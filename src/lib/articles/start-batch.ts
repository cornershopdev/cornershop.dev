import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import {
  articleGenerationConfigured,
  closeArticleBatch,
} from "@/lib/articles/generation";

const ARTICLE_BATCH_CADENCE_MS = 7 * 24 * 60 * 60_000;

export type ArticleBatchAdmission =
  | { ok: true; batchId: string }
  | { ok: false; status: 400 | 404 | 409; reason: string };

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
  startRun: (batchId: string) => Promise<string> = startArticleBatchWorkflow,
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
  const admission = await reserveArticleBatch(input);
  if (!admission.ok) return admission;

  try {
    const runId = await startRun(admission.batchId);
    const bound = await getDb().articleBatch.updateMany({
      where: {
        id: admission.batchId,
        workflowRunId: null,
      },
      data: { workflowRunId: runId },
    });
    if (bound.count !== 1) {
      const existing = await getDb().articleBatch.findUnique({
        where: { id: admission.batchId },
        select: { workflowRunId: true },
      });
      if (existing?.workflowRunId !== runId) {
        throw new Error("Article batch workflow run could not be bound");
      }
    }
    return { ok: true, runId };
  } catch (error) {
    try {
      await closeArticleBatch({
        batchId: admission.batchId,
        status: "FAILED",
        statusReason: "WORKFLOW_START_FAILED",
        expectedStatuses: ["QUEUED"],
      });
    } catch (closeError) {
      throw new AggregateError(
        [error, closeError],
        "Article workflow start failed and its reservation could not be closed",
      );
    }
    throw error;
  }
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
            select: { id: true },
          });
          if (activeBatch) {
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
            },
            select: { id: true },
          });
          return { ok: true, batchId: batch.id };
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

async function startArticleBatchWorkflow(batchId: string): Promise<string> {
  const { start } = await import("workflow/api");
  const { articleBatchWorkflow } = await import("@/workflows/article-batch");
  const run = await start(articleBatchWorkflow, [{ batchId }]);
  return run.runId;
}

function isPrismaCode(error: unknown, code: "P2002" | "P2034"): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}
