import { headers } from "next/headers";
import { listPublishedArticles } from "@/lib/articles/public-articles";
import { buildCustomerRss } from "@/lib/customer-article-discovery";
import { getSiteLocales } from "@/lib/site-draft";
import { liveSiteContext } from "@/lib/site-surface";
import { getCachedPublishedSiteView } from "@/lib/sites";

/**
 * RSS 2.0 feed for a site's published articles. Like the blog sitemap, it
 * only answers on a live customer surface where the proxy has attested the
 * slug; the factory host gets an empty channel rather than an error so the
 * route exists uniformly.
 */
export async function GET(): Promise<Response> {
  const live = liveSiteContext(await headers());
  if (!live) return rssResponse(emptyRss());

  const [site, articles] = await Promise.all([
    getCachedPublishedSiteView(live.slug, live.versionId),
    listPublishedArticles({
      slug: live.slug,
      versionId: live.versionId,
      limit: 20,
    }),
  ]);
  if (!site) return new Response("Not found", { status: 404 });

  return rssResponse(
    buildCustomerRss({
      origin: live.origin,
      site: {
        name: site.draft.name,
        description: site.draft.description,
        defaultLocale: site.draft.defaultLocale,
        locales: getSiteLocales(site.draft),
      },
      articles,
    }),
  );
}

function rssResponse(xml: string): Response {
  return new Response(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}

function emptyRss(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rss version="2.0"><channel>\n` +
    `  <title>Blog</title>\n` +
    `  <description>Latest articles</description>\n` +
    `</channel></rss>\n`
  );
}
