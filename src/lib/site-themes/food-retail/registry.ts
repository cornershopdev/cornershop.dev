import {
  FOOD_RETAIL_THEME_RENDERER_VERSION,
  foodRetailThemeTokensSchema,
  type FoodRetailBrandTrait,
  type FoodRetailCatalogExperience,
  type FoodRetailFulfillmentModel,
  type FoodRetailPhotographyQuality,
  type FoodRetailPricePosition,
  type FoodRetailPrimaryIntent,
  type FoodRetailRangeVolatility,
  type FoodRetailThemeId,
  type FoodRetailThemeTokens,
} from "@/lib/site-themes/food-retail/contracts";

export type FoodRetailThemeCapabilities = {
  categoryNavigation: boolean;
  productSearch: boolean;
  stickyOrderAction: boolean;
  imageEmphasis: boolean;
  provenanceEmphasis: boolean;
};

/**
 * Food-retail manifests carry no `previewFixtureId`. Unlike the restaurant,
 * this vertical ships no sample draft — the demo on `/create` stays a
 * restaurant — so a fixture id here would be a dangling reference rather than
 * a preview.
 */
export type FoodRetailThemeManifest = {
  id: FoodRetailThemeId;
  rendererVersion: typeof FOOD_RETAIL_THEME_RENDERER_VERSION;
  name: string;
  description: string;
  /** Homepage `#themes` shows only ranks 1–3. */
  featuredRank: 1 | 2 | 3 | null;
  /**
   * Internal design references only — patterns observed in highly reviewed
   * WordPress / Shopify food-retail themes. Never copied; never shown as
   * affiliate or "based on" claims in customer UI.
   */
  marketReferences: string[];
  experience: {
    primaryIntent: FoodRetailPrimaryIntent;
    catalogExperience: FoodRetailCatalogExperience;
  };
  fitSignals: {
    fulfillmentModels: FoodRetailFulfillmentModel[];
    primaryIntents: FoodRetailPrimaryIntent[];
    catalogExperiences: FoodRetailCatalogExperience[];
    brandTraits: FoodRetailBrandTrait[];
    pricePositions: FoodRetailPricePosition[];
    photographyQualities: FoodRetailPhotographyQuality[];
    rangeVolatilities: FoodRetailRangeVolatility[];
    multipleLocations: boolean;
  };
  avoidanceSignals: {
    fulfillmentModels: FoodRetailFulfillmentModel[];
    primaryIntents: FoodRetailPrimaryIntent[];
    catalogExperiences: FoodRetailCatalogExperience[];
    photographyQualities: FoodRetailPhotographyQuality[];
    rangeVolatilities: FoodRetailRangeVolatility[];
  };
  bestFor: string[];
  avoidWhen: string[];
  capabilities: FoodRetailThemeCapabilities;
  safeDefaultTokens: FoodRetailThemeTokens;
  aiBrief: string;
};

const manifests = {
  "daily-counter": {
    id: "daily-counter",
    rendererVersion: FOOD_RETAIL_THEME_RENDERER_VERSION,
    name: "Daily Counter",
    description:
      "A warm, appetite-forward counter for bakeries and patisseries whose range is rewritten every morning, with today's list ahead of everything else.",
    featuredRank: 1,
    marketReferences: [
      "Shopify Taste — catalogue rows with a fixed thumbnail rail, ordering action repeated per row",
      "Shopify Local — the hours-and-pickup band pinned directly under the hero",
    ],
    experience: { primaryIntent: "visit", catalogExperience: "daily-list" },
    fitSignals: {
      fulfillmentModels: ["counter", "click-collect"],
      primaryIntents: ["visit", "order"],
      catalogExperiences: ["daily-list"],
      brandTraits: ["warm", "classic", "modern"],
      pricePositions: ["value", "midmarket"],
      photographyQualities: ["limited", "strong"],
      rangeVolatilities: ["daily"],
      multipleLocations: false,
    },
    avoidanceSignals: {
      fulfillmentModels: [],
      primaryIntents: ["browse"],
      catalogExperiences: ["aisles"],
      photographyQualities: ["none"],
      rangeVolatilities: ["stable"],
    },
    bestFor: [
      "Bakeries and patisseries whose counter changes daily",
      "Shops where the visit, not the order, is the real conversion",
      "Ranges short enough to read in one scroll",
    ],
    avoidWhen: [
      "The range runs to hundreds of stable grocery lines",
      "There is no usable product photography at all",
      "Provenance copy matters more than the day's list",
    ],
    capabilities: {
      categoryNavigation: false,
      productSearch: false,
      stickyOrderAction: true,
      imageEmphasis: true,
      provenanceEmphasis: false,
    },
    safeDefaultTokens: foodRetailThemeTokensSchema.parse({
      colors: {
        background: "#fffaf2",
        foreground: "#1c140c",
        surface: "#f6ead8",
        accent: "#b4531b",
        accentForeground: "#ffffff",
      },
      style: {
        fontPair: "grotesk",
        density: "compact",
        radius: "soft",
        imageTreatment: "natural",
      },
    }),
    aiBrief:
      "Choose for bakeries and patisseries with a short daily range, real product photography and a visit-or-collect primary action.",
  },
  "craft-counter": {
    id: "craft-counter",
    rendererVersion: FOOD_RETAIL_THEME_RENDERER_VERSION,
    name: "Craft Counter",
    description:
      "An editorial, provenance-led shopfront for butchers, delis and cheesemongers, where the origin of a product carries as much weight as the price.",
    featuredRank: 2,
    marketReferences: [
      "Shopify Craft — asymmetric story blocks, the maker photo larger than the product",
      "Shopify Craft — small caps reserved for provenance and origin labels",
    ],
    experience: { primaryIntent: "browse", catalogExperience: "showcase" },
    fitSignals: {
      fulfillmentModels: ["counter", "click-collect"],
      primaryIntents: ["browse", "visit"],
      catalogExperiences: ["showcase"],
      brandTraits: ["craft", "rustic", "classic"],
      pricePositions: ["midmarket", "premium"],
      photographyQualities: ["limited", "strong"],
      rangeVolatilities: ["seasonal", "stable"],
      multipleLocations: false,
    },
    avoidanceSignals: {
      fulfillmentModels: ["delivery"],
      primaryIntents: ["order"],
      catalogExperiences: ["aisles"],
      photographyQualities: ["none"],
      rangeVolatilities: ["daily"],
    },
    bestFor: [
      "Butchers, delis and cheesemongers selling on provenance",
      "Shops charging above the local average and needing to justify it",
      "Ranges that change with the season rather than the day",
    ],
    avoidWhen: [
      "Speed of ordering matters more than the story",
      "The range is a broad practical grocery list",
      "There is no photography to carry an editorial layout",
    ],
    capabilities: {
      categoryNavigation: true,
      productSearch: false,
      stickyOrderAction: false,
      imageEmphasis: true,
      provenanceEmphasis: true,
    },
    safeDefaultTokens: foodRetailThemeTokensSchema.parse({
      colors: {
        background: "#f7f3ec",
        foreground: "#1a120a",
        surface: "#ece4d7",
        accent: "#6f4b2a",
        accentForeground: "#ffffff",
      },
      style: {
        fontPair: "editorial",
        density: "balanced",
        radius: "none",
        imageTreatment: "editorial",
      },
    }),
    aiBrief:
      "Choose for butchers, delis and cheesemongers whose sourcing and craft are the selling argument and whose range turns over seasonally.",
  },
  "market-shelves": {
    id: "market-shelves",
    rendererVersion: FOOD_RETAIL_THEME_RENDERER_VERSION,
    name: "Market Shelves",
    description:
      "A calm, category-first layout for grocers and general food shops with a broad stable range and uneven or missing product photography.",
    featuredRank: 3,
    marketReferences: [
      "Shopify Symmetry — mosaic category grid with mixed tile sizes, so a weak photo takes a small tile",
      "Shopify Local — deep green keeps a grocery palette from reading as discount",
    ],
    experience: { primaryIntent: "browse", catalogExperience: "aisles" },
    fitSignals: {
      fulfillmentModels: ["counter", "click-collect", "delivery"],
      primaryIntents: ["browse", "order"],
      catalogExperiences: ["aisles"],
      brandTraits: ["minimal", "modern", "classic"],
      pricePositions: ["value", "midmarket"],
      photographyQualities: ["none", "limited", "strong"],
      rangeVolatilities: ["stable", "seasonal"],
      multipleLocations: true,
    },
    avoidanceSignals: {
      fulfillmentModels: [],
      primaryIntents: [],
      catalogExperiences: ["daily-list"],
      photographyQualities: [],
      rangeVolatilities: ["daily"],
    },
    bestFor: [
      "Grocers and general food shops with many categories",
      "Shops with little or inconsistent product photography",
      "Businesses running more than one location",
    ],
    avoidWhen: [
      "The range is short enough to read as one daily list",
      "Provenance storytelling is the point of the shop",
      "Every product has strong photography worth showing large",
    ],
    capabilities: {
      categoryNavigation: true,
      productSearch: true,
      stickyOrderAction: false,
      imageEmphasis: false,
      provenanceEmphasis: false,
    },
    safeDefaultTokens: foodRetailThemeTokensSchema.parse({
      colors: {
        background: "#ffffff",
        foreground: "#141414",
        surface: "#eef0ec",
        accent: "#1f5132",
        accentForeground: "#ffffff",
      },
      style: {
        fontPair: "grotesk",
        density: "balanced",
        radius: "soft",
        imageTreatment: "graphic",
      },
    }),
    aiBrief:
      "Choose for grocers and general food shops with a broad stable range, many categories and weak or uneven photography.",
  },
} satisfies Record<FoodRetailThemeId, FoodRetailThemeManifest>;

export function listFoodRetailThemeManifests(): FoodRetailThemeManifest[] {
  return Object.values(manifests);
}

/** Homepage `#themes` — exactly the three featured ranks, in order. */
export function listFeaturedFoodRetailThemeManifests(): FoodRetailThemeManifest[] {
  return listFoodRetailThemeManifests()
    .filter(
      (
        manifest,
      ): manifest is FoodRetailThemeManifest & { featuredRank: 1 | 2 | 3 } =>
        manifest.featuredRank !== null,
    )
    .sort((left, right) => left.featuredRank - right.featuredRank);
}

export function getFoodRetailThemeManifest(
  id: FoodRetailThemeId,
): FoodRetailThemeManifest {
  return manifests[id];
}

export function findFoodRetailThemeManifest(
  id: string,
): FoodRetailThemeManifest | null {
  if (!Object.hasOwn(manifests, id)) return null;
  return (manifests as Record<string, FoodRetailThemeManifest>)[id] ?? null;
}
