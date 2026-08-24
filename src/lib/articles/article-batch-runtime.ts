import "server-only";
import {
  dispatchQueuedArticleBatches,
  reconcileBoundArticleBatches,
} from "@/lib/articles/start-batch";

const ARTICLE_BATCH_DISPATCH_INTERVAL_MS = 60_000;
const MAX_INITIAL_JITTER_MS = 30_000;

type ArticleBatchSchedulerGlobal = typeof globalThis & {
  __cornershopArticleBatchDispatcherStarted?: boolean;
};

/**
 * Keeps durable QUEUED article batches moving independently of the request that
 * admitted them. Database leases inside the dispatcher fence concurrent server
 * instances; this process guard only prevents duplicate timers in one instance.
 */
export function startArticleBatchDispatcher(): void {
  const schedulerGlobal = globalThis as ArticleBatchSchedulerGlobal;
  if (schedulerGlobal.__cornershopArticleBatchDispatcherStarted) return;
  schedulerGlobal.__cornershopArticleBatchDispatcherStarted = true;

  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    void reconcileBoundArticleBatches()
      .then(async (reconciliation) => ({
        reconciliation,
        dispatch: await dispatchQueuedArticleBatches(),
      }))
      .then((result) => {
        if (
          result.reconciliation.inspected > 0 ||
          result.dispatch.attempted > 0
        ) {
          console.log("[article-batches] runtime pass complete", result);
        }
      })
      .catch((error) => {
        console.error("[article-batches] dispatch failed", {
          error: error instanceof Error ? error.message : "unknown",
        });
      })
      .finally(() => {
        running = false;
      });
  };

  const initial = setTimeout(() => {
    run();
    const interval = setInterval(run, ARTICLE_BATCH_DISPATCH_INTERVAL_MS);
    interval.unref();
  }, Math.floor(Math.random() * MAX_INITIAL_JITTER_MS));
  initial.unref();
}
