import type { OperatorSiteView } from "@/lib/operator-autonomy/types";

export const LEAD_EMAIL_BLOCKERS = [
  {
    id: "consent",
    statement:
      "Eligibility stays unknown until verified written-consent or soft-opt-in evidence names the exact recipient. A public inbox is not consent.",
  },
  {
    id: "review",
    statement:
      "An operator must review the current private preview before any delivery.",
  },
  {
    id: "pause",
    statement:
      "The global outreach pause and the lead pause are checked before every send. This operator cannot lift them.",
  },
  {
    id: "production",
    statement:
      "A claim email needs the configured sender, Resend webhooks, claim secret, and the deployed image that contains this path. This assessment does not prove production is current.",
  },
  {
    id: "hold",
    statement: "The first-customer decision remains hold. Do not invite or charge.",
  },
  {
    id: "authorization",
    statement:
      "The owner must consent to the invitation, approve the €49 monthly offer and live checkout, confirm the menu and booking links, authorize DNS, and approve publish.",
  },
] as const;

export type LeadEmailBlockerId = (typeof LEAD_EMAIL_BLOCKERS)[number]["id"];

export type LeadDeliveryAssessment = {
  preview: {
    status: "ready";
    statement: string;
    command: "operator:prepare-lead";
  };
  email: {
    status: "blocked";
    statement: string;
    blockers: Array<{
      id: LeadEmailBlockerId;
      statement: string;
    }>;
  };
};

export function assessLeadDelivery(): LeadDeliveryAssessment {
  return {
    preview: {
      status: "ready",
      statement:
        "A private preview can be generated from a public http or https source on a loopback database. The command never sends mail, publishes, charges, or changes DNS.",
      command: "operator:prepare-lead",
    },
    email: {
      status: "blocked",
      statement:
        "A claim email cannot be sent from this operator. No input can clear this block.",
      blockers: LEAD_EMAIL_BLOCKERS.map((blocker) => ({
        id: blocker.id,
        statement: blocker.statement,
      })),
    },
  };
}

export function assessSiteLeadDelivery(site: OperatorSiteView): {
  slug: string;
  previewGenerated: boolean;
  email: "blocked";
  emailBlockerIds: LeadEmailBlockerId[];
} {
  return {
    slug: site.slug,
    previewGenerated: site.latestImportStatus === "READY",
    email: "blocked",
    emailBlockerIds: LEAD_EMAIL_BLOCKERS.map((blocker) => blocker.id),
  };
}

export function summarizeLeadDelivery(sites: readonly OperatorSiteView[]): LeadDeliveryAssessment & {
  sitesInWindow: number;
  previewsGenerated: number;
} {
  return {
    ...assessLeadDelivery(),
    sitesInWindow: sites.length,
    previewsGenerated: sites.filter((site) => site.latestImportStatus === "READY")
      .length,
  };
}
