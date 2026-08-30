import { Vertical } from "@/generated/prisma/enums";
import type { SiteThemeView } from "@/lib/site-draft";
import type { ThemeSurfaceColors } from "@/lib/site-themes/shared/contracts";
import {
  beautyRendererVersionId,
  beautySiteTheme,
} from "@/lib/site-themes/beauty/configuration";
import { getBeautyThemeManifest } from "@/lib/site-themes/beauty/registry";
import {
  beautyThemeOptions,
  parseBeautyThemeSelection,
  previewBeautyThemeAlternate,
} from "@/lib/site-themes/beauty/selection";
import {
  foodRetailRendererVersionId,
  foodRetailSiteTheme,
} from "@/lib/site-themes/food-retail/configuration";
import { getFoodRetailThemeManifest } from "@/lib/site-themes/food-retail/registry";
import {
  foodRetailThemeOptions,
  parseFoodRetailThemeSelection,
  previewFoodRetailThemeAlternate,
} from "@/lib/site-themes/food-retail/selection";
import {
  restaurantRendererVersionId,
  restaurantSiteTheme,
} from "@/lib/site-themes/restaurant/configuration";
import { getRestaurantThemeManifest } from "@/lib/site-themes/restaurant/registry";
import {
  parseRestaurantThemeSelection,
  previewRestaurantThemeAlternate,
  restaurantThemeOptions,
} from "@/lib/site-themes/restaurant/selection";
import type { VerticalId } from "@/lib/verticals/types";

/**
 * One shortlisted renderer, described for a picker surface.
 *
 * `active` is deliberately absent: membership of the shortlist is a property of
 * the selection, while which entry is currently rendered is a property of the
 * request. Callers own the second.
 */
export type ThemeAdapterOption = {
  id: string;
  name: string;
  description: string;
};

/**
 * A validated theme selection, erased of its vertical's concrete id union.
 *
 * `record` is the exact object that was validated, ready to be stored back in a
 * `SiteThemeView` or a draft attribute bag. Everything reachable from here has
 * already been through the vertical's own schema and registry check, so no
 * caller can widen the option set or the token vocabulary by holding one of
 * these.
 */
export type ThemeAdapterSelection = {
  record: Record<string, unknown>;
  themeId: string;
  rendererVersion: number;
  reasons: string[];
  /**
   * The theme's resolved colour surface, already contrast-repaired by the token
   * merge. Renderers apply this instead of the draft palette so the site a
   * customer sees matches the theme that was actually selected.
   */
  colors: ThemeSurfaceColors;
  /** The recorded theme first, then the two alternatives it named. */
  options: ThemeAdapterOption[];
  /**
   * Rotates onto a shortlisted alternate, or null when `themeId` is unknown or
   * outside this selection's shortlist. Tokens always come back from the
   * registry manifest, so rotation cannot introduce a style value the site was
   * never offered.
   */
  alternate: (themeId: string) => ThemeAdapterSelection | null;
};

export type VerticalThemeAdapter = {
  rendererVersionId: (rendererVersion: number) => string;
  /**
   * Nullable by design. Missing or malformed structured selection means "use
   * the vertical's established template-era renderer", never "silently move
   * this customer onto the new default theme".
   */
  parseSelection: (value: unknown) => ThemeAdapterSelection | null;
  siteTheme: (
    vertical: VerticalId,
    attributes: Record<string, unknown>,
  ) => SiteThemeView | null;
};

/**
 * Binds one vertical's theme modules to the erased adapter surface.
 *
 * The type parameters exist only to keep the binding honest inside this
 * function: `options` and `alternate` are the vertical's own closed-id helpers,
 * so a mismatched pairing fails to compile here rather than degrading into a
 * runtime string comparison at a call site.
 */
function createThemeAdapter<
  TId extends string,
  TSelection extends {
    themeId: TId;
    rendererVersion: number;
    reasons: string[];
    tokens: { colors: ThemeSurfaceColors };
  },
>(input: {
  rendererVersionId: (rendererVersion: number) => string;
  parseSelection: (value: unknown) => TSelection | null;
  themeOptions: (selection: TSelection) => TId[];
  previewAlternate: (selection: TSelection, themeId: TId) => TSelection | null;
  describeTheme: (id: TId) => { name: string; description: string };
  siteTheme: (
    vertical: VerticalId,
    attributes: Record<string, unknown>,
  ) => SiteThemeView | null;
}): VerticalThemeAdapter {
  function describe(selection: TSelection): ThemeAdapterSelection {
    return {
      record: selection,
      themeId: selection.themeId,
      rendererVersion: selection.rendererVersion,
      reasons: selection.reasons,
      colors: selection.tokens.colors,
      options: input.themeOptions(selection).map((id) => {
        const manifest = input.describeTheme(id);
        return { id, name: manifest.name, description: manifest.description };
      }),
      alternate: (themeId) => {
        // The requested id is an untrusted string, so it is filtered through
        // this selection's own shortlist before it can reach a registry lookup.
        const requested = input
          .themeOptions(selection)
          .find((candidate) => candidate === themeId);
        if (!requested) return null;
        const rotated = input.previewAlternate(selection, requested);
        return rotated ? describe(rotated) : null;
      },
    };
  }

  return {
    rendererVersionId: input.rendererVersionId,
    siteTheme: input.siteTheme,
    parseSelection: (value) => {
      const selection = input.parseSelection(value);
      return selection ? describe(selection) : null;
    },
  };
}

/**
 * Verticals with a registered theme layer. A vertical is absent until it has a
 * registry, a scorer and at least three themes, because the selection envelope
 * always names two alternatives.
 */
const THEME_ADAPTERS: Partial<Record<VerticalId, VerticalThemeAdapter>> = {
  [Vertical.RESTAURANT]: createThemeAdapter({
    rendererVersionId: restaurantRendererVersionId,
    parseSelection: parseRestaurantThemeSelection,
    themeOptions: restaurantThemeOptions,
    previewAlternate: previewRestaurantThemeAlternate,
    describeTheme: getRestaurantThemeManifest,
    siteTheme: restaurantSiteTheme,
  }),
  [Vertical.BEAUTY]: createThemeAdapter({
    rendererVersionId: beautyRendererVersionId,
    parseSelection: parseBeautyThemeSelection,
    themeOptions: beautyThemeOptions,
    previewAlternate: previewBeautyThemeAlternate,
    describeTheme: getBeautyThemeManifest,
    siteTheme: beautySiteTheme,
  }),
  [Vertical.FOOD_RETAIL]: createThemeAdapter({
    rendererVersionId: foodRetailRendererVersionId,
    parseSelection: parseFoodRetailThemeSelection,
    themeOptions: foodRetailThemeOptions,
    previewAlternate: previewFoodRetailThemeAlternate,
    describeTheme: getFoodRetailThemeManifest,
    siteTheme: foodRetailSiteTheme,
  }),
};

export function themeAdapterFor(
  vertical: VerticalId,
): VerticalThemeAdapter | null {
  return THEME_ADAPTERS[vertical] ?? null;
}

/**
 * Resolves the registered renderer recorded in a vertical's attribute bag.
 *
 * Returning null is the compatibility path: a vertical without a theme registry
 * and a draft written before its registry existed both keep their established
 * template-era renderer until an owner or a new import opts them in.
 */
export function registeredSiteTheme(
  vertical: VerticalId,
  attributes: Record<string, unknown>,
): SiteThemeView | null {
  return themeAdapterFor(vertical)?.siteTheme(vertical, attributes) ?? null;
}
