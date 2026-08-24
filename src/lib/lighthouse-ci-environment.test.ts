import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "../..");
const require = createRequire(import.meta.url);

type LighthouseConfig = {
  ci: {
    collect: { numberOfRuns: number };
    assert: {
      aggregationMethod?: string;
      assertions: Record<string, [string, Record<string, number>]>;
    };
  };
};

type PackageManifest = {
  scripts: Record<string, string>;
};

describe("Lighthouse CI environment", () => {
  it("uses the local Workflow world instead of inheriting Postgres", async () => {
    const workflow = await readFile(
      path.join(repoRoot, ".github/workflows/ci.yml"),
      "utf8",
    );

    expect(workflow).toContain(`
      - name: Lighthouse budgets
        env:
          WORKFLOW_TARGET_WORLD: "local"
        run: bun run lighthouse
`);
  });

  it("asserts the median run and retains hidden Lighthouse reports", async () => {
    const config = require(
      path.join(repoRoot, "lighthouserc.cjs"),
    ) as LighthouseConfig;
    const workflow = await readFile(
      path.join(repoRoot, ".github/workflows/ci.yml"),
      "utf8",
    );

    expect(config.ci.collect.numberOfRuns).toBe(3);
    expect(config.ci.assert.aggregationMethod).toBe("median");
    expect(config.ci.assert.assertions["categories:performance"]).toEqual([
      "error",
      { minScore: 0.9 },
    ]);
    expect(config.ci.assert.assertions["largest-contentful-paint"]).toEqual([
      "error",
      { maxNumericValue: 3800 },
    ]);
    expect(config.ci.assert.assertions["cumulative-layout-shift"]).toEqual([
      "error",
      { maxNumericValue: 0.1 },
    ]);
    expect(workflow).toContain("          include-hidden-files: true\n");
  });

  it("keeps multi-run budgets and machine-readable reports without LHCI", async () => {
    const [runner, browserResolver, fontAudit, packageManifest, workflow] =
      await Promise.all([
        readFile(path.join(repoRoot, "scripts/run-lighthouse.mjs"), "utf8"),
        readFile(path.join(repoRoot, "scripts/browser-path.mjs"), "utf8"),
        readFile(path.join(repoRoot, "scripts/verify-brand-fonts.mjs"), "utf8"),
        readFile(path.join(repoRoot, "package.json"), "utf8"),
        readFile(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8"),
      ]);
    const packageJson = JSON.parse(packageManifest) as PackageManifest;

    expect(packageJson.scripts.lighthouse).toBe(
      "node scripts/run-lighthouse.mjs",
    );
    expect(runner).toContain('import lighthouse from "lighthouse";');
    expect(runner).toContain(
      "for (let run = 1; run <= collect.numberOfRuns; run += 1)",
    );
    expect(runner).toContain("const maxCollectionAttempts = 3;");
    expect(runner).toContain('aggregationMethod: "median"');
    expect(runner).toContain("Math.floor(sorted.length / 2)");
    expect(runner).toContain('const jsonFile = `${basename}.report.json`;');
    expect(runner).toContain('const htmlFile = `${basename}.report.html`;');
    expect(runner).toContain('path.join(outputDir, "manifest.json")');
    expect(runner).toContain('path.join(outputDir, "assertion-results.json")');
    expect(runner).toContain("isRepresentativeRun:");
    expect(runner).toContain("summary: report.summary");
    expect(runner).toContain('manifest.status = failure ? "failed" : "passed";');
    expect(runner).toContain("if (chrome) await chrome.kill();");
    expect(runner).toContain("await stopServer(server, runtime);");
    expect(browserResolver.indexOf("Brave Browser")).toBeLessThan(
      browserResolver.indexOf("google-chrome"),
    );
    expect(fontAudit).toContain(
      'import { browserPath } from "./browser-path.mjs";',
    );
    expect(workflow.match(/node-version: "24\.19\.0"/g)).toHaveLength(2);
  });

  it("keeps brand fonts route-scoped instead of globally preloading them", async () => {
    const [
      layout,
      globalStyles,
      homepage,
      factoryFonts,
      nicheFonts,
      authFonts,
      editorialFonts,
      fullBrandFonts,
      siteHeader,
      mobileNav,
      transformation,
    ] = await Promise.all([
      readFile(path.join(repoRoot, "src/app/layout.tsx"), "utf8"),
      readFile(path.join(repoRoot, "src/app/globals.css"), "utf8"),
      readFile(path.join(repoRoot, "src/app/page.tsx"), "utf8"),
      readFile(
        path.join(repoRoot, "src/components/fonts/factory-font-scope.tsx"),
        "utf8",
      ),
      readFile(
        path.join(repoRoot, "src/components/fonts/niche-font-scope.tsx"),
        "utf8",
      ),
      readFile(
        path.join(repoRoot, "src/components/fonts/auth-font-scope.tsx"),
        "utf8",
      ),
      readFile(
        path.join(repoRoot, "src/components/fonts/editorial-font-scope.tsx"),
        "utf8",
      ),
      readFile(
        path.join(repoRoot, "src/components/fonts/full-brand-font-scope.tsx"),
        "utf8",
      ),
      readFile(path.join(repoRoot, "src/components/site-header.tsx"), "utf8"),
      readFile(
        path.join(repoRoot, "src/components/site-header-mobile-nav.tsx"),
        "utf8",
      ),
      readFile(
        path.join(repoRoot, "src/components/homepage-transformation.tsx"),
        "utf8",
      ),
    ]);

    expect(layout).not.toContain('from "next/font/');
    expect(layout).not.toContain("brand-fonts-loaded");
    expect(homepage).toContain("factoryFontVariables");
    expect(factoryFonts.match(/preload: true/g)).toHaveLength(2);
    expect(nicheFonts.match(/preload: true/g)).toHaveLength(2);
    expect(nicheFonts.match(/preload: false/g)).toHaveLength(1);
    expect(authFonts.match(/preload: true/g)).toHaveLength(2);
    expect(editorialFonts.match(/preload: true/g)).toHaveLength(2);
    expect(editorialFonts.match(/preload: false/g)).toHaveLength(1);
    expect(fullBrandFonts.match(/preload: true/g)).toHaveLength(3);
    for (const scope of [
      factoryFonts,
      nicheFonts,
      authFonts,
      editorialFonts,
      fullBrandFonts,
    ]) {
      expect(scope).toContain('from "next/font/google"');
      expect(scope).toContain('display: "swap"');
      expect(scope).not.toContain('display: "optional"');
      expect(scope).toContain("font-sans");
    }
    for (const monoScope of [
      factoryFonts,
      nicheFonts,
      editorialFonts,
      fullBrandFonts,
    ]) {
      expect(monoScope).toContain("adjustFontFallback: false");
      expect(monoScope).toContain(
        'fallback: ["ui-monospace", "monospace"]',
      );
    }
    expect(factoryFonts).toContain("geistSans.variable");
    expect(factoryFonts).toContain("geistMono.variable");
    expect(factoryFonts).not.toContain("Instrument_Serif");
    expect(nicheFonts).toContain("geistSans.variable");
    expect(nicheFonts).toContain("geistMono.variable");
    expect(nicheFonts).toContain("instrumentSerif.variable");
    expect(nicheFonts).toContain("restaurant-fonts");
    expect(nicheFonts).toContain("vertical === Vertical.RESTAURANT");
    expect(editorialFonts).toContain("geistMono.variable");
    expect(editorialFonts).toContain("instrumentSerif.variable");
    expect(fullBrandFonts).toContain("geistMono.variable");
    expect(fullBrandFonts).toContain("instrumentSerif.variable");
    expect(siteHeader).toContain("fontVariables={fontVariables}");
    expect(siteHeader).toContain("prefetch={false}");
    expect(siteHeader).toContain("prefetch={link.prefetch}");
    expect(mobileNav).toContain("fontVariables,");
    expect(mobileNav).toContain('"font-sans text-left"');
    expect(globalStyles).toContain(
      "--font-heading: var(--font-instrument-serif, georgia, serif);",
    );
    expect(globalStyles).toContain(
      "font-family: var(--font-instrument-serif, georgia, serif);",
    );
    expect(globalStyles).toContain(
      "--font-geist-mono: var(--font-geist-sans) !important;",
    );
    expect(globalStyles).toContain(
      'src: local("Arial"), local("Liberation Sans");',
    );
    expect(globalStyles).toContain(
      'src: local("Times New Roman"), local("Liberation Serif");',
    );
    for (const geistScope of [
      factoryFonts,
      nicheFonts,
      authFonts,
      editorialFonts,
      fullBrandFonts,
    ]) {
      expect(geistScope).toContain("stable-geist-fallback");
    }
    for (const serifScope of [
      nicheFonts,
      authFonts,
      editorialFonts,
      fullBrandFonts,
    ]) {
      expect(serifScope).toContain("stable-instrument-fallback");
    }
    expect(transformation).toContain(
      '"/marketing/restaurant-transformation.webp"',
    );
  });

  it("covers customer and authenticated surfaces with a brand font scope", async () => {
    const editorialRoutes = [
      "admin",
      "claim",
      "create",
      "workspace",
    ];
    const fullBrandRoutes = [
      "preview",
      "themes/restaurant",
      "dashboard/themes/[themeId]",
    ];

    for (const route of editorialRoutes) {
      const layout = await readFile(
        path.join(repoRoot, "src/app", route, "layout.tsx"),
        "utf8",
      );
      expect(layout).toContain("<EditorialFontScope>");
    }
    const nicheLayout = await readFile(
      path.join(repoRoot, "src/app/niche/[vertical]/layout.tsx"),
      "utf8",
    );
    expect(nicheLayout).toContain("<NicheFontScope");
    expect(nicheLayout).toContain("vertical={id}");
    const authLayout = await readFile(
      path.join(repoRoot, "src/app/sign-in/layout.tsx"),
      "utf8",
    );
    expect(authLayout).toContain("<AuthFontScope>");
    for (const route of fullBrandRoutes) {
      const layout = await readFile(
        path.join(repoRoot, "src/app", route, "layout.tsx"),
        "utf8",
      );
      expect(layout).toContain("<FullBrandFontScope>");
    }
    const dashboard = await readFile(
      path.join(repoRoot, "src/app/dashboard/page.tsx"),
      "utf8",
    );
    expect(dashboard).toContain("<EditorialFontScope>");
  });

  it("runs a cold-cache physical-font and no-reflow browser contract", async () => {
    const [workflow, audit, packageJson, nichePage] = await Promise.all([
      readFile(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8"),
      readFile(path.join(repoRoot, "scripts/verify-brand-fonts.mjs"), "utf8"),
      readFile(path.join(repoRoot, "package.json"), "utf8"),
      readFile(
        path.join(repoRoot, "src/app/niche/[vertical]/page.tsx"),
        "utf8",
      ),
    ]);

    expect(workflow).toContain("run: bun run verify:brand-fonts");
    expect(audit).toContain('session.send("CSS.getPlatformFontsForNode"');
    expect(audit).toContain('cacheDisabled: true');
    expect(audit).toContain('rate: 4');
    expect(audit).toContain('request.timestamp <= firstContentfulPaint');
    expect(audit).toContain('fontRequests.length === audit.requestCount');
    expect(audit).toContain('[aria-label="Open navigation"]');
    expect(audit).toContain('finalRect[key] === initialRect[key]');
    expect(audit).toContain(
      'finalRect.lineCount === initialRect.lineCount',
    );
    expect(audit).toContain(
      'cumulativeLayoutShift <= maxFontSwapLayoutShift',
    );
    const fontSwapCeiling = Number(
      audit.match(/maxFontSwapLayoutShift = ([\d.]+);/)?.[1],
    );
    expect(fontSwapCeiling).toBe(0.01);
    expect(0.116786).toBeGreaterThan(fontSwapCeiling);
    expect(audit).toContain('path: "/niche/restaurant"');
    expect(audit).not.toContain('path: "/niche/beauty"');
    expect(audit).toContain('path: "/themes/restaurant/terroir-editorial"');
    expect(audit).toContain('path: "/sign-in"');
    expect(audit).toContain(
      'Bun.spawn(["node", ".next/standalone/server.js"]',
    );
    expect(packageJson).toContain("node .next/standalone/server.js");
    expect(nichePage).toContain('href="#themes"');
    expect(nichePage).toContain(
      'href={marketing.themeGallery.href}\n                    prefetch={false}',
    );
  });
});
