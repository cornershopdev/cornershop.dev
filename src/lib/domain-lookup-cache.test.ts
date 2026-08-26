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
});
