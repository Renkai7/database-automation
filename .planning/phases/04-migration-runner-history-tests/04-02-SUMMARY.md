---
phase: 04-migration-runner-history-tests
plan: 02
subsystem: database
tags: [postgresql, libpg-query, safety-analyzer, floor, vitest]

# Dependency graph
requires:
  - phase: 04-migration-runner-history-tests
    provides: "04-01's runner core (packages/automation/src/runner/*) -- this plan does not touch it, but plan 04-04 (transaction-policy.ts) consumes the transactionHostile fact this plan adds"
provides:
  - "StatementFacts.transactionHostile (D-10) and StatementFacts.disarmsTimeout (D-17) -- the analyzer's fact vocabulary the runner reads instead of keeping its own keyword list"
  - "Seven new inspector-recognised statement kinds: Vacuum, AlterSystem, CreateDatabase, Reindex, SetGuc, AlterDatabaseSet, AlterRoleSet"
  - "D17_FLOOR_FACTS -- the widened, un-editable code floor covering every timeout-disarm scope (session/cluster/database/role), per the checkpoint decision cover-all-scopes"
  - "disarms-timeout-guc, set-guc-non-timeout, vacuum-in-migration, create-database-in-migration, reindex-in-migration rules (rules.json v2)"
  - "docs/decisions.md D17/D18/D19 -- the widened floor's definition, the deliberate idle_in_transaction_session_timeout exclusion, and the pinned runner timeout values plan 04-04 implements"
affects: [04-04-transaction-policy-and-timeouts (consumes transactionHostile directly, never re-derives it), 07-production-runner (inherits the database-/role-scoped floor coverage)]

# Actuals (#2632)
actuals:
  tokens: 21490
  tasks: 4
  commits: 3
  plan_head_before: 0c8898d0c8a1a89e9c72d9e5f2f18b3d78e2c6d1

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Floor decision groups labelled by name (D-02/D-07/D-17) in assertFloorNotWeakened's error message, not just by statementKind -- so a future violation names which decision it breaks, matching floor.ts's own established D02/D07-are-kept-distinct discipline extended to a third decision."
    - "A shared setstmtDisarmsTimeout helper factors the identical VariableSetStmt-shaped disarm test across VariableSetStmt, AlterSystemStmt.setstmt, AlterDatabaseSetStmt.setstmt and AlterRoleSetStmt.setstmt -- one place decides 'does this GUC-set disarm a timeout', never a per-scope copy."
    - "A rule can deliberately match on a single boolean fact alone (disarms-timeout-guc: { disarmsTimeout: true }), not on statementKind, when the fact itself -- not the statement kind that produced it -- is the actual hazard; this is the first rule in the catalogue to do so."

key-files:
  created:
    - packages/automation/test/transaction-hostile.test.ts
    - packages/automation/test/timeout-disarm-floor.test.ts
    - packages/automation/test/corpus/adversarial/set-lock-timeout-in-do-block.sql
    - packages/automation/test/corpus/adversarial/comment-mentions-set-lock-timeout.sql
    - packages/automation/test/corpus/blocked/reset-all.sql
    - packages/automation/test/corpus/blocked/alter-system-set-statement-timeout.sql
    - packages/automation/test/corpus/blocked/alter-database-set-lock-timeout.sql
    - packages/automation/test/corpus/usually-safe/create-index-concurrently-standalone.sql
    - packages/automation/test/corpus/review-required/set-search-path.sql
    - packages/automation/test/corpus/review-required/vacuum-analyze.sql
    - packages/automation/test/corpus/review-required/create-database.sql
    - packages/automation/test/corpus/review-required/reindex-index.sql
  modified:
    - packages/automation/src/types.ts
    - packages/automation/src/inspector/inspect.ts
    - packages/automation/src/classifier/floor.ts
    - packages/automation/src/rules/rules.json
    - packages/automation/test/inspector-facts.test.ts
    - packages/automation/test/rules-catalogue.test.ts
    - packages/automation/test/corpus.test.ts
    - packages/automation/test/corpus/manifest.json
    - docs/decisions.md
    - docs/30-squawk-comparison.md

key-decisions:
  - "User checkpoint decision (Task 2): D-17's widened floor covers EVERY scope (session, cluster, database, role) -- cover-all-scopes, not session-scope-only. ALTER DATABASE ... SET / ALTER ROLE ... SET are floored, not recorded as a gap, precisely because they are the MORE dangerous forms (they persist beyond the migration's own session)."
  - "Deviation (Rule 1): D06_UNMATCHED_CANARY_FACTS gained a transactionHostile:true canary but deliberately NOT a disarmsTimeout:true one. disarms-timeout-guc matches disarmsTimeout:true unconditionally by design (the plan's own action text), which makes that combination a genuinely catalogued BLOCKED case -- adding it as a canary would make assertUnmatchedDefaultsToReview reject the shipped rules file itself at load time (proven live before the fix: classifyFacts returned BLOCKED, not REVIEW_REQUIRED). Mirrors the file's own pre-existing nestingLimitExceeded exclusion. Recorded as WINDOWS.md unmet-truth #4 against the plan's literal must_haves wording, with equivalent enumeration-exploit coverage proven instead via timeout-disarm-floor.test.ts's tampering tests."
  - "docs/30-squawk-comparison.md was hand-updated (10 new rows appended, disagreement analysis for 5 of them, executive-summary counts recomputed) against a live squawk run over exactly the 10 new files -- never a full regeneration, which the file's own committed history shows destroys prior hand-filled disagreement explanations."
  - "Four extra corpus fixtures beyond the plan's explicit six (set-search-path.sql, vacuum-analyze.sql, create-database.sql, reindex-index.sql) added under Rule 2 -- required by corpus.test.ts's own pre-existing rule-coverage-completeness check for set-guc-non-timeout/vacuum-in-migration/create-database-in-migration/reindex-in-migration, which the plan's fixture list did not otherwise exercise."

patterns-established:
  - "A load-time self-check (assertFloorNotWeakened / assertUnmatchedDefaultsToReview) can conflict with a literal plan instruction when a new floor rule and a new canary target the identical fact combination -- resolve by checking live against the real classifyFacts before committing either, and follow the file's own established exclusion precedent (nestingLimitExceeded) rather than shipping a rules file that cannot load."

requirements-completed: [RUN-02]

coverage:
  - id: D1
    description: "The inspector recognises all seven previously-unnamed statement kinds (Vacuum, AlterSystem, CreateDatabase, Reindex, SetGuc, AlterDatabaseSet, AlterRoleSet) and carries transactionHostile/disarmsTimeout as observable StatementFacts, including through DO-block/function-body nesting"
    requirement: RUN-04
    verification:
      - kind: unit
        ref: "packages/automation/test/transaction-hostile.test.ts"
        status: pass
      - kind: unit
        ref: "packages/automation/test/inspector-facts.test.ts#every existing statement kind carries disarmsTimeout:false by default, and transactionHostile:false except the pre-existing CONCURRENTLY forms"
        status: pass
    human_judgment: false
  - id: D2
    description: "The code floor widens to 'irreversible data loss or self-disarming' -- a migration disarming lock_timeout/statement_timeout at any scope (session/cluster/database/role) is BLOCKED with no rules-file override, per the user's cover-all-scopes checkpoint decision"
    requirement: RUN-02
    verification:
      - kind: unit
        ref: "packages/automation/test/timeout-disarm-floor.test.ts"
        status: pass
      - kind: unit
        ref: "packages/automation/test/rules-catalogue.test.ts#04-02-PLAN.md task 3: the widened floor's new rule ids (D-17)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A matched adversarial pair proves the disarm rule's nested coverage (DO-block recursion) and false-positive resistance (comment/dollar-quoted mention is inert) are structural, not assumed -- and RESET ALL's no-name-field edge case is caught"
    verification:
      - kind: integration
        ref: "packages/automation/test/corpus.test.ts"
        status: pass
      - kind: e2e
        ref: "pnpm db:analyze packages/automation/test/corpus/blocked/reset-all.sql (exit 20)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The floor's stated definition ('irreversible data loss or self-disarming') is recorded as a principle in docs/decisions.md (D17/D18/D19) and in floor.ts's own header, so a future candidate is judged against the reasoning rather than an enumerated list"
    human_judgment: true
    rationale: "Documentation quality and whether the recorded principle genuinely reads as judgeable-against is a human-legibility question, not something a test asserts."

# Metrics
duration: 22min
completed: 2026-09-08
status: complete
---

# Phase 4 Plan 2: Transaction-Hostile and Timeout-Disarm Analyzer Facts Summary

**The analyzer now recognises seven previously-unnamed PostgreSQL statement kinds, carries `transactionHostile`/`disarmsTimeout` as first-class facts (surviving DO-block nesting), and its code floor widens to "irreversible data loss or self-disarming" -- covering every timeout-disarm scope including `ALTER DATABASE`/`ALTER ROLE ... SET`, per the user's explicit checkpoint decision.**

## Performance

- **Duration:** 22 min (16:55 start, checkpoint pause for Task 2's human decision, resumed and completed by 17:17)
- **Started:** 2026-09-08T20:55:00Z (approx.)
- **Completed:** 2026-09-08T21:17:00Z
- **Tasks:** 4 (2 auto/tdd, 1 checkpoint:decision, 1 auto)
- **Files modified:** 22 (12 created, 10 modified)

## Accomplishments

- `StatementFacts` gains `transactionHostile` (D-10) and `disarmsTimeout` (D-17), both defaulting `false`; `StatementKind` gains `Vacuum`, `AlterSystem`, `CreateDatabase`, `Reindex`, `SetGuc`, `AlterDatabaseSet`, `AlterRoleSet` -- seven new inspector dispatch branches plus a shared `setstmtDisarmsTimeout` helper covering all four `VariableSetStmt`-shaped disarm sites, with `VAR_RESET_ALL` treated as unconditionally disarming (no `name` field read at all).
- The existing `CreateIndex`/`DropIndex` `CONCURRENTLY` paths were extended (not replaced) to also set `transactionHostile`.
- The code floor widened: `D17_FLOOR_FACTS` (`SetGuc`, `AlterSystem`, `AlterDatabaseSet`, `AlterRoleSet`, all with `disarmsTimeout: true`) joins `assertFloorNotWeakened` alongside D-02/D-07, each floor violation's error message now names which decision it belongs to. Per the user's explicit checkpoint decision (**cover-all-scopes**), the database- and role-scoped forms are floored, not recorded as a gap.
- `rules.json` (bumped to v2) gains `disarms-timeout-guc` (BLOCKED, matches `disarmsTimeout: true` alone -- deliberately not on `statementKind`, so it covers every disarming form and any future one), `set-guc-non-timeout`, `vacuum-in-migration`, `create-database-in-migration`, `reindex-in-migration`.
- A matched adversarial pair (`adversarial/set-lock-timeout-in-do-block.sql` / `comment-mentions-set-lock-timeout.sql`) proves D-05's existing recursion catches a `SET lock_timeout` hidden inside a `DO` block, and that the same text appearing only in a comment and a dollar-quoted string literal is inert -- both live-verified via `analyzeSql` before being committed to the manifest.
- `docs/decisions.md` gained D17 (the widened floor definition), D18 (`idle_in_transaction_session_timeout` deliberately not set/floored, with reason), and D19 (the pinned runner timeout values, recorded here for plan 04-04 to implement).
- `docs/30-squawk-comparison.md` hand-updated with 10 new rows and disagreement analysis against a live squawk run, never a full regeneration (which would have destroyed the 20+ existing hand-filled explanations) -- this establishes squawk has **no rule at all** watching for a migration disarming its own session timeouts, a second independently-confirmed gap alongside the already-documented DO-block-recursion gap.

## Task Commits

Each task was committed atomically:

1. **Task 1: The seven statement kinds the inspector has never named, and the two facts they carry** - `064b469` (feat)
2. **Task 2: Decision gate -- widening the code floor is one-way in intent** - human decision only, no code, no commit (resolved: `cover-all-scopes`)
3. **Task 3: The widened floor, the rules that express it, and the canary set that keeps the new fields honest** - `a8d90d2` (feat)
4. **Task 4: The adversarial pair and the corpus entries that make nested coverage structural** - `e45b549` (test)

**Plan metadata:** committed alongside this SUMMARY (see below).

## Files Created/Modified

- `packages/automation/src/types.ts` - `transactionHostile`/`disarmsTimeout` fields, seven new `StatementKind` members
- `packages/automation/src/inspector/inspect.ts` - seven new dispatch branches, shared `setstmtDisarmsTimeout` helper, extended `CreateIndex`/`DropIndex` paths
- `packages/automation/src/classifier/floor.ts` - `D17_FLOOR_FACTS`, decision-labelled `assertFloorNotWeakened`, widened header comment, `transactionHostile` canary (and the documented `disarmsTimeout` exclusion)
- `packages/automation/src/rules/rules.json` (v2) - five new rules
- `docs/decisions.md` - D17/D18/D19
- `docs/30-squawk-comparison.md` - 10 new rows, 5 new disagreement analyses, recomputed executive-summary counts
- `packages/automation/test/transaction-hostile.test.ts`, `packages/automation/test/timeout-disarm-floor.test.ts` - new test files, every `<behavior>` row from Tasks 1/3
- `packages/automation/test/inspector-facts.test.ts`, `packages/automation/test/rules-catalogue.test.ts`, `packages/automation/test/corpus.test.ts`, `packages/automation/test/corpus/manifest.json` - extended coverage
- 12 new `.sql` corpus fixtures under `packages/automation/test/corpus/{adversarial,blocked,usually-safe,review-required}/`

## Decisions Made

- **User checkpoint decision (Task 2):** cover-all-scopes -- the database- and role-scoped disarm forms are floored, not recorded as a gap.
- Four extra corpus fixtures beyond the plan's explicit six, required by the pre-existing rule-coverage-completeness check.
- `docs/30-squawk-comparison.md` updated by hand, never regenerated wholesale.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `D06_UNMATCHED_CANARY_FACTS` cannot literally gain a `disarmsTimeout: true` canary without breaking the load-time self-check**
- **Found during:** Task 3
- **Issue:** The plan's own action text instructs adding both a `transactionHostile: true` and a `disarmsTimeout: true` entry to `D06_UNMATCHED_CANARY_FACTS`. The same task also instructs adding `disarms-timeout-guc`, matching `{ disarmsTimeout: true }` unconditionally (deliberately, not on `statementKind`). Verified live before making a choice: `classifyFacts({...EMPTY_FACTS, statementKind:"Unrecognized", disarmsTimeout:true}, rules)` returns `BLOCKED` (via `disarms-timeout-guc`), not `REVIEW_REQUIRED`. `assertUnmatchedDefaultsToReview` requires exactly `REVIEW_REQUIRED` for every canary, so including this entry would make `loadDefaultRules()` throw at import time -- breaking the CLI, every test, and the app.
- **Fix:** Added the `transactionHostile: true` canary (safe -- no rule matches on it alone, verified live it resolves `REVIEW_REQUIRED`). Did NOT add the `disarmsTimeout: true` canary, following the file's own pre-existing precedent (`nestingLimitExceeded` is excluded for the identical reason: paired with `statementKind: "Unrecognized"` it is a genuinely catalogued BLOCKED case, not an unmatched one). Documented in floor.ts's own comment, in `docs/decisions.md` D17, and recorded as `WINDOWS.md` unmet-truth #4 for transparency against the plan's literal wording.
- **Files modified:** `packages/automation/src/classifier/floor.ts`
- **Verification:** `timeout-disarm-floor.test.ts`'s three tampering tests (weakened verdict, deleted row, enumeration exploit over `disarmsTimeout`) and `rules-catalogue.test.ts`'s parallel enumeration exploit over `transactionHostile` both prove the underlying safety property (no rules-file edit can grant blanket non-BLOCKED/non-REVIEW_REQUIRED coverage) holds for both new fields, just via different, appropriately-targeted tests rather than a single shared canary mechanism for both.
- **Committed in:** `a8d90d2` (Task 3 commit)

**2. [Rule 2 - Missing Critical] Four corpus fixtures beyond the plan's explicit six, required for rule-coverage completeness**
- **Found during:** Task 4
- **Issue:** `corpus.test.ts`'s pre-existing "every rule id in rules.json appears in at least one manifest row" check failed after Task 3's four REVIEW_REQUIRED rules (`set-guc-non-timeout`, `vacuum-in-migration`, `create-database-in-migration`, `reindex-in-migration`) landed with no corpus fixture exercising them -- the plan's own Task 4 fixture list did not include one for any of the four.
- **Fix:** Added `review-required/set-search-path.sql`, `review-required/vacuum-analyze.sql`, `review-required/create-database.sql`, `review-required/reindex-index.sql`, each live-verified via `analyzeSql` before being added to the manifest.
- **Files modified:** `packages/automation/test/corpus/review-required/*.sql`, `packages/automation/test/corpus/manifest.json`
- **Verification:** `corpus.test.ts`'s rule-coverage describe block passes with zero new exceptions needed.
- **Committed in:** `e45b549` (Task 4 commit)

**3. [Rule 1 - Blocking] `docs/30-squawk-comparison.md` needed a hand-update, not a regeneration**
- **Found during:** Task 4
- **Issue:** `squawk-comparison-report.test.ts` (pre-existing, from Phase 3's Nyquist audit) failed because the 10 new corpus manifest entries had no row in the committed squawk comparison report. Running the generator script (`pnpm analyze:squawk-comparison`) regenerates the ENTIRE file and re-emits `_TBD_` placeholders for every disagreement -- confirmed live: it wiped 121 lines of existing hand-filled disagreement analysis.
- **Fix:** Reverted the full regeneration; instead ran squawk directly against only the 10 new files, computed each row's agreement per the report's own documented definition, and hand-appended the 10 rows plus 5 disagreement-detail sections (2 analyzer-correct, 3 different-by-design) in the same format as the existing entries, recomputing the executive-summary counts and row totals.
- **Files modified:** `docs/30-squawk-comparison.md`
- **Verification:** `squawk-comparison-report.test.ts` passes (all manifest entries present, no `_TBD_` survives, stated row counts match the table).
- **Committed in:** `e45b549` (Task 4 commit)

---

**Total deviations:** 3 auto-fixed (1 bug/self-check-conflict, 1 missing critical, 1 blocking)
**Impact on plan:** All three necessary to ship a rules file that actually loads and a test suite that actually stays green. No scope creep -- each deviation is a direct, provable consequence of this task's own changes, not unrelated work.

## Issues Encountered

None beyond the deviations above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `transactionHostile` and `disarmsTimeout` are importable analyzer facts (`packages/automation`'s barrel already re-exports `StatementFacts`); plan 04-04's `transaction-policy.ts` can read `transactionHostile` directly rather than keeping a second keyword list.
- `pnpm db:analyze:migrations` still exits 10 -- the committed history's classification is unchanged by the new rules (verified live, not merely by test).
- RUN-02 marked complete in `REQUIREMENTS.md` (checkbox applied; the traceability-table surface was not auto-matched by the write helper -- worth a manual glance if a future plan audits that table). RUN-04 stays Pending: the shared-ID gate correctly reports it blocked until plan 04-04 (the other declaring plan) also has a SUMMARY.
- No blockers for the next plan in this phase.

## Self-Check: PASSED

- All 12 files listed in `key-files.created` verified present on disk via `[ -f ]`-equivalent checks during Task 4's own verification.
- Commits `064b469` (Task 1), `a8d90d2` (Task 3), `e45b549` (Task 4) all found via `git log --oneline --all`.
- `pnpm exec vitest run packages/automation/test/` (25 files, 293 tests) green; full `pnpm test` (40 files, 394 tests) green; `pnpm exec tsc --noEmit -p packages/automation/tsconfig.json` clean.
- Plan-level `<verification>` re-confirmed: `pnpm db:analyze:migrations` exits 10; `pnpm db:analyze packages/automation/test/corpus/blocked/reset-all.sql` exits 20; `pnpm db:analyze packages/automation/test/corpus/adversarial/comment-mentions-set-lock-timeout.sql` reports no `disarms-timeout-guc` among its rule ids; `loadDefaultRules()` succeeds and three separate rules-file tampering shapes each make `loadRules` throw.

---
*Phase: 04-migration-runner-history-tests*
*Completed: 2026-09-08*
