import {
  FOOD_RETAIL_THEME_RENDERER_VERSION,
  FOOD_RETAIL_THEME_SCHEMA_VERSION,
  foodRetailAiThemeOutputSchema,
  foodRetailDesignProfileSchema,
  foodRetailThemeSelectionSchema,
  type FoodRetailAiThemeOutput,
  type FoodRetailDesignProfile,
  type FoodRetailThemeId,
  type FoodRetailThemeSelection,
} from "@/lib/site-themes/food-retail/contracts";
import {
  findFoodRetailThemeManifest,
  getFoodRetailThemeManifest,
  listFoodRetailThemeManifests,
  type FoodRetailThemeManifest,
} from "@/lib/site-themes/food-retail/registry";
import { mergeFoodRetailThemeTokens } from "@/lib/site-themes/food-retail/tokens";
import {
  includesValue,
  rankThemes,
  resolveDeterministicRanking,
  type ScoredTheme as ScoredThemeEntry,
  type ThemeScoreRule,
} from "@/lib/site-themes/shared/scoring";

export const DEFAULT_FOOD_RETAIL_DESIGN_PROFILE =
  foodRetailDesignProfileSchema.parse({
    fulfillmentModel: "counter",
    primaryIntent: "browse",
    catalogExperience: "aisles",
    brandTraits: ["classic", "minimal"],
    pricePosition: "midmarket",
    locationCount: 1,
    photographyQuality: "limited",
    rangeVolatility: "stable",
  });

type ScoredTheme = ScoredThemeEntry<FoodRetailThemeManifest>;

function matchingBrandTraits(
  manifest: FoodRetailThemeManifest,
  profile: FoodRetailDesignProfile,
): FoodRetailDesignProfile["brandTraits"] {
  return profile.brandTraits.filter((trait) =>
    includesValue(manifest.fitSignals.brandTraits, trait),
  );
}

/**
 * The food-retail weight table. Rule order is load-bearing: reasons are
 * collected in rule order and capped, so the strongest signals are the ones a
 * customer sees on the preview.
 *
 * `rangeVolatility` is weighted alongside the catalog experience rather than
 * below it. How fast the published range goes stale is the signal that
 * separates a bakery rewriting its counter every morning from a grocer whose
 * aisles hold for months, and the two want different catalog rhythms even when
 * every other signal agrees.
 */
const FOOD_RETAIL_THEME_SCORE_RULES: readonly ThemeScoreRule<
  FoodRetailThemeManifest,
  FoodRetailDesignProfile
>[] = [
  {
    weight: 6,
    count: (manifest, profile) =>
      includesValue(
        manifest.fitSignals.fulfillmentModels,
        profile.fulfillmentModel,
      ),
    reason: (_manifest, profile) =>
      `Fits the ${profile.fulfillmentModel.replaceAll("-", " ")} model`,
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
        manifest.fitSignals.catalogExperiences,
        profile.catalogExperience,
      ),
    reason: (_manifest, profile) =>
      `Supports a ${profile.catalogExperience.replaceAll("-", " ")} catalog`,
  },
  {
    weight: 4,
    count: (manifest, profile) =>
      includesValue(
        manifest.fitSignals.rangeVolatilities,
        profile.rangeVolatility,
      ),
    reason: (_manifest, profile) =>
      `Built for a ${profile.rangeVolatility} product range`,
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
        manifest.avoidanceSignals.fulfillmentModels,
        profile.fulfillmentModel,
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
        manifest.avoidanceSignals.catalogExperiences,
        profile.catalogExperience,
      ),
  },
  {
    weight: -4,
    count: (manifest, profile) =>
      includesValue(
        manifest.avoidanceSignals.rangeVolatilities,
        profile.rangeVolatility,
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

export function scoreFoodRetailThemes(
  input: FoodRetailDesignProfile,
): ScoredTheme[] {
  const profile = foodRetailDesignProfileSchema.parse(input);
  return rankThemes(
    listFoodRetailThemeManifests(),
    profile,
    FOOD_RETAIL_THEME_SCORE_RULES,
  );
}

function resolvedSelection(
  input: FoodRetailAiThemeOutput,
  source: "ai" | "deterministic" | "owner",
): FoodRetailThemeSelection {
  const manifest = getFoodRetailThemeManifest(input.themeId);
  return foodRetailThemeSelectionSchema.parse({
    schemaVersion: FOOD_RETAIL_THEME_SCHEMA_VERSION,
    themeId: input.themeId,
    rendererVersion: FOOD_RETAIL_THEME_RENDERER_VERSION,
    source,
    confidence: input.confidence,
    reasons: input.reasons,
    alternatives: input.alternatives,
    tokens: mergeFoodRetailThemeTokens(manifest.safeDefaultTokens, input.tokens),
  });
}

export function selectDeterministicFoodRetailTheme(
  input: FoodRetailDesignProfile,
): FoodRetailThemeSelection {
  const profile = foodRetailDesignProfileSchema.parse(input);
  const {
    winner,
    alternatives: alternativeManifests,
    confidence,
  } = resolveDeterministicRanking(
    listFoodRetailThemeManifests(),
    profile,
    FOOD_RETAIL_THEME_SCORE_RULES,
    "Food retail theme selection requires at least three registered themes",
  );
  const alternatives: [FoodRetailThemeId, FoodRetailThemeId] = [
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
          : ["Uses the safest fit for the available food retail signals"],
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
export function selectFoodRetailTheme(
  profileInput: FoodRetailDesignProfile,
  aiOutput: unknown,
): FoodRetailThemeSelection {
  const profile = foodRetailDesignProfileSchema.parse(profileInput);
  const parsed = foodRetailAiThemeOutputSchema.safeParse(aiOutput);
  return parsed.success
    ? resolvedSelection(parsed.data, "ai")
    : selectDeterministicFoodRetailTheme(profile);
}

/**
 * Converts an owner choice into the same closed, versioned contract used by
 * automatic selection. Tokens always come from the registered theme manifest;
 * the dashboard can choose a renderer, but it cannot smuggle arbitrary style
 * values into the public site.
 */
export function selectOwnerFoodRetailTheme(
  profileInput: FoodRetailDesignProfile | undefined,
  themeId: FoodRetailThemeId,
): FoodRetailThemeSelection {
  const profile =
    foodRetailDesignProfileSchema.safeParse(profileInput).data ??
    DEFAULT_FOOD_RETAIL_DESIGN_PROFILE;
  const automatic = selectDeterministicFoodRetailTheme(profile);
  const alternatives = [automatic.themeId, ...automatic.alternatives].filter(
    (candidate) => candidate !== themeId,
  );
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
      reasons: ["Selected explicitly by the shop owner"],
      alternatives: [firstAlternative, secondAlternative],
      tokens: {},
    },
    "owner",
  );
}

/**
 * The closed shortlist a preview surface may offer: the recorded theme first,
 * then the two alternatives the same selection run named.
 */
export function foodRetailThemeOptions(
  selection: FoodRetailThemeSelection,
): FoodRetailThemeId[] {
  return [selection.themeId, ...selection.alternatives];
}

/**
 * Rotates a recorded selection onto one of the alternatives it already names.
 *
 * The option set is closed on purpose: a crafted query string can only reach a
 * theme this selection already shortlisted, and tokens always come back from
 * the registry manifest, so the switcher cannot introduce a renderer or a style
 * value the site was never offered. Only `themeId`, `alternatives` and `tokens`
 * move; `source`, `confidence` and `reasons` keep describing the selection run
 * that produced the shortlist.
 */
export function previewFoodRetailThemeAlternate(
  selection: FoodRetailThemeSelection,
  themeId: FoodRetailThemeId,
): FoodRetailThemeSelection | null {
  const options = foodRetailThemeOptions(selection);
  if (!options.includes(themeId)) return null;
  if (themeId === selection.themeId) return selection;
  const [firstAlternative, secondAlternative] = options.filter(
    (candidate) => candidate !== themeId,
  );
  if (!firstAlternative || !secondAlternative) return null;

  return foodRetailThemeSelectionSchema.parse({
    ...selection,
    themeId,
    alternatives: [firstAlternative, secondAlternative],
    tokens: mergeFoodRetailThemeTokens(
      getFoodRetailThemeManifest(themeId).safeDefaultTokens,
    ),
  });
}

export function restoreAutomaticFoodRetailTheme(
  profileInput: FoodRetailDesignProfile | undefined,
): FoodRetailThemeSelection {
  return selectDeterministicFoodRetailTheme(
    foodRetailDesignProfileSchema.safeParse(profileInput).data ??
      DEFAULT_FOOD_RETAIL_DESIGN_PROFILE,
  );
}

/**
 * Compatibility is deliberately nullable. Missing or malformed structured
 * selection means "use the existing shop-type template", not "silently move
 * this customer onto the new default theme".
 */
export function parseFoodRetailThemeSelection(
  input: unknown,
): FoodRetailThemeSelection | null {
  const parsed = foodRetailThemeSelectionSchema.safeParse(input);
  if (!parsed.success) return null;
  const manifest = findFoodRetailThemeManifest(parsed.data.themeId);
  if (!manifest || manifest.rendererVersion !== parsed.data.rendererVersion) {
    return null;
  }
  return {
    ...parsed.data,
    tokens: mergeFoodRetailThemeTokens(
      manifest.safeDefaultTokens,
      parsed.data.tokens,
    ),
  };
}

export function normalizeGeneratedFoodRetailThemeSelection(
  profileInput: FoodRetailDesignProfile | undefined,
  generatedSelection: unknown,
): {
  designProfile: FoodRetailDesignProfile;
  themeSelection: FoodRetailThemeSelection;
} {
  const profile =
    foodRetailDesignProfileSchema.safeParse(profileInput).data ??
    DEFAULT_FOOD_RETAIL_DESIGN_PROFILE;
  const parsed = foodRetailThemeSelectionSchema.safeParse(generatedSelection);
  if (!parsed.success) {
    return {
      designProfile: profile,
      themeSelection: selectDeterministicFoodRetailTheme(profile),
    };
  }

  return {
    designProfile: profile,
    themeSelection: selectFoodRetailTheme(profile, {
      themeId: parsed.data.themeId,
      confidence: parsed.data.confidence,
      reasons: parsed.data.reasons,
      alternatives: parsed.data.alternatives,
      tokens: parsed.data.tokens,
    }),
  };
}
