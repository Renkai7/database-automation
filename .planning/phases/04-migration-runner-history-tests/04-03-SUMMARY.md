---
phase: 04-migration-runner-history-tests
plan: 03
subsystem: database
tags: [postgresql, testcontainers, drizzle-orm, vitest, migration-runner, migration-history]

# Dependency graph
requires:
  - phase: 04-migration-runner-history-tests
    provides: "04-01's runner core (runMigrations, RunnerClient, ensureDrizzleLedger, ensureRunnerTable, MigrationRefusedError, RUNNER_EXIT_CODES) -- this plan drives it directly against Testcontainers instances, never through pnpm db:migrate"
provides:
  - "tests/history/** -- RUN-05 (empty DB + full history), RUN-06 (existing DB + newest-only), and criterion 1/RUN-01 (tamper-then-refuse) each proven automatically against genuinely fresh PostgreSQL 17 Testcontainers instances"
  - "scripts/history-status.ts / scripts/history-suite.ts / docs/migration-history-status.json -- the committed, schema-validated, no-staleness record of the history suite's own result, with a cheap assertion Phase 5's CI and the default pnpm test suite hard-fail on"
  - "vitest.history.config.ts -- the third slow, Docker-dependent vitest entry point, structurally excluded from vitest.config.ts's default suite"
affects: [04-04-transaction-policy-and-timeouts, 04-05-partial-failure-and-recovery, 04-06-app-schema-changes (further tests/history/ files can land with no new infrastructure), 05-ci-safety-gate (may read/exercise the committed history status file)]

# Actuals (#2632)
actuals:
  tokens: 10391
  tasks: 3
  commits: 3
  plan_head_before: 1e4887cea5cf2d90a0c089eb8b7c4b708f577ea4

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A shared Testcontainers/schema-shape helper module (tests/history/support.ts) lives OUTSIDE the *.test.ts glob rather than being exported from one test file and imported by its siblings -- verified live this session that vitest re-executes an imported *.test.ts file's top-level describe()/it() registrations in the importing file's own run (a 2-test fixture became 3 when file B imported file A), which would have silently duplicated RUN-05's assertions inside RUN-06's and criterion 1's runs."
    - "The history-suite entry point (scripts/history-suite.ts) wraps a real `vitest run --config vitest.history.config.ts` child process with `{ reject: false }` and records PASS/FAIL from its exit code, writing nothing when the spawn itself could not start -- the same 'a suite that never ran is not a suite that failed' boundary scripts/drill.ts already established for the restore drill."
    - "The migration-history status record (docs/migration-history-status.json) deliberately carries no staleness/age field, unlike the restore drill's record -- these tests are deterministic and run from committed migrations, so nothing about them decays with time (D-24)."

key-files:
  created:
    - vitest.history.config.ts
    - scripts/history-status.ts
    - scripts/history-suite.ts
    - docs/migration-history-status.json
    - tests/history-status.test.ts
    - tests/history/support.ts
    - tests/history/empty-db-full-history.test.ts
    - tests/history/existing-db-newest-only.test.ts
    - tests/history/tamper-then-refuse.test.ts
  modified:
    - vitest.config.ts
    - package.json

key-decisions:
  - "tests/history/support.ts is a plain, non-test module rather than exported helpers from empty-db-full-history.test.ts imported by its siblings (the plan's second literal option) -- live-verified this session that importing a *.test.ts file from another duplicates its registered tests."
  - "scripts/history-suite.ts uses stdio: \"inherit\" on the vitest child process -- execa buffers and does not forward a child's stdout/stderr to the parent by default (verified live), and a developer running pnpm test:history needs to see vitest's real per-test output, the same way pnpm db:drill's own step logging is visible."
  - "RECIPE_CORE_TABLES and the expected full-history column shapes are re-declared in tests/history/support.ts rather than imported from scripts/backup.ts -- matches this repository's existing precedent (scripts/backup.ts's own list is deliberately not shared with scripts/verify-migration-state.ts's) of keeping each tool's list a private implementation detail with its own failure message."

patterns-established:
  - "Non-test shared helper modules for a *.test.ts-glob'd suite live in the suite's own directory but outside the include glob's file pattern (tests/history/support.ts, not tests/history/support.test.ts), avoiding vitest's per-import re-registration of describe/it blocks."

requirements-completed: [RUN-05, RUN-06]

# RUN-01 is jointly declared by 04-01 and 04-03 (04-01-PLAN.md's own frontmatter); it is left off
# this list even though this plan's tamper-then-refuse test satisfies criterion 1, because
# 04-01-SUMMARY.md already marked it complete once both declaring plans had summaries (the
# shared-ID gate resolved it at that point, not here) -- update_requirements below re-confirms
# rather than re-declares it.

coverage:
  - id: D1
    description: "Applying the full committed migration history to a genuinely empty PostgreSQL 17 instance produces the recipe-core schema -- asserted table by table (drizzle.__drizzle_migrations, runner.migration_runs, recipes/ingredients/steps) and column by column, with every runner.migration_runs row applied and carrying findings"
    requirement: RUN-05
    verification:
      - kind: integration
        ref: "tests/history/empty-db-full-history.test.ts#applies the full committed migration history to a genuinely empty database and produces the recipe-core schema"
        status: pass
    human_judgment: false
  - id: D2
    description: "Applying only the newest migration to a database already carrying every earlier migration (staged as journal-minus-newest, both halves derived from enumerateMigrationFiles() with no hardcoded tag) applies exactly one migration and produces the same schema as the full-history run"
    requirement: RUN-06
    verification:
      - kind: integration
        ref: "tests/history/existing-db-newest-only.test.ts#applies only the newest migration to a database already carrying every earlier migration"
        status: pass
    human_judgment: false
  - id: D3
    description: "A migration classified SAFE upstream and tampered afterward to contain DROP TABLE is refused at execution against a real database: zero ledger rows, zero recipe-core tables, one refused/BLOCKED runner.migration_runs row naming the drop-table rule id, no credential leaked -- proven twice to show the refusal is not a one-shot state -- and the committed apps/recipe-app/drizzle/ directory is never mutated"
    requirement: RUN-01
    verification:
      - kind: integration
        ref: "tests/history/tamper-then-refuse.test.ts#refuses a migration classified SAFE upstream but tampered to contain DROP TABLE, applying nothing"
        status: pass
      - kind: integration
        ref: "tests/history/tamper-then-refuse.test.ts#refuses the same tampered directory identically on a second run -- the refusal is not a one-shot state"
        status: pass
    human_judgment: false
  - id: D4
    description: "The history suite's own pass/fail result is a committed, schema-validated, separate fact from the restore drill's -- with no staleness rule -- and the default pnpm test suite hard-fails when that record is missing, malformed, never-run, or FAIL"
    verification:
      - kind: unit
        ref: "tests/history-status.test.ts (10 tests: failing directions plus the real committed-record check)"
        status: pass
      - kind: manual_procedural
        ref: "docs/migration-history-status.json manually set to FAIL, tests/history-status.test.ts's committed-record test confirmed to fail, then reverted with git checkout"
        status: pass
    human_judgment: false

# Metrics
duration: 20min
completed: 2026-09-08
status: complete
---

# Phase 4 Plan 3: Migration History Proofs Summary

**A `test:history` Testcontainers suite that proves the migration history is consistent -- full history against a genuinely empty PostgreSQL 17 instance, newest-only against an already-migrated one, and a post-classification tampered migration refused at execution -- with a committed, schema-validated, no-staleness pass/fail record the default `pnpm test` suite hard-fails on.**

## Performance

- **Duration:** 20 min (17:18 start, 17:38 completion)
- **Started:** 2026-09-08T17:18:00-04:00 (approx.)
- **Completed:** 2026-09-08T17:38:15-04:00
- **Tasks:** 3 (all `type="auto"`, no checkpoints)
- **Files modified:** 11 (9 created, 2 modified)

## Accomplishments

- `vitest.history.config.ts`: the third slow, Docker-dependent vitest entry point (mirrors `vitest.drill.config.ts` exactly), and `vitest.config.ts` now excludes `tests/history/**` alongside `tests/drill/**` -- a fast test placed anywhere else structurally cannot land in this suite.
- `scripts/history-status.ts` / `scripts/history-suite.ts` / `docs/migration-history-status.json`: a committed, zod-schema-validated record of the history suite's own pass/fail, deliberately carrying **no** staleness/age rule (these tests are deterministic, run from committed migrations, and never decay with time) and kept as its own separate fact from the restore drill's status record (`02-CONTEXT.md` D-18) -- a green run of one can never silently upgrade the other.
- `tests/history/empty-db-full-history.test.ts` (RUN-05): applies the full committed journal to a genuinely empty `postgres:17` Testcontainers instance via `runMigrations` directly, asserting emptiness first, then the exact recipe-core table/column shape and a fully-populated `runner.migration_runs`.
- `tests/history/existing-db-newest-only.test.ts` (RUN-06): stages "journal minus its newest entry", applies the full list a second time, and asserts exactly one newly-applied migration, the rest skipped, and the resulting schema shape matching the full-history run -- both halves derived from `enumerateMigrationFiles()` with no hardcoded migration tag (D-25), so this test always exercises whatever the actual newest migration is.
- `tests/history/tamper-then-refuse.test.ts` (criterion 1 / RUN-01): copies the committed migrations directory into an `mkdtemp` copy, proves the untampered oldest migration classifies SAFE, appends `DROP TABLE ingredients;` to the temp copy only, and proves the real runner refuses at execution -- zero ledger rows, zero recipe-core tables, one `refused`/`BLOCKED` run-report row naming `drop-table`, no credential leaked -- twice, proving the refusal is not a one-shot state. `git status --porcelain apps/recipe-app/drizzle` stays empty throughout.
- `tests/history-status.test.ts` gains the D-24 default-suite check: `assertHistoryStatusPassed()` called with no arguments against the real committed record, plus proof its path is distinct from the restore drill's own status path.
- First real `pnpm test:history` run recorded: **PASS in ~11 seconds** (4 tests across 3 files), closing `04-VALIDATION.md`'s "Estimated runtime: UNKNOWN" with a measurement.

## Task Commits

Each task was committed atomically:

1. **Task 1: The third vitest config, the history status record, and the structural exclusion** - `2bf842b` (feat)
2. **Task 2: The two history axes -- full history against an empty database, newest migration against an existing one** - `b34ea6f` (test)
3. **Task 3: Tamper-then-refuse against a real database, and the first recorded history-suite result** - `b8d53db` (test)

**Plan metadata:** committed alongside this SUMMARY (see below).

## Files Created/Modified

- `vitest.history.config.ts` - the third slow-suite vitest config (`tests/history/**/*.test.ts` only)
- `scripts/history-status.ts` - schema-validated read/write/assert for the committed history status record, no staleness rule
- `scripts/history-suite.ts` - `pnpm test:history` entry point, wraps `vitest run` and records PASS/FAIL
- `docs/migration-history-status.json` - first real recorded PASS
- `tests/history-status.test.ts` - failing-direction coverage plus the real committed-record check
- `tests/history/support.ts` - shared, non-test Testcontainers/schema-shape helper module
- `tests/history/empty-db-full-history.test.ts` - RUN-05
- `tests/history/existing-db-newest-only.test.ts` - RUN-06
- `tests/history/tamper-then-refuse.test.ts` - criterion 1 / RUN-01
- `vitest.config.ts` - `tests/history/**` added to the structural exclude array
- `package.json` - `test:history` script added

## Decisions Made

- `tests/history/support.ts` is a plain module, not exported-from/imported-into one of the two `*.test.ts` files as the plan's literal wording suggested -- live-verified this session that importing a `*.test.ts` file duplicates its registered tests in vitest.
- `scripts/history-suite.ts` sets `stdio: "inherit"` on the vitest child process so `pnpm test:history` shows real output -- execa does not forward a child's stdout/stderr by default (verified live).
- `RECIPE_CORE_TABLES` and the expected full-history column shapes are re-declared in `tests/history/support.ts`, matching this repository's established precedent of each tool keeping its own private list.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Shared test helpers moved to a standalone module, not exported from a `*.test.ts` file**
- **Found during:** Task 2
- **Issue:** The plan's action text names two acceptable shapes for the shared `startEmptyPostgres17()`/`readSchemaShape()` helpers: "duplicated in both files, or into one of the two files and imported by the other." The Task 3 read_first note explicitly expects the latter ("reuse its container/client helpers" from `empty-db-full-history.test.ts`). Live-verified before committing to either shape: a minimal 2-file fixture where file B imports a `describe()`/`it()` from file A produced **3** collected tests instead of 2 when both files are included in the same vitest run -- vitest re-executes an imported test file's top-level registrations inside the importing file's own run. Exporting the helpers from `empty-db-full-history.test.ts` and importing them into `existing-db-newest-only.test.ts` and `tamper-then-refuse.test.ts` would have silently duplicated RUN-05's own tests inside both other files' runs.
- **Fix:** Created `tests/history/support.ts` -- a plain, non-test module (not matching `vitest.history.config.ts`'s `*.test.ts` include glob) holding `startEmptyPostgres17`, `runnerClientFor`, `readSchemaShape`, `RECIPE_CORE_TABLES`, and `EXPECTED_FULL_HISTORY_COLUMNS`. All three test files import from it. This does not create a new `scripts/` module for test-only helpers (the plan's own prohibition) -- the helpers still live under `tests/history/`, just not registered as their own suite.
- **Files modified:** `tests/history/support.ts` (new), `tests/history/empty-db-full-history.test.ts`, `tests/history/existing-db-newest-only.test.ts`, `tests/history/tamper-then-refuse.test.ts`
- **Verification:** `pnpm exec vitest run --config vitest.history.config.ts` reports exactly 8 tests across the 4 files (1 + 1 + 2 + N/A support.ts has no tests) -- no duplicated test names in the output; the disposable 2-file reproduction (deleted after confirming) showed the bug in isolation first.
- **Committed in:** `b34ea6f` (Task 2), `b8d53db` (Task 3, `tamper-then-refuse.test.ts`'s own import)

**2. [Rule 2 - Missing Critical] `scripts/history-suite.ts` made vitest's own output visible**
- **Found during:** Task 3
- **Issue:** The plan's action text specifies `execa(..., { reject: false })` with no `stdio` option. Running `pnpm test:history` with that shape produced **zero** visible output -- exit code 0, but no indication of which tests ran or how long they took, verified live (`execa` buffers a child's stdout/stderr and does not forward it to the parent by default). A developer or CI log reading `pnpm test:history`'s output would see nothing useful.
- **Fix:** Added `stdio: "inherit"` to the `execa` call, matching the visibility `pnpm db:drill`'s own step-by-step `console.log` output already provides.
- **Files modified:** `scripts/history-suite.ts`
- **Verification:** Re-ran `pnpm test:history` -- vitest's real `RUN`/`Test Files`/`Duration` output now prints to the console; exit code and status-record behavior unchanged.
- **Committed in:** `b8d53db` (Task 3)

---

**Total deviations:** 2 auto-fixed (1 bug avoidance, 1 missing critical/usability)
**Impact on plan:** Both necessary for the suite to behave correctly (deviation 1 prevents silent test duplication) and usably (deviation 2 makes failures diagnosable). No scope creep -- neither changes what the plan's `must_haves`/`acceptance_criteria` require.

## Issues Encountered

None beyond the deviations above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `tests/history/support.ts` gives plans 04-04/04-05/04-06 a working Testcontainers harness (`startEmptyPostgres17`, `runnerClientFor`, `readSchemaShape`) to add further `tests/history/*.test.ts` files against with no new infrastructure, per this plan's own `success_criteria`.
- `docs/migration-history-status.json` carries a real, current `PASS` -- the default `pnpm test` suite (404 tests, all green) will hard-fail if this record ever goes missing, malformed, or FAIL (live-verified this session: temporarily set to FAIL, confirmed the exact failure, reverted with `git checkout`).
- `git status --porcelain apps/recipe-app/drizzle` is empty -- the committed migrations directory was never mutated by any test in this plan.
- RUN-05 and RUN-06 marked complete in `REQUIREMENTS.md` (sole declaring plan). RUN-01 was already marked complete by `04-01-SUMMARY.md` once both its declaring plans (04-01, 04-03) had summaries at that time -- `update_requirements` below re-confirms rather than re-declares it, since 04-03 had not yet produced a summary when 04-01 closed out; if the shared-ID gate reports it still pending, this plan's own `tests/history/tamper-then-refuse.test.ts` is the second declaring plan's proof.
- No blockers for the next plan in this phase.

## Self-Check: PASSED

- All 9 files listed in `key-files.created` verified present on disk via `[ -f ]`.
- Commits `2bf842b` (Task 1), `b34ea6f` (Task 2), `b8d53db` (Task 3) all found via `git log --oneline --all`.
- `pnpm test` (41 files, 404 tests) green; `pnpm test:history` (3 files, 4 tests) green, real PASS recorded in `docs/migration-history-status.json`.
- Plan-level `<verification>` block re-confirmed: `pnpm test` collects zero files under `tests/history/`; `pnpm test:history` rewrites the status record with a PASS; `git status --porcelain apps/recipe-app/drizzle` is empty; the default suite hard-fails when the status record is set to FAIL (live-verified and reverted).

---
*Phase: 04-migration-runner-history-tests*
*Completed: 2026-09-08*
