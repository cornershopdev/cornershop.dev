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

export function CounterServiceTheme({
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
      data-primary-intent="order"
      data-menu-experience="commerce"
      className={cn(
        "relative overflow-hidden font-sans",
        embedded ? "min-h-[760px] rounded-[1.5rem]" : "min-h-screen",
      )}
      style={themeStyle(tokens, sourceBrandPalette(draft))}
    >
      <ThemeAnalytics draft={draft} enabled={analyticsEnabled} />
      <header className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-current px-5 py-4 md:px-8">
        <SiteBrand
          draft={draft}
          href="#menu"
          className={cn(
            "text-2xl font-black tracking-[-0.05em] md:text-3xl",
            fontPairClass(tokens),
          )}
        />
        <div className="flex items-center gap-2">
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
          <ThemeLocation
            draft={draft}
            className="hidden max-w-[16rem] text-xs font-medium md:flex"
          />
          {ordering ? (
            <ThemeExternalAction
              integration={ordering}
              locale={locale}
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[var(--theme-accent)] px-5 py-3 text-sm font-black text-[var(--theme-accent-fg)]"
            />
          ) : null}
        </div>
      </header>
      <SourceNavigation draft={draft} />

      <section className="grid border-b-2 border-current lg:grid-cols-[0.95fr_1.05fr]">
        <div className="flex flex-col justify-between gap-10 px-6 py-10 md:px-10 md:py-14">
          <div>
            <span className="inline-flex rounded-full border-2 border-current px-3 py-1 text-[11px] font-black uppercase tracking-[0.1em]">
              {draft.eyebrow}
            </span>
            <h1
              className={cn(
                "mt-7 max-w-3xl text-[clamp(4rem,10vw,8.5rem)] font-black leading-[0.76] tracking-[-0.07em]",
                fontPairClass(tokens),
              )}
            >
              {draft.name}
            </h1>
          </div>
          <div className="grid gap-6 sm:grid-cols-[1fr_auto] sm:items-end">
            <p className="max-w-xl text-base font-medium leading-7">
              {draft.description}
            </p>
            {ordering ? (
              <ThemeExternalAction
                integration={ordering}
                locale={locale}
                className="inline-flex items-center justify-center gap-2 rounded-full border-2 border-current bg-[var(--theme-surface)] px-5 py-3 text-sm font-black"
              />
            ) : (
              <a
                href="#menu"
                className="rounded-full border-2 border-current px-5 py-3 text-center text-sm font-black"
              >
                {dictionary.themeBrowseMenu}
              </a>
            )}
          </div>
        </div>
        <ThemeHeroImage
          draft={draft}
          imageAlt={`${dictionary.heroImageAlt} ${draft.name}`}
          className="min-h-[400px] border-t-2 border-current lg:min-h-[640px] lg:border-l-2 lg:border-t-0"
        />
      </section>

      <nav
        aria-label={dictionary.themeMenuCategories}
        className="sticky top-0 z-10 flex gap-2 overflow-x-auto border-b-2 border-current bg-[var(--theme-bg)] px-5 py-3 md:px-8"
      >
        {draft.catalogSections.map((section, index) => (
          <a
            key={section.name}
            href={`#menu-section-${index}`}
            className="shrink-0 rounded-full border-2 border-current px-4 py-2 text-xs font-black uppercase tracking-[0.08em]"
          >
            {section.name}
          </a>
        ))}
      </nav>

      <section id="menu" className="px-5 py-12 md:px-8 md:py-16">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-4 border-b-2 border-current pb-8 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.12em]">
                {dictionary.counterMenuEyebrow}
              </p>
              <h2 className="mt-2 text-5xl font-black tracking-[-0.055em] md:text-7xl">
                {dictionary.counterMenuHeading}
              </h2>
            </div>
            <ThemeLocation draft={draft} className="max-w-sm text-sm" />
          </div>
          <div className="space-y-16 pt-10">
            {draft.catalogSections.map((section, sectionIndex) => (
              <section
                key={section.name}
                id={`menu-section-${sectionIndex}`}
              >
                <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <h3 className="text-3xl font-black tracking-[-0.04em]">
                    {section.name}
                  </h3>
                  <p className="text-sm font-medium opacity-70">
                    {section.description}
                  </p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {section.items
                    .filter((item) => item.available !== false)
                    .map((item) => (
                      <article
                        key={item.name}
                        className="grid min-h-44 grid-cols-[1fr_auto] gap-5 rounded-[1.4rem] border-2 border-current bg-[var(--theme-surface)] p-5"
                      >
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-lg font-black">{item.name}</h4>
                            {itemBadges(item.attributes).map((label) => (
                              <span
                                key={label}
                                className="rounded-full bg-[var(--theme-fg)] px-2 py-1 text-[9px] font-black uppercase tracking-[0.1em] text-[var(--theme-bg)]"
                              >
                                {label}
                              </span>
                            ))}
                          </div>
                          <p className="mt-3 text-sm leading-6 opacity-70">
                            {item.description}
                          </p>
                        </div>
                        <span className="font-mono text-sm font-bold">
                          {formatPrice(item.price, item.currency, locale)}
                        </span>
                      </article>
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

      <footer
        className={cn(
          "border-t-2 border-current px-5 py-8 md:px-8",
          ordering && !embedded ? "pb-24 md:pb-8" : undefined,
        )}
      >
        <div className="mx-auto grid max-w-7xl gap-4 text-sm sm:grid-cols-3 sm:items-start">
          <span className="font-black">{draft.name}</span>
          <ThemeBusinessHours draft={draft} />
          <ThemeContact draft={draft} className="sm:text-right" />
        </div>
      </footer>

      {ordering && !embedded ? (
        <div className="fixed inset-x-4 bottom-4 z-30 md:hidden">
          <ThemeExternalAction
            integration={ordering}
            locale={locale}
            className="flex min-h-14 items-center justify-center gap-2 rounded-full border-2 border-current bg-[var(--theme-accent)] px-6 py-4 text-sm font-black text-[var(--theme-accent-fg)] shadow-xl"
          />
        </div>
      ) : null}
      {ordering && embedded ? (
        <div className="sticky bottom-3 z-20 mx-3">
          <ThemeExternalAction
            integration={ordering}
            locale={locale}
            className="flex min-h-12 items-center justify-center gap-2 rounded-full border-2 border-current bg-[var(--theme-accent)] px-5 py-3 text-xs font-black text-[var(--theme-accent-fg)] shadow-lg"
          />
        </div>
      ) : null}
    </article>
  );
}
