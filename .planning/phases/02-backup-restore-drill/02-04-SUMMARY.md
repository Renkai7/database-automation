---
phase: 02-backup-restore-drill
plan: 04
subsystem: database
tags: [postgres, vitest, zod, backup, restore-drill, staleness-gate, testcontainers]

# Dependency graph
requires:
  - phase: 02-backup-restore-drill
    provides: "02-01: scripts/backup.ts (runBackup), scripts/drill.ts (runDrill, DrillTierResults); 02-02: all four assertion tiers wired into runDrill; 02-03: scripts/restore.ts (restoreIntoContainer)"
provides:
  - "scripts/drill-status.ts: DrillStatusSchema/DrillStatus, DEFAULT_DRILL_STATUS_PATH, MAX_DRILL_AGE_DAYS, readDrillStatus/recordAutomatedDrillResult/assertDrillStatusFresh -- the committed two-fact drill record and its D-19 staleness gate"
  - "docs/restore-drill-status.json: the committed, machine-readable drill record Phase 7's status view will read"
  - "scripts/drill.ts: three explicit D-20 outcomes wired into runDrill -- never-ran writes nothing, ran-and-failed records FAIL, passed records PASS, status write always after the container is stopped"
  - "scripts/restore.ts: restoreIntoContainer's optional onStepTiming hook for per-step (globals/data) restore duration"
  - "pnpm test: now hard-fails on a missing/FAIL/stale (>30d) automated drill record"
  - "pnpm test:drill (vitest.drill.config.ts, tests/drill/): the slow, Docker-dependent end-to-end proof that the drill reports through the record, structurally excluded from the default suite"
affects: [02-05]

# Actuals (#2632)
actuals:
  tokens: 8873
  tasks: 3
  commits: 3
  plan_head_before: 7a38f66

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "D-20's three-outcome boundary implemented as control flow, not a flag: the container-start step sits OUTSIDE any try/catch that could lead to a status write, so a drill that never ran (backup failed -- scripts/backup.ts's own runStep calls process.exit(1) directly -- or the container failed to start) structurally cannot touch docs/restore-drill-status.json. Only code reachable after the container has genuinely started can call recordAutomatedDrillResult."
    - "recordAutomatedDrillResult's only parameter is the automated outcome -- the human half is read from disk (or defaulted to its honest UNKNOWN starting state on a genuinely missing file) and carried through untouched, never accepted as an argument. This makes 'no code path can set the human fact' a property of the function's own signature, not a discipline someone has to remember."
    - "Status write ordering: the container is always stopped in a finally block BEFORE either the FAIL or PASS recordAutomatedDrillResult call runs (both live after the try/finally, gated on a captured drillError), so a status-write failure can never leave a disposable container running."
    - "Suite split is structural, not conventional: vitest.config.ts's exclude and vitest.drill.config.ts's include are exact mirror-image globs on tests/drill/, so a fast test placed outside that directory can't be silently excluded, and a slow test placed inside it can't silently join the default suite."

key-files:
  created:
    - scripts/drill-status.ts
    - docs/restore-drill-status.json
    - tests/drill-status.test.ts
    - tests/drill/restore-drill.test.ts
    - vitest.drill.config.ts
  modified:
    - scripts/drill.ts
    - scripts/restore.ts
    - vitest.config.ts
    - package.json

key-decisions:
  - "recordAutomatedDrillResult tolerates a missing status file ONLY on the very first ever pnpm db:drill run (before docs/restore-drill-status.json has ever been committed), defaulting the human half to its honest UNKNOWN starting state -- a file that EXISTS but fails schema validation is never silently replaced, since that would defeat readDrillStatus's own strict-parse guarantee. The distinction is made with a direct fs.access existence check, not by pattern-matching the caught error's message."
  - "[Rule 3 deviation, not in this plan's own files_modified] Added an optional onStepTiming callback to scripts/restore.ts's restoreIntoContainer options. The plan's own required durationMs schema names globalsRestore and dataRestore as separate fields, but the existing shared restore function performed both steps as one call with no timing seam. The callback is optional and source-compatible with every existing call site (only scripts/drill.ts uses it) -- chosen over duplicating the restore logic inline in drill.ts, which would have forked a security-relevant restore path (ON_ERROR_STOP=1 / --clean --if-exists pairing) into two copies."
  - "Task 1's committed docs/restore-drill-status.json required no manual hand-edit of the human object after all: recordAutomatedDrillResult's own bootstrap default for a missing file already IS the exact 'honest starting state' the plan describes (no last-performed date, UNKNOWN outcome, no timings, the runbook path as reference) -- a real pnpm db:drill run against a not-yet-existing file produces the committed shape directly."
  - "tests/drill/restore-drill.test.ts and tests/drill-status.test.ts both build every credential-shaped needle at runtime (postgres:// scheme prefix, SCRAM-SHA-256 verifier prefix) rather than as literals, following tests/target-pin.test.ts's/tests/guardrails.test.ts's established idiom -- this kept both new files off tests/guardrails.test.ts's fixture allowlists with no changes to that suite."

patterns-established:
  - "A committed status record's writer function accepts only the half of the record it is allowed to change; the untouched half is read from disk (or a fixed, honest default), never passed as an argument -- this is now the second precedent for 'no field a caller can control may leak into a value only a human should set' after 02-01's backup-manifest.ts no-credentials-by-type pattern, applied here to a different kind of prohibited value (a fact only a human may assert) rather than a secret."

requirements-completed: [BKP-07, BKP-08]

coverage:
  - id: D1
    description: "The committed drill status record (docs/restore-drill-status.json) is a two-fact JSON file -- automated and human, each with its own date/outcome -- and no code path can set the human fact. recordAutomatedDrillResult's signature has no parameter capable of naming or influencing it, and a run of pnpm db:drill leaves it byte-identical."
    requirement: BKP-08
    verification:
      - kind: e2e
        ref: "pnpm db:drill (live-verified 3 times this session, human object identical -- lastPerformedAt: null, outcome: UNKNOWN, timings: null -- across every run)"
        status: pass
      - kind: unit
        ref: "tests/drill-status.test.ts — 'never writes the human fact -- recordAutomatedDrillResult leaves it byte-identical (D-18/docs/decisions.md D7)'"
        status: pass
    human_judgment: false
  - id: D2
    description: "A drill that never ran (backup or container-start failure) writes nothing to the status record and exits non-zero -- no 'skipped' outcome exists anywhere in the schema or the writer. A drill that ran and failed records FAIL with the tiers/durations collected so far. pnpm test hard-fails on a missing record, a FAIL outcome, or a record older than 30 days (D-19/D-20), proven in all three failing directions plus the passing boundary case."
    requirement: BKP-08
    verification:
      - kind: unit
        ref: "tests/drill-status.test.ts (8/8 pass): missing-record, FAIL-outcome, stale (40d) vs. just-inside-threshold (29d), null lastRunAt, malformed schema, live gate against the real committed record"
        status: pass
      - kind: e2e
        ref: "pnpm test (81/81 passing, includes the staleness gate against the live record every run)"
        status: pass
    human_judgment: false
  - id: D3
    description: "pnpm db:drill (BKP-07) runs against a disposable, never-pre-seeded database and reports pass or fail through the re-read committed record, not the exit code alone. tests/drill/restore-drill.test.ts is the automated end-to-end proof: exit 0, no credential-shaped output, all four tiers true, every per-step duration > 0, human fact untouched, seeded dev database row counts unchanged. Structurally excluded from the default pnpm test suite via mirror-image vitest.config.ts/vitest.drill.config.ts globs."
    requirement: BKP-07
    verification:
      - kind: e2e
        ref: "pnpm test:drill (live-verified this session, 1/1 pass)"
        status: pass
      - kind: unit
        ref: "node -e suite-split-ok check (vitest.config.ts excludes tests/drill/**, vitest.drill.config.ts includes only it); pnpm test confirmed NOT to collect tests/drill/restore-drill.test.ts (verbose reporter output inspected directly)"
        status: pass
    human_judgment: false

duration: 55min
completed: 2026-09-07
status: complete
---

# Phase 2 Plan 4: Drill Status Record & Staleness Gate Summary

**`docs/restore-drill-status.json` is now a committed, two-fact record that only `pnpm db:drill`'s own code can half-write — a drill that never ran leaves it untouched, a drill that ran and failed records FAIL, and `pnpm test` hard-fails on a missing, failed, or 30-day-stale automated record, while the slow end-to-end drill proof lives in a structurally separate `pnpm test:drill` suite that cannot silently join the fast one.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 3 (Task 1: the status record + D-20 wiring; Task 2: the staleness gate; Task 3: suite split + end-to-end proof)
- **Files modified:** 9 (5 created, 4 modified)

## Accomplishments

- `docs/restore-drill-status.json` created by a real `pnpm db:drill` run (not hand-written) and live-verified 3 times this session: `automated.outcome` stays `PASS`, `automated.lastRunAt` is always fresh, all four tiers `true`, every `durationMs` field greater than zero, and `human` (`lastPerformedAt: null`, `outcome: "UNKNOWN"`, `timings: null`, `runbookRef: "docs/20-restore-runbook.md"`) is byte-identical across every run.
- D-20's three-outcome boundary implemented as control flow: the container-start step sits outside any try/catch that leads to a status write, so a backup or container-start failure structurally cannot touch the record — there is no "skipped" value anywhere in `scripts/drill-status.ts`'s schema or writer.
- `pnpm test` (81/81 passing) now includes `assertDrillStatusFresh`'s live gate against the real committed record on every run, plus 7 fixture-driven negative cases proving the missing/FAIL/stale/null/malformed failure directions and the just-inside-threshold pass — all Docker-free, so this cannot be quietly disabled to keep the suite fast.
- `pnpm test:drill` (new, `vitest.drill.config.ts`) is a structurally separate slow entry point: `vitest.config.ts`'s `exclude` and the drill config's `include` are exact mirror-image globs on `tests/drill/`, live-verified both ways — the default suite does not collect `tests/drill/restore-drill.test.ts`, and `pnpm test:drill` runs and passes it alone.
- `tests/drill/restore-drill.test.ts` is the automated, end-to-end proof of BKP-02/03/04/07: spawns a real `pnpm db:drill` child process, asserts exit 0 explicitly, asserts the combined output leaks neither the connection-string scheme prefix nor the SCRAM-SHA-256 role-password verifier prefix (both built at runtime), re-reads the status record rather than trusting the exit code, and asserts the local development database's seeded row counts are unchanged before/after.
- `pnpm test`: 81/81 passing (was 73/73 before this plan).

## Task Commits

Each task was committed atomically:

1. **Task 1: The committed two-fact drill record, written only by the half that owns it** — `8bdc9c4` (feat)
2. **Task 2: The cheap staleness gate that joins `pnpm test`, proven in all three failing directions** — `2c3eff9` (test)
3. **Task 3: Keep the slow drill test out of the fast suite by construction, and prove the drill leaks nothing** — `91644e9` (test)

## Files Created/Modified

- `scripts/drill-status.ts` (new) — `DrillStatusSchema`/`DrillStatus`, `DEFAULT_DRILL_STATUS_PATH`, `MAX_DRILL_AGE_DAYS`, `readDrillStatus`, `recordAutomatedDrillResult`, `assertDrillStatusFresh`
- `docs/restore-drill-status.json` (new) — committed two-fact record, created by a real drill run
- `scripts/drill.ts` — wires timing collection and the three D-20 outcomes into `runDrill`; container is always stopped (in a `finally`) before either status-write branch runs
- `scripts/restore.ts` — `restoreIntoContainer` gains an optional `onStepTiming` callback (Rule 3 deviation, see below)
- `tests/drill-status.test.ts` (new) — 8 cases proving `assertDrillStatusFresh` and `recordAutomatedDrillResult` in both directions
- `vitest.config.ts` — excludes `tests/drill/**` on top of vitest's own default exclude list
- `vitest.drill.config.ts` (new) — mirror-image `include` of exactly `tests/drill/`, same timeouts/pool/`fileParallelism` as the default config
- `tests/drill/restore-drill.test.ts` (new) — real-child-process end-to-end proof that the drill reports through the record and leaks nothing
- `package.json` — adds the `test:drill` script

## Decisions Made

- **`recordAutomatedDrillResult` tolerates a missing file only on the genuinely first-ever run**, defaulting the human half to its honest UNKNOWN starting state via an explicit `fs.access` existence check — a file that exists but fails schema validation is never silently replaced, preserving `readDrillStatus`'s strict-parse guarantee.
- **[Rule 3] Added an optional `onStepTiming` callback to `scripts/restore.ts`'s `restoreIntoContainer`** (file not in this plan's own `files_modified`). The plan's required `durationMs` schema names `globalsRestore` and `dataRestore` as separate fields, but the existing shared restore function performed both steps as one call with no timing seam. Chosen over duplicating the restore logic inline in `drill.ts`, which would have forked a security-relevant restore sequence (`ON_ERROR_STOP=1` / `--clean --if-exists` pairing) into two copies that could drift.
- **No manual hand-edit of the committed record's `human` object was needed.** `recordAutomatedDrillResult`'s own bootstrap default for a missing file already produces the exact "honest starting state" the plan describes, so running `pnpm db:drill` once against a not-yet-existing file created the correct committed shape directly.
- **Status write ordering**: both the FAIL and PASS `recordAutomatedDrillResult` calls in `scripts/drill.ts` live after the container-stop `finally` block (gated on a captured `drillError`), so a status-write failure can never leave a disposable container running.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `scripts/restore.ts` (outside this plan's `files_modified`) needed a per-step timing seam**
- **Found during:** Task 1, wiring `durationMs.globalsRestore`/`durationMs.dataRestore` into `scripts/drill.ts`.
- **Issue:** The plan's own required status schema names five separate `durationMs` fields including `globalsRestore` and `dataRestore`, but `restoreIntoContainer` (owned by plan 02-03, not in this plan's `files_modified`) performs both restore steps inside one function call with no way to observe their individual durations from the caller.
- **Fix:** Added an optional `onStepTiming?: (step, durationMs) => void` field to `RestoreIntoContainerOptions`, invoked once per restore step with its own elapsed time. Purely additive and optional — every existing call site (there is only `scripts/drill.ts`) is unaffected when it doesn't supply the callback.
- **Files modified:** `scripts/restore.ts`.
- **Verification:** `pnpm db:drill` live-verified 3 times; `docs/restore-drill-status.json`'s `durationMs.globalsRestore`/`durationMs.dataRestore` both recorded as distinct, non-zero values each run. `pnpm test` unaffected (81/81).
- **Committed in:** `8bdc9c4` (Task 1 commit).

---

**Total deviations:** 1 auto-fixed (Rule 3 — a blocking gap in a shared function outside this plan's own `files_modified` that this plan's own required schema shape exposed).
**Impact on plan:** No scope creep. The fix is narrowly scoped (one optional, additive field) and required for this plan's own `durationMs` schema to be genuinely populated rather than faked.

## Known Stubs

None. The status record, the staleness gate, and the end-to-end drill test are all production-quality, fully wired, and live-verified against the real Docker/Testcontainers pipeline — no placeholder outcomes, no hardcoded pass values, no unwired assertions.

## Issues Encountered

None beyond the pre-existing `.env`/`.env.example` sandbox-permission boundary already documented in `02-01-SUMMARY.md`/`02-02-SUMMARY.md`/`02-03-SUMMARY.md` and tracked in `.planning/WINDOWS.md` (entry 2, still open). This plan's live verification used the same inline-`RECIPE_BACKUP_DESTINATION` workaround established by prior plans in this phase; the residual gap (the variable is still not persisted in the developer's real `.env`) is unchanged, not newly introduced or newly resolved by this plan.

## User Setup Required

None new beyond what `02-01-SUMMARY.md` already documented (adding `RECIPE_BACKUP_DESTINATION` to the real, gitignored `.env`). No new environment variable or external service was introduced by this plan.

## Next Phase Readiness

- `docs/restore-drill-status.json`, `scripts/drill-status.ts`'s exports, and `pnpm test:drill` are all ready for plan 02-05 (the owner's manual destruction drill and the runbook) to build on — the runbook path (`docs/20-restore-runbook.md`) is already referenced as `human.runbookRef` in the committed record.
- BKP-07 and BKP-08 are now fully satisfied and marked complete in `.planning/REQUIREMENTS.md`. BKP-01, BKP-05, BKP-06 remain Pending, matching this phase's final plan (02-05).
- No blockers for 02-05 beyond the pre-existing `.env`/`.env.example` gap already tracked in `.planning/WINDOWS.md`. Plan 02-05 is the plan that will actually set `human.outcome` away from `UNKNOWN` — this plan deliberately left it untouched, per D-18/docs/decisions.md D7.

## Self-Check: PASSED

All created/modified files verified present on disk (`scripts/drill-status.ts`, `docs/restore-drill-status.json`,
`scripts/drill.ts`, `scripts/restore.ts`, `tests/drill-status.test.ts`, `vitest.config.ts`,
`vitest.drill.config.ts`, `tests/drill/restore-drill.test.ts`, `package.json`, this SUMMARY.md).
All three task commits (`8bdc9c4`, `2c3eff9`, `91644e9`) confirmed present in `git log --oneline --all`.
`pnpm test` green (81/81). `pnpm test:drill` green (1/1). `pnpm db:drill` re-run live this session,
`docs/restore-drill-status.json`'s `automated.outcome` PASS every run, `human` object byte-identical
every run.

---
*Phase: 02-backup-restore-drill*
*Completed: 2026-09-07*
