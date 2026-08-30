import {
  beautyThemeTokenOverrideSchema,
  beautyThemeTokensSchema,
  type BeautyThemeTokenOverride,
  type BeautyThemeTokens,
} from "@/lib/site-themes/beauty/contracts";
import { mergeThemeTokens } from "@/lib/site-themes/shared/tokens";

/**
 * Beauty-bound wrapper over the shared token merge. Colour repair, the closed
 * override vocabulary and the final schema parse all live in the shared kernel;
 * this module only binds the beauty schemas to it.
 */
export function mergeBeautyThemeTokens(
  defaults: BeautyThemeTokens,
  candidate: BeautyThemeTokenOverride | unknown = {},
): BeautyThemeTokens {
  return mergeThemeTokens(defaults, candidate, {
    parseOverride: (value) => {
      const parsed = beautyThemeTokenOverrideSchema.safeParse(value);
      return parsed.success ? parsed.data : {};
    },
    parseTokens: (value) => beautyThemeTokensSchema.parse(value),
  });
}
