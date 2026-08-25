import "server-only";
import { revalidateTag } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { Vertical } from "@/generated/prisma/enums";
import { getDb } from "@/lib/db";
import { siteStatusForDomainState } from "@/lib/domain-routing";
import {
  evidenceDigest,
  integrationUrlDigest,
} from "@/lib/evidence-digests";
import { hasUnreviewedRestaurantTranslations } from "@/lib/restaurant-menu-editor";
import { hasUnreviewedFoodRetailTranslations } from "@/lib/verticals/food-retail/editor";
import { DraftRevisionConflictError } from "@/lib/site-persistence";
import { previewCacheTagFor } from "@/lib/site-surface";
import {
  assertVerticalPublicationEnabled,
  SitePublicationCapabilityError,
} from "@/lib/site-publication-capability";
import {
  catalogItemHasUnselectedRemoteImage,
  projectHasUnselectedRemoteImage,
} from "@/lib/reviewed-photo-projection";
import {
  projectPublishedSiteVersion,
  projectSiteDraft,
  siteDraftRelations,
} from "@/lib/sites";
import type { VerticalId } from "@/lib/verticals/types";

export { SitePublicationCapabilityError };

const retryablePublishCodes = new Set(["P2002", "P2034"]);

export type PublishSiteDraftInput = {
  siteId: string;
  slug: string;
  vertical: VerticalId;
  actor: {
    id: string;
    email: string;
  };
  changeSummary: string;
  expectedRevision: number;
  now?: Date;
};

export type PublishedSiteVersion = {
  id: string;
  version: number;
  publishedAt: Date;
  theme: {
    id: string;
    version: string;
  };
};

export type SitePublicationHistoryItem = {
  id: string;
  version: number;
  publishedAt: Date;
  changeSummary: string;
  current: boolean;
  theme: {
    id: string;
    version: string;
  };
};

export class SitePublicationStateError extends Error {
  constructor() {
    super("Only claimed or live sites can be published");
    this.name = "SitePublicationStateError";
  }
}

export class SitePublicationTranslationError extends Error {
  constructor() {
    super("Review every stale translation before publishing");
    this.name = "SitePublicationTranslationError";
  }
}

export class SitePublicationPhotoError extends Error {
  constructor() {
    super("Review and select every photo from immutable storage before publishing");
    this.name = "SitePublicationPhotoError";
  }
}

/**
 * Validates the persisted private draft, appends an immutable snapshot, moves
 * the live pointer, and records the audit event in one serializable transaction.
 *
 * A caller cannot publish a request body directly: only the draft already owned
 * by this site can cross the boundary, which keeps preview and publish on the
 * same validated representation and makes Save-before-Publish explicit.
 */
export async function publishSiteDraft(
  input: PublishSiteDraftInput,
): Promise<PublishedSiteVersion> {
  assertVerticalPublicationEnabled(input.vertical);
  const changeSummary = input.changeSummary.trim();
  if (changeSummary.length < 3 || changeSummary.length > 280) {
    throw new Error("Change summary must be between 3 and 280 characters");
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("Site publishing is temporarily unavailable");
  }

  const db = getDb();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const published = await db.$transaction(
        async (tx) => {
          const site = await tx.site.findFirst({
            where: {
              id: input.siteId,
              slug: input.slug,
              vertical: input.vertical,
            },
            include: siteDraftRelations,
          });
          if (!site) throw new Error("Site not found");
          if (site.status !== "CLAIMED" && site.status !== "LIVE") {
            // Publishing must not resurrect a prospect or bypass an operator or
            // billing pause by changing PAUSED back to LIVE.
            throw new SitePublicationStateError();
          }
          if (site.draftRevision !== input.expectedRevision) {
            throw new DraftRevisionConflictError(site.draftRevision);
          }

          const selectedPhotos = await tx.photoAsset.findMany({
            where: { siteId: input.siteId, selectedUsage: { not: null } },
          });
          assertPublishablePhotoProjection(site, selectedPhotos);

          // `projectSiteDraft` is the private-preview projection. Parsing it
          // here before any write means validation failure cannot create a
          // version, move the pointer, change status, or write an audit row.
          const loaded = projectSiteDraft(site);
          const reviewableDraft = loaded.draft as {
            translations: Array<{
              status: "current" | "stale" | "draft";
            }>;
          };
          const hasUnreviewedTranslations =
            (loaded.vertical === Vertical.RESTAURANT &&
              hasUnreviewedRestaurantTranslations(reviewableDraft)) ||
            (loaded.vertical === Vertical.FOOD_RETAIL &&
              hasUnreviewedFoodRetailTranslations(reviewableDraft));
          if (hasUnreviewedTranslations) {
            throw new SitePublicationTranslationError();
          }
          const draft = loaded.draft as Prisma.InputJsonValue;
          const latest = await tx.siteVersion.findFirst({
            where: { siteId: input.siteId },
            orderBy: { version: "desc" },
            select: { version: true },
          });
          const publishedAt = input.now ?? new Date();
          const version = await tx.siteVersion.create({
            data: {
              siteId: input.siteId,
              version: (latest?.version ?? 0) + 1,
              vertical: loaded.vertical,
              theme: loaded.theme.selection as Prisma.InputJsonValue,
              themeVersion: loaded.theme.version,
              palette: (
                loaded.draft as { palette: Prisma.InputJsonValue }
              ).palette,
              content: draft,
              translations: (
                loaded.draft as { translations: Prisma.InputJsonValue }
              ).translations,
              integrations: (
                loaded.draft as { integrations: Prisma.InputJsonValue }
              ).integrations,
              publishedAt,
              publishedBy: input.actor.id,
              changeSummary,
            },
            select: { id: true, version: true },
          });
          const verifiedDomainCount = await tx.domain.count({
            where: { siteId: input.siteId, verified: true },
          });

          const moved = await tx.site.updateMany({
            where: {
              id: input.siteId,
              slug: input.slug,
              vertical: input.vertical,
            },
            data: {
              publishedSiteVersionId: version.id,
              // A snapshot can be published before DNS is connected, but it is
              // only live after at least one verified hostname routes to it.
              status: verifiedDomainCount > 0 ? "LIVE" : "CLAIMED",
            },
          });
          if (moved.count !== 1) {
            throw new Error("Site could not be published");
          }

          await tx.auditEvent.create({
            data: {
              type: "site.published",
              actor: input.actor.id,
              siteId: input.siteId,
              metadata: {
                siteVersionId: version.id,
                version: version.version,
                changeSummary,
                actorEmail: input.actor.email,
                themeId: loaded.theme.id,
                themeVersion: loaded.theme.version,
                live: verifiedDomainCount > 0,
                draftRevision: site.draftRevision,
                draftContentDigest: evidenceDigest(loaded.draft),
                integrationUrlDigest: integrationUrlDigest(
                  (
                    loaded.draft as {
                      integrations: Array<{
                        type: string;
                        url: string;
                        enabled: boolean;
                      }>;
                    }
                  ).integrations,
                ),
                previousSiteVersionId: site.publishedSiteVersionId,
              },
            },
          });

          return {
            id: version.id,
            version: version.version,
            publishedAt,
            theme: {
              id: loaded.theme.id,
              version: loaded.theme.version,
            },
          };
        },
        { isolationLevel: "Serializable" },
      );
      // Immediate expiry, not the `"max"` stale-while-revalidate profile: an
      // owner who just published expects the live surface to reflect it on
      // their very next request, the same "external trigger" case the Next.js
      // docs call out `{ expire: 0 }` for.
      revalidateTag(previewCacheTagFor(input.slug), { expire: 0 });
      return published;
    } catch (error) {
      if (attempt < 2 && isRetryablePublishError(error)) continue;
      throw error;
    }
  }

  throw new Error("Site could not be published");
}

function assertPublishablePhotoProjection(
  site: Prisma.SiteGetPayload<{ include: typeof siteDraftRelations }>,
  selectedPhotos: Array<{
    reviewStatus: "PENDING" | "APPROVED" | "REJECTED";
    selectedUsage: "HERO" | "GALLERY" | "CATALOG" | null;
    selectedCatalogItemId: string | null;
    originalStorageKey: string;
    originalUrl: string;
    provenance: "OFFICIAL" | "OWNER" | "PERMISSIONED_UGC";
    activeVariant: "ORIGINAL" | "ENHANCED";
    enhancedStorageKey: string | null;
    enhancedUrl: string | null;
    enhancedReviewStatus: "PENDING" | "APPROVED" | "REJECTED" | null;
  }>,
) {
  const isStoredAndApproved = (photo: (typeof selectedPhotos)[number]) =>
    photo.reviewStatus === "APPROVED" &&
    photo.originalStorageKey.length > 0 &&
    (photo.activeVariant !== "ENHANCED" ||
      (photo.enhancedReviewStatus === "APPROVED" &&
        Boolean(photo.enhancedStorageKey) &&
        Boolean(photo.enhancedUrl)));
  const activeUrl = (photo: (typeof selectedPhotos)[number]) =>
    photo.activeVariant === "ENHANCED" &&
    photo.enhancedReviewStatus === "APPROVED" &&
    photo.enhancedUrl
      ? photo.enhancedUrl
      : photo.originalUrl;

  const hero = selectedPhotos.find((photo) => photo.selectedUsage === "HERO");
  const hasHeroProjection = Boolean(
    site.heroImageUrl || site.heroOriginalImageUrl || site.heroImageProvenance,
  );
  if (
    hasHeroProjection !== Boolean(hero) ||
    (hero &&
      (!isStoredAndApproved(hero) ||
        site.heroImageUrl !== activeUrl(hero) ||
        site.heroOriginalImageUrl !== hero.originalUrl ||
        site.heroImageProvenance !== hero.provenance))
  ) {
    throw new SitePublicationPhotoError();
  }

  if (
    selectedPhotos.some(
      (photo) => photo.selectedUsage === "GALLERY" && !isStoredAndApproved(photo),
    )
  ) {
    throw new SitePublicationPhotoError();
  }

  const catalogItems = site.catalogSections.flatMap((section) => section.items);
  for (const item of catalogItems) {
    const selected = selectedPhotos.find(
      (photo) =>
        photo.selectedUsage === "CATALOG" &&
        photo.selectedCatalogItemId === item.id,
    );
    if (
      catalogItemHasUnselectedRemoteImage({
        imageUrl: item.imageUrl,
        originalImageUrl: item.originalImageUrl,
        imageProvenance: item.imageProvenance
          ? item.imageProvenance.toLowerCase().replace("_", "-")
          : null,
        selected: selected ?? null,
      })
    ) {
      throw new SitePublicationPhotoError();
    }
    if (selected && !isStoredAndApproved(selected)) {
      throw new SitePublicationPhotoError();
    }
  }

  const projects = Array.isArray(
    (site.attributes as { projects?: unknown }).projects,
  )
    ? ((site.attributes as { projects: unknown[] }).projects)
    : [];
  const gallery = selectedPhotos.filter(
    (photo) => photo.selectedUsage === "GALLERY",
  );
  for (const [index, project] of projects.entries()) {
    const record =
      typeof project === "object" && project !== null
        ? (project as Record<string, unknown>)
        : {};
    if (
      projectHasUnselectedRemoteImage({
        imageUrl: record.imageUrl,
        originalImageUrl: record.originalImageUrl,
        imageProvenance: record.imageProvenance,
        selected: gallery[index] ?? null,
      })
    ) {
      throw new SitePublicationPhotoError();
    }
  }
}

export async function getSitePublicationHistory(
  siteId: string,
): Promise<SitePublicationHistoryItem[]> {
  if (!process.env.DATABASE_URL) return [];
  const site = await getDb().site.findUnique({
    where: { id: siteId },
    select: {
      publishedSiteVersionId: true,
      siteVersions: {
        where: { publishedAt: { not: null } },
        orderBy: { version: "desc" },
        take: 20,
        select: {
          id: true,
          version: true,
          vertical: true,
          theme: true,
          themeVersion: true,
          palette: true,
          content: true,
          translations: true,
          integrations: true,
          publishedAt: true,
          changeSummary: true,
        },
      },
    },
  });
  if (!site) return [];

  return site.siteVersions.flatMap((version) => {
    try {
      const projected = projectPublishedSiteVersion(version);
      if (!projected || !version.publishedAt) return [];
      return [
        {
          id: version.id,
          version: version.version,
          publishedAt: version.publishedAt,
          changeSummary: version.changeSummary ?? "Published site",
          current: version.id === site.publishedSiteVersionId,
          theme: {
            id: projected.theme.id,
            version: projected.theme.version,
          },
        },
      ];
    } catch {
      // An adopted legacy database can contain incomplete historical rows.
      // They remain immutable, but must not make the owner's whole dashboard
      // unavailable or become rollback candidates.
      return [];
    }
  });
}

export async function rollbackPublishedSiteVersion(input: {
  siteId: string;
  slug: string;
  vertical: VerticalId;
  targetSiteVersionId: string;
  actor: {
    id: string;
    email: string;
  };
  now?: Date;
}): Promise<PublishedSiteVersion> {
  assertVerticalPublicationEnabled(input.vertical);
  if (!process.env.DATABASE_URL) {
    throw new Error("Site publishing is temporarily unavailable");
  }

  const db = getDb();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const published = await db.$transaction(
        async (tx) => {
          const site = await tx.site.findFirst({
            where: {
              id: input.siteId,
              slug: input.slug,
              vertical: input.vertical,
            },
            select: {
              status: true,
              publishedSiteVersionId: true,
              siteVersions: {
                where: {
                  id: input.targetSiteVersionId,
                  publishedAt: { not: null },
                },
                take: 1,
                select: {
                  id: true,
                  version: true,
                  vertical: true,
                  theme: true,
                  themeVersion: true,
                  palette: true,
                  content: true,
                  translations: true,
                  integrations: true,
                  publishedAt: true,
                  changeSummary: true,
                },
              },
            },
          });
          if (!site) throw new Error("Site not found");
          if (site.status !== "CLAIMED" && site.status !== "LIVE") {
            throw new SitePublicationStateError();
          }
          const target = site.siteVersions[0];
          if (!target) throw new Error("Published site version not found");
          const projected = projectPublishedSiteVersion(target);
          if (!projected || target.vertical !== input.vertical) {
            throw new Error("Published site version is invalid");
          }

          const latest = await tx.siteVersion.findFirst({
            where: { siteId: input.siteId },
            orderBy: { version: "desc" },
            select: { version: true },
          });
          const publishedAt = input.now ?? new Date();
          const version = await tx.siteVersion.create({
            data: {
              siteId: input.siteId,
              version: (latest?.version ?? 0) + 1,
              vertical: target.vertical,
              theme: projected.theme.selection as Prisma.InputJsonValue,
              themeVersion: projected.theme.version,
              palette: target.palette as Prisma.InputJsonValue,
              content: target.content as Prisma.InputJsonValue,
              translations: target.translations as Prisma.InputJsonValue,
              integrations: target.integrations as Prisma.InputJsonValue,
              publishedAt,
              publishedBy: input.actor.id,
              changeSummary: `Rollback to v${target.version}: ${target.changeSummary ?? "Published site"}`.slice(
                0,
                280,
              ),
            },
            select: { id: true, version: true },
          });
          const verifiedDomainCount = await tx.domain.count({
            where: { siteId: input.siteId, verified: true },
          });
          const nextStatus = siteStatusForDomainState({
            currentStatus: site.status,
            hasVerifiedDomain: verifiedDomainCount > 0,
            hasValidPublishedVersion: true,
          });

          const moved = await tx.site.updateMany({
            where: {
              id: input.siteId,
              slug: input.slug,
              vertical: input.vertical,
            },
            data: {
              publishedSiteVersionId: version.id,
              status: nextStatus,
            },
          });
          if (moved.count !== 1) {
            throw new Error("Site could not be rolled back");
          }

          await tx.auditEvent.create({
            data: {
              type: "site.rolled_back",
              actor: input.actor.id,
              siteId: input.siteId,
              metadata: {
                siteVersionId: version.id,
                version: version.version,
                targetSiteVersionId: target.id,
                targetVersion: target.version,
                previousSiteVersionId: site.publishedSiteVersionId,
                actorEmail: input.actor.email,
                themeId: projected.theme.id,
                themeVersion: projected.theme.version,
                live: nextStatus === "LIVE",
              },
            },
          });

          return {
            id: version.id,
            version: version.version,
            publishedAt,
            theme: {
              id: projected.theme.id,
              version: projected.theme.version,
            },
          };
        },
        { isolationLevel: "Serializable" },
      );
      revalidateTag(previewCacheTagFor(input.slug), { expire: 0 });
      return published;
    } catch (error) {
      if (attempt < 2 && isRetryablePublishError(error)) continue;
      throw error;
    }
  }

  throw new Error("Site could not be rolled back");
}

function isRetryablePublishError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    retryablePublishCodes.has(error.code)
  );
}
