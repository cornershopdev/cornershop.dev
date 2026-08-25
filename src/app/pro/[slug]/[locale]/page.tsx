import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { SiteRenderer } from "@/components/site-renderer";
import {
  CORNERSHOP_PRO_BRAND,
  isCornershopProClient,
  isTrustedCornershopProSite,
  proSiteBasePath,
} from "@/lib/cornershop-pro";
import { FACTORY_BRAND } from "@/lib/brand";
import {
  customerHostname,
  factoryMetadataOrigin,
  previewMetadata,
} from "@/lib/preview-metadata";
import { getSiteLocales, localizeSiteDraft } from "@/lib/site-draft";
import { resolveStorefrontBlogHref } from "@/lib/articles/public-articles";
import { liveSiteVersionId } from "@/lib/site-surface";
import {
  findSiteView,
  getCachedPublishedSiteView,
} from "@/lib/sites";

type PageProps = {
  params: Promise<{ slug: string; locale: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug, locale } = await params;
  if (!isCornershopProClient(slug)) notFound();
  const requestHeaders = await headers();
  const versionId = liveSiteVersionId(requestHeaders, slug);
  const site = versionId
    ? await getCachedPublishedSiteView(slug, versionId)
    : await findSiteView(slug);
  if (!site || !isTrustedCornershopProSite(slug, site.draft)) notFound();
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
      privateSurfaceBasePath: proSiteBasePath(slug),
      privateSurfaceBrandName: CORNERSHOP_PRO_BRAND,
    },
  );
}

export default async function ProLocalizedSitePage({ params }: PageProps) {
  const { slug, locale } = await params;
  if (!isCornershopProClient(slug)) notFound();
  const versionId = liveSiteVersionId(await headers(), slug);
  const [site, blogHref] = await Promise.all([
    versionId
      ? getCachedPublishedSiteView(slug, versionId)
      : findSiteView(slug),
    resolveStorefrontBlogHref({ slug, versionId }),
  ]);
  if (!site || !isTrustedCornershopProSite(slug, site.draft)) notFound();
  const isLiveSurface = versionId !== null;
  const locales = getSiteLocales(site.draft);
  if (!locales.includes(locale)) notFound();

  return (
    <SiteRenderer
      draft={localizeSiteDraft(site.draft, locale)}
      vertical={site.vertical}
      theme={site.theme}
      locale={locale}
      localeBasePath={isLiveSurface ? "/" : proSiteBasePath(slug)}
      availableLocales={locales}
      analyticsEnabled={isLiveSurface}
      blogHref={blogHref}
    />
  );
}
