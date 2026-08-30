import { describe, expect, it } from "bun:test";
import { getSiteDictionary, getTemplateCopy } from "@/lib/site-i18n";
import { SITE_UI_LOCALES, siteUiLocale } from "@/lib/site-locales";
import { listVerticalIds, resolveVerticalConfig } from "@/lib/verticals/registry";

describe("siteUiLocale", () => {
  it("resolves a shipped locale, its regional variants, and nothing else", () => {
    expect(siteUiLocale("mt")).toBe("mt");
    expect(siteUiLocale("mt-MT")).toBe("mt");
    expect(siteUiLocale("fr-CA")).toBe("fr");
    expect(siteUiLocale("MT")).toBe("mt");
    expect(siteUiLocale("de")).toBe("en");
  });
});

/**
 * The compiler already forces every dictionary to carry a key per shipped
 * locale. What it cannot see is a key present but left blank, which is how a
 * locale ships looking added while rendering an empty heading. English is the
 * reference: a key it fills, every locale must fill, and a key it leaves blank
 * on purpose stays blank everywhere.
 */
describe("shipped locale parity", () => {
  for (const verticalId of listVerticalIds()) {
    const config = resolveVerticalConfig(verticalId);

    it(`${verticalId} translates its dictionary into every shipped locale`, () => {
      const english = getSiteDictionary(config, "en");
      for (const locale of SITE_UI_LOCALES) {
        const dictionary = getSiteDictionary(config, locale);
        expect(Object.keys(dictionary).sort()).toEqual(
          Object.keys(english).sort(),
        );
        for (const [key, value] of Object.entries(english)) {
          expect(dictionary[key].length > 0).toBe(value.length > 0);
        }
      }
    });

    it(`${verticalId} translates every template into every shipped locale`, () => {
      for (const template of Object.values(config.templates.definitions)) {
        for (const locale of SITE_UI_LOCALES) {
          const copy = getTemplateCopy(template, locale);
          expect(copy.catalogEyebrow.length).toBeGreaterThan(0);
          expect(copy.catalogHeading.length).toBeGreaterThan(0);
          expect(copy.featuredHeading.length).toBeGreaterThan(0);
          expect(copy.featuredSubheading.length).toBeGreaterThan(0);
        }
      }
    });
  }
});
