# Owner sign-in

Owner sign-in sends a secure one-time link, asks the owner to confirm that link, and opens only the workspaces that the account may access.

## Sub-features

- `SIGNIN-OPEN` shows the email form on `/sign-in`.
- `SIGNIN-EMAIL` sends a secure link through the fake mailbox.
- `SIGNIN-CONFIRM` shows **Confirm it's you.** before creating the session.
- `SIGNIN-WORKSPACE` lists authorized workspaces and hides unauthorized ones.
- `SIGNIN-BOUNDARY` redirects an unauthenticated dashboard request to sign-in.

## How to get to it (user POV)

- Open `/sign-in` directly.
- Open `/dashboard` without a valid owner session and follow the redirect.
- Sign out from an owner session, then return to `/sign-in`.
- Open the one-time inbox link to reach `/sign-in/verify`, then choose **Continue securely**.
- Choose a workspace on `/workspace/select` to continue to `/dashboard`.

## Driving it with restofront-ctl

Preconditions: Build the app, configure the isolated local database from the skill, keep Redis on `127.0.0.1:6379`, and run `bun scripts/restofront-ctl.ts down --json` so both E2E ports are free.

- `SIGNIN-OPEN` Action: open `/sign-in` after the claim journey logs out. Command: `bun scripts/restofront-ctl.ts drive first-customer --json`. Result: the email field and **Email me a secure link** button appear.
- `SIGNIN-EMAIL` Action: submit `owner@restaurant.example.test`. Command: `bun scripts/restofront-ctl.ts drive first-customer --json`. Result: the heading changes to **Check your inbox.** and the fake mailbox contains a new link.
- `SIGNIN-CONFIRM` Action: open the new link and choose **Continue securely**. Command: `bun scripts/restofront-ctl.ts drive first-customer --json`. Result: **Confirm it's you.** appears before the browser reaches `/workspace/select`.
- `SIGNIN-WORKSPACE` Action: choose **Open First Customer Browser Restaurant**. Command: `bun scripts/restofront-ctl.ts drive first-customer --json`. Result: the browser reaches `/dashboard`, both authorized workspaces were listed, and the unauthorized workspace was absent.
- `SIGNIN-BOUNDARY` Action: log out and open `/dashboard`. Command: `bun scripts/restofront-ctl.ts drive first-customer --json`. Result: the browser redirects away from the dashboard to sign-in.

## Gotchas

- The success message does not reveal whether an arbitrary email has an account. Use the seeded owner and verify the fake mailbox side effect.
- The confirmation page protects the link from email scanners. Opening the link alone does not create the owner session.
- A workspace-selection session cannot open `/dashboard` until the owner chooses an authorized site.
- Reusing the earlier claim link is not proof of sign-in. The journey waits for a different mailbox link.
