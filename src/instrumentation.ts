export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;

  const { assertFirstCustomerTestModeSafety } = await import(
    "@/lib/first-customer-test-mode"
  );
  assertFirstCustomerTestModeSafety();

  if (process.env.DATABASE_URL) {
    const { startAnalyticsRetentionScheduler } = await import(
      "@/lib/analytics-retention-runtime"
    );
    startAnalyticsRetentionScheduler();
  }

  if (
    process.env.WORKFLOW_ENABLED === "true" &&
    process.env.WORKFLOW_TARGET_WORLD === "@workflow/world-postgres"
  ) {
    const { getWorld } = await import("workflow/runtime");
    await getWorld().start?.();
  }

  if (
    process.env.DATABASE_URL &&
    process.env.WORKFLOW_ENABLED === "true"
  ) {
    const { startArticleBatchDispatcher } = await import(
      "@/lib/articles/article-batch-runtime"
    );
    startArticleBatchDispatcher();

    const { startSourceMonitoringScheduler } = await import(
      "@/lib/source-monitoring-runtime"
    );
    startSourceMonitoringScheduler();
  }
}
