import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  FACTORY_ANALYTICS_DEFAULT_HOST,
  factoryAnalyticsSnippet,
  resolveFactoryAnalytics,
} from "@/lib/factory-analytics";

/**
 * The public factory funnel. Every surface here is ours; none of them is served
 * on a customer's domain.
 */
const INSTRUMENTED_SURFACES = [
  "src/app/page.tsx",
  "src/app/create/layout.tsx",
  "src/app/claim/layout.tsx",
  "src/app/sign-in/layout.tsx",
  "src/app/niche/[vertical]/layout.tsx",
  "src/app/themes/layout.tsx",
];

/**
 * Storefronts and owner surfaces. `proxy.ts` rewrites verified custom domains
 * onto `/preview`, so a mount added here would publish a third-party script on
 * someone else's domain.
 */
const UNINSTRUMENTED_SURFACES = [
  "src/app/layout.tsx",
  "src/app/preview/layout.tsx",
  "src/app/pro/layout.tsx",
  "src/app/dashboard/page.tsx",
  "src/app/workspace/layout.tsx",
  "src/app/admin/layout.tsx",
];

async function surfaceSource(path: string): Promise<string> {
  return readFile(new URL(`../../${path}`, import.meta.url), "utf8");
}

describe("factory analytics configuration", () => {
  it("no-ops when the project key is absent, blank, or whitespace", () => {
    expect(resolveFactoryAnalytics({})).toBeNull();
    expect(resolveFactoryAnalytics({ NEXT_PUBLIC_POSTHOG_KEY: "" })).toBeNull();
    expect(
      resolveFactoryAnalytics({ NEXT_PUBLIC_POSTHOG_KEY: "   " }),
    ).toBeNull();
    expect(
      resolveFactoryAnalytics({
        NEXT_PUBLIC_POSTHOG_HOST: "https://eu.i.posthog.com",
      }),
    ).toBeNull();
  });

  it("falls back to the European ingestion host and its asset origin", () => {
    expect(
      resolveFactoryAnalytics({ NEXT_PUBLIC_POSTHOG_KEY: " phc_example " }),
    ).toEqual({
      projectKey: "phc_example",
      apiHost: FACTORY_ANALYTICS_DEFAULT_HOST,
      assetHost: "https://eu-assets.i.posthog.com",
    });
  });

  it("keeps a reverse-proxy host verbatim and trims its trailing slash", () => {
    expect(
      resolveFactoryAnalytics({
        NEXT_PUBLIC_POSTHOG_KEY: "phc_example",
        NEXT_PUBLIC_POSTHOG_HOST: "https://cornershop.dev/ingest/",
      }),
    ).toEqual({
      projectKey: "phc_example",
      apiHost: "https://cornershop.dev/ingest",
      assetHost: "https://cornershop.dev/ingest",
    });
  });

  it("fails closed on a host that is not plain https", () => {
    for (const host of [
      "http://eu.i.posthog.com",
      "eu.i.posthog.com",
      "javascript:alert(1)",
      "https://eu.i.posthog.com?token=leak",
    ]) {
      expect(
        resolveFactoryAnalytics({
          NEXT_PUBLIC_POSTHOG_KEY: "phc_example",
          NEXT_PUBLIC_POSTHOG_HOST: host,
        }),
      ).toBeNull();
    }
  });
});

describe("factory analytics snippet", () => {
  const config = resolveFactoryAnalytics({
    NEXT_PUBLIC_POSTHOG_KEY: "phc_example",
  });

  it("loads the vendor bundle and initialises it once it has arrived", () => {
    expect(config).not.toBeNull();
    const snippet = factoryAnalyticsSnippet(config!);

    expect(snippet).toContain(
      '"https://eu-assets.i.posthog.com/static/array.js"',
    );
    expect(snippet).toContain("s.onload=function()");
    expect(snippet).toContain('window.posthog.init("phc_example"');
    expect(snippet).toContain('"capture_pageview":"history_change"');
  });

  it("emits no character that could close the inline script element", () => {
    const escaped = factoryAnalyticsSnippet({
      projectKey: '</script><img src=x onerror=alert(1)>',
      apiHost: "https://eu.i.posthog.com",
      assetHost: "https://eu-assets.i.posthog.com",
    });

    expect(escaped).not.toContain("<");
    expect(escaped).toContain("\\u003c/script");
  });
});

describe("factory analytics mount points", () => {
  it("instruments every public factory funnel surface", async () => {
    for (const path of INSTRUMENTED_SURFACES) {
      const source = await surfaceSource(path);
      expect(source).toContain(
        'from "@/components/factory-analytics"',
      );
      expect(source).toContain("<FactoryAnalytics />");
    }
  });

  it("keeps the pixel off storefront and owner surfaces", async () => {
    for (const path of UNINSTRUMENTED_SURFACES) {
      expect(await surfaceSource(path)).not.toContain("FactoryAnalytics");
    }
  });
});
