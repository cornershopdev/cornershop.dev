import { describe, expect, it } from "bun:test";
import { Vertical } from "@/generated/prisma/enums";
import { leadSiteDrafts } from "@/lib/lead-drafts";
import {
  parseReviewedDraftBatchImport,
  parseReviewedDraftImport,
} from "@/lib/operator-reviewed-draft-import";

const approvedDraft = leadSiteDrafts["le-petit-meunier"];

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
        approvedDraft,
        { ...approvedDraft, slug: "second", sourceUrl: "https://second.example" },
      ],
    });

    expect(batch.batch).toBe("malta-first-11");
    expect(batch.imports.map((entry) => entry.draft.slug)).toEqual([
      "le-petit-meunier",
      "second",
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
        batch: "duplicate",
        locked: true,
        vertical: Vertical.RESTAURANT,
        drafts: [approvedDraft, approvedDraft],
      }),
    ).toThrow("must be unique");
  });
});
