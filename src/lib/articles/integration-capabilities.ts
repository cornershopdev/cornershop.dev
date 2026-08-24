export const ARTICLE_INTEGRATION_CAPABILITIES = [
  "BOOKING",
  "ORDERING",
  "DELIVERY",
  "QUOTE",
  "CONTACT",
] as const;

export type ArticleIntegrationCapability =
  (typeof ARTICLE_INTEGRATION_CAPABILITIES)[number];

export function isArticleIntegrationCapability(
  value: string,
): value is ArticleIntegrationCapability {
  return ARTICLE_INTEGRATION_CAPABILITIES.includes(
    value as ArticleIntegrationCapability,
  );
}
