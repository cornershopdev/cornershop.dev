import { describe, expect, it } from "bun:test";
import {
  canonicalVerifiedCustomHostname,
  decideCustomerHostRoute,
  decidePlatformSubdomainRoute,
  planDomainHostnames,
  publicSiteOrigin,
  publicSiteUrl,
  siteStatusForDomainState,
  type PlatformSubdomainSite,
  type PublishedDomainRecord,
} from "@/lib/domain-routing";

describe("custom-domain hostname plans", () => {
  it("claims an apex and www together with the apex canonical", () => {
    expect(planDomainHostnames("www.example.com")).toEqual({
      canonicalHostname: "example.com",
      hostnames: ["example.com", "www.example.com"],
      records: [
        { hostname: "example.com", type: "A", name: "@" },
        { hostname: "www.example.com", type: "CNAME", name: "www" },
      ],
    });
    expect(planDomainHostnames("example.com")).toEqual(
      planDomainHostnames("www.example.com"),
    );
  });

  it("does not guess a registrable parent for deeper hostnames", () => {
    expect(planDomainHostnames("book.example.co.uk")).toEqual({
      canonicalHostname: "book.example.co.uk",
      hostnames: ["book.example.co.uk"],
      records: [
        {
          hostname: "book.example.co.uk",
          type: "CNAME",
          name: "book",
        },
      ],
    });
  });
});

describe("customer host isolation", () => {
  it("serves only root, locales, public site endpoints and the OG image", () => {
    const records = livePair();
    expect(
      decideCustomerHostRoute({
        hostname: "example.com",
        pathname: "/",
        records,
      }),
    ).toEqual({
      kind: "page",
      slug: "chez-lea",
      versionId: "version_1",
      locale: null,
    });
    expect(
      decideCustomerHostRoute({
        hostname: "example.com",
        pathname: "/fr-ca",
        records,
      }),
    ).toEqual({
      kind: "page",
      slug: "chez-lea",
      versionId: "version_1",
      locale: "fr-CA",
    });
    expect(
      decideCustomerHostRoute({
        hostname: "example.com",
        pathname: "/api/analytics/events",
        records,
      }).kind,
    ).toBe("public_api");
    expect(
      decideCustomerHostRoute({
        hostname: "example.com",
        pathname: "/api/sites/chez-lea/booking-requests",
        records,
      }).kind,
    ).toBe("public_api");
    expect(
      decideCustomerHostRoute({
        hostname: "example.com",
        pathname: "/preview/chez-lea/opengraph-image",
        records,
      }),
    ).toEqual({
      kind: "opengraph",
      slug: "chez-lea",
      versionId: "version_1",
    });
    expect(
      decideCustomerHostRoute({
        hostname: "example.com",
        pathname: "/preview/chez-lea/fr/opengraph-image",
        records,
      }).kind,
    ).toBe("opengraph");

    for (const pathname of [
      "/dashboard",
      "/admin",
      "/sign-in",
      "/create",
      "/menu",
      "/preview/chez-lea",
      "/preview/other-site/opengraph-image",
      "/api/domains",
      "/api/sites/another/booking-requests",
      "/blog/a/b",
      "/blog/a/b/c",
      "/robots.txt/extra",
      "/sitemap.xml.bak",
      "/foo/sitemap.xml",
      "/blog/robots.txt",
      "/blog/rss.xml/extra",
      "/blog/sitemap.xml/extra",
      "/preview/chez-lea/blog/rss.xml",
    ]) {
      expect(
        decideCustomerHostRoute({
          hostname: "example.com",
          pathname,
          records,
        }),
      ).toEqual({ kind: "not_found" });
    }
  });

  it("serves the blog index and single-segment article slugs", () => {
    const records = livePair();
    expect(
      decideCustomerHostRoute({
        hostname: "example.com",
        pathname: "/blog",
        records,
      }),
    ).toEqual({
      kind: "blog",
      slug: "chez-lea",
      versionId: "version_1",
      articleSlug: null,
    });
    expect(
      decideCustomerHostRoute({
        hostname: "example.com",
        pathname: "/blog/seasonal-menu-update",
        records,
      }),
    ).toEqual({
      kind: "blog",
      slug: "chez-lea",
      versionId: "version_1",
      articleSlug: "seasonal-menu-update",
    });
  });

  it("serves only the four literal customer discovery resources", () => {
    const records = livePair();
    for (const [pathname, kind] of [
      ["/robots.txt", "robots"],
      ["/sitemap.xml", "root_sitemap"],
      ["/blog/sitemap.xml", "blog_sitemap"],
      ["/blog/rss.xml", "rss"],
    ] as const) {
      expect(
        decideCustomerHostRoute({
          hostname: "example.com",
          pathname,
          records,
        }),
      ).toEqual({
        kind,
        slug: "chez-lea",
        versionId: "version_1",
      });
    }
  });

  it("permanently canonicalizes a verified www alias", () => {
    expect(
      decideCustomerHostRoute({
        hostname: "www.example.com",
        pathname: "/fr",
        records: livePair(),
      }),
    ).toEqual({
      kind: "redirect",
      canonicalHostname: "example.com",
    });
  });

  it("rejects unknown, unverified, paused and invalid snapshots", () => {
    const base = livePair()[0];
    for (const record of [
      { ...base, verified: false },
      { ...base, site: { ...base.site, status: "PAUSED" as const } },
      {
        ...base,
        site: {
          ...base.site,
          publishedSiteVersion: {
            ...base.site.publishedSiteVersion!,
            siteId: "site_other",
          },
        },
      },
      {
        ...base,
        site: {
          ...base.site,
          publishedSiteVersion: {
            ...base.site.publishedSiteVersion!,
            publishedAt: null,
          },
        },
      },
    ]) {
      expect(
        decideCustomerHostRoute({
          hostname: "example.com",
          pathname: "/",
          records: [record],
        }),
      ).toEqual({ kind: "not_found" });
    }
  });
});

describe("site domain lifecycle", () => {
  it("requires both a verified domain and a valid snapshot for LIVE", () => {
    expect(
      siteStatusForDomainState({
        currentStatus: "CLAIMED",
        hasVerifiedDomain: true,
        hasValidPublishedVersion: true,
      }),
    ).toBe("LIVE");
    expect(
      siteStatusForDomainState({
        currentStatus: "LIVE",
        hasVerifiedDomain: false,
        hasValidPublishedVersion: true,
      }),
    ).toBe("CLAIMED");
    expect(
      siteStatusForDomainState({
        currentStatus: "LIVE",
        hasVerifiedDomain: true,
        hasValidPublishedVersion: false,
      }),
    ).toBe("CLAIMED");
  });

  it("never bypasses a pause or changes pre-claim states", () => {
    expect(
      siteStatusForDomainState({
        currentStatus: "PAUSED",
        hasVerifiedDomain: true,
        hasValidPublishedVersion: true,
      }),
    ).toBe("PAUSED");
    expect(
      siteStatusForDomainState({
        currentStatus: "PREVIEW_READY",
        hasVerifiedDomain: true,
        hasValidPublishedVersion: true,
      }),
    ).toBe("PREVIEW_READY");
  });
});

describe("platform subdomain isolation", () => {
  it("serves claimed published sites on the niche subdomain", () => {
    expect(
      decidePlatformSubdomainRoute({
        hostname: "chez-lea.restofront.com",
        pathname: "/",
        site: claimedSite(),
      }),
    ).toEqual({
      kind: "page",
      slug: "chez-lea",
      versionId: "version_1",
      locale: null,
    });
    expect(
      decidePlatformSubdomainRoute({
        hostname: "chez-lea.restofront.com",
        pathname: "/",
        site: claimedSite({ status: "LIVE" }),
      }).kind,
    ).toBe("page");
    expect(
      decidePlatformSubdomainRoute({
        hostname: "chez-lea.restofront.com",
        pathname: "/FR-ca",
        site: claimedSite(),
      }),
    ).toEqual({
      kind: "page",
      slug: "chez-lea",
      versionId: "version_1",
      locale: "fr-CA",
    });
    expect(
      decidePlatformSubdomainRoute({
        hostname: "chez-lea.restofront.com",
        pathname: "/api/analytics/events",
        site: claimedSite(),
      }).kind,
    ).toBe("public_api");
    expect(
      decidePlatformSubdomainRoute({
        hostname: "chez-lea.restofront.com",
        pathname: "/preview/chez-lea/opengraph-image",
        site: claimedSite(),
      }),
    ).toEqual({
      kind: "opengraph",
      slug: "chez-lea",
      versionId: "version_1",
    });
  });

  it("blocks owner and operator paths on the platform subdomain", () => {
    for (const pathname of [
      "/dashboard",
      "/admin",
      "/sign-in",
      "/create",
      "/claim",
      "/menu",
      "/preview/chez-lea",
      "/api/admin",
      "/api/domains",
      "/api/sites/another/booking-requests",
      "/robots.txt/extra",
      "/sitemap.xml.bak",
      "/foo/sitemap.xml",
      "/blog/robots.txt",
      "/blog/rss.xml/extra",
      "/blog/sitemap.xml/extra",
      "/preview/chez-lea/blog/rss.xml",
    ]) {
      expect(
        decidePlatformSubdomainRoute({
          hostname: "chez-lea.restofront.com",
          pathname,
          site: claimedSite(),
        }),
      ).toEqual({ kind: "not_found" });
    }
  });

  it("serves discovery resources on a published platform subdomain", () => {
    for (const [pathname, kind] of [
      ["/robots.txt", "robots"],
      ["/sitemap.xml", "root_sitemap"],
      ["/blog/sitemap.xml", "blog_sitemap"],
      ["/blog/rss.xml", "rss"],
    ] as const) {
      expect(
        decidePlatformSubdomainRoute({
          hostname: "chez-lea.restofront.com",
          pathname,
          site: claimedSite(),
        }),
      ).toEqual({
        kind,
        slug: "chez-lea",
        versionId: "version_1",
      });
    }
  });

  it("404s unpublished, prospect, paused, and unknown slugs", () => {
    expect(
      decidePlatformSubdomainRoute({
        hostname: "chez-lea.restofront.com",
        pathname: "/",
        site: claimedSite({ slug: "someone-else" }),
      }),
    ).toEqual({ kind: "not_found" });
    expect(
      decidePlatformSubdomainRoute({
        hostname: "chez-lea.restofront.com",
        pathname: "/",
        site: null,
      }),
    ).toEqual({ kind: "not_found" });
    expect(
      decidePlatformSubdomainRoute({
        hostname: "chez-lea.restofront.com",
        pathname: "/",
        site: claimedSite({
          status: "PROSPECT",
          publishedSiteVersionId: null,
          publishedSiteVersion: null,
        }),
      }),
    ).toEqual({ kind: "not_found" });
    expect(
      decidePlatformSubdomainRoute({
        hostname: "chez-lea.restofront.com",
        pathname: "/",
        site: claimedSite({ status: "PREVIEW_READY" }),
      }),
    ).toEqual({ kind: "not_found" });
    expect(
      decidePlatformSubdomainRoute({
        hostname: "chez-lea.restofront.com",
        pathname: "/",
        site: claimedSite({ status: "PAUSED" }),
      }),
    ).toEqual({ kind: "not_found" });
  });

  it("redirects the platform subdomain to a verified custom domain", () => {
    expect(
      decidePlatformSubdomainRoute({
        hostname: "chez-lea.restofront.com",
        pathname: "/fr",
        site: claimedSite({
          status: "LIVE",
          verifiedDomains: [
            { hostname: "example.com", verified: true },
            { hostname: "www.example.com", verified: true },
          ],
        }),
      }),
    ).toEqual({
      kind: "redirect",
      canonicalHostname: "example.com",
    });
  });

  it("prefers the platform subdomain until a custom domain is verified", () => {
    expect(
      publicSiteOrigin({ slug: "chez-lea", vertical: "RESTAURANT" }),
    ).toBe("https://chez-lea.restofront.com");
    expect(
      publicSiteOrigin({
        slug: "chez-lea",
        vertical: "RESTAURANT",
        verifiedHostname: "www.example.com",
      }),
    ).toBe("https://example.com");
    expect(
      publicSiteUrl({
        slug: "chez-lea",
        vertical: "RESTAURANT",
        pathname: "/fr",
      }),
    ).toBe("https://chez-lea.restofront.com/fr");
    expect(
      canonicalVerifiedCustomHostname([
        { hostname: "www.example.com", verified: true },
        { hostname: "example.com", verified: true },
      ]),
    ).toBe("example.com");
  });
});

function claimedSite(
  overrides: Partial<PlatformSubdomainSite> = {},
): PlatformSubdomainSite {
  return {
    id: "site_1",
    slug: "chez-lea",
    status: "CLAIMED",
    publishedSiteVersionId: "version_1",
    publishedSiteVersion: {
      id: "version_1",
      siteId: "site_1",
      publishedAt: new Date("2026-07-27T00:00:00.000Z"),
    },
    verifiedDomains: [],
    ...overrides,
  };
}

function livePair(): PublishedDomainRecord[] {
  const site = {
    id: "site_1",
    slug: "chez-lea",
    status: "LIVE" as const,
    publishedSiteVersionId: "version_1",
    publishedSiteVersion: {
      id: "version_1",
      siteId: "site_1",
      publishedAt: new Date("2026-07-27T00:00:00.000Z"),
    },
  };
  return [
    { hostname: "example.com", verified: true, site },
    { hostname: "www.example.com", verified: true, site },
  ];
}
