import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import {
  articleGenerationConfigured,
  closeArticleBatch,
} from "@/lib/articles/generation";
import {
  ARTICLE_MUTATION_GATE_REASON,
  areArticleMutationsGated,
} from "@/lib/articles/mutation-gate";
import { isArticleBatchWorkflowName } from "@/lib/articles/workflow-state";

const ARTICLE_BATCH_CADENCE_MS = 7 * 24 * 60 * 60_000;
const ARTICLE_BATCH_DISPATCH_LIMIT = 100;
export const ARTICLE_BATCH_DISPATCH_LEASE_MS = 5 * 60_000;

type ArticleBatchStartRun = (
  batchId: string,
  dispatchLeaseToken: string,
) => Promise<string>;

export type ArticleWorkflowEngineState = {
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  workflowName: string;
};

type ReadArticleWorkflowEngineState = (
  workflowRunId: string,
) => Promise<ArticleWorkflowEngineState>;

export type ArticleBatchAdmission =
  | { ok: true; batchId: string; acquired: boolean }
  | { ok: false; status: 400 | 404 | 409; reason: string };

type ArticleBatchDispatch =
  | { ok: true; runId: string }
  | { ok: false; status: 409 | 503; reason: string };

/**
 * Starts a durable article-batch run for a site after the cheap preflight
 * checks the workflow itself would only discover mid-run. Kept beside the
 * route so both the owner dashboard and any future operator trigger share
 * one gate set.
 */
export async function startArticleBatch(
  input: {
    siteId: string;
    slug: string;
    requestedBy: string;
    count: number;
  },
  startRun: ArticleBatchStartRun = startArticleBatchWorkflow,
): Promise<
  | { ok: true; runId: string }
  | { ok: false; status: 400 | 404 | 409 | 503; reason: string }
> {
  if (!articleGenerationConfigured()) {
    return {
      ok: false,
      status: 503,
      reason: "Article generation is not configured.",
    };
  }
  if (await areArticleMutationsGated()) {
    return { ok: false, status: 503, reason: ARTICLE_MUTATION_GATE_REASON };
  }
  const admission = await reserveArticleBatch(input);
  if (!admission.ok) return admission;
  return dispatchArticleBatch(admission.batchId, startRun);
}

/**
 * Atomically admits one batch for a site's current cadence window. The Site
 * row is the per-site serialization fence; the partial unique index remains a
 * database-level backstop against any future admission path skipping it.
 */
export async function reserveArticleBatch(
  input: {
    siteId: string;
    requestedBy: string;
    count: number;
  },
  now = new Date(),
): Promise<ArticleBatchAdmission> {
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 8) {
    return {
      ok: false,
      status: 400,
      reason: "Batch size must be between 1 and 8.",
    };
  }

  const db = getDb();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await db.$transaction(
        async (transaction) => {
          const locked = await transaction.$queryRaw<Array<{ id: string }>>`
            SELECT "id"
            FROM "Site"
            WHERE "id" = ${input.siteId}
            FOR UPDATE
          `;
          if (!locked.length) {
            return { ok: false, status: 404, reason: "Site not found." };
          }

          const site = await transaction.site.findUnique({
            where: { id: input.siteId },
            select: {
              status: true,
              subscription: { select: { status: true } },
            },
          });
          if (!site) {
            return { ok: false, status: 404, reason: "Site not found." };
          }
          if (site.status !== "CLAIMED" && site.status !== "LIVE") {
            return {
              ok: false,
              status: 409,
              reason: "Articles are available once the site is claimed.",
            };
          }

          const activeBatch = await transaction.articleBatch.findFirst({
            where: {
              siteId: input.siteId,
              status: { in: ["QUEUED", "RUNNING"] },
            },
            select: { id: true, status: true, workflowRunId: true },
          });
          if (activeBatch) {
            if (
              activeBatch.status === "QUEUED" &&
              activeBatch.workflowRunId === null
            ) {
              return {
                ok: true,
                batchId: activeBatch.id,
                acquired: false,
              };
            }
            return {
              ok: false,
              status: 409,
              reason: "An article batch is already in progress.",
            };
          }

          const paid = site.subscription?.status === "ACTIVE";
          if (!paid) {
            const recentBatch = await transaction.articleBatch.findFirst({
              where: {
                siteId: input.siteId,
                createdAt: {
                  gt: new Date(now.getTime() - ARTICLE_BATCH_CADENCE_MS),
                },
              },
              select: { id: true },
            });
            if (recentBatch) {
              return {
                ok: false,
                status: 409,
                reason:
                  "A batch was generated in the last 7 days. Upgrade to generate more.",
              };
            }
          }

          const batch = await transaction.articleBatch.create({
            data: {
              siteId: input.siteId,
              requestedCount: input.count,
              requestedBy: input.requestedBy,
              status: "QUEUED",
            },
            select: { id: true },
          });
          return { ok: true, batchId: batch.id, acquired: true };
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      if (isPrismaCode(error, "P2002")) {
        return {
          ok: false,
          status: 409,
          reason: "An article batch is already in progress.",
        };
      }
      if (attempt < 2 && isPrismaCode(error, "P2034")) continue;
      throw error;
    }
  }
  throw new Error("Article batch admission could not be serialized");
}

/**
 * Claims one queued reservation for workflow dispatch. The lease fences
 * concurrent HTTP requests and dispatcher passes before either can enqueue a
 * workflow. A workflow that starts after its lease was replaced cannot claim
 * the batch and therefore cannot reach model/provider work.
 */
export async function dispatchArticleBatch(
  batchId: string,
  startRun: ArticleBatchStartRun = startArticleBatchWorkflow,
  now = new Date(),
): Promise<ArticleBatchDispatch> {
  if (await areArticleMutationsGated()) {
    return { ok: false, status: 503, reason: ARTICLE_MUTATION_GATE_REASON };
  }
  const db = getDb();
  const dispatchLeaseToken = randomUUID();
  const dispatchLeaseUntil = new Date(
    now.getTime() + ARTICLE_BATCH_DISPATCH_LEASE_MS,
  );
  const [claimed] = await db.articleBatch.updateManyAndReturn({
    where: {
      id: batchId,
      status: "QUEUED",
      workflowRunId: null,
      OR: [
        {
          dispatchLeaseToken: null,
          dispatchLeaseUntil: null,
        },
        { dispatchLeaseUntil: { lte: now } },
      ],
    },
    data: { dispatchLeaseToken, dispatchLeaseUntil },
    select: { id: true },
  });
  if (!claimed) return currentArticleBatchDispatch(batchId);

  let runId: string;
  try {
    runId = await startRun(batchId, dispatchLeaseToken);
  } catch {
    const released = await db.articleBatch.updateMany({
      where: {
        id: batchId,
        status: "QUEUED",
        workflowRunId: null,
        dispatchLeaseToken,
      },
      data: {
        dispatchLeaseToken: null,
        dispatchLeaseUntil: null,
      },
    });
    if (released.count !== 1) {
      const current = await currentArticleBatchDispatch(batchId);
      if (current.ok) return current;
    }
    return {
      ok: false,
      status: 503,
      reason: "The article workflow could not be started. Try again.",
    };
  }

  const bound = await db.articleBatch.updateMany({
    where: {
      id: batchId,
      status: "QUEUED",
      workflowRunId: null,
      dispatchLeaseToken,
    },
    data: {
      workflowRunId: runId,
      dispatchLeaseToken: null,
      dispatchLeaseUntil: null,
    },
  });
  if (bound.count === 1) return { ok: true, runId };

  const current = await currentArticleBatchDispatch(batchId);
  if (current.ok) return current;
  return {
    ok: false,
    status: 409,
    reason: "The article batch dispatch was claimed by another request.",
  };
}

/**
 * Best-effort drain for the process-level runtime. Every row is claimed again
 * inside dispatchArticleBatch, so overlapping runtime passes and owner-route
 * requests converge on one live dispatch lease.
 */
export async function dispatchQueuedArticleBatches(
  now = new Date(),
  startRun: ArticleBatchStartRun = startArticleBatchWorkflow,
): Promise<{
  attempted: number;
  started: number;
  deferred: number;
  failedToStart: number;
}> {
  if (!articleGenerationConfigured()) {
    return { attempted: 0, started: 0, deferred: 0, failedToStart: 0 };
  }
  if (await areArticleMutationsGated()) {
    return { attempted: 0, started: 0, deferred: 0, failedToStart: 0 };
  }
  const queued = await getDb().articleBatch.findMany({
    where: {
      status: "QUEUED",
      workflowRunId: null,
      OR: [
        {
          dispatchLeaseToken: null,
          dispatchLeaseUntil: null,
        },
        { dispatchLeaseUntil: { lte: now } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: ARTICLE_BATCH_DISPATCH_LIMIT,
    select: { id: true },
  });
  let started = 0;
  let deferred = 0;
  let failedToStart = 0;
  for (const batch of queued) {
    const result = await dispatchArticleBatch(batch.id, startRun, now);
    if (result.ok) started += 1;
    else if (result.status === 503) failedToStart += 1;
    else deferred += 1;
  }
  return {
    attempted: queued.length,
    started,
    deferred,
    failedToStart,
  };
}

/**
 * Reconciles only engine-owned rows whose durable Workflow run is terminal.
 * Pending/running runs, lookup failures, unknown workflow identities, and
 * owner races remain untouched. No timestamp participates in this decision.
 */
export async function reconcileBoundArticleBatches(
  readState: ReadArticleWorkflowEngineState = readArticleWorkflowEngineState,
): Promise<{
  inspected: number;
  active: number;
  closed: number;
  deferred: number;
}> {
  const batches = await getDb().articleBatch.findMany({
    where: {
      status: { in: ["QUEUED", "RUNNING"] },
      workflowRunId: { not: null },
    },
    orderBy: { createdAt: "asc" },
    take: ARTICLE_BATCH_DISPATCH_LIMIT,
    select: {
      id: true,
      status: true,
      workflowRunId: true,
      rejectedCount: true,
    },
  });
  let active = 0;
  let closed = 0;
  let deferred = 0;
  for (const batch of batches) {
    if (batch.status !== "QUEUED" && batch.status !== "RUNNING") {
      deferred += 1;
      continue;
    }
    const workflowRunId = batch.workflowRunId;
    if (!workflowRunId) continue;
    let state: ArticleWorkflowEngineState;
    try {
      state = await readState(workflowRunId);
    } catch {
      deferred += 1;
      continue;
    }
    if (!isArticleBatchWorkflowName(state.workflowName)) {
      deferred += 1;
      continue;
    }
    if (state.status === "pending" || state.status === "running") {
      active += 1;
      continue;
    }
    const statusReason = {
      completed: "WORKFLOW_COMPLETED_WITHOUT_BATCH_OUTCOME",
      failed: "WORKFLOW_ENGINE_FAILED",
      cancelled: "WORKFLOW_ENGINE_CANCELLED",
    }[state.status];
    const didClose = await closeArticleBatch({
      batchId: batch.id,
      workflowRunId,
      status: "FAILED",
      statusReason,
      rejectedCount: batch.rejectedCount,
      expectedStatuses: [batch.status],
    });
    if (didClose) closed += 1;
    else deferred += 1;
  }
  return { inspected: batches.length, active, closed, deferred };
}

async function currentArticleBatchDispatch(
  batchId: string,
): Promise<ArticleBatchDispatch> {
  const current = await getDb().articleBatch.findUnique({
    where: { id: batchId },
    select: { workflowRunId: true },
  });
  if (current?.workflowRunId) {
    return { ok: true, runId: current.workflowRunId };
  }
  return {
    ok: false,
    status: 409,
    reason: "The article batch is already being dispatched.",
  };
}

async function startArticleBatchWorkflow(
  batchId: string,
  dispatchLeaseToken: string,
): Promise<string> {
  const { start } = await import("workflow/api");
  const { articleBatchWorkflow } = await import("@/workflows/article-batch");
  const run = await start(articleBatchWorkflow, [
    { batchId, dispatchLeaseToken },
  ]);
  return run.runId;
}

async function readArticleWorkflowEngineState(
  workflowRunId: string,
): Promise<ArticleWorkflowEngineState> {
  const { getRun } = await import("workflow/api");
  const run = getRun(workflowRunId);
  const [status, workflowName] = await Promise.all([
    run.status,
    run.workflowName,
  ]);
  return { status, workflowName };
}

function isPrismaCode(error: unknown, code: "P2002" | "P2034"): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}
