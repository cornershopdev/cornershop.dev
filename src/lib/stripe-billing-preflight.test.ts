import { describe, expect, it } from "bun:test";
import type Stripe from "stripe";
import { preflightFoundingBilling } from "@/lib/stripe-billing-preflight";

const environment = {
  STRIPE_SECRET_KEY: "sk_live_example",
  STRIPE_WEBHOOK_SECRET: "whsec_example",
  STRIPE_PRICE_ID: "price_founding",
};

function stripePrice(
  overrides: Record<string, unknown> = {},
): Pick<Stripe, "prices"> {
  return {
    prices: {
      retrieve: async () =>
        ({
          id: "price_founding",
          active: true,
          currency: "eur",
          unit_amount: 4_900,
          type: "recurring",
          livemode: true,
          tax_behavior: "exclusive",
          recurring: {
            interval: "month",
            interval_count: 1,
            usage_type: "licensed",
          },
          product: { id: "prod_1", active: true },
          ...overrides,
        }) as Stripe.Price,
    } as unknown as Stripe["prices"],
  };
}

describe("Stripe billing preflight", () => {
  it("returns redacted evidence for the exact live founding offer", async () => {
    const result = await preflightFoundingBilling({
      stripe: stripePrice(),
      environment,
      requiredMode: "live",
    });

    expect(result).toMatchObject({
      ready: true,
      mode: "live",
      amount: 4_900,
      currency: "eur",
      interval: "month",
      taxBehavior: "exclusive",
    });
    expect(result.priceFingerprint).toHaveLength(64);
    expect(JSON.stringify(result)).not.toContain("price_founding");
  });

  it("fails closed for mode and provider-resource drift", async () => {
    await expect(
      preflightFoundingBilling({
        stripe: stripePrice(),
        environment,
        requiredMode: "test",
      }),
    ).rejects.toThrow("mode");
    await expect(
      preflightFoundingBilling({
        stripe: stripePrice({ unit_amount: 2_500 }),
        environment,
        requiredMode: "live",
      }),
    ).rejects.toThrow("approved offer");
  });
});
