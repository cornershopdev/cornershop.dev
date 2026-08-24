import { describe, expect, it } from "bun:test";
import {
  isArticleBatchQueueIdentifier,
  isArticleBatchWorkflowName,
} from "@/lib/articles/workflow-state";

describe("article Workflow identity", () => {
  it("matches only the exact article workflow module and export", () => {
    expect(
      isArticleBatchWorkflowName(
        "workflow//./src/workflows/article-batch//articleBatchWorkflow",
      ),
    ).toBe(true);
    expect(
      isArticleBatchWorkflowName(
        "workflow//./src/workflows/article-batch//anotherWorkflow",
      ),
    ).toBe(false);
    expect(
      isArticleBatchWorkflowName(
        "workflow//./src/workflows/lead-outreach//articleBatchWorkflow",
      ),
    ).toBe(false);
  });

  it("covers both Graphile flow and step identifiers for the module", () => {
    expect(
      isArticleBatchQueueIdentifier(
        "workflow//./src/workflows/article-batch//articleBatchWorkflow",
      ),
    ).toBe(true);
    expect(
      isArticleBatchQueueIdentifier(
        "step//./src/workflows/article-batch//persistBatchStep",
      ),
    ).toBe(true);
    expect(
      isArticleBatchQueueIdentifier(
        "step//./src/workflows/source-monitoring//persistBatchStep",
      ),
    ).toBe(false);
  });
});
