import "server-only";
import type {
  OutreachDirection,
  OutreachInboundForwardDeliveryStatus,
  OutreachInboundForwardStatus,
  OutreachStatus,
} from "@/generated/prisma/enums";
import { getDb } from "@/lib/db";
import { maskAccountEmail } from "@/lib/session";

export const OUTREACH_INBOX_PAGE_SIZE = 100;

const FAILED_MESSAGE_STATUSES = [
  "BOUNCED",
  "COMPLAINED",
  "FAILED",
] satisfies OutreachStatus[];

const FAILED_FORWARD_DELIVERY_STATUSES = [
  "BOUNCED",
  "COMPLAINED",
  "SUPPRESSED",
  "FAILED",
] satisfies OutreachInboundForwardDeliveryStatus[];

export type OutreachInboxForwardDto = {
  status: OutreachInboundForwardStatus;
  deliveryStatus: OutreachInboundForwardDeliveryStatus;
  attempts: number;
  lastFailureCode: string | null;
  deliveryFailureCode: string | null;
};

export type OutreachInboxMessageDto = {
  id: string;
  direction: OutreachDirection;
  status: OutreachStatus;
  provider: string;
  siteId: string;
  siteName: string | null;
  siteSlug: string | null;
  counterparty: string;
  subject: string | null;
  template: string | null;
  error: string | null;
  occurredAt: string;
  createdAt: string;
  forward: OutreachInboxForwardDto | null;
};

export type OutreachInboxSequenceDto = {
  id: string;
  siteId: string;
  siteName: string | null;
  siteSlug: string | null;
  template: string;
  recipient: string;
  status: OutreachStatus;
  attempt: number;
  reviewedAt: string | null;
  requestedBy: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OutreachInboxCounts = {
  sends: number;
  replies: number;
  sequences: number;
  failedMessages: number;
  stalledForwards: number;
};

export type OutreachInboxDto = {
  messages: OutreachInboxMessageDto[];
  sequences: OutreachInboxSequenceDto[];
  counts: OutreachInboxCounts;
  messagesTruncated: boolean;
  sequencesTruncated: boolean;
};

function maskAddress(address: string | null): string {
  if (!address) return "hidden";
  return maskAccountEmail(address);
}

export async function getOutreachInbox(): Promise<OutreachInboxDto> {
  const db = getDb();
  // Operators need delivery state, not a usable restaurant mailbox. Every
  // address is masked, and message bodies are never selected at all: a reply
  // body carries the sender's own signature block, so leaving it unread is a
  // stronger boundary than masking it after the fact.
  const [
    messages,
    sequences,
    sends,
    replies,
    sequenceTotal,
    failedMessages,
    stalledForwards,
  ] = await Promise.all([
    db.outreachMessage.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: OUTREACH_INBOX_PAGE_SIZE,
      select: {
        id: true,
        direction: true,
        status: true,
        provider: true,
        siteId: true,
        fromAddress: true,
        toAddress: true,
        subject: true,
        template: true,
        error: true,
        sentAt: true,
        receivedAt: true,
        createdAt: true,
        site: { select: { name: true, slug: true } },
        inboundForward: {
          select: {
            status: true,
            deliveryStatus: true,
            attempts: true,
            lastFailureCode: true,
            deliveryFailureCode: true,
          },
        },
      },
    }),
    db.outreachDispatch.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: OUTREACH_INBOX_PAGE_SIZE,
      select: {
        id: true,
        siteId: true,
        template: true,
        recipient: true,
        status: true,
        attempt: true,
        reviewedAt: true,
        requestedBy: true,
        error: true,
        createdAt: true,
        updatedAt: true,
        site: { select: { name: true, slug: true } },
      },
    }),
    db.outreachMessage.count({ where: { direction: "OUTBOUND" } }),
    db.outreachMessage.count({ where: { direction: "INBOUND" } }),
    db.outreachDispatch.count(),
    db.outreachMessage.count({
      where: { status: { in: FAILED_MESSAGE_STATUSES } },
    }),
    db.outreachInboundForward.count({
      where: {
        OR: [
          { deliveryStatus: { in: FAILED_FORWARD_DELIVERY_STATUSES } },
          { status: "EXHAUSTED" },
        ],
      },
    }),
  ]);

  return {
    messages: messages.map((message) => ({
      id: message.id,
      direction: message.direction,
      status: message.status,
      provider: message.provider,
      siteId: message.siteId,
      siteName: message.site?.name ?? null,
      siteSlug: message.site?.slug ?? null,
      counterparty: maskAddress(
        message.direction === "INBOUND"
          ? message.fromAddress
          : message.toAddress,
      ),
      subject: message.subject,
      template: message.template,
      error: message.error,
      occurredAt: (
        message.sentAt ??
        message.receivedAt ??
        message.createdAt
      ).toISOString(),
      createdAt: message.createdAt.toISOString(),
      forward: message.inboundForward
        ? {
            status: message.inboundForward.status,
            deliveryStatus: message.inboundForward.deliveryStatus,
            attempts: message.inboundForward.attempts,
            lastFailureCode: message.inboundForward.lastFailureCode,
            deliveryFailureCode: message.inboundForward.deliveryFailureCode,
          }
        : null,
    })),
    sequences: sequences.map((sequence) => ({
      id: sequence.id,
      siteId: sequence.siteId,
      siteName: sequence.site?.name ?? null,
      siteSlug: sequence.site?.slug ?? null,
      template: sequence.template,
      recipient: maskAddress(sequence.recipient),
      status: sequence.status,
      attempt: sequence.attempt,
      reviewedAt: sequence.reviewedAt?.toISOString() ?? null,
      requestedBy: sequence.requestedBy,
      error: sequence.error,
      createdAt: sequence.createdAt.toISOString(),
      updatedAt: sequence.updatedAt.toISOString(),
    })),
    counts: {
      sends,
      replies,
      sequences: sequenceTotal,
      failedMessages,
      stalledForwards,
    },
    messagesTruncated: sends + replies > messages.length,
    sequencesTruncated: sequenceTotal > sequences.length,
  };
}
