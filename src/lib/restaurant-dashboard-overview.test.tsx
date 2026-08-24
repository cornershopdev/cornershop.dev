import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Dashboard } from "@/app/dashboard/dashboard";
import { buildEmptyAnalyticsSummary } from "@/lib/analytics-contract";
import { FACTORY_BRAND } from "@/lib/brand";
import {
  restaurantDraftSchema,
  sampleRestaurant,
} from "@/lib/restaurant";
import { buildRestaurantDashboardOverview } from "@/lib/restaurant-dashboard-overview";

const dashboardSource = await Bun.file(
  new URL("../app/dashboard/dashboard.tsx", import.meta.url),
).text();

describe("Restaurant dashboard overview", () => {
  it("marks an empty menu and missing booking link incomplete", () => {
    const draft = restaurantDraftSchema.parse({
      ...sampleRestaurant,
      menuSections: sampleRestaurant.menuSections.map((section) => ({
        ...section,
        items: [],
      })),
      integrations: [],
    });

    expect(buildRestaurantDashboardOverview(draft)).toEqual({
      menuItemCount: 0,
      menuSectionCount: draft.menuSections.length,
      enabledLinkCount: 0,
      menuComplete: false,
      bookingComplete: false,
    });

    const html = renderDashboard(draft);
    expect(checklistStatus(html, "Menu has items")).toBe("Incomplete");
    expect(checklistStatus(html, "Booking link enabled")).toBe("Incomplete");
  });

  it("reports only enabled links and honors the booking enabled default", () => {
    const defaultEnabledBooking = restaurantDraftSchema.parse({
      ...sampleRestaurant,
      integrations: [
        {
          type: "booking",
          label: "Reserve",
          provider: null,
          url: "https://www.opentable.com/r/osteria-luna",
        },
      ],
    });
    const disabledBooking = restaurantDraftSchema.parse({
      ...sampleRestaurant,
      integrations: sampleRestaurant.integrations.map(
        (integration, index) => ({
          ...integration,
          enabled: index !== 0,
        }),
      ),
    });

    expect(defaultEnabledBooking.integrations[0].enabled).toBe(true);
    expect(
      buildRestaurantDashboardOverview(defaultEnabledBooking),
    ).toMatchObject({
      enabledLinkCount: 1,
      menuComplete: true,
      bookingComplete: true,
    });
    expect(buildRestaurantDashboardOverview(disabledBooking)).toMatchObject({
      enabledLinkCount: 1,
      bookingComplete: false,
    });

    const html = renderDashboard(defaultEnabledBooking);
    expect(checklistStatus(html, "Menu has items")).toBe("Complete");
    expect(checklistStatus(html, "Booking link enabled")).toBe("Complete");
    expect(html).toMatch(
      />Enabled links<\/p><p[^>]*>1<\/p><p[^>]*>Link currently enabled<\/p>/,
    );
  });

  it("renders literal checklist statuses and no dead or unsupported overview copy", () => {
    const html = renderDashboard(sampleRestaurant);
    const checklistLabels = [
      "Menu has items",
      "Booking link enabled",
      "Owner account claimed",
      "Site published",
      "Custom domain connected",
    ];

    for (const label of checklistLabels) {
      const row = checklistRow(html, label);
      const status = checklistStatus(html, label);
      expect(["Complete", "Incomplete"]).toContain(status);
      expect(row).toContain(
        `<span class="sr-only">${status}</span>`,
      );
      expect(row).toContain(
        '<span aria-hidden="true" class="grid size-5',
      );
      if (status === "Complete") {
        expect(row).toMatch(/<svg[^>]*aria-hidden="true"/);
      } else {
        expect(row).not.toContain("<svg");
      }
    }

    for (const unsupported of [
      "MoreHorizontal",
      "Edit homepage",
      "Good afternoon",
      "Preview healthy",
      "Preview ready",
      "Menu imported",
      "Booking link preserved",
      "Preserved systems",
      "No migrations required",
      "Email and booking systems remain untouched",
    ]) {
      expect(dashboardSource).not.toContain(unsupported);
    }
    expect(dashboardSource).not.toContain(
      '<button className="hidden items-center',
    );
    expect(dashboardSource).toContain(
      '<span className="hidden max-w-56 truncate text-sm font-medium sm:block">',
    );
  });
});

function renderDashboard(draft: typeof sampleRestaurant) {
  return renderToStaticMarkup(
    <Dashboard
      initialDraft={draft}
      initialDraftRevision={0}
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
      canSwitchWorkspace={false}
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
}

function checklistStatus(html: string, label: string) {
  const row = checklistRow(html, label);
  const status = row.match(
    /<span class="sr-only">(Complete|Incomplete)<\/span>/,
  )?.[1];
  if (!status) throw new Error(`Missing checklist status for: ${label}`);
  return status;
}

function checklistRow(html: string, label: string) {
  const labelIndex = html.indexOf(`>${label}</span>`);
  if (labelIndex < 0) throw new Error(`Missing checklist label: ${label}`);
  const rowEnd = html.indexOf("</div>", labelIndex);
  return html.slice(labelIndex, rowEnd);
}
