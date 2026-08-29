# Stripe billing operations

Stripe webhooks are the only durable provisioning path. A Checkout browser
return can reconcile a provisioned account and issue its signed session cookie,
but it never creates a user, organization, membership, site ownership, or
subscription.

## Runtime contract

The deployment requires all of:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_ID`
- `CLAIM_TOKEN_SECRET`
- `RESEND_API_KEY`

The launch Checkout offers exactly one plan for every claim-enabled vertical:
the Cornershopdev founding subscription at EUR 49.00 per month. Its Stripe Price and Product must be live,
active, non-metered, tax-exclusive, and recurring monthly. Test mode and live mode have separate keys,
prices, Customer Portal configurations, webhook endpoints, and signing secrets.
Never copy a test identifier into Production or a live identifier into local
development.

Checkout enables Adaptive Pricing so eligible customers see and pay in local currency while the durable integration contract remains EUR 49. Checkout disables promotion codes for this offer, requires billing-address and
tax-ID collection, and provisions only when Stripe reports
`payment_status=paid`. A completed zero-payment session cannot create ownership.

Checkout also requires an unexpired, unused `ClaimInvitation` whose SHA-256
token hash, intended email, and site all match. The secure-claim dependency
provides exact domain-email proof, operator approval, isolated rate limits, and
URL-fragment delivery so the raw invitation never enters an HTTP request.
Checkout return authorization uses a separate 30-minute HttpOnly cookie whose
digest and bound Session ID are stored on the invitation.

## Events

Configure only the event types the application processes:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `customer.subscription.paused`
- `customer.subscription.resumed`

Every processed Stripe event ID is committed in `StripeWebhookEvent` in the
same database transaction as its effect. Duplicate deliveries return `2xx`
without repeating provisioning. Subscription handlers retrieve the current
Stripe Subscription and also reject an event older than the last persisted
Stripe event timestamp. Active and trialing grant paid access; incomplete,
incomplete-expired, past-due, unpaid, paused, canceled, missing, and
unconfigured-price subscriptions do not.

Each subscription is bound to one site as well as its owning organization.
Customer Portal and publication checks use that site binding, so a multi-site
owner cannot open the wrong Stripe customer or let one site's status govern
another.

### Legacy subscription mapping

Migration `20260726240000_stripe_subscription_lifecycle` backfills a legacy
organization-scoped subscription only when the organization has exactly one
site and one subscription. It stops before changing the schema if any mapping
is ambiguous; it never guesses which paying site owns a row.

Preflight production before deploy:

```sql
SELECT subscription."id", subscription."organizationId",
       COUNT(DISTINCT site."id") AS "siteCount"
FROM "Subscription" AS subscription
LEFT JOIN "Site" AS site
  ON site."organizationId" = subscription."organizationId"
GROUP BY subscription."id", subscription."organizationId"
HAVING COUNT(DISTINCT site."id") <> 1;
```

An empty result is safe. If the query returns rows, stop the release. Identify
each billed site from Stripe subscription metadata and the claim audit trail,
then ship a reviewed predecessor data migration that adds `Subscription.siteId`
when absent and writes those explicit subscription-ID → site-ID mappings. The
lifecycle migration uses `ADD COLUMN IF NOT EXISTS`, preserves explicit values,
and runs in one transaction, so it can follow that predecessor safely. Never
infer a mapping from organization membership alone.

## Local and test-mode verification

The read-only, one-shot provider preflight validates the exact amount, currency,
cadence, tax behavior, Product state, and Stripe mode without exposing the Price
ID:

```bash
bun run operator:preflight-stripe --mode test
```

1. Use test-mode Price IDs and a test secret key in `.env.local`. Never commit
   that file.
2. Start the app:

   ```bash
   bun run dev
   ```

3. In a second terminal, forward only the supported events:

   ```bash
   stripe listen \
     --events checkout.session.completed,checkout.session.async_payment_succeeded,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,customer.subscription.paused,customer.subscription.resumed \
     --forward-to http://localhost:3000/api/webhooks/stripe
   ```

4. Put the temporary `whsec_…` value printed by that process in
   `STRIPE_WEBHOOK_SECRET` for the local process only, then restart the app.
   The Stripe CLI secret is not the Dashboard endpoint secret.
5. Open a valid test claim invitation and complete Checkout with a Stripe test
   payment method. Confirm that the account reaches `/dashboard` even after
   repeating the event or closing the Checkout return tab.
6. Exercise failure and recovery with Stripe test clocks or Dashboard test
   subscriptions: move the subscription through `past_due`, restore payment,
   schedule cancellation, cancel it, and resume a paused test subscription.
   Confirm `/dashboard` shows the billing action, new domain publication is
   blocked whenever access is not active, and an already-live site remains
   reachable.

The automated suite verifies signature-independent processing rules without
external credentials:

```bash
bun test \
  src/lib/billing-plans.test.ts \
  src/lib/claim-invitations.test.ts \
  src/lib/claim-security.test.ts \
  src/lib/stripe-subscription.test.ts \
  src/lib/stripe-webhook.test.ts \
  src/lib/billing-access.test.ts \
  src/lib/site-claim.test.ts
```

To replay a test event, use Workbench's **Resend** action or the Stripe CLI
event resend command for the event ID. The second delivery must still return
`2xx` and must not add another `StripeWebhookEvent`, subscription, organization,
membership, or owner.

## Production activation blockers

These are deliberate production changes and require explicit authority plus
durable release evidence:

1. Create or approve the one live founding Product and EUR 49 Price. Record
   the approved amount, currency, interval, tax behavior, and live Price ID.
2. Configure and test the live Customer Portal. Enable only the intended
   payment-method, cancellation, invoice, and plan-change features.
3. Create the live webhook endpoint:

   ```text
   https://cornershop.dev/api/webhooks/stripe
   ```

   Select only the seven event types listed above.

4. Store the live secret key, endpoint signing secret, the one live Price ID, and
   a randomly generated claim-token secret of at least 32 characters as
   encrypted Production parameters under
   `/shipshit/production/cornershopdev/`.
5. Deploy the reviewed release. Before cutover, deployment runs
   `operator:preflight-stripe --mode live`; it fails if the live founding Price
   drifts from EUR 49.00 monthly or its Product/mode/tax contract. The frequent
   `/api/health/ready` probe remains provider-read-free and reports missing
   billing configuration without returning any credential or identifier.
6. Complete one explicitly authorized low-risk live Checkout, then verify one
   owner, one organization, one owner membership, one claimed site, one
   subscription, and one event-ledger row. Resend that event and verify counts
   do not change.

Do not create live Products or Prices, enable the live portal, register the live
endpoint, change encrypted parameters, or charge a customer as part of routine
code verification.

### Legacy operator-approval migration gate

Migration `20260820120000_first_customer_evidence` refuses to proceed if an
unaccepted legacy operator-approved invitation is still bound to an active
Stripe Checkout. The old row has no durable authority evidence, while revoking
it in SQL would leave the Checkout URL chargeable. Before retrying a blocked
migration, the deploy script runs a predecessor-schema-safe read-only preflight
from the reviewed image before the candidate entrypoint can apply migrations.
It prints only counts, status, and identifier fingerprints.

If the preflight blocks, identify the matching Checkout Sessions in the private
database and expire every still-open Session in Stripe live mode. A completed
Session must be investigated and must not be revoked by this procedure. Once
Stripe reports every named Session as `expired`, use the same reviewed image to
atomically terminalize the legacy rows and create site audit events:

```bash
docker run --rm --network shipshit \
  --env-file /etc/cornershopdev/production.env \
  --entrypoint bun cornershopdev:<reviewed-commit-sha> \
  run operator:preflight-first-customer-migration \
  --environment production \
  --mode revoke-expired \
  --execute
```

The command refuses the entire write if any Checkout is not live-mode and
expired, and each update uses a database compare-and-swap on the invitation,
site, and Checkout ID. Rerun the normal deployment afterward. Never invent an
approval reference, directly edit a bound invitation, or bypass the migration
exception. Unbound, unaccepted legacy operator approvals are revoked by the
migration itself.

## Failed delivery and replay

- Stripe retries failed live webhook deliveries for up to several days. A
  missing database returns `503`; it is never acknowledged as persisted.
- Invalid signatures return `400`.
- A signed but invalid or mismatched claim is recorded, logged without the
  invitation token or a secret, acknowledged, and not retried forever. Its
  `StripeWebhookEvent.status` is `REJECTED`, `failureReason` contains the
  bounded server validation reason, and a site-scoped
  `stripe.webhook.rejected` audit row is added when the invitation is known.
- Query rejected events during incident review with:

  ```sql
  SELECT "eventId", "type", "failureReason", "processedAt"
  FROM "StripeWebhookEvent"
  WHERE "status" = 'REJECTED'
  ORDER BY "processedAt" DESC;
  ```

- Infrastructure and Stripe API failures return `500`, leaving no committed
  event-ledger row so a retry can process the event.
- Those runtime failures also create a deduplicated durable operator alert.
  Alert delivery never changes the webhook response: Stripe remains the source
  of truth for retry, while the outbox provides human escalation.
- Review failed deliveries in Stripe Workbench. Fix the database, configuration,
  or code fault first, deploy the fix, then resend the exact event.
- Rotate a webhook signing secret in Workbench and encrypted deployment
  parameters together. Redeploy before retiring the previous secret. Never put
  either value in an issue, pull request, shell transcript, or repository file.

Reference:
[Stripe webhook delivery and ordering](https://docs.stripe.com/webhooks),
[subscription webhook events](https://docs.stripe.com/billing/subscriptions/webhooks),
[Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment), and
[Customer Portal integration](https://docs.stripe.com/customer-management/integrate-customer-portal).
