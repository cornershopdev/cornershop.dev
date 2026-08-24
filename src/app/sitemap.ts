import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { listPublishedArticlesForSitemap } from "@/lib/articles/public-articles";
import { buildCustomerRootSitemap } from "@/lib/customer-article-discovery";
import { getSiteLocales } from "@/lib/site-draft";
import { liveSiteContext } from "@/lib/site-surface";
import { listRestaurantThemeManifests } from "@/lib/site-themes/restaurant/registry";
import { getCachedPublishedSiteView } from "@/lib/sites";
import { restaurantMarketing } from "@/lib/verticals/restaurant/marketing";
import { resolveRequestOrigin } from "@/lib/verticals/request-site";

/**
 * Every domain the app answers on serves this file, so the origin is read from
 * the request rather than hardcoded: a crawler on restofront.com must be handed
 * restofront.com's sitemap, not the factory's.
 *
 * A proxy-attested customer request gets that site's public home/locales/blog
 * entries. Factory and niche marketing requests retain the marketing-only
 * sitemap below.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const live = liveSiteContext(await headers());
  if (live) {
    const [site, articles] = await Promise.all([
      getCachedPublishedSiteView(live.slug, live.versionId),
      listPublishedArticlesForSitemap({
        slug: live.slug,
        versionId: live.versionId,
      }),
    ]);
    if (!site) return [];
    return buildCustomerRootSitemap({
      origin: live.origin,
      site: {
        name: site.draft.name,
        description: site.draft.description,
        defaultLocale: site.draft.defaultLocale,
        locales: getSiteLocales(site.draft),
      },
      articles,
    });
  }

  const origin = await resolveRequestOrigin();
  const restaurantOrigin = restaurantMarketing.domain
    ? `https://${restaurantMarketing.domain}`
    : null;
  const routes: MetadataRoute.Sitemap = [
    {
      url: origin,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
  if (origin === restaurantOrigin) {
    routes.push({
      url: `${origin}/themes/restaurant`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.7,
    });
    routes.push(
      ...listRestaurantThemeManifests().map(({ id }) => ({
        url: `${origin}/themes/restaurant/${id}`,
        lastModified: new Date(),
        changeFrequency: "monthly" as const,
        priority: 0.7,
      })),
    );
  }
  return routes;
}
