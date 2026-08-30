import { describe, expect, it } from "bun:test";
import { Vertical } from "@/generated/prisma/enums";
import {
  PREVIEW_THEME_PARAM,
  resolvePreviewThemeAlternates,
} from "@/lib/preview-theme-alternates";
import type { SiteDraftView } from "@/lib/site-draft";
import { localeHref } from "@/lib/site-surface";
import { restaurantThemeIdSchema } from "@/lib/site-themes/restaurant/contracts";
import { restaurantThemeFixtures } from "@/lib/site-themes/restaurant/fixtures";
import { getRestaurantThemeManifest } from "@/lib/site-themes/restaurant/registry";
import { parseRestaurantThemeSelection } from "@/lib/site-themes/restaurant/selection";
import { sampleFoodRetailDraft } from "@/lib/verticals/food-retail/fixtures";

const draft = restaurantThemeFixtures["after-dark"] as SiteDraftView;

function recordedSelection() {
  const selection = parseRestaurantThemeSelection(
    draft.attributes.themeSelection,
  );
  expect(selection).not.toBeNull();
  return selection!;
}

function resolve(requestedTheme: string | string[] | undefined) {
  return resolvePreviewThemeAlternates({
    vertical: Vertical.RESTAURANT,
    draft,
    requestedTheme,
  });
}

describe("preview theme alternates", () => {
  it("offers the recorded theme first, then the two alternatives it named", () => {
    const recorded = recordedSelection();
    const alternates = resolve(undefined);

    expect(alternates?.options.map(({ id }) => id)).toEqual([
      recorded.themeId,
      ...recorded.alternatives,
    ]);
    expect(alternates?.options.map(({ active }) => active)).toEqual([
      true,
      false,
      false,
    ]);
    expect(alternates?.options.map(({ name }) => name)).toEqual(
      [recorded.themeId, ...recorded.alternatives].map(
        (id) => getRestaurantThemeManifest(id).name,
      ),
    );
  });

  it("renders the published draft object itself while the recorded theme is active", () => {
    const recorded = recordedSelection();
    const alternates = resolve(recorded.themeId);

    expect(alternates?.draft).toBe(draft);
    expect(alternates?.theme.id).toBe(recorded.themeId);
    expect(alternates?.theme.version).toBe(
      `restaurant-renderer-v${recorded.rendererVersion}`,
    );
  });

  it("swaps the rendered selection and re-derives tokens from the registry", () => {
    const recorded = recordedSelection();
    const [alternate] = recorded.alternatives;
    const alternates = resolve(alternate);
    const rendered = parseRestaurantThemeSelection(
      alternates?.draft.attributes.themeSelection,
    );

    expect(alternates?.draft).not.toBe(draft);
    expect(rendered?.themeId).toBe(alternate);
    expect(rendered?.tokens).toEqual(
      getRestaurantThemeManifest(alternate).safeDefaultTokens,
    );
    // The renderer reads the draft; the theme record only labels it. They must
    // never describe two different themes.
    expect(alternates?.theme.id).toBe(alternate);
    expect(alternates?.theme.selection).toEqual(rendered!);
  });

  it("keeps the shortlist order and membership stable while an alternate is active", () => {
    const recorded = recordedSelection();
    const [alternate] = recorded.alternatives;

    expect(resolve(alternate)?.options.map(({ id }) => id)).toEqual([
      recorded.themeId,
      ...recorded.alternatives,
    ]);
    expect(resolve(alternate)?.options.map(({ active }) => active)).toEqual([
      false,
      true,
      false,
    ]);
  });

  it("reports the reasons recorded for the published selection", () => {
    const recorded = recordedSelection();

    expect(resolve(undefined)?.reasons).toEqual(recorded.reasons);
    expect(resolve(recorded.alternatives[0])?.reasons).toEqual(
      recorded.reasons,
    );
  });

  it("falls back to the recorded theme for anything outside the shortlist", () => {
    const recorded = recordedSelection();
    const shortlisted = new Set([recorded.themeId, ...recorded.alternatives]);
    const offRegistry = restaurantThemeIdSchema.options.filter(
      (id) => !shortlisted.has(id),
    );
    expect(offRegistry.length).toBeGreaterThan(0);

    for (const requested of [
      ...offRegistry,
      "not-a-theme",
      "",
      "__proto__",
      undefined,
    ]) {
      const alternates = resolve(requested);
      expect(alternates?.draft).toBe(draft);
      expect(alternates?.theme.id).toBe(recorded.themeId);
    }
  });

  it("reads the first value of a repeated query parameter", () => {
    const recorded = recordedSelection();
    const [alternate] = recorded.alternatives;

    expect(resolve([alternate, "not-a-theme"])?.theme.id).toBe(alternate);
    expect(resolve(["not-a-theme", alternate])?.theme.id).toBe(
      recorded.themeId,
    );
  });

  it("offers nothing for a vertical without a theme registry", () => {
    expect(
      resolvePreviewThemeAlternates({
        vertical: Vertical.FOOD_RETAIL,
        draft: sampleFoodRetailDraft as SiteDraftView,
        requestedTheme: undefined,
      }),
    ).toBeNull();
  });

  it("offers nothing for a legacy draft with no structured selection", () => {
    const legacy: SiteDraftView = {
      ...draft,
      attributes: { ...draft.attributes, themeSelection: undefined },
    };

    expect(
      resolvePreviewThemeAlternates({
        vertical: Vertical.RESTAURANT,
        draft: legacy,
        requestedTheme: recordedSelection().alternatives[0],
      }),
    ).toBeNull();
  });

  it("names the query parameter the preview surface reads", () => {
    expect(PREVIEW_THEME_PARAM).toBe("theme");
  });
});

describe("preview theme locale links", () => {
  it("carries no query while the recorded theme is active", () => {
    const alternates = resolvePreviewThemeAlternates({
      vertical: Vertical.RESTAURANT,
      draft,
      requestedTheme: undefined,
    })!;
    expect(alternates.activeQuery).toBe("");
    expect(localeHref(`/preview/osteria-luna${alternates.activeQuery}`, "fr", "en")).toBe(
      "/preview/osteria-luna/fr",
    );
  });

  it("pins the active alternate across a locale switch", () => {
    const recorded = resolvePreviewThemeAlternates({
      vertical: Vertical.RESTAURANT,
      draft,
      requestedTheme: undefined,
    })!;
    const alternate = recorded.options[1]!.id;
    const active = resolvePreviewThemeAlternates({
      vertical: Vertical.RESTAURANT,
      draft,
      requestedTheme: alternate,
    })!;

    expect(active.activeQuery).toBe(`?${PREVIEW_THEME_PARAM}=${alternate}`);
    // The locale link is the one place the theme could silently reset: it is
    // built from a base path, not from the incoming search params.
    expect(localeHref(`/preview/osteria-luna${active.activeQuery}`, "fr", "en")).toBe(
      `/preview/osteria-luna/fr?${PREVIEW_THEME_PARAM}=${alternate}`,
    );
  });

  it("resolves the pinned theme back out of the locale link", () => {
    const recorded = resolvePreviewThemeAlternates({
      vertical: Vertical.RESTAURANT,
      draft,
      requestedTheme: undefined,
    })!;
    const alternate = recorded.options[2]!.id;
    const href = localeHref(
      `/preview/osteria-luna?${PREVIEW_THEME_PARAM}=${alternate}`,
      "fr",
      "en",
    );
    const requested = new URL(href, "https://cornershop.dev").searchParams.get(
      PREVIEW_THEME_PARAM,
    )!;

    const landed = resolvePreviewThemeAlternates({
      vertical: Vertical.RESTAURANT,
      draft,
      requestedTheme: requested,
    })!;
    expect(landed.options.find((option) => option.active)?.id).toBe(alternate);
  });
});
