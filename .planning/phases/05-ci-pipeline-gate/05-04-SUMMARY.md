---
phase: 05-ci-pipeline-gate
plan: 04
subsystem: infra
tags: [ci, tamper-detection, drizzle, git, vitest, append-only]

requires:
  - phase: 05-ci-pipeline-gate (05-03)
    provides: scripts/ci thin-adapter convention (execa + import.meta.main + process.exitCode,
      never process.exit()), and packages/automation's pure-core/thin-adapter barrel pattern
provides:
  - "scripts/ci/check-append-only.ts: parseNameStatus, assertMigrationFilesAppendOnly (D-09
    file-level), assertJournalEntriesAppendOnly (D-10 journal entry-level), runCheckAppendOnly"
  - "scripts/ci/check-schema-drift.ts: assertWorkingTreeClean, driftSignalFromPorcelain (D-09
    schema-drift, signal is file appearance not exit code)"
  - "Journal and JournalEntry exported from packages/automation/src/adapter/drizzle-migrations.ts
    and re-exported type-only from the barrel, so the CI checks and the runner adapter share one
    definition of a journal entry"
affects: [05-06 (wires tamper-checks job), 05-08 (ruleset application, criterion-1 merge attempt)]

actuals:
  tokens: 7084
  tasks: 3
  commits: 6
  plan_head_before: 51f883d9f1a7ed12612f0cc445af3b6edcb76a47

tech-stack:
  added: []
  patterns:
    - "Hard-fail-never-warn error messages naming the exact field, the exact value observed, and
      why it cannot be trusted -- mirrored from drizzle-migrations.ts's journal-integrity errors
      into two new scripts/ci checks"
    - "Fail-closed on unresolvable git state: an unresolvable PR_BASE_SHA/PR_HEAD_SHA, an
      unparseable base journal, or a dirty working tree before generation all throw rather than
      being read as 'no change'"
    - "Type-only barrel re-export sharing one definition of a journal entry (Journal/JournalEntry
      exported from the adapter, re-exported type-only from packages/automation/src/index.ts) so
      a CI script never re-declares a silently-divergable second copy"
    - "Drift/tamper signal is the appearance of a file in git's own state (git status
      --porcelain, git diff --name-status), never a child process's exit code"

key-files:
  created:
    - scripts/ci/check-append-only.ts
    - tests/ci/check-append-only.test.ts
    - scripts/ci/check-schema-drift.ts
    - tests/ci/check-schema-drift.test.ts
  modified:
    - packages/automation/src/adapter/drizzle-migrations.ts
    - packages/automation/src/index.ts

key-decisions:
  - "No production-code deviations from the plan -- all three tasks implemented exactly as
    specified, no Rule 1-4 auto-fixes needed."
  - "gsd_run check tdd-red-evidence cannot classify this repository's Vitest TAP output (both
    --reporter=tap and --reporter=tap-flat lack the `# tests N`/`# pass N`/`# fail N` summary
    footer the classifier's parser expects, which is Node's native --test format, not Vitest's).
    Every RED phase was verified manually instead: nonzero exit, the exact named target-test
    assertion(s) failing against a deliberate wrong-behavior stub, zero import/crash failures.
    Documented once here rather than per-commit; see Issues Encountered."

requirements-completed: [CI-05]

coverage:
  - id: D1
    description: "File-level append-only (D-09): a modified or deleted file under
      apps/recipe-app/drizzle/ fails; only additions pass; no exemption for reverts"
    requirement: "CI-05"
    verification:
      - kind: unit
        ref: "tests/ci/check-append-only.test.ts#assertMigrationFilesAppendOnly"
        status: pass
    human_judgment: false
  - id: D2
    description: "Journal entry-level append-only (D-10): a changed idx/tag/when, a disappeared
      entry, or a duplicated idx in the head journal all throw; reordering and appending a new
      idx both pass"
    requirement: "CI-05"
    verification:
      - kind: unit
        ref: "tests/ci/check-append-only.test.ts#assertJournalEntriesAppendOnly"
        status: pass
    human_judgment: false
  - id: D3
    description: "Schema drift (D-09): the drift signal is a file appearing in git status
      --porcelain after generation, never generation's own exit code"
    requirement: "CI-05"
    verification:
      - kind: unit
        ref: "tests/ci/check-schema-drift.test.ts#driftSignalFromPorcelain"
        status: pass
      - kind: integration
        ref: "pnpm exec tsx scripts/ci/check-schema-drift.ts (live run against the unchanged
          repository)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Fail-closed on an unresolvable diff: a missing PR_BASE_SHA/PR_HEAD_SHA throws
      naming fetch-depth before any git diff runs"
    requirement: "CI-05"
    verification:
      - kind: unit
        ref: "tests/ci/check-append-only.test.ts#runCheckAppendOnly -- env-var gate"
        status: pass
    human_judgment: true
    rationale: "Only the missing-env-var branch is unit tested. The git cat-file -e
      <sha>^{commit} SHA-resolvability check (the other half of fail-closed-on-unresolvable-diff)
      is implemented and code-reviewed but not unit tested, since exercising it would require
      mocking the execa/git subprocess boundary rather than driving pure synthetic strings --
      left for a human/verifier to confirm against the source directly (source: runCheckAppendOnly
      in scripts/ci/check-append-only.ts) or exercise live once plan 05-06 wires this into a real
      workflow with actions/checkout's real fetch-depth behavior."
  - id: D5
    description: "Schema-drift check refuses to run when the migrations directory is already
      dirty before generation, so a dirty tree can never be misread as no drift"
    requirement: "CI-05"
    verification:
      - kind: unit
        ref: "tests/ci/check-schema-drift.test.ts#assertWorkingTreeClean"
        status: pass
    human_judgment: false
  - id: D6
    description: "The journal shape (Journal/JournalEntry) has exactly one declaration in the
      repository -- the CI check imports it type-only from the package barrel"
    requirement: "CI-05"
    verification:
      - kind: other
        ref: "grep -Ev '^[[:space:]]*//' scripts/ci/check-append-only.ts | grep -Ec 'interface
          (Journal|JournalEntry)' returns 0; packages/automation/src/index.ts line 5 carries
          both types in the existing type-only re-export statement"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-09-09
status: complete
---

# Phase 5 Plan 4: Migration Tamper Detection Summary

**Two mechanical CI-05 checks -- git-diff-based append-only for migration files and journal
entries (D-09/D-10), and a git-status-based schema-drift signal (D-09) -- built entirely on the
existing pure-core/thin-adapter conventions, with zero new npm dependencies.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-09-09T11:53:47-04:00 (prior plan's completion commit)
- **Completed:** 2026-09-09T12:08:20-04:00 (last task commit)
- **Tasks:** 3
- **Files modified:** 6 (4 created, 2 modified)

## Accomplishments

- `scripts/ci/check-append-only.ts` exports `parseNameStatus` and
  `assertMigrationFilesAppendOnly`: any `git diff --name-status` entry under
  `apps/recipe-app/drizzle/` (excluding the journal, which the entry-level check owns) that is
  not status `A` throws, naming the exact path and status -- no allowlist, no revert exemption.
- The same file adds `assertJournalEntriesAppendOnly`: parses both journal versions (a parse
  failure on either side throws, naming which side), keys entries by `idx`, and throws on a
  changed `tag`/`when`, a disappeared entry, or a duplicated `idx` in the head journal --
  reordering and appending a higher `idx` both pass. Imports `Journal`/`JournalEntry` type-only
  through the `packages/automation` barrel rather than re-declaring the shape.
- `runCheckAppendOnly` resolves `PR_BASE_SHA`/`PR_HEAD_SHA` with `git cat-file -e
  <sha>^{commit}` before ever diffing, so an unresolvable commit (a shallow clone, RESEARCH.md
  Pitfall 3) fails closed instead of silently passing an empty diff; both journal versions are
  read via `git show <sha>:...` (git object storage, never the working tree).
- `scripts/ci/check-schema-drift.ts` exports `assertWorkingTreeClean` and
  `driftSignalFromPorcelain`: the drift signal is the appearance of a file in `git status
  --porcelain` taken after `pnpm db:generate` runs, never the generator's own exit code (verified
  live: exit 0 in both the no-drift case and, per RESEARCH.md's own session finding, the
  exit-code-does-not-distinguish-drift case). A dirty tree before generation refuses to run at
  all, naming the offending paths.
- `Journal`/`JournalEntry` promoted from unexported to exported interfaces in
  `drizzle-migrations.ts` (visibility only, zero field changes) and re-exported type-only from
  the barrel alongside `MigrationFile` -- one definition of a journal entry, shared by the
  runner's own adapter and this plan's new CI check.

## Task Commits

Both TDD tasks (RED-phase stub + test, then GREEN implementation) were committed atomically:

1. **Task 1: File-level append-only** -- `d6e2b6a` (test, RED) / `ac24718` (feat, GREEN)
2. **Task 2: Journal entry-level append-only** -- `908ccae` (test, RED) / `c221f4d` (feat, GREEN)
3. **Task 3: Schema drift** -- `87560c3` (test, RED) / `243d895` (feat, GREEN)

No REFACTOR commits were needed -- each GREEN implementation was already the intended final
shape; no post-hoc cleanup changed behavior.

**Plan metadata:** commit follows this SUMMARY.

## Files Created/Modified

- `scripts/ci/check-append-only.ts` -- both D-09/D-10 append-only checks, plus the
  `import.meta.main` entry point wiring them together against the environment's SHAs
- `tests/ci/check-append-only.test.ts` -- 18 synthetic-fixture tests covering both checks and
  the env-var fail-closed gate
- `scripts/ci/check-schema-drift.ts` -- the D-09 schema-drift check and its entry point
- `tests/ci/check-schema-drift.test.ts` -- 5 synthetic-fixture tests
- `packages/automation/src/adapter/drizzle-migrations.ts` -- `JournalEntry`/`Journal` gained the
  `export` keyword (visibility only)
- `packages/automation/src/index.ts` -- barrel's existing type-only re-export widened to carry
  `Journal`/`JournalEntry` alongside `MigrationFile`

## Decisions Made

None beyond what the plan already specified -- all three tasks (parseNameStatus/append-only,
journal entry-level comparison, schema-drift signal) were implemented exactly as designed in
`05-CONTEXT.md` D-09/D-10 and `05-RESEARCH.md`'s code sketches, using the established
`scripts/ci/*` thin-entry-point convention (`execa` + `import.meta.main` + `process.exitCode`
discipline, never `process.exit()`) and the `packages/automation` pure-core/thin-adapter barrel
pattern from prior phases.

## Deviations from Plan

None - plan executed exactly as written. No Rule 1-4 auto-fixes were needed in the production
code; the one process-level note (the TDD RED-evidence tooling gap) is documented under Issues
Encountered below, since it did not require changing any plan-specified behavior.

## Issues Encountered

- **`gsd_run check tdd-red-evidence` cannot classify this repository's Vitest TAP output.** Its
  summary parser (`parseNodeTestSummary`) looks for Node's native `--test` TAP footer lines
  (`# tests N`, `# pass N`, `# fail N`), which neither Vitest's `tap` nor `tap-flat` reporter
  emits (confirmed live for both). The classifier still correctly extracts every failing test
  name (including the exact target test) via `tapFailedTestNames`, but the missing footer makes
  `summary.tests` read as `0`, which the classifier's `zero_tests_discovered` branch treats as
  INVALID_RED even on a genuine, well-formed RED run. All three RED phases in this plan were
  verified manually instead: `pnpm exec vitest run --reporter=tap-flat <file>` exits 1, the
  specific behavior-block assertions fail with `AssertionError`s matching the planned
  wrong-vs-right behavior, and zero tests fail from an import/crash/collection error. This is a
  tooling gap in a shared dependency, not something in scope for this plan to fix, and is
  recorded here so a future plan touching TDD tooling has the concrete repro.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Both `scripts/ci` checks are ready for plan `05-06` to wire into the `tamper-checks` job in
  `.github/workflows/pr-gate.yml` -- they already read `PR_BASE_SHA`/`PR_HEAD_SHA` from the
  environment (never `process.argv`) per the established convention, and need only
  `fetch-depth: 0` and (for the drift check) `RECIPE_DEV_DATABASE_URL` set to a pin-satisfying
  value at the job level (RESEARCH.md Pitfall 5 -- the drift check's config module asserts the
  pin at load time even though it opens no socket).
- D4's coverage gap (the `git cat-file` SHA-resolvability path is implemented but not unit
  tested) is a reasonable target for a verifier or a future plan to exercise live once `05-06`'s
  real workflow run exists -- a real shallow-clone/fetch-depth misconfiguration is now
  observable, unlike a synthetic fixture for it.
- CI-05's REQUIREMENTS.md checkbox is NOT ticked by this plan alone: `05-06` and `05-08` also
  declare `CI-05` in their own frontmatter (the shared-requirement gate), so it marks complete
  only once every declaring plan has a SUMMARY.

## Self-Check: PASSED

- All 5 created/output files verified present on disk (`scripts/ci/check-append-only.ts`,
  `tests/ci/check-append-only.test.ts`, `scripts/ci/check-schema-drift.ts`,
  `tests/ci/check-schema-drift.test.ts`, this SUMMARY.md).
- All 6 task commit hashes verified present in `git log --oneline --all`.
- Every `<acceptance_criteria>` re-checked: exports present, `import.meta.main` present, no
  literal `process.exit(` or `drizzle-kit` strings in either script, no local
  `interface Journal`/`JournalEntry` re-declaration, `PR_BASE_SHA`-unset test asserts
  `fetch-depth` in its message.
- Plan-level `<verification>` re-run: `pnpm exec vitest run tests/ci/check-append-only.test.ts
  tests/ci/check-schema-drift.test.ts` -- 23/23 pass. `pnpm exec tsx
  scripts/ci/check-schema-drift.ts` -- exit 0 against the unchanged repository. `pnpm test` --
  514/514 (was 491/491 baseline + 23 new). `git status --porcelain apps/recipe-app/drizzle/` --
  empty.

---
*Phase: 05-ci-pipeline-gate*
*Completed: 2026-09-09*
