import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import type {
  ImageProvenance,
  PhotoSourceKind,
  PhotoUsage,
  Vertical,
} from "@/generated/prisma/enums";
import { enhanceSiteImage } from "@/lib/ai/site-generation";
import { getDb } from "@/lib/db";
import { fetchPublicImage, type DiscoveredSourcePhoto } from "@/lib/importer";
import {
  PhotoImageValidationError,
  validatePhotoImageBytes,
} from "@/lib/photo-image-validation";
import {
  canReservePhotoEnhancement,
  enhancementReservationMicros,
  getPhotoSystemConfig,
  mapWithConcurrency,
  photoEnhancementConfigVersion,
  photoEnhancementIdempotencyKey,
  recordedEnhancementCostMicros,
} from "@/lib/photo-policy";
import {
  storeImmutableEnhancedPhoto,
  storeImmutableSiteOriginal,
} from "@/lib/storage/images";
import { resolveVerticalConfig } from "@/lib/verticals/registry";

const MAX_OWNER_UPLOAD_BYTES = 12_000_000;

export class PhotoLibraryError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "PHOTO_LIBRARY_ERROR",
  ) {
    super(message);
    this.name = "PhotoLibraryError";
  }
}

export type PhotoLibraryDto = Awaited<ReturnType<typeof getPhotoLibrary>>;
export { detectSupportedImageMediaType } from "@/lib/photo-image-validation";

function actorLabel(actor: { id: string; role: "owner" | "operator" }) {
  return `${actor.role}:${actor.id}`;
}

export async function ingestDiscoveredSitePhotos(input: {
  siteId: string;
  siteSlug: string;
  vertical: Vertical;
  photos: DiscoveredSourcePhoto[];
  actor?: string;
}): Promise<{ ingested: number; deduplicated: number; failed: number }> {
  const config = getPhotoSystemConfig();
  const photos = input.photos.slice(0, config.discoveryMaxImages);
  const results = await mapWithConcurrency(
    photos,
    config.ingestConcurrency,
    async (photo) => {
      try {
        const fetched = await fetchPublicImage(photo.sourceUrl);
        const ingested = await ingestPhotoBytes({
          siteId: input.siteId,
          siteSlug: input.siteSlug,
          vertical: input.vertical,
          sourceUrl: photo.sourceUrl,
          sourcePageUrl: photo.sourcePageUrl,
          provenance: "OFFICIAL",
          sourceKind: "FIRST_PARTY",
          reviewStatus: "PENDING",
          candidateUsages: photo.candidateUsages,
          data: fetched.data,
          claimedMediaType: fetched.mediaType,
          actor: input.actor ?? "system:photo-ingest",
        });
        return ingested.outcome;
      } catch {
        return "failed" as const;
      }
    },
  );
  const summary = {
    ingested: results.filter((result) => result === "ingested").length,
    deduplicated: results.filter((result) => result === "deduplicated").length,
    failed: results.filter((result) => result === "failed").length,
  };
  await getDb().auditEvent.create({
    data: {
      siteId: input.siteId,
      type: "photo.discovery.completed",
      actor: input.actor ?? "system:photo-ingest",
      metadata: { discovered: photos.length, ...summary },
    },
  });
  return summary;
}

export async function ingestOwnerPhoto(input: {
  siteId: string;
  siteSlug: string;
  vertical: Vertical;
  sourceUrl?: string;
  upload?: { data: Uint8Array; mediaType: string; filename?: string };
  candidateUsages: PhotoUsage[];
  actor: { id: string; role: "owner" | "operator" };
}) {
  if (Boolean(input.sourceUrl) === Boolean(input.upload)) {
    throw new PhotoLibraryError("Provide one photo URL or one uploaded file");
  }
  let data: Uint8Array;
  let claimedMediaType: string;
  let sourceUrl: string;
  let sourceKind: PhotoSourceKind;
  if (input.upload) {
    if (input.upload.data.byteLength > MAX_OWNER_UPLOAD_BYTES) {
      throw new PhotoLibraryError("The uploaded image is larger than 12 MB", 413);
    }
    data = input.upload.data;
    claimedMediaType = input.upload.mediaType;
    const sha256 = createHash("sha256").update(data).digest("hex");
    const safeFilename = (input.upload.filename ?? "photo")
      .replace(/[^a-z0-9._-]+/gi, "-")
      .slice(0, 120);
    sourceUrl = `owner-upload:${sha256}:${safeFilename || "photo"}`;
    sourceKind = "OWNER_UPLOAD";
  } else {
    const fetched = await fetchPublicImage(input.sourceUrl!);
    data = fetched.data;
    claimedMediaType = fetched.mediaType;
    sourceUrl = input.sourceUrl!;
    sourceKind = "OWNER_REFERENCE";
  }
  const ingested = await ingestPhotoBytes({
    siteId: input.siteId,
    siteSlug: input.siteSlug,
    vertical: input.vertical,
    sourceUrl,
    sourcePageUrl: null,
    provenance: "OWNER",
    sourceKind,
    reviewStatus: "APPROVED",
    candidateUsages:
      input.candidateUsages.length > 0 ? input.candidateUsages : ["GALLERY"],
    data,
    claimedMediaType,
    actor: actorLabel(input.actor),
  });
  return {
    result: ingested.outcome,
    library: await getPhotoLibrary(input.siteId),
  };
}

export type ReviewedSitePhoto = {
  sourceUrl: string;
  sourcePageUrl: string;
  usage: "HERO" | "GALLERY";
};

/**
 * Copies an operator-reviewed first-party photo into immutable storage, marks
 * the authentic original approved, and selects it for the supplied storefront
 * slot. Unlike discovery, this path never leaves reviewed preview imagery in a
 * pending state; unlike owner upload, it preserves official provenance.
 */
export async function ingestReviewedSitePhotos(input: {
  siteId: string;
  siteSlug: string;
  vertical: Vertical;
  photos: ReviewedSitePhoto[];
  actor: string;
}): Promise<{ selected: number; ingested: number; deduplicated: number }> {
  const config = getPhotoSystemConfig();
  const photos = input.photos.slice(0, config.discoveryMaxImages);
  const ingested = await mapWithConcurrency(
    photos,
    config.ingestConcurrency,
    async (photo) => {
      const fetched = await fetchPublicImage(photo.sourceUrl);
      const result = await ingestPhotoBytes({
        siteId: input.siteId,
        siteSlug: input.siteSlug,
        vertical: input.vertical,
        sourceUrl: photo.sourceUrl,
        sourcePageUrl: photo.sourcePageUrl,
        provenance: "OFFICIAL",
        sourceKind: "FIRST_PARTY",
        reviewStatus: "APPROVED",
        candidateUsages: [photo.usage],
        data: fetched.data,
        claimedMediaType: fetched.mediaType,
        actor: input.actor,
        promoteDuplicateToApproved: true,
      });
      return { photo, ...result };
    },
  );

  const selectedPhotoIds = new Set(ingested.map((result) => result.photoId));
  if (selectedPhotoIds.size !== ingested.length) {
    throw new PhotoLibraryError(
      "One reviewed image cannot fill more than one storefront slot",
      409,
      "DUPLICATE_REVIEWED_PHOTO_SLOT",
    );
  }
  const desiredPhotoIds = [...selectedPhotoIds];
  const staleSelections = await getDb().photoAsset.findMany({
    where: {
      siteId: input.siteId,
      selectedUsage: { in: ["HERO", "GALLERY"] },
      ...(desiredPhotoIds.length > 0
        ? { id: { notIn: desiredPhotoIds } }
        : {}),
    },
    select: { id: true },
  });
  for (const photo of staleSelections) {
    await reviewPhoto({
      siteId: input.siteId,
      photoId: photo.id,
      actor: { id: input.actor, role: "operator" },
      review: { action: "unselect" },
    });
  }

  for (const result of ingested) {
    await reviewPhoto({
      siteId: input.siteId,
      photoId: result.photoId,
      actor: { id: input.actor, role: "operator" },
      review: {
        action:
          result.photo.usage === "HERO" ? "select_hero" : "select_gallery",
      },
    });
  }

  const summary = {
    selected: ingested.length,
    ingested: ingested.filter((result) => result.outcome === "ingested").length,
    deduplicated: ingested.filter(
      (result) => result.outcome === "deduplicated",
    ).length,
  };
  await getDb().auditEvent.create({
    data: {
      siteId: input.siteId,
      type: "photo.reviewed-import.completed",
      actor: input.actor,
      metadata: { requested: photos.length, ...summary },
    },
  });
  return summary;
}

async function ingestPhotoBytes(input: {
  siteId: string;
  siteSlug: string;
  vertical: Vertical;
  sourceUrl: string;
  sourcePageUrl: string | null;
  provenance: ImageProvenance;
  sourceKind: PhotoSourceKind;
  reviewStatus: "PENDING" | "APPROVED";
  candidateUsages: PhotoUsage[];
  data: Uint8Array;
  claimedMediaType: string;
  actor: string;
  promoteDuplicateToApproved?: boolean;
}): Promise<{
  outcome: "ingested" | "deduplicated";
  photoId: string;
}> {
  let validatedImage: Awaited<ReturnType<typeof validatePhotoImageBytes>>;
  try {
    validatedImage = await validatePhotoImageBytes({
      data: input.data,
      claimedMediaType: input.claimedMediaType,
    });
  } catch (error) {
    if (error instanceof PhotoImageValidationError) {
      throw new PhotoLibraryError(error.message, 400, error.code);
    }
    throw error;
  }
  const stored = await storeImmutableSiteOriginal({
    siteSlug: input.siteSlug,
    vertical: input.vertical,
    data: input.data,
    mediaType: validatedImage.mediaType,
  });
  const db = getDb();
  const existing = await db.photoAsset.findUnique({
    where: {
      siteId_contentSha256: {
        siteId: input.siteId,
        contentSha256: stored.sha256,
      },
    },
    select: { id: true, candidateUsages: true },
  });
  if (existing) {
    await promoteOperatorReviewedDuplicate({
      photoId: existing.id,
      candidateUsages: existing.candidateUsages,
      input,
    });
    return { outcome: "deduplicated", photoId: existing.id };
  }
  try {
    const photoId = await db.$transaction(async (transaction) => {
      const photo = await transaction.photoAsset.create({
        data: {
          siteId: input.siteId,
          sourceUrl: input.sourceUrl,
          sourcePageUrl: input.sourcePageUrl,
          provenance: input.provenance,
          sourceKind: input.sourceKind,
          contentSha256: stored.sha256,
          originalStorageKey: stored.key,
          originalUrl: stored.url,
          mediaType: validatedImage.mediaType,
          byteLength: input.data.byteLength,
          width: validatedImage.width,
          height: validatedImage.height,
          candidateUsages: [...new Set(input.candidateUsages)],
          reviewStatus: input.reviewStatus,
          reviewedAt: input.reviewStatus === "APPROVED" ? new Date() : null,
          reviewedBy: input.reviewStatus === "APPROVED" ? input.actor : null,
        },
        select: { id: true },
      });
      await transaction.auditEvent.create({
        data: {
          siteId: input.siteId,
          type: "photo.original.persisted",
          actor: input.actor,
          metadata: {
            photoId: photo.id,
            provenance: input.provenance,
            sourceKind: input.sourceKind,
            sourcePageUrl: input.sourcePageUrl,
            contentSha256: stored.sha256,
            candidateUsages: input.candidateUsages,
          },
        },
      });
      return photo.id;
    });
    return { outcome: "ingested", photoId };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const duplicate = await db.photoAsset.findUniqueOrThrow({
        where: {
          siteId_contentSha256: {
            siteId: input.siteId,
            contentSha256: stored.sha256,
          },
        },
        select: { id: true, candidateUsages: true },
      });
      await promoteOperatorReviewedDuplicate({
        photoId: duplicate.id,
        candidateUsages: duplicate.candidateUsages,
        input,
      });
      return { outcome: "deduplicated", photoId: duplicate.id };
    }
    throw error;
  }
}

async function promoteOperatorReviewedDuplicate(input: {
  photoId: string;
  candidateUsages: PhotoUsage[];
  input: {
    reviewStatus: "PENDING" | "APPROVED";
    candidateUsages: PhotoUsage[];
    actor: string;
    promoteDuplicateToApproved?: boolean;
  };
}) {
  if (!input.input.promoteDuplicateToApproved) return;
  await getDb().photoAsset.update({
    where: { id: input.photoId },
    data: {
      reviewStatus: "APPROVED",
      reviewedAt: new Date(),
      reviewedBy: input.input.actor,
      candidateUsages: [
        ...new Set([
          ...input.candidateUsages,
          ...input.input.candidateUsages,
        ]),
      ],
    },
  });
}

export async function getPhotoLibrary(siteId: string) {
  const [photos, catalogItems, site, siteSpend] = await Promise.all([
    getDb().photoAsset.findMany({
      where: { siteId },
      orderBy: [{ selectedUsage: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        sourceUrl: true,
        sourcePageUrl: true,
        provenance: true,
        sourceKind: true,
        contentSha256: true,
        originalUrl: true,
        mediaType: true,
        byteLength: true,
        width: true,
        height: true,
        candidateUsages: true,
        reviewStatus: true,
        selectedUsage: true,
        selectedCatalogItemId: true,
        activeVariant: true,
        enhancedUrl: true,
        enhancedReviewStatus: true,
        enhancementStatus: true,
        enhancementModel: true,
        enhancementConfigVersion: true,
        enhancementCostMicros: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    getDb().catalogItem.findMany({
      where: { section: { siteId } },
      orderBy: [{ section: { position: "asc" } }, { position: "asc" }],
      select: {
        id: true,
        name: true,
        position: true,
        section: { select: { name: true, position: true } },
      },
    }),
    getDb().site.findUniqueOrThrow({
      where: { id: siteId },
      select: { draftRevision: true },
    }),
    photoSiteSpendState(siteId),
  ]);
  const config = getPhotoSystemConfig();
  return {
    draftRevision: site.draftRevision,
    photos: photos.map((photo) => ({
      ...photo,
      createdAt: photo.createdAt.toISOString(),
      updatedAt: photo.updatedAt.toISOString(),
    })),
    catalogItems: catalogItems.map((item) => ({
      id: item.id,
      name: item.name,
      sectionName: item.section.name,
      sectionIndex: item.section.position,
      itemIndex: item.position,
    })),
    budget: {
      committedMicros: siteSpend.committedMicros,
      ceilingMicros: config.perSiteCostCeilingMicros,
      perImageCeilingMicros: config.perImageCostCeilingMicros,
      enhancementsDisabled: siteSpend.enhancementsDisabled,
      disableReason: siteSpend.disableReason,
    },
  };
}

async function photoSiteSpendState(siteId: string): Promise<{
  committedMicros: number;
  enhancementsDisabled: boolean;
  disableReason: "PROVIDER_COST_CEILING_EXCEEDED" | "SITE_COST_CEILING" | null;
}> {
  const config = getPhotoSystemConfig();
  const runs = await getDb().photoEnhancementRun.findMany({
    where: { siteId },
    select: {
      estimatedCostMicros: true,
      actualCostMicros: true,
      errorCode: true,
    },
  });
  const committedMicros = runs.reduce(
    (total, run) => total + (run.actualCostMicros ?? run.estimatedCostMicros),
    0,
  );
  const providerOverrun = runs.some(
    (run) => run.errorCode === "PROVIDER_COST_CEILING_EXCEEDED",
  );
  const siteAdmissionClosed = !canReservePhotoEnhancement({
    committedMicros,
    reservationMicros: config.perImageCostCeilingMicros,
    siteCeilingMicros: config.perSiteCostCeilingMicros,
  });
  return {
    committedMicros,
    enhancementsDisabled: providerOverrun || siteAdmissionClosed,
    disableReason: providerOverrun
      ? "PROVIDER_COST_CEILING_EXCEEDED"
      : siteAdmissionClosed
        ? "SITE_COST_CEILING"
        : null,
  };
}

export type PhotoReviewAction =
  | { action: "approve_original" }
  | { action: "reject_original" }
  | { action: "approve_enhancement" }
  | { action: "reject_enhancement" }
  | { action: "restore_original" }
  | { action: "select_hero" }
  | { action: "select_gallery" }
  | { action: "select_catalog"; catalogItemId: string }
  | { action: "unselect" };

export async function reviewPhoto(input: {
  siteId: string;
  photoId: string;
  expectedRevision?: number;
  actor: { id: string; role: "owner" | "operator" };
  review: PhotoReviewAction;
}) {
  const db = getDb();
  const persistReview = async (transaction: Prisma.TransactionClient) => {
    // Serialize every selection mutation for a site. The partial unique index is
    // the final invariant; this lock also keeps the Site projection in sync.
    const [lockedSite] = await transaction.$queryRaw<Array<{ draftRevision: number }>>`
      SELECT "draftRevision" FROM "Site" WHERE "id" = ${input.siteId} FOR UPDATE
    `;
    if (!lockedSite) throw new PhotoLibraryError("Site not found", 404);
    if (
      input.expectedRevision !== undefined &&
      lockedSite.draftRevision !== input.expectedRevision
    ) {
      throw new PhotoLibraryError(
        "This draft changed in another tab. Refresh the photo library and try again.",
        409,
        "DRAFT_REVISION_CONFLICT",
      );
    }
    const photo = await transaction.photoAsset.findFirst({
      where: { id: input.photoId, siteId: input.siteId },
    });
    if (!photo) throw new PhotoLibraryError("Photo not found", 404);
    const actor = actorLabel(input.actor);
    const now = new Date();
    const action = input.review.action;

    if (action === "approve_original") {
      await transaction.photoAsset.update({
        where: { id: photo.id },
        data: { reviewStatus: "APPROVED", reviewedAt: now, reviewedBy: actor },
      });
    } else if (action === "reject_original") {
      if (photo.selectedUsage) {
        throw new PhotoLibraryError("Unselect this photo before rejecting it", 409);
      }
      await transaction.photoAsset.update({
        where: { id: photo.id },
        data: { reviewStatus: "REJECTED", reviewedAt: now, reviewedBy: actor },
      });
    } else if (action === "approve_enhancement") {
      if (!photo.enhancedUrl || photo.enhancementStatus !== "SUCCEEDED") {
        throw new PhotoLibraryError("This photo has no completed enhancement", 409);
      }
      await transaction.photoAsset.update({
        where: { id: photo.id },
        data: { enhancedReviewStatus: "APPROVED", activeVariant: "ENHANCED" },
      });
      if (photo.selectedUsage === "HERO") {
        await updateHeroSelection(
          transaction,
          { ...photo, enhancedReviewStatus: "APPROVED" },
          "ENHANCED",
        );
      } else if (photo.selectedUsage === "CATALOG" && photo.selectedCatalogItemId) {
        await transaction.catalogItem.update({
          where: { id: photo.selectedCatalogItemId },
          data: { imageUrl: photo.enhancedUrl },
        });
        await transaction.site.update({
          where: { id: input.siteId },
          data: { draftRevision: { increment: 1 } },
        });
      } else if (photo.selectedUsage === "GALLERY") {
        await incrementDraftRevision(transaction, input.siteId);
      }
    } else if (action === "reject_enhancement" || action === "restore_original") {
      await transaction.photoAsset.update({
        where: { id: photo.id },
        data: {
          activeVariant: "ORIGINAL",
          ...(action === "reject_enhancement"
            ? { enhancedReviewStatus: "REJECTED" as const }
            : {}),
        },
      });
      if (photo.selectedUsage === "HERO") {
        await updateHeroSelection(transaction, photo, "ORIGINAL");
      } else if (photo.selectedUsage === "CATALOG" && photo.selectedCatalogItemId) {
        await transaction.catalogItem.update({
          where: { id: photo.selectedCatalogItemId },
          data: { imageUrl: photo.originalUrl },
        });
        await transaction.site.update({
          where: { id: input.siteId },
          data: { draftRevision: { increment: 1 } },
        });
      } else if (
        photo.selectedUsage === "GALLERY" &&
        photo.activeVariant !== "ORIGINAL"
      ) {
        await incrementDraftRevision(transaction, input.siteId);
      }
    } else {
      if (photo.reviewStatus !== "APPROVED" && action !== "unselect") {
        throw new PhotoLibraryError("Approve the authentic original before selecting it", 409);
      }
      if (action === "select_hero") {
        if (photo.selectedUsage === "CATALOG" && photo.selectedCatalogItemId) {
          await transaction.catalogItem.update({
            where: { id: photo.selectedCatalogItemId },
            data: { imageUrl: null, originalImageUrl: null, imageProvenance: null },
          });
        }
        await transaction.photoAsset.updateMany({
          where: { siteId: input.siteId, selectedUsage: "HERO", id: { not: photo.id } },
          data: { selectedUsage: null },
        });
        await transaction.photoAsset.update({
          where: { id: photo.id },
          data: { selectedUsage: "HERO", selectedCatalogItemId: null },
        });
        await updateHeroSelection(transaction, photo, photo.activeVariant);
      } else if (action === "select_gallery") {
        if (photo.selectedUsage === "CATALOG" && photo.selectedCatalogItemId) {
          await transaction.catalogItem.update({
            where: { id: photo.selectedCatalogItemId },
            data: { imageUrl: null, originalImageUrl: null, imageProvenance: null },
          });
        }
        if (photo.selectedUsage === "HERO") {
          await transaction.site.update({
            where: { id: input.siteId },
            data: {
              heroImageUrl: null,
              heroOriginalImageUrl: null,
              heroImageProvenance: null,
              draftRevision: { increment: 1 },
            },
          });
        } else if (photo.selectedUsage === "CATALOG") {
          await transaction.site.update({
            where: { id: input.siteId },
            data: { draftRevision: { increment: 1 } },
          });
        } else if (photo.selectedUsage !== "GALLERY") {
          await incrementDraftRevision(transaction, input.siteId);
        }
        await transaction.photoAsset.update({
          where: { id: photo.id },
          data: { selectedUsage: "GALLERY", selectedCatalogItemId: null },
        });
      } else if (action === "select_catalog") {
        const item = await transaction.catalogItem.findFirst({
          where: {
            id: input.review.catalogItemId,
            section: { siteId: input.siteId },
          },
          select: { id: true },
        });
        if (!item) throw new PhotoLibraryError("Catalog item not found", 404);
        if (
          photo.selectedUsage === "CATALOG" &&
          photo.selectedCatalogItemId &&
          photo.selectedCatalogItemId !== item.id
        ) {
          await transaction.catalogItem.update({
            where: { id: photo.selectedCatalogItemId },
            data: { imageUrl: null, originalImageUrl: null, imageProvenance: null },
          });
        }
        if (photo.selectedUsage === "HERO") {
          await transaction.site.update({
            where: { id: input.siteId },
            data: {
              heroImageUrl: null,
              heroOriginalImageUrl: null,
              heroImageProvenance: null,
            },
          });
        }
        await transaction.photoAsset.updateMany({
          where: { selectedCatalogItemId: item.id },
          data: { selectedUsage: null, selectedCatalogItemId: null },
        });
        const imageUrl = activePhotoUrl(photo);
        await transaction.catalogItem.update({
          where: { id: item.id },
          data: {
            imageUrl,
            originalImageUrl: photo.originalUrl,
            imageProvenance: photo.provenance,
          },
        });
        await transaction.photoAsset.update({
          where: { id: photo.id },
          data: { selectedUsage: "CATALOG", selectedCatalogItemId: item.id },
        });
        await transaction.site.update({
          where: { id: input.siteId },
          data: { draftRevision: { increment: 1 } },
        });
      } else {
        if (photo.selectedUsage === "CATALOG" && photo.selectedCatalogItemId) {
          await transaction.catalogItem.update({
            where: { id: photo.selectedCatalogItemId },
            data: { imageUrl: null, originalImageUrl: null, imageProvenance: null },
          });
          await transaction.site.update({
            where: { id: input.siteId },
            data: { draftRevision: { increment: 1 } },
          });
        }
        await transaction.photoAsset.update({
          where: { id: photo.id },
          data: { selectedUsage: null, selectedCatalogItemId: null },
        });
        if (photo.selectedUsage === "HERO") {
          await transaction.site.update({
            where: { id: input.siteId },
            data: {
              heroImageUrl: null,
              heroOriginalImageUrl: null,
              heroImageProvenance: null,
              draftRevision: { increment: 1 },
            },
          });
        } else if (photo.selectedUsage === "GALLERY") {
          await incrementDraftRevision(transaction, input.siteId);
        }
      }
    }

    await transaction.auditEvent.create({
      data: {
        siteId: input.siteId,
        type: `photo.${action}`,
        actor,
        metadata: { photoId: photo.id, ...input.review },
      },
    });
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await db.$transaction(persistReview, { isolationLevel: "Serializable" });
      return getPhotoLibrary(input.siteId);
    } catch (error) {
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2034" || error.code === "P2002");
      if (retryable && attempt < 2) continue;
      throw error;
    }
  }
  throw new Error("The photo review could not be persisted");
}

async function incrementDraftRevision(
  transaction: Prisma.TransactionClient,
  siteId: string,
) {
  await transaction.site.update({
    where: { id: siteId },
    data: { draftRevision: { increment: 1 } },
  });
}

function activePhotoUrl(photo: {
  activeVariant: "ORIGINAL" | "ENHANCED";
  enhancedReviewStatus: "PENDING" | "APPROVED" | "REJECTED" | null;
  enhancedUrl: string | null;
  originalUrl: string;
}) {
  return photo.activeVariant === "ENHANCED" &&
    photo.enhancedReviewStatus === "APPROVED" &&
    photo.enhancedUrl
    ? photo.enhancedUrl
    : photo.originalUrl;
}

async function updateHeroSelection(
  transaction: Prisma.TransactionClient,
  photo: {
    siteId: string;
    originalUrl: string;
    enhancedUrl: string | null;
    enhancedReviewStatus: "PENDING" | "APPROVED" | "REJECTED" | null;
    provenance: ImageProvenance;
  },
  variant: "ORIGINAL" | "ENHANCED",
) {
  const heroImageUrl =
    variant === "ENHANCED" && photo.enhancedReviewStatus === "APPROVED"
      ? photo.enhancedUrl ?? photo.originalUrl
      : photo.originalUrl;
  await transaction.site.update({
    where: { id: photo.siteId },
    data: {
      heroImageUrl,
      heroOriginalImageUrl: photo.originalUrl,
      heroImageProvenance: photo.provenance,
      draftRevision: { increment: 1 },
    },
  });
}

export async function enhanceApprovedPhotos(input: {
  siteId: string;
  siteSlug: string;
  vertical: Vertical;
  photoIds: string[];
  idempotencyKey: string;
  enhancementNotes?: string;
  actor: { id: string; role: "owner" | "operator" };
}) {
  const config = getPhotoSystemConfig();
  const photoIds = [...new Set(input.photoIds)];
  if (photoIds.length === 0) {
    throw new PhotoLibraryError("Choose at least one approved photo");
  }
  if (photoIds.length > config.batchMaxImages) {
    throw new PhotoLibraryError(
      `Choose no more than ${config.batchMaxImages} photos per batch`,
    );
  }
  const vertical = resolveVerticalConfig(input.vertical);
  const configVersion = photoEnhancementConfigVersion(
    config,
    vertical,
    input.enhancementNotes,
  );
  const results = await mapWithConcurrency(
    photoIds,
    config.enhancementConcurrency,
    async (photoId) => {
      let run: Awaited<ReturnType<typeof reserveEnhancementRun>>;
      try {
        run = await reserveEnhancementRun({
          siteId: input.siteId,
          photoId,
          actor: actorLabel(input.actor),
          model: config.model,
          configVersion,
        });
      } catch (error) {
        return {
          photoId,
          status: "SKIPPED" as const,
          errorCode:
            error instanceof PhotoLibraryError
              ? error.code
              : "RESERVATION_FAILURE",
        };
      }
      if (run.status !== "QUEUED") return run;
      const claimed = await claimEnhancementRun(run.id, config.enhancementConcurrency);
      if (!claimed) {
        const replay = await getDb().photoEnhancementRun.findUniqueOrThrow({
          where: { id: run.id },
        });
        if (replay.status !== "QUEUED") return replay;
        await failUnclaimedEnhancementRun({
          runId: run.id,
          siteId: input.siteId,
          photoId,
          actor: actorLabel(input.actor),
        });
        return {
          ...run,
          status: "FAILED" as const,
          actualCostMicros: 0,
          errorCode: "CONCURRENCY_LIMIT",
        };
      }
      let actualCostMicros = run.estimatedCostMicros;
      try {
        const photo = await getDb().photoAsset.findFirstOrThrow({
          where: { id: photoId, siteId: input.siteId },
        });
        const image = await enhanceSiteImage(
          {
            sourceImageUrl: photo.originalUrl,
            siteName: input.siteSlug,
            enhancementNotes: input.enhancementNotes,
            model: config.model,
          },
          vertical,
        );
        actualCostMicros = recordedEnhancementCostMicros(
          image.costMicros,
          run.estimatedCostMicros,
          config.perImageCostCeilingMicros,
        );
        if (actualCostMicros > config.perImageCostCeilingMicros) {
          await failEnhancementCostOverrun({
            runId: run.id,
            siteId: input.siteId,
            photoId,
            actor: actorLabel(input.actor),
            actualCostMicros,
            perImageCeilingMicros: config.perImageCostCeilingMicros,
          });
          return {
            ...run,
            status: "FAILED" as const,
            actualCostMicros,
            errorCode: "PROVIDER_COST_CEILING_EXCEEDED",
          };
        }
        const validatedImage = await validatePhotoImageBytes({
          data: image.data,
          claimedMediaType: image.mediaType,
        });
        const stored = await storeImmutableEnhancedPhoto({
          siteSlug: input.siteSlug,
          vertical: input.vertical,
          sourceSha256: photo.contentSha256,
          configVersion,
          data: image.data,
          mediaType: validatedImage.mediaType,
        });
        await getDb().$transaction([
          getDb().photoEnhancementRun.update({
            where: { id: run.id },
            data: {
              status: "SUCCEEDED",
              actualCostMicros,
              completedAt: new Date(),
            },
          }),
          getDb().photoAsset.update({
            where: { id: photo.id },
            data: {
              enhancedUrl: stored.url,
              enhancedStorageKey: stored.key,
              enhancedReviewStatus: "PENDING",
              enhancementStatus: "SUCCEEDED",
              enhancementModel: config.model,
              enhancementConfigVersion: configVersion,
              enhancementCostMicros: actualCostMicros,
              activeVariant: "ORIGINAL",
            },
          }),
          getDb().auditEvent.create({
            data: {
              siteId: input.siteId,
              type: "photo.enhancement.completed",
              actor: actorLabel(input.actor),
              metadata: {
                photoId,
                runId: run.id,
                model: config.model,
                configVersion,
                actualCostMicros,
                ceilingExceeded: false,
              },
            },
          }),
        ]);
        return { ...run, status: "SUCCEEDED" as const, actualCostMicros };
      } catch (error) {
        const errorCode =
          error instanceof PhotoImageValidationError
            ? "INVALID_DERIVATIVE_OUTPUT"
            : "MODEL_OR_STORAGE_FAILURE";
        await getDb().$transaction([
          getDb().photoEnhancementRun.update({
            where: { id: run.id },
            data: {
              status: "FAILED",
              actualCostMicros,
              errorCode,
              completedAt: new Date(),
            },
          }),
          getDb().photoAsset.update({
            where: { id: photoId },
            data: { enhancementStatus: "FAILED", activeVariant: "ORIGINAL" },
          }),
          getDb().auditEvent.create({
            data: {
              siteId: input.siteId,
              type: "photo.enhancement.failed",
              actor: actorLabel(input.actor),
              metadata: { photoId, runId: run.id, errorCode, actualCostMicros },
            },
          }),
        ]);
        return { ...run, status: "FAILED" as const, actualCostMicros, errorCode };
      }
    },
  );
  return { results, library: await getPhotoLibrary(input.siteId) };
}

export async function reserveEnhancementRun(input: {
  siteId: string;
  photoId: string;
  actor: string;
  model: string;
  configVersion: string;
}) {
  const config = getPhotoSystemConfig();
  const estimatedCostMicros = enhancementReservationMicros({
    configuredEstimateMicros: config.estimatedCostMicros,
    perImageCeilingMicros: config.perImageCostCeilingMicros,
  });
  const identity = await getDb().photoAsset.findFirst({
    where: {
      id: input.photoId,
      siteId: input.siteId,
      reviewStatus: "APPROVED",
    },
    select: {
      contentSha256: true,
      originalStorageKey: true,
    },
  });
  if (!identity) {
    throw new PhotoLibraryError(
      "Only approved authentic photos can be enhanced",
      409,
    );
  }
  const idempotencyKey = photoEnhancementIdempotencyKey({
    siteId: input.siteId,
    photoId: input.photoId,
    contentSha256: identity.contentSha256,
    originalStorageKey: identity.originalStorageKey,
    model: input.model,
    configVersion: input.configVersion,
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await getDb().$transaction(
        async (transaction) => {
      const existing = await transaction.photoEnhancementRun.findUnique({
        where: { idempotencyKey },
      });
      if (existing) return existing;
      const photo = await transaction.photoAsset.findFirst({
        where: { id: input.photoId, siteId: input.siteId, reviewStatus: "APPROVED" },
        select: {
          id: true,
          enhancementStatus: true,
          enhancementModel: true,
          enhancementConfigVersion: true,
        },
      });
      if (!photo) {
        throw new PhotoLibraryError("Only approved authentic photos can be enhanced", 409);
      }
      if (
        photo.enhancementStatus === "SUCCEEDED" &&
        photo.enhancementModel === input.model &&
        photo.enhancementConfigVersion === input.configVersion
      ) {
        const skipped = await transaction.photoEnhancementRun.create({
          data: {
            siteId: input.siteId,
            photoId: input.photoId,
            idempotencyKey,
            status: "SKIPPED",
            model: input.model,
            configVersion: input.configVersion,
            estimatedCostMicros,
            actualCostMicros: 0,
            errorCode: "ALREADY_ENHANCED",
            requestedBy: input.actor,
            completedAt: new Date(),
          },
        });
        await transaction.auditEvent.create({
          data: {
            siteId: input.siteId,
            type: "photo.enhancement.skipped",
            actor: input.actor,
            metadata: {
              photoId: input.photoId,
              runId: skipped.id,
              errorCode: "ALREADY_ENHANCED",
              configVersion: input.configVersion,
            },
          },
        });
        return skipped;
      }
      const runs = await transaction.photoEnhancementRun.findMany({
        where: { siteId: input.siteId },
        select: {
          estimatedCostMicros: true,
          actualCostMicros: true,
          errorCode: true,
        },
      });
      const committed = runs.reduce(
        (total, run) => total + (run.actualCostMicros ?? run.estimatedCostMicros),
        0,
      );
      const providerCircuitOpen = runs.some(
        (run) => run.errorCode === "PROVIDER_COST_CEILING_EXCEEDED",
      );
      if (
        providerCircuitOpen ||
        !canReservePhotoEnhancement({
          committedMicros: committed,
          reservationMicros: estimatedCostMicros,
          siteCeilingMicros: config.perSiteCostCeilingMicros,
        })
      ) {
        const skipped = await transaction.photoEnhancementRun.create({
          data: {
            siteId: input.siteId,
            photoId: input.photoId,
            idempotencyKey,
            status: "SKIPPED",
            model: input.model,
            configVersion: input.configVersion,
            estimatedCostMicros,
            actualCostMicros: 0,
            errorCode: providerCircuitOpen
              ? "PROVIDER_COST_CIRCUIT_OPEN"
              : "SITE_COST_CEILING",
            requestedBy: input.actor,
            completedAt: new Date(),
          },
        });
        await transaction.auditEvent.create({
          data: {
            siteId: input.siteId,
            type: "photo.enhancement.skipped",
            actor: input.actor,
            metadata: {
              photoId: input.photoId,
              runId: skipped.id,
              errorCode: providerCircuitOpen
                ? "PROVIDER_COST_CIRCUIT_OPEN"
                : "SITE_COST_CEILING",
              committedMicros: committed,
              reservationMicros: estimatedCostMicros,
              siteCeilingMicros: config.perSiteCostCeilingMicros,
            },
          },
        });
        await transaction.photoAsset.update({
          where: { id: input.photoId },
          data: { enhancementStatus: "SKIPPED", activeVariant: "ORIGINAL" },
        });
        return skipped;
      }
      await transaction.photoAsset.update({
        where: { id: photo.id },
        data: { enhancementStatus: "QUEUED" },
      });
      const queued = await transaction.photoEnhancementRun.create({
        data: {
          siteId: input.siteId,
          photoId: input.photoId,
          idempotencyKey,
          status: "QUEUED",
          model: input.model,
          configVersion: input.configVersion,
          estimatedCostMicros,
          requestedBy: input.actor,
        },
      });
      await transaction.auditEvent.create({
        data: {
          siteId: input.siteId,
          type: "photo.enhancement.queued",
          actor: input.actor,
          metadata: {
            photoId: input.photoId,
            runId: queued.id,
            model: input.model,
            configVersion: input.configVersion,
            estimatedCostMicros,
          },
        },
      });
      return queued;
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const replay = await getDb().photoEnhancementRun.findUnique({
          where: { idempotencyKey },
        });
        if (replay) return replay;
      }
      if (
        attempt < 2 &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034"
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("The enhancement reservation could not be persisted");
}

export async function claimEnhancementRun(runId: string, concurrency: number) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await getDb().$transaction(
        async (transaction) => {
          const staleRuns = await transaction.photoEnhancementRun.findMany({
            where: {
              status: "RUNNING",
              updatedAt: { lt: new Date(Date.now() - 15 * 60_000) },
            },
            select: { id: true, photoId: true },
          });
          await transaction.photoEnhancementRun.updateMany({
            where: { id: { in: staleRuns.map((run) => run.id) } },
            data: {
              status: "FAILED",
              actualCostMicros: 0,
              errorCode: "STALE_CONCURRENCY_LEASE",
              completedAt: new Date(),
            },
          });
          await transaction.photoAsset.updateMany({
            where: { id: { in: staleRuns.map((run) => run.photoId) } },
            data: { enhancementStatus: "FAILED", activeVariant: "ORIGINAL" },
          });
          const running = await transaction.photoEnhancementRun.count({
            where: { status: "RUNNING" },
          });
          if (running >= concurrency) return false;
          const claimed = await transaction.photoEnhancementRun.updateMany({
            where: { id: runId, status: "QUEUED" },
            data: { status: "RUNNING", startedAt: new Date() },
          });
          if (claimed.count !== 1) return false;
          const run = await transaction.photoEnhancementRun.findUniqueOrThrow({
            where: { id: runId },
            select: { photoId: true },
          });
          await transaction.photoAsset.update({
            where: { id: run.photoId },
            data: { enhancementStatus: "RUNNING" },
          });
          return true;
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      if (
        attempt < 2 &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034"
      ) {
        continue;
      }
      throw error;
    }
  }
  return false;
}

async function failUnclaimedEnhancementRun(input: {
  runId: string;
  siteId: string;
  photoId: string;
  actor: string;
}) {
  await getDb().$transaction(async (transaction) => {
    const failed = await transaction.photoEnhancementRun.updateMany({
      where: { id: input.runId, status: "QUEUED" },
      data: {
        status: "FAILED",
        actualCostMicros: 0,
        errorCode: "CONCURRENCY_LIMIT",
        completedAt: new Date(),
      },
    });
    if (failed.count !== 1) return;
    await transaction.photoAsset.update({
      where: { id: input.photoId },
      data: { enhancementStatus: "FAILED", activeVariant: "ORIGINAL" },
    });
    await transaction.auditEvent.create({
      data: {
        siteId: input.siteId,
        type: "photo.enhancement.failed",
        actor: input.actor,
        metadata: {
          photoId: input.photoId,
          runId: input.runId,
          errorCode: "CONCURRENCY_LIMIT",
        },
      },
    });
  });
}

async function failEnhancementCostOverrun(input: {
  runId: string;
  siteId: string;
  photoId: string;
  actor: string;
  actualCostMicros: number;
  perImageCeilingMicros: number;
}) {
  await getDb().$transaction([
    getDb().photoEnhancementRun.update({
      where: { id: input.runId },
      data: {
        status: "FAILED",
        actualCostMicros: input.actualCostMicros,
        errorCode: "PROVIDER_COST_CEILING_EXCEEDED",
        completedAt: new Date(),
      },
    }),
    getDb().photoAsset.update({
      where: { id: input.photoId },
      data: { enhancementStatus: "FAILED", activeVariant: "ORIGINAL" },
    }),
    getDb().auditEvent.create({
      data: {
        siteId: input.siteId,
        type: "photo.enhancement.cost_ceiling_exceeded",
        actor: input.actor,
        metadata: {
          photoId: input.photoId,
          runId: input.runId,
          actualCostMicros: input.actualCostMicros,
          perImageCeilingMicros: input.perImageCeilingMicros,
          futureEnhancementsDisabled: true,
        },
      },
    }),
  ]);
}
