import { describe, expect, it } from "bun:test";
import {
  ARTICLE_BODY_MAX_CHARS,
  ARTICLE_BODY_MIN_CHARS,
  ARTICLE_PLAN_CONTRACT_VERSION,
  articleFingerprint,
  checkArticlePlan,
  checkRenderedArticleDraft,
  generatedArticlePlanSchema,
  renderArticlePlan,
  selectBatchTopics,
  type GeneratedArticlePlan,
} from "@/lib/articles/composer";
import type { SiteFacts } from "@/lib/articles/site-facts";
import { availableFacts } from "@/lib/articles/site-facts";
import { articleTopicPlansFor } from "@/lib/articles/topic-plans";
import { formatPrice } from "@/lib/site-draft";
import { supportedCurrencySchema } from "@/lib/verticals/schema";
import type { VerticalId } from "@/lib/verticals/types";

const facts: SiteFacts = {
  slug: "le-petit-meunier",
  name: "Le Petit Meunier",
  vertical: "RESTAURANT",
  locale: "fr",
  address: "12 Rue du Four, 75005 Paris",
  phone: "+33 1 42 00 00 00",
  businessHours: [{ days: "Tue–Sat", hours: "12:00–22:00" }],
  catalogItems: [
    { id: "catalog-croissant", name: "Croissant", price: 4.5, currency: "EUR" },
    {
      id: "catalog-pain-chocolat",
      name: "Pain au chocolat",
      price: null,
      currency: "EUR",
    },
  ],
  integrationCapabilities: ["BOOKING"],
};

const catalogPlan: GeneratedArticlePlan = {
  contractVersion: ARTICLE_PLAN_CONTRACT_VERSION,
  topicKey: "seasonal-menu",
  templateKey: "restaurant-current-menu",
  catalogItemId: "catalog-croissant",
  priceMode: "exact",
};

describe("availableFacts", () => {
  it("marks facts present only when non-empty", () => {
    const available = availableFacts(facts);
    expect(available.has("catalogItems")).toBe(true);
    expect(available.has("address")).toBe(true);
    expect(available.has("businessHours")).toBe(true);
    expect(available.has("phone")).toBe(true);
    expect(facts.integrationCapabilities).toEqual(["BOOKING"]);
  });

  it("withholds facts that are blank strings or empty arrays", () => {
    const sparse = availableFacts({
      ...facts,
      address: "   ",
      businessHours: [],
      catalogItems: [],
      integrationCapabilities: [],
      phone: null,
    });
    expect([...sparse]).toEqual([]);
  });
});

describe("selectBatchTopics", () => {
  const plans: Parameters<typeof selectBatchTopics>[0]["plans"] = [
    { key: "seasonal-menu", requiredFacts: ["catalogItems"] },
    { key: "neighbourhood-guide", requiredFacts: ["address"] },
    {
      key: "private-events",
      requiredFacts: ["phone"],
      requiredAnyIntegrationCapabilities: ["BOOKING", "CONTACT"],
    },
    { key: "first-visit", requiredFacts: ["businessHours", "address"] },
  ];

  it("never selects a topic whose required facts are missing", () => {
    const selected = selectBatchTopics({
      facts: { ...facts, phone: null, integrationCapabilities: [] },
      plans,
      count: 4,
      recentTopicKeys: [],
    });
    expect(selected.map((topic) => topic.key)).not.toContain("private-events");
  });

  it("caps the batch size and remains deterministic", () => {
    const run = () =>
      selectBatchTopics({ facts, plans, count: 99, recentTopicKeys: [] });
    expect(run()).toEqual(run());
    expect(run().length).toBeLessThanOrEqual(8);
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
    expect(
      second.filter((topic) => first.some((entry) => entry.key === topic.key)),
    ).toEqual([]);
  });

  it("returns no topics when no required fact is present", () => {
    expect(
      selectBatchTopics({
        facts: {
          ...facts,
          catalogItems: [],
          address: null,
          businessHours: [],
          phone: null,
          integrationCapabilities: [],
        },
        plans,
        count: 4,
        recentTopicKeys: [],
      }),
    ).toEqual([]);
  });
});

describe("generatedArticlePlanSchema", () => {
  it("exposes only the closed non-prose model contract", () => {
    const parsed = generatedArticlePlanSchema.parse(catalogPlan);
    expect(Object.keys(parsed).sort()).toEqual(
      [
        "catalogItemId",
        "contractVersion",
        "priceMode",
        "templateKey",
        "topicKey",
      ].sort(),
    );
  });

  it("strictly rejects every renderable or monetary extra field", () => {
    const extras: Record<string, unknown> = {
      title: "Moonbeam",
      excerpt: "Tart is baked every morning",
      bodyMarkdown: "Moonbeam **Tart** costs €**95**.",
      text: "Try our moonbeam tart today.",
      name: "Moonbeam Tart",
      price: 95,
      amount: "９５",
      currency: "EUR",
      range: { from: 4.5, to: 9.5 },
      qualifier: "starts at",
      unit: "per person",
    };

    for (const [field, value] of Object.entries(extras)) {
      expect(
        generatedArticlePlanSchema.safeParse({
          ...catalogPlan,
          [field]: value,
        }).success,
      ).toBe(false);
    }
  });

  it("cannot launder assertions across public fields or markup/entities", () => {
    for (const fields of [
      { title: "Moonbeam", excerpt: "Tart is baked every morning" },
      { title: "A Croissant costs €", excerpt: "95" },
      { bodyMarkdown: "[Moonbeam **Tart**](javascript:x) is baked." },
      { bodyMarkdown: "Croissant costs &amp;euro;95 or EUR&amp;nbsp;95." },
    ]) {
      expect(
        generatedArticlePlanSchema.safeParse({ ...catalogPlan, ...fields })
          .success,
      ).toBe(false);
    }
  });

  it("structurally rejects every previously reported prose bypass", () => {
    const forbiddenProse = [
      "Try our moonbeam tart today.",
      "Moonbeam **Tart** is baked each morning.",
      "[Moonbeam Tart](javascript:x) is baked each morning.",
      "Moonbeam [Tart](javascript:x) is baked each morning.",
      "A Croissant costs €**95**.",
      "A Croissant costs &amp;euro;95.",
      "A Croissant costs EUR&amp;nbsp;95.",
      "A Croissant costs €\n95.",
      "Try our\nmoonbeam tart today.",
      "Moonbeam tart\nis delicious today.",
      "A Croissant costs €９５.",
      "A Croissant costs ＥＵＲ ９５.",
      "A Croissant costs €\u206095.",
      "A Croissant costs €\u200b95.",
      "A Croissant costs €\u200e95.",
      "A Croissant costs from €4.50.",
      "A Croissant starts at €4.50.",
      "A Croissant costs €4.50+.",
      "A Croissant costs up to €4.50.",
      "A Croissant costs between €4.50 and more.",
      "Un croissant coûte à partir de 4,50 €.",
      "Un croissant coûte entre 4,50 € et 9,50 €.",
      "Le fromage coûte 4,50 €/kg.",
      "Ein Croissant kostet ab €4,50.",
      "Cena wynosi 4,50 zł/kg.",
      "価格は1000円/個です。",
    ];

    for (const bodyMarkdown of forbiddenProse) {
      expect(
        generatedArticlePlanSchema.safeParse({
          ...catalogPlan,
          bodyMarkdown,
        }).success,
      ).toBe(false);
      expect(
        generatedArticlePlanSchema.safeParse({
          ...catalogPlan,
          text: bodyMarkdown,
        }).success,
      ).toBe(false);
    }
  });

  it("uniformly rejects free prose that heuristic detectors used to misclassify", () => {
    const validButNonRenderableProse = [
      "Our dough for each Croissant is prepared every morning.",
      "The butter inside our Croissant is folded carefully.",
      "The kitchen is available for private events.",
      "Morning service is prepared with care.",
      "Our approach makes Every Visit feel easy.",
    ];

    for (const text of validButNonRenderableProse) {
      expect(
        generatedArticlePlanSchema.safeParse({ ...catalogPlan, text }).success,
      ).toBe(false);
    }
  });

  it("rejects unknown enum members and contract versions", () => {
    for (const patch of [
      { contractVersion: 2 },
      { topicKey: "invented-topic" },
      { templateKey: "free-prose" },
      { priceMode: "from" },
    ]) {
      expect(
        generatedArticlePlanSchema.safeParse({ ...catalogPlan, ...patch })
          .success,
      ).toBe(false);
    }
  });
});

describe("article plan validation", () => {
  it("requires the topic/template pair registered for the site vertical", () => {
    expect(
      checkArticlePlan(
        { ...catalogPlan, templateKey: "restaurant-menu-facts" },
        facts,
      ),
    ).toContain('template is not allowed for topic: "restaurant-menu-facts"');
    expect(
      checkArticlePlan(
        {
          ...catalogPlan,
          topicKey: "seasonal-stock",
          templateKey: "retail-current-stock",
        },
        facts,
      )[0],
    ).toContain("topic is not available for vertical");
  });

  it("requires exact, unique catalog-id membership without normalization", () => {
    const insertedControls = ["\u200b", "\u200e", "\u2060", "\u202e", "\ufeff"];
    const canonical = "catalog-croissant";
    const variants = [
      canonical.toUpperCase(),
      "ｃａｔａｌｏｇ－ｃｒｏｉｓｓａｎｔ",
      "catalοg-croissant",
      ...insertedControls.flatMap((control) => [
        `${control}${canonical}`,
        `${canonical.slice(0, 7)}${control}${canonical.slice(7)}`,
        `${canonical}${control}`,
      ]),
    ];

    for (const catalogItemId of variants) {
      expect(
        checkArticlePlan({ ...catalogPlan, catalogItemId }, facts).some(
          (problem) => problem.includes("unknown catalog item id"),
        ),
      ).toBe(true);
    }
  });

  it("treats canonically equivalent Unicode IDs as distinct identifiers", () => {
    const composedId = "café";
    const unicodeFacts: SiteFacts = {
      ...facts,
      catalogItems: [{ ...facts.catalogItems[0]!, id: composedId }],
    };
    expect(
      checkArticlePlan(
        { ...catalogPlan, catalogItemId: composedId.normalize("NFD") },
        unicodeFacts,
      ).some((problem) => problem.includes("unknown catalog item id")),
    ).toBe(true);
    expect(
      checkArticlePlan({ ...catalogPlan, catalogItemId: composedId }, unicodeFacts),
    ).toEqual([]);
  });

  it("rejects duplicate factual IDs instead of picking one price", () => {
    const duplicateFacts: SiteFacts = {
      ...facts,
      catalogItems: [
        facts.catalogItems[0]!,
        { ...facts.catalogItems[0]!, price: 95 },
      ],
    };
    expect(checkArticlePlan(catalogPlan, duplicateFacts)).toContain(
      'catalog item id is ambiguous: "catalog-croissant"',
    );
  });

  it("binds exact price mode to a finite same-item canonical price", () => {
    expect(
      checkArticlePlan(
        {
          ...catalogPlan,
          catalogItemId: "catalog-pain-chocolat",
          priceMode: "exact",
        },
        facts,
      ),
    ).toContain("exact price mode requires a canonical catalog price");

    for (const price of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(
        checkArticlePlan(catalogPlan, {
          ...facts,
          catalogItems: [{ ...facts.catalogItems[0]!, price }],
        }),
      ).toContain("selected catalog item has an invalid canonical price");
    }
  });

  it("keeps every public draft field independent of arbitrary catalog names", () => {
    const directRepros = [
      "",
      "   \t  ",
      "Croissant €95",
      "Croissant ninety-five euros",
      "Croissant E.U.R. 95",
      "Croissant E U R 95",
      "Croissant USD 95-125",
      "Croissant €**95**",
      "Croissant &amp;euro;95",
      "Croissant &amp;amp;amp;euro;95",
      "Croissant EUR&amp;nbsp;95",
      "Croissant €９５",
      "Croissant ＥＵＲ ９５",
      "Croissant €\u206095",
      "Croissant €\u200b95",
      "Croissant €\u200e95",
      "Croissant €\n95",
      "Croissant from €4.50",
      "Croissant starts at €4.50",
      "Croissant €4.50+",
      "Croissant up to €4.50",
      "Croissant between €4.50 and more",
      "Croissant EUR from 95",
      "Croissant € up to 95",
      "Croissant 95 per person EUR",
      "Croissant à partir de 4,50 €",
      "Croissant entre 4,50 € et 9,50 €",
      "Fromage 4,50 €/kg",
      "Croissant ab €4,50",
      "Ser 4,50 zł/kg",
      "商品1000円/個",
      "Croissant €٩٥",
      "Croissant EUR ۹۵",
      "Croissant ₹95",
      "Croissant ₽95",
      "Croissant ₩95",
      "Croissant RUB 95",
      "Croissant INR 95",
      "Croissant CNY 95",
      "Croissant €\u00ad95",
      "Croissant €\u034f95",
      "</script><script>alert(1)</script>",
      "Moonbeam\nTart €95",
      "A".repeat(500),
    ];
    const arbitraryNames = [...directRepros, ...deterministicCatalogNameFuzz()];
    const baselines = {
      exact: renderArticlePlan(catalogPlan, facts),
      omit: renderArticlePlan({ ...catalogPlan, priceMode: "omit" }, facts),
    };
    expect(baselines.exact.ok).toBe(true);
    expect(baselines.omit.ok).toBe(true);

    for (const name of arbitraryNames) {
      const renamedFacts: SiteFacts = {
        ...facts,
        catalogItems: [{ ...facts.catalogItems[0]!, name }],
      };
      for (const priceMode of ["omit", "exact"] as const) {
        const baseline = baselines[priceMode];
        const result = renderArticlePlan(
          { ...catalogPlan, priceMode },
          renamedFacts,
        );
        expect(result.ok).toBe(true);
        if (!result.ok || !baseline.ok) continue;
        expect(result.draft).toEqual(baseline.draft);
        if (directRepros.includes(name) && name.trim().length > 4) {
          expect(Object.values(result.draft).join("\n")).not.toContain(name);
        }
      }
    }
  });

  it("retains legitimate canonical names with non-price numerals", () => {
    for (const name of [
      "Studio 54",
      "Treatment 2.0",
      "Room 101",
      "商品９５号",
      "7-Eleven",
      "Version ٢",
      "B12 Serum",
      "Route 66",
      "Kraft 54",
      "No. 7",
      "BMW 3",
    ]) {
      const numberedFacts: SiteFacts = {
        ...facts,
        catalogItems: [{ ...facts.catalogItems[0]!, name }],
      };
      const omitted = renderArticlePlan(
        { ...catalogPlan, priceMode: "omit" },
        numberedFacts,
      );
      const exact = renderArticlePlan(catalogPlan, numberedFacts);
      expect(omitted.ok).toBe(true);
      expect(exact.ok).toBe(true);
      if (!omitted.ok || !exact.ok) continue;
      expect(Object.values(omitted.draft).join("\n")).not.toContain(name);
      expect(Object.values(exact.draft).join("\n")).not.toContain(name);
    }
  });

  it("forbids catalog IDs and price modes on non-catalog topics", () => {
    const locationPlan = {
      contractVersion: ARTICLE_PLAN_CONTRACT_VERSION,
      topicKey: "neighbourhood-guide",
      templateKey: "restaurant-location",
      catalogItemId: "catalog-croissant",
      priceMode: "exact",
    };
    const problems = checkArticlePlan(locationPlan, facts);
    expect(problems).toContain("non-catalog topic must not select a catalog item");
    expect(problems).toContain("non-catalog topic must omit catalog prices");
  });

  it("rejects a topic when its required structured fact is absent", () => {
    expect(
      checkArticlePlan(
        {
          contractVersion: ARTICLE_PLAN_CONTRACT_VERSION,
          topicKey: "neighbourhood-guide",
          templateKey: "restaurant-location",
          catalogItemId: null,
          priceMode: "omit",
        },
        { ...facts, address: null },
      ),
    ).toContain('required fact is unavailable: "address"');
  });
});

describe("deterministic article rendering", () => {
  it("takes only the canonical same-item price and derives the slug", () => {
    const sameNameFacts: SiteFacts = {
      ...facts,
      locale: "en",
      catalogItems: [
        { id: "first", name: "House Special", price: 4.5, currency: "EUR" },
        { id: "second", name: "House Special", price: 8.25, currency: "EUR" },
      ],
    };
    const result = renderArticlePlan(
      { ...catalogPlan, catalogItemId: "second" },
      sameNameFacts,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const expectedPrice = formatPrice(8.25, "EUR", "en");
    const otherPrice = formatPrice(4.5, "EUR", "en");
    const publicText = Object.values(result.draft).join("\n");
    expect(result.draft.slug).toBe("seasonal-menu");
    expect(publicText).not.toContain("House Special");
    expect(result.draft.bodyMarkdown).toContain(expectedPrice);
    expect(publicText.split(expectedPrice).length - 1).toBe(1);
    expect(publicText).not.toContain(otherPrice);
  });

  it("keeps catalog topic guidance distinct with the same selected fact", () => {
    const catalogTopics = articleTopicPlansFor("RESTAURANT").filter(
      (topic) => topic.catalogItem === "required",
    );

    for (const priceMode of ["omit", "exact"] as const) {
      const topicCopy = catalogTopics.map((topic) => {
        const result = renderArticlePlan(
          {
            contractVersion: ARTICLE_PLAN_CONTRACT_VERSION,
            topicKey: topic.key,
            templateKey: topic.templateKey,
            catalogItemId: "catalog-croissant",
            priceMode,
          },
          facts,
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return "";
        return `${result.draft.title}\n${result.draft.excerpt}`;
      });

      expect(new Set(topicCopy).size).toBe(catalogTopics.length);
    }
  });

  it("keeps canonical Unicode and Markdown-shaped names out of every public field", () => {
    const names = [
      "Moonbeam **Tart**",
      "[Croissant](/menu/€95)",
      "Crème brûlée",
      "寿司",
      "كعكة 🍰",
      "ＥＵＲ ９５",
      "Pain &amp; beurre",
    ];

    for (const name of names) {
      const unicodeFacts: SiteFacts = {
        ...facts,
        locale: "en",
        catalogItems: [
          {
            id: "unicode-item",
            name,
            price: null,
            currency: "EUR",
          },
        ],
      };
      const before = JSON.stringify(unicodeFacts);
      const result = renderArticlePlan(
        {
          ...catalogPlan,
          catalogItemId: "unicode-item",
          priceMode: "omit",
        },
        unicodeFacts,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(Object.values(result.draft).join("\n")).not.toContain(name);
      expect(JSON.stringify(unicodeFacts)).toBe(before);
    }
  });

  it("omits prices unless the closed plan requests the canonical exact value", () => {
    const exact = renderArticlePlan(catalogPlan, facts);
    const omitted = renderArticlePlan({ ...catalogPlan, priceMode: "omit" }, facts);
    expect(exact.ok).toBe(true);
    expect(omitted.ok).toBe(true);
    if (!exact.ok || !omitted.ok) return;
    const price = formatPrice(4.5, "EUR", facts.locale);
    expect(exact.draft.bodyMarkdown).toContain(price);
    expect(Object.values(exact.draft).join("\n").split(price).length - 1).toBe(1);
    expect(omitted.draft.excerpt).not.toContain(price);
    expect(omitted.draft.bodyMarkdown).not.toContain(price);
  });

  it("keeps omit-price drafts independent of canonical price and currency", () => {
    const base = renderArticlePlan({ ...catalogPlan, priceMode: "omit" }, facts);
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    expect(Object.values(base.draft).join("\n")).not.toContain("Croissant");

    for (const [price, currency] of [
      [null, "EUR"],
      [0, "USD"],
      [95, "JPY"],
      [Number.NaN, "unsupported"],
      [-1, "EUR"],
      [Number.POSITIVE_INFINITY, "RUB"],
    ] as const) {
      const changed = renderArticlePlan(
        { ...catalogPlan, priceMode: "omit" },
        {
          ...facts,
          catalogItems: [
            { ...facts.catalogItems[0]!, price, currency },
          ],
        },
      );
      expect(changed.ok).toBe(true);
      if (!changed.ok) continue;
      expect(changed.draft).toEqual(base.draft);
    }
  });

  it("renders every supported currency from the canonical fact", () => {
    for (const currency of supportedCurrencySchema.options) {
      const currencyFacts: SiteFacts = {
        ...facts,
        vertical: "FOOD_RETAIL",
        locale: "en",
        catalogItems: [
          { id: `item-${currency}`, name: "Matcha", price: 1_000.25, currency },
        ],
      };
      const result = renderArticlePlan(
        {
          contractVersion: ARTICLE_PLAN_CONTRACT_VERSION,
          topicKey: "seasonal-stock",
          templateKey: "retail-current-stock",
          catalogItemId: `item-${currency}`,
          priceMode: "exact",
        },
        currencyFacts,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const formatted = formatPrice(1_000.25, currency, "en");
      expect(result.draft.bodyMarkdown).toContain(formatted);
      expect(
        Object.values(result.draft).join("\n").split(formatted).length - 1,
      ).toBe(1);
      expect(Object.values(result.draft).join("\n")).not.toContain("Matcha");
    }
  });

  it("renders every registered topic/template in English and French", () => {
    const verticals: VerticalId[] = [
      "RESTAURANT",
      "BEAUTY",
      "LOCAL_SERVICE",
      "FOOD_RETAIL",
    ];

    for (const vertical of verticals) {
      for (const locale of ["en", "fr"] as const) {
        const templateFacts: SiteFacts = {
          ...facts,
          vertical,
          locale,
          integrationCapabilities: [
            "BOOKING",
            "ORDERING",
            "DELIVERY",
            "QUOTE",
            "CONTACT",
          ],
          catalogItems: [
            {
              id: "template-catalog-item",
              name: "Unique ⟦Canonical⟧ Name",
              price: 12.5,
              currency: "EUR",
            },
          ],
        };

        for (const topic of articleTopicPlansFor(vertical)) {
          const priceModes =
            topic.catalogItem === "required"
              ? (["omit", "exact"] as const)
              : (["omit"] as const);
          for (const priceMode of priceModes) {
            const plan: GeneratedArticlePlan = {
              contractVersion: ARTICLE_PLAN_CONTRACT_VERSION,
              topicKey: topic.key,
              templateKey: topic.templateKey,
              catalogItemId:
                topic.catalogItem === "required"
                  ? "template-catalog-item"
                  : null,
              priceMode,
            };
            const result = renderArticlePlan(plan, templateFacts);
            expect(result.ok).toBe(true);
            if (!result.ok) continue;
            expect(result.draft.topicKey).toBe(topic.key);
            expect(result.draft.slug).toBe(topic.key);
            expect(result.draft.title.trim().length).toBeGreaterThan(0);
            expect(result.draft.excerpt.trim().length).toBeGreaterThan(0);
            expect(result.draft.bodyMarkdown.length).toBeGreaterThanOrEqual(
              ARTICLE_BODY_MIN_CHARS,
            );
            expect(result.draft.bodyMarkdown.length).toBeLessThanOrEqual(
              ARTICLE_BODY_MAX_CHARS,
            );
            expect(
              result.draft.bodyMarkdown.match(/^#{1,3}\s/gm)?.length ?? 0,
            ).toBeLessThanOrEqual(2);
            expect(result.draft.bodyMarkdown).not.toContain(
              "template-catalog-item",
            );
            if (topic.catalogItem === "required") {
              const publicText = Object.values(result.draft).join("\n");
              const canonicalName = "Unique ⟦Canonical⟧ Name";
              const formattedPrice = formatPrice(12.5, "EUR", locale);
              if (priceMode === "exact") {
                expect(publicText).not.toContain(canonicalName);
                expect(publicText.split(formattedPrice).length - 1).toBe(1);
                expect(result.draft.bodyMarkdown).toContain(formattedPrice);
              } else {
                expect(publicText).not.toContain(canonicalName);
                expect(publicText).not.toContain(formattedPrice);
              }
            }
            expect(checkRenderedArticleDraft(result.draft)).toEqual([]);
          }
        }
      }
    }
  });
});

describe("rendered article compatibility", () => {
  it("retains the existing bounded string shape", () => {
    const rendered = {
      topicKey: "seasonal-menu",
      slug: "seasonal-menu",
      title: "A factual title",
      excerpt: "A factual excerpt",
      bodyMarkdown: "A".repeat(ARTICLE_BODY_MIN_CHARS),
    };
    expect(checkRenderedArticleDraft(rendered)).toEqual([]);
    expect(
      checkRenderedArticleDraft({ ...rendered, slug: "Not A Slug" }),
    ).toContain('slug is not a URL-safe kebab-case label: "Not A Slug"');
  });

  it("fails closed when any final rendered field contains unsafe characters", () => {
    const rendered = {
      topicKey: "seasonal-menu",
      slug: "seasonal-menu",
      title: "A factual title",
      excerpt: "A factual excerpt",
      bodyMarkdown: "A".repeat(ARTICLE_BODY_MIN_CHARS),
    };

    for (const patch of [
      { title: "</script><script>alert(1)</script>" },
      { excerpt: "A\nsecond line" },
      { excerpt: "Ambiguous\u202e text" },
      {
        bodyMarkdown: `${"A".repeat(ARTICLE_BODY_MIN_CHARS)}<script>`,
      },
      {
        bodyMarkdown: `${"A".repeat(ARTICLE_BODY_MIN_CHARS)}\u0000`,
      },
    ]) {
      expect(checkRenderedArticleDraft({ ...rendered, ...patch }).length).toBeGreaterThan(0);
    }
  });
});

describe("articleFingerprint", () => {
  it("is stable and input-sensitive", () => {
    const one = articleFingerprint({ siteId: "a", batchId: "b", topicKey: "t" });
    expect(one).toBe(
      articleFingerprint({ siteId: "a", batchId: "b", topicKey: "t" }),
    );
    expect(one).not.toBe(
      articleFingerprint({ siteId: "a", batchId: "b2", topicKey: "t" }),
    );
  });
});

function deterministicCatalogNameFuzz(): string[] {
  let state = 0x130c0de;
  const codeUnits = [
    0x0000,
    0x000a,
    0x001f,
    0x0020,
    0x0026,
    0x003c,
    0x003e,
    0x005b,
    0x005d,
    0x007f,
    0x00a0,
    0x034f,
    0x061c,
    0x200b,
    0x200e,
    0x202e,
    0x2060,
    0x20ac,
    0x30af,
    0x4e2d,
    0xd800,
    0xdfff,
    0xff10,
    0xff25,
  ];
  const next = () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state;
  };

  return Array.from({ length: 64 }, () => {
    const length = next() % 33;
    return Array.from(
      { length },
      () => String.fromCharCode(codeUnits[next() % codeUnits.length]!),
    ).join("");
  });
}
