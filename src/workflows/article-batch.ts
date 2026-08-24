import { getWorkflowMetadata, getWritable } from "workflow";
import type { SiteFacts } from "@/lib/articles/site-facts";
import type { GeneratedArticlePlan } from "@/lib/articles/composer";
import type { GeneratedBatchPlans } from "@/lib/articles/generation";

/**
 * Durable article-batch generation for one site.
 *
 * Same shape as `leadOutreachWorkflow`: the orchestrator only coordinates —
 * every DB read/write and model call is a `"use step"` so a crash between
 * steps resumes instead of re-running. The generation library is imported
 * dynamically inside steps because it transitively reaches Prisma and the AI
 * SDK, which must not enter the orchestrator bundle (see the note at the top
 * of `lead-outreach.ts`). The `SiteFacts`/`GeneratedArticlePlan` imports here
 * are type-only and vanish at build time.
 */

export type ArticleBatchEvent =
  | { type: "progress"; message: string }
  | { type: "skipped"; reason: string }
  | { type: "complete"; batchId: string; producedCount: number }
  | { type: "failed"; message: string };

export async function articleBatchWorkflow(input: {
  batchId: string;
  dispatchLeaseToken: string;
}): Promise<void> {
  "use workflow";

  const { workflowRunId } = getWorkflowMetadata();
  let knownRejectedCount = 0;
  try {
    const reservation = await beginBatchStep(
      input.batchId,
      workflowRunId,
      input.dispatchLeaseToken,
    );
    if (!reservation) return;

    const loaded = await loadInputsStep(reservation.siteId);
    if (!loaded.ok) {
      await closeBatchStep({
        batchId: input.batchId,
        workflowRunId,
        status: "SKIPPED",
        statusReason: "SITE_INELIGIBLE",
      });
      await emit({ type: "skipped", reason: loaded.reason });
      return;
    }

    await emit({ type: "progress", message: "Selecting topics" });
    const generated = await generatePlansStep({
      facts: loaded.facts,
      recentTopicKeys: loaded.recentTopicKeys,
      count: reservation.requestedCount,
    });
    knownRejectedCount = generated.rejectedCount;
    if (generated.status === "SKIPPED") {
      await closeBatchStep({
        batchId: input.batchId,
        workflowRunId,
        status: "SKIPPED",
        statusReason: generated.statusReason,
      });
      await emit({
        type: "skipped",
        reason: "No supportable topic is available for this site's facts.",
      });
      return;
    }
    if (!generated.plans.length) {
      const rejected = generated.rejectedCount > 0;
      await closeBatchStep({
        batchId: input.batchId,
        workflowRunId,
        status: rejected ? "REJECTED" : "ZERO_OUTPUT",
        statusReason: rejected
          ? "INVALID_MODEL_OUTPUT"
          : "MODEL_RETURNED_ZERO_DRAFTS",
        rejectedCount: generated.rejectedCount,
      });
      await emit({
        type: "skipped",
        reason: rejected
          ? "No returned plan matched a requested topic."
          : "The generation run returned no plans.",
      });
      return;
    }

    const persisted = await persistBatchStep({
      batchId: input.batchId,
      workflowRunId,
      siteId: reservation.siteId,
      plans: generated.plans,
      rejectedCount: generated.rejectedCount,
    });

    await emit({
      type: "complete",
      batchId: persisted.batchId,
      producedCount: persisted.producedCount,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Article batch failed.";
    await closeBatchStep({
      batchId: input.batchId,
      workflowRunId,
      status: "FAILED",
      statusReason: "GENERATION_FAILED",
      rejectedCount: knownRejectedCount,
    });
    await emit({ type: "failed", message });
    throw error;
  }
}

async function emit(event: ArticleBatchEvent): Promise<void> {
  "use step";
  const writer = getWritable<ArticleBatchEvent>().getWriter();
  try {
    await writer.write(event);
  } finally {
    writer.releaseLock();
  }
}

async function beginBatchStep(
  batchId: string,
  workflowRunId: string,
  dispatchLeaseToken: string,
): Promise<{
  siteId: string;
  requestedCount: number;
} | null> {
  "use step";
  const { beginArticleBatch } = await import("@/lib/articles/generation");
  return beginArticleBatch(batchId, workflowRunId, dispatchLeaseToken);
}

async function loadInputsStep(
  siteId: string,
): Promise<
  | { ok: true; facts: SiteFacts; recentTopicKeys: string[] }
  | { ok: false; reason: string }
> {
  "use step";
  const { loadGenerationInputs } = await import("@/lib/articles/generation");
  return loadGenerationInputs(siteId);
}

async function generatePlansStep(input: {
  facts: SiteFacts;
  recentTopicKeys: string[];
  count: number;
}): Promise<GeneratedBatchPlans> {
  "use step";
  const { generateBatchPlans } = await import("@/lib/articles/generation");
  return generateBatchPlans(input);
}

async function persistBatchStep(input: {
  batchId: string;
  workflowRunId: string;
  siteId: string;
  plans: GeneratedArticlePlan[];
  rejectedCount: number;
}): Promise<{ batchId: string; producedCount: number }> {
  "use step";
  const { persistArticleBatch } = await import("@/lib/articles/generation");
  return persistArticleBatch(input);
}

async function closeBatchStep(input: {
  batchId: string;
  workflowRunId: string;
  status: "ZERO_OUTPUT" | "REJECTED" | "SKIPPED" | "FAILED";
  statusReason: string;
  rejectedCount?: number;
}): Promise<boolean> {
  "use step";
  const { closeArticleBatch } = await import("@/lib/articles/generation");
  return closeArticleBatch(input);
}
