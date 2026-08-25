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
import {
  OwnerPaidOperationsSection,
  OwnerUnavailableCard,
} from "@/components/owner-paid-operations";
import { FACTORY_BRAND } from "@/lib/brand";
import {
  applyOwnerOperationInvariants,
  foodRetailOwnerOperations,
  restaurantOwnerOperations,
  type ClientPublicationHistoryItem,
  type OwnerPaidOperationsHookInput,
} from "@/lib/owner-operations";
import { sampleFoodRetailDraft } from "@/lib/verticals/food-retail/fixtures";
import { sampleLocalServiceSiteDraft } from "@/lib/verticals/local-service/fixtures";

const history: ClientPublicationHistoryItem[] = [
  {
    id: "ver_live",
    version: 3,
    publishedAt: "2026-08-02T10:00:00.000Z",
    changeSummary: "Reviewed storefront",
    current: true,
    theme: { id: "shopfront", version: "1" },
  },
  {
    id: "ver_previous",
    version: 2,
    publishedAt: "2026-08-01T10:00:00.000Z",
    changeSummary: "First publish",
    current: false,
    theme: { id: "shopfront", version: "1" },
  },
];

const activeBilling = {
  ok: true as const,
  subscription: {
    status: "ACTIVE" as const,
    stripePriceId: "price_founding",
    stripeCustomerId: "cus_owner",
  },
};

function paidController(
  overrides?: Partial<ReturnType<typeof baseController>>,
) {
  return { ...baseController(), ...overrides };
}

function baseController() {
  const input: OwnerPaidOperationsHookInput = {
    siteSlug: "owner-bakery",
    platformUrl: "https://owner-bakery.cornershop.dev",
    brandName: FACTORY_BRAND.name,
    capabilities: foodRetailOwnerOperations,
    billingAccess: activeBilling,
    initialPublicationHistory: history,
  };
  return {
    capabilities: input.capabilities,
    billingAccess: input.billingAccess,
    brandName: input.brandName,
    platformUrl: input.platformUrl,
    isDemo: false,
    portalLoading: false,
    openBillingPortal: async () => undefined,
    publicationHistory: history,
    rollbackLoading: null,
    rollback: async () => undefined,
    recordPublished: () => undefined,
    markDraftUnpublished: () => undefined,
    publishedVersion: 3,
    isPublished: true,
    liveUrl: input.platformUrl,
    domain: "",
    setDomain: () => undefined,
    domainSetup: null,
    domainError: null,
    domainNotice: null,
    domainLoading: false,
    connectDomain: async () => undefined,
    checkDomain: async () => undefined,
    removeDomain: async () => undefined,
    operationError: null,
  };
}

describe("shared owner paid operations surface", () => {
  it("renders billing, history, rollback, and domain for food-retail and local-service", () => {
    const foodHtml = renderToStaticMarkup(
      <FoodRetailDashboard
        email="owner@example.com"
        brand={FACTORY_BRAND}
        initialDraft={sampleFoodRetailDraft}
        initialRevision={7}
        initiallyPublished
        canSwitchWorkspace={false}
        platformUrl="https://bakery.cornershop.dev"
        billingAccess={activeBilling}
        publicationHistory={history}
      />,
    );
    const localHtml = renderToStaticMarkup(
      <LocalServiceDashboard
        initialDraft={sampleLocalServiceSiteDraft}
        initialRevision={7}
        email="owner@harbourelectrical.example"
        brand={FACTORY_BRAND}
        canSwitchWorkspace={false}
        initiallyPublished
        platformUrl="https://harbour-electrical.cornershop.dev"
        billingAccess={activeBilling}
        publicationHistory={history}
      />,
    );

    for (const html of [foodHtml, localHtml]) {
      expect(html).toContain("Subscription and billing");
      expect(html).toContain("Subscription is active on the founding plan");
      expect(html).toContain("Published history");
      expect(html).toContain("Version 3");
      expect(html).toContain("Rollback");
      expect(html).toContain("Use your own domain (optional)");
      expect(html).toContain("Changes wait for your approval.");
      expect(html).not.toContain(
        "Source monitoring is not ready for this workspace yet.",
      );
      expect(html).toContain("The photo library is not ready for this workspace yet.");
      expect(html).not.toContain("Restofront");
      expect(html).not.toContain("restaurant.com");
    }
  });

  it("shows an explicit unavailable state when publication mutation is gated", () => {
    const html = renderToStaticMarkup(
      <OwnerPaidOperationsSection
        paid={paidController({
          capabilities: applyOwnerOperationInvariants(
            foodRetailOwnerOperations,
            { claimEnabled: true, publicationMutationEnabled: false },
          ),
        })}
      />,
    );
    expect(html).toContain("Publishing is not available for this vertical.");
    expect(html).toContain("Published history");
    expect(html).not.toContain("Book a table");
    expect(html).not.toContain("Restofront");
  });

  it("does not hide gated operations or borrow restaurant copy", () => {
    const html = renderToStaticMarkup(
      <OwnerUnavailableCard operation="sourceMonitoring" state="not-yet" />,
    );
    expect(html).toContain("Source monitoring");
    expect(html).toContain(
      "Source monitoring is not ready for this workspace yet.",
    );
    expect(html).not.toContain("Last source check");
    expect(restaurantOwnerOperations.sourceMonitoring).toBe("enabled");
  });

  it("keeps the shared monitoring panel fail-closed when the registry disables it", () => {
    const html = renderToStaticMarkup(
      <FoodRetailDashboard
        email="owner@example.com"
        brand={FACTORY_BRAND}
        initialDraft={sampleFoodRetailDraft}
        initialRevision={7}
        initiallyPublished
        canSwitchWorkspace={false}
        platformUrl="https://bakery.cornershop.dev"
        billingAccess={activeBilling}
        publicationHistory={history}
        ownerOperations={{
          ...foodRetailOwnerOperations,
          sourceMonitoring: "not-yet",
        }}
      />,
    );
    expect(html).toContain(
      "Source monitoring is not ready for this workspace yet.",
    );
    expect(html).not.toContain("Changes wait for your approval.");
  });
});
