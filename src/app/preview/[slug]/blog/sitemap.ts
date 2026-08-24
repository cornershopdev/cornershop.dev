import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import {
  listPublishedArticlesForSitemap,
  type PublishedArticleSummary,
} from "@/lib/articles/public-articles";
import { buildCustomerBlogSitemap } from "@/lib/customer-article-discovery";
import { liveSiteContext } from "@/lib/site-surface";

/**
 * Per-site blog sitemap fragment. On a customer host or platform subdomain
 * the proxy attests the live slug/version, and this lists that site's
 * published articles. On the factory host there is no attested slug, so it
 * returns an empty list — the root `src/app/sitemap.ts` owns the factory's
 * own entries.
 */
export default async function blogSitemap(): Promise<MetadataRoute.Sitemap> {
  const live = liveSiteContext(await headers());
  if (!live) return [];

  const articles: PublishedArticleSummary[] =
    await listPublishedArticlesForSitemap({
      slug: live.slug,
      versionId: live.versionId,
    });
  return buildCustomerBlogSitemap({ origin: live.origin, articles });
}
