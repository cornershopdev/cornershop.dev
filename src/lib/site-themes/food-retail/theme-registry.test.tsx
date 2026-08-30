import { describe, expect, it } from "bun:test";
import { Vertical } from "@/generated/prisma/enums";
import {
  FOOD_RETAIL_THEME_RENDERER_VERSION,
  foodRetailDesignProfileSchema,
  foodRetailThemeIdSchema,
} from "@/lib/site-themes/food-retail/contracts";
import {
  findFoodRetailThemeManifest,
  getFoodRetailThemeManifest,
  listFeaturedFoodRetailThemeManifests,
  listFoodRetailThemeManifests,
} from "@/lib/site-themes/food-retail/registry";
import {
  foodRetailThemeOptions,
  parseFoodRetailThemeSelection,
  previewFoodRetailThemeAlternate,
  restoreAutomaticFoodRetailTheme,
  scoreFoodRetailThemes,
  selectDeterministicFoodRetailTheme,
  selectFoodRetailTheme,
  selectOwnerFoodRetailTheme,
} from "@/lib/site-themes/food-retail/selection";
import { mergeFoodRetailThemeTokens } from "@/lib/site-themes/food-retail/tokens";
import {
  colorContrast,
  MIN_TEXT_CONTRAST,
} from "@/lib/site-themes/shared/color";
import { themeAdapterFor } from "@/lib/site-themes/adapters";
import { foodRetailTemplates } from "@/lib/verticals/food-retail/templates";

const morningBakery = foodRetailDesignProfileSchema.parse({
  fulfillmentModel: "counter",
  primaryIntent: "visit",
  catalogExperience: "daily-list",
  brandTraits: ["warm", "classic"],
  pricePosition: "value",
  locationCount: 1,
  photographyQuality: "strong",
  rangeVolatility: "daily",
});

const neighborhoodGrocer = foodRetailDesignProfileSchema.parse({
  fulfillmentModel: "click-collect",
  primaryIntent: "browse",
  catalogExperience: "aisles",
  brandTraits: ["minimal", "modern"],
  pricePosition: "value",
  locationCount: 3,
  photographyQuality: "limited",
  rangeVolatility: "stable",
});

describe("food retail theme registry", () => {
  it("publishes three complete themes, all of them featured", () => {
    const manifests = listFoodRetailThemeManifests();
    expect(manifests.map(({ id }) => id)).toEqual([
      "daily-counter",
      "craft-counter",
      "market-shelves",
    ]);
    expect(new Set(manifests.map(({ id }) => id)).size).toBe(manifests.length);
    expect(listFeaturedFoodRetailThemeManifests().map(({ id }) => id)).toEqual([
      "daily-counter",
      "craft-counter",
      "market-shelves",
    ]);

    for (const manifest of manifests) {
      expect(foodRetailThemeIdSchema.parse(manifest.id)).toBe(manifest.id);
      expect(manifest.rendererVersion).toBe(FOOD_RETAIL_THEME_RENDERER_VERSION);
      expect(manifest.bestFor.length).toBeGreaterThan(0);
      expect(manifest.avoidWhen.length).toBeGreaterThan(0);
      expect(manifest.aiBrief.length).toBeGreaterThan(20);
      expect(manifest.marketReferences.length).toBeGreaterThan(0);
      expect(() => JSON.stringify(manifest)).not.toThrow();
    }
  });

  /**
   * `alternatives` is fixed at two, so a vertical with fewer than three
   * registered themes cannot produce a legal selection envelope at all.
   */
  it("registers enough themes to name a winner and two alternatives", () => {
    expect(listFoodRetailThemeManifests().length).toBeGreaterThanOrEqual(3);
  });

  /**
   * The non-restaurant renderer dispatch resolves `definitions[theme.id]`, so a
   * theme whose id is not a template key would silently fall back to the
   * shop-type template and render a different design than the one selected.
   */
  it("keeps every theme id addressable by the food retail template table", () => {
    for (const manifest of listFoodRetailThemeManifests()) {
      expect(foodRetailTemplates[manifest.id].id).toBe(manifest.id);
    }
  });

  it("does not resolve inherited object properties as theme manifests", () => {
    expect(findFoodRetailThemeManifest("__proto__")).toBeNull();
    expect(findFoodRetailThemeManifest("constructor")).toBeNull();
  });

  it("keeps capabilities coherent with the catalog experience", () => {
    for (const manifest of listFoodRetailThemeManifests()) {
      if (manifest.experience.catalogExperience === "aisles") {
        expect(manifest.capabilities.categoryNavigation).toBe(true);
      }
      if (manifest.experience.catalogExperience === "showcase") {
        expect(manifest.capabilities.provenanceEmphasis).toBe(true);
      }
      if (manifest.experience.catalogExperience === "daily-list") {
        expect(manifest.capabilities.stickyOrderAction).toBe(true);
      }
      if (manifest.capabilities.productSearch) {
        expect(manifest.capabilities.categoryNavigation).toBe(true);
      }
    }
  });
});

describe("bounded food retail theme selection", () => {
  it("separates a daily counter from a stable aisle range", () => {
    const bakery = scoreFoodRetailThemes(morningBakery)[0].manifest.id;
    const grocer = scoreFoodRetailThemes(neighborhoodGrocer)[0].manifest.id;

    expect(bakery).toBe("daily-counter");
    expect(grocer).toBe("market-shelves");
    expect(bakery).not.toBe(grocer);
  });

  it("names a winner and exactly two distinct alternatives", () => {
    for (const profile of [morningBakery, neighborhoodGrocer]) {
      const selection = selectDeterministicFoodRetailTheme(profile);
      const options = foodRetailThemeOptions(selection);

      expect(selection.alternatives).toHaveLength(2);
      expect(options).toHaveLength(3);
      expect(new Set(options).size).toBe(3);
      expect(options[0]).toBe(selection.themeId);
      expect(selection.rendererVersion).toBe(FOOD_RETAIL_THEME_RENDERER_VERSION);
      expect(selection.source).toBe("deterministic");
    }
  });

  it("accepts only registered ids and registry tokens for an owner choice", () => {
    const automatic = selectDeterministicFoodRetailTheme(morningBakery);
    const selected = selectOwnerFoodRetailTheme(morningBakery, "market-shelves");
    const nextAlternative = automatic.alternatives.find(
      (id) => id !== selected.themeId,
    );

    expect(selected).toMatchObject({
      themeId: "market-shelves",
      source: "owner",
      confidence: 1,
    });
    expect(nextAlternative).toBeDefined();
    expect(selected.alternatives).toEqual([automatic.themeId, nextAlternative!]);
    expect(selected.tokens).toEqual(
      getFoodRetailThemeManifest("market-shelves").safeDefaultTokens,
    );
    expect(restoreAutomaticFoodRetailTheme(morningBakery)).toEqual(automatic);
  });

  it("falls back to the scorer for unusable model output", () => {
    const deterministic = selectDeterministicFoodRetailTheme(neighborhoodGrocer);

    expect(selectFoodRetailTheme(neighborhoodGrocer, null)).toEqual(
      deterministic,
    );
    expect(
      selectFoodRetailTheme(neighborhoodGrocer, { themeId: "wp-astra" }),
    ).toEqual(deterministic);
    expect(
      selectFoodRetailTheme(neighborhoodGrocer, {
        themeId: "craft-counter",
        confidence: 0.9,
        reasons: ["Provenance led"],
        alternatives: ["craft-counter", "market-shelves"],
        tokens: {},
      }),
    ).toEqual(deterministic);
  });

  it("rejects a stored selection built for another renderer version", () => {
    const selection = selectDeterministicFoodRetailTheme(morningBakery);

    expect(parseFoodRetailThemeSelection(selection)?.themeId).toBe(
      selection.themeId,
    );
    expect(
      parseFoodRetailThemeSelection({
        ...selection,
        rendererVersion: FOOD_RETAIL_THEME_RENDERER_VERSION + 1,
      }),
    ).toBeNull();
    expect(parseFoodRetailThemeSelection(undefined)).toBeNull();
  });

  it("rotates only onto themes the recorded selection already shortlisted", () => {
    const selection = selectDeterministicFoodRetailTheme(neighborhoodGrocer);
    const [alternate] = selection.alternatives;
    const rotated = previewFoodRetailThemeAlternate(selection, alternate);

    expect(rotated?.themeId).toBe(alternate);
    expect(rotated?.tokens).toEqual(
      getFoodRetailThemeManifest(alternate).safeDefaultTokens,
    );
    expect(foodRetailThemeOptions(rotated!).toSorted()).toEqual(
      foodRetailThemeOptions(selection).toSorted(),
    );
    expect(
      previewFoodRetailThemeAlternate(selection, selection.themeId),
    ).toBe(selection);
  });
});

describe("food retail theme adapter", () => {
  it("exposes the shortlist and colours of a stored food retail selection", () => {
    const adapter = themeAdapterFor(Vertical.FOOD_RETAIL);
    const stored = selectDeterministicFoodRetailTheme(neighborhoodGrocer);
    const parsed = adapter?.parseSelection(stored);

    expect(parsed?.themeId).toBe(stored.themeId);
    expect(parsed?.colors).toEqual(stored.tokens.colors);
    expect(parsed?.options.map(({ id }) => id)).toEqual(
      foodRetailThemeOptions(stored),
    );
    // The adapter erases theme ids to `string`; every one it hands back must
    // still resolve in the registry it came from.
    for (const option of parsed?.options ?? []) {
      const manifest = findFoodRetailThemeManifest(option.id);
      expect(manifest).not.toBeNull();
      expect(option.name).toBe(manifest!.name);
    }
    expect(adapter?.rendererVersionId(stored.rendererVersion)).toBe(
      `food-retail-renderer-v${stored.rendererVersion}`,
    );
  });

  it("refuses to rotate onto a theme outside the recorded shortlist", () => {
    const adapter = themeAdapterFor(Vertical.FOOD_RETAIL);
    const stored = selectDeterministicFoodRetailTheme(neighborhoodGrocer);
    const parsed = adapter?.parseSelection(stored);
    const [alternate] = stored.alternatives;

    expect(parsed?.alternate(alternate)?.themeId).toBe(alternate);
    expect(parsed?.alternate("wp-astra")).toBeNull();
    expect(parsed?.alternate("__proto__")).toBeNull();
  });
});

describe("food retail theme colour accessibility", () => {
  const pairs = [
    { label: "body text", left: "background", right: "foreground" },
    { label: "surface text", left: "surface", right: "foreground" },
    { label: "action labels", left: "accent", right: "accentForeground" },
  ] as const;

  for (const manifest of listFoodRetailThemeManifests()) {
    for (const pair of pairs) {
      it(`${manifest.id} clears AA on ${pair.label} as published`, () => {
        const { colors } = manifest.safeDefaultTokens;
        expect(
          colorContrast(colors[pair.left], colors[pair.right]),
        ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      });

      it(`${manifest.id} still clears AA on ${pair.label} after merging`, () => {
        const { colors } = mergeFoodRetailThemeTokens(
          manifest.safeDefaultTokens,
        );
        expect(
          colorContrast(colors[pair.left], colors[pair.right]),
        ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      });
    }
  }

  it("repairs a mid-tone accent that neither black nor white can label", () => {
    const merged = mergeFoodRetailThemeTokens(
      getFoodRetailThemeManifest("market-shelves").safeDefaultTokens,
      { colors: { accent: "#8a7fd4", accentForeground: "#ffffff" } },
    );

    expect(
      colorContrast(merged.colors.accent, merged.colors.accentForeground),
    ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });

  it("ignores style values outside the closed token vocabulary", () => {
    const merged = mergeFoodRetailThemeTokens(
      getFoodRetailThemeManifest("craft-counter").safeDefaultTokens,
      { style: { fontPair: "comic-sans", density: "airy" }, script: "alert(1)" },
    );

    expect(merged.style.fontPair).toBe("editorial");
    expect(merged).not.toHaveProperty("script");
  });
});
