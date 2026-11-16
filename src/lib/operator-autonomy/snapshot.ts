import type { PrismaClient } from "@/generated/prisma/client";
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
import {
  ANALYTICS_WINDOWS,
  buildAnalyticsWindowDto,
  buildEmptyAnalyticsSummary,
  LIVE_BOOKING_REQUEST_SOURCE,
  type AnalyticsSummaryDto,
} from "@/lib/analytics-contract";
import { getDb } from "@/lib/db";
import { buildDailyBrief, type DailyBrief } from "@/lib/operator-autonomy/brief";
import { redactOperatorValue } from "@/lib/operator-autonomy/redact";
import {
  emptyCounts,
  type CountMap,
  type OperatorAutonomySnapshot,
  type OperatorSiteView,
} from "@/lib/operator-autonomy/types";
import {
  buildOperatorLeadRollup,
  getOperatorInvitationState,
  isOperatorReviewCurrent,
} from "@/lib/operator-lead-status";
import {
  GLOBAL_OUTREACH_PAUSE_KEY,
  isOutreachPaused,
} from "@/lib/outreach-pause";

const SITE_QUERY_LIMIT = 200;

type MetricRow = {
  days: number;
  visits: number;
  ctaVisitors: number;
  bookingLeads: number;
};

type GroupedCount = {
  _count: { _all: number };
};

export async function loadDailyBrief(
  db: PrismaClient = getDb(),
): Promise<DailyBrief> {
  const snapshot = await loadOperatorAutonomySnapshot(db);
  return redactOperatorValue(buildDailyBrief(snapshot));
}

export async function loadOperatorAutonomySnapshot(
  db: PrismaClient,
  now = new Date(),
): Promise<OperatorAutonomySnapshot> {
  const [
    siteCount,
    signedUpSiteCount,
    pendingBookingRequestCount,
    sitesByStatus,
    sitesByVertical,
    subscriptionsByStatus,
    alertsByStatus,
    openAlertsByKind,
    messagesByStatus,
    articlesByStatus,
    articleBatchesByStatus,
    pendingSourceSuggestions,
    outreachSettings,
    analytics,
    sites,
  ] = await Promise.all([
    db.site.count(),
    db.site.count({
      where: { organization: { memberships: { some: {} } } },
    }),
    db.bookingRequest.count({
      where: { status: { in: ["NEW", "NOTIFIED"] } },
    }),
    db.site.groupBy({ by: ["status"], _count: { _all: true } }),
    db.site.groupBy({ by: ["vertical"], _count: { _all: true } }),
    db.subscription.groupBy({ by: ["status"], _count: { _all: true } }),
    db.operatorAlert.groupBy({ by: ["status"], _count: { _all: true } }),
    db.operatorAlert.groupBy({
      by: ["kind"],
      where: { status: { in: ["PENDING", "EXHAUSTED"] } },
      _count: { _all: true },
    }),
    db.outreachMessage.groupBy({ by: ["status"], _count: { _all: true } }),
    db.article.groupBy({ by: ["status"], _count: { _all: true } }),
    db.articleBatch.groupBy({ by: ["status"], _count: { _all: true } }),
    db.sourceMonitorSuggestion.count({ where: { status: "PENDING" } }),
    db.operatorSetting.findMany({
      where: { key: { startsWith: GLOBAL_OUTREACH_PAUSE_KEY } },
      select: { key: true, value: true },
    }),
    portfolioAnalytics(db, now),
    db.site.findMany({
      orderBy: { updatedAt: "desc" },
      take: SITE_QUERY_LIMIT,
      select: {
        id: true,
        slug: true,
        name: true,
        vertical: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        description: true,
        address: true,
        phone: true,
        sourceUrl: true,
        heroImageUrl: true,
        heroImageProvenance: true,
        translations: true,
        publishedSiteVersionId: true,
        organization: {
          select: { _count: { select: { memberships: true } } },
        },
        subscription: { select: { status: true } },
        importJobs: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { status: true },
        },
        domains: { select: { verified: true } },
        claimInvitations: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            expiresAt: true,
            verifiedAt: true,
            acceptedAt: true,
            revokedAt: true,
            checkoutSessionId: true,
          },
        },
        auditEvents: {
          where: { type: "site.review.completed" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true },
        },
        catalogSections: {
          select: { _count: { select: { items: true } } },
        },
        _count: { select: { integrations: true } },
      },
    }),
  ]);

  const siteIds = sites.map((site) => site.id);
  const [pendingBookings, pendingSuggestions, articleCounts] =
    siteIds.length === 0
      ? [[], [], []]
      : await Promise.all([
          db.bookingRequest.groupBy({
            by: ["siteId"],
            where: {
              siteId: { in: siteIds },
              status: { in: ["NEW", "NOTIFIED"] },
            },
            _count: { _all: true },
          }),
          db.sourceMonitorSuggestion.groupBy({
            by: ["siteId"],
            where: { siteId: { in: siteIds }, status: "PENDING" },
            _count: { _all: true },
          }),
          db.article.groupBy({
            by: ["siteId", "status"],
            where: { siteId: { in: siteIds } },
            _count: { _all: true },
          }),
        ]);

  const bookingsBySite = new Map(
    pendingBookings.map((row) => [row.siteId, row._count._all]),
  );
  const suggestionsBySite = new Map(
    pendingSuggestions.map((row) => [row.siteId, row._count._all]),
  );
  const articlesBySite = new Map<string, { draft: number; published: number }>();
  for (const row of articleCounts) {
    const current = articlesBySite.get(row.siteId) ?? { draft: 0, published: 0 };
    if (row.status === "DRAFT") current.draft = row._count._all;
    if (row.status === "PUBLISHED") current.published = row._count._all;
    articlesBySite.set(row.siteId, current);
  }

  const globalPaused = outreachSettings.some(
    (setting) =>
      setting.key === GLOBAL_OUTREACH_PAUSE_KEY && setting.value !== false,
  );

  return {
    generatedAt: now.toISOString(),
    portfolio: {
      sites: siteCount,
      signedUpSites: signedUpSiteCount,
      pendingBookingRequests: pendingBookingRequestCount,
      sitesByStatus: fillGrouped(SiteStatus, sitesByStatus, (row) => row.status),
      sitesByVertical: fillGrouped(
        Vertical,
        sitesByVertical,
        (row) => row.vertical,
      ),
      subscriptionsByStatus: fillGrouped(
        SubscriptionStatus,
        subscriptionsByStatus,
        (row) => row.status,
      ),
      analytics,
    },
    alerts: {
      byStatus: fillGrouped(
        OperatorAlertStatus,
        alertsByStatus,
        (row) => row.status,
      ),
      openByKind: fillGrouped(
        OperatorAlertKind,
        openAlertsByKind,
        (row) => row.kind,
      ),
    },
    outreach: {
      globalPaused,
      pausedSiteCount: outreachSettings.filter(
        (setting) =>
          setting.key.startsWith(`${GLOBAL_OUTREACH_PAUSE_KEY}.site.`) &&
          setting.value !== false,
      ).length,
      messagesByStatus: fillGrouped(
        OutreachStatus,
        messagesByStatus,
        (row) => row.status,
      ),
    },
    content: {
      articlesByStatus: fillGrouped(
        ArticleStatus,
        articlesByStatus,
        (row) => row.status,
      ),
      articleBatchesByStatus: fillGrouped(
        ArticleBatchStatus,
        articleBatchesByStatus,
        (row) => row.status,
      ),
      pendingSourceSuggestions,
    },
    sites: sites.map((site) => {
      const invitation = site.claimInvitations[0] ?? null;
      const review = site.auditEvents[0] ?? null;
      const reviewedAt =
        review && isOperatorReviewCurrent(review.createdAt, site.updatedAt)
          ? review.createdAt
          : null;
      const verifiedDomainCount = site.domains.filter(
        (domain) => domain.verified,
      ).length;
      const ownerCount = site.organization?._count.memberships ?? 0;
      const articleCount = articlesBySite.get(site.id) ?? {
        draft: 0,
        published: 0,
      };
      const isPublished =
        Boolean(site.publishedSiteVersionId) && site.status === "LIVE";
      const view: OperatorSiteView = {
        slug: site.slug,
        name: site.name.slice(0, 160),
        vertical: site.vertical,
        status: site.status,
        createdAt: site.createdAt.toISOString(),
        ownerCount,
        subscriptionStatus: site.subscription?.status ?? null,
        latestImportStatus: site.importJobs[0]?.status ?? null,
        pendingBookingRequestCount: bookingsBySite.get(site.id) ?? 0,
        domainCount: site.domains.length,
        verifiedDomainCount,
        isPublished,
        pendingSourceSuggestionCount: suggestionsBySite.get(site.id) ?? 0,
        draftArticleCount: articleCount.draft,
        publishedArticleCount: articleCount.published,
        outreachPaused: isOutreachPaused(outreachSettings, site.id),
        invitationState: getOperatorInvitationState(invitation, now),
        contentReview: {
          missingFields: [
            !site.name.trim() ? ("name" as const) : null,
            !site.description?.trim() ? ("description" as const) : null,
            !site.address?.trim() ? ("address" as const) : null,
            !site.phone?.trim() ? ("phone" as const) : null,
            !site.sourceUrl?.trim() ? ("sourceUrl" as const) : null,
          ].filter((field) => field !== null),
          heroImage: !site.heroImageUrl
            ? "missing"
            : site.heroImageProvenance
              ? "provenance_recorded"
              : "provenance_missing",
          translationCount: Array.isArray(site.translations)
            ? site.translations.length
            : 0,
          integrationCount: site._count.integrations,
          catalogItemCount: site.catalogSections.reduce(
            (sum, section) => sum + section._count.items,
            0,
          ),
        },
        blockers: buildOperatorLeadRollup({
          importStatus: site.importJobs[0]?.status ?? null,
          reviewedAt,
          ownerCount,
          invitationState: getOperatorInvitationState(invitation, now),
          subscriptionStatus: site.subscription?.status ?? null,
          domainCount: site.domains.length,
          verifiedDomainCount,
          isPublished,
        }).map(({ stage, status, label }) => ({ stage, status, label })),
      };
      return view;
    }),
  };
}

async function portfolioAnalytics(
  db: PrismaClient,
  now: Date,
): Promise<AnalyticsSummaryDto> {
  const rows = await db.$queryRaw<MetricRow[]>`
    WITH windows(days) AS (
      VALUES (7), (30), (90)
    )
    SELECT
      windows.days::int AS days,
      (
        SELECT COUNT(DISTINCT (event."siteId", event."visitId"))::int
        FROM "AnalyticsEvent" AS event
        WHERE event."type" = 'SITE_VIEW'
          AND event."occurredAt" >=
            (${now}::timestamptz AT TIME ZONE 'UTC')
            - make_interval(days => windows.days)
          AND event."occurredAt" <
            (${now}::timestamptz AT TIME ZONE 'UTC')
      ) AS visits,
      (
        SELECT COUNT(DISTINCT (event."siteId", event."visitId"))::int
        FROM "AnalyticsEvent" AS event
        WHERE event."type" = 'CTA_CLICK'
          AND event."occurredAt" >=
            (${now}::timestamptz AT TIME ZONE 'UTC')
            - make_interval(days => windows.days)
          AND event."occurredAt" <
            (${now}::timestamptz AT TIME ZONE 'UTC')
      ) AS "ctaVisitors",
      (
        SELECT COUNT(*)::int
        FROM "BookingRequest" AS lead
        WHERE lead."source" = ${LIVE_BOOKING_REQUEST_SOURCE}
          AND lead."createdAt" >=
            (${now}::timestamptz AT TIME ZONE 'UTC')
            - make_interval(days => windows.days)
          AND lead."createdAt" <
            (${now}::timestamptz AT TIME ZONE 'UTC')
      ) AS "bookingLeads"
    FROM windows
    ORDER BY windows.days ASC
  `;

  const byDays = new Map(rows.map((row) => [Number(row.days), row]));
  const summary = buildEmptyAnalyticsSummary(now);
  summary.windows = ANALYTICS_WINDOWS.map((days) => {
    const row = byDays.get(days);
    return buildAnalyticsWindowDto({
      days,
      visits: Number(row?.visits ?? 0),
      ctaVisitors: Number(row?.ctaVisitors ?? 0),
      bookingLeads: Number(row?.bookingLeads ?? 0),
    });
  });
  return summary;
}

function fillGrouped<T extends string, Row extends GroupedCount>(
  enumObject: Record<string, T>,
  rows: readonly Row[],
  valueOf: (row: Row) => T,
): CountMap<T> {
  const counts = emptyCounts(Object.values(enumObject));
  for (const row of rows) {
    counts[valueOf(row)] = row._count._all;
  }
  return counts;
}
