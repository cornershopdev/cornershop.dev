# Claim ownership

The claim page lets a restaurant owner review a private site, prove control of an approved email address, open a one-time link, and continue to the founding-plan checkout.

## Sub-features

- `CLAIM-OPEN` shows the named private preview and the launch offer on `/claim/<slug>`.
- `CLAIM-EMAIL` sends the ownership link to the approved address.
- `CLAIM-LINK` attaches the one-time token to the correct site and email.
- `CLAIM-CHECKOUT` opens the local fake checkout only after ownership proof.
- `CLAIM-COMPLETE` accepts the invitation only after the fake payment webhook succeeds.

## How to get to it (user POV)

- Choose the claim action after a private preview is ready.
- Open `/claim/<slug>` from an operator-approved preview link.
- Open the one-time ownership link from the approved inbox, which returns to the same claim page with the token attached.
- Choose **Claim and continue** to open checkout.

## Driving it with restofront-ctl

Preconditions: Build the app, configure the isolated local database from the skill, keep Redis on `127.0.0.1:6379`, and run `bun scripts/restofront-ctl.ts down --json` so both E2E ports are free.

- `CLAIM-OPEN` Action: open `/claim/first-customer-browser-target`. Command: `bun scripts/restofront-ctl.ts drive first-customer --json`. Result: the browser shows the seeded restaurant and its private claim state.
- `CLAIM-EMAIL` Action: fill **Business owner email** and choose **Verify ownership by email**. Command: `bun scripts/restofront-ctl.ts drive first-customer --json`. Result: **Check that inbox** appears and the fake mailbox returns the one-time link.
- `CLAIM-LINK` Action: open the mailbox link. Command: `bun scripts/restofront-ctl.ts drive first-customer --json`. Result: **One-time ownership link attached** appears for the seeded site.
- `CLAIM-CHECKOUT` Action: choose **Claim and continue**. Command: `bun scripts/restofront-ctl.ts drive first-customer --json`. Result: the browser reaches the fake checkout on `127.0.0.1:4100`.
- `CLAIM-COMPLETE` Action: choose **Pay $53 in test mode**. Command: `bun scripts/restofront-ctl.ts drive first-customer --json`. Result: the browser reaches workspace selection and the local database records the accepted invitation after the webhook.

## Gotchas

- Never use a real Resend or Stripe endpoint. The control CLI overwrites both base URLs with the fake provider.
- The approved email and claim slug come from the E2E fixtures. An arbitrary address is not a valid ownership proof.
- Opening the link does not accept the invitation. The fake checkout webhook must complete first.
- Run `bun tests/e2e/support/database.ts cleanup` with the same `DATABASE_URL` after an interrupted journey.
