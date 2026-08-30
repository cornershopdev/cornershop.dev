import {
  LOCAL_SERVICE_THEME_RENDERER_VERSION,
  LOCAL_SERVICE_THEME_SCHEMA_VERSION,
  localServiceAiThemeOutputSchema,
  localServiceDesignProfileSchema,
  localServiceThemeSelectionSchema,
  type LocalServiceAiThemeOutput,
  type LocalServiceDesignProfile,
  type LocalServiceThemeId,
  type LocalServiceThemeSelection,
} from "@/lib/site-themes/local-service/contracts";
import {
  findLocalServiceThemeManifest,
  getLocalServiceThemeManifest,
  listLocalServiceThemeManifests,
  type LocalServiceThemeManifest,
} from "@/lib/site-themes/local-service/registry";
import { mergeLocalServiceThemeTokens } from "@/lib/site-themes/local-service/tokens";
import {
  includesValue,
  rankThemes,
  resolveDeterministicRanking,
  type ScoredTheme as ScoredThemeEntry,
  type ThemeScoreRule,
} from "@/lib/site-themes/shared/scoring";

export const DEFAULT_LOCAL_SERVICE_DESIGN_PROFILE =
  localServiceDesignProfileSchema.parse({
    engagementModel: "scheduled",
    primaryIntent: "quote",
    catalogExperience: "proof-led",
    brandTraits: ["trusted", "established"],
    locationCount: 1,
    photographyQuality: "limited",
  });

type ScoredTheme = ScoredThemeEntry<LocalServiceThemeManifest>;

function matchingBrandTraits(
  manifest: LocalServiceThemeManifest,
  profile: LocalServiceDesignProfile,
): LocalServiceDesignProfile["brandTraits"] {
  return profile.brandTraits.filter((trait) =>
    includesValue(manifest.fitSignals.brandTraits, trait),
  );
}

const LOCAL_SERVICE_THEME_SCORE_RULES: readonly ThemeScoreRule<
  LocalServiceThemeManifest,
  LocalServiceDesignProfile
>[] = [
  {
    weight: 6,
    count: (manifest, profile) =>
      includesValue(
        manifest.fitSignals.engagementModels,
        profile.engagementModel,
      ),
    reason: (_manifest, profile) =>
      `Fits ${profile.engagementModel.replaceAll("-", " ")} work`,
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
      `Supports a ${profile.catalogExperience.replaceAll("-", " ")} presentation`,
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
        manifest.avoidanceSignals.engagementModels,
        profile.engagementModel,
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

export function scoreLocalServiceThemes(
  input: LocalServiceDesignProfile,
): ScoredTheme[] {
  const profile = localServiceDesignProfileSchema.parse(input);
  return rankThemes(
    listLocalServiceThemeManifests(),
    profile,
    LOCAL_SERVICE_THEME_SCORE_RULES,
  );
}

function resolvedSelection(
  input: LocalServiceAiThemeOutput,
  source: "ai" | "deterministic" | "owner",
): LocalServiceThemeSelection {
  const manifest = getLocalServiceThemeManifest(input.themeId);
  return localServiceThemeSelectionSchema.parse({
    schemaVersion: LOCAL_SERVICE_THEME_SCHEMA_VERSION,
    themeId: input.themeId,
    rendererVersion: LOCAL_SERVICE_THEME_RENDERER_VERSION,
    source,
    confidence: input.confidence,
    reasons: input.reasons,
    alternatives: input.alternatives,
    tokens: mergeLocalServiceThemeTokens(manifest.safeDefaultTokens, input.tokens),
  });
}

export function selectDeterministicLocalServiceTheme(
  input: LocalServiceDesignProfile,
): LocalServiceThemeSelection {
  const profile = localServiceDesignProfileSchema.parse(input);
  const {
    winner,
    alternatives: alternativeManifests,
    confidence,
  } = resolveDeterministicRanking(
    listLocalServiceThemeManifests(),
    profile,
    LOCAL_SERVICE_THEME_SCORE_RULES,
    "Local-service theme selection requires at least three registered themes",
  );
  const alternatives: [LocalServiceThemeId, LocalServiceThemeId] = [
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
          : ["Uses the safest fit for the available local-service signals"],
      alternatives,
      tokens: {},
    },
    "deterministic",
  );
}

export function selectLocalServiceTheme(
  profileInput: LocalServiceDesignProfile,
  aiOutput: unknown,
): LocalServiceThemeSelection {
  const profile = localServiceDesignProfileSchema.parse(profileInput);
  const parsed = localServiceAiThemeOutputSchema.safeParse(aiOutput);
  return parsed.success
    ? resolvedSelection(parsed.data, "ai")
    : selectDeterministicLocalServiceTheme(profile);
}

export function selectOwnerLocalServiceTheme(
  profileInput: LocalServiceDesignProfile | undefined,
  themeId: LocalServiceThemeId,
): LocalServiceThemeSelection {
  const profile =
    localServiceDesignProfileSchema.safeParse(profileInput).data ??
    DEFAULT_LOCAL_SERVICE_DESIGN_PROFILE;
  const automatic = selectDeterministicLocalServiceTheme(profile);
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
      reasons: ["Selected explicitly by the business owner"],
      alternatives: [firstAlternative, secondAlternative],
      tokens: {},
    },
    "owner",
  );
}

export function localServiceThemeOptions(
  selection: LocalServiceThemeSelection,
): LocalServiceThemeId[] {
  return [selection.themeId, ...selection.alternatives];
}

export function previewLocalServiceThemeAlternate(
  selection: LocalServiceThemeSelection,
  themeId: LocalServiceThemeId,
): LocalServiceThemeSelection | null {
  const options = localServiceThemeOptions(selection);
  if (!options.includes(themeId)) return null;
  if (themeId === selection.themeId) return selection;
  const [firstAlternative, secondAlternative] = options.filter(
    (candidate) => candidate !== themeId,
  );
  if (!firstAlternative || !secondAlternative) return null;

  return localServiceThemeSelectionSchema.parse({
    ...selection,
    themeId,
    alternatives: [firstAlternative, secondAlternative],
    tokens: mergeLocalServiceThemeTokens(
      getLocalServiceThemeManifest(themeId).safeDefaultTokens,
    ),
  });
}

export function restoreAutomaticLocalServiceTheme(
  profileInput: LocalServiceDesignProfile | undefined,
): LocalServiceThemeSelection {
  return selectDeterministicLocalServiceTheme(
    localServiceDesignProfileSchema.safeParse(profileInput).data ??
      DEFAULT_LOCAL_SERVICE_DESIGN_PROFILE,
  );
}

export function parseLocalServiceThemeSelection(
  input: unknown,
): LocalServiceThemeSelection | null {
  const parsed = localServiceThemeSelectionSchema.safeParse(input);
  if (!parsed.success) return null;
  const manifest = findLocalServiceThemeManifest(parsed.data.themeId);
  if (!manifest || manifest.rendererVersion !== parsed.data.rendererVersion) {
    return null;
  }
  return {
    ...parsed.data,
    tokens: mergeLocalServiceThemeTokens(
      manifest.safeDefaultTokens,
      parsed.data.tokens,
    ),
  };
}

export function normalizeGeneratedLocalServiceThemeSelection(
  profileInput: LocalServiceDesignProfile | undefined,
  generatedSelection: unknown,
): {
  designProfile: LocalServiceDesignProfile;
  themeSelection: LocalServiceThemeSelection;
} {
  const profile =
    localServiceDesignProfileSchema.safeParse(profileInput).data ??
    DEFAULT_LOCAL_SERVICE_DESIGN_PROFILE;
  const parsed = localServiceThemeSelectionSchema.safeParse(generatedSelection);
  if (!parsed.success) {
    return {
      designProfile: profile,
      themeSelection: selectDeterministicLocalServiceTheme(profile),
    };
  }

  return {
    designProfile: profile,
    themeSelection: selectLocalServiceTheme(profile, {
      themeId: parsed.data.themeId,
      confidence: parsed.data.confidence,
      reasons: parsed.data.reasons,
      alternatives: parsed.data.alternatives,
      tokens: parsed.data.tokens,
    }),
  };
}
