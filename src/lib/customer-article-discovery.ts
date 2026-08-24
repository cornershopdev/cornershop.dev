import type { Metadata, MetadataRoute } from "next";
import type { PublishedArticle } from "@/lib/articles/public-articles";
import { canonicalSiteLocale, localeHref } from "@/lib/site-surface";

export type CustomerDiscoverySite = {
  name: string;
  description: string;
  defaultLocale: string;
  locales: string[];
};

export type CustomerDiscoveryArticle = Pick<
  PublishedArticle,
  "slug" | "title" | "excerpt" | "locale" | "publishedAt"
>;

const customerDisallowPaths = [
  "/api/",
  "/claim/",
  "/create",
  "/dashboard",
  "/niche/",
  "/preview/",
  "/pro/",
];

const SITEMAP_URL_LIMIT = 50_000;

export function buildCustomerRobots(origin: string): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: customerDisallowPaths,
    },
    sitemap: [
      customerUrl(origin, "/sitemap.xml"),
      customerUrl(origin, "/blog/sitemap.xml"),
    ],
  };
}

export function buildCustomerRootSitemap(input: {
  origin: string;
  site: CustomerDiscoverySite;
  articles: CustomerDiscoveryArticle[];
  generatedAt?: Date;
}): MetadataRoute.Sitemap {
  const generatedAt = input.generatedAt ?? new Date();
  const defaultLocale =
    canonicalSiteLocale(input.site.defaultLocale) ?? input.site.defaultLocale;
  const localePaths = routeableLocales(input.site).map((locale) =>
    localeHref("/", locale, defaultLocale),
  );
  const routes: MetadataRoute.Sitemap = unique(localePaths).map(
    (pathname, index) => ({
      url: customerUrl(input.origin, pathname),
      lastModified: generatedAt,
      changeFrequency: "weekly" as const,
      priority: index === 0 ? 1 : 0.8,
    }),
  );

  if (input.articles.length === 0) return routes;
  const articleBudget = Math.max(SITEMAP_URL_LIMIT - routes.length - 1, 0);
  const includedArticles = input.articles.slice(0, articleBudget);
  if (includedArticles.length === 0) return routes;
  const latestArticle = latestPublishedAt(includedArticles);
  routes.push({
    url: customerUrl(input.origin, "/blog"),
    lastModified: latestArticle,
    changeFrequency: "weekly",
    priority: 0.7,
  });
  routes.push(
    ...buildCustomerBlogSitemap({
      origin: input.origin,
      articles: includedArticles,
    }),
  );
  return routes;
}

export function buildCustomerBlogSitemap(input: {
  origin: string;
  articles: CustomerDiscoveryArticle[];
}): MetadataRoute.Sitemap {
  return input.articles.slice(0, SITEMAP_URL_LIMIT).map((article) => ({
    url: articleUrl(input.origin, article.slug),
    lastModified: article.publishedAt,
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));
}

export function buildCustomerBlogMetadata(input: {
  origin: string;
  site: CustomerDiscoverySite;
}): Metadata {
  const title = `${input.site.name} Blog`;
  const description = customerBlogDescription(input.site);
  const canonical = customerUrl(input.origin, "/blog");
  const feed = customerUrl(input.origin, "/blog/rss.xml");
  return {
    metadataBase: new URL(canonicalOrigin(input.origin)),
    title: { absolute: title },
    description,
    // The factory root layout owns Cornershopdev icons. Explicitly clearing
    // them prevents that visual identity (and its relative asset URLs) from
    // surviving Next's shallow metadata merge on customer article surfaces.
    icons: null,
    robots: { index: true, follow: true },
    alternates: {
      canonical,
      types: { "application/rss+xml": feed },
    },
    openGraph: {
      title,
      description,
      siteName: input.site.name,
      type: "website",
      url: canonical,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export function buildCustomerArticleMetadata(input: {
  origin: string;
  site: CustomerDiscoverySite;
  article: CustomerDiscoveryArticle;
}): Metadata {
  const title = `${input.article.title} — ${input.site.name}`;
  const canonical = articleUrl(input.origin, input.article.slug);
  return {
    metadataBase: new URL(canonicalOrigin(input.origin)),
    title: { absolute: title },
    description: input.article.excerpt,
    authors: [{ name: input.site.name }],
    icons: null,
    robots: { index: true, follow: true },
    alternates: {
      canonical,
      types: {
        "application/rss+xml": customerUrl(input.origin, "/blog/rss.xml"),
      },
    },
    openGraph: {
      title,
      description: input.article.excerpt,
      siteName: input.site.name,
      type: "article",
      url: canonical,
      publishedTime: input.article.publishedAt.toISOString(),
      authors: [input.site.name],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: input.article.excerpt,
    },
  };
}

export function buildCustomerArticleJsonLd(input: {
  origin: string;
  site: CustomerDiscoverySite;
  article: CustomerDiscoveryArticle;
}): Record<string, unknown> {
  const home = customerUrl(input.origin, "/");
  const blog = customerUrl(input.origin, "/blog");
  const canonical = articleUrl(input.origin, input.article.slug);
  const organization = {
    "@type": "Organization",
    name: input.site.name,
    url: home,
  };
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: input.article.title,
    description: input.article.excerpt,
    datePublished: input.article.publishedAt.toISOString(),
    dateModified: input.article.publishedAt.toISOString(),
    inLanguage: input.article.locale,
    url: canonical,
    mainEntityOfPage: canonical,
    author: organization,
    publisher: organization,
    isPartOf: {
      "@type": "Blog",
      name: `${input.site.name} Blog`,
      url: blog,
    },
  };
}

export function serializeCustomerArticleJsonLd(input: {
  origin: string;
  site: CustomerDiscoverySite;
  article: CustomerDiscoveryArticle;
}): string {
  return JSON.stringify(buildCustomerArticleJsonLd(input)).replaceAll(
    "<",
    "\\u003c",
  );
}

export function buildCustomerRss(input: {
  origin: string;
  site: CustomerDiscoverySite;
  articles: CustomerDiscoveryArticle[];
  generatedAt?: Date;
}): string {
  const title = `${input.site.name} Blog`;
  const description = customerBlogDescription(input.site);
  const blog = customerUrl(input.origin, "/blog");
  const feed = customerUrl(input.origin, "/blog/rss.xml");
  const lastBuildDate = (
    input.articles.length > 0
      ? latestPublishedAt(input.articles)
      : (input.generatedAt ?? new Date())
  ).toUTCString();
  const items = input.articles
    .map((article) => {
      const canonical = articleUrl(input.origin, article.slug);
      return (
        `    <item>\n` +
        `      <title>${escapeXml(article.title)}</title>\n` +
        `      <description>${escapeXml(article.excerpt)}</description>\n` +
        `      <link>${escapeXml(canonical)}</link>\n` +
        `      <guid isPermaLink="true">${escapeXml(canonical)}</guid>\n` +
        `      <pubDate>${article.publishedAt.toUTCString()}</pubDate>\n` +
        `    </item>`
      );
    })
    .join("\n");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>\n` +
    `  <title>${escapeXml(title)}</title>\n` +
    `  <description>${escapeXml(description)}</description>\n` +
    `  <link>${escapeXml(blog)}</link>\n` +
    `  <atom:link href="${escapeXml(feed)}" rel="self" type="application/rss+xml" />\n` +
    `  <language>${escapeXml(input.site.defaultLocale)}</language>\n` +
    `  <lastBuildDate>${lastBuildDate}</lastBuildDate>\n` +
    `${items ? `${items}\n` : ""}` +
    `</channel></rss>\n`
  );
}

function customerBlogDescription(site: CustomerDiscoverySite): string {
  const description = site.description.trim();
  return description
    ? `Latest stories from ${site.name}. ${description}`
    : `Latest stories and updates from ${site.name}.`;
}

function routeableLocales(site: CustomerDiscoverySite): string[] {
  return unique(
    [site.defaultLocale, ...site.locales].flatMap((locale) => {
      const canonical = canonicalSiteLocale(locale);
      return canonical ? [canonical] : [];
    }),
  );
}

function latestPublishedAt(articles: CustomerDiscoveryArticle[]): Date {
  return new Date(
    Math.max(...articles.map((article) => article.publishedAt.getTime())),
  );
}

function articleUrl(origin: string, slug: string): string {
  return customerUrl(origin, `/blog/${encodeURIComponent(slug)}`);
}

function customerUrl(origin: string, pathname: string): string {
  const expectedOrigin = canonicalOrigin(origin);
  const url = new URL(pathname, `${expectedOrigin}/`);
  if (url.origin !== expectedOrigin) {
    throw new Error("Customer discovery URL must remain same-origin");
  }
  return url.href;
}

function canonicalOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Customer discovery origin must be a canonical HTTPS origin");
  }
  return url.origin;
}

function escapeXml(value: string): string {
  return xml10Text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function xml10Text(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    const noncharacter =
      (codePoint >= 0xfdd0 && codePoint <= 0xfdef) ||
      (codePoint & 0xffff) === 0xfffe ||
      (codePoint & 0xffff) === 0xffff;
    const allowed =
      !noncharacter &&
      (codePoint === 0x09 ||
        codePoint === 0x0a ||
        codePoint === 0x0d ||
        (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
        (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
        (codePoint >= 0x10000 && codePoint <= 0x10ffff));
    return allowed ? character : "\uFFFD";
  }).join("");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
