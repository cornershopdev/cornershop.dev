import type { PublishedArticle } from "@/lib/articles/public-articles";
import { serializeJsonLd } from "@/lib/json-ld";

type ArticleJsonLdSource = Pick<
  PublishedArticle,
  "title" | "excerpt" | "publishedAt" | "locale"
>;

export function ArticleStructuredData({
  article,
}: {
  article: ArticleJsonLdSource;
}) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.excerpt,
    datePublished: article.publishedAt.toISOString(),
    dateModified: article.publishedAt.toISOString(),
    inLanguage: article.locale,
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
    />
  );
}
