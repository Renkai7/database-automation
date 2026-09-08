---
phase: 04-migration-runner-history-tests
plan: 04
subsystem: database
tags: [postgresql, drizzle-orm, pg, testcontainers, vitest, migration-runner, transactions]

# Dependency graph
requires:
  - phase: 04-migration-runner-history-tests
    provides: "04-01's runner core (runMigrations, RunnerClient, RUNNER_EXIT_CODES) -- this plan replaces its wrap-everything placeholder; 04-02's transactionHostile analyzer fact, the pure vocabulary this plan's policy reads instead of keeping a second keyword list; 04-03's tests/history/support.ts Testcontainers harness, reused verbatim for the new test file"
provides:
  - "packages/automation/src/runner/transaction-policy.ts -- decideTransactionPolicy(findings), MixedTransactionFileError, TransactionPolicy: the wrap-or-refuse decision derived exclusively from Finding.facts.transactionHostile"
  - "run-migrations.ts wired to the real policy module: a mixed-transaction-hostile file is refused (REFUSED_MIXED_FILE) with a recorded refused run entry, applying nothing from that file"
  - "tests/history/timeouts-and-concurrently.test.ts -- criterion 2 proven against a real postgres:17 Testcontainers instance: verified timeouts (and the negative control that proves the check can fail), a competing lock timing out in a bounded window, and CREATE INDEX CONCURRENTLY still succeeding with a mixed-file negative control"
affects: [04-05-partial-failure-and-recovery (inherits exactly one residual partial-failure case: a failed CONCURRENTLY build leaving an INVALID index, by construction of D-11's mixed-file refusal), 07-production-runner (the same transaction-policy.ts and timeout mechanism, unchanged, behind a second thin entry point)]

# Actuals (#2632)
actuals:
  tokens: 7111
  tasks: 2
  commits: 2
  plan_head_before: d50e807

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wrap-or-refuse policy is a pure function of Finding[] (transaction-policy.ts), mirroring floor.ts's own pure-function-of-facts, throw-loudly idiom -- no I/O, no imports beyond ../types, no side effects at import time. Counting hostile findings (not indexing statementIndex directly) is what makes a nested D-05 finding (non-empty nestedPath) count identically to a top-level one, with no special-casing."
    - "run-migrations.ts's applyMigration computes the transaction policy BEFORE splitStatements/execution and catches MixedTransactionFileError as its own refusal branch (recording a 'refused' run entry, mirroring the pre-existing BLOCKED branch) -- a mixed file never reaches the client at all, proven on the recorded call sequence, not merely on the thrown error."
    - "Real-database transaction tests use pg.Client built from a Testcontainers instance's own discrete host/port/user/password/database fields with options: RUNNER_CONNECTION_OPTIONS added explicitly at the call site (support.ts's shared runnerClientFor helper deliberately does NOT carry options, since most history tests don't need pinned timeouts) -- one negative-control client per file, built the same way but omitting options, is what proves the positive assertion is capable of failing."

key-files:
  created:
    - packages/automation/src/runner/transaction-policy.ts
    - packages/automation/test/transaction-policy.test.ts
    - tests/history/timeouts-and-concurrently.test.ts
  modified:
    - packages/automation/src/runner/run-migrations.ts
    - packages/automation/src/index.ts
    - packages/automation/test/run-migrations.test.ts
    - docs/migration-history-status.json

key-decisions:
  - "decideTransactionPolicy counts hostile findings across the WHOLE findings array (including nested findings from D-05 recursion) rather than only top-level ones, and refuses whenever more than one finding exists alongside at least one hostile finding -- this also correctly refuses two transactionHostile findings sharing one file (still a mixed file; a file is one unit), which the plan's behavior list called out explicitly."
  - "applyMigration computes the policy decision first (before splitStatements), so a mixed-file refusal happens with zero I/O beyond the recordRunEntry bookkeeping insert -- no statement from the refused file is ever split, let alone sent to the client."
  - "Case B/C's synthetic MigrationFile entries use in-memory:// placeholder paths (never read from disk) with idx/when values derived from the real committed journal's own maximum, so they always append after whatever the real history currently is -- no hardcoded migration count to keep in sync."

patterns-established:
  - "A runner-level test asserting 'no BEGIN was issued' or 'no statement executed' must assert on the fake/real client's own recorded call list or database state, never merely on the thrown error type -- carried forward from 04-01's own established discipline, now extended to the transaction-policy refusal path."

requirements-completed: [RUN-03, RUN-04]

coverage:
  - id: D1
    description: "The wrap-or-refuse decision is derived exclusively from the analyzer's transactionHostile fact -- no keyword list, statement-kind list, or regular expression of the runner's own; a mixed file (hostile statement alongside any other statement, including a second hostile one) is refused before any statement executes"
    requirement: RUN-04
    verification:
      - kind: unit
        ref: "packages/automation/test/transaction-policy.test.ts"
        status: pass
      - kind: unit
        ref: "packages/automation/test/run-migrations.test.ts#runMigrations transaction policy (D-09/D-11/RUN-03/RUN-04)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every migration execution runs under lock_timeout/statement_timeout applied at connect time and independently re-verified against pg_settings (as raw millisecond integers, never SHOW's human-formatted string) before anything executes, proven against a real PostgreSQL 17 instance -- including the negative control that a client without the connect-time options fails the same assertion"
    requirement: RUN-03
    verification:
      - kind: integration
        ref: "tests/history/timeouts-and-concurrently.test.ts#Case A: lock_timeout/statement_timeout are actually in effect as raw millisecond integers, and the assertion is proven capable of failing"
        status: pass
    human_judgment: false
  - id: D3
    description: "A migration blocked on a lock another session genuinely holds fails within a bounded window (> lock_timeout, comfortably < statement_timeout) rather than hanging, is recorded as a failed run-report row naming the failing statement, applies neither the ledger row nor the column, and the thrown error names a lock timeout without leaking the connection's own credentials"
    requirement: RUN-03
    verification:
      - kind: integration
        ref: "tests/history/timeouts-and-concurrently.test.ts#Case B: a competing lock times out rather than hanging (RUN-03)"
        status: pass
    human_judgment: false
  - id: D4
    description: "CREATE INDEX CONCURRENTLY still succeeds against a real database (unwrapped, valid index, one ledger row, wrapped=false run entry) because statements are never force-wrapped into a single transaction -- proven meaningful by a mixed-file negative control (CONCURRENTLY + ordinary ALTER TABLE) that is refused with neither the index nor the column created"
    requirement: RUN-04
    verification:
      - kind: integration
        ref: "tests/history/timeouts-and-concurrently.test.ts#Case C: CREATE INDEX CONCURRENTLY still succeeds (RUN-04), with a mixed-file negative control"
        status: pass
    human_judgment: false

# Metrics
duration: 17min
completed: 2026-09-08
status: complete
---

# Phase 4 Plan 4: Transaction Policy and Timeout Proof Summary

**The runner's wrap-or-refuse decision now reads the analyzer's own `transactionHostile` fact (never a second keyword list), refusing any file that mixes a transaction-hostile statement with anything else -- and criterion 2 is proven against a real PostgreSQL 17 instance: a competing lock fails within a bounded window while `CREATE INDEX CONCURRENTLY` still succeeds unwrapped.**

## Performance

- **Duration:** 17 min (04-03 completed 2026-09-08T17:38:15-04:00 -> Task 2 commit 2026-09-08T17:54:44-04:00)
- **Started:** 2026-09-08T17:38:15-04:00 (approx., immediately following 04-03)
- **Completed:** 2026-09-08T17:55:23-04:00 (approx.)
- **Tasks:** 2 (both `type="auto"`, Task 1 `tdd="true"`, no checkpoints)
- **Files modified:** 7 (3 created, 4 modified)

## Accomplishments

- `packages/automation/src/runner/transaction-policy.ts`: `decideTransactionPolicy(findings)` reads only `Finding.facts.transactionHostile` -- wraps by default (zero hostile findings, including an empty array); unwraps only when the file is exactly one finding and it is hostile; throws `MixedTransactionFileError` (naming the offending statement's index) for every other combination, including two hostile findings sharing one file. A nested finding (D-05 recursion, non-empty `nestedPath`) counts identically to a top-level one -- no special-casing.
- `run-migrations.ts`'s `applyMigration` replaces plan 04-01's wrap-everything placeholder: the policy decision runs before `splitStatements`/execution, and a thrown `MixedTransactionFileError` is mapped to `MigrationRefusedError` carrying `RUNNER_EXIT_CODES.REFUSED_MIXED_FILE`, with a `refused` run-report row recording the complete findings before rethrowing -- mirroring the pre-existing BLOCKED refusal branch exactly. No statement from a refused file ever reaches the injected client.
- Barrel (`packages/automation/src/index.ts`) exports `decideTransactionPolicy`, `MixedTransactionFileError`, `TransactionPolicy`.
- `packages/automation/test/transaction-policy.test.ts`: every behavior row in isolation, built from `EMPTY_FACTS`, including the "two hostile findings still refuse" and "nested finding counts the same" rows.
- `packages/automation/test/run-migrations.test.ts` extended with four new tests proving the policy at the `runMigrations` level, on the recorded call sequence: no `BEGIN`/`COMMIT` for a single `CREATE INDEX CONCURRENTLY`; a mixed file refused with `REFUSED_MIXED_FILE` and zero statements from that file reaching the client; exactly one `BEGIN`, per-statement `client.query()`, ledger insert, `COMMIT` in order for an ordinary migration; and no single recorded call ever names more than one `CREATE TABLE` (Pitfall 1).
- `tests/history/timeouts-and-concurrently.test.ts`: a single `postgres:17` Testcontainers instance, staged with the full committed history via `runMigrations`, proves Case A (timeouts genuinely in effect as raw `pg_settings` integers, plus the negative control that an untimed client fails the same check), Case B (a second `pg.Client` holds `LOCK TABLE recipes IN ACCESS EXCLUSIVE MODE`; the runner's competing `ALTER TABLE` fails in `(LOCK_TIMEOUT_MS, STATEMENT_TIMEOUT_MS)`, recorded as a `failed` run entry naming the statement, with no ledger row and no column), and Case C (`CREATE INDEX CONCURRENTLY` applies unwrapped -- valid index, one ledger row, `wrapped: false` run entry -- with a mixed-file negative control refused with neither the index nor the column created).
- `pnpm test:history` re-run in full: 4 files, 7 tests, PASS -- `docs/migration-history-status.json` carries a fresh `lastRunAt`/`outcome: "PASS"`.

## Task Commits

Each task was committed atomically:

1. **Task 1: The wrap-or-refuse decision, derived from facts and from nothing else** - `f4394bc` (feat)
2. **Task 2: Criterion 2 against a real database -- the lock times out, the concurrent index still succeeds** - `e7fa684` (test)

**Plan metadata:** committed alongside this SUMMARY (see below).

## Files Created/Modified

- `packages/automation/src/runner/transaction-policy.ts` - the pure wrap-or-refuse decision
- `packages/automation/src/runner/run-migrations.ts` - wired to the real policy, new REFUSED_MIXED_FILE branch
- `packages/automation/src/index.ts` - new barrel exports
- `packages/automation/test/transaction-policy.test.ts` - isolated policy behavior tests
- `packages/automation/test/run-migrations.test.ts` - runMigrations-level transaction-policy proofs
- `tests/history/timeouts-and-concurrently.test.ts` - criterion 2, RUN-03/RUN-04, against a real database
- `docs/migration-history-status.json` - fresh recorded PASS

## Decisions Made

- `decideTransactionPolicy` counts hostile findings across the whole array (top-level and nested alike) and refuses on any combination beyond "exactly one finding, and it is hostile" -- including two hostile findings in one file, which the plan's own behavior list required explicitly.
- `applyMigration` computes the policy before any I/O beyond the up-front ledger read, so a mixed-file refusal is provably zero-statement -- not merely error-typed.
- Case B/C's synthetic `MigrationFile` entries derive their `idx`/`when` from the real committed journal's own maximum rather than a hardcoded count, so the test never has to be kept in sync with the migration history's actual size.

## Deviations from Plan

None - plan executed exactly as written. The plan's own `<action>` text for Task 1 already anticipated the exact shape implemented (pure module mirroring `floor.ts`, `applyMigration` mapping the thrown error to `MigrationRefusedError`), and Task 2's three cases plus the mixed-file negative control were built and verified live against a real `postgres:17` Testcontainers instance without needing to deviate from the specified assertions.

## Issues Encountered

- First draft of Case B/C's `migration_tag` lookups queried `WHERE migration_tag = 'lock_probe'` / `'concurrent_index'` instead of the full tags actually recorded (`'9999_lock_probe'` / `'9999_concurrent_index'`) -- caught immediately by the live test run against the real container (two failing assertions expecting a row that could never match), fixed before commit. Not a deviation from the plan; a test-authoring mistake corrected during the same task, before anything was committed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 04-05 (partial failure and recovery) inherits exactly one residual partial-failure case by construction: a failed `CREATE INDEX CONCURRENTLY` build leaving an `INVALID` index behind. D-11's mixed-file refusal is what narrows RUN-08 down to that single named case rather than an open-ended set of half-applied-file shapes.
- `transactionHostile` remains readable in exactly one runner module (`transaction-policy.ts`) -- `grep -n "transactionHostile" packages/automation/src/runner/` confirmed live during this plan.
- `pnpm test` (42 files, 415 tests) and `pnpm test:history` (4 files, 7 tests) both green; `pnpm exec tsc --noEmit -p packages/automation/tsconfig.json` clean.
- No blockers for the next plan in this phase.

## Self-Check: PASSED

- All 3 files listed in `key-files.created` verified present on disk via `[ -f ]`.
- Commits `f4394bc` (Task 1), `e7fa684` (Task 2) both found via `git log --oneline --all`.
- `pnpm test` (42 files, 415 tests) green; `pnpm test:history` (4 files, 7 tests) green with a fresh recorded PASS; `pnpm exec tsc --noEmit -p packages/automation/tsconfig.json` clean.
- Plan-level `<verification>` block re-confirmed: a single-statement `CREATE INDEX CONCURRENTLY` migration produces no `BEGIN`/`COMMIT` (both the fake-client unit test and the real-database integration test); an ordinary migration still produces exactly one `BEGIN`/`COMMIT`; a mixed file is refused with `RUNNER_EXIT_CODES.REFUSED_MIXED_FILE` and nothing from it applied, both against a fake client and against a real database.

---
*Phase: 04-migration-runner-history-tests*
*Completed: 2026-09-08*
