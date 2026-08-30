# Dependency security migration for issue #161

Issue #161 removes every advisory reported by the unfiltered Bun 1.3.14 audit
that blocked dependency-governance PR #160. The remediation does not use
production-only filtering, severity thresholds, ignores, baselines, or advisory
suppression.

## Advisory trace

The failing audit reported 11 advisories across six package names. Each finding
is mapped to the locked parent that introduced it and the remediation below.

| Advisory | Affected resolution | Locked parent chain | Resolution |
| --- | --- | --- | --- |
| [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) | `deepmerge-ts@7.1.5` | `prisma@7.9.1 -> @prisma/config@7.9.1` | Exact `deepmerge-ts@8.0.0` override |
| [GHSA-jmr9-qjv8-65gv](https://github.com/advisories/GHSA-jmr9-qjv8-65gv) | `extract-zip@2.0.1` | `puppeteer-core@24.43.1 -> @puppeteer/browsers@2.13.2`; also `@lhci/cli@0.15.1 -> lighthouse@12.6.1` | Remove LHCI; upgrade to `lighthouse@13.4.1` and `puppeteer-core@25.8.0` |
| [GHSA-28wg-ghj8-5hjv](https://github.com/advisories/GHSA-28wg-ghj8-5hjv) | `nanoid@5.1.6` | `workflow@4.8.4 -> @workflow/core@4.8.4` | Patch the exact parent manifest to `nanoid@5.1.16` |
| [GHSA-52f5-9888-hmc6](https://github.com/advisories/GHSA-52f5-9888-hmc6) | `tmp@0.1.0` | Direct dependency of `@lhci/cli@0.15.1` | Remove LHCI |
| [GHSA-ph9p-34f9-6g65](https://github.com/advisories/GHSA-ph9p-34f9-6g65) | `tmp@0.0.33` | `@lhci/cli@0.15.1 -> inquirer@6.5.2 -> external-editor@3.1.0` | Remove LHCI |
| [GHSA-8xcm-r25x-g524](https://github.com/advisories/GHSA-8xcm-r25x-g524) | `undici@7.28.0` | `@workflow/world-local@4.3.0` and `@workflow/world-vercel@4.7.0` | Patch both exact parent manifests to `undici@7.29.0` |
| [GHSA-4cwx-7wf7-3272](https://github.com/advisories/GHSA-4cwx-7wf7-3272) | `undici@7.28.0` | Same Workflow parents | Same exact parent patches |
| [GHSA-m8rv-5g2x-5cg5](https://github.com/advisories/GHSA-m8rv-5g2x-5cg5) | `undici@7.28.0` | Same Workflow parents | Same exact parent patches |
| [GHSA-jr45-8vmc-qm54](https://github.com/advisories/GHSA-jr45-8vmc-qm54) | `undici@7.28.0` | Same Workflow parents | Same exact parent patches |
| [GHSA-v3r7-h72x-cjcm](https://github.com/advisories/GHSA-v3r7-h72x-cjcm) | `undici@7.28.0` | Same Workflow parents | Same exact parent patches |
| [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) | `uuid@8.3.2` | Direct dependency of `@lhci/cli@0.15.1` | Remove LHCI |

`extract-zip` has no patched release. Upgrading Puppeteer alone would not have
removed Lighthouse 12's Puppeteer 24 chain, so the LHCI parent had to be
replaced. Neither `@lhci/cli` nor `extract-zip` remains in `bun.lock`.

## Resolution policy

Supported upstream upgrades are used wherever they can express the intended
graph:

- `lighthouse@13.4.1` and `puppeteer-core@25.8.0` use
  `@puppeteer/browsers@3.2.1`, whose archive implementation no longer depends
  on `extract-zip`.
- Prisma's only `deepmerge-ts` consumer loads the plain `deepmerge` API through
  `@prisma/config`. The exact `8.0.0` override is graph-wide because this graph
  contains only that one `deepmerge-ts` resolution. A runtime contract loads
  the Prisma config and exercises a nested merge.

Bun 1.3.14 cannot express parent-scoped overrides. A global Nano ID override
would also replace PostCSS's intentional CommonJS-compatible 3.x resolution,
and a global Undici override would collapse the intentional root 8.x and
Workflow 7.x split. The narrow fallback is therefore three reproducible,
manifest-only `patchedDependencies` entries:

| Exact package | Manifest edge | Patch SHA-256 |
| --- | --- | --- |
| `@workflow/core@4.8.4` | `nanoid: 5.1.6 -> 5.1.16` | `e6872431c9b82f5ce2115e6a17e23740d39373a601e0ba061cc40da7cc6d79f5` |
| `@workflow/world-local@4.3.0` | `undici: 7.28.0 -> 7.29.0` | `18e492ba1128c164e2be37b16bb100bd9c56b3b97aa9181cf812dda0a3b8d1ef` |
| `@workflow/world-vercel@4.7.0` | `undici: 7.28.0 -> 7.29.0` | `6aabb73040cd6d69a52a96883e10223f28bc6cd65a2518ffc702046f120a0601` |

The contract test asserts those exact package versions, filenames, contents,
and hashes. It also proves that Workflow receives Nano ID 5.1.16 and Undici
7.29.0, PostCSS retains Nano ID 3.3.18, the application retains Undici 8.10.0,
and the APIs used by Workflow remain callable. These patches should be removed
as soon as the corresponding Workflow packages publish the fixed dependency
edges; an upstream version change intentionally breaks the exact patch key and
checksum contract instead of silently carrying a fork forward.

## Lighthouse and browser compatibility

The replacement runner continues to consume `lighthouserc.cjs` and preserves:

- both configured standalone-production URLs;
- three independent runs per URL;
- up to three transient collection attempts for each scheduled run, matching
  LHCI's Node runner, without retrying assertion or budget failures;
- the same per-metric median aggregation used by LHCI;
- error-level performance, LCP, CLS, and TBT budgets;
- six JSON reports, six HTML reports, LHCI's legacy-compatible filesystem
  manifest, and a machine-readable assertion-results artifact;
- failed assertion details in `assertion-results.json` and a non-zero exit
  status;
- the existing standalone assembly/server command and process cleanup.

Browser discovery is shared with the font audit. `BROWSER_PATH` and
`CHROME_PATH` remain supported, Brave remains the first local default, and CI
can use its installed Chrome. The verify and browser jobs pin Node 24.20.0 to
match the production build/runtime toolchain while Bun remains 1.3.14.

## Verification contract

The focused dependency contract is
`src/lib/dependency-security-contract.test.ts`. Lighthouse configuration stays
covered by `src/lib/lighthouse-ci-environment.test.ts`, while
`src/lib/lighthouse-runner.test.ts` executes the runner with deterministic
browser, server, collection, and artifact adapters to prove retry success and
exhaustion, median pass and fail, failure artifacts, no budget retry, and
cleanup. Delivery verification runs:

```sh
bun install --frozen-lockfile --ignore-scripts
bun audit --json
bun test src/lib/dependency-security-contract.test.ts src/lib/lighthouse-ci-environment.test.ts src/lib/lighthouse-runner.test.ts src/lib/container-runtime.test.ts
bun run test
bun run lint
bun run design:lint
bunx --bun prisma generate
bunx tsc --noEmit
bun run build
bun run verify:brand-fonts
bun run lighthouse
```

The existing GitHub `verify`, `first-customer-browser-e2e`, and
`container-runtime` jobs remain the required merge gates. Issue #161 does not
change the dependency-audit workflow, Dependabot configuration, governance
policy, or governance contract owned by PR #160.
