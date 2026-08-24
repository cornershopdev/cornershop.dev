import {
  parsePlatformSubdomain,
  platformSiteHostname,
  type PlatformSubdomain,
} from "@/lib/hostnames";
import type { VerticalId } from "@/lib/verticals/types";
import { canonicalSiteLocale } from "@/lib/site-surface";

export type DomainHostnamePlan = {
  canonicalHostname: string;
  hostnames: string[];
  records: Array<{
    hostname: string;
    type: "A" | "CNAME";
    name: string;
  }>;
};

export type PublishedDomainRecord = {
  hostname: string;
  verified: boolean;
  site: {
    id: string;
    slug: string;
    status: "PROSPECT" | "PREVIEW_READY" | "CLAIMED" | "LIVE" | "PAUSED";
    publishedSiteVersionId: string | null;
    publishedSiteVersion: {
      id: string;
      siteId: string;
      publishedAt: Date | null;
    } | null;
  };
};

export type CustomerHostDecision =
  | { kind: "not_found" }
  | {
      kind: "redirect";
      canonicalHostname: string;
    }
  | {
      kind: "page";
      slug: string;
      versionId: string;
      locale: string | null;
    }
  | {
      kind: "blog";
      slug: string;
      versionId: string;
      articleSlug: string | null;
    }
  | {
      kind: "robots";
      slug: string;
      versionId: string;
    }
  | {
      kind: "root_sitemap";
      slug: string;
      versionId: string;
    }
  | {
      kind: "blog_sitemap";
      slug: string;
      versionId: string;
    }
  | {
      kind: "rss";
      slug: string;
      versionId: string;
    }
  | {
      kind: "public_api";
      slug: string;
      versionId: string;
    }
  | {
      kind: "opengraph";
      slug: string;
      versionId: string;
    };

export type PlatformSubdomainSite = {
  id: string;
  slug: string;
  status: PublishedDomainRecord["site"]["status"];
  publishedSiteVersionId: string | null;
  publishedSiteVersion: PublishedDomainRecord["site"]["publishedSiteVersion"];
  verifiedDomains: Array<{ hostname: string; verified: boolean }>;
};

/**
 * Cornershop's explicit apex/www policy.
 *
 * A two-label hostname and its `www` form are one claim with the apex canonical.
 * Deeper hostnames are exact CNAME claims: guessing registrable domains such as
 * `co.uk` without a maintained public-suffix list would risk claiming a sibling.
 */
export function planDomainHostnames(hostname: string): DomainHostnamePlan {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
  const withoutWww = normalized.startsWith("www.")
    ? normalized.slice(4)
    : normalized;
  const isApexPair = withoutWww.split(".").length === 2;

  if (isApexPair) {
    return {
      canonicalHostname: withoutWww,
      hostnames: [withoutWww, `www.${withoutWww}`],
      records: [
        { hostname: withoutWww, type: "A", name: "@" },
        {
          hostname: `www.${withoutWww}`,
          type: "CNAME",
          name: "www",
        },
      ],
    };
  }

  return {
    canonicalHostname: normalized,
    hostnames: [normalized],
    records: [
      {
        hostname: normalized,
        type: "CNAME",
        name: normalized.split(".")[0] ?? normalized,
      },
    ],
  };
}

/**
 * Resolves the only surfaces a customer hostname may expose.
 *
 * All owner/operator routes and unrelated public APIs are denied here before
 * Next's filesystem router can see them. The two public write endpoints remain
 * available because the live renderer needs analytics and booking requests,
 * and the generated Open Graph image is passed through so a crawler can fetch
 * it from the customer host.
 */
export function decideCustomerHostRoute(input: {
  hostname: string;
  pathname: string;
  records: PublishedDomainRecord[];
}): CustomerHostDecision {
  const exact = input.records.find(
    (record) =>
      record.hostname === input.hostname &&
      record.verified &&
      hasValidPublishedSite(record),
  );
  if (!exact) return { kind: "not_found" };

  const plan = planDomainHostnames(input.hostname);
  const canonical = input.records.find(
    (record) =>
      record.hostname === plan.canonicalHostname &&
      record.site.id === exact.site.id &&
      record.verified &&
      hasValidPublishedSite(record),
  );
  const surface = customerSurface(input.pathname, exact.site.slug);
  if (surface.kind === "blocked") return { kind: "not_found" };

  if (
    input.hostname !== plan.canonicalHostname &&
    canonical &&
    canonical.site.publishedSiteVersionId ===
      exact.site.publishedSiteVersionId
  ) {
    return {
      kind: "redirect",
      canonicalHostname: plan.canonicalHostname,
    };
  }

  const versionId = exact.site.publishedSiteVersionId;
  if (!versionId) return { kind: "not_found" };
  if (
    surface.kind === "robots" ||
    surface.kind === "root_sitemap" ||
    surface.kind === "blog_sitemap" ||
    surface.kind === "rss"
  ) {
    return { kind: surface.kind, slug: exact.site.slug, versionId };
  }
  if (surface.kind === "public_api") {
    return {
      kind: "public_api",
      slug: exact.site.slug,
      versionId,
    };
  }
  if (surface.kind === "opengraph") {
    return {
      kind: "opengraph",
      slug: exact.site.slug,
      versionId,
    };
  }
  if (surface.kind === "blog") {
    return {
      kind: "blog",
      slug: exact.site.slug,
      versionId,
      articleSlug: surface.articleSlug ?? null,
    };
  }
  return {
    kind: "page",
    slug: exact.site.slug,
    versionId,
    locale: surface.locale,
  };
}

/**
 * Resolves a factory/niche platform subdomain (`<slug>.restofront.com` or
 * `<slug>.cornershop.dev`) onto the same public surfaces as a verified custom
 * domain. CLAIMED and LIVE snapshots both serve; unpublished prospects stay
 * private on the factory `/preview/<slug>` path. A verified custom domain
 * becomes the canonical host.
 */
export function decidePlatformSubdomainRoute(input: {
  hostname: string;
  pathname: string;
  parsed?: PlatformSubdomain | null;
  site: PlatformSubdomainSite | null;
}): CustomerHostDecision {
  const parsed = input.parsed ?? parsePlatformSubdomain(input.hostname);
  if (!parsed || !input.site || input.site.slug !== parsed.slug) {
    return { kind: "not_found" };
  }
  if (!hasPublicPublishedSnapshot(input.site)) return { kind: "not_found" };

  const surface = customerSurface(input.pathname, input.site.slug);
  if (surface.kind === "blocked") return { kind: "not_found" };

  const canonicalCustom = canonicalVerifiedCustomHostname(
    input.site.verifiedDomains,
  );
  if (canonicalCustom) {
    return {
      kind: "redirect",
      canonicalHostname: canonicalCustom,
    };
  }

  const versionId = input.site.publishedSiteVersionId;
  if (!versionId) return { kind: "not_found" };
  if (
    surface.kind === "robots" ||
    surface.kind === "root_sitemap" ||
    surface.kind === "blog_sitemap" ||
    surface.kind === "rss"
  ) {
    return { kind: surface.kind, slug: input.site.slug, versionId };
  }
  if (surface.kind === "public_api") {
    return {
      kind: "public_api",
      slug: input.site.slug,
      versionId,
    };
  }
  if (surface.kind === "opengraph") {
    return {
      kind: "opengraph",
      slug: input.site.slug,
      versionId,
    };
  }
  if (surface.kind === "blog") {
    return {
      kind: "blog",
      slug: input.site.slug,
      versionId,
      articleSlug: surface.articleSlug ?? null,
    };
  }
  return {
    kind: "page",
    slug: input.site.slug,
    versionId,
    locale: surface.locale,
  };
}

/**
 * A claimed site is public on its platform subdomain once a snapshot exists.
 * Custom domains still require LIVE via `hasValidPublishedSite`.
 */
export function hasPublicPublishedSnapshot(site: {
  id: string;
  status: PublishedDomainRecord["site"]["status"];
  publishedSiteVersionId: string | null;
  publishedSiteVersion: PublishedDomainRecord["site"]["publishedSiteVersion"];
}): boolean {
  const version = site.publishedSiteVersion;
  return (
    (site.status === "CLAIMED" || site.status === "LIVE") &&
    Boolean(site.publishedSiteVersionId) &&
    version?.id === site.publishedSiteVersionId &&
    version.siteId === site.id &&
    version.publishedAt instanceof Date
  );
}

export function canonicalVerifiedCustomHostname(
  domains: Array<{ hostname: string; verified: boolean }>,
): string | null {
  const verified = domains.filter((row) => row.verified);
  if (!verified.length) return null;
  const canonicals = verified.filter(
    (row) =>
      row.hostname === planDomainHostnames(row.hostname).canonicalHostname,
  );
  return canonicals[0]?.hostname ?? verified[0]?.hostname ?? null;
}

export function publicSiteOrigin(input: {
  slug: string;
  vertical?: VerticalId;
  verifiedHostname?: string | null;
}): string {
  if (input.verifiedHostname) {
    return `https://${planDomainHostnames(input.verifiedHostname).canonicalHostname}`;
  }
  return `https://${platformSiteHostname(input.slug, input.vertical)}`;
}

export function publicSiteUrl(input: {
  slug: string;
  vertical?: VerticalId;
  verifiedHostname?: string | null;
  pathname?: string;
}): string {
  const origin = publicSiteOrigin(input);
  const pathname = input.pathname ?? "/";
  if (pathname === "/") return `${origin}/`;
  return `${origin}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

export function siteStatusForDomainState(input: {
  currentStatus: "PROSPECT" | "PREVIEW_READY" | "CLAIMED" | "LIVE" | "PAUSED";
  hasVerifiedDomain: boolean;
  hasValidPublishedVersion: boolean;
}): "PROSPECT" | "PREVIEW_READY" | "CLAIMED" | "LIVE" | "PAUSED" {
  if (input.currentStatus === "PAUSED") return "PAUSED";
  if (
    input.currentStatus !== "CLAIMED" &&
    input.currentStatus !== "LIVE"
  ) {
    return input.currentStatus;
  }
  return input.hasVerifiedDomain && input.hasValidPublishedVersion
    ? "LIVE"
    : "CLAIMED";
}

function hasValidPublishedSite(record: PublishedDomainRecord): boolean {
  const version = record.site.publishedSiteVersion;
  return (
    record.site.status === "LIVE" &&
    Boolean(record.site.publishedSiteVersionId) &&
    version?.id === record.site.publishedSiteVersionId &&
    version.siteId === record.site.id &&
    version.publishedAt instanceof Date
  );
}

function customerSurface(
  pathname: string,
  slug: string,
):
  | { kind: "page"; locale: string | null }
  | { kind: "public_api" }
  | { kind: "opengraph" }
  | { kind: "blog"; articleSlug?: string }
  | { kind: "robots" }
  | { kind: "root_sitemap" }
  | { kind: "blog_sitemap" }
  | { kind: "rss" }
  | { kind: "blocked" } {
  if (pathname === "/") return { kind: "page", locale: null };
  const localeSegment = pathname.match(/^\/([^/]+)\/?$/)?.[1];
  const locale = canonicalSiteLocale(localeSegment ?? "");
  if (locale) return { kind: "page", locale };
  // Discovery resources are literal allowlist entries. Similar-looking files,
  // nested paths, and internal preview routes stay closed by default.
  if (pathname === "/robots.txt") return { kind: "robots" };
  if (pathname === "/sitemap.xml") return { kind: "root_sitemap" };
  if (pathname === "/blog/sitemap.xml") return { kind: "blog_sitemap" };
  if (pathname === "/blog/rss.xml") return { kind: "rss" };
  // The site's blog index and article pages. Only the exact two shapes below
  // are public; anything deeper (`/blog/a/b`) stays blocked.
  const blogIndex = pathname.match(/^\/blog\/?$/i);
  if (blogIndex) return { kind: "blog" };
  const blogArticle = pathname.match(/^\/blog\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/i);
  if (blogArticle?.[1]) {
    return { kind: "blog", articleSlug: blogArticle[1].toLowerCase() };
  }
  if (pathname === "/api/analytics/events") return { kind: "public_api" };
  if (
    pathname ===
    `/api/sites/${encodeURIComponent(slug)}/booking-requests`
  ) {
    return { kind: "public_api" };
  }
  // Live metadataBase is the customer host, so crawlers fetch the sibling
  // `/preview/<slug>/opengraph-image` there. Pass that file through; keep
  // the HTML preview path itself blocked.
  if (isSiteOgImagePath(pathname, slug)) return { kind: "opengraph" };
  return { kind: "blocked" };
}

function isSiteOgImagePath(pathname: string, slug: string): boolean {
  const segments = pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  if (segments[0] !== "preview" || segments[1] !== slug) return false;
  const file = segments.at(-1)?.toLowerCase();
  const isOgFile =
    file === "opengraph-image" ||
    file === "twitter-image" ||
    file === "opengraph-image.png" ||
    file === "twitter-image.png";
  if (!isOgFile) return false;
  if (segments.length === 3) return true;
  return (
    segments.length === 4 &&
    canonicalSiteLocale(segments[2] ?? "") !== null
  );
}
