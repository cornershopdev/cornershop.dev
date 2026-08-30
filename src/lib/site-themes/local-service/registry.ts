import {
  LOCAL_SERVICE_THEME_RENDERER_VERSION,
  localServiceThemeTokensSchema,
  type LocalServiceBrandTrait,
  type LocalServiceCatalogExperience,
  type LocalServiceEngagementModel,
  type LocalServicePhotographyQuality,
  type LocalServicePrimaryIntent,
  type LocalServiceThemeId,
  type LocalServiceThemeTokens,
} from "@/lib/site-themes/local-service/contracts";

export type LocalServiceThemeCapabilities = {
  stickyContactAction: boolean;
  projectEmphasis: boolean;
  trustEmphasis: boolean;
};

export type LocalServiceThemeManifest = {
  id: LocalServiceThemeId;
  rendererVersion: typeof LOCAL_SERVICE_THEME_RENDERER_VERSION;
  name: string;
  description: string;
  featuredRank: 1 | 2 | 3;
  marketReferences: string[];
  experience: {
    primaryIntent: LocalServicePrimaryIntent;
    catalogExperience: LocalServiceCatalogExperience;
  };
  fitSignals: {
    engagementModels: LocalServiceEngagementModel[];
    primaryIntents: LocalServicePrimaryIntent[];
    catalogExperiences: LocalServiceCatalogExperience[];
    brandTraits: LocalServiceBrandTrait[];
    photographyQualities: LocalServicePhotographyQuality[];
    multipleLocations: boolean;
  };
  avoidanceSignals: {
    engagementModels: LocalServiceEngagementModel[];
    primaryIntents: LocalServicePrimaryIntent[];
    catalogExperiences: LocalServiceCatalogExperience[];
    photographyQualities: LocalServicePhotographyQuality[];
  };
  bestFor: string[];
  avoidWhen: string[];
  capabilities: LocalServiceThemeCapabilities;
  safeDefaultTokens: LocalServiceThemeTokens;
  aiBrief: string;
};

const manifests = {
  "direct-response": {
    id: "direct-response",
    rendererVersion: LOCAL_SERVICE_THEME_RENDERER_VERSION,
    name: "Direct Response",
    description:
      "A crisp, action-first service page that puts the job list and contact route ahead of decorative storytelling.",
    featuredRank: 1,
    marketReferences: [
      "Highly rated trade-service themes — split hero, immediate phone or quote action, compact service rows",
      "Government service patterns — high contrast, explicit labels and minimal decorative ambiguity",
    ],
    experience: { primaryIntent: "contact", catalogExperience: "service-list" },
    fitSignals: {
      engagementModels: ["callout", "scheduled"],
      primaryIntents: ["contact", "quote"],
      catalogExperiences: ["service-list"],
      brandTraits: ["technical", "bold", "minimal"],
      photographyQualities: ["none", "limited"],
      multipleLocations: true,
    },
    avoidanceSignals: {
      engagementModels: ["project"],
      primaryIntents: ["browse"],
      catalogExperiences: ["portfolio"],
      photographyQualities: ["strong"],
    },
    bestFor: [
      "Repair and callout trades with a short service list",
      "Businesses whose phone, message or quote route is the conversion",
      "Sites with little usable project photography",
    ],
    avoidWhen: [
      "Completed work is the strongest sales proof",
      "Visitors need a slower credentials-led introduction",
      "The business is commissioned for long visual projects",
    ],
    capabilities: {
      stickyContactAction: true,
      projectEmphasis: false,
      trustEmphasis: false,
    },
    safeDefaultTokens: localServiceThemeTokensSchema.parse({
      colors: {
        background: "#f6f7f8",
        foreground: "#14202b",
        surface: "#e7edf1",
        accent: "#c74620",
        accentForeground: "#ffffff",
      },
      style: {
        fontPair: "condensed",
        density: "compact",
        radius: "soft",
        imageTreatment: "graphic",
      },
    }),
    aiBrief:
      "Choose for direct, contact-led trades with a concise service list and weak or missing project photography.",
  },
  "trusted-local": {
    id: "trusted-local",
    rendererVersion: LOCAL_SERVICE_THEME_RENDERER_VERSION,
    name: "Trusted Local",
    description:
      "A calm, established layout that gives service coverage, credentials and business-backed trust signals room to breathe.",
    featuredRank: 2,
    marketReferences: [
      "Established local-business themes — restrained card hero, service columns and visible proof blocks",
      "Professional-services layouts — quiet navy and warm paper surfaces with one measured action",
    ],
    experience: { primaryIntent: "quote", catalogExperience: "proof-led" },
    fitSignals: {
      engagementModels: ["scheduled", "callout"],
      primaryIntents: ["quote", "contact"],
      catalogExperiences: ["proof-led", "service-list"],
      brandTraits: ["trusted", "established", "minimal"],
      photographyQualities: ["none", "limited", "strong"],
      multipleLocations: true,
    },
    avoidanceSignals: {
      engagementModels: [],
      primaryIntents: ["browse"],
      catalogExperiences: ["portfolio"],
      photographyQualities: [],
    },
    bestFor: [
      "General trades with clear service areas and credentials",
      "Established businesses selling reassurance before urgency",
      "Mixed service lists with uneven photography",
    ],
    avoidWhen: [
      "A fast contact action must dominate every other element",
      "A strong visual portfolio is the main reason to hire",
      "The brand deliberately wants an editorial, craft-led mood",
    ],
    capabilities: {
      stickyContactAction: false,
      projectEmphasis: false,
      trustEmphasis: true,
    },
    safeDefaultTokens: localServiceThemeTokensSchema.parse({
      colors: {
        background: "#f5f1e8",
        foreground: "#18282d",
        surface: "#e8e0d2",
        accent: "#245c66",
        accentForeground: "#ffffff",
      },
      style: {
        fontPair: "grotesk",
        density: "balanced",
        radius: "round",
        imageTreatment: "documentary",
      },
    }),
    aiBrief:
      "Choose for established local trades where service areas, credentials and sourced trust signals should lead the decision.",
  },
  "project-led": {
    id: "project-led",
    rendererVersion: LOCAL_SERVICE_THEME_RENDERER_VERSION,
    name: "Project Led",
    description:
      "An image-forward, editorial layout for commissioned work where completed projects carry more weight than a dense service list.",
    featuredRank: 3,
    marketReferences: [
      "Architecture and maker portfolios — immersive hero, sparse typography and large project cards",
      "Craft studio themes — warm neutral palette, editorial rhythm and documentary imagery",
    ],
    experience: { primaryIntent: "browse", catalogExperience: "portfolio" },
    fitSignals: {
      engagementModels: ["project"],
      primaryIntents: ["browse", "quote"],
      catalogExperiences: ["portfolio", "proof-led"],
      brandTraits: ["craft", "established", "minimal"],
      photographyQualities: ["limited", "strong"],
      multipleLocations: false,
    },
    avoidanceSignals: {
      engagementModels: ["callout"],
      primaryIntents: ["contact"],
      catalogExperiences: ["service-list"],
      photographyQualities: ["none"],
    },
    bestFor: [
      "Builders and artisans commissioned for visible project work",
      "Businesses with approved photographs of completed work",
      "Visitors who need to assess craft before requesting a quote",
    ],
    avoidWhen: [
      "There is no source-backed project photography",
      "The work is urgent and phone-led",
      "The service list is the complete sales argument",
    ],
    capabilities: {
      stickyContactAction: false,
      projectEmphasis: true,
      trustEmphasis: true,
    },
    safeDefaultTokens: localServiceThemeTokensSchema.parse({
      colors: {
        background: "#efe9df",
        foreground: "#211d18",
        surface: "#ddd2c3",
        accent: "#76502f",
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
      "Choose for builders and artisans with genuine project imagery and a portfolio-led path to a quote.",
  },
} satisfies Record<LocalServiceThemeId, LocalServiceThemeManifest>;

export function listLocalServiceThemeManifests(): LocalServiceThemeManifest[] {
  return Object.values(manifests);
}

export function listFeaturedLocalServiceThemeManifests(): LocalServiceThemeManifest[] {
  return listLocalServiceThemeManifests().toSorted(
    (left, right) => left.featuredRank - right.featuredRank,
  );
}

export function getLocalServiceThemeManifest(
  id: LocalServiceThemeId,
): LocalServiceThemeManifest {
  return manifests[id];
}

export function findLocalServiceThemeManifest(
  id: string,
): LocalServiceThemeManifest | null {
  if (!Object.hasOwn(manifests, id)) return null;
  return (manifests as Record<string, LocalServiceThemeManifest>)[id] ?? null;
}
