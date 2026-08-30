import Stripe from "stripe";
import {
  assertFirstCustomerTestModeSafety,
  firstCustomerTestModeEnabled,
} from "@/lib/first-customer-test-mode";

let stripe: Stripe | undefined;

export function getStripe(): Stripe {
  if (stripe) return stripe;

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }

  assertFirstCustomerTestModeSafety();
  const providerUrl = firstCustomerTestModeEnabled()
    ? new URL(process.env.STRIPE_API_BASE_URL!)
    : null;
  stripe = new Stripe(secretKey, {
    apiVersion: "2026-08-26.dahlia",
    typescript: true,
    ...(providerUrl
      ? {
          protocol: providerUrl.protocol === "https:" ? "https" : "http",
          host: providerUrl.hostname,
          port: providerUrl.port,
        }
      : {}),
  });
  return stripe;
}
