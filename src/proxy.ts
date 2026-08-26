import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  decideCustomerHostRoute,
  decidePlatformSubdomainRoute,
  planDomainHostnames,
  type CustomerHostDecision,
} from "@/lib/domain-routing";
import {
  getCachedDomainRecords,
  getCachedPlatformSite,
  setCachedDomainRecords,
  setCachedPlatformSite,
} from "@/lib/domain-lookup-cache";
import {
  parsePlatformSubdomain,
  platformHostnames,
  requestHostname,
} from "@/lib/hostnames";
import {
  LIVE_SITE_ORIGIN_HEADER,
  LIVE_SITE_SLUG_HEADER,
  LIVE_SITE_VERSION_HEADER,
  PUBLIC_SITE_VERSION_HEADER,
} from "@/lib/site-surface";
import {
  listEmbedFrameOrigins,
  resolveVerticalByHostname,
  verticalSlug,
} from "@/lib/verticals/registry";

/**
 * The only origins a generated site may frame, derived from the provider tables
 * of the registered verticals rather than from a hand-kept list. A vertical that
 * ships a widget provider widens this by registering; nothing else can.
 *
 * `'none'` when no vertical publishes an embed, so a mistake in
 * `resolveBookingEmbed` degrades to a blocked frame instead of an open one.
 *
 * Only `frame-src` is set. The embeds are iframes, so nothing else needs
 * loosening, and declaring a full policy here would mean owning `script-src`
 * for Next's inline bootstrap — a much larger surface to get wrong for no gain.
 */
const embedFrameSrc = (() => {
  const origins = listEmbedFrameOrigins();
  return `frame-src ${origins.length ? origins.join(" ") : "'none'"}`;
})();

function withEmbedFrameCsp(response: NextResponse) {
  response.headers.set("Content-Security-Policy", embedFrameSrc);
  return response;
}

export async function proxy(request: NextRequest) {
  const upstreamHeaders = new Headers(request.headers);
  // Never trust a caller-supplied surface marker. Only the verified-domain
  // and platform-subdomain branches below may add it for the rewritten
  // Server Component request.
  upstreamHeaders.delete(LIVE_SITE_SLUG_HEADER);
  upstreamHeaders.delete(LIVE_SITE_VERSION_HEADER);
  upstreamHeaders.delete(LIVE_SITE_ORIGIN_HEADER);

  // Container-local infrastructure calls do not carry a public hostname.
  // Caddy's on-demand TLS check uses the Docker service name, while health
  // probes use an IP. Let these route handlers enforce their own authorization
  // before custom-domain lookup can turn either call into an unknown-host 404.
  if (
    request.nextUrl.pathname.startsWith("/api/health/") ||
    request.nextUrl.pathname === "/api/domains/authorize"
  ) {
    return NextResponse.next({ request: { headers: upstreamHeaders } });
  }

  const hostname = requestHostname(request.headers);
  if (!hostname || platformHostnames().has(hostname)) {
    const response = NextResponse.next({
      request: { headers: upstreamHeaders },
    });
    return request.nextUrl.pathname.startsWith("/preview/") ||
      request.nextUrl.pathname.startsWith("/pro/")
      ? withEmbedFrameCsp(response)
      : response;
  }

  // A niche's own marketing domain — restofront.com today, a nails or barber
  // domain tomorrow. Resolved from the vertical registry rather than from the
  // domain table: these hostnames belong to the factory, not to a customer, so
  // they must never be claimable through the custom-domain flow below, and
  // answering here also spares them a database round trip on every request.
  const niche = resolveVerticalByHostname(hostname);
  if (niche) {
    // The locale segment is dropped deliberately: a niche's marketing copy lives
    // in its config in one language, unlike a generated site, so `/fr` here
    // serves the same page rather than 404ing on a URL a visitor may well try.
    const locale = request.nextUrl.pathname.match(/^\/([a-z]{2})\/?$/i);
    if (request.nextUrl.pathname === "/" || locale) {
      return NextResponse.rewrite(
        new URL(`/niche/${verticalSlug(niche)}`, request.url),
        { request: { headers: upstreamHeaders } },
      );
    }
    return NextResponse.next({ request: { headers: upstreamHeaders } });
  }

  // Claimed sites are reachable at `<slug>.<niche>` (and `<slug>.cornershop.dev`
  // as a fallback) without the owner touching DNS. This runs before the Domain
  // table so a platform hostname can never be claimed as a custom domain, and so
  // a missing Site row 404s instead of falling through to an unknown-host lookup.
  const platform = parsePlatformSubdomain(hostname);
  if (platform) {
    const cachedSite = getCachedPlatformSite(platform.slug);
    const site =
      cachedSite !== undefined
        ? cachedSite
        : await getDb().site.findUnique({
            where: { slug: platform.slug },
            select: {
              id: true,
              slug: true,
              status: true,
              publishedSiteVersionId: true,
              publishedSiteVersion: {
                select: {
                  id: true,
                  siteId: true,
                  publishedAt: true,
                },
              },
              domains: {
                where: { verified: true },
                select: { hostname: true, verified: true },
              },
            },
          }).then((row) =>
            row
              ? {
                  id: row.id,
                  slug: row.slug,
                  status: row.status,
                  publishedSiteVersionId: row.publishedSiteVersionId,
                  publishedSiteVersion: row.publishedSiteVersion,
                  verifiedDomains: row.domains,
                }
              : null,
          );
    if (cachedSite === undefined) {
      setCachedPlatformSite(platform.slug, site);
    }
    return respondForCustomerHost(
      request,
      upstreamHeaders,
      decidePlatformSubdomainRoute({
        hostname,
        pathname: request.nextUrl.pathname,
        parsed: platform,
        site,
      }),
      301,
    );
  }

  const plan = planDomainHostnames(hostname);
  const cachedDomains = getCachedDomainRecords(plan.hostnames);
  const domains =
    cachedDomains ??
    (await getDb().domain.findMany({
      where: { hostname: { in: plan.hostnames } },
      select: {
        hostname: true,
        verified: true,
        site: {
          select: {
            id: true,
            slug: true,
            status: true,
            publishedSiteVersionId: true,
            publishedSiteVersion: {
              select: {
                id: true,
                siteId: true,
                publishedAt: true,
              },
            },
          },
        },
      },
    }));
  if (!cachedDomains) {
    setCachedDomainRecords(plan.hostnames, domains);
  }
  const decision = decideCustomerHostRoute({
    hostname,
    pathname: request.nextUrl.pathname,
    records: domains,
  });
  return respondForCustomerHost(request, upstreamHeaders, decision, 308);
}

function respondForCustomerHost(
  request: NextRequest,
  upstreamHeaders: Headers,
  decision: CustomerHostDecision,
  redirectStatus: 301 | 308,
) {
  if (decision.kind === "not_found") {
    return new NextResponse("Not found", {
      status: 404,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  if (decision.kind === "redirect") {
    const canonical = new URL(request.url);
    canonical.protocol = "https:";
    canonical.hostname = decision.canonicalHostname;
    canonical.port = "";
    return NextResponse.redirect(canonical, redirectStatus);
  }

  upstreamHeaders.set(LIVE_SITE_SLUG_HEADER, decision.slug);
  upstreamHeaders.set(LIVE_SITE_VERSION_HEADER, decision.versionId);
  const hostname = requestHostname(request.headers);
  if (!hostname) {
    return new NextResponse("Not found", {
      status: 404,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  upstreamHeaders.set(LIVE_SITE_ORIGIN_HEADER, `https://${hostname}`);
  if (
    decision.kind === "public_api" ||
    decision.kind === "opengraph" ||
    decision.kind === "robots" ||
    decision.kind === "root_sitemap"
  ) {
    return NextResponse.next({ request: { headers: upstreamHeaders } });
  }
  if (decision.kind === "blog_sitemap" || decision.kind === "rss") {
    const filename =
      decision.kind === "blog_sitemap" ? "sitemap.xml" : "rss.xml";
    return NextResponse.rewrite(
      new URL(`/preview/${decision.slug}/blog/${filename}`, request.url),
      { request: { headers: upstreamHeaders } },
    );
  }
  const destination =
    decision.kind === "blog"
      ? decision.articleSlug
        ? `/preview/${decision.slug}/blog/${decision.articleSlug}`
        : `/preview/${decision.slug}/blog`
      : decision.locale
        ? `/preview/${decision.slug}/${decision.locale}`
        : `/preview/${decision.slug}`;
  const response = NextResponse.rewrite(new URL(destination, request.url), {
    request: { headers: upstreamHeaders },
  });
  response.headers.set(PUBLIC_SITE_VERSION_HEADER, decision.versionId);
  return withEmbedFrameCsp(response);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|_next/webpack-hmr|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|map|woff|woff2)$).*)",
  ],
};
