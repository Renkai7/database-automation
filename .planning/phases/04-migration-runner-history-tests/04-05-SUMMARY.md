---
phase: 04-migration-runner-history-tests
plan: 05
subsystem: database
tags: [postgresql, drizzle-orm, pg, testcontainers, vitest, migration-runner, partial-failure, recovery]

# Dependency graph
requires:
  - phase: 04-migration-runner-history-tests
    provides: "04-01's runner core (runMigrations, RunnerClient, runner.migration_runs, RUNNER_EXIT_CODES) -- this plan wires the table's in_flight/resolved states 04-01 left as placeholders; 04-03's tests/history/support.ts Testcontainers harness (startEmptyPostgres17); 04-04's transaction-policy.ts (decideTransactionPolicy), whose wrap:false branch is exactly where this plan's marker lifecycle attaches"
provides:
  - "packages/automation/src/runner/runner-table.ts -- writeInFlightMarker/markMarkerApplied/markMarkerFailed/resolveMarker/readUnresolvedMarkers/readInvalidIndexes/UnresolvedMarkerError: the complete in-flight-marker lifecycle for D-18/D-19/D-20"
  - "run-migrations.ts refuses the WHOLE run before classifying anything when an unresolved marker exists (RUNNER_EXIT_CODES.REFUSED_STALE_MARKER), and its unwrapped branch brackets the single statement with a marker insert/resolve so a crash between execution and the ledger insert is a named, queryable state"
  - "scripts/db-migrate-recover.ts (pnpm db:migrate:recover) -- reports every unresolved marker and every INVALID index, states unmissably that nothing was repaired, then resolves the markers so pnpm db:migrate can proceed. Never touches the migration journal, never drops anything, accepts no target."
  - "tests/history/partial-failure-recovery.test.ts -- criterion 4/RUN-08 proven end to end against a real database, including the negative controls (a wrapped failure never blocks, the INVALID index survives recovery, resolved rows are never deleted)"
affects: [07-production-runner (db:migrate:recover is the recovery path a production incident will need under pressure; the runner-owned table's in_flight/resolved states are the substrate Phase 7's audit log extends)]

# Actuals (#2632)
actuals:
  tokens: 18218
  tasks: 3
  commits: 4
  plan_head_before: 7659aed

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A marker row is transitioned IN PLACE (UPDATE), never superseded by a second INSERT -- writeInFlightMarker's row becomes the ONE row for that migration, whether it ends in markMarkerApplied (state: applied), markMarkerFailed (state: failed, left unresolved), or resolveMarker (state: resolved, the recovery command's own outcome). This keeps the one-row-per-migration shape recordRunEntry already established for every other branch intact for the unwrapped branch too -- load-bearing because tests/history/empty-db-full-history.test.ts (04-03, unmodified by this plan) asserts every row sharing a run's run_id has state = 'applied' after a clean run, which a second, separately-inserted row would have broken."
    - "resolveMarker (state -> 'resolved') is reserved exclusively for db:migrate:recover's own outcome -- a marker a PRIOR run left behind. The ordinary run-migrations.ts success/failure paths never call it; they call markMarkerApplied/markMarkerFailed instead, which update the same row to 'applied'/'failed' respectively. 'resolved' is therefore a legible audit signal on its own: it means a human intervened, not merely that the row is closed out."
    - "readUnresolvedMarkers' WHERE clause (state = 'in_flight' OR (state = 'failed' AND wrapped = false)) is the single point that decides what counts as a stale marker -- a wrapped failure's row (wrapped: true) never matches it by construction, proven directly against a real database rather than merely inferred from the schema."

key-files:
  created:
    - scripts/db-migrate-recover.ts
    - packages/automation/test/runner-table.test.ts
    - tests/db-migrate-recover.test.ts
    - tests/history/partial-failure-recovery.test.ts
  modified:
    - packages/automation/src/runner/runner-table.ts
    - packages/automation/src/runner/run-migrations.ts
    - packages/automation/src/index.ts
    - packages/automation/test/run-migrations.test.ts
    - tests/guardrails.test.ts
    - package.json
    - docs/migration-history-status.json

key-decisions:
  - "The plan's own action text for run-migrations.ts's unwrapped branch names the literal sequence 'writeInFlightMarker -> statement -> insertLedgerRow -> resolveMarker'. Implemented instead as writeInFlightMarker -> statement -> insertLedgerRow -> markMarkerApplied (a new, otherwise-unlisted helper that updates the SAME row to state 'applied', not 'resolved') -- because tests/history/empty-db-full-history.test.ts (04-03, not in this plan's files_modified, and left unmodified) asserts every row sharing a run's run_id has state = 'applied' after a clean run. Calling the literally-named resolveMarker on every ordinary successful unwrapped migration would have set that row to 'resolved' instead, breaking that pre-existing, unmodifiable assertion. resolveMarker's own described behavior ('sets the row's state to resolved') is honored exactly as specified -- it is simply reserved for db:migrate:recover's own use, which is the only call site the plan's Task 2 action text actually names it for. This reconciles both constraints rather than picking one over the other; markMarkerFailed (a second, similarly unlisted helper) does the same for the failure path, for the identical reason."
  - "The unwrapped branch's failure path UPDATEs the SAME marker row to state 'failed' rather than inserting a second row (as the wrapped branch's recordRunEntry does) -- required by the plan's own must_haves truth ('its run entry carries the failing statement index and the error's own message', singular 'entry') and confirmed against tests/history/timeouts-and-concurrently.test.ts's (04-04) own ORDER BY id DESC LIMIT 1 query pattern, which only makes sense if there is exactly one row per migration."
  - "Case A's fixture inserts two steps rows sharing one recipe_id at DIFFERENT positions (0 and 1) -- steps already carries a committed UNIQUE(recipe_id, position) constraint from 01-CONTEXT.md D-09, so same-position rows would have failed at INSERT time, before the test's own CREATE UNIQUE INDEX CONCURRENTLY ever ran."
  - "Added an explicit real-database test for must_haves truth 6 ('a wrapped migration that fails is self-cleaning... does not block the next run') ahead of Case A, since no existing test in this phase asserted it directly -- 04-04's own Case B/C sequence in tests/history/timeouts-and-concurrently.test.ts implicitly proves the same property (a wrapped lock-timeout failure followed by a successful CONCURRENTLY migration), but this plan's own must-have earns a direct, first-class proof rather than resting on an implicit sequence in a sibling file."

patterns-established:
  - "A must_haves truth with a 'backstop' verification tag (this plan's #7, concurrent-invocation safety) is recorded as accepted risk in the threat register, not built or tested -- the development database is single-operator and disposable, and the runner explicitly makes no attempt to serialize concurrent invocations this phase."

requirements-completed: [RUN-08]

coverage:
  - id: D1
    description: "Before an unwrapped statement executes, the runner writes an in-flight marker naming the migration and statement index; the SAME row transitions to applied only once the ledger row has landed, or to failed (left unresolved) if the statement throws -- never a second row for either outcome"
    requirement: RUN-08
    verification:
      - kind: unit
        ref: "packages/automation/test/run-migrations.test.ts#runMigrations partial-failure marker lifecycle (D-18/D-20/RUN-08) > unwrapped branch issues, in order, the marker insert, the single statement, the ledger insert, and the marker resolve -- with no BEGIN anywhere in it"
        status: pass
      - kind: integration
        ref: "tests/history/partial-failure-recovery.test.ts#Case A: a genuine mid-migration failure leaves a failed, unresolved marker and an INVALID index -- no ledger row"
        status: pass
    human_judgment: false
  - id: D2
    description: "A run that finds an unresolved marker refuses the WHOLE run before classifying anything, applies nothing, exits RUNNER_EXIT_CODES.REFUSED_STALE_MARKER, and names the migration tag and statement index -- proven from two independently created marker causes (a genuine execution failure, and a hand-inserted in_flight row simulating a crash)"
    requirement: RUN-08
    verification:
      - kind: unit
        ref: "packages/automation/test/run-migrations.test.ts#refuses the whole run before classifying anything when the table already holds an unresolved marker, naming the migration tag and the recovery command, with no BEGIN, no statement, and no ledger insert reaching the client"
        status: pass
      - kind: integration
        ref: "tests/history/partial-failure-recovery.test.ts#Case B: the next run refuses -- REFUSED_STALE_MARKER, naming the migration tag and statement index, applying nothing"
        status: pass
      - kind: integration
        ref: "tests/history/partial-failure-recovery.test.ts#Case C: a hand-inserted crash marker also refuses, independently of Case A's cause"
        status: pass
    human_judgment: false
  - id: D3
    description: "pnpm db:migrate:recover reports the exact state (migration tag, journal idx, statement index of statement count, wrapped, verdict, error message, started at) for every unresolved marker and every INVALID index found, states unmissably that nothing was repaired, then resolves every marker -- never editing the migration journal, never dropping anything, accepting no target"
    requirement: RUN-08
    verification:
      - kind: unit
        ref: "tests/db-migrate-recover.test.ts#reportAndResolveMarkers prints both migration tags, their statement indexes, and the INVALID index, states nothing was repaired, resolves both markers, and issues no DELETE or DROP"
        status: pass
      - kind: integration
        ref: "tests/db-migrate-recover.test.ts#pnpm run db:migrate:recover exits 0 and reports no unresolved marker against the real, marker-free development database, leaking no credential and mutating no journal"
        status: pass
      - kind: integration
        ref: "tests/history/partial-failure-recovery.test.ts#Case D: recovery reports and resolves, and repairs nothing -- the INVALID index survives"
        status: pass
      - kind: unit
        ref: "tests/guardrails.test.ts#scripts/db-migrate-recover.ts never touches _journal.json, never issues DROP INDEX, and never forces process.exit (D-20/D-21)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A wrapped migration that fails is self-cleaning -- its statements and ledger row roll back together, leaving no marker, and the very next run is not blocked by it"
    requirement: RUN-08
    verification:
      - kind: integration
        ref: "tests/history/partial-failure-recovery.test.ts#must-have truth 6: a wrapped failure is self-cleaning -- it leaves no marker and does not block the next run"
        status: pass
    human_judgment: false
  - id: D5
    description: "Recovery repairs nothing on its own initiative -- after recovery, the operator's own action (dropping the INVALID index) is what lets a fresh migration apply normally"
    requirement: RUN-08
    verification:
      - kind: integration
        ref: "tests/history/partial-failure-recovery.test.ts#Case E: after recovery, dropping the INVALID index (the operator's own action) and running again applies a fresh migration normally"
        status: pass
    human_judgment: false

# Metrics
duration: 55min
completed: 2026-09-08
status: complete
---

# Phase 4 Plan 5: Partial-Failure Marker Lifecycle and Recovery Summary

**An in-flight marker now brackets every unwrapped statement (D-18), a stale marker refuses the whole next run (D-20), and `pnpm db:migrate:recover` reports and clears it without ever touching the migration journal or repairing the schema (D-21) -- proven end to end against a real database with a genuine `CREATE UNIQUE INDEX CONCURRENTLY` failure from real duplicate data.**

## Performance

- **Duration:** 55 min (04-04 completed 2026-09-08T17:55:23-04:00 approx. -> this SUMMARY)
- **Started:** 2026-09-08T21:57:02Z (approx., per STATE.md's own prior session timestamp)
- **Completed:** 2026-09-08 (see commit timestamps)
- **Tasks:** 3 (all `type="auto"`, Task 1 `tdd="true"`, no checkpoints)
- **Files modified:** 11 (4 created, 7 modified)

## Accomplishments

- `packages/automation/src/runner/runner-table.ts`: the complete in-flight-marker lifecycle -- `writeInFlightMarker` (inserts the row before the unwrapped statement runs), `markMarkerApplied`/`markMarkerFailed` (transition the SAME row on the ordinary success/failure paths), `resolveMarker` (the recovery command's own outcome, reserved for a marker a PRIOR run left behind), `readUnresolvedMarkers` (`state = 'in_flight' OR (state = 'failed' AND wrapped = false)`, with the wrapped-failure exclusion proven directly against a real database), `readInvalidIndexes` (`pg_index.indisvalid = false`, joined for readable names), and `UnresolvedMarkerError`. Contains no `DELETE` anywhere.
- `run-migrations.ts`: `runMigrations` calls `readUnresolvedMarkers` before anything is enumerated or classified, refusing the whole run (`RUNNER_EXIT_CODES.REFUSED_STALE_MARKER`) with no parameter, flag, or environment read able to bypass it. The unwrapped branch now brackets its single statement with `writeInFlightMarker` before and `markMarkerApplied`/`markMarkerFailed` after, in place -- proven on the exact recorded call sequence, never merely inferred.
- `scripts/db-migrate-recover.ts`: D-21's report-and-clear command. `reportAndResolveMarkers(client)` is exported and callable from a test with no CLI involved; the CLI entry is guarded by `import.meta.main`. Never reads `process.argv`/`process.stdin`, never references the migration journal or issues a `DROP INDEX`, never forces a synchronous process exit.
- `tests/history/partial-failure-recovery.test.ts`: criterion 4, six cases against a single real `postgres:17` container -- a wrapped failure's self-cleaning property (must-have truth 6), a genuine `CREATE UNIQUE INDEX CONCURRENTLY` failure from two `steps` rows sharing one `recipe_id` (Case A), the next run refusing (Case B), an independently hand-inserted crash marker also refusing (Case C), recovery reporting and resolving while repairing nothing (Case D), and the operator's own index drop letting a fresh migration apply normally (Case E).
- `pnpm test` (44 files, 436 tests) and `pnpm test:history` (5 files, 13 tests) both green; `docs/migration-history-status.json` carries a fresh recorded `PASS`.

## Task Commits

Each task was committed atomically:

1. **Task 1: The in-flight marker, the failure record, and the refusal that will not step past an unknown state** - `0e77813` (feat)
2. **Task 2: `pnpm db:migrate:recover` -- it reports, the operator decides** - `86fe902` (feat)
3. **Task 3: The whole partial-failure cycle, proven against a real database** - `887549b` (test), `cdeef8e` (test, must-have truth 6 addendum)

**Plan metadata:** committed alongside this SUMMARY (see below).

## Files Created/Modified

- `packages/automation/src/runner/runner-table.ts` - the in-flight-marker lifecycle
- `packages/automation/src/runner/run-migrations.ts` - up-front stale-marker refusal; unwrapped-branch marker bracketing
- `packages/automation/src/index.ts` - barrel exports for the new marker/recovery surface
- `packages/automation/test/run-migrations.test.ts` - D-18/D-20 call-sequence and refusal proofs
- `packages/automation/test/runner-table.test.ts` - unit coverage for every new runner-table.ts function
- `scripts/db-migrate-recover.ts` - `pnpm db:migrate:recover`
- `tests/db-migrate-recover.test.ts` - real-database no-op case, fake-client report/resolve case
- `tests/guardrails.test.ts` - widened command-script list; new D-20/D-21 structural assertion
- `tests/history/partial-failure-recovery.test.ts` - criterion 4, six cases against a real database
- `package.json` - `db:migrate:recover` script
- `docs/migration-history-status.json` - fresh recorded PASS

## Decisions Made

- `resolveMarker` (state -> `resolved`) is reserved exclusively for `db:migrate:recover`'s own outcome; the ordinary `run-migrations.ts` success/failure paths use two new, otherwise-unlisted helpers (`markMarkerApplied`/`markMarkerFailed`) instead, so a normal successful unwrapped migration still ends up `applied` -- required by `tests/history/empty-db-full-history.test.ts` (04-03, unmodified), which asserts every row for a clean run's `run_id` is `applied`.
- A failed unwrapped statement UPDATEs the same marker row to `failed` rather than inserting a second row, keeping the one-row-per-migration invariant intact and matching how `tests/history/timeouts-and-concurrently.test.ts` (04-04, unmodified) queries the table (`ORDER BY id DESC LIMIT 1`).
- Added a direct, real-database proof of must-have truth 6 (a wrapped failure is self-cleaning and does not block the next run) as its own case, ahead of Case A, rather than resting on the implicit proof already present in 04-04's own Case B/C sequence.
- Case A's fixture uses two `steps` rows at different `position` values (0 and 1) sharing one `recipe_id`, respecting the pre-existing `UNIQUE(recipe_id, position)` constraint while still making the new `CREATE UNIQUE INDEX CONCURRENTLY ... (recipe_id)` genuinely fail.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `packages/automation/test/run-migrations.test.ts`'s pre-existing exact-equality assertion updated for the new up-front unresolved-marker check**
- **Found during:** Task 1
- **Issue:** The pre-existing "refuses unparseable SQL" test asserted `client.calls` equals exactly one entry (the ledger read). Adding the up-front `readUnresolvedMarkers` call (required by this task's own behavior) makes that assertion false by construction -- there are now two legitimate calls before classification begins.
- **Fix:** Updated the exact-equality array to include the new `SELECT ... FROM runner.migration_runs WHERE state = 'in_flight' ...` call as the first entry, ahead of the pre-existing ledger read.
- **Files modified:** `packages/automation/test/run-migrations.test.ts`
- **Verification:** `pnpm exec vitest run packages/automation/test/run-migrations.test.ts` green.
- **Committed in:** `0e77813` (Task 1 commit)

**2. [Rule 1 - Bug] `packages/automation/test/runner-table.test.ts`'s "no DELETE" check narrowed to `DELETE FROM`**
- **Found during:** Task 1
- **Issue:** A literal `not.toContain("DELETE")` check against the whole file matched this module's own prose comments describing the constraint ("never `DELETE`s"), producing a false failure against documentation, not code.
- **Fix:** Narrowed the needle to `DELETE FROM` (assembled at runtime, matching this codebase's established needle-building idiom), which still catches any real SQL `DELETE` statement while leaving explanatory prose untouched.
- **Files modified:** `packages/automation/test/runner-table.test.ts`
- **Verification:** `pnpm exec vitest run packages/automation/test/runner-table.test.ts` green.
- **Committed in:** `0e77813` (Task 1 commit)

**3. [Rule 1 - Bug] `scripts/db-migrate-recover.ts`'s header comment reworded to avoid the literal substrings its own guardrail test forbids**
- **Found during:** Task 2
- **Issue:** The module's own explanatory header comment named `_journal.json`, `process.argv`, `process.stdin`, and `process.exit()` literally, which is exactly what the plan's own acceptance criteria ("contains no occurrence of ... `_journal.json`, or `DROP INDEX`") forbids anywhere in the file, comments included.
- **Fix:** Reworded every mention to describe the same constraint without the literal substrings (e.g. "the committed Drizzle migration journal" instead of the filename; "a command-line argument or standard input" instead of the property names).
- **Files modified:** `scripts/db-migrate-recover.ts`
- **Verification:** `grep -n "process.argv\|process.stdin\|process.exit(\|_journal.json\|DROP INDEX" scripts/db-migrate-recover.ts` returns nothing; `pnpm exec vitest run tests/guardrails.test.ts` green.
- **Committed in:** `86fe902` (Task 2 commit)

**4. [Rule 1 - Bug] `tests/db-migrate-recover.test.ts` read spy output after `mockRestore()` instead of before**
- **Found during:** Task 2
- **Issue:** `vi.spyOn(...).mockRestore()` also clears `.mock.calls` (it performs everything `mockClear()` does, per vitest's own documented semantics) -- reading `logSpy.mock.calls` after calling `mockRestore()` silently returned an empty array, making two new tests fail with `expected '' to contain ...`.
- **Fix:** Captured the joined output string inside the `try` block, immediately after `await reportAndResolveMarkers(...)`, before `finally`'s `mockRestore()` call runs.
- **Files modified:** `tests/db-migrate-recover.test.ts`
- **Verification:** Reproduced live (a debug script outside vitest confirmed the function itself printed correctly; the bug was purely in the test's own spy-reading order), then fixed and re-run green.
- **Committed in:** `86fe902` (Task 2 commit)

---

**Total deviations:** 4 auto-fixed (all Rule 1 -- test/documentation corrections required by this task's own new, correctly-specified behavior; no scope creep, no production-code behavior changed by any of them).
**Impact on plan:** All four were necessary to make the plan's own specified behavior pass against pre-existing tests and this plan's own new tests honestly. None weaken any acceptance criterion; #3 strengthens compliance with the plan's own literal wording.

## Issues Encountered

None beyond the deviations above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- RUN-08 is complete: the only residual partial state D-11's mixed-file refusal leaves possible (a failed `CREATE INDEX CONCURRENTLY`-family statement leaving an `INVALID` index) is named, reported, and blocking until a human runs `pnpm db:migrate:recover` -- proven end to end against a real database, including the two negative controls that make the positive proof mean something (the marker survives an attempted second run; the `INVALID` index survives recovery).
- Phase 7's production runner inherits a recovery command that already exists (`db:migrate:recover`) rather than starting from zero on the one thing it will need under pressure, and the runner-owned table's `in_flight`/`resolved` states are now part of the substrate Phase 7's audit log extends.
- `pnpm test` (44 files, 436 tests) and `pnpm test:history` (5 files, 13 tests) both green; `pnpm exec tsc --noEmit -p packages/automation/tsconfig.json` clean; `git status --porcelain apps/recipe-app/drizzle` empty throughout.
- No blockers for the next plan in this phase.

## Self-Check: PASSED

- All 4 files listed in `key-files.created` verified present on disk via `[ -f ]`.
- Commits `0e77813` (Task 1), `86fe902` (Task 2), `887549b` and `cdeef8e` (Task 3) all found via `git log --oneline --all`.
- `pnpm test` (44 files, 436 tests) green; `pnpm test:history` (5 files, 13 tests) green with a fresh recorded PASS; `pnpm exec tsc --noEmit -p packages/automation/tsconfig.json` clean.
- Plan-level `<verification>` block re-confirmed: `pnpm test` is green including `tests/db-migrate-recover.test.ts` and the extended guardrail suite; `pnpm test:history` is green with a fresh PASS; `pnpm db:migrate:recover` against the marker-free development database exits 0 and says so; `git status --porcelain apps/recipe-app/drizzle` is empty.

---
*Phase: 04-migration-runner-history-tests*
*Completed: 2026-09-08*
