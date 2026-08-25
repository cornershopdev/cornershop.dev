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

export function TerroirEditorialTheme({
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
  const supportingLinks = draft.integrations.filter(
    (integration) =>
      integration.enabled && integration !== booking,
  );
  const tokens = selection.tokens;

  return (
    <article
      lang={locale}
      data-site-theme={selection.themeId}
      data-theme-version={selection.rendererVersion}
      data-primary-intent="reserve"
      data-menu-experience="editorial"
      className={cn(
        "relative overflow-hidden font-sans",
        embedded ? "min-h-[760px] rounded-[1.5rem]" : "min-h-screen",
      )}
      style={themeStyle(tokens, sourceBrandPalette(draft))}
    >
      <ThemeAnalytics draft={draft} enabled={analyticsEnabled} />
      <header className="grid grid-cols-[1fr_auto] items-center gap-5 border-b border-current/15 px-5 py-5 md:px-10">
        <SiteBrand
          draft={draft}
          href="#menu"
          className={cn(
            "max-w-[18rem] text-xl leading-none tracking-[-0.035em] md:text-2xl",
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
              className="inline-flex min-h-11 items-center gap-2 border-b border-current pb-1 text-xs font-semibold uppercase tracking-[0.16em]"
            />
          ) : (
            <a
              href="#visit"
              className="border-b border-current pb-1 text-xs font-semibold uppercase tracking-[0.16em]"
            >
              {dictionary.themePlanVisit}
            </a>
          )}
        </div>
      </header>
      <SourceNavigation draft={draft} />

      <section className="grid min-h-[74svh] lg:grid-cols-[0.82fr_1.18fr]">
        <div className="flex flex-col justify-between gap-16 px-6 py-10 md:px-10 md:py-14 lg:py-20">
          <p className="max-w-sm text-xs font-semibold uppercase tracking-[0.2em] opacity-65">
            {draft.eyebrow}
          </p>
          <div>
            <h1
              className={cn(
                "max-w-3xl text-[clamp(4rem,9vw,8rem)] leading-[0.82] tracking-[-0.055em]",
                fontPairClass(tokens),
              )}
            >
              {draft.name}
            </h1>
            <p className="mt-8 max-w-xl text-base leading-7 opacity-72 md:text-lg">
              {draft.description}
            </p>
          </div>
          <ThemeLocation draft={draft} className="max-w-sm text-sm opacity-65" />
        </div>
        <ThemeHeroImage
          draft={draft}
          imageAlt={`${dictionary.heroImageAlt} ${draft.name}`}
          className="min-h-[480px] lg:min-h-full"
          overlayClassName="bg-[linear-gradient(180deg,transparent_65%,rgba(20,18,15,0.18))]"
        />
      </section>

      <section
        id="menu"
        className="border-t border-current/15 px-6 py-16 md:px-10 md:py-24"
      >
        <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[0.55fr_1.45fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-55">
              {dictionary.themeMenuEyebrow}
            </p>
            <h2
              className={cn(
                "mt-4 max-w-sm text-5xl leading-[0.9] tracking-[-0.045em] md:text-7xl",
                fontPairClass(tokens),
              )}
            >
              {dictionary.terroirMenuHeading}
            </h2>
          </div>
          <div className="space-y-14">
            {draft.catalogSections.map((section) => (
              <section key={section.name}>
                <div className="grid gap-2 border-b border-current/20 pb-5 sm:grid-cols-[1fr_1fr]">
                  <h3 className="text-xl font-semibold">{section.name}</h3>
                  <p className="text-sm leading-6 opacity-60">
                    {section.description}
                  </p>
                </div>
                <div className="divide-y divide-current/12">
                  {section.items
                    .filter((item) => item.available !== false)
                    .map((item) => (
                      <div
                        key={item.name}
                        className="grid gap-4 py-6 sm:grid-cols-[1fr_auto]"
                      >
                        <div>
                          <div className="flex flex-wrap items-center gap-3">
                            <h4 className="font-medium">{item.name}</h4>
                            {itemBadges(item.attributes).map((label) => (
                              <span
                                key={label}
                                className="text-[10px] font-semibold uppercase tracking-[0.13em] opacity-55"
                              >
                                {label}
                              </span>
                            ))}
                          </div>
                          <p className="mt-2 max-w-xl text-sm leading-6 opacity-65">
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
        className="border-t border-current/15 bg-[var(--theme-surface)] px-6 py-14 md:px-10"
      >
        <div className="mx-auto flex max-w-6xl flex-col gap-8 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-55">
              {dictionary.terroirVisitEyebrow}
            </p>
            <p
              className={cn(
                "mt-3 max-w-2xl text-4xl leading-[0.94] tracking-[-0.04em] md:text-6xl",
                fontPairClass(tokens),
              )}
            >
              {dictionary.terroirVisitHeading}
            </p>
          </div>
          <div className="flex flex-wrap gap-5">
            {booking ? (
              <ThemeExternalAction
                integration={booking}
                locale={locale}
                className="inline-flex items-center gap-2 bg-[var(--theme-accent)] px-5 py-3 text-sm font-semibold text-[var(--theme-accent-fg)]"
              />
            ) : null}
            {supportingLinks.map((integration) => (
              <ThemeExternalAction
                key={`${integration.type}-${integration.url}`}
                integration={integration}
                locale={locale}
                className="inline-flex items-center gap-2 border-b border-current py-2 text-sm"
              />
            ))}
          </div>
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
