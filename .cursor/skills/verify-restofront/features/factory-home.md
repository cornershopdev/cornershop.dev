# Factory home and URL intake

The factory home explains the website system and leads a visitor into the private preview form, where the visitor chooses a trade and enters an existing website or business name.

## Sub-features

- `HOME-OPEN` shows the factory status, product message, and primary calls to action.
- `HOME-NAV` opens Products, System, Themes, GitHub, Dashboard, and the create route.
- `INTAKE-OPEN` shows the trade picker and the source field on `/create`.
- `INTAKE-PREFILL` reads `source` and `vertical` from the `/create` query string.
- `INTAKE-SUBMIT` sends a source through **Build preview** and shows a private preview or a visible error.

## How to get to it (user POV)

- Open `/` directly.
- Choose **Build a local site** in the hero or **Build a site** in the header to open `/create`.
- Choose **Themes** in the factory header, then choose **Build a restaurant preview** to open `/create?vertical=restaurant`.
- Choose **Build a preview** on a theme detail page to open `/create?vertical=restaurant`.
- Open `/create?source=<website>&vertical=<trade>` from a shared intake link.

## Driving it with restofront-ctl

Preconditions: Start the managed instance and require `bun scripts/restofront-ctl.ts doctor --json` to pass.

- `HOME-OPEN` Action: open `/` and locate the heading **The system behind your next local website.** Command: `bun scripts/restofront-ctl.ts drive factory-home --json`. Result: the action screenshot shows the factory home.
- `INTAKE-OPEN` Action: choose **Build a local site**. Command: `bun scripts/restofront-ctl.ts drive factory-home --json`. Result: the browser reaches `/create` and shows **Build the first version.**
- `INTAKE-PREFILL` Action: enter `restaurant.example` in **Restaurant website or name**. Command: `bun scripts/restofront-ctl.ts drive factory-home --json`. Result: the result screenshot shows the value and the JSON reports that **Build preview** is enabled.
- `INTAKE-SUBMIT` Action: submit a controlled source only when the import boundary is in scope. Command: use Playwright against `/create` with the same label and button after the source provider has an approved local double. Result: a private preview or an alert is visible, and the proof records the persisted site or the explicit failure.

## Gotchas

- The public control drive stops before **Build preview** because source import can call network and model providers. Report `INTAKE-SUBMIT` as skipped unless those boundaries have approved local doubles.
- `/` has two create links with different accessible names. Use the exact **Build a local site** link in the hero for the control drive.
- The default trade is Restaurant. A valid `vertical` query changes the trade picker and source label.
- Demo fallback content is not proof that a submitted source was imported or persisted.
