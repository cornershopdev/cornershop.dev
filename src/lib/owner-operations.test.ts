import { describe, expect, it } from "bun:test";
import { Vertical } from "@/generated/prisma/enums";
import {
  applyOwnerOperationInvariants,
  assembleOwnerPaidWorkspace,
  beautyOwnerOperations,
  foodRetailOwnerOperations,
  isOwnerOperationEnabled,
  localServiceOwnerOperations,
  ownerOperationUnavailableMessage,
  restaurantOwnerOperations,
  toClientPublicationHistory,
} from "@/lib/owner-operations";
import {
  resolveOwnerOperations,
  resolveVerticalConfig,
} from "@/lib/verticals/registry";

const dashboardPage = await Bun.file(
  new URL("../app/dashboard/page.tsx", import.meta.url),
).text();
const restaurantDashboard = await Bun.file(
  new URL("../app/dashboard/dashboard.tsx", import.meta.url),
).text();
const foodRetailDashboard = await Bun.file(
  new URL("../app/dashboard/food-retail-dashboard.tsx", import.meta.url),
).text();
const localServiceDashboard = await Bun.file(
  new URL("../app/dashboard/local-service-dashboard.tsx", import.meta.url),
).text();

const memberAccess = {
  site: {
    id: "site_owner",
    slug: "owner-bakery",
    vertical: Vertical.FOOD_RETAIL,
    organizationId: "org_owner",
  },
  session: { userId: "user_owner", siteSlug: "owner-bakery" },
};

describe("owner operations capability model", () => {
  it("declares paid operations on the vertical config rather than dashboard component choice", () => {
    expect(resolveVerticalConfig(Vertical.RESTAURANT).ownerOperations).toEqual(
      restaurantOwnerOperations,
    );
    expect(resolveVerticalConfig(Vertical.FOOD_RETAIL).ownerOperations).toEqual(
      foodRetailOwnerOperations,
    );
    expect(
      resolveVerticalConfig(Vertical.LOCAL_SERVICE).ownerOperations,
    ).toEqual(localServiceOwnerOperations);
    expect(resolveVerticalConfig(Vertical.BEAUTY).ownerOperations).toEqual(
      beautyOwnerOperations,
    );

    expect(dashboardPage).toContain("loadOwnerPaidWorkspace(access)");
    expect(dashboardPage).not.toContain("RestaurantDashboard");
    expect(restaurantDashboard).toContain("useOwnerPaidOperations");
    expect(foodRetailDashboard).toContain("useOwnerPaidOperations");
    expect(localServiceDashboard).toContain("useOwnerPaidOperations");
    expect(foodRetailDashboard).toContain("OwnerPaidOperationsSection");
    expect(localServiceDashboard).toContain("OwnerPaidOperationsSection");
    expect(dashboardPage).toContain("getSourceMonitoringDashboard(access.site.id)");
    expect(foodRetailDashboard).toContain("SourceMonitoringPanel");
    expect(localServiceDashboard).toContain("SourceMonitoringPanel");
    expect(foodRetailDashboard).toContain("PhotoLibraryPanel");
    expect(localServiceDashboard).toContain("PhotoLibraryPanel");
  });

  it("enables billing, publication, domain, and workspace switching for owner-review verticals", () => {
    for (const id of [
      Vertical.RESTAURANT,
      Vertical.FOOD_RETAIL,
      Vertical.LOCAL_SERVICE,
    ] as const) {
      const ops = resolveOwnerOperations(id);
      expect(ops.billing).toBe("enabled");
      expect(ops.publicationHistory).toBe("enabled");
      expect(ops.publicationMutation).toBe("enabled");
      expect(ops.customDomain).toBe("enabled");
      expect(ops.workspaceSwitching).toBe("enabled");
    }
  });

  it("enables source monitoring and the photo library for owner-review verticals", () => {
    for (const id of [
      Vertical.RESTAURANT,
      Vertical.FOOD_RETAIL,
      Vertical.LOCAL_SERVICE,
    ] as const) {
      expect(resolveOwnerOperations(id).sourceMonitoring).toBe("enabled");
      expect(resolveOwnerOperations(id).photoLibrary).toBe("enabled");
    }
    for (const ops of [
      resolveOwnerOperations(Vertical.FOOD_RETAIL),
      resolveOwnerOperations(Vertical.LOCAL_SERVICE),
    ]) {
      expect(ops.articles).toBe("not-yet");
      expect(ops.analytics).toBe("not-yet");
      expect(ops.bookingInbox).toBe("not-yet");
    }
  });

  it("fails closed for beauty paid operations even if a leftover enabled flag is present", () => {
    expect(resolveOwnerOperations(Vertical.BEAUTY)).toMatchObject({
      billing: "unsupported",
      publicationMutation: "unsupported",
      customDomain: "unsupported",
    });
    expect(
      applyOwnerOperationInvariants(
        {
          ...beautyOwnerOperations,
          billing: "enabled",
          customDomain: "enabled",
          publicationMutation: "enabled",
        },
        { claimEnabled: false, publicationMutationEnabled: false },
      ),
    ).toMatchObject({
      billing: "gated",
      customDomain: "gated",
      publicationMutation: "gated",
    });
  });

  it("uses vertical-neutral unavailable copy instead of restaurant language", () => {
    expect(
      ownerOperationUnavailableMessage("publicationMutation", "gated"),
    ).toBe("Publishing is not available for this vertical.");
    expect(
      ownerOperationUnavailableMessage("sourceMonitoring", "not-yet"),
    ).toBe("Source monitoring is not ready for this workspace yet.");
    expect(ownerOperationUnavailableMessage("customDomain", "gated")).not.toMatch(
      /restofront|restaurant|menu/i,
    );
  });
});

describe("membership-scoped owner workspace loader", () => {
  it("queries only the authorized site id and session user id", async () => {
    const listedUsers: string[] = [];
    const billedSites: string[] = [];
    const historySites: string[] = [];

    const snapshot = await assembleOwnerPaidWorkspace(
      memberAccess,
      foodRetailOwnerOperations,
      {
        listWorkspaces: async (userId) => {
          listedUsers.push(userId);
          return [
            { id: "site_owner", slug: "owner-bakery", name: "Owner bakery" },
          ];
        },
        getBillingAccess: async (siteId) => {
          billedSites.push(siteId);
          return {
            ok: true,
            subscription: {
              status: "ACTIVE",
              stripePriceId: "price_founding",
              stripeCustomerId: "cus_owner",
            },
          };
        },
        getPublicationHistory: async (siteId) => {
          historySites.push(siteId);
          return [
            {
              id: "ver_owner",
              version: 2,
              publishedAt: new Date("2026-08-01T12:00:00.000Z"),
              changeSummary: "Owner publish",
              current: true,
              theme: { id: "shopfront", version: "1" },
            },
          ];
        },
      },
    );

    expect(listedUsers).toEqual(["user_owner"]);
    expect(billedSites).toEqual(["site_owner"]);
    expect(historySites).toEqual(["site_owner"]);
    expect(snapshot.canSwitchWorkspace).toBe(false);
    expect(snapshot.publicationHistory[0]?.publishedAt).toBe(
      "2026-08-01T12:00:00.000Z",
    );
  });

  it("does not load billing or history when those operations are gated", async () => {
    let billed = false;
    let historyLoaded = false;
    await assembleOwnerPaidWorkspace(
      memberAccess,
      applyOwnerOperationInvariants(beautyOwnerOperations, {
        claimEnabled: false,
        publicationMutationEnabled: false,
      }),
      {
        listWorkspaces: async () => [
          { id: "site_a", slug: "a", name: "A" },
          { id: "site_b", slug: "b", name: "B" },
        ],
        getBillingAccess: async () => {
          billed = true;
          return null;
        },
        getPublicationHistory: async () => {
          historyLoaded = true;
          return [];
        },
      },
    );
    expect(billed).toBe(false);
    expect(historyLoaded).toBe(false);
  });

  it("shows Switch workspace only when more than one authorized membership exists", async () => {
    const snapshot = await assembleOwnerPaidWorkspace(
      memberAccess,
      foodRetailOwnerOperations,
      {
        listWorkspaces: async () => [
          { id: "site_a", slug: "a", name: "A" },
          { id: "site_b", slug: "b", name: "B" },
        ],
        getBillingAccess: async () => null,
        getPublicationHistory: async () => [],
      },
    );
    expect(snapshot.canSwitchWorkspace).toBe(true);
  });
});

describe("owner operation helpers", () => {
  it("treats only enabled as available", () => {
    expect(isOwnerOperationEnabled("enabled")).toBe(true);
    expect(isOwnerOperationEnabled("gated")).toBe(false);
    expect(isOwnerOperationEnabled("not-yet")).toBe(false);
    expect(isOwnerOperationEnabled("unsupported")).toBe(false);
  });

  it("serializes publication timestamps for the client", () => {
    expect(
      toClientPublicationHistory([
        {
          id: "v1",
          version: 1,
          publishedAt: new Date("2026-08-02T08:00:00.000Z"),
          changeSummary: "Launch",
          current: true,
          theme: { id: "warm", version: "1" },
        },
      ]),
    ).toEqual([
      {
        id: "v1",
        version: 1,
        publishedAt: "2026-08-02T08:00:00.000Z",
        changeSummary: "Launch",
        current: true,
        theme: { id: "warm", version: "1" },
      },
    ]);
  });
});
