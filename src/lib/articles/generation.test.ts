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
    {
      id: "catalog-matcha-bun",
      name: "Matcha Bun",
      price: 1_000,
      currency: "JPY",
    },
  ],
  integrationCapabilities: [],
};

const plan = {
  contractVersion: 1,
  topicKey: "seasonal-stock",
  templateKey: "retail-current-stock",
  catalogItemId: "catalog-matcha-bun",
  priceMode: "exact",
} as const;

describe("article generation model contract", () => {
  it("asks only for exact IDs and closed plan fields", () => {
    const prompt = buildArticleBatchPrompt({
      facts,
      topics: [
        {
          key: "seasonal-stock",
          templateKey: "retail-current-stock",
          catalogItem: "required",
        },
      ],
    });

    expect(prompt).toContain(
      JSON.stringify([
        {
          catalogItemId: "catalog-matcha-bun",
          hasExactPrice: true,
        },
      ]),
    );
    expect(prompt).toContain(
      "Return only contractVersion, topicKey, templateKey, catalogItemId, and priceMode.",
    );
    expect(prompt).toContain(
      "topicKey=seasonal-stock; templateKey=retail-current-stock; catalogItem=required",
    );
    expect(prompt).not.toContain('"price":1000');
    expect(prompt).not.toContain('"currency":"JPY"');
    expect(prompt).not.toContain("Matcha Bun");
    expect(prompt).not.toContain("Prompt Contract Bakery");
    expect(prompt).not.toContain("1 Test Street");
    expect(prompt).not.toContain("bodyMarkdown");
  });

  it("accepts only strict closed plans", () => {
    expect(articleBatchOutputSchema.safeParse({ articles: [plan] }).success).toBe(
      true,
    );

    for (const extra of [
      { title: "Matcha Bun guide" },
      { excerpt: "What to know" },
      { bodyMarkdown: "Matcha Bun costs JPY 1000" },
      { name: "Matcha Bun" },
      { price: 1_000 },
      { currency: "JPY" },
      { range: { from: 1_000 } },
      { unit: "each" },
      { text: "Try our Matcha Bun" },
    ]) {
      expect(
        articleBatchOutputSchema.safeParse({
          articles: [{ ...plan, ...extra }],
        }).success,
      ).toBe(false);
    }
    expect(
      articleBatchOutputSchema.safeParse({ articles: [plan], prose: "no" })
        .success,
    ).toBe(false);
  });
});
