import { beforeEach, describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(callback: T): T =>
    callback,
}));

type ArticleRow = {
  slug: string;
  title: string;
  excerpt: string;
  bodyMarkdown: string;
  locale: string;
  publishedAt: Date | null;
};

let findManyInput: unknown;
let findFirstInput: unknown;
let manyRows: ArticleRow[] = [];
let firstRow: ArticleRow | null = null;
let findManyCalls = 0;
let findFirstCalls = 0;

mock.module("@/lib/db", () => ({
  getDb: () => ({
    article: {
      findMany: async (input: unknown) => {
        findManyCalls += 1;
        findManyInput = input;
        return manyRows;
      },
      findFirst: async (input: unknown) => {
        findFirstCalls += 1;
        findFirstInput = input;
        return firstRow;
      },
    },
  }),
}));

const {
  CUSTOMER_SITEMAP_ARTICLE_LIMIT,
  getPublishedArticle,
  hasPublishedArticles,
  listPublishedArticles,
  listPublishedArticlesForSitemap,
  resolveStorefrontBlogHref,
} = await import("@/lib/articles/public-articles");

const publishedAt = new Date("2026-08-20T10:00:00.000Z");
const row: ArticleRow = {
  slug: "summer-bread-guide",
  title: "Bread in summer",
  excerpt: "What changes with the weather.",
  bodyMarkdown: "Published body",
  locale: "en",
  publishedAt,
};

describe("public article exclusion", () => {
  beforeEach(() => {
    findManyInput = undefined;
    findFirstInput = undefined;
    manyRows = [];
    firstRow = null;
    findManyCalls = 0;
    findFirstCalls = 0;
  });

  it("returns nothing and never queries without a proxy-attested version", async () => {
    expect(
      await listPublishedArticles({
        slug: "maison-levain",
        versionId: null,
      }),
    ).toEqual([]);
    expect(findManyCalls).toBe(0);
  });

  it("queries only published rows with a publication timestamp", async () => {
    manyRows = [row, { ...row, slug: "missing-date", publishedAt: null }];

    const articles = await listPublishedArticles({
      slug: "maison-levain",
      versionId: "version_1",
      locale: "en",
      limit: 500,
    });

    expect(findManyInput).toMatchObject({
      where: {
        site: { slug: "maison-levain" },
        status: "PUBLISHED",
        publishedAt: { not: null },
        locale: "en",
      },
      orderBy: { publishedAt: "desc" },
      take: 100,
    });
    expect(articles).toEqual([{ ...row, publishedAt }]);
  });

  it("keeps published article 101 in the sitemap projection", async () => {
    manyRows = Array.from({ length: 101 }, (_, index) => ({
      ...row,
      slug: `published-${String(index + 1).padStart(3, "0")}`,
    }));

    const articles = await listPublishedArticlesForSitemap({
      slug: "maison-levain",
      versionId: "version_1",
    });

    expect(articles).toHaveLength(101);
    expect(articles.at(-1)?.slug).toBe("published-101");
    expect(findManyInput).toMatchObject({
      where: {
        site: { slug: "maison-levain" },
        status: "PUBLISHED",
        publishedAt: { not: null },
      },
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
    expect(
      (findManyInput as { select: Record<string, unknown> }).select,
    ).not.toHaveProperty("bodyMarkdown");
  });

  it("does not query the sitemap projection without live attestation", async () => {
    expect(
      await listPublishedArticlesForSitemap({
        slug: "maison-levain",
        versionId: null,
      }),
    ).toEqual([]);
    expect(findManyCalls).toBe(0);
  });

  it("applies the same published-only gate to an article detail", async () => {
    firstRow = row;
    expect(
      await getPublishedArticle({
        slug: "maison-levain",
        versionId: "version_1",
        articleSlug: row.slug,
      }),
    ).toEqual({ ...row, publishedAt });
    expect(findFirstInput).toMatchObject({
      where: {
        site: { slug: "maison-levain" },
        slug: row.slug,
        status: "PUBLISHED",
        publishedAt: { not: null },
      },
    });

    firstRow = { ...row, publishedAt: null };
    expect(
      await getPublishedArticle({
        slug: "maison-levain",
        versionId: "version_1",
        articleSlug: row.slug,
      }),
    ).toBeNull();
  });

  it("never queries article existence without a proxy-attested version", async () => {
    expect(
      await hasPublishedArticles({
        slug: "maison-levain",
        versionId: null,
      }),
    ).toBe(false);
    expect(findFirstCalls).toBe(0);
    expect(await resolveStorefrontBlogHref({ slug: "maison-levain", versionId: null })).toBeNull();
    expect(findFirstCalls).toBe(0);
  });

  it("exposes a live Blog href only when the attested version has published articles", async () => {
    firstRow = row;
    expect(
      await hasPublishedArticles({
        slug: "maison-levain",
        versionId: "version_1",
      }),
    ).toBe(true);
    expect(await resolveStorefrontBlogHref({
      slug: "maison-levain",
      versionId: "version_1",
    })).toBe("/blog");
    expect(findFirstInput).toMatchObject({
      where: {
        site: { slug: "maison-levain" },
        status: "PUBLISHED",
        publishedAt: { not: null },
      },
      select: { id: true },
    });

    firstRow = null;
    expect(
      await hasPublishedArticles({
        slug: "maison-levain",
        versionId: "version_1",
      }),
    ).toBe(false);
    expect(await resolveStorefrontBlogHref({
      slug: "maison-levain",
      versionId: "version_1",
    })).toBeNull();
  });
});
