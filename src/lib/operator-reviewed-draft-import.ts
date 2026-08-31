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
import {
  isGoogleSitesPhotoUrl,
  MAX_REVIEWED_PHOTO_TRANSFER_BYTES,
  MAX_REVIEWED_PHOTO_TRANSFER_TOTAL_BYTES,
} from "@/lib/reviewed-photo-transfer";
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
  photoTransfers: z
    .array(
      z.object({
        sourceUrl: z
          .url()
          .refine(
            isGoogleSitesPhotoUrl,
            "Only reviewed Google Sites photos may be transferred",
          ),
        mediaType: z.enum([
          "image/avif",
          "image/jpeg",
          "image/png",
          "image/webp",
        ]),
        dataBase64: z
          .base64()
          .max(Math.ceil((MAX_REVIEWED_PHOTO_TRANSFER_BYTES * 4) / 3) + 4),
      }),
    )
    .max(160)
    .default([]),
});

type TransferredReviewedPhoto = {
  sourceUrl: string;
  mediaType: "image/avif" | "image/jpeg" | "image/png" | "image/webp";
  data: Uint8Array;
};

export type ReviewedDraftImport = {
  vertical: VerticalId;
  draft: PersistableSiteDraft;
  transferredPhotos?: TransferredReviewedPhoto[];
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
  if (
    imports.some(
      (entry) =>
        !registeredSiteTheme(entry.vertical, entry.draft.attributes),
    )
  ) {
    throw new Error("A reviewed draft batch requires scored vertical themes");
  }
  const slugs = imports.map((entry) => entry.draft.slug);
  if (new Set(slugs).size !== slugs.length) {
    throw new Error("Reviewed draft slugs must be unique");
  }
  const photoUrls = new Set(
    imports.flatMap((entry) =>
      reviewedDraftPhotoPlan(entry.draft).map((photo) => photo.sourceUrl),
    ),
  );
  const transferredPhotos = batch.photoTransfers.map((transfer) => ({
    sourceUrl: transfer.sourceUrl,
    mediaType: transfer.mediaType,
    data: new Uint8Array(Buffer.from(transfer.dataBase64, "base64")),
  }));
  const transferredUrls = transferredPhotos.map((photo) => photo.sourceUrl);
  if (new Set(transferredUrls).size !== transferredUrls.length) {
    throw new Error("Transferred reviewed photo URLs must be unique");
  }
  if (transferredPhotos.some((photo) => !photoUrls.has(photo.sourceUrl))) {
    throw new Error("A transferred photo is not selected by the reviewed draft");
  }
  if (
    transferredPhotos.some(
      (photo) => photo.data.byteLength > MAX_REVIEWED_PHOTO_TRANSFER_BYTES,
    ) ||
    transferredPhotos.reduce((total, photo) => total + photo.data.byteLength, 0) >
      MAX_REVIEWED_PHOTO_TRANSFER_TOTAL_BYTES
  ) {
    throw new Error("Transferred reviewed photos exceed the import size limit");
  }
  const missingGoogleSitesPhoto = [...photoUrls].find(
    (url) => isGoogleSitesPhotoUrl(url) && !transferredUrls.includes(url),
  );
  if (missingGoogleSitesPhoto) {
    throw new Error(
      "Reviewed Google Sites photos must be transferred by the operator client",
    );
  }
  return {
    batch: batch.batch,
    imports: imports.map((entry) => ({
      ...entry,
      transferredPhotos: transferredPhotos.filter((photo) =>
        reviewedDraftPhotoPlan(entry.draft).some(
          (planned) => planned.sourceUrl === photo.sourceUrl,
        ),
      ),
    })),
  };
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
    // The authenticated batch boundary requires scored themes. Keep this
    // lower-level primitive compatible with legacy atomicity callers while
    // limiting immutable photo adoption to the new renderer contract.
    const transferredPhotos = new Map(
      (input.transferredPhotos ?? []).map((photo) => [photo.sourceUrl, photo]),
    );
    const photoPlan = expectedTheme
      ? reviewedDraftPhotoPlan(input.draft).map((photo) => ({
          ...photo,
          transferred: transferredPhotos.get(photo.sourceUrl),
        }))
      : [];
    const photoImport = expectedTheme
      ? await ingestReviewedSitePhotos({
          siteId: imported.siteId,
          siteSlug: imported.draft.slug,
          vertical: input.vertical,
          photos: photoPlan,
          actor: "reviewed-draft-import",
        })
      : { selected: 0, ingested: 0, deduplicated: 0 };
    if (expectedTheme && photoImport.selected !== photoPlan.length) {
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
      (Boolean(input.draft.heroImageUrl) && !verified.heroImageUrl) ||
      (expectedTheme &&
        (verified.draftThemeVersion !== expectedTheme.version ||
          (verifiedTheme?.themeId ?? verifiedTheme?.id) !== expectedTheme.id)) ||
      verified.defaultLocale !== input.draft.defaultLocale ||
      verified._count.catalogSections !== input.draft.catalogSections.length ||
      verifiedItemCount !== expectedItemCount ||
      verified._count.integrations !== input.draft.integrations.length ||
      (expectedTheme &&
        (verifiedPhotoUsages?.filter((usage) => usage === "HERO").length !==
          photoPlan.filter((photo) => photo.usage === "HERO").length ||
          verifiedPhotoUsages?.filter((usage) => usage === "GALLERY").length !==
            photoPlan.filter((photo) => photo.usage === "GALLERY").length))
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
