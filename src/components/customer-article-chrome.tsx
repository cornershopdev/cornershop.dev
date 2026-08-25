import type { ReactNode } from "react";
import { SiteAnalytics } from "@/components/site-analytics";
import { SiteBrand } from "@/components/site-brand";
import { StorefrontBlogNav } from "@/components/storefront-blog-nav";
import {
  resolveStorefrontPrimaryAction,
  STOREFRONT_BLOG_HREF,
} from "@/lib/articles/storefront-journey";
import type { SiteDraftView } from "@/lib/site-draft";
import { getSiteDictionary, localizeIntegrationUrl } from "@/lib/site-i18n";
import { resolveVerticalConfig } from "@/lib/verticals/registry";
import type { VerticalId } from "@/lib/verticals/types";

/**
 * Customer identity, palette, home navigation, and the published snapshot's
 * primary conversion action. Blog index and article pages share this chrome so
 * they cannot drift onto a factory-like surface.
 */
export function CustomerArticleChrome({
  draft,
  vertical,
  locale = draft.defaultLocale,
  analyticsEnabled = false,
  children,
}: {
  draft: SiteDraftView;
  vertical: VerticalId;
  locale?: string;
  analyticsEnabled?: boolean;
  children: ReactNode;
}) {
  const config = resolveVerticalConfig(vertical);
  const dictionary = getSiteDictionary(config, locale);
  const primaryAction = resolveStorefrontPrimaryAction(draft, vertical);

  return (
    <div
      lang={locale}
      data-article-storefront
      className="min-h-screen font-sans"
      style={
        {
          "--site-bg": draft.palette.background,
          "--site-fg": draft.palette.foreground,
          "--site-accent": draft.palette.accent,
          "--site-accent-fg": draft.palette.accentForeground ?? "#ffffff",
          background: "var(--site-bg)",
          color: "var(--site-fg)",
        } as React.CSSProperties
      }
    >
      {analyticsEnabled ? <SiteAnalytics siteSlug={draft.slug} /> : null}
      <header className="relative z-20 flex flex-wrap items-center justify-between gap-3 border-b border-current/10 p-4 sm:p-5 md:p-8">
        <SiteBrand
          draft={draft}
          href="/"
          className="min-w-0 break-words text-lg leading-tight sm:text-xl md:text-2xl"
        />
        <div className="flex flex-wrap items-center justify-end gap-3">
          <StorefrontBlogNav
            href={STOREFRONT_BLOG_HREF}
            isLiveSurface={analyticsEnabled}
            label={dictionary.blogNav}
          />
          {primaryAction ? (
            <a
              href={localizeIntegrationUrl(primaryAction.url, locale)}
              data-analytics-cta
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center justify-center rounded-full px-4 py-2 text-center text-xs font-bold text-[var(--site-accent-fg)] focus-visible:outline-2 focus-visible:outline-offset-2"
              style={{ background: "var(--site-accent)" }}
            >
              {primaryAction.label}
            </a>
          ) : null}
        </div>
      </header>
      {children}
    </div>
  );
}
