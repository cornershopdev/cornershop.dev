import { describe, expect, it } from "bun:test";
import {
  billingPlanForPrice,
  BillingConfigurationError,
  configuredBillingPlan,
  configuredBillingPriceId,
  stripeLivemodeForSecret,
  validateFoundingPrice,
} from "@/lib/billing-plans";

const configured = { STRIPE_PRICE_ID: "price_founding" };

describe("configuredBillingPlan", () => {
  it("creates one server-owned founding plan", () => {
    const plan = configuredBillingPlan(configured);
    expect(plan).toEqual({ id: "founding", priceId: "price_founding" });
    expect(billingPlanForPrice("price_founding", plan)?.id).toBe("founding");
    expect(billingPlanForPrice("price_attacker", plan)).toBeNull();
    expect(configuredBillingPriceId(configured)).toBe("price_founding");
  });

  it("fails closed when the one price is missing", () => {
    expect(() => configuredBillingPlan({})).toThrow(BillingConfigurationError);
  });
});

describe("Cornershopdev founding Stripe price", () => {
  const price = {
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
    product: { active: true },
  };

  it("accepts only the approved live EUR 49 monthly exclusive-tax offer", () => {
    expect(() =>
      validateFoundingPrice(price, {
        expectedPriceId: "price_founding",
        expectedLivemode: true,
      }),
    ).not.toThrow();
  });

  it("rejects wrong amount, currency, mode, cadence, tax, or archived product", () => {
    for (const candidate of [
      { ...price, unit_amount: 4_999 },
      { ...price, currency: "usd" },
      { ...price, livemode: false },
      { ...price, recurring: { ...price.recurring, interval: "year" } },
      { ...price, tax_behavior: "inclusive" },
      { ...price, product: { active: false } },
      { ...price, product: "prod_unexpanded" },
    ]) {
      expect(() =>
        validateFoundingPrice(candidate, {
          expectedPriceId: "price_founding",
          expectedLivemode: true,
        }),
      ).toThrow(BillingConfigurationError);
    }
  });

  it("derives expected mode from standard and restricted Stripe API keys", () => {
    expect(stripeLivemodeForSecret("sk_live_example")).toBe(true);
    expect(stripeLivemodeForSecret("rk_live_example")).toBe(true);
    expect(stripeLivemodeForSecret("sk_test_example")).toBe(false);
    expect(stripeLivemodeForSecret("rk_test_example")).toBe(false);
    expect(() => stripeLivemodeForSecret("pk_live_example")).toThrow(
      BillingConfigurationError,
    );
  });
});
