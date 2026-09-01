# Owner dashboard save and publish

The owner dashboard lets an authenticated restaurant owner edit private site content, save against the current draft revision, publish an immutable version, and open the live restaurant site.

## Sub-features

- `DASHBOARD-OPEN` opens the selected restaurant workspace and shows its overview.
- `DASHBOARD-SAVE` edits **Restaurant name** under **Settings** and saves the private draft.
- `DASHBOARD-CONFLICT` rejects a stale editor instead of overwriting a newer draft.
- `DASHBOARD-PRIVATE` keeps an unpublished private save off the public hostname.
- `DASHBOARD-PUBLISH` records a change summary, publishes the saved revision, and serves the live version.

## How to get to it (user POV)

- Choose **Open <restaurant name>** on `/workspace/select` after claim or sign-in.
- Open `/dashboard` directly with a valid site session.
- Open `/dashboard?demo=1` for the non-owner demo. Treat the demo as UI-only evidence.
- Choose **Dashboard** in the site header while an owner session is active.
- Choose the **Settings** tab to edit the restaurant name, then use **Save** or **Publish**.

## Driving it with restofront-ctl

Preconditions: Build the app, configure the isolated local database from the skill, keep Redis on `127.0.0.1:6379`, and run `bun scripts/restofront-ctl.ts down --json` so both E2E ports are free.

- `DASHBOARD-OPEN` Action: choose **Open First Customer Browser Restaurant** after workspace selection. Command: `bun scripts/restofront-ctl.ts drive first-customer --json`. Result: **Welcome to First Customer Browser Restaurant.** appears and the site session is bound to that workspace.
- `DASHBOARD-SAVE` Action: choose **Settings**, fill **Restaurant name**, then choose **Save**. Command: `bun scripts/restofront-ctl.ts drive first-customer --json`. Result: the save request returns `200`, sends the expected revision, and the button changes to **Saved**.
- `DASHBOARD-CONFLICT` Action: save from a stale second editor. Command: `bun scripts/restofront-ctl.ts drive first-customer --json`. Result: the stale save returns `409` and the page shows **This draft was updated elsewhere. Reload before saving again.**
- `DASHBOARD-PRIVATE` Action: request the restaurant hostname after the private save. Command: `bun scripts/restofront-ctl.ts drive first-customer --json`. Result: the hostname still returns `404` before publish.
- `DASHBOARD-PUBLISH` Action: choose **Publish**, enter the change summary, and confirm. Command: `bun scripts/restofront-ctl.ts drive first-customer --json`. Result: the button changes to **Published v1**, the restaurant hostname returns `200`, and the local database points at the version served in the response header.

## Gotchas

- `/dashboard?demo=1` can prove controls and layout only. Demo save and publish do not prove owner authorization or persistence.
- **Publish** opens both a prompt and a confirmation dialog. The Playwright journey handles both.
- A private save must not make the hostname public. Capture the `404` before publish and the `200` after publish.
- The stale-editor rejection is part of the save contract. A happy-path save alone does not prove concurrency safety.
