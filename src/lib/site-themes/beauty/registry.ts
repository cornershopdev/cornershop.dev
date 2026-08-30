import {
  BEAUTY_THEME_RENDERER_VERSION,
  beautyThemeTokensSchema,
  type BeautyBookingModel,
  type BeautyBrandTrait,
  type BeautyCatalogExperience,
  type BeautyPhotographyQuality,
  type BeautyPricePosition,
  type BeautyPrimaryIntent,
  type BeautyThemeId,
  type BeautyThemeTokens,
} from "@/lib/site-themes/beauty/contracts";

export type BeautyThemeCapabilities = {
  categoryNavigation: boolean;
  serviceSearch: boolean;
  stickyBookingAction: boolean;
  galleryEmphasis: boolean;
  packageEmphasis: boolean;
};

/**
 * Beauty manifests carry no `previewFixtureId`. Unlike the restaurant, this
 * vertical ships no sample draft — the demo on `/create` stays a restaurant — so
 * a fixture id here would be a dangling reference rather than a preview.
 */
export type BeautyThemeManifest = {
  id: BeautyThemeId;
  rendererVersion: typeof BEAUTY_THEME_RENDERER_VERSION;
  name: string;
  description: string;
  /**
   * Homepage `#themes` shows only ranks 1–3. Everything else stays in the full
   * gallery. Ranked themes are the strongest general fits; the rest cover
   * narrower service styles.
   */
  featuredRank: 1 | 2 | 3 | null;
  /**
   * Internal design references only — patterns observed in highly reviewed
   * WordPress / Shopify beauty themes. Never copied; never shown as affiliate
   * or "based on" claims in customer UI.
   */
  marketReferences: string[];
  experience: {
    primaryIntent: BeautyPrimaryIntent;
    catalogExperience: BeautyCatalogExperience;
  };
  fitSignals: {
    bookingModels: BeautyBookingModel[];
    primaryIntents: BeautyPrimaryIntent[];
    catalogExperiences: BeautyCatalogExperience[];
    brandTraits: BeautyBrandTrait[];
    pricePositions: BeautyPricePosition[];
    photographyQualities: BeautyPhotographyQuality[];
    multipleLocations: boolean;
  };
  avoidanceSignals: {
    bookingModels: BeautyBookingModel[];
    primaryIntents: BeautyPrimaryIntent[];
    catalogExperiences: BeautyCatalogExperience[];
    photographyQualities: BeautyPhotographyQuality[];
  };
  bestFor: string[];
  avoidWhen: string[];
  capabilities: BeautyThemeCapabilities;
  safeDefaultTokens: BeautyThemeTokens;
  aiBrief: string;
};

const manifests = {
  barbershop: {
    id: "barbershop",
    rendererVersion: BEAUTY_THEME_RENDERER_VERSION,
    name: "Barbershop",
    description:
      "A dark, high-contrast shopfront for walk-in barbers with a short priced cut list and a phone-first action.",
    featuredRank: 3,
    marketReferences: [
      "ThemeForest Barberry / Barber Shop demos — dark chrome, condensed caps, price-list primacy",
      "Refresh barber layouts — walk-in hours and call action above the fold",
    ],
    experience: {
      primaryIntent: "call",
      catalogExperience: "price-list",
    },
    fitSignals: {
      bookingModels: ["walk-in", "hybrid"],
      primaryIntents: ["call", "book"],
      catalogExperiences: ["price-list"],
      brandTraits: ["classic", "craft", "energetic"],
      pricePositions: ["value", "midmarket"],
      photographyQualities: ["none", "limited"],
      multipleLocations: true,
    },
    avoidanceSignals: {
      bookingModels: [],
      primaryIntents: ["browse"],
      catalogExperiences: ["packages", "gallery"],
      photographyQualities: [],
    },
    bestFor: [
      "Walk-in barbers with a fixed cut list",
      "Shops where the phone is the real booking channel",
      "Businesses with little or no usable photography",
    ],
    avoidWhen: [
      "Treatments are sold as multi-step packages",
      "The portfolio is the main reason customers visit",
      "The brand reads calm and spa-like",
    ],
    capabilities: {
      categoryNavigation: false,
      serviceSearch: false,
      stickyBookingAction: true,
      galleryEmphasis: false,
      packageEmphasis: false,
    },
    safeDefaultTokens: beautyThemeTokensSchema.parse({
      colors: {
        background: "#16130f",
        foreground: "#f4efe6",
        surface: "#221d17",
        accent: "#c8842f",
        accentForeground: "#16130f",
      },
      style: {
        fontPair: "grotesk",
        density: "compact",
        radius: "none",
        imageTreatment: "graphic",
      },
    }),
    aiBrief:
      "Choose for walk-in barbers with a short priced cut list, direct copy and a phone or drop-in primary action.",
  },
  "classic-salon": {
    id: "classic-salon",
    rendererVersion: BEAUTY_THEME_RENDERER_VERSION,
    name: "Classic Salon",
    description:
      "A warm, established hair salon layout with categorised services, stylist credit and appointment emphasis.",
    featuredRank: 2,
    marketReferences: [
      "ThemeForest Belle / Hair Salon demos — cream paper surface, categorised price columns",
      "Sense salon layouts — appointment primacy with a quiet editorial header",
    ],
    experience: {
      primaryIntent: "book",
      catalogExperience: "price-list",
    },
    fitSignals: {
      bookingModels: ["appointment", "hybrid"],
      primaryIntents: ["book", "call"],
      catalogExperiences: ["price-list", "packages"],
      brandTraits: ["classic", "craft", "serene"],
      pricePositions: ["midmarket", "premium"],
      photographyQualities: ["none", "limited"],
      multipleLocations: true,
    },
    avoidanceSignals: {
      bookingModels: ["walk-in"],
      primaryIntents: [],
      catalogExperiences: ["gallery"],
      photographyQualities: [],
    },
    bestFor: [
      "Established hair salons with a long service list",
      "Colour and cut menus split by category",
      "Appointment-led businesses with named stylists",
    ],
    avoidWhen: [
      "The business is purely walk-in",
      "The work is sold visually rather than by price",
      "The brand is deliberately minimal and monochrome",
    ],
    capabilities: {
      categoryNavigation: true,
      serviceSearch: false,
      stickyBookingAction: true,
      galleryEmphasis: false,
      packageEmphasis: true,
    },
    safeDefaultTokens: beautyThemeTokensSchema.parse({
      colors: {
        background: "#f6f1ea",
        foreground: "#241d1b",
        surface: "#ebe2d6",
        accent: "#7a2f3b",
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
      "Choose for appointment-led hair salons with a categorised priced service list and warm, established brand language.",
  },
  "modern-studio": {
    id: "modern-studio",
    rendererVersion: BEAUTY_THEME_RENDERER_VERSION,
    name: "Modern Studio",
    description:
      "A clean, neutral studio layout that leads with work: service cards, real photography and a single booking action.",
    featuredRank: 1,
    marketReferences: [
      "Refresh studio demos — neutral ground, generous whitespace, one dominant action",
      "Shopify Symmetry beauty layouts — card catalog with image-forward service tiles",
    ],
    experience: {
      primaryIntent: "book",
      catalogExperience: "gallery",
    },
    fitSignals: {
      bookingModels: ["appointment", "hybrid"],
      primaryIntents: ["book", "browse"],
      catalogExperiences: ["gallery", "price-list"],
      brandTraits: ["minimal", "craft", "serene"],
      pricePositions: ["midmarket", "premium"],
      photographyQualities: ["limited", "strong"],
      multipleLocations: false,
    },
    avoidanceSignals: {
      bookingModels: ["walk-in"],
      primaryIntents: [],
      catalogExperiences: [],
      photographyQualities: ["none"],
    },
    bestFor: [
      "Independent studios where the work is the pitch",
      "Lash, brow, colour and skin specialists",
      "Brands that read minimal and contemporary",
    ],
    avoidWhen: [
      "There is no usable photography at all",
      "The business is a high-volume walk-in shop",
      "The service list is a long undifferentiated price sheet",
    ],
    capabilities: {
      categoryNavigation: true,
      serviceSearch: false,
      stickyBookingAction: true,
      galleryEmphasis: true,
      packageEmphasis: false,
    },
    safeDefaultTokens: beautyThemeTokensSchema.parse({
      colors: {
        background: "#fbfaf9",
        foreground: "#17181a",
        surface: "#f0efed",
        accent: "#2f5d50",
        accentForeground: "#ffffff",
      },
      style: {
        fontPair: "grotesk",
        density: "balanced",
        radius: "soft",
        imageTreatment: "editorial",
      },
    }),
    aiBrief:
      "Choose for appointment-led independent studios with credible photography and a minimal, contemporary brand.",
  },
  "spa-luxe": {
    id: "spa-luxe",
    rendererVersion: BEAUTY_THEME_RENDERER_VERSION,
    name: "Spa Luxe",
    description:
      "A calm, immersive treatment layout for spas selling bundled rituals rather than individual line items.",
    featuredRank: null,
    marketReferences: [
      "ThemeForest Spa & Wellness demos — immersive hero, long-form treatment descriptions",
      "Sense wellness layouts — bundled ritual pricing with restrained motion",
    ],
    experience: {
      primaryIntent: "book",
      catalogExperience: "packages",
    },
    fitSignals: {
      bookingModels: ["appointment"],
      primaryIntents: ["book", "browse"],
      catalogExperiences: ["packages", "gallery"],
      brandTraits: ["serene", "minimal", "classic"],
      pricePositions: ["premium"],
      photographyQualities: ["limited", "strong"],
      multipleLocations: false,
    },
    avoidanceSignals: {
      bookingModels: ["walk-in"],
      primaryIntents: ["call"],
      catalogExperiences: ["price-list"],
      photographyQualities: ["none"],
    },
    bestFor: [
      "Spas and wellness rooms selling treatment packages",
      "Long descriptions where duration matters more than price",
      "Premium, unhurried brand language",
    ],
    avoidWhen: [
      "Customers drop in without an appointment",
      "The offer is a short, cheap, fast service list",
      "There is no photography to carry an immersive hero",
    ],
    capabilities: {
      categoryNavigation: true,
      serviceSearch: false,
      stickyBookingAction: false,
      galleryEmphasis: true,
      packageEmphasis: true,
    },
    safeDefaultTokens: beautyThemeTokensSchema.parse({
      colors: {
        background: "#f2f4ef",
        foreground: "#1f2721",
        surface: "#e3e8dd",
        accent: "#41604f",
        accentForeground: "#ffffff",
      },
      style: {
        fontPair: "editorial",
        density: "airy",
        radius: "round",
        imageTreatment: "natural",
      },
    }),
    aiBrief:
      "Choose for premium appointment-only spas selling bundled treatments with calm, unhurried copy.",
  },
  "express-nails": {
    id: "express-nails",
    rendererVersion: BEAUTY_THEME_RENDERER_VERSION,
    name: "Express Nails",
    description:
      "A bright, high-energy nail bar layout built for fast browsing, walk-ins and a dense visual service grid.",
    featuredRank: null,
    marketReferences: [
      "ThemeForest Nail Studio demos — saturated accent, rounded cards, dense service grid",
      "Refresh express-service layouts — walk-in hours and fast scanning over long copy",
    ],
    experience: {
      primaryIntent: "browse",
      catalogExperience: "gallery",
    },
    fitSignals: {
      bookingModels: ["walk-in", "hybrid"],
      primaryIntents: ["browse", "call"],
      catalogExperiences: ["gallery", "price-list"],
      brandTraits: ["playful", "energetic", "craft"],
      pricePositions: ["value", "midmarket"],
      photographyQualities: ["limited", "strong"],
      multipleLocations: true,
    },
    avoidanceSignals: {
      bookingModels: [],
      primaryIntents: [],
      catalogExperiences: ["packages"],
      photographyQualities: ["none"],
    },
    bestFor: [
      "Nail bars and express beauty counters",
      "Dense, visual service grids scanned on a phone",
      "Walk-in-friendly businesses with playful branding",
    ],
    avoidWhen: [
      "The offer is premium and appointment-only",
      "Treatments need long explanatory copy",
      "There is no photography of the work",
    ],
    capabilities: {
      categoryNavigation: true,
      serviceSearch: true,
      stickyBookingAction: true,
      galleryEmphasis: true,
      packageEmphasis: false,
    },
    safeDefaultTokens: beautyThemeTokensSchema.parse({
      colors: {
        background: "#fdf6f7",
        foreground: "#23181c",
        surface: "#f7e8ec",
        accent: "#b3245c",
        accentForeground: "#ffffff",
      },
      style: {
        fontPair: "rounded",
        density: "compact",
        radius: "round",
        imageTreatment: "graphic",
      },
    }),
    aiBrief:
      "Choose for walk-in nail bars and express counters with playful branding and a dense, visual service grid.",
  },
} satisfies Record<BeautyThemeId, BeautyThemeManifest>;

export function listBeautyThemeManifests(): BeautyThemeManifest[] {
  return Object.values(manifests);
}

/** Homepage `#themes` — exactly the three featured ranks, in order. */
export function listFeaturedBeautyThemeManifests(): BeautyThemeManifest[] {
  return listBeautyThemeManifests()
    .filter(
      (manifest): manifest is BeautyThemeManifest & { featuredRank: 1 | 2 | 3 } =>
        manifest.featuredRank !== null,
    )
    .sort((left, right) => left.featuredRank - right.featuredRank);
}

export function getBeautyThemeManifest(id: BeautyThemeId): BeautyThemeManifest {
  return manifests[id];
}

export function findBeautyThemeManifest(id: string): BeautyThemeManifest | null {
  if (!Object.hasOwn(manifests, id)) return null;
  return (manifests as Record<string, BeautyThemeManifest>)[id] ?? null;
}
