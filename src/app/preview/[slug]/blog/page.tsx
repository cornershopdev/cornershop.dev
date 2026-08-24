import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";
import {
  articleCacheTagFor,
  listPublishedArticles,
  type PublishedArticle,
} from "@/lib/articles/public-articles";
import { buildCustomerBlogMetadata } from "@/lib/customer-article-discovery";
import { getSiteLocales } from "@/lib/site-draft";
import { liveSiteContext, liveSiteVersionId } from "@/lib/site-surface";
import { getCachedPublishedSiteView } from "@/lib/sites";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const live = liveSiteContext(await headers());
  if (!live || live.slug !== slug) {
    return { robots: { index: false, follow: false } };
  }
  const site = await getCachedPublishedSiteView(slug, live.versionId);
  if (!site) return { robots: { index: false, follow: false } };
  return buildCustomerBlogMetadata({
    origin: live.origin,
    site: {
      name: site.draft.name,
      description: site.draft.description,
      defaultLocale: site.draft.defaultLocale,
      locales: getSiteLocales(site.draft),
    },
  });
}

export default async function BlogIndexPage({ params }: PageProps) {
  const { slug } = await params;
  const requestHeaders = await headers();
  const versionId = liveSiteVersionId(requestHeaders, slug);
  // Without the proxy-attested live surface this path is a private preview;
  // articles are a published-site feature, so previews get nothing.
  if (!versionId) notFound();

  const [site, articles] = await Promise.all([
    getCachedPublishedSiteView(slug, versionId),
    loadCachedArticles(slug, versionId),
  ]);
  if (!site || !articles.length) notFound();

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold">{site.draft.name} Blog</h1>
      <ul className="mt-10 space-y-10">
        {articles.map((article) => (
          <li key={article.slug}>
            <Link
              href={`/blog/${article.slug}`}
              className="text-xl font-medium underline-offset-4 hover:underline"
            >
              {article.title}
            </Link>
            <p className="mt-2 opacity-75">{article.excerpt}</p>
            <time
              dateTime={article.publishedAt.toISOString()}
              className="mt-1 block text-sm opacity-60"
            >
              {article.publishedAt.toLocaleDateString(undefined, {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </time>
          </li>
        ))}
      </ul>
    </main>
  );
}

/**
 * Same ISR-equivalent pattern as `getCachedPublishedSiteView`: content for a
 * published article list is cheap to recompute and must react to
 * publish/unpublish immediately, so the cache window is short and the tag is
 * what carries invalidation.
 */
function loadCachedArticles(
  slug: string,
  versionId: string,
): Promise<PublishedArticle[]> {
  const cached = unstable_cache(
    () => listPublishedArticles({ slug, versionId, limit: 50 }),
    ["published-articles", slug],
    {
      revalidate: 30,
      tags: [articleCacheTagFor(slug)],
    },
  );
  return cached();
}
