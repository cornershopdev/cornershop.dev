import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SiteRenderer } from "@/components/site-renderer";
import { deterministicDraft } from "@/lib/ai/site-generation";
import { localizeSiteDraft } from "@/lib/site-draft";
import {
  bindGeneratedFoodRetailDraftToEvidence,
  foodRetailConfig,
} from "@/lib/verticals/food-retail/config";
import { sampleFoodRetailDraft } from "@/lib/verticals/food-retail/fixtures";
import { foodRetailProviders } from "@/lib/verticals/food-retail/providers";
import { foodRetailSiteDraftSchema } from "@/lib/verticals/food-retail/schema";

describe("FOOD_RETAIL vertical", () => {
  it("keeps deterministic fallback content factual and empty", () => {
    const draft = deterministicDraft(
      {
        source: "Boulangerie du Coin",
        sourceUrl: null,
        sourceLocale: "fr",
        name: "Boulangerie du Coin",
        description: "",
        address: "",
        phone: "",
        heroImageUrl: null,
        pageText: "Boulangerie du Coin",
        links: [],
      },
      foodRetailConfig,
    );

    expect(draft.attributes).toEqual(foodRetailConfig.deterministicAttributes);
    /**
     * `toEqual` above is structural: it would still pass if the seeded
     * selection were nonsense, because both sides read the same config.
     * These two say what the seed has to mean — a shop with no evidence
     * still gets a profile, and its theme came from the scorer rather
     * than from a model or an owner.
     */
    expect(draft.attributes.designProfile).toBeDefined();
    expect(draft.attributes.themeSelection?.source).toBe("deterministic");
    expect(draft.catalogSections).toEqual([
      {
        name: "Gammes de produits",
        description:
          "Aucune gamme de produits n’était présente dans les données source structurées.",
        items: [],
      },
    ]);
    expect(draft.businessHours).toEqual([]);
    expect(draft.integrations).toEqual([]);
  });

  it("renders a sparse no-model French source without English or raw enum fallbacks", () => {
    const draft = deterministicDraft(
      {
        source: "Boulangerie des Amis",
        sourceUrl: "https://example.com/boulangerie",
        sourceLocale: "fr",
        name: "Boulangerie des Amis",
        description: "",
        address: "",
        phone: "",
        heroImageUrl: null,
        pageText: "Boulangerie des Amis",
        links: [],
      },
      foodRetailConfig,
    );
    const html = renderToStaticMarkup(
      <SiteRenderer draft={draft} vertical="FOOD_RETAIL" locale="fr" />,
    );

    expect(html).toContain("Aperçu privé du commerce alimentaire");
    expect(html).toContain("Gammes de produits");
    expect(html).toContain("Aucune gamme de produits");
    expect(html).not.toContain("Private food_retail preview");
    expect(html).not.toContain("private preview reconstructed");
    expect(html).not.toContain("Product ranges details");
  });

  it("keeps reconstructed products visible while preserving sourced and unknown stock", () => {
    const draft = deterministicDraft(
      {
        source: "https://example.com/bakery",
        sourceUrl: "https://example.com/bakery",
        sourceLocale: "en",
        name: "Evidence Bakery",
        description: "A source-backed local bakery product range.",
        address: "",
        phone: "",
        heroImageUrl: null,
        pageText: "Country loaf and rye loaf",
        links: [],
        catalogSections: [
          {
            name: "Breads",
            description: "",
            items: [
              {
                name: "Country loaf",
                description: "",
                price: null,
                currency: null,
                availability: null,
                imageUrl: null,
              },
              {
                name: "Rye loaf",
                description: "",
                price: null,
                currency: null,
                availability: false,
                availabilitySourceUrl: "https://example.com/bakery/breads",
                imageUrl: null,
              },
            ],
          },
        ],
      },
      foodRetailConfig,
    );

    expect(draft.catalogSections[0].items).toMatchObject([
      {
        available: null,
        attributes: { visible: true, stockSourceUrl: null },
      },
      {
        available: false,
        attributes: {
          visible: true,
          stockSourceUrl: "https://example.com/bakery/breads",
        },
      },
    ]);
    const markup = renderToStaticMarkup(
      <SiteRenderer draft={draft} vertical="FOOD_RETAIL" locale="en" />,
    );
    expect(markup).toContain("Country loaf");
    expect(markup).toContain("Rye loaf");
    expect(markup).not.toContain("In stock");
    expect(markup).toContain("Out of stock");
  });

  it("binds every model fact to deterministic crawl evidence", () => {
    const deterministic = deterministicDraft(
      {
        source: "Evidence Bakery",
        sourceUrl: "https://evidence.example/bakery",
        sourceLocale: "en",
        name: "Evidence Bakery",
        description: "A source-backed description of the local bakery.",
        address: "",
        phone: "",
        heroImageUrl: null,
        pageText: "Evidence Bakery",
        links: [],
      },
      foodRetailConfig,
    );
    const malicious = structuredClone(sampleFoodRetailDraft);
    malicious.name = "Invented Bakery";
    malicious.eyebrow = "Invented identity";
    malicious.description = "Invented canonical description";
    malicious.address = "Invented address";
    malicious.phone = "+1 555 INVENTED";
    malicious.email = "invented@attacker.example";
    malicious.sourceUrl = "https://attacker.example/source";
    malicious.sourceData = {
      navigation: [],
      brandAssets: [],
      evidence: [],
    };
    malicious.defaultLocale = "fr";
    malicious.attributes.pickupDetails = "Pickup in five minutes";
    malicious.businessHours = [{ days: "Every day", hours: "Always open" }];
    malicious.integrations = [
      {
        type: "ordering",
        label: "Invented order link",
        provider: null,
        url: "https://attacker.example/order",
        enabled: true,
        venueId: null,
      },
    ];
    const inventedItem = malicious.catalogSections[0].items[0];
    inventedItem.name = "Invented loaf";
    inventedItem.price = 99;
    inventedItem.available = true;
    inventedItem.attributes = {
      ...inventedItem.attributes,
      stockSourceUrl: "https://attacker.example/stock",
      seasonalAvailability: "Today only",
      preorderRequired: true,
      preorderNote: "Preorder now",
      allergens: ["invented allergen"],
      allergenSourceUrl: "https://attacker.example/allergens",
    };

    const bound = foodRetailSiteDraftSchema.parse(
      bindGeneratedFoodRetailDraftToEvidence({
        generated: malicious,
        deterministic,
      }),
    );

    expect(bound).toMatchObject({
      name: "Evidence Bakery",
      eyebrow: "Private food retail preview",
      description: "A source-backed description of the local bakery.",
      address: "",
      phone: "",
      email: "",
      sourceUrl: "https://evidence.example/bakery",
      defaultLocale: "en",
      attributes: { pickupDetails: "" },
      businessHours: [],
      integrations: [],
    });
    expect(bound.catalogSections).toEqual(deterministic.catalogSections);
    expect(JSON.stringify(bound)).not.toMatch(
      /Invented (?:Bakery|identity|canonical description|address|loaf)|99|Today only|Preorder now|invented allergen|attacker\.example/,
    );
  });

  it("preserves valid source-reconstructed products, prices, hours and links", () => {
    const sourceLink = {
      type: "ordering" as const,
      label: "Order from the shop",
      provider: null,
      url: "https://evidence.example/order",
      enabled: true,
      venueId: null,
    };
    const deterministic = deterministicDraft(
      {
        source: "https://evidence.example/bakery",
        sourceUrl: "https://evidence.example/bakery",
        sourceLocale: "en",
        name: "Evidence Bakery",
        description: "A source-backed description of the local bakery.",
        address: "1 Evidence Street",
        phone: "+356 2000 0000",
        heroImageUrl: null,
        pageText: "Country loaf €5, open Monday",
        links: [sourceLink],
        businessHours: [{ days: "Monday", hours: "08:00–16:00" }],
        catalogSections: [
          {
            name: "Bread",
            description: "",
            items: [
              {
                name: "Country loaf",
                description: "Naturally leavened bread.",
                price: 5,
                currency: "EUR",
                availability: null,
                imageUrl: null,
              },
            ],
          },
        ],
      },
      foodRetailConfig,
    );
    const generated = structuredClone(sampleFoodRetailDraft);
    const bound = foodRetailSiteDraftSchema.parse(
      bindGeneratedFoodRetailDraftToEvidence({ generated, deterministic }),
    );

    expect(bound).toMatchObject({
      name: "Evidence Bakery",
      description: "A source-backed description of the local bakery.",
      address: "1 Evidence Street",
      phone: "+356 2000 0000",
      defaultLocale: "en",
    });
    expect(bound.catalogSections).toEqual(deterministic.catalogSections);
    expect(bound.catalogSections[0].items[0]).toMatchObject({
      name: "Country loaf",
      price: 5,
      available: null,
      attributes: {
        seasonalAvailability: "",
        preorderRequired: null,
        preorderNote: "",
        allergens: [],
        allergenSourceUrl: null,
      },
    });
    expect(bound.businessHours).toEqual(deterministic.businessHours);
    expect(bound.integrations).toEqual([sourceLink]);
  });

  it("rejects allergen labels without attached source evidence", () => {
    const unsourced = structuredClone(sampleFoodRetailDraft);
    unsourced.catalogSections[0].items[0].attributes.allergenSourceUrl = null;

    expect(foodRetailSiteDraftSchema.safeParse(unsourced).success).toBe(false);
  });

  it("rejects restaurant booking links and unprovenanced product images", () => {
    const bookingDraft = {
      ...sampleFoodRetailDraft,
      integrations: sampleFoodRetailDraft.integrations.map(
        (integration, index) =>
          index === 0 ? { ...integration, type: "booking" } : integration,
      ),
    };
    expect(foodRetailSiteDraftSchema.safeParse(bookingDraft).success).toBe(
      false,
    );

    const imageDraft = structuredClone(sampleFoodRetailDraft);
    imageDraft.catalogSections[0].items[0].imageUrl =
      "https://example.com/product.jpg";
    imageDraft.catalogSections[0].items[0].imageProvenance = null;
    expect(foodRetailSiteDraftSchema.safeParse(imageDraft).success).toBe(false);
  });

  it("rejects source navigation destinations outside the authenticated source", () => {
    const draft = structuredClone(sampleFoodRetailDraft);
    draft.sourceData.navigation = [
      {
        label: "Order",
        url: "/order",
        destinationUrl: "https://attacker.example/phish",
      },
    ];

    const result = foodRetailSiteDraftSchema.safeParse(draft);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          message:
            "Source navigation destinations must match the authenticated source origin and intent",
        }),
      );
    }
  });

  it("preserves allergen evidence while localizing customer-facing labels", () => {
    const localized = localizeSiteDraft(sampleFoodRetailDraft, "fr");
    const firstItem = localized.catalogSections[0].items[0];

    expect(localized.attributes.pickupDetails).toContain("Commandez");
    expect(firstItem.name).toBe("Pain au levain de campagne");
    expect(firstItem.attributes.allergens).toEqual(["gluten"]);
    expect(firstItem.attributes.allergenSourceUrl).toBe(
      "https://example.com/maison-levain/allergens",
    );
  });

  it("rejects translated claims that are absent from the canonical source", () => {
    const adversarialDrafts = [
      (() => {
        const draft = structuredClone(sampleFoodRetailDraft);
        draft.attributes.pickupDetails = "";
        draft.translations[0].attributes.pickupDetails =
          "Retrait garanti en dix minutes";
        return draft;
      })(),
      (() => {
        const draft = structuredClone(sampleFoodRetailDraft);
        draft.catalogSections[0].items[0].attributes.seasonalAvailability = "";
        draft.translations[0].catalogSections[0].items[0].attributes.seasonalAvailability =
          "Disponible uniquement ce week-end";
        return draft;
      })(),
      (() => {
        const draft = structuredClone(sampleFoodRetailDraft);
        draft.catalogSections[0].items[0].attributes.preorderNote = "";
        draft.translations[0].catalogSections[0].items[0].attributes.preorderNote =
          "Précommande obligatoire";
        return draft;
      })(),
      (() => {
        const draft = structuredClone(sampleFoodRetailDraft);
        draft.translations[0].catalogSections[0].items[0].attributes.allergens.push(
          "fruits à coque",
        );
        return draft;
      })(),
    ];

    for (const draft of adversarialDrafts) {
      expect(() =>
        localizeSiteDraft(foodRetailSiteDraftSchema.parse(draft), "fr"),
      ).toThrow();
    }
  });

  it("registers commerce links but never booking providers", () => {
    expect(
      foodRetailProviders.some((provider) => provider.type === "ordering"),
    ).toBe(true);
    expect(
      foodRetailProviders.some((provider) => provider.type === "delivery"),
    ).toBe(true);
    expect(
      foodRetailProviders.some((provider) => provider.type === "booking"),
    ).toBe(false);
    expect(foodRetailConfig.prompt.extractionRules).toContain(
      "Do not create booking links",
    );
  });

  it("renders pickup and preorder conversion without reservations", () => {
    const html = renderToStaticMarkup(
      <SiteRenderer
        draft={sampleFoodRetailDraft}
        vertical="FOOD_RETAIL"
        locale="en"
      />,
    );

    expect(html).toContain("Preorder for pickup");
    expect(html).toContain("Order online for pickup");
    expect(html).toContain("Allergens: gluten");
    expect(html).toContain("Apricot season only");
    expect(html).not.toContain("Request a table");
    expect(html).not.toContain("Reservations");
    expect(html).not.toContain("booking-requests");
  });

  it("renders the sourced retail experience in French", () => {
    const html = renderToStaticMarkup(
      <SiteRenderer
        draft={localizeSiteDraft(sampleFoodRetailDraft, "fr")}
        vertical="FOOD_RETAIL"
        locale="fr"
      />,
    );

    expect(html).toContain("Commander pour retrait");
    expect(html).toContain("Retrait");
    expect(html).toContain("Allergènes: gluten");
    expect(html).toContain("Saison des abricots uniquement");
    expect(html).not.toContain("Réservations");
  });
});
