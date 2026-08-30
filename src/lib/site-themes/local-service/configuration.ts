import { Vertical } from "@/generated/prisma/enums";
import type { SiteThemeView } from "@/lib/site-draft";
import { parseLocalServiceThemeSelection } from "@/lib/site-themes/local-service/selection";
import type { VerticalId } from "@/lib/verticals/types";

export function localServiceRendererVersionId(rendererVersion: number): string {
  return `local-service-renderer-v${rendererVersion}`;
}

export function localServiceSiteTheme(
  vertical: VerticalId,
  attributes: Record<string, unknown>,
): SiteThemeView | null {
  if (vertical !== Vertical.LOCAL_SERVICE) return null;
  const selection = parseLocalServiceThemeSelection(attributes.themeSelection);
  if (!selection) return null;
  return {
    id: selection.themeId,
    version: localServiceRendererVersionId(selection.rendererVersion),
    selection,
  };
}
