# Cornershopdev

Cornershopdev is a multi-vertical local-business website factory. Each
configured niche supplies its own discovery queries, catalog/conversion
signals, content schema, preview generator, storefront identity, and provider
adapters. A business keeps the operational tools it already uses and reviews a
private prefilled preview. Claim, subscription, custom domains, monitoring,
leads, and articles are per-vertical capabilities, not a universal lifecycle.

## Vertical capabilities

These axes are independent. Factory visibility is not a standalone niche
launch. A claim mode is not owner publish. Rendering an already-published
snapshot is not the same as creating one. Custom domains, source monitoring,
leads, and articles are owner-operation flags resolved through
`resolveOwnerOperations` and fail closed against claim and publication-mutation
gates.

| Vertical | Factory visibility | Standalone launch | Claim mode | Owner mutation | Platform publication | Custom domains | Monitoring | Leads | Articles |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Restaurant | public | launched | niche | enabled | enabled | enabled | enabled | enabled | enabled |
| Beauty | public | unlaunched | disabled | unsupported | enabled | unsupported | unsupported | unsupported | unsupported |
| Food Retail | private | unlaunched | factory | enabled | enabled | enabled | enabled | not-yet | not-yet |
| Local Service | private | unlaunched | factory | enabled | enabled | enabled | enabled | not-yet | not-yet |

- **Factory visibility** — `marketing.publiclyAccessible`: the shared
  `/niche/[vertical]` route.
- **Standalone launch** — `verticalLaunchReadiness`: public access, canonical
  domain, matching routed hostname, and verified niche sender.
- **Claim mode** — `disabled`, `factory` (Cornershopdev sender and
  `<slug>.cornershop.dev`), or `niche` (the vertical's own domain and sender).
- **Owner mutation** — publish and rollback. Requires
  `publicationMutationEnabled` and a supported owner-review dashboard.
- **Platform publication** — `publicationEnabled`: already-published snapshots
  may still render when owners cannot create new ones.
- **Custom domains / Monitoring / Leads / Articles** — owner-operation states
  (`enabled`, `not-yet`, `gated`, `unsupported`).

Restaurant, Food Retail, and Local Service also enable billing, publication
history, workspace switching, and the reviewed photo library. Beauty leaves
every paid owner operation unsupported. It is a non-chargeable factory
preview, not a sellable niche.

## Product flow

Shared import path, used by every registered vertical:

1. Paste a source URL or name into that vertical's intake.
2. Import public website content with SSRF-safe fetching and bounded HTML reads.
3. Deterministically recover structured business facts, hours, bounded catalog
   candidates, relevant navigation, authentic source assets, and field-level
   provenance before any model is considered.
4. Recover source logos/favicons and CSS/meta brand colours, repairing contrast
   where necessary before the palette reaches a renderer.
5. Detect the source language and preserve it as canonical. When OpenRouter is
   configured, generate a complete English translation in the structured pass
   unless the vertical is `deterministic-only`.
6. Preserve first-party photography and optionally enhance exposure, colour,
   crop, noise, and clarity without changing material scene content. Each
   vertical lists its own forbidden elements.
7. Save a private preview through a durable PostgreSQL-backed Workflow.

What happens after preview depends on the matrix above:

- **Restaurant (`niche`)** — verify ownership through a one-time
  business-domain email invitation or a concierge-approved owner email; claim
  through invitation-bound Stripe Checkout; authorize a custom domain for
  on-demand TLS; monitor the menu, imagery, and links; review first-party
  booking leads; publish articles.
- **Food Retail and Local Service (`factory`)** — an approved preview can
  claim the shared $49 Cornershopdev plan and publish on
  `<slug>.cornershop.dev`. Custom domains and source monitoring are enabled.
  Owner analytics, lead inbox, and articles are not-yet.
- **Beauty (`disabled`)** — the factory `/niche/beauty` preview stays
  non-chargeable. Claim, owner mutation, billing, custom domains, monitoring,
  leads, and articles are unsupported.

## Customer workspace and operator console

Each claimed site has a tenant-scoped `/dashboard` workspace. Owners only get
the operations their vertical enables. Contact details are returned only after
the session is revalidated against that site's organization membership.
Restaurant can review first-party booking leads and move each request from
`NEW` to `CONTACTED` or `CLOSED`. Food Retail and Local Service do not expose
a lead inbox yet. Beauty has no owner-review dashboard.

`/admin` is the platform operator console. It requires both a database
`SUPERADMIN` role and an email listed in `SUPERADMIN_EMAILS`. It shows signups,
subscriptions, request totals, portfolio traffic and conversion summaries, and
bounded per-site operational rows. The private owner/outreach recipient is
stored separately from the sourced public business email and is visible only in
this dual-gated console. Lead creation never sends mail: an operator must review
the persisted preview, record a verified written-consent or soft-opt-in channel
basis with exact recipient, controller, email channel, claim/follow-up purpose,
timestamp, and private evidence reference, and confirm the exact niche-branded
recipient. Soft opt-in additionally requires customer/sale and collection
opt-out proof. The controller must exactly match `OUTREACH_LEGAL_CONTROLLER`,
and future-dated evidence is rejected. A public listing, generic corporate
rationale, value-first offer, or bare `ELIGIBLE` flag never authorizes
electronic outreach. Operators can pause all outreach or one lead before its
next send. Initials, follow-ups, and operator replies recheck current evidence,
mutable/unclaimed state, and bounce/complaint/provider suppression immediately
before provider delivery. Inbound replies and suppression webhooks use the same
transactional delivery fence, so they cannot commit in a post-check send gap.

## First-party analytics

Analytics run only on verified customer domains. Factory pages, private preview
routes, bots, and automated browsers are excluded. The browser creates an
ephemeral visit UUID in `sessionStorage` and sends only:

- event UUID
- visit UUID
- site view or CTA click
- server-owned site identity derived from the verified request hostname
- server timestamp

Raw analytics events never store IP addresses, user-agent strings, referrers,
paths, query strings, provider URLs, names, email addresses, phone numbers, or
booking notes. A one-minute Redis limiter may use a transient hash derived from
the connection address; it is not written to PostgreSQL.

Booking requests remain the authoritative lead count for verticals that enable
the lead inbox, so a dropped analytics beacon cannot lose a real lead. The
corresponding `LEAD_CREATED` event is server-owned and best effort. Restaurant
owner workspaces and the operator console expose 7, 30, and 90-day
distinct-visit, CTA-visitor, booking-lead, and conversion metrics. Food Retail
and Local Service mark owner analytics as not-yet; Beauty has no owner
analytics. Raw analytics events are retained for 120 days and pruned daily
under a PostgreSQL advisory lock.

## Restaurant themes

New restaurant previews use a versioned theme registry driven by service model,
primary customer intent, menu experience, brand traits, price position,
location count, and photography quality:

- `terroir-editorial@1` — reservation-led, seasonal and editorial
- `counter-service@1` — external-order-led commerce browsing
- `after-dark@1` — atmospheric reservations, events and late-night visits

The public registry and live renderer power `/themes/restaurant`. AI may choose
only these IDs plus a closed set of validated colour and presentation tokens,
plain-text reasons, confidence, and two alternatives. Unknown IDs, arbitrary
CSS/HTML/classes/components/font URLs, malformed tokens, and low-contrast
colour combinations are rejected or repaired before rendering. Missing or
invalid model output uses the deterministic scorer.

The six earlier cuisine-era templates (`heritage`, `fresh`, `bold`,
`nocturne`, `coastal`, and `warm`) remain as a compatibility renderer. A stored
restaurant without a valid structured selection keeps its existing layout;
theme adoption is never inferred from a deployment.

Dish imagery is a saved presentation setting rather than a destructive edit.
Heritage and fine-dining templates default to a clean text-led menu; casual,
fresh, coastal, and bold concepts default to a small highlights gallery. Owners
can show or hide the gallery from the dashboard without deleting any images.

## Beauty vertical

`BEAUTY` is a non-chargeable factory preview. `/niche/beauty` is publicly
accessible, but it has no standalone domain or sender, and `claimMode` is
`disabled`. Already-published snapshots remain renderable. Owner mutation,
billing, custom domains, monitoring, leads, articles, and the photo library
are unsupported. There is no owner-review dashboard.

## Food retail vertical

`FOOD_RETAIL` is a bounded vertical for bakeries, pâtisseries, butchers,
delis, cheesemongers, grocers and similar local food shops. It reuses the shared
site/catalog/integration engine but deliberately does not inherit table
reservations or restaurant lead capture. Its primary conversion action is an
existing preorder, click-and-collect, ordering or delivery link.

The schema supports product ranges, store hours, location and sourced pickup
details, seasonal availability, preorder notes, approved product photography,
and allergens only when an exact source URL is stored with the label. Unknown
products, prices, stock, pickup promises and allergens remain empty. English and
French storefront copy and translation overlays are included.

FOOD_RETAIL model output is presentation-only: a post-generation evidence
adapter restores business identity, contact details, hours, products, prices,
ordering links and factual product attributes from deterministic crawl output.
Unsupported model claims remain empty or null.

The vertical is factory-claimable but not publicly launched: marketing
hostnames are empty, domain and sender are null, and `publiclyAccessible` is
false. Claim mode is `factory`. Already-published snapshots render, and owners
with the food-retail dashboard may publish and roll back. Custom domains,
source monitoring, and the photo library are enabled. Owner analytics, lead
inbox, and articles are not-yet. See the capability matrix above and
[`docs/verticals/food-retail.md`](docs/verticals/food-retail.md).

## Local-service vertical

`LOCAL_SERVICE` is the bounded vertical for plumbers, electricians, builders,
repair trades, and artisans. It reuses the shared site/catalog/integration
engine while modeling services, service areas, explicit availability posture,
credentials and insurance evidence, trust signals, completed projects, hours,
and phone, WhatsApp, quote, or existing scheduling links.

Its deterministic no-model path recognizes sourced Schema.org trade subtypes
and preserves source language, logo/favicon, accessible brand palette, contact
details, hours, same-origin navigation, structured services, prices, and
evidence. Missing emergency coverage, credentials, insurance, trust claims,
projects, prices, or availability remain unstated rather than being inferred.

The vertical is registered for private imports, previews, and revision-safe
owner editing. Factory claim, publication, custom domains, source monitoring,
and the photo library are enabled. Public niche access and standalone launch
stay closed until a real domain, exact routed hostname, and matching verified
sender satisfy `verticalLaunchReadiness`. Owner analytics, lead inbox, and
articles are not-yet. See the capability matrix above and
[`docs/verticals/local-service.md`](docs/verticals/local-service.md).

## Internationalization

Site data uses one canonical source locale plus structured translation
overlays. Prices, currencies, images, addresses, provider names, and external
booking or ordering URLs remain shared, so translating a site cannot fork its
operational data. Catalog sections, items, descriptions, vertical-specific
labels, and link labels keep the same order and count in every locale.
If an existing provider URL already exposes a `lang` parameter, the rendered
link updates only that preference while preserving the same provider and flow.

Imports read the document language when available. Non-English sources receive
an English translation in the same schema-validated OpenRouter generation.
Restaurant templates and interface copy use small server-side dictionaries.
The canonical site is available at `/preview/[slug]`; translations use
`/preview/[slug]/[locale]` and expose language alternates in metadata.

## Stack

Package majors below match `package.json`. Runtime image pins live in the
Dockerfile.

- Next.js 16 App Router and React 19
- Bun 1.4.0 for installs, Prisma/Workflow migrations, and operator tooling;
  pinned Node.js 24.19.0 LTS for Next.js builds and the production standalone
  server
- Tailwind CSS v4 and shadcn/ui
- Prisma 7 with PostgreSQL and the `pg` driver adapter
- Vercel AI SDK 7 with OpenRouter for structured text generation and optional
  source-photo enhancement
- Workflow DevKit with its self-hosted PostgreSQL World
- Amazon S3 and CloudFront for persistent enhanced derivatives
- Redis for public preview rate limits
- Stripe subscriptions
- Resend passwordless sign-in links
- Caddy on-demand TLS for verified customer domains

## Local setup

```bash
cp .env.example .env.local
bun install
bun run dev
```

The marketing site and deterministic preview flow work without external credentials. Production integrations activate when their environment variables are configured.

Do not run migrations against production from a local machine. Create the
database, then apply the committed migrations through the reviewed release
environment:

```bash
bun run db:migrate:status
bun run db:migrate:deploy
```

Preview and production service isolation, readiness checks, backups, restores,
and credential rotation are documented in
[`docs/operations/platform-services.md`](docs/operations/platform-services.md).
The one-price offer, evidence gates, founder-cost worksheet, second-lead
qualification, and 30-day decision record for the first paid restaurant are in
[`docs/operations/first-customer-validation.md`](docs/operations/first-customer-validation.md).
The read-only production evidence command and its fail-closed manifest are in
[`docs/operations/first-customer-production-exercise.md`](docs/operations/first-customer-production-exercise.md).
The bearer-authenticated `/api/health/ready` route verifies PostgreSQL, Redis,
Amazon S3, billing, and the operator-alert outbox without returning secret
values. Each application
instance coalesces concurrent checks and caches their aggregate result for five
seconds.

## Required production configuration

### Database

- `DATABASE_URL`

### Platform readiness

- `HEALTHCHECK_TOKEN`

Use distinct, randomly generated values with at least 32 bytes for Preview and
Production. Readiness callers send the value as a bearer token; the endpoint
fails closed when it is absent or invalid.

### AI generation

Source crawling, same-origin page discovery, SSRF checks, and source
reconstruction run locally without a model. JSON-LD, metadata, explicit contact
links, semantic address markup, source navigation, logos/favicons, and CSS/meta
colours are recovered with bounded parsers. Every accepted fact keeps its source
URL, extraction method, and excerpt; evidence values are capped before draft
validation and malformed email candidates are skipped. Same-origin navigation
is persisted as safe internal hrefs, including for HTTP-only source sites.
Structured menu/product/service candidates
are accepted only when deterministic schema evidence exists. Each JSON-LD
entity keeps its owning page URL for provenance and relative asset resolution;
catalog availability remains unknown unless the source explicitly states it.

The persisted draft keeps the repaired palette, logo, favicon, contact details,
hours, canonical language, source navigation, authentic asset URLs, and the
evidence records used to recover them. Customer renderers consume that same
brand data. OpenRouter is optional and used to normalize or enrich the recovered
content into a structured vertical draft:

- `OPENROUTER_API_KEY`
- `OPENROUTER_TEXT_MODEL` defaults to `openrouter/auto`

OpenRouter Auto selects a compatible language model per import. Structured output
is schema validated before it is persisted.

Optional image enhancement runs through the same key and the same provider. The
model must expose `image` output and pass the photo policy's economical-model
allow-list; the default does.

- `OPENROUTER_IMAGE_MODEL` defaults to `google/gemini-3.1-flash-image`
- `PHOTO_ENHANCEMENT_MODEL` pins the validated batch model
- `PHOTO_ENHANCEMENT_ESTIMATED_COST_MICROS`,
  `PHOTO_ENHANCEMENT_PER_IMAGE_CEILING_MICROS`, and
  `PHOTO_ENHANCEMENT_PER_SITE_CEILING_MICROS` reserve the full per-image ceiling
  before provider work; reported overruns fail closed and disable more enhancement
- `PHOTO_DISCOVERY_MAX_IMAGES`, `PHOTO_INGEST_CONCURRENCY`,
  `PHOTO_ENHANCEMENT_CONCURRENCY`, and `PHOTO_ENHANCEMENT_BATCH_MAX_IMAGES`
  bound crawl/storage/provider fan-out

Without `OPENROUTER_API_KEY` an import still completes with the reconstructed
business identity, branding, contact details, hours, integrations, and any
bounded structured catalog candidates. Hero enhancement is skipped.

- `WORKFLOW_ENABLED=true`
- `WORKFLOW_TARGET_WORLD=@workflow/world-postgres`
- `WORKFLOW_POSTGRES_URL`

With workflow execution enabled, each server instance participates in a
database-backed due dispatcher. Active founding subscriptions are checked every 30 days. The due slot and run state are
persisted before a bounded Workflow run starts, so restarts and duplicate
dispatchers are safe. Past-due/canceled subscriptions and paused sites perform
no source fetches. Findings enter the owner/operator review queue and never
mutate a draft or published version automatically.

### Authentic image enhancement

Configure the private production S3 bucket and its CloudFront public origin:

- `AWS_REGION`
- `S3_BUCKET`
- `S3_PUBLIC_BASE_URL`

Cornershopdev never creates a photograph from text. The crawler deterministically
discovers a bounded set of photo references on the business's own pages, filters
logos and decorative assets, copies validated bytes to content-addressed immutable
storage, and deduplicates them by SHA-256. Owners may also upload a file or add an
HTTPS reference. Source page, provenance, candidate classification, review state,
selection, original, and enhanced derivative remain durable records.
Approved gallery selections are projected into the private draft and copied into
an immutable published version; restoring an original updates preview first and
reaches the live site only after the owner publishes again.

Allowed edits are exposure, white balance, highlight and shadow recovery,
denoising, sharpness, resolution, straightening, subtle cropping, and removal of
transient non-material distractions such as sensor dust. Material scene
elements must not be added, removed, replaced, moved, or regenerated. Each
vertical lists its own forbidden subjects — food and plating for restaurants,
product and packaging for food retail, skin/hair/nail and treatment results
for beauty. Only approved
originals enter a rate- and concurrency-limited batch. Originals remain active
until the owner approves the before/after derivative, and every approve, reject,
selection, restore, failure, and cost result is audited. See
`docs/operations/photo-ingestion.md` for the full safety and recovery contract.

### Preview abuse protection

Configure the isolated Redis service:

- `REDIS_URL`

Public imports are limited to five preview generations per IP address per hour.
Production fails closed when Redis is not configured, preventing an unbounded AI
generation endpoint.

### Billing

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_ID` (the one USD 49 monthly founding Price)

Configure the webhook endpoint as:

```text
https://cornershop.dev/api/webhooks/stripe
```

Test-mode verification, the exact event allowlist, retry/replay behavior,
Customer Portal setup, and the production activation blockers are documented
in [`docs/operations/stripe-billing.md`](docs/operations/stripe-billing.md).
Checkout requires a valid hashed claim invitation; a public preview URL alone
cannot authorize billing or ownership. Launch Checkout offers only the founding subscription; the deployment-time Stripe
preflight proves that it is the active, tax-exclusive USD 49.00 monthly Price.

### Owner sign-in

- `CLAIM_TOKEN_SECRET` with at least 32 random characters
- `BETTER_AUTH_SECRET` with at least 32 random characters, dedicated to session
  signing and distinct from `CLAIM_TOKEN_SECRET` in production
- `RESEND_API_KEY`
- `EMAIL_FROM`

### Operator alerts

- `OPERATOR_ALERT_EMAILS`
- `RESEND_API_KEY`

Checkout webhook, publication, and public-site health failures use a durable,
deduplicated outbox with bounded delivery retries. Deployment and exercise
instructions are in
[`docs/operations/platform-services.md`](docs/operations/platform-services.md).

### Niche outreach

- `RESEND_API_KEY`
- `RESEND_WEBHOOK_SECRET`
- `RESEND_INBOUND_WEBHOOK_SECRET` (must be present and different from the
  delivery webhook secret)
- `GOOGLE_PLACES_API_KEY` or an approved non-public
  `LEAD_DISCOVERY_NOMINATIM_BASE_URL` (the public OSMF endpoint is blocked)
- `WORKFLOW_ENABLED=true`
- the complete `WORKFLOW_POSTGRES_*` contract listed above

Before release, run the read-only outreach preflight inside the reviewed
container. It checks the committed outreach and private-contact migrations,
registered Restofront sender and reply-to plus every other launched niche
identity, Workflow/database configuration, verified Resend sending/receiving
domains, both distinct endpoint-specific signing secrets, and the enabled
delivery and inbound webhooks. It also fails closed unless a commercial or
self-hosted lead-enumeration provider is configured. It prints only check
names, booleans, public endpoints, niche names, and timestamps; it never
prints secret values and never sends an email.

```bash
bun run operator:preflight-outreach --environment production
```

### Customer domains

- `PUBLIC_APP_IP`
- `CUSTOM_DOMAIN_CNAME`
- `PLATFORM_HOSTNAMES`

The application records the hostname and returns the production A or CNAME
target. After DNS resolves, the owner verifies it in the dashboard. Caddy issues
TLS only when its authorization callback confirms that the domain is verified
and belongs to a claimed site. Custom-domain owner operations stay closed for
verticals whose `customDomain` capability is not enabled.

### Production routing

The app is single-origin. Caddy on the EC2 application host terminates TLS for
every ingress the factory operates — `cornershop.dev`, `www`, `api`, `domains`,
each claimed site's platform subdomain, and each customer storefront via
on-demand TLS — and reverse-proxies all of them to the one application
container. Restaurant sites use `<slug>.restofront.com`; verticals without a
launched niche domain fall back to `<slug>.cornershop.dev`. Wildcard DNS and TLS
are release gates, not assumptions.

The production state model, exact release procedure, deployed-SHA evidence, and
current external blockers are documented in
[`docs/operations/production-release.md`](docs/operations/production-release.md).

Leave `CORNERSHOPDEV_API_ORIGIN` empty. It exists for a future split deployment,
where it makes `next.config.ts` proxy `/api/*` to a separate API origin. Setting
it on a single-origin host proxies `/api/*` to a hostname that resolves back to
this same container, where the rewrite fires again — an infinite loop.

## Security boundaries

- Import URLs are limited to HTTP(S), DNS-resolved before every redirect, and rejected when any address is local or private.
- HTML responses are content-type checked, timeout bounded, and capped at 1.5 MB.
- AI output is validated with Zod before it enters the product.
- Existing booking and ordering links are extracted from source material and override model-generated links.
- Stripe webhooks verify the raw body signature.
- Claims require a hashed, expiring invitation bound to one site, intended
  email, and Stripe Checkout session, and only for verticals whose claim mode
  is enabled. Raw invitation tokens are kept in URL fragments so embedded
  preview assets cannot receive them as referrers.
- Self-serve claims require the exact imported business email or an address on
  the exact source hostname. Ambiguous ownership requires a dual-gated
  superadmin approval from the operator console.
- Claim invitation requests and checkout attempts use isolated Redis rate-limit
  buckets and fail closed in production. Creation, verification, checkout,
  acceptance, and rejection events are recorded without tokens or contact data.
- Better Auth owns revocable, database-backed dashboard sessions behind a
  signed HTTP-only, same-site cookie.
- Site mutations require a session matching the site slug and current
  organization membership. Routes are vertical-aware: publish/rollback, domain
  management, photo library, source monitoring, analytics, articles, and the
  lead inbox still fail closed when that vertical's owner operation is not
  enabled.
- Image enhancement and domain management require that same site-scoped session.
- Public preview generation is rate limited and fails closed in production.
- Enhanced derivatives are persisted to private S3 storage and served through CloudFront while authentic originals and provenance remain available.
- Arbitrary site images load directly in the browser instead of through the Next.js image proxy.

## Useful routes

- `/` — marketing and URL intake
- `/niche/[vertical]` — factory niche page for publicly accessible verticals
- `/create` — import and preview studio
- `/claim/[slug]` — pricing and claim checkout, when that vertical's claim mode is enabled
- `/dashboard` — authenticated vertical-aware owner management
- `/dashboard?demo=1` — local demo dashboard
- `/admin` — dual-gated superadmin operator console
- `/api/analytics/events` — first-party cookieless live-site event intake
- `/preview/[slug]` — private full-screen site preview
- `/preview/[slug]/[locale]` — translated site preview
