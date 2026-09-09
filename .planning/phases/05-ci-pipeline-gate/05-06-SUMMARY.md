---
phase: 05-ci-pipeline-gate
plan: 06
subsystem: ci
tags: [github-actions, postgres-service-container, docker-compose, restore-drill, ruleset]

requires:
  - phase: 05-ci-pipeline-gate (plans 03, 04, 05)
    provides: the proven `analyze` job and pure comment renderer (05-03); check-append-only.ts
      and check-schema-drift.ts (05-04); the committed main-protection.json ruleset payload,
      apply-ruleset.ts and check-ruleset-config.ts (05-05)
provides:
  - Five more jobs wired into `.github/workflows/pr-gate.yml`, joining `analyze`: tamper-checks,
    test, test-history, migrate, ruleset-config-check -- the exact six names committed in
    `.github/rulesets/main-protection.json`
  - A dedicated `migrate` job whose whole body is the real, unmodified `pnpm db:migrate` entry
    point against a database shaped to satisfy `assertLocalDevelopmentTarget`'s pin (CI-06's
    first clause; the boot-time guardrail is plan 05-07's job)
  - A scheduled `.github/workflows/restore-drill.yml` (weekly + workflow_dispatch), deliberately
    absent from the required-check list, with a real completed run
  - Live-observed evidence (a real closed pull request, #2) that all six checks register and
    report, plus three genuine cross-platform/architecture bugs found and fixed on the way
affects: [05-07, 05-08]

actuals:
  tokens: 5042
  tasks: 3
  commits: 10
plan_head_before: 4b840a5

tech-stack:
  added: []
  patterns:
    - "A job that runs `pnpm test` unmodified needs the SAME docker-compose-managed database
      lifecycle the suite already assumes locally (tests/migrate.test.ts's own `pnpm db:reset`
      shells out to `docker compose down -v && up -d --wait`) -- a GitHub Actions `services:`
      container is a second, incompatible database mechanism for any job that runs that suite,
      even though it works fine for a job that only runs `pnpm db:migrate` in isolation."
    - "`stdio: \"inherit\"` plus a POSIX child that execs a grandchild (`pnpm start` -> `next
      start` -> `next-server`) needs `detached: true` + `process.kill(-pid, \"SIGTERM\")` (whole
      process GROUP) to actually terminate -- `.kill()` on the direct child alone can leave a
      grandchild alive holding the parent's inherited stdout/stderr open, hanging the whole CI
      step indefinitely rather than merely leaking a process."
    - "A workflow `permissions:` block's key set is a real, live-enforced enum, not free-form
      text -- `gh workflow run` against a scratch `workflow_dispatch` trigger is the fastest way
      to get GitHub's own precise parse-error text (line/column) when a workflow silently fails
      its whole check-suite with zero jobs registered."

key-files:
  created:
    - .github/workflows/restore-drill.yml
  modified:
    - .github/workflows/pr-gate.yml
    - tests/smoke.test.ts
    - .planning/config.json

key-decisions:
  - "Set git.allow_default_branch_commits: true in .planning/config.json (Rule 3, blocking) --
    the #2924/#3819 protected-default-branch commit guard would otherwise refuse every commit
    this plan makes, but D-04 (05-CONTEXT.md) explicitly frames direct-to-main pushes and open
    pull requests as this phase's own intended, temporary state until 05-08 applies the live
    ruleset (0 rulesets confirmed on the repo throughout this plan)."
  - "`administration: write` is not a recognized workflow `permissions:` key at all (empirically
    confirmed live via `gh workflow run`: \"HTTP 422 ... Unexpected value 'administration'\"),
    contradicting 05-RESEARCH.md's assumption. `ruleset-config-check` now declares only
    `contents: read`; check-ruleset-config.ts's own `assertBypassListEmpty` already fails CLOSED
    on the resulting absent `bypass_actors`, which is the honest, correctly-predicted, and
    currently-observed outcome. This is a genuine unresolved finding for plan 05-08 (which first
    has a real ruleset to query), recorded in the workflow file itself and here rather than
    silently worked around."
  - "The `test` job provisions Postgres via `docker compose` (`pnpm db:up`), not a GitHub
    Actions `services:` container -- `pnpm test` includes `tests/migrate.test.ts`, which shells
    out to `pnpm run db:reset` (itself `docker compose down -v && up -d --wait`); a `services:`
    container held the same port and made that reset fail outright. `migrate` (which never runs
    `pnpm test`) keeps the `services:` container unchanged."
  - "tests/smoke.test.ts spawns its server with `detached: true` and, on non-Windows, kills the
    whole process GROUP (`process.kill(-pid, \"SIGTERM\")`) instead of the direct child alone --
    found live as a genuine CI hang (17+ minutes, cancelled), not a mere slowdown."

requirements-completed: []

coverage:
  - id: D1
    description: "Every pull request runs five more independent, named, non-conditional checks
      (tamper-checks, test, test-history, migrate, ruleset-config-check), joining `analyze` --
      the exact six names committed in main-protection.json's required_status_checks"
    requirement: CI-01
    verification:
      - kind: other
        ref: "Real PR Renkai7/database-automation#2, run 34383194765: analyze/tamper-checks/test/test-history/migrate all conclusion=success"
        status: pass
      - kind: other
        ref: "grep -v comments | grep -c 'name: <job>$' == 1 for each of the six job names"
        status: pass
    human_judgment: false
  - id: D2
    description: "The dedicated `migrate` job -- CI-06's first clause -- runs the real, unmodified
      `pnpm db:migrate` entry point in structural isolation from any job that builds or boots the
      application, against a database satisfying assertLocalDevelopmentTarget's pin with no
      loosening"
    requirement: CI-06
    verification:
      - kind: other
        ref: "Real PR run 34383194765, migrate job: conclusion=success, 29s; git diff --stat HEAD -- scripts/db-migrate.ts scripts/env.ts is empty"
        status: pass
    human_judgment: true
    rationale: "CI-06 also requires that nothing in the application's own source triggers a
      migration at boot -- plan 05-07's job, not asserted by anything in this plan. This
      deliverable proves only the first clause; a human/verifier should not read CI-06 as fully
      closed from this plan's evidence alone."
  - id: D3
    description: "The two CI-05 tamper checks (append-only files/journal entries, schema drift)
      run as a required, non-conditional check and pass against the real committed history"
    requirement: CI-05
    verification:
      - kind: other
        ref: "Real PR run 34383194765, tamper-checks job: conclusion=success, 13s"
        status: pass
    human_judgment: false
  - id: D4
    description: "The restore drill runs on a weekly schedule plus workflow_dispatch, is
      deliberately absent from the required-check list, and has genuinely run once"
    verification:
      - kind: other
        ref: "gh run list --workflow restore-drill.yml --limit 1 --json conclusion: success (run 34377739283, ~42s); node check against main-protection.json confirms no context contains \"drill\""
        status: pass
    human_judgment: false
  - id: D5
    description: "ruleset-config-check runs as a required check and fails closed (not silently
      passing) given the GITHUB_TOKEN's actual, confirmed permission ceiling"
    verification:
      - kind: other
        ref: "Real PR run 34383194765, ruleset-config-check job: conclusion=failure (expected -- assertBypassListEmpty fails closed on absent bypass_actors)"
        status: pass
    human_judgment: true
    rationale: "The check's own honest limit (documented in the workflow file and in
      check-ruleset-config.ts's own comments) means it cannot yet demonstrate a PASSING run
      against a real ruleset -- none exists until plan 05-08. A human should read this as an
      open, flagged finding for 05-08, not a defect in this plan's own wiring."

duration: ~79min
completed: 2026-09-09
status: complete
---

# Phase 5 Plan 6: CI Pipeline Gate -- Six Required Checks Summary

**All six required checks (`analyze`, `tamper-checks`, `test`, `test-history`, `migrate`, `ruleset-config-check`) now exist, run independently with no `needs:` ordering, and were proven reporting on a real, closed pull request -- along with a scheduled `restore-drill.yml` that has genuinely run once.**

## Performance

- **Duration:** ~79 min (approximate; not precisely instrumented at session start)
- **Started:** ~2026-09-09T16:15:00Z
- **Completed:** 2026-09-09T17:34:00Z
- **Tasks:** 3
- **Files modified:** 4 (2 workflow files, 1 test file, 1 config file)

## Accomplishments

- Expanded `.github/workflows/pr-gate.yml` from one job (`analyze`) to all six required checks
  named in the already-committed `.github/rulesets/main-protection.json`, with no job declaring
  `needs:` -- the merge decision depends on all six reporting, never on ordering between them.
- Added a dedicated `migrate` job whose entire body (after the shared preamble) is one step
  running `pnpm db:migrate` against a `postgres:17` database reachable at
  `127.0.0.1:5432/recipe_dev` -- `assertLocalDevelopmentTarget`'s pin satisfied honestly, with
  `scripts/db-migrate.ts` and `scripts/env.ts` both confirmed byte-for-byte unchanged.
- Added `.github/workflows/restore-drill.yml`: weekly schedule plus `workflow_dispatch`,
  deliberately excluded from the required-check list (with that reasoning stated in the file
  itself), and confirmed via `gh run list` to have genuinely completed once
  (`success`, ~42s, run `34377739283`).
- Opened a real pull request (`Renkai7/database-automation#2`) and drove it to a final state
  where five of the six checks pass and the sixth fails for the exact, documented, expected
  reason -- then closed it unmerged (mirroring plan `05-03`'s own precedent) and deleted the
  branch.
- Found and fixed three genuine, live-only bugs no amount of local (Windows) testing could have
  caught -- see Deviations below.

## Task Commits

Each task was committed atomically, plus four fix commits found live during verification:

1. **chore: allow direct commits to main until 05-08's ruleset applies** - `5a5abf3` (chore)
2. **Task 1: tamper-checks, test, test-history, ruleset-config-check jobs** - `f532ef7` (feat)
3. **Task 2: the dedicated migrate job** - `d1948bf` (feat)
4. **Task 3: the scheduled restore-drill workflow** - `77528e7` (feat)
5. **Rule 1 fix: RECIPE_BACKUP_DESTINATION step-level env (`runner` context)** - `13b102c` (fix)
6. **Rule 1 fix: remove `administration: write` (not a real permission key)** - `eb17a6b` (fix)
7. **Rule 1 fix: RECIPE_DEV_DATABASE_URL for the test-history job** - `27ee86f` (fix)
8. **Rule 1 fix: process-group kill in tests/smoke.test.ts** - `2157b5a` (fix)
9. **Rule 2 fix: timeout-minutes on the test job** - `1927810` (fix)
10. **Rule 1 fix: docker-compose provisioning for the test job** - `10d3b7b` (fix)

**Plan metadata:** (this commit)

_No separate plan-metadata-only commit was produced by a verification task; all evidence was
gathered against the same commits listed above, on a real pull request that was closed unmerged
after capturing evidence._

## Files Created/Modified

- `.github/workflows/pr-gate.yml` - now carries all six required jobs: `analyze` (unchanged from
  05-03), `tamper-checks`, `test`, `test-history`, `migrate`, `ruleset-config-check`.
- `.github/workflows/restore-drill.yml` (new) - weekly schedule + `workflow_dispatch`, provisions
  the dev database via `docker compose`, runs `pnpm test:drill`, opens/updates a tracking issue
  on failure, deliberately absent from the required-check list.
- `tests/smoke.test.ts` - server spawned with `detached: true`; non-Windows teardown now signals
  the whole process group instead of the direct child alone.
- `.planning/config.json` - `git.allow_default_branch_commits: true` (see Decisions).

## Decisions Made

See frontmatter `key-decisions` for full detail. Summary:

1. Allowed direct commits to `main` for this plan, matching D-04's explicit, temporary,
   documented phase state (no ruleset exists until 05-08).
2. `administration: write` cannot be granted to `GITHUB_TOKEN` at all -- confirmed live, not
   merely insufficiently scoped. `ruleset-config-check` now runs with only `contents: read` and
   fails closed as designed; flagged as an open finding for plan 05-08.
3. The `test` job provisions Postgres via `docker compose`, not a `services:` container --
   required because `pnpm test` includes `tests/migrate.test.ts`, which itself manages the dev
   database via `docker compose`.
4. `tests/smoke.test.ts`'s POSIX teardown now kills the whole process group, matching the
   existing Windows-specific `taskkill /T /F` behavior's actual effect.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `runner` context is not available in a job-level `env:` block**
- **Found during:** Task 3, first `gh workflow run restore-drill.yml` attempt
- **Issue:** `RECIPE_BACKUP_DESTINATION: ${{ runner.temp }}/restore-drill-backups` at job-level
  `env:` made GitHub reject the whole workflow: `HTTP 422 ... Unrecognized named-value: 'runner'`.
- **Fix:** Moved `RECIPE_BACKUP_DESTINATION` to the one step that actually needs it (`runner` is
  available in step-level expressions).
- **Files modified:** `.github/workflows/restore-drill.yml`
- **Verification:** `gh workflow run restore-drill.yml` succeeded; the resulting run completed
  `success` in ~42s.
- **Commit:** `13b102c`

**2. [Rule 1 - Bug] `administration` is not a recognized `permissions:` key**
- **Found during:** Task 1 verification (opening the real proof PR)
- **Issue:** `permissions: administration: write` on `ruleset-config-check` broke the ENTIRE
  `pr-gate.yml` workflow's parsing -- GitHub's check-suite for every affected commit reported
  `conclusion: failure` with **zero jobs registered** (a total parse failure, not a job failure),
  silently failing all six required checks, not just this one. Confirmed via a scratch
  `workflow_dispatch` trigger: `HTTP 422 ... (Line: 198, Col: 7) Unexpected value 'administration'`.
  This contradicts `05-RESEARCH.md`'s stated assumption that `administration: write` is a
  grantable `GITHUB_TOKEN` scope.
- **Fix:** Removed the key; the job now declares only `contents: read`. `assertBypassListEmpty`
  in `check-ruleset-config.ts` already fails CLOSED (not silently passes) when `bypass_actors` is
  absent from the API response -- exactly the outcome this token now produces. Documented as an
  unresolved, phase-blocking finding for plan `05-08` in both the workflow file and this SUMMARY.
- **Files modified:** `.github/workflows/pr-gate.yml`
- **Verification:** Workflow parses; all six jobs register on a real PR; `ruleset-config-check`
  fails for the documented, expected reason (not a parse error).
- **Commit:** `eb17a6b`

**3. [Rule 1 - Bug] `test-history` job needs `RECIPE_DEV_DATABASE_URL` it never opens a socket to**
- **Found during:** Task 1 verification, real PR run
- **Issue:** All 6 history-suite test files failed immediately with "RECIPE_DEV_DATABASE_URL is
  missing or malformed" (0 tests actually ran) -- `tests/history/support.ts` imports
  `scripts/env.ts` (for `EXPECTED_DEV_DATABASE_NAME`), which triggers `scripts/env.ts`'s own
  module-load-time `EnvSchema.parse(process.env)` before any test executes. The same shape as
  `05-RESEARCH.md`'s already-documented Pitfall 5 for `check-schema-drift.ts`, one import hop
  further away and missed in this plan's own Task 1 `read_first`.
- **Fix:** Added the same throwaway `RECIPE_DEV_DATABASE_URL`/`RECIPE_DEV_DB_PASSWORD` job-level
  env already used elsewhere in the workflow.
- **Files modified:** `.github/workflows/pr-gate.yml`
- **Verification:** `test-history` passed on the next real PR run (45s, then 42s).
- **Commit:** `27ee86f`

**4. [Rule 1 - Bug] `tests/smoke.test.ts`'s POSIX server teardown hung the entire CI step**
- **Found during:** Task 1 verification, real PR run (`test` job)
- **Issue:** The `test` job's "Run the application test suite" step never completed -- observed
  17+ minutes with zero step progress against a ~1 minute local baseline; cancelled rather than
  waited out. `serverProcess.kill()` signals only the direct `pnpm` child; `pnpm --filter
  recipe-app start` execs the real `next-server` process as a grandchild on POSIX too (the prior
  comment claimed this was Windows-only). With `stdio: "inherit"`, the surviving grandchild kept
  the job step's own stdout/stderr file descriptors open, hanging the step -- not the individual
  test assertions, which likely already passed internally.
- **Fix:** Spawn with `detached: true` (puts the whole tree in its own POSIX process group) and,
  on non-Windows, signal the negative pid (`process.kill(-pid, "SIGTERM")`) -- delivers to the
  whole group, mirroring the Windows `taskkill /T /F` branch's actual effect. Windows branch
  unchanged.
- **Files modified:** `tests/smoke.test.ts`
- **Verification:** Local `pnpm test` (531/531, including this file) still passes on Windows;
  real CI run's `test` job subsequently completed in 1m14s / 1m35s across two runs, no hang.
- **Commit:** `2157b5a`

**5. [Rule 2 - Missing Critical] No `timeout-minutes` ceiling on the `test` job**
- **Found during:** Same investigation as fix #4
- **Issue:** Without an explicit ceiling, a hung job (as #4 demonstrated is possible) would run
  until GitHub's own default 6-hour job timeout, silently consuming the repository's Actions
  minutes.
- **Fix:** Added `timeout-minutes: 15`, generous over the ~1 minute local baseline.
- **Files modified:** `.github/workflows/pr-gate.yml`
- **Verification:** No behavioral change on a passing run; documented as a defensive addition.
- **Commit:** `1927810`

**6. [Rule 1 - Bug] `test` job's `services:` container conflicts with `tests/migrate.test.ts`'s own database lifecycle**
- **Found during:** Task 1 verification, real PR run (`test` job, after fix #4)
- **Issue:** `test` failed `tests/migrate.test.ts`'s first assertion (`resetRun.exitCode` was `1`,
  not `0`). That test file -- part of the unmodified `pnpm test` suite -- shells out to `pnpm run
  db:reset` (`scripts/db-reset.ts`), which runs `docker compose down -v` then `docker compose up
  -d --wait` to reset the pinned dev database. A GitHub Actions `services:` container already
  held port `127.0.0.1:5432`, so `docker compose up -d --wait` failed outright on the port
  conflict -- two incompatible database-lifecycle mechanisms racing for the same port.
- **Fix:** Removed the `services:` block from `test`; added a `pnpm db:up` step (docker compose),
  matching `restore-drill.yml`'s already-proven provisioning. `migrate` (which never runs `pnpm
  test`) keeps its `services:` container unchanged -- it never hits this conflict.
- **Files modified:** `.github/workflows/pr-gate.yml`
- **Verification:** `test` passed on the next real PR run (1m35s), including `tests/migrate.test.ts`.
- **Commit:** `10d3b7b`

---

**Total deviations:** 6 auto-fixed (5 Rule 1 bugs, 1 Rule 2 missing-critical). All six were found
live against the real GitHub Actions runner and are exactly the class of discovery this plan's
own `<verification_discipline>` section anticipated ("prove the checks actually run and report on
GitHub's servers... this is how [05-03] caught a real bug"). None was speculative; every fix was
verified against a subsequent real CI run before being considered resolved.
**Impact on plan:** All six fixes were necessary for the plan's own stated success criteria (all
six checks reporting on a real PR) to be achievable at all. No scope creep -- fix #4/#6 touch
`tests/smoke.test.ts` and remove a `services:` block outside this plan's declared
`files_modified`, but both are squarely Rule 1/Rule 3 (blocking issues preventing the plan's own
required verification from completing), not new feature work.

## Issues Encountered

- **Unresolved, flagged for plan 05-08:** `ruleset-config-check` cannot currently pass against a
  real ruleset, because `GITHUB_TOKEN` has no way to be granted repository-administration scope
  through a workflow's declarative `permissions:` block (confirmed live, not assumed).
  `05-RESEARCH.md`'s own open question #1 already pre-committed "absent" as one of three possible
  outcomes requiring a design change (most likely a fine-grained PAT or GitHub App token with real
  admin rights, held as a repository secret) -- this SUMMARY confirms that outcome live rather
  than leaving it a research-time guess. Plan `05-08` (the plan that applies the ruleset and first
  has a real one to query) must resolve this before `ruleset-config-check` can ever report
  `success`; until then it will correctly, honestly fail closed on every run.
- Two stale, cosmetic GitHub Actions run records exist from before the `administration: write` fix
  landed (`push`-triggered `startup_failure` entries against `pr-gate.yml`, zero jobs registered,
  visible in `gh run list`). No action needed -- they are historical artifacts of the bug already
  fixed and documented above, not evidence of anything still broken.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan `05-07` can proceed: `tests/guardrails.test.ts`'s D-11 proof and D-15's startup-migration
  guardrail are unaffected by this plan; the `migrate` job's existence (this plan) and the
  boot-time guardrail (05-07) together fully close CI-06.
- Plan `05-08` has two concrete, load-bearing findings from this plan to act on: (1) the six
  required-check names are confirmed to match `main-protection.json` verbatim and all six report
  on a real PR; (2) `ruleset-config-check` needs a real admin-capable token (not achievable via
  `GITHUB_TOKEN`'s declarative `permissions:` at all) before it can ever pass -- this is a design
  decision 05-08 must make, not a bug to silently route around.
- `restore-drill.yml` is live, scheduled, and has one confirmed successful run; no further action
  needed unless the owner wants a different cadence.
- `git.allow_default_branch_commits: true` in `.planning/config.json` should be reconsidered once
  05-08 applies the live ruleset (direct pushes to `main` will then be refused by GitHub itself
  regardless of this flag).

---
*Phase: 05-ci-pipeline-gate*
*Completed: 2026-09-09*

## Self-Check: PASSED

- `.github/workflows/pr-gate.yml` and `.github/workflows/restore-drill.yml` both verified present
  on disk (`[ -f ]`).
- All 10 commits (`5a5abf3`, `f532ef7`, `d1948bf`, `77528e7`, `13b102c`, `eb17a6b`, `27ee86f`,
  `2157b5a`, `1927810`, `10d3b7b`) verified present in `git log`.
- Re-ran all task-level `<acceptance_criteria>` grep/node checks from `05-06-PLAN.md`: all pass
  against the current file content (job names exactly once each, zero `needs:`, exactly one
  `127.0.0.1:5432:5432` occurrence... note: `administration: write` occurs zero times, not once
  as the plan's own Task 1 acceptance criterion literally states -- see Deviation #2 above; the
  criterion's premise was empirically false and could not be satisfied as written without
  breaking the entire workflow).
- Re-ran the plan-level `<verification>` block:
  - `grep -v comments | grep -c 'needs:'` -> `0`. PASS.
  - All six job names appear exactly once each in the stripped workflow. PASS.
  - `git diff --stat HEAD -- scripts/db-migrate.ts scripts/env.ts` -> empty. PASS.
  - The restore drill workflow has one completed run (`success`, run `34377739283`). PASS.
  - Real pull request (`#2`) showed six checks reporting; conclusions and durations recorded
    above. PASS (5 pass, 1 fails for the documented, expected reason).
  - `pnpm test` passes locally: 531/531, 51/51 files. PASS.
- `pnpm test` re-run one final time after all fixes: 531/531 passed.
