import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RestaurantThemeRenderer } from "@/components/restaurant-themes/restaurant-theme-renderer";
import { hasRestaurantThemeRenderer } from "@/components/restaurant-themes/restaurant-theme-renderer";
import {
  restaurantAiThemeOutputSchema,
  restaurantDesignProfileSchema,
  restaurantThemeIdSchema,
  restaurantThemeSelectionSchema,
} from "@/lib/site-themes/restaurant/contracts";
import { restaurantThemeFixtures } from "@/lib/site-themes/restaurant/fixtures";
import {
  findRestaurantThemeManifest,
  getRestaurantThemeManifest,
  listRestaurantThemeManifests,
} from "@/lib/site-themes/restaurant/registry";
import {
  normalizeGeneratedRestaurantThemeSelection,
  parseRestaurantThemeSelection,
  restoreAutomaticRestaurantTheme,
  scoreRestaurantThemes,
  selectOwnerRestaurantTheme,
  selectRestaurantTheme,
} from "@/lib/site-themes/restaurant/selection";
import { colorContrast } from "@/lib/site-themes/restaurant/tokens";
import {
  fromRestaurantDraft,
  localizeRestaurantDraft,
  restaurantAttributesSchema,
  sampleRestaurant,
  toRestaurantDraft,
} from "@/lib/restaurant";

describe("restaurant theme registry", () => {
  it("publishes seven complete themes with three featured ranks for the homepage", () => {
    const manifests = listRestaurantThemeManifests();
    expect(manifests.map(({ id }) => id)).toEqual([
      "terroir-editorial",
      "counter-service",
      "after-dark",
      "neighborhood-table",
      "daylight-cafe",
      "family-feast",
      "vesper-room",
    ]);
    expect(new Set(manifests.map(({ id }) => id)).size).toBe(manifests.length);

    const featured = manifests
      .filter((manifest) => manifest.featuredRank !== null)
      .sort(
        (left, right) =>
          (left.featuredRank ?? 0) - (right.featuredRank ?? 0),
      );
    expect(featured.map(({ id }) => id)).toEqual([
      "terroir-editorial",
      "counter-service",
      "after-dark",
    ]);

    for (const manifest of manifests) {
      expect(restaurantThemeIdSchema.parse(manifest.id)).toBe(manifest.id);
      expect(manifest.rendererVersion).toBe(1);
      expect(manifest.bestFor.length).toBeGreaterThan(0);
      expect(manifest.avoidWhen.length).toBeGreaterThan(0);
      expect(manifest.aiBrief.length).toBeGreaterThan(20);
      expect(manifest.marketReferences.length).toBeGreaterThan(0);
      expect(manifest.previewFixtureId).toBe(
        restaurantThemeFixtures[manifest.id].slug,
      );
      expect(hasRestaurantThemeRenderer(manifest.id)).toBe(true);
      expect(() => JSON.stringify(manifest)).not.toThrow();
    }
  });

  it("does not resolve inherited object properties as theme manifests", () => {
    expect(findRestaurantThemeManifest("__proto__")).toBeNull();
    expect(findRestaurantThemeManifest("constructor")).toBeNull();
  });

  it("keeps order-app interaction capabilities on commerce only", () => {
    for (const manifest of listRestaurantThemeManifests()) {
      if (manifest.experience.menuExperience === "commerce") {
        expect(manifest.capabilities.categoryNavigation).toBe(true);
        expect(manifest.capabilities.stickyOrderAction).toBe(true);
      } else {
        expect(manifest.capabilities.categoryNavigation).toBe(false);
        expect(manifest.capabilities.menuSearch).toBe(false);
        expect(manifest.capabilities.stickyOrderAction).toBe(false);
      }
    }
  });

  it("backs every theme with a realistic fixture selected for that theme", () => {
    for (const manifest of listRestaurantThemeManifests()) {
      const fixture = restaurantThemeFixtures[manifest.id];
      const selection = parseRestaurantThemeSelection(
        fixture.attributes.themeSelection,
      );
      expect(fixture.name).not.toContain("Example");
      expect(fixture.catalogSections.length).toBeGreaterThan(0);
      expect(fixture.integrations.length).toBeGreaterThan(0);
      expect(fixture.heroImageUrl).toBe(
        `/themes/restaurant/${manifest.id}.webp`,
      );
      expect(selection?.themeId).toBe(manifest.id);
    }
  });
});

describe("bounded restaurant theme selection", () => {
  const fineDining = restaurantDesignProfileSchema.parse({
    serviceModel: "fine-dining",
    primaryIntent: "reserve",
    menuExperience: "editorial",
    brandTraits: ["craft", "minimal"],
    pricePosition: "premium",
    locationCount: 1,
    photographyQuality: "strong",
  });
  const takeaway = restaurantDesignProfileSchema.parse({
    serviceModel: "fast-casual",
    primaryIntent: "order",
    menuExperience: "commerce",
    brandTraits: ["energetic", "playful"],
    pricePosition: "value",
    locationCount: 2,
    photographyQuality: "strong",
  });

  it("selects different themes for the same cuisine with different service models", () => {
    const italianFineDining = scoreRestaurantThemes(fineDining)[0].manifest.id;
    const italianTakeaway = scoreRestaurantThemes(takeaway)[0].manifest.id;

    expect(italianFineDining).toBe("terroir-editorial");
    expect(italianTakeaway).toBe("counter-service");
    expect(italianFineDining).not.toBe(italianTakeaway);
  });

  it("accepts only registered IDs and closed token vocabulary", () => {
    const base = {
      themeId: "counter-service",
      confidence: 0.91,
      reasons: ["Ordering is the primary customer action"],
      alternatives: ["terroir-editorial", "after-dark"],
      tokens: {},
    };
    expect(restaurantAiThemeOutputSchema.parse(base).themeId).toBe(
      "counter-service",
    );

    for (const unsafe of [
      { ...base, themeId: "generated-theme" },
      { ...base, css: "body{display:none}" },
      { ...base, tokens: { className: "hidden" } },
      { ...base, tokens: { fontUrl: "https://evil.example/font.woff2" } },
      { ...base, html: "<script>alert(1)</script>" },
    ]) {
      expect(restaurantAiThemeOutputSchema.safeParse(unsafe).success).toBe(
        false,
      );
    }
  });

  it("falls back deterministically when model output is missing or invalid", () => {
    const absent = selectRestaurantTheme(takeaway, null);
    const unknown = selectRestaurantTheme(takeaway, {
      themeId: "not-registered",
      confidence: 1,
      reasons: ["Unknown theme"],
      alternatives: ["terroir-editorial", "after-dark"],
      tokens: {},
    });
    const injected = selectRestaurantTheme(takeaway, {
      themeId: "counter-service",
      confidence: 1,
      reasons: ["Ordering is primary"],
      alternatives: ["terroir-editorial", "after-dark"],
      tokens: { colors: { background: "url(javascript:alert(1))" } },
    });

    expect(absent.themeId).toBe("counter-service");
    expect(unknown).toEqual(absent);
    expect(injected).toEqual(absent);
    expect(absent.source).toBe("deterministic");
  });

  it("lets an owner override automatic selection and restore the bounded match", () => {
    const automatic = restoreAutomaticRestaurantTheme(takeaway);
    const selected = selectOwnerRestaurantTheme(
      takeaway,
      "terroir-editorial",
    );

    expect(automatic).toMatchObject({
      themeId: "counter-service",
      source: "deterministic",
      rendererVersion: 1,
    });
    expect(selected).toMatchObject({
      themeId: "terroir-editorial",
      source: "owner",
      confidence: 1,
      rendererVersion: 1,
    });
    const nextAlternative = automatic.alternatives.find(
      (id) => id !== selected.themeId,
    );
    expect(nextAlternative).toBeDefined();
    expect(selected.alternatives).toEqual([
      automatic.themeId,
      nextAlternative!,
    ]);
    expect(selected.tokens).toEqual(
      getRestaurantThemeManifest("terroir-editorial").safeDefaultTokens,
    );
    expect(restoreAutomaticRestaurantTheme(takeaway)).toEqual(automatic);
  });

  it("does not upgrade bare or version-incompatible model output", () => {
    const bareAiShape = normalizeGeneratedRestaurantThemeSelection(takeaway, {
      themeId: "terroir-editorial",
      confidence: 0.9,
      reasons: ["Unversioned model choice"],
      alternatives: ["after-dark", "counter-service"],
      tokens: {},
    });
    const incompatibleVersion = normalizeGeneratedRestaurantThemeSelection(
      takeaway,
      {
        schemaVersion: 1,
        rendererVersion: 2,
        themeId: "terroir-editorial",
        source: "ai",
        confidence: 0.9,
        reasons: ["Future renderer"],
        alternatives: ["after-dark", "counter-service"],
        tokens: {},
      },
    );

    expect(bareAiShape.themeSelection.source).toBe("deterministic");
    expect(bareAiShape.themeSelection.themeId).toBe("counter-service");
    expect(incompatibleVersion.themeSelection).toEqual(
      bareAiShape.themeSelection,
    );
  });

  it("repairs body, surface and action contrast after token merging", () => {
    const selection = selectRestaurantTheme(fineDining, {
      themeId: "terroir-editorial",
      confidence: 0.88,
      reasons: ["Reservations and seasonal storytelling lead"],
      alternatives: ["after-dark", "counter-service"],
      tokens: {
        colors: {
          background: "#ffffff",
          foreground: "#eeeeee",
          surface: "#fefefe",
          accent: "#ffff00",
          accentForeground: "#ffffff",
        },
      },
    });
    const { colors } = selection.tokens;

    expect(colorContrast(colors.background, colors.foreground)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(colorContrast(colors.surface, colors.foreground)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(colorContrast(colors.accent, colors.accentForeground)).toBeGreaterThanOrEqual(
      4.5,
    );
  });
});

describe("restaurant theme compatibility", () => {
  it("keeps missing and malformed structured selections on the legacy path", () => {
    expect(parseRestaurantThemeSelection(undefined)).toBeNull();
    expect(
      parseRestaurantThemeSelection({
        themeId: "warm",
        rendererVersion: 0,
      }),
    ).toBeNull();
    expect(
      restaurantAttributesSchema.parse({
        cuisine: "Modern Italian",
        showMenuImages: true,
        themeSelection: {
          themeId: "generated-theme",
          css: "body{}",
        },
      }).themeSelection,
    ).toBeUndefined();
  });

  it("preserves structured selection through flat/nested compatibility conversion", () => {
    const fixture = restaurantThemeFixtures["after-dark"];
    const flat = toRestaurantDraft(fixture);
    const roundTrip = toRestaurantDraft(fromRestaurantDraft(flat));

    expect(roundTrip.designProfile).toEqual(flat.designProfile);
    expect(roundTrip.themeSelection).toEqual(flat.themeSelection);
  });

  it("preserves structured selection across locale overlays", () => {
    const fixture = toRestaurantDraft(
      restaurantThemeFixtures["terroir-editorial"],
    );
    const translated = {
      ...fixture,
      translations: [
        {
          locale: "fr",
          status: "current" as const,
          cuisine: "Méditerranéenne de saison",
          eyebrow: "Le champ, le feu et la saison maltaise",
          description:
            "Une salle de douze couverts guidée par les producteurs locaux et la pêche du jour.",
          menuSections: fixture.menuSections.map((section) => ({
            name: section.name,
            description: section.description,
            items: section.items.map((item) => ({
              name: item.name,
              description: item.description,
              dietaryLabels: item.dietaryLabels,
            })),
          })),
          integrationLabels: ["Réserver une table"],
        },
      ],
    };

    const localized = localizeRestaurantDraft(translated, "fr");
    expect(localized.themeSelection).toEqual(fixture.themeSelection);
    expect(localized.designProfile).toEqual(fixture.designProfile);
  });

  it("does not add a structured selection to the established sample fixture", () => {
    expect(sampleRestaurant.themeSelection).toBeUndefined();
    expect(sampleRestaurant.designProfile).toBeUndefined();
  });
});

describe("restaurant theme renderers", () => {
  it("renders every registry fixture through its declared renderer", () => {
    for (const manifest of listRestaurantThemeManifests()) {
      const fixture = restaurantThemeFixtures[manifest.id];
      const selection = restaurantThemeSelectionSchema.parse(
        fixture.attributes.themeSelection,
      );
      const html = renderToStaticMarkup(
        <RestaurantThemeRenderer
          draft={fixture}
          selection={selection}
          embedded
        />,
      );

      expect(html).toContain(`data-site-theme="${manifest.id}"`);
      expect(html).toContain(`data-theme-version="1"`);
      expect(html).toContain(fixture.name);
      expect(html).toContain(fixture.address);
      expect(html).toContain("<section");
      expect(html).not.toContain("cornershop.dev");

      if (manifest.id === "counter-service") {
        expect(html).toContain('aria-label="Menu categories"');
        expect(html).toContain('data-menu-experience="commerce"');
      } else if (manifest.id === "family-feast") {
        expect(html).toContain('aria-label="Menu categories"');
        expect(html).toContain('data-menu-experience="catalog"');
      } else {
        expect(html).not.toContain('aria-label="Menu categories"');
        expect(html).not.toContain('data-menu-experience="commerce"');
      }
    }
  });

  it("localizes theme chrome and preserves locale navigation", () => {
    const expectedFrenchChrome = {
      "terroir-editorial": "Guidé par la saison.",
      "counter-service": "Choisissez votre commande.",
      "after-dark": "Prolongez la soirée.",
      "neighborhood-table": "Ce qu’il y a sur la table.",
      "daylight-cafe": "Cuit aujourd’hui. Prêt maintenant.",
      "family-feast": "De quoi contenter tout le monde.",
      "vesper-room": "Une carte courte, lue lentement.",
    } as const;

    for (const manifest of listRestaurantThemeManifests()) {
      const fixture = restaurantThemeFixtures[manifest.id];
      const selection = restaurantThemeSelectionSchema.parse(
        fixture.attributes.themeSelection,
      );
      const html = renderToStaticMarkup(
        <RestaurantThemeRenderer
          draft={fixture}
          selection={selection}
          locale="fr"
          localeBasePath={`/preview/${fixture.slug}`}
          availableLocales={["en", "fr"]}
        />,
      );

      expect(html).toContain('lang="fr"');
      expect(html).toContain('aria-label="Langue"');
      expect(html).toContain(`/preview/${fixture.slug}/fr`);
      expect(html).toContain(expectedFrenchChrome[manifest.id]);
    }
  });

  it("does not invent operational hours for the after-dark theme", () => {
    const fixture = restaurantThemeFixtures["after-dark"];
    const selection = restaurantThemeSelectionSchema.parse(
      fixture.attributes.themeSelection,
    );
    const html = renderToStaticMarkup(
      <RestaurantThemeRenderer draft={fixture} selection={selection} />,
    );

    expect(html).not.toContain("Drinks from 18:00");
    expect(html).not.toContain("late kitchen");
    expect(html).toContain("Tonight’s programme");
  });

  it("does not render unavailable menu items", () => {
    const fixture = restaurantThemeFixtures["counter-service"];
    const unavailableName = fixture.catalogSections[0].items[0].name;
    const selection = restaurantThemeSelectionSchema.parse(
      fixture.attributes.themeSelection,
    );
    const draft = {
      ...fixture,
      catalogSections: fixture.catalogSections.map((section, sectionIndex) => ({
        ...section,
        items: section.items.map((item, itemIndex) => ({
          ...item,
          available: sectionIndex === 0 && itemIndex === 0 ? false : true,
        })),
      })),
    };
    const html = renderToStaticMarkup(
      <RestaurantThemeRenderer draft={draft} selection={selection} />,
    );

    expect(html).not.toContain(unavailableName);
  });

  it("keeps disabled integrations out of public theme output", () => {
    const fixture = restaurantThemeFixtures["counter-service"];
    const hiddenLabel = fixture.integrations[0].label;
    const selection = restaurantThemeSelectionSchema.parse(
      fixture.attributes.themeSelection,
    );
    const draft = {
      ...fixture,
      integrations: fixture.integrations.map((integration, index) => ({
        ...integration,
        enabled: index !== 0,
      })),
    };
    const html = renderToStaticMarkup(
      <RestaurantThemeRenderer draft={draft} selection={selection} />,
    );

    expect(html).not.toContain(hiddenLabel);
    expect(html).toContain(fixture.integrations[1].label);
  });

  it("renders approved gallery projections with their preserved provenance", () => {
    const fixture = restaurantThemeFixtures["terroir-editorial"];
    const selection = restaurantThemeSelectionSchema.parse(
      fixture.attributes.themeSelection,
    );
    const html = renderToStaticMarkup(
      <RestaurantThemeRenderer
        draft={{
          ...fixture,
          attributes: { ...fixture.attributes, showMenuImages: true },
          galleryImages: [
            {
              url: "https://assets.example/approved-gallery.webp",
              originalUrl: "https://assets.example/authentic-original.jpg",
              provenance: "owner",
            },
          ],
        }}
        selection={selection}
      />,
    );

    expect(html).toContain("data-site-photo-gallery");
    expect(html).toContain('data-image-provenance="owner"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
    expect(html).toContain("https://assets.example/approved-gallery.webp");
    expect(html).not.toContain("https://assets.example/authentic-original.jpg");
  });
});
