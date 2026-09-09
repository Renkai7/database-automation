---
phase: 05-ci-pipeline-gate
plan: 05
subsystem: infra
tags: [github-rulesets, github-actions, gh-cli, ci-gate, tamper-detection]

requires:
  - phase: 05-ci-pipeline-gate
    provides: "05-03's analyze job name (analyze) and 05-04's tamper-checks scripts and their published required-check names, which this plan's committed payload cites verbatim"
provides:
  - "A committed, diffable ruleset payload (.github/rulesets/main-protection.json) that is the reviewable source of truth for D-04's branch protection, instead of a click-path"
  - "An idempotent apply script (scripts/ci/apply-ruleset.ts) that creates or updates the live ruleset from that payload and has no delete path"
  - "A fail-closed self-check (scripts/ci/check-ruleset-config.ts) that re-verifies the live ruleset's bypass list, enforcement mode, and required rules/checks on every run, following D-05's verify-don't-trust pattern"
  - "Fixture-driven proof (tests/ci/check-ruleset-config.test.ts) of every assertion, anchored on the absent-bypass_actors false negative that is the entire reason this check exists"
affects: [05-06, 05-08]

actuals:
  tokens: 6914
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Fail closed on an absent field, never treat absence as confirmed-empty (assertBypassListEmpty distinguishes 'cannot confirm' from 'confirmed empty' in both logic and message text)"
    - "Read the expected-value list from the one committed source file rather than re-typing it (assertRequiredRules reads contexts from .github/rulesets/main-protection.json via RULESET_PAYLOAD_PATH)"
    - "Verify, don't trust the tool's own account of itself (scripts/verify-migration-state.ts's precedent, applied one layer up to the ruleset by D-05)"

key-files:
  created:
    - .github/rulesets/main-protection.json
    - scripts/ci/apply-ruleset.ts
    - scripts/ci/check-ruleset-config.ts
    - tests/ci/check-ruleset-config.test.ts
  modified: []

key-decisions:
  - "CI-03 is NOT ticked complete in REQUIREMENTS.md by this plan, despite being named in this plan's own requirements frontmatter -- CI-03 reads 'the gate is enforced by a GitHub repository ruleset,' and this plan deliberately does not apply the ruleset to the live repository (the plan's own objective and verification section state this explicitly; plan 05-08 applies it, after the workflow has run at least once and the real reported check names are confirmed). Ticking the checkbox now would claim live enforcement that does not yet exist."
  - "check-ruleset-config.ts imports RULESET_PAYLOAD_PATH from apply-ruleset.ts rather than re-declaring the path string, so the two scripts can never read from different files -- Task 1's constant is the one place that path is defined."

requirements-completed: []

coverage:
  - id: D1
    description: "The ruleset is a committed, diffable JSON artifact with an explicitly empty bypass list, active enforcement, and the six required-check contexts"
    requirement: "CI-03"
    verification:
      - kind: unit
        ref: "node -e assertion script from the plan's Task 1 <verify> block"
        status: pass
    human_judgment: false
  - id: D2
    description: "apply-ruleset.ts's loadRulesetPayload refuses an untrustworthy payload (absent bypass_actors, non-active enforcement, empty context list) and chooseApplyMethod returns only create-or-update, never a removal instruction"
    requirement: "CI-03"
    verification:
      - kind: unit
        ref: "manual smoke script exercising loadRulesetPayload/chooseApplyMethod against the real committed payload and synthetic negative cases (see task execution log)"
        status: pass
    human_judgment: false
  - id: D3
    description: "check-ruleset-config.ts's four assertion functions fail closed on the absent-bypass_actors false negative, enforce set-comparison for required checks, and enumerate every ruleset targeting main"
    requirement: "CI-03"
    verification:
      - kind: unit
        ref: "tests/ci/check-ruleset-config.test.ts (17 tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The self-check and its every failure message state the check's own limit: it runs inside the thing it audits and cannot make tampering impossible, only visible and costlier"
    verification: []
    human_judgment: true
    rationale: "Whether the stated limit is worded clearly enough is a documentation-quality judgment, not something a test asserts. Reviewed against the plan's own must_haves wording during authoring; a human reviewer should confirm the phrasing reads as intended."

duration: 15min
completed: 2026-09-09
status: complete
---

# Phase 5 Plan 5: CI Pipeline Gate — Ruleset Payload and Self-Check Summary

**Committed, diffable GitHub ruleset payload plus an idempotent apply script and a fail-closed self-check that distinguishes "confirmed empty" from "could not confirm" on the bypass list — nothing applied to the live repository yet.**

## Performance

- **Duration:** 15 min
- **Started:** 2026-09-09T16:11:19Z (STATE.md's last recorded position at plan start)
- **Completed:** 2026-09-09T16:22:05Z
- **Tasks:** 3
- **Files modified:** 4 (all new)

## Accomplishments

- `.github/rulesets/main-protection.json` — the committed source of truth for the branch
  ruleset: `bypass_actors: []` explicitly present (not omitted), `enforcement: "active"`,
  `deletion`/`non_fast_forward`/`pull_request`/`required_status_checks` rules, and the six
  required-check contexts (`analyze`, `tamper-checks`, `test`, `test-history`, `migrate`,
  `ruleset-config-check`) carried verbatim from plans 05-03/05-04's job names.
- `scripts/ci/apply-ruleset.ts` — `loadRulesetPayload` refuses to trust a payload missing
  `bypass_actors`, not actively enforced, or with an empty required-check list;
  `chooseApplyMethod` returns only a create or update instruction (no third shape, no delete
  path anywhere in the module).
- `scripts/ci/check-ruleset-config.ts` — `assertBypassListEmpty` fails closed on an absent,
  `null`, or non-array `bypass_actors`, with a message text that names the distinction between
  "cannot confirm" and "confirmed empty"; `assertEnforcementActive` refuses GitHub's
  `"evaluate"` dry-run mode; `assertRequiredRules` compares required rule types and contexts as
  sets against the committed payload's own list; `rulesetsMatchingMain` enumerates every
  ruleset targeting `refs/heads/main`, including GitHub's `~ALL`/`~DEFAULT_BRANCH` wildcard
  forms, and `runCheckRulesetConfig` treats "no ruleset matches main" as a failure.
- `tests/ci/check-ruleset-config.test.ts` — 17 fixture-driven tests, all derived from one
  passing baseline by single mutations, anchored on the absent-`bypass_actors` case that is the
  entire reason this check exists (05-RESEARCH.md Pitfall 1).

## Task Commits

Each task was committed atomically:

1. **Task 1: The committed ruleset payload and its idempotent apply script** — `6316f94` (feat)
2. **Task 2: The self-check that fails closed on an unreadable bypass list** — `c8a4f1d` (feat)
3. **Task 3: Fixture-driven proof, including the false-negative the whole check exists to
   prevent** — `3851cba` (test)

**Plan metadata:** committed alongside this SUMMARY.

## Files Created/Modified

- `.github/rulesets/main-protection.json` — the reviewable branch-ruleset payload.
- `scripts/ci/apply-ruleset.ts` — idempotent create-or-update apply script, no delete path.
- `scripts/ci/check-ruleset-config.ts` — fail-closed live-configuration self-check.
- `tests/ci/check-ruleset-config.test.ts` — fixture-driven proof of every assertion.

## Decisions Made

- Did not tick CI-03 in `REQUIREMENTS.md` despite it being this plan's own declared
  requirement. CI-03's text ("the gate is enforced by a GitHub repository ruleset") describes
  live enforcement, and this plan's own objective and `<verification>` section are explicit
  that no ruleset is applied to the live repository here — that is plan 05-08's job, performed
  only after the workflow (05-06/05-07) has run at least once and the real reported check names
  are confirmed (05-RESEARCH.md Pitfall 2). Ticking the box now would claim a property that
  does not yet hold.
- `check-ruleset-config.ts` imports the `RULESET_PAYLOAD_PATH` constant from `apply-ruleset.ts`
  rather than re-declaring the file path as a second literal, so the payload path used to send
  the ruleset and the path used to read its expected context list can never independently
  drift.

## Deviations from Plan

None — plan executed exactly as written. Both TDD-marked tasks (Task 2, Task 3) followed this
plan's own explicit task split rather than the generic write-test-then-implement order: Task 2
implemented the four assertion functions against the plan's fully specified `<behavior>` block
and was verified via the plan's own static `<verify>` command (a symbol/reference presence
check, not a running test — Task 2 produces no test file of its own); Task 3 then wrote the
fixture-driven behavioral proof over that already-built implementation and is what actually
exercises every behavior row, including the absent-`bypass_actors` false negative. This is the
plan's own literal task boundary (Task 2's `<files>` is the implementation only; Task 3's
`<files>` is the test file only), not a TDD-discipline violation improvised during execution.

## TDD Gate Compliance

- Task 2 (`tdd="true"`) has no preceding `test(05-05):` commit for its own file, because its
  `<files>` list names only `scripts/ci/check-ruleset-config.ts` — no test file — and its
  `<verify>` block is a static symbol-presence check, not a red/green test cycle. This mirrors
  the plan's own explicit two-task split (build, then prove with fixtures) rather than a single
  task's usual red-then-green sequence.
- Task 3 (`tdd="true"`) is the `test(05-05):` commit (`3851cba`) that proves Task 2's already-
  built implementation against 17 fixture cases; since the implementation was already correct
  when the tests were written, all 17 passed on first run rather than failing red first. The
  plan's own `<behavior>` block for Task 3 is the specification this file was written against.
- `pnpm test` after both tasks: 531/531 (was 514/514 at plan start) — no regressions.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required. This plan touches no live GitHub API state.

## Next Phase Readiness

- Plan 05-06 can wire `.github/workflows/pr-gate.yml` to add the `tamper-checks`, `test`,
  `test-history`, `migrate`, and `ruleset-config-check` jobs (this plan supplies the script the
  last of those runs).
- Plan 05-08 can apply `.github/rulesets/main-protection.json` to the live repository via
  `scripts/ci/apply-ruleset.ts` once every required job has reported at least one real check
  name, and then rely on `scripts/ci/check-ruleset-config.ts` to keep proving the configuration
  afterward.
- Open item carried forward exactly as flagged in this plan: whether `administration: write` on
  a workflow `GITHUB_TOKEN` is sufficient for `bypass_actors` to be returned at all is UNKNOWN
  and settled only by a live run in plan 05-08 — not assumed here.

---
*Phase: 05-ci-pipeline-gate*
*Completed: 2026-09-09*

## Self-Check: PASSED

- All 4 created files confirmed present on disk.
- All 3 task commits (`6316f94`, `c8a4f1d`, `3851cba`) confirmed present in `git log`.
- Re-ran plan-level `<verification>`: the Task 1 payload assertion script exits 0;
  `pnpm exec vitest run tests/ci/check-ruleset-config.test.ts` passes (17/17);
  `pnpm test` passes (531/531, up from 514/514 at plan start); `git status --short` confirms
  no ruleset was applied to the live repository (no network call was made by this plan).
