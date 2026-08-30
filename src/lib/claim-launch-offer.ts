import {
  FOUNDING_PLAN_ID,
  FOUNDING_PRICE,
  FOUNDING_PRICE_SYMBOL,
  type BillingPlanId,
} from "@/lib/billing-plans";
import type { BrandIdentity } from "@/lib/brand";
import type { SiteDraftView } from "@/lib/site-draft";
import {
  isVerticalClaimEnabled,
  resolveVerticalConfig,
} from "@/lib/verticals/registry";
import type {
  MarketingPlan,
  VerticalId,
  VerticalMarketing,
} from "@/lib/verticals/types";

/**
 * Checkout's plan literal and the claim UI's displayed founding offer must
 * resolve from this mapping. A vertical may print its own copy and features,
 * but never a different price, cadence, or plan id than the Stripe contract.
 */
export const CLAIM_CHECKOUT_PLAN_ID = FOUNDING_PLAN_ID;

export type FoundingOfferDisplay = {
  price: string;
  cadence: string;
  currency: typeof FOUNDING_PRICE.currency;
};

export type ClaimLaunchOffer = {
  planId: BillingPlanId;
  name: string;
  price: string;
  cadence: string;
  currency: typeof FOUNDING_PRICE.currency;
  copy: string;
  features: string[];
  badge: string | null;
  emailPlaceholder: string;
};

export type ClaimCheckoutReturn = {
  sessionId: string;
  claimInvitationId: string;
};

export type ClaimPanelProps = {
  slug: string;
  vertical: VerticalId;
  fallbackDraft: SiteDraftView;
  checkoutReturn: ClaimCheckoutReturn | null;
  offer: ClaimLaunchOffer | null;
};

export type ClaimPageSite = {
  vertical: VerticalId;
  draft: SiteDraftView;
};

export type ClaimPageState =
  | { kind: "not_found" }
  | {
      kind: "ready";
      brand: BrandIdentity;
      offer: ClaimLaunchOffer | null;
      vertical: VerticalId;
      draft: SiteDraftView;
    };

export function foundingOfferDisplay(
  price: {
    currency: string;
    unitAmount: number;
    interval: string;
    intervalCount: number;
  } = FOUNDING_PRICE,
): FoundingOfferDisplay | null {
  if (price.currency !== FOUNDING_PRICE.currency) return null;
  if (price.intervalCount !== 1) return null;
  const majorUnits = price.unitAmount / 100;
  if (!Number.isInteger(majorUnits) || majorUnits <= 0) return null;
  return {
    price: `${FOUNDING_PRICE_SYMBOL}${majorUnits}`,
    cadence: `/${price.interval}`,
    currency: FOUNDING_PRICE.currency,
  };
}

export function resolveClaimLaunchOffer(
  marketing: VerticalMarketing,
): ClaimLaunchOffer | null {
  const display = foundingOfferDisplay();
  const pricing = marketing.pricing;
  const emailPlaceholder = marketing.signIn.emailPlaceholder.trim();
  if (!display || !pricing || emailPlaceholder.length === 0) return null;

  const matches = pricing.plans.filter((plan) =>
    isValidFoundingPlan(plan, display),
  );
  const plan = matches.length === 1 ? matches[0] : undefined;
  if (!plan) return null;

  return {
    planId: CLAIM_CHECKOUT_PLAN_ID,
    name: plan.name,
    price: plan.price,
    cadence: plan.cadence,
    currency: display.currency,
    copy: plan.copy,
    features: [...plan.features],
    badge: plan.badge ?? null,
    emailPlaceholder,
  };
}

export function resolveClaimLaunchOfferForVertical(
  id: VerticalId,
): ClaimLaunchOffer | null {
  return resolveClaimLaunchOffer(resolveVerticalConfig(id).marketing);
}

export function claimPageState(site: ClaimPageSite | null): ClaimPageState {
  if (!site || !isVerticalClaimEnabled(site.vertical)) {
    return { kind: "not_found" };
  }
  const config = resolveVerticalConfig(site.vertical);
  return {
    kind: "ready",
    brand: config.marketing.brand,
    offer: resolveClaimLaunchOffer(config.marketing),
    vertical: site.vertical,
    draft: site.draft,
  };
}

function isValidFoundingPlan(
  plan: MarketingPlan,
  display: FoundingOfferDisplay,
): boolean {
  return (
    plan.name.trim().toLowerCase() === CLAIM_CHECKOUT_PLAN_ID &&
    plan.featured === true &&
    plan.price === display.price &&
    plan.cadence === display.cadence &&
    plan.copy.trim().length > 0 &&
    plan.features.length > 0
  );
}
