---
phase: 03-safety-analyzer
plan: 06
subsystem: database
tags: [libpg-query, vitest, migration-safety, corpus, adversarial-testing, drizzle]

# Dependency graph
requires:
  - phase: 03-safety-analyzer
    provides: "plan 03-05's corpus-manifest-schema.ts/corpus.test.ts harness and 34-fixture catalogue corpus, plan 03-04's D-05 PL/pgSQL recursion plus its post-completion gap-closure fix (bodyInspected/container-body-not-inspected, LANGUAGE sql re-parsing), and the D-14/D-16 manifest fields (pairId/half/group) plan 03-05 reserved for this plan"
provides:
  - "test/corpus/adversarial/: ten fixtures forming five D-14 matched pairs (inline-comment, dollar-quoted-string, do-block, function-body, quoted-identifier), each pair proving a genuine DROP TABLE hidden by that evasion is BLOCKED and the same words as inert text are not"
  - "test/corpus/app-shaped/: three fixtures mirroring 01-CONTEXT.md D-11's reserved recipe-app churn (nullable notes column SAFE, timer_label SET NOT NULL REVIEW_REQUIRED, DROP TABLE ingredients BLOCKED) against the real recipes/ingredients/steps schema without touching it"
  - "test/corpus/manifest.json: 15 new rows (49 total) -- 10 adversarial, 3 app-shaped, 2 real-migration (the repository's genuine Drizzle migrations, referenced in place)"
  - "test/corpus.test.ts: the D-14 pair-integrity check (every pairId groups into exactly one hidden-executable and one inert-text-only row, naming the pair id and what was missing/duplicated when it does not) and the real-migration structural check; do-block-container/create-function-container removed from RULE_COVERAGE_EXCEPTIONS now that the adversarial pairs exercise them"
  - "test/anlz-07.test.ts: the direct, isolated demonstration of ROADMAP.md Phase 3 success criterion 1 -- a real drop-table fixture is BLOCKED, an additive nullable-column fixture is SAFE with a named rule id"
affects: [phase-04-migration-runner, phase-05-ci-gate, phase-07-audit]

# Actuals (#2632)
actuals:
  tokens: 8607
  tasks: 3
  commits: 5
  plan_head_before: fed4573

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Adversarial-pair derivation by execution, extending 03-05's own established discipline: every one of the ten adversarial fixtures' expected verdict/rule-id sets was produced by writing the candidate SQL, running it through the actually-installed analyzeSql/loadDefaultRules in a disposable probe script, and recording the real output before writing it into the manifest -- never assumed from the pair's own design intent. All ten matched the derived expectation exactly on first run; no analyzer defect was found by this plan (a null result reported honestly, not a foregone conclusion)."
    - "Structural RED/GREEN for tdd=\"true\" plan tasks that add only fixtures/data, not new production code: since this plan's tdd tasks (1 and 3) add corpus content rather than implementation, RED is a new *structural* assertion in corpus.test.ts (the D-14 pair-integrity check; the real-migration-group-references-the-two-real-files check) that fails against the manifest's pre-task state, and GREEN is the manifest/fixture content that satisfies it -- distinct from the more common RED (a test importing a not-yet-existing module) but the same discipline: a real, verified-failing assertion precedes the content that makes it pass."
    - "Cross-task fixture staging: all ten adversarial and three app-shaped fixture files were authored together during design/verification, then intentionally staged out of the working tree (moved to a temp location, moved back) between each task's own commit so that task 1's own <verify> command ran against exactly task 1's own deliverable, not against task 2's not-yet-committed fixtures sitting unlisted in the same corpus directory."

key-files:
  created:
    - packages/automation/test/corpus/adversarial/inline-comment-drop.sql
    - packages/automation/test/corpus/adversarial/inline-comment-inert.sql
    - packages/automation/test/corpus/adversarial/dollar-quoted-string-drop.sql
    - packages/automation/test/corpus/adversarial/dollar-quoted-string-inert.sql
    - packages/automation/test/corpus/adversarial/do-block-drop.sql
    - packages/automation/test/corpus/adversarial/do-block-inert.sql
    - packages/automation/test/corpus/adversarial/function-body-drop.sql
    - packages/automation/test/corpus/adversarial/function-body-inert.sql
    - packages/automation/test/corpus/adversarial/quoted-identifier-drop.sql
    - packages/automation/test/corpus/adversarial/quoted-identifier-inert.sql
    - packages/automation/test/corpus/app-shaped/recipes-add-notes-column.sql
    - packages/automation/test/corpus/app-shaped/steps-timer-label-set-not-null.sql
    - packages/automation/test/corpus/app-shaped/drop-ingredients-table.sql
    - packages/automation/test/anlz-07.test.ts
  modified:
    - packages/automation/test/corpus/manifest.json
    - packages/automation/test/corpus.test.ts

key-decisions:
  - "All ten adversarial fixtures use the app-agnostic 'orders' table (the existing catalogue-fixture convention from plan 03-05), never recipes/ingredients/steps -- keeping the adversarial group as generic as the catalogue it extends, distinct from the deliberately app-shaped group (D-16), matching 03-CONTEXT.md's own instruction that the two groups stay separate so packages/automation never couples to the fixture application's schema."
  - "The dollar-quoted-string pair and the function-body pair are deliberately built on two DIFFERENT concrete evasion mechanisms even though both hide a drop inside a CREATE FUNCTION body, to avoid the two pairs being structurally identical fixtures under different names: dollar-quoted-string uses LANGUAGE plpgsql with a CUSTOM dollar tag ($migration_body$, proving tagged quoting specifically works, not just the default $$), while function-body uses LANGUAGE sql with a SINGLE-QUOTED body (proving the gap-closure fix's LANGUAGE sql re-parse path catches it too, regardless of which quoting style hides the text). Both are genuine, distinct instances of PITFALLS.md C1's dollar-quoting and CREATE-FUNCTION-body bullets, not one shape restated twice under two pairIds."
  - "The dollar-quoted-string pair's inert half (a dollar-quoted string literal inserted as INSERT data) and the function-body pair's inert half (a LANGUAGE sql function returning a SELECT'd string constant) both resolve REVIEW_REQUIRED, not SAFE -- because INSERT and a bare SELECT have no StatementKind in this catalogue at all (D-04 never included either, the same documented limitation 03-04-SUMMARY.md and 03-05-SUMMARY.md already recorded for INSERT and WHERE-scoped UPDATE). This still satisfies the pair's own contract (\"not BLOCKED, no drop rule id\") and is the honest D-06 outcome for an unmatched statement, not weakened to a false SAFE to make the pair look cleaner."
  - "The app-shaped REVIEW_REQUIRED fixture uses the bare, naive `ALTER TABLE steps ALTER COLUMN timer_label SET NOT NULL` form (not the NOT VALID/VALIDATE/SET NOT NULL three-step safe form) -- deliberately the unsafe one-liner PITFALLS.md A5 warns teams reach for by default, so the fixture pins the verdict Phase 4 would actually get if it wrote the naive migration, which is the entire point of D-16 (\"Phase 4 should not discover a miscalibrated rule by running a real schema change\")."
  - "Both real-migration expected verdicts (0000_bumpy_khan.sql SAFE, 0001_busy_thunderbolt.sql REVIEW_REQUIRED) were confirmed by live probe before being written into the manifest, exactly matching the plan's own stated expectations -- no divergence was found, and 0001's REVIEW_REQUIRED is recorded in both the manifest `why` field and this summary as a correct classification (an unvalidated foreign-key add, PITFALLS.md A6), not a defect to explain away."

patterns-established:
  - "D-14 pair-integrity as a structural corpus-test invariant, not a convention: corpus.test.ts groups every manifest row with a pairId and fails, naming the pair id and exactly what is missing or duplicated, unless the group is exactly one hidden-executable row and one inert-text-only row -- verified live this session (a manifest row was temporarily deleted, the check failed naming that exact pair id, the deletion was reverted) rather than only reasoned about."

requirements-completed: [ANLZ-05, ANLZ-07]

coverage:
  - id: D1
    description: "Five matched adversarial pairs (D-14) ship under test/corpus/adversarial/, one per PITFALLS.md C1 evasion shape (inline comment, dollar-quoted string, DO block, function body, quoted identifier), and the corpus test structurally fails if any pair id has only one half"
    requirement: ANLZ-05
    verification:
      - kind: unit
        ref: "packages/automation/test/corpus.test.ts#D-14: adversarial fixtures ship as matched pairs, and the manifest enforces the pairing > every pairId groups into exactly one hidden-executable row and one inert-text-only row"
        status: pass
      - kind: unit
        ref: "packages/automation/test/corpus.test.ts#D-14: adversarial fixtures ship as matched pairs, and the manifest enforces the pairing > all five D-14 shapes named in PITFALLS.md section C1 are present in the manifest"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every hidden-executable adversarial fixture is BLOCKED with a D-02 floor rule id (drop-table) among its findings; every inert-text-only fixture is not BLOCKED and carries no floor rule id -- verified both structurally (manifest expectation) and by running each fixture through the real analyzer"
    requirement: ANLZ-05
    verification:
      - kind: unit
        ref: "packages/automation/test/corpus.test.ts#D-14 > every hidden-executable row's manifest expectation is BLOCKED with a D-02 floor rule id, and every inert-text-only row's expectation is never BLOCKED and never carries one"
        status: pass
      - kind: unit
        ref: "packages/automation/test/corpus.test.ts#corpus fixtures match their manifest row exactly (D-13) (10 adversarial cases among 49 total)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The app-shaped fixture group (D-16) mirrors 01-CONTEXT.md D-11's reserved recipe-app churn against the real recipes/ingredients/steps schema without modifying it: a nullable notes column is SAFE, a bare SET NOT NULL on the existing nullable timer_label column is REVIEW_REQUIRED, and dropping ingredients is BLOCKED"
    requirement: ANLZ-05
    verification:
      - kind: unit
        ref: "packages/automation/test/corpus.test.ts#corpus fixtures match their manifest row exactly (D-13) (3 app-shaped cases)"
        status: pass
      - kind: other
        ref: "git status --porcelain apps/recipe-app/src/db/schema.ts apps/recipe-app/drizzle (empty output, verified live)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The repository's two genuine Drizzle migrations are referenced in the corpus manifest at their own repository paths (never copied), with verdicts pinned: 0000_bumpy_khan.sql SAFE, 0001_busy_thunderbolt.sql REVIEW_REQUIRED"
    requirement: ANLZ-07
    verification:
      - kind: unit
        ref: "packages/automation/test/corpus.test.ts#real-migration group: the repository's two genuine Drizzle migrations are referenced in place (ANLZ-07)"
        status: pass
      - kind: other
        ref: "pnpm db:analyze:migrations (exit code 10, report sections for both files, verified live)"
        status: pass
    human_judgment: false
  - id: D5
    description: "test/anlz-07.test.ts demonstrates ROADMAP.md Phase 3 success criterion 1 directly: a real DROP TABLE fixture returns BLOCKED, an additive nullable-column fixture returns SAFE, and the SAFE finding names the rule id that earned it"
    requirement: ANLZ-07
    verification:
      - kind: unit
        ref: "packages/automation/test/anlz-07.test.ts#phase success criterion 1: a real DROP TABLE is BLOCKED, and a genuinely safe migration is SAFE"
        status: pass
    human_judgment: false
  - id: D6
    description: "The full pnpm test suite (Phase 1, Phase 2, all of Phase 3) stays green, and tsc --noEmit is clean"
    verification:
      - kind: other
        ref: "pnpm test"
        status: pass
      - kind: other
        ref: "pnpm exec tsc --noEmit -p packages/automation/tsconfig.json"
        status: pass
    human_judgment: false

duration: ~35min (approximate -- required-reading and derivation-by-execution passes preceded explicit start-time capture, matching this phase's own established caveat in 03-01 through 03-05)
completed: 2026-09-08
status: complete
---

# Phase 3 Plan 6: Adversarial Corpus and App-Shaped Verdicts (D-14/D-16) Summary

**Ten fixtures across five D-14 matched pairs prove a real `DROP TABLE` hidden by a comment, a dollar-quoted string, a `DO` block, a function body, or a keyword-colliding quoted identifier is still `BLOCKED` while the same words as inert text are never flagged, with a structural manifest check that fails a shape shipped with only one half; three D-16 fixtures pin the recipe app's reserved churn verdicts without spending it; the repository's two real Drizzle migrations are pinned in the corpus; and `test/anlz-07.test.ts` demonstrates phase success criterion 1 directly.**

## Performance

- **Duration:** ~35 min (approximate)
- **Tasks:** 3
- **Files modified:** 16 (14 created, 2 modified)

## Accomplishments

- `test/corpus/adversarial/` ships ten fixtures, five D-14 matched pairs (inline-comment, dollar-quoted-string, do-block, function-body, quoted-identifier), each hidden-executable half a genuine `DROP TABLE` surviving that evasion and each inert-text-only half the same words appearing only as a comment, a string literal, a raised notice, a returned string constant, or a phrase-shaped identifier -- all ten verdicts derived by running the real analyzer, matching the derived expectation exactly on first probe with no analyzer defect found
- `corpus.test.ts`'s new D-14 describe block makes the pairing structural: it groups every manifest row by `pairId` and fails, naming the pair id and what was missing or duplicated, unless the group is exactly one `hidden-executable` and one `inert-text-only` row -- live-verified this session by temporarily deleting one manifest row (the check failed, naming that exact pair id) and reverting
- `do-block-container`/`create-function-container` are removed from `corpus.test.ts`'s `RULE_COVERAGE_EXCEPTIONS`: the adversarial pairs' inert halves are now the fixtures that exercise both rules, closing the gap plan 03-05 deliberately deferred
- `test/corpus/app-shaped/` ships three fixtures against the real `recipes`/`ingredients`/`steps` tables (SAFE nullable column add, REVIEW_REQUIRED bare `SET NOT NULL` on the existing nullable `timer_label`, BLOCKED `DROP TABLE ingredients`), with `apps/recipe-app/src/db/schema.ts` and `apps/recipe-app/drizzle/` verified untouched (`git status --porcelain`, empty)
- The manifest's `real-migration` group references `apps/recipe-app/drizzle/0000_bumpy_khan.sql` (SAFE) and `0001_busy_thunderbolt.sql` (REVIEW_REQUIRED) in place, never copied; `pnpm db:analyze:migrations` exits 10 with a report section for both, matching the pinned verdicts exactly
- `test/anlz-07.test.ts` is the isolated, direct demonstration of phase success criterion 1: a real drop-table fixture is BLOCKED, an additive nullable-column fixture is SAFE and names the rule id that earned it
- `pnpm test` grew from 255 to 278 passing tests across this plan's five commits; `tsc --noEmit` stays clean throughout

## Task Commits

Task 1 and Task 3 carried `tdd="true"`; both followed genuine RED-GREEN (RED verified failing before commit, GREEN verified passing after):

1. **Task 1: Five matched adversarial pairs, and a manifest check that a lone half fails the suite** (`tdd="true"`)
   - RED: `bcd532a` (test) -- 3/45 failing (no adversarial fixtures existed; do-block-container/create-function-container newly uncovered)
   - GREEN: `e63f3cb` (feat) -- 55/55 pass (verified with task 2's not-yet-committed fixtures staged out of the working tree)
2. **Task 2: The app-shaped group** - `3edc98e` (feat) -- 58/58 pass; `git status --porcelain` on the real schema/migrations empty
3. **Task 3: The two real migrations, and the success-criterion-1 demonstration** (`tdd="true"`)
   - RED: `17cf044` (test) -- 1/62 failing (real-migration group check against an empty group); `anlz-07.test.ts` already passed (reuses already-implemented analyzer behavior, matching this phase's established "RED with some cases already passing" precedent)
   - GREEN: `30d0152` (feat) -- 64/64 pass; `pnpm db:analyze:migrations` exits 10 with both report sections

**Plan metadata:** commit follows this summary.

## Files Created/Modified

- `packages/automation/test/corpus/adversarial/*.sql` (10 files) - the five D-14 matched pairs
- `packages/automation/test/corpus/app-shaped/*.sql` (3 files) - the D-16 reserved-churn mirror
- `packages/automation/test/anlz-07.test.ts` - phase success criterion 1's direct demonstration
- `packages/automation/test/corpus/manifest.json` - 15 new rows (49 total): 10 adversarial, 3 app-shaped, 2 real-migration
- `packages/automation/test/corpus.test.ts` - D-14 pair-integrity describe block, real-migration structural check, `RULE_COVERAGE_EXCEPTIONS` update

## Decisions Made

See `key-decisions` in frontmatter for the full list. Most load-bearing: **adversarial-pair derivation by execution** (every fixture's expected outcome was produced by running the real analyzer, matching the expectation on first probe with zero analyzer defects found -- a genuine null result, reported honestly rather than assumed), and **the dollar-quoted-string/function-body pairs deliberately use two different concrete evasion mechanisms** (custom-tagged `LANGUAGE plpgsql` vs. single-quoted `LANGUAGE sql`) so five distinct pairIds correspond to five genuinely distinct fixture shapes, not one shape restated under two names.

## Deviations from Plan

None - plan executed exactly as written. No analyzer defect was found during derivation (all ten adversarial verdicts and both real-migration verdicts matched the plan's own stated/implied expectations exactly on first live probe); the `must_haves` prohibition against editing an expected verdict to match a wrong result was never invoked because no disagreement ever arose to invoke it against.

## Issues Encountered

None. All task `<verify>`/`<acceptance_criteria>` passed as specified; `pnpm test` stayed green throughout (255 -> 264 -> 267 -> 278 across this plan's five commits, zero regressions in any pre-existing Phase 1/2/3 suite); `tsc --noEmit -p packages/automation/tsconfig.json` is clean at every commit.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Ready:** D-14's "cannot be fooled in either direction" is now a structural property of the corpus, not a claim -- a future adversarial shape added with only its catching half fails the suite by construction. The D-16 app-shaped group gives Phase 4 known expected verdicts for the reserved recipe-app churn before it spends that material for real. The `real-migration` group and `test/anlz-07.test.ts` give Phase 4/5/7 a standing, isolated proof of phase success criterion 1 to build CI and audit expectations against.
- **Carried forward, unaffected by this plan:** `container-body-not-inspected`, `nesting-depth-exceeded`, `unresolvable-dynamic-sql`, and `empty-input` remain in `RULE_COVERAGE_EXCEPTIONS`, exercised only by their own dedicated suites (`language-sql-bodies.test.ts`, `plpgsql.test.ts`, `dynamic-sql.test.ts`, `analyze-edges.test.ts`) -- unchanged scope decisions from plan 03-05, not gaps this plan was asked to close.
- **Not yet exercised:** the `must_haves` prohibition on "no parameter/flag/env var may weaken a verdict" still has no counter-example -- same standing note as every prior plan in this phase, unchanged by this plan (no new CLI surface was added).
- **squawk-cli cross-check (D-15)** remains this phase's one outstanding deliverable, presumably plan 03-07, not touched by this plan.

---
*Phase: 03-safety-analyzer*
*Completed: 2026-09-08*

## Self-Check: PASSED

All key files confirmed present on disk: 10 adversarial fixtures, 3 app-shaped fixtures, `test/anlz-07.test.ts`, updated `manifest.json` (49 entries) and `corpus.test.ts`, this SUMMARY. All 5 task commits (`bcd532a`, `e63f3cb`, `3edc98e`, `17cf044`, `30d0152`) confirmed present via `git log --oneline`. Plan-level `<verification>` re-run: `pnpm test` 278/278 green (up from 255 at plan start, zero regressions); `pnpm exec tsc --noEmit -p packages/automation/tsconfig.json` clean; all five D-14 shapes present with the pair-integrity check passing; every hidden-executable half BLOCKED with `drop-table`, every inert half not BLOCKED with no floor rule id; the app-shaped group's three verdicts are SAFE/REVIEW_REQUIRED/BLOCKED with the real schema and migrations directory untouched (`git status --porcelain`, empty); `test/anlz-07.test.ts` demonstrates success criterion 1 directly; `pnpm db:analyze:migrations` exits 10 with a report section for both real migrations.
