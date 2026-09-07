---
phase: 01-local-environment
plan: 02
subsystem: database
tags: [drizzle, drizzle-kit, nextjs, postgresql, zod, vitest, execa]

requires:
  - phase: 01-local-environment
    provides: "pnpm workspace, healthy postgres:17 dev container, root db:* script surface, RECIPE_DEV_DATABASE_URL connection-variable template, root vitest.config.ts"
provides:
  - "scripts/env.ts — the single shared environment-validation and current_database() assertion module every entry point imports"
  - "apps/recipe-app — Next.js 16.3.4 App Router scaffold wired to Drizzle ORM 0.45.2 / drizzle-kit 0.31.10"
  - "recipes table (9 columns) with its first generated-and-applied migration, journalled"
  - "/recipes/[slug] Server Component route querying Drizzle directly, real HTTP 200/404 behavior"
  - "tests/smoke.test.ts — the headless D-08 boot proof, reusable verbatim by Phase 4 (RUN-07) and Phase 5 (CI-01)"
  - "deterministic seed (chicken-rice-bowl) derived from the design's own recipe content"
affects: [01-03, 01-04, 01-05, phase-04, phase-05]

actuals:
  tokens: 21103
  tasks: 2
  commits: 2
  plan_head_before: daba1287e965afe34b203462b61678281177ea4f

tech-stack:
  added: ["next 16.3.4", "react 19.2.8", "drizzle-orm 0.45.2", "drizzle-kit 0.31.10", "pg 8.23.0", "zod 4.5.4"]
  patterns:
    - "Shared env module (scripts/env.ts) imported by every DB-opening entry point — app, drizzle.config.ts, seed — each re-validating independently at import time (no inherited validation)"
    - "current_database() as the restore-safe environment marker, never a stored row (D-21)"
    - "generate -> inspect -> migrate loop only; drizzle-kit push never referenced by any committed script"
    - "Server Component queries Drizzle directly via db.query.<table>.findFirst — no API route layer (D-05)"
    - "Windows-safe child-process-tree cleanup via taskkill /T /F for any test that spawns a nested pnpm/next process"

key-files:
  created:
    - scripts/env.ts
    - scripts/env.test.ts
    - apps/recipe-app/package.json
    - apps/recipe-app/tsconfig.json
    - apps/recipe-app/next.config.ts
    - apps/recipe-app/next-env.d.ts
    - apps/recipe-app/drizzle.config.ts
    - apps/recipe-app/drizzle/0000_bumpy_khan.sql
    - apps/recipe-app/drizzle/meta/0000_snapshot.json
    - apps/recipe-app/drizzle/meta/_journal.json
    - apps/recipe-app/src/db/schema.ts
    - apps/recipe-app/src/db/client.ts
    - apps/recipe-app/src/db/seed.ts
    - apps/recipe-app/src/app/layout.tsx
    - apps/recipe-app/src/app/recipes/[slug]/page.tsx
    - tests/smoke.test.ts
  modified:
    - package.json
    - pnpm-lock.yaml

key-decisions:
  - "zod installed at the workspace root (not apps/recipe-app) because scripts/env.ts lives at the workspace root and Node resolves its bare-specifier imports relative to its own directory, not the importing app's node_modules — a pnpm-workspace strict-resolution constraint the plan's file layout implied but did not spell out."
  - "apps/recipe-app/package.json ships WITHOUT \"type\": \"module\" (plan specified type: module) — with it set, Next.js 16.3.4's internal next.config.ts compiler produced a CommonJS artifact (`exports.default = ...`) that Node then tried to load as ESM because of the package's own type field, throwing `ReferenceError: exports is not defined in ES module scope` on every build. Removing the field lets Node's default CJS interpretation match what Next's compiler actually emits; the app's own React/route source is transpiled by Next's own bundler regardless of this field, so no other behavior changed."
  - "next.config.ts resolves the workspace root via path.resolve(process.cwd(), '..', '..') instead of import.meta.url/__dirname, because import.meta is ESM-only syntax that would break exactly where the type:module removal above assumes CJS compilation, and pnpm --filter recipe-app always runs the app's own scripts with cwd set to apps/recipe-app."
  - "tests/smoke.test.ts kills its spawned server via `taskkill /pid <pid> /T /F` on win32 rather than execa's plain .kill() — pnpm --filter recipe-app start runs through a nested shell that spawns the actual next-server process as a grandchild, and Windows has no POSIX process-group SIGTERM cascade, so a plain kill() left an orphaned server holding port 3210 across test runs (reproduced and fixed during this plan, not a hypothetical)."
  - "typescript and @types/node added as devDependencies to apps/recipe-app in addition to the plan's listed package set, because Next's own build/typecheck step requires them resolvable from the app's own package resolution scope in this strict pnpm workspace."

requirements-completed: [ENV-02, ENV-03, APP-01]

coverage:
  - id: D1
    description: "A schema edit run through generate -> inspect -> migrate produces a reviewable SQL file and a journalled entry (ENV-02)"
    requirement: ENV-02
    verification:
      - kind: integration
        ref: "node -e journal-entries check on apps/recipe-app/drizzle/meta/_journal.json (journal-entries=1)"
        status: pass
      - kind: integration
        ref: "docker compose exec db psql -c '\\d recipes' — confirmed live schema matches the generated SQL, not inferred from drizzle-kit's exit code (Windows silent-no-op pitfall)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A production build, started headlessly on a fixed port, returns HTTP 200 for the seeded recipe route with database-sourced content (D-05, D-08, APP-01)"
    requirement: APP-01
    verification:
      - kind: e2e
        ref: "tests/smoke.test.ts#returns 200 with database-sourced content for the seeded slug"
        status: pass
    human_judgment: false
  - id: D3
    description: "An unknown recipe slug produces Next.js's not-found response rather than a server error"
    requirement: APP-01
    verification:
      - kind: e2e
        ref: "tests/smoke.test.ts#returns 404 for an unseeded slug"
        status: pass
    human_judgment: false
  - id: D4
    description: "A bare, unprefixed DATABASE_URL makes tooling and the app refuse to start, with no warning-and-continue path, even when RECIPE_DEV_DATABASE_URL is also correctly set (D-20)"
    requirement: ENV-03
    verification:
      - kind: unit
        ref: "scripts/env.test.ts — 'bare DATABASE_URL rejection (D-20)' describe block (3 tests)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Every process independently asserts current_database() before executing any caller statement; a mismatch aborts and names both the connected and expected database (D-21, ENV-03)"
    requirement: ENV-03
    verification:
      - kind: unit
        ref: "scripts/env.test.ts — 'assertDevelopmentDatabase (D-21)' describe block (3 tests)"
        status: pass
    human_judgment: false
  - id: D6
    description: "No thrown message or console output on any failure path discloses a connection string, password, or credential"
    verification:
      - kind: unit
        ref: "scripts/env.test.ts redaction assertions (2 dedicated tests) + grep for postgres:// across all new files"
        status: pass
    human_judgment: false
  - id: D7
    description: "Phase 1's schema scope is respected: only the recipes table exists, with exactly its nine planned columns, and no reserved-churn notes column or tags table was spent (D-09/D-10/D-11)"
    verification:
      - kind: integration
        ref: "docker compose exec db psql — information_schema.columns (9 exact columns) and information_schema.tables (only 'recipes')"
        status: pass
    human_judgment: false
  - id: D8
    description: "The seed is deterministic and derived from the design's own recipe content; base_servings resolves UI-SPEC Open Question 4 and subtitle resolves Open Question 3 (D-23)"
    verification:
      - kind: integration
        ref: "docker compose exec db psql -tAc 'SELECT slug, title, subtitle, base_servings, time_label, effort, base_kcal FROM recipes' — matches seed.ts values exactly"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-09-07
status: complete
---

# Phase 01 Plan 02: End-to-End Recipe Path + Environment Hardening Summary

**One seeded recipe row travels from a generated-and-applied Drizzle migration, through a Next.js 16 Server Component, to a real headless HTTP 200/404 response — gated by a shared env module whose bare-DATABASE_URL rejection and current_database() marker assertion are both covered by seven passing unit tests.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-09-07T00:26:00Z (approx, immediately following 01-01)
- **Completed:** 2026-09-07T00:46:00Z (approx)
- **Tasks:** 2 (1 tracer, 1 auto/tdd)
- **Files modified:** 18 (16 created, 2 modified) across both task commits

## Accomplishments
- Built `scripts/env.ts`: walks up from `process.cwd()` to find `pnpm-workspace.yaml`, loads that directory's `.env`, hard-fails on a bare `DATABASE_URL` before the zod parse ever runs, exports `getDevDatabaseUrl()` and `EXPECTED_DEV_DATABASE_NAME`, and exports `assertDevelopmentDatabase()` which asserts `current_database()` — the restore-safe marker per D-21 (a stored row would travel inside a `pg_dump` payload and survive a restore into the wrong environment; a connection property cannot).
- Scaffolded `apps/recipe-app`: Next.js 16.3.4 App Router, Drizzle ORM 0.45.2 + drizzle-kit 0.31.10, all wired to the shared env module — `drizzle.config.ts` and `src/db/client.ts` both obtain their connection string exclusively through `getDevDatabaseUrl()`, never a raw `process.env` read.
- Defined the `recipes` table (id, slug, title, subtitle, base_servings, time_label, effort, base_kcal, created_at) — ran `pnpm db:generate` → inspected the emitted SQL → `pnpm db:migrate` → verified the live schema directly with `docker compose exec db psql -c '\d recipes'` rather than trusting drizzle-kit's exit code, per the documented Windows silent-no-op pitfall. The journal (`meta/_journal.json`) recorded one entry.
- Seeded exactly one deterministic row (`chicken-rice-bowl`) derived from `Recipe Page.dc.html`'s own `ING`/`STEPS` source data and `DCLogic` defaults (title, `20 min`, `Easy`, `620` kcal, `mult = servings / 2`), with the subtitle replaced per UI-SPEC Open Question 3's resolution and `base_servings` fixed at 2 per Open Question 4.
- Built `/recipes/[slug]/page.tsx` as a Server Component: awaits the Next.js 16 `params` Promise, queries `db.query.recipes.findFirst` directly (no API route), calls `notFound()` on a missing row, and sets `dynamic = "force-dynamic"` so the route isn't prerendered against the database at build time.
- Built `tests/smoke.test.ts`: a real `next build` + `next start` on port 3210, polled to readiness, then two real HTTP requests — 200 with `Rice Bowl`/`Weeknight dinner` for the seeded slug, 404 for an unseeded one. Verified re-runnable twice in a row with the port cleanly released both times.
- Hardened and tested the environment layer's three failure states in `scripts/env.test.ts` (7 tests): bare `DATABASE_URL` present (even alongside a correct `RECIPE_DEV_DATABASE_URL`), the variable missing entirely (zod validation error naming it), and a `current_database()` mismatch (message names both the connected and expected database) — plus two dedicated tests asserting no thrown message ever contains `postgres://`, a password, or a full connection string.

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end "one seeded recipe reaches an HTTP response"** - `e540aab` (feat)
2. **Task 2: Harden the environment layer's failure states and cover them with tests** - `7c6b0ce` (test)

**Plan metadata:** committed alongside this summary.

## Files Created/Modified
- `scripts/env.ts` - shared zod-validated env module; bare-DATABASE_URL hard fail; `getDevDatabaseUrl()`; `assertDevelopmentDatabase()` on `current_database()`
- `scripts/env.test.ts` - 7 tests covering all three failure states plus credential-redaction assertions
- `apps/recipe-app/package.json` - Next.js 16.3.4 app manifest (no `type: module` — see Deviations)
- `apps/recipe-app/tsconfig.json` - extends root base config, `@/*` alias, includes `../../scripts/**/*.ts`
- `apps/recipe-app/next.config.ts` - `outputFileTracingRoot` via `process.cwd()`-relative path
- `apps/recipe-app/drizzle.config.ts` - reads connection string only via `getDevDatabaseUrl()`
- `apps/recipe-app/drizzle/0000_bumpy_khan.sql` + `meta/` - the generated-and-applied first migration
- `apps/recipe-app/src/db/schema.ts` - the `recipes` table (recipe core only, per D-09)
- `apps/recipe-app/src/db/client.ts` - the Drizzle client singleton
- `apps/recipe-app/src/db/seed.ts` - deterministic seed, runnable via `pnpm db:seed` or `seed()`
- `apps/recipe-app/src/app/layout.tsx` - minimal root layout
- `apps/recipe-app/src/app/recipes/[slug]/page.tsx` - the ported route's data layer (Server Component)
- `tests/smoke.test.ts` - headless D-08 boot proof with Windows-safe process cleanup
- `package.json`, `pnpm-lock.yaml` - added `zod` at the workspace root

## Decisions Made
See `key-decisions` in frontmatter for full rationale on each. Summary: zod moved to the workspace root (module-resolution requirement, not a preference); `apps/recipe-app` drops `type: "module"` to match what Next's config compiler actually emits; `next.config.ts` avoids `import.meta.url` accordingly; the smoke test's cleanup uses `taskkill /T /F` on Windows to avoid orphaning the server process; `typescript`/`@types/node` added to the app's own devDependencies for Next's internal typecheck step.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] zod unresolvable from scripts/env.ts when installed only into apps/recipe-app**
- **Found during:** Task 1, first `pnpm db:generate` run
- **Issue:** `drizzle.config.ts` (in `apps/recipe-app`) imports `scripts/env.ts` (at the workspace root) by relative path. Node resolves `scripts/env.ts`'s own bare-specifier imports (`zod`, `dotenv`) relative to *its own* directory, walking up from `scripts/` — not from the importing app's `node_modules`. With `zod` installed only in `apps/recipe-app/node_modules`, drizzle-kit failed with `Cannot find module 'zod'`.
- **Fix:** Ran `pnpm add -Dw zod`, installing it at the workspace root (resolved to `^4.5.4`, matching the version already approved at the 01-01 package-legitimacy checkpoint).
- **Files modified:** `package.json`, `pnpm-lock.yaml`
- **Verification:** `pnpm db:generate` succeeded afterward; `pnpm exec vitest run` green.
- **Committed in:** `e540aab` (Task 1 commit)

**2. [Rule 3 - Blocking] `"type": "module"` on apps/recipe-app broke next.config.ts loading**
- **Found during:** Task 1, first `pnpm --filter recipe-app build`
- **Issue:** With `apps/recipe-app/package.json` set to `"type": "module"` (as the plan specified), `next build` failed: `ReferenceError: exports is not defined in ES module scope`. Next's internal `next.config.ts` compiler emits a CommonJS artifact (`exports.default = ...`); Node then loaded that artifact as ESM because of the package's own `type` field, and the two disagreed.
- **Fix:** Removed `"type": "module"` from `apps/recipe-app/package.json`. Rewrote `next.config.ts` to resolve the workspace root via `path.resolve(process.cwd(), "..", "..")` instead of `import.meta.url`/`__dirname`, since `import.meta` is ESM-only syntax that would break under the now-assumed CJS compilation, and `pnpm --filter recipe-app` scripts always run with cwd set to `apps/recipe-app`.
- **Files modified:** `apps/recipe-app/package.json`, `apps/recipe-app/next.config.ts`
- **Verification:** `pnpm --filter recipe-app build` succeeded; re-verified `pnpm db:seed` (which runs via `tsx`, uses `import.meta.url` in `seed.ts`) still worked correctly after the package.json change.
- **Committed in:** `e540aab` (Task 1 commit)

**3. [Rule 1 - Bug] Orphaned `next start` process held port 3210 across test runs on Windows**
- **Found during:** Task 1, first `pnpm exec vitest run tests/smoke.test.ts` run — the second invocation failed with `EADDRINUSE` even though the first run's `afterAll` had called `serverProcess.kill()`.
- **Issue:** `pnpm --filter recipe-app start` runs the `start` script through a nested shell, which spawns the actual `next-server` process as a grandchild. Windows has no POSIX process-group SIGTERM cascade, so killing only the top-level pnpm process left the grandchild running and the port held (confirmed via `netstat -ano` + manual `taskkill /T /F`, reproducing exactly the platform pitfall this plan's context flagged).
- **Fix:** `afterAll` now uses `taskkill /pid <pid> /T /F` on `process.platform === "win32"` instead of `serverProcess.kill()`, killing the whole process tree.
- **Files modified:** `tests/smoke.test.ts`
- **Verification:** Ran the smoke test twice in a row; confirmed via `netstat -ano` that port 3210 was free after each run, and the second run started its own fresh server successfully instead of silently reusing a stale one.
- **Committed in:** `e540aab` (Task 1 commit)

**4. [Rule 3 - Blocking] typescript and @types/node not resolvable within apps/recipe-app's own package scope**
- **Found during:** Task 1, dependency installation (proactive, before the first build attempt)
- **Issue:** Next.js's own build/typecheck step requires `typescript` and `@types/node` resolvable from the app package's own resolution scope in this strict pnpm workspace; the root's copies are not visible to `apps/recipe-app` by default.
- **Fix:** Added both as devDependencies to `apps/recipe-app/package.json`, resolving to `^7.0.2` and `^24.13.3` respectively — matching the versions already pinned at the workspace root.
- **Files modified:** `apps/recipe-app/package.json`, `pnpm-lock.yaml`
- **Verification:** `next build`'s "Running TypeScript... Finished TypeScript" step completed without a missing-dependency prompt.
- **Committed in:** `e540aab` (Task 1 commit)

---

**Total deviations:** 4 auto-fixed (4 Rule 3 blocking issues, one of which — #3 — is also a Rule 1 bug in the test's own cleanup logic)
**Impact on plan:** All four fixes were necessary to make the documented commands (`db:generate`, `build`, the smoke test) actually work on this Windows/pnpm-workspace combination. No scope creep — no functionality was added beyond what Task 1 already specified; all four are build/tooling-configuration corrections.

## Issues Encountered

**Task 2 had no genuine RED phase.** Task 2 (`tdd="true"`) asked to write `scripts/env.test.ts` first and then adjust `scripts/env.ts` until all behaviors held. All 7 tests passed on the very first run against Task 1's implementation — Task 1's `env.ts` already ordered the bare-variable check before the zod parse and constructed every thrown message from database names only, so there was no failing-then-fixed delta to produce. No implementation change was made to `scripts/env.ts` in Task 2; the commit is test-only. Recorded honestly rather than fabricating an artificial failure, and logged to `.planning/WINDOWS.md` (`--kind deviation`) for visibility at the ship gate.

## User Setup Required
None - no external service configuration required. `.env` (gitignored, already present from 01-01) was used as-is; no new secrets were introduced.

## Next Phase Readiness
- `scripts/env.ts`, the `recipes` table, the seed, and `tests/smoke.test.ts` are all in place for plan 01-03 (which adds `ingredients` and `steps`, exercising the generate → migrate loop a second time) to build on directly.
- The Windows process-tree-kill pattern in `tests/smoke.test.ts` (`taskkill /T /F`) should be reused rather than re-derived by any later plan that spawns a nested `pnpm`/`next` process and needs reliable cleanup.
- `apps/recipe-app/package.json` intentionally does not set `"type": "module"` — any future file added under `apps/recipe-app` that assumes ESM-only syntax (top-level `await` outside an async function, `import.meta` outside `next.config.ts`'s own already-fixed usage) should be checked against this before being added.
- The recipe app currently renders only `title` and `subtitle` as plain markup — the full ported `Recipe Page` screen (tabs, servings stepper, ingredients/steps, favorite/cooked toggles) is plan 01-05's work, not started here.
- One open item logged to `.planning/WINDOWS.md`: Task 2's no-RED-phase note (informational, not a functional gap — all behaviors are implemented and tested).

---
*Phase: 01-local-environment*
*Completed: 2026-09-07*

## Self-Check: PASSED

- All key-files.created confirmed present on disk (verified via file listing during execution): `scripts/env.ts`, `scripts/env.test.ts`, `apps/recipe-app/package.json`, `apps/recipe-app/tsconfig.json`, `apps/recipe-app/next.config.ts`, `apps/recipe-app/drizzle.config.ts`, `apps/recipe-app/drizzle/0000_bumpy_khan.sql` + `meta/`, `apps/recipe-app/src/db/{schema,client,seed}.ts`, `apps/recipe-app/src/app/layout.tsx`, `apps/recipe-app/src/app/recipes/[slug]/page.tsx`, `tests/smoke.test.ts`.
- `git log --oneline --all` confirms both task commits exist: `e540aab` (Task 1) and `7c6b0ce` (Task 2).
- Re-ran every plan-level `<verification>` command immediately before writing this summary: `pnpm exec vitest run` reports 9/9 passing across `scripts/env.test.ts` and `tests/smoke.test.ts`; `apps/recipe-app/drizzle/meta/_journal.json` has 1 entry; `information_schema.columns` for `recipes` lists exactly the 9 planned columns with no `notes` column and no tags table anywhere in the database; the seeded slug returns HTTP 200 with `Rice Bowl`/`Weeknight dinner` in the body, an unseeded slug returns 404; a `grep -rn "postgres://"` across every file this plan created returned no matches.
