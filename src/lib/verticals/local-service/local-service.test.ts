import { describe, expect, it } from "bun:test";
import { deterministicDraft } from "@/lib/ai/site-generation";
import {
  bindGeneratedLocalServiceDraftToEvidence,
  localServiceConfig,
} from "@/lib/verticals/local-service/config";
import { sampleLocalServiceSiteDraft } from "@/lib/verticals/local-service/fixtures";
import {
  localServiceAttributesSchema,
  localServiceSiteDraftSchema,
} from "@/lib/verticals/local-service/schema";

describe("local-service vertical", () => {
  it("ships a complete fixture through the production draft schema", () => {
    expect(localServiceSiteDraftSchema.parse(sampleLocalServiceSiteDraft)).toEqual(
      sampleLocalServiceSiteDraft,
    );
    expect(sampleLocalServiceSiteDraft.attributes.tradeType).toBe("electrician");
    expect(sampleLocalServiceSiteDraft.integrations.map(({ type }) => type)).toEqual([
      "contact",
      "quote",
    ]);
  });

  it("bounds reusable trust, coverage and project fields", () => {
    expect(
      localServiceAttributesSchema.safeParse({
        ...localServiceConfig.attributeDefaults,
        serviceAreas: Array.from({ length: 25 }, (_, index) => `Area ${index}`),
      }).success,
    ).toBe(false);
    expect(
      localServiceAttributesSchema.safeParse({
        ...localServiceConfig.attributeDefaults,
        credentials: [{ name: "" }],
      }).success,
    ).toBe(false);
    expect(
      localServiceAttributesSchema.safeParse({
        ...localServiceConfig.attributeDefaults,
        projects: [{ title: "Claimed project", imageUrl: "javascript:alert(1)" }],
      }).success,
    ).toBe(false);
    expect(
      localServiceAttributesSchema.safeParse({
        ...localServiceConfig.attributeDefaults,
        projects: [
          {
            title: "Claimed project",
            imageUrl: "https://assets.example/rewire.jpg",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("keeps availability, insurance and price posture unstated by default", () => {
    expect(localServiceConfig.attributeDefaults).toMatchObject({
      availabilityPosture: "not-stated",
      insuranceStatus: "not-stated",
      credentials: [],
      trustSignals: [],
      projects: [],
    });
    expect(localServiceConfig.itemAttributeDefaults).toEqual({
      pricingModel: "not-stated",
      priceUnit: "",
      emergencyEligible: false,
    });
  });

  it("localizes quote, from, hourly and emergency item badges in French", () => {
    const badges = localServiceConfig.presentation.itemBadges;
    expect(
      badges?.(
        { pricingModel: "quote", priceUnit: "", emergencyEligible: false },
        "fr",
      ),
    ).toEqual(["Devis requis"]);
    expect(
      badges?.(
        { pricingModel: "from", priceUnit: "", emergencyEligible: false },
        "fr",
      ),
    ).toEqual(["À partir de"]);
    expect(
      badges?.(
        { pricingModel: "hourly", priceUnit: "", emergencyEligible: false },
        "fr",
      ),
    ).toEqual(["Tarif horaire"]);
    expect(
      badges?.(
        { pricingModel: "not-stated", priceUnit: "", emergencyEligible: true },
        "fr",
      ),
    ).toEqual(["Intervention d’urgence"]);
  });

  it("classifies external quote and WhatsApp providers without embeds", () => {
    expect(
      localServiceConfig.providers.find(({ name }) => name === "WhatsApp"),
    ).toMatchObject({ type: "contact" });
    expect(
      localServiceConfig.providers.find(({ name }) => name === "Jobber"),
    ).toMatchObject({ type: "quote" });
    expect(localServiceConfig.providers.some(({ embed }) => embed)).toBe(false);
    expect(
      localServiceConfig.crawl.linkKeywordHints.find(
        ({ type }) => type === "quote",
      )?.pattern.test("Demander un devis"),
    ).toBe(true);
    expect(
      localServiceConfig.crawl.linkKeywordHints.find(
        ({ type }) => type === "booking",
      )?.pattern.test("Prendre rendez-vous"),
    ).toBe(true);
    expect(localServiceConfig.crawl.relevantPathPattern.test("/realisations"))
      .toBe(true);
    expect(localServiceConfig.crawl.relevantPathPattern.test("/depannage"))
      .toBe(true);
  });

  it("removes malicious model-authored operational and trust claims from a sparse source", () => {
    const deterministic = deterministicDraft(
      {
        source: "Atelier Source",
        sourceUrl: "https://atelier-source.example/",
        businessTypes: ["Plumber"],
        sourceLocale: "fr",
        name: "Atelier Source",
        description:
          "Une entreprise locale reconstruite uniquement à partir des éléments disponibles.",
        address: "",
        phone: "",
        email: "",
        businessHours: [],
        logoUrl: null,
        faviconUrl: null,
        heroImageUrl: null,
        palette: null,
        navigation: [],
        catalogSections: [],
        brandAssets: [],
        evidence: [],
        pageText: "Atelier Source",
        links: [],
      },
      localServiceConfig,
    );
    const malicious = structuredClone(sampleLocalServiceSiteDraft);
    malicious.slug = "model-slug";
    malicious.name = "Licensed 24/7 Master Plumber";
    malicious.eyebrow = "Fully insured emergency response";
    malicious.description =
      "Invented same-day coverage, guarantees and project outcomes supplied only by the model.";
    malicious.address = "99 Invented Street";
    malicious.phone = "+33 9 99 99 99 99";
    malicious.email = "invented@example.com";
    malicious.defaultLocale = "en";
    malicious.businessHours = [{ days: "Every day", hours: "00:00–24:00" }];
    malicious.attributes = {
      tradeType: "plumber",
      availabilityPosture: "24-7-emergency",
      serviceAreas: ["All of France"],
      credentials: [{ name: "Master licence", issuer: "Invented board", reference: "FAKE-1" }],
      insuranceStatus: "insured",
      insuranceDetail: "€10m liability cover",
      trustSignals: [{ label: "Guaranteed", detail: "Lifetime guarantee" }],
      projects: [{ title: "Hospital refit", description: "Completed safely", imageUrl: null, location: "Paris" }],
      showProjectGallery: true,
    };
    malicious.catalogSections = [{
      name: "Emergency services",
      description: "Invented services",
      items: [{
        name: "24/7 emergency callout",
        description: "Guaranteed arrival in thirty minutes.",
        price: 25,
        currency: "EUR",
        available: true,
        imageUrl: null,
        attributes: {
          pricingModel: "fixed",
          priceUnit: "per callout",
          emergencyEligible: true,
        },
      }],
    }];
    malicious.integrations = [{
      type: "quote",
      label: "Instant guaranteed quote",
      provider: null,
      url: "https://invented.example/quote",
      enabled: true,
      venueId: null,
    }];
    malicious.translations = [{
      locale: "fr",
      eyebrow: "Urgence garantie",
      description: "Des affirmations inventées par le modèle sans aucune preuve source.",
      attributes: {},
      catalogSections: [{
        name: "Urgences",
        description: "Services inventés",
        items: [{
          name: "Urgence 24h/24",
          description: "Arrivée garantie en trente minutes.",
          attributes: {},
        }],
      }],
      integrationLabels: ["Devis immédiat"],
    }];

    const bound = localServiceSiteDraftSchema.parse(
      bindGeneratedLocalServiceDraftToEvidence({
        generated: malicious,
        deterministic,
      }),
    );

    expect(bound).toEqual(deterministic);
    expect(bound.attributes).toMatchObject({
      tradeType: "plumber",
      availabilityPosture: "not-stated",
      serviceAreas: [],
      credentials: [],
      insuranceStatus: "not-stated",
      trustSignals: [],
      projects: [],
      showProjectGallery: false,
    });
    expect(bound.businessHours).toEqual([]);
    expect(bound.catalogSections).toEqual([
      {
        name: "Services",
        description:
          "Aucun service n’était présent dans les données source structurées.",
        items: [],
      },
    ]);
    expect(bound.integrations).toEqual([]);
    expect(bound.translations).toEqual([]);
  });

  it("drops a malformed source amount when its currency is absent", () => {
    const draft = deterministicDraft(
      {
        source: "Malformed price source",
        sourceUrl: "https://malformed-price.example/",
        sourceLocale: "en",
        name: "Malformed price source",
        description: "A sparse source with an amount but no supported currency.",
        address: "",
        phone: "",
        email: "",
        businessHours: [],
        heroImageUrl: null,
        pageText: "Malformed price source",
        links: [],
        catalogSections: [
          {
            name: "Services",
            description: "",
            items: [
              {
                name: "Unqualified amount",
                description: "",
                price: 95,
                currency: null,
                availability: null,
                imageUrl: null,
              },
            ],
          },
        ],
      },
      localServiceConfig,
    );

    expect(draft.catalogSections[0]?.items[0]).toMatchObject({
      price: null,
      attributes: { pricingModel: "not-stated" },
    });
  });
});
