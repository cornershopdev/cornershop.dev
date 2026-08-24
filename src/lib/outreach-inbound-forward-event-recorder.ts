import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { enqueueOperatorAlert } from "@/lib/operator-alert-queue";
import {
  canApplyResendInboundForwardEvent,
  inboundForwardReceiptProvesProviderAcceptance,
  inboundForwardDeliveryFailureCode,
  RESEND_INBOUND_FORWARD_EVENT_TRANSITIONS,
  type ResendInboundForwardEventType,
} from "@/lib/outreach-inbound-forward-event-policy";
import { OUTREACH_INBOUND_FORWARD_EXHAUSTION_ALERT_TITLE } from "@/lib/outreach-inbound-forward-policy";

export type InboundForwardEventRecordResult = {
  handled: boolean;
  updated: number;
  reason?: "not_found" | "identity_conflict";
};

export async function recordResendInboundForwardEvent(
  input: {
    eventId: string;
    eventType: ResendInboundForwardEventType;
    occurredAt: Date;
    providerMessageId: string;
    taggedInboundForwardId?: string;
  },
  database: Pick<PrismaClient, "$transaction"> = getDb(),
): Promise<InboundForwardEventRecordResult> {
  return database.$transaction(async (tx) => {
    const select = {
      id: true,
      outreachMessageId: true,
      providerMessageId: true,
      providerEventAt: true,
      deliveryStatus: true,
      sentAt: true,
      attempts: true,
      firstProviderAttemptAt: true,
    } as const;
    const hasTaggedForward = input.taggedInboundForwardId !== undefined;
    const taggedForward = hasTaggedForward
      ? await tx.outreachInboundForward.findUnique({
          where: { id: input.taggedInboundForwardId },
          select,
        })
      : null;
    const providerForward = await tx.outreachInboundForward.findUnique({
      where: { providerMessageId: input.providerMessageId },
      select,
    });

    if (hasTaggedForward && !taggedForward) {
      return { handled: false, updated: 0, reason: "not_found" };
    }

    if (
      taggedForward &&
      ((taggedForward.providerMessageId &&
        taggedForward.providerMessageId !== input.providerMessageId) ||
        (providerForward && providerForward.id !== taggedForward.id))
    ) {
      await upsertProviderEventEvidence(tx, taggedForward.id, input);
      await enqueueIdentityConflictAlert(tx, taggedForward, input.occurredAt);
      return { handled: false, updated: 0, reason: "identity_conflict" };
    }

    const forward = hasTaggedForward ? taggedForward : providerForward;
    if (!forward) {
      return { handled: false, updated: 0, reason: "not_found" };
    }

    const transition = RESEND_INBOUND_FORWARD_EVENT_TRANSITIONS[input.eventType];
    await upsertProviderEventEvidence(tx, forward.id, input);

    let acceptanceUpdated = 0;
    if (inboundForwardReceiptProvesProviderAcceptance(input.eventType)) {
      const accepted = await tx.outreachInboundForward.updateMany({
        where: {
          id: forward.id,
          status: { in: ["PENDING", "EXHAUSTED"] },
          attempts: { gt: 0 },
          firstProviderAttemptAt: { not: null },
          OR: [
            { providerMessageId: input.providerMessageId },
            { providerMessageId: null },
          ],
        },
        data: {
          status: "SENT",
          sentAt: forward.sentAt ?? input.occurredAt,
          providerMessageId: input.providerMessageId,
          deliveryLeaseToken: null,
          deliveryLeaseUntil: null,
        },
      });
      acceptanceUpdated = accepted.count;
      if (accepted.count === 1) {
        await tx.outreachInboundForward.updateMany({
          where: {
            id: forward.id,
            status: "SENT",
            providerMessageId: input.providerMessageId,
            OR: [
              { lastFailureCode: null },
              {
                lastFailureCode: {
                  not: "provider_identity_conflict",
                },
              },
            ],
          },
          data: { lastFailureCode: null },
        });
        await reconcileSupersededExhaustionAlert(
          tx,
          forward,
          input.occurredAt,
        );
      }
    }

    if (
      !canApplyResendInboundForwardEvent({
        currentStatus: forward.deliveryStatus,
        currentEventAt: forward.providerEventAt,
        eventType: input.eventType,
        occurredAt: input.occurredAt,
      })
    ) {
      return { handled: true, updated: acceptanceUpdated };
    }

    const failureCode = inboundForwardDeliveryFailureCode(input.eventType);
    const updated = await tx.outreachInboundForward.updateMany({
      where: {
        id: forward.id,
        deliveryStatus: { in: [...transition.from] },
        attempts: { gt: 0 },
        firstProviderAttemptAt: { not: null },
        OR: [
          { providerMessageId: input.providerMessageId },
          { providerMessageId: null },
        ],
        AND: [
          {
            OR: [
              { providerEventAt: null },
              { providerEventAt: { lte: input.occurredAt } },
            ],
          },
        ],
      },
      data: {
        providerMessageId: input.providerMessageId,
        providerEventAt: input.occurredAt,
        deliveryStatus: transition.status,
        deliveredAt:
          transition.status === "DELIVERED" ? input.occurredAt : undefined,
        deliveryFailureCode: failureCode,
      },
    });
    if (updated.count === 1 && failureCode) {
      await enqueueOperatorAlert(tx, {
        kind: "OUTREACH_SEND_FAILURE",
        dedupKey: `inbound-forward-delivery:${forward.id}`,
        title: "Inbound read-copy delivery failed",
        message:
          "A provider accepted an inbound read copy but later reported a terminal delivery failure. The Postgres/admin outreach thread remains authoritative.",
        context: {
          forwardId: forward.id,
          outreachMessageId: forward.outreachMessageId,
          failureCode,
        },
        occurredAt: input.occurredAt,
      });
    }
    if (updated.count === 0) {
      const current = await tx.outreachInboundForward.findUnique({
        where: { id: forward.id },
        select,
      });
      if (
        current?.providerMessageId &&
        current.providerMessageId !== input.providerMessageId
      ) {
        await enqueueIdentityConflictAlert(tx, current, input.occurredAt);
        return {
          handled: false,
          updated: 0,
          reason: "identity_conflict",
        };
      }
    }
    return {
      handled: true,
      updated: Math.max(acceptanceUpdated, updated.count),
    };
  });
}

async function reconcileSupersededExhaustionAlert(
  tx: Pick<Prisma.TransactionClient, "operatorAlert">,
  forward: { id: string; outreachMessageId: string },
  occurredAt: Date,
) {
  const alertIdentity = {
    kind: "OUTREACH_SEND_FAILURE" as const,
    title: OUTREACH_INBOUND_FORWARD_EXHAUSTION_ALERT_TITLE,
    context: { path: ["forwardId"], equals: forward.id },
  };
  const existing = await tx.operatorAlert.findFirst({
    where: alertIdentity,
    select: { id: true },
  });
  await tx.operatorAlert.deleteMany({
    where: {
      ...alertIdentity,
      status: { in: ["PENDING", "EXHAUSTED"] },
    },
  });
  if (!existing) return;
  await enqueueOperatorAlert(tx, {
    kind: "OUTREACH_SEND_FAILURE",
    dedupKey: `inbound-forward-acceptance-reconciled:${forward.id}`,
    title: "Inbound read-copy acceptance reconciled",
    message:
      "A late signed positive provider receipt repaired an inbound read copy previously reported as exhausted. No additional copy was sent; the Postgres/admin outreach thread remains authoritative.",
    context: {
      forwardId: forward.id,
      outreachMessageId: forward.outreachMessageId,
      failureCode: "provider_acceptance_reconciled",
    },
    occurredAt,
  });
}

async function upsertProviderEventEvidence(
  tx: Pick<Prisma.TransactionClient, "outreachForwardProviderEvent">,
  forwardId: string,
  input: {
    eventId: string;
    eventType: ResendInboundForwardEventType;
    occurredAt: Date;
    providerMessageId: string;
  },
) {
  const transition = RESEND_INBOUND_FORWARD_EVENT_TRANSITIONS[input.eventType];
  const event = await tx.outreachForwardProviderEvent.upsert({
    where: { id: input.eventId },
    update: {},
    create: {
      id: input.eventId,
      forwardId,
      providerMessageId: input.providerMessageId,
      eventType: input.eventType,
      deliveryStatus: transition.status,
      occurredAt: input.occurredAt,
    },
    select: {
      forwardId: true,
      providerMessageId: true,
      eventType: true,
      occurredAt: true,
    },
  });
  if (
    event.forwardId !== forwardId ||
    event.providerMessageId !== input.providerMessageId ||
    event.eventType !== input.eventType ||
    event.occurredAt.getTime() !== input.occurredAt.getTime()
  ) {
    throw new Error("Resend inbound forward event identity mismatch");
  }
}

async function enqueueIdentityConflictAlert(
  tx: Pick<Prisma.TransactionClient, "operatorAlert">,
  forward: { id: string; outreachMessageId: string },
  occurredAt: Date,
) {
  await enqueueOperatorAlert(tx, {
    kind: "OUTREACH_SEND_FAILURE",
    dedupKey: `inbound-forward-identity:${forward.id}`,
    title: "Inbound read-copy provider identity conflict",
    message:
      "A signed provider event did not match the provider identity bound to an inbound read copy. The event was isolated without changing the authoritative outreach thread.",
    context: {
      forwardId: forward.id,
      outreachMessageId: forward.outreachMessageId,
      failureCode: "provider_identity_conflict",
    },
    occurredAt,
  });
}
