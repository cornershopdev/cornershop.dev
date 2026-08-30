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
    expect(snippet).toContain("window.__factoryAnalyticsQueue");
  });

  it("queues a privacy-bounded initial event until PostHog is ready", () => {
    expect(config).not.toBeNull();
    const snippet = factoryAnalyticsSnippet(config!, {
      name: "preview_view",
      properties: { slug: "sample-preview", vertical: "RESTAURANT" },
    });

    expect(snippet).toContain('"name":"preview_view"');
    expect(snippet).toContain('"slug":"sample-preview"');
    expect(snippet).toContain('"vertical":"RESTAURANT"');
    expect(snippet).not.toContain("email");
    expect(snippet).not.toContain("token");
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

  it("instruments factory previews without mounting analytics in their layout", async () => {
    for (const path of [
      "src/app/preview/[slug]/page.tsx",
      "src/app/preview/[slug]/[locale]/page.tsx",
    ]) {
      const source = await surfaceSource(path);
      expect(source).toContain("<FactoryAnalytics");
      expect(source).toContain('name: "preview_view"');
      expect(source).toContain("!isLiveSurface");
    }
    expect(await surfaceSource("src/app/preview/layout.tsx")).not.toContain(
      "FactoryAnalytics",
    );
  });

  it("captures checkout milestones without passing contact or claim data", async () => {
    const source = await surfaceSource(
      "src/app/claim/[slug]/claim-panel.tsx",
    );
    expect(source).toContain('name: "checkout_started"');
    expect(source).toContain('name: "checkout_completed"');
    expect(source).toContain("{ slug, vertical, plan: offer.planId }");
    expect(source).not.toContain("properties: { email");
    expect(source).not.toContain("properties: { invitationToken");
  });

  it("reads analytics configuration from the running container", async () => {
    const source = await surfaceSource("src/components/factory-analytics.tsx");
    expect(source).toContain("const runtimeEnvironment = process.env");
    expect(source).not.toContain(
      "process.env.NEXT_PUBLIC_POSTHOG_KEY",
    );
    expect(source).not.toContain(
      "process.env.NEXT_PUBLIC_POSTHOG_HOST",
    );
    expect(source).toContain("isFactoryHostname(requestHostname(requestHeaders))");
  });
});
