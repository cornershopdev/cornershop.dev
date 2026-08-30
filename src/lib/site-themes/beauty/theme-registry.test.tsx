import { describe, expect, it } from "bun:test";
import { Vertical } from "@/generated/prisma/enums";
import {
  BEAUTY_THEME_RENDERER_VERSION,
  beautyDesignProfileSchema,
  beautyThemeIdSchema,
} from "@/lib/site-themes/beauty/contracts";
import {
  findBeautyThemeManifest,
  getBeautyThemeManifest,
  listBeautyThemeManifests,
  listFeaturedBeautyThemeManifests,
} from "@/lib/site-themes/beauty/registry";
import {
  beautyThemeOptions,
  parseBeautyThemeSelection,
  previewBeautyThemeAlternate,
  restoreAutomaticBeautyTheme,
  scoreBeautyThemes,
  selectBeautyTheme,
  selectDeterministicBeautyTheme,
  selectOwnerBeautyTheme,
} from "@/lib/site-themes/beauty/selection";
import {
  colorContrast,
  MIN_TEXT_CONTRAST,
} from "@/lib/site-themes/shared/color";
import { mergeBeautyThemeTokens } from "@/lib/site-themes/beauty/tokens";
import { themeAdapterFor } from "@/lib/site-themes/adapters";
import { beautyTemplates } from "@/lib/verticals/beauty/templates";

const walkInBarber = beautyDesignProfileSchema.parse({
  bookingModel: "walk-in",
  primaryIntent: "call",
  catalogExperience: "price-list",
  brandTraits: ["classic", "craft"],
  pricePosition: "value",
  locationCount: 1,
  photographyQuality: "none",
});

const portfolioStudio = beautyDesignProfileSchema.parse({
  bookingModel: "appointment",
  primaryIntent: "book",
  catalogExperience: "gallery",
  brandTraits: ["minimal", "craft"],
  pricePosition: "premium",
  locationCount: 1,
  photographyQuality: "strong",
});

describe("beauty theme registry", () => {
  it("publishes five complete themes with three featured ranks", () => {
    const manifests = listBeautyThemeManifests();
    expect(manifests.map(({ id }) => id)).toEqual([
      "barbershop",
      "classic-salon",
      "modern-studio",
      "spa-luxe",
      "express-nails",
    ]);
    expect(new Set(manifests.map(({ id }) => id)).size).toBe(manifests.length);
    expect(listFeaturedBeautyThemeManifests().map(({ id }) => id)).toEqual([
      "modern-studio",
      "classic-salon",
      "barbershop",
    ]);

    for (const manifest of manifests) {
      expect(beautyThemeIdSchema.parse(manifest.id)).toBe(manifest.id);
      expect(manifest.rendererVersion).toBe(BEAUTY_THEME_RENDERER_VERSION);
      expect(manifest.bestFor.length).toBeGreaterThan(0);
      expect(manifest.avoidWhen.length).toBeGreaterThan(0);
      expect(manifest.aiBrief.length).toBeGreaterThan(20);
      expect(manifest.marketReferences.length).toBeGreaterThan(0);
      expect(() => JSON.stringify(manifest)).not.toThrow();
    }
  });

  /**
   * The beauty renderer dispatch resolves `definitions[theme.id]`, so a theme
   * whose id is not a template key would silently fall back to the attribute
   * derived template and render as a different design than the one selected.
   */
  it("keeps every theme id addressable by the beauty template table", () => {
    for (const manifest of listBeautyThemeManifests()) {
      expect(beautyTemplates[manifest.id].id).toBe(manifest.id);
    }
  });

  it("does not resolve inherited object properties as theme manifests", () => {
    expect(findBeautyThemeManifest("__proto__")).toBeNull();
    expect(findBeautyThemeManifest("constructor")).toBeNull();
  });

  it("keeps capabilities coherent with the catalog experience", () => {
    for (const manifest of listBeautyThemeManifests()) {
      if (manifest.experience.catalogExperience === "gallery") {
        expect(manifest.capabilities.galleryEmphasis).toBe(true);
      }
      if (manifest.experience.catalogExperience === "packages") {
        expect(manifest.capabilities.packageEmphasis).toBe(true);
      }
      if (manifest.capabilities.serviceSearch) {
        expect(manifest.capabilities.categoryNavigation).toBe(true);
      }
    }
  });
});

describe("bounded beauty theme selection", () => {
  it("selects different themes for different booking models", () => {
    const barber = scoreBeautyThemes(walkInBarber)[0].manifest.id;
    const studio = scoreBeautyThemes(portfolioStudio)[0].manifest.id;

    expect(barber).toBe("barbershop");
    expect(studio).toBe("modern-studio");
    expect(barber).not.toBe(studio);
  });

  it("names a winner and exactly two distinct alternatives", () => {
    for (const profile of [walkInBarber, portfolioStudio]) {
      const selection = selectDeterministicBeautyTheme(profile);
      const options = beautyThemeOptions(selection);

      expect(selection.alternatives).toHaveLength(2);
      expect(options).toHaveLength(3);
      expect(new Set(options).size).toBe(3);
      expect(options[0]).toBe(selection.themeId);
      expect(selection.rendererVersion).toBe(BEAUTY_THEME_RENDERER_VERSION);
      expect(selection.source).toBe("deterministic");
    }
  });

  it("accepts only registered ids and registry tokens for an owner choice", () => {
    const automatic = selectDeterministicBeautyTheme(walkInBarber);
    const selected = selectOwnerBeautyTheme(walkInBarber, "spa-luxe");
    const nextAlternative = automatic.alternatives.find(
      (id) => id !== selected.themeId,
    );

    expect(selected).toMatchObject({
      themeId: "spa-luxe",
      source: "owner",
      confidence: 1,
    });
    expect(nextAlternative).toBeDefined();
    expect(selected.alternatives).toEqual([automatic.themeId, nextAlternative!]);
    expect(selected.tokens).toEqual(
      getBeautyThemeManifest("spa-luxe").safeDefaultTokens,
    );
    expect(restoreAutomaticBeautyTheme(walkInBarber)).toEqual(automatic);
  });

  it("falls back to the scorer for unusable model output", () => {
    const deterministic = selectDeterministicBeautyTheme(portfolioStudio);

    expect(selectBeautyTheme(portfolioStudio, null)).toEqual(deterministic);
    expect(selectBeautyTheme(portfolioStudio, { themeId: "wp-astra" })).toEqual(
      deterministic,
    );
    expect(
      selectBeautyTheme(portfolioStudio, {
        themeId: "modern-studio",
        confidence: 0.9,
        reasons: ["Portfolio led"],
        alternatives: ["modern-studio", "spa-luxe"],
        tokens: {},
      }),
    ).toEqual(deterministic);
  });

  it("rejects a stored selection built for another renderer version", () => {
    const selection = selectDeterministicBeautyTheme(walkInBarber);

    expect(parseBeautyThemeSelection(selection)?.themeId).toBe(
      selection.themeId,
    );
    expect(
      parseBeautyThemeSelection({
        ...selection,
        rendererVersion: BEAUTY_THEME_RENDERER_VERSION + 1,
      }),
    ).toBeNull();
    expect(parseBeautyThemeSelection(undefined)).toBeNull();
  });

  it("rotates only onto themes the recorded selection already shortlisted", () => {
    const selection = selectDeterministicBeautyTheme(portfolioStudio);
    const [alternate] = selection.alternatives;
    const rotated = previewBeautyThemeAlternate(selection, alternate);

    expect(rotated?.themeId).toBe(alternate);
    expect(rotated?.tokens).toEqual(
      getBeautyThemeManifest(alternate).safeDefaultTokens,
    );
    expect(beautyThemeOptions(rotated!).toSorted()).toEqual(
      beautyThemeOptions(selection).toSorted(),
    );
    expect(previewBeautyThemeAlternate(selection, selection.themeId)).toBe(
      selection,
    );

    const outsider = listBeautyThemeManifests()
      .map(({ id }) => id)
      .find((id) => !beautyThemeOptions(selection).includes(id));
    expect(outsider).toBeDefined();
    expect(previewBeautyThemeAlternate(selection, outsider!)).toBeNull();
  });
});

describe("beauty theme adapter", () => {
  it("exposes the shortlist and colours of a stored beauty selection", () => {
    const adapter = themeAdapterFor(Vertical.BEAUTY);
    const stored = selectDeterministicBeautyTheme(portfolioStudio);
    const parsed = adapter?.parseSelection(stored);

    expect(parsed?.themeId).toBe(stored.themeId);
    expect(parsed?.colors).toEqual(stored.tokens.colors);
    expect(parsed?.options.map(({ id }) => id)).toEqual(
      beautyThemeOptions(stored),
    );
    // The adapter erases theme ids to `string`; every one it hands back must
    // still resolve in the registry it came from.
    for (const option of parsed?.options ?? []) {
      const manifest = findBeautyThemeManifest(option.id);
      expect(manifest).not.toBeNull();
      expect(option.name).toBe(manifest!.name);
    }
    expect(adapter?.rendererVersionId(stored.rendererVersion)).toBe(
      `beauty-renderer-v${stored.rendererVersion}`,
    );
  });

  it("refuses to rotate onto a theme outside the recorded shortlist", () => {
    const adapter = themeAdapterFor(Vertical.BEAUTY);
    const stored = selectDeterministicBeautyTheme(portfolioStudio);
    const parsed = adapter?.parseSelection(stored);
    const [alternate] = stored.alternatives;

    expect(parsed?.alternate(alternate)?.themeId).toBe(alternate);
    expect(parsed?.alternate("wp-astra")).toBeNull();
    expect(parsed?.alternate("__proto__")).toBeNull();
  });
});

describe("beauty theme colour accessibility", () => {
  const pairs = [
    { label: "body text", left: "background", right: "foreground" },
    { label: "surface text", left: "surface", right: "foreground" },
    { label: "action labels", left: "accent", right: "accentForeground" },
  ] as const;

  for (const manifest of listBeautyThemeManifests()) {
    for (const pair of pairs) {
      it(`${manifest.id} clears AA on ${pair.label} as published`, () => {
        const { colors } = manifest.safeDefaultTokens;
        expect(
          colorContrast(colors[pair.left], colors[pair.right]),
        ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      });

      it(`${manifest.id} still clears AA on ${pair.label} after merging`, () => {
        const { colors } = mergeBeautyThemeTokens(manifest.safeDefaultTokens);
        expect(
          colorContrast(colors[pair.left], colors[pair.right]),
        ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      });
    }
  }

  it("repairs a mid-tone accent that neither black nor white can label", () => {
    const merged = mergeBeautyThemeTokens(
      getBeautyThemeManifest("modern-studio").safeDefaultTokens,
      { colors: { accent: "#8a7fd4", accentForeground: "#ffffff" } },
    );

    expect(
      colorContrast(merged.colors.accent, merged.colors.accentForeground),
    ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });

  it("ignores style values outside the closed token vocabulary", () => {
    const merged = mergeBeautyThemeTokens(
      getBeautyThemeManifest("spa-luxe").safeDefaultTokens,
      { style: { fontPair: "comic-sans", density: "airy" }, script: "alert(1)" },
    );

    expect(merged.style.fontPair).toBe("editorial");
    expect(merged).not.toHaveProperty("script");
  });
});
