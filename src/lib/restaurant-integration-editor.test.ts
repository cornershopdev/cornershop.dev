import { describe, expect, it } from "bun:test";
import {
  restaurantDraftSchema,
  sampleRestaurant,
} from "@/lib/restaurant";
import {
  applyRestaurantIntegrationMutation,
  integrationPlacement,
  validateRestaurantIntegrations,
} from "@/lib/restaurant-integration-editor";

function multilingualDraft() {
  return restaurantDraftSchema.parse({
    ...sampleRestaurant,
    defaultLocale: "fr",
    translations: [
      {
        locale: "en",
        status: "current",
        cuisine: sampleRestaurant.cuisine,
        eyebrow: sampleRestaurant.eyebrow,
        description: sampleRestaurant.description,
        menuSections: sampleRestaurant.menuSections.map((section) => ({
          name: section.name,
          description: section.description,
          items: section.items.map((item) => ({
            name: item.name,
            description: item.description,
            dietaryLabels: item.dietaryLabels,
          })),
        })),
        integrationLabels: sampleRestaurant.integrations.map(
          (integration) => integration.label,
        ),
      },
    ],
  });
}

describe("restaurant integration editor", () => {
  it("keeps localized labels aligned through add, reorder and removal", () => {
    let draft = multilingualDraft();
    draft = applyRestaurantIntegrationMutation(draft, {
      type: "add",
      integrationType: "delivery",
    });
    draft = applyRestaurantIntegrationMutation(draft, {
      type: "update",
      integrationIndex: 2,
      changes: {
        label: "Deliver dinner",
        url: "https://deliveroo.com/menu/valletta/osteria-luna",
      },
    });
    draft = applyRestaurantIntegrationMutation(draft, {
      type: "move",
      integrationIndex: 2,
      direction: -1,
    });
    draft = applyRestaurantIntegrationMutation(draft, {
      type: "remove",
      integrationIndex: 0,
    });

    expect(restaurantDraftSchema.parse(draft)).toEqual(draft);
    expect(draft.translations[0].status).toBe("stale");
    expect(draft.translations[0].integrationLabels).toHaveLength(
      draft.integrations.length,
    );
    expect(draft.integrations[0]).toMatchObject({
      provider: "Deliveroo",
      type: "delivery",
    });
  });

  it("keeps disabled links recoverable without making translations stale", () => {
    const draft = multilingualDraft();
    const disabled = applyRestaurantIntegrationMutation(draft, {
      type: "update",
      integrationIndex: 0,
      changes: { enabled: false },
    });

    expect(disabled.integrations[0].enabled).toBe(false);
    expect(disabled.translations[0].status).toBe("current");
    expect(disabled.integrations[0]).toMatchObject({
      type: draft.integrations[0].type,
      label: draft.integrations[0].label,
      provider: draft.integrations[0].provider,
      url: draft.integrations[0].url,
    });
  });

  it("rejects unsafe URLs, provider impersonation and unapproved social links", () => {
    const unsafeUrls = [
      "http://instagram.com/osteria",
      "https://user:secret@instagram.com/osteria",
      "https://localhost/restaurant",
      "https://127.0.0.1/restaurant",
      "https://instagram.com:8443/osteria",
      "https://example.com",
      "https://www.example.org/order",
    ];
    for (const url of unsafeUrls) {
      const draft = {
        ...sampleRestaurant,
        integrations: [
          {
            type: "social" as const,
            label: "Follow us",
            provider: "Instagram",
            url,
            enabled: true,
            venueId: null,
          },
        ],
      };
      expect(validateRestaurantIntegrations(draft).length).toBeGreaterThan(0);
    }

    const impersonated = {
      ...sampleRestaurant,
      integrations: [
        {
          type: "booking" as const,
          label: "Book",
          provider: "OpenTable",
          url: "https://restaurant.example/reservations",
          enabled: true,
          venueId: null,
        },
      ],
    };
    const unapprovedSocial = {
      ...sampleRestaurant,
      integrations: [
        {
          type: "social" as const,
          label: "Follow",
          provider: null,
          url: "https://social.example/osteria",
          enabled: true,
          venueId: null,
        },
      ],
    };
    const deceptiveSocial = {
      ...sampleRestaurant,
      integrations: [
        {
          type: "social" as const,
          label: "Follow",
          provider: "Instagram",
          url: "https://instagram.com.attacker.example/osteria",
          enabled: true,
          venueId: null,
        },
      ],
    };
    expect(validateRestaurantIntegrations(impersonated)).not.toEqual([]);
    expect(validateRestaurantIntegrations(unapprovedSocial)).not.toEqual([]);
    expect(validateRestaurantIntegrations(deceptiveSocial)).not.toEqual([]);
  });

  it("normalizes provider identity from the hostname and previews placement", () => {
    const parsed = restaurantDraftSchema.parse({
      ...sampleRestaurant,
      integrations: [
        {
          type: "booking",
          label: "Reserve",
          provider: null,
          url: "https://www.opentable.com/r/osteria-luna",
          enabled: true,
        },
      ],
    });

    expect(parsed.integrations[0].provider).toBe("OpenTable");
    expect(integrationPlacement("booking").regions).toEqual([
      "header",
      "content",
    ]);
    expect(integrationPlacement("social").regions).toEqual(["footer"]);
  });
});
