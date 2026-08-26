import { beforeEach, describe, expect, it, mock } from "bun:test";
import { NextRequest } from "next/server";
import { clearDomainLookupCache } from "@/lib/domain-lookup-cache";
import type { PublishedDomainRecord } from "@/lib/domain-routing";
import {
  LIVE_SITE_ORIGIN_HEADER,
  LIVE_SITE_SLUG_HEADER,
  LIVE_SITE_VERSION_HEADER,
} from "@/lib/site-surface";

type PlatformSiteRow = {
  id: string;
  slug: string;
  status: "PROSPECT" | "PREVIEW_READY" | "CLAIMED" | "LIVE" | "PAUSED";
  publishedSiteVersionId: string | null;
  publishedSiteVersion: {
    id: string;
    siteId: string;
    publishedAt: Date | null;
  } | null;
  domains: Array<{ hostname: string; verified: boolean }>;
} | null;

let platformSite: PlatformSiteRow = null;
let customDomainRows: PublishedDomainRecord[] = [];
let platformLookupCalls = 0;

mock.module("@/lib/db", () => ({
  getDb: () => ({
    site: {
      findUnique: async ({ where }: { where: { slug: string } }) => {
        platformLookupCalls += 1;
        return platformSite && platformSite.slug === where.slug
          ? platformSite
          : null;
      },
    },
    domain: {
      findMany: async () => customDomainRows,
    },
  }),
}));

const { proxy } = await import("@/proxy");

const SLUG = "le-petit-meunier";
const VERSION_ID = "sv_1";

function claimedSite(
  overrides: Partial<NonNullable<PlatformSiteRow>> = {},
): NonNullable<PlatformSiteRow> {
  return {
    id: "site_1",
    slug: SLUG,
    status: "CLAIMED",
    publishedSiteVersionId: VERSION_ID,
    publishedSiteVersion: {
      id: VERSION_ID,
      siteId: "site_1",
      publishedAt: new Date("2026-08-01T00:00:00Z"),
    },
    domains: [],
    ...overrides,
  };
}

function request(pathname: string, hostname: string): NextRequest {
  return new NextRequest(`http://localhost${pathname}`, {
    headers: { "x-forwarded-host": hostname },
  });
}

async function rewriteDestination(response: Response): Promise<string | null> {
  const destination = response.headers.get("x-middleware-rewrite");
  if (!destination) return null;
  return new URL(destination, "http://localhost").pathname;
}

describe("health endpoint routing", () => {
  it("bypasses custom-domain resolution for container-local probes", async () => {
    for (const pathname of ["/api/health/live", "/api/health/ready"]) {
      const response = await proxy(
        new NextRequest(`http://127.0.0.1:3000${pathname}`),
      );

      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    }
  });

  it("lets Caddy authorize TLS through its internal service hostname", async () => {
    const response = await proxy(
      new NextRequest(
        "http://cornershopdev:3000/api/domains/authorize?domain=cornershop.dev",
      ),
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });
});

describe("platform-subdomain routing", () => {
  beforeEach(() => {
    platformSite = null;
    customDomainRows = [];
    platformLookupCalls = 0;
    clearDomainLookupCache();
  });

  it("reuses the slug lookup within the five-second cache window", async () => {
    platformSite = claimedSite();

    await proxy(request("/", `${SLUG}.restofront.com`));
    await proxy(request("/blog", `${SLUG}.restofront.com`));

    expect(platformLookupCalls).toBe(1);
  });

  it("serves a claimed site at its platform subdomain without DNS action", async () => {
    platformSite = claimedSite();

    const response = await proxy(request("/", `${SLUG}.restofront.com`));

    expect(await rewriteDestination(response)).toBe(`/preview/${SLUG}`);
    expect(response.headers.get("x-cornershop-site-version")).toBe(VERSION_ID);
  });

  it("canonicalizes localized platform paths onto the preview locale route", async () => {
    platformSite = claimedSite();

    const response = await proxy(
      request("/fr-ca", `${SLUG}.restofront.com`),
    );

    expect(await rewriteDestination(response)).toBe(
      `/preview/${SLUG}/fr-CA`,
    );
  });

  it("marks the rewritten request with the serving slug and version", async () => {
    platformSite = claimedSite();

    const response = await proxy(request("/", `${SLUG}.restofront.com`));

    expect(
      response.headers.get(
        "x-middleware-request-x-cornershop-live-site-slug",
      ),
    ).toBe(SLUG);
    expect(
      response.headers.get(
        "x-middleware-request-x-cornershop-live-site-version",
      ),
    ).toBe(VERSION_ID);
  });

  it("never forwards caller-supplied live-site markers", async () => {
    platformSite = null;

    const response = await proxy(
      new NextRequest("http://localhost/", {
        headers: {
          "x-forwarded-host": `${SLUG}.restofront.com`,
          "x-cornershop-live-site-slug": "someone-elses-site",
          "x-cornershop-live-site-version": "sv_fake",
          "x-cornershop-live-site-origin": "https://attacker.example",
        },
      }),
    );

    expect(response.status).toBe(404);
    expect(
      response.headers.get(
        "x-middleware-request-x-cornershop-live-site-slug",
      ),
    ).toBeNull();
    expect(
      response.headers.get(
        "x-middleware-request-x-cornershop-live-site-origin",
      ),
    ).toBeNull();
  });

  it("404s unpublished prospects so previews stay private", async () => {
    platformSite = claimedSite({
      status: "PROSPECT",
      publishedSiteVersionId: null,
      publishedSiteVersion: null,
    });

    const response = await proxy(request("/", `${SLUG}.restofront.com`));

    expect(response.status).toBe(404);
    expect(await rewriteDestination(response)).toBeNull();
  });

  it("404s paused sites", async () => {
    platformSite = claimedSite({ status: "PAUSED" });

    const response = await proxy(request("/", `${SLUG}.restofront.com`));

    expect(response.status).toBe(404);
  });

  it("blocks owner and operator surfaces on customer hosts", async () => {
    platformSite = claimedSite();

    for (const pathname of ["/dashboard", "/claim/x", "/api/auth/session"]) {
      const response = await proxy(request(pathname, `${SLUG}.restofront.com`));
      expect(response.status).toBe(404);
    }
  });

  it("keeps the two public write endpoints reachable", async () => {
    platformSite = claimedSite();

    const analytics = await proxy(
      request("/api/analytics/events", `${SLUG}.restofront.com`),
    );
    expect(analytics.headers.get("x-middleware-next")).toBe("1");

    const booking = await proxy(
      request(
        `/api/sites/${SLUG}/booking-requests`,
        `${SLUG}.restofront.com`,
      ),
    );
    expect(booking.headers.get("x-middleware-next")).toBe("1");
  });

  it("routes all discovery resources with a platform-origin attestation", async () => {
    platformSite = claimedSite();
    const hostname = `${SLUG}.restofront.com`;
    for (const [pathname, destination] of [
      ["/robots.txt", null],
      ["/sitemap.xml", null],
      ["/blog/sitemap.xml", `/preview/${SLUG}/blog/sitemap.xml`],
      ["/blog/rss.xml", `/preview/${SLUG}/blog/rss.xml`],
    ] as const) {
      const response = await proxy(request(pathname, hostname));
      expect(response.status).toBe(200);
      expect(await rewriteDestination(response)).toBe(destination);
      if (destination === null) {
        expect(response.headers.get("x-middleware-next")).toBe("1");
      }
      expect(forwardedHeader(response, LIVE_SITE_SLUG_HEADER)).toBe(SLUG);
      expect(forwardedHeader(response, LIVE_SITE_VERSION_HEADER)).toBe(
        VERSION_ID,
      );
      expect(forwardedHeader(response, LIVE_SITE_ORIGIN_HEADER)).toBe(
        `https://${hostname}`,
      );
    }
  });

  it("301s to the canonical verified custom domain once it exists", async () => {
    platformSite = claimedSite({
      status: "LIVE",
      domains: [{ hostname: "lepetitmeunier.fr", verified: true }],
    });

    const response = await proxy(request("/", `${SLUG}.restofront.com`));

    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("https://lepetitmeunier.fr/");
    expect(await rewriteDestination(response)).toBeNull();
  });

  it("falls back to the factory apex as a platform parent", async () => {
    platformSite = claimedSite();

    const response = await proxy(request("/", `${SLUG}.cornershop.dev`));

    expect(await rewriteDestination(response)).toBe(`/preview/${SLUG}`);
  });

  it("keeps reserved operator labels under a niche domain closed", async () => {
    const response = await proxy(request("/", "api.restofront.com"));

    expect(response.status).toBe(404);
    expect(await rewriteDestination(response)).toBeNull();
  });

  it("does not mint nested platform hosts", async () => {
    const response = await proxy(
      request("/", `foo.${SLUG}.restofront.com`),
    );

    expect(response.status).toBe(404);
  });
});

describe("custom-domain discovery routing", () => {
  const hostname = "lepetitmeunier.example";

  beforeEach(() => {
    platformSite = null;
    customDomainRows = [liveCustomDomain(hostname)];
    clearDomainLookupCache();
  });

  it("serves and attests all four discovery resources", async () => {
    for (const [pathname, destination] of [
      ["/robots.txt", null],
      ["/sitemap.xml", null],
      ["/blog/sitemap.xml", `/preview/${SLUG}/blog/sitemap.xml`],
      ["/blog/rss.xml", `/preview/${SLUG}/blog/rss.xml`],
    ] as const) {
      const response = await proxy(request(pathname, hostname));
      expect(response.status).toBe(200);
      expect(await rewriteDestination(response)).toBe(destination);
      expect(forwardedHeader(response, LIVE_SITE_SLUG_HEADER)).toBe(SLUG);
      expect(forwardedHeader(response, LIVE_SITE_VERSION_HEADER)).toBe(
        VERSION_ID,
      );
      expect(forwardedHeader(response, LIVE_SITE_ORIGIN_HEADER)).toBe(
        `https://${hostname}`,
      );
    }
  });

  it("canonicalizes a regional locale on a custom domain", async () => {
    const response = await proxy(request("/FR-ca", hostname));

    expect(await rewriteDestination(response)).toBe(
      `/preview/${SLUG}/fr-CA`,
    );
    expect(forwardedHeader(response, LIVE_SITE_ORIGIN_HEADER)).toBe(
      `https://${hostname}`,
    );
  });

  it("overwrites a spoofed origin only after custom-host attestation", async () => {
    const response = await proxy(
      new NextRequest("http://localhost/blog/rss.xml", {
        headers: {
          "x-forwarded-host": hostname,
          [LIVE_SITE_SLUG_HEADER]: "attacker",
          [LIVE_SITE_VERSION_HEADER]: "sv_attacker",
          [LIVE_SITE_ORIGIN_HEADER]: "https://attacker.example",
        },
      }),
    );

    expect(forwardedHeader(response, LIVE_SITE_SLUG_HEADER)).toBe(SLUG);
    expect(forwardedHeader(response, LIVE_SITE_VERSION_HEADER)).toBe(
      VERSION_ID,
    );
    expect(forwardedHeader(response, LIVE_SITE_ORIGIN_HEADER)).toBe(
      `https://${hostname}`,
    );
  });

  it("keeps nested, spoofed, and unrelated discovery-like paths denied", async () => {
    for (const pathname of [
      "/robots.txt/extra",
      "/sitemap.xml.bak",
      "/foo/sitemap.xml",
      "/blog/robots.txt",
      "/blog/rss.xml/extra",
      "/blog/sitemap.xml/extra",
      `/preview/${SLUG}/blog/rss.xml`,
      "/blog/article/nested",
      "/dashboard",
      "/api/auth/session",
    ]) {
      const response = await proxy(request(pathname, hostname));
      expect(response.status).toBe(404);
      expect(await rewriteDestination(response)).toBeNull();
      expect(forwardedHeader(response, LIVE_SITE_ORIGIN_HEADER)).toBeNull();
    }
  });
});

function forwardedHeader(response: Response, name: string): string | null {
  return response.headers.get(`x-middleware-request-${name}`);
}

function liveCustomDomain(hostname: string): PublishedDomainRecord {
  return {
    hostname,
    verified: true,
    site: {
      id: "site_1",
      slug: SLUG,
      status: "LIVE",
      publishedSiteVersionId: VERSION_ID,
      publishedSiteVersion: {
        id: VERSION_ID,
        siteId: "site_1",
        publishedAt: new Date("2026-08-01T00:00:00Z"),
      },
    },
  };
}
