import { MoonStar } from "lucide-react";
import { formatPrice } from "@/lib/site-draft";
import { SiteBrand, SourceNavigation } from "@/components/site-brand";
import { KenBurns, motionProps, Stagger } from "@/components/motion";
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

/**
 * Atmosphere-led room. The visit is the action, so there is no order rail and
 * no category navigation: the menu is read as prose on a slow scroll. Motion is
 * CSS-only and reveals on view, so a customer with reduced motion still lands
 * on a fully composed page.
 */
export function VesperRoomTheme({
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
  const roomLink = draft.integrations.find(
    (integration) => integration.enabled && integration.type === "social",
  );
  const booking = draft.integrations.find(
    (integration) => integration.enabled && integration.type === "booking",
  );
  const tokens = selection.tokens;

  return (
    <article
      lang={locale}
      data-site-theme={selection.themeId}
      data-theme-version={selection.rendererVersion}
      data-primary-intent="visit"
      data-menu-experience="editorial"
      className={cn(
        "relative overflow-hidden font-sans",
        embedded ? "min-h-[760px] rounded-[1.5rem]" : "min-h-screen",
      )}
      style={themeStyle(tokens, sourceBrandPalette(draft))}
    >
      <ThemeAnalytics draft={draft} enabled={analyticsEnabled} />

      <section className="relative min-h-[88svh] overflow-hidden">
        <KenBurns
          className="absolute inset-0"
          durationMs={24000}
          scaleTo={1.08}
        >
          <ThemeHeroImage
            draft={draft}
            imageAlt={`${dictionary.heroImageAlt} ${draft.name}`}
            className="absolute inset-0"
            overlayClassName="bg-[linear-gradient(180deg,rgba(10,8,14,0.72),rgba(10,8,14,0.28)_38%,rgba(10,8,14,0.94))]"
          />
        </KenBurns>

        <header className="relative z-10 flex items-center justify-between gap-5 px-6 py-6 text-[#f2ece2] md:px-12">
          <SiteBrand
            draft={draft}
            href="#menu"
            className={cn(
              "text-lg tracking-[0.26em] uppercase",
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
              className="border-white/25"
            />
            <ThemeBlogNav
              href={blogHref}
              enabled={analyticsEnabled}
              label={dictionary.blogNav}
            />
            {roomLink ? (
              <ThemeExternalAction
                integration={roomLink}
                locale={locale}
                className="hidden items-center gap-2 text-[11px] uppercase tracking-[0.18em] opacity-80 sm:inline-flex"
              />
            ) : null}
          </div>
        </header>

        <SourceNavigation
          draft={draft}
          className="relative z-10 border-white/10 text-[#f2ece2]"
        />

        <div className="relative z-10 flex min-h-[calc(88svh-96px)] flex-col justify-end px-6 pb-16 pt-28 text-[#f2ece2] md:px-12 md:pb-24">
          <p
            {...motionProps({
              preset: "fade-in",
              durationMs: 1400,
              className:
                "flex items-center gap-3 text-[11px] uppercase tracking-[0.3em] text-[#f2ece2]/65",
            })}
          >
            <MoonStar className="size-4" />
            {dictionary.vesperArrivalEyebrow}
          </p>
          <h1
            {...motionProps({
              preset: "rise-in",
              delayMs: 160,
              durationMs: 1600,
              distancePx: 28,
              className: cn(
                "mt-8 max-w-4xl text-[clamp(3rem,8vw,6.5rem)] leading-[0.94] tracking-[-0.03em]",
                fontPairClass(tokens),
              ),
            })}
          >
            {draft.name}
          </h1>
          <div className="mt-10 grid gap-8 border-t border-white/15 pt-8 md:grid-cols-[1.1fr_0.9fr]">
            <p
              {...motionProps({
                preset: "fade-in",
                delayMs: 320,
                durationMs: 1500,
                className:
                  "max-w-xl text-base leading-8 text-[#f2ece2]/72 md:text-lg",
              })}
            >
              {draft.description}
            </p>
            <ThemeLocation
              draft={draft}
              className="text-sm leading-7 text-[#f2ece2]/55 md:justify-self-end md:text-right"
            />
          </div>
        </div>
      </section>

      <section id="menu" className="px-6 py-20 md:px-12 md:py-32">
        <div className="mx-auto max-w-4xl">
          <p
            {...motionProps({
              preset: "fade-in",
              className:
                "text-[11px] uppercase tracking-[0.3em] text-[var(--theme-accent)]",
            })}
          >
            {dictionary.vesperMenuEyebrow}
          </p>
          <h2
            {...motionProps({
              preset: "reveal",
              durationMs: 1200,
              distancePx: 24,
              className: cn(
                "mt-6 text-4xl leading-[1.06] tracking-[-0.028em] md:text-6xl",
                fontPairClass(tokens),
              ),
            })}
          >
            {dictionary.vesperMenuHeading}
          </h2>
          <p
            {...motionProps({
              preset: "fade-in",
              delayMs: 180,
              className: "mt-7 max-w-2xl text-base leading-8 opacity-65",
            })}
          >
            {dictionary.vesperMenuIntro}
          </p>

          <Stagger className="mt-20 flex flex-col gap-20" stepMs={140}>
            {draft.catalogSections.map((section) => (
              <section
                key={section.name}
                {...motionProps({
                  preset: "rise-in",
                  durationMs: 1100,
                  distancePx: 22,
                })}
              >
                <div className="flex flex-col gap-2 border-b border-current/15 pb-6">
                  <h3
                    className={cn(
                      "text-2xl tracking-[-0.02em] md:text-3xl",
                      fontPairClass(tokens),
                    )}
                  >
                    {section.name}
                  </h3>
                  <p className="text-sm leading-7 opacity-55">
                    {section.description}
                  </p>
                </div>
                <div className="mt-8 flex flex-col gap-9">
                  {section.items
                    .filter((item) => item.available !== false)
                    .map((item) => (
                      <div key={item.name} className="flex flex-col gap-2">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                          <h4 className="text-lg tracking-[-0.01em]">
                            {item.name}
                          </h4>
                          <span className="text-sm tabular-nums opacity-70">
                            {formatPrice(item.price, item.currency, locale)}
                          </span>
                        </div>
                        <p className="max-w-2xl text-sm leading-7 opacity-58">
                          {item.description}
                        </p>
                        {itemBadges(item.attributes).length > 0 ? (
                          <div className="flex flex-wrap gap-2 pt-1">
                            {itemBadges(item.attributes).map((label) => (
                              <span
                                key={label}
                                className="text-[10px] uppercase tracking-[0.2em] opacity-45"
                              >
                                {label}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                </div>
              </section>
            ))}
          </Stagger>
        </div>
      </section>

      <SitePhotoGallery
        draft={draft}
        eyebrow={dictionary.featuredHeading}
        heading={dictionary.featuredSubheading}
        enabled={draft.attributes.showMenuImages === true}
      />

      <section className="border-t border-current/12 px-6 py-24 md:px-12 md:py-32">
        <div className="mx-auto flex max-w-4xl flex-col items-start gap-10">
          <p
            {...motionProps({
              preset: "reveal",
              durationMs: 1300,
              distancePx: 20,
              className: cn(
                "max-w-3xl text-3xl leading-[1.12] tracking-[-0.028em] text-[var(--theme-accent)] md:text-5xl",
                fontPairClass(tokens),
              ),
            })}
          >
            {dictionary.vesperClosing}
          </p>
          {booking ? (
            <ThemeExternalAction
              integration={booking}
              locale={locale}
              className="inline-flex min-h-11 items-center gap-2 border-b border-current pb-1 text-xs uppercase tracking-[0.22em]"
            />
          ) : null}
        </div>
      </section>

      <footer className="grid gap-3 border-t border-current/12 px-6 py-10 text-xs opacity-50 sm:grid-cols-3 md:px-12">
        <span>{draft.name}</span>
        <ThemeBusinessHours draft={draft} />
        <ThemeContact draft={draft} className="sm:text-right" />
      </footer>
    </article>
  );
}
