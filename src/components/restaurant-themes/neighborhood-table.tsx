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

export function NeighborhoodTableTheme({
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
  const booking = draft.integrations.find(
    (integration) =>
      integration.enabled && integration.type === "booking",
  );
  const tokens = selection.tokens;

  return (
    <article
      lang={locale}
      data-site-theme={selection.themeId}
      data-theme-version={selection.rendererVersion}
      data-primary-intent="reserve"
      data-menu-experience="catalog"
      className={cn(
        "relative overflow-hidden font-sans",
        embedded ? "min-h-[760px] rounded-[1.5rem]" : "min-h-screen",
      )}
      style={themeStyle(tokens, sourceBrandPalette(draft))}
    >
      <ThemeAnalytics draft={draft} enabled={analyticsEnabled} />
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-current/15 px-5 py-5 md:px-8">
        <SiteBrand
          draft={draft}
          href="#menu"
          className={cn(
            "text-xl font-semibold tracking-[-0.03em] md:text-2xl",
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
          {booking ? (
            <ThemeExternalAction
              integration={booking}
              locale={locale}
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[var(--theme-accent)] px-5 py-3 text-sm font-semibold text-[var(--theme-accent-fg)]"
            />
          ) : (
            <a
              href="#visit"
              className="inline-flex min-h-11 items-center rounded-full border border-current/25 px-5 py-3 text-sm font-semibold"
            >
              {dictionary.themePlanVisit}
            </a>
          )}
        </div>
      </header>
      <SourceNavigation draft={draft} />

      <section className="grid border-b border-current/15 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="flex flex-col justify-center gap-8 px-6 py-14 md:px-10 md:py-20">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] opacity-60">
            {draft.eyebrow}
          </p>
          <h1
            className={cn(
              "max-w-3xl text-[clamp(3.6rem,8vw,7rem)] leading-[0.88] tracking-[-0.05em]",
              fontPairClass(tokens),
            )}
          >
            {draft.name}
          </h1>
          <p className="max-w-xl text-base leading-7 opacity-72 md:text-lg">
            {draft.description}
          </p>
          <ThemeLocation draft={draft} className="max-w-md text-sm opacity-65" />
        </div>
        <ThemeHeroImage
          draft={draft}
          imageAlt={`${dictionary.heroImageAlt} ${draft.name}`}
          className="min-h-[420px] lg:min-h-full"
          overlayClassName="bg-[linear-gradient(180deg,transparent_70%,rgba(42,36,28,0.16))]"
        />
      </section>

      <section
        id="menu"
        className="px-6 py-16 md:px-10 md:py-24"
      >
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] opacity-55">
              {dictionary.themeMenuEyebrow}
            </p>
            <h2
              className={cn(
                "mt-4 text-5xl leading-[0.92] tracking-[-0.045em] md:text-6xl",
                fontPairClass(tokens),
              )}
            >
              {dictionary.neighborhoodMenuHeading}
            </h2>
          </div>
          <div className="space-y-12">
            {draft.catalogSections.map((section) => (
              <section
                key={section.name}
                className="rounded-2xl border border-current/12 bg-[var(--theme-surface)] p-6 md:p-8"
              >
                <div className="mb-6 border-b border-current/12 pb-5">
                  <h3 className="text-2xl font-semibold tracking-[-0.03em]">
                    {section.name}
                  </h3>
                  <p className="mt-2 text-sm leading-6 opacity-60">
                    {section.description}
                  </p>
                </div>
                <div className="divide-y divide-current/10">
                  {section.items
                    .filter((item) => item.available !== false)
                    .map((item) => (
                      <div
                        key={item.name}
                        className="grid gap-4 py-5 sm:grid-cols-[1fr_auto]"
                      >
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="font-medium">{item.name}</h4>
                            {itemBadges(item.attributes).map((label) => (
                              <span
                                key={label}
                                className="rounded-full border border-current/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] opacity-60"
                              >
                                {label}
                              </span>
                            ))}
                          </div>
                          <p className="mt-2 max-w-2xl text-sm leading-6 opacity-65">
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
        className="border-t border-current/15 bg-[var(--theme-accent)] px-6 py-14 text-[var(--theme-accent-fg)] md:px-10"
      >
        <div className="mx-auto flex max-w-6xl flex-col gap-8 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] opacity-75">
              {dictionary.neighborhoodVisitEyebrow}
            </p>
            <p
              className={cn(
                "mt-3 max-w-2xl text-4xl leading-[0.94] tracking-[-0.04em] md:text-5xl",
                fontPairClass(tokens),
              )}
            >
              {dictionary.neighborhoodVisitHeading}
            </p>
          </div>
          {booking ? (
            <ThemeExternalAction
              integration={booking}
              locale={locale}
              className="inline-flex min-h-12 items-center gap-2 rounded-full bg-[var(--theme-accent-fg)] px-5 py-3 text-sm font-semibold text-[var(--theme-accent)]"
            />
          ) : null}
        </div>
      </section>

      <footer className="grid gap-3 border-t border-current/15 px-6 py-7 text-xs opacity-55 sm:grid-cols-3 md:px-10">
        <span>{draft.name}</span>
        <ThemeBusinessHours draft={draft} />
        <ThemeContact draft={draft} className="sm:text-right" />
      </footer>
    </article>
  );
}
