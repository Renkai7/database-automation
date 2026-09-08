---
phase: 04-migration-runner-history-tests
plan: 01
subsystem: database
tags: [postgresql, drizzle-orm, pg, libpg-query, vitest, migration-runner]

# Dependency graph
requires:
  - phase: 03-safety-analyzer
    provides: analyzeSql, enumerateMigrationFiles, loadDefaultRules, the StatementFacts/Verdict/Finding vocabulary
provides:
  - "packages/automation/src/runner/* -- the pure-core runner (client, timeouts, exit-codes, split-statements, ledger, runner-table, run-migrations), injectable-client, no pg import (D-28)"
  - "scripts/db-migrate.ts -- the pinned thin entry point; pnpm db:migrate is now the gated runner, not drizzle-kit migrate"
  - "runner.migration_runs -- the in-database run-report/sidecar table plan 04-05 extends for in-flight/failure state"
  - "drizzle-kit's own migrate sub-command made structurally unreachable from the whole tracked source surface (D-02), enforced by tests/guardrails.test.ts with no per-file allowlist"
affects: [04-migration-runner-history-tests (plans 02-07 drive this same runMigrations core from Testcontainers), 05-ci-safety-gate (consumes the RunReport JSON shape), 07-production-runner (second thin entry point over the same core)]

# Actuals (#2632)
actuals:
  tokens: 17727
  tasks: 3
  commits: 2

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Classify-then-execute in two phases: every pending migration is classified (analyzeSql) BEFORE any of them is executed, so a parse failure anywhere in the pending set aborts before a single statement runs (D-08's literal 'applying nothing at all') -- distinct from a BLOCKED verdict discovered during the execution phase, which stops the run but does not undo migrations already applied earlier in that same phase (D-02's narrower 'apply nothing further')."
    - "RunnerClient is a single-method (query(text): Promise<{rows}>) injected interface with no bind-parameter mechanism (D-28) -- every write path (ledger.ts, runner-table.ts) builds its own safely-quoted SQL literal as its own equivalent of parameterisation, rather than depending on a driver capability the minimal client shape does not expose."
    - "Pure-core / thin-adapter split extended one level further: packages/automation/src/runner/ never imports pg; scripts/db-migrate.ts is the only module on the migrate path permitted to hold a real connection."

key-files:
  created:
    - packages/automation/src/runner/client.ts
    - packages/automation/src/runner/timeouts.ts
    - packages/automation/src/runner/exit-codes.ts
    - packages/automation/src/runner/split-statements.ts
    - packages/automation/src/runner/ledger.ts
    - packages/automation/src/runner/runner-table.ts
    - packages/automation/src/runner/run-migrations.ts
    - scripts/db-migrate.ts
    - tests/migrate.test.ts
    - packages/automation/test/split-statements.test.ts
    - packages/automation/test/ledger.test.ts
    - packages/automation/test/run-migrations.test.ts
  modified:
    - packages/automation/src/adapter/drizzle-migrations.ts
    - packages/automation/src/index.ts
    - package.json
    - tests/db-reset.test.ts
    - apps/recipe-app/drizzle.config.ts
    - scripts/db-reset.ts
    - scripts/drill-assertions.ts
    - scripts/verify-migration-state.ts
    - tests/guardrails.test.ts
    - tests/target-pin.test.ts

key-decisions:
  - "Two-phase classify-then-execute in runMigrations, derived directly from D-08's own wording distinction ('apply nothing further' for BLOCKED vs. 'applying nothing at all' for a parse failure) -- not stated explicitly as an algorithm in CONTEXT.md, but the only reading that satisfies both sentences literally."
  - "RunnerClient's minimal single-method shape means no module can depend on driver-level parameter binding; ledger.ts and runner-table.ts each build safely-quoted SQL literals as their own equivalent of parameterisation."
  - "User checkpoint decision (Task 2): the D-02 second-migrate-path guardrail is unconditional, no per-file allowlist, mirroring the existing drizzle-kit push guardrail idiom exactly -- six prose mentions were reworded (not five; Task 1's own packages/automation/src/runner/timeouts.ts also carried the phrase and was found only once the unconditional whole-source-surface scan ran)."
  - "runner.migration_runs is bootstrapped by the runner itself (CREATE ... IF NOT EXISTS at first connect), deliberately not a committed Drizzle migration -- the runner needs the table to exist in order to record the very run that creates it, and it is runner infrastructure, not application schema drizzle-kit generate should diff."

patterns-established:
  - "Runner exit-code contract (RUNNER_EXIT_CODES) is deliberately distinct from packages/automation's analyzer EXIT_CODES -- the runner's 0 means 'applied everything it was allowed to, including REVIEW_REQUIRED', never reused from the analyzer's own verdict-exit-code enum."
  - "Every new entry point on the migrate path (scripts/db-migrate.ts) follows the established run(): Promise<number> / process.exitCode pattern -- never a forced synchronous process exit, because this process runs libpg-query WASM parses (the reproduced Windows libuv crash packages/automation/src/cli.ts's own header documents)."

requirements-completed: [RUN-01, RUN-02, RUN-03]

coverage:
  - id: D1
    description: "pnpm db:migrate is the runner end to end: reads each committed migration once, classifies and splits the exact same buffer, executes under verified connect-time lock_timeout/statement_timeout, writes a byte-compatible drizzle.__drizzle_migrations row and a complete runner.migration_runs row, and a second run applies nothing"
    requirement: RUN-01
    verification:
      - kind: integration
        ref: "tests/migrate.test.ts#applies the full committed history as byte-compatible drizzle rows plus a complete runner-owned run report, and a second run applies nothing"
        status: pass
      - kind: unit
        ref: "packages/automation/test/split-statements.test.ts"
        status: pass
      - kind: unit
        ref: "packages/automation/test/ledger.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every refusal branch (BLOCKED with no override, unparseable SQL, comment-only file, options-key-set immutability, duplicate journal idx) executes nothing against the injected client, proven on a recording fake client's call list, not merely a thrown error"
    requirement: RUN-02
    verification:
      - kind: unit
        ref: "packages/automation/test/run-migrations.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every migration execution is wrapped under connect-time lock_timeout/statement_timeout the runner verifies actually took effect via pg_settings before executing anything"
    requirement: RUN-03
    verification:
      - kind: integration
        ref: "tests/migrate.test.ts"
        status: pass
      - kind: unit
        ref: "packages/automation/test/run-migrations.test.ts#two adjacent statements separated by a standalone comment produce exactly two client.query() calls whose texts contain neither the comment nor a trailing semicolon"
        status: pass
    human_judgment: false
  - id: D4
    description: "drizzle-kit's own migrate sub-command is structurally unreachable from the whole tracked source surface, with no exemption list, and packages/automation still imports no database driver"
    verification:
      - kind: unit
        ref: "tests/guardrails.test.ts"
        status: pass
    human_judgment: false

# Metrics
duration: 31min
completed: 2026-09-08
status: complete
---

# Phase 4 Plan 1: Migration Runner Summary

**`pnpm db:migrate` is now a real, in-process migration runner over `pg` -- classifying each committed migration's exact bytes, refusing BLOCKED with no override, executing under a verified `lock_timeout`/`statement_timeout`, and writing both a byte-compatible `drizzle.__drizzle_migrations` row and a complete `runner.migration_runs` row -- with drizzle-kit's own `migrate` sub-command made structurally unreachable from the whole repository.**

## Performance

- **Duration:** 31 min (16:15:58 plan creation -> 16:46:47 Task 3 commit; includes one checkpoint pause for Task 2's human decision)
- **Started:** 2026-09-08T16:15:58-04:00
- **Completed:** 2026-09-08T16:46:47-04:00
- **Tasks:** 3 (1 tracer, 1 checkpoint:decision, 1 auto)
- **Files modified:** 22 (12 created, 10 modified)

## Accomplishments

- Runner core (`packages/automation/src/runner/`): a `RunnerClient`-injected, `pg`-free module set that reads each migration's bytes once, classifies and statement-splits that exact buffer via `analyzeSql`/`libpg-query`, refuses `BLOCKED` unconditionally, and executes wrapped in a transaction with the byte-compatible ledger insert in the same transaction (D-12).
- `lock_timeout`/`statement_timeout` applied as libpq connect-time options and independently re-verified against `pg_settings` before anything executes (D-13/D-14/D-15) -- never trusting "set it and move on."
- A runner-owned `runner.migration_runs` table records the complete findings, verdict, statement count, wrap/unwrap decision and timing for every migration considered, including skipped ones -- the substrate Phase 7's audit log will extend.
- `scripts/db-migrate.ts`: the pinned thin entry point, accepting exactly one flag (`--migrations-dir <path>`, a directory, never a database target), never calling a forced synchronous process exit (Windows libuv WASM-teardown crash avoidance).
- Every refusal branch (BLOCKED, parse failure, options-key immutability, comment-only file, duplicate journal `idx`) proven against a recording fake client -- asserting on the call list, not merely on a thrown error.
- `drizzle-kit`'s own `migrate` sub-command made structurally unreachable from the entire tracked source surface (`tests/guardrails.test.ts`, unconditional, no per-file allowlist -- the user's explicit checkpoint decision), alongside a new structural guarantee that `packages/automation` still imports no database driver.

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end runner (tracer)** - `e0de3b6` (feat)
2. **Task 2: Decision checkpoint -- how strictly to close the second migrate path** - human decision only, no code, no commit (resolved: `unconditional`)
3. **Task 3: Refusal contracts + second migrate path closed structurally** - `fbb4830` (test)

_Note: Task 1 is `type="tracer"` -- its own `<verify>` (both entries `<automated>`, no `<human-check>`) was re-run after the commit per the tracer feedback gate and passed, so execution proceeded straight to Task 2's checkpoint with no separate mid-flight halt._

## Files Created/Modified

- `packages/automation/src/runner/client.ts` - `RunnerClient` interface, the whole database capability the runner core is allowed
- `packages/automation/src/runner/timeouts.ts` - pinned timeout constants, connect-time options string, `pg_settings`-based verification
- `packages/automation/src/runner/exit-codes.ts` - `RUNNER_EXIT_CODES`, distinct from the analyzer's own `EXIT_CODES`
- `packages/automation/src/runner/split-statements.ts` - `stmt_location`/`stmt_len`-based statement splitting
- `packages/automation/src/runner/ledger.ts` - byte-compatible `drizzle.__drizzle_migrations` hash/read/insert
- `packages/automation/src/runner/runner-table.ts` - `runner.migration_runs` DDL + safely-quoted insert/read
- `packages/automation/src/runner/run-migrations.ts` - the classify-then-execute orchestrator
- `scripts/db-migrate.ts` - the pinned thin entry point
- `tests/migrate.test.ts` - end-to-end proof against the real pinned dev database
- `packages/automation/test/{split-statements,ledger,run-migrations}.test.ts` - unit coverage
- `packages/automation/src/adapter/drizzle-migrations.ts` - `MigrationFile.when`, duplicate-`idx` hard fail
- `packages/automation/src/index.ts` - new runner barrel exports
- `package.json` - `db:migrate` now runs `scripts/db-migrate.ts`
- `tests/db-reset.test.ts` - expects `runner.migration_runs` in the post-reset table list
- `tests/guardrails.test.ts` - the new D-02 (no second migrate path) and D-28 (no `pg` import) assertions
- `apps/recipe-app/drizzle.config.ts`, `scripts/db-reset.ts`, `scripts/drill-assertions.ts`, `scripts/verify-migration-state.ts`, `tests/target-pin.test.ts`, `packages/automation/src/runner/timeouts.ts` - reworded prose mentions of drizzle-kit's own migrate sub-command, meaning preserved

## Decisions Made

- Two-phase classify-then-execute in `runMigrations`, derived from D-08's own wording distinction between "apply nothing further" (BLOCKED, discovered mid-execution) and "applying nothing at all" (a parse failure) -- the only reading that satisfies both sentences literally.
- `RunnerClient`'s minimal single-method shape (no bind-parameter mechanism) means every write path builds its own safely-quoted SQL literal as its equivalent of parameterisation.
- User checkpoint decision: the D-02 guardrail is unconditional with no per-file allowlist, mirroring the existing `drizzle-kit push` guardrail idiom exactly.
- `runner.migration_runs` is bootstrapped by the runner itself, deliberately not a committed Drizzle migration.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Reworded a sixth prose mention of the forbidden phrase, beyond the five files Task 2's checkpoint named**
- **Found during:** Task 3
- **Issue:** `packages/automation/src/runner/timeouts.ts`'s own D-15 module comment (written during Task 1) used the literal phrase "drizzle-kit migrate" in prose -- the checkpoint's five-file list, gathered before Task 1 existed, could not have named a file Task 1 itself created. The new unconditional D-02 guardrail scans the whole tracked source surface, so this file would otherwise fail the very test this task adds.
- **Fix:** Reworded to "drizzle-kit's own migrate sub-command", meaning preserved.
- **Files modified:** `packages/automation/src/runner/timeouts.ts`
- **Verification:** `tests/guardrails.test.ts`'s new D-02 assertion passes; a full grep across the tracked source surface confirms zero remaining occurrences of the two-token phrase.
- **Committed in:** `fbb4830` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to satisfy the plan's own acceptance criteria (an unconditional, whole-source-surface scan) faithfully rather than only the five files named before Task 1's own code existed. No scope creep.

## Issues Encountered

- `tests/migrate.test.ts`'s JSON-report extraction initially mis-parsed `pnpm run db:migrate`'s stdout, because `dotenv`'s own "injected env" notice prints a stray `{` inside its tip text before the real JSON report. Fixed by locating the report's own line-initial `{` (a `"\n{\n"` marker) rather than the first `{` character anywhere in stdout. Resolved before commit; no lasting issue.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `runMigrations`/`RunnerClient` are importable from `packages/automation` and take an injected client, so plans 04-02 through 04-05 (the Testcontainers-backed history proofs, transaction-hostile handling, and partial-failure recovery) can drive the exact same core without a second code path.
- `drizzle-kit generate` and `drizzle-kit check` are confirmed untouched and still work (relied on by `tests/db-reset.test.ts`'s own committed-history exercise).
- RUN-01/RUN-02/RUN-03 have a working, tested implementation behind `pnpm db:migrate`; REQUIREMENTS.md's own checkboxes for those IDs stay unticked for now because sibling plans later in this phase also declare them (the shared-ID gate correctly reported `0/3 ready` this run) -- they will tick once every declaring plan in Phase 4 has its own SUMMARY.
- No blockers for the next plan in this phase.

## Self-Check: PASSED

- All 13 files listed in `key-files.created` verified present on disk via `[ -f ]`.
- Commits `e0de3b6` (Task 1), `fbb4830` (Task 3), `0d19b19` (this SUMMARY) all found via `git log --oneline --all`.
- `pnpm test` (38 files, 338 tests) green; `pnpm exec tsc --noEmit -p packages/automation/tsconfig.json` clean.
- Plan-level `<verification>` block re-confirmed: `pnpm db:migrate` against an already-migrated dev database exits 0 and applies nothing; `pnpm db:reset`'s independent `assertMigrationHistoryApplied` post-check passes; zero occurrences of `drizzle-kit migrate` remain in the tracked source surface; zero `pg` imports under `packages/automation/src/`.

---
*Phase: 04-migration-runner-history-tests*
*Completed: 2026-09-08*
