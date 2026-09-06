# Phase 1: Local Environment - Pattern Map

**Mapped:** 2026-09-06
**Files analyzed:** 20 (new/modified)
**Analogs found:** 5 (design-tree/doc analogs) / 20 — the remaining 15 are `NO ANALOG — greenfield`

## Ground truth: this repo has no application code yet

`git ls-files` returns 39 tracked files: `.planning/` artifacts, `docs/`, `CLAUDE.md`,
`.claude/`, and the Claude Design import under `apps/recipe-app/design/`. There is no
`package.json`, no `docker-compose.yml`, no TypeScript, no Drizzle config, no test
framework. **Every infra/backend file this phase creates is genuinely new — do not
invent server-side or tooling analogs that don't exist.** The only two categories of
real, in-repo prior art are:

1. **The design tree** (`apps/recipe-app/design/`) — the highest-value analog for the
   `Recipe Page` port. Tokens, class names, exact markup, and the binding-logic shape all
   transfer directly into concrete `<action>` values.
2. **Documentation conventions** (`docs/decisions.md`, `CLAUDE.md`) — for how the D-27
   redeploy-investigation findings and any new decision entries must be written.

`apps/recipe-app/design/IMPORT.md` states explicitly (quoted): *"The design is imported
**as-is**. Do not restyle it. Per decision D13, the UI is taken verbatim and backend
functionality stays thin."* And on `Recipe Page.dc.html` specifically: *"deliberately
departs from Modernist (rounded corners, warmer palette) and its own notes say so. That
divergence is intentional; keep it."* And on transcription risk: *"'Transcribed' means
the content passed through the model context rather than being decoded straight to
disk... if a rendering discrepancy ever appears, re-fetch that file from the source
project before debugging it as a styling bug."*

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `pnpm-workspace.yaml`, root `package.json` | config | — | none | NO ANALOG — greenfield |
| `docker-compose.yml` | config | — | none | NO ANALOG — greenfield |
| `scripts/env.ts` | utility | request-response (validation) | none | NO ANALOG — greenfield |
| `scripts/db-query.ts` | utility/CLI | request-response | none | NO ANALOG — greenfield |
| `scripts/db-reset.ts` | utility/CLI | batch (orchestration) | none | NO ANALOG — greenfield |
| `apps/recipe-app/drizzle.config.ts` | config | — | none | NO ANALOG — greenfield |
| `apps/recipe-app/src/db/schema.ts` | model | CRUD | none | NO ANALOG — greenfield |
| `apps/recipe-app/src/db/client.ts` | service | request-response | none | NO ANALOG — greenfield |
| `apps/recipe-app/src/db/seed.ts` | utility | batch/file-I/O(DB) | design's own `ING`/`STEPS` arrays in `Recipe Page.dc.html` (lines 332-349) | role-match (content source, not code shape) |
| `apps/recipe-app/src/app/layout.tsx` | component | request-response | design's outer canvas wrapper in `Recipe Page.dc.html` (line 22) — **chrome only, do not port verbatim (see Open Q6)** | partial-match (structure inspiration only) |
| `apps/recipe-app/src/app/recipes/[id]/page.tsx` | component (Server Component) | request-response | `Recipe Page.dc.html` markup (lines 22-320) + its `DCLogic` `Component` class (lines 351-413) | exact (content/behavior), partial (needs React port) |
| `apps/recipe-app/src/app/recipes/[id]/error.tsx` | component | request-response | none (net-new, not part of ported screen — UI-SPEC explicitly says use standard 8pt scale, not Recipe Page exceptions) | NO ANALOG — greenfield |
| `apps/recipe-app/src/components/RecipeHeader.tsx` (or similar) | component | request-response | `Recipe Page.dc.html` lines 41-49 (title/subtitle/favorite) | exact (markup), needs React port |
| `apps/recipe-app/src/components/TabTrack.tsx` | component | event-driven (client state) | `Recipe Page.dc.html` lines 68-71 + logic lines 370-379 | exact (markup+logic), needs React port |
| `apps/recipe-app/src/components/ServingsStepper.tsx` | component | event-driven (client state) | `Recipe Page.dc.html` lines 75-82 + logic lines 358-359, 381-384 | exact (markup+logic), needs React port |
| `apps/recipe-app/src/components/IngredientsGrid.tsx` | component | CRUD (read) | `Recipe Page.dc.html` lines 83-92 + logic lines 386-393 | exact (markup+logic), needs React port |
| `apps/recipe-app/src/components/StepsList.tsx` | component | CRUD (read) | `Recipe Page.dc.html` lines 95-108 + logic lines 395-400 | exact (markup+logic), needs React port |
| `apps/recipe-app/src/components/CookedCta.tsx` / favorite toggle | component | event-driven (client state) | `Recipe Page.dc.html` lines 46-48 (favorite button), lines 407-410 (cooked logic) | exact (markup+logic), needs React port |
| `apps/recipe-app/drizzle/*.sql` + `meta/_journal.json` | migration | batch | none (generated artifact, not hand-written) | NO ANALOG — greenfield |
| test files (`scripts/env.test.ts`, smoke test, etc.) | test | request-response | none | NO ANALOG — greenfield |
| `docs/00-current-state.md` §7 update (D-27 findings) | documentation | — | `docs/decisions.md` entry format (below) | role-match (doc convention) |

## Pattern Assignments

### `apps/recipe-app/src/app/recipes/[id]/page.tsx` (component, request-response)

**Analog:** `apps/recipe-app/design/Recipe Page.dc.html` (markup) + its inline `Component`
class (logic), both in the same file.

**What ports directly — CSS/tokens/classes (from `_ds/modernist-.../styles.css`):**
```css
:root {
  --font-heading: "Archivo", system-ui, sans-serif;
  --font-heading-weight: 800;
  --font-body: "Archivo", system-ui, sans-serif;
}
body { margin: 0; font-size: 15px; line-height: 1.55; font-weight: 400; }
h1,h2,h3,h4,h5,h6 { font-family: var(--font-heading); font-weight: var(--font-heading-weight); }
```
Note: `Recipe Page.dc.html` itself overrides most of Modernist's zero-radius/2px-rule
system with its own inline styles (pill radii, 20-34px card radii, warm palette below) —
per D-06 that divergence is intentional. Only the font tokens and base body rule above are
genuinely shared; do not pull in `.btn`, `.card`, `.tag`, `.nav` etc. classes from
`styles.css` for this screen, since the ported page does not use them (it is 100% inline
styles in the source).

**Structural markup to port (content area only — nav strip → header → meta row → tab
track → active panel → CTA), from `Recipe Page.dc.html` lines 30-125** (phone frame shown;
tablet/desktop frames at lines ~150-320 repeat the same structure at different sizes —
port one responsive component, not three copies):
```html
<div style="flex:none;padding:18px 20px 0;display:flex;align-items:center;justify-content:space-between">
  <button ...back icon svg... </button>
  <button ...bookmark icon svg... </button>
</div>
<div data-hide-sb style="flex:1;...background:#fffaf6;border-radius:34px 34px 0 0;padding:26px 22px 0;margin-top:18px">
  <div style="display:flex;align-items:flex-start;gap:14px">
    <div style="min-width:0">
      <h2 style="margin:0;font-size:24px;line-height:1.15;letter-spacing:-.01em">{{ title }}</h2>
      <div style="font-size:12.5px;color:#8d7d76;margin-top:5px">{{ subtitle }}</div>
    </div>
    <button onClick="{{ toggleFav }}" style="...background:#fdeee8;color:{{ favColor }}...">
      <svg ... fill="{{ favFill }}" .../>
    </button>
  </div>
  <!-- meta row: clock icon + timeLabel, effort icon + effort, sc-if showMacros: kcal icon + kcalLabel -->
  <!-- tab track: two buttons, Ingredients/Instructions, pill background #f7e7e0, active fill = accent -->
  <!-- sc-if onIngredients: servings stepper + sc-for ingredients grid -->
  <!-- sc-if onSteps: sc-for steps list with per-step sc-if hasTimer chip -->
</div>
```

**Binding-model → React mapping (this is the actual "core pattern" to copy):**
The source's `Component extends DCLogic` (`Recipe Page.dc.html` lines 351-413) is a
single `renderVals()` computing a flat props object from `this.state` and `this.props`.
Port this 1:1 as a client component's `useState` + derived-values block — it is already
shaped like a React function component:
```typescript
// Source: Recipe Page.dc.html lines 352-411, transliterated
const [tab, setTab] = useState<'ing' | 'steps'>('ing');
const [servings, setServings] = useState(recipe.baseServings); // was hardcoded `2`
const [fav, setFav] = useState(true);       // ephemeral client-only (UI-SPEC Open Q2, resolved)
const [cooked, setCooked] = useState(false); // ephemeral client-only (UI-SPEC Open Q2, resolved)

const mult = servings / recipe.baseServings; // was `s.servings / 2`
const round = (n: number) => (n >= 20 ? Math.round(n / 5) * 5 : Math.round(n * 2) / 2);
const servingsLabel = servings === 1 ? 'Scaled for one' : `Scaled for ${servings}`;
const inc = () => setServings((n) => Math.min(8, n + 1));
const dec = () => setServings((n) => Math.max(1, n - 1));
const toggleFav = () => setFav((f) => !f);
const toggleCooked = () => setCooked((c) => !c);
const ctaLabel = cooked ? 'Cooked ✓' : 'Mark as cooked';
```
`sc-if value="{{ X }}"` → `{X && (...)}`. `sc-for list="{{ ingredients }}" as="ing"` →
`{ingredients.map((ing) => (...))}`. `{{ expr }}` interpolations → `{expr}`. Event
attributes `onClick="{{ fn }}"` → `onClick={fn}`. `style-hover="..."` (a DC-runtime-only
pseudo-class attribute, see `support.js` `collectProps`/`pseudoClasses`) has no React
equivalent — reimplement as a CSS class or inline `:hover` via a stylesheet, not as a
prop.

**Where real DB rows replace the hardcoded `ING`/`STEPS` arrays** (`Recipe Page.dc.html`
lines 332-349 — this is D-23's seed source, transcribe these exact values into
`seed.ts`):
```javascript
const ING = [
  ["Chicken breast", 200, "g"], ["Basmati rice", 90, "g"], ["Broccoli", 150, "g"],
  ["Spring onions", 2, ""], ["Garlic", 2, "cloves"], ["Ginger", 10, "g"],
  ["Soy sauce", 20, "ml"], ["Sesame oil", 10, "ml"]
];
const STEPS = [
  ["Rinse the rice until the water runs clear, then set it on with a lid down.", "12 min"],
  ["Butterfly the chicken so it cooks evenly, and salt it while the pan comes up to heat.", ""],
  ["Sear hard on both sides until the crust is deep gold, then rest it off the heat.", "8 min"],
  ["Steam the broccoli over the rice for the last few minutes so it stays bright.", "4 min"],
  ["Slice the chicken, build the bowl, and dress it with the soy, sesame, garlic and ginger.", ""]
];
```
Recipe title default: `"Chicken & Rice Bowl"` (line 363's fallback). Servings math
depends on `mult = servings / 2` (line 358) — i.e. every ingredient quantity above is
authored "per 2 servings," which is UI-SPEC Open Question 4: the schema needs a
base-servings value (column or fixed constant `2`) for the scaler math to derive from
real data.

**Error/not-found handling — NO analog exists (net-new, not part of ported screen):**
Per UI-SPEC "Open Questions #1 RESOLVED" and the UI-Considerations table: unknown recipe
id → Next.js `notFound()`; failed Drizzle query → route-level `error.tsx` with plain text
+ retry affordance, using the **standard 8pt spacing scale and base 15px/1.55 Archivo
body style** (`styles.css` line 82: `font-size: 15px; line-height: 1.55; font-weight:
400;`) — explicitly **not** the Recipe Page's non-4px exception values. This file is
genuinely new UI with no design-file analog; build it against the plain `styles.css` base
rule only.

---

### `apps/recipe-app/src/db/schema.ts` (model, CRUD) — NO ANALOG, greenfield

No existing Drizzle schema anywhere in the repo. Build directly from Pattern 2/6 in
`01-RESEARCH.md` (`drizzle-orm/node-postgres`, `pgTable`) and D-09's three tables
(`recipes`, `ingredients`, `steps`, real FKs, ordering column on `steps`). The design
content dictates required columns: `recipes` needs at least `name`/title,
`base_servings` (UI-SPEC Open Q4), and — per UI-SPEC Open Q3 resolution — a `subtitle`
column with a Phase-1-appropriate value instead of the meal-planner-referencing string
`"Wednesday lunch · from this week's plan"` (`Recipe Page.dc.html` line 364). `time_label`
("20 min"), `effort` ("Easy"), and `kcal`/macro base value (620, scaled by `mult`) are
implied by lines 365-368. `ingredients` needs `name`, `quantity`, `unit` (raw values from
the `ING` array, scaled at read time — do not pre-scale in the DB). `steps` needs `text`,
an ordering column, and an optional `timer` field (`hasTimer`/`timer` from the `STEPS`
array).

---

### `scripts/env.ts`, `scripts/db-query.ts`, `scripts/db-reset.ts` (utility/CLI) — NO ANALOG, greenfield

No CLI scripts, no `pg` usage, no zod usage anywhere in the tracked tree. Build exactly
per `01-RESEARCH.md` Patterns 3, 4, 5 (already fully coded there — `current_database()`
assertion, hard-fail on bare `DATABASE_URL`, `pg.Client` one-shot script). There is
nothing in-repo to copy imports/conventions from; the research file's code blocks are
authoritative for this phase.

---

### `docker-compose.yml`, `drizzle.config.ts`, `pnpm-workspace.yaml` (config) — NO ANALOG, greenfield

No existing Compose file, Drizzle config, or workspace manifest. Use `01-RESEARCH.md`
Patterns 1 and 2 verbatim (Compose service block with `postgres:17`, `pg_isready`
healthcheck, `127.0.0.1:5432:5432` binding per D-18; `drizzle.config.ts` reading
`getDevDatabaseUrl()` from the shared env module).

---

### `docs/00-current-state.md` §7 update (documentation, D-27 findings)

**Analog:** `docs/decisions.md` entry format (see any `## D<n> — <title>` block, e.g. D1/D2
excerpted below) — copy this status-tagging discipline even though §7 is a findings
section, not a decision log:
```markdown
## D1 — Dev database runs as a local Docker container
**Status:** PROPOSED · 2026-09-06

Postgres in Docker on the local Windows machine rather than a Windows-installed service.

**Why:** ...
**Consequence:** ...
```
Apply the same "explicit status, dated, why/consequence" discipline to the §7 write-back:
record the redeploy-investigation finding with its evidence tier (per D-26's ordered
list) and explicitly write "still UNKNOWN" if the timeboxed investigation doesn't reach a
conclusion — per CLAUDE.md's "mark unverified things UNKNOWN" non-negotiable. Per D-27, a
new `docs/decisions.md` entry is opened **only if** the finding forces one (e.g., if
migrations turn out to run at deploy time after all).

---

## Shared Patterns

### Environment/connection safety (D-19/D-20/D-21)
**Source:** `01-RESEARCH.md` Patterns 3 & 4 (no in-repo analog — first env-validation code
in this repo). Apply identically to: `apps/recipe-app/src/db/client.ts`,
`apps/recipe-app/drizzle.config.ts`, `scripts/db-query.ts`, `scripts/db-reset.ts`,
`apps/recipe-app/src/db/seed.ts` — every one of these must import the same
`scripts/env.ts` module rather than re-implementing the check.

### Design-token reuse for the ported screen only
**Source:** `apps/recipe-app/design/_ds/modernist-.../styles.css` lines 1-2, 44-46, 82
(font import, font tokens, base body rule).
**Apply to:** `apps/recipe-app/src/app/layout.tsx` (font loading via `next/font/google`,
per UI-SPEC: `weight: ['400','600','800']`) and any net-new (non-ported) markup, which
uses the **standard 8pt scale**, not the Recipe Page's inline exception values.
**Do not apply to:** the ported Recipe Page component tree, which uses its own inline
values verbatim per D-06 — do not normalize them onto the 8pt scale or the `styles.css`
component classes (`.btn`, `.card`, etc.), none of which the source screen uses.

### "Chrome vs. shipped UI" filter when reading `.dc.html` files
**Source:** UI-SPEC Open Question 6 and `Recipe Page.dc.html` lines 22-28 (outer canvas
wrapper, per-frame caption spans, frame bezel/box-shadow).
**Apply to:** anyone porting markup out of any `.dc.html` file in this or future phases —
the outer `padding:48px 56px 72px;gap:56px` flex wrapper, the "Phone · 402pt"-style
caption spans, and the fixed-size device-frame `div` (`width:402px;height:844px;
border-radius:38px;...box-shadow:...`) are Claude Design's canvas presentation, not
shipped UI. Only the markup inside the frame's content area (nav row → content sheet →
tabs/ingredients/steps/CTA) is real.

### DC binding-model → React translation table
**Source:** `apps/recipe-app/design/support.js` (`compileAttr`, `walkFor`, `walkIf`,
`walkText` — the actual runtime semantics of `{{ }}`, `sc-for`, `sc-if`).
**Apply to:** every ported component (Header, TabTrack, ServingsStepper,
IngredientsGrid, StepsList, favorite/cooked toggles).

| DC construct | React equivalent |
|---|---|
| `{{ expr }}` in text/attrs | `{expr}` |
| `<sc-if value="{{ cond }}">...</sc-if>` | `{cond && (...)}` |
| `<sc-for list="{{ arr }}" as="x">...</sc-for>` | `{arr.map((x) => (...))}` |
| `onClick="{{ fn }}"` | `onClick={fn}` |
| `style-hover="background:..."` | no direct equivalent — CSS class + `:hover`, or inline JS `onMouseEnter`/`onMouseLeave` state; do not attempt to pass as a React prop |
| `this.state` + `renderVals()` (DCLogic class) | `useState` + plain derived-values block in the function component body |

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `pnpm-workspace.yaml`, root `package.json` | config | — | Repo has no `package.json` at all yet (0 tracked JS/TS config files) |
| `docker-compose.yml` | config | — | No container orchestration exists in this repo |
| `scripts/env.ts`, `scripts/db-query.ts`, `scripts/db-reset.ts` | utility | request-response / batch | No CLI scripts of any kind exist; first `pg`/`zod` usage in the repo |
| `apps/recipe-app/drizzle.config.ts`, `src/db/schema.ts`, `src/db/client.ts` | config/model/service | CRUD | No Drizzle usage anywhere; greenfield per D-09/D-11 |
| `apps/recipe-app/src/db/seed.ts` | utility | batch | No seed scripts exist; content source is the design's `ING`/`STEPS` arrays (see Pattern Assignments), but the script shape itself has no analog |
| `apps/recipe-app/src/app/layout.tsx` | component | request-response | No Next.js app exists; only chrome-level inspiration available from the design's outer wrapper, which must NOT be ported verbatim (Open Q6) |
| `apps/recipe-app/src/app/recipes/[id]/error.tsx` | component | request-response | Net-new UI with zero design-file precedent — UI-SPEC explicitly assigns it the standard 8pt scale instead of an analog |
| test files (env validation, smoke test, migration-shape test) | test | request-response/e2e | No test framework installed; `01-RESEARCH.md` Validation Architecture section is the only guide (Wave 0 gap list) |
| `apps/recipe-app/drizzle/*.sql`, `meta/_journal.json` | migration | batch | Generated artifacts; nothing to copy from, produced by `drizzle-kit generate` |

## Metadata

**Analog search scope:** entire tracked tree (`git ls-files`, 39 files) — no `node_modules`
or build output exists to search. Confirmed via `git ls-files` that all cited paths
(`apps/recipe-app/design/**`, `docs/decisions.md`) are tracked source, not gitignored
mirrors (`.gitignore` only excludes `node_modules/`, `.env*`, `*.log`, `dist/`,
`.DS_Store` — none of which intersect the design tree or docs).
**Files scanned:** 39 tracked files; deep-read `apps/recipe-app/design/IMPORT.md`,
`Recipe Page.dc.html` (full), `_ds/modernist-.../styles.css` (full), `support.js`
(runtime semantics, partial — binding-compiler sections only), `.gitignore`,
`docs/decisions.md` (header + D1/D2 excerpt).
**Pattern extraction date:** 2026-09-06
