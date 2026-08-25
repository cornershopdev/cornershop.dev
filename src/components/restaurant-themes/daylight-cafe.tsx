import { formatPrice } from "@/lib/site-draft";
import { SiteBrand, SourceNavigation } from "@/components/site-brand";
import {
  fontPairClass,
  itemBadges,
  sourceBrandPalette,
  themeStyle,
  ThemeAnalytics,
  ThemeBlogNav,
  ThemeBusinessHours,
  ThemeContact,
  ThemeExternalAction,
  ThemeHeroImage,
  ThemeLocaleNavigation,
  ThemeLocation,
  type RestaurantThemeRendererProps,
} from "@/components/restaurant-themes/shared";
import { SitePhotoGallery } from "@/components/site-photo-gallery";
import { cn } from "@/lib/utils";

export function DaylightCafeTheme({
  draft,
  selection,
  locale = draft.defaultLocale,
  localeBasePath,
  availableLocales = [draft.defaultLocale],
  dictionary,
  embedded = false,
  analyticsEnabled = false,
  blogHref,
}: RestaurantThemeRendererProps) {
  const ordering = draft.integrations.find(
    (integration) =>
      integration.enabled &&
      ["ordering", "delivery"].includes(integration.type),
  );
  const tokens = selection.tokens;

  return (
    <article
      lang={locale}
      data-site-theme={selection.themeId}
      data-theme-version={selection.rendererVersion}
      data-primary-intent="visit"
      data-menu-experience="catalog"
      className={cn(
        "relative overflow-hidden font-sans",
        embedded ? "min-h-[760px] rounded-[1.5rem]" : "min-h-screen",
      )}
      style={themeStyle(tokens, sourceBrandPalette(draft))}
    >
      <ThemeAnalytics draft={draft} enabled={analyticsEnabled} />
      <header className="flex flex-wrap items-center justify-between gap-4 px-5 py-5 md:px-8">
        <SiteBrand
          draft={draft}
          href="#menu"
          className={cn(
            "text-xl font-semibold tracking-[-0.04em] md:text-2xl",
            fontPairClass(tokens),
          )}
        />
        <div className="flex items-center gap-3">
          <ThemeLocaleNavigation
            locale={locale}
            localeBasePath={localeBasePath}
            availableLocales={availableLocales}
            defaultLocale={draft.defaultLocale}
            label={dictionary.language}
          />
          <ThemeBlogNav
            href={blogHref}
            enabled={analyticsEnabled}
            label={dictionary.blogNav}
          />
          {ordering ? (
            <ThemeExternalAction
              integration={ordering}
              locale={locale}
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[var(--theme-accent)] px-5 py-3 text-sm font-semibold text-[var(--theme-accent-fg)]"
            />
          ) : (
            <a
              href="#visit"
              className="inline-flex min-h-11 items-center rounded-full border border-current/20 px-5 py-3 text-sm font-semibold"
            >
              {dictionary.themePlanVisit}
            </a>
          )}
        </div>
      </header>
      <SourceNavigation draft={draft} />

      <section className="relative min-h-[70svh] overflow-hidden">
        <ThemeHeroImage
          draft={draft}
          imageAlt={`${dictionary.heroImageAlt} ${draft.name}`}
          className="absolute inset-0"
          overlayClassName="bg-[linear-gradient(180deg,rgba(251,247,240,0.18),rgba(251,247,240,0.88)_78%)]"
        />
        <div className="relative z-10 flex min-h-[70svh] flex-col justify-end px-6 pb-12 pt-24 md:px-10 md:pb-16">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] opacity-70">
            {draft.eyebrow}
          </p>
          <h1
            className={cn(
              "mt-5 max-w-4xl text-[clamp(3.8rem,9vw,7.5rem)] font-semibold leading-[0.86] tracking-[-0.055em]",
              fontPairClass(tokens),
            )}
          >
            {draft.name}
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 opacity-75 md:text-lg">
            {draft.description}
          </p>
        </div>
      </section>

      <section
        id="menu"
        className="border-t border-current/10 px-6 py-16 md:px-10 md:py-24"
      >
        <div className="mx-auto max-w-6xl">
          <div className="mb-10 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--theme-accent)]">
                {dictionary.daylightMenuEyebrow}
              </p>
              <h2
                className={cn(
                  "mt-3 text-5xl font-semibold leading-[0.92] tracking-[-0.045em] md:text-6xl",
                  fontPairClass(tokens),
                )}
              >
                {dictionary.daylightMenuHeading}
              </h2>
            </div>
            <ThemeLocation draft={draft} className="max-w-sm text-sm opacity-65" />
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            {draft.catalogSections.map((section) => (
              <section
                key={section.name}
                className="rounded-[1.5rem] border border-current/10 bg-[var(--theme-surface)] p-6"
              >
                <h3 className="text-xl font-semibold tracking-[-0.03em]">
                  {section.name}
                </h3>
                <p className="mt-2 text-sm leading-6 opacity-60">
                  {section.description}
                </p>
                <div className="mt-6 space-y-4">
                  {section.items
                    .filter((item) => item.available !== false)
                    .map((item) => (
                      <div
                        key={item.name}
                        className="grid grid-cols-[1fr_auto] gap-4 border-t border-current/8 pt-4"
                      >
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="font-medium">{item.name}</h4>
                            {itemBadges(item.attributes).map((label) => (
                              <span
                                key={label}
                                className="rounded-full bg-[var(--theme-fg)]/8 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]"
                              >
                                {label}
                              </span>
                            ))}
                          </div>
                          <p className="mt-1.5 text-sm leading-6 opacity-65">
                            {item.description}
                          </p>
                        </div>
                        <span className="font-mono text-sm">
                          {formatPrice(item.price, item.currency, locale)}
                        </span>
                      </div>
                    ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </section>

      <SitePhotoGallery
        draft={draft}
        eyebrow={dictionary.featuredHeading}
        heading={dictionary.featuredSubheading}
        enabled={draft.attributes.showMenuImages === true}
      />

      <section
        id="visit"
        className="border-t border-current/10 bg-[var(--theme-surface)] px-6 py-14 md:px-10"
      >
        <div className="mx-auto flex max-w-6xl flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <p
            className={cn(
              "max-w-2xl text-3xl font-semibold leading-[1.05] tracking-[-0.035em] md:text-4xl",
              fontPairClass(tokens),
            )}
          >
            {dictionary.daylightVisitHeading}
          </p>
          {ordering ? (
            <ThemeExternalAction
              integration={ordering}
              locale={locale}
              className="inline-flex min-h-12 items-center gap-2 rounded-full bg-[var(--theme-accent)] px-5 py-3 text-sm font-semibold text-[var(--theme-accent-fg)]"
            />
          ) : null}
        </div>
      </section>

      <footer className="grid gap-3 border-t border-current/10 px-6 py-7 text-xs opacity-55 sm:grid-cols-3 md:px-10">
        <span>{draft.name}</span>
        <ThemeBusinessHours draft={draft} />
        <ThemeContact draft={draft} className="sm:text-right" />
      </footer>
    </article>
  );
}
