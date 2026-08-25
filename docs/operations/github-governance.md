# GitHub delivery governance

**Last audited:** 2026-08-23

**Frozen audit base:** `cb3894977a5bd1c2ac6139e51f5f9d574d79eee4`

This runbook defines the effective merge, security, and work-readiness contract
for `cornershopdev/cornershop.dev`. Repository settings are live configuration;
this document is the durable review record and must be updated when those
settings change.

## Effective default-branch gate

Every pull request to `main` must be current with `main` and have successful
exact-head results from the GitHub Actions app for all three contexts:

- `verify`
- `container-runtime`
- `first-customer-browser-e2e`

The classic `main` protection and the active `Passing CI on main`
ruleset intentionally encode the same three strict checks. The ruleset also
requires a pull request, linear history, and resolved review threads, and has no
bypass actors. Classic protection enforces the same linear-history and
conversation-resolution requirements for administrators. The separate
`Protect default branch` ruleset prevents deletion and non-fast-forward updates.

| Control | Frozen audit state | Effective contract |
| --- | --- | --- |
| Classic required checks | `verify`, `container-runtime`; strict | All three checks; strict |
| Ruleset required checks | `verify`; non-strict | All three checks; strict |
| Browser E2E | Green but optional | Required and app-bound |
| Linear history | Ruleset only | Ruleset and classic protection |
| Review threads | Ruleset only | Ruleset and classic protection |
| Bypass | No ruleset bypass; classic admins exempt | No bypass, including administrators |
| Merge methods | Merge, squash, and rebase exposed | Squash only |
| Update branch | Disabled | Enabled |
| Auto-merge | Disabled | Enabled; never bypasses required checks |
| Merged head cleanup | Disabled | Automatic branch deletion |

Squash commits use the pull-request title and body. Rebase and merge commits are
disabled at repository level so the UI exposes one method that is compatible
with the linear-history rule. Enabling auto-merge is permission to queue an
eligible pull request, not permission for an agent to merge one.

When auditing protection, read both sources. A green check that appears in only
one source is not enough, and changing one source must not leave the other with
a weaker or contradictory policy.

## Native security controls

The repository uses GitHub-native controls without a custom CodeQL workflow:

- dependency graph and Dependabot alerts;
- Dependabot security updates;
- weekly Dependabot version checks for the Bun, Docker, and GitHub Actions
  ecosystems from `.github/dependabot.yml`;
- secret scanning and push protection;
- CodeQL default setup for Actions and JavaScript/TypeScript, using the default
  query suite on GitHub-hosted runners with a weekly schedule.

Default CodeQL setup owns its generated workflow. Do not add a competing CodeQL
workflow unless default setup becomes unavailable and a separately reviewed
advanced configuration is required. Never retrieve or paste security alerts as
governance evidence; record only feature enablement and scan/run status.

### Dependency update and audit policy

Routine version maintenance is deliberately bounded. Dependabot checks the Bun,
Docker, and GitHub Actions ecosystems weekly. Within each ecosystem, one wildcard
allow rule admits only SemVer patch and minor version updates, one group combines
those routine updates, and `open-pull-requests-limit: 1` permits at most one open
version-update pull request. The group explicitly applies only to version
updates. GitHub documents that `allow.update-types` and the open pull-request
limit do not suppress or consume supported security-update pull requests, so no
wildcard major-ignore rule is needed. See GitHub's
[Dependabot options reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference).

GitHub's current
[Dependabot ecosystem matrix](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories)
supports version updates for the text `bun.lock` format from Bun 1.1.39 onward,
but does not support Bun security-update pull requests. The root entry therefore
uses `package-ecosystem: bun`, while `.github/workflows/dependency-audit.yml`
provides the missing lockfile-native vulnerability detection. It runs for
relevant dependency and workflow changes — including `.npmrc`, which can
reroute registry advisory lookups — on pull requests and `main` pushes,
daily at 04:17 UTC, and on manual dispatch. The job installs Bun 1.3.14, validates
that `package.json` and `bun.lock` agree with a frozen install while lifecycle
scripts are disabled, then runs the exact unfiltered audit with Bash pipefail.
Any reported vulnerability or registry request failure fails the job, while the
raw JSON is still retained as a workflow artifact.

Per the [Bun audit documentation](https://bun.sh/docs/pm/cli/audit), `bun audit`
reads the package list from `bun.lock` and sends its package names and versions
to npm's advisory endpoint; packages assigned to another scoped registry are
sent to that registry instead and can be skipped if it has no advisory endpoint.
This repository's audit is an intentional disclosure of its public
package/version graph to npm. The workflow supplies no source, secrets, customer
data, private-registry credentials, registry configuration, or writable token,
and none may be added to make an audit pass. Complete Bun dependency submission
is owned by `.github/workflows/bun-dependency-snapshot.yml` and is not part of
this audit job.

### Bun lockfile dependency submission

GitHub's automatic dependency submission has no Bun builder, so the live SBOM
endpoint otherwise reports only the repository root, direct `package.json`
entries, and Actions dependencies. `.github/workflows/bun-dependency-snapshot.yml`
parses the committed text `bun.lock` with `scripts/build-bun-dependency-snapshot.ts`
and `src/lib/bun-dependency-snapshot.ts`. It does not run `bun install`, resolve
floating versions, or mutate `package.json` / `bun.lock`.

The workflow default permission is `contents: read`. A `validate` job runs on
path-filtered pull requests, path-filtered `main` pushes, the daily 04:47 UTC
schedule, and `workflow_dispatch`. It reconstructs the snapshot, runs the parser
and permission contract tests, and uploads a `bun-dependency-snapshot` artifact.
The `submit` job is the only job with `contents: write`. It runs only when
`github.ref == refs/heads/main` and the event is `push`, `schedule`, or
`workflow_dispatch`, after `validate` succeeds. Pull requests never receive
write permission and never POST to the dependency-graph API. The workflow uses
the default `github.token` only; no repository, package-registry, customer, or
deployment secrets are in scope.

Idempotency depends on a stable pair that GitHub keeps unique:

- `job.correlator` = `Bun dependency snapshot submit`
- `detector.name` = `cornershopdev-bun-lockfile`

Do not rename the workflow, the `submit` job, or the detector. Repeating the
same lockfile replaces the previous snapshot for that pair; a changed lockfile
replaces it without accumulating stale packages. Failure fails this workflow
only. It is not a required runtime merge check and must not be folded into
`ci.yml`.

To inspect evidence, download the `bun-dependency-snapshot` artifact from the
workflow run and confirm the resolved package count, representative production
transitives, and representative development transitives. After this workflow
reaches `main`, reconcile the live SBOM endpoint
(`/repos/{owner}/{repo}/dependency-graph/sbom`) and record the resulting
package count before closing #153. Do not call live SBOM mutate APIs from a
laptop or from an untrusted pull request.

To roll back, disable the "Bun dependency snapshot" workflow in the Actions
tab or revert the workflow file. The last accepted snapshot remains until
another trusted run submits a replacement with the same correlator and
detector. Do not add `pull_request_target`, registry credentials, or
`contents: write` on the validate/pull-request path.

When the audit fails:

1. Download the `bun-audit-json` artifact and identify each advisory, affected
   locked version, and smallest direct dependency that can carry a fix.
2. Open a focused remediation pull request that updates the manifest and
   `bun.lock` together. Do not filter by severity, ignore an advisory, swallow
   the audit exit status, enable install scripts, or add registry credentials.
3. Re-run the unfiltered audit, focused tests, the full test suite, lint,
   typecheck, and the production build. Merge eligibility still depends on the
   exact-head required checks.
4. If no compatible safe release exists, record the advisory and blocked
   dependency chain in a dedicated issue, choose an explicit replacement,
   override, or major migration, and keep the audit red until the reviewed risk
   is actually removed.

SemVer-major maintenance is always a named migration, never routine automation.
Create a dedicated issue and branch for one dependency or base image, review its
release and migration guidance, update every coupled manifest/lock/runtime pin,
and provide compatibility, rollback, audit, full-test, typecheck, and build
evidence in one ready pull request. A reviewed Actions major follows the same
path. Do not add `version-update:semver-major` to the wildcard allow rule; if a
temporary Dependabot exception is justified, it must name exactly one dependency
and be removed when that scoped migration closes.

Dependabot version updates begin after `.github/dependabot.yml` reaches the
default branch. Security alerts and security updates are repository settings and
do not wait for that file.

At this audit, GitHub accepted enable requests for non-provider secret patterns
and validity checks both alongside base secret scanning and again after base
scanning was active. Both target re-reads still reported `disabled`. They are
therefore unavailable under the repository's current plan/configuration and
must not be reported as enabled. Re-evaluate them only after the GitHub plan or
security-product configuration changes. Private vulnerability reporting also
remains disabled because it is a separate disclosure workflow outside issue
#132's scanning and dependency-alert scope.

## Readiness labels

Each tracked issue receives at most one readiness label. The label classifies
the next executable boundary; it never replaces the issue's acceptance criteria.

| Label | Meaning | Initial issues |
| --- | --- | --- |
| `agent-ready` | Bounded repository work can proceed without new authority. | #124 |
| `human-only` | Requires authorized human or real-customer action. | #20, #47, #52 |
| `external-blocked` | Waits on external runtime, provider, or customer evidence. | #10, #98 |
| `gated` | Must not start until its documented prerequisite gate passes. | #49-#51, #53 |

Issue #20 is the human first-customer acceptance epic. Its unmet runtime and
alerting readiness is tracked in #10. Issue #47 is downstream commercial
validation that reuses evidence from #20; #47 does not block #20. Neither label
nor automation may complete their real payment, owner action, customer-domain,
support-cost, second-lead, or review-date acceptance rows.

## Project placement

The Restofront execution board owns work that contributes to the first paid
restaurant or the self-serve beta:

| Issue | Status | Priority | Area |
| --- | --- | --- | --- |
| #124 | In Progress | P1 — Self-serve beta | Lead operations |
| #132 | In Progress | P1 — Self-serve beta | Quality |

The private Cornershopdev Portfolio remains strategic-only. Issues #49-#53 stay
there as `Todo`; adding #124 or #132 to that board would blur the written revenue
gate. For user-owned Projects, verify membership from the project's item list:
the issue-level `projectItems` connection can appear empty even when the item is
present.

## Change procedure

Before every governance mutation, re-read classic protection, both active
rulesets, repository merge/security settings, both project boards, open pull
requests, and the issues whose readiness or dependency semantics are in scope.
After the mutation, read the same target again and record the smallest
non-sensitive before/after evidence. Never weaken a gate to land a governance
change, and never treat a settings response or automated test as real-customer
acceptance.
