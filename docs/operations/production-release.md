# Production release truth and runbook

**Last audited:** 2026-08-20

Production truth is not a single checkbox. Cornershopdev tracks these states
separately so a green merge cannot be reported as a configured, deployed, or
customer-accepted release.

| State                 | Meaning                                                                                                                                      | Required evidence                                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Code merged           | The exact release SHA is contained in `origin/main` and CI verification passed.                                                              | Stable `vX.Y.Z` tag, merge ancestry check, successful `verify` job.                                              |
| Production configured | The reviewed Caddy bundle is installed, every required SSM value is present, and the candidate passes semantic outreach and platform checks. | Immutable bundle checksums and candidate preflight output; no screenshots or secret values.                      |
| Migrations applied    | The candidate image's complete committed migration set is applied to production.                                                             | `prisma migrate status` from the exact candidate after its entrypoint migration.                                 |
| Production deployed   | Caddy routes to a healthy container whose Docker image tag is the exact release SHA.                                                         | Systems Manager command, immutable deploy-script checksum, deployed-SHA sentinel, public liveness.               |
| Acceptance proven     | A real owner/payment/publish/customer-domain journey satisfies #20 and #47.                                                                  | Customer-authorized evidence listed in `first-customer-validation.md`. Release automation never sets this state. |

## 2026-08-20 production audit

| Check                    | Evidence                                                                                                                                                                                                                                                              | Verdict                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Latest merged code       | `origin/main` = `3f398556a7b849aceb222a1cca12a6663b468681`; refresh this SHA and its required CI once more immediately before cutting the release.                                                                                                                    | `CODE_MERGED`, not deployed.                                                          |
| Running production image | SSM inspection `6a4d128d-5f53-4f3c-af67-b8c683da74c5` found `cornershopdev:feb674d6a39ea716ab8287aab6eeb42c183cb7b9`, healthy since 2026-07-27.                                                                                                                       | 15 commits behind main.                                                               |
| Published release        | Latest stable release is `v0.2.0` at `2abae11cb4205a2ca600d73ca9389be98637e6f2`. Later production changes were manual workflow dispatches.                                                                                                                            | Release history alone does not identify the running image.                            |
| Schema                   | The running image reports 15 migrations and “up to date”; main contains 18.                                                                                                                                                                                           | Up to date only for the old image, not for main.                                      |
| Outreach                 | The running image has no `operator:preflight-outreach` command. Metadata-only SSM checks find neither `RESEND_WEBHOOK_SECRET` nor `RESEND_INBOUND_WEBHOOK_SECRET`; the configured sender is `Vincent from Restofront`, not the required `Vincent from Restofrontapp`. | Not configured or deployed.                                                           |
| Authentication secret    | SSM lacks `BETTER_AUTH_SECRET`; the old image uses the claim-secret rollout fallback.                                                                                                                                                                                 | Explicit production auth configuration not ready.                                     |
| First-customer evidence  | SSM has `SUPERADMIN_EMAILS`, but lacks `FIRST_CUSTOMER_EVIDENCE_PUBLIC_KEY`.                                                                                                                                                                                          | Evidence verification configuration not ready.                                        |
| Photo policy             | SSM lacks `OPENROUTER_IMAGE_MODEL`, `PHOTO_ENHANCEMENT_MODEL`, and all documented `PHOTO_*` cost/concurrency controls.                                                                                                                                                | The next image would silently use code defaults unless the reviewed policy is pinned. |
| Platform wildcard DNS    | Random labels under `*.restofront.com` and `*.cornershop.dev` return no A records; neither hosted zone contains a wildcard.                                                                                                                                           | Not ready.                                                                            |
| Caddy on-demand TLS      | Caddy validates successfully and its loaded JSON uses `http://api-cornershop-dev:3000/api/domains/authorize` as the on-demand permission endpoint.                                                                                                                    | Caddy policy ready; wildcard DNS and new application authorization are not.           |
| Customer acceptance      | No settled first payment, owner edit/publish, owner-authorized custom domain, second qualified lead, or +30-day decision record is attached to #20/#47.                                                                                                               | Not proven.                                                                           |

This audit authorizes no production deploy, DNS change, email, customer charge,
or customer-domain change.

## External configuration blockers

Apply these only with production authority. They are prerequisites, not proof
of deployment or acceptance.

### 1. Add the two reviewed wildcard records

```bash
aws route53 change-resource-record-sets \
  --hosted-zone-id Z0616902GJXO4BCGHVNV \
  --change-batch file://deploy/aws/route53-restofront-platform-wildcard.json

aws route53 change-resource-record-sets \
  --hosted-zone-id Z07698652UO7KEWAGO5AW \
  --change-batch file://deploy/aws/route53-cornershopdev-platform-wildcard.json
```

Wait for both changes to reach `INSYNC`. A random label under each parent must
then resolve to `52.8.153.188`. Do not mint certificates for random labels;
the release preflight uses DNS-only random probes and stable persisted-site TLS
probes to preserve the shared Let's Encrypt quota.

### 2. Add the missing secrets without placing them in shell history

```bash
read -r -s CORNERSHOP_BETTER_AUTH_SECRET
aws ssm put-parameter \
  --region us-east-1 \
  --name /shipshit/production/cornershopdev/BETTER_AUTH_SECRET \
  --type SecureString \
  --value "$CORNERSHOP_BETTER_AUTH_SECRET" \
  --overwrite
unset CORNERSHOP_BETTER_AUTH_SECRET

read -r -s CORNERSHOP_RESEND_WEBHOOK_SECRET
aws ssm put-parameter \
  --region us-east-1 \
  --name /shipshit/production/cornershopdev/RESEND_WEBHOOK_SECRET \
  --type SecureString \
  --value "$CORNERSHOP_RESEND_WEBHOOK_SECRET" \
  --overwrite
unset CORNERSHOP_RESEND_WEBHOOK_SECRET

read -r -s CORNERSHOP_RESEND_INBOUND_WEBHOOK_SECRET
aws ssm put-parameter \
  --region us-east-1 \
  --name /shipshit/production/cornershopdev/RESEND_INBOUND_WEBHOOK_SECRET \
  --type SecureString \
  --value "$CORNERSHOP_RESEND_INBOUND_WEBHOOK_SECRET" \
  --overwrite
unset CORNERSHOP_RESEND_INBOUND_WEBHOOK_SECRET

read -r -s CORNERSHOP_FIRST_CUSTOMER_EVIDENCE_PUBLIC_KEY
aws ssm put-parameter \
  --region us-east-1 \
  --name /shipshit/production/cornershopdev/FIRST_CUSTOMER_EVIDENCE_PUBLIC_KEY \
  --type SecureString \
  --value "$CORNERSHOP_FIRST_CUSTOMER_EVIDENCE_PUBLIC_KEY" \
  --overwrite
unset CORNERSHOP_FIRST_CUSTOMER_EVIDENCE_PUBLIC_KEY
```

`BETTER_AUTH_SECRET` must contain at least 32 random characters. Each Resend
value must be the current signing secret for its mapped production endpoint,
and the two values must differ. Reusing one endpoint's value or generating an
unrelated value makes the corresponding signature verification fail.
`FIRST_CUSTOMER_EVIDENCE_PUBLIC_KEY` is the base64-encoded Ed25519 SPKI public
key held by the independent evidence custodian. Its private counterpart must
never enter SSM, CI, the container, or this repository.

### 3. Pin the reviewed photo model and policy

These non-secret values are absent from production SSM. Add them before the
candidate is built so production uses the reviewed economical model and bounded
fan-out/cost policy instead of silently inheriting code defaults:

```bash
while IFS='=' read -r key value; do
  aws ssm put-parameter \
    --region us-east-1 \
    --name "/shipshit/production/cornershopdev/$key" \
    --type String \
    --value "$value" \
    --overwrite
done <<'PHOTO_POLICY'
OPENROUTER_IMAGE_MODEL=google/gemini-3.1-flash-image
PHOTO_ENHANCEMENT_MODEL=google/gemini-3.1-flash-image
PHOTO_DISCOVERY_MAX_IMAGES=8
PHOTO_INGEST_CONCURRENCY=4
PHOTO_ENHANCEMENT_CONCURRENCY=2
PHOTO_ENHANCEMENT_BATCH_MAX_IMAGES=6
PHOTO_ENHANCEMENT_ESTIMATED_COST_MICROS=25000
PHOTO_ENHANCEMENT_PER_IMAGE_CEILING_MICROS=50000
PHOTO_ENHANCEMENT_PER_SITE_CEILING_MICROS=500000
PHOTO_POLICY
```

### 4. Configure the factory sender identity

```bash
aws ssm put-parameter \
  --region us-east-1 \
  --name /shipshit/production/cornershopdev/EMAIL_FROM \
  --type String \
  --value 'Vincent from Cornershopdev <vincent@send.cornershop.dev>' \
  --overwrite

aws ssm put-parameter \
  --region us-east-1 \
  --name /shipshit/production/cornershopdev/EMAIL_REPLY_TO \
  --type String \
  --value 'vincent@reply.cornershop.dev' \
  --overwrite
```

Restofront keeps its niche-specific `send.restofront.com` / `restofront.com`
identity. Factory-claimed Food Retail and Local Service sites use the
generic Cornershopdev sender and receiving-only reply subdomain above.

In Resend, enable both exact HTTPS endpoints:

- `https://cornershop.dev/api/webhooks/resend` with `email.sent`,
  `email.delivered`, `email.bounced`, `email.complained`, `email.failed`, and
  `email.suppressed`.
- `https://cornershop.dev/api/webhooks/resend/inbound` with `email.received`.

The release preflight lists provider webhook metadata and fails closed unless
both endpoints and their complete event sets are enabled. Provider metadata
does not reveal signing secrets, so the same preflight separately requires the
two configured secrets to be present and unequal without printing either value.

## Release procedure

1. Merge the complete release scope to `main`; required CI must be green. Fetch
   and refresh `origin/main` again immediately before choosing the release SHA.
2. Confirm the external blockers above with read-only SSM, Route 53, DNS, and
   Resend checks. Never print secret values.
3. Publish one stable `vX.Y.Z` GitHub release targeting the exact full main SHA.
   Manual workflow dispatch runs verification only and cannot deploy.
4. The release workflow proves the tag SHA is merged to `origin/main`, builds
   and uploads immutable artifacts, verifies the deploy-script and Caddy bundle
   checksums, and reconciles the host launcher plus managed Caddy fragment.
5. The candidate applies migrations, becomes healthy, reports migration status,
   passes the outbound and inbound outreach preflight, and proves both wildcard
   DNS parents before traffic changes.
6. After cutover, Caddy reloads and the deployment probes HTTPS/on-demand TLS
   for stable persisted-site hosts under both parents. Failure rolls back to the
   previous container.
7. The workflow verifies public liveness and uploads
   `production-release-<tag>` evidence containing the exact SHA, release URL,
   workflow run, SSM command ID, and independent state verdicts.
8. Link that artifact from the release/board issues. Do not close #20 or #47
   until their real-world acceptance evidence is complete.

Re-running a failed release workflow is permitted after configuration is fixed;
publishing a replacement tag solely to hide a failed gate is not.

## Board reconciliation

The evidence above implies these issue states:

| Issue | Correct state      | Reason                                                                                                                                                               |
| ----- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #47   | Open / In Progress | The offer is documented, but no first settled payment, published custom domain, support-cost record, second qualified lead, or scheduled/completed review is proven. |
| #98   | Open / In Progress | Code is merged, but wildcard DNS, production deployment, and valid-TLS site evidence are absent.                                                                     |
| #20   | Open / Todo        | The paid-owner end-to-end exit has not begun with an authorized customer.                                                                                            |
| #10   | Open / In Progress | Production services run, but Preview DB isolation and the production image round trip remain unproven; current alert code is not deployed.                           |
| #16   | Open / In Progress | Main contains substantial auth work, but production config/deployment and a real owner receive/use exercise remain open.                                             |
| #17   | Open / In Progress | Main contains operator/outreach work, but the production operator journey and blocker rollup acceptance remain unproven.                                             |
| #88   | Closed             | PR #87 merged as `09e2e73`, main CI passed, the security reviewer passed, and every referenced review thread is resolved.                                            |
