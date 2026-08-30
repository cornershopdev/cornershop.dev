import { emailReplyTo, emailSender } from "@/lib/email-identity";
import { listOutreachVerticals } from "@/lib/lead-generation/registry";
import { resolveVerticalConfig } from "@/lib/verticals/registry";
import type { VerticalId } from "@/lib/verticals/types";
import { configuredOutreachController } from "@/lib/electronic-outreach-eligibility";
import { approvedNominatimBaseUrl } from "@/lib/lead-discovery-places";
import { configuredOutreachInboundForwardTarget } from "@/lib/outreach-inbound-forward-policy";

export const OUTREACH_MIGRATIONS = [
  "20260819120000_outreach_inbound_mailbox",
  "20260820200000_site_contact_privacy_and_catalog_availability",
  "20260823100000_outreach_inbound_forward_outbox",
] as const;
export const RESTOFRONT_OUTREACH_FROM =
  "Vincent from Restofrontapp <vincent@send.restofront.com>";
export const RESTOFRONT_OUTREACH_REPLY_TO = "vincent@reply.restofront.com";
export const REQUIRED_RESEND_WEBHOOK_EVENTS = [
  "email.sent",
  "email.delivered",
  "email.bounced",
  "email.complained",
  "email.failed",
  "email.suppressed",
] as const;
export const REQUIRED_RESEND_INBOUND_WEBHOOK_EVENTS = [
  "email.received",
] as const;

type Environment = Record<string, string | undefined>;

export type OutreachEnvironmentReadiness = {
  ready: boolean;
  checks: {
    database: boolean;
    resendApiKey: boolean;
    resendDeliveryWebhookSecret: boolean;
    resendInboundWebhookSecret: boolean;
    claimTokenSecret: boolean;
    legalController: boolean;
    leadDiscoveryProvider: boolean;
    workflow: boolean;
    appOrigin: boolean;
    sender: boolean;
    replyTo: boolean;
    inboundForwardTarget: boolean;
  };
  missingOrInvalid: string[];
  webhookEndpoint: string | null;
  inboundWebhookEndpoint: string | null;
  verticals: Array<{
    vertical: VerticalId;
    brand: string;
    senderConfigured: boolean;
    replyToConfigured: boolean;
  }>;
};

export type ResendWebhookSummary = {
  endpoint: string;
  status: "enabled" | "disabled";
  events: string[] | null;
};

export type ResendDomainSummary = {
  name: string;
  status: string;
  capabilities?: { sending?: string; receiving?: string };
};

export function isOutreachPreflightReady(checks: {
  configurationReady: boolean;
  migrationApplied: boolean;
  schemaReady: boolean;
  workflowDatabaseReachable: boolean;
  deliveryWebhookRegistered: boolean;
  inboundWebhookRegistered: boolean;
}): boolean {
  return Object.values(checks).every(Boolean);
}

export function evaluateOutreachEnvironment(
  env: Environment,
  options: { expectedAppOrigin?: string } = {},
): OutreachEnvironmentReadiness {
  const webhookEndpoint = resolveWebhookEndpoint(env.NEXT_PUBLIC_APP_URL);
  const inboundWebhookEndpoint = resolveInboundWebhookEndpoint(
    env.NEXT_PUBLIC_APP_URL,
  );
  const verticals = listOutreachVerticals().map((vertical) => {
    const marketing = resolveVerticalConfig(vertical).marketing;
    const declaredSender = marketing.email?.from ?? env.EMAIL_FROM?.trim();
    const declaredReplyTo =
      marketing.email?.replyTo ?? env.EMAIL_REPLY_TO?.trim();
    return {
      vertical,
      brand: marketing.brand.name,
      senderConfigured:
        Boolean(declaredSender) &&
        emailSender(vertical, env) === declaredSender,
      replyToConfigured:
        Boolean(declaredReplyTo) &&
        emailReplyTo(vertical, env) === declaredReplyTo,
    };
  });
  const checks = {
    database: Boolean(env.DATABASE_URL),
    resendApiKey: Boolean(env.RESEND_API_KEY),
    resendDeliveryWebhookSecret: Boolean(env.RESEND_WEBHOOK_SECRET),
    resendInboundWebhookSecret:
      Boolean(env.RESEND_INBOUND_WEBHOOK_SECRET) &&
      env.RESEND_INBOUND_WEBHOOK_SECRET !== env.RESEND_WEBHOOK_SECRET,
    claimTokenSecret: Boolean(
      env.CLAIM_TOKEN_SECRET && env.CLAIM_TOKEN_SECRET.length >= 32,
    ),
    legalController: Boolean(configuredOutreachController(env)),
    leadDiscoveryProvider:
      Boolean(env.GOOGLE_PLACES_API_KEY?.trim()) ||
      Boolean(approvedNominatimBaseUrl(env.LEAD_DISCOVERY_NOMINATIM_BASE_URL)),
    workflow:
      env.WORKFLOW_ENABLED === "true" &&
      env.WORKFLOW_TARGET_WORLD === "@workflow/world-postgres" &&
      isPostgresUrl(env.WORKFLOW_POSTGRES_URL) &&
      env.WORKFLOW_POSTGRES_JOB_PREFIX === "cornershopdev_" &&
      isBoundedPositiveInteger(env.WORKFLOW_POSTGRES_MAX_POOL_SIZE) &&
      isBoundedPositiveInteger(env.WORKFLOW_POSTGRES_WORKER_CONCURRENCY),
    appOrigin:
      Boolean(webhookEndpoint) &&
      (!options.expectedAppOrigin ||
        webhookEndpoint === resolveWebhookEndpoint(options.expectedAppOrigin)),
    sender:
      verticals.length > 0 &&
      verticals.every((vertical) => vertical.senderConfigured),
    replyTo:
      verticals.length > 0 &&
      verticals.every((vertical) => vertical.replyToConfigured),
    inboundForwardTarget: isOptionalInboundForwardTargetValid(env),
  };
  const variableByCheck = {
    database: "DATABASE_URL",
    resendApiKey: "RESEND_API_KEY",
    resendDeliveryWebhookSecret: "RESEND_WEBHOOK_SECRET",
    resendInboundWebhookSecret:
      "RESEND_INBOUND_WEBHOOK_SECRET (present and distinct)",
    claimTokenSecret: "CLAIM_TOKEN_SECRET",
    legalController: "OUTREACH_LEGAL_CONTROLLER",
    leadDiscoveryProvider:
      "GOOGLE_PLACES_API_KEY|LEAD_DISCOVERY_NOMINATIM_BASE_URL",
    workflow: "WORKFLOW_*",
    appOrigin: "NEXT_PUBLIC_APP_URL",
    sender: "VERTICAL_OR_FACTORY_EMAIL_FROM",
    replyTo: "VERTICAL_OR_FACTORY_EMAIL_REPLY_TO",
    inboundForwardTarget: "OUTREACH_INBOUND_FORWARD_TO (optional but valid)",
  } satisfies Record<keyof typeof checks, string>;
  const missingOrInvalid = Object.entries(checks).flatMap(([name, ready]) =>
    ready ? [] : [variableByCheck[name as keyof typeof variableByCheck]],
  );

  return {
    ready: missingOrInvalid.length === 0,
    checks,
    missingOrInvalid,
    webhookEndpoint,
    inboundWebhookEndpoint,
    verticals,
  };
}

function isOptionalInboundForwardTargetValid(env: Environment): boolean {
  try {
    configuredOutreachInboundForwardTarget(env);
    return true;
  } catch {
    return false;
  }
}

export function hasRequiredResendDomains(
  domains: ResendDomainSummary[],
  env: Environment = process.env,
): boolean {
  return listOutreachVerticals().every((vertical) => {
    const senderDomain = emailDomain(emailSender(vertical, env));
    const replyTo = emailReplyTo(vertical, env);
    const replyDomain = replyTo ? emailDomain(replyTo) : null;
    if (!senderDomain || !replyDomain) return false;
    return (
      domains.some(
        (domain) =>
          domain.name.toLowerCase() === senderDomain &&
          domain.status === "verified" &&
          domain.capabilities?.sending === "enabled",
      ) &&
      domains.some(
        (domain) =>
          domain.name.toLowerCase() === replyDomain &&
          domain.status === "verified" &&
          domain.capabilities?.receiving === "enabled",
      )
    );
  });
}

function emailDomain(value: string): string | null {
  const match = value.toLowerCase().match(/<?[^<>\s@]+@([^<>\s]+)>?$/);
  return match?.[1]?.replace(/>$/, "") ?? null;
}

function isPostgresUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "postgres:" || url.protocol === "postgresql:";
  } catch {
    return false;
  }
}

function isBoundedPositiveInteger(value: string | undefined): boolean {
  if (!value || !/^\d+$/.test(value)) return false;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 100;
}

export function hasRequiredResendWebhook(
  webhooks: ResendWebhookSummary[],
  expectedEndpoint: string,
): boolean {
  return hasWebhookEvents(
    webhooks,
    expectedEndpoint,
    REQUIRED_RESEND_WEBHOOK_EVENTS,
  );
}

export function hasRequiredResendInboundWebhook(
  webhooks: ResendWebhookSummary[],
  expectedEndpoint: string,
): boolean {
  return hasWebhookEvents(
    webhooks,
    expectedEndpoint,
    REQUIRED_RESEND_INBOUND_WEBHOOK_EVENTS,
  );
}

function hasWebhookEvents(
  webhooks: ResendWebhookSummary[],
  expectedEndpoint: string,
  requiredEvents: readonly string[],
): boolean {
  return webhooks.some((webhook) => {
    if (webhook.status !== "enabled" || webhook.endpoint !== expectedEndpoint) {
      return false;
    }
    const events = new Set(webhook.events ?? []);
    return requiredEvents.every((event) => events.has(event));
  });
}

function resolveWebhookEndpoint(appUrl: string | undefined): string | null {
  return resolveHttpsPath(appUrl, "/api/webhooks/resend");
}

function resolveInboundWebhookEndpoint(
  appUrl: string | undefined,
): string | null {
  return resolveHttpsPath(appUrl, "/api/webhooks/resend/inbound");
}

function resolveHttpsPath(
  appUrl: string | undefined,
  pathname: string,
): string | null {
  if (!appUrl) return null;
  try {
    const url = new URL(pathname, appUrl);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}
