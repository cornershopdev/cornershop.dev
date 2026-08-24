import {
  parseStepName,
  parseWorkflowName,
} from "workflow/observability";

export const ARTICLE_BATCH_WORKFLOW_SHORT_NAME = "articleBatchWorkflow";
const ARTICLE_BATCH_WORKFLOW_MODULE = "./src/workflows/article-batch";

export function isArticleBatchWorkflowName(name: string): boolean {
  const parsed = parseWorkflowName(name);
  return (
    parsed?.shortName === ARTICLE_BATCH_WORKFLOW_SHORT_NAME &&
    parsed.moduleSpecifier === ARTICLE_BATCH_WORKFLOW_MODULE
  );
}
/** Identifies both flow and step Graphile messages for the article workflow. */
export function isArticleBatchQueueIdentifier(name: string): boolean {
  const workflow = parseWorkflowName(name);
  if (workflow) return isArticleBatchWorkflowName(name);
  return parseStepName(name)?.moduleSpecifier === ARTICLE_BATCH_WORKFLOW_MODULE;
}
