import { Vertical } from "@/generated/prisma/enums";
import { parseBeautyThemeSelection } from "@/lib/site-themes/beauty/selection";
import type { SiteThemeView } from "@/lib/site-draft";
import type { VerticalId } from "@/lib/verticals/types";

export function beautyRendererVersionId(rendererVersion: number): string {
  return `beauty-renderer-v${rendererVersion}`;
}

/**
 * Returning null is intentional: salons drafted before the theme registry keep
 * their established service-style template until an owner or a new import opts
 * them into the versioned registry.
 */
export function beautySiteTheme(
  vertical: VerticalId,
  attributes: Record<string, unknown>,
): SiteThemeView | null {
  if (vertical !== Vertical.BEAUTY) return null;
  const selection = parseBeautyThemeSelection(attributes.themeSelection);
  if (!selection) return null;
  return {
    id: selection.themeId,
    version: beautyRendererVersionId(selection.rendererVersion),
    selection,
  };
}
