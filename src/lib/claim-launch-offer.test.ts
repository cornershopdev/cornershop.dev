import { describe, expect, it } from "bun:test";
import { Vertical } from "@/generated/prisma/enums";
import { FOUNDING_PLAN_ID, FOUNDING_PRICE } from "@/lib/billing-plans";
import {
  CLAIM_CHECKOUT_PLAN_ID,
  claimPageState,
  foundingOfferDisplay,
  resolveClaimLaunchOffer,
  resolveClaimLaunchOfferForVertical,
} from "@/lib/claim-launch-offer";
import { sampleSiteDraft } from "@/lib/restaurant";
import { sampleFoodRetailDraft } from "@/lib/verticals/food-retail/fixtures";
import { foodRetailMarketing } from "@/lib/verticals/food-retail/marketing";
import { sampleLocalServiceSiteDraft } from "@/lib/verticals/local-service/fixtures";
import { localServiceMarketing } from "@/lib/verticals/local-service/marketing";
import { beautyMarketing } from "@/lib/verticals/beauty/marketing";
import { restaurantMarketing } from "@/lib/verticals/restaurant/marketing";
import type { VerticalMarketing } from "@/lib/verticals/types";

const claimPanel = await Bun.file(
  new URL("../app/claim/[slug]/claim-panel.tsx", import.meta.url),
).text();
const claimPage = await Bun.file(
  new URL("../app/claim/[slug]/page.tsx", import.meta.url),
).text();
const checkoutRoute = await Bun.file(
  new URL("../app/api/checkout/route.ts", import.meta.url),
).text();

describe("claim launch offer mapping", () => {
  it("prints the founding Stripe contract as the shared display price", () => {
    expect(CLAIM_CHECKOUT_PLAN_ID).toBe(FOUNDING_PLAN_ID);
    expect(FOUNDING_PRICE).toMatchObject({
      currency: "usd",
      unitAmount: 4_900,
      interval: "month",
      intervalCount: 1,
    });
    expect(foundingOfferDisplay()).toEqual({
      price: "$49",
      cadence: "/month",
      currency: "usd",
    });
  });

  it("resolves restaurant, food-retail, and local-service from their own marketing", () => {
    const display = foundingOfferDisplay();
    expect(display).not.toBeNull();

    const restaurant = resolveClaimLaunchOffer(restaurantMarketing);
    const foodRetail = resolveClaimLaunchOffer(foodRetailMarketing);
    const localService = resolveClaimLaunchOffer(localServiceMarketing);

    expect(restaurant).toMatchObject({
      planId: CLAIM_CHECKOUT_PLAN_ID,
      name: "Founding",
      price: display!.price,
      cadence: display!.cadence,
      currency: display!.currency,
      emailPlaceholder: "owner@restaurant.com",
      copy: restaurantMarketing.pricing.plans[0].copy,
      features: restaurantMarketing.pricing.plans[0].features,
    });
    expect(foodRetail).toMatchObject({
      planId: CLAIM_CHECKOUT_PLAN_ID,
      name: "Founding",
      price: display!.price,
      cadence: display!.cadence,
      emailPlaceholder: "owner@shop.com",
      copy: foodRetailMarketing.pricing.plans[0].copy,
      features: foodRetailMarketing.pricing.plans[0].features,
    });
    expect(localService).toMatchObject({
      planId: CLAIM_CHECKOUT_PLAN_ID,
      name: "Founding",
      price: display!.price,
      cadence: display!.cadence,
      emailPlaceholder: "owner@business.com",
      copy: localServiceMarketing.pricing.plans[0].copy,
      features: localServiceMarketing.pricing.plans[0].features,
    });

    expect(foodRetail?.copy).not.toBe(restaurant?.copy);
    expect(localService?.copy).not.toBe(restaurant?.copy);
    expect(foodRetail?.features).not.toEqual(restaurant?.features);
    expect(localService?.features).not.toEqual(restaurant?.features);
    expect(resolveClaimLaunchOfferForVertical(Vertical.RESTAURANT)).toEqual(
      restaurant,
    );
    expect(resolveClaimLaunchOfferForVertical(Vertical.FOOD_RETAIL)).toEqual(
      foodRetail,
    );
    expect(resolveClaimLaunchOfferForVertical(Vertical.LOCAL_SERVICE)).toEqual(
      localService,
    );
  });

  it("fails closed instead of borrowing another vertical's plan", () => {
    expect(resolveClaimLaunchOffer(wrongPriceMarketing())).toBeNull();
    expect(resolveClaimLaunchOffer(unnamedPlanMarketing())).toBeNull();
    expect(resolveClaimLaunchOffer(blankEmailMarketing())).toBeNull();
    expect(resolveClaimLaunchOffer(beautyMarketing)).toBeNull();
    expect(
      resolveClaimLaunchOffer(wrongPriceMarketing(restaurantMarketing)),
    ).toBeNull();
  });

  it("keeps the claim UI and checkout on the same mapping", async () => {
    expect(claimPanel).not.toContain("restaurantMarketing");
    expect(claimPanel).not.toContain("owner@restaurant.com");
    expect(claimPanel).toContain("plan: offer.planId");
    expect(claimPanel).toContain("offer.emailPlaceholder");
    expect(claimPanel).toContain('role="alert"');
    expect(claimPanel).toContain('role="status"');
    expect(claimPanel).toContain('id={errorSummaryId}');
    expect(claimPanel).toContain("<form onSubmit={submit}");
    expect(claimPanel).toContain('type="submit"');
    expect(claimPage).toContain("claimPageState");
    expect(claimPage).toContain("offer={state.offer}");
    expect(checkoutRoute).toContain("resolveClaimLaunchOfferForVertical");
    expect(checkoutRoute).toContain("offer.planId !== plan");
    expect(checkoutRoute).toContain("isVerticalClaimEnabled(invitation.vertical)");
  });
});

describe("claim page route state", () => {
  it("brands restaurant, food-retail, and local-service from their verticals", () => {
    const restaurant = claimPageState({
      vertical: Vertical.RESTAURANT,
      draft: sampleSiteDraft,
    });
    const foodRetail = claimPageState({
      vertical: Vertical.FOOD_RETAIL,
      draft: sampleFoodRetailDraft,
    });
    const localService = claimPageState({
      vertical: Vertical.LOCAL_SERVICE,
      draft: sampleLocalServiceSiteDraft,
    });

    expect(restaurant).toMatchObject({
      kind: "ready",
      brand: { name: "Restofrontapp" },
      offer: resolveClaimLaunchOffer(restaurantMarketing),
      vertical: Vertical.RESTAURANT,
    });
    expect(foodRetail).toMatchObject({
      kind: "ready",
      brand: { name: "Shopfront Food" },
      offer: resolveClaimLaunchOffer(foodRetailMarketing),
      vertical: Vertical.FOOD_RETAIL,
    });
    expect(localService).toMatchObject({
      kind: "ready",
      brand: { name: "Tradefront" },
      offer: resolveClaimLaunchOffer(localServiceMarketing),
      vertical: Vertical.LOCAL_SERVICE,
    });
    expect(foodRetail.kind === "ready" && foodRetail.offer?.emailPlaceholder).toBe(
      "owner@shop.com",
    );
    expect(
      localService.kind === "ready" && localService.offer?.emailPlaceholder,
    ).toBe("owner@business.com");
  });

  it("404s disabled verticals and missing sites without borrowing a plan", () => {
    expect(claimPageState(null)).toEqual({ kind: "not_found" });
    expect(
      claimPageState({
        vertical: Vertical.BEAUTY,
        draft: sampleSiteDraft,
      }),
    ).toEqual({ kind: "not_found" });
  });
});

function requirePricing(
  marketing: VerticalMarketing,
): NonNullable<VerticalMarketing["pricing"]> {
  if (!marketing.pricing) {
    throw new Error("fixture marketing must declare a founding offer");
  }
  return marketing.pricing;
}

function wrongPriceMarketing(
  base: VerticalMarketing = foodRetailMarketing,
): VerticalMarketing {
  const pricing = requirePricing(base);
  const [plan] = pricing.plans;
  return {
    ...base,
    pricing: {
      ...pricing,
      plans: [{ ...plan, price: "$25" }],
    },
  };
}

function unnamedPlanMarketing(): VerticalMarketing {
  const pricing = requirePricing(localServiceMarketing);
  const [plan] = pricing.plans;
  return {
    ...localServiceMarketing,
    pricing: {
      ...pricing,
      plans: [{ ...plan, name: "Starter" }],
    },
  };
}

function blankEmailMarketing(): VerticalMarketing {
  return {
    ...foodRetailMarketing,
    signIn: {
      ...foodRetailMarketing.signIn,
      emailPlaceholder: "   ",
    },
  };
}
