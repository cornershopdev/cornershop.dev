---
name: verify-restofront
description: Drive and verify the Restofront restaurant website factory's Next.js web UI when a change needs browser proof, local service health checks, or owner-journey evidence.
---

# Verify Restofront

Use `restofront-ctl` from the repository root. It drives the real web UI with Playwright and stores evidence under `.cursor/skills/verify-restofront/artifacts/`.

## Launch

Install the locked dependencies and the Chromium browser once:

```bash
bun install --frozen-lockfile
bunx playwright install chromium
```

Create the production build. The public routes do not connect to this placeholder database:

```bash
DATABASE_URL=postgresql://127.0.0.1:5432/cornershopdev_verify_restofront BETTER_AUTH_SECRET=verify-only-better-auth-secret-32-bytes bun run build
```

Check the launch without changing local state, then start the app and the fake providers:

```bash
bun scripts/restofront-ctl.ts up --dry-run --json
bun scripts/restofront-ctl.ts up --json
```

The command refuses to start when `3100` or `4100` has an unknown listener. A successful launch waits for both `http://127.0.0.1:3100/api/health/live` and `http://127.0.0.1:4100/_health`. It writes the app and provider logs into the run's artifact directory.

For the owner journey, create an isolated local database before the build and export it in the same shell:

```bash
psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'cornershopdev_verify_restofront'" | grep -q 1 || createdb cornershopdev_verify_restofront
export DATABASE_URL=postgresql://127.0.0.1:5432/cornershopdev_verify_restofront
export WORKFLOW_POSTGRES_URL="$DATABASE_URL"
bunx --bun prisma migrate deploy
bun run workflow:migrate
```

Do not point the control CLI at a remote database. The stateful drive rejects remote hosts and database names without `e2e`, `test`, or `verify`.

## Doctor

Run the read-only doctor whenever the app, build, or ports look wrong:

```bash
bun scripts/restofront-ctl.ts doctor --json
```

Doctor checks the recorded process groups, confirms that their commands still match, proves that their groups own ports `3100` and `4100`, reads both health endpoints, and compares the running build and Git head with the current checkout. Any failed check exits nonzero.

## Drive

Read [the feature map](features/README.md) before choosing a drive. The map names every known entry point and the proof each feature requires.

Drive the factory home and URL intake:

```bash
bun scripts/restofront-ctl.ts drive factory-home --json
```

Drive the restaurant theme gallery and the first theme detail:

```bash
bun scripts/restofront-ctl.ts drive restaurant-themes --json
```

The claim, sign-in, and dashboard maps share the repo's full first-customer Playwright journey. Stop the managed public instance first because Playwright owns the same two ports:

```bash
bun scripts/restofront-ctl.ts down --json
bun scripts/restofront-ctl.ts drive first-customer --dry-run --json
bun scripts/restofront-ctl.ts drive first-customer --json
```

The full journey requires the isolated database setup from Launch and Redis on `127.0.0.1:6379`. It seeds and cleans its own browser fixtures. The CLI forces Stripe and email requests to the fake provider on `4100`; it does not send customer or owner email.

## Evidence

Keep every proof under `.cursor/skills/verify-restofront/artifacts/<run-id>/`. Public drives save an action screenshot, a result screenshot, and a JSON record with the build ID, Git head, route, actions, observations, and paths. The stateful drive saves its terminal transcript and result JSON.

A valid proof follows these rules:

- Exercise the real user route with Playwright. Do not call internal setters or test-only endpoints to create the visible state.
- Capture the screen before the action and after the resulting state appears.
- Verify a side effect when the action promises one. The first-customer journey checks the local database, the fake mailbox, the fake checkout, and the published hostname response.
- Mock only the production provider boundaries that the app already isolates. This repo's E2E contract supplies fake email and Stripe endpoints.
- Record skipped entry points and the reason. Do not claim a feature when the drive covered only a convenient subset.
- Treat `--dry-run` as a plan. Confirm that it created no browser, process, artifact, network request, or Git change before citing it as safe.

## Cleanup

Stop only the process groups recorded by this checkout:

```bash
bun scripts/restofront-ctl.ts down --dry-run --json
bun scripts/restofront-ctl.ts down --json
```

The command never kills by process name and never adopts an unknown listener. It removes the temporary run-state file but keeps every artifact. After a failed owner journey, run its fixture cleanup with the same isolated `DATABASE_URL`, then run `down`:

```bash
bun tests/e2e/support/database.ts cleanup
bun scripts/restofront-ctl.ts down --json
```

If this run created `cornershopdev_verify_restofront` and no other run uses it, remove that scratch database after the fixture cleanup:

```bash
dropdb cornershopdev_verify_restofront
```

## Helpers

`scripts/restofront-ctl.ts` is executable and accepts these commands:

```bash
bun scripts/restofront-ctl.ts help --json
bun scripts/restofront-ctl.ts up --json
bun scripts/restofront-ctl.ts doctor --json
bun scripts/restofront-ctl.ts drive factory-home --json
bun scripts/restofront-ctl.ts drive restaurant-themes --json
bun scripts/restofront-ctl.ts drive first-customer --json
bun scripts/restofront-ctl.ts down --json
```

Add `--dry-run` to `up`, `drive`, or `down` to inspect the planned work without starting a process, browser, or cleanup action. Add `--json` for one machine-readable result. Invalid commands and failed checks write a JSON error and exit nonzero.
