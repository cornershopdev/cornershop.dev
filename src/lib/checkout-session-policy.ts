export type BoundCheckoutSession = {
  status: string | null;
  url: string | null;
  priceId: string | null;
};

export type CheckoutSessionAction =
  | "create"
  | "reuse"
  | "expire_and_replace"
  | "replace"
  | "await_provisioning";

export type FoundingCheckoutConfiguration = {
  allowPromotionCodes: boolean | null;
  automaticTaxEnabled: boolean;
  billingAddressCollection: string | null;
  taxIdCollectionEnabled: boolean;
};

export function isReusableFoundingCheckout(
  configuration: FoundingCheckoutConfiguration,
): boolean {
  return (
    configuration.allowPromotionCodes === false &&
    configuration.automaticTaxEnabled &&
    configuration.billingAddressCollection === "required" &&
    configuration.taxIdCollectionEnabled
  );
}

export function checkoutSessionAction(
  session: BoundCheckoutSession | null,
  requestedPriceId: string,
): CheckoutSessionAction {
  if (!session) return "create";
  if (session.status === "complete") return "await_provisioning";
  if (session.status === "expired") return "replace";
  if (session.status !== "open") return "replace";
  if (!session.url) return "expire_and_replace";
  if (session.priceId === requestedPriceId) return "reuse";
  return "expire_and_replace";
}
