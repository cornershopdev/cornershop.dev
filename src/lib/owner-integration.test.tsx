import { describe, expect, it, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/navigation", () => ({
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    refresh: () => {},
    back: () => {},
    prefetch: () => {},
  }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));

import { FoodRetailDashboard } from "@/app/dashboard/food-retail-dashboard";
import { LocalServiceDashboard } from "@/app/dashboard/local-service-dashboard";
import { Dashboard } from "@/app/dashboard/dashboard";
import { buildEmptyAnalyticsSummary } from "@/lib/analytics-contract";
import { FACTORY_BRAND } from "@/lib/brand";
import {
  applyRestaurantIntegrationMutation,
  validateRestaurantIntegrations,
} from "@/lib/restaurant-integration-editor";
import { restaurantDraftSchema, sampleRestaurant } from "@/lib/restaurant";
import {
  canEnableOwnerIntegration,
  createOwnerIntegration,
  defaultOwnerIntegrationLabel,
  formatOwnerDraftIssues,
  mergeOwnerDraftIssues,
  OWNER_INTEGRATION_BLANK_MESSAGE,
  OWNER_INTEGRATION_ENABLE_MESSAGE,
  OWNER_INTEGRATION_PLACEHOLDER_MESSAGE,
  OWNER_INTEGRATION_SCHEME_MESSAGE,
  ownerIntegrationFieldPath,
  ownerIntegrationIssueMessage,
  validateOwnerIntegrationUrl,
  validateOwnerIntegrations,
  withOwnerIntegrationEnabled,
  withOwnerIntegrationUrl,
} from "@/lib/owner-integration";
import { sampleFoodRetailDraft } from "@/lib/verticals/food-retail/fixtures";
import {
  foodRetailIntegrationSchema,
  foodRetailSiteDraftSchema,
} from "@/lib/verticals/food-retail/schema";
import { sampleLocalServiceSiteDraft } from "@/lib/verticals/local-service/fixtures";
import {
  localServiceIntegrationSchema,
  localServiceSiteDraftSchema,
} from "@/lib/verticals/local-service/schema";
import { restaurantIntegrationSchema } from "@/lib/verticals/restaurant/schema";

const dashboardPage = await Bun.file(
  new URL("../app/dashboard/page.tsx", import.meta.url),
).text();
const foodRetailDashboardSource = await Bun.file(
  new URL("../app/dashboard/food-retail-dashboard.tsx", import.meta.url),
).text();
const localServiceDashboardSource = await Bun.file(
  new URL("../app/dashboard/local-service-dashboard.tsx", import.meta.url),
).text();
const restaurantIntegrationEditorSource = await Bun.file(
  new URL("./restaurant-integration-editor.ts", import.meta.url),
).text();

describe("owner integration factory", () => {
  it("starts every vertical's new row blank and hidden until a URL is entered", () => {
    const created = [
      createOwnerIntegration({ type: "ordering" }),
      createOwnerIntegration({ type: "quote" }),
      createOwnerIntegration({ type: "booking" }),
    ];

    for (const integration of created) {
      expect(integration).toMatchObject({
        url: "",
        enabled: false,
        provider: null,
        venueId: null,
      });
      expect(foodRetailIntegrationSchema.safeParse(integration).success).toBe(
        false,
      );
      expect(localServiceIntegrationSchema.safeParse(integration).success).toBe(
        false,
      );
      expect(restaurantIntegrationSchema.safeParse(integration).success).toBe(
        false,
      );
      expect(canEnableOwnerIntegration(integration.url)).toBe(false);
    }

    expect(created[0].label).toBe(defaultOwnerIntegrationLabel("ordering"));
    expect(created[1].label).toBe("Request a quote");
    expect(created[2].label).toBe("Book a table");
  });

  it("rejects blank links, placeholder domains and invalid schemes on the url field", () => {
    expect(validateOwnerIntegrationUrl("")).toBe(
      OWNER_INTEGRATION_BLANK_MESSAGE,
    );
    expect(validateOwnerIntegrationUrl("   ")).toBe(
      OWNER_INTEGRATION_BLANK_MESSAGE,
    );
    expect(validateOwnerIntegrationUrl("https://example.com")).toBe(
      OWNER_INTEGRATION_PLACEHOLDER_MESSAGE,
    );
    expect(validateOwnerIntegrationUrl("https://www.example.com/order")).toBe(
      OWNER_INTEGRATION_PLACEHOLDER_MESSAGE,
    );
    expect(validateOwnerIntegrationUrl("https://shop.example.net/quote")).toBe(
      OWNER_INTEGRATION_PLACEHOLDER_MESSAGE,
    );
    expect(validateOwnerIntegrationUrl("http://orders.maison-levain.example")).toBe(
      OWNER_INTEGRATION_SCHEME_MESSAGE,
    );
    expect(validateOwnerIntegrationUrl("ftp://orders.maison-levain.example")).toBe(
      OWNER_INTEGRATION_SCHEME_MESSAGE,
    );
    expect(validateOwnerIntegrationUrl("javascript:alert(1)")).not.toBeNull();

    const issues = validateOwnerIntegrations([
      createOwnerIntegration({ type: "quote" }),
      {
        ...createOwnerIntegration({ type: "ordering" }),
        url: "https://example.com",
        enabled: true,
      },
    ]);
    expect(issues).toEqual(
      expect.arrayContaining([
        {
          path: ownerIntegrationFieldPath(0, "url"),
          message: OWNER_INTEGRATION_BLANK_MESSAGE,
        },
        {
          path: ownerIntegrationFieldPath(1, "url"),
          message: OWNER_INTEGRATION_PLACEHOLDER_MESSAGE,
        },
        {
          path: ownerIntegrationFieldPath(1, "enabled"),
          message: OWNER_INTEGRATION_ENABLE_MESSAGE,
        },
      ]),
    );
    expect(
      ownerIntegrationIssueMessage(issues, ownerIntegrationFieldPath(1, "url")),
    ).toBe(OWNER_INTEGRATION_PLACEHOLDER_MESSAGE);
  });

  it("allows enable only after an allowed HTTPS URL is present", () => {
    const blank = createOwnerIntegration({ type: "quote" });
    expect(withOwnerIntegrationEnabled(blank, true).enabled).toBe(false);

    const filled = withOwnerIntegrationUrl(
      blank,
      "https://harbour-electrical.example/quote",
    );
    expect(filled).toMatchObject({
      url: "https://harbour-electrical.example/quote",
      enabled: false,
    });
    expect(canEnableOwnerIntegration(filled.url)).toBe(true);

    const enabled = withOwnerIntegrationEnabled(filled, true);
    expect(enabled.enabled).toBe(true);

    const placeholder = withOwnerIntegrationUrl(
      enabled,
      "https://example.org/quote",
    );
    expect(placeholder.enabled).toBe(false);
    expect(
      foodRetailIntegrationSchema.safeParse({
        ...enabled,
        type: "ordering",
      }).success,
    ).toBe(true);
    expect(
      foodRetailIntegrationSchema.safeParse({
        ...placeholder,
        type: "ordering",
      }).success,
    ).toBe(false);
  });

  it("keeps other edits when formatting the exact invalid link field", () => {
    const issues = mergeOwnerDraftIssues(
      validateOwnerIntegrations([
        {
          url: "https://example.com",
          enabled: false,
        },
      ]),
      [
        {
          path: "name",
          message: "Too short",
        },
        {
          path: ownerIntegrationFieldPath(0, "url"),
          message: "Duplicate schema message",
        },
      ],
    );

    expect(formatOwnerDraftIssues(issues)).toBe(
      `${ownerIntegrationFieldPath(0, "url")}: ${OWNER_INTEGRATION_PLACEHOLDER_MESSAGE} · name: Too short`,
    );
  });
});

describe("owner integration schema and editor wiring", () => {
  it("rejects placeholder domains from persisted customer integrations", () => {
    const placeholder = {
      type: "ordering" as const,
      label: "Order online",
      provider: null,
      url: "https://example.com",
      enabled: true,
      venueId: null,
    };
    expect(foodRetailIntegrationSchema.safeParse(placeholder).success).toBe(
      false,
    );
    expect(localServiceIntegrationSchema.safeParse({
      ...placeholder,
      type: "quote",
    }).success).toBe(false);
    expect(restaurantIntegrationSchema.safeParse({
      ...placeholder,
      type: "ordering",
    }).success).toBe(false);
  });

  it("keeps imported customer links that already use a real HTTPS host", () => {
    expect(
      foodRetailSiteDraftSchema.parse(sampleFoodRetailDraft).integrations[0],
    ).toMatchObject({
      url: "https://maison-levain.example/order",
      enabled: true,
    });
    expect(
      localServiceSiteDraftSchema.parse(sampleLocalServiceSiteDraft)
        .integrations[1],
    ).toMatchObject({
      url: "https://harbour-electrical.example/quote",
      enabled: true,
    });
  });

  it("adds restaurant rows through the shared factory", () => {
    const draft = applyRestaurantIntegrationMutation(sampleRestaurant, {
      type: "add",
      integrationType: "delivery",
    });
    const created = draft.integrations.at(-1);

    expect(created).toMatchObject({
      type: "delivery",
      label: "Get delivery",
      url: "",
      enabled: false,
      provider: null,
    });
    expect(validateRestaurantIntegrations(draft)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ownerIntegrationFieldPath(draft.integrations.length - 1, "url"),
        }),
      ]),
    );

    const filled = applyRestaurantIntegrationMutation(draft, {
      type: "update",
      integrationIndex: draft.integrations.length - 1,
      changes: {
        url: "https://deliveroo.com/menu/valletta/osteria-luna",
        enabled: true,
      },
    });
    expect(filled.integrations.at(-1)).toMatchObject({
      url: "https://deliveroo.com/menu/valletta/osteria-luna",
      enabled: true,
      provider: "Deliveroo",
    });
    expect(restaurantDraftSchema.parse(filled)).toEqual(filled);
  });

  it("wires food-retail and local-service dashboards to the shared factory", () => {
    expect(foodRetailDashboardSource).toContain("createOwnerIntegration");
    expect(foodRetailDashboardSource).not.toContain('url: ""');
    expect(localServiceDashboardSource).toContain("createOwnerIntegration");
    expect(localServiceDashboardSource).not.toContain(
      'url: "https://example.com"',
    );
    expect(restaurantIntegrationEditorSource).toContain("createOwnerIntegration");
  });
});

describe("owner dashboard workspace switching", () => {
  it("loads the food-retail workspace count onto the shared account-actions contract", () => {
    expect(dashboardPage).toContain("loadOwnerPaidWorkspace(access)");
    expect(dashboardPage).toMatch(
      /FOOD_RETAIL[\s\S]*canSwitchWorkspace=\{paid\.canSwitchWorkspace\}/,
    );
    expect(foodRetailDashboardSource).toContain(
      "<AccountActions canSwitch={canSwitchWorkspace} />",
    );
    expect(foodRetailDashboardSource).not.toContain(
      "<AccountActions canSwitch />",
    );
  });

  it("hides Switch workspace for a single membership and shows it for multiple", () => {
    const foodRetailSingle = renderToStaticMarkup(
      <FoodRetailDashboard
        email="owner@example.com"
        brand={FACTORY_BRAND}
        initialDraft={sampleFoodRetailDraft}
        initialRevision={7}
        initiallyPublished={false}
        platformUrl="https://bakery.cornershop.dev"
        canSwitchWorkspace={false}
      />,
    );
    const foodRetailMultiple = renderToStaticMarkup(
      <FoodRetailDashboard
        email="owner@example.com"
        brand={FACTORY_BRAND}
        initialDraft={sampleFoodRetailDraft}
        initialRevision={7}
        initiallyPublished={false}
        platformUrl="https://bakery.cornershop.dev"
        canSwitchWorkspace
      />,
    );
    const localServiceSingle = renderToStaticMarkup(
      <LocalServiceDashboard
        initialDraft={sampleLocalServiceSiteDraft}
        initialRevision={7}
        email="owner@harbourelectrical.example"
        brand={FACTORY_BRAND}
        canSwitchWorkspace={false}
        initiallyPublished={false}
        platformUrl="https://harbour-electrical.cornershop.dev"
      />,
    );
    const localServiceMultiple = renderToStaticMarkup(
      <LocalServiceDashboard
        initialDraft={sampleLocalServiceSiteDraft}
        initialRevision={7}
        email="owner@harbourelectrical.example"
        brand={FACTORY_BRAND}
        canSwitchWorkspace
        initiallyPublished={false}
        platformUrl="https://harbour-electrical.cornershop.dev"
      />,
    );
    const restaurantSingle = renderDashboard(false);
    const restaurantMultiple = renderDashboard(true);

    expect(foodRetailSingle).not.toContain("Switch workspace");
    expect(foodRetailMultiple).toContain("Switch workspace");
    expect(localServiceSingle).not.toContain("Switch workspace");
    expect(localServiceMultiple).toContain("Switch workspace");
    expect(restaurantSingle).not.toContain("Switch workspace");
    expect(restaurantMultiple).toContain("Switch workspace");
  });
});

function renderDashboard(canSwitchWorkspace: boolean) {
  return renderToStaticMarkup(
    <Dashboard
      initialDraft={sampleRestaurant}
      initialDraftRevision={0}
      email="owner@example.com"
      checkoutComplete={false}
      demo={false}
      brand={FACTORY_BRAND}
      analyticsSummary={buildEmptyAnalyticsSummary(
        new Date("2026-08-23T00:00:00.000Z"),
      )}
      bookingInbox={{
        requests: [],
        total: 0,
        awaitingContact: 0,
        truncated: false,
      }}
      billingAccess={null}
      publicationHistory={[]}
      canSwitchWorkspace={canSwitchWorkspace}
      sourceMonitoring={{
        cadenceDays: null,
        nextRunAt: null,
        lastRunAt: null,
        lastFailureAt: null,
        lastFailureCode: null,
        lastSuccessAt: null,
        latestRun: null,
        suggestions: [],
      }}
      platformUrl="https://osteria-luna.cornershop.dev"
    />,
  );
}
