import {
  RESTAURANT_THEME_RENDERER_VERSION,
  restaurantThemeTokensSchema,
  type RestaurantBrandTrait,
  type RestaurantMenuExperience,
  type RestaurantPhotographyQuality,
  type RestaurantPricePosition,
  type RestaurantPrimaryIntent,
  type RestaurantServiceModel,
  type RestaurantThemeId,
  type RestaurantThemeTokens,
} from "@/lib/site-themes/restaurant/contracts";

export type RestaurantThemeCapabilities = {
  categoryNavigation: boolean;
  menuSearch: boolean;
  stickyOrderAction: boolean;
  reservationEmphasis: boolean;
  eventsEmphasis: boolean;
};

export type RestaurantThemeManifest = {
  id: RestaurantThemeId;
  rendererVersion: typeof RESTAURANT_THEME_RENDERER_VERSION;
  name: string;
  description: string;
  /**
   * Homepage `#themes` shows only ranks 1–3. Everything else stays in the full
   * `/themes` gallery. Ranked themes are the strongest general fits; the rest
   * cover narrower service models.
   */
  featuredRank: 1 | 2 | 3 | null;
  /**
   * Internal design references only — patterns observed in highly reviewed
   * WordPress / Shopify restaurant themes. Never copied; never shown as
   * affiliate or "based on" claims in customer UI.
   */
  marketReferences: string[];
  previewFixtureId: string;
  experience: {
    primaryIntent: RestaurantPrimaryIntent;
    menuExperience: RestaurantMenuExperience;
  };
  fitSignals: {
    serviceModels: RestaurantServiceModel[];
    primaryIntents: RestaurantPrimaryIntent[];
    menuExperiences: RestaurantMenuExperience[];
    brandTraits: RestaurantBrandTrait[];
    pricePositions: RestaurantPricePosition[];
    photographyQualities: RestaurantPhotographyQuality[];
    multipleLocations: boolean;
  };
  avoidanceSignals: {
    serviceModels: RestaurantServiceModel[];
    primaryIntents: RestaurantPrimaryIntent[];
    menuExperiences: RestaurantMenuExperience[];
    photographyQualities: RestaurantPhotographyQuality[];
  };
  bestFor: string[];
  avoidWhen: string[];
  capabilities: RestaurantThemeCapabilities;
  safeDefaultTokens: RestaurantThemeTokens;
  aiBrief: string;
};

const manifests = {
  "terroir-editorial": {
    id: "terroir-editorial",
    rendererVersion: RESTAURANT_THEME_RENDERER_VERSION,
    name: "Terroir Editorial",
    description:
      "A quiet reservation-led story for destination dining, seasonal menus and strong photography.",
    featuredRank: 1,
    marketReferences: [
      "ThemeForest Rosa 2 / Attika fine-dining demos — editorial hero, short menu, reservation primacy",
      "CaseThemes Savour — premium dining room storytelling without commerce chrome",
    ],
    previewFixtureId: "maison-serein",
    experience: {
      primaryIntent: "reserve",
      menuExperience: "editorial",
    },
    fitSignals: {
      serviceModels: ["fine-dining", "full-service"],
      primaryIntents: ["reserve", "visit"],
      menuExperiences: ["editorial", "catalog"],
      brandTraits: ["classic", "craft", "minimal"],
      pricePositions: ["midmarket", "premium"],
      photographyQualities: ["limited", "strong"],
      multipleLocations: false,
    },
    avoidanceSignals: {
      serviceModels: ["fast-casual", "takeaway"],
      primaryIntents: ["order"],
      menuExperiences: ["commerce"],
      photographyQualities: ["none"],
    },
    bestFor: [
      "Chef-led and seasonal restaurants",
      "Short tasting or à la carte menus",
      "Reservation and place-led storytelling",
    ],
    avoidWhen: [
      "Ordering is the main customer action",
      "The menu needs dense product browsing",
      "There is no usable restaurant photography",
    ],
    capabilities: {
      categoryNavigation: false,
      menuSearch: false,
      stickyOrderAction: false,
      reservationEmphasis: true,
      eventsEmphasis: false,
    },
    safeDefaultTokens: restaurantThemeTokensSchema.parse({
      colors: {
        background: "#f2eee4",
        foreground: "#20231f",
        surface: "#e4ded0",
        accent: "#7f3f2e",
        accentForeground: "#ffffff",
      },
      style: {
        fontPair: "editorial",
        density: "airy",
        radius: "none",
        imageTreatment: "natural",
      },
    }),
    aiBrief:
      "Choose for reservation-led destination dining with restrained copy, seasonal menus and credible photography.",
  },
  "counter-service": {
    id: "counter-service",
    rendererVersion: RESTAURANT_THEME_RENDERER_VERSION,
    name: "Counter Service",
    description:
      "A bright order-first storefront for fast menus, collection and external delivery handoff.",
    featuredRank: 2,
    marketReferences: [
      "Shopify Pesto / Stish — category chips, sticky order CTA, fast-casual conversion",
      "CaseThemes Wellfood — takeaway and delivery handoff without fake cart checkout",
    ],
    previewFixtureId: "fold-pizza",
    experience: {
      primaryIntent: "order",
      menuExperience: "commerce",
    },
    fitSignals: {
      serviceModels: ["fast-casual", "cafe-bakery", "takeaway"],
      primaryIntents: ["order", "visit"],
      menuExperiences: ["commerce", "catalog"],
      brandTraits: ["playful", "energetic", "craft"],
      pricePositions: ["value", "midmarket"],
      photographyQualities: ["none", "limited", "strong"],
      multipleLocations: true,
    },
    avoidanceSignals: {
      serviceModels: ["fine-dining"],
      primaryIntents: ["reserve"],
      menuExperiences: ["editorial"],
      photographyQualities: [],
    },
    bestFor: [
      "Fast casual, takeaway and counter service",
      "Menus customers browse before ordering",
      "Existing collection or delivery providers",
    ],
    avoidWhen: [
      "Reservations are the primary conversion",
      "The menu is intentionally short and editorial",
      "The restaurant needs a quiet luxury tone",
    ],
    capabilities: {
      categoryNavigation: true,
      menuSearch: false,
      stickyOrderAction: true,
      reservationEmphasis: false,
      eventsEmphasis: false,
    },
    safeDefaultTokens: restaurantThemeTokensSchema.parse({
      colors: {
        background: "#fff7df",
        foreground: "#172118",
        surface: "#ffffff",
        accent: "#d13a22",
        accentForeground: "#ffffff",
      },
      style: {
        fontPair: "grotesk",
        density: "compact",
        radius: "round",
        imageTreatment: "graphic",
      },
    }),
    aiBrief:
      "Choose for fast-casual or takeaway restaurants where customers need category browsing and a clear external order handoff.",
  },
  "after-dark": {
    id: "after-dark",
    rendererVersion: RESTAURANT_THEME_RENDERER_VERSION,
    name: "After Dark",
    description:
      "An atmospheric late-night stage for bars, dining rooms, reservations and event-led visits.",
    featuredRank: 3,
    marketReferences: [
      "ThemeForest Laurent / Delicioz bar demos — dark cinematic hero, events strip, late menu",
      "Savory nightlife presets — reservation + programme without daytime cafe cues",
    ],
    previewFixtureId: "nightjar-room",
    experience: {
      primaryIntent: "reserve",
      menuExperience: "catalog",
    },
    fitSignals: {
      serviceModels: ["bar-nightlife", "full-service"],
      primaryIntents: ["reserve", "visit"],
      menuExperiences: ["catalog", "editorial"],
      brandTraits: ["atmospheric", "energetic", "classic"],
      pricePositions: ["midmarket", "premium"],
      photographyQualities: ["limited", "strong"],
      multipleLocations: false,
    },
    avoidanceSignals: {
      serviceModels: ["cafe-bakery", "takeaway"],
      primaryIntents: ["order"],
      menuExperiences: ["commerce"],
      photographyQualities: ["none"],
    },
    bestFor: [
      "Cocktail bars and late-night dining",
      "Reservation, private-hire or event-led venues",
      "Atmospheric interiors and evening photography",
    ],
    avoidWhen: [
      "Daytime counter service is the core business",
      "External ordering is the main conversion",
      "Dark presentation conflicts with the real brand",
    ],
    capabilities: {
      categoryNavigation: false,
      menuSearch: false,
      stickyOrderAction: false,
      reservationEmphasis: true,
      eventsEmphasis: true,
    },
    safeDefaultTokens: restaurantThemeTokensSchema.parse({
      colors: {
        background: "#111010",
        foreground: "#f5efe4",
        surface: "#211d1c",
        accent: "#e85d3f",
        accentForeground: "#111010",
      },
      style: {
        fontPair: "condensed",
        density: "balanced",
        radius: "soft",
        imageTreatment: "cinematic",
      },
    }),
    aiBrief:
      "Choose for bars, nightlife and evening restaurants with atmospheric imagery, reservation intent and event or private-hire relevance.",
  },
  "neighborhood-table": {
    id: "neighborhood-table",
    rendererVersion: RESTAURANT_THEME_RENDERER_VERSION,
    name: "Neighborhood Table",
    description:
      "A warm full-service front door for independent restaurants: clear menu, hours, and a reservation path diners already expect.",
    featuredRank: null,
    marketReferences: [
      "ThemeForest Grand Restaurant / Linguini / Dina — classic hospitality layout, OpenTable-style reserve, catalog menu",
      "Shopify Local food presets — neighborhood trust, visit-first without luxury theatre",
    ],
    previewFixtureId: "marina-kitchen",
    experience: {
      primaryIntent: "reserve",
      menuExperience: "catalog",
    },
    fitSignals: {
      serviceModels: ["full-service"],
      primaryIntents: ["reserve", "visit"],
      menuExperiences: ["catalog"],
      brandTraits: ["classic", "craft"],
      pricePositions: ["midmarket"],
      photographyQualities: ["limited", "strong"],
      multipleLocations: false,
    },
    avoidanceSignals: {
      serviceModels: ["fine-dining", "takeaway", "bar-nightlife"],
      primaryIntents: ["order"],
      menuExperiences: ["commerce", "editorial"],
      photographyQualities: ["none"],
    },
    bestFor: [
      "Independent full-service neighbourhood restaurants",
      "Menus diners scan before booking a table",
      "Warm, familiar hospitality without luxury theatre",
    ],
    avoidWhen: [
      "Ordering or delivery is the main conversion",
      "The restaurant needs a short tasting-menu story",
      "The brand wants nightlife or cafe energy",
    ],
    capabilities: {
      categoryNavigation: false,
      menuSearch: false,
      stickyOrderAction: false,
      reservationEmphasis: true,
      eventsEmphasis: false,
    },
    safeDefaultTokens: restaurantThemeTokensSchema.parse({
      colors: {
        background: "#f7f1e8",
        foreground: "#2a241c",
        surface: "#efe6d8",
        accent: "#b54a2f",
        accentForeground: "#ffffff",
      },
      style: {
        fontPair: "editorial",
        density: "balanced",
        radius: "soft",
        imageTreatment: "natural",
      },
    }),
    aiBrief:
      "Choose for classic full-service neighbourhood dining where guests browse a full menu then reserve.",
  },
  "daylight-cafe": {
    id: "daylight-cafe",
    rendererVersion: RESTAURANT_THEME_RENDERER_VERSION,
    name: "Daylight Cafe",
    description:
      "A bright visit-first storefront for cafes, bakeries and daytime rooms—hours, specialties and a light menu people can scan quickly.",
    featuredRank: null,
    marketReferences: [
      "ThemeForest Rosa 2 cafe / bakery demos — airy photography, daytime visit intent",
      "Shopify Local cafe presets — craft goods, soft commerce without sticky order chrome",
    ],
    previewFixtureId: "harbour-loaf",
    experience: {
      primaryIntent: "visit",
      menuExperience: "catalog",
    },
    fitSignals: {
      serviceModels: ["cafe-bakery"],
      primaryIntents: ["visit", "order"],
      menuExperiences: ["catalog", "commerce"],
      brandTraits: ["craft", "minimal", "playful"],
      pricePositions: ["value", "midmarket"],
      photographyQualities: ["limited", "strong"],
      multipleLocations: true,
    },
    avoidanceSignals: {
      serviceModels: ["fine-dining", "bar-nightlife"],
      primaryIntents: ["reserve"],
      menuExperiences: ["editorial"],
      photographyQualities: [],
    },
    bestFor: [
      "Cafes, bakeries and daytime hospitality",
      "Short specialty menus and pastry cases",
      "Visit-first rooms that may also take collection orders",
    ],
    avoidWhen: [
      "Dinner reservations are the primary conversion",
      "The room is nightlife or fine dining",
      "The menu needs dense delivery browsing",
    ],
    capabilities: {
      categoryNavigation: false,
      menuSearch: false,
      stickyOrderAction: false,
      reservationEmphasis: false,
      eventsEmphasis: false,
    },
    safeDefaultTokens: restaurantThemeTokensSchema.parse({
      colors: {
        background: "#fbf7f0",
        foreground: "#3a3228",
        surface: "#ffffff",
        accent: "#c4783a",
        accentForeground: "#111111",
      },
      style: {
        fontPair: "grotesk",
        density: "airy",
        radius: "round",
        imageTreatment: "natural",
      },
    }),
    aiBrief:
      "Choose for cafes and bakeries where daytime visits matter more than evening reservations.",
  },
  "family-feast": {
    id: "family-feast",
    rendererVersion: RESTAURANT_THEME_RENDERER_VERSION,
    name: "Family Feast",
    description:
      "A clear, high-trust storefront for family restaurants and multi-location groups—full menus, easy scanning, and booking or ordering links that stay external.",
    featuredRank: null,
    marketReferences: [
      "ThemeForest Savory multi-demo approach — flexible family dining, large catalog menus",
      "Shopify Pesto multi-preset food grids — scannable sections without inventing a cart",
    ],
    previewFixtureId: "olive-branch",
    experience: {
      primaryIntent: "visit",
      menuExperience: "catalog",
    },
    fitSignals: {
      serviceModels: ["full-service", "fast-casual"],
      primaryIntents: ["visit", "reserve", "order"],
      menuExperiences: ["catalog"],
      brandTraits: ["classic", "playful", "energetic"],
      pricePositions: ["value", "midmarket"],
      photographyQualities: ["none", "limited", "strong"],
      multipleLocations: true,
    },
    avoidanceSignals: {
      serviceModels: ["fine-dining", "bar-nightlife"],
      primaryIntents: [],
      menuExperiences: ["editorial"],
      photographyQualities: [],
    },
    bestFor: [
      "Family restaurants and familiar cuisine houses",
      "Larger menus that need easy section scanning",
      "Single or multi-location groups with booking or order links",
    ],
    avoidWhen: [
      "The brand needs quiet luxury or tasting-menu storytelling",
      "Nightlife or cafe craft is the core identity",
      "Photography is the main design idea",
    ],
    capabilities: {
      categoryNavigation: false,
      menuSearch: false,
      stickyOrderAction: false,
      reservationEmphasis: true,
      eventsEmphasis: false,
    },
    safeDefaultTokens: restaurantThemeTokensSchema.parse({
      colors: {
        background: "#fffdf8",
        foreground: "#1f2a24",
        surface: "#f3eee4",
        accent: "#2f6b4f",
        accentForeground: "#ffffff",
      },
      style: {
        fontPair: "grotesk",
        density: "compact",
        radius: "soft",
        imageTreatment: "graphic",
      },
    }),
    aiBrief:
      "Choose for family restaurants and multi-location groups that need a scannable full menu and simple booking or order handoff.",
  },
  "vesper-room": {
    id: "vesper-room",
    rendererVersion: RESTAURANT_THEME_RENDERER_VERSION,
    name: "Vesper Room",
    description:
      "A slow, atmospheric room for visit-led dining where the photography and the light carry the menu.",
    featuredRank: null,
    marketReferences: [
      "ThemeForest Osteria — long-scroll editorial menu with a single quiet action",
      "ThemeForest Piquant — low-light hospitality palette and unhurried section rhythm",
    ],
    previewFixtureId: "hollow-lantern",
    experience: {
      primaryIntent: "visit",
      menuExperience: "editorial",
    },
    fitSignals: {
      serviceModels: ["fine-dining", "bar-nightlife"],
      primaryIntents: ["visit"],
      menuExperiences: ["editorial"],
      brandTraits: ["atmospheric", "minimal"],
      pricePositions: ["premium"],
      photographyQualities: ["strong"],
      multipleLocations: false,
    },
    avoidanceSignals: {
      serviceModels: ["takeaway", "fast-casual", "cafe-bakery"],
      primaryIntents: ["order"],
      menuExperiences: ["commerce"],
      photographyQualities: ["none", "limited"],
    },
    bestFor: [
      "Rooms people come to for the atmosphere first",
      "Short, written menus that read like prose",
      "Venues with genuinely strong low-light photography",
    ],
    avoidWhen: [
      "Reservations or orders are the only thing that matters",
      "The menu is long enough to need categories or search",
      "There is no usable photography of the room",
    ],
    capabilities: {
      categoryNavigation: false,
      menuSearch: false,
      stickyOrderAction: false,
      reservationEmphasis: false,
      eventsEmphasis: true,
    },
    safeDefaultTokens: restaurantThemeTokensSchema.parse({
      colors: {
        background: "#14101a",
        foreground: "#f2ece2",
        surface: "#221b2b",
        accent: "#c9a86a",
        accentForeground: "#171019",
      },
      style: {
        fontPair: "editorial",
        density: "airy",
        radius: "none",
        imageTreatment: "cinematic",
      },
    }),
    aiBrief:
      "Choose for atmosphere-led rooms and late dining where a visitor should feel the space before reading the menu, and where photography is strong enough to carry a slow scroll.",
  },
} satisfies Record<RestaurantThemeId, RestaurantThemeManifest>;

export function listRestaurantThemeManifests(): RestaurantThemeManifest[] {
  return Object.values(manifests);
}

/** Homepage `#themes` — exactly the three featured ranks, in order. */
export function listFeaturedRestaurantThemeManifests(): RestaurantThemeManifest[] {
  return listRestaurantThemeManifests()
    .filter(
      (manifest): manifest is RestaurantThemeManifest & { featuredRank: 1 | 2 | 3 } =>
        manifest.featuredRank !== null,
    )
    .sort((left, right) => left.featuredRank - right.featuredRank);
}

export function getRestaurantThemeManifest(
  id: RestaurantThemeId,
): RestaurantThemeManifest {
  return manifests[id];
}

export function findRestaurantThemeManifest(
  id: string,
): RestaurantThemeManifest | null {
  if (!Object.hasOwn(manifests, id)) return null;
  return (manifests as Record<string, RestaurantThemeManifest>)[id] ?? null;
}
