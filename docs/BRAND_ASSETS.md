# WindSwordAI Brand Assets

The sword artwork is **user-approved and canonical**. It is never redrawn,
traced or reinterpreted. `scripts/build-brand-assets.mjs` only crops, resizes,
converts ink-on-white to alpha, and composites onto icon backgrounds.

Originals live in `brand-source/`. Web derivatives live in `public/brand/` and
`public/icons/` and are committed so the static export needs no image tooling.
Regenerate with `npm run brand:build`.

## Hierarchy

| Role | Source | Web asset | Used for |
| --- | --- | --- | --- |
| Primary logo (shaded) | `WindSwordAI logo, tilted, shaded.png` | `brand/windsword-shaded.webp` | Chat empty state, larger brand moments |
| Compact / system logo (clean) | `WindSwordAI logo, tilted, clean (1).png` | `brand/windsword-clean.webp`, `brand/windsword-clean-sm.webp` | Topbar, menu header, monochrome contexts |
| Full-colour identity | `01_windsword_base_enhanced_transparent.png` | `brand/windsword-bluesteel*.webp`, `brand/layer-base*.webp` | Home hero, About, app icons, OG card |
| Effect layers (same canvas as base) | `02_…glowing_blue_aura`, `03_…wind_energy`, `04_…blade_light_beam`, `05_…red_gem_aura` | `brand/layer-{aura,wind,beam,gem}*.webp` | About page motion |
| Square logo | `WindSwordAI logo, 800x800.png` | (source only) | Reserved |

`windsword-clean-sm` is the same drawing with the alpha curve lifted so the
hairlines survive at 40px. It is not a different mark.

## Theme handling

The two ink drawings are converted to alpha and rendered with CSS `mask-image`
(`BrandMark`), so a single file follows `currentColor` in light and dark. The
colour art is used as-is; in dark theme the aura layer is brightened toward
white-blue, in light theme only the base plus a faint beam is shown.

## Home-screen icons

`public/icons/*` place the colour sword on a dark charcoal stone tile
(generated noise texture, no artwork change). `icon-maskable-512.png` keeps
the sword inside the 80% safe zone; `apple-touch-icon.png` is full-bleed
because iOS applies its own rounded mask. `favicon.ico` and `favicon-32.png`
use the same tile so the tab icon reads on light and dark browser chrome.
