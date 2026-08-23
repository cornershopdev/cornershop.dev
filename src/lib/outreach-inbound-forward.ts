import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { emailSender } from "@/lib/email-identity";
import { enqueueOperatorAlert } from "@/lib/operator-alert-queue";
import {
  isDefinitiveResendRejection,
  PROVIDER_IDEMPOTENCY_WINDOW_MS,
} from "@/lib/outreach-delivery-policy";
import {
  boundedForwardContext,
  buildInboundForwardEmail,
  configuredOutreachInboundForwardTarget,
  dispatchInboundForwardBatch,
  emptyInboundForwardOutcomes,
  inboundForwardFailureState,
  inboundForwardingConfigured,
  OUTREACH_INBOUND_FORWARD_BATCH_SIZE,
  OUTREACH_INBOUND_FORWARD_LEASE_MS,
  OUTREACH_INBOUND_FORWARD_MAX_ATTEMPTS,
  type InboundForwardDeliveryOutcome,
} from "@/lib/outreach-inbound-forward-policy";
import { sendBoundedResendEmail } from "@/lib/resend";

type Environment = Record<string, string | undefined>;
type ForwardQueueDb = Pick<
  Prisma.TransactionClient,
  "outreachInboundForward" | "site"
>;

export async function enqueueOutreachInboundForward(
  db: ForwardQueueDb,
  input: {
    outreachMessageId: string;
    siteId: string;
    fromAddress: string;
    toAddress: string;
  },
  env: Environment = process.env,
): Promise<boolean> {
  if (!inboundForwardingConfigured(env)) return false;

  let targetAddress: string | null = null;
  let lastFailureCode: string | null = null;
  try {
    targetAddress = configuredOutreachInboundForwardTarget(env, [
      input.fromAddress,
      input.toAddress,
    ]);
  } catch {
    lastFailureCode = "configuration_invalid";
  }

  const site = await db.site.findUniqueOrThrow({
    where: { id: input.siteId },
    select: { name: true, slug: true },
  });
  const forward = await db.outreachInboundForward.upsert({
    where: { outreachMessageId: input.outreachMessageId },
    update: {},
    create: {
      outreachMessageId: input.outreachMessageId,
      idempotencyKey: `outreach-inbound-forward:${input.outreachMessageId}`,
      targetAddress,
      senderAddress: boundedForwardContext(emailSender(null, env), 320),
      siteName: boundedForwardContext(site.name, 120),
      siteSlug: boundedForwardContext(site.slug, 100),
      lastFailureCode,
    },
    select: { id: true, attempts: true, targetAddress: true },
  });

  if (targetAddress && forward.attempts === 0 && !forward.targetAddress) {
    await db.outreachInboundForward.updateMany({
      where: {
        id: forward.id,
        status: "PENDING",
        attempts: 0,
        targetAddress: null,
      },
      data: { targetAddress, lastFailureCode: null },
    });
  }
  return true;
}

export async function dispatchDueOutreachInboundForwards(
  limit = OUTREACH_INBOUND_FORWARD_BATCH_SIZE,
  env: Environment = process.env,
): Promise<Record<InboundForwardDeliveryOutcome, number>> {
  if (!inboundForwardingConfigured(env)) return emptyInboundForwardOutcomes();
  configuredOutreachInboundForwardTarget(env);

  const boundedLimit = Math.max(1, Math.min(100, limit));
  const ids = await getDb().outreachInboundForward.findMany({
    where: {
      status: "PENDING",
      nextAttemptAt: { lte: new Date() },
      attempts: { lte: OUTREACH_INBOUND_FORWARD_MAX_ATTEMPTS },
    },
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
    take: boundedLimit,
    select: { id: true },
  });
  return dispatchInboundForwardBatch(
    ids.map(({ id }) => id),
    (id) => deliverOutreachInboundForward(id, env),
  );
}

export async function deliverOutreachInboundForward(
  id: string,
  env: Environment = process.env,
): Promise<InboundForwardDeliveryOutcome> {
  const db = getDb();
  const now = new Date();
  const leaseToken = randomUUID();
  const leaseUntil = new Date(
    now.getTime() + OUTREACH_INBOUND_FORWARD_LEASE_MS,
  );
  const claimed = await db.outreachInboundForward.updateMany({
    where: {
      id,
      status: "PENDING",
      attempts: { lte: OUTREACH_INBOUND_FORWARD_MAX_ATTEMPTS },
      nextAttemptAt: { lte: now },
      OR: [{ deliveryLeaseUntil: null }, { deliveryLeaseUntil: { lt: now } }],
    },
    data: { deliveryLeaseToken: leaseToken, deliveryLeaseUntil: leaseUntil },
  });
  if (claimed.count !== 1) return "deduplicated";

  const forward = await db.outreachInboundForward.findFirst({
    where: { id, deliveryLeaseToken: leaseToken },
    select: {
      id: true,
      outreachMessageId: true,
      idempotencyKey: true,
      targetAddress: true,
      senderAddress: true,
      siteName: true,
      siteSlug: true,
      attempts: true,
      firstProviderAttemptAt: true,
      lastFailureCode: true,
      outreachMessage: {
        select: {
          fromAddress: true,
          toAddress: true,
          subject: true,
          textBody: true,
        },
      },
    },
  });
  if (!forward) return "deduplicated";

  const replayingPreparedAttempt =
    forward.attempts > 0 && forward.lastFailureCode === null;

  let configuredTarget: string | null;
  try {
    configuredTarget = configuredOutreachInboundForwardTarget(env, [
      forward.outreachMessage.fromAddress,
      forward.outreachMessage.toAddress,
    ]);
  } catch {
    await releaseConfigurationBlockedForward(
      id,
      leaseToken,
      now,
      replayingPreparedAttempt,
    );
    return "configuration-invalid";
  }
  if (!configuredTarget) {
    await releaseConfigurationBlockedForward(
      id,
      leaseToken,
      now,
      replayingPreparedAttempt,
    );
    return "configuration-invalid";
  }

  const targetAddress =
    forward.attempts > 0 && forward.targetAddress
      ? forward.targetAddress
      : configuredTarget;
  if (
    forward.attempts > 0 &&
    forward.targetAddress &&
    configuredTarget !== forward.targetAddress
  ) {
    await releaseConfigurationBlockedForward(
      id,
      leaseToken,
      now,
      replayingPreparedAttempt,
    );
    return "configuration-invalid";
  }
  if (
    forward.firstProviderAttemptAt &&
    now.getTime() - forward.firstProviderAttemptAt.getTime() >=
      PROVIDER_IDEMPOTENCY_WINDOW_MS
  ) {
    return (await exhaustForward(
      forward.id,
      leaseToken,
      forward.outreachMessageId,
      "idempotency_window_expired",
    ))
      ? "exhausted"
      : "deduplicated";
  }

  if (
    forward.attempts >= OUTREACH_INBOUND_FORWARD_MAX_ATTEMPTS &&
    !replayingPreparedAttempt
  ) {
    return (await exhaustForward(
      forward.id,
      leaseToken,
      forward.outreachMessageId,
      forward.lastFailureCode ?? "attempts_exhausted",
    ))
      ? "exhausted"
      : "deduplicated";
  }

  // The increment is committed before the provider call. A process can die
  // anywhere after that write, so an expired lease with no persisted failure
  // replays the same logical attempt and stable Resend idempotency key instead
  // of consuming another attempt or stranding attempts === max.
  const attempt = replayingPreparedAttempt
    ? forward.attempts
    : forward.attempts + 1;
  const prepared = await db.outreachInboundForward.updateMany({
    where: {
      id: forward.id,
      status: "PENDING",
      deliveryLeaseToken: leaseToken,
      attempts: forward.attempts,
    },
    data: {
      ...(replayingPreparedAttempt ? {} : { attempts: { increment: 1 } }),
      targetAddress,
      firstProviderAttemptAt: forward.firstProviderAttemptAt ?? now,
      lastFailureCode: null,
    },
  });
  if (prepared.count !== 1) return "deduplicated";

  try {
    const { data, error } = await sendBoundedResendEmail(
      buildInboundForwardEmail({
        senderAddress: forward.senderAddress,
        targetAddress,
        siteName: forward.siteName,
        siteSlug: forward.siteSlug,
        sourceAddress: forward.outreachMessage.fromAddress,
        originalSubject: forward.outreachMessage.subject,
        textBody: forward.outreachMessage.textBody,
        outreachMessageId: forward.outreachMessageId,
      }),
      forward.idempotencyKey,
    );
    if (data?.id) {
      const finalized = await db.outreachInboundForward.updateMany({
        where: { id: forward.id, deliveryLeaseToken: leaseToken },
        data: {
          status: "SENT",
          sentAt: new Date(),
          providerMessageId: data.id,
          lastFailureCode: null,
          deliveryLeaseToken: null,
          deliveryLeaseUntil: null,
        },
      });
      if (finalized.count !== 1) {
        throw new Error("Inbound forward acceptance was not finalized");
      }
      return "sent";
    }
    if (error?.name === "invalid_idempotent_request") {
      return (await exhaustForward(
        forward.id,
        leaseToken,
        forward.outreachMessageId,
        "idempotency_payload_mismatch",
      ))
        ? "exhausted"
        : "deduplicated";
    }
    if (error && isDefinitiveResendRejection(error.statusCode)) {
      return (await exhaustForward(
        forward.id,
        leaseToken,
        forward.outreachMessageId,
        "provider_rejected",
      ))
        ? "exhausted"
        : "deduplicated";
    }
    return persistForwardFailure({
      id: forward.id,
      leaseToken,
      outreachMessageId: forward.outreachMessageId,
      attempt,
      failureCode:
        error?.statusCode === 429
          ? "provider_rate_limited"
          : "provider_unavailable",
    });
  } catch {
    return persistForwardFailure({
      id: forward.id,
      leaseToken,
      outreachMessageId: forward.outreachMessageId,
      attempt,
      failureCode: "provider_unavailable",
    });
  }
}

async function persistForwardFailure(input: {
  id: string;
  leaseToken: string;
  outreachMessageId: string;
  attempt: number;
  failureCode: string;
}): Promise<"pending" | "exhausted" | "deduplicated"> {
  const state = inboundForwardFailureState(input.attempt, new Date());
  if (state.status === "EXHAUSTED") {
    return (await exhaustForward(
      input.id,
      input.leaseToken,
      input.outreachMessageId,
      input.failureCode,
    ))
      ? "exhausted"
      : "deduplicated";
  }
  const persisted = await getDb().outreachInboundForward.updateMany({
    where: { id: input.id, deliveryLeaseToken: input.leaseToken },
    data: {
      ...state,
      lastFailureCode: input.failureCode,
      deliveryLeaseToken: null,
      deliveryLeaseUntil: null,
    },
  });
  if (persisted.count !== 1) return "deduplicated";
  return "pending";
}

async function exhaustForward(
  id: string,
  leaseToken: string,
  outreachMessageId: string,
  failureCode: string,
): Promise<boolean> {
  return getDb().$transaction(async (tx) => {
    const exhausted = await tx.outreachInboundForward.updateMany({
      where: { id, deliveryLeaseToken: leaseToken },
      data: {
        status: "EXHAUSTED",
        lastFailureCode: failureCode,
        deliveryLeaseToken: null,
        deliveryLeaseUntil: null,
      },
    });
    if (exhausted.count !== 1) return false;
    await enqueueOperatorAlert(tx, {
      kind: "OUTREACH_SEND_FAILURE",
      dedupKey: `inbound-forward:${id}`,
      title: "Inbound read-copy forwarding exhausted",
      message:
        "A persisted inbound read copy could not be forwarded after bounded retries. The Postgres/admin outreach thread remains authoritative.",
      context: { forwardId: id, outreachMessageId, failureCode },
    });
    return true;
  });
}

async function releaseConfigurationBlockedForward(
  id: string,
  leaseToken: string,
  now: Date,
  preservePreparedAttempt: boolean,
): Promise<void> {
  await getDb().outreachInboundForward.updateMany({
    where: { id, deliveryLeaseToken: leaseToken },
    data: {
      nextAttemptAt: new Date(now.getTime() + 5 * 60_000),
      ...(preservePreparedAttempt
        ? {}
        : { lastFailureCode: "configuration_invalid" }),
      deliveryLeaseToken: null,
      deliveryLeaseUntil: null,
    },
  });
}
