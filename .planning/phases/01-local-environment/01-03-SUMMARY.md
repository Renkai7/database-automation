---
phase: 01-local-environment
plan: 03
subsystem: database
tags: [drizzle, drizzle-kit, postgresql, foreign-keys]

requires:
  - phase: 01-local-environment
    provides: "scripts/env.ts, the recipes table + its first migration, and the generate -> inspect -> migrate loop proven by plan 01-02's tracer slice"
provides:
  - "ingredients and steps tables completing the D-09 recipe core, with real FKs (cascade delete) and per-recipe position uniqueness"
  - "A second generated, inspected, applied and journalled migration (drizzle/0001_busy_thunderbolt.sql), proving ENV-02's loop is a loop rather than a one-off"
  - "The deterministic seed's full content (D-23): one recipe, eight ingredients, five steps, fixed row counts Phase 2's restore verification (BKP-04) can assert against"
affects: [01-04, 01-05, phase-02, phase-04]

actuals:
  tokens: 4030
  tasks: 2
  commits: 2
  plan_head_before: 65a1fecff5884de16e71e18009464b5732b6a20b

tech-stack:
  added: []
  patterns:
    - "Seed inserts go through the schema's own Drizzle table objects (drizzle(client, {schema}) wrapping the existing one-shot pg.Client), not raw SQL strings, so a column rename in schema.ts breaks the seed at type-check time"
    - "Cascade-delete FKs (recipe_id -> recipes.id, onDelete: cascade) make delete-then-insert seeding naturally idempotent"
    - "Windows drizzle-kit migrate silent-no-op pitfall verified against live information_schema/psql output at every step, never against the CLI exit code alone"

key-files:
  created:
    - apps/recipe-app/drizzle/0001_busy_thunderbolt.sql
    - apps/recipe-app/drizzle/meta/0001_snapshot.json
  modified:
    - apps/recipe-app/src/db/schema.ts
    - apps/recipe-app/src/db/seed.ts
    - apps/recipe-app/drizzle/meta/_journal.json
    - .planning/REQUIREMENTS.md

key-decisions:
  - "seed.ts rewritten to use drizzle(client, {schema}) over the existing pg.Client, rather than extending the prior raw-SQL INSERT pattern, so the seed's dependency on schema.ts's column names is enforced by the TypeScript compiler rather than only discovered at runtime."

requirements-completed: [ENV-02]

coverage:
  - id: D1
    description: "ingredients and steps tables complete the D-09 recipe core with real foreign keys (cascade delete) and a unique (recipe_id, position) constraint on each"
    requirement: ENV-02
    verification:
      - kind: integration
        ref: "docker compose exec db psql -c '\\d ingredients' / '\\d steps' — live schema matches the generated SQL"
        status: pass
      - kind: integration
        ref: "information_schema.table_constraints FOREIGN KEY count for ingredients+steps = 2"
        status: pass
    human_judgment: false
  - id: D2
    description: "A second schema edit travels the same generate -> inspect -> migrate loop as the first, producing a second journalled migration (ENV-02)"
    requirement: ENV-02
    verification:
      - kind: integration
        ref: "node -e journal-entries check on apps/recipe-app/drizzle/meta/_journal.json (journal-entries=2)"
        status: pass
      - kind: unit
        ref: "manual inspection of apps/recipe-app/drizzle/0001_busy_thunderbolt.sql — two CREATE TABLE statements + two FK ALTER statements, no drop/alter against recipes"
        status: pass
    human_judgment: false
  - id: D3
    description: "The seed is deterministic: a fresh apply produces exactly one recipe, eight ingredients and five steps, matching the imported design's own recipe content verbatim"
    verification:
      - kind: integration
        ref: "docker compose exec db psql -tAc row-count query (1/8/5) and per-row content/order spot-check against Recipe Page.dc.html's ING/STEPS arrays"
        status: pass
    human_judgment: false
  - id: D4
    description: "Ingredient quantities are stored raw (per base_servings=2), not pre-scaled; two of five steps carry a null timer_label, matching the source's hasTimer conditional"
    verification:
      - kind: integration
        ref: "docker compose exec db psql -tAc 'SELECT count(*) FROM steps WHERE timer_label IS NULL' (=2); quantity column values match ING array literals exactly"
        status: pass
    human_judgment: false
  - id: D5
    description: "No D-10/D-11 reserved schema change was spent: only recipes/ingredients/steps exist, recipes still has exactly its 9 original columns, no notes/tags/meal-plan/shopping surface anywhere"
    verification:
      - kind: integration
        ref: "information_schema.tables (3 tables only) and information_schema.columns for recipes (9 unchanged columns)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The full vitest suite (9 tests, 2 files) is green after the migration is applied"
    verification:
      - kind: e2e
        ref: "pnpm exec vitest run — 9 passed (9)"
        status: pass
    human_judgment: false

duration: 35min
completed: 2026-09-07
status: complete
---

# Phase 01 Plan 03: Recipe Core Expansion — Ingredients, Steps, Second Migration Summary

**Ingredients and steps tables (real FKs, cascade delete, per-recipe position uniqueness) reached the live development database through a second generated-inspected-migrated Drizzle migration, and the seed now writes the design's full eight-ingredient, five-step content through the schema's own Drizzle table objects rather than raw SQL.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-09-07T20:20:00Z (approx)
- **Completed:** 2026-09-07T20:55:00Z (approx)
- **Tasks:** 2 (both `type="auto"`, Task 2 marked BLOCKING)
- **Files modified:** 5 (2 created, 3 modified — schema.ts, seed.ts, drizzle migration + snapshot + journal)

## Accomplishments
- Extended `apps/recipe-app/src/db/schema.ts` with `ingredients` and `steps`, both with a `recipe_id` foreign key to `recipes.id` (`onDelete: "cascade"`) and a unique constraint on `(recipe_id, position)`; declared Drizzle `relations` so `db.query.recipes.findFirst({ with: {...} })` can load both children.
- Extended `apps/recipe-app/src/db/seed.ts` to insert the design's full eight-ingredient, five-step content — and, going beyond a literal extension of the prior file, rewrote the insert path to go through `drizzle(client, { schema })` and the schema's own table objects instead of raw parameterized SQL strings, so the schema-to-seed link the plan's `key_links` called for is enforced by the TypeScript compiler, not just documentation.
- Ran the exact ENV-02 loop a second time: `pnpm db:generate` emitted `drizzle/0001_busy_thunderbolt.sql` (two `CREATE TABLE` statements plus two FK `ALTER TABLE` statements, no drop/alter against `recipes`) → inspected it → `pnpm db:migrate` → verified directly against the live database via `psql \d ingredients`/`\d steps`, never trusting the CLI's exit code alone (the documented Windows silent-no-op pitfall from 01-02 carried forward here).
- Ran `pnpm db:seed`; confirmed row counts `1/8/5`, exactly 2 foreign-key constraints across the two child tables, and exactly 2 null `timer_label` rows — all via direct `information_schema`/`psql` queries against the live database.
- Spot-checked every seeded row's content and ordering against `Recipe Page.dc.html`'s `ING`/`STEPS` arrays (transcribed via `01-PATTERNS.md`) and confirmed exact match, including the empty-string unit on Spring onions and the two null timer labels landing on the correct step positions (1 and 4).
- Confirmed no D-10/D-11 reserved schema change was spent: `information_schema.tables` lists exactly `recipes`, `ingredients`, `steps`; `recipes` still has exactly its original 9 columns.
- Re-ran the full `vitest` suite after the migration: 9/9 tests still passing across `scripts/env.test.ts` and `tests/smoke.test.ts`.
- Marked `ENV-02` complete in `.planning/REQUIREMENTS.md` (via the shared-ID readiness gate — `APP-01`, also declared by plan 01-03, stays open because sibling plan 01-05 hasn't finished yet).

## Task Commits

Each task was committed atomically:

1. **Task 1: Add the ingredients and steps tables and extend the deterministic seed** - `56805a0` (feat)
2. **Task 2: [BLOCKING] Generate, inspect and apply the second migration to the live database, then reseed** - `ec66b38` (feat)

**Plan metadata:** committed alongside this summary.

## Files Created/Modified
- `apps/recipe-app/src/db/schema.ts` - added `ingredients` and `steps` tables + their Drizzle relations to `recipes`
- `apps/recipe-app/src/db/seed.ts` - extended to insert 8 ingredient rows + 5 step rows, rewritten onto `drizzle(client, {schema})` insert calls instead of raw SQL
- `apps/recipe-app/drizzle/0001_busy_thunderbolt.sql` - the second generated migration (ingredients + steps CREATE TABLE, two FK ALTER TABLE statements)
- `apps/recipe-app/drizzle/meta/0001_snapshot.json` - drizzle-kit's schema snapshot backing the new migration
- `apps/recipe-app/drizzle/meta/_journal.json` - now has 2 entries
- `.planning/REQUIREMENTS.md` - `ENV-02` checkbox marked complete

## Decisions Made
- **`seed.ts` rewritten onto Drizzle's own table objects instead of extending the prior raw-SQL `INSERT` pattern.** The plan's `key_links` frontmatter explicitly wants a column rename in `schema.ts` to break the seed at type-check time; parameterized raw SQL strings (the pattern 01-02 established for the single `recipes` insert) cannot provide that guarantee — a renamed column there would only surface as a runtime SQL error. Wrapping the existing one-shot `pg.Client` in `drizzle(client, { schema })` (confirmed supported: `NodePgClient = Pool | PoolClient | Client` in drizzle-orm 0.45.2's own type definitions) keeps Pattern 5's one-shot-`Client`-not-`Pool` guidance intact while making the column dependency a compile-time one. This is a Rule 1/2-style correctness improvement in service of an explicit plan requirement, not an architectural change — same connection, same database, same seed shape, different insert API.

## Deviations from Plan

None beyond the seed-rewrite decision above, which directly implements a `key_links` requirement already present in the plan's own frontmatter rather than deviating from it.

## Issues Encountered
None. Both tasks completed on the first attempt with no failed verification, no auto-fix cycles, and no auth gates.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The full D-09 recipe core (`recipes` + `ingredients` + `steps`, real FKs, ordering column) is now live in the development database, ready for plan 01-05 to wire the ported `Recipe Page` screen against real ingredient/step rows (not just the `recipes` row 01-02 wired).
- `ENV-02` is complete. `APP-01` (also declared by this plan) stays open in `.planning/REQUIREMENTS.md` until sibling plan `01-05` — which also declares `APP-01` — produces its own summary, per the shared-ID readiness gate; this is expected, not a gap.
- The exact eight-ingredient, five-step, fixed-row-count seed content is now committed and reproducible via `pnpm db:seed` (idempotent through the cascade-delete relationship) — Phase 2's restore verification (BKP-04) has known values to assert row counts and spot-checked content against.
- No new entries were added to `.planning/WINDOWS.md` by this plan; the one pre-existing open entry (Task 2's no-RED-phase note from plan 01-02) is unrelated to this plan's work and remains open from before.

---
*Phase: 01-local-environment*
*Completed: 2026-09-07*

## Self-Check: PASSED

- Both key-files.created (`apps/recipe-app/drizzle/0001_busy_thunderbolt.sql`, `apps/recipe-app/drizzle/meta/0001_snapshot.json`) confirmed present on disk.
- `git log --oneline --all` confirms both task commits exist: `56805a0` (Task 1) and `ec66b38` (Task 2).
- Re-ran every plan-level `<verification>` command immediately before writing this summary: live database reports `1/8/5` for recipes/ingredients/steps; `information_schema.table_constraints` reports exactly 2 FOREIGN KEY constraints across `ingredients`+`steps`; exactly 2 seeded steps have a null `timer_label`; `meta/_journal.json` holds exactly 2 entries; `pnpm exec vitest run` reports 9/9 passing.
- Re-confirmed no D-10/D-11 reserved change was spent: `information_schema.tables` lists exactly `recipes`, `ingredients`, `steps`; `recipes`'s 9 columns are unchanged from plan 01-02.
