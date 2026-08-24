import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { buildCustomerRobots } from "@/lib/customer-article-discovery";
import { liveSiteContext } from "@/lib/site-surface";
import { resolveRequestOrigin } from "@/lib/verticals/request-site";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const live = liveSiteContext(await headers());
  if (live) return buildCustomerRobots(live.origin);

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // `/niche/` is the internal path a storefront is rewritten from. A launched
        // niche is reachable at both its own domain and this path, and only the
        // domain should be indexed — the canonical in the page's metadata says the
        // same thing, this keeps the duplicate out of the crawl entirely.
        disallow: [
          "/api/",
          "/claim/",
          "/create",
          "/dashboard",
          "/niche/",
          "/preview/",
        ],
      },
    ],
    // Same request-derived origin as the sitemap itself, so each domain points at
    // its own rather than at the factory's.
    sitemap: `${await resolveRequestOrigin()}/sitemap.xml`,
  };
}
