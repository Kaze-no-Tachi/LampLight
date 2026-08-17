# Adopting React Suite (rsuite)

## Status

Decided with the user; nothing in `package.json` or `src/` has been touched
for this yet. Next: phase 1 (foundations) below, as its own gated commit.

**Decisions taken:**

- **Coexist with Tailwind**, not replace it. Tailwind stays for page layout,
  spacing, and typography; rsuite is for interactive controls only.
- **Dialogs first.** `AddLessonDialog` and the two `window.confirm` archive
  buttons are phase 2, ahead of the `/teach` admin screen.
- **One screen or component category per commit**, gated in full each time,
  same as every round-2 chunk.

## What was asked

Rebuild the UI on React Suite (rsuite), modals included. No component list or
pace was specified beyond that, and CLAUDE.md already flagged this as needing
its own plan: which components rsuite replaces first, whether Tailwind and
rsuite's own styling coexist or one wins, and whether native `<dialog>` /
`window.confirm` get swapped for rsuite's `Modal` in the same pass.

## Facts gathered before proposing anything

- **Current surface**: 52 tsx files under `src/app`, 28 of them client
  components. Exactly two native dialogs (`add-lesson-dialog.tsx` uses
  `<dialog>`) and two `window.confirm` call sites (`archive-course-button.tsx`,
  and an archive button inside `lesson-list.tsx`). No component library is
  installed; every screen is Tailwind v4 utility classes plus plain HTML
  elements.
- **rsuite 6.2.2** (current npm latest) lists `react: ">=18"` and
  `react-dom: ">=18"` as peer dependencies, no upper bound, so it installs
  against React 19 with no `--legacy-peer-deps` workaround needed.
- **rsuite ships per-component entry points** (`rsuite/Modal`, `rsuite/Button`,
  etc., both CJS and ESM) with `sideEffects` scoped to each component's own
  `styles/*.css`. That means importing one component does not pull in the
  whole ~700KB `rsuite.min.css`; only the CSS a given screen actually uses
  needs to load.
- **rsuite 6.x themes entirely through CSS custom properties** (`--rs-*`,
  4,577 of them in the shipped stylesheet), including a primary color scale
  (`--rs-primary-50` through `--rs-primary-900`), a gray scale, and semantic
  aliases (`--rs-bg-card`, `--rs-text-color`, `--rs-border-primary`, and so
  on). This is the one fact that decides whether this adoption is safe to do
  at all, covered next.
- rsuite needs a `CustomProvider` mounted once near the root (locale, RTL,
  and the container some overlaid components portal into); this project has
  no client-side root wrapper today; something has to hold it, most likely
  `chrome.tsx` or a small new provider file sitting beside it.

## The risk that has to be solved before anything else

Per-tenant theming (PRD section 9) is not decoration here, it is the reason
this product looks like each institute owns it rather than looks like a
shared LMS. `src/lib/theme/theme.ts` resolves an institute's preset and
overrides into a `TokenMap`, and `chrome.tsx`'s `ThemeStyle` renders it as a
`:root` block at request time so Tailwind's `--primary`, `--background`, and
so on pick it up with no rebuild.

rsuite's default stylesheet sets its own `--rs-primary-*` scale to rsuite's
stock blue, completely independent of this app's tokens. Installed and used
as-is, every rsuite `Button` and `Modal` on every institute's site would be
the same blue regardless of that institute's brand color: the exact failure
mode custom CSS was refused for in `theme.ts`'s own reasoning, arrived at
from the opposite direction (a library owning the styling this time, not an
admin-supplied stylesheet).

The fix looks buildable, not experimental: extend the same request-time
`:root` block `ThemeStyle` already emits to also derive `--rs-primary-*`,
`--rs-gray-*`, and the handful of semantic `--rs-bg-*`/`--rs-text-*`/
`--rs-border-*` aliases rsuite actually reads, from the same resolved
`TokenMap` `theme.ts` already computes (a resolved `primary` producing a
50-900 tint/shade ramp the way `mix()` already blends colors for muted text).
This is new work, not configuration: nothing generates a color ramp from one
hex value today. Scoping it down to only the `--rs-*` variables the adopted
components actually read (not all 4,577) keeps it bounded to each phase below
rather than a big upfront rewrite of the theme engine.

## Why these decisions

1. **Coexist, not replace.** rsuite has no opinion on page layout; rewriting
   every `<div className="flex ...">` into `Grid`/`FlexboxGrid` is a much
   larger, riskier project than the ask ("rebuild the UI on rsuite, modals
   included") requires, for no identified product benefit.
2. **Dialogs first.** Smallest real slice: it proves the theming bridge and
   the `CustomProvider` placement on two screens with existing e2e coverage
   that already exercises them end to end, before touching the larger and
   more visible `/teach` admin surface.
3. **One screen per commit**, gated the same way every round-2 chunk was
   (typecheck, lint, format, em dash check, unit and isolation suite, full
   e2e suite). Each e2e spec touching a converted screen needs its selectors
   checked against whatever DOM rsuite actually renders (its `Button` is not
   a bare `<button>`, its `Modal` is not a bare `<dialog>`), which is exactly
   what "run the thing, do not assert that it works" exists to catch.

## Phases

1. **Foundations.** Install `rsuite`, add `CustomProvider` near the root
   (likely wrapping `chrome.tsx`'s children or a new small provider
   component), extend `theme.ts`/`ThemeStyle` to also emit the `--rs-*`
   tokens the adopted components need, derived from the same resolved
   `TokenMap`. No screen changes yet; verified by rendering one rsuite
   `Button` somewhere temporary and confirming it actually recolors across
   Grace's and Cornerstone's two different seeded themes.
2. **Pilot: modals and confirms.** `AddLessonDialog` and the two archive
   confirmations move to rsuite's `Modal`. This is the concrete "modals"
   part of the ask, done first and small enough to fully verify against the
   existing e2e specs that already drive these flows
   (`tests/e2e/catalog.spec.ts`'s unified-editor test archives a lesson and
   the course; `teaching.spec.ts` covers the instructor side).
3. **Forms and controls on the newly merged `/teach` admin surface.** Publish
   toggle to rsuite `Toggle`, the instructor `<select>` to `SelectPicker`,
   the course/program creation forms to rsuite `Form`/`Input`. Chosen because
   it is the screen this session just finished rebuilding, so its shape is
   freshest and its e2e coverage (just rewritten in chunk 5) is the most
   current.
4. **Outward from there**, one screen category per commit: `/settings/people`
   and `/settings/domains` (lists, forms, an inline confirm), then the
   remaining settings screens, then the public-facing catalogue and shelf
   only if the earlier phases show the coexistence approach is holding up
   without visual regressions.

Each phase is its own commit or small set of commits, gated in full, exactly
like round 2's chunks.

## What this plan deliberately does not decide

- Exact `--rs-*` to `TokenMap` mapping formula (tint/shade ramp math): left
  for the foundations phase, once the user has confirmed this is worth
  building at all.
- Whether `window.confirm` disappears entirely or only the two archive
  buttons in scope today get converted: scope is "dialogs and confirms
  that exist right now", not a mandate to invent new confirmation UI
  elsewhere.
- Whether a future rsuite version or a different theming approach
  (CSS-in-JS override, a rsuite theme preset per institute precomputed at
  branding-save time instead of per-request) would be cheaper than deriving
  `--rs-*` at request time. Request-time derivation was picked here only
  because it mirrors what `theme.ts` already does and needs no new storage.
