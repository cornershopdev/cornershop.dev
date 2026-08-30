import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import { Client } from "pg";

const enabled =
  process.env.OUTREACH_INBOUND_FORWARD_MIGRATION_POSTGRES_TEST === "1";
const migrationsDirectory = fileURLToPath(
  new URL("../../prisma/migrations/", import.meta.url),
);
const predecessorMigration = "20260821150000_seo_article_batches";
const forwardingMigration = "20260823100000_outreach_inbound_forward_outbox";

describe.skipIf(!enabled)("inbound read-copy predecessor upgrade", () => {
  test(
    "upgrades the exact predecessor schema with forwarding receipts intact",
    verifyOutreachInboundForwardPredecessorUpgrade,
    120_000,
  );
});

export async function verifyOutreachInboundForwardPredecessorUpgrade() {
  const sourceDatabaseUrl = process.env.DATABASE_URL;
  if (!sourceDatabaseUrl) throw new Error("DATABASE_URL is required");

  const databaseName = `inbound_forward_upgrade_${randomUUID().replaceAll("-", "")}`;
  const adminUrl = new URL(sourceDatabaseUrl);
  adminUrl.pathname = "/postgres";
  adminUrl.searchParams.delete("schema");
  const upgradeUrl = new URL(sourceDatabaseUrl);
  upgradeUrl.pathname = `/${databaseName}`;
  upgradeUrl.searchParams.delete("schema");
  const admin = new Client({ connectionString: adminUrl.toString() });
  let databaseCreated = false;
  let upgrade: Client | null = null;

  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${databaseName}" TEMPLATE template0`);
    databaseCreated = true;
    upgrade = new Client({ connectionString: upgradeUrl.toString() });
    await upgrade.connect();

    const migrationNames = (
      await readdir(migrationsDirectory, {
        withFileTypes: true,
      })
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const predecessorMigrations = migrationNames.filter(
      (name) => name <= predecessorMigration,
    );
    expect(predecessorMigrations.at(-1)).toBe(predecessorMigration);
    expect(migrationNames).toContain(forwardingMigration);
    expect(
      migrationNames[migrationNames.indexOf(predecessorMigration) + 1],
    ).toBe(forwardingMigration);
    for (const migrationName of predecessorMigrations) {
      await applyMigration(upgrade, migrationName);
    }

    await upgrade.query(
      `INSERT INTO "Site" ("id", "slug", "name", "updatedAt")
           VALUES ('forward-upgrade-site', 'forward-upgrade', 'Forward upgrade', NOW())`,
    );
    await upgrade.query(
      `INSERT INTO "OutreachMessage" (
             "id", "idempotencyKey", "siteId", "direction",
             "providerMessageId", "fromAddress", "toAddress", "subject",
             "textBody", "status", "receivedAt", "updatedAt"
           ) VALUES (
             'forward-upgrade-source', 'forward-upgrade-source-key',
             'forward-upgrade-site', 'INBOUND', 'received-upgrade-provider',
             'owner@example.test', 'vincent@reply.restofront.com', 'Re: Preview',
             'Predecessor mailbox content.', 'RECEIVED', NOW(), NOW()
           )`,
    );

    await applyMigration(upgrade, forwardingMigration);

    expect(await enumValues(upgrade, "OutreachInboundForwardStatus")).toEqual([
      "PENDING",
      "SENT",
      "EXHAUSTED",
    ]);
    expect(
      await enumValues(upgrade, "OutreachInboundForwardDeliveryStatus"),
    ).toEqual([
      "PENDING",
      "SENT",
      "DELIVERED",
      "BOUNCED",
      "COMPLAINED",
      "SUPPRESSED",
      "FAILED",
    ]);

    const tables = await upgrade.query<{ name: string }>(
      `SELECT table_name AS "name"
           FROM information_schema.tables
           WHERE table_schema = 'public'
             AND table_name IN (
               'OutreachInboundForward',
               'OutreachForwardProviderEvent'
             )
           ORDER BY table_name`,
    );
    expect(tables.rows).toEqual([
      { name: "OutreachForwardProviderEvent" },
      { name: "OutreachInboundForward" },
    ]);

    const indexes = await upgrade.query<{
      name: string;
      unique: boolean;
    }>(
      `SELECT
             indexname AS "name",
             indexdef LIKE 'CREATE UNIQUE INDEX%' AS "unique"
           FROM pg_indexes
           WHERE schemaname = 'public'
             AND tablename IN (
               'OutreachInboundForward',
               'OutreachForwardProviderEvent'
             )
           ORDER BY indexname`,
    );
    expect(indexes.rows).toEqual(
      expect.arrayContaining([
        {
          name: "OutreachInboundForward_outreachMessageId_key",
          unique: true,
        },
        {
          name: "OutreachInboundForward_idempotencyKey_key",
          unique: true,
        },
        {
          name: "OutreachInboundForward_providerMessageId_key",
          unique: true,
        },
        {
          name: "OutreachInboundForward_status_nextAttemptAt_idx",
          unique: false,
        },
        {
          name: "OutreachForwardProviderEvent_forwardId_occurredAt_idx",
          unique: false,
        },
        {
          name: "OutreachForwardEvent_providerMessageId_occurredAt_idx",
          unique: false,
        },
      ]),
    );

    const foreignKeys = await upgrade.query<{
      constraintName: string;
      tableName: string;
      columnName: string;
      foreignTableName: string;
      foreignColumnName: string;
      updateRule: string;
      deleteRule: string;
    }>(
      `SELECT
             tc.constraint_name AS "constraintName",
             tc.table_name AS "tableName",
             kcu.column_name AS "columnName",
             ccu.table_name AS "foreignTableName",
             ccu.column_name AS "foreignColumnName",
             rc.update_rule AS "updateRule",
             rc.delete_rule AS "deleteRule"
           FROM information_schema.table_constraints AS tc
           JOIN information_schema.key_column_usage AS kcu
             ON tc.constraint_catalog = kcu.constraint_catalog
            AND tc.constraint_schema = kcu.constraint_schema
            AND tc.constraint_name = kcu.constraint_name
           JOIN information_schema.constraint_column_usage AS ccu
             ON tc.constraint_catalog = ccu.constraint_catalog
            AND tc.constraint_schema = ccu.constraint_schema
            AND tc.constraint_name = ccu.constraint_name
           JOIN information_schema.referential_constraints AS rc
             ON tc.constraint_catalog = rc.constraint_catalog
            AND tc.constraint_schema = rc.constraint_schema
            AND tc.constraint_name = rc.constraint_name
           WHERE tc.constraint_schema = 'public'
             AND tc.constraint_name IN (
               'OutreachInboundForward_outreachMessageId_fkey',
               'OutreachForwardProviderEvent_forwardId_fkey'
             )
           ORDER BY tc.constraint_name`,
    );
    expect(foreignKeys.rows).toEqual([
      {
        constraintName: "OutreachForwardProviderEvent_forwardId_fkey",
        tableName: "OutreachForwardProviderEvent",
        columnName: "forwardId",
        foreignTableName: "OutreachInboundForward",
        foreignColumnName: "id",
        updateRule: "CASCADE",
        deleteRule: "CASCADE",
      },
      {
        constraintName: "OutreachInboundForward_outreachMessageId_fkey",
        tableName: "OutreachInboundForward",
        columnName: "outreachMessageId",
        foreignTableName: "OutreachMessage",
        foreignColumnName: "id",
        updateRule: "CASCADE",
        deleteRule: "CASCADE",
      },
    ]);

    const untouchedSources = await upgrade.query<{ count: number }>(
      `SELECT COUNT(*)::int AS "count"
           FROM "OutreachInboundForward"`,
    );
    expect(untouchedSources.rows).toEqual([{ count: 0 }]);

    await upgrade.query(
      `INSERT INTO "OutreachInboundForward" (
             "id", "outreachMessageId", "idempotencyKey", "targetAddress",
             "senderAddress", "siteName", "siteSlug", "status",
             "deliveryStatus", "providerMessageId", "providerEventAt",
             "updatedAt"
           ) VALUES (
             'forward-upgrade-copy', 'forward-upgrade-source',
             'forward-upgrade-copy-key', 'operator@example.test',
             'Vincent <vincent@send.restofront.com>', 'Forward upgrade',
             'forward-upgrade', 'SENT', 'COMPLAINED',
             'forward-upgrade-provider', NOW(), NOW()
           )`,
    );
    await upgrade.query(
      `INSERT INTO "OutreachForwardProviderEvent" (
             "id", "forwardId", "providerMessageId", "eventType",
             "deliveryStatus", "occurredAt"
           ) VALUES (
             'forward-upgrade-event', 'forward-upgrade-copy',
             'forward-upgrade-provider', 'email.complained', 'COMPLAINED', NOW()
           )`,
    );

    await upgrade.query(
      `DELETE FROM "OutreachMessage" WHERE "id" = 'forward-upgrade-source'`,
    );
    const cascaded = await upgrade.query<{
      forwards: number;
      events: number;
    }>(
      `SELECT
             (SELECT COUNT(*)::int FROM "OutreachInboundForward") AS "forwards",
             (SELECT COUNT(*)::int FROM "OutreachForwardProviderEvent") AS "events"`,
    );
    expect(cascaded.rows).toEqual([{ forwards: 0, events: 0 }]);
  } finally {
    await upgrade?.end().catch(() => undefined);
    try {
      if (databaseCreated) {
        await admin.query(
          `SELECT pg_terminate_backend(pid)
           FROM pg_stat_activity
           WHERE datname = $1 AND pid <> pg_backend_pid()`,
          [databaseName],
        );
        await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      }
    } finally {
      await admin.end().catch(() => undefined);
    }
  }
}

async function applyMigration(
  client: Client,
  migrationName: string,
): Promise<void> {
  const sql = await readFile(
    `${migrationsDirectory}/${migrationName}/migration.sql`,
    "utf8",
  );
  await client.query(sql);
}

async function enumValues(client: Client, typeName: string): Promise<string[]> {
  const result = await client.query<{ value: string }>(
    `SELECT enumlabel AS value
     FROM pg_enum
     JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
     WHERE pg_type.typname = $1
     ORDER BY enumsortorder`,
    [typeName],
  );
  return result.rows.map((row) => row.value);
}
