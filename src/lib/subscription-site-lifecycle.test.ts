import { describe, expect, it, mock } from "bun:test";
import type { Prisma } from "@/generated/prisma/client";
import { reconcileSiteSubscriptionLifecycle } from "@/lib/subscription-site-lifecycle";

describe("site subscription lifecycle", () => {
  it("leaves an already-provisioned site untouched for INCOMPLETE", async () => {
    const update = mock(async () => undefined);
    const createAuditEvent = mock(async () => undefined);
    const countDomains = mock(async () => {
      throw new Error("INCOMPLETE must not inspect domains");
    });
    const tx = {
      site: {
        findUnique: async () => ({
          status: "LIVE",
          publishedSiteVersionId: "version_1",
          publishedSiteVersion: {
            id: "version_1",
            siteId: "site_1",
            publishedAt: new Date("2026-08-01T00:00:00.000Z"),
          },
        }),
        update,
      },
      domain: { count: countDomains },
      auditEvent: { create: createAuditEvent },
    } as unknown as Prisma.TransactionClient;

    await reconcileSiteSubscriptionLifecycle(tx, {
      siteId: "site_1",
      subscriptionStatus: "INCOMPLETE",
      stripeEventId: "evt_incomplete",
    });

    expect(countDomains).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(createAuditEvent).not.toHaveBeenCalled();
  });
});
