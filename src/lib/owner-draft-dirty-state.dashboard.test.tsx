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

import { Dashboard } from "@/app/dashboard/dashboard";
import { FoodRetailDashboard } from "@/app/dashboard/food-retail-dashboard";
import { LocalServiceDashboard } from "@/app/dashboard/local-service-dashboard";
import { AccountActions } from "@/components/account-actions";
import { buildEmptyAnalyticsSummary } from "@/lib/analytics-contract";
import { FACTORY_BRAND } from "@/lib/brand";
import { sampleRestaurant } from "@/lib/restaurant";
import { sampleFoodRetailDraft } from "@/lib/verticals/food-retail/fixtures";
import { sampleLocalServiceSiteDraft } from "@/lib/verticals/local-service/fixtures";

const dashboard = await Bun.file(
  new URL("../app/dashboard/dashboard.tsx", import.meta.url),
).text();
const foodRetailDashboard = await Bun.file(
  new URL("../app/dashboard/food-retail-dashboard.tsx", import.meta.url),
).text();
const localServiceDashboard = await Bun.file(
  new URL("../app/dashboard/local-service-dashboard.tsx", import.meta.url),
).text();
const accountActions = await Bun.file(
  new URL("../components/account-actions.tsx", import.meta.url),
).text();
const dirtyState = await Bun.file(
  new URL("./owner-draft-dirty-state.ts", import.meta.url),
).text();

const dashboardSources = [
  ["restaurant", dashboard],
  ["food-retail", foodRetailDashboard],
  ["local-service", localServiceDashboard],
] as const;

describe("vertical dashboards share one dirty-state contract", () => {
  it("wires the shared hook, unload guard, and navigation intercept on every owner dashboard", () => {
    expect(dirtyState).toContain("window.onbeforeunload");
    expect(dirtyState).toContain("beforeunload");
    expect(dirtyState).toContain("confirmDiscardUnsavedOwnerEdits");
    expect(dirtyState).toContain("reconcileOwnerDraftAuxiliary");

    for (const [, source] of dashboardSources) {
      expect(source).toContain("useOwnerDraftDirtyState");
      expect(source).toContain("OwnerDraftDirtyGuard");
      expect(source).toContain("ownerDraftNavigationProps");
      expect(source).toContain("applyAuxiliary");
      expect(source).toContain("hasUnsavedChanges={dirty}");
      expect(source).not.toContain("addEventListener(\"beforeunload\"");
    }

    expect(accountActions).toContain("useOwnerUnsavedEdits");
    expect(accountActions).toContain("confirmDiscardUnsavedOwnerEdits");
    expect(accountActions).toContain('href="/workspace/select"');
    expect(accountActions).toContain("/api/auth/logout");
  });

  it("renders clean dashboards without an unsaved prompt surface", () => {
    const restaurantHtml = renderToStaticMarkup(
      <Dashboard
        initialDraft={sampleRestaurant}
        initialDraftRevision={4}
        email="owner@example.com"
        checkoutComplete={false}
        demo
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
        canSwitchWorkspace
        sourceMonitoring={{
          cadenceDays: null,
          nextRunAt: null,
          lastRunAt: null,
          lastSuccessAt: null,
          lastFailureAt: null,
          lastFailureCode: null,
          latestRun: null,
          suggestions: [],
        }}
        platformUrl="https://osteria-luna.cornershop.dev"
      />,
    );
    const foodRetailHtml = renderToStaticMarkup(
      <FoodRetailDashboard
        email="owner@example.com"
        brand={FACTORY_BRAND}
        initialDraft={sampleFoodRetailDraft}
        initialRevision={7}
        initiallyPublished={false}
        canSwitchWorkspace
        platformUrl="https://bakery.cornershop.dev"
      />,
    );
    const localServiceHtml = renderToStaticMarkup(
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

    expect(restaurantHtml).toContain("Saved");
    expect(foodRetailHtml).toContain("Saved");
    expect(localServiceHtml).toContain("Saved");
    expect(localServiceHtml).toContain("Draft revision 7");
    expect(foodRetailHtml).toContain("Switch workspace");
    expect(restaurantHtml).not.toContain("Unsaved changes");
    expect(localServiceHtml).not.toContain("Unsaved changes");

    const actions = renderToStaticMarkup(<AccountActions canSwitch />);
    expect(actions).toContain("Switch workspace");
    expect(actions).toContain("Sign out");
    expect(actions).toContain("/workspace/select");
  });

  it("keeps restaurant settings and food-retail edits on the shared setDraft path", () => {
    expect(dashboard).toContain('id="restaurant-name"');
    expect(dashboard).toContain("setDraft((current) => ({");
    expect(dashboard).toContain("showMenuImages: checked");
    expect(foodRetailDashboard).toContain("setDraft({ ...draft, name:");
    expect(localServiceDashboard).toContain("function change(");
    expect(localServiceDashboard).toContain("setDraft((current) => {");
  });
});
