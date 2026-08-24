import { describe, expect, it } from "bun:test";
import {
  LIVE_SITE_ORIGIN_HEADER,
  LIVE_SITE_SLUG_HEADER,
  LIVE_SITE_VERSION_HEADER,
  canonicalSiteLocale,
  liveSiteContext,
  liveSiteCanonicalPath,
  PUBLIC_SITE_VERSION_HEADER,
  previewCacheTagFor,
} from "@/lib/site-surface";

describe("previewCacheTagFor", () => {
  it("canonicalizes language and regional locale segments", () => {
    expect(canonicalSiteLocale("EN")).toBe("en");
    expect(canonicalSiteLocale("fr-ca")).toBe("fr-CA");
    expect(canonicalSiteLocale("FR-CA")).toBe("fr-CA");
    expect(canonicalSiteLocale("french")).toBeNull();
    expect(canonicalSiteLocale("fr-CA-extra")).toBeNull();
  });

  it("derives a stable tag from the slug", () => {
    expect(previewCacheTagFor("le-petit-meunier")).toBe(
      "preview-site:le-petit-meunier",
    );
  });

  it("keys the tag on the slug alone so a republish invalidates it", () => {
    // A rollback or republish changes which SiteVersion is current for a
    // slug; the cache tag must not embed a version id or the previous
    // version's cache entry would never be invalidated.
    expect(previewCacheTagFor("cafe-du-coin")).toBe(
      "preview-site:cafe-du-coin",
    );
  });

  it("keeps distinct slugs on distinct tags", () => {
    expect(previewCacheTagFor("site-a")).not.toBe(previewCacheTagFor("site-b"));
  });

  it("builds absolute live canonicals on the public origin", () => {
    expect(
      liveSiteCanonicalPath("https://chez-lea.restofront.com", "en", "en"),
    ).toBe("https://chez-lea.restofront.com/");
    expect(
      liveSiteCanonicalPath("https://chez-lea.restofront.com", "fr", "en"),
    ).toBe("https://chez-lea.restofront.com/fr");
  });

  it("uses a non-secret response header for live version evidence", () => {
    expect(PUBLIC_SITE_VERSION_HEADER).toBe("x-cornershop-site-version");
  });

  it("reads a complete proxy-attested customer origin", () => {
    const requestHeaders = new Headers({
      [LIVE_SITE_SLUG_HEADER]: "chez-lea",
      [LIVE_SITE_VERSION_HEADER]: "version_1",
      [LIVE_SITE_ORIGIN_HEADER]: "https://chez-lea.restofront.com",
    });
    expect(liveSiteContext(requestHeaders)).toEqual({
      slug: "chez-lea",
      versionId: "version_1",
      origin: "https://chez-lea.restofront.com",
    });
  });

  it("rejects incomplete or non-canonical origin attestations", () => {
    for (const origin of [
      "",
      "http://chez-lea.example",
      "https://chez-lea.example:8443",
      "https://chez-lea.example/private",
      "https://user@chez-lea.example",
      "https://chez-lea.example?spoofed=1",
    ]) {
      expect(
        liveSiteContext(
          new Headers({
            [LIVE_SITE_SLUG_HEADER]: "chez-lea",
            [LIVE_SITE_VERSION_HEADER]: "version_1",
            [LIVE_SITE_ORIGIN_HEADER]: origin,
          }),
        ),
      ).toBeNull();
    }
    expect(
      liveSiteContext(
        new Headers({
          [LIVE_SITE_SLUG_HEADER]: "chez-lea",
          [LIVE_SITE_ORIGIN_HEADER]: "https://chez-lea.example",
        }),
      ),
    ).toBeNull();
  });
});
