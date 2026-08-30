import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { PreviewThemeSwitcher } from "@/components/preview-theme-switcher";
import { SiteRenderer } from "@/components/site-renderer";
import { FactoryAnalytics } from "@/components/factory-analytics";
import { FACTORY_BRAND } from "@/lib/brand";
import {
  customerHostname,
  factoryMetadataOrigin,
  previewMetadata,
} from "@/lib/preview-metadata";
import {
  PREVIEW_THEME_PARAM,
  resolvePreviewThemeAlternates,
} from "@/lib/preview-theme-alternates";
import { getSiteLocales, localizeSiteDraft } from "@/lib/site-draft";
import { resolveStorefrontBlogHref } from "@/lib/articles/public-articles";
import { liveSiteVersionId } from "@/lib/site-surface";
import {
  findSiteView,
  getCachedPublishedSiteView,
} from "@/lib/sites";

type PageProps = {
  params: Promise<{ slug: string; locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug, locale } = await params;
  const requestHeaders = await headers();
  const versionId = liveSiteVersionId(requestHeaders, slug);
  const site = versionId
    ? await getCachedPublishedSiteView(slug, versionId)
    : await findSiteView(slug);
  if (!site) notFound();
  const isLiveSurface = versionId !== null;
  const locales = getSiteLocales(site.draft);
  if (!locales.includes(locale)) notFound();
  const draft = localizeSiteDraft(site.draft, locale);

  return previewMetadata(
    {
      name: site.draft.name,
      description: draft.description,
      slug: site.draft.slug,
      defaultLocale: site.draft.defaultLocale,
      faviconUrl: site.draft.faviconUrl,
    },
    {
      isLiveSurface,
      locale,
      locales,
      verifiedHostname: isLiveSurface
        ? customerHostname(requestHeaders)
        : null,
      factoryOrigin: factoryMetadataOrigin(),
      factoryName: FACTORY_BRAND.name,
    },
  );
}

export default async function LocalizedPreviewPage({
  params,
  searchParams,
}: PageProps) {
  const { slug, locale } = await params;
  const versionId = liveSiteVersionId(await headers(), slug);
  const [site, blogHref, query] = await Promise.all([
    versionId
      ? getCachedPublishedSiteView(slug, versionId)
      : findSiteView(slug),
    resolveStorefrontBlogHref({ slug, versionId }),
    searchParams,
  ]);
  if (!site) notFound();
  const isLiveSurface = versionId !== null;
  const locales = getSiteLocales(site.draft);
  if (!locales.includes(locale)) notFound();
  // The same factory-only shortlist as the default-locale preview. The active
  // theme rides on `localeBasePath` below so switching language does not
  // silently drop the theme a visitor is looking at.
  const alternates = isLiveSurface
    ? null
    : resolvePreviewThemeAlternates({
        vertical: site.vertical,
        draft: site.draft,
        requestedTheme: query[PREVIEW_THEME_PARAM],
      });

  return (
    <>
      {!isLiveSurface ? (
        <FactoryAnalytics
          initialEvent={{
            name: "preview_view",
            properties: { slug, vertical: site.vertical },
          }}
        />
      ) : null}
      <SiteRenderer
        draft={localizeSiteDraft(alternates?.draft ?? site.draft, locale)}
        vertical={site.vertical}
        theme={alternates?.theme ?? site.theme}
        locale={locale}
        localeBasePath={
          isLiveSurface
            ? "/"
            : `/preview/${slug}${alternates?.activeQuery ?? ""}`
        }
        availableLocales={locales}
        analyticsEnabled={isLiveSurface}
        blogHref={blogHref}
      />
      {alternates ? (
        <PreviewThemeSwitcher
          basePath={`/preview/${slug}/${locale}`}
          options={alternates.options}
          reasons={alternates.reasons}
        />
      ) : null}
    </>
  );
}
