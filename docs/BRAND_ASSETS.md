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

Superseded by the icon pack below: `public/icons/*` and the favicons now come
from the supplied stone-tile artwork (see "Icon pack").

## Icon pack (current source of truth)

The seven approved icon-pack files live in `brand-source/icon-pack/` with their
original usage guide (`WindSwordAI_Icon_Pack_Usage_Guide.md`). They supersede
the earlier thin line drawing for small marks.

| Pack file | Derived asset | Used for |
| --- | --- | --- |
| `ornate_sapphire_winged_sword.png` | `brand/windsword-sapphire-sm.webp` | **Header/menu mark (38–40px)** — colour reads well at this size |
| `ornate_winged_fantasy_sword.png` | `brand/windsword-line.webp` | Line mark for monochrome/system contexts (not in the header; light theme inverts it to charcoal via CSS) |
| `winged_fantasy_sword_emblem.png` | `brand/windsword-line-alt.webp` | Alternate line mark for badges/utility surfaces (not yet placed) |
| `ornate_winged_silver_sword_icon.png` | `brand/windsword-gray.webp` | **Chat screen** empty-state mark |
| `ornate_sapphire_winged_sword.png` | `brand/windsword-sapphire*.webp`, OG card | Home hero, social card |
| `winged_sword_on_stone_crest.png` | `icons/stone/*`, top-level `icons/*`, favicons | **Default** PWA / Add to Home Screen / favicon |
| `angelwing_ruby_sword_emblem.png` | `icons/sand/*` | Light-theme / warm home-screen alternate (not wired to the manifest; iOS cannot switch by theme) |
| `winged_sword_on_ancient_stone.png` | `icons/ancient-sand/*` | Seasonal / alternate skin |

Tiles are cropped just inside their rounded edge (the sources have black
corners) and re-rounded with transparent corners. Apple touch icons are
full-bleed squares; the maskable icon places the tile inside the 80% safe zone
on blurred stone. Favicons use the stone tile: a thin line crop was
unrecognizable at 16–32px.

**Note on two colour swords.** The About page's animated layers (aura, wind,
beam, gem) were rendered over `01_windsword_base_enhanced_transparent` and must
register exactly over it, so About keeps that base. Home hero, OG and app icons
use the icon-pack sapphire art. If a single colour sword is wanted everywhere,
the aura/wind/beam/gem layers need to be regenerated over the sapphire art.

Motion rules from the pack apply: brand animation is rare and subtle, never on
favicons or app icons, and always honours `prefers-reduced-motion`. Current
implementation: About ambient layers and a ≤1° desktop hover lift on the header
mark.
