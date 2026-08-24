import type { Prisma } from "@/generated/prisma/client";
import {
  operatorAlertFingerprint,
  safeAlertText,
  type OperatorAlertKind,
} from "@/lib/operator-alert-policy";

export type OperatorAlertInput = {
  kind: OperatorAlertKind;
  dedupKey: string;
  title: string;
  message: string;
  context?: Record<string, string | number | boolean | null>;
  occurredAt?: Date;
};

export type PreparedOperatorAlert = Omit<OperatorAlertInput, "occurredAt"> & {
  occurredAt: Date;
  fingerprint: string;
};

type OperatorAlertQueueDb = Pick<Prisma.TransactionClient, "operatorAlert">;

/** Persist an alert intent without contacting its delivery provider. */
export function enqueueOperatorAlert(
  db: OperatorAlertQueueDb,
  input: OperatorAlertInput,
) {
  return persistPreparedOperatorAlert(db, prepareOperatorAlert(input));
}

export function prepareOperatorAlert(
  input: OperatorAlertInput,
): PreparedOperatorAlert {
  const occurredAt = input.occurredAt ?? new Date();
  const prepared = {
    ...input,
    title: safeAlertText(input.title, 160),
    message: safeAlertText(input.message, 1000),
    occurredAt,
  };
  return {
    ...prepared,
    fingerprint: operatorAlertFingerprint(prepared),
  };
}

export function persistPreparedOperatorAlert(
  db: OperatorAlertQueueDb,
  input: PreparedOperatorAlert,
) {
  return db.operatorAlert.upsert({
    where: { fingerprint: input.fingerprint },
    update: {
      occurrenceCount: { increment: 1 },
      lastOccurredAt: input.occurredAt,
    },
    create: {
      fingerprint: input.fingerprint,
      kind: input.kind,
      title: input.title,
      message: input.message,
      context: (input.context ?? {}) as Prisma.InputJsonValue,
      firstOccurredAt: input.occurredAt,
      lastOccurredAt: input.occurredAt,
      nextAttemptAt: input.occurredAt,
    },
    select: { id: true, occurrenceCount: true, status: true },
  });
}
