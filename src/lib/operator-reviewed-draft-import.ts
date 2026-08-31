import { z } from "zod";
import { Vertical } from "@/generated/prisma/enums";
import { getDb } from "@/lib/db";
import {
  buildOperatorImportIdentity,
  createImportJob,
  persistSiteImport,
  recordImportFailure,
  type PersistableSiteDraft,
} from "@/lib/site-persistence";
import { resolveVerticalConfig } from "@/lib/verticals/registry";
import type { VerticalId } from "@/lib/verticals/types";
import {
  ingestReviewedSitePhotos,
  type ReviewedSitePhoto,
} from "@/lib/photo-library";
import { registeredSiteTheme } from "@/lib/site-themes/adapters";

const reviewedDraftEnvelopeSchema = z.object({
  vertical: z.enum(Vertical),
  draft: z.unknown(),
});

const reviewedDraftBatchSchema = z.object({
  batch: z.string().trim().min(1).max(100),
  locked: z.literal(true),
  vertical: z.enum(Vertical),
  drafts: z.array(z.unknown()).min(1).max(20),
});

export type ReviewedDraftImport = {
  vertical: VerticalId;
  draft: PersistableSiteDraft;
};

export type ReviewedDraftBatchImport = {
  batch: string;
  imports: ReviewedDraftImport[];
};

export function reviewedDraftPhotoPlan(
  draft: PersistableSiteDraft,
): ReviewedSitePhoto[] {
  if (!draft.sourceUrl) return [];
  const hero = draft.heroOriginalImageUrl ?? draft.heroImageUrl;
  return [
    ...(hero
      ? [
          {
            sourceUrl: hero,
            sourcePageUrl: draft.sourceUrl,
            usage: "HERO" as const,
          },
        ]
      : []),
    ...(draft.galleryImages ?? [])
      .map((image) => ({
        sourceUrl: image.originalUrl,
        sourcePageUrl: draft.sourceUrl!,
        usage: "GALLERY" as const,
      }))
      .filter((photo) => photo.sourceUrl !== hero),
  ].filter(
    (photo, index, photos) =>
      photos.findIndex(
        (candidate) =>
          candidate.sourceUrl === photo.sourceUrl &&
          candidate.usage === photo.usage,
      ) === index,
  );
}

export function parseReviewedDraftImport(input: unknown): ReviewedDraftImport {
  const envelope = reviewedDraftEnvelopeSchema.parse(input);
  const draft = resolveVerticalConfig(envelope.vertical).draftSchema.parse(
    envelope.draft,
  ) as PersistableSiteDraft;
  if (!draft.sourceUrl?.trim()) {
    throw new Error("A reviewed draft requires its public source URL");
  }
  return { vertical: envelope.vertical, draft };
}

export function parseReviewedDraftBatchImport(
  input: unknown,
): ReviewedDraftBatchImport {
  const batch = reviewedDraftBatchSchema.parse(input);
  const imports = batch.drafts.map((draft) =>
    parseReviewedDraftImport({ vertical: batch.vertical, draft }),
  );
  const slugs = imports.map((entry) => entry.draft.slug);
  if (new Set(slugs).size !== slugs.length) {
    throw new Error("Reviewed draft slugs must be unique");
  }
  return { batch: batch.batch, imports };
}

/**
 * Persists one private, source-reviewed draft exactly as supplied. The payload
 * stays outside the public repository and crosses only the authenticated
 * operator boundary. Re-running the same input updates a mutable preview;
 * claimed sites and any slug/source disagreement fail closed.
 */
export async function importReviewedOperatorDraft(input: ReviewedDraftImport) {
  const source = input.draft.sourceUrl!;
  const expectedTheme = registeredSiteTheme(
    input.vertical,
    input.draft.attributes,
  );
  if (!expectedTheme) {
    throw new Error("A reviewed draft requires a scored vertical theme");
  }
  const identity = buildOperatorImportIdentity(
    input.draft,
    source,
    [],
    input.vertical,
  );
  const importJob = await createImportJob(source, input.vertical);

  try {
    const imported = await persistSiteImport({
      draft: input.draft,
      vertical: input.vertical,
      source,
      importJobId: importJob.id,
      actor: "operator:reviewed-draft-import",
      requiredSlug: identity.slug,
    });
    const photoPlan = reviewedDraftPhotoPlan(input.draft);
    const photoImport = await ingestReviewedSitePhotos({
      siteId: imported.siteId,
      siteSlug: imported.draft.slug,
      vertical: input.vertical,
      photos: photoPlan,
      actor: "reviewed-draft-import",
    });
    if (photoImport.selected !== photoPlan.length) {
      throw new Error("The reviewed draft failed its photo verification");
    }
    const db = getDb();
    const expectedItemCount = input.draft.catalogSections.reduce(
      (sum, section) => sum + section.items.length,
      0,
    );
    const verified = await db.site.findUnique({
      where: { id: imported.siteId },
      select: {
        slug: true,
        sourceKey: true,
        status: true,
        logoUrl: true,
        heroImageUrl: true,
        draftThemeVersion: true,
        draftTheme: true,
        defaultLocale: true,
        _count: { select: { catalogSections: true, integrations: true } },
        catalogSections: {
          select: { _count: { select: { items: true } } },
        },
        photos: {
          where: {
            reviewStatus: "APPROVED",
            selectedUsage: { in: ["HERO", "GALLERY"] },
          },
          select: { selectedUsage: true },
        },
      },
    });
    const verifiedItemCount =
      verified?.catalogSections.reduce(
        (sum, section) => sum + section._count.items,
        0,
      ) ?? -1;
    const verifiedTheme = verified?.draftTheme as {
      id?: unknown;
      themeId?: unknown;
      rendererVersion?: unknown;
    } | null;
    const verifiedPhotoUsages = verified?.photos.map(
      (photo) => photo.selectedUsage,
    );
    if (
      !verified ||
      verified.slug !== identity.slug ||
      verified.sourceKey !== identity.sourceKey ||
      verified.status !== "PREVIEW_READY" ||
      verified.logoUrl !== input.draft.logoUrl ||
      !verified.heroImageUrl ||
      verified.draftThemeVersion !== expectedTheme.version ||
      (verifiedTheme?.themeId ?? verifiedTheme?.id) !== expectedTheme.id ||
      verified.defaultLocale !== input.draft.defaultLocale ||
      verified._count.catalogSections !== input.draft.catalogSections.length ||
      verifiedItemCount !== expectedItemCount ||
      verified._count.integrations !== input.draft.integrations.length ||
      verifiedPhotoUsages?.filter((usage) => usage === "HERO").length !==
        photoPlan.filter((photo) => photo.usage === "HERO").length ||
      verifiedPhotoUsages?.filter((usage) => usage === "GALLERY").length !==
        photoPlan.filter((photo) => photo.usage === "GALLERY").length
    ) {
      throw new Error("The reviewed draft failed its database verification");
    }

    return {
      slug: imported.draft.slug,
      created: imported.created,
      urls: imported.urls,
      verified: true as const,
      photoCount: photoImport.selected,
    };
  } catch (error) {
    await recordImportFailure(importJob.id, error);
    throw error;
  }
}

export async function importReviewedOperatorDraftBatch(
  input: ReviewedDraftBatchImport,
) {
  const results = [];
  // A failed run may have committed earlier rows. Each row is idempotent, so
  // retrying the same locked batch safely converges without duplicate slugs.
  for (const reviewedDraft of input.imports) {
    results.push(await importReviewedOperatorDraft(reviewedDraft));
  }
  return { batch: input.batch, count: results.length, results };
}
