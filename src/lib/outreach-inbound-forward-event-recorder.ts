import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { enqueueOperatorAlert } from "@/lib/operator-alert-queue";
import {
  canApplyResendInboundForwardEvent,
  inboundForwardDeliveryFailureCode,
  RESEND_INBOUND_FORWARD_EVENT_TRANSITIONS,
  type ResendInboundForwardEventType,
} from "@/lib/outreach-inbound-forward-event-policy";

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

    if (
      !canApplyResendInboundForwardEvent({
        currentStatus: forward.deliveryStatus,
        currentEventAt: forward.providerEventAt,
        eventType: input.eventType,
        occurredAt: input.occurredAt,
      })
    ) {
      return { handled: true, updated: 0 };
    }

    const failureCode = inboundForwardDeliveryFailureCode(input.eventType);
    const updated = await tx.outreachInboundForward.updateMany({
      where: {
        id: forward.id,
        deliveryStatus: { in: [...transition.from] },
        OR: [
          { providerMessageId: null },
          { providerMessageId: input.providerMessageId },
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
    return { handled: true, updated: updated.count };
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
