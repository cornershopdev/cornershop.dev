import "server-only";
import { normalizeAccountEmail } from "@/lib/account-email";
import { getDb } from "@/lib/db";
import { captureOperatorAlert } from "@/lib/operator-alerts";
import {
  extractEmailAddress,
  extractEmailAddresses,
  htmlToPlainText,
  inboundThreadTokens,
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
import { enqueueOutreachInboundForward } from "@/lib/outreach-inbound-forward";

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
    select: { id: true, siteId: true, fromAddress: true, toAddress: true },
  });
  if (existing) {
    await enqueueOutreachInboundForward(db, {
      outreachMessageId: existing.id,
      siteId: existing.siteId,
      fromAddress: existing.fromAddress,
      toAddress: existing.toAddress,
    });
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
    await captureOperatorAlert({
      kind: "OUTREACH_REPLY",
      dedupKey: `inbound-unmatched:${input.metadata.emailId}`,
      title: "Inbound outreach reply could not be matched",
      message:
        "A signed inbound email did not match a configured outreach thread. Inspect the From/To headers and mailbox.",
      context: {
        emailId: input.metadata.emailId,
        from: fields.from,
      },
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
        select: {
          id: true,
          siteId: true,
          fromAddress: true,
          toAddress: true,
        },
      });
      if (duplicate) {
        await enqueueOutreachInboundForward(tx, {
          outreachMessageId: duplicate.id,
          siteId: duplicate.siteId,
          fromAddress: duplicate.fromAddress,
          toAddress: duplicate.toAddress,
        });
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
      await enqueueOutreachInboundForward(tx, {
        outreachMessageId: created.id,
        siteId: matched.siteId,
        fromAddress,
        toAddress,
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
    await captureOperatorAlert({
      kind: "OUTREACH_REPLY",
      dedupKey: `inbound:${input.metadata.emailId}`,
      title: "A lead replied",
      message:
        "An inbound reply was stored on the lead thread. Follow-up campaign sends are stopped; reply from /admin.",
      context: {
        siteId: matched.siteId,
        outreachMessageId: persisted.message.id,
      },
      occurredAt: receivedAt,
    });
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
      select: { id: true, siteId: true, fromAddress: true, toAddress: true },
    });
    if (duplicate) {
      await enqueueOutreachInboundForward(db, {
        outreachMessageId: duplicate.id,
        siteId: duplicate.siteId,
        fromAddress: duplicate.fromAddress,
        toAddress: duplicate.toAddress,
      });
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
  const tokens = inboundThreadTokens(fields);
  if (tokens.length > 0) {
    const byHeader = await db.outreachMessage.findFirst({
      where: {
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

    const plusTags = tokens.filter((token) => !token.includes("@"));
    const recipientVerticals = inboundRecipientVerticals(fields);
    if (plusTags.length > 0 && recipientVerticals.length > 0) {
      const byPlus = await db.site.findFirst({
        where: {
          vertical: { in: recipientVerticals },
          OR: [{ slug: { in: plusTags } }, { id: { in: plusTags } }],
        },
        orderBy: { updatedAt: "desc" },
        select: { id: true },
      });
      if (byPlus) {
        return {
          siteId: byPlus.id,
          threadKey: outreachThreadKey(byPlus.id),
        };
      }
    }
  }

  const from = safeEmail(fields.from);
  const recipientVerticals = inboundRecipientVerticals(fields);
  if (!from || recipientVerticals.length === 0) return null;
  const byContact = await db.site.findMany({
    where: {
      vertical: { in: recipientVerticals },
      leadContactEmail: from,
    },
    orderBy: { updatedAt: "desc" },
    take: 2,
    select: { id: true },
  });
  if (byContact.length !== 1) return null;
  return {
    siteId: byContact[0]!.id,
    threadKey: outreachThreadKey(byContact[0]!.id),
  };
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

function safeEmail(value: string): string | null {
  const extracted = extractEmailAddress(value);
  if (!extracted) return null;
  try {
    return normalizeAccountEmail(extracted);
  } catch {
    return extracted;
  }
}

export function inboundHeaderMessageIds(
  headers: Record<string, string>,
): string[] {
  return [
    ...parseRfcMessageIds(headers["in-reply-to"]),
    ...parseRfcMessageIds(headers.references),
  ];
}
