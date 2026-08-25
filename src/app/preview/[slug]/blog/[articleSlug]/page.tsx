import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";
import { ArticleMarkdown } from "@/components/article-markdown";
import { CustomerArticleChrome } from "@/components/customer-article-chrome";
import {
  articleCacheTagFor,
  getPublishedArticle,
  type PublishedArticle,
} from "@/lib/articles/public-articles";
import { approvedArticleDestinations } from "@/lib/articles/safe-article-href";
import {
  buildCustomerArticleMetadata,
  serializeCustomerArticleJsonLd,
} from "@/lib/customer-article-discovery";
import { getSiteLocales } from "@/lib/site-draft";
import { liveSiteContext } from "@/lib/site-surface";
import { getCachedPublishedSiteView } from "@/lib/sites";

type PageProps = {
  params: Promise<{ slug: string; articleSlug: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug, articleSlug } = await params;
  const live = liveSiteContext(await headers());
  if (!live || live.slug !== slug) {
    return { robots: { index: false, follow: false } };
  }
  const [site, article] = await Promise.all([
    getCachedPublishedSiteView(slug, live.versionId),
    loadCachedArticle(slug, live.versionId, articleSlug),
  ]);
  if (!site || !article) {
    return { robots: { index: false, follow: false } };
  }
  return buildCustomerArticleMetadata({
    origin: live.origin,
    site: {
      name: site.draft.name,
      description: site.draft.description,
      defaultLocale: site.draft.defaultLocale,
      locales: getSiteLocales(site.draft),
    },
    article,
  });
}

export default async function ArticlePage({ params }: PageProps) {
  const { slug, articleSlug } = await params;
  const live = liveSiteContext(await headers());
  if (!live || live.slug !== slug) notFound();

  const [site, article] = await Promise.all([
    getCachedPublishedSiteView(slug, live.versionId),
    loadCachedArticle(slug, live.versionId, articleSlug),
  ]);
  if (!site || !article) notFound();

  const discoverySite = {
    name: site.draft.name,
    description: site.draft.description,
    defaultLocale: site.draft.defaultLocale,
    locales: getSiteLocales(site.draft),
  };
  const jsonLd = serializeCustomerArticleJsonLd({
    origin: live.origin,
    site: discoverySite,
    article,
  });

  return (
    <CustomerArticleChrome
      draft={site.draft}
      vertical={site.vertical}
      locale={site.draft.defaultLocale}
      analyticsEnabled
    >
      <main className="mx-auto w-full max-w-2xl px-6 py-16">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLd }}
        />
        <article>
          <header>
            <h1 className="text-3xl font-semibold">{article.title}</h1>
            <time
              dateTime={article.publishedAt.toISOString()}
              className="mt-2 block text-sm opacity-60"
            >
              {article.publishedAt.toLocaleDateString(undefined, {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </time>
          </header>
          <div className="mt-8">
            <ArticleMarkdown
              markdown={article.bodyMarkdown}
              approvedDestinations={approvedArticleDestinations(
                site.draft.integrations,
              )}
            />
          </div>
        </article>
        <p className="mt-12">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Back to the site
          </Link>
        </p>
      </main>
    </CustomerArticleChrome>
  );
}

/** Tag-invalidated mirror of the blog index cache; see that page's note. */
async function loadCachedArticle(
  slug: string,
  versionId: string,
  articleSlug: string,
): Promise<PublishedArticle | null> {
  const cached = unstable_cache(
    async () => {
      const article = await getPublishedArticle({
        slug,
        versionId,
        articleSlug,
      });
      return article
        ? { ...article, publishedAt: article.publishedAt.toISOString() }
        : null;
    },
    ["published-article", slug, articleSlug],
    {
      revalidate: 30,
      tags: [articleCacheTagFor(slug)],
    },
  );
  const article = await cached();
  return article
    ? { ...article, publishedAt: new Date(article.publishedAt) }
    : null;
}
