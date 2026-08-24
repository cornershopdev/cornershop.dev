import { Client } from "pg";
import { reconcileBoundArticleBatches } from "../src/lib/articles/start-batch";
import {
  ARTICLE_MUTATION_GATE_KEY,
} from "../src/lib/articles/mutation-gate";
import {
  isArticleBatchQueueIdentifier,
  isArticleBatchWorkflowName,
} from "../src/lib/articles/workflow-state";
import { getDb } from "../src/lib/db";

type Action = "close" | "check" | "open";

const action = parseAction(process.argv.slice(2));

try {
  if (action === "close" || action === "open") {
    await setGate(action === "close");
    console.log(
      JSON.stringify({
        command: "article-rollout",
        action,
        gateClosed: action === "close",
      }),
    );
  } else {
    const result = await checkQuiescence();
    console.log(
      JSON.stringify(
        { command: "article-rollout", action, ...result },
        null,
        2,
      ),
    );
    if (!result.ready) process.exitCode = 1;
  }
} catch (error) {
  console.error(
    JSON.stringify({
      command: "article-rollout",
      action,
      ready: false,
      error: error instanceof Error ? error.message : "unknown",
    }),
  );
  process.exitCode = 1;
}

async function setGate(closed: boolean): Promise<void> {
  const databaseUrl = requiredEnvironment("DATABASE_URL");
  const client = new Client({
    connectionString: databaseUrl,
    application_name: "cornershopdev-article-rollout-gate",
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
  });
  await client.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO "OperatorSetting" (
         "key", "value", "updatedBy", "createdAt", "updatedAt"
       ) VALUES ($1, $2::jsonb, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT ("key") DO UPDATE
       SET "value" = EXCLUDED."value",
           "updatedBy" = EXCLUDED."updatedBy",
           "updatedAt" = CURRENT_TIMESTAMP
       RETURNING "value"`,
      [
        ARTICLE_MUTATION_GATE_KEY,
        JSON.stringify(closed),
        `deploy:article-rollout:${closed ? "close" : "open"}`,
      ],
    );
    if (result.rows[0]?.value !== closed) {
      throw new Error("article mutation gate did not persist the requested state");
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function checkQuiescence(): Promise<{
  ready: boolean;
  gateClosed: boolean;
  reconciliation: Awaited<ReturnType<typeof reconcileBoundArticleBatches>>;
  activeWorkflowRuns: Array<{
    runId: string;
    status: "pending" | "running";
    workflowName: string;
  }>;
  articleGraphileJobs: Array<{ id: string; identifier: string }>;
  remainingBoundBatches: number;
}> {
  const workflowClient = new Client({
    connectionString: requiredEnvironment("WORKFLOW_POSTGRES_URL"),
    application_name: "cornershopdev-article-rollout-quiescence",
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
  });
  await workflowClient.connect();
  try {
    // This operator is a read-only quiescence probe over Workflow's durable
    // materialized state. Direct reads avoid starting a Workflow worker in the
    // one-shot deploy container while preserving the runtime's exact identity
    // and terminal-state reconciliation rules.
    const reconciliation = await reconcileBoundArticleBatches(async (runId) => {
      const result = await workflowClient.query<{
        status: string;
        workflowName: string;
      }>(
        `SELECT "status"::text, "name" AS "workflowName"
         FROM "workflow"."workflow_runs"
         WHERE "id" = $1`,
        [runId],
      );
      const run = result.rows[0];
      if (!run) throw new Error(`Workflow run not found: ${runId}`);
      return {
        status: workflowStatus(run.status),
        workflowName: run.workflowName,
      };
    });
    const activeWorkflowRuns = (
      await workflowClient.query<{
        runId: string;
        status: "pending" | "running";
        workflowName: string;
      }>(`
        SELECT "id" AS "runId", "status"::text, "name" AS "workflowName"
        FROM "workflow"."workflow_runs"
        WHERE "status" IN ('pending', 'running')
      `)
    ).rows
      .filter((run) => isArticleBatchWorkflowName(run.workflowName))
      .map((run) => ({
        runId: run.runId,
        status: run.status,
        workflowName: run.workflowName,
      }));
    const [gate, remainingBoundBatches, articleGraphileJobs] =
      await Promise.all([
        getDb().operatorSetting.findUnique({
          where: { key: ARTICLE_MUTATION_GATE_KEY },
          select: { value: true },
        }),
        getDb().articleBatch.count({
          where: {
            status: { in: ["QUEUED", "RUNNING"] },
            workflowRunId: { not: null },
          },
        }),
        findArticleGraphileJobs(workflowClient),
      ]);
    const gateClosed = gate?.value === true;
    return {
      ready:
        gateClosed &&
        activeWorkflowRuns.length === 0 &&
        articleGraphileJobs.length === 0 &&
        remainingBoundBatches === 0,
      gateClosed,
      reconciliation,
      activeWorkflowRuns,
      articleGraphileJobs,
      remainingBoundBatches,
    };
  } finally {
    await workflowClient.end().catch(() => undefined);
    await getDb().$disconnect();
  }
}

async function findArticleGraphileJobs(client: Client): Promise<
  Array<{ id: string; identifier: string }>
> {
  const jobPrefix = requiredEnvironment("WORKFLOW_POSTGRES_JOB_PREFIX");
  if (!/^[a-z][a-z0-9_]{0,62}_$/.test(jobPrefix)) {
    throw new Error("WORKFLOW_POSTGRES_JOB_PREFIX is not a bounded SQL-safe prefix");
  }
  const result = await client.query<{
    id: string;
    payload: unknown;
  }>(
    `SELECT jobs."id"::text, jobs."payload"
     FROM "graphile_worker"."_private_jobs" AS jobs
     INNER JOIN "graphile_worker"."_private_tasks" AS tasks
       ON tasks."id" = jobs."task_id"
     WHERE tasks."identifier" = ANY($1::text[])`,
    [[`${jobPrefix}flows`, `${jobPrefix}steps`]],
  );
  return result.rows.flatMap((row) => {
    const identifier = graphilePayloadIdentifier(row.payload);
    return identifier && isArticleBatchQueueIdentifier(identifier)
      ? [{ id: row.id, identifier }]
      : [];
  });
}

function graphilePayloadIdentifier(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || !("id" in payload)) {
    return null;
  }
  return typeof payload.id === "string" ? payload.id : null;
}

function requiredEnvironment(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function workflowStatus(
  value: string,
): "pending" | "running" | "completed" | "failed" | "cancelled" {
  if (
    value === "pending" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }
  throw new Error(`Unsupported Workflow status: ${value}`);
}

function parseAction(args: string[]): Action {
  if (
    args.length !== 2 ||
    args[0] !== "--action" ||
    !["close", "check", "open"].includes(args[1] ?? "")
  ) {
    throw new Error("Use --action close, --action check, or --action open.");
  }
  return args[1] as Action;
}
