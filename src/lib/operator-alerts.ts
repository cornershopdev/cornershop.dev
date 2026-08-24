import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import {
  configuredOperatorAlertRecipients,
  dispatchOperatorAlertBatch,
  OPERATOR_ALERT_DELIVERY_TIMEOUT_MS,
  OPERATOR_ALERT_DISPATCH_BATCH_SIZE,
  OPERATOR_ALERT_LEASE_MS,
  OPERATOR_ALERT_MAX_ATTEMPTS,
  operatorAlertFailureState,
  type AlertDeliveryOutcome,
} from "@/lib/operator-alert-policy";
import {
  persistPreparedOperatorAlert,
  prepareOperatorAlert,
  type OperatorAlertInput,
  type PreparedOperatorAlert,
} from "@/lib/operator-alert-queue";
import { emailSender } from "@/lib/email-identity";
import { getResend } from "@/lib/resend";

export type CaptureOperatorAlertInput = OperatorAlertInput;

export type { AlertDeliveryOutcome } from "@/lib/operator-alert-policy";

export async function captureOperatorAlert(
  input: CaptureOperatorAlertInput,
): Promise<AlertDeliveryOutcome> {
  const prepared = prepareOperatorAlert(input);

  try {
    const result = await persistPreparedOperatorAlert(getDb(), prepared);
    if (result.occurrenceCount > 1 || result.status !== "PENDING") {
      return "deduplicated";
    }
    return deliverOperatorAlert(result.id);
  } catch {
    return deliverFallbackAlert(prepared);
  }
}

export async function dispatchDueOperatorAlerts(
  limit = OPERATOR_ALERT_DISPATCH_BATCH_SIZE,
): Promise<Record<AlertDeliveryOutcome, number>> {
  const boundedLimit = Math.max(1, Math.min(100, limit));
  const ids = await getDb().operatorAlert.findMany({
    where: {
      status: "PENDING",
      nextAttemptAt: { lte: new Date() },
      attempts: { lt: OPERATOR_ALERT_MAX_ATTEMPTS },
    },
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
    take: boundedLimit,
    select: { id: true },
  });
  return dispatchOperatorAlertBatch(
    ids.map(({ id }) => id),
    deliverOperatorAlert,
  );
}

async function deliverOperatorAlert(id: string): Promise<AlertDeliveryOutcome> {
  const now = new Date();
  const leaseToken = randomUUID();
  const leaseUntil = new Date(now.getTime() + OPERATOR_ALERT_LEASE_MS);
  const claimed = await getDb().operatorAlert.updateMany({
    where: {
      id,
      status: "PENDING",
      attempts: { lt: OPERATOR_ALERT_MAX_ATTEMPTS },
      nextAttemptAt: { lte: now },
      OR: [{ deliveryLeaseUntil: null }, { deliveryLeaseUntil: { lt: now } }],
    },
    data: { deliveryLeaseToken: leaseToken, deliveryLeaseUntil: leaseUntil },
  });
  if (claimed.count !== 1) return "deduplicated";

  const alert = await getDb().operatorAlert.findFirst({
    where: { id, deliveryLeaseToken: leaseToken },
    select: {
      id: true,
      fingerprint: true,
      kind: true,
      title: true,
      message: true,
      context: true,
      attempts: true,
      occurrenceCount: true,
      firstOccurredAt: true,
      lastOccurredAt: true,
    },
  });
  if (!alert) return "deduplicated";

  const attempt = alert.attempts + 1;
  try {
    const recipients = configuredOperatorAlertRecipients();
    const { error } = await withDeliveryTimeout(
      getResend().emails.send(
        {
          from: emailSender(null),
          to: recipients,
          subject: `[Cornershopdev] ${alert.title}`,
          html: alertEmailHtml(alert),
        },
        {
          headers: { "Idempotency-Key": `operator-alert-${alert.fingerprint}` },
        },
      ),
    );
    if (error) throw new Error(error.message);
    await getDb().operatorAlert.updateMany({
      where: { id, deliveryLeaseToken: leaseToken },
      data: {
        status: "DELIVERED",
        attempts: attempt,
        deliveredAt: new Date(),
        lastFailureCode: null,
        deliveryLeaseToken: null,
        deliveryLeaseUntil: null,
      },
    });
    return "delivered";
  } catch (error) {
    const failureState = operatorAlertFailureState(attempt, new Date());
    await getDb().operatorAlert.updateMany({
      where: { id, deliveryLeaseToken: leaseToken },
      data: {
        ...failureState,
        attempts: attempt,
        lastFailureCode: alertFailureCode(error),
        deliveryLeaseToken: null,
        deliveryLeaseUntil: null,
      },
    });
    return failureState.status === "EXHAUSTED" ? "exhausted" : "pending";
  }
}

async function deliverFallbackAlert(
  input: PreparedOperatorAlert,
): Promise<AlertDeliveryOutcome> {
  try {
    const recipients = configuredOperatorAlertRecipients();
    const { error } = await withDeliveryTimeout(
      getResend().emails.send(
        {
          from: emailSender(null),
          to: recipients,
          subject: `[Cornershopdev] ${input.title}`,
          html: alertEmailHtml({
            kind: input.kind,
            title: input.title,
            message: input.message,
            context: input.context ?? {},
            occurrenceCount: 1,
            firstOccurredAt: input.occurredAt,
            lastOccurredAt: input.occurredAt,
          }),
        },
        {
          headers: {
            "Idempotency-Key": `operator-alert-${input.fingerprint}`,
          },
        },
      ),
    );
    return error ? "unavailable" : "fallback-delivered";
  } catch {
    return "unavailable";
  }
}

async function withDeliveryTimeout<T>(delivery: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      delivery,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Operator alert delivery timed out")),
          OPERATOR_ALERT_DELIVERY_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function alertEmailHtml(alert: {
  kind: string;
  title: string;
  message: string;
  context: unknown;
  occurrenceCount: number;
  firstOccurredAt: Date;
  lastOccurredAt: Date;
}): string {
  const context = JSON.stringify(alert.context ?? {});
  return `<div style="font-family:Arial,sans-serif;padding:32px;background:#f4efe5">
  <div style="max-width:640px;margin:auto;background:#fff;padding:28px;border-radius:14px">
    <p style="font-size:12px;font-weight:700;color:#a5482d">CORNERSHOPDEV OPERATOR ALERT</p>
    <h1 style="font-size:24px">${escapeHtml(alert.title)}</h1>
    <p>${escapeHtml(alert.message)}</p>
    <dl>
      <dt>Kind</dt><dd>${escapeHtml(alert.kind)}</dd>
      <dt>Occurrences</dt><dd>${alert.occurrenceCount}</dd>
      <dt>First seen</dt><dd>${alert.firstOccurredAt.toISOString()}</dd>
      <dt>Last seen</dt><dd>${alert.lastOccurredAt.toISOString()}</dd>
    </dl>
    <pre style="white-space:pre-wrap;background:#f6f6f6;padding:12px">${escapeHtml(context)}</pre>
  </div>
</div>`;
}

function alertFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (
    message.includes("operator_alert_emails") ||
    message.includes("resend_api_key")
  ) {
    return "configuration_missing";
  }
  if (message.includes("rate") || message.includes("429")) {
    return "provider_rate_limited";
  }
  if (message.includes("sender") || message.includes("domain")) {
    return "sender_rejected";
  }
  return "provider_error";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
