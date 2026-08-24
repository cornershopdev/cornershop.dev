import { describe, expect, it } from "bun:test";
import {
  buildCustomerArticleJsonLd,
  buildCustomerArticleMetadata,
  buildCustomerBlogMetadata,
  buildCustomerBlogSitemap,
  buildCustomerRobots,
  buildCustomerRootSitemap,
  buildCustomerRss,
  type CustomerDiscoveryArticle,
} from "@/lib/customer-article-discovery";

const site = {
  name: "Maison & Levain",
  description: "Neighbourhood bread, pastry, and seasonal lunches.",
  defaultLocale: "en",
  locales: ["en", "fr", "FR-ca"],
};

const articles: CustomerDiscoveryArticle[] = [
  {
    slug: "summer-bread-guide",
    title: "Bread & summer",
    excerpt: "A guide to our warm-weather loaves.",
    locale: "en",
    publishedAt: new Date("2026-08-20T10:00:00.000Z"),
  },
  {
    slug: "market-mornings",
    title: "Market mornings",
    excerpt: "What arrives before the ovens are lit.",
    locale: "en",
    publishedAt: new Date("2026-08-10T09:00:00.000Z"),
  },
];

const customerOrigins = [
  "https://maison-levain.restofront.com",
  "https://maison-levain.example",
];

describe("customer discovery URLs", () => {
  for (const origin of customerOrigins) {
    it(`emits same-origin robots and root sitemap URLs for ${origin}`, () => {
      expect(buildCustomerRobots(origin)).toEqual({
        rules: {
          userAgent: "*",
          allow: "/",
          disallow: [
            "/api/",
            "/claim/",
            "/create",
            "/dashboard",
            "/niche/",
            "/preview/",
            "/pro/",
          ],
        },
        sitemap: [
          `${origin}/sitemap.xml`,
          `${origin}/blog/sitemap.xml`,
        ],
      });

      const root = buildCustomerRootSitemap({
        origin,
        site,
        articles,
        generatedAt: new Date("2026-08-23T00:00:00.000Z"),
      });
      expect(root.map(({ url }) => url)).toEqual([
        `${origin}/`,
        `${origin}/fr`,
        `${origin}/fr-CA`,
        `${origin}/blog`,
        `${origin}/blog/summer-bread-guide`,
        `${origin}/blog/market-mornings`,
      ]);
      assertCustomerUrls(
        origin,
        root.map(({ url }) => url),
      );

      const blog = buildCustomerBlogSitemap({ origin, articles });
      assertCustomerUrls(
        origin,
        blog.map(({ url }) => url),
      );
    });
  }

  it("does not advertise a blog that has no published articles", () => {
    const sitemap = buildCustomerRootSitemap({
      origin: customerOrigins[0]!,
      site,
      articles: [],
      generatedAt: new Date("2026-08-23T00:00:00.000Z"),
    });
    expect(sitemap.map(({ url }) => url)).toEqual([
      `${customerOrigins[0]}/`,
      `${customerOrigins[0]}/fr`,
      `${customerOrigins[0]}/fr-CA`,
    ]);
  });

  it("rejects non-canonical or cross-origin inputs", () => {
    expect(() => buildCustomerRobots("http://maison.example")).toThrow();
    expect(() => buildCustomerRobots("https://maison.example/private")).toThrow();
    expect(() => buildCustomerRobots("https://maison.example:8443")).toThrow();
  });

  it("never produces more than the sitemap protocol's 50,000 URLs", () => {
    const oversized = Array.from({ length: 50_001 }, (_, index) => ({
      ...articles[0]!,
      slug: `article-${index}`,
    }));
    expect(
      buildCustomerBlogSitemap({
        origin: customerOrigins[0]!,
        articles: oversized,
      }),
    ).toHaveLength(50_000);
    expect(
      buildCustomerRootSitemap({
        origin: customerOrigins[0]!,
        site,
        articles: oversized,
      }),
    ).toHaveLength(50_000);
  });
});

describe("customer blog and article metadata", () => {
  for (const origin of customerOrigins) {
    it(`uses the business identity and absolute canonicals for ${origin}`, () => {
      const blog = buildCustomerBlogMetadata({ origin, site });
      expect(blog).toMatchObject({
        metadataBase: new URL(origin),
        title: { absolute: "Maison & Levain Blog" },
        alternates: {
          canonical: `${origin}/blog`,
          types: { "application/rss+xml": `${origin}/blog/rss.xml` },
        },
        openGraph: {
          title: "Maison & Levain Blog",
          siteName: "Maison & Levain",
          type: "website",
          url: `${origin}/blog`,
        },
        twitter: {
          title: "Maison & Levain Blog",
        },
      });

      const article = buildCustomerArticleMetadata({
        origin,
        site,
        article: articles[0]!,
      });
      expect(article).toMatchObject({
        metadataBase: new URL(origin),
        title: { absolute: "Bread & summer — Maison & Levain" },
        authors: [{ name: "Maison & Levain" }],
        alternates: {
          canonical: `${origin}/blog/summer-bread-guide`,
        },
        openGraph: {
          title: "Bread & summer — Maison & Levain",
          siteName: "Maison & Levain",
          type: "article",
          url: `${origin}/blog/summer-bread-guide`,
        },
        twitter: {
          title: "Bread & summer — Maison & Levain",
        },
      });
      expect(JSON.stringify({ blog, article })).not.toContain("Cornershopdev");
      expect(JSON.stringify({ blog, article })).not.toContain("/preview/");
      expect(blog.icons).toBeNull();
      expect(article.icons).toBeNull();

      const resolvedAgainstFactory = {
        icons: { icon: [{ url: "/brand/cornershopdev/favicon-32.png" }] },
        openGraph: { siteName: "Cornershopdev" },
        ...blog,
      };
      expect(resolvedAgainstFactory.icons).toBeNull();
      expect(resolvedAgainstFactory.openGraph?.siteName).toBe(
        "Maison & Levain",
      );
    });
  }

  it("replaces XML 1.0-forbidden controls without dropping valid Unicode", () => {
    const xml = buildCustomerRss({
      origin: customerOrigins[0]!,
      site: { ...site, name: "Maison\u0001 🥖" },
      articles: [
        {
          ...articles[0]!,
          title: "Bread\u0000 & \ud800summer\ufdd0\u{1fffe} 🥐",
        },
      ],
      generatedAt: new Date("2026-08-23T00:00:00.000Z"),
    });

    expect(xml).not.toContain("\u0000");
    expect(xml).not.toContain("\u0001");
    expect(Array.from(xml, (character) => character.codePointAt(0))).not.toContain(
      0xd800,
    );
    expect(xml).not.toContain("\ufdd0");
    expect(xml).not.toContain("\u{1fffe}");
    expect(xml).toContain("Maison� 🥖 Blog");
    expect(xml).toContain("Bread� &amp; �summer�� 🥐");
  });
});

describe("customer RSS and article identity", () => {
  for (const origin of customerOrigins) {
    it(`emits business-owned absolute feed identity for ${origin}`, () => {
      const xml = buildCustomerRss({
        origin,
        site,
        articles,
        generatedAt: new Date("2026-08-23T00:00:00.000Z"),
      });
      expect(xml).toContain("<title>Maison &amp; Levain Blog</title>");
      expect(xml).toContain(`<link>${origin}/blog</link>`);
      expect(xml).toContain(`href="${origin}/blog/rss.xml"`);
      expect(xml).toContain(
        `<guid isPermaLink="true">${origin}/blog/summer-bread-guide</guid>`,
      );
      expect(xml).not.toContain("<link>/blog/");
      expect(xml).not.toContain("cornershop.dev");
      expect(xml).not.toContain("/preview/");

      const jsonLd = buildCustomerArticleJsonLd({
        origin,
        site,
        article: articles[0]!,
      });
      expect(jsonLd).toMatchObject({
        "@type": "Article",
        url: `${origin}/blog/summer-bread-guide`,
        mainEntityOfPage: `${origin}/blog/summer-bread-guide`,
        author: { "@type": "Organization", name: "Maison & Levain" },
        publisher: { "@type": "Organization", name: "Maison & Levain" },
        isPartOf: {
          "@type": "Blog",
          name: "Maison & Levain Blog",
          url: `${origin}/blog`,
        },
      });
    });
  }
});

function assertCustomerUrls(origin: string, urls: string[]): void {
  for (const value of urls) {
    expect(new URL(value).origin).toBe(origin);
    expect(value).not.toContain("cornershop.dev");
    expect(value).not.toContain("/preview/");
  }
}
