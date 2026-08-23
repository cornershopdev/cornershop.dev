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
  const boundedLimit = Math.max(1, Math.min(100, limit));
  const ids = await getDb().outreachInboundForward.findMany({
    where: {
      OR: [
        {
          status: "PENDING",
          nextAttemptAt: { lte: new Date() },
          attempts: { lte: OUTREACH_INBOUND_FORWARD_MAX_ATTEMPTS },
        },
        {
          status: "SENT",
          lastFailureCode: "provider_identity_conflict",
          nextAttemptAt: { lte: new Date() },
        },
      ],
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
      nextAttemptAt: { lte: now },
      OR: [
        {
          status: "PENDING",
          attempts: { lte: OUTREACH_INBOUND_FORWARD_MAX_ATTEMPTS },
          OR: [
            { deliveryLeaseUntil: null },
            { deliveryLeaseUntil: { lt: now } },
          ],
        },
        {
          status: "SENT",
          lastFailureCode: "provider_identity_conflict",
          OR: [
            { deliveryLeaseUntil: null },
            { deliveryLeaseUntil: { lt: now } },
          ],
        },
      ],
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
      status: true,
      attempts: true,
      firstProviderAttemptAt: true,
      sentAt: true,
      providerMessageId: true,
      providerEventAt: true,
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

  // A signed receipt can bind the provider identity before the sender process
  // finalizes its response. If that process died, the next lease reconciles
  // the accepted send from durable receipt evidence without another provider
  // call or any dependency on the current forwarding configuration.
  if (forward.status === "SENT") {
    if (forward.lastFailureCode !== "provider_identity_conflict") {
      return "deduplicated";
    }
    return resolveSentProviderIdentityConflict({
      id: forward.id,
      leaseToken,
      outreachMessageId: forward.outreachMessageId,
    });
  }
  if (forward.status !== "PENDING") return "deduplicated";
  if (forward.lastFailureCode === "provider_identity_conflict") {
    return resolveProviderIdentityConflict(
      forward.id,
      leaseToken,
      forward.outreachMessageId,
    );
  }
  if (forward.providerMessageId) {
    const reconciled = await db.outreachInboundForward.updateMany({
      where: {
        id: forward.id,
        status: "PENDING",
        deliveryLeaseToken: leaseToken,
        providerMessageId: forward.providerMessageId,
      },
      data: {
        status: "SENT",
        sentAt: forward.sentAt ?? forward.providerEventAt ?? now,
        lastFailureCode: null,
        deliveryLeaseToken: null,
        deliveryLeaseUntil: null,
      },
    });
    return reconciled.count === 1 ? "sent" : "deduplicated";
  }

  const replayingPreparedAttempt =
    forward.attempts > 0 && forward.lastFailureCode === null;

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

  let configuredTarget: string | null;
  try {
    configuredTarget = configuredOutreachInboundForwardTarget(env, [
      forward.outreachMessage.fromAddress,
      forward.outreachMessage.toAddress,
    ]);
  } catch {
    return handleConfigurationBlockedForward({
      id,
      leaseToken,
      outreachMessageId: forward.outreachMessageId,
      failureCode: "configuration_invalid",
      now,
      firstProviderAttemptAt: forward.firstProviderAttemptAt,
      preservePreparedAttempt: replayingPreparedAttempt,
    });
  }
  if (!configuredTarget) {
    return exhaustConfigurationBlockedForward(
      id,
      leaseToken,
      forward.outreachMessageId,
      "configuration_missing",
    );
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
    return handleConfigurationBlockedForward({
      id,
      leaseToken,
      outreachMessageId: forward.outreachMessageId,
      failureCode: "configuration_target_changed",
      now,
      firstProviderAttemptAt: forward.firstProviderAttemptAt,
      preservePreparedAttempt: replayingPreparedAttempt,
    });
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

  let providerResult: Awaited<ReturnType<typeof sendBoundedResendEmail>>;
  try {
    providerResult = await sendBoundedResendEmail(
      buildInboundForwardEmail({
        inboundForwardId: forward.id,
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
  } catch {
    return persistForwardFailure({
      id: forward.id,
      leaseToken,
      outreachMessageId: forward.outreachMessageId,
      attempt,
      failureCode: "provider_unavailable",
    });
  }

  const { data, error } = providerResult;
  if (data?.id) {
    try {
      const finalized = await db.outreachInboundForward.updateMany({
        where: {
          id: forward.id,
          status: "PENDING",
          deliveryLeaseToken: leaseToken,
          OR: [
            { providerMessageId: null },
            { providerMessageId: data.id },
          ],
        },
        data: {
          status: "SENT",
          sentAt: new Date(),
          providerMessageId: data.id,
          lastFailureCode: null,
          deliveryLeaseToken: null,
          deliveryLeaseUntil: null,
        },
      });
      if (finalized.count === 1) return "sent";
    } catch (finalizationError) {
      if (isProviderMessageIdentityConflict(finalizationError)) {
        // Continue to the authoritative post-CAS identity check below.
      } else {
        return persistForwardFailure({
          id: forward.id,
          leaseToken,
          outreachMessageId: forward.outreachMessageId,
          attempt,
          failureCode: "provider_unavailable",
        });
      }
    }
    const reconciled = await db.outreachInboundForward.findUnique({
      where: { id: forward.id },
      select: { status: true, providerMessageId: true },
    });
    if (
      reconciled?.status === "SENT" &&
      reconciled.providerMessageId === data.id
    ) {
      return "sent";
    }
    if (
      reconciled?.status === "SENT" &&
      reconciled.providerMessageId &&
      reconciled.providerMessageId !== data.id
    ) {
      return resolveSentProviderIdentityConflict({
        id: forward.id,
        outreachMessageId: forward.outreachMessageId,
        returnedProviderMessageId: data.id,
      });
    }
    return resolveProviderIdentityConflict(
      forward.id,
      leaseToken,
      forward.outreachMessageId,
    );
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
    where: {
      id: input.id,
      status: "PENDING",
      deliveryLeaseToken: input.leaseToken,
    },
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
      where: { id, status: "PENDING", deliveryLeaseToken: leaseToken },
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

async function exhaustConfigurationBlockedForward(
  id: string,
  leaseToken: string,
  outreachMessageId: string,
  failureCode: string,
): Promise<"configuration-invalid" | "deduplicated"> {
  return (await exhaustForward(
    id,
    leaseToken,
    outreachMessageId,
    failureCode,
  ))
    ? "configuration-invalid"
    : "deduplicated";
}

async function handleConfigurationBlockedForward(input: {
  id: string;
  leaseToken: string;
  outreachMessageId: string;
  failureCode: string;
  now: Date;
  firstProviderAttemptAt: Date | null;
  preservePreparedAttempt: boolean;
}): Promise<"configuration-invalid" | "deduplicated"> {
  if (!input.firstProviderAttemptAt) {
    return exhaustConfigurationBlockedForward(
      input.id,
      input.leaseToken,
      input.outreachMessageId,
      input.failureCode,
    );
  }
  const expiresAt = new Date(
    input.firstProviderAttemptAt.getTime() + PROVIDER_IDEMPOTENCY_WINDOW_MS,
  );
  if (input.now >= expiresAt) {
    return exhaustConfigurationBlockedForward(
      input.id,
      input.leaseToken,
      input.outreachMessageId,
      input.failureCode,
    );
  }
  const released = await getDb().outreachInboundForward.updateMany({
    where: {
      id: input.id,
      status: "PENDING",
      deliveryLeaseToken: input.leaseToken,
    },
    data: {
      nextAttemptAt: new Date(
        Math.min(input.now.getTime() + 5 * 60_000, expiresAt.getTime()),
      ),
      ...(input.preservePreparedAttempt
        ? {}
        : { lastFailureCode: input.failureCode }),
      deliveryLeaseToken: null,
      deliveryLeaseUntil: null,
    },
  });
  return released.count === 1 ? "configuration-invalid" : "deduplicated";
}

function isProviderMessageIdentityConflict(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return (error as { code?: unknown }).code === "P2002";
}

async function resolveSentProviderIdentityConflict(input: {
  id: string;
  outreachMessageId: string;
  leaseToken?: string;
  returnedProviderMessageId?: string;
}): Promise<"pending" | "exhausted" | "deduplicated"> {
  const eligibility = input.returnedProviderMessageId
    ? {
        id: input.id,
        status: "SENT" as const,
        providerMessageId: { not: input.returnedProviderMessageId },
      }
    : {
        id: input.id,
        status: "SENT" as const,
        lastFailureCode: "provider_identity_conflict",
        deliveryLeaseToken: input.leaseToken,
      };
  try {
    const alerted = await getDb().$transaction(async (tx) => {
      const marked = await tx.outreachInboundForward.updateMany({
        where: eligibility,
        data: { lastFailureCode: "provider_identity_conflict" },
      });
      if (marked.count !== 1) return false;
      await enqueueProviderIdentityConflictAlert(
        tx,
        input.id,
        input.outreachMessageId,
      );
      const resolved = await tx.outreachInboundForward.updateMany({
        where: {
          id: input.id,
          status: "SENT",
          lastFailureCode: "provider_identity_conflict",
        },
        data: {
          lastFailureCode: null,
          deliveryLeaseToken: null,
          deliveryLeaseUntil: null,
        },
      });
      return resolved.count === 1;
    });
    return alerted ? "exhausted" : "deduplicated";
  } catch {
    // A SENT row is outside the normal delivery queue. Persist a dedicated
    // marker and release its lease so the dispatcher retries only the alert
    // transaction; the provider is never called again for this row.
    const marked = await getDb().outreachInboundForward.updateMany({
      where: eligibility,
      data: {
        lastFailureCode: "provider_identity_conflict",
        nextAttemptAt: new Date(Date.now() + 5 * 60_000),
        deliveryLeaseToken: null,
        deliveryLeaseUntil: null,
      },
    });
    return marked.count === 1 ? "pending" : "deduplicated";
  }
}

function enqueueProviderIdentityConflictAlert(
  tx: Pick<Prisma.TransactionClient, "operatorAlert">,
  id: string,
  outreachMessageId: string,
) {
  return enqueueOperatorAlert(tx, {
    kind: "OUTREACH_SEND_FAILURE",
    dedupKey: `inbound-forward-identity:${id}`,
    title: "Inbound read-copy provider identity conflict",
    message:
      "The provider response did not match the identity already bound by a signed inbound read-copy receipt. No additional copy will be sent; inspect the provider event ledger.",
    context: {
      forwardId: id,
      outreachMessageId,
      failureCode: "provider_identity_conflict",
    },
  });
}

async function resolveProviderIdentityConflict(
  id: string,
  leaseToken: string,
  outreachMessageId: string,
): Promise<"pending" | "exhausted" | "deduplicated"> {
  try {
    return (await exhaustForward(
      id,
      leaseToken,
      outreachMessageId,
      "provider_identity_conflict",
    ))
      ? "exhausted"
      : "deduplicated";
  } catch {
    // Preserve a content-free reconciliation marker if alert persistence is
    // temporarily unavailable. The next lease retries only the atomic alert
    // boundary; it never calls the provider with a conflicting identity.
    const pending = await getDb().outreachInboundForward.updateMany({
      where: { id, status: "PENDING", deliveryLeaseToken: leaseToken },
      data: {
        lastFailureCode: "provider_identity_conflict",
        nextAttemptAt: new Date(),
        deliveryLeaseToken: null,
        deliveryLeaseUntil: null,
      },
    });
    return pending.count === 1 ? "pending" : "deduplicated";
  }
}
