---
phase: 05-ci-pipeline-gate
plan: 03
subsystem: ci
tags: [github-actions, gh-cli, pull-request-comment, safety-analyzer, ci-gate]

requires:
  - phase: 05-ci-pipeline-gate (plan 02)
    provides: the public GitHub remote (origin), gh CLI authentication, Actions default workflow
      permission set to write
provides:
  - The repository's first GitHub Actions workflow (.github/workflows/pr-gate.yml), carrying one
    required-check job named `analyze`
  - A pure AnalysisResult[]/failure -> markdown renderer (packages/automation/src/render/pr-comment.ts),
    exported from the package barrel
  - The thin CI adapter (scripts/ci/analyze-gate.ts) that runs the analyzer, computes the D-07
    introduced/pre-existing split, posts the sticky PR comment, and derives the job exit code
  - Live-observed evidence (gh version, exact reported check name, github.sha behaviour, sticky-
    comment persistence) that plan 05-08's ruleset configuration can build on without guessing
affects: [05-04, 05-05, 05-06, 05-07, 05-08]

actuals:
  tokens: 8388
  tasks: 3
  commits: 3
plan_head_before: 762fe36

tech-stack:
  added: []
  patterns:
    - "pnpm exec <bin> ... over pnpm <script-name> ... when a child process's stdout must be
      parsed as data -- pnpm run prints a banner to stdout that pnpm exec does not."
    - "Pure renderer / thin adapter split (D-17): packages/automation/src/render/pr-comment.ts
      has zero I/O; every fetch/fs/gh call lives in scripts/ci/analyze-gate.ts."
    - "One process owns both the verdict and the report of the verdict (analyze-gate.ts), so the
      two can never disagree."

key-files:
  created:
    - .github/workflows/pr-gate.yml
    - packages/automation/src/render/pr-comment.ts
    - packages/automation/src/render/pr-comment.test.ts
    - scripts/ci/analyze-gate.ts
    - tests/ci/analyze-gate.test.ts
  modified:
    - packages/automation/src/index.ts

key-decisions:
  - "Fixed a real bug found on this plan's own real CI run: `execa(\"pnpm\", [\"db:analyze:migrations\", \"--json\"])` runs a package.json script via `pnpm run`, which prints a banner to stdout ahead of the actual JSON, breaking JSON.parse. Switched to `pnpm exec tsx packages/automation/src/cli.ts --migrations --json`, matching scripts/history-suite.ts's own established `pnpm exec` convention."
  - "Extracted commentBodyForAnalyzerRun as its own exported function so Task 3's verdict-vs-failure comment routing is unit-testable without spawning a real process."
  - "Task 1 deliberately shipped the proven verdict path only (no hostile-content escaping, no non-verdict handling); Task 3 added renderAnalyzerFailureComment and escapeForComment as its own commit, matching the plan's tracer-then-expand structure."

requirements-completed: [CI-01, CI-02, CI-04]

coverage:
  - id: D1
    description: "The analyzer's verdict reaches a pull request through one wired path: pure renderer -> thin adapter -> workflow job named analyze"
    requirement: CI-01
    verification:
      - kind: unit
        ref: "packages/automation/src/render/pr-comment.test.ts"
        status: pass
      - kind: unit
        ref: "tests/ci/analyze-gate.test.ts"
        status: pass
      - kind: other
        ref: "pnpm db:analyze:migrations --json exits 10 (REVIEW_REQUIRED) against the committed history, unchanged classification behaviour"
        status: pass
    human_judgment: false
  - id: D2
    description: "A BLOCKED verdict would fail the job (CI-02); REVIEW REQUIRED and SAFE pass it; a parse failure or an invalid rules file also fail the job but are reported distinctly from BLOCKED, never mislabelled as a destructive-migration verdict"
    requirement: CI-02
    verification:
      - kind: unit
        ref: "tests/ci/analyze-gate.test.ts#jobExitCodeForAnalyzerExit"
        status: pass
      - kind: unit
        ref: "tests/ci/analyze-gate.test.ts#commentBodyForAnalyzerRun (Task 3: non-verdict outcomes)"
        status: pass
      - kind: unit
        ref: "packages/automation/src/render/pr-comment.test.ts#renderAnalyzerFailureComment"
        status: pass
    human_judgment: false
  - id: D3
    description: "Hostile author-controlled content (backticks, pipes, angle brackets, a triple-fence sequence) in a path, rule id, or rationale cannot corrupt the rendered comment's structure on the public pull request"
    verification:
      - kind: unit
        ref: "packages/automation/src/render/pr-comment.test.ts#escapes hostile content in a rationale, a rule id, and a path without breaking the comment's structure"
        status: pass
    human_judgment: false
  - id: D4
    description: "A real pull request (Renkai7/database-automation#1) ran a required check named exactly `analyze`, the check reported SUCCESS against a REVIEW_REQUIRED history, and exactly one sticky comment (author github-actions) carried the complete findings across two pushes"
    requirement: CI-04
    verification:
      - kind: other
        ref: "gh pr checks 1 --json name,state (observed: [{\"name\":\"analyze\",\"state\":\"SUCCESS\"}])"
        status: pass
      - kind: other
        ref: "gh pr view 1 --json comments (single github-actions comment, same comment id across two successful runs)"
        status: pass
    human_judgment: true
    rationale: "Task 2's <verify> carries a <human-check> block requiring a human to visually confirm the rendered comment in a browser. Under this project's configured workflow.human_verify_mode=end-of-phase, that step is deferred to the phase-level UAT consolidation rather than performed synchronously by this executor -- this is the project's own designed behaviour, not a gap in this plan's own work. All automated evidence for the same claim is recorded above and passed."

duration: 45min
completed: 2026-09-09
status: complete
---

# Phase 5 Plan 3: CI Pipeline Gate -- Analyze Check Tracer Summary

**A real pull request against the new public GitHub remote ran a required `analyze` check that classified the whole committed migration history and posted the complete REVIEW_REQUIRED verdict as a single sticky comment, proven end-to-end on GitHub's own servers.**

## Performance

- **Duration:** 45 min
- **Started:** 2026-09-09T15:26:09Z
- **Completed:** 2026-09-09T16:11:00Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- Wired one complete path from the analyzer's `--json` output to a pull-request comment: a pure
  markdown renderer in `packages/automation`, a thin `gh`-shelling adapter in `scripts/ci`, and
  the repository's first GitHub Actions workflow declaring a single required job named `analyze`.
- Proved the whole chain on a real pull request (`Renkai7/database-automation#1`): the `analyze`
  check reported `SUCCESS` against the committed history's REVIEW_REQUIRED verdict, and a single
  sticky comment (rewritten in place across two pushes, never duplicated) carried every rule id
  and every rationale for `0001_busy_thunderbolt.sql` verbatim.
- Found and fixed a real bug live on that same CI run: `pnpm run <script>`'s banner text was
  corrupting the analyzer's JSON output before it ever reached `JSON.parse`.
- Expanded the renderer to cover the two non-verdict analyzer outcomes (parse failure, invalid
  rules file) with a heading that is asserted, by test, never to contain the word BLOCKED, and to
  escape hostile author-controlled content (backticks, pipes, angle brackets, a triple-fence
  sequence) so it cannot corrupt the rendered comment's structure on a public pull request.

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end "the analyzer's verdict reaches the pull request"** - `3f92517` (feat)
2. **Rule 1 bugfix (found live during Task 2's real-PR proof)** - `4a4f330` (fix)
3. **Task 3: The non-verdict outcomes and hostile content** - `bc4ba90` (feat)

**Plan metadata:** (this commit)

_Task 2 ("Prove the slice on a real pull request") produced no file changes to `main` -- its
output is the live observation recorded in this SUMMARY and the `docs`-free evidence trail below._

## Files Created/Modified

- `.github/workflows/pr-gate.yml` - the repository's first workflow file; one `analyze` job,
  plain `pull_request` trigger, explicit head-SHA checkout with `fetch-depth: 0`, `concurrency`
  cancel-in-progress, `pull-requests: write` scoped to the `analyze` job only.
- `packages/automation/src/render/pr-comment.ts` - pure `AnalyzedFile[] -> markdown` renderer;
  exports `PR_COMMENT_MARKER`, `renderPrComment`, `renderAnalyzerFailureComment`,
  `escapeForComment`, and the `AnalyzedFile` type. Zero I/O, imports only from `../types`.
- `packages/automation/src/render/pr-comment.test.ts` - fixture-driven proof: marker position,
  D-06 "never a summary" (every rule id/rationale verbatim), D-07 grouping, worst-verdict
  heading, zero-finding explicit statement, hostile-content escaping, and the failure-comment's
  BLOCKED-free heading.
- `scripts/ci/analyze-gate.ts` - the thin adapter: runs the analyzer via `pnpm exec tsx ...`,
  computes the introduced/pre-existing split from `git diff --name-only`, selects the renderer
  via `commentBodyForAnalyzerRun`, posts through `gh pr comment --edit-last --create-if-none`,
  and derives the job's exit code from `EXIT_CODES` via `jobExitCodeForAnalyzerExit`. Never calls
  `process.exit()`.
- `tests/ci/analyze-gate.test.ts` - table-driven `jobExitCodeForAnalyzerExit` over every
  `EXIT_CODES` value plus one unmapped value, `introducedMigrationPaths` over synthetic diff
  output, and `commentBodyForAnalyzerRun`'s verdict-vs-failure branching.
- `packages/automation/src/index.ts` (modified) - barrel re-exports `PR_COMMENT_MARKER`,
  `renderPrComment`, `renderAnalyzerFailureComment`, and the `AnalyzedFile` type, grouped near
  the existing `analyzeSql`/`types` exports rather than among the D-27 runner exports.

## Decisions Made

- **`pnpm exec` over `pnpm run` for anything whose stdout is parsed as data.** `pnpm
  db:analyze:migrations --json` (a `pnpm run` invocation of a package.json script) prints a
  `> package@version scriptname` banner to stdout ahead of the real output -- confirmed on both
  this repo's own Windows dev machine and the real `ubuntu-latest` Actions runner, and it was
  this plan's own first genuine CI failure (run `34372008995`, "Unexpected token '>' ... is not
  valid JSON"). Fixed by shelling out to `pnpm exec tsx packages/automation/src/cli.ts
  --migrations --json` directly, matching `scripts/history-suite.ts`'s own established `pnpm
  exec` convention.
- **`commentBodyForAnalyzerRun` extracted as its own exported function.** Keeps the
  verdict-vs-non-verdict comment-selection logic (Task 3) unit-testable without spawning a real
  `git`/`pnpm`/`gh` process, following this repo's own "verify, don't trust" testing discipline.
- **Task 1 shipped the proven verdict path only; Task 3 added `renderAnalyzerFailureComment` and
  `escapeForComment` in its own commit** -- deliberately following the plan's own
  tracer-then-expand task structure rather than front-loading Task 3's scope into Task 1.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `pnpm run`'s stdout banner corrupted the analyzer's JSON output**
- **Found during:** Task 2 (the real PR's first CI run, `34372008995`)
- **Issue:** `execa("pnpm", ["db:analyze:migrations", "--json"], { reject: false })` invokes the
  package.json script through `pnpm run`, which writes `> database-automation@ ...` / `> tsx
  packages/automation/src/cli.ts --migrations "--json"` to stdout before the script's own output.
  `JSON.parse` on that combined stdout threw `Unexpected token '>' ... is not valid JSON`, and the
  `analyze` job failed even though the analyzer itself correctly classified the history as
  REVIEW_REQUIRED.
- **Fix:** Replaced the invocation with `execa("pnpm", ["exec", "tsx",
  "packages/automation/src/cli.ts", "--migrations", "--json"], { reject: false })`. `pnpm exec`
  runs the named binary directly and never prints the script-run banner.
- **Files modified:** `scripts/ci/analyze-gate.ts`
- **Verification:** Reproduced live locally on Windows and on the real Actions runner before the
  fix; after the fix, both the local end-to-end run against PR #1 and the second/third real CI
  runs (`34372221847`, `34372375531`) succeeded with exit 0 and a correctly rendered comment.
- **Commit:** `4a4f330`

---

**Total deviations:** 1 auto-fixed (1 bug).
**Impact on plan:** The fix was necessary for the tracer's own success criterion (the `analyze`
check reporting `SUCCESS`) -- without it, every real PR run would fail regardless of the
committed history's actual classification. No scope creep; the fix is scoped to the exact
invocation this plan itself wrote in Task 1.

## Real Pull Request Evidence (Task 2)

Pull request `Renkai7/database-automation#1` ("05-03 tracer proof: analyze check on a real PR
(not for merge)"), branch `ci/05-03-tracer-proof`, opened against `main`, closed unmerged and
its branch deleted after this evidence was captured.

| Observation | Value |
|---|---|
| `gh --version` on the runner | `gh version 2.100.0 (2026-09-03)` |
| Reported check name (`gh pr checks --json name`) | `analyze` (exact match to the workflow job's `name:`) |
| Reported check state | `SUCCESS` |
| Job conclusion (`gh api .../runs/{id}`) | `success` / `completed` |
| Committed history's worst verdict during this run | `REVIEW_REQUIRED` (exit 10) -- D-06 correctly passed it |
| `github.sha` (run's own `head_sha`) vs `github.event.pull_request.head.sha` | **Identical** in every observed run (e.g. `2fef3843c3...` == `2fef3843c3...`) -- no divergence was observed. This workflow always pins `ref:` explicitly, so whether an unpinned checkout would have resolved differently was not tested; recording the observed equality honestly rather than inferring the pin was unnecessary. |
| Sticky-comment persistence | One comment (id `5604640056`, author `github-actions`) created on the second (first-successful) run and left with the same id across the third run -- no duplicate ever appeared, satisfying the plan's own backstop truth after two real pushes to the branch |
| Comment content | Contained `0001_busy_thunderbolt.sql` and its rule id `add-foreign-key-validated` verbatim, plus the complete findings for all five committed migrations |

**Note on the evidence trail:** before the second real CI run, this executor ran
`scripts/ci/analyze-gate.ts` locally (as its own end-to-end verification of the Rule-1 fix,
authenticated as the owner's own `gh` account) and posted one comment authored `Renkai7`. That
comment was deleted via the GitHub API once the real CI-authored comment existed, so the PR's
final comment history reflects only what the CI workflow itself produced. This is recorded here
for honesty about the exact sequence of events, not because it affected the workflow's own
correctness.

Assumptions A1/A2/A3 from `05-RESEARCH.md` are settled by this real run: A1 (gh preinstalled) --
confirmed, `gh 2.100.0`. A3 (required-check context equals job `name:`) -- confirmed, `analyze`
reported verbatim. A2 (default checkout ref) was not independently tested, since this workflow
always pins `ref:` explicitly (as the plan itself required) -- the observed value is that
`github.sha` equals the PR head SHA in every run watched.

## Issues Encountered

None beyond the Rule 1 bugfix documented above, which was resolved within this plan's own scope.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The `analyze` job's exact reported check name (`analyze`) is now confirmed, not guessed --
  plan `05-08`'s ruleset `required_status_checks` entry for it can be written verbatim.
- `renderPrComment`/`renderAnalyzerFailureComment`/`PR_COMMENT_MARKER`/`AnalyzedFile` are stable
  public exports other CI checks in this phase can build alongside without re-deriving the
  pure-renderer/thin-adapter seam.
- Plan `05-04` (tamper-checks: append-only + schema-drift) and later plans add jobs to the same
  `.github/workflows/pr-gate.yml` file; no changes to the `analyze` job itself should be needed.
- The Task 2 human-check (visually confirming the rendered comment in a browser) is deferred to
  the phase-level UAT consolidation per this project's `human_verify_mode: end-of-phase` config --
  flagged in this SUMMARY's `coverage` block (D4) for the verifier to route to a human.

---
*Phase: 05-ci-pipeline-gate*
*Completed: 2026-09-09*

## Self-Check: PASSED

- All 6 key files verified present on disk (`[ -f ]`).
- All 3 task commits (`3f92517`, `4a4f330`, `bc4ba90`) verified present in `git log`.
- Re-ran `pnpm exec vitest run packages/automation/src/render/pr-comment.test.ts
  tests/ci/analyze-gate.test.ts` -- 2 files, 23 tests, all passed.
- Re-ran `pnpm db:analyze:migrations --json` -- exit 10 (REVIEW_REQUIRED), unchanged
  classification behaviour.
- `pnpm test` (full fast suite): 48 files, 491 tests, all passed.
- Real pull request `Renkai7/database-automation#1` observed directly via `gh`: `analyze` check
  `SUCCESS`, single sticky `github-actions` comment across two real CI runs, closed unmerged.
