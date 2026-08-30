# Platform services runbook

Cornershopdev needs PostgreSQL, Redis, and Amazon S3 before production can accept
public imports. Production runs on the shared `api.shipshit.dev` EC2 host in an
isolated container, while data services and credentials remain isolated.

## Environment isolation

Never copy production database or AWS credentials into pull-request builds.
CI uses non-connecting placeholders; runtime credentials are loaded from
encrypted SSM parameters on the EC2 host.

| Service         | Production isolation                                                                             | Runtime variables                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| PostgreSQL      | Dedicated database and login on the existing private RDS instance                                | `DATABASE_URL`                                                                           |
| Workflow        | PostgreSQL World with a Cornershopdev job prefix and bounded concurrency                         | `WORKFLOW_*`                                                                             |
| Redis           | Dedicated private ElastiCache replication group with TLS, authentication, and encryption at rest | `REDIS_URL`                                                                              |
| Images          | Private versioned S3 bucket served through CloudFront OAC                                        | `AWS_REGION`, `S3_BUCKET`, `S3_PUBLIC_BASE_URL`                                          |
| Billing         | Stripe Checkout, signed webhooks, and Customer Portal                                            | `STRIPE_*`, `CLAIM_TOKEN_SECRET`                                                         |
| Operator alerts | Durable PostgreSQL outbox delivered through Resend                                               | `OPERATOR_ALERT_EMAILS`, `RESEND_API_KEY`                                                |
| Niche outreach  | Explicit operator send, Workflow follow-up, separately signed Resend delivery and inbound events | `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `RESEND_INBOUND_WEBHOOK_SECRET`, optional `OUTREACH_INBOUND_FORWARD_TO`, `WORKFLOW_*` |

Preview database provisioning is still an external infrastructure gate. Do not
mark it complete because a Preview URL exists in a local file or CI placeholder.
After the managed Preview database is created, compare the two reviewed runtime
values without printing either value:

```bash
bun run operator:verify-environment-isolation
```

Inject `PRODUCTION_DATABASE_URL` and `PREVIEW_DATABASE_URL` into that process
from the approved secret stores; do not put either value in shell history. The
command first compares normalized host, port, database, and schema identifiers,
then opens read-only transactions and compares the observed server/database
identities. It rejects credential-only differences, IPv4 and bracketed or
unbracketed IPv6 loopback hosts, malformed values, matching configuration,
matching observed identities, and unreachable targets. Attach its hash-only
JSON output to the release record; never attach the input URLs. This proves
database identity separation, not provider backup policy.

After configuring production, redeploy it and request `/api/health/ready`. The
route returns `200` only when the runtime services and billing configuration are
ready.
When configuration is missing, it returns `503` with the missing variable names
and remediation guidance. Provider failures return a generic unreachable
response without variable names or provider details. The route never returns
connection URLs, tokens, or provider error bodies.

Set a distinct `HEALTHCHECK_TOKEN` with at least 32 random bytes in each
environment. Readiness callers must send it as a bearer token:

```bash
curl --fail-with-body \
  --header "Authorization: Bearer $HEALTHCHECK_TOKEN" \
  https://<deployment-host>/api/health/ready
```

The route fails closed when the token is missing or invalid. Each application
instance also coalesces concurrent probes and caches the aggregate result for
five seconds to avoid amplifying health checks into the database, Redis, and
S3 providers.

Readiness also checks the operator-alert configuration and durable queue. An
exhausted alert or a due failed delivery returns `503` with instructions to run
the dispatcher; recipients and provider errors are never returned.

## Multi-vertical lead discovery and outreach preflight

Outreach remains disabled until the operator has reviewed the private preview
and explicitly confirms the initial send. Creating or reopening a lead never
sends an email. The global pause and each lead's own pause in `/admin` are
checked inside the same delivery fence before every Workflow send; every
pause/resume change is written to the operator audit log.

Discovery requires a dedicated adapter for every `Vertical` enum entry. It does
not reuse restaurant category, menu, booking, or structured-data heuristics for
another niche. Preview the query, score, evidence, and preview action without
writes first:

```bash
bun run leads:discover -- --vertical restaurant --city Valletta
bun run leads:discover -- --vertical beauty --city Valletta
```

`--execute` requires `OPERATOR_LEAD_INGEST_TOKEN`. Web-backed candidates run
through the vertical's real import/generation pipeline and persist a private
preview; place-only candidates remain prospects until an operator supplies a
source. Redirected sources, preview content, discovery/audit metadata, and
eligibility are committed to one canonical site in one serializable
transaction. Execute never sends outreach. It records the adapter, every
provider/query pair actually executed, and listing categories,
an operator-owned `UNKNOWN | ELIGIBLE | INELIGIBLE` field and evidence fields.
These are operational evidence, not legal conclusions. Electronic outreach is
fail-closed unless `channel_basis` is `VERIFIED_WRITTEN_CONSENT` or
`VERIFIED_SOFT_OPT_IN` and the record binds the exact private recipient,
controller, `EMAIL` channel, `CLAIM_INVITATION_AND_FOLLOW_UP` purpose,
offset-aware timestamp, and a private `crm:`, `consent:`, `ticket:`, or `dms:`
evidence reference. `controller` must match the exact legal identity configured
as `OUTREACH_LEGAL_CONTROLLER`; missing, mismatched, or future-dated evidence is
blocked. Soft opt-in also requires customer/sale evidence and proof that an
opt-out was offered at collection. Public listings, generic corporate or
value-first rationales, and a bare `ELIGIBLE` flag do not authorize email.
The operator can edit the record and must still review the current preview
before delivery.

Source-reviewed drafts that already exist in the private customer repository
use `POST /api/admin/leads/reviewed-draft` with the same dedicated bearer token.
One request carries a locked `{ batch, vertical, drafts }` envelope of at most
20 rows; every row is validated by the selected vertical schema. This path
never crawls, generates, or sends mail: it persists the reviewed content
exactly, requires the approved slug and source to remain bound, updates only
mutable prospect/preview rows, and fails closed for claimed sites or identity
collisions. Re-running the same envelope is the supported idempotent recovery
path.

Run a locked private batch from a trusted operator machine without copying it
into this repository:

```bash
bun run operator:import:reviewed-drafts -- \
  --input /absolute/path/to/private/reviewed-drafts.json

bun run operator:import:reviewed-drafts -- \
  --input /absolute/path/to/private/reviewed-drafts.json \
  --execute
```

The first command validates and prints only slugs. Execute requires
`OPERATOR_LEAD_INGEST_TOKEN`, imports each exact draft over HTTPS, then requires
its returned slug/database verification and a live `200` preview before moving
to the next row. The command never sends outreach.

Store the exact legal controller at
`/shipshit/production/cornershopdev/OUTREACH_LEGAL_CONTROLLER`. Deployment
requires the parameter and the no-send outreach preflight reports only its
boolean readiness, never the configured identity.

Discovery homepage signals use the same DNS-resolved, connect-pinned,
redirect-revalidated public fetch boundary as imports. Provider-controlled
private IPv4/IPv6 literals, private DNS answers, rebinding, and redirects fail
closed. One normalized source belongs to exactly one vertical; manual and
automated ingest reject cross-vertical reuse before changing a lead.

Systematic discovery also fails closed unless `GOOGLE_PLACES_API_KEY` or an
explicit commercial/self-hosted Nominatim-compatible
`LEAD_DISCOVERY_NOMINATIM_BASE_URL` is configured. The public OSMF
`nominatim.openstreetmap.org` endpoint is hard-blocked and is never an implicit
fallback. Store whichever approved provider setting is used under the matching
`/shipshit/production/cornershopdev/` SSM path.

Resend assigns a signing secret to each webhook endpoint. Store the delivery
endpoint's secret as `RESEND_WEBHOOK_SECRET` and the inbound reply endpoint's
different secret as `RESEND_INBOUND_WEBHOOK_SECRET`, both as SecureStrings
under `/shipshit/production/cornershopdev/`. Never copy one endpoint's secret
to the other variable.

In Resend, register and enable this delivery endpoint:

```text
https://cornershop.dev/api/webhooks/resend
```

Subscribe it to `email.sent`, `email.delivered`, `email.bounced`,
`email.complained`, `email.failed`, and `email.suppressed`. Before approving a
release, also register and enable the inbound endpoint
`https://cornershop.dev/api/webhooks/resend/inbound` for `email.received` and
store that endpoint's own signing secret in `RESEND_INBOUND_WEBHOOK_SECRET`.
Each launched niche must have its own verified Resend sending domain and a
verified receiving-capable reply-to domain declared by its vertical config.
An unlaunched vertical with no niche domain/sender remains discoverable and
previewable but cannot deliver mail.

Restofront uses two Resend domains on the same niche:

| Resend domain          | DNS                                               | Role                                                           |
| ---------------------- | ------------------------------------------------- | -------------------------------------------------------------- |
| `send.restofront.com`  | `send.send.restofront.com` MX/TXT + DKIM          | Outbound `from`                                                |
| `restofront.com`       | root MX + `resend._domainkey` TXT; receiving only | Inbound `replyTo` (`vincent@restofront.com`)                   |
| `send.cornershop.dev`  | `send.send.cornershop.dev` MX/TXT + DKIM          | Factory SMB outbound `from`                                    |
| `cornershop.dev`       | root MX + DKIM; receiving only                    | Factory SMB inbound `replyTo` (`vincent@cornershop.dev`)       |

Inbound mail is webhook-driven (`email.received`); there is no IMAP mailbox.
Operator threads live in the admin outreach panel and in Postgres, not in a
traditional mail client.

`OUTREACH_INBOUND_FORWARD_TO` optionally sends a read copy of each matched
inbound message to one operator mailbox. Leave it unset or blank to keep
forwarding disabled; no outbox row or provider call is created for a new inbound
message in that mode. The dispatcher still reconciles an already-persisted due
row if the setting is later removed: it makes no provider call, records the row
as `EXHAUSTED`, and commits a content-free operator alert in the same
transaction so a pending or ambiguous copy cannot remain stranded silently.
When enabled, store exactly one bare email address as the optional encrypted SSM
parameter `/shipshit/production/cornershopdev/OUTREACH_INBOUND_FORWARD_TO`.
Lists, display-name syntax, malformed addresses, message participants, and any
niche receiving domain are rejected so forwarding cannot loop back through
`email.received`. Changing this setting never changes root MX records or plus-tag
thread routing.

The webhook transaction commits the inbound `OutreachMessage` and its audit
event without creating a new forwarding intent. Postgres and the admin thread
are the source of truth; receiving a reply therefore consumes no outbound send
quota and never copies customer content to a personal mailbox. The separately
deployed worker remains only to drain or reconcile forwarding rows created by a
pre-#194 release. It makes at most three attempts for those legacy rows,
retrying after one and five minutes while the key is inside the provider
idempotency window. A terminal row is retained as `EXHAUSTED` and creates a
content-free operator alert for reconciliation.

Each legacy provider request carries the immutable forwarding-row identifier as
a Resend tag. Signed `sent`, `delivered`, `failed`, `suppressed`, `bounced`,
and `complained` receipts are stored in a dedicated append-only provider-event
ledger keyed by the Svix event ID. `deliveryStatus` is deliberately separate
from the forwarding outbox `status`: provider acceptance completes the outbox,
while a later delivery failure advances only the receipt snapshot and enqueues
a durable, content-free alert. Every validated receipt class, including
`failed` and `suppressed`, proves provider handling only when the row already
records a real prepared attempt; it therefore settles that outbox to `SENT`
without weakening the distinct delivery failure. Exact webhook retries are
no-ops, older events cannot regress the snapshot, and a tagged row that is not
visible yet returns a retryable response instead of acknowledging and losing
the receipt.

Legacy read copies contain a bounded site name, slug, original sender/subject,
and a bounded plain-text message body. Raw inbound HTML is never rendered. The
copy is visibly marked read-only and deliberately has no `Reply-To` or
threading header: reply from the admin outreach panel so the operator workflow
stays authoritative.
Dispatcher output and application logs contain aggregate outcomes, row IDs, and
generic failure codes only—never the destination, subject, message body, or raw
provider response. The code path and provider acceptance do not prove personal
inbox receipt; record that evidence separately after an authorized deployment.

Before approving a release, run the read-only preflight inside the exact
candidate image with its deployment env:

```bash
docker run --rm \
  --env-file /etc/cornershopdev/production.env \
  --network shipshit \
  --entrypoint bun \
  <reviewed-image> \
  run operator:preflight-outreach --environment production
```

The command opens read-only PostgreSQL transactions to verify the outreach
migrations, required tables/columns/indexes (including the private
`leadContactEmail` boundary), application database, and Workflow database;
lists Resend delivery/inbound webhook metadata and domain capabilities;
requires both endpoint-specific secrets to be present and unequal; and
validates every outreach-enabled niche's configured niche or factory sender and reply-to identity plus
the approved lead-enumeration provider. It performs no database writes,
configuration changes, or email sends. Output contains only check names,
booleans, public endpoints, niche names, and timestamps—never database URLs,
API keys, signing secrets, mailbox contents, or provider error bodies. A
failed check is a release blocker; do not weaken the preflight or mark it
ready from configuration screenshots.

## Image storage round trip

Bucket reachability alone does not prove the application write/read path.
After explicit production authorization, execute:

```bash
docker exec api-cornershop-dev \
  bun run operator:verify-image-storage --environment production --execute
```

The command writes a content-addressed immutable original and its config-addressed
enhanced derivative through the production photo storage path, retrieves both
with the configured S3 client, verifies their exact SHA-256 content, proves the
keys are distinct, and deletes every exact object version and delete marker in a
`finally` cleanup. It then lists the keys again and refuses to report success if
any version remains. The scoped runtime role must allow `s3:ListBucketVersions`
and `s3:DeleteObjectVersion` in addition to `s3:PutObject`, `s3:GetObject`, and
`s3:DeleteObject`. Output contains
only fixture labels, digests, cleanup status, environment, and timestamp—never
bucket names, keys, URLs, credentials, or provider error bodies. A run without
`--execute` performs no write. When verification and cleanup both fail, the
output retains the primary write/read or content-mismatch failure and reports
`cleanup: failed` separately. Do not claim the production round trip until the
real command succeeds and cleanup is recorded as `completed`. Issue #10 remains
the evidence gate; after an observed role denial, repair and review IAM before an
authorized retry rather than probing production from a feature branch.

## Runtime operator alerts

Checkout webhook infrastructure failures, persisted-draft or server publication
failures, and failed public `/api/health/live` checks create a durable
`OperatorAlert`. The fingerprint deduplicates each incident for 15 minutes.
Delivery uses the configured factory sender and `OPERATOR_ALERT_EMAILS`, leases
each row against concurrent workers, and stops after three total attempts:
immediate delivery, retries after one and five minutes, then terminal exhaustion
after the third failure. A database or delivery exception for one row is counted
as pending and does not prevent later alerts in the same batch from running.
Recipient addresses and provider responses are absent from alert rows,
readiness responses, and command output.

Stripe webhook failure responses schedule their operator alert with Next.js
`after`, which sends the response without waiting for Resend while extending the
request lifecycle until alert capture settles. Do not replace this with a
floating promise; it may be dropped after the response completes.

Production deploys install a local systemd timer named
`cornershopdev-public-health.timer`. Every two minutes it starts the exact
deployed image with the encrypted environment file and checks the public HTTPS
endpoint. Alert draining is deliberately isolated in
`cornershopdev-operator-alerts.timer`, which runs every minute and processes at
most five rows per invocation. Five worst-case five-second delivery timeouts
consume 25 seconds inside its 45-second service limit; a saturated alert queue
therefore cannot delay or terminate the independent public health check.
Legacy inbound read-copy draining is separately isolated in
`cornershopdev-inbound-forwards.timer`. It runs every minute and processes at
most five rows left by pre-#194 releases; five worst-case eight-second provider
timeouts remain inside its 55-second service limit. New inbound replies never
enter that queue. All three timers use the existing host and providers; they
create no separate billable monitoring service.

Useful commands:

```bash
systemctl status cornershopdev-public-health.timer
journalctl -u cornershopdev-public-health.service --since '30 minutes ago'
systemctl status cornershopdev-operator-alerts.timer
journalctl -u cornershopdev-operator-alerts.service --since '30 minutes ago'
docker exec api-cornershop-dev bun run operator:dispatch-alerts
systemctl status cornershopdev-inbound-forwards.timer
journalctl -u cornershopdev-inbound-forwards.service --since '30 minutes ago'
docker exec api-cornershop-dev bun run operator:dispatch-inbound-forwards
```

The repository owner owns primary response; the release operator is backup.
An `EXHAUSTED` row or alerting readiness failure is actionable: restore Resend
configuration/provider availability, run the dispatcher, confirm `DELIVERED`,
then document the incident. Do not reset attempt counters or delete the row to
make readiness green.

The code path is not evidence of delivery. Exercise each of the three alert
kinds in an authorized Preview environment, then one controlled production
public-health alert. Record timestamps and receipt without including recipient
addresses. Until those exercises occur, keep the acceptance item open.

## Database release procedure

Committed migrations in `prisma/migrations` are the only production schema
source. Do not use `prisma db push` or `prisma migrate dev` against Preview or
Production.

1. Confirm the target shell or CI environment contains the reviewed target
   `DATABASE_URL`.
2. Take or verify a provider backup before any destructive migration.
3. Before the account-email migration, run this read-only duplicate preflight:

   ```sql
   SELECT LOWER("email"), COUNT(*)
   FROM "User"
   GROUP BY LOWER("email")
   HAVING COUNT(*) > 1;
   ```

   Resolve any returned rows before deploying; the migration itself also fails
   closed on this condition.

4. Check migration state with `bun run db:migrate:status`.
5. Apply pending migrations with `bun run db:migrate:deploy`.
6. Redeploy the application and confirm `/api/health/ready` returns `200`.
7. Record the migration name, target environment, operator, and backup reference
   in the release record.

### Reviewed fixture imports

Approved lead previews must be imported with a dedicated create-only operator
script. Do not send them back through `/api/import`: that route crawls and
regenerates content instead of preserving the reviewed fixture.

Le Petit Meunier uses the canonical slug `le-petit-meunier`. Run the dry-run
inside the healthy production container first:

```bash
docker exec api-cornershop-dev \
  bun run operator:import:le-petit-meunier
```

The preflight stops if the canonical slug, the legacy
`restaurant-le-petit-meunier` slug, the normalized source identity, or the
source URL already exists. After confirming the RDS recovery window is healthy,
execute the same reviewed import:

```bash
docker exec api-cornershop-dev \
  bun run operator:import:le-petit-meunier --execute
```

Servizo is the portable product-brand demo (marketing site + Pulse ordering
link). It stays on the shared restaurant site model — no Tradefront vertical —
so it can leave Cornershopdev later. Canonical slug `servizo`:

**Cornershop Pro URLs (direct link, not factory-listed):**

- Site: `https://cornershop.dev/pro/servizo`
- App: `https://cornershop.dev/pro/servizo/app` (redirects to the owner app)

```bash
docker exec api-cornershop-dev \
  bun run operator:import:servizo
```

```bash
docker exec api-cornershop-dev \
  bun run operator:import:servizo --execute
```

Issue a claim invitation for the owner (father-in-law / operator-approved
email) after the site is `PREVIEW_READY`:

```bash
docker exec api-cornershop-dev \
  bun run operator:claim:servizo --email owner@example.com
```

```bash
docker exec api-cornershop-dev \
  bun run operator:claim:servizo --email owner@example.com --execute \
    --evidence-ref private-crm:servizo-owner-consent
```

The importer writes the site, catalog, integrations, version snapshot, import
job, and audit event in one serializable transaction. It verifies the expected
relation counts before commit and reads the canonical row back afterward.

### Superadmin bootstrap

The operator console at `/admin` is protected by two independent gates:

1. the user's PostgreSQL `platformRole` is `SUPERADMIN`;
2. the normalized email is present in the deployment's comma-separated
   `SUPERADMIN_EMAILS`.

Store `SUPERADMIN_EMAILS` as a SecureString under
`/shipshit/production/cornershopdev/SUPERADMIN_EMAILS`, deploy it, then preview
the role change:

```bash
docker exec api-cornershop-dev \
  bun run operator:grant-superadmin --email owner@example.com
```

Apply it only after confirming the target:

```bash
docker exec api-cornershop-dev \
  bun run operator:grant-superadmin --email owner@example.com --execute
```

The script can create a platform-only operator with no customer organization.
Removing either the database role or the environment entry revokes `/admin`.

The container applies committed Prisma migrations and the idempotent Workflow
bootstrap before it starts accepting traffic. A candidate must pass its
container health check before Caddy is reloaded. A failed migration stops the
candidate and leaves the current production container running.

## Backup and restore

- RDS keeps seven days of automated backups with deletion protection enabled.
- Keep Preview restore drills separate from Production. Perform a quarterly
  restore into a new, isolated database and verify the migration table and a
  sample restaurant record before deleting the drill database.
- Restore by creating a new database from the selected recovery point, applying
  any later reviewed migrations, validating it, then replacing `DATABASE_URL`
  through a reviewed environment change. Do not overwrite the existing database
  in place.
- S3 versioning protects image originals and derivatives from accidental
  replacement. Retain authentic source URLs and provenance in PostgreSQL.
- PostgreSQL backups include `OperatorAlert`; restore drills must confirm one
  delivered and one exhausted fixture retain attempts, timestamps, and status.
- After restore, run the alert dispatcher with delivery disabled until DNS and
  database identity are confirmed, preventing stale pending alerts from being
  mailed from a drill environment.

## Credential ownership and rotation

The repository owner is accountable for provider access, backup policy, and
release approval. A migration operator may execute the reviewed commands but
must not copy credentials into issues, pull requests, logs, or local production
environment files.

Rotate database and external-provider credentials every 90 days and immediately after
suspected exposure or an operator access change:

1. Create the replacement credential.
2. Update the matching SecureString under
   `/shipshit/production/cornershopdev/`.
3. Deploy the exact reviewed image and verify readiness.
4. Revoke the old credential only after production is healthy.
5. Record the date, owner, affected environment, and verification result without
   recording the credential value.

For `RESEND_API_KEY` or `OPERATOR_ALERT_EMAILS`, keep the old delivery path
active while the replacement is configured, dispatch all due rows, deploy and
confirm alerting readiness, then revoke the old key. For database rotation,
re-run the non-secret environment-isolation command after both environments are
updated. For S3 credentials or policies, re-run the cleanup-safe round trip in
Preview first and Production only with explicit approval.

## Deployment

A published stable GitHub release builds the Docker image without
production secrets, uploads the immutable image archive to the private
deployment bucket, and assumes the repository-scoped AWS OIDC role. Merging to
`main` and manually dispatching CI never deploy automatically. Publish the
release only after the scoped IAM policy, SSM parameters, host bootstrap, and
DNS prerequisites are reviewed and ready. The role may upload only
Cornershopdev artifacts and send only `AWS-RunShellScript` commands to the
production instance. See `production-release.md` for the complete state model
and exact gates.

The candidate image installs dependencies and runs migrations/operator commands
with Bun 1.4.0, but both the Next.js production build and standalone web server
run on the fully pinned Node.js 24.20.0 LTS Alpine image. CI starts the exact
candidate image, confirms both runtime versions and the Node PID 1 executable,
then exercises public, sign-in, Better Auth session, and unauthenticated
dashboard responses before a release can use that image.

The host deployment script:

1. Loads Cornershopdev parameters from SSM without printing them.
2. Starts or verifies the isolated Redis container.
3. Loads the exact image artifact and starts a candidate.
4. Waits for `/api/health/ready`.
5. Verifies migrations, outreach configuration, and wildcard DNS in the exact
   candidate.
6. Swaps container names, reloads Caddy, verifies public on-demand TLS, and
   rolls back on failure.

The authorization migration intentionally changes the signed session payload
from an email address to the immutable database user id. Existing browser
sessions are invalidated once on rollout; affected customers sign in again by
requesting a new magic link.

Route53 sends `cornershop.dev`, `www.cornershop.dev`, and
`domains.cornershop.dev` to the EC2 Elastic IP. Caddy owns TLS termination.
Customer domains use on-demand TLS, gated by
`/api/domains/authorize`; unverified hostnames cannot cause certificate
issuance.
