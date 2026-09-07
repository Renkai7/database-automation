---
phase: 01-local-environment
plan: 07
subsystem: database
tags: [error-handling, drizzle-kit, migration-verification, security, gap-closure]

requires:
  - phase: 01-local-environment (01-01..01-06)
    provides: scripts/env.ts's shared validation module, scripts/db-query.ts, scripts/db-reset.ts, apps/recipe-app/drizzle/meta/_journal.json, the D-22 five-step rebuild order
provides:
  - "scripts/log.ts: safeErrorMessage(error) -- the single, tested definition of the never-print-the-raw-error-object rule (closes IN-01)"
  - "scripts/verify-migration-state.ts: DEFAULT_JOURNAL_PATH and assertMigrationHistoryApplied() -- an independently testable, proven-both-directions assertion that the migration history actually applied (closes CR-02)"
  - "scripts/db-reset.ts: a new runStep between migrate and seed that calls assertMigrationHistoryApplied(), so the rebuild proves its own result instead of trusting drizzle-kit's exit code"
affects: [01-08, phase-04-migration-runner]

actuals:
  tokens: 3334
  tasks: 2
  commits: 6
  plan_head_before: fb48357270bffb0b58d1d7f34dc3ba53850eef9a

tech-stack:
  added: []
  patterns:
    - "Shared, side-effect-free error-formatting module: a single-function module with no imports, safe to import from any script or test without triggering scripts/env.ts's import-time environment validation"
    - "Independently-callable state assertion: verification logic that a destructive CLI tool runs on itself lives in its own module (not inline in the tool), specifically so a test can call it directly without triggering the tool's own module-load side effects, and can therefore be proven to fail as well as pass"

key-files:
  created:
    - scripts/log.ts
    - tests/log.test.ts
    - scripts/verify-migration-state.ts
    - tests/verify-migration-state.test.ts
  modified:
    - scripts/db-query.ts
    - scripts/db-reset.ts

key-decisions:
  - "scripts/log.ts imports nothing and has no side effects, so it can be imported by a test (or a future consumer) without triggering scripts/env.ts's import-time environment validation -- the same reasoning 01-06 documented for keeping env.ts's concerns separate from a plain string formatter."
  - "assertMigrationHistoryApplied checks only what a silently no-opped migrate would break (applied-migration count vs. the committed journal, and presence of the three recipe-core tables) -- seed row counts deliberately stay out of it and remain tests/db-reset.test.ts's own independent responsibility, so the rebuild tool's self-check is not coupled to fixture data."
  - "tests/db-reset.test.ts's assertRebuiltState was left untouched rather than refactored onto the new shared module -- an end-to-end test that verified the tool by calling the tool's own helper would prove only that the helper agrees with itself; the test's independent assertion is what makes it evidence."

patterns-established:
  - "Pattern: a destructive/idempotent CLI tool's self-verification logic lives in its own importable module, not inline in the tool's entry function, so the guard is provable in the failing direction and not just the passing one."

requirements-completed: [ENV-04, ENV-05]

coverage:
  - id: D1
    description: "The 'print only the error's own message, never the error object' rule (T-01-18 / IN-01) is defined once in scripts/log.ts, tested, and imported by both scripts/db-query.ts and scripts/db-reset.ts -- no inline conditional reconstructing a message from an unknown error value remains in either script."
    requirement: "ENV-05"
    verification:
      - kind: unit
        ref: "tests/log.test.ts#scripts/log.ts — safeErrorMessage"
        status: pass
      - kind: integration
        ref: "tests/db-query.test.ts#never prints a connection-string scheme prefix or a password on any path (T-01-18)"
        status: pass
      - kind: unit
        ref: "tests/guardrails.test.ts (9/9, no new allowlist entries needed)"
        status: pass
    human_judgment: false
  - id: D2
    description: "pnpm db:reset independently re-verifies that the migration history actually applied (drizzle.__drizzle_migrations count vs. the committed journal, plus presence of the three recipe-core tables) instead of trusting drizzle-kit migrate's exit code (CR-02)."
    requirement: "ENV-04"
    verification:
      - kind: unit
        ref: "tests/verify-migration-state.test.ts#resolves against the live, genuinely migrated development database"
        status: pass
      - kind: integration
        ref: "pnpm db:reset (manual run: prints 'verify migration history applied' step, completes, recipe-core counts 1/8/5)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The migration-state assertion is proven to fail, not just to pass: given a journal reporting one more entry than was actually applied, assertMigrationHistoryApplied rejects naming both counts, and the rejection message carries no connection-string scheme prefix."
    requirement: "ENV-04"
    verification:
      - kind: unit
        ref: "tests/verify-migration-state.test.ts#rejects when the journal reports one more entry than was actually applied, naming both counts"
        status: pass
    human_judgment: false
  - id: D4
    description: "The new verification step fails loudly (no catch-and-continue, no skip flag/argument/env var) and the D-22 five-step order, D-24's no-prompt property, and tests/db-reset.test.ts's independent end-to-end assertion are all unchanged."
    requirement: "ENV-04"
    verification:
      - kind: integration
        ref: "tests/db-reset.test.ts#destroys, rebuilds, migrates and reseeds non-interactively, and converges on a second run (D-22/D-24)"
        status: pass
      - kind: unit
        ref: "tests/guardrails.test.ts#scripts/db-reset.ts takes no interactive input (D-24)"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-09-07
status: complete
---

# Phase 1 Plan 07: Rebuild Self-Verification and Shared Error Formatting (Gap Closure) Summary

**`pnpm db:reset` now independently re-verifies that the migration history actually applied instead of trusting `drizzle-kit migrate`'s exit code, and the "never print the raw error object" rule that keeps a connection string out of logs is defined once in `scripts/log.ts` and imported by both CLI scripts.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-09-07T15:50:00Z (approx.)
- **Completed:** 2026-09-07T16:15:00Z (approx.)
- **Tasks:** 2 completed
- **Files modified:** 6 (4 created, 2 modified)

## Accomplishments

- `scripts/log.ts` (new) exports `safeErrorMessage(error: unknown): string`, the single tested definition of the credential-safety output rule previously duplicated across three call sites in `scripts/db-query.ts` and `scripts/db-reset.ts`. It imports nothing and has no side effects, so importing it never triggers `scripts/env.ts`'s import-time environment validation.
- `scripts/db-query.ts` and all three error-formatting sites in `scripts/db-reset.ts` now route through `safeErrorMessage` instead of each carrying its own `error instanceof Error` conditional. `tests/db-query.test.ts` passes unmodified, including its output-hygiene assertions.
- `scripts/verify-migration-state.ts` (new) exports `DEFAULT_JOURNAL_PATH` and `assertMigrationHistoryApplied()`, which re-queries `drizzle.__drizzle_migrations` and `information_schema.tables` directly, closing CR-02 — the known Windows failure mode where `drizzle-kit migrate` can exit zero without applying SQL.
- `tests/verify-migration-state.test.ts` proves the guard in both directions: it resolves against the live, genuinely migrated development database, and rejects — naming both the expected and found counts — when given a journal reporting one entry more than was actually applied.
- `scripts/db-reset.ts` runs the new assertion as its own numbered step between the migrate step and the seed step. A live `pnpm db:reset` run confirmed the new step prints its start/done lines, the rebuild still completes, and the recipe-core row counts land at 1/8/5.

## Task Commits

Both tasks were `tdd="true"` and followed the RED → GREEN cycle (no REFACTOR commit needed for either — both implementations were minimal on first pass):

1. **Task 1 — RED: failing test for `safeErrorMessage`** — `5925abf` (test)
2. **Task 1 — GREEN: define `safeErrorMessage` in `scripts/log.ts`** — `1440e7b` (feat)
3. **Task 1 — wire both scripts onto the shared formatter** — `5ebc044` (refactor)
4. **Task 2 — RED: failing tests for the post-migrate state assertion** — `f0ed6f7` (test)
5. **Task 2 — GREEN: `assertMigrationHistoryApplied` in `scripts/verify-migration-state.ts`** — `37ae320` (feat)
6. **Task 2 — wire the assertion into `db-reset.ts`'s step sequence** — `0d1307e` (feat)

_Note: commit 3 (`5ebc044`) is typed `refactor` rather than `feat` because it changes only how the two existing scripts format an error message they already formatted — no new behavior, matching the commit-type table's "no behavior change" definition. Commit 6 (`0d1307e`) is typed `feat` rather than `refactor` because it adds a new observable step (and therefore new behavior — a rebuild can now fail where it previously would have reported success) to `db-reset.ts`._

## Files Created/Modified

- `scripts/log.ts` (new) — `safeErrorMessage(error: unknown): string`; no imports, no side effects.
- `tests/log.test.ts` (new) — five cases: Error, string, non-Error object carrying connection details, `undefined`, `null`.
- `scripts/verify-migration-state.ts` (new) — `DEFAULT_JOURNAL_PATH`, `assertMigrationHistoryApplied()`.
- `tests/verify-migration-state.test.ts` (new) — green-direction and red-direction (mismatched journal) cases.
- `scripts/db-query.ts` — top-level catch now calls `safeErrorMessage`; inline rationale comment replaced with a pointer to `scripts/log.ts`.
- `scripts/db-reset.ts` — all three error-formatting sites route through `safeErrorMessage`; new `runStep("verify migration history applied", ...)` inserted between the migrate and seed steps.

## Decisions Made

See `key-decisions` in frontmatter: `scripts/log.ts` is deliberately import-free and side-effect-free; `assertMigrationHistoryApplied` deliberately excludes seed row counts from its scope (that stays `tests/db-reset.test.ts`'s job); `tests/db-reset.test.ts` was deliberately left untouched rather than refactored onto the new module, because an independent test assertion is what makes the guard's proof credible.

## Deviations from Plan

None — plan executed exactly as written. Both tasks' `<action>` and `<acceptance_criteria>` were followed directly; no Rule 1-4 deviations were needed.

## Issues Encountered

- **RED phase for both tasks was a module-not-found import error** (the target files did not exist yet), rather than a test running against existing-but-wrong behavior. This is the expected RED shape for net-new modules and was verified deliberately before writing any implementation, consistent with how plan 01-06 handled RED evidence when `workflow.tdd_mode` is not set in `.planning/config.json` (confirmed unset for this project) — RED evidence was established manually (run test, confirm the specific import-failure mode, then implement) rather than via the automated `gsd_run check tdd-red-evidence` gate.
- **Pre-commit HEAD safety assertion vs. this repository's actual working pattern:** this repository has no git remote (worktree isolation auto-degraded per #683), and every prior phase-1 commit — including all of plan 01-06's — was made directly on `main`. The orchestrator's `<sequential_execution>` instructions for this run explicitly confirmed executing "on the main working tree (git branch `main`)". Commits were made directly to `main`, consistent with this project's established, single-branch, milestone-branch-created-later workflow.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- CR-02 is closed: `pnpm db:reset` verifies its own result inside the tool a person actually runs, and that verification is proven to fail (not just assumed to work) via `tests/verify-migration-state.test.ts`'s red-direction case.
- IN-01 is closed: the credential-safety output rule has one definition (`scripts/log.ts`), one test file, and two importers (`scripts/db-query.ts`, `scripts/db-reset.ts`).
- D-22's five-step rebuild order and D-24's no-prompt property survive intact — the new step is additive, not a reordering, and takes no skip flag.
- ENV-04 and ENV-05 are also declared by plans 01-04 and 01-06, both of which already have SUMMARY.md files; this plan's SUMMARY completes the shared-ID set (#2388), so both requirement IDs should now be eligible to mark Complete.
- Plan 01-08 (final Phase 1 completion bookkeeping, including WR-03's application-side servings-scaler fix and the outstanding UI-SPEC row) remains to close out this phase.
- Full `pnpm test` suite: 45/45 green (8 test files), including a live `pnpm db:reset` run and a live `pnpm db:query` row-count check performed directly (outside `pnpm test`) as required by this plan's own verification steps.

## Self-Check: PASSED

All created/modified files confirmed present on disk: `scripts/log.ts`, `tests/log.test.ts`, `scripts/verify-migration-state.ts`, `tests/verify-migration-state.test.ts`, `scripts/db-query.ts`, `scripts/db-reset.ts`, this SUMMARY.md. All six task commits (`5925abf`, `1440e7b`, `5ebc044`, `f0ed6f7`, `37ae320`, `0d1307e`) confirmed present in `git log`. Plan-level `<verification>` re-run: `pnpm db:reset` prints the migration-history verification step and completes with recipe-core counts at 1/8/5; `tests/verify-migration-state.test.ts` passes both directions; no output path of either CLI script carries a connection-string scheme prefix or a password (verified across `tests/db-query.test.ts`, `tests/guardrails.test.ts`, and the live `pnpm db:reset` output); `tests/db-reset.test.ts` is byte-for-byte unmodified (confirmed via `git diff`) and passes; `tests/guardrails.test.ts` is 9/9 green with no new fixture-allowlist entries needed; full `pnpm test` suite is 45/45 green.

---
*Phase: 01-local-environment*
*Completed: 2026-09-07*
