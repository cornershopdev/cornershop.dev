import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import type { Prisma } from "@/generated/prisma/client";

mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({
  revalidateTag: () => undefined,
  revalidatePath: () => undefined,
  updateTag: () => undefined,
  refresh: () => undefined,
  unstable_cache: <T extends (...args: never[]) => unknown>(callback: T): T =>
    callback,
  unstable_noStore: () => undefined,
  cacheLife: () => undefined,
  cacheTag: () => undefined,
  unstable_cacheLife: () => undefined,
  unstable_cacheTag: () => undefined,
}));

const enabled = process.env.SITE_PUBLICATION_POSTGRES_TEST === "1";
const siteId = `site-publication-${randomUUID()}`;
const organizationId = `site-publication-org-${randomUUID()}`;
const userId = `site-publication-user-${randomUUID()}`;
const slug = `site-publication-${randomUUID()}`;
const foodSiteId = `food-retail-publication-${randomUUID()}`;
const foodSlug = `food-retail-publication-${randomUUID()}`;
const localServiceSiteId = `local-service-publication-${randomUUID()}`;
const localServiceSlug = `local-service-publication-${randomUUID()}`;
const actor = { id: userId, email: `${userId}@example.test` };

let db: ReturnType<typeof import("@/lib/db").getDb>;
let sampleSiteDraft: typeof import("@/lib/restaurant").sampleSiteDraft;
let sampleFoodRetailDraft: typeof import("@/lib/verticals/food-retail/fixtures").sampleFoodRetailDraft;
let sampleLocalServiceDraft: typeof import("@/lib/verticals/local-service/fixtures").sampleLocalServiceSiteDraft;
let publishSiteDraft: typeof import("@/lib/site-publication").publishSiteDraft;
let rollbackPublishedSiteVersion: typeof import("@/lib/site-publication").rollbackPublishedSiteVersion;
let getSitePublicationHistory: typeof import("@/lib/site-publication").getSitePublicationHistory;
let DraftRevisionConflictError: typeof import("@/lib/site-persistence").DraftRevisionConflictError;
let updateSiteDraft: typeof import("@/lib/site-persistence").updateSiteDraft;
let findOwnerSiteDraft: typeof import("@/lib/sites").findOwnerSiteDraft;
let findPublishedSiteView: typeof import("@/lib/sites").findPublishedSiteView;
let findSiteView: typeof import("@/lib/sites").findSiteView;
let localizeSiteDraft: typeof import("@/lib/site-draft").localizeSiteDraft;
let restaurantThemeFixtures: typeof import("@/lib/site-themes/restaurant/fixtures").restaurantThemeFixtures;
let selectOwnerRestaurantTheme: typeof import("@/lib/site-themes/restaurant/selection").selectOwnerRestaurantTheme;
let Vertical: typeof import("@/generated/prisma/enums").Vertical;

async function currentDraftRevision(): Promise<number> {
  return (
    await db.site.findUniqueOrThrow({
      where: { id: siteId },
      select: { draftRevision: true },
    })
  ).draftRevision;
}

describe.skipIf(!enabled)(
  "safe draft and publish PostgreSQL integration",
  () => {
    beforeAll(async () => {
      const database = await import("@/lib/db");
      const restaurant = await import("@/lib/restaurant");
      const foodRetail = await import("@/lib/verticals/food-retail/fixtures");
      const localService =
        await import("@/lib/verticals/local-service/fixtures");
      const publication = await import("@/lib/site-publication");
      const persistence = await import("@/lib/site-persistence");
      const sites = await import("@/lib/sites");
      const siteDraft = await import("@/lib/site-draft");
      const themeFixtures =
        await import("@/lib/site-themes/restaurant/fixtures");
      const themeSelection =
        await import("@/lib/site-themes/restaurant/selection");
      const enums = await import("@/generated/prisma/enums");

      db = database.getDb();
      sampleSiteDraft = restaurant.sampleSiteDraft;
      sampleFoodRetailDraft = foodRetail.sampleFoodRetailDraft;
      sampleLocalServiceDraft = localService.sampleLocalServiceSiteDraft;
      publishSiteDraft = publication.publishSiteDraft;
      rollbackPublishedSiteVersion = publication.rollbackPublishedSiteVersion;
      getSitePublicationHistory = publication.getSitePublicationHistory;
      updateSiteDraft = persistence.updateSiteDraft;
      DraftRevisionConflictError = persistence.DraftRevisionConflictError;
      findOwnerSiteDraft = sites.findOwnerSiteDraft;
      findPublishedSiteView = sites.findPublishedSiteView;
      findSiteView = sites.findSiteView;
      localizeSiteDraft = siteDraft.localizeSiteDraft;
      restaurantThemeFixtures = themeFixtures.restaurantThemeFixtures;
      selectOwnerRestaurantTheme = themeSelection.selectOwnerRestaurantTheme;
      Vertical = enums.Vertical;

      await db.user.create({
        data: {
          id: userId,
          email: actor.email,
          name: "Publication owner",
          memberships: {
            create: {
              organization: {
                create: {
                  id: organizationId,
                  name: "Publication integration",
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
          name: sampleSiteDraft.name,
          eyebrow: sampleSiteDraft.eyebrow,
          description: sampleSiteDraft.description,
          address: sampleSiteDraft.address,
          phone: sampleSiteDraft.phone,
          sourceUrl: sampleSiteDraft.sourceUrl,
          heroImageUrl: sampleSiteDraft.heroImageUrl,
          heroOriginalImageUrl: sampleSiteDraft.heroOriginalImageUrl,
          heroImageProvenance: "OWNER",
          draftTheme: { id: "warm" },
          draftThemeVersion: "legacy-v1",
          draftPalette: sampleSiteDraft.palette,
          attributes: sampleSiteDraft.attributes,
          autoEnhanceImages: sampleSiteDraft.autoEnhanceImages,
          defaultLocale: sampleSiteDraft.defaultLocale,
          translations: sampleSiteDraft.translations,
          vertical: "RESTAURANT",
          status: "CLAIMED",
          organizationId,
          integrations: {
            create: sampleSiteDraft.integrations.map(
              (integration, position) => ({
                type: integration.type.toUpperCase() as
                  "BOOKING" | "ORDERING" | "DELIVERY" | "SOCIAL",
                label: integration.label,
                provider: integration.provider,
                url: integration.url,
                venueId: integration.venueId,
                position,
              }),
            ),
          },
          catalogSections: {
            create: sampleSiteDraft.catalogSections.map(
              (section, sectionPosition) => ({
                name: section.name,
                description: section.description,
                position: sectionPosition,
                items: {
                  create: section.items.map((item, itemPosition) => ({
                    name: item.name,
                    description: item.description,
                    price: item.price,
                    currency: item.currency,
                    imageUrl: item.imageUrl,
                    originalImageUrl: item.originalImageUrl,
                    imageProvenance: item.imageProvenance?.toUpperCase() as
                      "OFFICIAL" | "OWNER" | undefined,
                    attributes: item.attributes,
                    position: itemPosition,
                  })),
                },
              }),
            ),
          },
        },
      });
      if (!sampleSiteDraft.heroImageUrl) {
        throw new Error("Publication fixture requires its reviewed hero");
      }
      await db.photoAsset.create({
        data: {
          siteId,
          sourceUrl: sampleSiteDraft.heroImageUrl,
          provenance: "OWNER",
          sourceKind: "OWNER_REFERENCE",
          contentSha256: "e".repeat(64),
          originalStorageKey: `test/${"e".repeat(64)}.jpg`,
          originalUrl: sampleSiteDraft.heroImageUrl,
          mediaType: "image/jpeg",
          byteLength: 1_024,
          candidateUsages: ["HERO"],
          reviewStatus: "APPROVED",
          selectedUsage: "HERO",
          reviewedAt: new Date(),
          reviewedBy: actor.id,
        },
      });
      await db.domain.create({
        data: {
          hostname: `${randomUUID()}.example.test`,
          siteId,
          verificationToken: randomUUID(),
          verified: true,
          verifiedAt: new Date(),
        },
      });
      await db.site.create({
        data: {
          id: foodSiteId,
          slug: foodSlug,
          name: sampleFoodRetailDraft.name,
          vertical: Vertical.FOOD_RETAIL,
          attributes: sampleFoodRetailDraft.attributes,
          organizationId,
        },
      });
      await db.site.create({
        data: {
          id: localServiceSiteId,
          slug: localServiceSlug,
          name: sampleLocalServiceDraft.name,
          vertical: Vertical.LOCAL_SERVICE,
          attributes: sampleLocalServiceDraft.attributes,
          organizationId,
        },
      });
    });

    afterAll(async () => {
      if (!db) return;
      await db.site.deleteMany({
        where: {
          id: { in: [siteId, foodSiteId, localServiceSiteId] },
        },
      });
      await db.organization.deleteMany({ where: { id: organizationId } });
      await db.user.deleteMany({ where: { id: userId } });
    });

    test("does not let Publish bypass a paused lifecycle state", async () => {
      await db.site.update({
        where: { id: siteId },
        data: { status: "PAUSED" },
      });

      await expect(
        publishSiteDraft({
          siteId,
          slug,
          vertical: Vertical.RESTAURANT,
          actor,
          changeSummary: "Attempt to bypass pause",
          expectedRevision: await currentDraftRevision(),
        }),
      ).rejects.toThrow("Only claimed or live sites can be published");
      expect(
        await db.site.findUniqueOrThrow({
          where: { id: siteId },
          select: {
            publishedSiteVersionId: true,
            _count: { select: { siteVersions: true, auditEvents: true } },
          },
        }),
      ).toEqual({
        publishedSiteVersionId: null,
        _count: { siteVersions: 0, auditEvents: 0 },
      });

      await db.site.update({
        where: { id: siteId },
        data: { status: "CLAIMED" },
      });
    });

    test("publishes a validated immutable snapshot and promotes a verified custom-domain site to LIVE", async () => {
      expect(await db.domain.count({ where: { siteId, verified: true } })).toBe(
        1,
      );
      const published = await publishSiteDraft({
        siteId,
        slug,
        vertical: Vertical.RESTAURANT,
        actor,
        changeSummary: "Initial customer launch",
        expectedRevision: await currentDraftRevision(),
        now: new Date("2026-07-26T20:00:00.000Z"),
      });

      expect(published).toMatchObject({
        version: 1,
        theme: { id: "warm", version: "legacy-v1" },
      });
      const site = await db.site.findUnique({
        where: { id: siteId },
        select: {
          status: true,
          publishedSiteVersionId: true,
          publishedSiteVersion: {
            select: {
              content: true,
              translations: true,
              integrations: true,
              palette: true,
              publishedBy: true,
              changeSummary: true,
            },
          },
          auditEvents: {
            where: { type: "site.published" },
            select: { actor: true, metadata: true },
          },
        },
      });

      expect(site?.status).toBe("LIVE");
      expect(site?.publishedSiteVersionId).toBe(published.id);
      expect(site?.publishedSiteVersion).toMatchObject({
        publishedBy: actor.id,
        changeSummary: "Initial customer launch",
        palette: sampleSiteDraft.palette,
        translations: sampleSiteDraft.translations,
        integrations: sampleSiteDraft.integrations,
      });
      expect(site?.publishedSiteVersion?.content).toMatchObject({
        slug,
        name: sampleSiteDraft.name,
        palette: sampleSiteDraft.palette,
      });
      expect(site?.auditEvents).toEqual([
        {
          actor: actor.id,
          metadata: expect.objectContaining({
            siteVersionId: published.id,
            version: 1,
            changeSummary: "Initial customer launch",
            actorEmail: actor.email,
            draftRevision: 0,
            draftContentDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
            integrationUrlDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
            previousSiteVersionId: null,
          }),
        },
      ]);
    });

    test("keeps Save private until a later atomic publish", async () => {
      const firstPointer = (
        await db.site.findUniqueOrThrow({
          where: { id: siteId },
          select: { publishedSiteVersionId: true },
        })
      ).publishedSiteVersionId;
      const changedDraft = {
        ...sampleSiteDraft,
        slug,
        name: "Private draft name",
        description:
          "This description is visible in the owner preview but not on the public domain.",
        palette: {
          background: "#101010",
          foreground: "#f5f5f5",
          accent: "#dd5544",
        },
        attributes: {
          ...sampleSiteDraft.attributes,
          cuisine: "Japanese omakase",
        },
      };

      await updateSiteDraft(slug, changedDraft, Vertical.RESTAURANT);

      const afterSave = await db.site.findUniqueOrThrow({
        where: { id: siteId },
        select: {
          publishedSiteVersionId: true,
          siteVersions: { select: { id: true } },
        },
      });
      const [privateView, publicView] = await Promise.all([
        findSiteView(slug),
        findPublishedSiteView(slug),
      ]);
      expect(afterSave.publishedSiteVersionId).toBe(firstPointer);
      expect(afterSave.siteVersions).toHaveLength(1);
      expect(privateView?.draft.name).toBe("Private draft name");
      expect(privateView?.theme.id).toBe("nocturne");
      expect(publicView?.draft.name).toBe(sampleSiteDraft.name);
      expect(publicView?.draft.palette).toEqual(sampleSiteDraft.palette);
      expect(publicView?.theme).toMatchObject({
        id: "warm",
        version: "legacy-v1",
      });

      const second = await publishSiteDraft({
        siteId,
        slug,
        vertical: Vertical.RESTAURANT,
        actor,
        changeSummary: "Publish private copy and palette",
        expectedRevision: await currentDraftRevision(),
      });
      expect(second.version).toBe(2);
      expect(second.theme).toEqual({ id: "nocturne", version: "legacy-v1" });
      expect(second.id).not.toBe(firstPointer);
      expect((await findPublishedSiteView(slug))?.draft).toMatchObject({
        name: changedDraft.name,
        palette: changedDraft.palette,
      });
    });

    test("rejects a publish when another save advances the reviewed revision", async () => {
      const loadedRevision = await currentDraftRevision();
      const reviewedDraft = {
        ...sampleSiteDraft,
        slug,
        name: "Reviewed owner draft",
      };
      const reviewed = await updateSiteDraft(
        slug,
        reviewedDraft,
        Vertical.RESTAURANT,
        { actor, expectedRevision: loadedRevision },
      );
      const concurrentlySaved = {
        ...reviewedDraft,
        name: "Concurrent unreviewed owner draft",
      };
      const concurrent = await updateSiteDraft(
        slug,
        concurrentlySaved,
        Vertical.RESTAURANT,
        { actor, expectedRevision: reviewed.revision },
      );
      const beforePublish = await db.site.findUniqueOrThrow({
        where: { id: siteId },
        select: {
          publishedSiteVersionId: true,
          _count: { select: { siteVersions: true, auditEvents: true } },
        },
      });

      await expect(
        publishSiteDraft({
          siteId,
          slug,
          vertical: Vertical.RESTAURANT,
          actor,
          changeSummary: "Publish the reviewed owner draft",
          expectedRevision: reviewed.revision,
        }),
      ).rejects.toMatchObject({
        name: "DraftRevisionConflictError",
        currentRevision: concurrent.revision,
      });

      expect(
        await db.site.findUniqueOrThrow({
          where: { id: siteId },
          select: {
            publishedSiteVersionId: true,
            _count: { select: { siteVersions: true, auditEvents: true } },
          },
        }),
      ).toEqual(beforePublish);
      expect((await findSiteView(slug))?.draft.name).toBe(
        concurrentlySaved.name,
      );
    });

    test("persists menu order, availability, currency and approved imagery", async () => {
      const firstSection = sampleSiteDraft.catalogSections[0];
      const secondSection = sampleSiteDraft.catalogSections[1];
      const editedDraft = {
        ...sampleSiteDraft,
        slug,
        catalogSections: [
          {
            ...secondSection,
            items: [...secondSection.items].reverse(),
          },
          {
            ...firstSection,
            items: firstSection.items.map((item, index) =>
              index === 0
                ? {
                    ...item,
                    price: 8.5,
                    currency: "GBP" as const,
                    available: false,
                    imageUrl: "/approved/menu-item.webp",
                    originalImageUrl: "/approved/menu-item.webp",
                    imageProvenance: "owner" as const,
                  }
                : item,
            ),
          },
        ],
      };

      await updateSiteDraft(slug, editedDraft, Vertical.RESTAURANT);
      const reloaded = await findSiteView(slug);
      expect(
        reloaded?.draft.catalogSections.map((section) => section.name),
      ).toEqual([secondSection.name, firstSection.name]);
      expect(
        reloaded?.draft.catalogSections[0].items.map((item) => item.name),
      ).toEqual([...secondSection.items].reverse().map((item) => item.name));
      expect(reloaded?.draft.catalogSections[1].items[0]).toMatchObject({
        price: 8.5,
        currency: "GBP",
        available: false,
        imageUrl: "/approved/menu-item.webp",
      });
    });

    test("round-trips nullable, evidence-backed food-retail stock separately from visibility", async () => {
      const editedDraft = structuredClone(sampleFoodRetailDraft);
      editedDraft.slug = foodSlug;
      editedDraft.catalogSections[0].items[0].available = false;
      editedDraft.catalogSections[0].items[0].attributes.visible = true;
      editedDraft.catalogSections[0].items[0].attributes.stockSourceUrl =
        "https://example.com/maison-levain/daily-breads";
      editedDraft.catalogSections[1].items[0].available = null;
      editedDraft.catalogSections[1].items[0].attributes.visible = true;
      editedDraft.catalogSections[1].items[0].attributes.stockSourceUrl = null;

      await updateSiteDraft(foodSlug, editedDraft, Vertical.FOOD_RETAIL);
      const reloaded = await findSiteView(foodSlug);

      expect(reloaded?.draft.catalogSections[0].items[0]).toMatchObject({
        available: false,
        attributes: {
          visible: true,
          stockSourceUrl: "https://example.com/maison-levain/daily-breads",
        },
      });
      expect(reloaded?.draft.catalogSections[1].items[0]).toMatchObject({
        available: null,
        attributes: {
          visible: true,
          stockSourceUrl: null,
        },
      });
    });

    test("publishes reviewed food retail and can roll back to a valid historical snapshot", async () => {
      const canonicalDraft = structuredClone(sampleFoodRetailDraft);
      canonicalDraft.slug = foodSlug;
      canonicalDraft.heroImageUrl = null;
      canonicalDraft.heroOriginalImageUrl = null;
      canonicalDraft.heroImageProvenance = null;
      await updateSiteDraft(foodSlug, canonicalDraft, Vertical.FOOD_RETAIL);
      // Hero selection is owned by the photo library, not the general draft save.
      // Clear the previous test's unreviewed source projection through the same
      // persisted boundary before exercising publication without a selected hero.
      await db.site.update({
        where: { id: foodSiteId },
        data: {
          heroImageUrl: null,
          heroOriginalImageUrl: null,
          heroImageProvenance: null,
        },
      });
      const loaded = await findOwnerSiteDraft(foodSlug);
      if (!loaded) throw new Error("Expected the food editor draft");
      const reviewed = await updateSiteDraft(
        foodSlug,
        {
          ...(loaded.draft as typeof sampleFoodRetailDraft),
          description: "Reviewed food-retail editor save.",
        },
        Vertical.FOOD_RETAIL,
        { actor, expectedRevision: loaded.revision },
      );
      expect((await findOwnerSiteDraft(foodSlug))?.revision).toBe(
        reviewed.revision,
      );
      expect((await findSiteView(foodSlug))?.draft.description).toBe(
        "Reviewed food-retail editor save.",
      );

      const privateView = await findSiteView(foodSlug);
      if (!privateView) throw new Error("Expected private food-retail preview");
      const legacyContent = structuredClone(privateView.draft);
      legacyContent.description = "Valid historical food-retail snapshot.";
      // Each value was parsed by the registered draft/theme schemas immediately
      // above; the casts bridge those JSON-safe domain types to Prisma's write type.
      const legacyVersion = await db.siteVersion.create({
        data: {
          siteId: foodSiteId,
          version: 1,
          vertical: Vertical.FOOD_RETAIL,
          theme: privateView.theme.selection as Prisma.InputJsonValue,
          themeVersion: privateView.theme.version,
          palette: privateView.draft.palette as Prisma.InputJsonValue,
          content: legacyContent as Prisma.InputJsonValue,
          translations: privateView.draft.translations as Prisma.InputJsonValue,
          integrations: privateView.draft.integrations as Prisma.InputJsonValue,
          publishedAt: new Date(),
          publishedBy: actor.id,
          changeSummary: "Valid historical food-retail snapshot",
        },
      });
      await db.site.update({
        where: { id: foodSiteId },
        data: {
          status: "CLAIMED",
          publishedSiteVersionId: legacyVersion.id,
        },
      });
      const published = await publishSiteDraft({
        siteId: foodSiteId,
        slug: foodSlug,
        vertical: Vertical.FOOD_RETAIL,
        actor,
        changeSummary: "Publish reviewed food storefront",
        expectedRevision: reviewed.revision,
      });
      expect(published.version).toBe(2);
      expect((await findPublishedSiteView(foodSlug))?.draft.description).toBe(
        "Reviewed food-retail editor save.",
      );

      const rolledBack = await rollbackPublishedSiteVersion({
        siteId: foodSiteId,
        slug: foodSlug,
        vertical: Vertical.FOOD_RETAIL,
        targetSiteVersionId: legacyVersion.id,
        actor,
      });
      expect(rolledBack.version).toBe(3);
      expect((await findPublishedSiteView(foodSlug))?.draft.description).toBe(
        "Valid historical food-retail snapshot.",
      );
      expect((await findSiteView(foodSlug))?.draft.description).toBe(
        "Reviewed food-retail editor save.",
      );
    });

    test("publishes a deterministic local-service owner draft", async () => {
      const draft = structuredClone(sampleLocalServiceDraft);
      draft.slug = localServiceSlug;
      const saved = await updateSiteDraft(
        localServiceSlug,
        draft,
        Vertical.LOCAL_SERVICE,
        { actor, expectedRevision: 0 },
      );
      await db.site.update({
        where: { id: localServiceSiteId },
        data: { status: "CLAIMED" },
      });

      const published = await publishSiteDraft({
        siteId: localServiceSiteId,
        slug: localServiceSlug,
        vertical: Vertical.LOCAL_SERVICE,
        actor,
        changeSummary: "Publish reviewed electrician website",
        expectedRevision: saved.revision,
      });

      expect(published.version).toBe(1);
      expect(
        (await findPublishedSiteView(localServiceSlug))?.draft.description,
      ).toBe(sampleLocalServiceDraft.description);
    });

    test("versions and audits authorized integration saves without publishing", async () => {
      const before = await db.site.findUniqueOrThrow({
        where: { id: siteId },
        select: {
          draftRevision: true,
          publishedSiteVersionId: true,
          _count: { select: { siteVersions: true } },
        },
      });
      const first = sampleSiteDraft.integrations[0];
      const second = sampleSiteDraft.integrations[1];
      const editedDraft = {
        ...sampleSiteDraft,
        slug,
        integrations: [
          { ...second, enabled: false },
          {
            ...first,
            label: "Reserve securely",
            enabled: true,
          },
        ],
      };

      const saved = await updateSiteDraft(
        slug,
        editedDraft,
        Vertical.RESTAURANT,
        { actor },
      );
      const [reloaded, after, audit] = await Promise.all([
        findSiteView(slug),
        db.site.findUniqueOrThrow({
          where: { id: siteId },
          select: {
            draftRevision: true,
            publishedSiteVersionId: true,
            _count: { select: { siteVersions: true } },
          },
        }),
        db.auditEvent.findFirst({
          where: {
            siteId,
            type: "site.draft.saved",
            actor: actor.id,
          },
          orderBy: { createdAt: "desc" },
          select: { metadata: true },
        }),
      ]);

      expect(saved.revision).toBe(before.draftRevision + 1);
      expect(after).toEqual({
        draftRevision: saved.revision,
        publishedSiteVersionId: before.publishedSiteVersionId,
        _count: before._count,
      });
      expect(reloaded?.draft.integrations).toEqual([
        expect.objectContaining({
          label: second.label,
          enabled: false,
        }),
        expect.objectContaining({
          label: "Reserve securely",
          provider: first.provider,
          enabled: true,
        }),
      ]);
      expect(audit?.metadata).toMatchObject({
        revision: saved.revision,
        actorEmail: actor.email,
        integrationCount: 2,
        enabledIntegrationCount: 1,
        draftContentDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        integrationUrlDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        publishedSiteVersionIdAtSave: before.publishedSiteVersionId,
      });
    });

    test("rejects the second first-save from two owner tabs loaded at the same revision", async () => {
      const [firstTab, secondTab] = await Promise.all([
        findOwnerSiteDraft(slug),
        findOwnerSiteDraft(slug),
      ]);
      if (!firstTab || !secondTab) {
        throw new Error("Expected both owner tabs to load the persisted draft");
      }
      expect(secondTab.revision).toBe(firstTab.revision);
      expect(await findSiteView(slug)).not.toHaveProperty("draftRevision");

      const firstSave = await updateSiteDraft(
        slug,
        {
          ...(firstTab.draft as typeof sampleSiteDraft),
          description: "Saved from the first independently loaded owner tab.",
        },
        Vertical.RESTAURANT,
        { actor, expectedRevision: firstTab.revision },
      );

      await expect(
        updateSiteDraft(
          slug,
          {
            ...(secondTab.draft as typeof sampleSiteDraft),
            description: "This stale owner tab must not overwrite the first.",
          },
          Vertical.RESTAURANT,
          { actor, expectedRevision: secondTab.revision },
        ),
      ).rejects.toMatchObject({
        name: "DraftRevisionConflictError",
        currentRevision: firstSave.revision,
      });

      expect((await findOwnerSiteDraft(slug))?.draft).toMatchObject({
        description: "Saved from the first independently loaded owner tab.",
      });
    });

    test("refuses to publish stale translated copy without moving the live pointer", async () => {
      const current = await findSiteView(slug);
      if (!current) throw new Error("Expected the persisted restaurant draft");
      const staleDraft = {
        ...current.draft,
        autoEnhanceImages: sampleSiteDraft.autoEnhanceImages,
        translations: [
          {
            locale: "fr" as const,
            status: "stale" as const,
            attributes: {
              cuisine: current.draft.attributes.cuisine,
            },
            eyebrow: current.draft.eyebrow,
            description: current.draft.description,
            catalogSections: current.draft.catalogSections.map((section) => ({
              name: section.name,
              description: section.description,
              items: section.items.map((item) => ({
                name: item.name,
                description: item.description,
                attributes: {
                  dietaryLabels: item.attributes.dietaryLabels,
                },
              })),
            })),
            integrationLabels: current.draft.integrations.map(
              (integration) => integration.label,
            ),
          },
        ],
      };
      await updateSiteDraft(slug, staleDraft, Vertical.RESTAURANT);
      const before = await db.site.findUniqueOrThrow({
        where: { id: siteId },
        select: {
          publishedSiteVersionId: true,
          _count: { select: { siteVersions: true, auditEvents: true } },
        },
      });

      await expect(
        publishSiteDraft({
          siteId,
          slug,
          vertical: Vertical.RESTAURANT,
          actor,
          changeSummary: "Stale translation must not publish",
          expectedRevision: await currentDraftRevision(),
        }),
      ).rejects.toThrow("Review every stale translation before publishing");

      expect(
        await db.site.findUniqueOrThrow({
          where: { id: siteId },
          select: {
            publishedSiteVersionId: true,
            _count: { select: { siteVersions: true, auditEvents: true } },
          },
        }),
      ).toEqual(before);
      await updateSiteDraft(
        slug,
        { ...staleDraft, translations: [] },
        Vertical.RESTAURANT,
      );
    });

    test("leaves the live pointer untouched when persisted draft validation fails", async () => {
      const before = await db.site.findUniqueOrThrow({
        where: { id: siteId },
        select: {
          publishedSiteVersionId: true,
          _count: { select: { siteVersions: true, auditEvents: true } },
        },
      });
      await db.site.update({
        where: { id: siteId },
        data: {
          translations: [
            {
              locale: "fr",
              catalogSections: [],
              integrationLabels: [],
            },
          ],
        },
      });

      await expect(
        publishSiteDraft({
          siteId,
          slug,
          vertical: Vertical.RESTAURANT,
          actor,
          changeSummary: "This publish must fail",
          expectedRevision: await currentDraftRevision(),
        }),
      ).rejects.toThrow();

      const after = await db.site.findUniqueOrThrow({
        where: { id: siteId },
        select: {
          publishedSiteVersionId: true,
          _count: { select: { siteVersions: true, auditEvents: true } },
        },
      });
      expect(after).toEqual(before);
      await db.site.update({
        where: { id: siteId },
        data: { translations: [] },
      });
    });

    test("serializes concurrent publishes and never mutates published history", async () => {
      const results = await Promise.all([
        publishSiteDraft({
          siteId,
          slug,
          vertical: Vertical.RESTAURANT,
          actor,
          changeSummary: "Concurrent publish A",
          expectedRevision: await currentDraftRevision(),
        }),
        publishSiteDraft({
          siteId,
          slug,
          vertical: Vertical.RESTAURANT,
          actor,
          changeSummary: "Concurrent publish B",
          expectedRevision: await currentDraftRevision(),
        }),
      ]);
      const versions = await db.siteVersion.findMany({
        where: { siteId },
        orderBy: { version: "asc" },
        select: { id: true, version: true },
      });
      const pointer = await db.site.findUniqueOrThrow({
        where: { id: siteId },
        select: { publishedSiteVersionId: true },
      });

      expect(results.map((result) => result.version).sort()).toEqual([3, 4]);
      expect(versions.map((version) => version.version)).toEqual([1, 2, 3, 4]);
      expect(pointer.publishedSiteVersionId).toBe(versions.at(-1)?.id ?? null);

      await expect(
        Promise.resolve(
          db.siteVersion.update({
            where: { id: versions[0].id },
            data: { changeSummary: "Tampered history" },
          }),
        ),
      ).rejects.toThrow("Published site versions are immutable");
    });

    test("preserves an owner theme through save, reload, locale, publish and rollback", async () => {
      await db.domain.deleteMany({ where: { siteId } });
      const fixture = restaurantThemeFixtures["counter-service"];
      const ownerSelection = selectOwnerRestaurantTheme(
        fixture.profile,
        "after-dark",
      );
      const ownerDraft = {
        ...fixture,
        slug,
        attributes: {
          ...fixture.attributes,
          themeSelection: ownerSelection,
        },
        translations: [
          {
            locale: "fr",
            attributes: { cuisine: "Comptoir italien" },
            eyebrow: "Des parts, des pizzas entières, sans détour",
            description:
              "Un comptoir de quartier pour des pizzas au levain, des boissons fraîches et une collecte rapide.",
            catalogSections: fixture.catalogSections.map((section) => ({
              name: section.name,
              description: section.description,
              items: section.items.map((item) => ({
                name: item.name,
                description: item.description,
                attributes: item.attributes,
              })),
            })),
            integrationLabels: fixture.integrations.map(
              (integration) => integration.label,
            ),
          },
        ],
      };

      await updateSiteDraft(slug, ownerDraft, Vertical.RESTAURANT);
      await db.photoAsset.updateMany({
        where: { siteId, selectedUsage: "HERO" },
        data: {
          sourceUrl: fixture.heroImageUrl!,
          originalUrl: fixture.heroImageUrl!,
          originalStorageKey: "test/reviewed-counter-service-hero.webp",
        },
      });
      await db.site.update({
        where: { id: siteId },
        data: {
          heroOriginalImageUrl: fixture.heroImageUrl,
          heroImageProvenance: "OWNER",
        },
      });
      const reloaded = await findSiteView(slug);
      expect(reloaded?.theme).toEqual({
        id: "after-dark",
        version: "restaurant-renderer-v1",
        selection: ownerSelection,
      });
      expect(reloaded?.draft.attributes.themeSelection).toEqual(ownerSelection);
      expect(
        localizeSiteDraft(reloaded!.draft, "fr").attributes.themeSelection,
      ).toEqual(ownerSelection);

      const ownerPublished = await publishSiteDraft({
        siteId,
        slug,
        vertical: Vertical.RESTAURANT,
        actor,
        changeSummary: "Publish owner-selected after-dark theme",
        expectedRevision: await currentDraftRevision(),
      });
      expect(ownerPublished.theme).toEqual({
        id: "after-dark",
        version: "restaurant-renderer-v1",
      });
      const storedOwnerVersion = await db.siteVersion.findUniqueOrThrow({
        where: { id: ownerPublished.id },
        select: {
          theme: true,
          themeVersion: true,
          translations: true,
        },
      });
      expect(storedOwnerVersion).toMatchObject({
        theme: ownerSelection,
        themeVersion: "restaurant-renderer-v1",
        translations: ownerDraft.translations,
      });

      const nextSelection = selectOwnerRestaurantTheme(
        fixture.profile,
        "terroir-editorial",
      );
      await updateSiteDraft(
        slug,
        {
          ...ownerDraft,
          attributes: {
            ...ownerDraft.attributes,
            themeSelection: nextSelection,
          },
        },
        Vertical.RESTAURANT,
      );
      await publishSiteDraft({
        siteId,
        slug,
        vertical: Vertical.RESTAURANT,
        actor,
        changeSummary: "Publish a later owner theme",
        expectedRevision: await currentDraftRevision(),
      });

      const rolledBack = await rollbackPublishedSiteVersion({
        siteId,
        slug,
        vertical: Vertical.RESTAURANT,
        targetSiteVersionId: ownerPublished.id,
        actor,
      });
      expect(rolledBack.id).not.toBe(ownerPublished.id);
      expect(rolledBack.theme).toEqual(ownerPublished.theme);
      expect(
        (await findPublishedSiteView(slug))?.draft.attributes.themeSelection,
      ).toEqual(ownerSelection);
      expect(
        localizeSiteDraft((await findPublishedSiteView(slug))!.draft, "fr")
          .attributes.themeSelection,
      ).toEqual(ownerSelection);
      // Rollback moves only the public pointer; the owner's later private draft
      // remains available for another edit or publish.
      expect(
        (await findSiteView(slug))?.draft.attributes.themeSelection,
      ).toEqual(nextSelection);
      expect(
        await db.site.findUniqueOrThrow({
          where: { id: siteId },
          select: { status: true },
        }),
      ).toEqual({ status: "CLAIMED" });

      await db.domain.create({
        data: {
          hostname: `${randomUUID()}.example.test`,
          siteId,
          verificationToken: randomUUID(),
          verified: true,
          verifiedAt: new Date(),
        },
      });
      await rollbackPublishedSiteVersion({
        siteId,
        slug,
        vertical: Vertical.RESTAURANT,
        targetSiteVersionId: ownerPublished.id,
        actor,
      });
      expect(
        await db.site.findUniqueOrThrow({
          where: { id: siteId },
          select: { status: true },
        }),
      ).toEqual({ status: "LIVE" });
      expect(
        await db.auditEvent.count({
          where: {
            siteId,
            type: "site.rolled_back",
            actor: actor.id,
          },
        }),
      ).toBe(2);
    });

    test("keeps publication history and rollback site-membership scoped across verticals", async () => {
      const restaurantHistory = await getSitePublicationHistory(siteId);
      const foodHistory = await getSitePublicationHistory(foodSiteId);
      const localHistory = await getSitePublicationHistory(localServiceSiteId);

      expect(restaurantHistory.length).toBeGreaterThan(0);
      expect(restaurantHistory.every((item) => item.id)).toBe(true);
      expect(foodHistory.map((item) => item.id)).not.toEqual(
        expect.arrayContaining(restaurantHistory.map((item) => item.id)),
      );
      expect(localHistory.map((item) => item.id)).not.toEqual(
        expect.arrayContaining(restaurantHistory.map((item) => item.id)),
      );

      const foreignVersionId = restaurantHistory[0]?.id;
      if (!foreignVersionId) {
        throw new Error("Expected a restaurant publication to isolate against");
      }
      await expect(
        rollbackPublishedSiteVersion({
          siteId: foodSiteId,
          slug: foodSlug,
          vertical: Vertical.FOOD_RETAIL,
          targetSiteVersionId: foreignVersionId,
          actor,
        }),
      ).rejects.toThrow("Published site version not found");
      await expect(
        rollbackPublishedSiteVersion({
          siteId: localServiceSiteId,
          slug: localServiceSlug,
          vertical: Vertical.LOCAL_SERVICE,
          targetSiteVersionId: foreignVersionId,
          actor,
        }),
      ).rejects.toThrow("Published site version not found");
      await expect(
        publishSiteDraft({
          siteId: foodSiteId,
          slug,
          vertical: Vertical.FOOD_RETAIL,
          actor,
          changeSummary: "Cross-tenant slug must not publish",
          expectedRevision: 0,
        }),
      ).rejects.toThrow("Site not found");
    });

    test("rejects a stale food-retail owner save and publish revision", async () => {
      const loaded = await findOwnerSiteDraft(foodSlug);
      if (!loaded) throw new Error("Expected the food-retail owner draft");
      const firstSave = await updateSiteDraft(
        foodSlug,
        {
          ...(loaded.draft as typeof sampleFoodRetailDraft),
          description: "Food-retail first independent tab save.",
        },
        Vertical.FOOD_RETAIL,
        { actor, expectedRevision: loaded.revision },
      );
      await expect(
        updateSiteDraft(
          foodSlug,
          {
            ...(loaded.draft as typeof sampleFoodRetailDraft),
            description: "Stale food-retail tab must not overwrite.",
          },
          Vertical.FOOD_RETAIL,
          { actor, expectedRevision: loaded.revision },
        ),
      ).rejects.toMatchObject({
        name: "DraftRevisionConflictError",
        currentRevision: firstSave.revision,
      });
      expect(DraftRevisionConflictError).toBeDefined();

      await expect(
        publishSiteDraft({
          siteId: foodSiteId,
          slug: foodSlug,
          vertical: Vertical.FOOD_RETAIL,
          actor,
          changeSummary: "Stale food-retail publish",
          expectedRevision: loaded.revision,
        }),
      ).rejects.toMatchObject({
        name: "DraftRevisionConflictError",
        currentRevision: firstSave.revision,
      });
    });

    test("rejects a stale local-service owner save and publish revision", async () => {
      const loaded = await findOwnerSiteDraft(localServiceSlug);
      if (!loaded) throw new Error("Expected the local-service owner draft");
      const firstSave = await updateSiteDraft(
        localServiceSlug,
        {
          ...(loaded.draft as typeof sampleLocalServiceDraft),
          description: "Local-service first independent tab save.",
        },
        Vertical.LOCAL_SERVICE,
        { actor, expectedRevision: loaded.revision },
      );
      await expect(
        updateSiteDraft(
          localServiceSlug,
          {
            ...(loaded.draft as typeof sampleLocalServiceDraft),
            description: "Stale local-service tab must not overwrite.",
          },
          Vertical.LOCAL_SERVICE,
          { actor, expectedRevision: loaded.revision },
        ),
      ).rejects.toMatchObject({
        name: "DraftRevisionConflictError",
        currentRevision: firstSave.revision,
      });

      await expect(
        publishSiteDraft({
          siteId: localServiceSiteId,
          slug: localServiceSlug,
          vertical: Vertical.LOCAL_SERVICE,
          actor,
          changeSummary: "Stale local-service publish",
          expectedRevision: loaded.revision,
        }),
      ).rejects.toMatchObject({
        name: "DraftRevisionConflictError",
        currentRevision: firstSave.revision,
      });
    });
  },
);
