import {
  restaurantThemeTokenOverrideSchema,
  restaurantThemeTokensSchema,
  type RestaurantThemeTokenOverride,
  type RestaurantThemeTokens,
} from "@/lib/site-themes/restaurant/contracts";
import { mergeThemeTokens } from "@/lib/site-themes/shared/tokens";

export {
  colorContrast,
  MIN_TEXT_CONTRAST,
} from "@/lib/site-themes/shared/color";

/**
 * Restaurant-bound wrapper over the shared token merge. Colour repair, the
 * closed override vocabulary and the final schema parse all live in the shared
 * kernel; this module only binds the restaurant schemas to it.
 */
export function mergeRestaurantThemeTokens(
  defaults: RestaurantThemeTokens,
  candidate: RestaurantThemeTokenOverride | unknown = {},
): RestaurantThemeTokens {
  return mergeThemeTokens(defaults, candidate, {
    parseOverride: (value) => {
      const parsed = restaurantThemeTokenOverrideSchema.safeParse(value);
      return parsed.success ? parsed.data : {};
    },
    parseTokens: (value) => restaurantThemeTokensSchema.parse(value),
  });
}
