import { describe, expect, it } from "bun:test";
import {
  assessLeadDelivery,
  assessSiteLeadDelivery,
  LEAD_EMAIL_BLOCKERS,
  summarizeLeadDelivery,
} from "@/lib/operator-autonomy/lead-delivery";
import type { OperatorSiteView } from "@/lib/operator-autonomy/types";

function site(overrides: Partial<OperatorSiteView> = {}): OperatorSiteView {
  return {
    slug: "ada-bakery",
    name: "Ada Bakery",
    vertical: "RESTAURANT",
    status: "PREVIEW_READY",
    createdAt: "2026-10-14T00:00:00.000Z",
    ownerCount: 0,
    subscriptionStatus: null,
    latestImportStatus: "READY",
    pendingBookingRequestCount: 0,
    domainCount: 0,
    verifiedDomainCount: 0,
    isPublished: false,
    pendingSourceSuggestionCount: 0,
    draftArticleCount: 0,
    publishedArticleCount: 0,
    outreachPaused: true,
    invitationState: "NONE",
    contentReview: {
      missingFields: [],
      heroImage: "missing",
      translationCount: 0,
      integrationCount: 0,
      catalogItemCount: 0,
    },
    blockers: [],
    ...overrides,
  };
}

describe("lead delivery", () => {
  it("keeps claim email blocked and names the preview command", () => {
    const delivery = assessLeadDelivery();

    expect(delivery.preview).toMatchObject({
      status: "ready",
      command: "operator:prepare-lead",
    });
    expect(delivery.email.status).toBe("blocked");
    expect(delivery.email.blockers.map((blocker) => blocker.id)).toEqual(
      LEAD_EMAIL_BLOCKERS.map((blocker) => blocker.id),
    );
  });

  it("reports a generated preview without clearing the email block", () => {
    expect(assessSiteLeadDelivery(site()).previewGenerated).toBe(true);
    expect(assessSiteLeadDelivery(site()).email).toBe("blocked");
    expect(
      assessSiteLeadDelivery(site({ latestImportStatus: "FAILED" })).previewGenerated,
    ).toBe(false);
    expect(
      assessSiteLeadDelivery(site({ latestImportStatus: null })).email,
    ).toBe("blocked");
  });

  it("counts generated previews inside the operator window", () => {
    const summary = summarizeLeadDelivery([
      site(),
      site({ slug: "pending", latestImportStatus: null }),
    ]);

    expect(summary.email.status).toBe("blocked");
    expect(summary.sitesInWindow).toBe(2);
    expect(summary.previewsGenerated).toBe(1);
  });
});
