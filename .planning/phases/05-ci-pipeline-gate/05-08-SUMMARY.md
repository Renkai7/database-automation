---
phase: 05-ci-pipeline-gate
plan: 08
subsystem: infra
tags: [github-rulesets, github-actions, ci-cd, branch-protection, tamper-detection, drizzle-kit]

# Dependency graph
requires:
  - phase: 05-ci-pipeline-gate (plans 01-07)
    provides: the public GitHub repository, the pr-gate.yml workflow (analyze, tamper-checks,
      test, test-history, migrate, ruleset-config-check), the committed ruleset payload, and the
      guardrail suite this plan applies and observes
provides:
  - The `main-protection` GitHub repository ruleset, live and applied, with `bypass_actors` read
    back present and empty and direct pushes to `main` refused
  - docs/40-ci-gate-merge-attempt.md -- D-18's performed record, written from the owner's own
    verbatim merge-attempt report and both tamper checks falsified against real pull requests
  - docs/decisions.md D26-D33 -- the live ruleset, its self-check and honest limits, the D30/D31
    split (workflow token cannot observe bypass_actors), D-18's performed proof, and the closing
    "Still UNKNOWN after Phase 5" list
  - CI-01 .. CI-06 ticked in .planning/REQUIREMENTS.md, each against a named observed artifact
  - The working-mode change for every later phase: `main` is protected; every commit that must
    reach `origin/main`, including `.planning/` documentation, now travels through a branch and a
    pull request whose six required checks pass
affects: [06-connectivity, 07-production]

# Actuals (#2632)
actuals:
  tokens: 18603
  tasks: 3
  commits: 11

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Apply-then-self-check: the ruleset is created via the GitHub API, then read back from the
      per-ruleset GET endpoint (never trusted from the request that created it) before anything
      depends on its configuration."
    - "Split required/advisory checks: a property a workflow token structurally cannot observe
      (bypass_actors under GITHUB_TOKEN-only permissions) moves to a non-required, always-visible
      job rather than blocking merges permanently or being silently dropped."
    - "Performed-act documentation: docs/40-ci-gate-merge-attempt.md is written from what actually
      happened (a live owner-performed merge attempt, live CI job logs) rather than composed in
      advance, following 02-CONTEXT.md D-10's restore-runbook precedent."

key-files:
  created:
    - docs/40-ci-gate-merge-attempt.md
  modified:
    - docs/decisions.md
    - .planning/REQUIREMENTS.md
    - tests/ci/check-ruleset-config.test.ts

key-decisions:
  - "D26: the main-protection ruleset is live on the real repository -- bypass_actors read back
    present and empty, direct push refused with GitHub's own verbatim error."
  - "D30/D31: a workflow's own GITHUB_TOKEN has no declarative path to observe bypass_actors at
    all (confirmed live, not merely insufficient permission) -- ruleset-config-check stays
    required but narrowed to what contents:read can see; the bypass-list assertion moved to a
    separate, non-required ruleset-bypass-audit job rather than adding a new credential."
  - "D32/D33: D-18's merge attempt was performed by the owner personally and recorded verbatim;
    no bypass/override affordance was offered. Both tamper-detection clauses (CI-05) were
    falsified against real pull requests, not only fixtures. Phase 5's requirements are ticked
    only where a specific observed artifact backs them, and everything left unresolved is written
    down as UNKNOWN rather than assumed."

patterns-established:
  - "Documentation-as-deliverable: a docs/ record that quotes verbatim, real output (owner report,
    CI job logs, PR comment) rather than describing intended behavior in the abstract."

requirements-completed: [CI-01, CI-02, CI-03, CI-04, CI-05, CI-06]

coverage:
  - id: D1
    description: "docs/40-ci-gate-merge-attempt.md exists, recording D-18's performed act: the
      owner personally could not merge a BLOCKED pull request through the live ruleset, with no
      bypass affordance offered."
    requirement: "CI-03"
    verification:
      - kind: manual_procedural
        ref: "owner performed the merge attempt on PR #4 through GitHub's web UI with their own
          admin account; verbatim report captured in docs/40-ci-gate-merge-attempt.md"
        status: pass
    human_judgment: true
    rationale: "No test inside the system can assert what GitHub refuses to do for a specific
      human account (05-CONTEXT.md D-18); this is a claim only a performed act and a human
      report can settle."
  - id: D2
    description: "Both tamper-detection checks (CI-05) falsified against real pull requests: an
      edit to an already-applied migration, and a hand-edited divergence from schema.ts."
    requirement: "CI-05"
    verification:
      - kind: integration
        ref: "PR #5 (demo/tamper-edit-applied-migration) -- tamper-checks failed with
          assertMigrationFilesAppendOnly's exact message, quoted in docs/40-ci-gate-merge-attempt.md"
        status: pass
      - kind: integration
        ref: "PR #6 (demo/tamper-schema-drift) -- tamper-checks failed on the schema-drift step,
          quoted in docs/40-ci-gate-merge-attempt.md"
        status: pass
    human_judgment: false
  - id: D3
    description: "CI-01..CI-06 ticked in .planning/REQUIREMENTS.md, each against a named observed
      artifact rather than on implementation alone; the Phase 5 traceability row updated."
    requirement: "CI-01, CI-02, CI-03, CI-04, CI-05, CI-06"
    verification:
      - kind: other
        ref: ".planning/REQUIREMENTS.md Phase 5 traceability row, cross-referenced against
          docs/decisions.md D26/D28/D29/D32 and docs/40-ci-gate-merge-attempt.md"
        status: pass
    human_judgment: false
  - id: D4
    description: "docs/decisions.md carries D26-D33, ending with a 'Still UNKNOWN after Phase 5'
      section naming production's PostgreSQL major version, the drift-found exit code, the
      never-reporting-check question, the owner's GitHub plan tier, fork pull requests, and the
      Windows-CI asymmetry."
    requirement: null
    verification:
      - kind: other
        ref: "grep -c 'Still UNKNOWN after Phase 5' docs/decisions.md == 1"
        status: pass
    human_judgment: false
  - id: D5
    description: "Every commit this plan produced, including its own documentation, reached
      origin/main only through a branch and a pull request whose six required checks passed --
      the final end-to-end confirmation that the gate permits legitimate work as readily as it
      refuses destructive work."
    requirement: null
    verification:
      - kind: other
        ref: "PR #7 (docs/05-08-merge-attempt-record) and PR #8 (docs/05-08-close-out-phase),
          both merged with all six required checks green; gh pr list --state open returns 0"
        status: pass
    human_judgment: false

duration: 74min (this session; plan spans two executor sessions -- see Deviations)
completed: 2026-09-09
status: complete
---

# Phase 5 Plan 08: CI Pipeline Gate -- Applied and Proven Summary

**The `main-protection` GitHub ruleset is live with an empty bypass list; the repository owner
personally attempted to merge a BLOCKED migration through GitHub's own web UI and could not, with
no bypass offered; both tamper-detection checks were falsified against real pull requests; and
Phase 5's six requirements are ticked only where a specific observed artifact backs them.**

## Performance

- **Duration:** This session (continuation from a `checkpoint:human-verify` awaiting the owner's
  personally-performed merge attempt) ran ~74 min, 2026-09-09T18:05Z-19:22Z. The plan as a whole
  spans two executor sessions across the same day (Task 1 in an earlier session, Task 2's
  human-check and Tasks 2-3's close-out in this one) -- see `plan_head_before` note below.
- **Started (this session):** 2026-09-09T18:05Z (docs/40-ci-gate-merge-attempt.md drafted)
- **Completed:** 2026-09-09T19:22Z
- **Tasks:** 3 (Task 1 completed in a prior session; Tasks 2-3 completed in this one)
- **Files modified (this session):** 4 (`docs/40-ci-gate-merge-attempt.md` created;
  `docs/decisions.md`, `.planning/REQUIREMENTS.md`, `tests/ci/check-ruleset-config.test.ts`
  modified) plus the auto-updated `docs/migration-history-status.json` status artifact

## Accomplishments

- **`docs/40-ci-gate-merge-attempt.md` written from the owner's own performed act.** Quotes the
  owner's verbatim merge-attempt report against PR #4 (a real `DROP TABLE` migration reproducing
  Phase 4's own reverted `D-32` change), the exact `assertMigrationFilesAppendOnly` failure from
  PR #5, and the exact schema-drift failure from PR #6 -- all closed unmerged. States the gate's
  honest boundary explicitly: this proves criterion 1 for one account, once, under one confirmed
  configuration, not that the underlying ruleset cannot be edited by someone with admin access to
  edit it.
- **CI-01..CI-06 ticked in `.planning/REQUIREMENTS.md`**, each against a named, specific artifact
  (a live API read, a passing/failing check on a real pull request, a source-code inspection) --
  no checkbox rests on implementation alone.
- **`docs/decisions.md` D32/D33 close the phase's decision log**, resolving D28's
  "falsification pending" status and ending with a `Still UNKNOWN after Phase 5` section that
  names every question this phase did not settle rather than silently dropping it.
- **The working-mode change proved itself on its own commits**: both of this plan's remaining
  documentation changes reached `main` only through a branch, a pull request, and all six
  required checks passing (PR #7, PR #8) -- no direct push occurred at any point.

## Task Commits

Each task was committed atomically. Task 1 was completed in a prior executor session (this
SUMMARY is written by a continuation agent); its commits are listed for completeness.

1. **Task 1: Apply the ruleset from verbatim reported check names, then self-check it live**
   (prior session) -- `b35c995` (fix: repair ruleset payload schema and list-endpoint matching
   bug), `46cef93` (docs: record D26-D30), `d425ed5` (fix: narrow ruleset-config-check,
   add advisory bypass audit), `98e09db` (feat: wire ruleset-bypass-audit), `ac28bb3`
   (test: allow ruleset-bypass-audit guardrail exception), `ede6bd5` (docs: record D31),
   `1f443ca` (merge PR #3)
2. **Task 2: The performed proofs** -- `2ae5cf8` (docs: write D-18's performed merge-attempt
   record), `664e109` (merge PR #7); PR #4 closed unmerged via `gh pr close 4` (no commit)
3. **Task 3: Close out the phase record** -- `ddeb8de` (docs: CI-01..CI-06 traceability, D32/D33,
   Still UNKNOWN list, Rule 1 CRLF-regex fix), `53132e0` (merge PR #8)

**Plan-level commit count (measured, #3968):** `git rev-list --count 6dbe07c..HEAD` = **11**.
`plan_head_before: 6dbe07c` (the last commit of plan 05-07, immediately preceding this plan's
first commit). No ledger file existed for this plan at continuation start (it spans two
sessions); one was created (`gsd-plan-head-before-05-08`) against this same base before recording
this count.

## Files Created/Modified

- `docs/40-ci-gate-merge-attempt.md` -- D-18's performed record: the owner's verbatim
  merge-attempt report, both tamper-check falsifications, and the gate's stated honest boundary.
- `docs/decisions.md` -- D28 status updated to reflect completed falsification; D32 (D-18
  performed, both tamper checks falsified) and D33 (phase close-out, working-mode restated, Still
  UNKNOWN list) added.
- `.planning/REQUIREMENTS.md` -- CI-01..CI-06 checkboxes ticked; Phase 5 traceability row updated
  with per-requirement evidence, replacing "Pending".
- `tests/ci/check-ruleset-config.test.ts` -- two function-body-matching regexes widened from `\n`
  to `\r?\n` (Rule 1 deviation, see below).
- `docs/migration-history-status.json` -- auto-updated `lastRunAt` from this session's own
  `pnpm test:history` run (status artifact, not hand-edited).

## Decisions Made

- **D26-D31 stand unchanged** (recorded in a prior session): the ruleset is live with an empty,
  read-back-confirmed bypass list; the self-check runs inside the thing it audits; tamper
  detection is live as committed; the `migrate` job satisfies CI-06 without loosening the
  local-development-target pin; a workflow token cannot observe `bypass_actors` under any
  grantable `permissions:` scope; and the owner's resolution was to split the required check
  (narrowed to what `contents: read` can see) from a separate, non-required, always-visible
  bypass-audit job, rather than add a new credential.
- **D32 (new):** D-18's performed merge attempt and both tamper falsifications are complete,
  closing D28's "falsification pending" status. The gate's honest boundary is restated: proof for
  one account, once, under one confirmed configuration -- not proof the ruleset configuration
  itself cannot be changed by an admin.
- **D33 (new):** Phase 5's requirements are closed with named evidence per requirement; the
  working-mode change (every commit to `main`, including docs, now travels through a gated pull
  request) is restated because it governs every later phase; the Phase 7 environment-protection-
  bypass blocker is recorded as already resolved by D-02's public visibility, not reopened; and a
  `Still UNKNOWN after Phase 5` list closes the phase honestly rather than by omission.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `tests/ci/check-ruleset-config.test.ts`'s function-body regexes were
CRLF-hostile, failing `pnpm test` on this Windows development machine**
- **Found during:** Task 3's own required `pnpm test` verify step
- **Issue:** Two regexes (`/export async function runCheckRulesetConfig\(\)[\s\S]*?\n\}\n/` and
  the equivalent for `runCheckRulesetBypassAudit`) assumed a bare `\n` immediately precedes and
  follows a function's closing brace. This repository's own git config checks TypeScript sources
  out as CRLF on Windows (`core.autocrlf=true`, confirmed live), so the character immediately
  after the closing brace is `\r`, not `\n` -- the regex never matched, and both tests failed with
  `bodyMatch` `null`, even though the underlying guardrail logic (`runCheckRulesetConfig` correctly
  omits `assertBypassListEmpty`; `runCheckRulesetBypassAudit` correctly imports and calls it) was
  unchanged and correct. This is `05-CONTEXT.md` D-12's Windows/CI asymmetry in the opposite
  direction from what D-12 anticipates: a false failure a Windows dev machine would see that CI's
  Linux checkout (LF) would never reproduce.
- **Fix:** Widened both regexes to `\r?\n` around the closing brace.
- **Files modified:** `tests/ci/check-ruleset-config.test.ts`
- **Verification:** `pnpm test` -- 51/51 test files, 540/540 tests pass (was 50/51, 538/540
  before the fix, with the two failures isolated to this file).
- **Committed in:** `ddeb8de` (Task 3 commit)

**2. [Rule 3 - Blocking, documented in a prior session, restated here for completeness] Observation
3's construction diverged from the plan's literal action text**
- **Found during:** Task 2, prior session (this SUMMARY records it because it is load-bearing for
  what `docs/40-ci-gate-merge-attempt.md` Observation 3 says)
- **Issue:** The plan's action text says "edit a committed migration so the history no longer
  reconstructs `schema.ts`." Editing an existing `.sql` file in place would trip the append-only
  check first, and GitHub Actions skips a job's later steps once an earlier one fails -- the
  schema-drift step, and its own failure message, would never have run.
- **Fix:** Constructed the divergence as a pure addition instead (a new migration generated
  against a temporarily-edited `schema.ts`, committed alongside the real, unmodified `schema.ts`),
  which passes the append-only check cleanly and isolates the schema-drift failure exactly as
  Observation 3 needs. Recorded in the PR #6 commit message and restated in
  `docs/40-ci-gate-merge-attempt.md` and `docs/decisions.md` D32 so it is never mistaken for an
  oversight.
- **Files modified:** none in this session (already committed to `main` via PR #6's demonstration
  branch in a prior session; this session only documents it)
- **Verification:** PR #6's `tamper-checks` job failed on the schema-drift step specifically, with
  the append-only step passing cleanly -- confirmed live in the job log, quoted verbatim in
  `docs/40-ci-gate-merge-attempt.md`.
- **Committed in:** `c459e87` (prior session, demo branch, not part of this plan's own commit
  count since the branch was closed unmerged)

---

**Total deviations:** 2 (1 auto-fixed this session under Rule 1; 1 documented from a prior
session under Rule 3, no new fix required).
**Impact on plan:** Neither affected scope. The Rule 1 fix was required to satisfy Task 3's own
`pnpm test` acceptance criterion and is a narrow, Windows-line-ending-only correctness fix with no
behavior change to the guardrail itself. The Rule 3 deviation was already fully documented and
verified in the prior session; this session's job was to write it into the permanent record.

## Issues Encountered

None beyond the two deviations above.

## User Setup Required

None -- no external service configuration required. (The plan's own working-mode change --
every commit to `main` now needs a branch and a pull request -- is a process change, not a setup
step, and is recorded prominently in `docs/decisions.md` D33 and D26.)

## Next Phase Readiness

- **Phase 5 is complete.** All four success criteria are met: the owner cannot merge a pull
  request carrying a destructive migration (proven by performing the attempt, not merely
  configuring it); both tamper-detection clauses are falsified against real pull requests; the
  ruleset keeps asserting itself continuously (`ruleset-config-check`, narrowed per D31); and
  everything this phase could not settle is written down as UNKNOWN rather than guessed.
- **Ready for Phase 6 (Connectivity).** The `migrate` job's shape (a service container reachable
  at `127.0.0.1:5432/recipe_dev`, satisfying `assertLocalDevelopmentTarget` honestly) is the
  concrete starting point Phase 6 extends with a staging environment and a connection mechanism,
  per `05-CONTEXT.md`'s own "Consumed by Phase 6" note.
- **Carried into Phase 7, already resolved rather than reopened:** the environment-protection-
  bypass blocker `.planning/STATE.md` had listed as open is settled by D-02's public-repository
  visibility (recorded in D33). Still genuinely open for Phase 7: the owner's GitHub plan tier
  (does not matter, given public visibility), and whether a never-reporting required check blocks
  a merge (documented by GitHub, not separately provoked here).
- **Working-mode note for whoever executes Phase 6:** direct pushes to `main` are refused from
  this point forward, including for `.planning/` documentation commits. Every subsequent GSD
  phase in this repository needs a branch and a pull request to publish, exactly as this plan's
  own two closing commits did.

## Self-Check: PASSED

- `docs/40-ci-gate-merge-attempt.md` exists: **FOUND**
- `git log --oneline --all --grep="05-08"` returns commits including `2ae5cf8`, `ddeb8de`,
  `664e109`, `53132e0`: **FOUND** (confirmed via `git log`)
- `grep -ci 'verbatim' docs/40-ci-gate-merge-attempt.md` = 5 (>0): **PASS**
- `grep -ci 'not an audit trail' docs/40-ci-gate-merge-attempt.md` = 1 (>0): **PASS**
- `gh pr list --state open --json number --jq 'length'` = 0: **PASS**
- `grep -c 'Still UNKNOWN after Phase 5' docs/decisions.md` = 1 (>0): **PASS**
- Phase 5's own `.planning/REQUIREMENTS.md` traceability row no longer reads `Pending`: **PASS**
  (other phases' rows still legitimately read `Pending`, confirmed not a false pass)
- `pnpm test` = 540/540 passing, `pnpm test:history` = 14/14 passing: **PASS**
- No direct push to `main` occurred: **PASS** (both remaining commits reached `main` via PR #7 and
  PR #8, each merged only after all six required checks passed)

---
*Phase: 05-ci-pipeline-gate*
*Completed: 2026-09-09*
