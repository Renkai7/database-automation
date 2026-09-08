---
phase: 03-safety-analyzer
plan: 07
subsystem: database
tags: [squawk-cli, execa, postgres-ast, migration-safety, decision-log]

# Dependency graph
requires:
  - phase: 03-safety-analyzer
    provides: "The complete analyzer (analyzeSql, rules.json, corpus manifest) built in plans 03-01 through 03-06, which this plan cross-checks against an independent tool"
provides:
  - "packages/automation/scripts/squawk-comparison.ts, a re-runnable D-15 calibration generator"
  - "docs/30-squawk-comparison.md, the committed, fully-annotated squawk comparison report (phase success criterion 5)"
  - "docs/decisions.md D16, the project-level record of the analyzer's classification contract"
  - ".planning/phases/03-safety-analyzer/COVERAGE.md, the api-coverage seal-gate declaration"
  - "tests/guardrails.test.ts now covers packages/ by default"
affects: [04-migration-runner, 07-extraction]

# Actuals (#2632)
actuals:
  tokens: 18223
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: [squawk-cli@2.64.0 (devDependency of packages/automation only)]
  patterns:
    - "execa preferLocal+localDir to resolve a workspace-member's own node_modules/.bin binary from a script that runs via the root package.json (squawk is not hoisted to the workspace root)"
    - "Comparison generator writes structural rows + placeholder disagreement blocks; hand-annotation is a separate commit, not re-generated"

key-files:
  created:
    - packages/automation/scripts/squawk-comparison.ts
    - docs/30-squawk-comparison.md
    - .planning/phases/03-safety-analyzer/COVERAGE.md
  modified:
    - packages/automation/package.json
    - package.json
    - packages/automation/tsconfig.json
    - tests/guardrails.test.ts
    - docs/decisions.md
    - .claude/CLAUDE.md

key-decisions:
  - "No squawk-correct gap found in this 49-file corpus run: every one of the 21 disagreements resolved to analyzer-correct (2) or different-by-design (19), so rules.json was not modified"
  - "squawk's static rule engine produced zero findings for adversarial/do-block-drop.sql, a real DROP TABLE hidden in a DO block -- the single most significant finding of the comparison, surfaced prominently rather than minimised"
  - "D16 recorded in docs/decisions.md as the project-level classification contract, carrying forward the zod-resolves-from-workspace-root gap as a named, undone Phase 7 task"
  - "sourceSurfaceFiles widened to cover packages/ with zero new allowlist exemptions needed -- packages/automation's code already satisfies every existing guardrail assertion"
  - ".claude/CLAUDE.md's stale libpg-query version (17.7.4) reconciled to 18.1.4, with the newer-grammar-is-the-safe-direction reasoning recorded rather than left as an unexplained discrepancy"

patterns-established:
  - "One-time calibration scripts live in a package's own scripts/ directory, are added to that package's tsconfig include for type-checking, and are never imported from src/ or a fast-suite test"

requirements-completed: [ANLZ-06]

coverage:
  - id: D1
    description: "squawk-cli installed as a devDependency of packages/automation, confirmed runnable on this Windows machine (squawk 2.64.0)"
    requirement: "ANLZ-06"
    verification:
      - kind: other
        ref: "pnpm --filter automation exec squawk --version"
        status: pass
    human_judgment: false
  - id: D2
    description: "Comparison generator runs both tools over the identical 49-file corpus and writes docs/30-squawk-comparison.md"
    requirement: "ANLZ-06"
    verification:
      - kind: other
        ref: "pnpm analyze:squawk-comparison"
        status: pass
      - kind: unit
        ref: "packages/automation/test/corpus.test.ts, packages/automation/test/rules-catalogue.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every one of the 21 disagreement rows carries a labelled explanation (analyzer-correct/squawk-correct/different-by-design) with a stated reason, and the do-block-drop finding is surfaced prominently"
    requirement: "ANLZ-06"
    verification: []
    human_judgment: true
    rationale: "Whether each explanation's reasoning is sound, and whether the squawk-favouring finding is genuinely surfaced prominently rather than buried, is a judgment call no automated check can make -- this is phase success criterion 5's own stated ask for human-read explanation."
  - id: D4
    description: "packages/ is inside tests/guardrails.test.ts's source surface with no weakened assertion"
    verification:
      - kind: unit
        ref: "tests/guardrails.test.ts (10/10 assertions)"
        status: pass
    human_judgment: false
  - id: D5
    description: "docs/decisions.md D16 records the classification contract, both deliberate exclusions, and the zod-resolution item as an open Phase 7 task"
    verification: []
    human_judgment: true
    rationale: "Whether the decision-log entry accurately and completely captures the analyzer's contract in the project's own house format is an editorial judgment, not something a test asserts."
  - id: D6
    description: ".planning/phases/03-safety-analyzer/COVERAGE.md declares no external API integration with its reason"
    verification:
      - kind: other
        ref: ".planning/phases/03-safety-analyzer/COVERAGE.md exists and contains the required declaration text"
        status: pass
    human_judgment: false

duration: ~50min
completed: 2026-09-08
status: complete
---

# Phase 3 Plan 7: Squawk Comparison and Phase Close-Out Summary

**squawk-cli cross-checked against the analyzer over 49 corpus files: 21 disagreements, all explained, zero squawk-favouring gaps found -- and squawk itself missed a real DROP TABLE hidden in a DO block that this analyzer's D-05 recursion caught.**

## Performance

- **Duration:** ~50 min (continuation session; resumed after a resolved package-legitimacy checkpoint)
- **Started:** ~2026-09-08T14:40:00Z (approximate -- continuation from a prior executor's checkpoint)
- **Completed:** 2026-09-08T15:26:18Z
- **Tasks:** 3
- **Files modified:** 10 (4 created, 6 modified)

## Accomplishments

- Installed `squawk-cli` as a `packages/automation`-only devDependency after the checkpoint's npm-listing approval, and confirmed the Windows x64 binary actually runs on this machine.
- Built `packages/automation/scripts/squawk-comparison.ts`: sources its file list from `loadCorpusManifest`, calls `analyzeSql` in-process for this analyzer's verdict, and spawns `squawk --reporter json --pg-version 17.0` per file via `execa` with `reject: false` so squawk's normal non-zero "violations found" exit is never treated as failure.
- Ran the comparison over all 49 corpus files and hand-examined every one of the 21 disagreements, labelling each analyzer-correct, squawk-correct, or different-by-design with a stated reason -- committed at `docs/30-squawk-comparison.md`.
- Widened `tests/guardrails.test.ts`'s `sourceSurfaceFiles` to cover `packages/`, closing a scope gap that predates this phase, with zero new allowlist exemptions needed.
- Recorded `docs/decisions.md` D16 (the safety analyzer's classification contract) and `.planning/phases/03-safety-analyzer/COVERAGE.md` (no external API integration).
- Reconciled `.claude/CLAUDE.md`'s stale stack-research version numbers and the still-open production-PostgreSQL-version question.

## Task Commits

Each task was committed atomically:

1. **Task 1: Install squawk-cli and build the comparison generator** - `a08f4b7` (feat)
2. **Task 2: Examine and explain every disagreement, and commit the report** - `ed47eb1` (docs)
3. **Task 3: Bring packages/ inside the guardrail scope, record D16, declare coverage** - `08572be` (feat)

**Plan metadata:** (this commit, following this summary)

_Note: the checkpoint (`squawk-cli` package-legitimacy confirmation) preceded Task 1 and was resolved by the user before this continuation session began -- see "Checkpoint Handling" below._

## Files Created/Modified

- `packages/automation/scripts/squawk-comparison.ts` - the D-15 comparison generator
- `docs/30-squawk-comparison.md` - the committed, fully-annotated comparison report
- `.planning/phases/03-safety-analyzer/COVERAGE.md` - the api-coverage seal-gate declaration
- `packages/automation/package.json` - `squawk-cli` devDependency
- `package.json` (root) - `analyze:squawk-comparison` script
- `packages/automation/tsconfig.json` - `include` widened to cover `scripts/**/*.ts`
- `tests/guardrails.test.ts` - `sourceSurfaceFiles` now covers `packages/`
- `docs/decisions.md` - new D16 entry, plus the PostgreSQL-version open question
- `.claude/CLAUDE.md` - stack table reconciled to `libpg-query` 18.1.4 and the version-gap note

## Decisions Made

- **No squawk-correct gap in this run.** Every disagreement resolved to analyzer-correct or different-by-design; `rules.json` was not modified. This is stated in the report as a claim about this 49-file corpus and this run, not a permanent guarantee squawk never catches anything this project's rules could miss.
- **The `do-block-drop.sql` finding is the report's headline result, not a footnote.** squawk produced zero findings -- not even its blanket session-timeout rules -- for a file containing a real, reachable `DROP TABLE` hidden inside a `DO` block's body. This is direct evidence that D-05's recursive PL/pgSQL inspection investment was necessary: an independent, widely-used linter misses the exact class of hazard that recursion exists to catch.
- **`prefer-bigint-over-int` and `prefer-robust-stmts` recorded as different-by-design, not squawk-correct.** Neither is a lock/rewrite/data-loss hazard (this catalogue's stated D-04 scope): the first is a schema-design capacity recommendation, the second is a rerun-idempotency concern this project's one-shot journal-tracked migration model does not need. Recorded with explicit reasoning rather than silently excluded.
- **D16 in `docs/decisions.md`** carries the zod-resolves-from-workspace-root gap forward as a named, undone Phase 7 task -- `packages/automation/package.json` does not declare `zod` (or `execa`, which this plan's own script also relies on resolving the same way) as its own dependency, resolving only via Node's directory walk-up to the workspace root. Marked open, not done.
- **Production's PostgreSQL major version is recorded as an explicit, still-UNKNOWN open question** in both `.claude/CLAUDE.md` and `docs/decisions.md` D16, with the reasoning for why Phase 3's `libpg-query` pg18 upgrade did not need to wait on it (a newer parser grammar is a near-superset of an older server's, so the failure direction is accepting syntax an older server would reject, never missing a real hazard).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] Widened `packages/automation/tsconfig.json`'s `include` to cover `scripts/**/*.ts`**
- **Found during:** Task 1
- **Issue:** The plan's success criteria requires `npx tsc --noEmit` clean in `packages/automation`, but the package's existing `tsconfig.json` only included `src/**/*.ts` and `test/**/*.ts` -- the new `scripts/squawk-comparison.ts` would never actually be type-checked, silently passing regardless of correctness.
- **Fix:** Added `"scripts/**/*.ts"` to the `include` array.
- **Files modified:** `packages/automation/tsconfig.json`
- **Verification:** `npx tsc --noEmit` inside `packages/automation` is clean with the new script in scope.
- **Committed in:** `a08f4b7` (Task 1 commit)

**2. [Rule 2 - Missing critical / CLAUDE.md enforcement] Reconciled `.claude/CLAUDE.md`'s stale Technology Stack entries**
- **Found during:** Task 3, per this plan's explicit "documentation debt to reconcile" instructions
- **Issue:** `.claude/CLAUDE.md`'s stack-research table still stated `libpg-query` 17.7.4 and gave no status on the production PostgreSQL major version, both stale relative to Phase 3's actual state (the package was upgraded to the pg18 line; the version gap remains genuinely open).
- **Fix:** Updated the version entries with the actual current values and the reasoning for why the pg18/PG17-dev mismatch is the safe direction, not an unexamined discrepancy; recorded the PostgreSQL-major-version gap as explicitly UNKNOWN with a cross-reference to `docs/decisions.md` D16 rather than leaving it silently stale.
- **Files modified:** `.claude/CLAUDE.md`
- **Verification:** Read the updated sections end to end; every claim traces to a real commit (`9f9ff0f`) or an explicit UNKNOWN, per `CLAUDE.md`'s own "mark unverified things UNKNOWN" non-negotiable.
- **Committed in:** `08572be` (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (2 missing critical / documentation debt)
**Impact on plan:** Both auto-fixes needed for the plan's own stated success criteria and its explicit documentation-debt instructions. No scope creep -- neither touches the analyzer's runtime behavior.

## Checkpoint Handling

The plan opened with a `checkpoint:human-verify` (`gate="blocking-human"`) gating the `squawk-cli` npm-listing confirmation before install. A prior executor ran up to this checkpoint and stopped, with no commits yet made for this plan. The user reviewed the npm listing (`github.com/sbdchd/squawk`, ~447k weekly downloads, `squawk-cli@2.64.0`, Windows x64 optional dependency confirmed) and replied "approved." This continuation session resumed at Task 1 per that approval -- documented here as normal flow, not a deviation.

## Issues Encountered

None. squawk's Windows binary ran correctly on the first attempt; no per-file `UNKNOWN` outcomes occurred (0 of 49 files).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 3 (safety analyzer) is now complete: 7/7 plans, `pnpm test` at 278/278 (up from the pre-phase baseline, no regressions), `tsc --noEmit` clean in `packages/automation`, corpus manifest at 49 rows, `rules.json` at 37 rules (unchanged this plan).
- `docs/30-squawk-comparison.md` and `docs/decisions.md` D16 give Phase 4 (migration runner) a durable, project-level record of the analyzer's classification contract to build against, without needing to re-read Phase 3's full planning history.
- **Open item for the owner, not decided here:** `DROP OWNED BY <role>` currently resolves REVIEW_REQUIRED via D-06's unmatched-statement default rather than the D-02 BLOCKED floor, despite dropping every object a role owns. Flagged as an observation in this plan's own phase-state context, not changed -- a genuine open question for whoever plans Phase 4 or a future Phase 3 hardening pass.
- **Open item for Phase 7's extraction:** `packages/automation/package.json` does not declare `zod` or `execa` as its own dependencies, relying on workspace-root resolution. Recorded in D16 as a named, undone task -- must be closed before the package is published or consumed outside this monorepo.
- **Open item, UNKNOWN:** production's PostgreSQL major version. Recorded explicitly in `.claude/CLAUDE.md` and `docs/decisions.md` D16; does not block Phase 4, but should be resolved before Phase 5 (CI) pins any environment-specific tooling.

## Self-Check: PASSED

- All 9 created/modified files confirmed present on disk (`packages/automation/scripts/squawk-comparison.ts`, `docs/30-squawk-comparison.md`, `.planning/phases/03-safety-analyzer/COVERAGE.md`, `docs/decisions.md`, `tests/guardrails.test.ts`, `packages/automation/package.json`, `package.json`, `packages/automation/tsconfig.json`, `.claude/CLAUDE.md`).
- All 3 task commits (`a08f4b7`, `ed47eb1`, `08572be`) confirmed present via `git log --oneline --all --grep="03-07"`.
- `docs/30-squawk-comparison.md` contains zero remaining `_TBD_` placeholders (21/21 disagreement rows annotated) and 22 occurrences of `different-by-design`, `analyzer-correct`, or `squawk-correct` labels.
- `docs/decisions.md` contains a `## D16` heading marked ACCEPTED.
- Re-ran plan-level `<verification>`: `pnpm test` 278/278 green; `pnpm analyze:squawk-comparison` produces 49 rows (matching `packages/automation/test/corpus/manifest.json`'s 49 entries); `tests/guardrails.test.ts` 10/10 with the widened scope and no weakened assertion; `.planning/phases/03-safety-analyzer/COVERAGE.md` exists with its reasoned declaration.
- `git rev-list --count 868e508..HEAD` = 3 (plan_head_before: `868e508`), matching `actuals.commits: 3` in this file's frontmatter.

---
*Phase: 03-safety-analyzer*
*Completed: 2026-09-08*
