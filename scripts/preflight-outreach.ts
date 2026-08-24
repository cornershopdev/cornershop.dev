import { Client } from "pg";
import { getResend } from "@/lib/resend";
import {
  evaluateOutreachEnvironment,
  hasRequiredResendDomains,
  hasRequiredResendInboundWebhook,
  hasRequiredResendWebhook,
  OUTREACH_MIGRATIONS,
} from "@/lib/outreach-readiness";

let environment: "preview" | "production" | "invalid" = "invalid";

try {
  environment = parseEnvironment(process.argv.slice(2));
  const configuration = evaluateOutreachEnvironment(process.env, {
    expectedAppOrigin:
      environment === "production" ? "https://cornershop.dev" : undefined,
  });
  const [
    database,
    workflowDatabaseReachable,
    webhookRegistered,
    inboundWebhookRegistered,
    senderAndReplyDomainsReady,
  ] = configuration.ready
    ? await Promise.all([
        checkDatabase(process.env.DATABASE_URL!),
        checkReadOnlyConnection(process.env.WORKFLOW_POSTGRES_URL!),
        checkWebhook(configuration.webhookEndpoint!),
        configuration.inboundWebhookEndpoint
          ? checkInboundWebhook(configuration.inboundWebhookEndpoint)
          : Promise.resolve(false),
        checkSenderAndReplyDomains(),
      ])
    : [
        { migrationApplied: false, schemaReady: false },
        false,
        false,
        false,
        false,
      ];
  const ready =
    configuration.ready &&
    database.migrationApplied &&
    database.schemaReady &&
    workflowDatabaseReachable &&
    webhookRegistered &&
    inboundWebhookRegistered &&
    senderAndReplyDomainsReady;

  console.log(
    JSON.stringify(
      {
        command: "preflight-outreach",
        environment,
        ready,
        checks: {
          environment: configuration.checks,
          migrations: {
            names: OUTREACH_MIGRATIONS,
            applied: database.migrationApplied,
            schemaReady: database.schemaReady,
          },
          workflowDatabase: { reachableReadOnly: workflowDatabaseReachable },
          webhook: {
            endpoint: configuration.webhookEndpoint,
            registered: webhookRegistered,
          },
          inboundWebhook: {
            endpoint: configuration.inboundWebhookEndpoint,
            registered: inboundWebhookRegistered,
          },
          senderAndReplyDomains: {
            ready: senderAndReplyDomainsReady,
            verticals: configuration.verticals,
          },
        },
        missingOrInvalid: configuration.missingOrInvalid,
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  if (!ready) process.exitCode = 1;
} catch {
  console.error(
    JSON.stringify({
      command: "preflight-outreach",
      environment,
      ready: false,
      failure: "database_or_resend_check_failed",
      failedAt: new Date().toISOString(),
    }),
  );
  process.exitCode = 1;
}

async function checkDatabase(databaseUrl: string): Promise<{
  migrationApplied: boolean;
  schemaReady: boolean;
}> {
  const client = new Client({
    connectionString: databaseUrl,
    application_name: "cornershopdev-outreach-preflight",
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
  });
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    const result = await client.query<{
      migrationApplied: boolean;
      schemaReady: boolean;
    }>(
      `SELECT
         (
           SELECT count(*)::int
           FROM "_prisma_migrations"
           WHERE "migration_name" = ANY($1::text[])
             AND "finished_at" IS NOT NULL
             AND "rolled_back_at" IS NULL
         ) = $2 AS "migrationApplied",
         (
           to_regclass('"OutreachDispatch"') IS NOT NULL
           AND to_regclass('"OutreachProviderEvent"') IS NOT NULL
           AND to_regclass('"OutreachInboundForward"') IS NOT NULL
           AND to_regclass('"OutreachForwardProviderEvent"') IS NOT NULL
           AND to_regclass('"OperatorAuditEvent"') IS NOT NULL
           AND to_regclass('"OperatorSetting"') IS NOT NULL
           AND to_regclass('"OutreachMessage_idempotencyKey_key"') IS NOT NULL
           AND to_regclass('"OutreachDispatch_idempotencyKey_key"') IS NOT NULL
           AND to_regclass('"OutreachDispatch_workflowRunId_key"') IS NOT NULL
           AND to_regclass('"ClaimInvitation_outreachKey_key"') IS NOT NULL
           AND to_regclass('"OutreachInboundForward_outreachMessageId_key"') IS NOT NULL
           AND to_regclass('"OutreachInboundForward_idempotencyKey_key"') IS NOT NULL
           AND to_regclass('"OutreachInboundForward_providerMessageId_key"') IS NOT NULL
           AND to_regclass('"OutreachInboundForward_status_nextAttemptAt_idx"') IS NOT NULL
           AND to_regclass('"OutreachForwardProviderEvent_forwardId_occurredAt_idx"') IS NOT NULL
           AND to_regclass('"OutreachForwardEvent_providerMessageId_occurredAt_idx"') IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema()
               AND table_name = 'Site'
               AND column_name = 'leadContactEmail'
               AND is_nullable = 'YES'
           )
           AND EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema()
               AND table_name = 'OutreachMessage'
               AND column_name = 'idempotencyKey'
               AND is_nullable = 'NO'
               AND column_default IS NOT NULL
           )
           AND (
             SELECT count(*) FROM information_schema.columns
             WHERE table_schema = current_schema()
               AND table_name = 'OutreachMessage'
               AND column_name IN (
                 'idempotencyKey', 'replyToAddress', 'providerEventAt',
                 'providerAttemptedAt', 'deliveryLeaseId',
                 'deliveryLeaseExpiresAt', 'rfcMessageId', 'inReplyTo',
                 'threadKey', 'createdByActor', 'receivedAt'
               )
           ) = 11
           AND (
             SELECT count(*) FROM information_schema.columns
             WHERE table_schema = current_schema()
               AND table_name = 'OutreachDispatch'
               AND column_name IN (
                 'idempotencyKey', 'siteId', 'template', 'recipient',
                 'reviewedAt', 'status', 'workflowRunId', 'requestedBy',
                 'attempt', 'error', 'createdAt', 'updatedAt'
               )
           ) = 12
           AND (
             SELECT count(*) FROM information_schema.columns
             WHERE table_schema = current_schema()
               AND table_name = 'OutreachProviderEvent'
               AND column_name IN (
                 'id', 'outreachMessageId', 'providerMessageId', 'eventType',
                 'status', 'occurredAt', 'createdAt'
               )
           ) = 7
           AND (
             SELECT count(*) FROM information_schema.columns
             WHERE table_schema = current_schema()
               AND table_name = 'OutreachInboundForward'
               AND column_name IN (
                 'id', 'outreachMessageId', 'idempotencyKey', 'targetAddress',
                 'senderAddress', 'siteName', 'siteSlug', 'status', 'attempts',
                 'nextAttemptAt', 'deliveryLeaseUntil', 'deliveryLeaseToken',
                 'firstProviderAttemptAt', 'sentAt', 'deliveredAt',
                 'providerMessageId', 'providerEventAt', 'lastFailureCode',
                 'deliveryStatus', 'deliveryFailureCode', 'createdAt', 'updatedAt'
               )
           ) = 22
           AND (
             SELECT count(*) FROM information_schema.columns
             WHERE table_schema = current_schema()
               AND table_name = 'OutreachForwardProviderEvent'
               AND column_name IN (
                 'id', 'forwardId', 'providerMessageId', 'eventType',
                 'deliveryStatus', 'occurredAt', 'createdAt'
               )
           ) = 7
           AND EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema()
               AND table_name = 'ClaimInvitation'
               AND column_name = 'outreachKey'
           )
           AND EXISTS (
             SELECT 1 FROM pg_constraint
             WHERE conname = 'OutreachDispatch_siteId_fkey'
               AND contype = 'f'
           )
           AND EXISTS (
             SELECT 1 FROM pg_constraint
             WHERE conname = 'OutreachProviderEvent_outreachMessageId_fkey'
               AND contype = 'f'
           )
           AND EXISTS (
             SELECT 1 FROM pg_constraint
             WHERE conname = 'OutreachInboundForward_outreachMessageId_fkey'
               AND contype = 'f'
           )
           AND EXISTS (
             SELECT 1 FROM pg_constraint
             WHERE conname = 'OutreachForwardProviderEvent_forwardId_fkey'
               AND contype = 'f'
           )
         ) AS "schemaReady"`,
      [[...OUTREACH_MIGRATIONS], OUTREACH_MIGRATIONS.length],
    );
    await client.query("ROLLBACK");
    return (
      result.rows[0] ?? {
        migrationApplied: false,
        schemaReady: false,
      }
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function checkReadOnlyConnection(databaseUrl: string): Promise<boolean> {
  const client = new Client({
    connectionString: databaseUrl,
    application_name: "cornershopdev-workflow-preflight",
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
  });
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    await client.query("SELECT 1");
    await client.query("ROLLBACK");
    return true;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function checkWebhook(expectedEndpoint: string): Promise<boolean> {
  const result = await getResend().webhooks.list();
  if (result.error || !result.data) throw new Error("webhook list failed");
  return hasRequiredResendWebhook(result.data.data, expectedEndpoint);
}

async function checkInboundWebhook(expectedEndpoint: string): Promise<boolean> {
  const result = await getResend().webhooks.list();
  if (result.error || !result.data) throw new Error("webhook list failed");
  return hasRequiredResendInboundWebhook(result.data.data, expectedEndpoint);
}

async function checkSenderAndReplyDomains(): Promise<boolean> {
  const result = await getResend().domains.list();
  if (result.error || !result.data) throw new Error("domain list failed");
  return hasRequiredResendDomains(result.data.data);
}

function parseEnvironment(args: string[]): "preview" | "production" {
  if (
    args.length !== 2 ||
    args[0] !== "--environment" ||
    (args[1] !== "preview" && args[1] !== "production")
  ) {
    throw new Error("Use --environment preview or --environment production.");
  }
  return args[1];
}
