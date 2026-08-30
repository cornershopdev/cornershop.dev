import { createHmac } from "node:crypto";

const port = 4100;
const appOrigin = "http://127.0.0.1:3100";
const webhookSecret = "whsec_first_customer_e2e";
const priceId = "price_founding_e2e";
const ownerEmail = "owner@restaurant.example.test";
const messages: Array<Record<string, unknown>> = [];
const sessions = new Map<string, Record<string, unknown>>();
let counter = 0;

Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/_health") return Response.json({ ok: true });
    if (url.pathname === "/_mailbox/latest") {
      const to = url.searchParams.get("to");
      const message = [...messages]
        .reverse()
        .find((item) => item.to === to);
      return message
        ? Response.json(message)
        : Response.json({ error: "not_found" }, { status: 404 });
    }
    if (url.pathname === "/emails" && request.method === "POST") {
      const message = (await request.json()) as Record<string, unknown>;
      const id = `email_first_customer_${++counter}`;
      messages.push({ ...message, id });
      return Response.json({ id });
    }
    if (url.pathname === `/v1/prices/${priceId}`) {
      return stripeJson({
        id: priceId,
        object: "price",
        active: true,
        livemode: false,
        currency: "eur",
        unit_amount: 4_900,
        type: "recurring",
        tax_behavior: "exclusive",
        recurring: {
          interval: "month",
          interval_count: 1,
          usage_type: "licensed",
        },
        product: {
          id: "prod_first_customer_e2e",
          object: "product",
          active: true,
          livemode: false,
        },
      });
    }
    if (url.pathname === "/v1/checkout/sessions" && request.method === "POST") {
      const form = new URLSearchParams(await request.text());
      if (form.get("adaptive_pricing[enabled]") !== "true") {
        return stripeJson({ error: { message: "adaptive_pricing_required" } }, 400);
      }
      const id = `cs_test_first_customer_${++counter}`;
      const invitationId = form.get("client_reference_id")!;
      const siteSlug = form.get("metadata[siteSlug]")!;
      const successUrl = form.get("success_url")!;
      const subscription = subscriptionFixture(id);
      const session = {
        id,
        object: "checkout.session",
        livemode: false,
        mode: "subscription",
        status: "open",
        payment_status: "unpaid",
        currency: "eur",
        amount_subtotal: 4_900,
        adaptive_pricing: { enabled: true },
        presentment_details: {
          presentment_amount: 5_300,
          presentment_currency: "usd",
        },
        allow_promotion_codes: false,
        automatic_tax: { enabled: true },
        billing_address_collection: "required",
        tax_id_collection: { enabled: true },
        total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 },
        client_reference_id: invitationId,
        customer_email: ownerEmail,
        customer_details: { email: ownerEmail },
        metadata: { claimInvitationId: invitationId, siteSlug, plan: "founding" },
        subscription,
        success_url: successUrl,
        url: `http://127.0.0.1:${port}/checkout/${id}`,
      };
      sessions.set(id, session);
      return stripeJson(session);
    }
    const checkoutMatch = url.pathname.match(/^\/v1\/checkout\/sessions\/([^/]+)$/);
    if (checkoutMatch) {
      const session = sessions.get(checkoutMatch[1]!);
      if (!session) return stripeJson({ error: { message: "missing" } }, 404);
      if (request.method === "GET") return stripeJson(session);
    }
    const expireMatch = url.pathname.match(
      /^\/v1\/checkout\/sessions\/([^/]+)\/expire$/,
    );
    if (expireMatch && request.method === "POST") {
      const session = sessions.get(expireMatch[1]!);
      if (!session) return stripeJson({ error: { message: "missing" } }, 404);
      session.status = "expired";
      return stripeJson(session);
    }
    const subscriptionMatch = url.pathname.match(/^\/v1\/subscriptions\/([^/]+)$/);
    if (subscriptionMatch) {
      return stripeJson(subscriptionFixture(subscriptionMatch[1]!.replace(/^sub_/, "")));
    }
    const checkoutPage = url.pathname.match(/^\/checkout\/([^/]+)$/);
    if (checkoutPage && request.method === "GET") {
      const session = sessions.get(checkoutPage[1]!);
      if (!session) return new Response("Not found", { status: 404 });
      return new Response(
        `<!doctype html><html><body><h1>Stripe test-mode founding checkout</h1><p>$53.00 local presentment for the €49 monthly plan</p><form method="post" action="/checkout/${checkoutPage[1]}/pay"><button type="submit">Pay $53 in test mode</button></form></body></html>`,
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }
    const pay = url.pathname.match(/^\/checkout\/([^/]+)\/pay$/);
    if (pay && request.method === "POST") {
      const session = sessions.get(pay[1]!);
      if (!session) return new Response("Not found", { status: 404 });
      session.status = "complete";
      session.payment_status = "paid";
      const event = {
        id: `evt_first_customer_${++counter}`,
        object: "event",
        type: "checkout.session.completed",
        created: Math.floor(Date.now() / 1_000),
        livemode: false,
        data: { object: session },
      };
      const payload = JSON.stringify(event);
      const timestamp = Math.floor(Date.now() / 1_000);
      const signature = createHmac("sha256", webhookSecret)
        .update(`${timestamp}.${payload}`)
        .digest("hex");
      const webhook = await fetch(`${appOrigin}/api/webhooks/stripe`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": `t=${timestamp},v1=${signature}`,
        },
        body: payload,
      });
      if (!webhook.ok) {
        return new Response(`Webhook failed: ${webhook.status}`, { status: 502 });
      }
      const successUrl = String(session.success_url).replace(
        "{CHECKOUT_SESSION_ID}",
        String(session.id),
      );
      return Response.redirect(successUrl, 303);
    }
    return new Response("Not found", { status: 404 });
  },
});

function subscriptionFixture(checkoutId: string) {
  return {
    id: `sub_${checkoutId}`,
    object: "subscription",
    livemode: false,
    customer: `cus_${checkoutId}`,
    status: "active",
    cancel_at_period_end: false,
    items: {
      object: "list",
      data: [
        {
          id: `si_${checkoutId}`,
          current_period_end: Math.floor(Date.now() / 1_000) + 2_592_000,
          price: { id: priceId },
        },
      ],
    },
  };
}

function stripeJson(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "request-id": `req_first_customer_${counter}` },
  });
}
