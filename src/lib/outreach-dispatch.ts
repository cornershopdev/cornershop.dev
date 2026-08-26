import { randomUUID } from "node:crypto";
import "server-only";
import type { OutreachStatus } from "@/generated/prisma/enums";
import { getDb } from "@/lib/db";
import { evaluateLeadOutreachEligibility } from "@/lib/operator-lead-attributes";
import type { OutreachEligibilityReason } from "@/lib/electronic-outreach-eligibility";
import { mutableLeadStatuses } from "@/lib/lead-status";
import { isVerticalOutreachConfigured } from "@/lib/lead-generation/registry";
import { lockOutreachSite } from "@/lib/outreach-lock";

const INITIAL_TEMPLATE = "preview_ready";
export const OUTREACH_DISPATCH_STALE_MS = 5 * 60_000;

export type InitialOutreachDispatch = {
  id: string;
  status: OutreachStatus;
  workflowRunId: string | null;
  attempt: number;
};

export class OutreachDispatchAuthorizationError extends Error {
  constructor(
    message: string,
    public readonly reason: OutreachEligibilityReason,
  ) {
    super(message);
    this.name = "OutreachDispatchAuthorizationError";
  }
}

export function isInitialOutreachDispatchRetryable(
  dispatch: {
    status: OutreachStatus;
    workflowRunId: string | null;
    updatedAt: Date;
  },
  now = new Date(),
): boolean {
  return (
    dispatch.status === "FAILED" ||
    (dispatch.status === "QUEUED" &&
      dispatch.workflowRunId === null &&
      dispatch.updatedAt.getTime() <=
        now.getTime() - OUTREACH_DISPATCH_STALE_MS)
  );
}

export async function reserveInitialOutreachDispatch(input: {
  siteId: string;
  recipient: string;
  reviewedAt: Date;
  actor: string;
  now?: Date;
}): Promise<InitialOutreachDispatch & { acquired: boolean }> {
  const db = getDb();
  const idempotencyKey = `lead-outreach:${input.siteId}:${INITIAL_TEMPLATE}`;
  const candidateId = randomUUID();
  const staleBefore = new Date(
    (input.now ?? new Date()).getTime() - OUTREACH_DISPATCH_STALE_MS,
  );

  return db.$transaction(async (tx) => {
    await lockOutreachSite(tx, input.siteId);
    const site = await tx.site.findUnique({
      where: { id: input.siteId },
      select: {
        attributes: true,
        leadContactEmail: true,
        status: true,
        vertical: true,
      },
    });
    const eligibility = evaluateLeadOutreachEligibility(
      site?.attributes,
      site?.leadContactEmail ?? null,
    );
    if (
      !site?.leadContactEmail ||
      site.leadContactEmail.trim().toLowerCase() !==
        input.recipient.trim().toLowerCase() ||
      !mutableLeadStatuses.has(site.status) ||
      !isVerticalOutreachConfigured(site.vertical) ||
      !eligibility.allowed
    ) {
      throw new OutreachDispatchAuthorizationError(
        eligibility.allowed
          ? "The private lead contact changed before outreach was queued."
          : eligibility.message,
        eligibility.allowed ? "recipient_mismatch" : eligibility.reason,
      );
    }

    const dispatch = await tx.outreachDispatch.upsert({
      where: { idempotencyKey },
      update: {},
      create: {
        id: candidateId,
        idempotencyKey,
        siteId: input.siteId,
        template: INITIAL_TEMPLATE,
        recipient: input.recipient,
        reviewedAt: input.reviewedAt,
        requestedBy: input.actor,
      },
      select: {
        id: true,
        status: true,
        workflowRunId: true,
        attempt: true,
        updatedAt: true,
      },
    });

    if (dispatch.id !== candidateId) {
      const reclaimable = isInitialOutreachDispatchRetryable(
        dispatch,
        input.now,
      );
      if (!reclaimable) {
        return { ...dispatch, acquired: false };
      }
      const retryingFailure = dispatch.status === "FAILED";
      const reclaimed = await tx.outreachDispatch.updateMany({
        where: retryingFailure
          ? {
              id: dispatch.id,
              status: "FAILED",
              attempt: dispatch.attempt,
            }
          : {
              id: dispatch.id,
              status: "QUEUED",
              workflowRunId: null,
              attempt: dispatch.attempt,
              updatedAt: { lte: staleBefore },
            },
        data: {
          recipient: input.recipient,
          reviewedAt: input.reviewedAt,
          requestedBy: input.actor,
          status: "QUEUED",
          workflowRunId: null,
          error: null,
          // A definite failure gets a fresh provider idempotency slot. A
          // stale no-run reservation is ambiguous, so replay the same logical
          // attempt and converge on its existing provider key instead.
          attempt: retryingFailure ? { increment: 1 } : dispatch.attempt,
        },
      });
      if (reclaimed.count !== 1) {
        const current = await tx.outreachDispatch.findUniqueOrThrow({
          where: { id: dispatch.id },
          select: {
            id: true,
            status: true,
            workflowRunId: true,
            attempt: true,
            updatedAt: true,
          },
        });
        return { ...current, acquired: false };
      }
    }

    const reserved =
      dispatch.id === candidateId
        ? dispatch
        : await tx.outreachDispatch.findUniqueOrThrow({
            where: { id: dispatch.id },
            select: {
              id: true,
              status: true,
              workflowRunId: true,
              attempt: true,
              updatedAt: true,
            },
          });
    await tx.auditEvent.create({
      data: {
        siteId: input.siteId,
        type: "outreach.initial.requested",
        actor: input.actor,
        metadata: {
          source: "operator-console",
          dispatchId: reserved.id,
          attempt: reserved.attempt,
        },
      },
    });
    return { ...reserved, acquired: true };
  });
}

export async function markInitialOutreachDispatchStarted(input: {
  dispatchId: string;
  siteId: string;
  workflowRunId: string;
  actor: string;
  attempt: number;
}): Promise<void> {
  await getDb().$transaction(async (transaction) => {
    const updated = await transaction.outreachDispatch.updateMany({
      where: {
        id: input.dispatchId,
        status: "QUEUED",
        attempt: input.attempt,
        workflowRunId: null,
      },
      data: { workflowRunId: input.workflowRunId },
    });
    if (updated.count !== 1) return;
    await transaction.auditEvent.create({
      data: {
        siteId: input.siteId,
        type: "outreach.initial.queued",
        actor: input.actor,
        metadata: {
          dispatchId: input.dispatchId,
          workflowRunId: input.workflowRunId,
          attempt: input.attempt,
        },
      },
    });
  });
}

export async function markInitialOutreachDispatchFinished(input: {
  dispatchId: string;
  siteId: string;
  actor: string;
  status: "SENT" | "FAILED";
  attempt: number;
  error?: string;
}): Promise<void> {
  await getDb().$transaction(async (tx) => {
    const updated = await tx.outreachDispatch.updateMany({
      where: {
        id: input.dispatchId,
        status:
          input.status === "SENT" ? { in: ["QUEUED", "FAILED"] } : "QUEUED",
        attempt: input.attempt,
      },
      data: {
        status: input.status,
        error: input.error ?? null,
      },
    });
    if (updated.count === 1 && input.status === "FAILED") {
      await tx.auditEvent.create({
        data: {
          siteId: input.siteId,
          type: "outreach.initial.failed",
          actor: input.actor,
          metadata: {
            dispatchId: input.dispatchId,
            attempt: input.attempt,
            reason: input.error ?? "unknown",
          },
        },
      });
    }
  });
}
