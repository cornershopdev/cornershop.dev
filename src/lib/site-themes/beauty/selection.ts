import {
  BEAUTY_THEME_RENDERER_VERSION,
  BEAUTY_THEME_SCHEMA_VERSION,
  beautyAiThemeOutputSchema,
  beautyDesignProfileSchema,
  beautyThemeSelectionSchema,
  type BeautyAiThemeOutput,
  type BeautyDesignProfile,
  type BeautyThemeId,
  type BeautyThemeSelection,
} from "@/lib/site-themes/beauty/contracts";
import {
  findBeautyThemeManifest,
  getBeautyThemeManifest,
  listBeautyThemeManifests,
  type BeautyThemeManifest,
} from "@/lib/site-themes/beauty/registry";
import { mergeBeautyThemeTokens } from "@/lib/site-themes/beauty/tokens";
import {
  includesValue,
  rankThemes,
  resolveDeterministicRanking,
  type ScoredTheme as ScoredThemeEntry,
  type ThemeScoreRule,
} from "@/lib/site-themes/shared/scoring";

export const DEFAULT_BEAUTY_DESIGN_PROFILE = beautyDesignProfileSchema.parse({
  bookingModel: "appointment",
  primaryIntent: "book",
  catalogExperience: "price-list",
  brandTraits: ["classic", "craft"],
  pricePosition: "midmarket",
  locationCount: 1,
  photographyQuality: "limited",
});

type ScoredTheme = ScoredThemeEntry<BeautyThemeManifest>;

function matchingBrandTraits(
  manifest: BeautyThemeManifest,
  profile: BeautyDesignProfile,
): BeautyDesignProfile["brandTraits"] {
  return profile.brandTraits.filter((trait) =>
    includesValue(manifest.fitSignals.brandTraits, trait),
  );
}

/**
 * The beauty weight table. Rule order is load-bearing: reasons are collected in
 * rule order and capped, so the strongest signals are the ones a customer sees
 * on the preview.
 */
const BEAUTY_THEME_SCORE_RULES: readonly ThemeScoreRule<
  BeautyThemeManifest,
  BeautyDesignProfile
>[] = [
  {
    weight: 6,
    count: (manifest, profile) =>
      includesValue(manifest.fitSignals.bookingModels, profile.bookingModel),
    reason: (_manifest, profile) =>
      `Fits a ${profile.bookingModel.replaceAll("-", " ")} business`,
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
      `Presents services as a ${profile.catalogExperience.replaceAll("-", " ")}`,
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
        manifest.avoidanceSignals.bookingModels,
        profile.bookingModel,
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
    weight: -3,
    count: (manifest, profile) =>
      includesValue(
        manifest.avoidanceSignals.photographyQualities,
        profile.photographyQuality,
      ),
  },
];

export function scoreBeautyThemes(input: BeautyDesignProfile): ScoredTheme[] {
  const profile = beautyDesignProfileSchema.parse(input);
  return rankThemes(
    listBeautyThemeManifests(),
    profile,
    BEAUTY_THEME_SCORE_RULES,
  );
}

function resolvedSelection(
  input: BeautyAiThemeOutput,
  source: "ai" | "deterministic" | "owner",
): BeautyThemeSelection {
  const manifest = getBeautyThemeManifest(input.themeId);
  return beautyThemeSelectionSchema.parse({
    schemaVersion: BEAUTY_THEME_SCHEMA_VERSION,
    themeId: input.themeId,
    rendererVersion: BEAUTY_THEME_RENDERER_VERSION,
    source,
    confidence: input.confidence,
    reasons: input.reasons,
    alternatives: input.alternatives,
    tokens: mergeBeautyThemeTokens(manifest.safeDefaultTokens, input.tokens),
  });
}

export function selectDeterministicBeautyTheme(
  input: BeautyDesignProfile,
): BeautyThemeSelection {
  const profile = beautyDesignProfileSchema.parse(input);
  const {
    winner,
    alternatives: alternativeManifests,
    confidence,
  } = resolveDeterministicRanking(
    listBeautyThemeManifests(),
    profile,
    BEAUTY_THEME_SCORE_RULES,
    "Beauty theme selection requires at least three registered themes",
  );
  const alternatives: [BeautyThemeId, BeautyThemeId] = [
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
          : ["Uses the safest fit for the available salon signals"],
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
export function selectBeautyTheme(
  profileInput: BeautyDesignProfile,
  aiOutput: unknown,
): BeautyThemeSelection {
  const profile = beautyDesignProfileSchema.parse(profileInput);
  const parsed = beautyAiThemeOutputSchema.safeParse(aiOutput);
  return parsed.success
    ? resolvedSelection(parsed.data, "ai")
    : selectDeterministicBeautyTheme(profile);
}

/**
 * Converts an owner choice into the same closed, versioned contract used by
 * automatic selection. Tokens always come from the registered theme manifest;
 * the dashboard can choose a renderer, but it cannot smuggle arbitrary style
 * values into the public site.
 */
export function selectOwnerBeautyTheme(
  profileInput: BeautyDesignProfile | undefined,
  themeId: BeautyThemeId,
): BeautyThemeSelection {
  const profile =
    beautyDesignProfileSchema.safeParse(profileInput).data ??
    DEFAULT_BEAUTY_DESIGN_PROFILE;
  const automatic = selectDeterministicBeautyTheme(profile);
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
      reasons: ["Selected explicitly by the salon owner"],
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
export function beautyThemeOptions(
  selection: BeautyThemeSelection,
): BeautyThemeId[] {
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
export function previewBeautyThemeAlternate(
  selection: BeautyThemeSelection,
  themeId: BeautyThemeId,
): BeautyThemeSelection | null {
  const options = beautyThemeOptions(selection);
  if (!options.includes(themeId)) return null;
  if (themeId === selection.themeId) return selection;
  const [firstAlternative, secondAlternative] = options.filter(
    (candidate) => candidate !== themeId,
  );
  if (!firstAlternative || !secondAlternative) return null;

  return beautyThemeSelectionSchema.parse({
    ...selection,
    themeId,
    alternatives: [firstAlternative, secondAlternative],
    tokens: mergeBeautyThemeTokens(
      getBeautyThemeManifest(themeId).safeDefaultTokens,
    ),
  });
}

export function restoreAutomaticBeautyTheme(
  profileInput: BeautyDesignProfile | undefined,
): BeautyThemeSelection {
  const profile =
    beautyDesignProfileSchema.safeParse(profileInput).data ??
    DEFAULT_BEAUTY_DESIGN_PROFILE;
  return selectDeterministicBeautyTheme(profile);
}

/**
 * Compatibility is deliberately nullable. Missing or malformed structured
 * selection means "use the established service-style template", not "silently
 * move this customer onto the new default theme".
 */
export function parseBeautyThemeSelection(
  input: unknown,
): BeautyThemeSelection | null {
  const parsed = beautyThemeSelectionSchema.safeParse(input);
  if (!parsed.success) return null;
  const manifest = findBeautyThemeManifest(parsed.data.themeId);
  if (!manifest || manifest.rendererVersion !== parsed.data.rendererVersion) {
    return null;
  }
  return {
    ...parsed.data,
    tokens: mergeBeautyThemeTokens(
      manifest.safeDefaultTokens,
      parsed.data.tokens,
    ),
  };
}

export function normalizeGeneratedBeautyThemeSelection(
  profileInput: BeautyDesignProfile | undefined,
  generatedSelection: unknown,
): {
  designProfile: BeautyDesignProfile;
  themeSelection: BeautyThemeSelection;
} {
  const profile =
    beautyDesignProfileSchema.safeParse(profileInput).data ??
    DEFAULT_BEAUTY_DESIGN_PROFILE;
  const parsed = beautyThemeSelectionSchema.safeParse(generatedSelection);
  if (!parsed.success) {
    return {
      designProfile: profile,
      themeSelection: selectDeterministicBeautyTheme(profile),
    };
  }

  return {
    designProfile: profile,
    themeSelection: selectBeautyTheme(profile, {
      themeId: parsed.data.themeId,
      confidence: parsed.data.confidence,
      reasons: parsed.data.reasons,
      alternatives: parsed.data.alternatives,
      tokens: parsed.data.tokens,
    }),
  };
}
