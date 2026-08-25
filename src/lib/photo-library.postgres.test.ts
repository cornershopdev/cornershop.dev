import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({
  revalidateTag: () => undefined,
  unstable_cache: <T extends (...args: never[]) => unknown>(callback: T): T =>
    callback,
}));

const enabled = process.env.PHOTO_LIBRARY_POSTGRES_TEST === "1";
const siteId = `photo-site-${randomUUID()}`;
const slug = `photo-${randomUUID()}`;
const actor = { id: `owner-${randomUUID()}`, role: "owner" as const };

let db: ReturnType<typeof import("@/lib/db").getDb>;
let getPhotoLibrary: typeof import("@/lib/photo-library").getPhotoLibrary;
let reviewPhoto: typeof import("@/lib/photo-library").reviewPhoto;
let reserveEnhancementRun: typeof import("@/lib/photo-library").reserveEnhancementRun;
let claimEnhancementRun: typeof import("@/lib/photo-library").claimEnhancementRun;
let publishSiteDraft: typeof import("@/lib/site-publication").publishSiteDraft;
let updateSiteDraft: typeof import("@/lib/site-persistence").updateSiteDraft;
let findPublishedSiteView: typeof import("@/lib/sites").findPublishedSiteView;
let findSiteView: typeof import("@/lib/sites").findSiteView;
let photoId: string;
let secondHeroPhotoId: string;
let catalogPhotoId: string;
let galleryPhotoId: string;
let catalogItemId: string;
let secondCatalogItemId: string;

describe.skipIf(!enabled)("photo library PostgreSQL persistence", () => {
  beforeAll(async () => {
    const database = await import("@/lib/db");
    const library = await import("@/lib/photo-library");
    const publication = await import("@/lib/site-publication");
    const persistence = await import("@/lib/site-persistence");
    const sites = await import("@/lib/sites");
    db = database.getDb();
    getPhotoLibrary = library.getPhotoLibrary;
    reviewPhoto = library.reviewPhoto;
    reserveEnhancementRun = library.reserveEnhancementRun;
    claimEnhancementRun = library.claimEnhancementRun;
    publishSiteDraft = publication.publishSiteDraft;
    updateSiteDraft = persistence.updateSiteDraft;
    findPublishedSiteView = sites.findPublishedSiteView;
    findSiteView = sites.findSiteView;

    const site = await db.site.create({
      data: {
        id: siteId,
        slug,
        name: "Photo Test Bistro",
        description: "A real fixture used only for photo persistence checks.",
        sourceUrl: "https://photo-test.example/",
        draftPalette: {
          background: "#ffffff",
          foreground: "#111111",
          accent: "#aa0000",
        },
        attributes: { cuisine: "Bistro", showMenuImages: true },
        status: "CLAIMED",
        catalogSections: {
          create: {
            name: "Menu",
            position: 0,
            items: {
              create: [
                { name: "Pasta", position: 0 },
                { name: "Tiramisu", position: 1 },
              ],
            },
          },
        },
      },
      select: {
        catalogSections: {
          select: { items: { select: { id: true } } },
        },
      },
    });
    catalogItemId = site.catalogSections[0]!.items[0]!.id;
    secondCatalogItemId = site.catalogSections[0]!.items[1]!.id;
    const hero = await db.photoAsset.create({
      data: {
        siteId,
        sourceUrl: "https://photo-test.example/room.jpg",
        sourcePageUrl: "https://photo-test.example/",
        provenance: "OFFICIAL",
        sourceKind: "FIRST_PARTY",
        contentSha256: "a".repeat(64),
        originalStorageKey: `test/${"a".repeat(64)}.jpg`,
        originalUrl: "https://assets.example/original-room.jpg",
        mediaType: "image/jpeg",
        byteLength: 1_024,
        candidateUsages: ["HERO", "GALLERY"],
      },
    });
    photoId = hero.id;
    const secondHero = await db.photoAsset.create({
      data: {
        siteId,
        sourceUrl: "https://photo-test.example/patio.jpg",
        sourcePageUrl: "https://photo-test.example/",
        provenance: "OFFICIAL",
        sourceKind: "FIRST_PARTY",
        contentSha256: "d".repeat(64),
        originalStorageKey: `test/${"d".repeat(64)}.jpg`,
        originalUrl: "https://assets.example/original-patio.jpg",
        mediaType: "image/jpeg",
        byteLength: 1_024,
        candidateUsages: ["HERO"],
        reviewStatus: "APPROVED",
        reviewedAt: new Date(),
        reviewedBy: `owner:${actor.id}`,
      },
    });
    secondHeroPhotoId = secondHero.id;
    const catalog = await db.photoAsset.create({
      data: {
        siteId,
        sourceUrl: "owner-upload:test:pasta.jpg",
        provenance: "OWNER",
        sourceKind: "OWNER_UPLOAD",
        contentSha256: "b".repeat(64),
        originalStorageKey: `test/${"b".repeat(64)}.jpg`,
        originalUrl: "https://assets.example/original-pasta.jpg",
        mediaType: "image/jpeg",
        byteLength: 1_024,
        candidateUsages: ["CATALOG"],
        reviewStatus: "APPROVED",
        reviewedAt: new Date(),
        reviewedBy: `owner:${actor.id}`,
      },
    });
    catalogPhotoId = catalog.id;
    const gallery = await db.photoAsset.create({
      data: {
        siteId,
        sourceUrl: "https://photo-test.example/dining-room.jpg",
        sourcePageUrl: "https://photo-test.example/gallery",
        provenance: "OFFICIAL",
        sourceKind: "FIRST_PARTY",
        contentSha256: "c".repeat(64),
        originalStorageKey: `test/${"c".repeat(64)}.jpg`,
        originalUrl: "https://assets.example/original-dining-room.jpg",
        mediaType: "image/jpeg",
        byteLength: 1_024,
        candidateUsages: ["GALLERY"],
        reviewStatus: "APPROVED",
        reviewedAt: new Date(),
        reviewedBy: `owner:${actor.id}`,
      },
    });
    galleryPhotoId = gallery.id;
  });

  afterAll(async () => {
    await db.site.deleteMany({ where: { id: siteId } });
  });

  test("enforces content dedupe and persists reviewed hero selection", async () => {
    let duplicateCode: string | null = null;
    try {
      await db.photoAsset.create({
        data: {
          siteId,
          sourceUrl: "https://cdn.example/duplicate.jpg",
          provenance: "OFFICIAL",
          sourceKind: "FIRST_PARTY",
          contentSha256: "a".repeat(64),
          originalStorageKey: "test/duplicate.jpg",
          originalUrl: "https://assets.example/duplicate.jpg",
          mediaType: "image/jpeg",
          byteLength: 1_024,
          candidateUsages: ["GALLERY"],
        },
      });
    } catch (error) {
      duplicateCode = (error as { code?: string }).code ?? null;
    }
    expect(duplicateCode).toBe("P2002");

    await reviewPhoto({
      siteId,
      photoId,
      actor,
      review: { action: "approve_original" },
    });
    await reviewPhoto({
      siteId,
      photoId,
      actor,
      review: { action: "select_hero" },
    });
    expect(
      await db.site.findUniqueOrThrow({
        where: { id: siteId },
        select: {
          heroImageUrl: true,
          heroOriginalImageUrl: true,
          heroImageProvenance: true,
          draftRevision: true,
        },
      }),
    ).toEqual({
      heroImageUrl: "https://assets.example/original-room.jpg",
      heroOriginalImageUrl: "https://assets.example/original-room.jpg",
      heroImageProvenance: "OFFICIAL",
      draftRevision: 1,
    });
  });

  test("requires before/after approval and restores the immutable original", async () => {
    await db.photoAsset.update({
      where: { id: photoId },
      data: {
        enhancedUrl: "https://assets.example/enhanced-room.webp",
        enhancedStorageKey: "test/enhanced-room.webp",
        enhancedReviewStatus: "PENDING",
        enhancementStatus: "SUCCEEDED",
        enhancementModel: "google/gemini-3.1-flash-image",
        enhancementConfigVersion: "abc123def4567890",
        enhancementCostMicros: 12_345,
      },
    });
    await db.photoEnhancementRun.create({
      data: {
        siteId,
        photoId,
        idempotencyKey: `${siteId}:${photoId}:postgres-test`,
        status: "SUCCEEDED",
        model: "google/gemini-3.1-flash-image",
        configVersion: "abc123def4567890",
        estimatedCostMicros: 25_000,
        actualCostMicros: 12_345,
        requestedBy: `owner:${actor.id}`,
        completedAt: new Date(),
      },
    });
    await reviewPhoto({
      siteId,
      photoId,
      actor,
      review: { action: "approve_enhancement" },
    });
    expect(
      await db.site.findUniqueOrThrow({
        where: { id: siteId },
        select: { heroImageUrl: true },
      }),
    ).toEqual({ heroImageUrl: "https://assets.example/enhanced-room.webp" });

    await reviewPhoto({
      siteId,
      photoId,
      actor,
      review: { action: "restore_original" },
    });
    expect(
      await db.site.findUniqueOrThrow({
        where: { id: siteId },
        select: { heroImageUrl: true },
      }),
    ).toEqual({ heroImageUrl: "https://assets.example/original-room.jpg" });
  });

  test("serializes two-tab hero selection and preserves the single-hero invariant", async () => {
    const expectedRevision = (await getPhotoLibrary(siteId)).draftRevision;
    const selections = await Promise.allSettled([
      reviewPhoto({
        siteId,
        photoId,
        expectedRevision,
        actor,
        review: { action: "select_hero" },
      }),
      reviewPhoto({
        siteId,
        photoId: secondHeroPhotoId,
        expectedRevision,
        actor,
        review: { action: "select_hero" },
      }),
    ]);
    expect(selections.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(selections.filter((result) => result.status === "rejected")).toHaveLength(1);
    const selected = await db.photoAsset.findMany({
      where: { siteId, selectedUsage: "HERO" },
      select: { id: true, originalUrl: true },
    });
    expect(selected).toHaveLength(1);
    expect(
      await db.site.findUniqueOrThrow({
        where: { id: siteId },
        select: { heroImageUrl: true, heroOriginalImageUrl: true },
      }),
    ).toEqual({
      heroImageUrl: selected[0]!.originalUrl,
      heroOriginalImageUrl: selected[0]!.originalUrl,
    });

    // Leave the shared fixture deterministic for the enhancement assertions.
    await reviewPhoto({
      siteId,
      photoId,
      actor,
      review: { action: "select_hero" },
    });
  });

  test("selects a real catalog photo and reports committed cost plus audit history", async () => {
    await reviewPhoto({
      siteId,
      photoId: catalogPhotoId,
      actor,
      review: { action: "select_catalog", catalogItemId },
    });
    expect(
      await db.catalogItem.findUniqueOrThrow({
        where: { id: catalogItemId },
        select: { imageUrl: true, originalImageUrl: true, imageProvenance: true },
      }),
    ).toEqual({
      imageUrl: "https://assets.example/original-pasta.jpg",
      originalImageUrl: "https://assets.example/original-pasta.jpg",
      imageProvenance: "OWNER",
    });
    await reviewPhoto({
      siteId,
      photoId: catalogPhotoId,
      actor,
      review: { action: "select_catalog", catalogItemId: secondCatalogItemId },
    });
    expect(
      await db.catalogItem.findMany({
        where: { id: { in: [catalogItemId, secondCatalogItemId] } },
        orderBy: { position: "asc" },
        select: { imageUrl: true },
      }),
    ).toEqual([
      { imageUrl: null },
      { imageUrl: "https://assets.example/original-pasta.jpg" },
    ]);
    const library = await getPhotoLibrary(siteId);
    expect(library.budget.committedMicros).toBe(12_345);
    expect(library.photos).toHaveLength(4);
    expect(
      await db.auditEvent.count({
        where: { siteId, type: { startsWith: "photo." } },
      }),
    ).toBeGreaterThanOrEqual(5);
  });

  test("reconciles a selected catalog photo by stable identity across reorder and deletion", async () => {
    const before = await getPhotoLibrary(siteId);
    const view = await findSiteView(slug);
    expect(view).not.toBeNull();
    const reordered = structuredClone(view!.draft) as unknown as Parameters<
      typeof updateSiteDraft
    >[1];
    reordered.catalogSections = reordered.catalogSections.map((section) => ({
      ...section,
      items: [...section.items].reverse(),
    }));
    await updateSiteDraft(slug, reordered, "RESTAURANT", {
      expectedRevision: before.draftRevision,
      actor: { id: actor.id, email: "photo-owner@example.test" },
    });

    const afterReorder = await getPhotoLibrary(siteId);
    const selectedPhoto = afterReorder.photos.find(
      (photo) => photo.id === catalogPhotoId,
    );
    const selectedItem = afterReorder.catalogItems.find(
      (item) => item.id === selectedPhoto?.selectedCatalogItemId,
    );
    expect(selectedItem?.name).toBe("Tiramisu");
    expect(
      (await findSiteView(slug))?.draft.catalogSections[0]?.items.find(
        (item) => item.name === "Tiramisu",
      )?.imageUrl,
    ).toBe("https://assets.example/original-pasta.jpg");

    const afterReorderView = await findSiteView(slug);
    const deleted = structuredClone(afterReorderView!.draft) as unknown as Parameters<
      typeof updateSiteDraft
    >[1];
    deleted.catalogSections = deleted.catalogSections.map((section) => ({
      ...section,
      items: section.items.filter((item) => item.name !== "Tiramisu"),
    }));
    await updateSiteDraft(slug, deleted, "RESTAURANT", {
      expectedRevision: afterReorder.draftRevision,
      actor: { id: actor.id, email: "photo-owner@example.test" },
    });
    const afterDelete = await getPhotoLibrary(siteId);
    expect(
      afterDelete.photos.find((photo) => photo.id === catalogPhotoId),
    ).toMatchObject({ selectedUsage: null, selectedCatalogItemId: null });
    expect(
      (await findSiteView(slug))?.draft.catalogSections.flatMap(
        (section) => section.items,
      ),
    ).not.toContainEqual(
      expect.objectContaining({
        imageUrl: "https://assets.example/original-pasta.jpg",
      }),
    );
  });

  test("deduplicates canonical enhancement operations and admits one concurrent claim", async () => {
    const operation = {
      siteId,
      photoId: catalogPhotoId,
      actor: `owner:${actor.id}`,
      model: "google/gemini-3.1-flash-image",
      configVersion: "canonical123456",
    };
    const [first, second] = await Promise.all([
      reserveEnhancementRun(operation),
      reserveEnhancementRun(operation),
    ]);
    expect(second.id).toBe(first.id);
    expect(
      await db.photoEnhancementRun.count({
        where: {
          siteId,
          photoId: catalogPhotoId,
          configVersion: operation.configVersion,
        },
      }),
    ).toBe(1);
    const claims = await Promise.all([
      claimEnhancementRun(first.id, 4),
      claimEnhancementRun(first.id, 4),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);

    await db.photoEnhancementRun.update({
      where: { id: first.id },
      data: { status: "FAILED", actualCostMicros: 0, completedAt: new Date() },
    });
    await db.photoAsset.update({
      where: { id: catalogPhotoId },
      data: { enhancementStatus: "FAILED" },
    });
  });

  test("blocks an imported remote hero after ingestion failure until claim review selects its immutable original", async () => {
    await db.photoAsset.updateMany({
      where: { siteId, selectedUsage: "HERO" },
      data: { selectedUsage: null },
    });
    await db.site.update({
      where: { id: siteId },
      data: {
        status: "CLAIMED",
        heroImageUrl: "https://mutable-source.example/hero.jpg",
        heroOriginalImageUrl: "https://mutable-source.example/hero.jpg",
        heroImageProvenance: "OFFICIAL",
      },
    });
    const before = await db.site.findUniqueOrThrow({
      where: { id: siteId },
      select: { publishedSiteVersionId: true, _count: { select: { siteVersions: true } } },
    });
    await expect(
      publishSiteDraft({
        siteId,
        slug,
        vertical: "RESTAURANT",
        actor: { id: actor.id, email: "photo-owner@example.test" },
        expectedRevision: (
          await db.site.findUniqueOrThrow({
            where: { id: siteId },
            select: { draftRevision: true },
          })
        ).draftRevision,
        changeSummary: "Reject mutable imported hero",
      }),
    ).rejects.toThrow("immutable storage");
    expect(
      await db.site.findUniqueOrThrow({
        where: { id: siteId },
        select: { publishedSiteVersionId: true, _count: { select: { siteVersions: true } } },
      }),
    ).toEqual(before);

    await reviewPhoto({
      siteId,
      photoId,
      actor,
      review: { action: "select_hero" },
    });
    await expect(
      publishSiteDraft({
        siteId,
        slug,
        vertical: "RESTAURANT",
        actor: { id: actor.id, email: "photo-owner@example.test" },
        expectedRevision: (
          await db.site.findUniqueOrThrow({
            where: { id: siteId },
            select: { draftRevision: true },
          })
        ).draftRevision,
        changeSummary: "Publish reviewed immutable hero",
      }),
    ).resolves.toMatchObject({ version: 1 });
    expect((await findPublishedSiteView(slug))?.draft.heroImageUrl).toBe(
      "https://assets.example/original-room.jpg",
    );
  });

  test("projects selected gallery provenance through private preview and immutable live snapshots", async () => {
    const beforeSelection = await getPhotoLibrary(siteId);
    await reviewPhoto({
      siteId,
      photoId: galleryPhotoId,
      expectedRevision: beforeSelection.draftRevision,
      actor,
      review: { action: "select_gallery" },
    });
    expect((await getPhotoLibrary(siteId)).draftRevision).toBe(
      beforeSelection.draftRevision + 1,
    );
    await expect(
      reviewPhoto({
        siteId,
        photoId: galleryPhotoId,
        expectedRevision: beforeSelection.draftRevision,
        actor,
        review: { action: "unselect" },
      }),
    ).rejects.toMatchObject({ code: "DRAFT_REVISION_CONFLICT", status: 409 });
    expect((await findSiteView(slug))?.draft.galleryImages).toEqual([
      {
        url: "https://assets.example/original-dining-room.jpg",
        originalUrl: "https://assets.example/original-dining-room.jpg",
        provenance: "official",
      },
    ]);

    await db.photoAsset.update({
      where: { id: galleryPhotoId },
      data: {
        enhancedUrl: "https://assets.example/enhanced-dining-room.webp",
        enhancedStorageKey: "test/enhanced-dining-room.webp",
        enhancedReviewStatus: "PENDING",
        enhancementStatus: "SUCCEEDED",
        enhancementModel: "google/gemini-3.1-flash-image",
        enhancementConfigVersion: "gallery123456789",
        enhancementCostMicros: 10_000,
      },
    });
    await reviewPhoto({
      siteId,
      photoId: galleryPhotoId,
      actor,
      review: { action: "approve_enhancement" },
    });
    expect((await findSiteView(slug))?.draft.galleryImages[0]).toEqual({
      url: "https://assets.example/enhanced-dining-room.webp",
      originalUrl: "https://assets.example/original-dining-room.jpg",
      provenance: "official",
    });

    await publishSiteDraft({
      siteId,
      slug,
      vertical: "RESTAURANT",
      actor: { id: actor.id, email: "photo-owner@example.test" },
      expectedRevision: (
        await db.site.findUniqueOrThrow({
          where: { id: siteId },
          select: { draftRevision: true },
        })
      ).draftRevision,
      changeSummary: "Publish approved gallery",
    });
    expect((await findPublishedSiteView(slug))?.draft.galleryImages[0]).toEqual({
      url: "https://assets.example/enhanced-dining-room.webp",
      originalUrl: "https://assets.example/original-dining-room.jpg",
      provenance: "official",
    });

    await reviewPhoto({
      siteId,
      photoId: galleryPhotoId,
      actor,
      review: { action: "restore_original" },
    });
    expect((await findSiteView(slug))?.draft.galleryImages[0]?.url).toBe(
      "https://assets.example/original-dining-room.jpg",
    );
    expect((await findPublishedSiteView(slug))?.draft.galleryImages[0]?.url).toBe(
      "https://assets.example/enhanced-dining-room.webp",
    );

    await publishSiteDraft({
      siteId,
      slug,
      vertical: "RESTAURANT",
      actor: { id: actor.id, email: "photo-owner@example.test" },
      expectedRevision: (
        await db.site.findUniqueOrThrow({
          where: { id: siteId },
          select: { draftRevision: true },
        })
      ).draftRevision,
      changeSummary: "Restore authentic original gallery",
    });
    expect((await findPublishedSiteView(slug))?.draft.galleryImages[0]).toEqual({
      url: "https://assets.example/original-dining-room.jpg",
      originalUrl: "https://assets.example/original-dining-room.jpg",
      provenance: "official",
    });
  });
});

const foodSiteId = `photo-food-${randomUUID()}`;
const foodSlug = `photo-food-${randomUUID()}`;
const localSiteId = `photo-local-${randomUUID()}`;
const localSlug = `photo-local-${randomUUID()}`;
const otherSiteId = `photo-other-${randomUUID()}`;
const otherSlug = `photo-other-${randomUUID()}`;

describe.skipIf(!enabled)("vertical photo library PostgreSQL persistence", () => {
  let sampleFoodRetailDraft: typeof import("@/lib/verticals/food-retail/fixtures").sampleFoodRetailDraft;
  let sampleLocalServiceDraft: typeof import("@/lib/verticals/local-service/fixtures").sampleLocalServiceSiteDraft;
  let Vertical: typeof import("@/generated/prisma/enums").Vertical;
  let foodProductPhotoId: string;
  let foodHeroPhotoId: string;
  let localGalleryPhotoId: string;

  beforeAll(async () => {
    const foodRetail = await import("@/lib/verticals/food-retail/fixtures");
    const localService = await import("@/lib/verticals/local-service/fixtures");
    const enums = await import("@/generated/prisma/enums");
    sampleFoodRetailDraft = foodRetail.sampleFoodRetailDraft;
    sampleLocalServiceDraft = localService.sampleLocalServiceSiteDraft;
    Vertical = enums.Vertical;

    await db.site.create({
      data: {
        id: foodSiteId,
        slug: foodSlug,
        name: sampleFoodRetailDraft.name,
        description: sampleFoodRetailDraft.description,
        sourceUrl: sampleFoodRetailDraft.sourceUrl,
        vertical: Vertical.FOOD_RETAIL,
        status: "CLAIMED",
        attributes: sampleFoodRetailDraft.attributes,
        catalogSections: {
          create: {
            name: sampleFoodRetailDraft.catalogSections[0]!.name,
            position: 0,
            items: {
              create: {
                name: sampleFoodRetailDraft.catalogSections[0]!.items[0]!.name,
                position: 0,
              },
            },
          },
        },
      },
    });
    foodHeroPhotoId = (
      await db.photoAsset.create({
        data: {
          siteId: foodSiteId,
          sourceUrl: "https://photo-food.example/counter.jpg",
          provenance: "OFFICIAL",
          sourceKind: "FIRST_PARTY",
          contentSha256: "1".repeat(64),
          originalStorageKey: `test/${"1".repeat(64)}.jpg`,
          originalUrl: "https://assets.example/food-counter.jpg",
          mediaType: "image/jpeg",
          byteLength: 1_024,
          candidateUsages: ["HERO"],
          reviewStatus: "APPROVED",
          reviewedAt: new Date(),
          reviewedBy: `owner:${actor.id}`,
        },
      })
    ).id;
    foodProductPhotoId = (
      await db.photoAsset.create({
        data: {
          siteId: foodSiteId,
          sourceUrl: "owner-upload:test:loaf.jpg",
          provenance: "OWNER",
          sourceKind: "OWNER_UPLOAD",
          contentSha256: "2".repeat(64),
          originalStorageKey: `test/${"2".repeat(64)}.jpg`,
          originalUrl: "https://assets.example/food-loaf.jpg",
          mediaType: "image/jpeg",
          byteLength: 1_024,
          candidateUsages: ["CATALOG"],
          reviewStatus: "APPROVED",
          reviewedAt: new Date(),
          reviewedBy: `owner:${actor.id}`,
        },
      })
    ).id;

    await db.site.create({
      data: {
        id: localSiteId,
        slug: localSlug,
        name: sampleLocalServiceDraft.name,
        description: sampleLocalServiceDraft.description,
        sourceUrl: sampleLocalServiceDraft.sourceUrl,
        vertical: Vertical.LOCAL_SERVICE,
        status: "CLAIMED",
        attributes: sampleLocalServiceDraft.attributes,
        catalogSections: {
          create: {
            name: sampleLocalServiceDraft.catalogSections[0]!.name,
            position: 0,
            items: {
              create: {
                name: sampleLocalServiceDraft.catalogSections[0]!.items[0]!.name,
                position: 0,
              },
            },
          },
        },
      },
    });
    localGalleryPhotoId = (
      await db.photoAsset.create({
        data: {
          siteId: localSiteId,
          sourceUrl: "https://photo-local.example/rewire.jpg",
          provenance: "OFFICIAL",
          sourceKind: "FIRST_PARTY",
          contentSha256: "3".repeat(64),
          originalStorageKey: `test/${"3".repeat(64)}.jpg`,
          originalUrl: "https://assets.example/local-rewire.jpg",
          mediaType: "image/jpeg",
          byteLength: 1_024,
          candidateUsages: ["GALLERY"],
          reviewStatus: "APPROVED",
          reviewedAt: new Date(),
          reviewedBy: `owner:${actor.id}`,
        },
      })
    ).id;

    await db.site.create({
      data: {
        id: otherSiteId,
        slug: otherSlug,
        name: "Other bakery",
        description: "A second tenant used only to prove photo isolation.",
        sourceUrl: "https://other-bakery.example/",
        vertical: Vertical.FOOD_RETAIL,
        status: "CLAIMED",
        attributes: sampleFoodRetailDraft.attributes,
      },
    });
  });

  afterAll(async () => {
    await db.site.deleteMany({
      where: { id: { in: [foodSiteId, localSiteId, otherSiteId] } },
    });
  });

  test("does not save arbitrary food-retail URLs or caller-authored provenance", async () => {
    const draft = structuredClone(sampleFoodRetailDraft);
    draft.slug = foodSlug;
    draft.heroImageUrl = "https://example.com/invented-hero.jpg";
    draft.heroOriginalImageUrl = "https://example.com/invented-hero.jpg";
    draft.heroImageProvenance = "permissioned-ugc";
    draft.catalogSections[0]!.items[0]!.imageUrl =
      "https://example.com/invented-loaf.jpg";
    draft.catalogSections[0]!.items[0]!.originalImageUrl =
      "https://example.com/invented-loaf.jpg";
    draft.catalogSections[0]!.items[0]!.imageProvenance = "owner";

    await updateSiteDraft(foodSlug, draft, Vertical.FOOD_RETAIL, {
      expectedRevision: 0,
      actor: { id: actor.id, email: "photo-owner@example.test" },
    });
    expect(
      await db.site.findUniqueOrThrow({
        where: { id: foodSiteId },
        select: {
          heroImageUrl: true,
          heroOriginalImageUrl: true,
          heroImageProvenance: true,
        },
      }),
    ).toEqual({
      heroImageUrl: null,
      heroOriginalImageUrl: null,
      heroImageProvenance: null,
    });
    expect(
      await db.catalogItem.findFirstOrThrow({
        where: {
          section: { siteId: foodSiteId },
          name: sampleFoodRetailDraft.catalogSections[0]!.items[0]!.name,
        },
        select: {
          imageUrl: true,
          originalImageUrl: true,
          imageProvenance: true,
        },
      }),
    ).toEqual({
      imageUrl: null,
      originalImageUrl: null,
      imageProvenance: null,
    });
  });

  test("maps approved food-retail media onto hero and product slots with tenant isolation", async () => {
    const library = await getPhotoLibrary(foodSiteId);
    const productItem = library.catalogItems.find(
      (item) =>
        item.name === sampleFoodRetailDraft.catalogSections[0]!.items[0]!.name,
    );
    expect(productItem).toBeDefined();
    await reviewPhoto({
      siteId: foodSiteId,
      photoId: foodHeroPhotoId,
      expectedRevision: library.draftRevision,
      actor,
      review: { action: "select_hero" },
    });
    await reviewPhoto({
      siteId: foodSiteId,
      photoId: foodProductPhotoId,
      actor,
      review: { action: "select_catalog", catalogItemId: productItem!.id },
    });

    const otherLibrary = await getPhotoLibrary(otherSiteId);
    expect(otherLibrary.photos).toEqual([]);

    expect(
      await db.site.findUniqueOrThrow({
        where: { id: foodSiteId },
        select: {
          heroImageUrl: true,
          heroOriginalImageUrl: true,
          heroImageProvenance: true,
        },
      }),
    ).toEqual({
      heroImageUrl: "https://assets.example/food-counter.jpg",
      heroOriginalImageUrl: "https://assets.example/food-counter.jpg",
      heroImageProvenance: "OFFICIAL",
    });
    expect(
      await db.catalogItem.findFirstOrThrow({
        where: {
          section: { siteId: foodSiteId },
          name: sampleFoodRetailDraft.catalogSections[0]!.items[0]!.name,
        },
        select: {
          imageUrl: true,
          originalImageUrl: true,
          imageProvenance: true,
        },
      }),
    ).toEqual({
      imageUrl: "https://assets.example/food-loaf.jpg",
      originalImageUrl: "https://assets.example/food-loaf.jpg",
      imageProvenance: "OWNER",
    });

    const overwrite = structuredClone(sampleFoodRetailDraft);
    overwrite.slug = foodSlug;
    overwrite.heroImageUrl = "https://example.com/invented-hero.jpg";
    overwrite.heroOriginalImageUrl = "https://example.com/invented-hero.jpg";
    overwrite.heroImageProvenance = "permissioned-ugc";
    overwrite.catalogSections[0]!.items[0]!.imageUrl =
      "https://example.com/invented-loaf.jpg";
    overwrite.catalogSections[0]!.items[0]!.imageProvenance = "owner";
    await updateSiteDraft(foodSlug, overwrite, Vertical.FOOD_RETAIL, {
      expectedRevision: (await getPhotoLibrary(foodSiteId)).draftRevision,
    });
    expect(
      await db.site.findUniqueOrThrow({
        where: { id: foodSiteId },
        select: { heroImageUrl: true },
      }),
    ).toEqual({ heroImageUrl: "https://assets.example/food-counter.jpg" });
    expect(
      await db.catalogItem.findFirstOrThrow({
        where: {
          section: { siteId: foodSiteId },
          name: sampleFoodRetailDraft.catalogSections[0]!.items[0]!.name,
        },
        select: { imageUrl: true },
      }),
    ).toEqual({ imageUrl: "https://assets.example/food-loaf.jpg" });

    const smuggled = structuredClone(sampleFoodRetailDraft);
    smuggled.slug = otherSlug;
    smuggled.heroImageUrl = "https://assets.example/food-counter.jpg";
    smuggled.heroOriginalImageUrl = "https://assets.example/food-counter.jpg";
    smuggled.heroImageProvenance = "official";
    await updateSiteDraft(otherSlug, smuggled, Vertical.FOOD_RETAIL, {
      expectedRevision: 0,
    });
    expect((await findSiteView(otherSlug))?.draft.heroImageUrl).toBeNull();
  });

  test("maps local-service gallery photos onto project slots and survives save, publish, and rollback", async () => {
    const before = await getPhotoLibrary(localSiteId);
    await reviewPhoto({
      siteId: localSiteId,
      photoId: localGalleryPhotoId,
      expectedRevision: before.draftRevision,
      actor,
      review: { action: "select_gallery" },
    });
    await expect(
      reviewPhoto({
        siteId: localSiteId,
        photoId: localGalleryPhotoId,
        expectedRevision: before.draftRevision,
        actor,
        review: { action: "unselect" },
      }),
    ).rejects.toMatchObject({ code: "DRAFT_REVISION_CONFLICT", status: 409 });

    const draft = structuredClone(sampleLocalServiceDraft);
    draft.slug = localSlug;
    draft.attributes.projects[0]!.imageUrl =
      "https://example.com/invented-project.jpg";
    draft.attributes.projects[0]!.imageProvenance = "owner";
    const saved = await updateSiteDraft(localSlug, draft, Vertical.LOCAL_SERVICE, {
      expectedRevision: (await getPhotoLibrary(localSiteId)).draftRevision,
      actor: { id: actor.id, email: "photo-owner@example.test" },
    });
    const privateView = await findSiteView(localSlug);
    expect(privateView?.draft.galleryImages).toEqual([
      {
        url: "https://assets.example/local-rewire.jpg",
        originalUrl: "https://assets.example/local-rewire.jpg",
        provenance: "official",
      },
    ]);
    const privateProjects = (
      privateView?.draft.attributes as {
        projects: Array<Record<string, unknown>>;
      }
    ).projects;
    expect(privateProjects[0]).toMatchObject({
      title: "Townhouse rewire",
      imageUrl: "https://assets.example/local-rewire.jpg",
      originalImageUrl: "https://assets.example/local-rewire.jpg",
      imageProvenance: "official",
    });

    await publishSiteDraft({
      siteId: localSiteId,
      slug: localSlug,
      vertical: "LOCAL_SERVICE",
      actor: { id: actor.id, email: "photo-owner@example.test" },
      expectedRevision: saved.revision,
      changeSummary: "Publish reviewed project gallery",
    });
    const live = await findPublishedSiteView(localSlug);
    expect(live?.draft.galleryImages[0]?.url).toBe(
      "https://assets.example/local-rewire.jpg",
    );
    const liveProjects = (
      live?.draft.attributes as {
        projects: Array<Record<string, unknown>>;
      }
    ).projects;
    expect(liveProjects[0]).toMatchObject({
      imageUrl: "https://assets.example/local-rewire.jpg",
      imageProvenance: "official",
    });

    const firstVersion = await db.siteVersion.findFirstOrThrow({
      where: { siteId: localSiteId },
      orderBy: { version: "asc" },
      select: { id: true },
    });
    const publication = await import("@/lib/site-publication");
    await publication.rollbackPublishedSiteVersion({
      siteId: localSiteId,
      slug: localSlug,
      vertical: "LOCAL_SERVICE",
      targetSiteVersionId: firstVersion.id,
      actor: { id: actor.id, email: "photo-owner@example.test" },
    });
    expect(
      (await findPublishedSiteView(localSlug))?.draft.galleryImages[0],
    ).toEqual({
      url: "https://assets.example/local-rewire.jpg",
      originalUrl: "https://assets.example/local-rewire.jpg",
      provenance: "official",
    });
    expect((await findSiteView(localSlug))?.draft.galleryImages[0]?.url).toBe(
      "https://assets.example/local-rewire.jpg",
    );
  });

  test("keeps a valid imported local path readable until it is adopted", async () => {
    const library = await getPhotoLibrary(foodSiteId);
    const selectedProduct = library.photos.find(
      (entry) => entry.id === foodProductPhotoId,
    );
    if (selectedProduct?.selectedUsage === "CATALOG") {
      await reviewPhoto({
        siteId: foodSiteId,
        photoId: foodProductPhotoId,
        expectedRevision: library.draftRevision,
        actor,
        review: { action: "unselect" },
      });
    }
    const draft = structuredClone(sampleFoodRetailDraft);
    draft.slug = foodSlug;
    draft.heroImageUrl = null;
    draft.heroOriginalImageUrl = null;
    draft.heroImageProvenance = null;
    draft.catalogSections[0]!.items[0]!.imageUrl = "/approved/loaf.webp";
    draft.catalogSections[0]!.items[0]!.originalImageUrl = "/approved/loaf.webp";
    draft.catalogSections[0]!.items[0]!.imageProvenance = "owner";
    await updateSiteDraft(foodSlug, draft, Vertical.FOOD_RETAIL, {
      expectedRevision: (await getPhotoLibrary(foodSiteId)).draftRevision,
    });
    expect(
      await db.catalogItem.findFirstOrThrow({
        where: {
          section: { siteId: foodSiteId },
          name: sampleFoodRetailDraft.catalogSections[0]!.items[0]!.name,
        },
        select: {
          imageUrl: true,
          originalImageUrl: true,
          imageProvenance: true,
        },
      }),
    ).toEqual({
      imageUrl: "/approved/loaf.webp",
      originalImageUrl: "/approved/loaf.webp",
      imageProvenance: "OWNER",
    });
  });
});
