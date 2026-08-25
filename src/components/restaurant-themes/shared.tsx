import { ArrowUpRight, MapPin } from "lucide-react";
import Link from "next/link";
import { SiteAnalytics } from "@/components/site-analytics";
import { StorefrontBlogNav } from "@/components/storefront-blog-nav";
import { localizeIntegrationUrl } from "@/lib/site-i18n";
import { localeHref } from "@/lib/site-surface";
import { serializeRestaurantJsonLd } from "@/lib/restaurant-json-ld";
import type { SiteDraftView, SiteIntegrationView } from "@/lib/site-draft";
import type {
  RestaurantThemeSelection,
  RestaurantThemeTokens,
} from "@/lib/site-themes/restaurant/contracts";
import { cn } from "@/lib/utils";

export type RestaurantThemeRendererProps = {
  draft: SiteDraftView;
  selection: RestaurantThemeSelection;
  locale?: string;
  localeBasePath?: string;
  availableLocales?: string[];
  dictionary: Record<string, string>;
  embedded?: boolean;
  analyticsEnabled?: boolean;
  blogHref?: string | null;
};

export type RestaurantThemeRendererInputProps = Omit<
  RestaurantThemeRendererProps,
  "dictionary"
> & {
  dictionary?: Record<string, string>;
};

export function themeStyle(
  tokens: RestaurantThemeTokens,
  palette?: SiteDraftView["palette"],
): React.CSSProperties {
  const background = palette?.background ?? tokens.colors.background;
  const foreground = palette?.foreground ?? tokens.colors.foreground;
  return {
    "--theme-bg": background,
    "--theme-fg": foreground,
    "--theme-surface": palette
      ? `color-mix(in srgb, ${background}, ${foreground} 7%)`
      : tokens.colors.surface,
    "--theme-accent": palette?.accent ?? tokens.colors.accent,
    "--theme-accent-fg":
      palette?.accentForeground ?? tokens.colors.accentForeground,
    background: "var(--theme-bg)",
    color: "var(--theme-fg)",
  } as React.CSSProperties;
}

export function sourceBrandPalette(
  draft: Pick<SiteDraftView, "palette" | "sourceData">,
): SiteDraftView["palette"] | undefined {
  return draft.sourceData?.evidence.some((item) =>
    item.field.startsWith("palette."),
  )
    ? draft.palette
    : undefined;
}

export function fontPairClass(tokens: RestaurantThemeTokens): string {
  return {
    editorial: "font-display",
    grotesk: "font-sans",
    condensed: "font-mono uppercase",
  }[tokens.style.fontPair];
}

export function ThemeAnalytics({
  draft,
  enabled,
}: {
  draft: SiteDraftView;
  enabled: boolean;
}) {
  return enabled ? <SiteAnalytics siteSlug={draft.slug} /> : null;
}

export function RestaurantStructuredData({
  draft,
  enabled,
}: {
  draft: SiteDraftView;
  enabled: boolean;
}) {
  if (!enabled) return null;
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeRestaurantJsonLd(draft) }}
    />
  );
}

export function ThemeHeroImage({
  draft,
  imageAlt,
  className,
  overlayClassName,
}: {
  draft: Pick<SiteDraftView, "heroImageUrl" | "name">;
  imageAlt: string;
  className?: string;
  overlayClassName?: string;
}) {
  return (
    <div
      role={draft.heroImageUrl ? "img" : undefined}
      aria-label={draft.heroImageUrl ? imageAlt : undefined}
      className={cn(
        "relative overflow-hidden bg-[var(--theme-surface)] bg-cover bg-center",
        className,
      )}
      style={
        draft.heroImageUrl
          ? { backgroundImage: `url("${draft.heroImageUrl}")` }
          : undefined
      }
    >
      {overlayClassName ? (
        <div className={cn("absolute inset-0", overlayClassName)} />
      ) : null}
    </div>
  );
}

export function ThemeLocation({
  draft,
  className,
}: {
  draft: Pick<SiteDraftView, "address">;
  className?: string;
}) {
  return draft.address ? (
    <span className={cn("flex items-start gap-2", className)}>
      <MapPin className="mt-0.5 size-4 shrink-0" />
      {draft.address}
    </span>
  ) : null;
}

export function ThemeBusinessHours({
  draft,
  className,
}: {
  draft: Pick<SiteDraftView, "businessHours">;
  className?: string;
}) {
  if (draft.businessHours.length === 0) return null;
  return (
    <dl className={cn("grid gap-1", className)}>
      {draft.businessHours.map((row) => (
        <div
          key={`${row.days}-${row.hours}`}
          className="flex flex-wrap justify-between gap-x-4"
        >
          <dt>{row.days}</dt>
          <dd>{row.hours}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ThemeContact({
  draft,
  className,
}: {
  draft: Pick<SiteDraftView, "address" | "phone" | "email">;
  className?: string;
}) {
  if (!draft.address && !draft.phone && !draft.email) return null;
  return (
    <address className={cn("grid gap-1 not-italic", className)}>
      {draft.address ? <span>{draft.address}</span> : null}
      {draft.phone ? <a href={`tel:${draft.phone}`}>{draft.phone}</a> : null}
      {draft.email ? <a href={`mailto:${draft.email}`}>{draft.email}</a> : null}
    </address>
  );
}

export function ThemeExternalAction({
  integration,
  locale,
  className,
}: {
  integration: SiteIntegrationView;
  locale?: string;
  className?: string;
}) {
  return (
    <a
      href={
        locale
          ? localizeIntegrationUrl(integration.url, locale)
          : integration.url
      }
      data-analytics-cta
      target="_blank"
      rel="noreferrer"
      className={className}
    >
      {integration.label}
      <ArrowUpRight className="size-4 shrink-0" />
    </a>
  );
}

export function ThemeBlogNav({
  href,
  enabled,
  label,
  className,
}: {
  href?: string | null;
  enabled: boolean;
  label: string;
  className?: string;
}) {
  return (
    <StorefrontBlogNav
      href={href}
      isLiveSurface={enabled}
      label={label}
      className={className}
    />
  );
}

export function ThemeLocaleNavigation({
  locale,
  localeBasePath,
  availableLocales,
  defaultLocale,
  label,
  className,
}: {
  locale: string;
  localeBasePath?: string;
  availableLocales: string[];
  defaultLocale: string;
  label: string;
  className?: string;
}) {
  if (!localeBasePath || availableLocales.length < 2) return null;

  return (
    <nav
      aria-label={label}
      className={cn(
        "flex items-center rounded-full border border-current/25 p-1 text-[10px] font-bold uppercase tracking-[0.08em]",
        className,
      )}
    >
      {availableLocales.map((availableLocale) => (
        <Link
          key={availableLocale}
          href={localeHref(
            localeBasePath,
            availableLocale,
            defaultLocale,
          )}
          hrefLang={availableLocale}
          aria-current={availableLocale === locale ? "page" : undefined}
          className={cn(
            "inline-flex min-h-8 min-w-8 items-center justify-center rounded-full px-2",
            availableLocale === locale
              ? "bg-[var(--theme-fg)] text-[var(--theme-bg)]"
              : "opacity-70 hover:opacity-100",
          )}
        >
          {availableLocale.split("-")[0]}
        </Link>
      ))}
    </nav>
  );
}

export function itemBadges(attributes: Record<string, unknown>): string[] {
  const labels = attributes.dietaryLabels;
  return Array.isArray(labels)
    ? labels.filter((label): label is string => typeof label === "string")
    : [];
}
