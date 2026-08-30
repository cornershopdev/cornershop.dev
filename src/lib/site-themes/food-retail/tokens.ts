import {
  foodRetailThemeTokenOverrideSchema,
  foodRetailThemeTokensSchema,
  type FoodRetailThemeTokenOverride,
  type FoodRetailThemeTokens,
} from "@/lib/site-themes/food-retail/contracts";
import { mergeThemeTokens } from "@/lib/site-themes/shared/tokens";

/**
 * Food-retail-bound wrapper over the shared token merge. Colour repair, the
 * closed override vocabulary and the final schema parse all live in the shared
 * kernel; this module only binds the food-retail schemas to it.
 */
export function mergeFoodRetailThemeTokens(
  defaults: FoodRetailThemeTokens,
  candidate: FoodRetailThemeTokenOverride | unknown = {},
): FoodRetailThemeTokens {
  return mergeThemeTokens(defaults, candidate, {
    parseOverride: (value) => {
      const parsed = foodRetailThemeTokenOverrideSchema.safeParse(value);
      return parsed.success ? parsed.data : {};
    },
    parseTokens: (value) => foodRetailThemeTokensSchema.parse(value),
  });
}
