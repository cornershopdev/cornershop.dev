import { describe, expect, it } from "bun:test";
import {
  clearDomainLookupCache,
  getCachedDomainRecords,
  getCachedPlatformSite,
  invalidatePlatformSiteSlug,
  setCachedDomainRecords,
  setCachedPlatformSite,
} from "@/lib/domain-lookup-cache";
import type {
  PlatformSubdomainSite,
  PublishedDomainRecord,
} from "@/lib/domain-routing";

const sample: PublishedDomainRecord[] = [
  {
    hostname: "example.com",
    verified: true,
    site: {
      id: "site_1",
      slug: "example",
      status: "LIVE",
      publishedSiteVersionId: "ver_1",
      publishedSiteVersion: {
        id: "ver_1",
        siteId: "site_1",
        publishedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    },
  },
];

const platformSite: PlatformSubdomainSite = {
  ...sample[0]!.site,
  verifiedDomains: [{ hostname: "example.com", verified: true }],
};

describe("domain lookup cache", () => {
  it("stores and returns records for a hostname set", () => {
    clearDomainLookupCache();
    setCachedDomainRecords(["www.example.com", "example.com"], sample);
    expect(
      getCachedDomainRecords(["example.com", "www.example.com"]),
    ).toEqual(sample);
  });

  it("expires entries after ttl", async () => {
    clearDomainLookupCache();
    setCachedDomainRecords(["short.example"], sample, 5);
    expect(getCachedDomainRecords(["short.example"])).toEqual(sample);
    await Bun.sleep(15);
    expect(getCachedDomainRecords(["short.example"])).toBeNull();
  });

  it("stores, expires, and invalidates platform sites by slug", async () => {
    clearDomainLookupCache();
    setCachedPlatformSite("example", platformSite, 5);
    expect(getCachedPlatformSite("example")).toEqual(platformSite);
    await Bun.sleep(15);
    expect(getCachedPlatformSite("example")).toBeUndefined();

    setCachedPlatformSite("example", platformSite);
    invalidatePlatformSiteSlug("example");
    expect(getCachedPlatformSite("example")).toBeUndefined();
  });

  it("caches missing platform sites", () => {
    clearDomainLookupCache();
    setCachedPlatformSite("missing", null);
    expect(getCachedPlatformSite("missing")).toBeNull();
  });

  // Regression: a request that arrives while a site is still unpublished must
  // not pin the pre-publish row, or the owner's own subdomain keeps 404ing for
  // the whole TTL after they hit Publish.
  it("refuses to cache a platform site that is not publicly serving", () => {
    clearDomainLookupCache();
    setCachedPlatformSite("example", {
      ...platformSite,
      status: "CLAIMED",
      publishedSiteVersionId: null,
      publishedSiteVersion: null,
    });
    expect(getCachedPlatformSite("example")).toBeUndefined();
  });

  it("refuses to cache domain records whose site is not publicly serving", () => {
    clearDomainLookupCache();
    setCachedDomainRecords(
      ["pending.example"],
      [
        {
          ...sample[0]!,
          hostname: "pending.example",
          site: {
            ...sample[0]!.site,
            status: "CLAIMED",
            publishedSiteVersionId: null,
            publishedSiteVersion: null,
          },
        },
      ],
    );
    expect(getCachedDomainRecords(["pending.example"])).toBeNull();
  });

  it("still caches an unknown hostname as an empty result", () => {
    clearDomainLookupCache();
    setCachedDomainRecords(["unknown.example"], []);
    expect(getCachedDomainRecords(["unknown.example"])).toEqual([]);
  });
});
