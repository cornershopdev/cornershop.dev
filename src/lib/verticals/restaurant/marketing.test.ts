import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { Vertical } from "@/generated/prisma/enums";
import { foundingOfferDisplay } from "@/lib/claim-launch-offer";
import { foodRetailMarketing } from "@/lib/verticals/food-retail/marketing";
import { localServiceMarketing } from "@/lib/verticals/local-service/marketing";
import { restaurantMarketing } from "@/lib/verticals/restaurant/marketing";
import {
  isVerticalClaimEnabled,
  listVerticalIds,
  resolveVerticalConfig,
} from "@/lib/verticals/registry";

/**
 * GTM audit + first-customer runbook: launch is one €49/month founding plan.
 * Headlining $25/$50 or generated food imagery as a paid extra is the
 * regression these assertions exist to catch.
 */
describe("Restofront founding offer", () => {
  it("sells only one €49/month founding plan", () => {
    expect(restaurantMarketing.hero.proofPoints).toContain("€49/month");
    expect(restaurantMarketing.hero.proofPoints.join(" ")).not.toContain("$25");

    expect(restaurantMarketing.pricing.plans).toHaveLength(1);
    const [plan] = restaurantMarketing.pricing.plans;
    expect(plan).toMatchObject({
      name: "Founding",
      price: "€49",
      cadence: "/month",
      featured: true,
    });
    expect(plan.features.join(" ")).not.toMatch(/AI-assisted|generated food/i);
    expect(
      plan.features.some((feature) => /booking|ordering/.test(feature)),
    ).toBe(true);
  });

  it("does not advertise generated food imagery as a paid differentiator", () => {
    const blob = JSON.stringify(restaurantMarketing);
    expect(blob).not.toMatch(/AI-assisted food imagery/i);
    expect(blob).not.toMatch(/generate missing editorial/i);
    expect(blob).not.toMatch(/complementary editorial images/i);
    expect(restaurantMarketing.imagery.copy.toLowerCase()).toMatch(
      /existing photography|source/,
    );
  });

  it("shares one founding price on claim-enabled verticals while keeping feature lists scoped", () => {
    const claimEnabledMarketing = listVerticalIds()
      .filter(isVerticalClaimEnabled)
      .map((id) => resolveVerticalConfig(id).marketing);

    expect(claimEnabledMarketing.map((marketing) => marketing.brand.name)).toEqual(
      expect.arrayContaining([
        restaurantMarketing.brand.name,
        foodRetailMarketing.brand.name,
        localServiceMarketing.brand.name,
      ]),
    );
    expect(isVerticalClaimEnabled(Vertical.BEAUTY)).toBe(false);

    for (const marketing of claimEnabledMarketing) {
      expect(marketing.pricing?.plans).toHaveLength(1);
      expect(marketing.pricing?.plans[0]?.price).toBe(foundingOfferDisplay()?.price);
      expect(marketing.pricing?.copy).toContain("Local currency");
    }
    expect(foodRetailMarketing.pricing.plans[0]?.features).not.toEqual(
      restaurantMarketing.pricing.plans[0]?.features,
    );
  });

  it("checks out the founding plan against the single STRIPE_PRICE_ID", async () => {
    const [panel, mapping, checkoutRoute] = await Promise.all([
      readFile(
        new URL("../../../app/claim/[slug]/claim-panel.tsx", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../../claim-launch-offer.ts", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../../../app/api/checkout/route.ts", import.meta.url),
        "utf8",
      ),
    ]);
    expect(mapping).toContain("CLAIM_CHECKOUT_PLAN_ID = FOUNDING_PLAN_ID");
    expect(mapping).toContain("foundingOfferDisplay");
    expect(panel).toContain("plan: offer.planId");
    expect(panel).not.toContain("restaurantMarketing");
    expect(panel).not.toContain("price: 25");
    expect(panel).not.toContain("price: 50");
    expect(panel).not.toContain("$25");
    expect(checkoutRoute).toContain("adaptive_pricing: { enabled: true }");
    expect(checkoutRoute).toContain("resolveClaimLaunchOfferForVertical");
  });
});
