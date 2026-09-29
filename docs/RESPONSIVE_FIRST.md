# WindSwordAI Responsive-First Standard

WindSwordAI is **mobile-first and web-first**. Responsive behavior is a product requirement, not a finishing pass.

## Benchmark

The interaction quality and breakpoint behavior of [GoldenSunAI](https://sukonik.github.io/goldensunai/index.html) is the baseline reference for WindSwordAI responsiveness.

WindSwordAI should preserve its own legal-AI visual identity, but match or exceed GoldenSunAI in:

- navigation smoothness
- mobile hierarchy
- spacing consistency
- breakpoint transitions
- theme controls
- button responsiveness
- touch ergonomics
- animation restraint
- accessibility
- perceived speed

## Core Rule

**Design mobile first. Enhance upward for tablet and desktop. Do not build desktop UI and patch it down later.**

Every new interface PR — Chat, Matters, document viewers, loaders, Night Studio, research, integrations, admin tools, settings, and future plugins — must follow this standard.

## Navigation

### Phones

- Use a purpose-built mobile navigation experience.
- Do not squeeze the desktop sidebar into a phone layout.
- Prefer simple, high-confidence navigation with large touch targets.
- Theme / Appearance controls must remain reachable on mobile.
- Menu open/close should feel immediate.
- Support close button, navigation, Escape where applicable, and an obvious outside-dismiss gesture.
- Lock background scroll while the mobile menu is open.

### Tablet and desktop

- Progressively enhance navigation instead of duplicating mobile complexity.
- Desktop can expose persistent navigation where useful.
- Avoid unnecessary motion or oversized chrome.

## Motion

Use fast, restrained timing:

- fast interaction feedback: approximately **120ms**
- normal menu/drawer transitions: approximately **180–220ms**
- easing: `cubic-bezier(0.2, 0.7, 0.2, 1)`

Animations must support `prefers-reduced-motion`.

Mobile animations should normally be simpler than desktop animations.

## Buttons and controls

- Minimum practical touch target: **44 × 44px**
- Icon-only buttons require accessible names.
- Interactive state must not rely on color alone.
- Focus state must be clearly visible.
- Disabled, active, expanded, pressed, and loading states should be perceptible.
- Prefer native semantic controls where practical.

## Layout

WindSwordAI should be reviewed at minimum at:

- 320px
- 360px
- 390px
- 430px
- 640px
- 768px
- 900px
- 1024px
- 1440px

Requirements:

- no horizontal overflow
- no clipped primary controls
- no unreachable theme/navigation controls
- chat composer remains usable with mobile safe areas and dynamic viewport height
- content hierarchy remains understandable without relying on hover
- dense desktop features should collapse intentionally rather than shrink indiscriminately

## Control sizing and density

- `--control` is the touch-first control size (44px). Phones and touch tablets always use it.
- Only **desktop with a mouse** (`min-width: 900px` and `pointer: fine`) drops to dense 40px controls (36px for segmented options). Never key density off width alone.
- Hover styles live inside `@media (hover: hover)` so a tap never leaves a sticky hover state.
- Buttons are reset (`appearance: none`, `padding: 0`, `touch-action: manipulation`); circular controls set `aspect-ratio: 1` and min sizes so flex/grid can never squash them.
- Every button-like control has an `:active` press state (~120ms) and a visible `:focus-visible` ring. `forced-colors` gets explicit borders.

## Search

- One search field lives at the top of the navigation (menu sheet on phones, sidebar on desktop). 16px font on phones (no iOS zoom), 48px tall on touch, 40px dense with a mouse.
- Filters pages and recent chats live; `Enter` opens the first result, `↓` moves into the list, `Esc` clears first and only then closes the sheet.
- `⌘K` / `Ctrl K` focuses it (opening the sheet first on phones/tablets); the hint chip shows only where a keyboard is likely.

## Chat feed

The feed always knows where it is:

- **Pinned** to the latest message while you are at the end; a `ResizeObserver` keeps it pinned when the composer grows, the keyboard opens, or the device rotates.
- **Your own message** always returns the feed to the end.
- **A reply while you are reading history** does not yank the scroll. A "Jump to latest" / "N new replies" button appears instead.
- The toolbar gains a shadow once the feed has scrolled; the feed is a labelled `role="log"`.
- The chat height follows `visualViewport` (`--vvh`) because iOS Safari does not shrink the layout for the keyboard. Reading width is `--chat-measure` (760px, 840px on ≥1600px) and the composer aligns to it.

## Performance

Rich does not mean heavy.

Prefer:

- CSS transitions over animation frameworks
- system fonts unless a brand font materially adds value
- lightweight SVG/CSS visuals
- reduced blur/transparency on constrained layouts
- local/static assets where appropriate
- progressive enhancement

Avoid adding a large runtime dependency solely for visual polish.

## Accessibility

Responsive QA includes accessibility QA.

Each interface PR should verify:

- keyboard focus
- screen-reader labels for icon-only controls
- native semantics where possible
- visible focus rings
- sufficient contrast
- reduced-motion behavior
- large touch targets
- reasonable reading order
- hidden mobile drawers are not focusable when closed

## CI / Review Gate

UI PRs should generate review screenshots and browser checks.

A responsive regression is a merge blocker.

At minimum, CI should catch:

- horizontal overflow
- console/page errors
- broken mobile navigation
- hidden/unusable Appearance controls
- theme persistence regressions
- touch targets below the expected minimum
- route-specific layout failures

## Product principle

> **WindSwordAI should feel purpose-built at every screen size — not like one layout being forced to fit another device.**
