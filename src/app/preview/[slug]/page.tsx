import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { SiteRenderer } from "@/components/site-renderer";
import { FACTORY_BRAND } from "@/lib/brand";
import {
  customerHostname,
  factoryMetadataOrigin,
  previewMetadata,
} from "@/lib/preview-metadata";
import { getSiteLocales } from "@/lib/site-draft";
import { resolveStorefrontBlogHref } from "@/lib/articles/public-articles";
import { liveSiteVersionId } from "@/lib/site-surface";
import {
  findSiteView,
  getCachedPublishedSiteView,
} from "@/lib/sites";

type PageProps = {
  params: Promise<{ slug: string }>;
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

export default async function PreviewPage({ params }: PageProps) {
  const { slug } = await params;
  const versionId = liveSiteVersionId(await headers(), slug);
  const [site, blogHref] = await Promise.all([
    versionId
      ? getCachedPublishedSiteView(slug, versionId)
      : findSiteView(slug),
    resolveStorefrontBlogHref({ slug, versionId }),
  ]);
  if (!site) notFound();
  const isLiveSurface = versionId !== null;
  return (
    <SiteRenderer
      draft={site.draft}
      vertical={site.vertical}
      theme={site.theme}
      locale={site.draft.defaultLocale}
      localeBasePath={isLiveSurface ? "/" : `/preview/${slug}`}
      availableLocales={getSiteLocales(site.draft)}
      analyticsEnabled={isLiveSurface}
      blogHref={blogHref}
    />
  );
}
