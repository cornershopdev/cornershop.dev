import {
  localServiceThemeTokenOverrideSchema,
  localServiceThemeTokensSchema,
  type LocalServiceThemeTokenOverride,
  type LocalServiceThemeTokens,
} from "@/lib/site-themes/local-service/contracts";
import { mergeThemeTokens } from "@/lib/site-themes/shared/tokens";

export {
  colorContrast,
  MIN_TEXT_CONTRAST,
} from "@/lib/site-themes/shared/color";

export function mergeLocalServiceThemeTokens(
  defaults: LocalServiceThemeTokens,
  candidate: LocalServiceThemeTokenOverride | unknown = {},
): LocalServiceThemeTokens {
  return mergeThemeTokens(defaults, candidate, {
    parseOverride: (value) => {
      const parsed = localServiceThemeTokenOverrideSchema.safeParse(value);
      return parsed.success ? parsed.data : {};
    },
    parseTokens: (value) => localServiceThemeTokensSchema.parse(value),
  });
}
