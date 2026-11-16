import type {
  ArticleBatchStatus,
  ArticleStatus,
  ImportStatus,
  OperatorAlertKind,
  OperatorAlertStatus,
  OutreachStatus,
  SiteStatus,
  SubscriptionStatus,
  Vertical,
} from "@/generated/prisma/enums";
import type { AnalyticsSummaryDto } from "@/lib/analytics-contract";
import type {
  OperatorInvitationState,
  OperatorLeadStage,
  OperatorLeadStageStatus,
} from "@/lib/operator-lead-status";

export const BRIEF_SITE_LIMIT = 40;

export type CountMap<T extends string> = Record<T, number>;

export type OperatorSiteView = {
  slug: string;
  name: string;
  vertical: Vertical;
  status: SiteStatus;
  createdAt: string;
  ownerCount: number;
  subscriptionStatus: SubscriptionStatus | null;
  latestImportStatus: ImportStatus | null;
  pendingBookingRequestCount: number;
  domainCount: number;
  verifiedDomainCount: number;
  isPublished: boolean;
  pendingSourceSuggestionCount: number;
  draftArticleCount: number;
  publishedArticleCount: number;
  outreachPaused: boolean;
  invitationState: OperatorInvitationState;
  contentReview: {
    missingFields: Array<
      "name" | "description" | "address" | "phone" | "sourceUrl"
    >;
    heroImage: "missing" | "provenance_missing" | "provenance_recorded";
    translationCount: number;
    integrationCount: number;
    catalogItemCount: number;
  };
  blockers: Array<{
    stage: OperatorLeadStage;
    status: OperatorLeadStageStatus;
    label: string;
  }>;
};

export type OperatorAutonomySnapshot = {
  generatedAt: string;
  portfolio: {
    sites: number;
    signedUpSites: number;
    pendingBookingRequests: number;
    sitesByStatus: CountMap<SiteStatus>;
    sitesByVertical: CountMap<Vertical>;
    subscriptionsByStatus: CountMap<SubscriptionStatus>;
    analytics: AnalyticsSummaryDto;
  };
  alerts: {
    byStatus: CountMap<OperatorAlertStatus>;
    openByKind: CountMap<OperatorAlertKind>;
  };
  outreach: {
    globalPaused: boolean;
    pausedSiteCount: number;
    messagesByStatus: CountMap<OutreachStatus>;
  };
  content: {
    articlesByStatus: CountMap<ArticleStatus>;
    articleBatchesByStatus: CountMap<ArticleBatchStatus>;
    pendingSourceSuggestions: number;
  };
  sites: OperatorSiteView[];
};

export type AttentionItem = {
  severity: "info" | "action-for-human";
  code: string;
  summary: string;
  slugs: string[];
};

export function emptyCounts<T extends string>(
  values: readonly T[],
): CountMap<T> {
  return Object.fromEntries(values.map((value) => [value, 0])) as CountMap<T>;
}
