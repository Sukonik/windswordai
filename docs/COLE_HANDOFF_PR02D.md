# Cole Handoff — PR 02D Mobile/UI Rebuild + Canonical Brand Assets

## Team authority

### Cole — CTO / Lead Developer
Cole is the implementation lead for WindSwordAI.

Cole may:
- refactor or replace the current shell/components/CSS structure;
- remove accumulated UI patches that are getting in the way;
- reorganize responsive styles and breakpoints;
- change component boundaries;
- simplify or replace existing navigation behavior;
- replace the current generated sword SVG treatment;
- change the implementation strategy if it produces a cleaner, faster result;
- improve CI/review tooling as needed.

Cole does **not** need to preserve the current PR 02C implementation just because it is already merged.

### Ari — CDO / Lead Design + Product Architecture
Ari owns:
- product architecture;
- UX/UI direction;
- visual identity;
- responsive behavior requirements;
- mobile/web acceptance criteria;
- security/product constraints;
- PR sequencing;
- final design review before merge.

Nathan is final product approval.

## Why this handoff exists

The current WindSwordAI site is technically responsive but does not yet meet the desired product feel on phones. The logo implementation is also not faithful enough to the user-approved artwork.

Do **not** continue patching the current desktop-oriented shell indefinitely.

Treat PR 02D as a clean correction.

## Critical reference repositories

These are required references, not optional inspiration.

### 1. GoldenSunAI — primary responsiveness benchmark
Repository:
https://github.com/Sukonik/goldensunai

Live:
https://sukonik.github.io/goldensunai/index.html

Reference this for:
- overall smoothness;
- mobile-first hierarchy;
- breakpoint transitions;
- navigation feel;
- touch interaction;
- spacing rhythm;
- visual polish without sluggishness;
- desktop/mobile continuity.

WindSwordAI must feel at least this smooth across the board.

### 2. UUUB — brand-site responsiveness and presentation benchmark
Repository:
https://github.com/Sukonik/uuub

Reference this for:
- brand presentation;
- responsive composition;
- typography;
- mobile section flow;
- polished cards/buttons;
- simple but rich visual identity.

### 3. BlackBowAI 9 — team workflow / implementation precedent
Repository:
https://github.com/Sukonik/blackbowai9

Reference this for:
- Ari ↔ Cole working relationship;
- Cole as lead developer / CTO;
- Ari as design/product architecture lead / CDO;
- review-artifact discipline;
- iterative PR cadence;
- implementation autonomy inside approved product constraints.

### 4. ClearSky / weather-app — responsive application precedent
Repository:
https://github.com/Sukonik/weather-app

Reference this for:
- dense responsive information UI;
- mobile-first application behavior;
- multi-view consistency;
- practical touch-friendly controls.

## Brand assets — canonical user-approved hierarchy

The approved artwork from the design review is:

1. **Primary logo:** shaded winged longsword
   - exact conversation file name: `WindSwordAI logo, tilted, shaded.png`
   - use as the main brand/logo treatment at sizes where detail remains legible.

2. **Compact/system logo:** clean line winged longsword
   - exact conversation file name: `WindSwordAI logo, tilted, clean (1).png`
   - use for small headers, favicon/app-icon contexts, compact mobile UI, monochrome contexts.

3. **Full-color identity artwork:** blue-steel winged longsword
   - exact conversation file name: `bluesteel.png`
   - use for About/hero/brand moments.
   - silver/steel body, deep blue blade, restrained red jewel.

4. Additional approved square logo asset:
   - exact conversation file name: `WindSwordAI logo, 800x800.png`

### Brand rule
**Do not redraw, reinterpret, trace into a different sword, or replace these with a homemade substitute mark.**

If optimization is needed:
- preserve the approved silhouette and proportions;
- crop/resize/compress transparently;
- create WebP/AVIF/PNG derivatives as needed;
- do not materially redesign the source art.

## PR 02D objective

Rebuild WindSwordAI's responsive shell so it feels intentionally designed on both mobile and desktop.

This PR is allowed to replace PR 02C implementation details.

### Phone layout target

At 320–430px:
- simple top bar;
- clean menu button;
- canonical compact logo;
- Appearance/theme control remains easy to reach;
- full-height or sheet-style mobile menu designed specifically for phones;
- large touch-friendly navigation rows;
- no desktop sidebar squeezed into the viewport;
- clear close behavior;
- no awkward empty strips;
- no crowded status badges;
- no clipped labels;
- no controls relying on hover;
- composer respects safe areas and keyboard/dynamic viewport behavior.

### Desktop/tablet target
- retain rich legal-workspace feel;
- smooth transition from phone → tablet → desktop;
- persistent navigation only where it genuinely improves the workspace;
- avoid oversized chrome;
- keep primary work area dominant.

## Interaction feel

Use GoldenSunAI as the feel benchmark.

Target:
- button feedback around 100–140ms;
- drawer/menu transitions around 180–220ms;
- restrained easing;
- no sluggish blur-heavy motion;
- no visual jank;
- no long decorative transitions on mobile.

`prefers-reduced-motion` must remain supported.

## Appearance switcher

Must work reliably on mobile and desktop.

Requirements:
- visible/reachable on phones;
- persisted across reloads and route changes;
- light/dark transitions should not flash incorrectly on load;
- menu and topbar controls should agree;
- all pages must remain legible in both themes.

## Accessibility

Minimum:
- 44×44px practical touch targets;
- visible focus rings;
- accessible names on icon-only buttons;
- semantic buttons/selects/links;
- correct `aria-expanded` / `aria-pressed` where applicable;
- closed mobile menu must not remain keyboard-focusable;
- sufficient contrast;
- reduced-motion support;
- reasonable reading/focus order.

## About page

Keep the concept, but implement it with the canonical assets.

### Light theme
- normal blue-steel artwork;
- crisp steel/silver presentation;
- minimal ambient motion.

### Dark theme
- blue-steel artwork can brighten toward white-blue;
- soft white aura;
- restrained wind/light effect;
- red jewel remains restrained.

### Desktop motion
- simple wind arcs/streams;
- subtle blade-light sweep;
- slow ambient glow.

### Mobile motion
- simpler than desktop;
- 1–2 wind streaks;
- soft pulse/glow;
- prioritize performance/battery.

Reduced-motion users should get a static illuminated composition.

## Code cleanup expectation

Cole may remove or replace accumulated overrides from:
- PR 02B;
- PR 02C;
- current duplicated breakpoint patches;
- current custom sword SVG implementation.

Prefer a coherent system over another layer of overrides.

Strong preference:
- base/mobile styles first;
- progressive tablet/desktop enhancement;
- fewer contradictory media queries;
- shared design tokens;
- shared button/nav primitives;
- reusable responsive layout primitives.

## Required review widths

Review actual screenshots at:
- 320×740
- 360×800
- 390×844
- 430×932
- 640px
- 768×1024
- 900px
- 1024×768
- 1440×1000

## Required review routes

At minimum:
- Home
- Chat
- mobile menu open
- mobile menu light theme
- About
- Matters
- Night Studio
- Settings
- Status

## Merge gate

**Green CI is necessary but not sufficient.**

Do not merge PR 02D merely because tests pass.

Required before Ari/Nathan review:
1. publish or attach real screenshots from required breakpoints;
2. provide an easy demo/review link;
3. provide downloadable review artifact;
4. confirm canonical logos are actually used;
5. show mobile menu open in dark + light;
6. show About in dark + light;
7. show Chat at 390px with composer visible;
8. confirm no horizontal overflow;
9. confirm theme persistence;
10. confirm no console/page errors.

Ari will review visual quality and responsive feel against GoldenSunAI before signoff.

## What must NOT change in this PR

Do not expand scope into:
- PR 03 real provider/runtime work;
- LQ.AI retrieval;
- document loaders;
- OCR;
- matter backend;
- Harvey LAB integration.

PR 02D is the last dedicated visual/responsive correction before capability work.

## After PR 02D

Cole remains lead developer for implementation.

Ari remains design/product architecture lead.

Planned sequence returns to:
- PR 03 — secure chat runtime/provider gateway;
- PR 04 — secure document + image loader;
- PR 05 — LQ.AI retrieval/citations;
- PR 06 — Matters;
- PR 07 — Night Studio;
- PR 08–10 — repair/OCR/sandbox/evaluation.

## Definition of done

WindSwordAI should feel like a sibling of GoldenSunAI / UUUB / ClearSky in polish, but retain its own WindSwordAI legal-workspace identity.

The key test is simple:

> A user should not feel that the mobile site is a desktop application being forced onto a phone.
