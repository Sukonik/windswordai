# WindSwordAI Icon Pack — Usage Guide

This pack contains seven approved WindSwordAI icon/logo assets for web, mobile, PWA, home-screen icons, headers, favicons, social cards, and branded interface moments.

## Asset roles

| File | Best use |
|---|---|
| `ornate_sapphire_winged_sword.png` | **Primary full-color sword**. Hero art, About page, splash/empty states, larger header branding, social cards. Transparent background. |
| `ornate_winged_fantasy_sword.png` | **Primary black/white line icon**. Header mark, monochrome UI, light/dark theme adaptation, print, small brand lockups. Transparent background. |
| `winged_fantasy_sword_emblem.png` | **Alternate black/white line icon**. A/B option for compact UI, badges, utility surfaces, monochrome export. Transparent background. |
| `ornate_winged_silver_sword_icon.png` | **Grayscale sword**. Neutral UI, disabled/quiet states, legal/document surfaces where full color is too expressive. Transparent background. |
| `winged_sword_on_stone_crest.png` | **Dark stone app icon**. Preferred dark-theme PWA / save-to-home-screen / desktop shortcut icon. |
| `angelwing_ruby_sword_emblem.png` | **Sand / light-stone app icon**. Preferred light-theme or warm mobile home-screen icon. |
| `winged_sword_on_ancient_stone.png` | **Ancient sand-stone alternate app icon**. Secondary mobile/home-screen theme or seasonal/alternate skin. |

All current source PNGs are approximately **1254×1254**. That is more than enough for normal web/PWA/mobile derivations. If a true 4096×4096 archival master is required later, create one separately; do not upscale these just for favicon or app-icon use.

---

# Recommended brand hierarchy

## 1. Header / topbar

For a normal WindSwordAI header:

- Use `ornate_winged_fantasy_sword.png` or `winged_fantasy_sword_emblem.png`
- Render at roughly **28–40px high**
- Pair with the WindSwordAI wordmark
- Keep the full-color sword out of very small headers unless the icon is at least ~48px high

Recommended hierarchy:

```text
[ line sword ] WindSwordAI
```

When **WindSword-Block** is integrated, use it for the wordmark and primary navigation branding.

### Dark theme
Use the white/black line asset through a CSS mask or monochrome treatment so it reads as bright silver/white.

### Light theme
Use the same line asset as dark charcoal/black.

---

# 2. Full-color logo / hero art

Use:

`ornate_sapphire_winged_sword.png`

Best for:

- Home hero
- About page
- product splash
- empty-state branding
- onboarding
- social media cards
- larger app identity surfaces

Suggested rendered sizes:

- mobile hero: **220–340px**
- desktop hero: **360–640px**
- About page: **300–560px**

Avoid shrinking the full-color art below roughly **48px** because the wings, gem, and blue blade lose clarity.

---

# 3. Favicons

The full sword is very tall/slender, so it is not ideal at 16×16.

Use the **boldest line icon** as the source, then generate:

```text
favicon-16.png
favicon-32.png
favicon-48.png
favicon.ico
```

For 16×16 and 32×32, crop more aggressively around the **guard / wings / gem / upper blade** rather than trying to preserve the entire sword.

A future micro-mark could also use a very simple sword silhouette inspired by:

`🗡️`

That would be ideal for tiny 16–24px contexts.

Recommended HTML:

```html
<link rel="icon" href="/brand/icons/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="/brand/icons/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/brand/icons/favicon-16.png">
```

---

# 4. Save to Home Screen / PWA

## Preferred dark icon

`winged_sword_on_stone_crest.png`

## Preferred light icon

`angelwing_ruby_sword_emblem.png`

## Alternate warm icon

`winged_sword_on_ancient_stone.png`

Generate at minimum:

```text
apple-touch-icon.png    180×180
icon-192.png            192×192
icon-512.png            512×512
icon-maskable-512.png   512×512
```

For maskable icons, keep the sword and gem inside the central **~80% safe area** so Android launchers do not crop important details.

### HTML / iOS

```html
<link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="WindSwordAI">
<meta name="theme-color" content="#0b0e13">
```

### Manifest example

```json
{
  "name": "WindSwordAI",
  "short_name": "WindSwordAI",
  "display": "standalone",
  "background_color": "#0b0e13",
  "theme_color": "#0b0e13",
  "icons": [
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-maskable-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
```

---

# 5. Suggested repository layout

```text
public/
└── brand/
    ├── master/
    │   ├── ornate_sapphire_winged_sword.png
    │   ├── ornate_winged_fantasy_sword.png
    │   ├── winged_fantasy_sword_emblem.png
    │   └── ornate_winged_silver_sword_icon.png
    │
    ├── app-icons/
    │   ├── stone/
    │   ├── sand/
    │   └── ancient-sand/
    │
    ├── headers/
    │   ├── line-32.png
    │   ├── line-40.png
    │   └── grayscale-40.png
    │
    └── favicons/
        ├── favicon-16.png
        ├── favicon-32.png
        ├── favicon-48.png
        └── favicon.ico
```

Keep the original master files untouched and generate derivatives from them.

---

# 6. Next.js usage

For static-export-safe branding:

```tsx
<img
  src="/brand/master/ornate_sapphire_winged_sword.png"
  alt="WindSwordAI"
  width={512}
  height={512}
/>
```

For a decorative sword next to an existing accessible wordmark:

```tsx
<img
  src="/brand/master/ornate_winged_fantasy_sword.png"
  alt=""
  aria-hidden="true"
/>
```

Do not give both the icon and adjacent `WindSwordAI` text the same accessible name; that causes screen readers to announce the brand twice.

---

# 7. Theme-aware icon selection

Recommended behavior:

### Dark UI
- line icon → white / silver
- full-color blue sword → normal
- dark stone app icon → primary

### Light UI
- line icon → black / charcoal
- grayscale sword → secondary
- sand app icon → primary

Do not automatically invert the full-color blue/red sword; preserve its blue blade and red gem.

---

# 8. Light animation ideas

Animations should be **rare, subtle, and meaningful**. The sword is strongest when it feels mostly still.

## A. Gem pulse

Good for:

- AI processing
- wake state
- unusual insight
- secure-mode transition

Use a slow red aura pulse around the gem only.

```css
@keyframes gemPulse {
  0%, 100% { filter: drop-shadow(0 0 0 rgba(255, 45, 75, 0)); }
  50% { filter: drop-shadow(0 0 10px rgba(255, 45, 75, .45)); }
}
```

Use for 1–2 cycles, not continuously.

---

## B. Blade shimmer

A thin white/blue highlight can travel once down the blade on:

- first load
- successful completion
- mode activation

Keep it short: roughly **700–1200ms**.

---

## C. Wind pass

Use 1–2 faint blue-white streaks passing behind the sword.

Good for:

- opening About
- entering WindSword mode
- rare UI delight moments

Do not run continuously on mobile.

---

## D. Tiny hover lift

Desktop only:

```css
.wind-icon {
  transition: transform 160ms cubic-bezier(.2,.7,.2,1);
}

.wind-icon:hover {
  transform: translateY(-2px) rotate(-0.5deg);
}
```

Keep rotation under about **1 degree**.

---

## E. Rare slash-command response

When `/secret`, `/pixel`, or another expressive WindSword feature activates, the line icon could briefly:

1. brighten,
2. emit one wind streak,
3. return to normal.

This creates personality without turning the interface into a game animation.

---

# 9. Motion rules

Always support:

```css
@media (prefers-reduced-motion: reduce) {
  .wind-icon,
  .wind-effect,
  .gem-effect {
    animation: none !important;
    transition: none !important;
  }
}
```

Recommended limits:

- micro feedback: **100–140ms**
- icon hover: **140–180ms**
- blade shimmer: **700–1200ms**
- rare aura pulse: **1.5–2.5s**
- avoid infinite animation except extremely subtle ambient About-page effects

Never animate:

- favicon
- iOS home-screen icon
- Android launcher icon
- legal-document content
- persistent navigation icon continuously

---

# 10. Small-size rule

At very small sizes, **simpler wins**.

| Size | Recommended asset |
|---:|---|
| 16px | future micro sword / tightly cropped bold line mark |
| 24px | bold black/white line mark |
| 32–40px | black/white line mark |
| 48–64px | line, grayscale, or full color |
| 96px+ | full-color sword |
| 180–512px | stone/sand app icons |
| 512px+ | full-color hero / social art |

The current line-art swords are better for headers than the earlier thin line drawing because they retain recognizable geometry at smaller sizes.

---

# 11. Suggested next brand step

After Cole integrates this pack, consider adding a **micro WindSword mark** derived from the same sword:

- blade + small guard
- no feathers
- no gem detail below 20px
- roughly the visual simplicity of `🗡️`

That mark would become the ideal:

- 16px favicon
- slash-command icon
- inline status icon
- loading indicator
- browser tab mark

The detailed winged sword remains the full WindSwordAI identity; the micro sword becomes its smallest-system shorthand.

---

## Core rule

> **Use detail when the surface can support detail. Use the simple line sword when the interface needs speed, clarity, or small-scale recognition.**

Do not redraw the approved primary sword casually. Create derivatives by cropping, resizing, masking, or simplifying only when the target size genuinely requires it.
