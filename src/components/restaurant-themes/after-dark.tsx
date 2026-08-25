import { CalendarDays, Clock3 } from "lucide-react";
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

export function AfterDarkTheme({
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
  const eventLink = draft.integrations.find(
    (integration) =>
      integration.enabled && integration.type === "social",
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
      <section className="relative min-h-[82svh] overflow-hidden border-b border-white/15">
        <ThemeHeroImage
          draft={draft}
          imageAlt={`${dictionary.heroImageAlt} ${draft.name}`}
          className="absolute inset-0"
          overlayClassName="bg-[linear-gradient(90deg,rgba(7,6,6,0.92),rgba(7,6,6,0.34)_62%,rgba(7,6,6,0.58))]"
        />
        <header className="relative z-10 flex items-center justify-between gap-5 border-b border-white/15 px-5 py-5 text-[#f5efe4] md:px-9">
          <SiteBrand
            draft={draft}
            href="#menu"
            className={cn(
              "text-lg font-bold tracking-[0.08em]",
              fontPairClass(tokens),
            )}
          />
          <div className="flex items-center gap-4">
            <ThemeLocaleNavigation
              locale={locale}
              localeBasePath={localeBasePath}
              availableLocales={availableLocales}
              defaultLocale={draft.defaultLocale}
              label={dictionary.language}
              className="border-white/30"
            />
            <ThemeBlogNav
              href={blogHref}
              enabled={analyticsEnabled}
              label={dictionary.blogNav}
            />
            {eventLink ? (
              <ThemeExternalAction
                integration={eventLink}
                locale={locale}
                className="hidden items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] sm:inline-flex"
              />
            ) : null}
            {booking ? (
              <ThemeExternalAction
                integration={booking}
                locale={locale}
                className="inline-flex min-h-11 items-center gap-2 rounded-md bg-[var(--theme-accent)] px-4 py-3 text-xs font-black uppercase tracking-[0.11em] text-[var(--theme-accent-fg)]"
              />
            ) : null}
          </div>
        </header>
        <SourceNavigation
          draft={draft}
          className="relative z-10 border-white/15 text-[#f5efe4]"
        />
        <div className="relative z-10 flex min-h-[calc(82svh-86px)] flex-col justify-end px-6 pb-12 pt-24 text-[#f5efe4] md:px-10 md:pb-16">
          <div className="grid gap-10 lg:grid-cols-[1fr_0.55fr] lg:items-end">
            <div>
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#f5efe4]/65">
                <Clock3 className="size-4" />
                {draft.eyebrow}
              </p>
              <h1
                className={cn(
                  "mt-6 max-w-5xl text-[clamp(4.2rem,12vw,10rem)] font-black leading-[0.72] tracking-[-0.075em]",
                  fontPairClass(tokens),
                )}
              >
                {draft.name}
              </h1>
            </div>
            <div className="border-l border-white/25 pl-5">
              <p className="max-w-md text-sm leading-7 text-[#f5efe4]/72 md:text-base">
                {draft.description}
              </p>
              <ThemeLocation
                draft={draft}
                className="mt-6 max-w-sm text-sm text-[#f5efe4]/60"
              />
            </div>
          </div>
        </div>
      </section>

      {eventLink ? (
        <section className="border-b border-current/15 bg-[var(--theme-surface)] px-6 py-7 md:px-10">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <CalendarDays className="size-5 text-[var(--theme-accent)]" />
              <p className="text-[10px] font-bold uppercase tracking-[0.18em]">
                {dictionary.afterDarkEventsEyebrow}
              </p>
            </div>
            <ThemeExternalAction
              integration={eventLink}
              locale={locale}
              className="inline-flex items-center gap-2 border-b border-current pb-1 text-xs font-bold uppercase tracking-[0.12em]"
            />
          </div>
        </section>
      ) : null}

      <section
        id="menu"
        className="px-6 py-16 md:px-10 md:py-24"
      >
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-8 border-b border-current/20 pb-10 lg:grid-cols-[0.7fr_1.3fr] lg:items-end">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--theme-accent)]">
                {dictionary.afterDarkMenuEyebrow}
              </p>
              <h2
                className={cn(
                  "mt-4 text-5xl font-black leading-[0.84] tracking-[-0.055em] md:text-7xl",
                  fontPairClass(tokens),
                )}
              >
                {dictionary.afterDarkMenuHeading}
              </h2>
            </div>
            <p className="max-w-xl text-sm leading-7 opacity-65 lg:justify-self-end">
              {dictionary.afterDarkMenuIntro}
            </p>
          </div>
          <div className="grid gap-12 pt-12 lg:grid-cols-2">
            {draft.catalogSections.map((section) => (
              <section
                key={section.name}
                className="rounded-xl border border-current/20 bg-[var(--theme-surface)] p-6 md:p-8"
              >
                <div className="mb-7">
                  <h3 className="text-2xl font-bold tracking-[-0.035em]">
                    {section.name}
                  </h3>
                  <p className="mt-2 text-sm opacity-55">
                    {section.description}
                  </p>
                </div>
                <div className="divide-y divide-current/15">
                  {section.items
                    .filter((item) => item.available !== false)
                    .map((item) => (
                      <div
                        key={item.name}
                        className="grid grid-cols-[1fr_auto] gap-5 py-5"
                      >
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="font-semibold">{item.name}</h4>
                            {itemBadges(item.attributes).map((label) => (
                              <span
                                key={label}
                                className="rounded-full border border-current/25 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.11em] opacity-65"
                              >
                                {label}
                              </span>
                            ))}
                          </div>
                          <p className="mt-2 text-sm leading-6 opacity-62">
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

      <section className="border-t border-current/15 bg-[var(--theme-accent)] px-6 py-12 text-[var(--theme-accent-fg)] md:px-10">
        <div className="mx-auto flex max-w-7xl flex-col gap-7 md:flex-row md:items-end md:justify-between">
          <p
            className={cn(
              "max-w-3xl text-4xl font-black leading-[0.9] tracking-[-0.045em] md:text-6xl",
              fontPairClass(tokens),
            )}
          >
            {dictionary.afterDarkClosing}
          </p>
          {booking ? (
            <ThemeExternalAction
              integration={booking}
              locale={locale}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-[var(--theme-accent-fg)] px-5 py-3 text-sm font-black uppercase tracking-[0.1em] text-[var(--theme-accent)]"
            />
          ) : null}
        </div>
      </section>

      <footer className="grid gap-3 border-t border-current/15 px-6 py-8 text-xs opacity-55 sm:grid-cols-3 md:px-10">
        <span>{draft.name}</span>
        <ThemeBusinessHours draft={draft} />
        <ThemeContact draft={draft} className="sm:text-right" />
      </footer>
    </article>
  );
}
