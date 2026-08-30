/**
 * Vertical-agnostic theme scoring.
 *
 * Each vertical supplies its own weighted rule table; the ranking, reason
 * capping, tie-breaking and confidence maths live here so every vertical
 * behaves identically and only the signals differ.
 */

export const MAX_THEME_REASONS = 4;

/**
 * `count` returns how many times the weight applies. A boolean is treated as
 * 0 or 1, which covers every single-signal rule; multi-signal rules (such as
 * brand traits) return the match count so the weight multiplies.
 */
export type ThemeScoreRule<TManifest, TProfile> = {
  weight: number;
  count: (manifest: TManifest, profile: TProfile) => number | boolean;
  reason?: (manifest: TManifest, profile: TProfile) => string | null;
};

export type ScoredTheme<TManifest> = {
  manifest: TManifest;
  score: number;
  reasons: string[];
};

export function includesValue<T>(values: readonly T[], value: T): boolean {
  return values.includes(value);
}

function ruleCount(value: number | boolean): number {
  if (typeof value === "boolean") return value ? 1 : 0;
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

export function scoreThemesWithRules<TManifest, TProfile>(
  manifest: TManifest,
  profile: TProfile,
  rules: readonly ThemeScoreRule<TManifest, TProfile>[],
): ScoredTheme<TManifest> {
  let score = 0;
  const reasons: string[] = [];

  for (const rule of rules) {
    const count = ruleCount(rule.count(manifest, profile));
    if (count === 0) continue;
    score += rule.weight * count;
    const reason = rule.reason?.(manifest, profile);
    if (reason) reasons.push(reason);
  }

  return { manifest, score, reasons: reasons.slice(0, MAX_THEME_REASONS) };
}

/**
 * Ranks a whole registry. Ties break on the theme id so ranking is stable and
 * reproducible for a given profile — selection is persisted to customer rows,
 * so it must never depend on registry insertion order.
 */
export function rankThemes<TManifest extends { id: string }, TProfile>(
  manifests: readonly TManifest[],
  profile: TProfile,
  rules: readonly ThemeScoreRule<TManifest, TProfile>[],
): ScoredTheme<TManifest>[] {
  return manifests
    .map((manifest) => scoreThemesWithRules(manifest, profile, rules))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.manifest.id.localeCompare(right.manifest.id),
    );
}

export type DeterministicRanking<TManifest> = {
  winner: ScoredTheme<TManifest>;
  alternatives: [TManifest, TManifest];
  confidence: number;
};

/**
 * A selection is only valid with a winner plus exactly two alternatives, so a
 * vertical needs at least three registered themes before it can ship.
 */
export function resolveDeterministicRanking<
  TManifest extends { id: string },
  TProfile,
>(
  manifests: readonly TManifest[],
  profile: TProfile,
  rules: readonly ThemeScoreRule<TManifest, TProfile>[],
  insufficientThemesMessage: string,
): DeterministicRanking<TManifest> {
  const scored = rankThemes(manifests, profile, rules);
  const [winner, firstAlternative, secondAlternative] = scored;
  if (!winner || !firstAlternative || !secondAlternative) {
    throw new Error(insufficientThemesMessage);
  }

  const gap = winner.score - firstAlternative.score;
  return {
    winner,
    alternatives: [firstAlternative.manifest, secondAlternative.manifest],
    confidence: Math.min(0.95, Math.max(0.55, 0.62 + gap * 0.035)),
  };
}
