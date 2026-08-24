import { normalizeAccountEmail } from "@/lib/account-email";
import { emailReplyTo } from "@/lib/email-identity";
import { listOutreachVerticals } from "@/lib/lead-generation/registry";
import { extractEmailAddress } from "@/lib/outreach-thread";

export const OUTREACH_INBOUND_FORWARD_MAX_ATTEMPTS = 3;
export const OUTREACH_INBOUND_FORWARD_LEASE_MS = 2 * 60_000;
export const OUTREACH_INBOUND_FORWARD_BATCH_SIZE = 5;
export const OUTREACH_INBOUND_FORWARD_BODY_MAX_LENGTH = 100_000;
export const OUTREACH_INBOUND_FORWARD_SUBJECT_MAX_LENGTH = 240;
export const OUTREACH_INBOUND_FORWARD_EXHAUSTION_ALERT_TITLE =
  "Inbound read-copy forwarding exhausted";

const RETRY_DELAYS_MS = [60_000, 5 * 60_000] as const;

type Environment = Record<string, string | undefined>;

export type InboundForwardDeliveryOutcome =
  | "sent"
  | "pending"
  | "exhausted"
  | "deduplicated"
  | "configuration-invalid";

export function inboundForwardingConfigured(
  env: Environment = process.env,
): boolean {
  return Boolean(env.OUTREACH_INBOUND_FORWARD_TO?.trim());
}

/**
 * Resolves exactly one bare operator mailbox. Receiving-domain and message
 * participants are rejected so a read copy cannot recursively re-enter the
 * inbound outreach webhook or accidentally be sent back to the lead.
 */
export function configuredOutreachInboundForwardTarget(
  env: Environment = process.env,
  blockedAddresses: string[] = [],
): string | null {
  const raw = env.OUTREACH_INBOUND_FORWARD_TO?.trim();
  if (!raw) return null;
  if (
    raw.length > 320 ||
    /[\r\n,]/.test(raw) ||
    raw.includes("<") ||
    raw.includes(">")
  ) {
    throw invalidForwardTarget();
  }

  let target: string;
  try {
    target = normalizeAccountEmail(raw);
  } catch {
    throw invalidForwardTarget();
  }

  const receivingDomains = new Set(
    listOutreachVerticals().flatMap((vertical) => {
      const replyTo = emailReplyTo(vertical, env);
      const domain = replyTo
        ? emailDomain(extractEmailAddress(replyTo) ?? "")
        : null;
      return domain ? [domain] : [];
    }),
  );
  const targetDomain = emailDomain(target);
  if (!targetDomain || receivingDomains.has(targetDomain)) {
    throw invalidForwardTarget();
  }

  const normalizedBlocked = new Set(
    blockedAddresses.flatMap((address) => {
      try {
        return [normalizeAccountEmail(address)];
      } catch {
        return [];
      }
    }),
  );
  if (normalizedBlocked.has(target)) throw invalidForwardTarget();
  return target;
}

export function inboundForwardFailureState(
  attempt: number,
  now: Date,
):
  | { status: "PENDING"; nextAttemptAt: Date }
  | { status: "EXHAUSTED" } {
  if (attempt >= OUTREACH_INBOUND_FORWARD_MAX_ATTEMPTS) {
    return { status: "EXHAUSTED" };
  }
  const delay = RETRY_DELAYS_MS[attempt - 1];
  if (delay === undefined) return { status: "EXHAUSTED" };
  return { status: "PENDING", nextAttemptAt: new Date(now.getTime() + delay) };
}

export async function dispatchInboundForwardBatch(
  ids: string[],
  deliver: (id: string) => Promise<InboundForwardDeliveryOutcome>,
): Promise<Record<InboundForwardDeliveryOutcome, number>> {
  const totals = emptyInboundForwardOutcomes();
  for (const id of ids) {
    try {
      totals[await deliver(id)] += 1;
    } catch {
      totals.pending += 1;
    }
  }
  return totals;
}

export function emptyInboundForwardOutcomes(): Record<
  InboundForwardDeliveryOutcome,
  number
> {
  return {
    sent: 0,
    pending: 0,
    exhausted: 0,
    deduplicated: 0,
    "configuration-invalid": 0,
  };
}

export function buildInboundForwardEmail(input: {
  inboundForwardId: string;
  senderAddress: string;
  targetAddress: string;
  siteName: string;
  siteSlug: string;
  sourceAddress: string;
  originalSubject: string;
  textBody: string;
  outreachMessageId: string;
}): {
  from: string;
  to: string;
  subject: string;
  text: string;
  tags: Array<{ name: string; value: string }>;
} {
  const siteName = boundedHeader(input.siteName, 120) || "Unnamed lead";
  const siteSlug = boundedHeader(input.siteSlug, 100) || "unknown-lead";
  const sourceAddress = boundedHeader(input.sourceAddress, 320) || "unknown";
  const originalSubject =
    boundedHeader(input.originalSubject, 200) || "(no subject)";
  const body = boundedBody(input.textBody);
  const subject = boundedHeader(
    `[Read copy: ${siteName} / ${siteSlug}] ${originalSubject}`,
    OUTREACH_INBOUND_FORWARD_SUBJECT_MAX_LENGTH,
  );

  return {
    from: input.senderAddress,
    to: input.targetAddress,
    subject,
    text: [
      "READ-ONLY COPY",
      "Reply from the Cornershopdev admin panel to preserve the outreach thread.",
      "",
      `Lead: ${siteName}`,
      `Slug: ${siteSlug}`,
      `From: ${sourceAddress}`,
      `Subject: ${originalSubject}`,
      "",
      body,
    ].join("\n"),
    tags: [
      { name: "category", value: "outreach_inbound_forward" },
      {
        name: "outreach_inbound_forward_id",
        value: input.inboundForwardId,
      },
      { name: "outreach_message_id", value: input.outreachMessageId },
    ],
  };
}

export function boundedForwardContext(value: string, maxLength: number): string {
  return boundedHeader(value, maxLength);
}

function boundedHeader(value: string, maxLength: number): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function boundedBody(value: string): string {
  const normalized = value.replaceAll("\u0000", "").trim();
  if (normalized.length <= OUTREACH_INBOUND_FORWARD_BODY_MAX_LENGTH) {
    return normalized || "(empty reply)";
  }
  return `${normalized.slice(0, OUTREACH_INBOUND_FORWARD_BODY_MAX_LENGTH)}\n\n[Read copy truncated]`;
}

function emailDomain(address: string): string | null {
  const at = address.lastIndexOf("@");
  return at > 0 ? address.slice(at + 1).toLowerCase() : null;
}

function invalidForwardTarget(): Error {
  return new Error(
    "OUTREACH_INBOUND_FORWARD_TO must be one valid operator mailbox outside every inbound receiving domain.",
  );
}
