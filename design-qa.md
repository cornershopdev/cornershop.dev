# Cornershopdev brand QA

## Reference

- Approved direction: `docs/brand-concepts/cornershopdev-04-c-dot.png`
- Mark: one custom factory-green C with one detached coral point, optically
  centered in the open-right gap
- Palette: factory green `#0D4A39`, coral `#F15A3D`, transparent exterior

## Production exports

- `public/brand/cornershopdev/logo-square.png`: 1024 × 1024 RGBA master
- `public/brand/cornershopdev/mark.png`: 512 × 512 RGBA header mark
- `public/brand/cornershopdev/apple-touch-icon.png`: 180 × 180 RGBA touch icon
- `public/brand/cornershopdev/favicon-32.png`: 32 × 32 RGBA favicon

The root layout declares the dedicated PNG favicon and Apple touch icon. There
is no `src/app/favicon.ico` file convention because Next.js forces that global
file into customer-host metadata after child metadata has resolved.

The master contains only the two exact flat sRGB brand colors plus alpha. All
four corners are transparent.

## Browser verification

- Desktop: verified on the factory homepage at 1280 × 720. The 48px source
  renders cleanly in the header with correct wordmark spacing and no clipping.
- Mobile: verified at 390 × 844. The mark renders at 36 × 36, the wordmark stays
  legible, and the navigation remains contained with no horizontal overflow.
- Browser metadata: the declared 32px favicon and 180px Apple touch icon both
  resolve from factory pages without leaking into customer-host article pages.
- Responsive page state: hero copy, controls and header remain readable at both
  inspected viewports.

final result: passed
