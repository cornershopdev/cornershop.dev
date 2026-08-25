import { describe, expect, it } from "bun:test";
import { Vertical } from "@/generated/prisma/enums";
import { isVerticalClaimEnabled } from "@/lib/verticals/registry";

const importStudio = await Bun.file(
  new URL("../app/create/import-studio.tsx", import.meta.url),
).text();
const claimPage = await Bun.file(
  new URL("../app/claim/[slug]/page.tsx", import.meta.url),
).text();
const checkoutRoute = await Bun.file(
  new URL("../app/api/checkout/route.ts", import.meta.url),
).text();

describe("food retail factory claim gate", () => {
  it("keeps the unpersisted food demo inside Import Studio", () => {
    expect(importStudio).toContain(
      "setExternalPreviewAvailable(previewAvailable)",
    );
    expect(importStudio).toContain("{externalPreviewAvailable ? (");
    expect(importStudio).toContain(
      "This demo remains in the preview above and has not created a",
    );
    expect(importStudio).toMatch(
      /Vertical\.FOOD_RETAIL[\s\S]*?complete\([\s\S]*?sampleFoodRetailDraft[\s\S]*?false,/,
    );
  });

  it("exposes the reviewed factory checkout through the shared claim guards", () => {
    expect(isVerticalClaimEnabled(Vertical.FOOD_RETAIL)).toBe(true);
    expect(isVerticalClaimEnabled(Vertical.RESTAURANT)).toBe(true);
    expect(importStudio).toContain(
      "{isVerticalClaimEnabled(site.vertical) ? (",
    );
    expect(claimPage).toContain("claimPageState");
    expect(checkoutRoute).toContain(
      "isVerticalClaimEnabled(invitation.vertical)",
    );
    expect(checkoutRoute).toContain("resolveClaimLaunchOfferForVertical");
  });
});
