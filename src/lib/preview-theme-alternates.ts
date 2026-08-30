import { Vertical } from "@/generated/prisma/enums";
import type { SiteDraftView, SiteThemeView } from "@/lib/site-draft";
import { restaurantThemeIdSchema } from "@/lib/site-themes/restaurant/contracts";
import { restaurantRendererVersionId } from "@/lib/site-themes/restaurant/configuration";
import { getRestaurantThemeManifest } from "@/lib/site-themes/restaurant/registry";
import {
  parseRestaurantThemeSelection,
  previewRestaurantThemeAlternate,
  restaurantThemeOptions,
} from "@/lib/site-themes/restaurant/selection";
import type { VerticalId } from "@/lib/verticals/types";

export const PREVIEW_THEME_PARAM = "theme";

export type PreviewThemeOption = {
  id: string;
  name: string;
  description: string;
  active: boolean;
};

export type PreviewThemeAlternates = {
  /**
   * The draft to render. Identical to the input draft while the recorded theme
   * is active, so an untouched preview keeps rendering the exact published
   * object rather than a rebuilt copy of it.
   */
  draft: SiteDraftView;
  /** Kept in step with `draft` so the renderer and its theme record never disagree. */
  theme: SiteThemeView;
  options: PreviewThemeOption[];
  reasons: string[];
  /**
   * The query string that pins the active theme, or `""` while the recorded
   * theme is active. Appended to link bases that must survive navigation
   * inside the preview, so switching language does not silently drop the
   * theme a visitor is currently looking at.
   */
  activeQuery: string;
};

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Resolves the factory-only "View as" shortlist for one preview request.
 *
 * Returns null whenever there is nothing honest to offer: a vertical with no
 * theme registry, or a legacy restaurant whose draft carries no structured
 * selection. Callers must also skip it on the live customer surface, where
 * factory chrome has no business appearing.
 *
 * An unknown, malformed or non-shortlisted requested theme silently falls back
 * to the recorded selection instead of erroring, so a stale bookmark still
 * renders the customer's real site.
 */
export function resolvePreviewThemeAlternates({
  vertical,
  draft,
  requestedTheme,
}: {
  vertical: VerticalId;
  draft: SiteDraftView;
  requestedTheme: string | string[] | undefined;
}): PreviewThemeAlternates | null {
  if (vertical !== Vertical.RESTAURANT) return null;
  const recorded = parseRestaurantThemeSelection(
    draft.attributes.themeSelection,
  );
  if (!recorded) return null;

  const requested = restaurantThemeIdSchema.safeParse(
    firstParam(requestedTheme),
  );
  const active =
    (requested.success
      ? previewRestaurantThemeAlternate(recorded, requested.data)
      : null) ?? recorded;

  return {
    draft:
      active === recorded
        ? draft
        : {
            ...draft,
            attributes: { ...draft.attributes, themeSelection: active },
          },
    theme: {
      id: active.themeId,
      version: restaurantRendererVersionId(active.rendererVersion),
      selection: active,
    },
    // Options come from the recorded selection so the shortlist keeps a stable
    // order and membership as the visitor switches between its entries.
    options: restaurantThemeOptions(recorded).map((id) => {
      const manifest = getRestaurantThemeManifest(id);
      return {
        id,
        name: manifest.name,
        description: manifest.description,
        active: id === active.themeId,
      };
    }),
    reasons: recorded.reasons,
    activeQuery:
      active === recorded
        ? ""
        : `?${PREVIEW_THEME_PARAM}=${encodeURIComponent(active.themeId)}`,
  };
}
