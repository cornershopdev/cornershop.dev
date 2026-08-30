import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SiteRenderer } from "@/components/site-renderer";
import { Vertical } from "@/generated/prisma/enums";
import { registeredSiteTheme, themeAdapterFor } from "@/lib/site-themes/adapters";
import {
  LOCAL_SERVICE_THEME_RENDERER_VERSION,
  localServiceDesignProfileSchema,
  localServiceThemeIdSchema,
} from "@/lib/site-themes/local-service/contracts";
import {
  findLocalServiceThemeManifest,
  getLocalServiceThemeManifest,
  listFeaturedLocalServiceThemeManifests,
  listLocalServiceThemeManifests,
} from "@/lib/site-themes/local-service/registry";
import {
  localServiceThemeOptions,
  parseLocalServiceThemeSelection,
  previewLocalServiceThemeAlternate,
  restoreAutomaticLocalServiceTheme,
  scoreLocalServiceThemes,
  selectDeterministicLocalServiceTheme,
  selectLocalServiceTheme,
  selectOwnerLocalServiceTheme,
} from "@/lib/site-themes/local-service/selection";
import { mergeLocalServiceThemeTokens } from "@/lib/site-themes/local-service/tokens";
import {
  colorContrast,
  MIN_TEXT_CONTRAST,
} from "@/lib/site-themes/shared/color";
import { resolvePreviewThemeAlternates } from "@/lib/preview-theme-alternates";
import { sampleLocalServiceSiteDraft } from "@/lib/verticals/local-service/fixtures";
import { localServiceTemplates } from "@/lib/verticals/local-service/templates";

const calloutTrade = localServiceDesignProfileSchema.parse({
  engagementModel: "callout",
  primaryIntent: "contact",
  catalogExperience: "service-list",
  brandTraits: ["technical", "bold"],
  locationCount: 2,
  photographyQuality: "none",
});

const establishedTrade = localServiceDesignProfileSchema.parse({
  engagementModel: "scheduled",
  primaryIntent: "quote",
  catalogExperience: "proof-led",
  brandTraits: ["trusted", "established"],
  locationCount: 3,
  photographyQuality: "limited",
});

const visualCraft = localServiceDesignProfileSchema.parse({
  engagementModel: "project",
  primaryIntent: "browse",
  catalogExperience: "portfolio",
  brandTraits: ["craft", "minimal"],
  locationCount: 1,
  photographyQuality: "strong",
});

describe("local-service theme registry", () => {
  it("publishes three complete themes in featured order", () => {
    const manifests = listLocalServiceThemeManifests();
    expect(manifests.map(({ id }) => id)).toEqual([
      "direct-response",
      "trusted-local",
      "project-led",
    ]);
    expect(listFeaturedLocalServiceThemeManifests().map(({ id }) => id)).toEqual(
      ["direct-response", "trusted-local", "project-led"],
    );

    for (const manifest of manifests) {
      expect(localServiceThemeIdSchema.parse(manifest.id)).toBe(manifest.id);
      expect(manifest.rendererVersion).toBe(
        LOCAL_SERVICE_THEME_RENDERER_VERSION,
      );
      expect(manifest.bestFor.length).toBeGreaterThan(0);
      expect(manifest.avoidWhen.length).toBeGreaterThan(0);
      expect(manifest.marketReferences.length).toBeGreaterThan(0);
      expect(manifest.aiBrief.length).toBeGreaterThan(20);
      expect(localServiceTemplates[manifest.id].id).toBe(manifest.id);
    }
  });

  it("does not resolve inherited object properties as manifests", () => {
    expect(findLocalServiceThemeManifest("__proto__")).toBeNull();
    expect(findLocalServiceThemeManifest("constructor")).toBeNull();
  });
});

describe("bounded local-service theme selection", () => {
  it("separates direct, trust-led and project-led businesses", () => {
    expect(scoreLocalServiceThemes(calloutTrade)[0].manifest.id).toBe(
      "direct-response",
    );
    expect(scoreLocalServiceThemes(establishedTrade)[0].manifest.id).toBe(
      "trusted-local",
    );
    expect(scoreLocalServiceThemes(visualCraft)[0].manifest.id).toBe(
      "project-led",
    );
  });

  it("names exactly two distinct alternatives", () => {
    for (const profile of [calloutTrade, establishedTrade, visualCraft]) {
      const selection = selectDeterministicLocalServiceTheme(profile);
      const options = localServiceThemeOptions(selection);
      expect(selection.alternatives).toHaveLength(2);
      expect(options).toHaveLength(3);
      expect(new Set(options).size).toBe(3);
      expect(options[0]).toBe(selection.themeId);
      expect(selection.source).toBe("deterministic");
    }
  });

  it("falls back to the scorer for unusable model output", () => {
    const deterministic = selectDeterministicLocalServiceTheme(visualCraft);
    expect(selectLocalServiceTheme(visualCraft, null)).toEqual(deterministic);
    expect(
      selectLocalServiceTheme(visualCraft, { themeId: "contractor-pro" }),
    ).toEqual(deterministic);
    expect(
      selectLocalServiceTheme(visualCraft, {
        themeId: "project-led",
        confidence: 0.9,
        reasons: ["Portfolio fit"],
        alternatives: ["project-led", "trusted-local"],
        tokens: {},
      }),
    ).toEqual(deterministic);
  });

  it("accepts only registered tokens for an owner choice", () => {
    const automatic = selectDeterministicLocalServiceTheme(calloutTrade);
    const selected = selectOwnerLocalServiceTheme(calloutTrade, "project-led");
    expect(selected).toMatchObject({
      themeId: "project-led",
      source: "owner",
      confidence: 1,
    });
    expect(selected.tokens).toEqual(
      getLocalServiceThemeManifest("project-led").safeDefaultTokens,
    );
    expect(restoreAutomaticLocalServiceTheme(calloutTrade)).toEqual(automatic);
  });

  it("rejects incompatible stored versions and closed-list escapes", () => {
    const selection = selectDeterministicLocalServiceTheme(establishedTrade);
    expect(parseLocalServiceThemeSelection(selection)?.themeId).toBe(
      selection.themeId,
    );
    expect(
      parseLocalServiceThemeSelection({
        ...selection,
        rendererVersion: LOCAL_SERVICE_THEME_RENDERER_VERSION + 1,
      }),
    ).toBeNull();
    expect(parseLocalServiceThemeSelection(undefined)).toBeNull();
    expect(previewLocalServiceThemeAlternate(selection, "project-led")?.themeId).toBe(
      "project-led",
    );
    expect(
      themeAdapterFor(Vertical.LOCAL_SERVICE)
        ?.parseSelection(selection)
        ?.alternate("contractor-pro"),
    ).toBeNull();
  });
});

describe("local-service theme rendering", () => {
  it("registers the adapter and exposes the full shortlist", () => {
    const stored = selectDeterministicLocalServiceTheme(calloutTrade);
    const parsed = themeAdapterFor(Vertical.LOCAL_SERVICE)?.parseSelection(stored);
    expect(parsed?.themeId).toBe("direct-response");
    expect(parsed?.colors).toEqual(stored.tokens.colors);
    expect(parsed?.options.map(({ id }) => id)).toEqual(
      localServiceThemeOptions(stored),
    );
  });

  it("renders the selected neutral template without changing the trade", () => {
    const theme = registeredSiteTheme(
      Vertical.LOCAL_SERVICE,
      sampleLocalServiceSiteDraft.attributes,
    );
    expect(theme).not.toBeNull();
    const html = renderToStaticMarkup(
      <SiteRenderer
        draft={sampleLocalServiceSiteDraft}
        vertical={Vertical.LOCAL_SERVICE}
        theme={theme!}
      />,
    );
    expect(html).toContain('data-site-template="direct-response"');
    expect(html).toContain('data-site-theme-version="local-service-renderer-v1"');
    expect(html).toContain("Qualified electrician");
    expect(html).not.toContain("Builder ·");
    expect(html).not.toContain("Artisan ·");
  });

  it("rotates all three preview alternates with their registry colours", () => {
    const alternates = resolvePreviewThemeAlternates({
      vertical: Vertical.LOCAL_SERVICE,
      draft: sampleLocalServiceSiteDraft,
      requestedTheme: "project-led",
    });
    expect(alternates?.theme.id).toBe("project-led");
    expect(alternates?.options).toHaveLength(3);
    expect(
      alternates?.draft.attributes.themeSelection,
    ).toMatchObject({ themeId: "project-led" });
    expect(
      themeAdapterFor(Vertical.LOCAL_SERVICE)?.parseSelection(
        alternates?.draft.attributes.themeSelection,
      )?.colors,
    ).toEqual(getLocalServiceThemeManifest("project-led").safeDefaultTokens.colors);
  });
});

describe("local-service theme colour accessibility", () => {
  const pairs = [
    { left: "background", right: "foreground" },
    { left: "surface", right: "foreground" },
    { left: "accent", right: "accentForeground" },
  ] as const;

  for (const manifest of listLocalServiceThemeManifests()) {
    for (const pair of pairs) {
      it(`${manifest.id} clears AA for ${pair.left}/${pair.right}`, () => {
        const { colors } = mergeLocalServiceThemeTokens(
          manifest.safeDefaultTokens,
        );
        expect(
          colorContrast(colors[pair.left], colors[pair.right]),
        ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      });
    }
  }

  it("ignores values outside the closed token vocabulary", () => {
    const merged = mergeLocalServiceThemeTokens(
      getLocalServiceThemeManifest("trusted-local").safeDefaultTokens,
      {
        style: { fontPair: "comic-sans", density: "airy" },
        script: "alert(1)",
      },
    );
    expect(merged.style.fontPair).toBe("grotesk");
    expect(merged).not.toHaveProperty("script");
  });
});
