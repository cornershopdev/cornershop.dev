import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ArticleMarkdown } from "@/components/article-markdown";
import { CustomerArticleChrome } from "@/components/customer-article-chrome";
import { RestaurantThemeRenderer } from "@/components/restaurant-themes/restaurant-theme-renderer";
import { SiteRenderer } from "@/components/site-renderer";
import { approvedArticleDestinations } from "@/lib/articles/safe-article-href";
import {
  resolveStorefrontPrimaryAction,
  storefrontBlogHref,
} from "@/lib/articles/storefront-journey";
import { analyticsEventInputSchema } from "@/lib/analytics-contract";
import { restaurantThemeSelectionSchema } from "@/lib/site-themes/restaurant/contracts";
import { restaurantThemeFixtures } from "@/lib/site-themes/restaurant/fixtures";
import { listRestaurantThemeManifests } from "@/lib/site-themes/restaurant/registry";
import { sampleFoodRetailDraft } from "@/lib/verticals/food-retail/fixtures";
import { restaurantConfig } from "@/lib/verticals/restaurant/config";
import {
  restaurantSiteDraftSchema,
  sampleSiteDraft,
} from "@/lib/verticals/restaurant/schema";

const publishedDraft = restaurantSiteDraftSchema.parse({
  ...sampleSiteDraft,
  name: "Published Osteria",
  palette: {
    background: "#f4efe5",
    foreground: "#1d241f",
    accent: "#a5482d",
  },
  integrations: [
    {
      type: "booking",
      label: "Book a table",
      provider: "SevenRooms",
      url: "https://www.sevenrooms.com/explore/osteria-luna",
      enabled: true,
      venueId: null,
    },
  ],
});

const draftSnapshot = restaurantSiteDraftSchema.parse({
  ...sampleSiteDraft,
  name: "Draft Kitchen Rewrite",
  palette: {
    background: "#111111",
    foreground: "#eeeeee",
    accent: "#ff00aa",
  },
  integrations: [],
});

describe("storefront blog href conditions", () => {
  it("stays absent on preview, unpublished, and zero-article surfaces", () => {
    expect(
      storefrontBlogHref({ isLiveSurface: false, hasPublishedArticles: true }),
    ).toBeNull();
    expect(
      storefrontBlogHref({ isLiveSurface: true, hasPublishedArticles: false }),
    ).toBeNull();
    expect(
      storefrontBlogHref({ isLiveSurface: false, hasPublishedArticles: false }),
    ).toBeNull();
  });

  it("returns the live Blog path only for an attested version with articles", () => {
    expect(
      storefrontBlogHref({ isLiveSurface: true, hasPublishedArticles: true }),
    ).toBe("/blog");
  });
});

describe("shared live renderer blog navigation", () => {
  it("does not expose Blog on preview or unpublished shared surfaces", () => {
    const preview = renderToStaticMarkup(
      <SiteRenderer
        draft={sampleSiteDraft}
        vertical={restaurantConfig.id}
        blogHref="/blog"
      />,
    );
    const unpublished = renderToStaticMarkup(
      <SiteRenderer
        draft={sampleSiteDraft}
        vertical={restaurantConfig.id}
        analyticsEnabled
      />,
    );
    const foodRetail = renderToStaticMarkup(
      <SiteRenderer draft={sampleFoodRetailDraft} vertical="FOOD_RETAIL" />,
    );

    expect(preview).not.toContain('data-storefront-nav="blog"');
    expect(unpublished).not.toContain('data-storefront-nav="blog"');
    expect(foodRetail).not.toContain('data-storefront-nav="blog"');
  });

  it("exposes Blog on the shared live renderer only when that version has articles", () => {
    const live = renderToStaticMarkup(
      <SiteRenderer
        draft={sampleSiteDraft}
        vertical={restaurantConfig.id}
        analyticsEnabled
        blogHref="/blog"
      />,
    );
    const zeroArticle = renderToStaticMarkup(
      <SiteRenderer
        draft={sampleSiteDraft}
        vertical={restaurantConfig.id}
        analyticsEnabled
        blogHref={null}
      />,
    );

    expect(live).toContain('data-storefront-nav="blog"');
    expect(live).toContain('href="/blog"');
    expect(zeroArticle).not.toContain('data-storefront-nav="blog"');
  });
});

describe("restaurant live renderer blog navigation", () => {
  it("does not expose Blog on preview or zero-article restaurant themes", () => {
    for (const manifest of listRestaurantThemeManifests()) {
      const fixture = restaurantThemeFixtures[manifest.id];
      const selection = restaurantThemeSelectionSchema.parse(
        fixture.attributes.themeSelection,
      );
      const preview = renderToStaticMarkup(
        <RestaurantThemeRenderer
          draft={fixture}
          selection={selection}
          blogHref="/blog"
        />,
      );
      const zeroArticle = renderToStaticMarkup(
        <RestaurantThemeRenderer
          draft={fixture}
          selection={selection}
          analyticsEnabled
        />,
      );

      expect(preview).not.toContain('data-storefront-nav="blog"');
      expect(zeroArticle).not.toContain('data-storefront-nav="blog"');
    }
  });

  it("exposes one Blog entry on every live restaurant theme with published articles", () => {
    for (const manifest of listRestaurantThemeManifests()) {
      const fixture = restaurantThemeFixtures[manifest.id];
      const selection = restaurantThemeSelectionSchema.parse(
        fixture.attributes.themeSelection,
      );
      const html = renderToStaticMarkup(
        <RestaurantThemeRenderer
          draft={fixture}
          selection={selection}
          analyticsEnabled
          blogHref="/blog"
        />,
      );

      expect(html).toContain('data-storefront-nav="blog"');
      expect(html).toContain('href="/blog"');
      expect(html.split('data-storefront-nav="blog"')).toHaveLength(2);
    }
  });
});

describe("published article storefront chrome", () => {
  it("renders the exact authorized published identity instead of a later draft", () => {
    const published = renderToStaticMarkup(
      <CustomerArticleChrome
        draft={publishedDraft}
        vertical={restaurantConfig.id}
        analyticsEnabled
      >
        <p>Article body stays in the page, not in analytics.</p>
      </CustomerArticleChrome>,
    );
    const isolated = renderToStaticMarkup(
      <CustomerArticleChrome
        draft={draftSnapshot}
        vertical={restaurantConfig.id}
        analyticsEnabled
      >
        <p>Draft-only copy</p>
      </CustomerArticleChrome>,
    );

    expect(published).toContain("Published Osteria");
    expect(published).toContain("#f4efe5");
    expect(published).not.toContain("Draft Kitchen Rewrite");
    expect(published).not.toContain("#ff00aa");
    expect(isolated).toContain("Draft Kitchen Rewrite");
    expect(isolated).not.toContain("Published Osteria");
  });

  it("provides keyboard-accessible home navigation and an evidence-backed conversion action", () => {
    const markup = renderToStaticMarkup(
      <CustomerArticleChrome
        draft={publishedDraft}
        vertical={restaurantConfig.id}
        analyticsEnabled
      >
        <p>Back to the site</p>
      </CustomerArticleChrome>,
    );
    const action = resolveStorefrontPrimaryAction(
      publishedDraft,
      restaurantConfig.id,
    );

    expect(action?.url).toBe(
      "https://www.sevenrooms.com/explore/osteria-luna",
    );
    expect(markup).toContain('href="/"');
    expect(markup).toContain("Published Osteria");
    expect(markup).toContain("Back to the site");
    expect(markup).toContain('href="https://www.sevenrooms.com/explore/osteria-luna"');
    expect(markup).toContain("Book a table");
    expect(markup).toContain("data-analytics-cta");
    expect(markup).toContain("min-h-11");
  });

  it("does not invent a conversion action the published snapshot does not carry", () => {
    const markup = renderToStaticMarkup(
      <CustomerArticleChrome
        draft={draftSnapshot}
        vertical={restaurantConfig.id}
        analyticsEnabled
      >
        <p>No CTA</p>
      </CustomerArticleChrome>,
    );

    expect(resolveStorefrontPrimaryAction(draftSnapshot, restaurantConfig.id)).toBeNull();
    expect(markup).not.toContain("data-analytics-cta");
  });
});

describe("article storefront analytics minimization", () => {
  it("preserves CTA semantics without recording article body or URL data", () => {
    const articleBody =
      "Private article body that mentions https://article.example/secret-path";
    const articleUrl = "/blog/summer-bread-guide";
    const markup = renderToStaticMarkup(
      <CustomerArticleChrome
        draft={publishedDraft}
        vertical={restaurantConfig.id}
        analyticsEnabled
      >
        <ArticleMarkdown
          markdown={`Read more at [home](/) or [book](${publishedDraft.integrations[0]?.url}). ${articleBody}`}
          approvedDestinations={approvedArticleDestinations(
            publishedDraft.integrations,
          )}
        />
      </CustomerArticleChrome>,
    );

    const ctaMarkup = markup.match(
      /<a[^>]*data-analytics-cta[^>]*>[\s\S]*?<\/a>/,
    )?.[0];
    expect(ctaMarkup).toBeDefined();
    expect(ctaMarkup).toContain("Book a table");
    expect(ctaMarkup).not.toContain(articleBody);
    expect(ctaMarkup).not.toContain(articleUrl);
    expect(ctaMarkup).not.toContain("article.example");

    const bodyLink = markup.match(
      /<a[^>]*href="https:\/\/www\.sevenrooms\.com\/explore\/osteria-luna"[^>]*>[\s\S]*?<\/a>/g,
    );
    expect(bodyLink?.some((link) => !link.includes("data-analytics-cta"))).toBe(
      true,
    );

    expect(
      analyticsEventInputSchema.parse({
        id: "5cd2b4dd-c6d5-4bfb-b453-2d12b349c27a",
        visitId: "aa508bd0-43a1-4559-88ff-127fcf981bab",
        type: "CTA_CLICK",
      }),
    ).toEqual({
      id: "5cd2b4dd-c6d5-4bfb-b453-2d12b349c27a",
      visitId: "aa508bd0-43a1-4559-88ff-127fcf981bab",
      type: "CTA_CLICK",
    });
    expect(() =>
      analyticsEventInputSchema.parse({
        id: "5cd2b4dd-c6d5-4bfb-b453-2d12b349c27a",
        visitId: "aa508bd0-43a1-4559-88ff-127fcf981bab",
        type: "CTA_CLICK",
        url: articleUrl,
        body: articleBody,
      }),
    ).toThrow();
  });
});
