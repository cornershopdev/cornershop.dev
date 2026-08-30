export const FOUNDING_PLAN_ID = "founding" as const;

export type BillingPlanId = typeof FOUNDING_PLAN_ID;

type BillingEnvironment = Record<string, string | undefined>;

export type BillingPlan = {
  id: BillingPlanId;
  priceId: string;
};

export const FOUNDING_PRICE = {
  currency: "eur",
  unitAmount: 4_900,
  interval: "month",
  intervalCount: 1,
  taxBehavior: "exclusive",
} as const;

/**
 * Kept beside the price it renders. The offer is sold in euros to European
 * businesses, so the amount and the symbol in front of it are one decision:
 * changing the currency without the symbol prints the wrong money.
 */
export const FOUNDING_PRICE_SYMBOL = "€";

export type StripePriceConfiguration = {
  id: string;
  active: boolean;
  currency: string;
  unit_amount: number | null;
  type: string;
  livemode: boolean;
  tax_behavior?: string | null;
  recurring: {
    interval: string;
    interval_count: number;
    usage_type?: string;
  } | null;
  product: string | { active?: boolean; deleted?: boolean | void };
};

export class BillingConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingConfigurationError";
  }
}

export function configuredBillingPlan(
  env: BillingEnvironment = process.env,
): BillingPlan {
  return {
    id: FOUNDING_PLAN_ID,
    priceId: validatePriceId(env.STRIPE_PRICE_ID, "STRIPE_PRICE_ID"),
  };
}

export function billingPlanForPrice(
  priceId: string,
  plan = configuredBillingPlan(),
): BillingPlan | null {
  return plan.priceId === priceId ? plan : null;
}

export function configuredBillingPriceId(
  env: BillingEnvironment = process.env,
): string {
  return configuredBillingPlan(env).priceId;
}

/**
 * Stripe IDs alone do not prove the offer. This validates the expanded live
 * resource immediately before Checkout and in the operator preflight so a
 * wrong mode, amount, cadence, tax treatment, or archived Product fails closed.
 */
export function validateFoundingPrice(
  price: StripePriceConfiguration,
  input: { expectedPriceId: string; expectedLivemode: boolean },
): void {
  const productActive =
    typeof price.product !== "string" &&
    price.product.active === true &&
    price.product.deleted !== true;
  const recurring = price.recurring;
  const valid =
    price.id === input.expectedPriceId &&
    price.livemode === input.expectedLivemode &&
    price.active &&
    price.type === "recurring" &&
    price.currency.toLowerCase() === FOUNDING_PRICE.currency &&
    price.unit_amount === FOUNDING_PRICE.unitAmount &&
    price.tax_behavior === FOUNDING_PRICE.taxBehavior &&
    recurring?.interval === FOUNDING_PRICE.interval &&
    recurring.interval_count === FOUNDING_PRICE.intervalCount &&
    recurring.usage_type !== "metered" &&
    productActive;
  if (!valid) {
    throw new BillingConfigurationError(
      "The Cornershopdev founding Stripe price does not match the approved offer",
    );
  }
}

const STRIPE_LIVE_KEY_PREFIXES = ["sk_live_", "rk_live_"] as const;
const STRIPE_TEST_KEY_PREFIXES = ["sk_test_", "rk_test_"] as const;

export function isStripeLiveApiKey(secret: string | undefined): boolean {
  return STRIPE_LIVE_KEY_PREFIXES.some((prefix) => secret?.startsWith(prefix));
}

export function isStripeTestApiKey(secret: string | undefined): boolean {
  return STRIPE_TEST_KEY_PREFIXES.some((prefix) => secret?.startsWith(prefix));
}

export function stripeLivemodeForSecret(secret: string | undefined): boolean {
  if (isStripeLiveApiKey(secret)) return true;
  if (isStripeTestApiKey(secret)) return false;
  throw new BillingConfigurationError("STRIPE_SECRET_KEY is not configured");
}

function validatePriceId(value: string | undefined, variable: string): string {
  if (!value?.startsWith("price_") || value.length < 8) {
    throw new BillingConfigurationError(`${variable} is not configured`);
  }
  return value;
}
