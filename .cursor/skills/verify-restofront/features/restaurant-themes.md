# Restaurant theme gallery

The restaurant theme gallery lets a visitor compare seven registered website systems, open a theme detail, and view each fictional restaurant preview before starting a private build.

## Sub-features

- `THEMES-GALLERY` lists all seven restaurant theme cards on `/themes/restaurant`.
- `THEMES-DETAIL` opens the description, fit, signals, tokens, and preview for one theme.
- `THEMES-PREVIEW` opens a complete fictional restaurant website in a new tab.
- `THEMES-CREATE` opens the restaurant-prefilled create route.

## How to get to it (user POV)

- Open `/themes/restaurant` directly.
- Choose **Themes** in the factory home header.
- Choose the **Theme details** control on any gallery card to open `/themes/restaurant/<theme-id>`.
- Choose **Full preview** or **Open full preview** to open `/themes/restaurant/<theme-id>/preview` in a new tab.
- Choose **Build a restaurant preview** in the gallery or **Build a preview** on a theme detail page.

## Driving it with restofront-ctl

Preconditions: Start the managed instance and require `bun scripts/restofront-ctl.ts doctor --json` to pass.

- `THEMES-GALLERY` Action: open `/themes/restaurant`. Command: `bun scripts/restofront-ctl.ts drive restaurant-themes --json`. Result: the action screenshot shows **The restaurant decides the theme.** and the JSON records seven cards.
- `THEMES-DETAIL` Action: choose the first **Theme details** control. Command: `bun scripts/restofront-ctl.ts drive restaurant-themes --json`. Result: the browser reaches `/themes/restaurant/terroir-editorial` and shows **Terroir Editorial**.
- `THEMES-PREVIEW` Action: choose **Open full website preview** on the selected theme detail. Command: `bun scripts/restofront-ctl.ts drive restaurant-themes --json`. Result: the new tab shows **Maison Serein**, and its `data-site-theme` is `terroir-editorial`.
- `THEMES-CREATE` Action: choose **Build a preview** on the selected theme detail. Command: `bun scripts/restofront-ctl.ts drive restaurant-themes --json`. Result: the browser reaches `/create?vertical=restaurant` and shows **Restaurant website or name**.

## Gotchas

- Gallery cards embed preview iframes. Drive the top-level links and headings, not text inside an iframe.
- **Full preview** opens a new tab. Capture both the click and the new page.
- The control drive skips the duplicate **Full preview** control on the gallery after it proves the same route from the theme detail. Keep that skip in the evidence JSON.
- The gallery order starts with `terroir-editorial`. The control drive treats a different first detail route as a registry change that needs a map update.
- A theme detail proves browsing. It does not prove automatic theme selection for an imported restaurant.
