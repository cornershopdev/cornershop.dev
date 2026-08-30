import {
  RESTAURANT_THEME_RENDERER_VERSION,
  RESTAURANT_THEME_SCHEMA_VERSION,
  restaurantAiThemeOutputSchema,
  restaurantDesignProfileSchema,
  restaurantThemeSelectionSchema,
  type RestaurantAiThemeOutput,
  type RestaurantDesignProfile,
  type RestaurantThemeId,
  type RestaurantThemeSelection,
} from "@/lib/site-themes/restaurant/contracts";
import {
  findRestaurantThemeManifest,
  getRestaurantThemeManifest,
  listRestaurantThemeManifests,
  type RestaurantThemeManifest,
} from "@/lib/site-themes/restaurant/registry";
import { mergeRestaurantThemeTokens } from "@/lib/site-themes/restaurant/tokens";
import {
  includesValue,
  rankThemes,
  resolveDeterministicRanking,
  type ScoredTheme as ScoredThemeEntry,
  type ThemeScoreRule,
} from "@/lib/site-themes/shared/scoring";

export const DEFAULT_RESTAURANT_DESIGN_PROFILE =
  restaurantDesignProfileSchema.parse({
    serviceModel: "full-service",
    primaryIntent: "reserve",
    menuExperience: "catalog",
    brandTraits: ["classic", "craft"],
    pricePosition: "midmarket",
    locationCount: 1,
    photographyQuality: "limited",
  });

type ScoredTheme = ScoredThemeEntry<RestaurantThemeManifest>;

function matchingBrandTraits(
  manifest: RestaurantThemeManifest,
  profile: RestaurantDesignProfile,
): RestaurantDesignProfile["brandTraits"] {
  return profile.brandTraits.filter((trait) =>
    includesValue(manifest.fitSignals.brandTraits, trait),
  );
}

/**
 * The restaurant weight table. Rule order is load-bearing: reasons are
 * collected in rule order and capped, so the strongest signals are the ones a
 * customer sees on the preview.
 */
const RESTAURANT_THEME_SCORE_RULES: readonly ThemeScoreRule<
  RestaurantThemeManifest,
  RestaurantDesignProfile
>[] = [
  {
    weight: 6,
    count: (manifest, profile) =>
      includesValue(manifest.fitSignals.serviceModels, profile.serviceModel),
    reason: (_manifest, profile) =>
      `Fits the ${profile.serviceModel.replaceAll("-", " ")} model`,
  },
  {
    weight: 5,
    count: (manifest, profile) =>
      includesValue(manifest.fitSignals.primaryIntents, profile.primaryIntent),
    reason: (_manifest, profile) =>
      `Keeps ${profile.primaryIntent} as the primary action`,
  },
  {
    weight: 5,
    count: (manifest, profile) =>
      includesValue(
        manifest.fitSignals.menuExperiences,
        profile.menuExperience,
      ),
    reason: (_manifest, profile) =>
      `Supports a ${profile.menuExperience} menu experience`,
  },
  {
    weight: 2,
    count: (manifest, profile) => matchingBrandTraits(manifest, profile).length,
    reason: (manifest, profile) =>
      `Matches the ${matchingBrandTraits(manifest, profile).join(" and ")} brand character`,
  },
  {
    weight: 2,
    count: (manifest, profile) =>
      includesValue(manifest.fitSignals.pricePositions, profile.pricePosition),
  },
  {
    weight: 2,
    count: (manifest, profile) =>
      includesValue(
        manifest.fitSignals.photographyQualities,
        profile.photographyQuality,
      ),
  },
  {
    weight: 1,
    count: (manifest, profile) =>
      profile.locationCount > 1 && manifest.fitSignals.multipleLocations,
  },
  {
    weight: -7,
    count: (manifest, profile) =>
      includesValue(
        manifest.avoidanceSignals.serviceModels,
        profile.serviceModel,
      ),
  },
  {
    weight: -6,
    count: (manifest, profile) =>
      includesValue(
        manifest.avoidanceSignals.primaryIntents,
        profile.primaryIntent,
      ),
  },
  {
    weight: -6,
    count: (manifest, profile) =>
      includesValue(
        manifest.avoidanceSignals.menuExperiences,
        profile.menuExperience,
      ),
  },
  {
    weight: -3,
    count: (manifest, profile) =>
      includesValue(
        manifest.avoidanceSignals.photographyQualities,
        profile.photographyQuality,
      ),
  },
];

export function scoreRestaurantThemes(
  input: RestaurantDesignProfile,
): ScoredTheme[] {
  const profile = restaurantDesignProfileSchema.parse(input);
  return rankThemes(
    listRestaurantThemeManifests(),
    profile,
    RESTAURANT_THEME_SCORE_RULES,
  );
}

function resolvedSelection(
  input: RestaurantAiThemeOutput,
  source: "ai" | "deterministic" | "owner",
): RestaurantThemeSelection {
  const manifest = getRestaurantThemeManifest(input.themeId);
  return restaurantThemeSelectionSchema.parse({
    schemaVersion: RESTAURANT_THEME_SCHEMA_VERSION,
    themeId: input.themeId,
    rendererVersion: RESTAURANT_THEME_RENDERER_VERSION,
    source,
    confidence: input.confidence,
    reasons: input.reasons,
    alternatives: input.alternatives,
    tokens: mergeRestaurantThemeTokens(
      manifest.safeDefaultTokens,
      input.tokens,
    ),
  });
}

export function selectDeterministicRestaurantTheme(
  input: RestaurantDesignProfile,
): RestaurantThemeSelection {
  const profile = restaurantDesignProfileSchema.parse(input);
  const { winner, alternatives: alternativeManifests, confidence } =
    resolveDeterministicRanking(
      listRestaurantThemeManifests(),
      profile,
      RESTAURANT_THEME_SCORE_RULES,
      "Restaurant theme selection requires at least three registered themes",
    );
  const alternatives: [RestaurantThemeId, RestaurantThemeId] = [
    alternativeManifests[0].id,
    alternativeManifests[1].id,
  ];
  return resolvedSelection(
    {
      themeId: winner.manifest.id,
      confidence,
      reasons:
        winner.reasons.length > 0
          ? winner.reasons
          : ["Uses the safest fit for the available restaurant signals"],
      alternatives,
      tokens: {},
    },
    "deterministic",
  );
}

/**
 * The model never selects a renderer directly. It can only submit the closed
 * output schema; anything else falls back to the same deterministic scorer used
 * when no model is configured.
 */
export function selectRestaurantTheme(
  profileInput: RestaurantDesignProfile,
  aiOutput: unknown,
): RestaurantThemeSelection {
  const profile = restaurantDesignProfileSchema.parse(profileInput);
  const parsed = restaurantAiThemeOutputSchema.safeParse(aiOutput);
  return parsed.success
    ? resolvedSelection(parsed.data, "ai")
    : selectDeterministicRestaurantTheme(profile);
}

/**
 * Converts an owner choice into the same closed, versioned contract used by
 * automatic selection. Tokens always come from the registered theme manifest;
 * the dashboard can choose a renderer, but it cannot smuggle arbitrary style
 * values into the public site.
 */
export function selectOwnerRestaurantTheme(
  profileInput: RestaurantDesignProfile | undefined,
  themeId: RestaurantThemeId,
): RestaurantThemeSelection {
  const profile =
    restaurantDesignProfileSchema.safeParse(profileInput).data ??
    DEFAULT_RESTAURANT_DESIGN_PROFILE;
  const automatic = selectDeterministicRestaurantTheme(profile);
  const alternatives = [
    automatic.themeId,
    ...automatic.alternatives,
  ].filter((candidate) => candidate !== themeId);
  const [firstAlternative, secondAlternative] = alternatives;
  if (!firstAlternative || !secondAlternative) {
    throw new Error(
      "Owner theme selection requires at least three registered themes",
    );
  }

  return resolvedSelection(
    {
      themeId,
      confidence: 1,
      reasons: ["Selected explicitly by the restaurant owner"],
      alternatives: [firstAlternative, secondAlternative],
      tokens: {},
    },
    "owner",
  );
}

export function restoreAutomaticRestaurantTheme(
  profileInput: RestaurantDesignProfile | undefined,
): RestaurantThemeSelection {
  const profile =
    restaurantDesignProfileSchema.safeParse(profileInput).data ??
    DEFAULT_RESTAURANT_DESIGN_PROFILE;
  return selectDeterministicRestaurantTheme(profile);
}

/**
 * Compatibility is deliberately nullable. Missing or malformed structured
 * selection means "use the existing cuisine-era renderer", not "silently move
 * this customer onto the new default theme".
 */
export function parseRestaurantThemeSelection(
  input: unknown,
): RestaurantThemeSelection | null {
  const parsed = restaurantThemeSelectionSchema.safeParse(input);
  if (!parsed.success) return null;
  const manifest = findRestaurantThemeManifest(parsed.data.themeId);
  if (!manifest || manifest.rendererVersion !== parsed.data.rendererVersion) {
    return null;
  }
  return {
    ...parsed.data,
    tokens: mergeRestaurantThemeTokens(
      manifest.safeDefaultTokens,
      parsed.data.tokens,
    ),
  };
}

export function normalizeGeneratedRestaurantThemeSelection(
  profileInput: RestaurantDesignProfile | undefined,
  generatedSelection: unknown,
): {
  designProfile: RestaurantDesignProfile;
  themeSelection: RestaurantThemeSelection;
} {
  const profile =
    restaurantDesignProfileSchema.safeParse(profileInput).data ??
    DEFAULT_RESTAURANT_DESIGN_PROFILE;
  const parsed = restaurantThemeSelectionSchema.safeParse(generatedSelection);
  if (!parsed.success) {
    return {
      designProfile: profile,
      themeSelection: selectDeterministicRestaurantTheme(profile),
    };
  }

  return {
    designProfile: profile,
    themeSelection: selectRestaurantTheme(profile, {
      themeId: parsed.data.themeId,
      confidence: parsed.data.confidence,
      reasons: parsed.data.reasons,
      alternatives: parsed.data.alternatives,
      tokens: parsed.data.tokens,
    }),
  };
}
