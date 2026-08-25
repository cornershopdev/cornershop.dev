import { describe, expect, it } from "bun:test";
import { Vertical } from "@/generated/prisma/enums";
import {
  buildSourceMonitoringDiff,
  parseSourceMonitoringSuggestionValue,
  SourceMonitoringUnsupportedSuggestionError,
} from "@/lib/source-monitoring-diff";
import { sampleSiteDraft } from "@/lib/restaurant";
import { sampleFoodRetailDraft } from "@/lib/verticals/food-retail/fixtures";
import { sampleLocalServiceSiteDraft } from "@/lib/verticals/local-service/fixtures";

describe("evidence-backed source diffs", () => {
  it("emits menu, contact, hours and link suggestions with evidence", () => {
    const current = draft();
    const proposed = {
      ...draft(),
      phone: "+356 9999 0000",
      businessHours: [{ days: "Monday-Friday", hours: "09:00-18:00" }],
      catalogSections: [
        {
          name: "Lunch",
          description: "",
          items: [
            {
              name: "New pasta",
              description: "Tomato",
              price: 18,
              currency: "EUR",
              available: true,
              attributes: {},
              imageUrl: null,
            },
          ],
        },
      ],
    };
    const result = buildSourceMonitoringDiff({
      current,
      proposed,
      extracted: {
        source: "example.com",
        sourceUrl: "https://example.com/",
        sourceLocale: "en",
        name: "Example",
        description: "",
        address: "",
        phone: "+356 9999 0000",
      heroImageUrl: null,
      photos: [],
        pageText:
          "Contact +356 9999 0000. Monday-Friday 09:00-18:00. Lunch: New pasta, Tomato, €18.",
        links: [
          {
            type: "booking",
            label: "Book",
            provider: "Provider",
            url: "https://book.example.com/",
          },
        ],
      },
      checkedLinks: [],
      capturedAt: new Date("2026-07-27T00:00:00.000Z"),
    });
    expect(result.map((entry) => entry.field).sort()).toEqual([
      "CONTACT",
      "HOURS",
      "LINKS",
      "MENU",
    ]);
    expect(result.every((entry) => entry.evidence.length > 0)).toBe(true);
    const links = result.find((entry) => entry.field === "LINKS");
    expect(links?.suggestedValue).toMatchObject({
      integrations: [
        {
          label: "Book",
          url: "https://book.example.com/",
          enabled: false,
          venueId: null,
        },
      ],
    });
  });

  it("drops AI-proposed facts that are absent from source evidence", () => {
    const current = draft();
    const result = buildSourceMonitoringDiff({
      current,
      proposed: {
        ...current,
        phone: "invented",
        businessHours: [{ days: "Sunday", hours: "24 hours" }],
        catalogSections: [
          {
            name: "Fantasy",
            description: "",
            items: [
              {
                name: "Imaginary dish",
                description: "",
                price: 99,
                currency: "EUR",
                available: true,
                attributes: {},
                imageUrl: null,
              },
            ],
          },
        ],
      },
      extracted: {
        source: "example.com",
        sourceUrl: "https://example.com/",
        sourceLocale: "en",
        name: "Example",
        description: "",
        address: "",
        phone: "",
      heroImageUrl: null,
      photos: [],
        pageText: "Welcome to Example",
        links: [],
      },
      checkedLinks: [],
      capturedAt: new Date(),
    });
    expect(result).toEqual([]);
  });
});

describe("lossless source-monitoring diffs", () => {
  it("does not implicitly enable newly discovered links", () => {
    const current = structuredClone(sampleSiteDraft);
    current.integrations = [
      {
        type: "booking",
        label: "Reserve",
        provider: "OpenTable",
        url: "https://www.opentable.com/r/osteria-luna",
        enabled: false,
        venueId: "rid-123",
      },
    ];
    const result = buildSourceMonitoringDiff({
      current,
      proposed: current,
      extracted: extractedSite({
        pageText: "Reserve at OpenTable or book with CoverManager.",
        links: [
          {
            type: "booking",
            label: "CoverManager",
            provider: "CoverManager",
            url: "https://book.covermanager.test/osteria",
          },
        ],
      }),
      checkedLinks: [
        {
          originalUrl: "https://www.opentable.com/r/osteria-luna",
          finalUrl: "https://www.opentable.com/r/osteria-luna-valletta",
          status: 200,
        },
      ],
      capturedAt: new Date("2026-08-25T00:00:00.000Z"),
    });
    const links = result.find((entry) => entry.field === "LINKS");
    expect(links?.suggestedValue).toEqual({
      integrations: [
        {
          type: "booking",
          label: "Reserve",
          provider: "OpenTable",
          url: "https://www.opentable.com/r/osteria-luna-valletta",
          enabled: false,
          venueId: "rid-123",
        },
        {
          type: "booking",
          label: "CoverManager",
          provider: "CoverManager",
          url: "https://book.covermanager.test/osteria",
          enabled: false,
          venueId: null,
        },
      ],
      translations: current.translations,
    });
  });

  it("preserves restaurant availability, dietary attributes, and translation structure", () => {
    const current = structuredClone(sampleSiteDraft);
    current.catalogSections = [
      {
        ...current.catalogSections[0],
        items: [current.catalogSections[0].items[0]],
      },
    ];
    const proposed = structuredClone(current);
    proposed.catalogSections[0].items[0] = {
      ...proposed.catalogSections[0].items[0],
      description: "Rosemary, sea salt, cultured butter, extra virgin oil",
      available: false,
      attributes: { dietaryLabels: ["vegan"] },
      imageUrl: null,
    };
    proposed.catalogSections[0].items.push({
      name: "Olives",
      description: "House marinated",
      price: 5,
      currency: "EUR",
      available: true,
      attributes: { dietaryLabels: [] },
      imageUrl: null,
    });
    const result = buildSourceMonitoringDiff({
      current,
      proposed,
      extracted: extractedSite({
        pageText:
          "To begin House focaccia Rosemary, sea salt, cultured butter, extra virgin oil. Olives House marinated.",
      }),
      checkedLinks: [],
      capturedAt: new Date("2026-08-25T00:00:00.000Z"),
    });
    const menu = result.find((entry) => entry.field === "MENU");
    const suggested = menu?.suggestedValue as {
      catalogSections: typeof current.catalogSections;
    };
    expect(suggested.catalogSections[0].items[0]).toMatchObject({
      name: "House focaccia",
      description: "Rosemary, sea salt, cultured butter, extra virgin oil",
      available: current.catalogSections[0].items[0].available,
      attributes: current.catalogSections[0].items[0].attributes,
    });
    expect(suggested.catalogSections[0].items.at(-1)).toMatchObject({
      name: "Olives",
      available: true,
    });
  });

  it("preserves food-retail tri-state stock and item attributes across catalog suggestions", () => {
    const current = structuredClone(sampleFoodRetailDraft);
    const proposed = structuredClone(current);
    proposed.catalogSections[0].items[0] = {
      ...proposed.catalogSections[0].items[0],
      description: "Natural starter, wheat flour and a longer ferment.",
      available: false,
      attributes: {
        ...proposed.catalogSections[0].items[0].attributes,
        visible: false,
        stockSourceUrl: null,
        allergens: [],
        allergenSourceUrl: null,
      },
    };
    proposed.catalogSections[1].items[0] = {
      ...proposed.catalogSections[1].items[0],
      available: true,
      attributes: {
        ...proposed.catalogSections[1].items[0].attributes,
        seasonalAvailability: "invented",
      },
    };
    const result = buildSourceMonitoringDiff({
      current,
      proposed,
      extracted: extractedSite({
        pageText:
          "Daily breads Country sourdough Natural starter, wheat flour and a longer ferment. Weekend counter Apricot tart Available during apricot season.",
      }),
      checkedLinks: [],
      capturedAt: new Date("2026-08-25T00:00:00.000Z"),
    });
    const menu = result.find((entry) => entry.field === "MENU");
    const suggested = menu?.suggestedValue as {
      catalogSections: typeof current.catalogSections;
      translations: typeof current.translations;
    };
    expect(suggested.catalogSections[0].items[0]).toMatchObject({
      description: "Natural starter, wheat flour and a longer ferment.",
      available: true,
      attributes: current.catalogSections[0].items[0].attributes,
    });
    expect(suggested.catalogSections[1].items[0]).toMatchObject({
      available: null,
      attributes: current.catalogSections[1].items[0].attributes,
    });
    expect(suggested.translations[0]?.catalogSections).toHaveLength(
      current.translations[0].catalogSections.length,
    );
  });

  it("preserves local-service pricing attributes and does not invent public quote links", () => {
    const current = structuredClone(sampleLocalServiceSiteDraft);
    const proposed = structuredClone(current);
    proposed.catalogSections[0].items[0] = {
      ...proposed.catalogSections[0].items[0],
      description: "Diagnosis and repair for tripping circuits and failed sockets.",
      attributes: {
        pricingModel: "hourly",
        priceUnit: "per hour",
        emergencyEligible: false,
      },
    };
    const result = buildSourceMonitoringDiff({
      current,
      proposed,
      extracted: extractedSite({
        pageText:
          "Electrical work Fault finding and repairs Diagnosis and repair for tripping circuits and failed sockets. Rewires and upgrades.",
        links: [
          {
            type: "quote",
            label: "New quote form",
            provider: "Harbour quotes",
            url: "https://harbour-electrical.example/new-quote",
          },
        ],
      }),
      checkedLinks: [],
      capturedAt: new Date("2026-08-25T00:00:00.000Z"),
    });
    const menu = result.find((entry) => entry.field === "MENU");
    const suggestedMenu = menu?.suggestedValue as {
      catalogSections: typeof current.catalogSections;
    };
    expect(suggestedMenu.catalogSections[0].items[0]).toMatchObject({
      description:
        "Diagnosis and repair for tripping circuits and failed sockets.",
      available: true,
      attributes: {
        pricingModel: "quote",
        priceUnit: "",
        emergencyEligible: true,
      },
    });
    const links = result.find((entry) => entry.field === "LINKS");
    const suggestedLinks = links?.suggestedValue as {
      integrations: typeof current.integrations;
    };
    expect(
      suggestedLinks.integrations.map((link) => ({
        url: link.url,
        enabled: link.enabled,
        provider: link.provider,
      })),
    ).toEqual([
      {
        url: "https://wa.me/35679991122",
        enabled: true,
        provider: "WhatsApp",
      },
      {
        url: "https://harbour-electrical.example/quote",
        enabled: true,
        provider: "Existing quote form",
      },
      {
        url: "https://harbour-electrical.example/new-quote",
        enabled: false,
        provider: "Harbour quotes",
      },
    ]);
  });
});

describe("unsupported source-monitoring suggestion shapes", () => {
  it("fails closed when a discovered link omits the visibility decision", () => {
    expect(() =>
      parseSourceMonitoringSuggestionValue(
        "LINKS",
        {
          integrations: [
            {
              type: "booking",
              label: "Book",
              provider: "CoverManager",
              url: "https://book.covermanager.test/osteria",
              venueId: null,
            },
          ],
          translations: [],
        },
        sampleSiteDraft,
        Vertical.RESTAURANT,
      ),
    ).toThrow(SourceMonitoringUnsupportedSuggestionError);
  });

  it("fails closed when food-retail is given a restaurant booking link", () => {
    expect(() =>
      parseSourceMonitoringSuggestionValue(
        "LINKS",
        {
          integrations: [
            {
              type: "booking",
              label: "Book a table",
              provider: "OpenTable",
              url: "https://www.opentable.com/r/bakery",
              enabled: false,
              venueId: null,
            },
          ],
          translations: sampleFoodRetailDraft.translations.map(
            (translation) => ({
              ...translation,
              integrationLabels: ["Book a table"],
            }),
          ),
        },
        sampleFoodRetailDraft,
        Vertical.FOOD_RETAIL,
      ),
    ).toThrow(SourceMonitoringUnsupportedSuggestionError);
  });

  it("fails closed when food-retail stock is claimed without source evidence", () => {
    const invalid = structuredClone(sampleFoodRetailDraft);
    invalid.catalogSections[1].items[0].available = true;
    expect(() =>
      parseSourceMonitoringSuggestionValue(
        "MENU",
        {
          catalogSections: invalid.catalogSections,
          translations: invalid.translations,
        },
        sampleFoodRetailDraft,
        Vertical.FOOD_RETAIL,
      ),
    ).toThrow(SourceMonitoringUnsupportedSuggestionError);
  });

  it("fails closed on extra suggestion keys instead of dropping them", () => {
    expect(() =>
      parseSourceMonitoringSuggestionValue(
        "CONTACT",
        {
          address: "1 Harbour Street",
          phone: "+356 7999 1122",
          published: true,
        },
        sampleLocalServiceSiteDraft,
        Vertical.LOCAL_SERVICE,
      ),
    ).toThrow(/Nothing was saved to the private draft/);
  });

  it("accepts an explicit disabled discovered link for each owner-review vertical", () => {
    expect(
      parseSourceMonitoringSuggestionValue(
        "LINKS",
        {
          integrations: [
            ...sampleSiteDraft.integrations,
            {
              type: "social",
              label: "Instagram",
              provider: "Instagram",
              url: "https://www.instagram.com/osterialuna/",
              enabled: false,
              venueId: null,
            },
          ],
          translations: sampleSiteDraft.translations,
        },
        sampleSiteDraft,
        Vertical.RESTAURANT,
      ),
    ).toMatchObject({
      integrations: expect.arrayContaining([
        expect.objectContaining({
          url: "https://www.instagram.com/osterialuna/",
          enabled: false,
        }),
      ]),
    });
    expect(
      parseSourceMonitoringSuggestionValue(
        "LINKS",
        {
          integrations: [
            ...sampleFoodRetailDraft.integrations,
            {
              type: "delivery",
              label: "Delivery",
              provider: "Existing delivery",
              url: "https://maison-levain.example/delivery",
              enabled: false,
              venueId: null,
            },
          ],
          translations: sampleFoodRetailDraft.translations.map(
            (translation) => ({
              ...translation,
              integrationLabels: [
                ...translation.integrationLabels,
                "Delivery",
              ],
            }),
          ),
        },
        sampleFoodRetailDraft,
        Vertical.FOOD_RETAIL,
      ),
    ).toMatchObject({
      integrations: expect.arrayContaining([
        expect.objectContaining({ enabled: false, type: "delivery" }),
      ]),
    });
    expect(
      parseSourceMonitoringSuggestionValue(
        "CONTACT",
        { address: "Valletta waterfront", phone: "+356 7999 1122" },
        sampleLocalServiceSiteDraft,
        Vertical.LOCAL_SERVICE,
      ),
    ).toEqual({ address: "Valletta waterfront", phone: "+356 7999 1122" });
  });
});

function extractedSite(input: {
  pageText: string;
  links?: Array<{
    type: "booking" | "ordering" | "delivery" | "social" | "quote" | "contact";
    label: string;
    provider: string | null;
    url: string;
  }>;
}) {
  return {
    source: "source.test",
    sourceUrl: "https://source.test/",
    sourceLocale: "en",
    name: "Source",
    description: "",
    address: "",
    phone: "",
    heroImageUrl: null,
    photos: [],
    pageText: input.pageText,
    links: input.links ?? [],
  };
}

function draft() {
  return {
    slug: "example",
    name: "Example",
    eyebrow: "",
    description: "A sufficiently long example business description.",
    address: "",
    phone: "",
    sourceUrl: "https://example.com/",
    heroImageUrl: null,
    palette: { background: "#fff", foreground: "#000", accent: "#f00" },
    attributes: {},
    autoEnhanceImages: false,
    defaultLocale: "en",
    businessHours: [],
    translations: [],
    catalogSections: [
      {
        name: "Menu",
        description: "",
        items: [],
      },
    ],
    integrations: [],
  };
}
