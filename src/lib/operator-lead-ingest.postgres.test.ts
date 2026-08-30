import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";

const enabled = process.env.OPERATOR_LEAD_INGEST_POSTGRES_TEST === "1";
if (enabled) mock.module("server-only", () => ({}));

const suffix = randomUUID();
const safeSuffix = suffix.replaceAll("-", "");
const originalSource = `https://old-${suffix}.example.test/catalog`;
const finalSource = `https://new-${suffix}.example.test/shop`;
const failedOriginalSource = `https://failed-old-${suffix}.example.test/menu`;
const failedFinalSource = `https://failed-new-${suffix}.example.test/restaurant`;
const successfulSlug = `redirected-lead-${suffix}`;
const failedSlug = `failed-redirected-lead-${suffix}`;
const failurePlaceId = `forced-ingest-failure-${suffix}`;
const triggerName = `lead_ingest_failure_trigger_${safeSuffix}`;
const triggerFunction = `lead_ingest_failure_function_${safeSuffix}`;
const rerunSource = `https://rerun-${suffix}.example.test`;
const rerunSlug = `rerun-eligible-${suffix}`;
const reopenSource = `https://reopen-${suffix}.example.test`;
const reopenSlug = `reopen-eligible-${suffix}`;
const redirectUpdateSource = `https://redirect-update-${suffix}.example.test`;
const redirectUpdateSlug = `redirect-update-eligible-${suffix}`;
const fenceSource = `https://fence-${suffix}.example.test`;
const fenceSlug = `fence-eligible-${suffix}`;
const fencePlaceId = `fence-ingest-${suffix}`;
const fenceTriggerName = `lead_ingest_fence_trigger_${safeSuffix}`;
const fenceTriggerFunction = `lead_ingest_fence_function_${safeSuffix}`;
const fenceLockClassId = 1381259068;
const fenceLockObjectId = 172;
const reviewedSource = `https://reviewed-${suffix}.example.test`;
const reviewedSlug = `reviewed-${suffix}`;
const reviewedCollisionSource = `https://reviewed-collision-${suffix}.example.test`;
const reviewedCollisionSlug = `reviewed-collision-${suffix}`;

let db: ReturnType<typeof import("@/lib/db").getDb>;
let createImportJob: typeof import("@/lib/site-persistence").createImportJob;
let persistSiteImport: typeof import("@/lib/site-persistence").persistSiteImport;
let recordImportFailure: typeof import("@/lib/site-persistence").recordImportFailure;
let sampleSiteDraft: typeof import("@/lib/restaurant").sampleSiteDraft;
let createLeadDiscoveryRecord: typeof import("@/lib/operator-lead-attributes").createLeadDiscoveryRecord;
let createLeadEligibilityRecord: typeof import("@/lib/operator-lead-attributes").createLeadEligibilityRecord;
let parseLeadEligibility: typeof import("@/lib/operator-lead-attributes").parseLeadEligibility;
let parseLeadDiscovery: typeof import("@/lib/operator-lead-attributes").parseLeadDiscovery;
let ingestOperatorProspectLead: typeof import("@/lib/operator-lead-ingest").ingestOperatorProspectLead;
let createOrReopenOperatorLead: typeof import("@/lib/operator-leads").createOrReopenOperatorLead;
let recordOperatorLeadAction: typeof import("@/lib/operator-leads").recordOperatorLeadAction;
let normalizeImportSource: typeof import("@/lib/import-identity").normalizeImportSource;
let importReviewedOperatorDraft: typeof import("@/lib/operator-reviewed-draft-import").importReviewedOperatorDraft;

describe.skipIf(!enabled)("operator discovery import PostgreSQL atomicity", () => {
  beforeAll(async () => {
    const database = await import("@/lib/db");
    db = database.getDb();
    ({ createImportJob, persistSiteImport, recordImportFailure } =
      await import("@/lib/site-persistence"));
    ({ sampleSiteDraft } = await import("@/lib/restaurant"));
    ({ createLeadDiscoveryRecord, createLeadEligibilityRecord } =
      await import("@/lib/operator-lead-attributes"));
    ({
      parseLeadEligibility,
      parseLeadDiscovery,
    } = await import("@/lib/operator-lead-attributes"));
    ({ ingestOperatorProspectLead } = await import(
      "@/lib/operator-lead-ingest"
    ));
    ({ createOrReopenOperatorLead, recordOperatorLeadAction } = await import(
      "@/lib/operator-leads"
    ));
    ({ normalizeImportSource } = await import("@/lib/import-identity"));
    ({ importReviewedOperatorDraft } = await import(
      "@/lib/operator-reviewed-draft-import"
    ));

    await db.$executeRawUnsafe(`
      CREATE FUNCTION "${triggerFunction}"() RETURNS trigger AS $failure$
      BEGIN
        IF NEW."type" = 'site.lead.ingested'
           AND NEW."metadata"->>'placeId' = '${failurePlaceId}' THEN
          RAISE EXCEPTION 'forced lead metadata persistence failure';
        END IF;
        RETURN NEW;
      END
      $failure$ LANGUAGE plpgsql
    `);
    await db.$executeRawUnsafe(`
      CREATE TRIGGER "${triggerName}"
      BEFORE INSERT ON "AuditEvent"
      FOR EACH ROW EXECUTE FUNCTION "${triggerFunction}"()
    `);
    await db.$executeRawUnsafe(`
      CREATE FUNCTION "${fenceTriggerFunction}"() RETURNS trigger AS $fence$
      BEGIN
        IF NEW."slug" = '${fenceSlug}' THEN
          PERFORM pg_advisory_xact_lock(${fenceLockClassId}, ${fenceLockObjectId});
        END IF;
        RETURN NEW;
      END
      $fence$ LANGUAGE plpgsql
    `);
    await db.$executeRawUnsafe(`
      CREATE TRIGGER "${fenceTriggerName}"
      BEFORE UPDATE ON "Site"
      FOR EACH ROW EXECUTE FUNCTION "${fenceTriggerFunction}"()
    `);
  });

  afterAll(async () => {
    if (!db) return;
    await db.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS "${triggerName}" ON "AuditEvent"`,
    );
    await db.$executeRawUnsafe(
      `DROP FUNCTION IF EXISTS "${triggerFunction}"()`,
    );
    await db.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS "${fenceTriggerName}" ON "Site"`,
    );
    await db.$executeRawUnsafe(
      `DROP FUNCTION IF EXISTS "${fenceTriggerFunction}"()`,
    );
    await db.site.deleteMany({
      where: {
        slug: {
          in: [
            successfulSlug,
            failedSlug,
            rerunSlug,
            reopenSlug,
            redirectUpdateSlug,
            fenceSlug,
            reviewedSlug,
            reviewedCollisionSlug,
          ],
        },
      },
    });
    await db.importJob.deleteMany({
      where: {
        OR: [
          { source: { in: [originalSource, failedOriginalSource] } },
          {
            sourceKey: {
              in: [
                normalizeImportSource(reviewedSource),
                normalizeImportSource(reviewedCollisionSource),
              ],
            },
          },
        ],
      },
    });
  });

  test("binds redirected preview and discovery evidence to one canonical site", async () => {
    const importJob = await createImportJob(originalSource, "RESTAURANT");
    const discovery = discoveryRecord("redirect-place", finalSource);
    const persisted = await persistSiteImport({
      draft: {
        ...sampleSiteDraft,
        slug: successfulSlug,
        sourceUrl: finalSource,
      },
      vertical: "RESTAURANT",
      source: originalSource,
      importJobId: importJob.id,
      actor: "system:lead-discovery",
      leadIngest: {
        name: "Redirected Lead",
        phone: "+356 2000 0000",
        address: "12 Republic Street, Valletta",
        discovery,
        audit: null,
        eligibility: createLeadEligibilityRecord({
          state: "UNKNOWN",
          evidence: {},
          updatedBy: "system:lead-discovery",
        }),
      },
    });

    const originalKey = normalizeImportSource(originalSource);
    const finalKey = normalizeImportSource(finalSource);
    const sites = await db.site.findMany({
      where: { OR: [{ sourceKey: originalKey }, { sourceKey: finalKey }] },
      select: { id: true, slug: true, sourceKey: true, status: true, attributes: true },
    });
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({
      slug: successfulSlug,
      sourceKey: finalKey,
      status: "PREVIEW_READY",
      attributes: {
        leadDiscovery: {
          placeId: "redirect-place",
          queries: [
            {
              provider: "google_places",
              query: "restaurants in Valletta",
            },
          ],
        },
      },
    });
    expect(persisted.draft.slug).toBe(successfulSlug);
    expect(
      await db.importJob.findUniqueOrThrow({ where: { id: importJob.id } }),
    ).toMatchObject({
      status: "READY",
      sourceKey: finalKey,
      siteId: sites[0]!.id,
    });
    expect(
      await db.auditEvent.count({
        where: { siteId: sites[0]!.id, type: "site.lead.ingested" },
      }),
    ).toBe(1);
  });

  test("rolls back the canonical site when lead metadata persistence fails", async () => {
    const importJob = await createImportJob(failedOriginalSource, "RESTAURANT");
    let failure: unknown;
    try {
      await persistSiteImport({
        draft: {
          ...sampleSiteDraft,
          slug: failedSlug,
          sourceUrl: failedFinalSource,
        },
        vertical: "RESTAURANT",
        source: failedOriginalSource,
        importJobId: importJob.id,
        actor: "system:lead-discovery",
        leadIngest: {
          name: "Failed Redirected Lead",
          phone: null,
          address: null,
          discovery: discoveryRecord(failurePlaceId, failedFinalSource),
          audit: null,
          eligibility: createLeadEligibilityRecord({
            state: "UNKNOWN",
            evidence: {},
            updatedBy: "system:lead-discovery",
          }),
        },
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toContain("forced lead metadata persistence failure");
    await recordImportFailure(importJob.id, failure);

    expect(
      await db.site.count({
        where: {
          OR: [
            { sourceKey: normalizeImportSource(failedOriginalSource) },
            { sourceKey: normalizeImportSource(failedFinalSource) },
            { slug: failedSlug },
          ],
        },
      }),
    ).toBe(0);
    expect(
      await db.importJob.findUniqueOrThrow({ where: { id: importJob.id } }),
    ).toMatchObject({ status: "FAILED", siteId: null });
  });

  test("discovery rerun preserves operator eligibility evidence on exact-source update", async () => {
    const sourceKey = normalizeImportSource(rerunSource);
    await db.site.create({
      data: {
        slug: rerunSlug,
        name: "Eligible Rerun Lead",
        sourceUrl: rerunSource,
        sourceKey,
        vertical: "RESTAURANT",
        status: "PROSPECT",
        attributes: { leadEligibility: operatorEligibleRecord() },
      },
    });

    const result = await ingestOperatorProspectLead({
      source: rerunSource,
      vertical: "RESTAURANT",
      name: "Eligible Rerun Lead",
      city: "Valletta",
      score: 55,
      reasons: ["No online booking"],
      queries: [
        { provider: "google_places", query: "restaurants in Valletta" },
      ],
      generatePreview: false,
    });
    expect(result.reopened).toBe(true);

    const row = await db.site.findUniqueOrThrow({
      where: { sourceKey },
      select: { attributes: true },
    });
    expect(parseLeadEligibility(row.attributes)).toMatchObject({
      state: "ELIGIBLE",
      updatedBy: "operator:console",
      evidence: { owner_consent: "written approval on file" },
    });
    expect(parseLeadDiscovery(row.attributes)).toMatchObject({ score: 55 });
    expect(
      await db.auditEvent.count({
        where: { type: "site.lead.ingest.updated", site: { slug: rerunSlug } },
      }),
    ).toBe(1);
  });

  test("reopen preserves operator eligibility evidence", async () => {
    const sourceKey = normalizeImportSource(reopenSource);
    await db.site.create({
      data: {
        slug: reopenSlug,
        name: "Eligible Reopen Lead",
        sourceUrl: reopenSource,
        sourceKey,
        vertical: "RESTAURANT",
        status: "PROSPECT",
        attributes: { leadEligibility: operatorEligibleRecord() },
      },
    });

    const result = await createOrReopenOperatorLead({
      source: reopenSource,
      vertical: "RESTAURANT",
      actor: "system:lead-discovery",
      leadIngest: {
        name: "Eligible Reopen Lead",
        phone: null,
        address: null,
        discovery: discoveryRecord(`reopen-${suffix}`, reopenSource),
        audit: null,
        eligibility: createLeadEligibilityRecord({
          state: "UNKNOWN",
          evidence: {},
          updatedBy: "system:lead-discovery",
        }),
      },
    });
    expect(result.reopened).toBe(true);

    const row = await db.site.findUniqueOrThrow({
      where: { sourceKey },
      select: { attributes: true, status: true },
    });
    expect(row.status).toBe("PREVIEW_READY");
    expect(parseLeadEligibility(row.attributes)).toMatchObject({
      state: "ELIGIBLE",
      updatedBy: "operator:console",
      evidence: { owner_consent: "written approval on file" },
    });
  });

  test("canonical exact-source import update preserves operator eligibility evidence", async () => {
    const sourceKey = normalizeImportSource(redirectUpdateSource);
    await db.site.create({
      data: {
        slug: redirectUpdateSlug,
        name: "Eligible Redirect Lead",
        sourceUrl: redirectUpdateSource,
        sourceKey,
        vertical: "RESTAURANT",
        status: "PREVIEW_READY",
        attributes: { leadEligibility: operatorEligibleRecord() },
      },
    });
    const importJob = await createImportJob(
      redirectUpdateSource,
      "RESTAURANT",
    );

    const persisted = await persistSiteImport({
      draft: {
        ...sampleSiteDraft,
        slug: redirectUpdateSlug,
        sourceUrl: redirectUpdateSource,
      },
      vertical: "RESTAURANT",
      source: redirectUpdateSource,
      importJobId: importJob.id,
      actor: "system:lead-discovery",
      leadIngest: {
        name: "Eligible Redirect Lead",
        phone: null,
        address: null,
        discovery: discoveryRecord(`redirect-update-${suffix}`, redirectUpdateSource),
        audit: null,
        eligibility: createLeadEligibilityRecord({
          state: "UNKNOWN",
          evidence: {},
          updatedBy: "system:lead-discovery",
        }),
      },
    });
    expect(persisted.created).toBe(false);

    const row = await db.site.findUniqueOrThrow({
      where: { sourceKey },
      select: { attributes: true },
    });
    expect(parseLeadEligibility(row.attributes)).toMatchObject({
      state: "ELIGIBLE",
      updatedBy: "operator:console",
      evidence: { owner_consent: "written approval on file" },
    });
  });

  test("concurrent operator eligibility edit serializes with an ingest rerun", async () => {
    const sourceKey = normalizeImportSource(fenceSource);
    await db.site.create({
      data: {
        slug: fenceSlug,
        name: "Fence Lead",
        sourceUrl: fenceSource,
        sourceKey,
        vertical: "RESTAURANT",
        status: "PROSPECT",
        attributes: {
          leadEligibility: createLeadEligibilityRecord({
            state: "UNKNOWN",
            evidence: {},
            updatedBy: "system:lead-discovery",
          }),
        },
      },
    });

    let releaseBlocker!: () => void;
    let blockerReady!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      blockerReady = resolve;
    });
    const blocker = db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`
        DO $fence_blocker$
        BEGIN
          PERFORM pg_advisory_xact_lock(${fenceLockClassId}, ${fenceLockObjectId});
        END
        $fence_blocker$
      `);
      blockerReady();
      await release;
    });
    await ready;

    const ingest = ingestOperatorProspectLead({
      source: fenceSource,
      vertical: "RESTAURANT",
      name: "Fence Lead",
      city: "Valletta",
      placeId: fencePlaceId,
      score: 61,
      reasons: ["Missing hours"],
      queries: [
        { provider: "google_places", query: "restaurants in Valletta" },
      ],
      generatePreview: false,
    });
    await waitForFenceWaiter();

    // The operator decision starts while the ingest transaction still holds
    // the Site row lock; it must wait for the ingest to commit instead of
    // interleaving between the ingest's attribute read and write.
    const operatorEdit = recordOperatorLeadAction({
      siteSlug: fenceSlug,
      action: "set_eligibility",
      note: null,
      actor: "operator:console",
      eligibility: "ELIGIBLE",
      eligibilityEvidence: { owner_consent: "granted by phone" },
    });

    releaseBlocker();
    await blocker;
    await expect(ingest).resolves.toMatchObject({ reopened: true });
    await expect(operatorEdit).resolves.toBeTruthy();

    const row = await db.site.findUniqueOrThrow({
      where: { sourceKey },
      select: { attributes: true },
    });
    expect(parseLeadEligibility(row.attributes)).toMatchObject({
      state: "ELIGIBLE",
      updatedBy: "operator:console",
      evidence: { owner_consent: "granted by phone" },
    });
    expect(parseLeadDiscovery(row.attributes)).toMatchObject({ score: 61 });
    expect(
      await db.auditEvent.count({
        where: { type: "site.lead.eligibility.updated", site: { slug: fenceSlug } },
      }),
    ).toBe(1);
  });

  test("reviewed draft reruns update one exact preview without changing its slug", async () => {
    const draft = {
      ...sampleSiteDraft,
      slug: reviewedSlug,
      name: "Reviewed private lead",
      sourceUrl: reviewedSource,
    };
    const created = await importReviewedOperatorDraft({
      vertical: "RESTAURANT",
      draft,
    });
    expect(created).toMatchObject({
      slug: reviewedSlug,
      created: true,
      verified: true,
    });

    const updated = await importReviewedOperatorDraft({
      vertical: "RESTAURANT",
      draft: { ...draft, description: "Reviewed copy updated idempotently." },
    });
    expect(updated).toMatchObject({
      slug: reviewedSlug,
      created: false,
      verified: true,
    });
    expect(
      await db.site.count({
        where: {
          OR: [
            { slug: reviewedSlug },
            { sourceKey: normalizeImportSource(reviewedSource) },
          ],
        },
      }),
    ).toBe(1);
    expect(
      await db.site.findUniqueOrThrow({
        where: { slug: reviewedSlug },
        select: { description: true, status: true },
      }),
    ).toMatchObject({
      description: "Reviewed copy updated idempotently.",
      status: "PREVIEW_READY",
    });
  });

  test("reviewed draft import fails closed when its exact slug belongs to another source", async () => {
    await db.site.create({
      data: {
        slug: reviewedCollisionSlug,
        name: "Unrelated existing site",
        sourceUrl: `https://unrelated-${suffix}.example.test`,
        sourceKey: `url:unrelated-${suffix}.example.test`,
        vertical: "RESTAURANT",
        status: "PREVIEW_READY",
        attributes: {},
      },
    });

    await expect(
      importReviewedOperatorDraft({
        vertical: "RESTAURANT",
        draft: {
          ...sampleSiteDraft,
          slug: reviewedCollisionSlug,
          sourceUrl: reviewedCollisionSource,
        },
      }),
    ).rejects.toThrow("conflicts with an existing site");
    expect(
      await db.site.count({
        where: { sourceKey: normalizeImportSource(reviewedCollisionSource) },
      }),
    ).toBe(0);
    expect(
      await db.importJob.findFirstOrThrow({
        where: {
          sourceKey: normalizeImportSource(reviewedCollisionSource),
        },
        orderBy: { createdAt: "desc" },
        select: { status: true, siteId: true },
      }),
    ).toEqual({ status: "FAILED", siteId: null });
  });
});

function operatorEligibleRecord() {
  return createLeadEligibilityRecord({
    state: "ELIGIBLE",
    evidence: { owner_consent: "written approval on file" },
    updatedBy: "operator:console",
  });
}

async function waitForFenceWaiter(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const rows = await db.$queryRaw<Array<{ waiting: number }>>`
      SELECT COUNT(*)::int AS waiting
      FROM pg_locks
      WHERE locktype = 'advisory'
        AND classid = ${fenceLockClassId}
        AND objid = ${fenceLockObjectId}
        AND NOT granted
    `;
    if ((rows[0]?.waiting ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Ingest update did not reach the advisory-lock barrier");
}

function discoveryRecord(placeId: string, websiteUrl: string) {
  return createLeadDiscoveryRecord({
    vertical: "RESTAURANT",
    city: "Valletta",
    placeId,
    sourceProvider: "google_places",
    queries: [
      { provider: "google_places", query: "restaurants in Valletta" },
    ],
    score: 42,
    reasons: ["Missing mobile viewport meta"],
    websiteUrl,
    rating: 4.2,
    reviewCount: 12,
    hasWebsite: true,
    categories: ["restaurant"],
  });
}
