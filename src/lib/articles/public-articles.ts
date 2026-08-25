import "server-only";
import { unstable_cache } from "next/cache";
import { getDb } from "@/lib/db";
import { previewCacheTagFor } from "@/lib/site-surface";

/**
 * Public article reads for customer surfaces.
 *
 * Every function here requires BOTH the proxy-attested live-site slug and
 * version id before it returns content, mirroring how the site renderer
 * gates published snapshots: a factory-hosted `/preview/<slug>/blog` request
 * has no attested version and gets nothing, so drafts can never leak onto a
 * public path through this module.
 */

export type PublishedArticle = {
  slug: string;
  title: string;
  excerpt: string;
  bodyMarkdown: string;
  locale: string;
  publishedAt: Date;
};

export type PublishedArticleSummary = Omit<PublishedArticle, "bodyMarkdown">;

// Protocol ceiling for one sitemap file. Root sitemap construction reserves
// its non-article entries before it slices; the dedicated blog sitemap may use
// this complete budget.
export const CUSTOMER_SITEMAP_ARTICLE_LIMIT = 50_000;

export async function listPublishedArticles(input: {
  slug: string;
  versionId: string | null;
  locale?: string;
  limit?: number;
}): Promise<PublishedArticle[]> {
  if (!input.versionId) return [];
  const db = getDb();
  const rows = await db.article.findMany({
    where: {
      site: { slug: input.slug },
      status: "PUBLISHED",
      publishedAt: { not: null },
      ...(input.locale ? { locale: input.locale } : {}),
    },
    orderBy: { publishedAt: "desc" },
    take: Math.min(Math.max(input.limit ?? 50, 1), 100),
    select: {
      slug: true,
      title: true,
      excerpt: true,
      bodyMarkdown: true,
      locale: true,
      publishedAt: true,
    },
  });
  return rows.flatMap((row) =>
    row.publishedAt
      ? [
          {
            slug: row.slug,
            title: row.title,
            excerpt: row.excerpt,
            bodyMarkdown: row.bodyMarkdown,
            locale: row.locale,
            publishedAt: row.publishedAt,
          },
        ]
      : [],
  );
}

/**
 * Complete published-article projection for discovery surfaces.
 *
 * The reader used by the on-page blog and RSS is deliberately short. Sitemaps
 * have a different contract: omitting article 101 makes older public content
 * undiscoverable, so this projection uses the protocol limit and avoids loading
 * article bodies that sitemap generation never consumes.
 */
export async function listPublishedArticlesForSitemap(input: {
  slug: string;
  versionId: string | null;
}): Promise<PublishedArticleSummary[]> {
  if (!input.versionId) return [];
  const rows = await getDb().article.findMany({
    where: publishedArticleWhere(input.slug),
    orderBy: [{ publishedAt: "desc" }, { slug: "asc" }],
    take: CUSTOMER_SITEMAP_ARTICLE_LIMIT,
    select: {
      slug: true,
      title: true,
      excerpt: true,
      locale: true,
      publishedAt: true,
    },
  });
  return rows.flatMap((row) =>
    row.publishedAt
      ? [
          {
            slug: row.slug,
            title: row.title,
            excerpt: row.excerpt,
            locale: row.locale,
            publishedAt: row.publishedAt,
          },
        ]
      : [],
  );
}

export async function hasPublishedArticles(input: {
  slug: string;
  versionId: string | null;
}): Promise<boolean> {
  if (!input.versionId) return false;
  const row = await getDb().article.findFirst({
    where: publishedArticleWhere(input.slug),
    select: { id: true },
  });
  return Boolean(row);
}

/**
 * Live renderer Blog href for an attested published version. Missing
 * attestation, unpublished snapshots, and zero-article sites stay null so
 * preview chrome cannot grow a Blog entry.
 */
export async function resolveStorefrontBlogHref(input: {
  slug: string;
  versionId: string | null;
}): Promise<string | null> {
  if (!input.versionId) return null;
  const cached = unstable_cache(
    () => hasPublishedArticles({ slug: input.slug, versionId: input.versionId }),
    ["published-articles-exist", input.slug],
    {
      revalidate: 30,
      tags: [articleCacheTagFor(input.slug)],
    },
  );
  return (await cached()) ? "/blog" : null;
}

export async function getPublishedArticle(input: {
  slug: string;
  versionId: string | null;
  articleSlug: string;
}): Promise<PublishedArticle | null> {
  if (!input.versionId) return null;
  const db = getDb();
  const row = await db.article.findFirst({
    where: {
      site: { slug: input.slug },
      slug: input.articleSlug,
      status: "PUBLISHED",
      publishedAt: { not: null },
    },
    select: {
      slug: true,
      title: true,
      excerpt: true,
      bodyMarkdown: true,
      locale: true,
      publishedAt: true,
    },
  });
  if (!row?.publishedAt) return null;
  return {
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    bodyMarkdown: row.bodyMarkdown,
    locale: row.locale,
    publishedAt: row.publishedAt,
  };
}

/**
 * Cache tag for a site's published-article surfaces. Publish/unpublish
 * invalidates it with `{ expire: 0 }`, mirroring how
 * `previewCacheTagFor` busts the live site snapshot.
 */
export function articleCacheTagFor(slug: string): string {
  return `${previewCacheTagFor(slug)}:articles`;
}

function publishedArticleWhere(slug: string) {
  return {
    site: { slug },
    status: "PUBLISHED" as const,
    publishedAt: { not: null },
  };
}
