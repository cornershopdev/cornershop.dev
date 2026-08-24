import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ArticleStructuredData } from "@/lib/articles/article-json-ld";

describe("public article JSON-LD", () => {
  it("renders untrusted fields without allowing a script breakout", () => {
    const title = "</script><script>alert(1)</script>";
    const excerpt = "before\u2028middle\u2029after";
    const publishedAt = new Date("2026-08-23T12:34:56.000Z");

    const markup = renderToStaticMarkup(
      <ArticleStructuredData
        article={{ title, excerpt, publishedAt, locale: "en" }}
      />,
    );
    const script = markup.match(
      /^<script type="application\/ld\+json">([\s\S]*)<\/script>$/,
    );
    const payload = script?.[1];

    expect(payload).toBeDefined();
    if (payload === undefined) throw new Error("Missing JSON-LD payload");
    expect(markup.match(/<script/g)).toHaveLength(1);
    expect(payload).not.toContain("<");
    expect(payload).not.toContain("\u2028");
    expect(payload).not.toContain("\u2029");
    expect(JSON.parse(payload)).toEqual({
      "@context": "https://schema.org",
      "@type": "Article",
      headline: title,
      description: excerpt,
      datePublished: publishedAt.toISOString(),
      dateModified: publishedAt.toISOString(),
      inLanguage: "en",
    });
  });
});
