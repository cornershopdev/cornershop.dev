/**
 * The locales the factory itself ships chrome for, as opposed to `localeSchema`,
 * which is an open BCP 47 code because a scraped business writes its own site in
 * whatever language it likes. Those are two different things: a Maltese bakery
 * can carry `mt` content long before the engine has a Maltese word for "Pickup".
 *
 * Declaring the shipped set here, and typing every locale-keyed dictionary
 * against it, is what makes a locale impossible to half-add: appending a code
 * turns every dictionary missing that locale into a compile error rather than a
 * silent fall back to English in production.
 */
export const SITE_UI_LOCALES = ["en", "fr", "mt"] as const;

export type SiteUiLocale = (typeof SITE_UI_LOCALES)[number];

/**
 * The shipped locale a request's BCP 47 code resolves to. Region subtags are
 * dropped (`fr-FR` and `fr-CA` share one dictionary), and anything unshipped
 * lands on `en` — the same locale → language → `en` order `pickLocaleEntry`
 * applies to the dictionaries themselves.
 */
export function siteUiLocale(locale: string): SiteUiLocale {
  const language = locale.toLowerCase().split("-")[0];
  return (
    SITE_UI_LOCALES.find((shipped) => shipped === language) ?? "en"
  );
}
