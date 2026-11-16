import { describe, expect, it } from "bun:test";
import {
  ArticleBatchStatus,
  ArticleStatus,
  OperatorAlertKind,
  OperatorAlertStatus,
  OutreachStatus,
  SiteStatus,
  SubscriptionStatus,
  Vertical,
} from "@/generated/prisma/enums";
import { buildEmptyAnalyticsSummary } from "@/lib/analytics-contract";
import { buildDailyBrief } from "@/lib/operator-autonomy/brief";
import { KILL_CRITERIA } from "@/lib/operator-autonomy/contract";
import { redactOperatorValue } from "@/lib/operator-autonomy/redact";
import {
  BRIEF_SITE_LIMIT,
  emptyCounts,
  type OperatorAutonomySnapshot,
  type OperatorSiteView,
} from "@/lib/operator-autonomy/types";
import { isVerticalPubliclyLaunched } from "@/lib/verticals/registry";

const generatedAt = "2026-10-14T00:00:00.000Z";

function site(overrides: Partial<OperatorSiteView> = {}): OperatorSiteView {
  return {
    slug: "ada-bakery",
    name: "Ada Bakery",
    vertical: "FOOD_RETAIL",
    status: "PREVIEW_READY",
    createdAt: generatedAt,
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

function snapshot(
  overrides: Partial<OperatorAutonomySnapshot> = {},
): OperatorAutonomySnapshot {
  return {
    generatedAt,
    portfolio: {
      sites: 1,
      signedUpSites: 0,
      pendingBookingRequests: 0,
      sitesByStatus: emptyCounts(Object.values(SiteStatus)),
      sitesByVertical: emptyCounts(Object.values(Vertical)),
      subscriptionsByStatus: emptyCounts(Object.values(SubscriptionStatus)),
      analytics: buildEmptyAnalyticsSummary(new Date(generatedAt)),
    },
    alerts: {
      byStatus: emptyCounts(Object.values(OperatorAlertStatus)),
      openByKind: emptyCounts(Object.values(OperatorAlertKind)),
    },
    outreach: {
      globalPaused: true,
      pausedSiteCount: 0,
      messagesByStatus: emptyCounts(Object.values(OutreachStatus)),
    },
    content: {
      articlesByStatus: emptyCounts(Object.values(ArticleStatus)),
      articleBatchesByStatus: emptyCounts(Object.values(ArticleBatchStatus)),
      pendingSourceSuggestions: 0,
    },
    sites: [site()],
    ...overrides,
  };
}

describe("daily brief", () => {
  it("keeps launch blocked and kill criteria unmeasured", () => {
    const brief = buildDailyBrief(snapshot());

    expect(brief.launch.status).toBe("blocked");
    expect(brief.killCriteria.map((criterion) => criterion.id)).toEqual(
      KILL_CRITERIA.map((criterion) => criterion.id),
    );
    expect(brief.killCriteria.every((criterion) => criterion.status === "unmeasured")).toBe(
      true,
    );
    expect(brief.verticals.map((vertical) => vertical.publiclyLaunched)).toEqual(
      brief.verticals.map((vertical) => isVerticalPubliclyLaunched(vertical.id)),
    );
  });

  it("redacts contact details and reports human attention", () => {
    const brief = redactOperatorValue(
      buildDailyBrief(
        snapshot({
          alerts: {
            byStatus: {
              ...emptyCounts(Object.values(OperatorAlertStatus)),
              EXHAUSTED: 2,
            },
            openByKind: emptyCounts(Object.values(OperatorAlertKind)),
          },
          outreach: {
            globalPaused: false,
            pausedSiteCount: 0,
            messagesByStatus: emptyCounts(Object.values(OutreachStatus)),
          },
          sites: [
            site({
              name: "Ada ada@example.com sk_live_secret postgres://operator:secret@db/app",
              latestImportStatus: "FAILED",
              subscriptionStatus: "PAST_DUE",
            }),
          ],
        }),
      ),
    );
    const encoded = JSON.stringify(brief);

    expect(encoded).not.toContain("ada@example.com");
    expect(encoded).not.toContain("sk_live_secret");
    expect(encoded).not.toContain("postgres://");
    expect(encoded).toContain("[redacted-email]");
    expect(encoded).toContain("[redacted-secret]");
    expect(encoded).toContain("[redacted-url]");
    expect(brief.leadDelivery.email.status).toBe("blocked");
    expect(brief.leadDelivery.preview.command).toBe("operator:prepare-lead");
    expect(brief.attention.map((item) => item.code)).toEqual([
      "launch-blocked",
      "lead-email-blocked",
      "alerts-exhausted",
      "outreach-not-paused",
      "import-failed",
      "subscription-past-due",
    ]);
  });

  it("truncates the brief site list and keeps the omitted count", () => {
    const sites = Array.from({ length: BRIEF_SITE_LIMIT + 3 }, (_, index) =>
      site({ slug: `site-${index}`, name: `Site ${index}` }),
    );
    const brief = buildDailyBrief(snapshot({ sites }));

    expect(brief.sites).toHaveLength(BRIEF_SITE_LIMIT);
    expect(brief.omittedSiteCount).toBe(3);
    expect(brief.attention.some((item) => item.code === "site-list-truncated")).toBe(
      true,
    );
  });
});
