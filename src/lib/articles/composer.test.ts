import { describe, expect, it } from "bun:test";
import {
  articleFingerprint,
  checkArticleDraft,
  selectBatchTopics,
} from "@/lib/articles/composer";
import type { SiteFacts } from "@/lib/articles/site-facts";
import { availableFacts } from "@/lib/articles/site-facts";

const facts: SiteFacts = {
  slug: "le-petit-meunier",
  name: "Le Petit Meunier",
  vertical: "RESTAURANT",
  locale: "fr",
  address: "12 Rue du Four, 75005 Paris",
  phone: "+33 1 42 00 00 00",
  businessHours: [{ days: "Tue–Sat", hours: "12:00–22:00" }],
  catalogItems: [
    { name: "Croissant", price: 4.5, currency: "EUR" },
    { name: "Pain au chocolat", price: null, currency: "EUR" },
  ],
  integrationLabels: ["Book a table"],
};

describe("availableFacts", () => {
  it("marks facts present only when non-empty", () => {
    const available = availableFacts(facts);
    expect(available.has("catalogItems")).toBe(true);
    expect(available.has("address")).toBe(true);
    expect(available.has("businessHours")).toBe(true);
    expect(available.has("phone")).toBe(true);
    expect(available.has("integrations")).toBe(true);
  });

  it("withholds facts that are blank strings or empty arrays", () => {
    const sparse = availableFacts({
      ...facts,
      address: "   ",
      businessHours: [],
      catalogItems: [],
      integrationLabels: [],
      phone: null,
    });
    expect([...sparse]).toEqual([]);
  });
});

describe("selectBatchTopics", () => {
  const plans = [
    { key: "seasonal-menu", requiredFacts: ["catalogItems"] },
    { key: "neighbourhood-guide", requiredFacts: ["address"] },
    { key: "private-events", requiredFacts: ["phone", "integrations"] },
    { key: "first-visit", requiredFacts: ["businessHours", "address"] },
  ];

  it("never selects a topic whose required facts are missing", () => {
    const selected = selectBatchTopics({
      facts: { ...facts, phone: null, integrationLabels: [] },
      plans,
      count: 4,
      recentTopicKeys: [],
    });

    expect(selected.map((topic) => topic.key)).not.toContain("private-events");
  });

  it("caps the batch size", () => {
    const selected = selectBatchTopics({
      facts,
      plans,
      count: 99,
      recentTopicKeys: [],
    });
    expect(selected.length).toBeLessThanOrEqual(8);
  });

  it("avoids topics covered by recent batches when alternatives exist", () => {
    const first = selectBatchTopics({
      facts,
      plans,
      count: 2,
      recentTopicKeys: [],
    });
    const second = selectBatchTopics({
      facts,
      plans,
      count: 2,
      recentTopicKeys: first.map((topic) => topic.key),
    });

    const overlap = second.filter((topic) =>
      first.some((entry) => entry.key === topic.key),
    );
    expect(overlap.length).toBe(0);
  });

  it("returns an empty selection when no topic is supportable", () => {
    expect(
      selectBatchTopics({
        facts: {
          ...facts,
          catalogItems: [],
          address: null,
          businessHours: [],
          phone: null,
          integrationLabels: [],
        },
        plans,
        count: 4,
        recentTopicKeys: [],
      }),
    ).toEqual([]);
  });

  it("is deterministic for the same site and inputs", () => {
    const run = () =>
      selectBatchTopics({ facts, plans, count: 3, recentTopicKeys: [] }).map(
        (topic) => topic.key,
      );
    expect(run()).toEqual(run());
  });
});

describe("checkArticleDraft", () => {
  const base = {
    topicKey: "seasonal-menu",
    slug: "what-s-in-season",
    title: "What's in season on our menu right now",
    excerpt: "A look at this month's bakes.",
    bodyMarkdown:
      "Our croissant lamination uses butter from the same two dairies all year. ".repeat(
        10,
      ),
    catalogClaims: [{ name: "Croissant", price: null, currency: null }],
  };

  it("accepts a factual draft", () => {
    expect(checkArticleDraft(base, facts)).toEqual([]);
  });

  it("rejects award claims", () => {
    expect(
      checkArticleDraft(
        { ...base, bodyMarkdown: `${base.bodyMarkdown} We are award-winning.` },
        facts,
      ).some((problem) => problem.startsWith("forbidden claim")),
    ).toBe(true);
  });

  it("rejects fabricated rankings and certifications", () => {
    for (const claim of [
      "Voted the best bakery in Paris.",
      "We are certified organic.",
      "Rated #1 by locals.",
    ]) {
      expect(
        checkArticleDraft(
          { ...base, bodyMarkdown: `${base.bodyMarkdown} ${claim}` },
          facts,
        ).some((problem) => problem.startsWith("forbidden claim")),
      ).toBe(true);
    }
  });

  it("accepts a structured catalog name and supported price claim", () => {
    expect(
      checkArticleDraft(
        {
          ...base,
          bodyMarkdown: `${base.bodyMarkdown} A Croissant costs €4.50.`,
          catalogClaims: [
            { name: "Croissant", price: 4.5, currency: "EUR" },
          ],
        },
        facts,
      ),
    ).toEqual([]);
    expect(
      checkArticleDraft(
        {
          ...base,
          bodyMarkdown: `${base.bodyMarkdown} A Croissant costs 4,50\u00a0€.`,
          catalogClaims: [
            { name: "Croissant", price: 4.5, currency: "EUR" },
          ],
        },
        facts,
      ),
    ).toEqual([]);
  });

  it("rejects an unknown structured catalog item claim", () => {
    expect(
      checkArticleDraft(
        {
          ...base,
          bodyMarkdown: `${base.bodyMarkdown} The Moonbeam Tart is folded by hand.`,
          catalogClaims: [
            ...base.catalogClaims,
            { name: "Moonbeam Tart", price: null, currency: null },
          ],
        },
        facts,
      ).some((problem) => problem.includes("unknown catalog item")),
    ).toBe(true);
  });

  it("rejects high-confidence unknown prose even beside a valid claim", () => {
    for (const unknownAssertion of [
      "Moonbeam Tart is folded by hand.",
      "Croissant Supreme is baked each morning.",
      "Éclair Doré is prepared each afternoon.",
      "Éclair is prepared each afternoon.",
      "Moonbeam tart is folded by hand.",
      "We prepare Moonbeam Tart each morning.",
      "Croissant supreme is baked each morning.",
      "Croissant-Supreme is baked each morning.",
    ]) {
      expect(
        checkArticleDraft(
          {
            ...base,
            topicKey: "first-visit",
            bodyMarkdown: `${base.bodyMarkdown} ${unknownAssertion}`,
          },
          facts,
        ).some((problem) => problem.includes("unknown catalog item mention")),
      ).toBe(true);
    }
  });

  it("does not mistake the verified business name for a catalog item", () => {
    expect(
      checkArticleDraft(
        {
          ...base,
          bodyMarkdown: `${base.bodyMarkdown} Le Petit Meunier is available for private bookings.`,
        },
        facts,
      ),
    ).toEqual([]);
  });

  it("accepts only fully declared coordinated catalog mentions", () => {
    expect(
      checkArticleDraft(
        {
          ...base,
          bodyMarkdown: `${base.bodyMarkdown} Croissant and Pain au chocolat are served each morning.`,
          catalogClaims: [
            ...base.catalogClaims,
            { name: "Pain au chocolat", price: null, currency: null },
          ],
        },
        facts,
      ),
    ).toEqual([]);
    expect(
      checkArticleDraft(
        {
          ...base,
          bodyMarkdown: `${base.bodyMarkdown} Croissant and Moonbeam tart are served each morning.`,
        },
        facts,
      ).some((problem) => problem.includes("unknown catalog item mention")),
    ).toBe(true);
  });

  it("rejects catalog-dependent prose that omits its structured claims", () => {
    expect(
      checkArticleDraft(
        {
          ...base,
          bodyMarkdown: "The invented Moonbeam Tart is folded by hand. ".repeat(15),
          catalogClaims: [],
        },
        facts,
      ).some((problem) => problem.includes("catalog-dependent topic")),
    ).toBe(true);
  });

  it("rejects a canonical catalog mention omitted from structured claims", () => {
    expect(
      checkArticleDraft({ ...base, catalogClaims: [] }, facts).some((problem) =>
        problem.includes("lacks a structured claim"),
      ),
    ).toBe(true);
  });

  it("rejects claims whose declared catalog item is absent from prose", () => {
    expect(
      checkArticleDraft(
        {
          ...base,
          catalogClaims: [
            ...base.catalogClaims,
            { name: "Pain au chocolat", price: null, currency: null },
          ],
        },
        facts,
      ).some((problem) => problem.includes("absent from article")),
    ).toBe(true);
  });

  it("rejects unsupported, wrong-currency, and unpriced catalog claims", () => {
    const adversarialClaims = [
      { name: "Croissant", price: 95, currency: "EUR" },
      { name: "Croissant", price: 4.5, currency: "USD" },
      { name: "Pain au chocolat", price: 4.5, currency: "EUR" },
    ];
    const prose = [
      "A Croissant costs €95.",
      "A Croissant costs USD 4.50.",
      "A Pain au chocolat costs €4.50.",
    ];
    for (const [index, claim] of adversarialClaims.entries()) {
      expect(
        checkArticleDraft(
          {
            ...base,
            bodyMarkdown: `${base.bodyMarkdown} ${prose[index]}`,
            catalogClaims: [claim],
          },
          facts,
        ).some((problem) => problem.includes("catalog price")),
      ).toBe(true);
    }
  });

  it("rejects raw price assertions without matching structured backing", () => {
    expect(
      checkArticleDraft(
        {
          ...base,
          bodyMarkdown: `${base.bodyMarkdown} A Croissant costs 4.50 euros.`,
          catalogClaims: base.catalogClaims,
        },
        facts,
      ).some((problem) => problem.includes("price")),
    ).toBe(true);
  });

  it("does not let a valid price claim back a different item", () => {
    expect(
      checkArticleDraft(
        {
          ...base,
          bodyMarkdown: `${base.bodyMarkdown} A Pain au chocolat costs €4.50.`,
          catalogClaims: [
            { name: "Croissant", price: 4.5, currency: "EUR" },
            { name: "Pain au chocolat", price: null, currency: null },
          ],
        },
        facts,
      ).some((problem) => problem.includes("price assertion")),
    ).toBe(true);
  });

  it("does not let same-sentence co-occurrence launder another item's price", () => {
    expect(
      checkArticleDraft(
        {
          ...base,
          bodyMarkdown: `${base.bodyMarkdown} Croissant remains available while Pain au chocolat costs €4.50.`,
          catalogClaims: [
            { name: "Croissant", price: 4.5, currency: "EUR" },
            { name: "Pain au chocolat", price: null, currency: null },
          ],
        },
        facts,
      ).some((problem) => problem.includes("price assertion")),
    ).toBe(true);
  });

  it("does not let undeclared unknown items launder a known item's price", () => {
    for (const prose of [
      "Croissant remains available while Éclair costs €4.50.",
      "Croissant remains available while Moonbeam tart costs €4.50.",
      "Croissant remains available while Croissant-Supreme costs €4.50.",
    ]) {
      expect(
        checkArticleDraft(
          {
            ...base,
            bodyMarkdown: `${base.bodyMarkdown} ${prose}`,
            catalogClaims: [
              { name: "Croissant", price: 4.5, currency: "EUR" },
            ],
          },
          facts,
        ).length,
      ).toBeGreaterThan(0);
    }
  });

  it("recognizes every supported catalog currency in raw prose", () => {
    for (const currency of ["JPY", "SEK", "NOK", "DKK", "PLN"]) {
      const pricedFacts: SiteFacts = {
        ...facts,
        catalogItems: [{ name: "Matcha", price: 1_000, currency }],
      };
      expect(
        checkArticleDraft(
          {
            ...base,
            bodyMarkdown:
              "Our Matcha is prepared consistently each morning. ".repeat(10) +
              `Matcha costs ${currency} 1200.`,
            catalogClaims: [
              { name: "Matcha", price: 1_000, currency },
            ],
          },
          pricedFacts,
        ).some((problem) => problem.includes("price assertion")),
      ).toBe(true);
    }
  });

  it("recognizes supported native currency symbols in raw prose", () => {
    const nativePrices = [
      ["JPY", "¥1200", "¥1000"],
      ["SEK", "1200 kr", "1000 kr"],
      ["NOK", "1200 kr", "1000 kr"],
      ["DKK", "1200 kr", "1000 kr"],
      ["PLN", "1200 zł", "1000 zł"],
    ] as const;
    for (const [currency, wrongPrice, factualPrice] of nativePrices) {
      const pricedFacts: SiteFacts = {
        ...facts,
        catalogItems: [{ name: "Matcha", price: 1_000, currency }],
      };
      const draft = {
        ...base,
        catalogClaims: [{ name: "Matcha", price: 1_000, currency }],
      };
      expect(
        checkArticleDraft(
          {
            ...draft,
            bodyMarkdown:
              "Our Matcha is prepared consistently each morning. ".repeat(10) +
              `Matcha costs ${wrongPrice}.`,
          },
          pricedFacts,
        ).some((problem) => problem.includes("price assertion")),
      ).toBe(true);
      expect(
        checkArticleDraft(
          {
            ...draft,
            bodyMarkdown:
              "Our Matcha is prepared consistently each morning. ".repeat(10) +
              `Matcha costs ${factualPrice}.`,
          },
          pricedFacts,
        ),
      ).toEqual([]);
    }
  });

  it("rejects an ambiguous kr symbol", () => {
    const ambiguousFacts: SiteFacts = {
      ...facts,
      catalogItems: [
        { name: "Matcha", price: 1_000, currency: "SEK" },
        { name: "Cardamom Bun", price: 1_000, currency: "NOK" },
      ],
    };
    expect(
      checkArticleDraft(
        {
          ...base,
          bodyMarkdown:
            "Our Matcha is prepared consistently each morning. ".repeat(10) +
            "Matcha costs 1000 kr.",
          catalogClaims: [
            { name: "Matcha", price: 1_000, currency: "SEK" },
          ],
        },
        ambiguousFacts,
      ).some((problem) => problem.includes("price assertion")),
    ).toBe(true);
  });

  it("rejects partially parsed monetary ranges across dash forms", () => {
    for (const separator of ["-", "‐", "‑", "‒", "–", "—", "−", "/", "~"]) {
      expect(
        checkArticleDraft(
          {
            ...base,
            bodyMarkdown: `${base.bodyMarkdown} A Croissant costs €4.50${separator}95.`,
            catalogClaims: [
              { name: "Croissant", price: 4.5, currency: "EUR" },
            ],
          },
          facts,
        ).some((problem) => problem.includes("price assertion")),
      ).toBe(true);
    }
  });

  it("accepts a supported price before its same-sentence item name", () => {
    expect(
      checkArticleDraft(
        {
          ...base,
          bodyMarkdown: `${base.bodyMarkdown} For €4.50, choose a Croissant.`,
          catalogClaims: [
            { name: "Croissant", price: 4.5, currency: "EUR" },
          ],
        },
        facts,
      ),
    ).toEqual([]);
  });

  it("rejects an ambiguous or unsupported dollar symbol", () => {
    expect(
      checkArticleDraft(
        {
          ...base,
          bodyMarkdown: `${base.bodyMarkdown} A Croissant costs $4.50.`,
          catalogClaims: [
            { name: "Croissant", price: 4.5, currency: "EUR" },
          ],
        },
        facts,
      ).some((problem) => problem.includes("price assertion")),
    ).toBe(true);
  });

  it("does not treat ordinary non-currency numbers as price claims", () => {
    expect(
      checkArticleDraft(
        {
          ...base,
          bodyMarkdown: `${base.bodyMarkdown} The method has stayed consistent since 2018.`,
        },
        facts,
      ),
    ).toEqual([]);
  });

  it("enforces the kebab-case slug contract", () => {
    expect(
      checkArticleDraft({ ...base, slug: "Not A Slug" }, facts).some((problem) =>
        problem.includes("slug"),
      ),
    ).toBe(true);
  });

  it("rejects implausibly short bodies", () => {
    expect(
      checkArticleDraft({ ...base, bodyMarkdown: "Come visit us." }, facts).some(
        (problem) => problem.includes("short"),
      ),
    ).toBe(true);
  });
});

describe("articleFingerprint", () => {
  it("is stable and input-sensitive", () => {
    const one = articleFingerprint({
      siteId: "a",
      batchId: "b",
      topicKey: "t",
    });
    expect(one).toBe(
      articleFingerprint({ siteId: "a", batchId: "b", topicKey: "t" }),
    );
    expect(one).not.toBe(
      articleFingerprint({ siteId: "a", batchId: "b2", topicKey: "t" }),
    );
  });
});
