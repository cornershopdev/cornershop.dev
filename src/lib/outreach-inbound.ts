import "server-only";
import { getDb } from "@/lib/db";
import {
  extractEmailAddress,
  extractEmailAddresses,
  htmlToPlainText,
  normalizeRfcMessageId,
  outreachThreadKey,
  parseRfcMessageIds,
  type InboundAddressFields,
} from "@/lib/outreach-thread";
import { fetchReceivedResendEmail } from "@/lib/resend-receiving";
import { emailReplyTo } from "@/lib/email-identity";
import { listOutreachVerticals } from "@/lib/lead-generation/registry";
import type { VerticalId } from "@/lib/verticals/types";
import { lockOutreachDelivery, lockOutreachSite } from "@/lib/outreach-lock";

const INBOUND_SENDER_DOMAIN_ALLOWLIST = new Set([
  "genfeed.ai",
  "send.genfeed.ai",
]);

export type RecordInboundOutreachResult = {
  handled: boolean;
  created: boolean;
  retry: boolean;
  siteId: string | null;
  messageId: string | null;
};

export type InboundWebhookMetadata = {
  emailId: string;
  from: string;
  to: string[];
  subject: string;
  rfcMessageId: string | null;
  receivedFor: string[];
};

export async function recordInboundOutreachMessage(input: {
  eventId: string;
  occurredAt: Date;
  metadata: InboundWebhookMetadata;
}): Promise<RecordInboundOutreachResult> {
  const db = getDb();
  const existing = await db.outreachMessage.findUnique({
    where: { providerMessageId: input.metadata.emailId },
    select: { id: true, siteId: true },
  });
  if (existing) {
    return {
      handled: true,
      created: false,
      retry: false,
      siteId: existing.siteId,
      messageId: existing.id,
    };
  }

  const received = await fetchReceivedResendEmail(input.metadata.emailId);
  if (!received) {
    return {
      handled: false,
      created: false,
      retry: true,
      siteId: null,
      messageId: null,
    };
  }

  const headers = received.headers;
  const fields: InboundAddressFields = {
    from: received.from || input.metadata.from,
    to: received.to.length > 0 ? received.to : input.metadata.to,
    receivedFor:
      received.receivedFor.length > 0
        ? received.receivedFor
        : input.metadata.receivedFor,
    inReplyTo: headers["in-reply-to"] ?? null,
    references: headers.references ?? null,
    rfcMessageId: received.messageId ?? input.metadata.rfcMessageId,
  };
  const matched = await matchInboundOutreachThread(fields);
  if (!matched) {
    await recordUnmatchedInbound(db, {
      eventId: input.eventId,
      emailId: input.metadata.emailId,
      from: fields.from,
      occurredAt: input.occurredAt,
    });
    return {
      handled: false,
      created: false,
      retry: false,
      siteId: null,
      messageId: null,
    };
  }

  const textBody =
    received.text?.trim() ||
    (received.html ? htmlToPlainText(received.html) : "") ||
    received.subject ||
    input.metadata.subject ||
    "(empty reply)";
  const receivedAt = input.occurredAt;
  const rfcMessageId = fields.rfcMessageId
    ? normalizeRfcMessageId(fields.rfcMessageId)
    : `resend-inbound:${input.metadata.emailId}`;
  const fromAddress =
    extractEmailAddress(fields.from) ?? fields.from.toLowerCase();
  const toAddress =
    extractEmailAddresses(fields.to)[0] ??
    extractEmailAddresses(fields.receivedFor ?? [])[0] ??
    "unmatched@cornershop.dev";

  try {
    const persisted = await db.$transaction(async (tx) => {
      // Match the delivery lock order: global fence, then Site row. A reply
      // now commits wholly before a follow-up's final check or after its
      // already-started provider attempt, with no suppression gap.
      await lockOutreachDelivery(tx);
      await lockOutreachSite(tx, matched.siteId);
      const duplicate = await tx.outreachMessage.findUnique({
        where: { providerMessageId: input.metadata.emailId },
        select: { id: true, siteId: true },
      });
      if (duplicate) {
        return { created: false as const, message: duplicate };
      }

      const created = await tx.outreachMessage.create({
        data: {
          idempotencyKey: `resend-inbound:${input.metadata.emailId}`,
          siteId: matched.siteId,
          direction: "INBOUND",
          provider: "resend",
          providerMessageId: input.metadata.emailId,
          rfcMessageId,
          fromAddress,
          replyToAddress: null,
          toAddress,
          subject: received.subject || input.metadata.subject || "(no subject)",
          textBody,
          htmlBody: received.html,
          template: null,
          inReplyTo: fields.inReplyTo,
          threadKey: matched.threadKey,
          createdByActor: `lead:${fromAddress}`,
          status: "RECEIVED",
          receivedAt,
        },
        select: { id: true, siteId: true },
      });
      await tx.auditEvent.create({
        data: {
          type: "outreach.inbound.received",
          actor: `lead:${fromAddress}`,
          siteId: matched.siteId,
          metadata: {
            outreachMessageId: created.id,
            threadKey: matched.threadKey,
            providerMessageId: input.metadata.emailId,
          },
          createdAt: receivedAt,
        },
      });
      return { created: true as const, message: created };
    });
    if (!persisted.created) {
      return {
        handled: true,
        created: false,
        retry: false,
        siteId: persisted.message.siteId,
        messageId: persisted.message.id,
      };
    }
    return {
      handled: true,
      created: true,
      retry: false,
      siteId: matched.siteId,
      messageId: persisted.message.id,
    };
  } catch (error) {
    const duplicate = await db.outreachMessage.findUnique({
      where: { providerMessageId: input.metadata.emailId },
      select: { id: true, siteId: true },
    });
    if (duplicate) {
      return {
        handled: true,
        created: false,
        retry: false,
        siteId: duplicate.siteId,
        messageId: duplicate.id,
      };
    }
    throw error;
  }
}

export async function matchInboundOutreachThread(
  fields: InboundAddressFields,
): Promise<{ siteId: string; threadKey: string } | null> {
  const db = getDb();
  const tokens = inboundHeaderMessageIds({
    "in-reply-to": fields.inReplyTo ?? "",
    references: fields.references ?? "",
  });
  if (tokens.length === 0) return null;
  const byHeader = await db.outreachMessage.findFirst({
    where: {
      direction: "OUTBOUND",
      OR: [
        { rfcMessageId: { in: tokens } },
        { id: { in: tokens } },
        { providerMessageId: { in: tokens } },
        {
          threadKey: {
            in: tokens.map((token) =>
              token.startsWith("lead:") ? token : `lead:${token}`,
            ),
          },
        },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: { siteId: true, threadKey: true },
  });
  if (byHeader) {
    return {
      siteId: byHeader.siteId,
      threadKey: byHeader.threadKey ?? outreachThreadKey(byHeader.siteId),
    };
  }
  return null;
}

export function inboundRecipientVerticals(
  fields: InboundAddressFields,
): VerticalId[] {
  const recipients = extractEmailAddresses([
    ...fields.to,
    ...(fields.receivedFor ?? []),
  ]);
  return listOutreachVerticals().filter((vertical) => {
    const replyTo = emailReplyTo(vertical)?.toLowerCase();
    if (!replyTo) return false;
    return recipients.some((address) => matchesReplyTo(address, replyTo));
  });
}

function matchesReplyTo(address: string, replyTo: string): boolean {
  const replyDomain = replyTo.slice(replyTo.indexOf("@"));
  const replyLocal = replyTo.slice(0, replyTo.indexOf("@"));
  if (address === replyTo) return true;
  const at = address.indexOf("@");
  if (at < 0) return false;
  const local = address.slice(0, at);
  const domain = address.slice(at);
  return domain === replyDomain && local.startsWith(`${replyLocal}+`);
}

/** @deprecated Use `inboundRecipientVerticals`. */
export function isRestofrontInboundRecipient(
  fields: InboundAddressFields,
): boolean {
  return inboundRecipientVerticals(fields).includes("RESTAURANT");
}

export function inboundHeaderMessageIds(
  headers: Record<string, string>,
): string[] {
  return [
    ...parseRfcMessageIds(headers["in-reply-to"]),
    ...parseRfcMessageIds(headers.references),
  ];
}

export function isAllowlistedInboundSender(value: string): boolean {
  const email = extractEmailAddress(value);
  if (!email) return false;
  return INBOUND_SENDER_DOMAIN_ALLOWLIST.has(
    email.slice(email.lastIndexOf("@") + 1),
  );
}

async function recordUnmatchedInbound(
  db: ReturnType<typeof getDb>,
  input: {
    eventId: string;
    emailId: string;
    from: string;
    occurredAt: Date;
  },
): Promise<void> {
  const email = extractEmailAddress(input.from);
  const senderDomain = email?.slice(email.lastIndexOf("@") + 1) ?? null;
  const allowlisted = isAllowlistedInboundSender(input.from);
  const action = allowlisted ? "retained_at_provider" : "dropped";

  console.info("[outreach-inbound] unmatched email", {
    emailId: input.emailId,
    senderDomain,
    allowlisted,
    action,
  });
  try {
    await db.operatorAuditEvent.create({
      data: {
        type: allowlisted
          ? "outreach.inbound.allowlisted_unmatched"
          : "outreach.inbound.unmatched_dropped",
        actor: "system:resend-inbound",
        metadata: {
          eventId: input.eventId,
          emailId: input.emailId,
          senderDomain,
          allowlisted,
          action,
        },
        createdAt: input.occurredAt,
      },
    });
  } catch {
    console.error("[outreach-inbound] unmatched audit failed", {
      emailId: input.emailId,
      allowlisted,
    });
  }
}
