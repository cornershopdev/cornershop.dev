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
const createdSiteIds = new Set([siteId]);
const createdOrganizationIds = new Set<string>();
let db: ReturnType<typeof import("@/lib/db").getDb>;
let loadGenerationInputs: typeof import("@/lib/articles/generation").loadGenerationInputs;
let persistArticleBatch: typeof import("@/lib/articles/generation").persistArticleBatch;
let beginArticleBatch: typeof import("@/lib/articles/generation").beginArticleBatch;
let closeArticleBatch: typeof import("@/lib/articles/generation").closeArticleBatch;
let reserveArticleBatch: typeof import("@/lib/articles/start-batch").reserveArticleBatch;
let startArticleBatch: typeof import("@/lib/articles/start-batch").startArticleBatch;

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
    ({ reserveArticleBatch, startArticleBatch } = await import(
      "@/lib/articles/start-batch"
    ));

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
      name: "Croissant",
      price: 4.5,
      currency: "EUR",
    });
    expect(inputs.facts.integrationLabels).toEqual(["Book a table"]);
    expect(inputs.facts.address).toBe("12 Rue du Four, Paris");
    expect(inputs.recentTopicKeys).toEqual([]);
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
        INSERT INTO "ArticleBatch" (
          "id", "siteId", "requestedCount", "producedCount", "requestedBy", "completedAt"
        ) VALUES
          ('legacy-zero', 'legacy-site-zero', 0, 0, 'legacy-script', NOW()),
          ('legacy-rejected', 'legacy-site-rejected', 2, 0, 'legacy-workflow', NOW()),
          ('legacy-succeeded', 'legacy-site-succeeded', 4, 2, 'legacy-workflow', NOW())
      `);
      await client.query(await readFile(outcomeMigrationPath, "utf8"));

      const outcomes = await client.query<{
        id: string;
        requestedCount: number;
        acceptedCount: number;
        rejectedCount: number;
        status: string;
        statusReason: string | null;
      }>(`
        SELECT "id", "requestedCount", "acceptedCount", "rejectedCount",
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

      const activeInsert = (id: string) =>
        client.query(
          `INSERT INTO "ArticleBatch" (
             "id", "siteId", "requestedCount", "requestedBy", "updatedAt"
           ) VALUES ($1, 'one-active-site', 4, 'migration-test', NOW())`,
          [id],
        );
      await activeInsert("active-one");
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

    const batchId = await createRunningBatch(siteId, 4);
    const persisted = await persistArticleBatch({
      batchId,
      siteId,
      facts: inputs.facts,
      model: "test-model",
      drafts: [
        {
          topicKey: "seasonal-menu",
          slug: "seasonal-menu-update",
          title: "In season now",
          excerpt: "What the ovens are doing this month.",
          bodyMarkdown:
            "Our croissant lamination stays the same all year. ".repeat(20),
          catalogClaims: [
            { name: "Croissant", price: null, currency: null },
          ],
        },
        {
          topicKey: "neighbourhood-guide",
          slug: "where-to-find-us",
          title: "Find us in the fifth",
          excerpt: "Directions and what is nearby.",
          bodyMarkdown:
            "We are on Rue du Four between the bakery and the bookshop. ".repeat(
              15,
            ),
          catalogClaims: [],
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

    const persisted = await persistArticleBatch({
      batchId: await createRunningBatch(siteId, 1),
      siteId,
      facts: inputs.facts,
      drafts: [
        {
          topicKey: "dietary-faqs",
          slug: "seasonal-menu-update",
          title: "Same slug, different article",
          excerpt: "Slug collision test.",
          bodyMarkdown:
            "Ask us about the Croissant ingredients before choosing. ".repeat(15),
          catalogClaims: [
            { name: "Croissant", price: null, currency: null },
          ],
        },
      ],
    });
    expect(persisted.producedCount).toBe(1);

    const slugs = (
      await db.article.findMany({
        where: { siteId },
        select: { slug: true },
      })
    ).map((row) => row.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs).toContain("seasonal-menu-update-2");
  });

  test("extracts exactly the last two batches' topics for dedupe", async () => {
    // Third batch; only batch two's and batch three's topics may appear.
    const inputs = await loadGenerationInputs(siteId);
    if (!inputs.ok) throw new Error(inputs.reason);
    await persistArticleBatch({
      batchId: await createRunningBatch(siteId, 1),
      siteId,
      facts: inputs.facts,
      drafts: [
        {
          topicKey: "chef-story",
          slug: "our-kitchen",
          title: "Our kitchen",
          excerpt: "Suppliers and method.",
          bodyMarkdown:
            "Our Croissant is folded in the kitchen in small batches. ".repeat(12),
          catalogClaims: [
            { name: "Croissant", price: null, currency: null },
          ],
        },
      ],
    });

    const afterThird = await loadGenerationInputs(siteId);
    if (!afterThird.ok) throw new Error(afterThird.reason);
    // Batch 2 (dietary-faqs) + batch 3 (chef-story); batch 1 must be excluded.
    expect([...afterThird.recentTopicKeys].sort()).toEqual(
      ["chef-story", "dietary-faqs"].sort(),
    );
  });

  test("guardrails shrink the batch instead of failing it", async () => {
    const inputs = await loadGenerationInputs(siteId);
    if (!inputs.ok) throw new Error(inputs.reason);
    const persisted = await persistArticleBatch({
      batchId: await createRunningBatch(siteId, 1),
      siteId,
      facts: inputs.facts,
      drafts: [
        {
          topicKey: "trends",
          slug: "award-winning-bakes",
          title: "Award winning bakes",
          excerpt: "This should never persist.",
          bodyMarkdown: "We are award winning and certified organic. ".repeat(10),
          catalogClaims: [],
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
    expect(await db.article.count({ where: { siteId, topicKey: "trends" } })).toBe(0);

    const afterRejected = await loadGenerationInputs(siteId);
    if (!afterRejected.ok) throw new Error(afterRejected.reason);
    expect([...afterRejected.recentTopicKeys].sort()).toEqual(
      ["chef-story", "dietary-faqs"].sort(),
    );
  });

  test("atomically admits one of two concurrent starts", async () => {
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

    const admitted = results.filter((result) => result.ok);
    expect(admitted).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    expect(
      await db.articleBatch.count({ where: { siteId: concurrentSiteId } }),
    ).toBe(1);
    const winner = admitted[0];
    if (!winner?.ok) throw new Error("concurrent admission had no winner");
    await closeArticleBatch({
      batchId: winner.batchId,
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
    const admitted = starts.filter((result) => result.ok);
    expect(admitted).toHaveLength(1);
    const first = admitted[0];
    if (!first?.ok) throw new Error("paid admission had no winner");
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
      facts: inputs.facts,
      drafts: [
        factualDraft("accounting-factual", "seasonal-menu"),
        {
          ...factualDraft("accounting-invented", "first-visit"),
          bodyMarkdown: "The invented Moonbeam Tart is ready today. ".repeat(15),
          catalogClaims: [
            { name: "Moonbeam Tart", price: 12, currency: "EUR" },
          ],
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

  test("workflow start failures close the reservation without provider work", async () => {
    const failureSiteId = await createClaimedSite();
    const previousApiKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "test-only-never-sent";
    let startAttempts = 0;
    try {
      await expect(
        startArticleBatch(
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
      ).rejects.toThrow("synthetic workflow start failure");
    } finally {
      restoreEnvironment("OPENROUTER_API_KEY", previousApiKey);
    }

    expect(startAttempts).toBe(1);
    expect(
      await db.articleBatch.findFirstOrThrow({
        where: { siteId: failureSiteId },
      }),
    ).toMatchObject({
      requestedCount: 4,
      acceptedCount: 0,
      rejectedCount: 0,
      status: "FAILED",
      statusReason: "WORKFLOW_START_FAILED",
    });
    const retry = await reserveArticleBatch({
      siteId: failureSiteId,
      requestedBy: "failed-start-retry",
      count: 4,
    });
    expect(retry).toMatchObject({ ok: false, status: 409 });
  });

  test("binds the workflow run id after a fast terminal outcome", async () => {
    const fastSiteId = await createClaimedSite();
    const previousApiKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "test-only-never-sent";
    try {
      const result = await startArticleBatch(
        {
          siteId: fastSiteId,
          slug: "unused-fast-terminal-slug",
          requestedBy: "fast-terminal-test",
          count: 4,
        },
        async (batchId) => {
          await beginArticleBatch(batchId);
          await closeArticleBatch({
            batchId,
            status: "ZERO_OUTPUT",
            statusReason: "MODEL_RETURNED_ZERO_DRAFTS",
          });
          return `run_fast_${randomUUID()}`;
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
      select: { slug: true },
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

    await db.article.updateMany({
      where: { siteId, topicKey: "seasonal-menu" },
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

function factualDraft(slug: string, topicKey: string) {
  return {
    topicKey,
    slug,
    title: "A factual bakery article",
    excerpt: "A source-backed look at one familiar bake.",
    bodyMarkdown:
      "Our Croissant is folded carefully and baked in small batches each morning. ".repeat(
        10,
      ),
    catalogClaims: [
      { name: "Croissant", price: null, currency: null },
    ],
  };
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
