# Restofront first-customer validation runbook

**Runbook version:** 2026-08-20

**Issues:** [#20](https://github.com/cornershopdev/cornershop.dev/issues/20)
and [#47](https://github.com/cornershopdev/cornershop.dev/issues/47)

**Candidate:** Le Petit Meunier

**Current decision:** `HOLD — do not invite or charge`

**2026-08-20 truth update:** The safe draft/publish, claiming, billing,
authentication, platform-subdomain, and outreach implementations are merged to
main, but production still runs `feb674d6a39ea716ab8287aab6eeb42c183cb7b9`.
Wildcard DNS and required outreach/auth configuration are absent. These merged
capabilities therefore remain unavailable for first-customer acceptance. See
[`production-release.md`](production-release.md) for the current evidence and
release blockers. Issue #47 must remain open until the real commercial and
customer-domain evidence below exists.

The executable, read-only production evidence gate is documented in
[`first-customer-production-exercise.md`](./first-customer-production-exercise.md).
Its automated-path result is platform evidence only; issue acceptance still
requires `REAL_CUSTOMER_ACCEPTANCE_VERIFIED` from live provider, customer,
custom-domain, alert-receipt, and human cost/review evidence.

This is the commercial and operational exit plan for the first paid Restofront
restaurant. It separates verified platform evidence from evidence that can only
come from an authorized restaurant owner and a real payment. A working preview,
green deploy, or founder test never substitutes for owner consent, ownership
verification, a settled Stripe charge, or a published customer domain.

## Automated browser boundary

GitHub CI runs a Chromium journey against a production build and real
PostgreSQL/Redis services. It uses loopback-only Stripe and Resend doubles to
exercise the actual claim page, `/api/claim-invitations`, founding-plan
`/api/checkout`, an external test Checkout page, signed Stripe webhook,
checkout bootstrap, magic-link sign-in, workspace chooser and cookie rotation,
dashboard save/publish HTTP routes, and the public-host rewrite with immutable
version identity. The journey also proves a used claim is rejected, a stale
workspace cookie cannot open the dashboard, private Save leaves the public host
unpublished, and booking/ordering destinations survive Publish.

The double boundary requires `CORNERSHOP_ENV=test`,
`FIRST_CUSTOMER_E2E=1`, loopback app/provider/database origins, test provider
keys, and no `VERCEL_ENV`. Instrumentation aborts startup if any part is unsafe.
CI artifacts say `AUTOMATED_BROWSER_JOURNEY_VERIFIED` and explicitly keep
`realPaymentVerified`, `realCustomerAcceptanceVerified`, and
`productionAccepted` false. They are platform evidence, never issue #20/#47
real-world acceptance evidence.

## The one-price offer

### Restofront Founding Restaurant — €49/month

VAT is added when applicable. There is no setup fee, annual alternative,
discount, trial, second tier, or usage charge in the first-customer offer. The
restaurant can cancel monthly.

The outcome is one maintained, mobile-first restaurant website on the
restaurant's own domain:

- Restofront imports the existing public menu and restaurant details into a
  private preview.
- The owner reviews and corrects the preview before anything is published.
- The owner can edit menu content and restaurant details after claiming.
- Restofront connects the restaurant's custom domain and provides SSL.
- Existing booking, ordering, and delivery destinations are preserved as
  external links.
- Hosting, the owner workspace, first-party booking-request inbox, and
  first-party traffic/conversion reporting are included.
- Founder-assisted import, verification, and domain setup are included for this
  validation customer and measured as onboarding cost.

The offer does **not** include native ordering, POS integration, loyalty,
branded apps, Google Business Profile synchronization, SEO or revenue
guarantees, unlimited redesigns, or rights to reuse images the restaurant does
not own. Generated food imagery is removed from this offer. Only source images,
owner uploads, or explicitly permissioned customer imagery may go live.

### Promise ledger

| Promise | Offer status | Evidence or gate |
| --- | --- | --- |
| Private prefilled preview | Working | Le Petit Meunier preview returned HTTP 200 on 2026-07-26. Owner approval is still absent. |
| Owner-editable menu and details | Working in the customer workspace | A real owner edit remains unverified. Access depends on safe claim and provisioning. |
| Existing booking/ordering destinations preserved | Working in product design | Compare the source and published URLs before launch; no customer-path evidence exists yet. |
| Custom domain and SSL | Working platform capability | Must be proven on a domain the restaurant has authorized. A platform or Restofront domain does not count. |
| Booking-request inbox and first-party analytics | Deployed in PR #59 | Analytics activate only on a verified customer domain; no customer-domain data exists yet. |
| Safe private Save and atomic Publish | Merged on main; not production-deployed | Do not imply that production has the implementation until a SHA-bound release deploy proves it. Acceptance still requires a real owner save, unchanged-live-pointer evidence, and exact published-version evidence. |
| Secure, owner-bound invitation | Merged on main; not production-deployed | Do not send a claim URL until production config/deploy gates pass and a real owner authorizes the exercise. Acceptance still requires authorized owner receipt, signed provider delivery, one acceptance, and rejected replay evidence. |
| Durable one-plan billing lifecycle | Merged on main; not production-deployed | Do not initiate a live checkout until the exact release is deployed and the customer authorizes a live charge. Acceptance still requires an authorized settled live €49 charge and idempotent live webhook evidence. |

Public Restofront marketing and the claim UI sell this same €49/month founding
plan and authentic-image policy. Live Stripe still has to match: create the one founding
price at EUR 49 and set SSM `STRIPE_PRICE_ID`. Code cannot
change the Stripe dashboard.

## Production evidence snapshot

The following is platform-readiness evidence only.

| Check | Verified evidence | What it does not prove |
| --- | --- | --- |
| PR #59 | Merged as `ae915911e55f76edbcd0134c6b867c8215147150`; PR `verify` passed. | No customer used the lead inbox or analytics. |
| Production deploy | Workflow run `30216461217` deployed the same SHA. `verify`, `deploy / deploy`, Systems Manager deployment, and production verification completed successfully at 2026-07-26 19:20 UTC. | No payment, claim, edit, publish, or customer-domain journey occurred. |
| Cornershopdev ingress | `cornershop.dev` and `www.cornershop.dev` returned HTTP 200 through Caddy at 2026-07-26 20:13 UTC. | This is the factory domain, not a customer domain. |
| Restofront AWS DNS cutover | `restofront.com` resolved to `52.8.153.188`; `www.restofront.com` was a CNAME to the apex and resolved to the same address. Both returned HTTP 200 through Caddy and rewrote to `/niche/restaurant`. | Restofront is the niche marketing domain, not proof that a restaurant authorized DNS. |
| Live health | `/api/health/live` returned HTTP 200 on both `cornershop.dev` and `api.cornershop.dev`. | Liveness is not the bearer-authenticated dependency-readiness check and not an alert-delivery test. |
| Candidate preview | `/preview/le-petit-meunier` returned HTTP 200 through both Cornershopdev and Restofront. | The restaurant owner has not been verified and has not approved the content or imagery. |

Keep the GitHub run URL, probe timestamps, response codes, DNS answers, and the
final customer artifacts together in issue #20. Never attach secrets, raw
tokens, private customer contact data, or Stripe payment details beyond the
non-sensitive identifiers needed to verify the event.

## Acceptance evidence matrix

Statuses mean:

- `VERIFIED` — objective evidence already exists.
- `DOCUMENTED` — the rule or offer is written, but the customer event has not
  happened.
- `AUTOMATED` — the platform path is covered by deterministic tests, but the
  customer/provider event has not happened.
- `HUMAN` — only an authorized person or real-world event can supply evidence.

| Issue criterion | Status on 2026-07-26 | Required acceptance evidence | Dependency or owner |
| --- | --- | --- | --- |
| #20: operator creates or opens the Le Petit Meunier lead | `HUMAN` | Timestamped operator-console record for the canonical `le-petit-meunier` site, with no private contact data copied into GitHub. | Operator action; not blocked by #18, #13, or #8. |
| #20: verified owner accepts a single-use invitation | `AUTOMATED` | Invitation audit events showing creation, signed delivery, verification, one acceptance, expiry, and failed replay; owner identity/authority attestation stored privately. | Real owner consent and action. |
| #20: Stripe collects the first payment and webhook provisions the account | `AUTOMATED` | Settled live-mode Checkout/Payment identifier, matching idempotent webhook event, and one user, organization, owner membership, and active subscription. Redact personal/payment data. | Customer authorization and a real live charge. |
| #20: owner signs in and edits a menu item | `AUTOMATED` | Owner session audit, before/after value, and owner confirmation that the edit is intentional. | Real owner action. |
| #20: Save changes only the private preview | `AUTOMATED` | Before/after evidence proving the draft changed while the published pointer and custom domain did not. | Real owner action on production data. |
| #20: Publish atomically updates the public site | `AUTOMATED` | Publish audit event and immutable version identifiers; old version remains live on a forced validation failure; new version appears only after successful publish. | Authorized production publish. |
| #20: verified custom domain serves the correct site with valid SSL | `AUTOMATED` | Owner-authorized DNS change, platform domain-verification record, public DNS answer, valid certificate, HTTP 200, and content/version match to the published snapshot. | Owner/domain administrator authorization and production DNS. |
| #20: booking and ordering links remain unchanged | `HUMAN` | Machine-readable source-versus-published URL comparison plus owner confirmation for every retained provider link. | Final authorized launch check. |
| #20: checkout, publish, and public-site failure alerting | `AUTOMATED` | One safe synthetic failure per path with timestamped alert receipt, destination, acknowledgement, and runbook link. | Controlled production exercise and receipt acknowledgement. |
| #20: price, onboarding time, support, and decision date recorded | `DOCUMENTED` | Completed worksheet below and a calendar/review link dated exactly 30 days after the first settled charge. | Founder records actuals; no engineering dependency. |
| #20: evidence and operational instructions attached | `DOCUMENTED` | Link this runbook now; attach the completed evidence rows only after each event occurs. | Issue owner. |
| #47: one price and offer written before the first conversation | `DOCUMENTED` | Immutable link to this runbook revision predating the first recorded conversation. | Commercial owner. Public pricing must be aligned before use. |
| #47: every promised capability is working, upcoming, or removed | `DOCUMENTED` | Promise ledger above reviewed immediately before the conversation. | Commercial owner; review immediately before use. |
| #47: first restaurant pays and reaches a published custom domain | `HUMAN` | Same payment, publication, DNS, SSL, and content-match evidence as #20. | Authorized customer payment, edit, publish, and DNS action. |
| #47: founder-assisted work and recurring support cost recorded | `HUMAN` | Completed onboarding entries and at least the first 30 days of support entries in the worksheet. | Founder; actual activity only. |
| #47: second qualified restaurant lead documented | `HUMAN` | A second lead record satisfying every qualification rule below. | Commercial acquisition; no engineering dependency. |
| #47: dated keep/change/stop review scheduled and recorded | `HUMAN` | Calendar/review link scheduled for `first settled charge date + 30 calendar days`, then completed decision record. | Founder; cannot be dated until a real first charge exists. |

## Historical engineering dependencies

Issues #8, #13, and #18 delivered the billing, claim, and publication platform
boundaries described below. They are no longer reasons to mark a real-world row
complete: test-mode and platform evidence still cannot substitute for the live
customer, provider, payment, DNS, alert-receipt, and 30-day evidence required by
the production gate.

### #18 — safe draft and publish

#18 established private Save, validated atomic Publish, failure rollback, and
immutable public version routing. The production exercise must still observe
those guarantees on the authorized restaurant journey.

### #13 — secure claiming and ownership verification

#13 established the owner-bound claim invitation and ownership-proof boundary.
The first customer's consent, authority, delivery, acceptance, and replay
evidence remain real-world gates.

A public preview URL, an email entered into checkout, founder familiarity with
the restaurant, or control of the Restofront domain is not ownership proof.

### #8 — durable Stripe provisioning and subscription lifecycle

#8 established browser-independent, idempotent Stripe provisioning and the
subscription lifecycle. It did not perform or authorize the first live charge.

Neither a Stripe test-mode success nor a browser return from Checkout counts as
the first payment.

## Founder-assisted onboarding and support-cost worksheet

Create one private worksheet per customer. GitHub receives only redacted totals
and evidence links.

### Customer and commercial record

| Field | Actual |
| --- | --- |
| Customer record ID | `[private CRM/operator ID]` |
| Restaurant | `[name]` |
| City/country | `[city, country]` |
| Authorized owner/representative verified at | `[timestamp — pending]` |
| Offer revision shown | `[commit SHA]` |
| Price | `€49/month + applicable VAT` |
| First settled charge at | `[timestamp — pending]` |
| Stripe non-sensitive evidence ID | `[pending]` |
| Custom domain | `[pending]` |
| Published version ID | `[pending]` |
| 30-day review date | `[first settled charge date + 30 calendar days]` |

### One-time founder-assisted onboarding

Record minutes, even when the activity is bundled into the €49 offer.

| Activity | Started | Finished | Founder minutes | External cost | Notes/evidence |
| --- | --- | --- | ---: | ---: | --- |
| Lead review and source validation |  |  |  |  |  |
| Content/menu import and corrections |  |  |  |  |  |
| Ownership verification assistance |  |  |  |  |  |
| Owner walkthrough and intentional edit |  |  |  |  |  |
| Booking/ordering link comparison |  |  |  |  |  |
| DNS and SSL assistance |  |  |  |  |  |
| Publish and acceptance checks |  |  |  |  |  |
| Billing/support handoff |  |  |  |  |  |
| **Onboarding total** |  |  | **0** | **$0.00** |  |

Also record owner claim elapsed time separately. The live kill threshold is
more than 20 minutes to complete a claim, or fewer than 60% of owners who start
and finish it.

### Recurring support log

| Date | Category | Founder minutes | External cost | Root cause | Repeatable fix or product change |
| --- | --- | ---: | ---: | --- | --- |
|  | content/menu |  |  |  |  |
|  | domain/SSL |  |  |  |  |
|  | billing |  |  |  |  |
|  | booking/ordering link |  |  |  |  |
|  | incident/other |  |  |  |  |
| **First 30-day total** |  | **0** | **$0.00** |  |  |

Recurring support above 30 founder minutes per customer per month triggers the
existing stop/change threshold.

### Unit economics

Fill these with actual provider charges and an explicit internal founder-hour
rate; do not silently value founder time at zero.

```text
monthly revenue excluding VAT                    = €49.00
payment processing                               = [actual]
incremental hosting/storage/AI/email              = [actual]
other customer-variable cost                     = [actual]
gross profit before founder labour                = revenue - variable costs
gross margin                                      = gross profit / revenue

internal founder hourly rate                      = [explicit €/hour]
recurring support cost                            = support minutes / 60 × rate
monthly contribution after recurring support      = gross profit - support cost
onboarding labour cost                            = onboarding minutes / 60 × rate
12-month onboarding amortization                  = onboarding labour cost / 12
12-month monthly contribution after founder work  =
  gross profit - support cost - onboarding amortization
```

Record CAC separately. The existing commercial stop threshold is CAC above
€200 at €49/month.

## Second-qualified-lead gate

Do not open the P2 gate until a second restaurant satisfies every item below.
A scraped listing, generated preview, email address, or restaurant name alone is
not a qualified lead.

- It is a single-location independent restaurant in the same launch city and
  country as the validation customer.
- It has a weak or missing website, a public menu that can be lawfully reviewed,
  and existing booking/ordering providers that can remain external.
- A named owner or authorized decision-maker has explicitly agreed to discuss
  the Restofront offer or requested follow-up through a lawful channel.
- The lawful contact basis and consent/follow-up evidence are recorded
  privately; no consent is inferred from public contact details.
- The decision-maker's problem, current website/provider setup, pricing
  reaction, principal objection, and target decision timing are recorded.
- A concrete next step and date exist.
- No payment or domain change is requested before #13 and #8 pass.

Required redacted issue evidence:

```text
Lead record ID:
Qualified at:
City/country:
Fit criteria passed:
Decision-maker authority verified:
Lawful contact/consent evidence location:
Problem and pricing reaction:
Principal objection:
Next step and date:
Disqualifying risk:
```

## Thirty-day keep/change/stop review

**Template version:** 2026-07-26

**First settled charge date:** `[YYYY-MM-DD — pending]`

**Decision meeting date:** `[YYYY-MM-DD = first charge + 30 calendar days]`

**Calendar/review link:** `[pending]`

**Decision owner:** Vincent

Schedule the meeting within 24 hours of the first settled live-mode charge.
Because no first charge is verified, the meeting date is intentionally blank;
inventing a date would falsely imply that the 30-day clock has started.

### Inputs at the decision meeting

| Measure | Actual | Keep/change/stop comparison |
| --- | ---: | --- |
| Delivered previews |  | Conversation rate below 8% after at least 50 delivered previews is a stop/change signal. |
| Qualified conversations |  | Record channel and lawful contact basis. |
| Paying customers |  | Fewer than 5 from roughly 60 previews, or below 4% preview-to-paid, is a stop/change signal. |
| Preview-to-paid conversion |  | Compare with 4%. |
| CAC |  | Above €200 at €49/month is a stop/change signal. |
| Claim completion time |  | Above 20 minutes is a stop/change signal. |
| Claim completion rate |  | Below 60% is a stop/change signal. |
| Founder onboarding minutes |  | Explain the largest manual steps. |
| Recurring support minutes/customer |  | Above 30 minutes/month is a stop/change signal. |
| Gross margin before founder labour |  | Use actual variable costs. |
| Contribution after founder labour |  | Include recurring support and 12-month onboarding amortization. |
| Prompted menu-update completion |  | Below 30% of live customers is a stop/change signal. |
| Credible legal/compliance challenges |  | Any credible challenge is a stop signal pending resolution. |
| Second qualified lead |  | Must exist before P2. |
| Customer outcome and retention intent |  | Owner statement or behavior; never founder inference. |

### Decision record

Choose exactly one:

- `KEEP` — continue the same €49 offer and one-city wedge for the next cohort.
- `CHANGE` — state one falsifiable change to price, scope, onboarding, channel,
  or product, its owner, deadline, and success threshold.
- `STOP` — stop acquiring or charging new restaurants, preserve customer
  obligations, and document the failed threshold and wind-down actions.

```text
Decision:
Decided at:
Evidence window:
Thresholds passed:
Thresholds failed:
Customer statement/evidence:
Second-lead status:
Reason:
Next action:
Owner:
Due date:
Issue/PR links:
```

## Execution order and human-action gates

1. Align the public Restofront pricing/promise copy with this offer.
2. Complete #18, #13, and #8; require green CI and an exact-head verifier pass
   for each current implementation head.
3. Demonstrate checkout, publish, and public-site failure alerts without a
   customer or live charge.
4. Open the canonical Le Petit Meunier lead and store the operator evidence.
5. Obtain owner consent and verify authority through #13. This cannot be
   delegated to code or inferred.
6. Have the owner review the source content, images, price, hours, and retained
   provider links.
7. Only with explicit customer authorization, run one live €49 checkout and
   verify webhook-only provisioning.
8. Have the owner sign in, make an intentional menu edit, prove Save isolation,
   then publish.
9. Only with owner/domain-administrator authorization, change DNS; verify SSL,
   published-version identity, and retained external links.
10. Start the worksheets, schedule the +30-day review, and qualify the second
    lead through a lawful, consented conversation.

Steps 5, 7, 8, 9, and the real sales conversation in step 10 are human-action
gates. This runbook authorizes none of them and records none as complete.
