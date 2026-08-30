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
        _count: { select: { catalogSections: true, integrations: true } },
        catalogSections: {
          select: { _count: { select: { items: true } } },
        },
      },
    });
    const verifiedItemCount =
      verified?.catalogSections.reduce(
        (sum, section) => sum + section._count.items,
        0,
      ) ?? -1;
    if (
      !verified ||
      verified.slug !== identity.slug ||
      verified.sourceKey !== identity.sourceKey ||
      verified.status !== "PREVIEW_READY" ||
      verified._count.catalogSections !== input.draft.catalogSections.length ||
      verifiedItemCount !== expectedItemCount ||
      verified._count.integrations !== input.draft.integrations.length
    ) {
      throw new Error("The reviewed draft failed its database verification");
    }

    return {
      slug: imported.draft.slug,
      created: imported.created,
      urls: imported.urls,
      verified: true as const,
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
