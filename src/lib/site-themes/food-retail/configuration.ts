import { Vertical } from "@/generated/prisma/enums";
import { parseFoodRetailThemeSelection } from "@/lib/site-themes/food-retail/selection";
import type { SiteThemeView } from "@/lib/site-draft";
import type { VerticalId } from "@/lib/verticals/types";

export function foodRetailRendererVersionId(rendererVersion: number): string {
  return `food-retail-renderer-v${rendererVersion}`;
}

/**
 * Returning null is intentional: shops drafted before the theme registry keep
 * their established shop-type template until an owner or a new import opts them
 * into the versioned registry.
 */
export function foodRetailSiteTheme(
  vertical: VerticalId,
  attributes: Record<string, unknown>,
): SiteThemeView | null {
  if (vertical !== Vertical.FOOD_RETAIL) return null;
  const selection = parseFoodRetailThemeSelection(attributes.themeSelection);
  if (!selection) return null;
  return {
    id: selection.themeId,
    version: foodRetailRendererVersionId(selection.rendererVersion),
    selection,
  };
}
