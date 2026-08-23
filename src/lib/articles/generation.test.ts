import { describe, expect, it } from "bun:test";
import {
  articleBatchOutputSchema,
  buildArticleBatchPrompt,
} from "@/lib/articles/generation";
import type { SiteFacts } from "@/lib/articles/site-facts";

const facts: SiteFacts = {
  slug: "prompt-contract",
  name: "Prompt Contract Bakery",
  vertical: "FOOD_RETAIL",
  locale: "en",
  address: "1 Test Street",
  phone: null,
  businessHours: [],
  catalogItems: [
    { name: "Matcha Bun", price: 1_000, currency: "JPY" },
  ],
  integrationLabels: [],
};

describe("article generation model contract", () => {
  it("puts structured canonical catalog facts and claim rules in the prompt", () => {
    const prompt = buildArticleBatchPrompt({
      facts,
      topics: [{ key: "product-guide", title: "A product guide" }],
    });

    expect(prompt).toContain(
      JSON.stringify([
        { name: "Matcha Bun", price: 1_000, currency: "JPY" },
      ]),
    );
    expect(prompt).toContain(
      "catalogClaims must enumerate every catalog item named",
    );
    expect(prompt).toContain(
      "price/currency pair must be copied exactly from that same catalog item",
    );
    expect(prompt).toContain("[product-guide] A product guide");
  });

  it("requires bounded structured claims in every model article", () => {
    const article = {
      topicKey: "product-guide",
      slug: "matcha-bun-guide",
      title: "Matcha Bun guide",
      excerpt: "What to know.",
      bodyMarkdown: "A factual body.",
    };

    expect(
      articleBatchOutputSchema.safeParse({ articles: [article] }).success,
    ).toBe(false);
    expect(
      articleBatchOutputSchema.safeParse({
        articles: [
          {
            ...article,
            catalogClaims: [
              { name: "Matcha Bun", price: 1_000, currency: "JPY" },
            ],
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      articleBatchOutputSchema.safeParse({
        articles: [
          {
            ...article,
            catalogClaims: [
              { name: "Matcha Bun", price: 1_000, currency: "jpy" },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });
});
