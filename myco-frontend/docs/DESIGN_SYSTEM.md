# Boxcode HRMS — Design System

## Direction

Amber on graphite, carried over from the approved sign-in page and the mobile
app so the whole product reads as one thing. The dashboard defaults to a light
theme (white cards, soft shadows) because HR scans tables all day; a real dark
theme and a system mode sit behind the topbar toggle.

"Premium" here means hierarchy, spacing, motion restraint and truthful state
design - not maximum glass. Glass is reserved for chrome that floats
(topbar, dropdowns, dialogs); content cards are solid.

## Tokens

Single source: `shared/design-tokens/tokens.json`, mirrored into
`web/app/globals.css` (CSS custom properties) and `mobile/src/theme.ts`.

Web token names: `--ground, --surface, --surface-2, --line, --ink, --ink-2,
--ink-3, --accent`, plus reserved status colours `--st-present, --st-late,
--st-half, --st-absent, --st-pending`. Status colours are never reused as
decoration.

## Theming (web)

- `:root` holds the dark palette - the sign-in page's design, untouched.
- `.bx-light` / `.bx-dark` re-skin the dashboard subtree (`#bx-shell`) by
  overriding the custom properties; components never branch on theme.
- The choice (light / dark / system) persists in `localStorage['bx-theme']`.
  A `beforeInteractive` script in the root layout flags `<html>` with
  `.bx-dark-mode` before first paint, so there is no white flash; CSS scopes
  that flag to `#bx-shell` so the sign-in page is unaffected.

## Surfaces

| Class | Use |
|---|---|
| `.bx-card` | Primary content card. Solid, bordered, soft shadow |
| `.bx-glass` | Floating chrome: topbar |
| `.bx-glass-strong` | Overlays: dropdowns, menus |
| `.bx-ambient` | Page background wash - two static radial gradients, zero per-frame cost |

## Status system

One vocabulary product-wide (`web/components/Status.tsx`,
`mobile/src/format.ts` STATUS_META). **Never colour alone**: every status is a
word + glyph (+ colour). Glyphs: ● present/approved, ◐ half day, ○
absent/rejected, ◇ on leave, ◌ pending, – off/holiday/cancelled.
Presence (currently in the office) is a separate live mark - an amber dot with
a slow `bx-pulse` ring - never conflated with the day's computed status.

## Motion

- `bx-rise` / `bx-rise-i` (staggered via `--bx-i`): content entering. 350ms,
  ease-out-quart, 6px travel.
- `bx-pop`: menus/dialogs. 180ms.
- `CountUp`: headline numbers settle over 600ms, real value always in the DOM.
- `bx-pulse`: live presence. `bx-skeleton`: loading shimmer (opacity only).
- Everything animates transform/opacity only. `prefers-reduced-motion`
  disables all of it.
- Mobile uses RN `Animated` with `useNativeDriver`; the HOLBOX shutter
  animates a slice's translateX and never the letters' opacity - if animation
  fails, the word still reads.

## Type

Archivo (display), Source Sans 3 (body), IBM Plex Mono - loaded via `<link>`,
never `next/font` (it fetches at build time and breaks offline builds).
Tabular numerals (`.tnum`) on every number column.

## Layout & responsiveness

Max content width 1280px. Sidebar: fixed at ≥lg, drawer below. Grids collapse
5→3→2 columns. Tables that carry many columns either scroll inside their card
(board) or transform to card lists below `md` (directory). The body never
scrolls horizontally.

## Accessibility rules

- Focus is always visible: 2px accent outline, offset 2 (`#bx-shell :focus-visible`).
- Icon-only buttons carry `aria-label`; live updates use `role="status"` /
  `aria-live`; decorative glyphs are `aria-hidden` with `sr-only` text beside
  them where meaning matters.
- Dialogs are native `<dialog>` (focus trap, Escape, backdrop for free).
- Empty states say what would appear; a 403 says who the page is for.
- Touch targets on mobile ≥ 44pt for primary actions.
