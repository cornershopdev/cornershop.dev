# First-customer production evidence exercise

This runbook verifies a completed, explicitly authorized first-customer journey.
It does not send an invitation, open Checkout, charge a customer, create an
account, change DNS, publish content, or trigger an incident. Those actions
remain separate operator and customer decisions.

The verifier has three possible outcomes:

- `NOT_VERIFIED`: the deterministic product path itself is incomplete.
- `AUTOMATED_PATH_VERIFIED`: deterministic platform evidence exists, but one or
  more real-customer, live-provider, public-domain, or human records are absent.
- `REAL_CUSTOMER_ACCEPTANCE_VERIFIED`: every automated and real-production gate
  is supported by live provider, PostgreSQL, HTTPS, and durable human evidence.

Only the final outcome satisfies the real first-customer rows in issues #20 and
#47. CI (including the full Chromium/provider-double journey), Stripe test
mode, a platform subdomain, a preview, an application health check, or a
manually edited checkbox can never produce it.

## Current fail-closed instrumentation boundary

The verifier deliberately requires evidence fields that the application may not
yet emit. Missing instrumentation is reported as a missing check; the verifier
does not infer or synthesize it.

In particular, the gate requires:

- signed provider `email.delivered` event rows for the exact claim invitation
  and auth magic link, linked to each record's provider message ID; API
  acceptance called `SENT` is insufficient;
- an accepted invitation followed by a recorded rejected replay, plus exact
  workspace-session rotation and post-publish revocation audit rows; both the
  replaced session and the final signed-out session must be absent;
- a draft-save audit containing `draftContentDigest`, `integrationUrlDigest`, and
  `publishedSiteVersionIdAtSave`;
- a publish audit containing the prior live pointer, draft revision, content
  digest, and `integrationUrlDigest` matching the source import;
- the public customer response to expose the exact immutable site-version ID in
  `X-Cornershop-Site-Version` or a `cornershop-site-version` meta element.

Until those records exist naturally in production, the correct result is not
verified. Do not replace them with operator assertions.

## Authorization gates

Obtain and privately record each authorization before the related action:

1. An owner or authorized representative consents to receive the one-time claim
   invitation and supplies evidence of authority.
2. The same representative approves the exact €49/month offer and authorizes
   the live Stripe Checkout.
3. The owner confirms the intended menu edit and source booking/ordering links.
4. The domain administrator authorizes the exact DNS change.
5. The owner approves publishing the reviewed version.

None of these can be inferred from control of Restofront, a public email address,
an imported menu, or a successful test-mode exercise.

## Exercise order

### 1. Preflight the release and price

- Record the deployed commit SHA, release URL, deployment run, and successful
  protected readiness result.
- In Stripe live mode, review the configured founding Price. It must be active,
  tax-exclusive, non-metered, EUR 49.00, recurring monthly, and the same ID
  configured as `STRIPE_PRICE_ID`.
- Confirm the live webhook endpoint and supported events are enabled.
- Confirm claim and sign-in delivery status is driven by signed provider events,
  not merely the email-send API response.

Stop if any item is missing or ambiguous.

### 2. Complete the authorized customer journey

Follow the human-action order in
[`first-customer-validation.md`](./first-customer-validation.md): issue one
owner-bound invitation, complete one authorized live checkout, wait for webhook
provisioning, sign in, choose the intended workspace, save one intentional
private edit, prove the existing public version did not move, then publish.

Record only non-secret identifiers in the evidence manifest. Keep the raw claim
token, email links, session cookies, customer email, payment details, and owner
proof outside GitHub and outside command output.

### 3. Verify the public result

- Confirm the exact customer-authorized hostname is verified in the platform.
- Confirm its certificate is valid and the public HTTPS request succeeds.
- Confirm the response exposes the same immutable version ID stored as the
  site's published pointer.
- Compare a stable digest of the owner-approved source booking and ordering
  destinations with the published snapshot digest.

Restofront, Cornershopdev, any of their subdomains, and any hostname listed in
`PLATFORM_HOSTNAMES` are factory or niche infrastructure. The manifest and live
redirect check reject them; they do not satisfy the custom-domain criterion.

### 4. Record failure-alert evidence

Use separately authorized, controlled exercises for checkout-webhook,
publication, and public-site health failure alerts. Each evidence row requires a
durable `DELIVERED` alert row and a private receipt/acknowledgement reference.
The production verifier reads existing rows only; it never creates an incident.

### 5. Record human cost and review evidence

Complete the private onboarding-cost, recurring-support, owner-edit confirmation,
and +30-day review records. Put only opaque references to them in the manifest.
Also record when each entry occurred. The review schedule must be created no
later than one day after the settled live charge. The support window and review
cannot complete before 30 full days have elapsed from that invoice's `paid_at`
timestamp, and the verifier checks the current time independently. Valid-looking
references cannot make the gate pass early.

An evidence custodian who is independent of the application must inspect every
private reference and alert receipt, then sign the complete manifest with the
offline Ed25519 private key. The application deployment contains only the
base64 SPKI public key in `FIRST_CUSTOMER_EVIDENCE_PUBLIC_KEY`; the private key
must never enter SSM, the container, CI, GitHub, or the repository. The verifier
requires the signature to cover every reference and timestamp and requires its
`signedAt` to be after the latest evidence record.

## Run the read-only gate

Copy
[`first-customer-evidence.example.json`](./first-customer-evidence.example.json)
to an approved private location and replace every example value. Do not commit a
real customer manifest.

After the custodian has inspected the referenced records, create a new signed
file outside the repository. The command refuses to overwrite an existing file
and prints only the signer ID and evidence digest:

```bash
bun run operator:sign-first-customer-evidence \
  --manifest /approved-private-path/first-customer-evidence-unsigned.json \
  --private-key /offline-key-location/first-customer-ed25519.pem \
  --output /approved-private-path/first-customer-evidence-signed.json \
  --signer private-evidence-custodian:<approved-id> \
  --execute
```

Run the verifier inside the exact deployed application image with its production
environment. `--execute` is an explicit acknowledgement that the command will
read production systems. It does not authorize or perform writes.

```bash
docker exec -i api-cornershop-dev \
  bun run operator:verify-first-customer \
  --environment production \
  --manifest - \
  --execute \
  < /approved-private-path/first-customer-evidence-signed.json
```

Streaming the manifest over standard input keeps its private references out of
the container filesystem and command arguments. The verifier bounds the input
to 1 MB and never echoes those references.

The command performs only:

- PostgreSQL reads of the named site, invitation, webhook ledger, auth, session,
  publication, domain, subscription, and alert records;
- Stripe GET requests for the configured Price, named Checkout Session,
  Subscription, and the exact invoice attached to that Checkout Session;
- one public HTTPS GET to validate certificate handling, response status, and
  published-version identity.

Output contains the check verdicts, missing check names, public origin, and
short SHA-256 fingerprints of identifiers. It does not print database URLs,
provider keys, customer email, evidence references, raw identifiers, provider
response bodies, claim tokens, or session cookies.

The command exits non-zero unless the outcome is exactly
`REAL_CUSTOMER_ACCEPTANCE_VERIFIED`. Attach the redacted JSON output and the
private evidence-record location to issue #20. Do not attach the manifest.

## Failure handling

- `manifest_invalid:*`: replace missing or placeholder fields in the private
  manifest.
- `production_configuration_missing`: run inside the reviewed production image
  with its encrypted environment, including the custodian's Ed25519 public key.
- `live_stripe_configuration_required`: stop; do not substitute test credentials.
- `evidence_source_unavailable`: a provider, database, or public HTTPS source
  could not be read. Retry only after resolving the underlying source.
- An `AUTOMATED_PATH_VERIFIED` result is not an error to work around. Read its
  `missing` list, gather the absent real evidence, and rerun.

Never edit database rows, alert statuses, audit metadata, Stripe objects, or the
public response merely to make the verifier green. Fix missing product
instrumentation through a reviewed release, then perform a new authorized
exercise.
