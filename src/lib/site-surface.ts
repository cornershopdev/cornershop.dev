export const LIVE_SITE_SLUG_HEADER = "x-cornershop-live-site-slug";
export const LIVE_SITE_VERSION_HEADER = "x-cornershop-live-site-version";
export const LIVE_SITE_ORIGIN_HEADER = "x-cornershop-live-site-origin";
export const PUBLIC_SITE_VERSION_HEADER = "x-cornershop-site-version";

export type LiveSiteContext = {
  slug: string;
  versionId: string;
  origin: string;
};

export function liveSiteVersionId(
  headers: Pick<Headers, "get">,
  siteSlug: string,
): string | null {
  if (headers.get(LIVE_SITE_SLUG_HEADER) !== siteSlug) return null;
  const versionId = headers.get(LIVE_SITE_VERSION_HEADER)?.trim();
  return versionId || null;
}

export function isLiveSiteSurface(
  headers: Pick<Headers, "get">,
  siteSlug: string,
): boolean {
  return liveSiteVersionId(headers, siteSlug) !== null;
}

/**
 * Complete public identity attached by `proxy.ts` after hostname, publication,
 * and snapshot checks have passed. Customer discovery routes have no slug in
 * their filesystem path, so they must require the full marker set rather than
 * infer identity from an untrusted Host header.
 */
export function liveSiteContext(
  headers: Pick<Headers, "get">,
): LiveSiteContext | null {
  const slug = headers.get(LIVE_SITE_SLUG_HEADER)?.trim();
  const versionId = headers.get(LIVE_SITE_VERSION_HEADER)?.trim();
  const origin = canonicalHttpsOrigin(
    headers.get(LIVE_SITE_ORIGIN_HEADER)?.trim() ?? "",
  );
  if (!slug || !versionId || !origin) return null;
  return { slug, versionId, origin };
}

/**
 * Appends a locale segment to a base path while preserving any query string or
 * fragment already on it. The preview surface hangs `?theme=` off the base path
 * so a visitor switching language keeps looking at the theme they picked; the
 * locale segment belongs on the path, never after the `?`.
 */
export function localeHref(
  basePath: string,
  locale: string,
  defaultLocale: string,
): string {
  if (locale === defaultLocale) return basePath;
  const suffixIndex = basePath.search(/[?#]/);
  const path = suffixIndex === -1 ? basePath : basePath.slice(0, suffixIndex);
  const suffix = suffixIndex === -1 ? "" : basePath.slice(suffixIndex);
  return `${path.replace(/\/$/, "")}/${locale}${suffix}`;
}

/** Canonical shape accepted by the shared site schema: `en` or `fr-CA`. */
export function canonicalSiteLocale(value: string): string | null {
  const match = value.match(/^([a-z]{2})(?:-([a-z]{2}))?$/i);
  const language = match?.[1];
  if (!language) return null;
  const region = match[2];
  return region
    ? `${language.toLowerCase()}-${region.toUpperCase()}`
    : language.toLowerCase();
}

export function liveSiteCanonicalPath(
  origin: string,
  locale: string,
  defaultLocale: string,
): string {
  return locale === defaultLocale ? `${origin}/` : `${origin}/${locale}`;
}

/**
 * The `unstable_cache` tag for a site's cached live-surface data.
 *
 * One tag per slug, not per version: a rollback or republish moves which
 * version is current for the slug, so invalidation must key on the slug
 * regardless of which immutable `SiteVersion` row is being served.
 */
export function previewCacheTagFor(slug: string): string {
  return `preview-site:${slug}`;
}

function canonicalHttpsOrigin(value: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    if (value !== url.origin && value !== `${url.origin}/`) return null;
    return url.origin;
  } catch {
    return null;
  }
}
