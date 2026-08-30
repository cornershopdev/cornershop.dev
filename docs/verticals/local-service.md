# Local-service vertical

`LOCAL_SERVICE` is the bounded local-trade implementation for plumbers,
electricians, builders, repair businesses, and artisans. It is registered in
the existing vertical registry and uses the shared crawler, import workflow,
site tables, renderer, owner editing, domain routing, and
source-monitoring engine. Owner analytics, lead inbox, and articles are
not-yet. It does not fork the app and it
does not accept model-authored HTML, CSS, class names, or components.

## Data contract

The generic site columns continue to own name, address, phone, source URL,
images, palette, locale, translations, hours, catalog sections, and external
integrations. Trade-only facts stay in the existing validated JSON attribute
bags:

| Concern       | Bounded representation                                                                                   |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| Trade         | `plumber`, `electrician`, `builder`, `repair`, `artisan`, or `general-trades`                            |
| Services      | Shared catalog sections and items; per-service pricing posture, optional unit, and emergency eligibility |
| Service areas | Up to 24 explicit place names; no inferred radius                                                        |
| Availability  | Closed posture enum with `not-stated` as the deterministic default                                       |
| Credentials   | Up to 16 name/issuer/reference records                                                                   |
| Insurance     | `not-stated`, `insured`, or `not-insured`, plus one bounded evidence detail                              |
| Trust signals | Up to 16 label/evidence records                                                                          |
| Projects      | Up to 24 title/description/location/HTTPS-or-local-image records                                         |
| Conversion    | Shared phone plus `contact`, `quote`, `booking`, and `social` HTTPS integrations                         |
| Hours         | Shared bounded business-hours rows                                                                       |

Integration allowlists are vertical-owned even though storage uses one enum:
Restaurant retains booking/ordering/delivery/social, Beauty accepts only
booking/social, Food Retail accepts only ordering/delivery/social, and
LOCAL_SERVICE accepts only quote/contact/booking/social. The shared renderer
applies the same allowlist as defence in depth before exposing any link.

The model prompt forbids invented services, service areas, emergency response,
credentials, licences, insurance, guarantees, project outcomes, WhatsApp
numbers, quote tools, and prices. Deterministic imports default every trust and
availability field to empty or `not-stated`.

Prompt instructions are not the trust boundary. LOCAL_SERVICE declares the
`deterministic-only` draft-generation strategy, so `generateSiteDraft` skips
text generation even when OpenRouter is configured. This avoids sending source
content to a model and avoids model latency and cost. The
`bindGeneratedLocalServiceDraftToEvidence` hook remains a defence-in-depth
boundary for direct callers and tests: it replaces identity, locale, branding,
contact details, hours, integrations, catalog/services, prices, availability,
emergency posture, areas, credentials, insurance, trust signals, and projects
with the deterministic reconstruction. LOCAL_SERVICE does not yet have
`current`/`stale`/`draft` translation review state, so generated translation
overlays are discarded rather than stored with an implied approval. They may be
introduced only alongside explicit owner review and publication gates.

Template headings identify the trade subtype and the source of the displayed
information only. They do not imply credentials, safety, quality, covered
services, completed work, or outcomes. Structured opening hours are emitted
only when display rows can be converted to canonical Schema.org day and time
tokens; ambiguous rows remain visible to customers but are omitted from JSON-LD.

The current importer reconstructs service rows only from supported structured
Schema.org `Service`, `Offer`, and `OfferCatalog` evidence. Unstructured service
cards, price tiles, prose-only project galleries, and visual harmonization are
not claimed by this vertical yet; those inputs remain bounded page text or
source assets rather than being promoted into factual catalog/project fields.

## Rendering and SEO

The shared renderer consumes a vertical-neutral `businessDetails` projection.
It renders phone, WhatsApp/contact, and quote actions; service pricing badges;
availability posture; service areas; credential and trust lists; completed
projects; business hours; and external tools. It explicitly disables the
restaurant/appointment booking-request form for local trades.

Published local-service sites emit escaped JSON-LD using the narrowest supported
Schema.org subtype (`Plumber`, `Electrician`, `GeneralContractor`,
`HomeAndConstructionBusiness`, or `ProfessionalService`). Structured data may
include services, service areas, hours, credentials, phone, social profiles,
and contact/quote actions only when those facts exist in the validated draft.
Private previews remain `noindex` and emit no structured data.

## Owner editing and persistence

The tenant-scoped dashboard loads the same validated nested draft used by the
preview path. Owners can edit business copy, phone, address,
hours, trade and availability posture, service areas, insurance evidence,
credentials, trust signals, services, projects, and external tools. Save uses
the existing optimistic draft revision, organization membership, same-origin
mutation, relation-replacement, and audit boundaries. Publication and rollback
use the shared billing, same-origin, optimistic-revision, immutable snapshot,
and audit boundaries. The editor saves before publication and requires a
3–280 character change summary plus explicit confirmation.

## Capability row

Matches the README matrix and `resolveOwnerOperations(LOCAL_SERVICE)`:

| Vertical | Factory visibility | Standalone launch | Claim mode | Owner mutation | Platform publication | Custom domains | Monitoring | Leads | Articles |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Local Service | private | unlaunched | factory | enabled | enabled | enabled | enabled | not-yet | not-yet |

Owner photo library is enabled. Owner analytics, lead inbox, and articles stay
`not-yet`. The renderer disables the restaurant booking-request form.

## Launch gate

Tradefront has no standalone niche storefront. Its marketing config therefore
keeps hostname, domain, and niche sender empty, while `claimMode: "factory"`
allows an approved private preview to use Cornershopdev's verified sender,
shared €49 checkout, and `<slug>.cornershop.dev` public URL.
`publicationEnabled` and `publicationMutationEnabled` are both true for that
factory path. A future standalone niche still must satisfy
`verticalLaunchReadiness`:

1. a configured public domain;
2. that exact domain registered in the proxy hostname list;
3. a configured sender and reply-to address;
4. both mail domains equal to, or subdomains of, the niche domain.

The factory claim lane does not enable model generation or bypass review.
Standalone DNS, sender verification, and committed niche config remain one
separate release gate.

## Verification evidence

Focused tests cover:

- fixture and schema round-tripping;
- field bounds and project-image URL safety;
- conservative deterministic defaults;
- malicious model output stripped back to source-backed or conservative values,
  including generated factual translations;
- provider classification for WhatsApp and quote tools;
- registry, slug, asset namespace, and launch-readiness behavior;
- LocalBusiness subtype, services, areas, hours, actions, and script escaping;
- existing restaurant and beauty vertical compatibility.
- a realistic French plumber HTML source through reconstruction, deterministic
  draft generation, and the shared preview renderer, including sourced subtype,
  language, logo/favicon, palette, contact details, hours, navigation, services,
  pricing evidence, and the absence of invented emergency/trust claims;
- deferred owner-save reconciliation that advances the server revision without
  overwriting newer local edits;

Run the complete repository gates on the Mac Studio and in required GitHub CI:

```bash
bunx next typegen
bunx tsc --noEmit
bun run lint
bun test
bun run build
```

Do not run a local Vercel command or deploy this vertical directly. Production
deployment remains release-driven after merge, and the local-service niche must
remain unlaunched until the launch gate above is genuinely satisfied.
