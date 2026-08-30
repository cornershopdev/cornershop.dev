import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { PreviewThemeSwitcher } from "@/components/preview-theme-switcher";
import { SiteRenderer } from "@/components/site-renderer";
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
import { getSiteLocales } from "@/lib/site-draft";
import { resolveStorefrontBlogHref } from "@/lib/articles/public-articles";
import { liveSiteVersionId } from "@/lib/site-surface";
import {
  findSiteView,
  getCachedPublishedSiteView,
} from "@/lib/sites";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const requestHeaders = await headers();
  const versionId = liveSiteVersionId(requestHeaders, slug);
  const site = versionId
    ? await getCachedPublishedSiteView(slug, versionId)
    : await findSiteView(slug);
  if (!site) notFound();
  const isLiveSurface = versionId !== null;
  return previewMetadata(site.draft, {
    isLiveSurface,
    locales: getSiteLocales(site.draft),
    verifiedHostname: isLiveSurface
      ? customerHostname(requestHeaders)
      : null,
    factoryOrigin: factoryMetadataOrigin(),
    factoryName: FACTORY_BRAND.name,
  });
}

export default async function PreviewPage({
  params,
  searchParams,
}: PageProps) {
  const { slug } = await params;
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
  // Theme alternates are factory chrome. The live customer surface renders the
  // published selection only and ignores the query parameter entirely.
  const alternates = isLiveSurface
    ? null
    : resolvePreviewThemeAlternates({
        vertical: site.vertical,
        draft: site.draft,
        requestedTheme: query[PREVIEW_THEME_PARAM],
      });

  return (
    <>
      <SiteRenderer
        draft={alternates?.draft ?? site.draft}
        vertical={site.vertical}
        theme={alternates?.theme ?? site.theme}
        locale={site.draft.defaultLocale}
        localeBasePath={
          isLiveSurface
            ? "/"
            : `/preview/${slug}${alternates?.activeQuery ?? ""}`
        }
        availableLocales={getSiteLocales(site.draft)}
        analyticsEnabled={isLiveSurface}
        blogHref={blogHref}
      />
      {alternates ? (
        <PreviewThemeSwitcher
          basePath={`/preview/${slug}`}
          options={alternates.options}
          reasons={alternates.reasons}
        />
      ) : null}
    </>
  );
}
