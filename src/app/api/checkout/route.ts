import { cookies } from "next/headers";
import { z } from "zod";
import {
  configuredBillingPlan,
  FOUNDING_PLAN_ID,
  stripeLivemodeForSecret,
  validateFoundingPrice,
} from "@/lib/billing-plans";
import { alertCheckoutStartFailure } from "@/lib/billing-operator-alerts";
import {
  checkoutSessionAction,
  isReusableFoundingCheckout,
} from "@/lib/checkout-session-policy";
import {
  authorizeClaimInvitationForCheckout,
  bindClaimInvitationToCheckout,
  buildClaimCheckoutIdempotencyKey,
  ClaimFlowError,
  MIN_CLAIM_CHECKOUT_TTL_MS,
  type CheckoutClaimInvitation,
  recordClaimRejection,
} from "@/lib/claim-invitations";
import {
  CHECKOUT_RETURN_COOKIE,
  createCheckoutReturnToken,
} from "@/lib/claim-security";
import { limitClaimCheckout } from "@/lib/rate-limit";
import { isSameOriginMutation } from "@/lib/request-origin";
import { getStripe } from "@/lib/stripe";
import { secureCookieRequired } from "@/lib/first-customer-test-mode";
import { resolveClaimLaunchOfferForVertical } from "@/lib/claim-launch-offer";
import { isVerticalClaimEnabled } from "@/lib/verticals/registry";

const requestSchema = z.object({
  plan: z.literal(FOUNDING_PLAN_ID),
  siteSlug: z.string().trim().min(2).max(80),
  invitationToken: z
    .string()
    .min(32)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/),
});

export async function POST(request: Request) {
  const rateLimit = await limitClaimCheckout(request);
  if (!rateLimit.success) {
    return Response.json(
      {
        error:
          rateLimit.reason === "unavailable"
            ? "Claim checkout is temporarily unavailable."
            : "Too many claim attempts. Try again later.",
      },
      { status: rateLimit.reason === "unavailable" ? 503 : 429 },
    );
  }
  if (!isSameOriginMutation(request)) {
    return Response.json(
      { error: "Cross-site checkout requests are not allowed." },
      { status: 403 },
    );
  }

  let siteSlug = "unknown";
  try {
    const input = requestSchema.parse(await request.json());
    const { plan, invitationToken } = input;
    siteSlug = input.siteSlug;
    if (!process.env.DATABASE_URL) {
      return Response.json(
        { error: "Claim checkout is temporarily unavailable." },
        { status: 503 },
      );
    }

    const priceId = configuredBillingPlan().priceId;
    const invitation = await authorizeClaimInvitationForCheckout({
      siteSlug,
      token: invitationToken,
    });
    if (!isVerticalClaimEnabled(invitation.vertical)) {
      throw new ClaimFlowError(
        "not_claimable",
        409,
        "This site already has an owner or is not available to claim.",
        invitation.id,
      );
    }
    const offer = resolveClaimLaunchOfferForVertical(invitation.vertical);
    if (!offer || offer.planId !== plan) {
      return Response.json(
        { error: "Claim checkout is temporarily unavailable." },
        { status: 503 },
      );
    }
    const stripe = getStripe();
    const price = await stripe.prices.retrieve(priceId, {
      expand: ["product"],
    });
    validateFoundingPrice(price, {
      expectedPriceId: priceId,
      expectedLivemode: stripeLivemodeForSecret(process.env.STRIPE_SECRET_KEY),
    });

    if (invitation.checkoutSessionId) {
      const existing = await stripe.checkout.sessions.retrieve(
        invitation.checkoutSessionId,
      );
      let action = checkoutSessionAction(
        {
          status: existing.status,
          url: existing.url,
          priceId: invitation.stripePriceId,
        },
        priceId,
      );
      if (
        action === "reuse" &&
        !isReusableFoundingCheckout({
          allowPromotionCodes: existing.allow_promotion_codes,
          automaticTaxEnabled: existing.automatic_tax.enabled,
          billingAddressCollection: existing.billing_address_collection,
          taxIdCollectionEnabled: existing.tax_id_collection?.enabled === true,
        })
      ) {
        action = "expire_and_replace";
      }
      if (action === "reuse" && existing.url) {
        return bindReturnCredential(
          invitation,
          existing.id,
          existing.url,
          priceId,
          invitation.checkoutAttempt + 1,
        );
      }
      if (action === "await_provisioning") {
        return Response.json(
          { error: "Payment is complete and the account is being finalized" },
          { status: 409 },
        );
      }
      if (
        invitation.expiresAt.getTime() - Date.now() <
        MIN_CLAIM_CHECKOUT_TTL_MS
      ) {
        throw new ClaimFlowError(
          "invalid_invitation",
          403,
          "This ownership link is near expiry. Continue the existing checkout or request a new email after it expires.",
        );
      }
      if (action === "expire_and_replace") {
        try {
          await stripe.checkout.sessions.expire(existing.id);
        } catch (error) {
          const refreshed = await stripe.checkout.sessions.retrieve(
            existing.id,
          );
          if (refreshed.status !== "expired") throw error;
        }
      }
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!appUrl) throw new Error("NEXT_PUBLIC_APP_URL is not configured");
    const nextAttempt = invitation.checkoutAttempt + 1;
    const checkoutExpiresAt = Math.min(
      Math.floor(Date.now() / 1000) + 24 * 60 * 60,
      Math.floor(invitation.expiresAt.getTime() / 1000),
    );
    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        adaptive_pricing: { enabled: true },
        expires_at: checkoutExpiresAt,
        line_items: [{ price: priceId, quantity: 1 }],
        allow_promotion_codes: false,
        automatic_tax: { enabled: true },
        billing_address_collection: "required",
        tax_id_collection: { enabled: true },
        customer_email: invitation.email,
        client_reference_id: invitation.id,
        metadata: {
          claimInvitationId: invitation.id,
          siteSlug,
          plan,
        },
        subscription_data: {
          metadata: {
            claimInvitationId: invitation.id,
            siteSlug,
            plan,
          },
        },
        success_url:
          `${appUrl}/api/auth/checkout?session_id={CHECKOUT_SESSION_ID}` +
          `&claim_id=${encodeURIComponent(invitation.id)}`,
        cancel_url: `${appUrl}/claim/${encodeURIComponent(siteSlug)}?checkout=canceled`,
      },
      {
        idempotencyKey: buildClaimCheckoutIdempotencyKey({
          invitationId: invitation.id,
          plan,
          previousSessionId: invitation.checkoutSessionId,
          expiresAt: checkoutExpiresAt,
        }),
      },
    );
    if (!session.url) throw new Error("Stripe Checkout returned no URL");

    return bindReturnCredential(
      invitation,
      session.id,
      session.url,
      priceId,
      nextAttempt,
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: error.issues[0]?.message ?? "Check your details and retry" },
        { status: 400 },
      );
    }
    if (error instanceof ClaimFlowError) {
      await recordClaimRejection({
        siteSlug,
        reason: error.code,
        actor: "claimant:checkout",
        invitationId: error.invitationId,
      });
      return Response.json({ error: error.message }, { status: error.status });
    }

    console.error("[checkout] failed", {
      siteSlug,
      error: error instanceof Error ? error.message : "unknown",
    });
    await alertCheckoutStartFailure(siteSlug);
    return Response.json(
      { error: "Checkout could not start. Try again in a moment." },
      { status: 500 },
    );
  }
}

async function bindReturnCredential(
  invitation: CheckoutClaimInvitation,
  sessionId: string,
  sessionUrl: string,
  priceId: string,
  checkoutAttempt: number,
): Promise<Response> {
  const returnToken = createCheckoutReturnToken();
  const returnExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
  let binding;
  try {
    binding = await bindClaimInvitationToCheckout({
      invitation,
      stripeCheckoutSessionId: sessionId,
      stripePriceId: priceId,
      checkoutAttempt,
      checkoutReturnTokenHash: returnToken.tokenHash,
      checkoutReturnExpiresAt: returnExpiresAt,
    });
  } catch (error) {
    if (sessionId !== invitation.checkoutSessionId) {
      await expireUnboundCheckout(sessionId);
    }
    throw error;
  }
  if (!binding.didBind) {
    if (binding.checkoutSessionId !== sessionId) {
      await expireUnboundCheckout(sessionId);
    }
    throw new ClaimFlowError(
      "invitation_used",
      409,
      "Another checkout replaced this one. Reopen the ownership email and try again.",
    );
  }

  const cookieStore = await cookies();
  cookieStore.set(CHECKOUT_RETURN_COOKIE, returnToken.token, {
    httpOnly: true,
    secure: secureCookieRequired(),
    sameSite: "lax",
    maxAge: 30 * 60,
    path: "/",
  });
  return Response.json({ url: sessionUrl });
}

async function expireUnboundCheckout(sessionId: string): Promise<void> {
  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.status === "open") {
      await stripe.checkout.sessions.expire(session.id);
    }
  } catch (error) {
    console.error("[checkout] failed to expire unbound session", {
      stripeCheckoutSessionId: sessionId,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}
