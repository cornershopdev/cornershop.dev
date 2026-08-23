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
- weekly Dependabot version checks for the Bun/npm, Docker, and GitHub Actions
  ecosystems from `.github/dependabot.yml`;
- secret scanning and push protection;
- CodeQL default setup for Actions and JavaScript/TypeScript, using the default
  query suite on GitHub-hosted runners with a weekly schedule.

Default CodeQL setup owns its generated workflow. Do not add a competing CodeQL
workflow unless default setup becomes unavailable and a separately reviewed
advanced configuration is required. Never retrieve or paste security alerts as
governance evidence; record only feature enablement and scan/run status.

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
