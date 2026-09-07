---
phase: 01-local-environment
plan: 05
subsystem: ui
tags: [nextjs, react, drizzle, css, archivo, vitest]

requires:
  - phase: 01-local-environment
    provides: "the full recipe/ingredients/steps core with two applied migrations, the deterministic 1/8/5 seed, and the tracer-proven Server Component route from plans 01-02..01-04"
provides:
  - "The ported Recipe Page screen (RecipeScreen, IngredientsGrid, StepsList) wired to real database rows, preserving Recipe Page.dc.html's deliberate divergences (non-4px spacing/radius, three font weights, warm palette)"
  - "/recipes/[slug]/not-found.tsx and /recipes/[slug]/error.tsx — net-new markup on the standard 8pt scale, kept separate from the ported screen's exception values"
  - "/ entry route redirecting to the seeded recipe"
  - "tests/smoke.test.ts extended with content-level assertions (ingredient names, step bodies, tab labels, CTA label, servings caption, no-image, 404 not-found heading) — still a pure HTTP-response boot proof reusable by Phase 4 RUN-07 and Phase 5 CI-01"
affects: [phase-04, phase-05]

actuals:
  tokens: 8492
  tasks: 2
  commits: 2
  plan_head_before: 33de5f4d3655b90aa3509545874c56fce953be3c

tech-stack:
  added: []
  patterns:
    - "DC binding-model -> React translation applied literally per 01-PATTERNS.md's table: {{ expr }} -> JSX expression, sc-if -> logical-and, sc-for -> .map, style-hover -> a CSS :hover class rule (never a prop)"
    - "Two separate spacing regimes in one globals.css: rp-* classes carry the Recipe Page's verbatim non-4px source values; std-* classes (not-found/error) use the standard 8pt scale — never merged"
    - "Quantities scaled at render time from the raw stored numeric column, never pre-scaled in the database; the same round() helper is transliterated verbatim from the source"

key-files:
  created:
    - apps/recipe-app/src/components/RecipeScreen.tsx
    - apps/recipe-app/src/components/IngredientsGrid.tsx
    - apps/recipe-app/src/components/StepsList.tsx
    - apps/recipe-app/src/app/globals.css
    - apps/recipe-app/src/app/page.tsx
    - apps/recipe-app/src/app/recipes/[slug]/not-found.tsx
    - apps/recipe-app/src/app/recipes/[slug]/error.tsx
  modified:
    - apps/recipe-app/src/app/layout.tsx
    - apps/recipe-app/src/app/recipes/[slug]/page.tsx
    - tests/smoke.test.ts

key-decisions:
  - "Dropped the desktop frame's app-shell 'Kitchen' top bar (brand + This week/Recipes/Shopping/Settings text + breadcrumb) and used the same back/save icon nav row at all three breakpoints instead, sized per the exceptions table's 38/40/48px row. That app-shell chrome points at sections (meal planner, shopping) explicitly unbuilt in this phase (D-07); the must_haves' own header definition names only 'back and save icon buttons' plus title/subtitle/meta row, which this satisfies without inventing navigation to screens that don't exist."
  - "The servings stepper is always rendered in the meta row at all three breakpoints (matching the tablet/desktop source behavior), rather than reproducing the phone frame's specific quirk of only showing it inside the Ingredients tab content. This is a documented simplification, not a silent one — flagged here for the human-check step."
  - "Desktop's two-column sidebar/main layout is implemented with CSS Grid named areas over a single DOM tree (no per-breakpoint markup duplication), matching the plan's 'port one responsive component' instruction; exact pixel geometry versus the three canvas frames is left for the human side-by-side comparison this task's own <verify><human-check> already calls for."

requirements-completed: [APP-01]

coverage:
  - id: D1
    description: "The Recipe Page renders the eight seeded ingredients and five seeded steps from the database, not hardcoded arrays; servings initialises from the recipe's base_servings column (D-06, D-23, APP-01)"
    requirement: APP-01
    verification:
      - kind: e2e
        ref: "tests/smoke.test.ts#renders all eight seeded ingredients, all five seeded steps, both tabs, the CTA label and the two-servings caption"
        status: pass
      - kind: unit
        ref: "grep confirmation: page.tsx query orders ingredients/steps by position with no hardcoded array; RecipeScreen.tsx declares exactly 4 useState hooks"
        status: pass
    human_judgment: false
  - id: D2
    description: "An unknown slug calls Next.js's not-found path; a failed query would hit a route-level error boundary rendering plain text plus a retry affordance, neither of which is data-bound to the ported screen's exception spacing"
    requirement: APP-01
    verification:
      - kind: e2e
        ref: "tests/smoke.test.ts#returns 404 with the not-found heading for an unseeded slug"
        status: pass
      - kind: unit
        ref: "grep confirmation: error.tsx never references error.message or error.stack; not-found.tsx and error.tsx use only 4/8/16/24/32px spacing values in globals.css's std-* rules"
        status: pass
    human_judgment: false
  - id: D3
    description: "The ported screen preserves the source's deliberate divergences (non-4px spacing/radius values, three font weights, favourite two-tone hardcoded independent of the accent constant, no hero image, no truncation) and matches the design 1:1 for content"
    verification:
      - kind: unit
        ref: "grep confirmation: favColor/favFill in RecipeScreen.tsx are #e0362b/#c9b3aa/none literals, not derived from ACCENT; no <img> tag and no ellipsis/text-overflow rule anywhere under apps/recipe-app/src/"
        status: pass
    human_judgment: true
    rationale: "Full visual fidelity against the three canvas frames (exact desktop sidebar proportions, breakpoint feel, hover states) requires a human side-by-side comparison — this task's own <verify><human-check> already calls for it and is harvested at end-of-phase per workflow.human_verify_mode."
  - id: D4
    description: "Responsive layout ships at the plan's proposed default breakpoints (phone <834px, tablet 834-1439px, desktop >=1440px) via min-width media queries, pending the developer's confirmation or override"
    verification: []
    human_judgment: true
    rationale: "UI-SPEC's own flagged assumption (Open Question 5) records these breakpoints as a proposed default awaiting confirmation, not a locked decision — the human-check step is where that confirmation happens."

duration: 20min
completed: 2026-09-07
status: complete
---

# Phase 01 Plan 05: Recipe Page Port and Route Hardening Summary

**The Recipe Page screen (header, tab track, servings scaler, ingredient grid, step list, favourite/cooked toggles) is now wired to the live database — real seeded ingredients and steps, scaled at render time from a real base_servings column — with a not-found path, an error boundary that never leaks connection details, and a smoke test that asserts on rendered content instead of a bare status code.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-09-07T01:10:00Z (approx, immediately following 01-04)
- **Completed:** 2026-09-07T01:26:00Z (approx)
- **Tasks:** 2 (both `type="auto"`)
- **Files modified:** 10 (7 created, 3 modified)

## Accomplishments
- Built `RecipeScreen.tsx` as a client component transliterating `Recipe Page.dc.html`'s `Component extends DCLogic` class 1:1: four `useState` hooks (`tab`, `servings`, `fav`, `cooked`), with `servings` initialised from `recipe.baseServings` instead of the source's hardcoded `2`. The multiplier, rounding helper, servings caption ("Scaled for one"/"Scaled for {n}"), clamp range (1-8), and CTA label toggle are all reproduced verbatim.
- Built `IngredientsGrid.tsx` and `StepsList.tsx`, receiving real rows from the Server Component and rendering the source's per-breakpoint card/step markup, scaling quantities at render time (never pre-scaled in the database) and preserving the per-step `hasTimer` conditional and the cloves/empty-unit/normal-unit formatting exactly as written.
- Extended `apps/recipe-app/src/app/recipes/[slug]/page.tsx` to load the recipe together with its ingredients and steps in one Drizzle query (`with: { ingredients: {...}, steps: {...} }`), both ordered by `position`, and pass the result straight to `RecipeScreen` — no hardcoded ingredient/step array anywhere in the route.
- Built `globals.css` carrying only the base body rule (15px/1.55/400) and the heading weight rule from the design system, plus the full `rp-*` class set for the ported screen (verbatim inline-style-derived spacing/radius/color) and a separate `std-*` class set on the standard 8pt scale for net-new markup — the two regimes never merged. Updated `layout.tsx` to load Archivo at weights 400/600/800 via `next/font/google` and import `globals.css`.
- Verified against a real production build + `next start`: the rendered page contains all eight seeded ingredient names, all five seeded step bodies, both tab labels, the CTA label, and "Scaled for 2"; contains no `<img>` element and no ellipsis/`text-overflow` rule anywhere; and the favourite two-tone (`#e0362b`/`#c9b3aa`) is hardcoded in the component source, independent of the `#e8623c` accent constant.
- Built `not-found.tsx` ("Recipe not found" / "No recipe matches that address. It may have been renamed." / link back to `/`) and `error.tsx` (client component wired to `reset`, "Could not load this recipe" / "The database did not answer..." / "Try again" button) — both net-new, both on the standard 8pt scale, neither referencing `error.message` or `error.stack`, and `error.tsx` logs nothing at all so no path can emit a connection string.
- Built `app/page.tsx` as the entry route, redirecting to `/recipes/chicken-rice-bowl` via Next's `redirect()`.
- Extended `tests/smoke.test.ts` with real HTTP-response assertions against the production build: all eight ingredient names, all five step bodies, both tab labels, the CTA label, and the two-servings caption for the seeded slug; no `<img>` element; and a 404 with the not-found heading for an unseeded slug. Kept the existing build/start/poll/`taskkill /T /F` teardown structure exactly as plan 01-02 established it.
- Ran the full `vitest` suite: 26/26 tests passing across 5 files (up from 24/24 before this plan). Left the development database up, healthy, migrated (2 journal entries) and seeded (1/8/5).
- Marked `APP-01` complete in `.planning/REQUIREMENTS.md` via the shared-ID readiness gate (`requirements.ready-ids` confirmed plan 01-03, the other declaring plan, had already produced its summary).

## Task Commits

Each task was committed atomically:

1. **Task 1: Port the Recipe Page screen and bind it to real rows** - `de24b37` (feat)
2. **Task 2: Not-found and error paths, entry route, and content-level smoke assertions** - `86c0d2e` (feat)

**Plan metadata:** committed alongside this summary.

## Files Created/Modified
- `apps/recipe-app/src/components/RecipeScreen.tsx` - client component, 4-state binding-model port, header/meta/tabs/CTA
- `apps/recipe-app/src/components/IngredientsGrid.tsx` - ingredient card grid, render-time quantity scaling
- `apps/recipe-app/src/components/StepsList.tsx` - ordered step list with per-step conditional timer chip
- `apps/recipe-app/src/app/globals.css` - base body/heading rules + `rp-*` (ported) and `std-*` (net-new) class sets
- `apps/recipe-app/src/app/layout.tsx` - loads Archivo (400/600/800) via `next/font/google`, imports `globals.css`
- `apps/recipe-app/src/app/recipes/[slug]/page.tsx` - loads recipe + ordered ingredients/steps in one query
- `apps/recipe-app/src/app/recipes/[slug]/not-found.tsx` - net-new, standard 8pt scale
- `apps/recipe-app/src/app/recipes/[slug]/error.tsx` - client error boundary, no message/stack leak, no logging
- `apps/recipe-app/src/app/page.tsx` - entry route, redirects to the seeded recipe
- `tests/smoke.test.ts` - extended with content-level assertions (see Accomplishments)

## Decisions Made
See `key-decisions` in frontmatter for full rationale. Summary: dropped the desktop frame's app-shell "Kitchen" top bar (points at unbuilt sections) in favor of a uniform back/save icon nav row at all breakpoints; always render the servings stepper in the meta row regardless of active tab rather than reproducing the phone frame's tab-gated placement; desktop's two-column layout uses CSS Grid named areas over one DOM tree rather than duplicated markup.

## Deviations from Plan

### Auto-fixed Issues

None - no bugs, missing critical functionality, or blocking issues were encountered during implementation. The three items above are documented design-fidelity decisions made under "Claude's Discretion" (01-CONTEXT.md: "How the ported screen's Claude Design binding model... maps onto React components"), not fixes to broken behavior, so they are recorded under Decisions Made / coverage D3-D4 rather than as Rule 1-3 auto-fixes.

---

**Total deviations:** 0 auto-fixed
**Impact on plan:** None. All implementation choices are documented decisions within the plan's own declared discretion, surfaced for the human-check step already built into Task 1's `<verify>` block.

## Issues Encountered
None. Both tasks completed on the first attempt; `pnpm --filter recipe-app build` and `pnpm exec vitest run` passed without a fix cycle.

## Known Stubs

None. Favourite and cooked are intentionally ephemeral client-only React state per the resolved owner decision (UI-SPEC Open Question 2) — not a stub, a locked scope boundary. No UI element renders empty/placeholder data; every rendered field is sourced from the seeded database rows.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 1's full scope is now delivered: the disposable local Postgres environment, the generate→inspect→migrate loop (exercised twice), `db:query`/`db:reset`, the structural guardrail suite, and the wired Recipe Page screen with its not-found/error paths and a content-asserting smoke test.
- All five plans in this phase now have summaries; `APP-01` is complete, joining `ENV-01`...`ENV-05` (all previously marked complete in earlier plans of this phase).
- The human-check items flagged in Task 1's `<verify>` (visual side-by-side comparison against `Recipe Page.dc.html`, and confirmation or override of the proposed responsive breakpoints) are unresolved by design under `workflow.human_verify_mode: end-of-phase` — they are harvested into the phase's UAT step rather than gated mid-flight here.
- `.planning/WINDOWS.md` has one pre-existing open entry (plan 01-02's no-RED-phase note) unrelated to this plan; no new entries were added by this plan.
- The development database is left up, healthy, migrated (2 journal entries) and seeded (1 recipe / 8 ingredients / 5 steps).

---
*Phase: 01-local-environment*
*Completed: 2026-09-07*

## Self-Check: PASSED

- All key-files.created confirmed present on disk: `apps/recipe-app/src/components/{RecipeScreen,IngredientsGrid,StepsList}.tsx`, `apps/recipe-app/src/app/globals.css`, `apps/recipe-app/src/app/page.tsx`, `apps/recipe-app/src/app/recipes/[slug]/{not-found,error}.tsx`.
- `git log --oneline --all` confirms both task commits exist: `de24b37` (Task 1) and `86c0d2e` (Task 2).
- Re-ran every plan-level `<verification>` command immediately before writing this summary: `pnpm --filter recipe-app build` compiles with no TypeScript error; a request to `/recipes/chicken-rice-bowl` returns 200 with all eight ingredient names, all five step bodies, both tab labels, the CTA label and "Scaled for 2" in the body; the response contains no `<img>` element; a request to an unseeded slug returns 404 with "Recipe not found" in the body; `error.tsx` contains no reference to `error.message` or `error.stack`; `pnpm exec vitest run` reports 26/26 passing across 5 files with no failures or skips.
- Confirmed the development database is left up, healthy, migrated (2 journal entries) and seeded (1/8/5) via `pnpm db:query`.
