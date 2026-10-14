import type { Vertical } from "@/generated/prisma/enums";
import {
  isVerticalClaimEnabled,
  isVerticalPubliclyAccessible,
  listVerticalIds,
  verticalLaunchReadiness,
} from "@/lib/verticals/registry";
import {
  KILL_CRITERIA,
  LAUNCH_STATEMENT,
  OPERATOR_AGENT_MAY,
  OPERATOR_AGENT_MUST_NOT,
  OPERATOR_HUMAN_GATES,
} from "@/lib/operator-autonomy/contract";
import {
  BRIEF_SITE_LIMIT,
  type AttentionItem,
  type OperatorAutonomySnapshot,
  type OperatorSiteView,
} from "@/lib/operator-autonomy/types";

export type DailyBrief = {
  generatedAt: string;
  launch: {
    status: "blocked";
    statement: string;
    agentMay: readonly string[];
    agentMustNot: readonly string[];
    humanGates: readonly string[];
  };
  killCriteria: Array<{
    id: (typeof KILL_CRITERIA)[number]["id"];
    statement: string;
    status: "unmeasured";
  }>;
  verticals: Array<{
    id: Vertical;
    publiclyAccessible: boolean;
    publiclyLaunched: boolean;
    claimEnabled: boolean;
    launchIssues: string[];
  }>;
  portfolio: OperatorAutonomySnapshot["portfolio"];
  alerts: OperatorAutonomySnapshot["alerts"];
  outreach: OperatorAutonomySnapshot["outreach"];
  content: OperatorAutonomySnapshot["content"];
  attention: AttentionItem[];
  sites: OperatorSiteView[];
  omittedSiteCount: number;
};

export function buildDailyBrief(
  snapshot: OperatorAutonomySnapshot,
): DailyBrief {
  const sites = snapshot.sites.slice(0, BRIEF_SITE_LIMIT);
  return {
    generatedAt: snapshot.generatedAt,
    launch: {
      status: "blocked",
      statement: LAUNCH_STATEMENT,
      agentMay: OPERATOR_AGENT_MAY,
      agentMustNot: OPERATOR_AGENT_MUST_NOT,
      humanGates: OPERATOR_HUMAN_GATES,
    },
    killCriteria: KILL_CRITERIA.map((criterion) => ({
      ...criterion,
      status: "unmeasured" as const,
    })),
    verticals: listVerticalIds().map((id) => {
      const readiness = verticalLaunchReadiness(id);
      return {
        id,
        publiclyAccessible: isVerticalPubliclyAccessible(id),
        publiclyLaunched: readiness.ready,
        claimEnabled: isVerticalClaimEnabled(id),
        launchIssues: readiness.issues,
      };
    }),
    portfolio: snapshot.portfolio,
    alerts: snapshot.alerts,
    outreach: snapshot.outreach,
    content: snapshot.content,
    attention: buildAttention(snapshot),
    sites,
    omittedSiteCount: Math.max(0, snapshot.sites.length - sites.length),
  };
}

function buildAttention(snapshot: OperatorAutonomySnapshot): AttentionItem[] {
  const items: AttentionItem[] = [
    {
      severity: "info",
      code: "launch-blocked",
      summary:
        "Autonomous launch stays blocked until the operator records the one-city concierge test.",
      slugs: [],
    },
  ];

  if ((snapshot.alerts.byStatus.EXHAUSTED ?? 0) > 0) {
    items.push({
      severity: "action-for-human",
      code: "alerts-exhausted",
      summary: `${snapshot.alerts.byStatus.EXHAUSTED} operator alerts are exhausted. Run the alert dispatcher and read the operator console.`,
      slugs: [],
    });
  }

  if ((snapshot.alerts.byStatus.PENDING ?? 0) > 0) {
    items.push({
      severity: "action-for-human",
      code: "alerts-pending",
      summary: `${snapshot.alerts.byStatus.PENDING} operator alerts are waiting for delivery.`,
      slugs: [],
    });
  }

  if (!snapshot.outreach.globalPaused) {
    items.push({
      severity: "info",
      code: "outreach-not-paused",
      summary:
        "The global outreach pause is off. The agent still must not send mail.",
      slugs: [],
    });
  }

  pushSlugItem(items, snapshot.sites, {
    code: "import-failed",
    severity: "action-for-human",
    summary: "sites have a failed import.",
    match: (site) => site.latestImportStatus === "FAILED",
  });
  pushSlugItem(items, snapshot.sites, {
    code: "subscription-past-due",
    severity: "action-for-human",
    summary: "sites have a past-due subscription.",
    match: (site) => site.subscriptionStatus === "PAST_DUE",
  });
  pushSlugItem(items, snapshot.sites, {
    code: "source-suggestions-pending",
    severity: "action-for-human",
    summary: "sites have source-monitor suggestions waiting for the owner.",
    match: (site) => site.pendingSourceSuggestionCount > 0,
  });
  pushSlugItem(items, snapshot.sites, {
    code: "owner-publish-ready",
    severity: "info",
    summary: "sites are ready for the owner to publish. The agent must not publish.",
    match: (site) =>
      site.blockers.some(
        (blocker) => blocker.stage === "publish" && blocker.status === "ready",
      ),
  });

  if ((snapshot.content.articleBatchesByStatus.FAILED ?? 0) > 0) {
    items.push({
      severity: "action-for-human",
      code: "article-batch-failed",
      summary: `${snapshot.content.articleBatchesByStatus.FAILED} article batches failed.`,
      slugs: [],
    });
  }

  if (snapshot.sites.length > BRIEF_SITE_LIMIT) {
    items.push({
      severity: "info",
      code: "site-list-truncated",
      summary: `The brief includes ${BRIEF_SITE_LIMIT} of ${snapshot.sites.length} sites. Ask read_site_operations for one slug.`,
      slugs: [],
    });
  }

  return items;
}

function pushSlugItem(
  items: AttentionItem[],
  sites: OperatorSiteView[],
  input: {
    code: string;
    severity: AttentionItem["severity"];
    summary: string;
    match: (site: OperatorSiteView) => boolean;
  },
) {
  const slugs = sites.filter(input.match).map((site) => site.slug);
  if (slugs.length === 0) return;
  items.push({
    severity: input.severity,
    code: input.code,
    summary: `${slugs.length} ${input.summary}`,
    slugs,
  });
}
