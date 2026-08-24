import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { Client } from "pg";

const enabled = process.env.ARTICLES_POSTGRES_TEST === "1";
if (enabled) mock.module("server-only", () => ({}));

const siteId = `articles-test-${randomUUID()}`;
const outcomeMigrationPath = fileURLToPath(
  new URL(
    "../../../prisma/migrations/20260823110000_article_batch_admission_outcomes/migration.sql",
    import.meta.url,
  ),
);
const prismaSchemaPath = fileURLToPath(
  new URL("../../../prisma/schema.prisma", import.meta.url),
);
const createdSiteIds = new Set([siteId]);
const createdOrganizationIds = new Set<string>();
let db: ReturnType<typeof import("@/lib/db").getDb>;
let loadGenerationInputs: typeof import("@/lib/articles/generation").loadGenerationInputs;
let persistArticleBatch: typeof import("@/lib/articles/generation").persistArticleBatch;
let beginArticleBatch: typeof import("@/lib/articles/generation").beginArticleBatch;
let closeArticleBatch: typeof import("@/lib/articles/generation").closeArticleBatch;
let reserveArticleBatch: typeof import("@/lib/articles/start-batch").reserveArticleBatch;
let startArticleBatch: typeof import("@/lib/articles/start-batch").startArticleBatch;
let dispatchArticleBatch: typeof import("@/lib/articles/start-batch").dispatchArticleBatch;
let dispatchQueuedArticleBatches: typeof import("@/lib/articles/start-batch").dispatchQueuedArticleBatches;
let reconcileBoundArticleBatches: typeof import("@/lib/articles/start-batch").reconcileBoundArticleBatches;
let articleBatchDispatchLeaseMs: number;

/**
 * PostgreSQL-gated integration coverage for the article engine's persistence
 * half: topic-window extraction (the last-two-batches contract), slug
 * deduplication across batches, and guardrail enforcement at the write path.
 * The model round-trip is not exercised here — it needs OPENROUTER_API_KEY
 * and is covered by the prompt/schema contract in the unit tests.
 */
describe.skipIf(!enabled)("articles PostgreSQL integration", () => {
  beforeAll(async () => {
    const generation = await import("@/lib/articles/generation");
    const database = await import("@/lib/db");
    db = database.getDb();
    loadGenerationInputs = generation.loadGenerationInputs;
    persistArticleBatch = generation.persistArticleBatch;
    beginArticleBatch = generation.beginArticleBatch;
    closeArticleBatch = generation.closeArticleBatch;
    const startBatch = await import("@/lib/articles/start-batch");
    reserveArticleBatch = startBatch.reserveArticleBatch;
    startArticleBatch = startBatch.startArticleBatch;
    dispatchArticleBatch = startBatch.dispatchArticleBatch;
    dispatchQueuedArticleBatches = startBatch.dispatchQueuedArticleBatches;
    reconcileBoundArticleBatches = startBatch.reconcileBoundArticleBatches;
    articleBatchDispatchLeaseMs = startBatch.ARTICLE_BATCH_DISPATCH_LEASE_MS;

    await db.operatorSetting.upsert({
      where: { key: "articles.mutations.gated" },
      update: { value: false, updatedBy: "articles-postgres-test" },
      create: {
        key: "articles.mutations.gated",
        value: false,
        updatedBy: "articles-postgres-test",
      },
    });

    await db.site.create({
      data: {
        id: siteId,
        slug: `articles-site-${randomUUID()}`,
        name: "Le Petit Meunier",
        status: "CLAIMED",
        address: "12 Rue du Four, Paris",
        phone: "+33 1 42 00 00 00",
        defaultLocale: "fr",
        catalogSections: {
          create: [
            {
              name: "Viennoiseries",
              position: 0,
              items: {
                create: [
                  { name: "Croissant", price: 4.5, currency: "EUR", position: 0 },
                  { name: "Pain au chocolat", price: 3.5, currency: "EUR", position: 1 },
                ],
              },
            },
          ],
        },
        integrations: {
          create: [{ type: "BOOKING", label: "Book a table", url: "https://book.example", position: 0 }],
        },
      },
      select: { id: true },
    });
  });

  afterAll(async () => {
    if (!enabled) return;
    await db.site
      .deleteMany({ where: { id: { in: [...createdSiteIds] } } })
      .catch(() => undefined);
    await db.organization
      .deleteMany({ where: { id: { in: [...createdOrganizationIds] } } })
      .catch(() => undefined);
  });

  test("loads facts from the live draft relations", async () => {
    const inputs = await loadGenerationInputs(siteId);
    if (!inputs.ok) throw new Error(inputs.reason);
    expect(inputs.facts.catalogItems).toContainEqual({
      id: expect.any(String),
      name: "Croissant",
      price: 4.5,
      currency: "EUR",
    });
    expect(inputs.facts.integrationCapabilities).toEqual(["BOOKING"]);
    expect(inputs.facts.address).toBe("12 Rue du Four, Paris");
    expect(inputs.recentTopicKeys).toEqual([]);
  });

  test("retains the predecessor count column through fresh migration deploys", async () => {
    const [schemaContract, migrationContract] = await Promise.all([
      readFile(prismaSchemaPath, "utf8"),
      readFile(outcomeMigrationPath, "utf8"),
    ]);
    expect(schemaContract).toMatch(
      /acceptedCount\s+Int\s+@default\(0\)\s+@map\("producedCount"\)/,
    );
    expect(schemaContract).toMatch(
      /updatedAt\s+DateTime\s+@default\(now\(\)\)\s+@updatedAt/,
    );
    const executableMigration = migrationContract
      .replace(/^--.*$/gm, "")
      .trim();
    expect(executableMigration.startsWith("BEGIN;")).toBe(true);
    expect(executableMigration.endsWith("COMMIT;")).toBe(true);
    expect(migrationContract).not.toContain(
      'RENAME COLUMN "producedCount"',
    );
    expect(migrationContract).not.toContain('"acceptedCount"');

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is required");
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const columns = await client.query<{ column_name: string }>(`
        SELECT "column_name"
        FROM "information_schema"."columns"
        WHERE "table_schema" = current_schema()
          AND "table_name" = 'ArticleBatch'
      `);
      const physicalNames = columns.rows.map((column) => column.column_name);
      expect(physicalNames).toContain("producedCount");
      expect(physicalNames).not.toContain("acceptedCount");

      const triggers = await client.query<{ trigger_name: string }>(`
        SELECT "trigger_name"
        FROM "information_schema"."triggers"
        WHERE "event_object_schema" = current_schema()
          AND "event_object_table" = 'ArticleBatch'
      `);
      expect(triggers.rows.map((trigger) => trigger.trigger_name)).toContain(
        "ArticleBatch_expand_legacy_terminal",
      );
    } finally {
      await client.end().catch(() => undefined);
    }
  });

  test("expands a predecessor writer row to terminal during rolling deploys", async () => {
    const legacySiteId = await createClaimedSite({ paid: true });
    const legacyBatchId = `legacy-writer-${randomUUID()}`;
    const completedAt = new Date();
    await db.$executeRaw`
      INSERT INTO "ArticleBatch" (
        "id", "siteId", "requestedCount", "producedCount", "model",
        "requestedBy", "completedAt"
      ) VALUES (
        ${legacyBatchId}, ${legacySiteId}, ${3}, ${1}, ${"legacy-model"},
        ${"legacy-container"}, ${completedAt}
      )
    `;
    await db.$executeRaw`
      UPDATE "ArticleBatch"
      SET "producedCount" = ${1}
      WHERE "id" = ${legacyBatchId}
    `;

    const expanded = await db.articleBatch.findUniqueOrThrow({
      where: { id: legacyBatchId },
      select: {
        requestedCount: true,
        acceptedCount: true,
        rejectedCount: true,
        status: true,
        statusReason: true,
        startedAt: true,
        completedAt: true,
        updatedAt: true,
      },
    });
    expect(expanded).toMatchObject({
      requestedCount: 3,
      acceptedCount: 1,
      rejectedCount: 2,
      status: "SUCCEEDED",
      statusReason: null,
      startedAt: expect.any(Date),
      completedAt,
      updatedAt: expect.any(Date),
    });

    const next = await reserveArticleBatch({
      siteId: legacySiteId,
      requestedBy: "post-rollout-admission",
      count: 4,
    });
    expect(next.ok).toBe(true);
    if (!next.ok) throw new Error(next.reason);
    await closeArticleBatch({
      batchId: next.batchId,
      status: "ZERO_OUTPUT",
      statusReason: "TEST_CLEANUP",
    });
  });

  test("backfills predecessor outcomes and installs the active-batch fence", async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is required");
    const schema = `article_batch_upgrade_${randomUUID().replaceAll("-", "")}`;
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}", public`);
      await client.query(`
        CREATE TABLE "ArticleBatch" (
          "id" TEXT PRIMARY KEY,
          "siteId" TEXT NOT NULL,
          "requestedCount" INTEGER NOT NULL,
          "producedCount" INTEGER NOT NULL,
          "model" TEXT,
          "requestedBy" TEXT NOT NULL,
          "completedAt" TIMESTAMP(3),
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await client.query(`
        CREATE TABLE "OperatorSetting" (
          "key" TEXT PRIMARY KEY,
          "value" JSONB NOT NULL,
          "updatedBy" TEXT,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL
        )
      `);
      await client.query(`
        INSERT INTO "ArticleBatch" (
          "id", "siteId", "requestedCount", "producedCount", "requestedBy", "completedAt"
        ) VALUES
          ('legacy-zero', 'legacy-site-zero', 0, 0, 'legacy-script', NOW()),
          ('legacy-rejected', 'legacy-site-rejected', 2, 0, 'legacy-workflow', NOW()),
          ('legacy-succeeded', 'legacy-site-succeeded', 4, 2, 'legacy-workflow', NOW())
      `);
      await client.query(await readFile(outcomeMigrationPath, "utf8"));

      expect(
        (
          await client.query<{ value: boolean }>(`
            SELECT "value" FROM "OperatorSetting"
            WHERE "key" = 'articles.mutations.gated'
          `)
        ).rows,
      ).toEqual([{ value: true }]);

      const columns = await client.query<{ column_name: string }>(
        `SELECT "column_name"
         FROM "information_schema"."columns"
         WHERE "table_schema" = $1
           AND "table_name" = 'ArticleBatch'`,
        [schema],
      );
      const physicalNames = columns.rows.map((column) => column.column_name);
      expect(physicalNames).toContain("producedCount");
      expect(physicalNames).not.toContain("acceptedCount");

      const outcomes = await client.query<{
        id: string;
        requestedCount: number;
        acceptedCount: number;
        rejectedCount: number;
        status: string;
        statusReason: string | null;
      }>(`
        SELECT "id", "requestedCount", "producedCount" AS "acceptedCount", "rejectedCount",
               "status"::text, "statusReason"
        FROM "ArticleBatch"
        ORDER BY "id"
      `);
      expect(outcomes.rows).toEqual([
        {
          id: "legacy-rejected",
          requestedCount: 2,
          acceptedCount: 0,
          rejectedCount: 2,
          status: "REJECTED",
          statusReason: "ALL_DRAFTS_REJECTED",
        },
        {
          id: "legacy-succeeded",
          requestedCount: 4,
          acceptedCount: 2,
          rejectedCount: 2,
          status: "SUCCEEDED",
          statusReason: null,
        },
        {
          id: "legacy-zero",
          requestedCount: 0,
          acceptedCount: 0,
          rejectedCount: 0,
          status: "ZERO_OUTPUT",
          statusReason: "LEGACY_ZERO_OUTPUT",
        },
      ]);

      await client.query(`
        INSERT INTO "ArticleBatch" (
          "id", "siteId", "requestedCount", "producedCount", "model",
          "requestedBy", "completedAt"
        ) VALUES (
          'legacy-client-after-upgrade', 'legacy-client-site', 3, 1,
          'legacy-model', 'legacy-container', NOW()
        )
      `);
      expect(
        (
          await client.query<{
            acceptedCount: number;
            rejectedCount: number;
            status: string;
            statusReason: string | null;
            startedAt: Date;
            updatedAt: Date;
          }>(`
            SELECT "producedCount" AS "acceptedCount", "rejectedCount",
                   "status"::text, "statusReason", "startedAt", "updatedAt"
            FROM "ArticleBatch"
            WHERE "id" = 'legacy-client-after-upgrade'
          `)
        ).rows[0],
      ).toEqual({
        acceptedCount: 1,
        rejectedCount: 2,
        status: "SUCCEEDED",
        statusReason: null,
        startedAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });

      const activeInsert = (id: string) =>
        client.query(
          `INSERT INTO "ArticleBatch" (
             "id", "siteId", "requestedCount", "requestedBy"
           ) VALUES ($1, 'one-active-site', 4, 'migration-test')`,
          [id],
        );
      await activeInsert("active-one");
      expect(
        (
          await client.query<{
            acceptedCount: number;
            rejectedCount: number;
            status: string;
          }>(`
            SELECT "producedCount" AS "acceptedCount", "rejectedCount", "status"::text
            FROM "ArticleBatch"
            WHERE "id" = 'active-one'
          `)
        ).rows[0],
      ).toEqual({ acceptedCount: 0, rejectedCount: 0, status: "QUEUED" });
      await expect(activeInsert("active-two")).rejects.toMatchObject({
        code: "23505",
      });
    } finally {
      await client.query("SET search_path TO public").catch(() => undefined);
      await client
        .query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        .catch(() => undefined);
      await client.end().catch(() => undefined);
    }
  });

  test("refuses unclaimed sites", async () => {
    const prospect = await db.site.create({
      data: { id: `articles-prospect-${randomUUID()}`, slug: `prospect-${randomUUID()}`, name: "Prospect" },
      select: { id: true },
    });
    const inputs = await loadGenerationInputs(prospect.id);
    expect(inputs.ok).toBe(false);
    await db.site.delete({ where: { id: prospect.id } });
  });

  test("persists a batch as drafts with a completed batch row", async () => {
    const inputs = await loadGenerationInputs(siteId);
    if (!inputs.ok) throw new Error(inputs.reason);
    const croissantId = catalogItemIdByName(inputs.facts.catalogItems, "Croissant");

    const batchId = await createRunningBatch(siteId, 4);
    const persisted = await persistArticleBatch({
      batchId,
      siteId,
      model: "test-model",
      plans: [
        factualPlan(croissantId, "seasonal-menu"),
        {
          contractVersion: 1,
          topicKey: "neighbourhood-guide",
          templateKey: "restaurant-location",
          catalogItemId: null,
          priceMode: "omit",
        },
      ],
    });

    expect(persisted.producedCount).toBe(2);
    expect(
      await db.articleBatch.findUniqueOrThrow({ where: { id: batchId } }),
    ).toMatchObject({
      requestedCount: 4,
      acceptedCount: 2,
      rejectedCount: 0,
      status: "SUCCEEDED",
      statusReason: null,
      model: "test-model",
    });
    const rows = await db.article.findMany({ where: { siteId } });
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.status).toBe("DRAFT");
      expect(row.batchId).toBe(persisted.batchId);
      expect(row.sourceBatchId).toBe(persisted.batchId);
    }
  });

  test("dedupes slugs across batches", async () => {
    const inputs = await loadGenerationInputs(siteId);
    if (!inputs.ok) throw new Error(inputs.reason);
    const croissantId = catalogItemIdByName(inputs.facts.catalogItems, "Croissant");

    const persisted = await persistArticleBatch({
      batchId: await createRunningBatch(siteId, 1),
      siteId,
      plans: [factualPlan(croissantId, "seasonal-menu")],
    });
    expect(persisted.producedCount).toBe(1);

    const slugs = (
      await db.article.findMany({
        where: { siteId },
        select: { slug: true },
      })
    ).map((row) => row.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs).toContain("seasonal-menu-2");
  });

  test("extracts exactly the last two batches' topics for dedupe", async () => {
    // Third batch; only batch two's and batch three's topics may appear.
    const inputs = await loadGenerationInputs(siteId);
    if (!inputs.ok) throw new Error(inputs.reason);
    const croissantId = catalogItemIdByName(inputs.facts.catalogItems, "Croissant");
    await persistArticleBatch({
      batchId: await createRunningBatch(siteId, 1),
      siteId,
      plans: [factualPlan(croissantId, "chef-story")],
    });

    const afterThird = await loadGenerationInputs(siteId);
    if (!afterThird.ok) throw new Error(afterThird.reason);
    // Batch 2 (seasonal-menu) + batch 3 (chef-story); batch 1 must be excluded.
    expect([...afterThird.recentTopicKeys].sort()).toEqual(
      ["chef-story", "seasonal-menu"].sort(),
    );
  });

  test("guardrails shrink the batch instead of failing it", async () => {
    const inputs = await loadGenerationInputs(siteId);
    if (!inputs.ok) throw new Error(inputs.reason);
    const persisted = await persistArticleBatch({
      batchId: await createRunningBatch(siteId, 1),
      siteId,
      plans: [
        {
          contractVersion: 1,
          topicKey: "dietary-faqs",
          templateKey: "restaurant-dietary-enquiry",
          catalogItemId: `unknown-${randomUUID()}`,
          priceMode: "omit",
        },
      ],
    });
    expect(persisted.producedCount).toBe(0);
    expect(
      await db.articleBatch.findUniqueOrThrow({
        where: { id: persisted.batchId },
      }),
    ).toMatchObject({
      requestedCount: 1,
      acceptedCount: 0,
      rejectedCount: 1,
      status: "REJECTED",
      statusReason: "ALL_DRAFTS_REJECTED",
    });
    expect(
      await db.article.count({ where: { siteId, topicKey: "dietary-faqs" } }),
    ).toBe(0);

    const afterRejected = await loadGenerationInputs(siteId);
    if (!afterRejected.ok) throw new Error(afterRejected.reason);
    expect([...afterRejected.recentTopicKeys].sort()).toEqual(
      ["chef-story", "seasonal-menu"].sort(),
    );
  });

  test("re-resolves selected catalog facts at persistence and snapshots them", async () => {
    const snapshotSiteId = await createClaimedSite();
    const inputs = await loadGenerationInputs(snapshotSiteId);
    if (!inputs.ok) throw new Error(inputs.reason);
    const catalogItemId = inputs.facts.catalogItems[0]!.id;
    const selectedPlans = [
      { ...factualPlan(catalogItemId, "seasonal-menu"), priceMode: "exact" as const },
      factualPlan(catalogItemId, "dietary-faqs"),
    ];

    await db.catalogItem.update({
      where: { id: catalogItemId },
      data: {
        name: "Current Snapshot Croissant",
        price: 8.25,
        currency: "GBP",
      },
    });
    const persisted = await persistArticleBatch({
      batchId: await createRunningBatch(snapshotSiteId, selectedPlans.length),
      siteId: snapshotSiteId,
      plans: selectedPlans,
    });
    expect(persisted).toMatchObject({ producedCount: 2, rejectedCount: 0 });

    const beforeLaterEdit = await db.article.findMany({
      where: { batchId: persisted.batchId },
      orderBy: { topicKey: "asc" },
      select: {
        id: true,
        topicKey: true,
        title: true,
        excerpt: true,
        bodyMarkdown: true,
      },
    });
    const exact = beforeLaterEdit.find(
      (article) => article.topicKey === "seasonal-menu",
    );
    const omitted = beforeLaterEdit.find(
      (article) => article.topicKey === "dietary-faqs",
    );
    const currentPrice = testPrice(8.25, "GBP", "en");
    expect(exact).toBeDefined();
    expect(omitted).toBeDefined();
    expect(Object.values(exact ?? {}).join("\n")).toContain(currentPrice);
    expect(Object.values(exact ?? {}).join("\n")).not.toContain(
      "Current Snapshot Croissant",
    );
    expect(Object.values(omitted ?? {}).join("\n")).not.toContain(
      "Current Snapshot Croissant",
    );

    await db.catalogItem.update({
      where: { id: catalogItemId },
      data: { name: "Later Catalog Name", price: 99, currency: "USD" },
    });
    expect(
      await db.article.findMany({
        where: { batchId: persisted.batchId },
        orderBy: { topicKey: "asc" },
        select: {
          id: true,
          topicKey: true,
          title: true,
          excerpt: true,
          bodyMarkdown: true,
        },
      }),
    ).toEqual(beforeLaterEdit);
  });

  test("binds an exact price to the selected ID when names collide", async () => {
    const bindingSiteId = await createClaimedSite();
    const first = await loadGenerationInputs(bindingSiteId);
    if (!first.ok) throw new Error(first.reason);
    const firstItem = first.facts.catalogItems[0]!;
    const section = await db.catalogSection.findFirstOrThrow({
      where: { siteId: bindingSiteId },
      select: { id: true },
    });
    const secondItem = await db.catalogItem.create({
      data: {
        sectionId: section.id,
        name: firstItem.name,
        price: 9.75,
        currency: "GBP",
        position: 1,
      },
      select: { id: true },
    });

    const persisted = await persistArticleBatch({
      batchId: await createRunningBatch(bindingSiteId, 1),
      siteId: bindingSiteId,
      plans: [
        {
          ...factualPlan(secondItem.id, "seasonal-menu"),
          priceMode: "exact",
        },
      ],
    });
    const article = await db.article.findFirstOrThrow({
      where: { batchId: persisted.batchId },
      select: { title: true, excerpt: true, bodyMarkdown: true },
    });
    const publicText = Object.values(article).join("\n");
    expect(publicText).toContain(testPrice(9.75, "GBP", "en"));
    expect(publicText).not.toContain(testPrice(4.5, "EUR", "en"));
    expect(publicText).not.toContain(firstItem.name);
  });

  test("rejects deleted, reparented, and cross-site catalog IDs", async () => {
    const deletedSiteId = await createClaimedSite();
    const deletedInputs = await loadGenerationInputs(deletedSiteId);
    if (!deletedInputs.ok) throw new Error(deletedInputs.reason);
    const deletedItemId = deletedInputs.facts.catalogItems[0]!.id;
    await db.catalogItem.delete({ where: { id: deletedItemId } });

    const otherSiteId = await createClaimedSite();
    const otherInputs = await loadGenerationInputs(otherSiteId);
    if (!otherInputs.ok) throw new Error(otherInputs.reason);
    const crossSiteItemId = otherInputs.facts.catalogItems[0]!.id;

    const reparentedSiteId = await createClaimedSite();
    const reparentedInputs = await loadGenerationInputs(reparentedSiteId);
    if (!reparentedInputs.ok) throw new Error(reparentedInputs.reason);
    const reparentedItemId = reparentedInputs.facts.catalogItems[0]!.id;
    const otherSection = await db.catalogSection.findFirstOrThrow({
      where: { siteId: otherSiteId },
      select: { id: true },
    });
    await db.catalogItem.update({
      where: { id: reparentedItemId },
      data: { sectionId: otherSection.id },
    });

    for (const [targetSiteId, catalogItemId] of [
      [deletedSiteId, deletedItemId],
      [deletedSiteId, crossSiteItemId],
      [reparentedSiteId, reparentedItemId],
    ] as const) {
      const persisted = await persistArticleBatch({
        batchId: await createRunningBatch(targetSiteId, 1),
        siteId: targetSiteId,
        plans: [factualPlan(catalogItemId, "seasonal-menu")],
      });
      expect(persisted).toMatchObject({ producedCount: 0, rejectedCount: 1 });
      expect(
        await db.article.count({ where: { batchId: persisted.batchId } }),
      ).toBe(0);
      expect(
        await db.articleBatch.findUniqueOrThrow({
          where: { id: persisted.batchId },
          select: { status: true },
        }),
      ).toEqual({ status: "REJECTED" });
    }
  });

  test("rejects an unsupported current currency for exact price mode", async () => {
    const currencySiteId = await createClaimedSite();
    const inputs = await loadGenerationInputs(currencySiteId);
    if (!inputs.ok) throw new Error(inputs.reason);
    const catalogItemId = inputs.facts.catalogItems[0]!.id;
    await db.catalogItem.update({
      where: { id: catalogItemId },
      data: { currency: "RUB" },
    });

    const persisted = await persistArticleBatch({
      batchId: await createRunningBatch(currencySiteId, 1),
      siteId: currencySiteId,
      plans: [
        {
          ...factualPlan(catalogItemId, "seasonal-menu"),
          priceMode: "exact",
        },
      ],
    });
    expect(persisted).toMatchObject({ producedCount: 0, rejectedCount: 1 });
    expect(await db.article.count({ where: { batchId: persisted.batchId } })).toBe(
      0,
    );
  });

  test("rejects a contact plan when its integration is disabled before persistence", async () => {
    const integrationSiteId = await createClaimedSite();
    await db.site.update({
      where: { id: integrationSiteId },
      data: { phone: "+356 2000 0000" },
    });
    const integration = await db.integration.create({
      data: {
        siteId: integrationSiteId,
        type: "BOOKING",
        label: "Book a table",
        url: "https://book.example.test",
        enabled: true,
      },
      select: { id: true },
    });
    const selectedInputs = await loadGenerationInputs(integrationSiteId);
    if (!selectedInputs.ok) throw new Error(selectedInputs.reason);
    expect(selectedInputs.facts.integrationCapabilities).toEqual(["BOOKING"]);
    const selectedPlan = {
      contractVersion: 1 as const,
      topicKey: "private-events" as const,
      templateKey: "restaurant-group-enquiry" as const,
      catalogItemId: null,
      priceMode: "omit" as const,
    };

    await db.integration.update({
      where: { id: integration.id },
      data: { enabled: false },
    });
    const afterDisable = await loadGenerationInputs(integrationSiteId);
    if (!afterDisable.ok) throw new Error(afterDisable.reason);
    expect(afterDisable.facts.integrationCapabilities).toEqual([]);

    const persisted = await persistArticleBatch({
      batchId: await createRunningBatch(integrationSiteId, 1),
      siteId: integrationSiteId,
      plans: [selectedPlan],
    });
    expect(persisted).toMatchObject({ producedCount: 0, rejectedCount: 1 });
    expect(await db.article.count({ where: { batchId: persisted.batchId } })).toBe(
      0,
    );
    expect(
      await db.articleBatch.findUniqueOrThrow({
        where: { id: persisted.batchId },
        select: { status: true, statusReason: true },
      }),
    ).toEqual({ status: "REJECTED", statusReason: "ALL_DRAFTS_REJECTED" });
  });

  test("qualifies ordering only from enabled ordering or delivery capabilities", async () => {
    const orderingSiteId = await createClaimedSite();
    await db.site.update({
      where: { id: orderingSiteId },
      data: { vertical: "FOOD_RETAIL" },
    });
    await db.integration.createMany({
      data: [
        {
          siteId: orderingSiteId,
          type: "ORDERING",
          label: "Disabled order link",
          url: "https://disabled-order.example.test",
          enabled: false,
        },
        {
          siteId: orderingSiteId,
          type: "BOOKING",
          label: "Wrong capability",
          url: "https://booking.example.test",
          enabled: true,
        },
        {
          siteId: orderingSiteId,
          type: "SOCIAL",
          label: "Social only",
          url: "https://social.example.test",
          enabled: true,
        },
        {
          siteId: orderingSiteId,
          type: "ANALYTICS",
          label: "Analytics only",
          url: "https://analytics.example.test",
          enabled: true,
        },
      ],
    });
    const plan = {
      contractVersion: 1 as const,
      topicKey: "ordering-options" as const,
      templateKey: "retail-ordering-options" as const,
      catalogItemId: null,
      priceMode: "omit" as const,
    };
    const withoutOrdering = await loadGenerationInputs(orderingSiteId);
    if (!withoutOrdering.ok) throw new Error(withoutOrdering.reason);
    expect(withoutOrdering.facts.integrationCapabilities).toEqual(["BOOKING"]);
    const rejected = await persistArticleBatch({
      batchId: await createRunningBatch(orderingSiteId, 1),
      siteId: orderingSiteId,
      plans: [plan],
    });
    expect(rejected).toMatchObject({ producedCount: 0, rejectedCount: 1 });

    const delivery = await db.integration.create({
      data: {
        siteId: orderingSiteId,
        type: "DELIVERY",
        label: "Published delivery link",
        url: "https://delivery.example.test",
        enabled: true,
      },
      select: { id: true },
    });
    const withDelivery = await loadGenerationInputs(orderingSiteId);
    if (!withDelivery.ok) throw new Error(withDelivery.reason);
    expect(withDelivery.facts.integrationCapabilities).toEqual([
      "BOOKING",
      "DELIVERY",
    ]);

    await db.integration.update({
      where: { id: delivery.id },
      data: { type: "SOCIAL" },
    });
    const rejectedAfterCapabilityChange = await persistArticleBatch({
      batchId: await createRunningBatch(orderingSiteId, 1),
      siteId: orderingSiteId,
      plans: [plan],
    });
    expect(rejectedAfterCapabilityChange).toMatchObject({
      producedCount: 0,
      rejectedCount: 1,
    });

    await db.integration.update({
      where: { id: delivery.id },
      data: { type: "DELIVERY" },
    });
    const accepted = await persistArticleBatch({
      batchId: await createRunningBatch(orderingSiteId, 1),
      siteId: orderingSiteId,
      plans: [plan],
    });
    expect(accepted).toMatchObject({ producedCount: 1, rejectedCount: 0 });
  });

  test("rejects catalog plans hidden from the storefront before persistence", async () => {
    for (const vertical of ["RESTAURANT", "FOOD_RETAIL"] as const) {
      const visibilitySiteId = await createClaimedSite();
      if (vertical === "FOOD_RETAIL") {
        await db.site.update({
          where: { id: visibilitySiteId },
          data: { vertical },
        });
        await db.catalogItem.updateMany({
          where: { section: { siteId: visibilitySiteId } },
          data: { attributes: { visible: true } },
        });
      }
      const selectedInputs = await loadGenerationInputs(visibilitySiteId);
      if (!selectedInputs.ok) throw new Error(selectedInputs.reason);
      expect(selectedInputs.facts.catalogItems).toHaveLength(1);
      const catalogItemId = selectedInputs.facts.catalogItems[0]!.id;
      const selectedPlan =
        vertical === "RESTAURANT"
          ? factualPlan(catalogItemId, "seasonal-menu")
          : {
              contractVersion: 1 as const,
              topicKey: "seasonal-stock" as const,
              templateKey: "retail-current-stock" as const,
              catalogItemId,
              priceMode: "omit" as const,
            };

      if (vertical === "RESTAURANT") {
        await db.catalogItem.update({
          where: { id: catalogItemId },
          data: { available: false },
        });
      } else {
        await db.catalogItem.update({
          where: { id: catalogItemId },
          data: { attributes: { visible: false } },
        });
      }
      const hiddenInputs = await loadGenerationInputs(visibilitySiteId);
      if (!hiddenInputs.ok) throw new Error(hiddenInputs.reason);
      expect(hiddenInputs.facts.catalogItems).toEqual([]);

      const persisted = await persistArticleBatch({
        batchId: await createRunningBatch(visibilitySiteId, 1),
        siteId: visibilitySiteId,
        plans: [selectedPlan],
      });
      expect(persisted).toMatchObject({ producedCount: 0, rejectedCount: 1 });
      expect(
        await db.article.count({ where: { batchId: persisted.batchId } }),
      ).toBe(0);
      expect(
        await db.articleBatch.findUniqueOrThrow({
          where: { id: persisted.batchId },
          select: { status: true },
        }),
      ).toEqual({ status: "REJECTED" });
    }
  });

  test("atomically creates one reservation across concurrent admissions", async () => {
    const concurrentSiteId = await createClaimedSite();
    const results = await Promise.all([
      reserveArticleBatch({
        siteId: concurrentSiteId,
        requestedBy: "concurrent-one",
        count: 4,
      }),
      reserveArticleBatch({
        siteId: concurrentSiteId,
        requestedBy: "concurrent-two",
        count: 4,
      }),
    ]);

    expect(
      results.filter((result) => result.ok && result.acquired),
    ).toHaveLength(1);
    expect(
      await db.articleBatch.count({ where: { siteId: concurrentSiteId } }),
    ).toBe(1);
    const winner = results.find((result) => result.ok && result.acquired);
    if (!winner?.ok) throw new Error("concurrent admission had no winner");
    for (const result of results) {
      if (result.ok) expect(result.batchId).toBe(winner.batchId);
      else expect(result.status).toBe(409);
    }
    await closeArticleBatch({
      batchId: winner.batchId,
      status: "ZERO_OUTPUT",
      statusReason: "TEST_CLEANUP",
    });
  });

  test("the durable release gate blocks admission and queued dispatch", async () => {
    const gatedSiteId = await createClaimedSite({ paid: true });
    const previousApiKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "test-only-never-sent";
    let startCalls = 0;
    try {
      await db.operatorSetting.update({
        where: { key: "articles.mutations.gated" },
        data: { value: true, updatedBy: "article-gate-test" },
      });
      expect(
        await startArticleBatch(
          {
            siteId: gatedSiteId,
            slug: "unused-gated-slug",
            requestedBy: "gated-start",
            count: 4,
          },
          async () => {
            startCalls += 1;
            return `run_unexpected_${randomUUID()}`;
          },
        ),
      ).toMatchObject({ ok: false, status: 503 });
      expect(
        await db.articleBatch.count({ where: { siteId: gatedSiteId } }),
      ).toBe(0);

      const reservation = await reserveArticleBatch({
        siteId: gatedSiteId,
        requestedBy: "reserve-before-gate-dispatch",
        count: 4,
      });
      if (!reservation.ok) throw new Error(reservation.reason);
      expect(
        await dispatchArticleBatch(reservation.batchId, async () => {
          startCalls += 1;
          return `run_unexpected_${randomUUID()}`;
        }),
      ).toMatchObject({ ok: false, status: 503 });
      expect(startCalls).toBe(0);
      await db.operatorSetting.update({
        where: { key: "articles.mutations.gated" },
        data: { value: false, updatedBy: "article-gate-test-cleanup" },
      });
      await closeArticleBatch({
        batchId: reservation.batchId,
        status: "ZERO_OUTPUT",
        statusReason: "TEST_CLEANUP",
      });
    } finally {
      await db.operatorSetting.update({
        where: { key: "articles.mutations.gated" },
        data: { value: false, updatedBy: "articles-postgres-test" },
      });
      restoreEnvironment("OPENROUTER_API_KEY", previousApiKey);
    }
  });

  test("redispatches the same queued row after a reserve-only crash", async () => {
    const crashSiteId = await createClaimedSite();
    const first = await reserveArticleBatch({
      siteId: crashSiteId,
      requestedBy: "reserve-before-crash",
      count: 4,
    });
    if (!first.ok) throw new Error(first.reason);
    expect(first.acquired).toBe(true);
    const workflowRunId = `run_redispatch_${randomUUID()}`;
    const previousApiKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "test-only-never-sent";
    try {
      const replay = await startArticleBatch(
        {
          siteId: crashSiteId,
          slug: "unused-redispatch-slug",
          requestedBy: "request-after-crash",
          count: 2,
        },
        async (batchId, dispatchLeaseToken) => {
          expect(batchId).toBe(first.batchId);
          expect(dispatchLeaseToken).toBeTruthy();
          return workflowRunId;
        },
      );
      expect(replay).toEqual({ ok: true, runId: workflowRunId });
      expect(
        await db.articleBatch.findUniqueOrThrow({
          where: { id: first.batchId },
          select: {
            requestedBy: true,
            requestedCount: true,
            status: true,
            workflowRunId: true,
            dispatchLeaseToken: true,
            dispatchLeaseUntil: true,
          },
        }),
      ).toEqual({
        requestedBy: "reserve-before-crash",
        requestedCount: 4,
        status: "QUEUED",
        workflowRunId,
        dispatchLeaseToken: null,
        dispatchLeaseUntil: null,
      });
      expect(
        await db.articleBatch.count({ where: { siteId: crashSiteId } }),
      ).toBe(1);
      await closeArticleBatch({
        batchId: first.batchId,
        workflowRunId,
        status: "ZERO_OUTPUT",
        statusReason: "TEST_CLEANUP",
      });
    } finally {
      restoreEnvironment("OPENROUTER_API_KEY", previousApiKey);
    }
  });

  test("the dispatcher recovers an unbound queued reservation", async () => {
    const queuedSiteId = await createClaimedSite({ paid: true });
    const admission = await reserveArticleBatch({
      siteId: queuedSiteId,
      requestedBy: "dispatcher-crash-recovery",
      count: 4,
    });
    if (!admission.ok) throw new Error(admission.reason);
    const workflowRunId = `run_dispatcher_recovery_${randomUUID()}`;
    const previousApiKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "test-only-never-sent";
    try {
      expect(
        await dispatchQueuedArticleBatches(new Date(), async (batchId, token) => {
          expect(batchId).toBe(admission.batchId);
          expect(token).toBeTruthy();
          return workflowRunId;
        }),
      ).toEqual({
        attempted: 1,
        started: 1,
        deferred: 0,
        failedToStart: 0,
      });
      expect(
        await db.articleBatch.findUniqueOrThrow({
          where: { id: admission.batchId },
          select: {
            status: true,
            workflowRunId: true,
            dispatchLeaseToken: true,
            dispatchLeaseUntil: true,
          },
        }),
      ).toEqual({
        status: "QUEUED",
        workflowRunId,
        dispatchLeaseToken: null,
        dispatchLeaseUntil: null,
      });
      await closeArticleBatch({
        batchId: admission.batchId,
        workflowRunId,
        status: "ZERO_OUTPUT",
        statusReason: "TEST_CLEANUP",
      });
    } finally {
      restoreEnvironment("OPENROUTER_API_KEY", previousApiKey);
    }
  });

  test("lets one concurrent dispatcher own a fresh lease", async () => {
    const dispatchSiteId = await createClaimedSite({ paid: true });
    const admission = await reserveArticleBatch({
      siteId: dispatchSiteId,
      requestedBy: "concurrent-dispatch",
      count: 4,
    });
    if (!admission.ok) throw new Error(admission.reason);
    const workflowRunId = `run_dispatch_winner_${randomUUID()}`;
    let startCalls = 0;
    let releaseStart!: () => void;
    const startGate = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    let observeStart!: () => void;
    const startObserved = new Promise<void>((resolve) => {
      observeStart = resolve;
    });
    const winner = dispatchArticleBatch(
      admission.batchId,
      async () => {
        startCalls += 1;
        observeStart();
        await startGate;
        return workflowRunId;
      },
    );
    await startObserved;
    const contender = await dispatchArticleBatch(
      admission.batchId,
      async () => {
        startCalls += 1;
        return `run_unexpected_${randomUUID()}`;
      },
    );
    expect(contender).toMatchObject({ ok: false, status: 409 });
    releaseStart();
    expect(await winner).toEqual({ ok: true, runId: workflowRunId });
    expect(startCalls).toBe(1);
    await closeArticleBatch({
      batchId: admission.batchId,
      workflowRunId,
      status: "ZERO_OUTPUT",
      statusReason: "TEST_CLEANUP",
    });
  });

  test("defers a fresh dispatch lease and reclaims it after expiry", async () => {
    const leaseSiteId = await createClaimedSite({ paid: true });
    const admission = await reserveArticleBatch({
      siteId: leaseSiteId,
      requestedBy: "dispatch-lease-expiry",
      count: 4,
    });
    if (!admission.ok) throw new Error(admission.reason);
    const now = new Date();
    await db.articleBatch.update({
      where: { id: admission.batchId },
      data: {
        dispatchLeaseToken: `lease_fresh_${randomUUID()}`,
        dispatchLeaseUntil: new Date(
          now.getTime() + articleBatchDispatchLeaseMs,
        ),
      },
    });
    let startCalls = 0;
    expect(
      await dispatchArticleBatch(
        admission.batchId,
        async () => {
          startCalls += 1;
          return `run_unexpected_${randomUUID()}`;
        },
        now,
      ),
    ).toMatchObject({ ok: false, status: 409 });
    expect(startCalls).toBe(0);

    await db.articleBatch.update({
      where: { id: admission.batchId },
      data: { dispatchLeaseUntil: new Date(now.getTime() - 1) },
    });
    const workflowRunId = `run_reclaimed_${randomUUID()}`;
    expect(
      await dispatchArticleBatch(
        admission.batchId,
        async () => {
          startCalls += 1;
          return workflowRunId;
        },
        now,
      ),
    ).toEqual({ ok: true, runId: workflowRunId });
    expect(startCalls).toBe(1);
    await closeArticleBatch({
      batchId: admission.batchId,
      workflowRunId,
      status: "ZERO_OUTPUT",
      statusReason: "TEST_CLEANUP",
    });
  });

  test("fences a leased queued row from ownerless and wrong-owner writes", async () => {
    const leasedSiteId = await createClaimedSite({ paid: true });
    const inputs = await loadGenerationInputs(leasedSiteId);
    if (!inputs.ok) throw new Error(inputs.reason);
    const catalogItemId = inputs.facts.catalogItems[0]!.id;
    const admission = await reserveArticleBatch({
      siteId: leasedSiteId,
      requestedBy: "leased-owner-fence",
      count: 1,
    });
    if (!admission.ok) throw new Error(admission.reason);
    const dispatchLeaseToken = `lease_owner_fence_${randomUUID()}`;
    await db.articleBatch.update({
      where: { id: admission.batchId },
      data: {
        dispatchLeaseToken,
        dispatchLeaseUntil: new Date(
          Date.now() + articleBatchDispatchLeaseMs,
        ),
      },
    });
    const persistInput = {
      batchId: admission.batchId,
      siteId: leasedSiteId,
      plans: [factualPlan(catalogItemId, "seasonal-menu")],
    };
    await expect(persistArticleBatch(persistInput)).rejects.toThrow(
      "Article batch reservation is not running",
    );
    await expect(
      persistArticleBatch({
        ...persistInput,
        workflowRunId: `run_wrong_leased_${randomUUID()}`,
      }),
    ).rejects.toThrow("Article batch workflow owner does not match");
    expect(
      await closeArticleBatch({
        batchId: admission.batchId,
        status: "FAILED",
        statusReason: "OWNERLESS_CLOSE",
      }),
    ).toBe(false);
    expect(
      await closeArticleBatch({
        batchId: admission.batchId,
        workflowRunId: `run_wrong_leased_${randomUUID()}`,
        status: "FAILED",
        statusReason: "WRONG_OWNER_CLOSE",
      }),
    ).toBe(false);
    expect(
      await db.articleBatch.findUniqueOrThrow({
        where: { id: admission.batchId },
        select: {
          status: true,
          workflowRunId: true,
          dispatchLeaseToken: true,
          acceptedCount: true,
          rejectedCount: true,
        },
      }),
    ).toEqual({
      status: "QUEUED",
      workflowRunId: null,
      dispatchLeaseToken,
      acceptedCount: 0,
      rejectedCount: 0,
    });
    expect(
      await db.article.count({ where: { batchId: admission.batchId } }),
    ).toBe(0);

    await db.articleBatch.update({
      where: { id: admission.batchId },
      data: { dispatchLeaseToken: null, dispatchLeaseUntil: null },
    });
    await closeArticleBatch({
      batchId: admission.batchId,
      status: "ZERO_OUTPUT",
      statusReason: "TEST_CLEANUP",
    });
  });

  test("fences a delayed workflow after its dispatch lease is replaced", async () => {
    const fencedSiteId = await createClaimedSite({ paid: true });
    const admission = await reserveArticleBatch({
      siteId: fencedSiteId,
      requestedBy: "dispatch-fence",
      count: 4,
    });
    if (!admission.ok) throw new Error(admission.reason);
    const now = new Date();
    const oldLeaseToken = `lease_old_${randomUUID()}`;
    await db.articleBatch.update({
      where: { id: admission.batchId },
      data: {
        dispatchLeaseToken: oldLeaseToken,
        dispatchLeaseUntil: new Date(now.getTime() - 1),
      },
    });
    const oldWorkflowRunId = `run_old_${randomUUID()}`;
    const winningWorkflowRunId = `run_new_${randomUUID()}`;
    const result = await dispatchArticleBatch(
      admission.batchId,
      async (batchId, winningLeaseToken) => {
        expect(winningLeaseToken).not.toBe(oldLeaseToken);
        expect(
          await beginArticleBatch(
            batchId,
            oldWorkflowRunId,
            oldLeaseToken,
          ),
        ).toBeNull();
        expect(
          await beginArticleBatch(
            batchId,
            winningWorkflowRunId,
            winningLeaseToken,
          ),
        ).toEqual({ siteId: fencedSiteId, requestedCount: 4 });
        return winningWorkflowRunId;
      },
      now,
    );
    expect(result).toEqual({ ok: true, runId: winningWorkflowRunId });
    expect(
      await db.articleBatch.findUniqueOrThrow({
        where: { id: admission.batchId },
        select: {
          status: true,
          workflowRunId: true,
          dispatchLeaseToken: true,
          dispatchLeaseUntil: true,
        },
      }),
    ).toEqual({
      status: "RUNNING",
      workflowRunId: winningWorkflowRunId,
      dispatchLeaseToken: null,
      dispatchLeaseUntil: null,
    });
    await closeArticleBatch({
      batchId: admission.batchId,
      workflowRunId: winningWorkflowRunId,
      status: "ZERO_OUTPUT",
      statusReason: "TEST_CLEANUP",
    });
  });

  test("never reclaims a healthy running workflow from updatedAt", async () => {
    const runningSiteId = await createClaimedSite({ paid: true });
    const admission = await reserveArticleBatch({
      siteId: runningSiteId,
      requestedBy: "healthy-long-running",
      count: 4,
    });
    if (!admission.ok) throw new Error(admission.reason);
    const workflowRunId = `run_healthy_long_${randomUUID()}`;
    const dispatchLeaseToken = `lease_healthy_long_${randomUUID()}`;
    await db.articleBatch.update({
      where: { id: admission.batchId },
      data: {
        dispatchLeaseToken,
        dispatchLeaseUntil: new Date(
          Date.now() + articleBatchDispatchLeaseMs,
        ),
      },
    });
    await beginArticleBatch(
      admission.batchId,
      workflowRunId,
      dispatchLeaseToken,
    );
    const started = await db.articleBatch.findUniqueOrThrow({
      where: { id: admission.batchId },
      select: { startedAt: true },
    });
    const yearsOld = new Date("2000-01-01T00:00:00.000Z");
    await db.articleBatch.update({
      where: { id: admission.batchId },
      data: { updatedAt: yearsOld },
    });
    const previousApiKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "test-only-never-sent";
    let startCalls = 0;
    try {
      const blocked = await startArticleBatch(
        {
          siteId: runningSiteId,
          slug: "unused-running-slug",
          requestedBy: "healthy-long-running-retry",
          count: 2,
        },
        async () => {
          startCalls += 1;
          return `run_unexpected_${randomUUID()}`;
        },
      );
      expect(blocked).toMatchObject({ ok: false, status: 409 });
    } finally {
      restoreEnvironment("OPENROUTER_API_KEY", previousApiKey);
    }
    expect(startCalls).toBe(0);
    expect(
      await db.articleBatch.findUniqueOrThrow({
        where: { id: admission.batchId },
        select: {
          status: true,
          workflowRunId: true,
          startedAt: true,
          updatedAt: true,
        },
      }),
    ).toEqual({
      status: "RUNNING",
      workflowRunId,
      startedAt: started.startedAt,
      updatedAt: yearsOld,
    });
    expect(
      await db.articleBatch.count({ where: { siteId: runningSiteId } }),
    ).toBe(1);
    await closeArticleBatch({
      batchId: admission.batchId,
      workflowRunId,
      status: "ZERO_OUTPUT",
      statusReason: "TEST_CLEANUP",
    });
  });

  test("reconciles bound batches only from durable terminal Workflow state", async () => {
    const workflowName =
      "workflow//./src/workflows/article-batch//articleBatchWorkflow";
    const cases = [
      { engine: "pending", batch: "QUEUED", expected: "QUEUED" },
      { engine: "running", batch: "RUNNING", expected: "RUNNING" },
      { engine: "completed", batch: "QUEUED", expected: "FAILED" },
      { engine: "failed", batch: "RUNNING", expected: "FAILED" },
      { engine: "cancelled", batch: "RUNNING", expected: "FAILED" },
      { engine: "wrong-workflow", batch: "RUNNING", expected: "RUNNING" },
      { engine: "lookup-error", batch: "QUEUED", expected: "QUEUED" },
    ] as const;
    const rows: Array<{
      engine: (typeof cases)[number]["engine"];
      batch: (typeof cases)[number]["batch"];
      expected: (typeof cases)[number]["expected"];
      batchId: string;
      workflowRunId: string;
      index: number;
    }> = [];
    for (const [index, testCase] of cases.entries()) {
      const targetSiteId = await createClaimedSite({ paid: true });
      const admission = await reserveArticleBatch({
        siteId: targetSiteId,
        requestedBy: `workflow-reconcile-${testCase.engine}`,
        count: 4,
      });
      if (!admission.ok) throw new Error(admission.reason);
      const workflowRunId = `run_reconcile_${testCase.engine}_${randomUUID()}`;
      await db.articleBatch.update({
        where: { id: admission.batchId },
        data: {
          status: testCase.batch,
          workflowRunId,
          rejectedCount: index,
          ...(testCase.batch === "RUNNING" ? { startedAt: new Date() } : {}),
          // A passive timestamp must not affect any case.
          updatedAt: new Date("2000-01-01T00:00:00.000Z"),
        },
      });
      rows.push({ ...testCase, batchId: admission.batchId, workflowRunId, index });
    }

    expect(
      await reconcileBoundArticleBatches(async (workflowRunId) => {
        const row = rows.find((candidate) => candidate.workflowRunId === workflowRunId);
        if (!row) throw new Error("unexpected workflow run");
        if (row.engine === "lookup-error") {
          throw new Error("synthetic Workflow lookup failure");
        }
        return {
          status:
            row.engine === "wrong-workflow" ? "completed" : row.engine,
          workflowName:
            row.engine === "wrong-workflow"
              ? "workflow//./src/workflows/source-monitoring//sourceMonitoringWorkflow"
              : workflowName,
        };
      }),
    ).toEqual({ inspected: 7, active: 2, closed: 3, deferred: 2 });

    for (const row of rows) {
      const actual = await db.articleBatch.findUniqueOrThrow({
        where: { id: row.batchId },
        select: {
          status: true,
          statusReason: true,
          rejectedCount: true,
          workflowRunId: true,
        },
      });
      expect(actual.status).toBe(row.expected);
      expect(actual.rejectedCount).toBe(row.index);
      expect(actual.workflowRunId).toBe(row.workflowRunId);
      if (row.engine === "completed") {
        expect(actual.statusReason).toBe(
          "WORKFLOW_COMPLETED_WITHOUT_BATCH_OUTCOME",
        );
      } else if (row.engine === "failed") {
        expect(actual.statusReason).toBe("WORKFLOW_ENGINE_FAILED");
      } else if (row.engine === "cancelled") {
        expect(actual.statusReason).toBe("WORKFLOW_ENGINE_CANCELLED");
      } else {
        expect(actual.statusReason).toBeNull();
      }
    }

    const completed = rows.find((row) => row.engine === "completed");
    if (!completed) throw new Error("missing completed Workflow case");
    const completedBatch = await db.articleBatch.findUniqueOrThrow({
      where: { id: completed.batchId },
      select: { siteId: true },
    });
    const next = await reserveArticleBatch({
      siteId: completedBatch.siteId,
      requestedBy: "after-terminal-reconciliation",
      count: 1,
    });
    expect(next.ok).toBe(true);
    if (next.ok) {
      await closeArticleBatch({
        batchId: next.batchId,
        status: "ZERO_OUTPUT",
        statusReason: "TEST_CLEANUP",
      });
    }

    for (const row of rows.filter((candidate) => candidate.expected !== "FAILED")) {
      await closeArticleBatch({
        batchId: row.batchId,
        workflowRunId: row.workflowRunId,
        status: "ZERO_OUTPUT",
        statusReason: "TEST_CLEANUP",
      });
    }
  });

  test("fences persistence and terminal closes by workflow owner", async () => {
    const ownerSiteId = await createClaimedSite({ paid: true });
    const inputs = await loadGenerationInputs(ownerSiteId);
    if (!inputs.ok) throw new Error(inputs.reason);
    const catalogItemId = inputs.facts.catalogItems[0]!.id;
    const admission = await reserveArticleBatch({
      siteId: ownerSiteId,
      requestedBy: "terminal-owner-fence",
      count: 1,
    });
    if (!admission.ok) throw new Error(admission.reason);
    const workflowRunId = `run_terminal_owner_${randomUUID()}`;
    const dispatchLeaseToken = `lease_terminal_owner_${randomUUID()}`;
    await db.articleBatch.update({
      where: { id: admission.batchId },
      data: {
        dispatchLeaseToken,
        dispatchLeaseUntil: new Date(
          Date.now() + articleBatchDispatchLeaseMs,
        ),
      },
    });
    await beginArticleBatch(
      admission.batchId,
      workflowRunId,
      dispatchLeaseToken,
    );
    const wrongWorkflowRunId = `run_terminal_loser_${randomUUID()}`;
    await expect(
      persistArticleBatch({
        batchId: admission.batchId,
        workflowRunId: wrongWorkflowRunId,
        siteId: ownerSiteId,
        plans: [factualPlan(catalogItemId, "seasonal-menu")],
      }),
    ).rejects.toThrow("Article batch workflow owner does not match");
    expect(
      await closeArticleBatch({
        batchId: admission.batchId,
        workflowRunId: wrongWorkflowRunId,
        status: "FAILED",
        statusReason: "WRONG_OWNER",
      }),
    ).toBe(false);

    const persisted = await persistArticleBatch({
      batchId: admission.batchId,
      workflowRunId,
      siteId: ownerSiteId,
      plans: [factualPlan(catalogItemId, "seasonal-menu")],
    });
    expect(persisted).toMatchObject({ producedCount: 1, rejectedCount: 0 });
    expect(
      await persistArticleBatch({
        batchId: admission.batchId,
        workflowRunId,
        siteId: ownerSiteId,
        plans: [factualPlan(catalogItemId, "seasonal-menu")],
      }),
    ).toEqual(persisted);
    await expect(
      persistArticleBatch({
        batchId: admission.batchId,
        workflowRunId: wrongWorkflowRunId,
        siteId: ownerSiteId,
        plans: [factualPlan(catalogItemId, "seasonal-menu")],
      }),
    ).rejects.toThrow("Article batch workflow owner does not match");
    expect(
      await db.articleBatch.findUniqueOrThrow({
        where: { id: admission.batchId },
        select: { status: true, workflowRunId: true, acceptedCount: true },
      }),
    ).toEqual({
      status: "SUCCEEDED",
      workflowRunId,
      acceptedCount: 1,
    });
  });

  test("admits one workflow owner and idempotently replays only that owner", async () => {
    const beginSiteId = await createClaimedSite();
    const admission = await reserveArticleBatch({
      siteId: beginSiteId,
      requestedBy: "concurrent-begin-test",
      count: 4,
    });
    if (!admission.ok) throw new Error(admission.reason);
    const dispatchLeaseToken = `lease_begin_owner_${randomUUID()}`;
    await db.articleBatch.update({
      where: { id: admission.batchId },
      data: {
        dispatchLeaseToken,
        dispatchLeaseUntil: new Date(
          Date.now() + articleBatchDispatchLeaseMs,
        ),
      },
    });

    const workflowRunIds = Array.from(
      { length: 8 },
      (_, index) => `run_begin_owner_${index}_${randomUUID()}`,
    );
    const attempts = await Promise.all(
      workflowRunIds.map((workflowRunId) =>
        beginArticleBatch(
          admission.batchId,
          workflowRunId,
          dispatchLeaseToken,
        ),
      ),
    );
    const winnerIndexes = attempts.flatMap((attempt, index) =>
      attempt === null ? [] : [index],
    );
    expect(winnerIndexes).toHaveLength(1);
    const winnerIndex = winnerIndexes[0];
    if (winnerIndex === undefined) throw new Error("batch begin had no owner");
    const winningWorkflowRunId = workflowRunIds[winnerIndex];
    expect(attempts[winnerIndex]).toEqual({
      siteId: beginSiteId,
      requestedCount: 4,
    });

    const firstTransition = await db.articleBatch.findUniqueOrThrow({
      where: { id: admission.batchId },
      select: { status: true, startedAt: true, workflowRunId: true },
    });
    expect(firstTransition).toMatchObject({
      status: "RUNNING",
      startedAt: expect.any(Date),
      workflowRunId: winningWorkflowRunId,
    });

    expect(
      await beginArticleBatch(admission.batchId, winningWorkflowRunId),
    ).toEqual({ siteId: beginSiteId, requestedCount: 4 });
    expect(
      await beginArticleBatch(
        admission.batchId,
        `run_begin_loser_${randomUUID()}`,
      ),
    ).toBeNull();
    expect(
      await db.articleBatch.findUniqueOrThrow({
        where: { id: admission.batchId },
        select: { status: true, startedAt: true, workflowRunId: true },
      }),
    ).toEqual(firstTransition);

    await closeArticleBatch({
      batchId: admission.batchId,
      workflowRunId: winningWorkflowRunId,
      status: "ZERO_OUTPUT",
      statusReason: "TEST_CLEANUP",
    });
    const terminalTransition = await db.articleBatch.findUniqueOrThrow({
      where: { id: admission.batchId },
      select: { status: true, startedAt: true, workflowRunId: true },
    });
    expect(terminalTransition).toMatchObject({
      status: "ZERO_OUTPUT",
      startedAt: firstTransition.startedAt,
      workflowRunId: winningWorkflowRunId,
    });
    expect(
      await beginArticleBatch(admission.batchId, winningWorkflowRunId),
    ).toBeNull();
    expect(
      await db.articleBatch.findUniqueOrThrow({
        where: { id: admission.batchId },
        select: { status: true, startedAt: true, workflowRunId: true },
      }),
    ).toEqual(terminalTransition);
  });

  test("honors the same workflow owner when start binds it before begin", async () => {
    const preboundSiteId = await createClaimedSite();
    const admission = await reserveArticleBatch({
      siteId: preboundSiteId,
      requestedBy: "prebound-begin-test",
      count: 3,
    });
    if (!admission.ok) throw new Error(admission.reason);
    const workflowRunId = `run_prebound_${randomUUID()}`;
    await db.articleBatch.update({
      where: { id: admission.batchId },
      data: { workflowRunId },
    });

    expect(
      await beginArticleBatch(
        admission.batchId,
        `run_prebound_loser_${randomUUID()}`,
      ),
    ).toBeNull();
    expect(
      await beginArticleBatch(admission.batchId, workflowRunId),
    ).toEqual({ siteId: preboundSiteId, requestedCount: 3 });
    expect(
      await db.articleBatch.findUniqueOrThrow({
        where: { id: admission.batchId },
        select: { status: true, workflowRunId: true },
      }),
    ).toEqual({ status: "RUNNING", workflowRunId });

    await closeArticleBatch({
      batchId: admission.batchId,
      workflowRunId,
      status: "ZERO_OUTPUT",
      statusReason: "TEST_CLEANUP",
    });
  });

  test("allows paid cadence bypass only after the active batch is terminal", async () => {
    const paidSiteId = await createClaimedSite({ paid: true });
    const starts = await Promise.all([
      reserveArticleBatch({
        siteId: paidSiteId,
        requestedBy: "paid-one",
        count: 4,
      }),
      reserveArticleBatch({
        siteId: paidSiteId,
        requestedBy: "paid-two",
        count: 4,
      }),
    ]);
    expect(
      starts.filter((result) => result.ok && result.acquired),
    ).toHaveLength(1);
    const first = starts.find((result) => result.ok && result.acquired);
    if (!first?.ok) throw new Error("paid admission had no winner");
    for (const result of starts) {
      if (result.ok) expect(result.batchId).toBe(first.batchId);
      else expect(result.status).toBe(409);
    }
    await closeArticleBatch({
      batchId: first.batchId,
      status: "ZERO_OUTPUT",
      statusReason: "MODEL_RETURNED_ZERO_DRAFTS",
    });

    const next = await reserveArticleBatch({
      siteId: paidSiteId,
      requestedBy: "paid-next",
      count: 4,
    });
    expect(next.ok).toBe(true);
    if (!next.ok) throw new Error(next.reason);
    await closeArticleBatch({
      batchId: next.batchId,
      status: "ZERO_OUTPUT",
      statusReason: "TEST_CLEANUP",
    });
  });

  test("keeps requested, accepted, and rejected counts independent and replay-safe", async () => {
    const accountingSiteId = await createClaimedSite();
    const inputs = await loadGenerationInputs(accountingSiteId);
    if (!inputs.ok) throw new Error(inputs.reason);
    const catalogItemId = inputs.facts.catalogItems[0]!.id;
    const admission = await reserveArticleBatch({
      siteId: accountingSiteId,
      requestedBy: "accounting-test",
      count: 4,
    });
    if (!admission.ok) throw new Error(admission.reason);
    expect(await beginArticleBatch(admission.batchId)).toMatchObject({
      siteId: accountingSiteId,
      requestedCount: 4,
    });
    const persistInput = {
      batchId: admission.batchId,
      siteId: accountingSiteId,
      plans: [
        factualPlan(catalogItemId, "seasonal-menu"),
        {
          ...factualPlan(`unknown-${randomUUID()}`, "dietary-faqs"),
        },
      ],
    };
    const first = await persistArticleBatch(persistInput);
    const replay = await persistArticleBatch(persistInput);

    expect(first).toEqual(replay);
    expect(first).toMatchObject({ producedCount: 1, rejectedCount: 1 });
    expect(
      await db.articleBatch.findUniqueOrThrow({
        where: { id: admission.batchId },
      }),
    ).toMatchObject({
      requestedCount: 4,
      acceptedCount: 1,
      rejectedCount: 1,
      status: "SUCCEEDED",
    });
    expect(
      await db.article.count({ where: { batchId: admission.batchId } }),
    ).toBe(1);
    expect(
      await closeArticleBatch({
        batchId: admission.batchId,
        status: "FAILED",
        statusReason: "LATE_FAILURE",
      }),
    ).toBe(false);
    expect(
      await db.articleBatch.findUniqueOrThrow({
        where: { id: admission.batchId },
        select: { status: true },
      }),
    ).toEqual({ status: "SUCCEEDED" });
  });

  test("terminal zero, skipped, rejected, and failed outcomes close and consume cadence", async () => {
    const outcomes = [
      ["ZERO_OUTPUT", "MODEL_RETURNED_ZERO_DRAFTS", 0],
      ["SKIPPED", "SITE_INELIGIBLE", 0],
      ["REJECTED", "ALL_DRAFTS_REJECTED", 2],
      ["FAILED", "GENERATION_FAILED", 0],
    ] as const;

    for (const [status, statusReason, rejectedCount] of outcomes) {
      const outcomeSiteId = await createClaimedSite();
      const admission = await reserveArticleBatch({
        siteId: outcomeSiteId,
        requestedBy: `outcome-${status.toLowerCase()}`,
        count: 4,
      });
      if (!admission.ok) throw new Error(admission.reason);
      await beginArticleBatch(admission.batchId);
      expect(
        await closeArticleBatch({
          batchId: admission.batchId,
          status,
          statusReason,
          rejectedCount,
        }),
      ).toBe(true);
      const terminal = await db.articleBatch.findUniqueOrThrow({
        where: { id: admission.batchId },
      });
      expect(terminal).toMatchObject({
        requestedCount: 4,
        acceptedCount: 0,
        rejectedCount,
        status,
        statusReason,
      });
      expect(terminal.completedAt).toBeInstanceOf(Date);
      const completedAt = terminal.completedAt;
      expect(
        await closeArticleBatch({
          batchId: admission.batchId,
          status,
          statusReason: "MUST_NOT_REWRITE",
          rejectedCount: 99,
        }),
      ).toBe(true);
      expect(
        await db.articleBatch.findUniqueOrThrow({
          where: { id: admission.batchId },
          select: {
            completedAt: true,
            rejectedCount: true,
            statusReason: true,
          },
        }),
      ).toEqual({ completedAt, rejectedCount, statusReason });

      const retry = await reserveArticleBatch({
        siteId: outcomeSiteId,
        requestedBy: "cadence-retry",
        count: 4,
      });
      expect(retry).toMatchObject({ ok: false, status: 409 });
    }
  });

  test("workflow start failures release the same reservation for retry", async () => {
    const failureSiteId = await createClaimedSite();
    const previousApiKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "test-only-never-sent";
    let startAttempts = 0;
    try {
      expect(
        await startArticleBatch(
          {
            siteId: failureSiteId,
            slug: "unused-test-slug",
            requestedBy: "start-failure-test",
            count: 4,
          },
          async () => {
            startAttempts += 1;
            throw new Error("synthetic workflow start failure");
          },
        ),
      ).toMatchObject({ ok: false, status: 503 });

      const released = await db.articleBatch.findFirstOrThrow({
        where: { siteId: failureSiteId },
        select: {
          id: true,
          requestedBy: true,
          requestedCount: true,
          acceptedCount: true,
          rejectedCount: true,
          status: true,
          statusReason: true,
          workflowRunId: true,
          dispatchLeaseToken: true,
          dispatchLeaseUntil: true,
        },
      });
      expect(released).toMatchObject({
        requestedBy: "start-failure-test",
        requestedCount: 4,
        acceptedCount: 0,
        rejectedCount: 0,
        status: "QUEUED",
        statusReason: null,
        workflowRunId: null,
        dispatchLeaseToken: null,
        dispatchLeaseUntil: null,
      });

      const workflowRunId = `run_after_start_retry_${randomUUID()}`;
      expect(
        await startArticleBatch(
          {
            siteId: failureSiteId,
            slug: "unused-test-slug",
            requestedBy: "start-failure-retry",
            count: 2,
          },
          async (batchId, dispatchLeaseToken) => {
            startAttempts += 1;
            expect(batchId).toBe(released.id);
            expect(dispatchLeaseToken).toBeTruthy();
            return workflowRunId;
          },
        ),
      ).toEqual({ ok: true, runId: workflowRunId });
      expect(
        await db.articleBatch.findMany({
          where: { siteId: failureSiteId },
          select: {
            id: true,
            requestedBy: true,
            requestedCount: true,
            status: true,
            workflowRunId: true,
          },
        }),
      ).toEqual([
        {
          id: released.id,
          requestedBy: "start-failure-test",
          requestedCount: 4,
          status: "QUEUED",
          workflowRunId,
        },
      ]);
      await closeArticleBatch({
        batchId: released.id,
        workflowRunId,
        status: "ZERO_OUTPUT",
        statusReason: "TEST_CLEANUP",
      });
    } finally {
      restoreEnvironment("OPENROUTER_API_KEY", previousApiKey);
    }

    expect(startAttempts).toBe(2);
  });

  test("binds the workflow run id after a fast terminal outcome", async () => {
    const fastSiteId = await createClaimedSite();
    const previousApiKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "test-only-never-sent";
    const workflowRunId = `run_fast_${randomUUID()}`;
    try {
      const result = await startArticleBatch(
        {
          siteId: fastSiteId,
          slug: "unused-fast-terminal-slug",
          requestedBy: "fast-terminal-test",
          count: 4,
        },
        async (batchId, dispatchLeaseToken) => {
          await beginArticleBatch(
            batchId,
            workflowRunId,
            dispatchLeaseToken,
          );
          await closeArticleBatch({
            batchId,
            workflowRunId,
            status: "ZERO_OUTPUT",
            statusReason: "MODEL_RETURNED_ZERO_DRAFTS",
          });
          return workflowRunId;
        },
      );
      if (!result.ok) throw new Error(result.reason);
      expect(
        await db.articleBatch.findFirstOrThrow({
          where: { siteId: fastSiteId },
          select: { status: true, workflowRunId: true },
        }),
      ).toEqual({ status: "ZERO_OUTPUT", workflowRunId: result.runId });
    } finally {
      restoreEnvironment("OPENROUTER_API_KEY", previousApiKey);
    }
  });

  test("publishing an article makes it visible to the public reader", async () => {
    const { listPublishedArticles, getPublishedArticle } = await import(
      "@/lib/articles/public-articles"
    );
    const slugRow = await db.article.findFirstOrThrow({
      where: { siteId, topicKey: "seasonal-menu" },
      select: { id: true, slug: true },
    });

    const site = await db.site.findUniqueOrThrow({
      where: { id: siteId },
      select: { slug: true },
    });

    // Unattested surface sees nothing.
    expect(
      await listPublishedArticles({ slug: site!.slug, versionId: null }),
    ).toEqual([]);

    // Drafts are invisible even with attestation.
    expect(
      await listPublishedArticles({ slug: site!.slug, versionId: "sv_any" }),
    ).toEqual([]);

    await db.article.update({
      where: { id: slugRow.id },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });

    const published = await listPublishedArticles({
      slug: site!.slug,
      versionId: "sv_any",
    });
    expect(published.length).toBe(1);
    expect(published[0]!.slug).toBe(slugRow.slug);

    const one = await getPublishedArticle({
      slug: site!.slug,
      versionId: "sv_any",
      articleSlug: slugRow.slug,
    });
    expect(one?.title).toBeTruthy();
  });

  test("workflow failures preserve provider rejections in the durable outcome", async () => {
    const failureSiteId = await createClaimedSite();
    const admission = await reserveArticleBatch({
      siteId: failureSiteId,
      requestedBy: "workflow-rejection-carry",
      count: 2,
    });
    if (!admission.ok) throw new Error(admission.reason);
    const workflowRunId = `run_rejection_carry_${randomUUID()}`;
    const dispatchLeaseToken = `lease_rejection_carry_${randomUUID()}`;
    await db.articleBatch.update({
      where: { id: admission.batchId },
      data: {
        dispatchLeaseToken,
        dispatchLeaseUntil: new Date(Date.now() + articleBatchDispatchLeaseMs),
      },
    });

    const [actualWorkflow, actualGeneration] = await Promise.all([
      import("workflow"),
      import("@/lib/articles/generation"),
    ]);
    try {
      mock.module("workflow", () => ({
        ...actualWorkflow,
        getWorkflowMetadata: () => ({ workflowRunId }),
        getWritable: () => ({
          getWriter: () => ({
            write: async () => undefined,
            releaseLock: () => undefined,
          }),
        }),
      }));
      mock.module("@/lib/articles/generation", () => ({
        ...actualGeneration,
        generateBatchPlans: async (input: {
          facts: { catalogItems: Array<{ id: string }> };
        }) => ({
          status: "GENERATED" as const,
          plans: [
            {
              ...factualPlan(
                input.facts.catalogItems[0]!.id,
                "seasonal-menu",
              ),
              priceMode: "exact" as const,
            },
          ],
          rejectedCount: 1,
        }),
        persistArticleBatch: async () => {
          throw new Error("synthetic persistence failure");
        },
      }));
      const { articleBatchWorkflow } = await import("@/workflows/article-batch");

      await expect(
        articleBatchWorkflow({
          batchId: admission.batchId,
          dispatchLeaseToken,
        }),
      ).rejects.toThrow("synthetic persistence failure");
      expect(
        await db.articleBatch.findUniqueOrThrow({
          where: { id: admission.batchId },
          select: {
            requestedCount: true,
            acceptedCount: true,
            rejectedCount: true,
            status: true,
            statusReason: true,
            workflowRunId: true,
          },
        }),
      ).toEqual({
        requestedCount: 2,
        acceptedCount: 0,
        rejectedCount: 1,
        status: "FAILED",
        statusReason: "GENERATION_FAILED",
        workflowRunId,
      });
      expect(
        await db.article.count({ where: { batchId: admission.batchId } }),
      ).toBe(0);
    } finally {
      mock.module("workflow", () => actualWorkflow);
      mock.module("@/lib/articles/generation", () => actualGeneration);
    }
  });
});

async function createRunningBatch(
  targetSiteId: string,
  requestedCount: number,
): Promise<string> {
  const batch = await db.articleBatch.create({
    data: {
      siteId: targetSiteId,
      requestedCount,
      requestedBy: "test-operator",
    },
    select: { id: true },
  });
  const started = await beginArticleBatch(batch.id);
  if (!started) throw new Error("test article batch did not start");
  return batch.id;
}

async function createClaimedSite(options: { paid?: boolean } = {}): Promise<string> {
  const targetSiteId = `articles-outcome-${randomUUID()}`;
  createdSiteIds.add(targetSiteId);
  let organizationId: string | undefined;
  if (options.paid) {
    organizationId = `articles-org-${randomUUID()}`;
    createdOrganizationIds.add(organizationId);
    await db.organization.create({
      data: { id: organizationId, name: "Article batch test organization" },
    });
  }

  await db.site.create({
    data: {
      id: targetSiteId,
      slug: `articles-outcome-${randomUUID()}`,
      name: "Article Batch Test Bakery",
      status: "CLAIMED",
      defaultLocale: "en",
      organizationId,
      catalogSections: {
        create: {
          name: "Bakes",
          position: 0,
          items: {
            create: {
              name: "Croissant",
              price: 4.5,
              currency: "EUR",
              position: 0,
            },
          },
        },
      },
      ...(organizationId
        ? {
            subscription: {
              create: {
                stripeCustomerId: `cus_${randomUUID()}`,
                stripeSubscriptionId: `sub_${randomUUID()}`,
                stripePriceId: "price_article_batch_test",
                status: "ACTIVE" as const,
                organizationId,
              },
            },
          }
        : {}),
    },
    select: { id: true },
  });
  return targetSiteId;
}

function factualPlan(
  catalogItemId: string,
  topicKey: "seasonal-menu" | "dietary-faqs" | "chef-story",
) {
  const templateKey = {
    "seasonal-menu": "restaurant-current-menu",
    "dietary-faqs": "restaurant-dietary-enquiry",
    "chef-story": "restaurant-menu-facts",
  } as const;
  return {
    contractVersion: 1 as const,
    topicKey,
    templateKey: templateKey[topicKey],
    catalogItemId,
    priceMode: "omit" as const,
  };
}

function catalogItemIdByName(
  items: Array<{ id: string; name: string }>,
  name: string,
): string {
  const item = items.find((candidate) => candidate.name === name);
  if (!item) throw new Error(`Catalog item not found: ${name}`);
  return item.id;
}

function testPrice(price: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: price % 1 === 0 ? 0 : 2,
  }).format(price);
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
