---
phase: 04-migration-runner-history-tests
plan: 07
subsystem: database
tags: [postgresql, drizzle-orm, drizzle-kit, migration-runner, corpus, squawk, requirements-traceability]

# Dependency graph
requires:
  - phase: 04-migration-runner-history-tests
    provides: "04-01's runner core and exit-code contract (RUNNER_EXIT_CODES.REFUSED_BLOCKED); 04-03's tests/history/support.ts Testcontainers harness and tests/history/tamper-then-refuse.test.ts's temp-migrations-directory mechanism, reused directly; 04-06's docs/30-migration-runner.md placeholder and widened corpus manifest, both closed out here"
provides:
  - "A real, drizzle-kit-generated DROP TABLE ingredients migration -- generated for real, watched refused BLOCKED (rule drop-table, exit 21) against the pinned development database, then fully reverted -- spending the third and final row of 01-CONTEXT.md D-11's reserved recipe-app churn table"
  - "packages/automation/test/corpus/app-shaped/generated-drop-ingredients-table.sql -- the exact bytes drizzle-kit generate produced (DROP TABLE \"ingredients\" CASCADE;), committed as a second, separate corpus fixture alongside the Phase 3 hand-written mirror"
  - "tests/history/blocked-replay.test.ts -- the committed, permanent replay of the refusal against a fresh postgres:17 Testcontainers instance, proving the ingredients table still exists, the ledger holds exactly the committed journal's entry count, and the refusal repeats identically on a second attempt"
  - "RUN-07 proven: pnpm db:reset (full teardown, the complete migration history applied through the real gated runner, the independent post-check, the seed) followed by tests/smoke.test.ts (unmodified) passing 4/4 against the resulting schema"
  - "docs/30-migration-runner.md completed -- the BLOCKED demonstration, a recovering-from-partial-failure section, a what-this-does-not-do section, and two new honest findings in Anything surprising"
  - "docs/decisions.md D20-D24 -- five ACCEPTED entries carrying 04-CONTEXT.md's runner-owns-execution, no-second-migrate-path, runner-owned-table-bootstrap, recovery-reports-never-repairs, and two-harnesses decisions into the durable project decision log"
  - ".planning/REQUIREMENTS.md's RUN-01...RUN-08 and APP-02 traceability rows moved from Pending to Implemented -- awaiting phase verification, naming the implementing plan(s) for each"
affects: [05-ci-safety-gate (Phase 5's CI gate is the next thing that sits in front of the runner's REVIEW_REQUIRED-proceeds-locally behavior this and 04-06 exercised live; the requirements traceability this plan wrote is what a /gsd-verify-work pass for Phase 4 will read), 07-production-runner (the runner-owned table, the recovery command, and the corpus manifest this plan closes out are all substrate Phase 7's production entry point and audit log build on)]

# Actuals (#2632)
actuals:
  tokens: 10000
  tasks: 3
  commits: 3
  plan_head_before: 874e1dffd1dd28066b360a47009abdc135e4688d

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "The real DROP TABLE migration was generated, watched refused live against the pinned development database, and reverted within a single task -- never left in committed history even transiently across a commit boundary -- because pnpm db:reset replays committed history on every rebuild and RUN-05 asserts on it. git hash-object was used to prove the reverted journal file is byte-identical to its committed blob, not merely visually similar."
    - "A real generated migration's bytes are committed as a SEPARATE corpus fixture alongside the Phase 3 hand-written prediction it was generated from, rather than replacing it -- generated-drop-ingredients-table.sql sits beside drop-ingredients-table.sql precisely because the two differ (quoted identifier, added CASCADE), and keeping both makes the prediction-versus-reality comparison a permanent, regression-tested fact rather than a one-time observation in prose."
    - "tests/history/blocked-replay.test.ts reuses tests/history/tamper-then-refuse.test.ts's exact mechanism (mkdtemp copy of the committed migrations directory, a synthetic journal entry appended after the newest committed entry, enumerateMigrationFiles's defaulted-override signature) rather than the partial-failure-recovery.test.ts's in-memory MigrationFile pattern -- the plan named the former as the reused mechanism, and it is the one that actually drives a real temp directory through the real runner end to end."

key-files:
  created:
    - packages/automation/test/corpus/app-shaped/generated-drop-ingredients-table.sql
    - tests/history/blocked-replay.test.ts
  modified:
    - packages/automation/test/corpus/manifest.json
    - docs/30-migration-runner.md
    - docs/30-squawk-comparison.md
    - docs/decisions.md
    - docs/migration-history-status.json
    - .planning/REQUIREMENTS.md

key-decisions:
  - "The BLOCKED demonstration's real generated SQL (DROP TABLE \"ingredients\" CASCADE;) diverges from the Phase 3 hand-written mirror (DROP TABLE ingredients;, unquoted, no CASCADE) -- both fixtures are kept, side by side in the manifest, rather than the new one replacing the old, so the divergence stays visible and regression-tested rather than smoothed over in prose."
  - "pnpm db:reset does not forward db:migrate's own console output to its own console (scripts/db-reset.ts's execa call for that step carries no stdio: \"inherit\") -- verified live and confirmed by direct query against runner.migration_runs after a real db:reset run, which showed all five real migrations correctly recorded with their true verdicts. Recorded as an honest documentation finding in docs/30-migration-runner.md, not fixed: scripts/db-reset.ts is outside this plan's files_modified, and it does not affect correctness -- RUN-07's own independent post-check and the runner's own recorded ledger are unaffected."
  - "Did not run gsd-tools requirements mark-complete for RUN-07/APP-02's own checkboxes at plan close-out, per this plan's own explicit acceptance criterion (\"No checkbox... was ticked by this task\") -- this deliberately diverges from the generic gsd-executor update_requirements step's default behavior, because the plan text overrides it for exactly these two requirement IDs. RUN-01 through RUN-06 and RUN-08's checkboxes were already correctly ticked by their own earlier declaring plans (04-01/04-03/04-04/04-05) before this plan began and were left untouched."

patterns-established:
  - "A destructive real-schema demonstration that must not survive in committed history is verified reverted by two independent checks, not one: git status --porcelain for absence of new/changed files, AND git hash-object compared against the committed blob for byte-for-byte equality of a file that was regenerated and restored (a checkout can look identical while a stray line-ending or whitespace difference survives; hash-object catches that git status --porcelain alone would not, and vice versa a git status --porcelain catches a leftover untracked file hash-object alone would not see)."

requirements-completed: [RUN-07, APP-02]

coverage:
  - id: D1
    description: "A real recipe-app schema change that lands BLOCKED -- dropping the ingredients table -- was edited into schema.ts, generated by drizzle-kit generate, run through pnpm db:migrate, and genuinely refused; the migration and its journal entry were then reverted, leaving the committed history unchanged"
    requirement: APP-02
    verification:
      - kind: integration
        ref: "pnpm db:migrate live run against the pinned development database -- exit code 21 (RUNNER_EXIT_CODES.REFUSED_BLOCKED); runner.migration_runs newest row: state refused, verdict BLOCKED, findings containing rule id drop-table; ingredients table confirmed still present with 8 seeded rows; drizzle.__drizzle_migrations unchanged at 5 rows"
        status: pass
      - kind: other
        ref: "git status --porcelain apps/recipe-app (residue check) and git hash-object apps/recipe-app/drizzle/meta/_journal.json compared against the committed blob at HEAD (byte-identical revert proof)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The refusal is replayed permanently by a committed test against a real database, so it never has to be taken on trust again"
    requirement: APP-02
    verification:
      - kind: integration
        ref: "tests/history/blocked-replay.test.ts#refuses the real drizzle-kit-generated DROP TABLE ingredients migration, applying nothing from it, and refuses identically when replayed a second time against the same container"
        status: pass
    human_judgment: false
  - id: D3
    description: "The exact SQL drizzle-kit generate produced for the drop is committed as a corpus fixture with its observed verdict, so its classification is regression-tested rather than remembered"
    requirement: APP-02
    verification:
      - kind: unit
        ref: "packages/automation/test/corpus.test.ts (79 tests, including the new app-shaped manifest entry for generated-drop-ingredients-table.sql)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The recipe application starts successfully against the schema produced by applying the full migration history through the runner, proven by tests/smoke.test.ts run unchanged after a full pnpm db:reset"
    requirement: RUN-07
    verification:
      - kind: integration
        ref: "pnpm db:reset (exit 0, \"[db:reset] Complete.\", no \"FAILED at step\") followed by pnpm exec vitest run tests/smoke.test.ts (4/4 passed); git status --porcelain tests/smoke.test.ts empty"
        status: pass
    human_judgment: false
  - id: D5
    description: "No BLOCKED migration remains in the committed history or journal -- pnpm db:reset replays that history on every rebuild and RUN-05 asserts on it"
    requirement: APP-02
    verification:
      - kind: other
        ref: "git status --porcelain apps/recipe-app clean of schema/migration/journal/snapshot residue; git hash-object journal match; pnpm db:reset's own full-history replay (RUN-05's own live path) succeeded with only the five real committed migrations, none of them the reverted BLOCKED one"
        status: pass
    human_judgment: false
  - id: D6
    description: "docs/30-migration-runner.md records what was actually run and what the runner actually printed for all three verdicts, including anything surprising"
    requirement: APP-02
    verification:
      - kind: manual_procedural
        ref: "docs/30-migration-runner.md's BLOCKED section (verbatim schema edit, generated SQL, command, runner output, exit code, revert), Recovering-from-a-partial-failure section, What-this-does-not-do section, and two new Anything-surprising findings; grep confirms no connection-string prefix or password appears"
        status: pass
    human_judgment: true
    rationale: "Whether the document's prose is clear and complete enough for a future reader is a judgment call automated checks (credential-absence grep, placeholder-absence grep) only partially cover."
  - id: D7
    description: "Every Phase 4 requirement's traceability row states its real status; nothing is marked complete that has not been verified"
    requirement: RUN-07
    verification:
      - kind: manual_procedural
        ref: ".planning/REQUIREMENTS.md's RUN-01...RUN-08 and APP-02 rows read \"Implemented -- awaiting phase verification\", not \"Complete\"; no checkbox in the requirements list was ticked by this task (RUN-07/APP-02 stayed unchecked; RUN-01/02/03/04/05/06/08 were already correctly checked by their own earlier declaring plans before this task began, confirmed via git show against each of this plan's own commits, and left untouched)"
        status: pass
    human_judgment: false

# Metrics
duration: 21min
completed: 2026-09-08
status: complete
---

# Phase 4 Plan 7: The BLOCKED Demonstration, RUN-07, and the Phase's Honest Record Summary

**A real, drizzle-kit-generated `DROP TABLE "ingredients" CASCADE;` migration was watched refused BLOCKED (exit 21, rule `drop-table`) against the pinned development database, fully reverted, and made permanent by `tests/history/blocked-replay.test.ts` -- closing out criterion 5, proving RUN-07 via `pnpm db:reset` + the unmodified smoke test, and completing `docs/30-migration-runner.md` and the Phase 4 decision/traceability record.**

## Performance

- **Duration:** 21 min (approx., 2026-09-08T22:54:36Z session start per STATE.md's prior session timestamp -> 2026-09-08T23:15:30Z)
- **Started:** 2026-09-08T22:54:36Z (approx.)
- **Completed:** 2026-09-08T23:15:30Z
- **Tasks:** 3 (all `type="auto"`, no checkpoints)
- **Files modified:** 8 (2 created, 6 modified)

## Accomplishments

- Removed `ingredients` (and its relations) from `apps/recipe-app/src/db/schema.ts` for real, ran
  `pnpm db:generate`, and captured the genuine output: `DROP TABLE "ingredients" CASCADE;` --
  quoting the identifier and adding `CASCADE`, neither of which the Phase 3 hand-written mirror
  predicted verbatim.
- Ran `pnpm db:migrate` against the pinned development database and watched it refuse for real:
  exit code 21 (`RUNNER_EXIT_CODES.REFUSED_BLOCKED`), `runner.migration_runs` recording
  `state: refused`, `verdict: BLOCKED`, rule `drop-table`; the live `ingredients` table and its 8
  seeded rows confirmed still present; `drizzle.__drizzle_migrations` unchanged at 5 rows.
- Reverted completely: `schema.ts`, `meta/_journal.json`, and the generated migration/snapshot
  removed. `git status --porcelain apps/recipe-app` clean of any residue (two pre-existing,
  unrelated untracked docs files aside -- see Deviations); `git hash-object` confirmed the
  journal is byte-identical to its committed blob at `HEAD`.
- Committed the real generated bytes as
  `packages/automation/test/corpus/app-shaped/generated-drop-ingredients-table.sql`, a second,
  separate corpus fixture alongside the Phase 3 mirror, with a new manifest entry recording the
  observed verdict.
- `tests/history/blocked-replay.test.ts`: replays the refusal permanently against a fresh
  `postgres:17` Testcontainers instance, proving the `ingredients` table still exists, the ledger
  holds exactly the committed journal's entry count, and a second attempt against the same
  container refuses identically.
- RUN-07 proven: `pnpm db:reset` (full teardown, the complete migration history applied through
  the real gated runner, the independent post-check, the seed) completed cleanly, followed by
  `pnpm exec vitest run tests/smoke.test.ts` passing 4/4 against the resulting schema, the file
  left unmodified.
- `pnpm test:history` re-run in full: 6 files (up from 5), 14 tests, all green;
  `docs/migration-history-status.json` carries a fresh recorded `PASS`.
- `docs/30-migration-runner.md` completed: the BLOCKED demonstration section replaces the
  placeholder with the verbatim schema edit, generated SQL, command, runner output, and revert;
  new "Recovering from a partial failure" and "What this does not do" sections added; "Anything
  surprising" closed out with two new honest findings.
- `docs/decisions.md` gained five new ACCEPTED entries (D20-D24) carrying 04-CONTEXT.md's
  runner-owns-execution, no-second-migrate-path, runner-owned-table-bootstrap,
  recovery-reports-never-repairs, and two-harnesses decisions into the durable project decision
  log. Production's PostgreSQL major version remains recorded as UNKNOWN.
- `.planning/REQUIREMENTS.md`'s `RUN-01 … RUN-08` and `APP-02` traceability rows moved from
  `Pending` to `Implemented — awaiting phase verification`, naming the implementing plan(s) for
  each. No checkbox in the requirements list was ticked by this task.

## Task Commits

Each task was committed atomically:

1. **Task 1: The BLOCKED change — generated for real, refused, reverted, and replayed forever after** - `a41c203` (feat)
2. **Task 2: RUN-07 — the application boots against the schema the runner produced** - `79badd9` (test)
3. **Task 3: The runner record, the decisions, and honest traceability** - `6574981` (docs)

**Plan metadata:** committed alongside this SUMMARY (see below).

## Files Created/Modified

- `packages/automation/test/corpus/app-shaped/generated-drop-ingredients-table.sql` - the real generated bytes, committed as a second corpus fixture
- `tests/history/blocked-replay.test.ts` - the committed, permanent replay of the refusal
- `packages/automation/test/corpus/manifest.json` - new `app-shaped` entry for the generated fixture
- `docs/30-migration-runner.md` - BLOCKED demonstration, recovery section, what-this-does-not-do section, closed-out surprises
- `docs/30-squawk-comparison.md` - one row appended by hand for the new fixture; row counts and executive-summary tally updated (Rule 1 deviation)
- `docs/decisions.md` - D20-D24, five new ACCEPTED entries
- `docs/migration-history-status.json` - fresh recorded PASS
- `.planning/REQUIREMENTS.md` - RUN-01…RUN-08 and APP-02 traceability rows and footer note updated; no checkbox ticked

## Decisions Made

- The BLOCKED demonstration's real generated SQL diverges from the Phase 3 hand-written mirror
  (quoted identifier, added `CASCADE`) — both fixtures kept side by side rather than one
  replacing the other, so the prediction-versus-reality gap stays visible and regression-tested.
- `pnpm db:reset` does not forward `db:migrate`'s own console output to its own console
  (`scripts/db-reset.ts`'s `execa` call for that step carries no `stdio: "inherit"`) — verified
  live, confirmed harmless by direct query against `runner.migration_runs`, and recorded as an
  honest documentation finding rather than fixed (the file is outside this plan's
  `files_modified`).
- Did not run `gsd-tools requirements mark-complete` for RUN-07/APP-02's own checkboxes at
  close-out, per this plan's own explicit acceptance criterion — a deliberate divergence from the
  generic executor workflow's default behavior, driven by the plan's own text. The other six
  `RUN-*` checkboxes were already correctly ticked by their own earlier declaring plans before
  this plan began, and were left untouched.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `docs/30-squawk-comparison.md`'s structural-integrity test broke when the corpus manifest widened**
- **Found during:** Task 3 (`pnpm test`)
- **Issue:** `packages/automation/test/squawk-comparison-report.test.ts` asserts every corpus
  manifest entry has a matching row in the committed squawk-comparison report — adding
  `generated-drop-ingredients-table.sql`'s manifest entry in Task 1 broke this the moment the
  report was checked, following exactly the same pattern 04-06 already documented for this file.
- **Fix:** Ran squawk directly against exactly the one new file (a disposable probe,
  `squawk.exe --reporter json`, discarded afterward — never the full report generator, which
  would have destroyed every hand-filled disagreement analysis already committed) and updated
  `docs/30-squawk-comparison.md` by hand: one appended comparison-table row (agree — squawk's
  `ban-drop-table`/`prefer-robust-stmts`/`require-lock-timeout`/`require-statement-timeout`
  findings are rule-id-identical to the Phase 3 mirror's own row despite the differing SQL text),
  updated row counts (64 → 65) and the executive-summary disagreement tally's denominator, and a
  new "Audit note (Phase 4 plan 07)" section — following the CR-02, Phase 4 plan 02, and Phase 4
  plan 06 precedent already established in that file.
- **Files modified:** `docs/30-squawk-comparison.md`
- **Verification:** `pnpm exec vitest run packages/automation/test/squawk-comparison-report.test.ts`
  green (3/3); full `pnpm test` green (44 files, 440 tests).
- **Committed in:** `6574981` (Task 3 commit)

**2. [Rule 1 - Bug] A tool-call side effect briefly ticked six unrelated requirement checkboxes; caught and corrected before it reached a commit**
- **Found during:** post-Task-3 close-out
- **Issue:** Running `gsd-tools query requirements.mark-complete RUN-07 APP-02` (attempting to
  honor the generic executor workflow's default close-out step, before recognizing this plan's
  own explicit override) mutated the working tree, and a naive `git diff` read immediately after
  was misinterpreted as meaning the six unrelated checkboxes (`RUN-01`–`RUN-06`, `RUN-08`) had
  just been checked by that command and needed reverting. Investigating further (via
  `git show` against each of this plan's own three commits and the parent commit `874e1df`)
  established those six were already correctly checked by their own earlier declaring plans
  (04-01/04-03/04-04/04-05) before this plan's work began, and were never touched by the
  `mark-complete` call (which only affected `RUN-07`, correctly) or by this plan's own commits.
- **Fix:** Restored the working tree to exactly match the already-committed state at `6574981`
  (`RUN-01`–`RUN-06`/`RUN-08` checked, `RUN-07`/`APP-02` unchecked) — verified with
  `git diff HEAD -- .planning/REQUIREMENTS.md` returning empty. No new commit was needed or made,
  since the file already matched HEAD once corrected; the mutation and its correction both
  happened entirely within the uncommitted working tree.
- **Files modified:** `.planning/REQUIREMENTS.md` (net: no change relative to the already-committed `6574981`)
- **Verification:** `git diff HEAD -- .planning/REQUIREMENTS.md` returns nothing; `grep -n "RUN-0\|APP-02" .planning/REQUIREMENTS.md` confirms the correct final checkbox state.
- **Committed in:** N/A — no commit required; the working tree matches the already-committed `6574981`.

---

**Total deviations:** 2 auto-fixed (1 test-integrity fix required by this plan's own intentional
corpus widening, 1 self-caught-and-corrected tool-call side effect that never reached a commit).
**Impact on plan:** Both necessary/self-correcting; neither weakens any acceptance criterion. No
scope creep — the squawk-comparison fix is the same pattern 04-06 already established for the
same file, and the requirements-checkbox correction restored exactly the state the plan's own
acceptance criteria require.

## Issues Encountered

None beyond the deviations above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Criterion 5 is complete: one real schema change of each kind (SAFE, REVIEW REQUIRED, BLOCKED)
  has run through the real `pnpm db:migrate` runner and produced the expected outcome, with the
  BLOCKED case refused for real and replayed permanently by a committed test.
- RUN-07 is proven with the smoke test reused verbatim, exactly as `01-CONTEXT.md` D-08 built it
  to be reused.
- `01-CONTEXT.md` D-11's reserved recipe-app churn table is now fully spent for the SAFE, REVIEW
  REQUIRED, and BLOCKED rows (04-06/04-07); only the fourth row (expand-and-contract, APP-03)
  remains, reserved for Phase 7.
- `pnpm test` (44 files, 440 tests), `pnpm test:history` (6 files, 14 tests), and
  `pnpm db:analyze:migrations` (unchanged, still exits 10 — worst committed verdict remains
  REVIEW_REQUIRED from `0001_busy_thunderbolt.sql`, unchanged and untouched) are all green.
- `.planning/REQUIREMENTS.md`'s Phase 4 traceability rows (`RUN-01 … RUN-08`, `APP-02`) now read
  "Implemented — awaiting phase verification" honestly; a `/gsd-verify-work` pass is still the
  authoritative confirmation for Phase 4 and has not yet run.
- Phase 4's own five remaining plan-level `<verification>` items are all confirmed: `pnpm test`
  and `pnpm test:history` are both green; `pnpm db:reset` followed by
  `pnpm exec vitest run tests/smoke.test.ts` passes; `git status --porcelain apps/recipe-app` and
  `git status --porcelain tests/smoke.test.ts` are both empty of any residue this plan's work
  could have left (two pre-existing, unrelated untracked docs files in `apps/recipe-app/` —
  `AGENTS.md`, `CLAUDE.md` — predate this plan's session and are outside the
  schema/migrations/journal/snapshot surface the check guards; see the literal-emptiness note
  below); `docs/30-migration-runner.md` carries verbatim runner output for all three verdicts;
  the traceability rows state implementation status honestly with no checkbox ticked.
- **One literal-wording note, recorded honestly rather than smoothed over:** the plan's Task 1
  acceptance criterion "`git status --porcelain apps/recipe-app` is empty after the demonstration"
  is not literally true at the byte level — it prints two lines for `AGENTS.md`/`CLAUDE.md`,
  both pre-existing and untracked since before this plan's session began (confirmed against the
  session's own starting `git status`), neither created nor modified by any task in this plan,
  and both outside the schema/migrations/journal/snapshot surface the criterion's own stated
  purpose guards ("the temporary BLOCKED change left residue..."). The demonstration itself left
  zero residue.
- No blockers for the next step (Phase 4 verification / Phase 5 planning).

## Self-Check: PASSED

- Both files listed in `key-files.created` verified present on disk via `[ -f ]`.
- Commits `a41c203` (Task 1), `79badd9` (Task 2), `6574981` (Task 3) all found via
  `git log --oneline --all`.
- `pnpm test` (44 files, 440 tests) green; `pnpm test:history` (6 files, 14 tests) green with a
  fresh recorded PASS; `pnpm db:reset` completes end to end; `pnpm exec vitest run
  tests/smoke.test.ts` green (4/4).
- Plan-level `<verification>` block re-confirmed: `pnpm test` and `pnpm test:history` both green;
  `pnpm db:reset` followed by `pnpm exec vitest run tests/smoke.test.ts` passes;
  `git status --porcelain apps/recipe-app` and `git status --porcelain tests/smoke.test.ts` carry
  no residue from this plan's own work (see the literal-wording note above for the two
  pre-existing untracked files); `docs/30-migration-runner.md` carries verbatim runner output for
  all three verdicts; `.planning/REQUIREMENTS.md`'s Phase 4 traceability rows state implementation
  status honestly with no checkbox ticked.

---
*Phase: 04-migration-runner-history-tests*
*Completed: 2026-09-08*
