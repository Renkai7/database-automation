---
phase: 05-ci-pipeline-gate
plan: 07
subsystem: testing
tags: [guardrails, vitest, tdd, structural-enforcement, ci, github-actions]

requires:
  - phase: 05-ci-pipeline-gate (05-05, 05-06)
    provides: the committed ruleset payload and its six required-check contexts (05-05), and the
      pr-gate.yml workflow whose six job names those contexts must match verbatim (05-06)
provides:
  - "D-15/CI-06 boot-time migration ban: no file under apps/recipe-app/src/, next.config.ts, or
    an instrumentation*.ts startup hook may reference the migration entry point, the runner's
    exported symbols, or the schema-sync sub-command"
  - "D-11 first half: loadRules (the real, imported function) refuses a synthetic rules file that
    weakens a floor operation below BLOCKED, or weakens the unmatched-statement default below
    REVIEW REQUIRED, driven entirely from in-memory values"
  - "D-11 second half: exact set equality, in both directions, between
    .github/rulesets/main-protection.json's required-check contexts and every job name: in
    .github/workflows/pr-gate.yml, plus a no-duplicate-job-name assertion"
  - "sourceSurfaceFiles() now enumerates .github/, bringing the schema-sync ban, the
    migrate-sub-command ban and the direct-connection-variable-read ban over CI configuration"
  - "CI_WORKFLOW_FILES_WITH_EPHEMERAL_DSN (D25 shape): every connection string in pr-gate.yml and
    restore-drill.yml is parsed and constrained to the pinned dev host/port/database, imported
    from scripts/env.ts rather than re-typed"
  - "The D-06 no-target ban now covers every scripts/ci/*.ts module, derived via
    `git ls-files scripts/ci` rather than a hand-typed array"
affects: [05-08 (applies the ruleset this plan's set-equality test already proves agrees with the
  workflow), Phase 7 (any future scripts/ci addition or apps/recipe-app/src boot-path change
  inherits this coverage automatically)]

actuals:
  tokens: 5823
  tasks: 3
  commits: 4
  plan_head_before: b7280af

tech-stack:
  added: []
  patterns:
    - "Falsify the guardrail live, then delete the falsification -- proves a test fails when the
      forbidden change is actually made, not merely that the assertion text sounds right"
    - "A floor-safe synthetic rules-file baseline isolates which self-check
      (assertFloorNotWeakened vs assertUnmatchedDefaultsToReview) a given test proves, rather
      than incidentally tripping the other one first"
    - "D25 shape reused a third time: an allowlist that constrains (parses and checks every
      connection string against the pinned target) rather than merely exempting the listed file"
    - "Enumerate by prefix/git-ls-files rather than a hand-typed array, so a file added later is
      covered by default rather than exempt by default (applied to .github/, the CI script list,
      and the D-15 application-boot file list alike)"

key-files:
  created: []
  modified:
    - tests/guardrails.test.ts

key-decisions:
  - "restore-drill.yml added to CI_WORKFLOW_FILES_WITH_EPHEMERAL_DSN alongside pr-gate.yml, a
    deviation from the plan's literal action text (which names only pr-gate.yml) -- Rule 1: now
    that .github/ is in the source surface, restore-drill.yml's identical pinned-target
    connection string would otherwise be flagged as a false-positive offender by the
    connection-string-prefix test, and the plan's own must_haves truth is not scoped to one
    file."
  - "CI-01 and CI-06 are NOT ticked complete in REQUIREMENTS.md despite being this plan's own
    declared requirements -- both are also declared by plan 05-08, which has not yet produced a
    SUMMARY (confirmed via `requirements.ready-ids`, 0/2 ready). The shared-ID gate defers
    marking either complete until every declaring plan finishes."

patterns-established:
  - "Guardrail non-vacuity: every new source-surface or file-list assertion first proves its own
    enumerated input is non-empty before scanning anything, so a renamed directory or reverted
    line cannot make the check pass having examined nothing."

requirements-completed: []

coverage:
  - id: D1
    description: "D-15/CI-06: nothing in the application's own source (or Next.js startup-hook
      files) can trigger a migration at boot -- proven non-vacuous by a live falsification"
    requirement: "CI-06"
    verification:
      - kind: unit
        ref: "tests/guardrails.test.ts#no file in the application's own source (or its Next.js
          startup-hook files) triggers a migration at boot (D-15, CI-06)"
        status: pass
    human_judgment: false
  - id: D2
    description: "D-11 first half: loadRules refuses a synthetic rules file weakening either the
      D-02/D-07/D-17 floor or the D-06 unmatched-statement default"
    requirement: "CI-01"
    verification:
      - kind: unit
        ref: "tests/guardrails.test.ts#loadRules refuses a synthetic rules file that weakens a
          floor operation below BLOCKED (D-11, first half)"
        status: pass
      - kind: unit
        ref: "tests/guardrails.test.ts#loadRules refuses a synthetic rules file whose
          unmatched-statement default is weaker than REVIEW REQUIRED (D-11, first half)"
        status: pass
    human_judgment: false
  - id: D3
    description: "D-11 second half: the ruleset's required-check contexts and pr-gate.yml's job
      names are exactly the same set, with no duplicate job name"
    requirement: "CI-01"
    verification:
      - kind: unit
        ref: "tests/guardrails.test.ts#the ruleset's required-check contexts and pr-gate.yml's
          job names are exactly the same set, with no duplicate job name (D-11, second half)"
        status: pass
    human_judgment: true
    rationale: "This test proves the two sides of the contract this repository owns agree. It
      cannot prove GitHub's own behaviour that a never-reporting required check blocks a merge --
      that is a claim about GitHub's servers, observed live in plan 05-08, not assertable from
      inside this repository."
  - id: D4
    description: "CI configuration (.github/) is inside the same source surface as scripts/,
      tests/, packages/ and the application, with its one legitimate connection string
      constrained (not merely exempted) to the pinned development target"
    requirement: "CI-01"
    verification:
      - kind: unit
        ref: "tests/guardrails.test.ts#sourceSurfaceFiles() actually enumerates packages/ (and
          the other claimed roots)... (widened to include .github/)"
        status: pass
      - kind: unit
        ref: "tests/guardrails.test.ts#every connection string in a listed CI workflow file
          targets the pinned development host, port and database (D25 shape, 05-07-PLAN.md
          Task 3)"
        status: pass
    human_judgment: false

duration: 17min
completed: 2026-09-09
status: complete
---

# Phase 5 Plan 7: Guardrail Suite Extension Summary

**Three properties this phase relied on -- no boot-time migration path, a rules-floor that
refuses to load when weakened, and provably-agreeing ruleset/workflow contract names -- are now
things `tests/guardrails.test.ts` fails on, with `.github/` folded into the same source surface
as the rest of the repository.**

## Performance

- **Duration:** ~17 min
- **Started:** 2026-09-09T17:36:19Z (STATE.md's last recorded position at plan start)
- **Completed:** 2026-09-09T17:53:22Z
- **Tasks:** 3
- **Files modified:** 1 (`tests/guardrails.test.ts`)

## Accomplishments

- **D-15/CI-06:** a new guardrail enumerates every tracked file under `apps/recipe-app/src/`,
  `apps/recipe-app/next.config.ts`, and any `apps/recipe-app/instrumentation*.ts`, asserts that
  list is non-empty, and bans references to the migration script name (`db:migrate`), the
  runner's exported symbols (`runMigrations`, `ensureDrizzleLedger`, `enumerateMigrationFiles`),
  and the schema-sync sub-command (`drizzle-kit push`), unconditionally. Proven non-vacuous by a
  real falsification: a scratch file under `apps/recipe-app/src/` importing `runMigrations` made
  the test fail with the file name and offending symbol named in the message; the scratch file
  was deleted and never committed.
- **D-11, first half:** two tests drive the real `loadRules` (imported from `packages/automation`,
  never re-implemented) against in-memory-only synthetic rules files -- one weakens a floor
  operation (`DropTable`) below `BLOCKED`, one weakens the unmatched-statement default
  (`Unrecognized`) below `REVIEW_REQUIRED` -- and assert both throw `RulesFileError` naming the
  offending value. A floor-safe synthetic baseline (nine rules covering D-02/D-07/D-17) is shared
  between both tests so each isolates the specific self-check it proves.
- **D-11, second half:** a new test extracts the six required-status-check contexts from
  `.github/rulesets/main-protection.json` and every job `name:` from
  `.github/workflows/pr-gate.yml` (matched at exactly 4-space indentation, distinguishing
  job-level names from the 0-indent workflow name and the 6-space, dash-prefixed step names) and
  asserts exact set equality in both directions, plus no duplicate job name. Records honestly
  that GitHub's own never-reporting-check-blocks-merge behaviour is observed live in plan 05-08,
  not proven here.
- **Widened source surface:** `sourceSurfaceFiles()` now enumerates `.github/`, and the
  non-vacuity test's claimed-roots list was extended to include it -- genuinely RED before the
  change (0 files enumerated), GREEN after.
- **`CI_WORKFLOW_FILES_WITH_EPHEMERAL_DSN`** (D25 shape): lists `pr-gate.yml` and
  `restore-drill.yml`, excluded from the plain connection-string-prefix ban but constrained
  instead -- a new test parses every connection string each file carries and asserts host, port,
  and database name all match the pinned constants imported from `scripts/env.ts`.
- **Extended no-target coverage:** the D-06 test's `commandScripts` list now also includes every
  `scripts/ci/*.ts` module, derived via `git ls-files scripts/ci` rather than hand-typed.

## Task Commits

Each behavior was committed following this phase's established RED/GREEN idiom where a genuine
RED existed, and as a single `test(05-07):` commit where the property already held (guardrail
tests proving already-correct prior-phase code, matching 05-05's own documented precedent):

1. **Task 1: D-15 boot-time migration ban** -- `6f5dc61` (test; passed immediately, falsified live)
2. **Task 2: D-11 both halves** -- `8ccd480` (test; both halves passed immediately against
   already-correct floor.ts/ruleset/workflow code)
3. **Task 3: widen the source surface** -- `3c9aef1` (test, RED) / `500c706` (feat, GREEN)

**Plan metadata:** committed alongside this SUMMARY.

## Files Created/Modified

- `tests/guardrails.test.ts` -- five new guardrail tests, one widened non-vacuity assertion, one
  widened no-target script list, one new constant (`CI_WORKFLOW_FILES_WITH_EPHEMERAL_DSN`), and
  `sourceSurfaceFiles()` extended to cover `.github/`.

## Decisions Made

- **`restore-drill.yml` added to `CI_WORKFLOW_FILES_WITH_EPHEMERAL_DSN`**, a deviation from the
  plan's literal action text ("exactly `.github/workflows/pr-gate.yml`") -- see Deviations below.
- Job-name extraction uses a 4-space-exact-indent regex rather than a YAML parser (no YAML
  dependency exists in this workspace) -- verified against the real file's exact whitespace
  before writing the pattern, and distinguishes job-level `name:` from both the workflow-level
  `name: PR Gate` (0-indent) and every step-level `- name: ...` (6-space, dash-prefixed).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `restore-drill.yml` added to `CI_WORKFLOW_FILES_WITH_EPHEMERAL_DSN`**
- **Found during:** Task 3
- **Issue:** The plan's action text names only `.github/workflows/pr-gate.yml` for the
  ephemeral-DSN allowlist. `restore-drill.yml` (built in plan 05-06) legitimately carries the
  identical pinned-target connection string (`postgres://recipe_app:...@127.0.0.1:5432/recipe_dev`)
  for the same throwaway-per-job-credential reason (T-05-38). Now that `.github/` is inside the
  source surface, leaving it off the allowlist would make the existing connection-string-prefix
  test (D-19/WR-01) flag it as a false-positive offender -- a real test regression, not a
  hypothetical one.
- **Fix:** Added `.github/workflows/restore-drill.yml` to `CI_WORKFLOW_FILES_WITH_EPHEMERAL_DSN`
  alongside `pr-gate.yml`. It is not merely exempted: the new constrained-connection-string test
  parses and checks its connection string against the same pinned host/port/database components.
- **Files modified:** `tests/guardrails.test.ts`
- **Verification:** `pnpm exec vitest run tests/guardrails.test.ts` -- 21/21 pass, including both
  the connection-string-prefix test (no offenders) and the new constrained-connection-string
  test (both files' connection strings verified against the pin).
- **Committed in:** `500c706` (Task 3 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 Rule 1 bug fix).
**Impact on plan:** Necessary for correctness -- the plan's own `must_haves` truth ("any
PostgreSQL connection string appearing in a CI workflow file...") is not scoped to one file, and
the fix keeps that truth mechanically enforced rather than accidentally regressed by the same
plan that widened the scan to find it. No scope creep beyond the one additional allowlist entry.

## TDD Gate Compliance

- **Task 1** (`tdd="true"`): single `test(05-07):` commit (`6f5dc61`). The property (application
  source never references the runner) already held in the codebase -- writing the test made it
  pass immediately, matching 05-05-SUMMARY.md's own documented precedent ("since the
  implementation was already correct when the tests were written, all 17 passed on first run
  rather than failing red first"). RED was instead proven by live falsification: a scratch file
  under `apps/recipe-app/src/` referencing `runMigrations` made the test fail with the expected
  named-file/named-symbol message (recorded below), then was deleted and never committed.
- **Task 2** (`tdd="true"`): single `test(05-07):` commit (`8ccd480`). Both halves (the rules-floor
  refusal, the ruleset/workflow set equality) are guardrail proofs of already-correct Phase
  3/4/05-05/05-06 code -- both passed on first run, same documented pattern as Task 1.
- **Task 3** (`tdd="true"`): genuine RED->GREEN. `3c9aef1` (test, RED) widened the non-vacuity
  test's claimed-roots list to `.github/` before `sourceSurfaceFiles()` covered it -- confirmed
  failing on exactly the intended assertion (`expected 0 to be greater than 0`), no
  import/crash/collection error. `500c706` (feat, GREEN) implemented the widening plus the
  dependent constant/test/derivation, and the suite passed (21/21).
- `pnpm test` after every task: 532 (Task 1) -> 535 (Task 2) -> 536 (Task 3) -- was 531 at plan
  start, no regressions.

### Falsification record (Task 1's acceptance criteria)

A scratch file `apps/recipe-app/src/scratch-falsification.ts` was temporarily added, importing
`runMigrations` from `packages/automation`:

```ts
import { runMigrations } from "../../../packages/automation/src/index";
export function boot() {
  return runMigrations;
}
```

Running `pnpm exec vitest run tests/guardrails.test.ts -t "no file in the application"` produced:

```
AssertionError: D-15/CI-06: "apps/recipe-app/src/scratch-falsification.ts" must not reference
"runMigrations" -- migrations reach the database only through the pipeline-invoked runner
(scripts/db-migrate.ts), never through the application's own startup path.: expected
'import { runMigrations } from "../../…' not to contain 'runMigrations'
```

The scratch file was deleted immediately after (`git rm --cached -f` to also clear the
intent-to-add index entry from an earlier `git add -N`), and the suite re-confirmed green
(17/17 at that point in the sequence) before the task's commit was made.

## Issues Encountered

None beyond the deviation documented above.

## User Setup Required

None -- no external service configuration required. This plan touches no live GitHub API state
and opens no database connection (`scripts/env.ts`'s pin assertion runs at import time only,
against the same local `.env` every other test file in this suite already uses).

## Next Phase Readiness

- Plan 05-08 can apply `.github/rulesets/main-protection.json` to the live repository with this
  plan's set-equality test already having proven, mechanically, that its six required-check
  contexts match `pr-gate.yml`'s six job names exactly -- the one property that test can prove
  from inside this repository, ahead of 05-08's live observation of GitHub's own enforcement
  behaviour.
- CI-01 and CI-06 remain untracked in `REQUIREMENTS.md` (see Decisions Made) until plan 05-08
  also produces a SUMMARY -- the shared-ID gate, not an oversight.
- A future `scripts/ci/*.ts` addition, a future `apps/recipe-app/src` file, or a future
  `.github/workflows/*.yml` file all inherit this plan's coverage automatically (enumerated by
  `git ls-files`/prefix, never a hand-typed allowlist), so no future plan needs to remember to
  extend these three guardrails.

## Self-Check: PASSED

- `tests/guardrails.test.ts` confirmed present and modified on disk (only file this plan touches).
- All 4 task commit hashes confirmed present in `git log --oneline`:
  `6f5dc61`, `8ccd480`, `3c9aef1`, `500c706`.
- Every `<acceptance_criteria>` re-checked: D-15 test present and non-vacuous (falsified live);
  both D-11 loadRules tests throw `RulesFileError` naming the offending value, driven from
  in-memory-only synthetic rules; the set-equality test asserts non-empty extraction before
  comparing and checks no-duplicate job names; `.github/` non-vacuity added;
  `CI_WORKFLOW_FILES_WITH_EPHEMERAL_DSN` non-empty with every listed path confirmed present via
  `git ls-files`; the constrained-connection-string test checks all three pinned components
  imported from `scripts/env.ts`; the no-target script list is derived from
  `git ls-files scripts/ci`, asserted non-empty.
- Plan-level `<verification>` re-run: `pnpm exec vitest run tests/guardrails.test.ts` -- 21/21
  pass. `pnpm test` -- 536/536 (was 531/531 baseline + 5 new). `pnpm exec tsx
  scripts/ci/check-schema-drift.ts` -- exit 0, no drift. `git status --porcelain` -- clean (no
  scratch file, no unexpected changes beyond `tests/guardrails.test.ts`).

---
*Phase: 05-ci-pipeline-gate*
*Completed: 2026-09-09*
