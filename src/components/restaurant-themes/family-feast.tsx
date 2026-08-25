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

export function FamilyFeastTheme({
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
  const ordering = draft.integrations.find(
    (integration) =>
      integration.enabled &&
      ["ordering", "delivery"].includes(integration.type),
  );
  const primaryAction = booking ?? ordering;
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
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-current/12 px-5 py-4 md:px-8">
        <SiteBrand
          draft={draft}
          href="#menu"
          className={cn(
            "text-xl font-bold tracking-[-0.04em] md:text-2xl",
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
          {primaryAction ? (
            <ThemeExternalAction
              integration={primaryAction}
              locale={locale}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[var(--theme-accent)] px-4 py-3 text-sm font-bold text-[var(--theme-accent-fg)]"
            />
          ) : null}
        </div>
      </header>
      <SourceNavigation draft={draft} />

      <section className="grid border-b border-current/12 lg:grid-cols-2">
        <div className="flex flex-col justify-center gap-6 px-6 py-12 md:px-10 md:py-16">
          <span className="inline-flex w-fit rounded-md bg-[var(--theme-accent)]/12 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--theme-accent)]">
            {draft.eyebrow}
          </span>
          <h1
            className={cn(
              "max-w-3xl text-[clamp(3.4rem,7.5vw,6.5rem)] font-bold leading-[0.9] tracking-[-0.05em]",
              fontPairClass(tokens),
            )}
          >
            {draft.name}
          </h1>
          <p className="max-w-xl text-base leading-7 opacity-70">
            {draft.description}
          </p>
          <div className="flex flex-wrap gap-3">
            {booking ? (
              <ThemeExternalAction
                integration={booking}
                locale={locale}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--theme-accent)] px-4 py-3 text-sm font-bold text-[var(--theme-accent-fg)]"
              />
            ) : null}
            {ordering ? (
              <ThemeExternalAction
                integration={ordering}
                locale={locale}
                className="inline-flex items-center gap-2 rounded-lg border border-current/20 px-4 py-3 text-sm font-bold"
              />
            ) : (
              <a
                href="#menu"
                className="inline-flex items-center rounded-lg border border-current/20 px-4 py-3 text-sm font-bold"
              >
                {dictionary.themeBrowseMenu}
              </a>
            )}
          </div>
        </div>
        <ThemeHeroImage
          draft={draft}
          imageAlt={`${dictionary.heroImageAlt} ${draft.name}`}
          className="min-h-[380px] lg:min-h-full"
        />
      </section>

      <nav
        aria-label={dictionary.themeMenuCategories}
        className="flex gap-2 overflow-x-auto border-b border-current/12 bg-[var(--theme-bg)] px-5 py-3 md:px-8"
      >
        {draft.catalogSections.map((section, index) => (
          <a
            key={section.name}
            href={`#menu-section-${index}`}
            className="shrink-0 rounded-lg border border-current/15 px-3 py-2 text-xs font-bold uppercase tracking-[0.08em]"
          >
            {section.name}
          </a>
        ))}
      </nav>

      <section id="menu" className="px-5 py-12 md:px-8 md:py-16">
        <div className="mx-auto max-w-7xl">
          <div className="mb-8 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--theme-accent)]">
                {dictionary.familyMenuEyebrow}
              </p>
              <h2 className="mt-2 text-4xl font-bold tracking-[-0.04em] md:text-5xl">
                {dictionary.familyMenuHeading}
              </h2>
            </div>
            <ThemeLocation draft={draft} className="max-w-sm text-sm opacity-65" />
          </div>
          <div className="space-y-10">
            {draft.catalogSections.map((section, sectionIndex) => (
              <section
                key={section.name}
                id={`menu-section-${sectionIndex}`}
              >
                <div className="mb-4 flex flex-col gap-1 border-b border-current/12 pb-4 sm:flex-row sm:items-end sm:justify-between">
                  <h3 className="text-2xl font-bold tracking-[-0.03em]">
                    {section.name}
                  </h3>
                  <p className="text-sm opacity-60">{section.description}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {section.items
                    .filter((item) => item.available !== false)
                    .map((item) => (
                      <article
                        key={item.name}
                        className="grid grid-cols-[1fr_auto] gap-4 rounded-xl border border-current/10 bg-[var(--theme-surface)] p-4"
                      >
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="font-semibold">{item.name}</h4>
                            {itemBadges(item.attributes).map((label) => (
                              <span
                                key={label}
                                className="rounded bg-[var(--theme-accent)]/12 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--theme-accent)]"
                              >
                                {label}
                              </span>
                            ))}
                          </div>
                          <p className="mt-2 text-sm leading-6 opacity-65">
                            {item.description}
                          </p>
                        </div>
                        <span className="font-mono text-sm font-semibold">
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

      <footer className="grid gap-3 border-t border-current/12 px-6 py-8 text-sm sm:grid-cols-3 md:px-10">
        <span className="font-bold">{draft.name}</span>
        <ThemeBusinessHours draft={draft} />
        <ThemeContact draft={draft} className="sm:text-right" />
      </footer>
    </article>
  );
}
