import { describe, expect, it, mock } from "bun:test";
import { Vertical } from "@/generated/prisma/enums";
import { leadSiteDrafts } from "@/lib/lead-drafts";
import { restoreAutomaticRestaurantTheme } from "@/lib/site-themes/restaurant/selection";

mock.module("server-only", () => ({}));

const {
  parseReviewedDraftBatchImport,
  parseReviewedDraftImport,
  reviewedDraftPhotoPlan,
} = await import("@/lib/operator-reviewed-draft-import");

const approvedDraft = leadSiteDrafts["le-petit-meunier"];
const scoredApprovedDraft = {
  ...approvedDraft,
  attributes: {
    ...approvedDraft.attributes,
    themeSelection: restoreAutomaticRestaurantTheme(
      approvedDraft.attributes.designProfile,
    ),
  },
};
const googleHero =
  "https://lh3.googleusercontent.com/sitesv/refreshed-hero-token=w1280";

describe("reviewed operator draft import", () => {
  it("accepts an exact vertical draft without changing private content", () => {
    const input = parseReviewedDraftImport({
      vertical: Vertical.RESTAURANT,
      draft: approvedDraft,
    });

    expect(input.vertical).toBe(Vertical.RESTAURANT);
    expect(input.draft).toEqual(approvedDraft);
    expect(input.draft.slug).toBe("le-petit-meunier");
  });

  it("turns reviewed hero and gallery originals into official photo slots", () => {
    const hero = "https://restaurant.example/hero.jpg";
    const gallery = "https://restaurant.example/gallery.jpg";
    expect(
      reviewedDraftPhotoPlan({
        ...approvedDraft,
        heroImageUrl: hero,
        heroOriginalImageUrl: hero,
        galleryImages: [
          { url: gallery, originalUrl: gallery, provenance: "official" },
        ],
      }),
    ).toEqual([
      {
        sourceUrl: hero,
        sourcePageUrl: approvedDraft.sourceUrl!,
        usage: "HERO",
      },
      {
        sourceUrl: gallery,
        sourcePageUrl: approvedDraft.sourceUrl!,
        usage: "GALLERY",
      },
    ]);
  });

  it("requires the public source that binds import identity", () => {
    expect(() =>
      parseReviewedDraftImport({
        vertical: Vertical.RESTAURANT,
        draft: { ...approvedDraft, sourceUrl: null },
      }),
    ).toThrow("public source URL");
  });

  it("rejects content that does not satisfy the selected vertical", () => {
    expect(() =>
      parseReviewedDraftImport({
        vertical: Vertical.RESTAURANT,
        draft: { ...approvedDraft, catalogSections: [] },
      }),
    ).toThrow();
  });

  it("validates a locked batch as one bounded operator request", () => {
    const batch = parseReviewedDraftBatchImport({
      batch: "malta-first-11",
      locked: true,
      vertical: Vertical.RESTAURANT,
      drafts: [
        scoredApprovedDraft,
        {
          ...scoredApprovedDraft,
          slug: "second",
          sourceUrl: "https://second.example",
        },
      ],
    });

    expect(batch.batch).toBe("malta-first-11");
    expect(batch.imports.map((entry) => entry.draft.slug)).toEqual([
      "le-petit-meunier",
      "second",
    ]);
  });

  it("requires and decodes transferred Google Sites photo bytes", () => {
    const draft = {
      ...scoredApprovedDraft,
      heroImageUrl: googleHero,
      heroOriginalImageUrl: googleHero,
      galleryImages: [],
    };
    expect(() =>
      parseReviewedDraftBatchImport({
        batch: "missing-google-transfer",
        locked: true,
        vertical: Vertical.RESTAURANT,
        drafts: [draft],
      }),
    ).toThrow("must be transferred by the operator client");

    const batch = parseReviewedDraftBatchImport({
      batch: "transferred-google-photo",
      locked: true,
      vertical: Vertical.RESTAURANT,
      drafts: [draft],
      photoTransfers: [
        {
          sourceUrl: googleHero,
          mediaType: "image/png",
          dataBase64: "iVBORw==",
        },
      ],
    });

    expect(batch.imports[0]?.transferredPhotos).toEqual([
      {
        sourceUrl: googleHero,
        mediaType: "image/png",
        data: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
      },
    ]);
  });

  it("rejects unlocked or duplicate batches", () => {
    expect(() =>
      parseReviewedDraftBatchImport({
        batch: "unlocked",
        locked: false,
        vertical: Vertical.RESTAURANT,
        drafts: [approvedDraft],
      }),
    ).toThrow();
    expect(() =>
      parseReviewedDraftBatchImport({
        batch: "unscored",
        locked: true,
        vertical: Vertical.RESTAURANT,
        drafts: [approvedDraft],
      }),
    ).toThrow("requires scored vertical themes");
    expect(() =>
      parseReviewedDraftBatchImport({
        batch: "duplicate",
        locked: true,
        vertical: Vertical.RESTAURANT,
        drafts: [scoredApprovedDraft, scoredApprovedDraft],
      }),
    ).toThrow("must be unique");
  });
});
