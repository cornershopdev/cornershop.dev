import { randomUUID } from "node:crypto";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { Vertical } from "@/generated/prisma/enums";
import {
  restaurantSiteDraftSchema,
  sampleSiteDraft,
} from "@/lib/restaurant";
import { updateSiteDraft } from "@/lib/site-persistence";
import { findSiteDraft } from "@/lib/sites";
import { sampleFoodRetailDraft } from "@/lib/verticals/food-retail/fixtures";
import { foodRetailSiteDraftSchema } from "@/lib/verticals/food-retail/schema";
import { sampleLocalServiceSiteDraft } from "@/lib/verticals/local-service/fixtures";
import { localServiceSiteDraftSchema } from "@/lib/verticals/local-service/schema";

mock.module("server-only", () => ({}));

const enabled = process.env.SOURCE_MONITORING_POSTGRES_TEST === "1";
const siteId = `monitor-site-${randomUUID()}`;
const foodSiteId = `monitor-food-${randomUUID()}`;
const localSiteId = `monitor-local-${randomUUID()}`;
const organizationId = `monitor-org-${randomUUID()}`;
const userId = `monitor-user-${randomUUID()}`;
const slug = `monitor-${randomUUID()}`;
const foodSlug = `monitor-food-${randomUUID()}`;
const localSlug = `monitor-local-${randomUUID()}`;
const previousPrice = process.env.STRIPE_PRICE_ID;

let db: ReturnType<typeof import("@/lib/db").getDb>;
let dispatchDueSourceMonitoring: typeof import("@/lib/source-monitoring").dispatchDueSourceMonitoring;
let reviewSourceMonitoringSuggestion: typeof import("@/lib/source-monitoring").reviewSourceMonitoringSuggestion;
let SourceMonitoringConflictError: typeof import("@/lib/source-monitoring").SourceMonitoringConflictError;
let SourceMonitoringUnsupportedSuggestionError: typeof import("@/lib/source-monitoring").SourceMonitoringUnsupportedSuggestionError;

describe.skipIf(!enabled)("source monitoring PostgreSQL persistence", () => {
  beforeAll(async () => {
    process.env.STRIPE_PRICE_ID = "price_monitor_founding";
    const database = await import("@/lib/db");
    const monitoring = await import("@/lib/source-monitoring");
    db = database.getDb();
    dispatchDueSourceMonitoring = monitoring.dispatchDueSourceMonitoring;
    reviewSourceMonitoringSuggestion =
      monitoring.reviewSourceMonitoringSuggestion;
    SourceMonitoringConflictError = monitoring.SourceMonitoringConflictError;
    SourceMonitoringUnsupportedSuggestionError =
      monitoring.SourceMonitoringUnsupportedSuggestionError;

    await db.user.create({
      data: {
        id: userId,
        email: `${userId}@example.test`,
        name: "Source monitoring owner",
        memberships: {
          create: {
            organization: {
              create: {
                id: organizationId,
                name: "Monitoring integration",
              },
            },
          },
        },
      },
    });
    await db.site.create({
      data: {
        id: siteId,
        slug,
        name: "Monitoring Cafe",
        eyebrow: "Cafe",
        description: "A sufficiently long monitoring integration fixture.",
        address: "Old address",
        phone: "1111",
        sourceUrl: "https://example.com/",
        draftPalette: {
          background: "#ffffff",
          foreground: "#111111",
          accent: "#aa0000",
        },
        attributes: { cuisine: "Cafe", showMenuImages: false },
        status: "CLAIMED",
        organizationId,
        catalogSections: {
          create: {
            name: "Menu",
            description: "",
            position: 0,
          },
        },
        subscription: {
          create: {
            stripeCustomerId: `cus_${randomUUID()}`,
            stripeSubscriptionId: `sub_${randomUUID()}`,
            stripePriceId: "price_monitor_founding",
            status: "ACTIVE",
            organizationId,
          },
        },
      },
    });
    await createOwnedSite({
      id: foodSiteId,
      slug: foodSlug,
      vertical: Vertical.FOOD_RETAIL,
      name: "Monitoring Bakery",
    });
    await createOwnedSite({
      id: localSiteId,
      slug: localSlug,
      vertical: Vertical.LOCAL_SERVICE,
      name: "Monitoring Electrical",
    });
    await updateSiteDraft(
      foodSlug,
      { ...sampleFoodRetailDraft, slug: foodSlug },
      Vertical.FOOD_RETAIL,
    );
    await updateSiteDraft(
      localSlug,
      { ...sampleLocalServiceSiteDraft, slug: localSlug },
      Vertical.LOCAL_SERVICE,
    );
  });

  afterAll(async () => {
    await db.site.deleteMany({
      where: { id: { in: [siteId, foodSiteId, localSiteId] } },
    });
    await db.organization.deleteMany({ where: { id: organizationId } });
    await db.user.deleteMany({ where: { id: userId } });
    restoreEnvironment(
      "STRIPE_PRICE_ID",
      previousPrice,
    );
  });

  test("claims one durable run for one schedule slot", async () => {
    const now = new Date("2026-07-27T10:00:00.000Z");
    const first = await dispatchDueSourceMonitoring(
      now,
      async (runId) => `workflow-${runId}`,
    );
    const replay = await dispatchDueSourceMonitoring(
      now,
      async (runId) => `workflow-replay-${runId}`,
    );
    expect(first).toEqual({ claimed: 1, started: 1, failedToStart: 0 });
    expect(replay).toEqual({ claimed: 0, started: 0, failedToStart: 0 });
    expect(
      await db.sourceMonitorRun.count({ where: { siteId } }),
    ).toBe(1);
  });

  test("applies an accepted suggestion to the draft but never publishes", async () => {
    const run = await db.sourceMonitorRun.create({
      data: {
        siteId,
        idempotencyKey: `${siteId}:manual-accept`,
        scheduledFor: new Date(),
        status: "SUCCEEDED",
        completedAt: new Date(),
        suggestionCount: 1,
      },
    });
    const suggestion = await db.sourceMonitorSuggestion.create({
      data: {
        siteId,
        runId: run.id,
        fingerprint: randomUUID(),
        field: "CONTACT",
        path: "contact",
        currentValue: { address: "Old address", phone: "1111" },
        suggestedValue: { address: "New address", phone: "2222" },
        evidence: [],
      },
    });
    const beforeRevision = (
      await db.site.findUniqueOrThrow({
        where: { id: siteId },
        select: { draftRevision: true },
      })
    ).draftRevision;
    const reviewed = await reviewSourceMonitoringSuggestion({
      siteId,
      suggestionId: suggestion.id,
      actor: {
        id: userId,
        email: `${userId}@example.test`,
        role: "owner",
      },
      action: "accept",
      expectedRevision: beforeRevision,
    });
    expect(reviewed).toMatchObject({
      status: "ACCEPTED",
      revision: beforeRevision + 1,
      vertical: "RESTAURANT",
      draft: {
        address: "New address",
        phone: "2222",
      },
    });
    expect(
      await db.site.findUniqueOrThrow({
        where: { id: siteId },
        select: {
          address: true,
          phone: true,
          publishedSiteVersionId: true,
          _count: { select: { siteVersions: true } },
          draftRevision: true,
        },
      }),
    ).toEqual({
      address: "New address",
      phone: "2222",
      publishedSiteVersionId: null,
      _count: { siteVersions: 0 },
      draftRevision: beforeRevision + 1,
    });
  });

  test("rejects stale suggestions instead of overwriting a later owner edit", async () => {
    const run = await db.sourceMonitorRun.create({
      data: {
        siteId,
        idempotencyKey: `${siteId}:manual-stale`,
        scheduledFor: new Date(),
        status: "SUCCEEDED",
        completedAt: new Date(),
        suggestionCount: 1,
      },
    });
    const suggestion = await db.sourceMonitorSuggestion.create({
      data: {
        siteId,
        runId: run.id,
        fingerprint: randomUUID(),
        field: "CONTACT",
        path: "contact",
        currentValue: { address: "Old address", phone: "1111" },
        suggestedValue: { address: "Bad overwrite", phone: "3333" },
        evidence: [],
      },
    });
    await expect(
      reviewSourceMonitoringSuggestion({
        siteId,
        suggestionId: suggestion.id,
        actor: {
          id: userId,
          email: `${userId}@example.test`,
          role: "owner",
        },
        action: "accept",
        expectedRevision: await currentRevision(),
      }),
    ).rejects.toBeInstanceOf(SourceMonitoringConflictError);
    expect(
      await db.sourceMonitorSuggestion.findUniqueOrThrow({
        where: { id: suggestion.id },
        select: { status: true },
      }),
    ).toEqual({ status: "PENDING" });
  });

  test("rejects an accepted suggestion loaded at an older draft revision", async () => {
    const run = await db.sourceMonitorRun.create({
      data: {
        siteId,
        idempotencyKey: `${siteId}:manual-stale-revision`,
        scheduledFor: new Date(),
        status: "SUCCEEDED",
        completedAt: new Date(),
        suggestionCount: 1,
      },
    });
    const suggestion = await db.sourceMonitorSuggestion.create({
      data: {
        siteId,
        runId: run.id,
        fingerprint: randomUUID(),
        field: "CONTACT",
        path: "contact",
        currentValue: { address: "New address", phone: "2222" },
        suggestedValue: { address: "Stale revision", phone: "4444" },
        evidence: [],
      },
    });
    const revision = await currentRevision();

    await expect(
      reviewSourceMonitoringSuggestion({
        siteId,
        suggestionId: suggestion.id,
        actor: {
          id: userId,
          email: `${userId}@example.test`,
          role: "owner",
        },
        action: "accept",
        expectedRevision: revision - 1,
      }),
    ).rejects.toMatchObject({
      name: "DraftRevisionConflictError",
      currentRevision: revision,
    });
    expect(
      await db.sourceMonitorSuggestion.findUniqueOrThrow({
        where: { id: suggestion.id },
        select: { status: true },
      }),
    ).toEqual({ status: "PENDING" });
  });

  test("accepts restaurant, food-retail, and local-service catalog suggestions without publishing", async () => {
    await updateSiteDraft(
      slug,
      { ...sampleSiteDraft, slug },
      Vertical.RESTAURANT,
    );
    const restaurantBefore = restaurantSiteDraftSchema.parse(
      (await findSiteDraft(slug))?.draft,
    );
    const restaurantRevision = (await findSiteDraft(slug))?.revision;
    if (restaurantRevision === undefined) throw new Error("Restaurant draft missing");
    const restaurantMenu = {
      catalogSections: restaurantBefore.catalogSections.map(
        (section, sectionIndex) => ({
          ...section,
          items: section.items.map((item, itemIndex) =>
            sectionIndex === 0 && itemIndex === 0
              ? { ...item, description: "Reviewed focaccia description" }
              : item,
          ),
        }),
      ),
      translations: restaurantBefore.translations,
    };
    const restaurantAccepted = await acceptSuggestion({
      siteId,
      field: "MENU",
      path: "catalogSections",
      currentValue: {
        catalogSections: restaurantBefore.catalogSections,
        translations: restaurantBefore.translations,
      },
      suggestedValue: restaurantMenu,
      expectedRevision: restaurantRevision,
    });
    expect(restaurantAccepted).toMatchObject({
      status: "ACCEPTED",
      vertical: "RESTAURANT",
    });
    const restaurantAfter = restaurantSiteDraftSchema.parse(
      (await findSiteDraft(slug))?.draft,
    );
    expect(restaurantAfter.catalogSections[0].items[0]).toMatchObject({
      description: "Reviewed focaccia description",
      available: restaurantBefore.catalogSections[0].items[0].available,
      attributes: restaurantBefore.catalogSections[0].items[0].attributes,
    });
    expect(await unpublished(siteId)).toBe(true);

    const foodLoaded = await findSiteDraft(foodSlug);
    const foodBefore = foodRetailSiteDraftSchema.parse(foodLoaded?.draft);
    if (foodLoaded?.revision === undefined) {
      throw new Error("Food-retail draft missing");
    }
    const foodMenu = {
      catalogSections: foodBefore.catalogSections.map(
        (section, sectionIndex) => ({
          ...section,
          items: section.items.map((item, itemIndex) =>
            sectionIndex === 0 && itemIndex === 0
              ? {
                  ...item,
                  description: "Natural starter with a longer ferment.",
                }
              : item,
          ),
        }),
      ),
      translations: foodBefore.translations,
    };
    await acceptSuggestion({
      siteId: foodSiteId,
      field: "MENU",
      path: "catalogSections",
      currentValue: {
        catalogSections: foodBefore.catalogSections,
        translations: foodBefore.translations,
      },
      suggestedValue: foodMenu,
      expectedRevision: foodLoaded.revision,
    });
    const foodAfter = foodRetailSiteDraftSchema.parse(
      (await findSiteDraft(foodSlug))?.draft,
    );
    expect(foodAfter.catalogSections[0].items[0]).toMatchObject({
      description: "Natural starter with a longer ferment.",
      available: true,
      attributes: {
        visible: true,
        stockSourceUrl: "https://example.com/maison-levain/daily-breads",
        allergens: ["gluten"],
      },
    });
    expect(foodAfter.catalogSections[1].items[0]).toMatchObject({
      available: null,
      attributes: { visible: true, stockSourceUrl: null },
    });
    expect(await unpublished(foodSiteId)).toBe(true);

    const localLoaded = await findSiteDraft(localSlug);
    const localBefore = localServiceSiteDraftSchema.parse(localLoaded?.draft);
    if (localLoaded?.revision === undefined) {
      throw new Error("Local-service draft missing");
    }
    const localMenu = {
      catalogSections: localBefore.catalogSections.map((section) => ({
        ...section,
        items: section.items.map((item, itemIndex) =>
          itemIndex === 0
            ? {
                ...item,
                description: "Diagnosis and repair, reviewed from source.",
              }
            : item,
        ),
      })),
      translations: localBefore.translations,
    };
    await acceptSuggestion({
      siteId: localSiteId,
      field: "MENU",
      path: "catalogSections",
      currentValue: {
        catalogSections: localBefore.catalogSections,
        translations: localBefore.translations,
      },
      suggestedValue: localMenu,
      expectedRevision: localLoaded.revision,
    });
    const localAfter = localServiceSiteDraftSchema.parse(
      (await findSiteDraft(localSlug))?.draft,
    );
    expect(localAfter.catalogSections[0].items[0]).toMatchObject({
      description: "Diagnosis and repair, reviewed from source.",
      available: true,
      attributes: {
        pricingModel: "quote",
        emergencyEligible: true,
      },
    });
    expect(localAfter.attributes).toMatchObject({
      credentials: localBefore.attributes.credentials,
      projects: localBefore.attributes.projects,
    });
    expect(await unpublished(localSiteId)).toBe(true);
  });

  test("persists newly discovered links as disabled reviewable visibility decisions", async () => {
    const foodLoaded = await findSiteDraft(foodSlug);
    const foodBefore = foodRetailSiteDraftSchema.parse(foodLoaded?.draft);
    if (foodLoaded?.revision === undefined) {
      throw new Error("Food-retail draft missing");
    }
    const discovered = {
      type: "delivery" as const,
      label: "Delivery",
      provider: "Existing delivery",
      url: "https://maison-levain.example/delivery",
      enabled: false,
      venueId: null,
    };
    const suggested = {
      integrations: [...foodBefore.integrations, discovered],
      translations: foodBefore.translations.map((translation) => ({
        ...translation,
        integrationLabels: [...translation.integrationLabels, discovered.label],
      })),
    };
    await acceptSuggestion({
      siteId: foodSiteId,
      field: "LINKS",
      path: "integrations",
      currentValue: {
        integrations: foodBefore.integrations,
        translations: foodBefore.translations,
      },
      suggestedValue: suggested,
      expectedRevision: foodLoaded.revision,
    });
    const foodAfter = foodRetailSiteDraftSchema.parse(
      (await findSiteDraft(foodSlug))?.draft,
    );
    expect(foodAfter.integrations).toEqual(suggested.integrations);
    expect(
      await db.integration.findMany({
        where: { siteId: foodSiteId },
        orderBy: { position: "asc" },
        select: { url: true, enabled: true, provider: true },
      }),
    ).toEqual([
      {
        url: "https://maison-levain.example/order",
        enabled: true,
        provider: "Existing ordering",
      },
      {
        url: "https://maison-levain.example/delivery",
        enabled: false,
        provider: "Existing delivery",
      },
    ]);
    expect(await unpublished(foodSiteId)).toBe(true);
  });

  test("rejects a local-service suggestion without changing the private draft", async () => {
    const localLoaded = await findSiteDraft(localSlug);
    const localBefore = localServiceSiteDraftSchema.parse(localLoaded?.draft);
    if (localLoaded?.revision === undefined) {
      throw new Error("Local-service draft missing");
    }
    const run = await db.sourceMonitorRun.create({
      data: {
        siteId: localSiteId,
        idempotencyKey: `${localSiteId}:reject`,
        scheduledFor: new Date(),
        status: "SUCCEEDED",
        completedAt: new Date(),
        suggestionCount: 1,
      },
    });
    const suggestion = await db.sourceMonitorSuggestion.create({
      data: {
        siteId: localSiteId,
        runId: run.id,
        fingerprint: randomUUID(),
        field: "CONTACT",
        path: "contact",
        currentValue: {
          address: localBefore.address,
          phone: localBefore.phone,
        },
        suggestedValue: {
          address: "Rejected address",
          phone: localBefore.phone,
        },
        evidence: [],
      },
    });
    await expect(
      reviewSourceMonitoringSuggestion({
        siteId: localSiteId,
        suggestionId: suggestion.id,
        actor: ownerActor(),
        action: "reject",
      }),
    ).resolves.toEqual({ status: "REJECTED" });
    expect(
      localServiceSiteDraftSchema.parse((await findSiteDraft(localSlug))?.draft)
        .address,
    ).toBe(localBefore.address);
    expect((await findSiteDraft(localSlug))?.revision).toBe(
      localLoaded.revision,
    );
    expect(await unpublished(localSiteId)).toBe(true);
  });

  test("rejects unsupported suggestion shapes without mutating the draft", async () => {
    const localLoaded = await findSiteDraft(localSlug);
    const localBefore = localServiceSiteDraftSchema.parse(localLoaded?.draft);
    if (localLoaded?.revision === undefined) {
      throw new Error("Local-service draft missing");
    }
    const run = await db.sourceMonitorRun.create({
      data: {
        siteId: localSiteId,
        idempotencyKey: `${localSiteId}:unsupported-shape`,
        scheduledFor: new Date(),
        status: "SUCCEEDED",
        completedAt: new Date(),
        suggestionCount: 1,
      },
    });
    const suggestion = await db.sourceMonitorSuggestion.create({
      data: {
        siteId: localSiteId,
        runId: run.id,
        fingerprint: randomUUID(),
        field: "LINKS",
        path: "integrations",
        currentValue: {
          integrations: localBefore.integrations,
          translations: localBefore.translations,
        },
        suggestedValue: {
          integrations: [
            {
              type: "quote",
              label: "Broken",
              provider: "Harbour quotes",
              url: "https://harbour-electrical.example/broken",
              venueId: null,
            },
          ],
          translations: localBefore.translations,
        },
        evidence: [],
      },
    });
    await expect(
      reviewSourceMonitoringSuggestion({
        siteId: localSiteId,
        suggestionId: suggestion.id,
        actor: ownerActor(),
        action: "accept",
        expectedRevision: localLoaded.revision,
      }),
    ).rejects.toBeInstanceOf(SourceMonitoringUnsupportedSuggestionError);
    expect(
      await db.sourceMonitorSuggestion.findUniqueOrThrow({
        where: { id: suggestion.id },
        select: { status: true },
      }),
    ).toEqual({ status: "PENDING" });
    expect((await findSiteDraft(localSlug))?.revision).toBe(
      localLoaded.revision,
    );
    expect(await unpublished(localSiteId)).toBe(true);
  });

  test("rejects a stale food-retail revision without applying the suggestion", async () => {
    const foodLoaded = await findSiteDraft(foodSlug);
    const foodBefore = foodRetailSiteDraftSchema.parse(foodLoaded?.draft);
    if (foodLoaded?.revision === undefined) {
      throw new Error("Food-retail draft missing");
    }
    const run = await db.sourceMonitorRun.create({
      data: {
        siteId: foodSiteId,
        idempotencyKey: `${foodSiteId}:stale-revision`,
        scheduledFor: new Date(),
        status: "SUCCEEDED",
        completedAt: new Date(),
        suggestionCount: 1,
      },
    });
    const suggestion = await db.sourceMonitorSuggestion.create({
      data: {
        siteId: foodSiteId,
        runId: run.id,
        fingerprint: randomUUID(),
        field: "CONTACT",
        path: "contact",
        currentValue: {
          address: foodBefore.address,
          phone: foodBefore.phone,
        },
        suggestedValue: {
          address: "Stale bakery address",
          phone: foodBefore.phone,
        },
        evidence: [],
      },
    });
    await expect(
      reviewSourceMonitoringSuggestion({
        siteId: foodSiteId,
        suggestionId: suggestion.id,
        actor: ownerActor(),
        action: "accept",
        expectedRevision: foodLoaded.revision - 1,
      }),
    ).rejects.toMatchObject({
      name: "DraftRevisionConflictError",
      currentRevision: foodLoaded.revision,
    });
    expect(
      foodRetailSiteDraftSchema.parse((await findSiteDraft(foodSlug))?.draft)
        .address,
    ).toBe(foodBefore.address);
    expect(
      await db.sourceMonitorSuggestion.findUniqueOrThrow({
        where: { id: suggestion.id },
        select: { status: true },
      }),
    ).toEqual({ status: "PENDING" });
  });
});

async function currentRevision(id = siteId): Promise<number> {
  return (
    await db.site.findUniqueOrThrow({
      where: { id },
      select: { draftRevision: true },
    })
  ).draftRevision;
}

function ownerActor() {
  return {
    id: userId,
    email: `${userId}@example.test`,
    role: "owner" as const,
  };
}

async function unpublished(id: string) {
  const site = await db.site.findUniqueOrThrow({
    where: { id },
    select: {
      publishedSiteVersionId: true,
      _count: { select: { siteVersions: true } },
    },
  });
  return site.publishedSiteVersionId === null && site._count.siteVersions === 0;
}

async function acceptSuggestion(input: {
  siteId: string;
  field: "MENU" | "CONTACT" | "HOURS" | "LINKS";
  path: string;
  currentValue: unknown;
  suggestedValue: unknown;
  expectedRevision: number;
}) {
  const run = await db.sourceMonitorRun.create({
    data: {
      siteId: input.siteId,
      idempotencyKey: `${input.siteId}:${randomUUID()}`,
      scheduledFor: new Date(),
      status: "SUCCEEDED",
      completedAt: new Date(),
      suggestionCount: 1,
    },
  });
  const suggestion = await db.sourceMonitorSuggestion.create({
    data: {
      siteId: input.siteId,
      runId: run.id,
      fingerprint: randomUUID(),
      field: input.field,
      path: input.path,
      currentValue: input.currentValue as never,
      suggestedValue: input.suggestedValue as never,
      evidence: [],
    },
  });
  return reviewSourceMonitoringSuggestion({
    siteId: input.siteId,
    suggestionId: suggestion.id,
    actor: ownerActor(),
    action: "accept",
    expectedRevision: input.expectedRevision,
  });
}

async function createOwnedSite(input: {
  id: string;
  slug: string;
  vertical: Vertical;
  name: string;
}) {
  await db.site.create({
    data: {
      id: input.id,
      slug: input.slug,
      name: input.name,
      eyebrow: "Workspace",
      description: "A sufficiently long monitoring integration fixture.",
      address: "Old address",
      phone: "1111",
      sourceUrl: "https://source.test/",
      draftPalette: {
        background: "#ffffff",
        foreground: "#111111",
        accent: "#aa0000",
      },
      attributes: {},
      status: "CLAIMED",
      vertical: input.vertical,
      organizationId,
      catalogSections: {
        create: {
          name: "Catalog",
          description: "",
          position: 0,
        },
      },
    },
  });
}

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
