# PR 02D — Review Notes (Cole → Ari / Nathan)

## What changed

- **Shell rebuilt mobile-first.** One stylesheet (`app/globals.css`, 2,518 → ~550 lines), base rules are the phone layout, `640 / 900 / 1200` enhance upward. All PR 02B/02C overrides and the homemade SVG sword were removed.
- **Phone navigation is a purpose-built full-height sheet** (≤ 899px): 52px rows, close button, Appearance (Dark / Light, `aria-pressed`) and utilities pinned above the safe area. Closed sheet is `visibility: hidden`, so it is not focusable. Body scroll is locked while open. Route change, any link tap, Escape, the close button and crossing 900px all close it.
- **Desktop (≥ 900px)** gets a persistent 268/288px sidebar; the menu button and sheet chrome disappear.
- **Appearance** is one shared store (`lib/theme.ts`) driven by `<html data-theme>`; topbar button and menu segment always agree. Boot script sets the theme (and `theme-color`) before paint.
- **Motion**: 120ms feedback, 200ms sheet, `cubic-bezier(.2,.7,.2,1)`. No blur on phones (topbar blur only ≥ 640px). `prefers-reduced-motion` renders a static illuminated About composition.
- **Chat**: `100dvh` layout, `interactive-widget=resizes-content`, safe-area padding, 16px textarea (no iOS zoom), auto-growing composer, add-menu dismisses on outside tap / Escape, 44px controls.
- **Canonical brand art** (see `docs/BRAND_ASSETS.md`): clean logo in topbar/menu, shaded logo in chat empty state, colour blue-steel on Home/About/app icons. Nothing redrawn.
- **About**: layers from the supplied variants (aura, wind, beam, red gem) registered over the base art. Dark: aura pulse, drifting wind, blade-light sweep, faint gem pulse (≥ 640px). Phone: aura pulse + two wind streaks only; wind/beam/gem layers are not rendered. Light: crisp steel, beam only.
- **Icons / home screen**: charcoal-stone tile with the colour sword — favicon, 192/512, maskable 512, apple-touch, web manifest, OG card.

## Merge-gate checklist

| # | Gate | Where |
| --- | --- | --- |
| 1 | Screenshots at required widths | CI artifact `review/screenshots/` |
| 2 | Demo link | Pages deploy after merge; artifact `out/` is a static site (`python3 -m http.server -d out`) |
| 3 | Downloadable artifact | `windsword-pr-*-review` |
| 4 | Canonical logos used | `responsive-audit` → `canonical-compact-logo-in-topbar`, `about-uses-canonical-art` |
| 5 | Menu open dark + light | `menu-open-{dark,light}-*.png` |
| 6 | About dark + light | `about-{dark,light}-*.png` |
| 7 | Chat @390 composer visible | `chat-dark-390x844.png`, audit `chat-composer-visible` |
| 8 | No horizontal overflow | audit `no-horizontal-overflow` (9 widths × 7 routes) |
| 9 | Theme persistence | audit `theme-persists-after-reload` |
| 10 | No console/page errors | audit `loads-no-errors` |

## Out of scope (unchanged)

Provider runtime, retrieval, loaders, OCR, matter backend, Harvey LAB.
