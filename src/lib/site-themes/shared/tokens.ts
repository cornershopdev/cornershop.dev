import {
  repairThemeColorSurface,
  type ThemeColorSurface,
} from "@/lib/site-themes/shared/color";

/**
 * The token shape every vertical publishes: a shared five-colour surface plus
 * a vertical-specific closed style vocabulary.
 */
export type ThemeTokens<TStyle extends Record<string, string>> = {
  colors: ThemeColorSurface;
  style: TStyle;
};

export type ThemeTokenMergeParsers<TTokens> = {
  /**
   * Must be total: invalid candidates return an empty override rather than
   * throwing, so malformed model output degrades to the registered defaults.
   */
  parseOverride: (value: unknown) => {
    colors?: Partial<ThemeColorSurface>;
    /**
     * Values stay `unknown` on purpose. A vertical builds its override schema
     * from a generic style vocabulary, so the value type is not recoverable
     * here — and it does not need to be: `parseTokens` re-parses the merged
     * result against the strict schema, which is the actual gate.
     */
    style?: Record<string, unknown>;
  };
  parseTokens: (value: unknown) => TTokens;
};

/**
 * Token overrides are a closed vocabulary and colour repair runs after the
 * merge, so a valid-looking model response cannot produce unreadable body
 * text, surface text or action labels. This is a security boundary: the merge
 * is the only path by which non-registry values can reach a rendered site.
 */
export function mergeThemeTokens<
  TTokens extends ThemeTokens<Record<string, string>>,
>(
  defaults: TTokens,
  candidate: unknown,
  parsers: ThemeTokenMergeParsers<TTokens>,
): TTokens {
  const override = parsers.parseOverride(candidate);

  return parsers.parseTokens({
    ...defaults,
    colors: repairThemeColorSurface({
      ...defaults.colors,
      ...override.colors,
    }),
    style: {
      ...defaults.style,
      ...override.style,
    },
  });
}
