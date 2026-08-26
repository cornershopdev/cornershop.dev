import { unstable_cache } from "next/cache";
import { cache } from "react";
import { Prisma } from "@/generated/prisma/client";
import { Vertical } from "@/generated/prisma/enums";
import {
  canonicalVerifiedCustomHostname,
  publicSiteOrigin,
} from "@/lib/domain-routing";
import { getDb } from "@/lib/db";
import { leadSiteDrafts } from "@/lib/lead-drafts";
import type {
  SiteDraftView,
  SitePaletteView,
  SiteThemeView,
} from "@/lib/site-draft";
import { LEGACY_THEME_VERSION } from "@/lib/site-draft";
import { previewCacheTagFor } from "@/lib/site-surface";
import {
  restaurantRendererVersionId,
  restaurantSiteTheme,
} from "@/lib/site-themes/restaurant/configuration";
import { parseRestaurantThemeSelection } from "@/lib/site-themes/restaurant/selection";
import { sampleSiteDraft } from "@/lib/verticals/restaurant/schema";
import {
  isVerticalPublicationEnabled,
  resolveVerticalConfig,
  type ErasedVerticalConfig,
} from "@/lib/verticals/registry";
import {
  safeExternalHttpsUrlSchema,
  siteImageUrlSchema,
  sourceNavigationIntentSchema,
} from "@/lib/verticals/schema";
import type { VerticalId } from "@/lib/verticals/types";

/**
 * How long a customer domain's live-surface fetch may serve a cached
 * `SiteVersion` before revalidating from the database on its own. Publish,
 * rollback, and domain-verification changes invalidate this early via
 * `revalidateTag(previewCacheTagFor(slug), ...)`, so this window only bounds
 * staleness for state changes those call sites don't cover directly.
 */
const PUBLISHED_SITE_VIEW_REVALIDATE_SECONDS = 300;

export const siteDraftRelations = {
  integrations: {
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  },
  catalogSections: {
    orderBy: { position: "asc" },
    include: { items: { orderBy: { position: "asc" } } },
  },
  photos: {
    where: { selectedUsage: "GALLERY", reviewStatus: "APPROVED" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      originalUrl: true,
      provenance: true,
      activeVariant: true,
      enhancedUrl: true,
      enhancedReviewStatus: true,
    },
  },
} satisfies Prisma.SiteInclude;

export type PersistedSiteDraftRecord = Prisma.SiteGetPayload<{
  include: typeof siteDraftRelations;
}>;

export type LoadedSite = {
  vertical: VerticalId;
  config: ErasedVerticalConfig;
  draft: unknown;
  revision: number;
  theme: SiteThemeView;
};

/**
 * Shared server-to-client contract for an owner editor's initial full-replace
 * save. Every vertical must send this revision back as `expectedRevision`.
 */
export type OwnerDraftDto<TDraft> = {
  draft: TDraft;
  revision: number;
};

/**
 * What a page needs to render a site: the draft in its structural form plus the
 * vertical and pinned theme identity that own it.
 */
export type SiteView = {
  vertical: VerticalId;
  draft: SiteDraftView;
  theme: SiteThemeView;
};

export type PublishedSiteVersionRecord = {
  vertical: VerticalId;
  theme: Prisma.JsonValue;
  themeVersion: string;
  palette: Prisma.JsonValue;
  content: Prisma.JsonValue;
  translations: Prisma.JsonValue;
  integrations: Prisma.JsonValue;
  publishedAt: Date | null;
};

/**
 * Projects editable Site rows through the owning vertical's schemas.
 *
 * This function is shared with the publish transaction so the private preview
 * and the snapshot being published cannot drift into separate serialization
 * formats.
 */
export function projectSiteDraft(site: PersistedSiteDraftRecord): LoadedSite {
  const config = resolveVerticalConfig(site.vertical);
  const attributes = config.attributesSchema.parse(site.attributes);
  const compatibleIntegrationState = compatibleVerticalIntegrationState(
    config,
    site.integrations.map((integration) => ({
      type: integration.type.toLowerCase(),
      label: integration.label,
      provider: integration.provider,
      url: integration.url,
      enabled: integration.enabled,
      venueId: integration.venueId,
    })),
    site.translations,
  );
  const draft = config.draftSchema.parse({
    slug: site.slug,
    name: site.name,
    eyebrow:
      site.eyebrow ??
      config.presentation.buildEyebrow(attributes, {
        address: site.address,
      }),
    description: site.description ?? config.presentation.fallbackDescription,
    address: site.address ?? "",
    phone: site.phone ?? "",
    email: site.email ?? "",
    sourceUrl: site.sourceUrl,
    logoUrl: compatiblePersistedImageUrl(site.logoUrl),
    faviconUrl: compatiblePersistedImageUrl(site.faviconUrl),
    heroImageUrl: compatiblePersistedImageUrl(site.heroImageUrl),
    heroOriginalImageUrl: compatiblePersistedImageUrl(
      site.heroOriginalImageUrl,
    ),
    heroImageProvenance: fromDatabaseImageProvenance(
      site.heroImageProvenance,
    ),
    galleryImages: site.photos.map((photo) => ({
      url:
        photo.activeVariant === "ENHANCED" &&
        photo.enhancedReviewStatus === "APPROVED" &&
        photo.enhancedUrl
          ? photo.enhancedUrl
          : photo.originalUrl,
      originalUrl: photo.originalUrl,
      provenance: fromDatabaseImageProvenance(photo.provenance)!,
    })),
    palette: storedPalette(
      site.draftPalette,
      config.presentation.fallbackPalette,
    ),
    sourceData: compatibleSourceData(site.sourceData, site.sourceUrl),
    attributes,
    autoEnhanceImages: site.autoEnhanceImages,
    defaultLocale: site.defaultLocale,
    businessHours: site.businessHours,
    translations: compatibleIntegrationState.translations,
    catalogSections: site.catalogSections.map((section) => ({
      name: section.name,
      description: section.description ?? "",
      items: section.items.map((item) => ({
        name: item.name,
        description: item.description ?? "",
        price: item.price === null ? null : Number(item.price),
        currency: item.currency,
        available: item.available,
        attributes: config.itemAttributesSchema.parse(item.attributes),
        imageUrl: compatiblePersistedImageUrl(item.imageUrl),
        originalImageUrl: compatiblePersistedImageUrl(item.originalImageUrl),
        imageProvenance: fromDatabaseImageProvenance(item.imageProvenance),
      })),
    })),
    integrations: compatibleIntegrationState.integrations,
  });

  return {
    vertical: site.vertical,
    config,
    draft,
    revision: site.draftRevision,
    theme: editableTheme(
      site.vertical,
      config,
      attributes,
      site.draftTheme,
      site.draftThemeVersion,
    ),
  };
}

/**
 * Loads editable draft state, including its optimistic-concurrency revision.
 * Custom domains never use this mutable-draft path.
 */
export async function findSiteDraft(slug: string): Promise<LoadedSite | null> {
  if (!process.env.DATABASE_URL) return null;

  const site = await getDb().site.findUnique({
    where: { slug },
    include: siteDraftRelations,
  });

  return site ? projectSiteDraft(site) : null;
}

/** Backward-compatible owner loader; `LoadedSite.revision` is the token. */
export async function findOwnerSiteDraft(
  slug: string,
): Promise<LoadedSite | null> {
  return findSiteDraft(slug);
}

/**
 * Dereferences the site's one live pointer and validates the immutable snapshot
 * before rendering it. Mutable Site columns and child rows are intentionally not
 * selected, so a Save cannot leak into a public custom domain or platform
 * subdomain. CLAIMED snapshots are included because a site can be public on
 * `<slug>.<niche>` before a custom domain makes the row LIVE.
 */
export async function findPublishedSiteView(
  slug: string,
  versionId?: string,
): Promise<SiteView | null> {
  if (!process.env.DATABASE_URL) return null;

  const version = versionId
    ? await getDb().siteVersion.findFirst({
        where: {
          id: versionId,
          publishedAt: { not: null },
          site: {
            slug,
            status: { in: ["CLAIMED", "LIVE"] },
            publishedSiteVersionId: versionId,
          },
        },
        select: {
          vertical: true,
          theme: true,
          themeVersion: true,
          palette: true,
          content: true,
          translations: true,
          integrations: true,
          publishedAt: true,
        },
      })
    : (
        await getDb().site.findUnique({
          where: { slug },
          select: {
            publishedSiteVersion: {
              select: {
                vertical: true,
                theme: true,
                themeVersion: true,
                palette: true,
                content: true,
                translations: true,
                integrations: true,
                publishedAt: true,
              },
            },
          },
        })
      )?.publishedSiteVersion;
  if (!version || !isVerticalPublicationEnabled(version.vertical)) return null;
  return projectPublishedSiteVersion(version);
}

/**
 * Cached front door for the live surface a verified customer domain serves.
 *
 * `proxy.ts` only sets the version-id header for a hostname that is verified
 * and points at a `LIVE` site, so this is the ISR-equivalent path: content
 * for a given `(slug, versionId)` pair is immutable once published, and
 * `previewCacheTagFor(slug)` lets publish/rollback/domain-verification bust
 * the entry the instant the currently-serving version changes.
 *
 * `unstable_cache` is called fresh on every invocation deliberately — that is
 * what lets `tags` be computed per slug instead of being fixed once at
 * module load, which is the documented pattern for per-key tag invalidation.
 */
export function getCachedPublishedSiteView(
  slug: string,
  versionId: string,
): Promise<SiteView | null> {
  const cached = unstable_cache(
    () => findPublishedSiteView(slug, versionId),
    ["published-site-view", slug, versionId],
    {
      revalidate: PUBLISHED_SITE_VIEW_REVALIDATE_SECONDS,
      tags: [previewCacheTagFor(slug)],
    },
  );
  return cached();
}

/**
 * Canonical origin for a live site surface: verified custom domain when one
 * exists, otherwise the platform subdomain. Used by `alternates.canonical` and
 * Open Graph URLs so they follow the same redirect policy as `proxy.ts`.
 */
export async function resolveLiveSiteOrigin(
  slug: string,
  vertical: VerticalId,
): Promise<string> {
  if (!process.env.DATABASE_URL) {
    return publicSiteOrigin({ slug, vertical });
  }
  const rows = await getDb().domain.findMany({
    where: { verified: true, site: { slug } },
    select: { hostname: true },
  });
  return publicSiteOrigin({
    slug,
    vertical,
    verifiedHostname: canonicalVerifiedCustomHostname(
      rows.map((row) => ({ hostname: row.hostname, verified: true })),
    ),
  });
}

export function projectPublishedSiteVersion(
  version: PublishedSiteVersionRecord,
): SiteView | null {
  if (!version.publishedAt) return null;
  const config = resolveVerticalConfig(version.vertical);
  const content = compatiblePublishedContent(version.content);
  const compatibleIntegrationState = compatibleVerticalIntegrationState(
    config,
    version.integrations,
    version.translations,
  );
  const draft = config.draftSchema.parse({
    ...content,
    palette: version.palette,
    translations: compatibleIntegrationState.translations,
    integrations: compatibleIntegrationState.integrations,
  }) as SiteDraftView;
  const theme = publishedTheme(
    version.vertical,
    config,
    version.theme,
    version.themeVersion,
    draft.attributes,
  );
  if (!theme) return null;

  return { vertical: version.vertical, draft, theme };
}

/**
 * The loader every private rendering page uses. It adds demo fixtures on top of
 * the editable storage read; live custom-domain requests switch to
 * `findPublishedSiteView` in the page before this is called.
 */
export const findSiteView = cache(async function findSiteView(
  slug: string,
): Promise<SiteView | null> {
  if (!process.env.DATABASE_URL) {
    const draft =
      leadSiteDrafts[slug] ??
      (slug === sampleSiteDraft.slug ? sampleSiteDraft : null);
    if (!draft) return null;
    const config = resolveVerticalConfig(Vertical.RESTAURANT);
    const attributes = config.attributesSchema.parse(draft.attributes);
    return {
      vertical: Vertical.RESTAURANT,
      draft,
      theme: editableTheme(
        Vertical.RESTAURANT,
        config,
        attributes,
        {},
        LEGACY_THEME_VERSION,
      ),
    };
  }

  const site = await findSiteDraft(slug);
  if (!site) return null;
  return {
    vertical: site.vertical,
    draft: site.draft as SiteDraftView,
    theme: site.theme,
  };
});

/**
 * Same as `findSiteView`, but falls back to the **sample** site only when the
 * requested slug is the sample's own slug. Arbitrary owner slugs never receive
 * invented Osteria Luna content.
 */
export async function getSiteView(slug: string): Promise<SiteView> {
  const site = await findSiteView(slug);
  if (site) return site;

  if (slug !== sampleSiteDraft.slug) {
    throw new Error(`Site not found: ${slug}`);
  }

  const config = resolveVerticalConfig(Vertical.RESTAURANT);
  const draft = sampleSiteDraft;
  const attributes = config.attributesSchema.parse(draft.attributes);
  return {
    vertical: Vertical.RESTAURANT,
    draft,
    theme: editableTheme(
      Vertical.RESTAURANT,
      config,
      attributes,
      {},
      LEGACY_THEME_VERSION,
    ),
  };
}

function editableTheme(
  vertical: VerticalId,
  config: ErasedVerticalConfig,
  attributes: Record<string, unknown>,
  value: Prisma.JsonValue,
  version: string,
): SiteThemeView {
  const registeredTheme = restaurantSiteTheme(vertical, attributes);
  if (registeredTheme) return registeredTheme;

  const selection = jsonRecord(value);
  const storedId = typeof selection.id === "string" ? selection.id : null;
  const resolvedId = config.templates.resolve(attributes).id;
  const id =
    storedId && storedId in config.templates.definitions
      ? storedId
      : resolvedId;
  return {
    id,
    version: version || LEGACY_THEME_VERSION,
    selection: { ...selection, id },
  };
}

function publishedTheme(
  vertical: VerticalId,
  config: ErasedVerticalConfig,
  value: Prisma.JsonValue,
  version: string,
  attributes: Record<string, unknown>,
): SiteThemeView | null {
  if (vertical === Vertical.RESTAURANT) {
    const storedSelection = parseRestaurantThemeSelection(value);
    if (storedSelection) {
      const expectedVersion = restaurantRendererVersionId(
        storedSelection.rendererVersion,
      );
      if (version !== expectedVersion) return null;
      return {
        id: storedSelection.themeId,
        version,
        selection: storedSelection,
      };
    }

    // PR #64 stored the structured selection inside the immutable content
    // snapshot before the dedicated theme column was wired to the registry.
    // Read those snapshots compatibly; the next owner Save/Publish promotes the
    // same validated selection into the dedicated versioned theme fields.
    const contentTheme = restaurantSiteTheme(vertical, attributes);
    if (contentTheme) return contentTheme;
  }

  const selection = jsonRecord(value);
  const id = typeof selection.id === "string" ? selection.id : null;
  if (!id || !(id in config.templates.definitions) || !version) return null;
  return { id, version, selection };
}

function storedPalette(
  value: Prisma.JsonValue,
  fallback: Omit<SitePaletteView, "accentForeground"> & {
    accentForeground?: string;
  },
): SitePaletteView {
  const palette = jsonRecord(value);
  if (
    typeof palette.background !== "string" ||
    typeof palette.foreground !== "string" ||
    typeof palette.accent !== "string"
  ) {
    return {
      ...fallback,
      accentForeground: fallback.accentForeground ?? "#ffffff",
    };
  }
  return {
    background: palette.background,
    foreground: palette.foreground,
    accent: palette.accent,
    accentForeground:
      typeof palette.accentForeground === "string"
        ? palette.accentForeground
        : "#ffffff",
  };
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function compatiblePersistedImageUrl(value: unknown): string | null {
  const parsed = siteImageUrlSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Draft schemas intentionally reject integration kinds a vertical does not own,
 * but older Site rows and immutable snapshots may predate that narrowing. Keep
 * those rows readable by projecting only the vertical's current allowlist and
 * removing the labels at the same indices from every aligned translation.
 */
function compatibleVerticalIntegrationState(
  config: ErasedVerticalConfig,
  value: unknown,
  translationsValue: unknown,
): { integrations: unknown; translations: unknown } {
  if (!Array.isArray(value)) {
    return { integrations: value, translations: translationsValue };
  }

  const retainedIndices = value.flatMap((entry, index) => {
    const type = jsonRecord(entry).type;
    return typeof type === "string" &&
      config.integrationTypes.some((allowedType) => allowedType === type)
      ? [index]
      : [];
  });
  if (retainedIndices.length === value.length) {
    return { integrations: value, translations: translationsValue };
  }

  const integrations = retainedIndices.map((index) => value[index]);
  const translations = Array.isArray(translationsValue)
    ? translationsValue.map((entry) => {
        const translation = jsonRecord(entry);
        const labels = translation.integrationLabels;
        if (!Array.isArray(labels) || labels.length !== value.length) {
          return entry;
        }
        return {
          ...translation,
          integrationLabels: retainedIndices.map((index) => labels[index]),
        };
      })
    : translationsValue;
  return { integrations, translations };
}

function compatibleSourceData(
  value: unknown,
  sourceUrl: unknown,
): Record<string, unknown> {
  const sourceData = jsonRecord(value);
  const source = validHttpUrl(sourceUrl);
  const navigation = Array.isArray(sourceData.navigation)
    ? sourceData.navigation.flatMap((entry) => {
        const normalized = compatibleSourceNavigation(entry, source);
        return normalized ? [normalized] : [];
      })
    : [];
  const brandAssets = Array.isArray(sourceData.brandAssets)
    ? sourceData.brandAssets.flatMap((entry) => {
        const asset = jsonRecord(entry);
        const url = compatiblePersistedImageUrl(asset.url);
        return url ? [{ ...asset, url }] : [];
      })
    : [];
  const evidence = Array.isArray(sourceData.evidence)
    ? sourceData.evidence.map((entry) => {
        const record = jsonRecord(entry);
        return {
          ...record,
          value:
            typeof record.value === "string"
              ? record.value.slice(0, 500)
              : record.value,
          excerpt:
            typeof record.excerpt === "string"
              ? record.excerpt.slice(0, 280)
              : record.excerpt,
        };
      })
    : [];
  return { ...sourceData, navigation, brandAssets, evidence };
}

function compatibleSourceNavigation(
  value: unknown,
  source: URL | null,
): Record<string, unknown> | null {
  const navigation = jsonRecord(value);
  if (
    typeof navigation.label !== "string" ||
    typeof navigation.url !== "string"
  ) {
    return null;
  }

  let intent = navigation.url;
  try {
    const absolute = new URL(intent);
    if (!source || absolute.origin !== source.origin) return null;
    intent = `${absolute.pathname}${absolute.search}${absolute.hash}`;
  } catch {
    // Current rows already store a bounded internal intent.
  }
  const parsedIntent = sourceNavigationIntentSchema.safeParse(intent);
  if (!parsedIntent.success) {
    return null;
  }

  const candidateDestination =
    source?.protocol === "https:"
      ? new URL(parsedIntent.data, source).toString()
      : null;
  const destination = safeExternalHttpsUrlSchema.safeParse(
    candidateDestination,
  );
  return {
    label: navigation.label,
    url: parsedIntent.data,
    destinationUrl: destination.success ? destination.data : null,
  };
}

function compatiblePublishedContent(value: unknown): Record<string, unknown> {
  const content = jsonRecord(value);
  const sourceUrl = content.sourceUrl;
  const catalogSections = Array.isArray(content.catalogSections)
    ? content.catalogSections.map((sectionValue) => {
        const section = jsonRecord(sectionValue);
        const items = Array.isArray(section.items)
          ? section.items.map((itemValue) => {
              const item = jsonRecord(itemValue);
              return {
                ...item,
                imageUrl: compatiblePersistedImageUrl(item.imageUrl),
                originalImageUrl: compatiblePersistedImageUrl(
                  item.originalImageUrl,
                ),
              };
            })
          : section.items;
        return { ...section, items };
      })
    : content.catalogSections;

  return {
    ...content,
    logoUrl: compatiblePersistedImageUrl(content.logoUrl),
    faviconUrl: compatiblePersistedImageUrl(content.faviconUrl),
    heroImageUrl: compatiblePersistedImageUrl(content.heroImageUrl),
    heroOriginalImageUrl: compatiblePersistedImageUrl(
      content.heroOriginalImageUrl,
    ),
    sourceData: compatibleSourceData(content.sourceData, sourceUrl),
    catalogSections,
  };
}

function validHttpUrl(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function fromDatabaseImageProvenance(
  value: "OFFICIAL" | "OWNER" | "PERMISSIONED_UGC" | null,
): "official" | "owner" | "permissioned-ugc" | null {
  if (!value) return null;
  return value.toLowerCase().replace("_", "-") as
    | "official"
    | "owner"
    | "permissioned-ugc";
}
