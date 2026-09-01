# Restofront verification feature map

This map records user-visible Restofront paths and the evidence required to claim that each one works. Run commands from the repository root.

## Baseline preconditions

- Install dependencies with `bun install --frozen-lockfile`.
- Install Chromium with `bunx playwright install chromium`.
- Build the app with the exact command in [the verification skill](../SKILL.md#launch).
- Keep ports `3100` and `4100` free. `restofront-ctl up` refuses to share either port.
- Start public drives with `bun scripts/restofront-ctl.ts up --json`, then require a passing `doctor --json`.
- Use a dedicated local PostgreSQL database and local Redis for the first-customer journey. Never use production credentials.

## Driving conventions

- Use the ARIA roles, labels, link names, headings, and paths listed in each feature file.
- Run one managed public instance per checkout. Do not double-drive a shared port or browser session.
- Use `drive factory-home` and `drive restaurant-themes` against the managed instance.
- Run `down` before `drive first-customer`. The existing Playwright configuration owns `3100`, `4100`, the seed, and fixture cleanup for that journey.
- Keep provider traffic local. The control CLI overrides Stripe and Resend endpoints with `http://127.0.0.1:4100`.

## Proof and skip reporting

Store evidence in `.cursor/skills/verify-restofront/artifacts/<run-id>/`. A public proof needs an action screenshot, a result screenshot, and the drive JSON. A stateful proof needs the Playwright transcript, result JSON, database assertions, fake-provider assertions, and visible browser assertions.

Name every skipped sub-feature and entry point in the handoff. State why it was skipped and what remains unproved. A dry run proves command planning only. It does not prove the UI or side effects.

## Feature entry contract

Each feature file has one user-visible feature and exactly four sections. Keep every user entry point, stable handle, command, expected result, and run-specific trap current. Add a feature file when a new top-level route, menu entry, or owner workflow appears. Update the index in the same change.

## Features

- [Factory home and URL intake](factory-home.md)
- [Restaurant theme gallery](restaurant-themes.md)
- [Claim ownership](claim-ownership.md)
- [Owner sign-in](sign-in.md)
- [Owner dashboard save and publish](owner-dashboard.md)
