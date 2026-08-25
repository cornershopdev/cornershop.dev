import { Prisma } from "@/generated/prisma/client";
import { catalogPhotoReplacementPosition } from "@/lib/catalog-photo-reconciliation";
import { Vertical } from "@/generated/prisma/enums";
import { getDb } from "@/lib/db";
import { bindOwnerDraftImagesToLibrary } from "@/lib/reviewed-photo-projection";
import { evidenceDigest, integrationUrlDigest } from "@/lib/evidence-digests";
import { LEGACY_THEME_VERSION, slugify } from "@/lib/site-draft";
import { restaurantSiteTheme } from "@/lib/site-themes/restaurant/configuration";
import {
  buildImportUrls,
  importFailureMessage,
  normalizeImportSource,
  slugCollisionCandidate,
  storedImportSource,
  type ImportUrls,
} from "@/lib/import-identity";
import { resolveVerticalConfig } from "@/lib/verticals/registry";
import type { VerticalId } from "@/lib/verticals/types";
import {
  mergeOperatorLeadAttributes,
  preservePersistedLeadEligibility,
  type LeadDiscoveryRecord,
  type LeadEligibilityRecord,
} from "@/lib/operator-lead-attributes";
import type { LocalSeoAuditResult } from "@/lib/local-seo-audit";

const retryablePrismaCodes = new Set(["P2002", "P2034"]);
const mutableImportStatuses = new Set(["PROSPECT", "PREVIEW_READY"]);

/**
 * The vertical-agnostic surface every vertical's draft schema produces. Verticals
 * are free to add fields; the write path only ever reads these, and everything
 * vertical-specific travels inside the `attributes` bags.
 */
export type PersistableSiteDraft = {
  slug: string;
  name: string;
  eyebrow: string;
  description: string;
  address: string;
  phone: string;
  /** Sourced public business mailbox. Operator recipients never enter drafts. */
  email?: string;
  sourceUrl: string | null;
  logoUrl?: string | null;
  faviconUrl?: string | null;
  heroImageUrl: string | null;
  heroOriginalImageUrl?: string | null;
  heroImageProvenance?: "official" | "owner" | "permissioned-ugc" | null;
  galleryImages?: Array<{
    url: string;
    originalUrl: string;
    provenance: "official" | "owner" | "permissioned-ugc";
  }>;
  palette: {
    background: string;
    foreground: string;
    accent: string;
    accentForeground?: string;
  };
  sourceData?: {
    navigation: Array<{
      label: string;
      url: string;
      destinationUrl: string | null;
    }>;
    brandAssets: Array<{
      type: "logo" | "favicon" | "hero" | "content";
      url: string;
      sourceUrl: string;
      provenance: "official";
      evidence: "json-ld" | "meta" | "html" | "link" | "css";
    }>;
    evidence: Array<{
      field: string;
      value: string;
      sourceUrl: string;
      method: "json-ld" | "meta" | "html" | "link" | "css";
      excerpt: string;
    }>;
  };
  attributes: Record<string, unknown>;
  autoEnhanceImages: boolean;
  defaultLocale: string;
  businessHours: Array<{ days: string; hours: string }>;
  translations: unknown[];
  catalogSections: Array<{
    name: string;
    description: string;
    items: Array<{
      name: string;
      description: string;
      price: number | null;
      currency: string;
      available: boolean | null;
      attributes: Record<string, unknown>;
      imageUrl: string | null;
      originalImageUrl?: string | null;
      imageProvenance?: "official" | "owner" | "permissioned-ugc" | null;
    }>;
  }>;
  integrations: Array<{
    type: "booking" | "ordering" | "delivery" | "social" | "quote" | "contact";
    label: string;
    provider: string | null;
    url: string;
    enabled: boolean;
    venueId?: string | null;
  }>;
};

export type PersistedSiteImport<TDraft extends PersistableSiteDraft> = {
  siteId: string;
  draft: TDraft;
  importJobId: string;
  urls: ImportUrls;
  created: boolean;
};

export type PersistedLeadIngest = {
  name: string;
  phone: string | null;
  address: string | null;
  discovery: LeadDiscoveryRecord;
  audit: LocalSeoAuditResult | null;
  eligibility: LeadEligibilityRecord;
};

export type OwnerDraftSaveOptions = {
  actor?: {
    id: string;
    email: string;
  };
  auditType?: "site.draft.saved" | "site.translation.regenerated";
  /**
   * When set, the save fails with DraftRevisionConflictError unless the row
   * still carries this revision. Multi-tab editors use the value returned by
   * the previous save so a stale full-replace cannot silently clobber newer work.
   */
  expectedRevision?: number;
};

export type OwnerDraftSaveResult = {
  revision: number;
};

export class DraftRevisionConflictError extends Error {
  readonly currentRevision: number | null;

  constructor(currentRevision: number | null = null) {
    super("This draft was updated elsewhere. Reload before saving again.");
    this.name = "DraftRevisionConflictError";
    this.currentRevision = currentRevision;
  }
}

export class ImportDatabaseUnavailableError extends Error {
  constructor() {
    super("Preview persistence is temporarily unavailable");
    this.name = "ImportDatabaseUnavailableError";
  }
}

export class ImportConflictError extends Error {
  constructor() {
    super("This site is already owned and cannot be replaced by an import");
    this.name = "ImportConflictError";
  }
}

export class OperatorImportConflictError extends Error {
  constructor() {
    super("The operator import conflicts with an existing site");
    this.name = "OperatorImportConflictError";
  }
}

export type OperatorImportIdentity = {
  slug: string;
  sourceKey: string;
  sourceUrl: string | null;
  forbiddenSlugs: string[];
  where: Prisma.SiteWhereInput;
};

export function buildOperatorImportIdentity(
  draft: Pick<PersistableSiteDraft, "slug" | "name" | "sourceUrl">,
  source: string,
  forbiddenSlugs: string[] = [],
  vertical: VerticalId = Vertical.RESTAURANT,
): OperatorImportIdentity {
  const slug =
    slugify(draft.slug) || slugify(draft.name) || vertical.toLowerCase();
  const sourceKey = normalizeImportSource(draft.sourceUrl ?? source);
  const allForbiddenSlugs = [...new Set([slug, ...forbiddenSlugs])];
  const identityConditions: Prisma.SiteWhereInput[] = [
    { slug: { in: allForbiddenSlugs } },
    { sourceKey },
  ];
  if (draft.sourceUrl) {
    identityConditions.push({ sourceUrl: draft.sourceUrl });
  }
  return {
    slug,
    sourceKey,
    sourceUrl: draft.sourceUrl,
    forbiddenSlugs: allForbiddenSlugs,
    where: { OR: identityConditions },
  };
}

export async function findOperatorImportConflict(
  lookup: {
    findFirstSite: (
      where: Prisma.SiteWhereInput,
    ) => Promise<{ id: string } | null>;
  },
  identity: OperatorImportIdentity,
): Promise<{ id: string } | null> {
  return lookup.findFirstSite(identity.where);
}

export async function createImportJob(
  source: string,
  vertical: VerticalId = Vertical.RESTAURANT,
): Promise<{ id: string; sourceKey: string }> {
  const db = requireImportDatabase();
  const sourceKey = normalizeImportSource(source);
  return db.importJob.create({
    data: {
      source: storedImportSource(source),
      sourceKey,
      vertical,
      status: "QUEUED",
      startedAt: new Date(),
    },
    select: { id: true, sourceKey: true },
  }) as Promise<{ id: string; sourceKey: string }>;
}

export async function updateImportJob(
  importJobId: string,
  data: {
    status?: "CRAWLING" | "EXTRACTING" | "GENERATING";
    workflowRunId?: string;
  },
): Promise<void> {
  await requireImportDatabase().importJob.update({
    where: { id: importJobId },
    data,
  });
}

export async function recordImportFailure(
  importJobId: string,
  error: unknown,
): Promise<string> {
  const message = importFailureMessage(error);
  await requireImportDatabase().importJob.update({
    where: { id: importJobId },
    data: {
      status: "FAILED",
      error: message,
      completedAt: new Date(),
    },
  });
  return message;
}

export async function persistSiteImport<
  TDraft extends PersistableSiteDraft,
>(input: {
  draft: TDraft;
  vertical: VerticalId;
  source: string;
  importJobId: string;
  actor?: string;
  contactEmail?: string;
  leadIngest?: PersistedLeadIngest;
}): Promise<PersistedSiteImport<TDraft>> {
  const db = requireImportDatabase();
  const config = resolveVerticalConfig(input.vertical);
  let draft = config.draftSchema.parse(input.draft) as TDraft;
  if (input.leadIngest) {
    const validatedLeadDraft = config.draftSchema.parse({
      ...draft,
      name: input.leadIngest.name,
      phone: input.leadIngest.phone?.trim() || draft.phone,
      address: input.leadIngest.address?.trim() || draft.address,
    }) as TDraft;
    draft = {
      ...validatedLeadDraft,
      // Operational lead evidence deliberately sits beside the vertical's
      // content attributes. Add it after content-schema validation because
      // Zod strips keys that no storefront renderer owns.
      attributes: mergeOperatorLeadAttributes(
        validatedLeadDraft.attributes,
        input.leadIngest.discovery,
        input.leadIngest.audit,
        input.leadIngest.eligibility,
      ),
    } as TDraft;
  }
  const sourceKey = normalizeImportSource(draft.sourceUrl ?? input.source);
  const verticalSlug = input.vertical.toLowerCase();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await db.$transaction(
        async (tx) => {
          const identityConditions: Prisma.SiteWhereInput[] = [{ sourceKey }];
          if (draft.sourceUrl) {
            identityConditions.push({ sourceUrl: draft.sourceUrl });
          }

          let existing = await tx.site.findFirst({
            where: { OR: identityConditions },
            select: {
              id: true,
              slug: true,
              sourceKey: true,
              sourceUrl: true,
              status: true,
              vertical: true,
              attributes: true,
            },
          });

          const requestedSlug =
            slugify(draft.slug) || slugify(draft.name) || verticalSlug;
          let slug = existing?.slug ?? requestedSlug;

          if (!existing) {
            for (
              let collisionIndex = 0;
              collisionIndex < 100;
              collisionIndex += 1
            ) {
              const candidate = slugCollisionCandidate(
                requestedSlug,
                collisionIndex,
              );
              const collision = await tx.site.findUnique({
                where: { slug: candidate },
                select: {
                  id: true,
                  slug: true,
                  sourceKey: true,
                  sourceUrl: true,
                  status: true,
                  vertical: true,
                  attributes: true,
                },
              });
              if (!collision) {
                slug = candidate;
                break;
              }

              const collisionSourceKey = collision.sourceKey
                ? collision.sourceKey
                : collision.sourceUrl
                  ? normalizeImportSource(collision.sourceUrl)
                  : null;
              if (collisionSourceKey === sourceKey) {
                existing = collision;
                slug = collision.slug;
                break;
              }

              if (collisionIndex === 99) {
                throw new Error("A unique preview URL could not be reserved");
              }
            }
          }

          if (existing && !mutableImportStatuses.has(existing.status)) {
            throw new ImportConflictError();
          }
          if (existing && existing.vertical !== input.vertical) {
            throw new ImportConflictError();
          }

          const site = existing
            ? await tx.site.update({
                where: { id: existing.id },
                data: {
                  ...siteScalarData(
                    draft,
                    input.vertical,
                    sourceKey,
                    input.leadIngest
                      ? (preservePersistedLeadEligibility(
                          draft.attributes as Record<string, unknown>,
                          existing.attributes,
                        ) as Prisma.InputJsonValue)
                      : undefined,
                  ),
                  ...(input.contactEmail
                    ? { leadContactEmail: input.contactEmail }
                    : {}),
                  ...siteRelationReplaceData(draft, input.vertical),
                },
                select: { id: true, slug: true },
              })
            : await tx.site.create({
                data: {
                  slug,
                  ...siteScalarData(
                    draft,
                    input.vertical,
                    sourceKey,
                    input.leadIngest
                      ? (draft.attributes as Prisma.InputJsonValue)
                      : undefined,
                  ),
                  ...(input.contactEmail
                    ? { leadContactEmail: input.contactEmail }
                    : {}),
                  integrations: { create: integrationCreateData(draft) },
                  catalogSections: {
                    create: catalogSectionCreateData(draft, input.vertical),
                  },
                },
                select: { id: true, slug: true },
              });

          await tx.auditEvent.create({
            data: {
              type: existing ? "site.import.updated" : "site.import.created",
              actor: input.actor ?? "system:import",
              metadata: {
                importJobId: input.importJobId,
                vertical: input.vertical,
                source: storedImportSource(input.source),
                sourceKey,
                previousStatus: existing?.status ?? null,
                contactEmailUpdated: Boolean(input.contactEmail),
                draftContentDigest: evidenceDigest(draft),
                integrationUrlDigest: integrationUrlDigest(draft.integrations),
              },
              siteId: site.id,
            },
          });
          if (input.leadIngest) {
            await tx.auditEvent.create({
              data: {
                type: existing
                  ? "site.lead.ingest.updated"
                  : "site.lead.ingested",
                actor: input.actor ?? "system:lead-discovery",
                metadata: {
                  sourceKey,
                  city: input.leadIngest.discovery.city,
                  score: input.leadIngest.discovery.score,
                  placeId: input.leadIngest.discovery.placeId,
                  adapterId: input.leadIngest.discovery.adapterId,
                  eligibility: input.leadIngest.eligibility.state,
                  previousStatus: existing?.status ?? null,
                },
                siteId: site.id,
              },
            });
          }
          await tx.importJob.update({
            where: { id: input.importJobId },
            data: {
              sourceKey,
              vertical: input.vertical,
              status: "READY",
              error: null,
              completedAt: new Date(),
              siteId: site.id,
            },
          });

          const canonicalDraft = config.draftSchema.parse({
            ...draft,
            slug: site.slug,
          }) as TDraft;
          return {
            siteId: site.id,
            draft: canonicalDraft,
            importJobId: input.importJobId,
            urls: buildImportUrls(site.slug),
            created: !existing,
          };
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      if (attempt < 2 && isRetryablePrismaError(error)) continue;
      throw error;
    }
  }

  throw new Error("The site import could not be persisted");
}

/**
 * Imports a reviewed fixture without invoking the public crawler or allowing the
 * normal mutable-import path to replace a prospect. The preflight and every
 * write share one serializable transaction, so a conflict leaves no queued job
 * or partial site behind.
 */
export async function createOperatorSiteImport<
  TDraft extends PersistableSiteDraft,
>(input: {
  draft: TDraft;
  vertical: VerticalId;
  source: string;
  forbiddenSlugs?: string[];
}): Promise<PersistedSiteImport<TDraft>> {
  const db = requireImportDatabase();
  const config = resolveVerticalConfig(input.vertical);
  const draft = config.draftSchema.parse(input.draft) as TDraft;
  const identity = buildOperatorImportIdentity(
    draft,
    input.source,
    input.forbiddenSlugs,
    input.vertical,
  );

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await db.$transaction(
        async (tx) => {
          const conflict = await findOperatorImportConflict(
            {
              findFirstSite: (where) =>
                tx.site.findFirst({
                  where,
                  select: { id: true },
                }),
            },
            identity,
          );
          if (conflict) throw new OperatorImportConflictError();

          const importJob = await tx.importJob.create({
            data: {
              source: storedImportSource(input.source),
              sourceKey: identity.sourceKey,
              vertical: input.vertical,
              status: "QUEUED",
              startedAt: new Date(),
            },
            select: { id: true },
          });
          const site = await tx.site.create({
            data: {
              slug: identity.slug,
              ...siteScalarData(draft, input.vertical, identity.sourceKey),
              integrations: { create: integrationCreateData(draft) },
              catalogSections: {
                create: catalogSectionCreateData(draft, input.vertical),
              },
            },
            select: { id: true, slug: true },
          });

          await tx.auditEvent.create({
            data: {
              type: "site.import.created",
              actor: "operator:fixture-import",
              metadata: {
                importJobId: importJob.id,
                vertical: input.vertical,
                source: storedImportSource(input.source),
                sourceKey: identity.sourceKey,
                draftContentDigest: evidenceDigest(draft),
                integrationUrlDigest: integrationUrlDigest(draft.integrations),
              },
              siteId: site.id,
            },
          });
          await tx.importJob.update({
            where: { id: importJob.id },
            data: {
              status: "READY",
              completedAt: new Date(),
              siteId: site.id,
            },
          });

          const [
            persistedSite,
            sectionCount,
            itemCount,
            integrationRows,
            versionCount,
          ] = await Promise.all([
            tx.site.findUnique({
              where: { id: site.id },
              select: {
                slug: true,
                eyebrow: true,
                status: true,
                sourceKey: true,
              },
            }),
            tx.catalogSection.count({ where: { siteId: site.id } }),
            tx.catalogItem.count({
              where: { section: { siteId: site.id } },
            }),
            tx.integration.findMany({
              where: { siteId: site.id },
              orderBy: { position: "asc" },
              select: { label: true, position: true },
            }),
            tx.siteVersion.count({ where: { siteId: site.id } }),
          ]);
          const expectedItemCount = draft.catalogSections.reduce(
            (sum, section) => sum + section.items.length,
            0,
          );
          const integrationOrderMatches = integrationRows.every(
            (integration, index) =>
              integration.position === index &&
              integration.label === draft.integrations[index]?.label,
          );
          if (
            !persistedSite ||
            persistedSite.slug !== identity.slug ||
            persistedSite.eyebrow !== draft.eyebrow ||
            persistedSite.status !== "PREVIEW_READY" ||
            persistedSite.sourceKey !== identity.sourceKey ||
            sectionCount !== draft.catalogSections.length ||
            itemCount !== expectedItemCount ||
            integrationRows.length !== draft.integrations.length ||
            !integrationOrderMatches ||
            versionCount !== 0
          ) {
            throw new Error(
              "The operator import failed its atomic fidelity check",
            );
          }

          return {
            siteId: site.id,
            draft: config.draftSchema.parse({
              ...draft,
              slug: site.slug,
            }) as TDraft,
            importJobId: importJob.id,
            urls: buildImportUrls(site.slug),
            created: true,
          };
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      if (attempt < 2 && isRetryablePrismaError(error)) continue;
      throw error;
    }
  }

  throw new Error("The operator site import could not be persisted");
}

/**
 * Owner-initiated edit of an already-persisted site. Shares the exact same column
 * and relation mapping as the import path so the two can never drift. Identity and
 * lifecycle columns (slug, vertical, sourceUrl, sourceKey, status) stay owned by the
 * import — an owner editing copy must never move a site between verticals, re-point
 * its import identity, or resurrect it into PREVIEW_READY after it has been claimed.
 */
export async function updateSiteDraft(
  slug: string,
  draft: PersistableSiteDraft,
  vertical: VerticalId,
  options: OwnerDraftSaveOptions = {},
): Promise<OwnerDraftSaveResult> {
  const config = resolveVerticalConfig(vertical);
  const parsed = config.draftSchema.parse(draft) as PersistableSiteDraft;
  const db = requireImportDatabase();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await db.$transaction(
        async (tx) => {
          // Serializable + explicit revision check: updateMany cannot nest
          // relation replaces, so the optimistic guard is a read-then-update.
          const current = await tx.site.findFirst({
            where: { slug, vertical },
            select: {
              id: true,
              draftRevision: true,
              publishedSiteVersionId: true,
            },
          });
          if (!current) throw new Error("Site not found");
          if (
            options.expectedRevision !== undefined &&
            current.draftRevision !== options.expectedRevision
          ) {
            throw new DraftRevisionConflictError(current.draftRevision);
          }
          const libraryPhotos = await tx.photoAsset.findMany({
            where: { siteId: current.id },
            select: {
              id: true,
              originalUrl: true,
              enhancedUrl: true,
              enhancedReviewStatus: true,
              activeVariant: true,
              provenance: true,
              reviewStatus: true,
              selectedUsage: true,
              selectedCatalogItemId: true,
              selectedCatalogItem: {
                select: {
                  name: true,
                  section: { select: { name: true } },
                },
              },
            },
          });
          const bound = bindOwnerDraftImagesToLibrary(parsed, libraryPhotos);
          // Catalog rows are replaced on a full owner save. Preserve a managed
          // photo only when section + item names identify one unique replacement;
          // position alone can silently move a real product photo to another item.
          const catalogPhotoTargets = libraryPhotos.flatMap((selection) =>
            selection.selectedUsage === "CATALOG" &&
            selection.selectedCatalogItem
              ? [
                  {
                    selection,
                    position: catalogPhotoReplacementPosition({
                      previousSectionName:
                        selection.selectedCatalogItem.section.name,
                      previousItemName: selection.selectedCatalogItem.name,
                      replacementCatalog: bound.catalogSections,
                    }),
                  },
                ]
              : [],
          );
          const updated = await tx.site.update({
            where: { id: current.id },
            data: {
              ...siteDraftScalarData(bound, vertical),
              ...siteRelationReplaceData(bound, vertical),
              draftRevision: { increment: 1 },
            },
            select: { id: true, draftRevision: true },
          });
          await rebindSelectedCatalogPhotos(
            tx,
            current.id,
            catalogPhotoTargets,
          );
          if (options.actor) {
            await tx.auditEvent.create({
              data: {
                type: options.auditType ?? "site.draft.saved",
                actor: options.actor.id,
                siteId: updated.id,
                metadata: {
                  revision: updated.draftRevision,
                  actorEmail: options.actor.email,
                  integrationCount: parsed.integrations.length,
                  enabledIntegrationCount: parsed.integrations.filter(
                    (integration) => integration.enabled,
                  ).length,
                  draftContentDigest: evidenceDigest(parsed),
                  integrationUrlDigest: integrationUrlDigest(
                    parsed.integrations,
                  ),
                  publishedSiteVersionIdAtSave: current.publishedSiteVersionId,
                },
              },
            });
          }
          return { revision: updated.draftRevision };
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      if (error instanceof DraftRevisionConflictError) throw error;
      if (attempt < 2 && isRetryablePrismaError(error)) continue;
      throw error;
    }
  }

  throw new Error("The site draft could not be saved");
}

function requireImportDatabase() {
  if (!process.env.DATABASE_URL) {
    throw new ImportDatabaseUnavailableError();
  }
  return getDb();
}

type CatalogPhotoSelectionRow = {
  id: string;
  originalUrl: string;
  enhancedUrl: string | null;
  enhancedReviewStatus: "PENDING" | "APPROVED" | "REJECTED" | null;
  activeVariant: "ORIGINAL" | "ENHANCED";
  provenance: "OFFICIAL" | "OWNER" | "PERMISSIONED_UGC";
};

export async function rebindSelectedCatalogPhotos(
  tx: Prisma.TransactionClient,
  siteId: string,
  catalogPhotoTargets: Array<{
    selection: CatalogPhotoSelectionRow;
    position: { sectionIndex: number; itemIndex: number } | null;
  }>,
): Promise<void> {
  if (catalogPhotoTargets.length === 0) return;
  const replacementItems = await tx.catalogItem.findMany({
    where: { section: { siteId } },
    select: {
      id: true,
      position: true,
      section: { select: { position: true } },
    },
  });
  for (const { selection, position } of catalogPhotoTargets) {
    const replacement = position
      ? replacementItems.find(
          (item) =>
            item.position === position.itemIndex &&
            item.section.position === position.sectionIndex,
        )
      : null;
    const managedUrls = [selection.originalUrl, selection.enhancedUrl].filter(
      (url): url is string => Boolean(url),
    );
    await tx.catalogItem.updateMany({
      where: {
        section: { siteId },
        ...(replacement ? { id: { not: replacement.id } } : {}),
        OR: [
          { imageUrl: { in: managedUrls } },
          { originalImageUrl: { in: managedUrls } },
        ],
      },
      data: {
        imageUrl: null,
        originalImageUrl: null,
        imageProvenance: null,
      },
    });
    if (replacement) {
      const imageUrl =
        selection.activeVariant === "ENHANCED" &&
        selection.enhancedReviewStatus === "APPROVED" &&
        selection.enhancedUrl
          ? selection.enhancedUrl
          : selection.originalUrl;
      await tx.catalogItem.update({
        where: { id: replacement.id },
        data: {
          imageUrl,
          originalImageUrl: selection.originalUrl,
          imageProvenance: selection.provenance,
        },
      });
    }
    await tx.photoAsset.update({
      where: { id: selection.id },
      data: replacement
        ? {
            selectedCatalogItemId: replacement.id,
            selectedUsage: "CATALOG",
          }
        : { selectedCatalogItemId: null, selectedUsage: null },
    });
  }
}

function siteRelationReplaceData(
  draft: PersistableSiteDraft,
  vertical: VerticalId,
) {
  return {
    integrations: {
      deleteMany: {},
      create: integrationCreateData(draft),
    },
    catalogSections: {
      deleteMany: {},
      create: catalogSectionCreateData(draft, vertical),
    },
  };
}

function siteScalarData(
  draft: PersistableSiteDraft,
  vertical: VerticalId,
  sourceKey: string | null,
  trustedOperationalAttributes?: Prisma.InputJsonValue,
) {
  return {
    ...siteDraftScalarData(draft, vertical),
    ...(trustedOperationalAttributes
      ? { attributes: trustedOperationalAttributes }
      : {}),
    // Identity and lifecycle columns: only the import path owns these. An owner
    // editing copy must never move a site between verticals, re-point its import
    // identity, or resurrect it into PREVIEW_READY after it has been claimed.
    vertical,
    sourceUrl: draft.sourceUrl,
    sourceKey,
    status: "PREVIEW_READY" as const,
  };
}

/** The subset of `Site` columns an owner edit is allowed to overwrite. */
export function siteDraftScalarData(
  draft: PersistableSiteDraft,
  vertical: VerticalId,
) {
  const config = resolveVerticalConfig(vertical);
  const attributes = config.attributesSchema.parse(draft.attributes);
  const theme = config.templates.resolve(attributes);
  const registeredTheme = restaurantSiteTheme(vertical, attributes);
  return {
    name: draft.name,
    eyebrow: draft.eyebrow,
    description: draft.description,
    address: draft.address,
    phone: draft.phone,
    email: draft.email || null,
    logoUrl: draft.logoUrl,
    faviconUrl: draft.faviconUrl,
    sourceData: (draft.sourceData ?? {}) as Prisma.InputJsonValue,
    heroImageUrl: draft.heroImageUrl,
    heroOriginalImageUrl: draft.heroOriginalImageUrl,
    heroImageProvenance: toDatabaseImageProvenance(draft.heroImageProvenance),
    // Parsed on the way in as well as on the way out: the attributes bag is the
    // only place vertical-specific data lives, so an unvalidated write here is a
    // read-path crash later.
    attributes: attributes as Prisma.InputJsonValue,
    draftTheme: (registeredTheme?.selection ?? {
      id: theme.id,
    }) as Prisma.InputJsonValue,
    draftThemeVersion: registeredTheme?.version ?? LEGACY_THEME_VERSION,
    draftPalette: draft.palette as Prisma.InputJsonValue,
    autoEnhanceImages: draft.autoEnhanceImages,
    defaultLocale: draft.defaultLocale,
    businessHours: draft.businessHours as Prisma.InputJsonValue,
    translations: draft.translations as Prisma.InputJsonValue,
  };
}

function integrationCreateData(draft: PersistableSiteDraft) {
  return draft.integrations.map((integration, position) => ({
    type: toDatabaseIntegrationType(integration.type),
    label: integration.label,
    provider: integration.provider,
    url: integration.url,
    enabled: integration.enabled,
    venueId: integration.venueId ?? null,
    position,
  }));
}

function catalogSectionCreateData(
  draft: PersistableSiteDraft,
  vertical: VerticalId,
) {
  const config = resolveVerticalConfig(vertical);
  return draft.catalogSections.map((section, sectionIndex) => ({
    name: section.name,
    description: section.description,
    position: sectionIndex,
    items: {
      create: section.items.map((item, itemIndex) => ({
        name: item.name,
        description: item.description,
        price: item.price,
        currency: item.currency,
        available: item.available,
        attributes: config.itemAttributesSchema.parse(
          item.attributes,
        ) as Prisma.InputJsonValue,
        imageUrl: item.imageUrl,
        originalImageUrl: item.originalImageUrl,
        imageProvenance: toDatabaseImageProvenance(item.imageProvenance),
        position: itemIndex,
      })),
    },
  }));
}

function toDatabaseIntegrationType(
  value: PersistableSiteDraft["integrations"][number]["type"],
): "BOOKING" | "ORDERING" | "DELIVERY" | "SOCIAL" | "QUOTE" | "CONTACT" {
  return value.toUpperCase() as
    "BOOKING" | "ORDERING" | "DELIVERY" | "SOCIAL" | "QUOTE" | "CONTACT";
}

function toDatabaseImageProvenance(
  value: PersistableSiteDraft["heroImageProvenance"],
): "OFFICIAL" | "OWNER" | "PERMISSIONED_UGC" | null {
  if (!value) return null;
  if (value === "permissioned-ugc") return "PERMISSIONED_UGC";
  return value.toUpperCase() as "OFFICIAL" | "OWNER";
}

function isRetryablePrismaError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    retryablePrismaCodes.has(error.code)
  );
}
