---
phase: 03-safety-analyzer
plan: 05
subsystem: database
tags: [libpg-query, zod, vitest, migration-safety, corpus, rules-engine]

# Dependency graph
requires:
  - phase: 03-safety-analyzer
    provides: "plan 03-02's complete 37-rule catalogue and hardened classifyFacts, plan 03-03's CLI/exit-code contract, plan 03-04's PL/pgSQL recursion plus its post-completion gap-closure fix (bodyInspected / container-body-not-inspected), and D-13's corpus-as-files-plus-manifest design"
provides:
  - "test/corpus-manifest-schema.ts: CorpusManifestSchema/loadCorpusManifest, kept separate from src/classifier/rules-schema.ts per 03-RESEARCH.md's resolved open question -- policy that ships with the library vs. test expectations that never do"
  - "test/corpus/manifest.json: 34 committed rows mapping each corpus .sql file to its expected verdict and expected rule ids -- the expectation of record, never encoded in a SQL comment"
  - "test/corpus/{blocked,review-required,safe}/*.sql: 34 real, app-agnostic .sql fixtures covering the full BLOCKED set (minus the one operation that cannot be expressed as parseable SQL at all), every REVIEW REQUIRED form including two D-06 unmatched-statement cases, the complete USUALLY SAFE set, and all three same-file safe-form pairings plus a near-miss control proving exact-name matching"
  - "test/corpus.test.ts: the harness -- per-fixture verdict/rule-id diff, structural integrity (no orphan .sql file, no dangling manifest row), rule-coverage check against the shipped 37-rule catalogue with a small justified exception list, a concurrency check (Promise.all vs sequential, deep-equal), and the no-verdict-in-a-comment guard"
affects: [03-06, 03-07, phase-04-migration-runner, phase-05-ci-gate]

# Actuals (#2632)
actuals:
  tokens: 10919
  tasks: 3
  commits: 5
  plan_head_before: 012eba021a79cf50e92ae861460671cc382ad2a7

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Corpus derivation by running the real analyzer, not by hand-reasoning: every fixture's expectedVerdict/expectedRuleIds in this plan was produced by writing the candidate SQL, running it through the actually-installed analyzeSql/loadDefaultRules in a disposable probe script, and recording the real output -- never assumed from reading rules.json's rationale text alone. This is what caught two genuine plan-text-vs-analyzer disagreements (see Deviations) before they became silently-wrong manifest rows."
    - "Rule-coverage exception list built incrementally within one plan via a temporary PENDING_FIXTURES_RULE_IDS scaffold (task 1/2), collapsed into the final single, permanently-justified RULE_COVERAGE_EXCEPTIONS list once every task's fixtures had landed (task 3) -- so the harness's own <verify> step could pass after every task's commit without ever silently widening what 'covered' means, mirroring 03-04-SUMMARY.md's own 'RED commit with some cases already passing' incremental-build precedent."
    - "Manifest `file` entries are repository-root-relative paths read directly via readFileSync (cwd-relative, not import.meta.url-relative) -- matching src/adapter/drizzle-migrations.ts's own DEFAULT_MIGRATIONS_DIR convention, and the reason plan 03-06 can reference the two real Drizzle migrations in place rather than copying them into the corpus directory."

key-files:
  created:
    - packages/automation/test/corpus-manifest-schema.ts
    - packages/automation/test/corpus.test.ts
    - packages/automation/test/corpus/manifest.json
    - packages/automation/test/corpus/blocked/ (7 fixtures)
    - packages/automation/test/corpus/review-required/ (13 fixtures)
    - packages/automation/test/corpus/safe/ (14 fixtures)
  modified: []

key-decisions:
  - "The plan's own 'eight BLOCKED fixtures' (one of them removing an enum value via ALTER TYPE ... DROP VALUE) is unsatisfiable as literally written: PostgreSQL's own grammar rejects that statement unconditionally at parse time (re-confirmed live against the installed libpg-query@18.1.4 line this plan inherited, matching 03-02-SUMMARY.md's already-documented finding under the prior pg17 line). No corpus fixture -- which must be genuinely parseable SQL -- can exist for a statement that never reaches an AST node. blocked/ ships with the seven operations that are genuinely reachable; alter-type-drop-value stays in the rule-coverage exception list with that justification, and the plan's own artifact count ('roughly thirty-four .sql fixtures') is still met exactly (7+13+14=34)."
  - "The plan's near-miss control ('the same unvalidated-then-validate pair where the second statement names a different constraint, expected REVIEW_REQUIRED') does not hold under the real analyzer: verified live that this shape produces SAFE, not REVIEW_REQUIRED, because add-check-constraint-not-valid and validate-constraint both match unconditionally regardless of pairing -- exactly 03-02-SUMMARY.md's own documented key-decision ('the pair-not-valid-validated pairing does not change either statement's verdict in this implementation'). Substituted the concurrent-index-then-unique-constraint pairing with a mismatched index name instead, which genuinely falls through to D-06's unmatched REVIEW_REQUIRED on a name mismatch, preserving the plan's underlying intent (exact name equality, not fuzzy matching) without asserting a false expectation."
  - "The rule-coverage exception list's PL/pgSQL/dynamic-SQL/empty-input entries (do-block-container, create-function-container, container-body-not-inspected, nesting-depth-exceeded, unresolvable-dynamic-sql, empty-input) are a deliberate scope decision, not an oversight: this plan's own objective (03-05-PLAN.md) is explicitly 'the generic, app-agnostic half of the catalogue,' and all six are already exercised end to end by plan 03-04's own dedicated fixtures (plpgsql.test.ts, dynamic-sql.test.ts) and the post-03-04 gap-closure fix's own suite (language-sql-bodies.test.ts) plus analyze-edges.test.ts's empty-input contract."

patterns-established:
  - "Corpus derivation-by-execution: a fixture's expected outcome is never hand-derived from reading rules.json's rationale prose -- it is produced by running the actual candidate SQL through the real, installed analyzer in a throwaway probe script and recording the observed output, then reasoning about whether that output is CORRECT (not just recording it uncritically). Catches plan-text-vs-implementation drift before it becomes a silently-wrong manifest row instead of after."

requirements-completed: [ANLZ-02, ANLZ-04, ANLZ-07]

coverage:
  - id: D1
    description: "The corpus is real .sql files on disk plus one committed manifest mapping each file to its expected verdict and expected rule ids -- the same directory can be handed to another tool unchanged, and adding a case is a file plus a manifest row"
    requirement: ANLZ-02
    verification:
      - kind: unit
        ref: "packages/automation/test/corpus.test.ts#structural integrity: the manifest and the corpus directory must name exactly the same files"
        status: pass
    human_judgment: false
  - id: D2
    description: "No expected verdict is encoded in a SQL comment anywhere in the corpus"
    requirement: ANLZ-02
    verification:
      - kind: unit
        ref: "packages/automation/test/corpus.test.ts#D-13: no corpus fixture may encode its expected verdict inside a SQL comment"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every rule id in the shipped 37-rule catalogue is exercised by at least one corpus fixture, and the corpus test fails if a catalogue rule has no fixture (except a small, justified exception list)"
    requirement: ANLZ-02
    verification:
      - kind: unit
        ref: "packages/automation/test/corpus.test.ts#rule coverage: every shipped catalogue rule id is exercised by at least one fixture"
        status: pass
    human_judgment: false
  - id: D4
    description: "Every fixture's actual verdict and actual rule ids equal its manifest row, and a mismatch names the file, the expected value and the actual value (34 fixtures)"
    requirement: ANLZ-02
    verification:
      - kind: unit
        ref: "packages/automation/test/corpus.test.ts#corpus fixtures match their manifest row exactly (D-13) (34 cases, one per fixture)"
        status: pass
    human_judgment: false
  - id: D5
    description: "A statement whose kind no rule matches lands on REVIEW_REQUIRED with an empty rule-id list, proving SAFE is earned rather than defaulted to"
    requirement: ANLZ-07
    verification:
      - kind: unit
        ref: "packages/automation/test/corpus/review-required/add-column-unknown-default-function.sql + unfamiliar-statement-create-sequence.sql, both expectedRuleIds: [] in manifest.json"
        status: pass
    human_judgment: false
  - id: D6
    description: "Running every corpus fixture concurrently produces results identical to running them one at a time, and no analyzer module holds mutable module-level state that two concurrent analyses could share"
    requirement: ANLZ-02
    verification:
      - kind: unit
        ref: "packages/automation/test/corpus.test.ts#concurrency: the corpus holds no property that a concurrent run could observe differently"
        status: pass
    human_judgment: false
  - id: D7
    description: "An ADD COLUMN defaulting to now() is SAFE and one defaulting to clock_timestamp() is REVIEW_REQUIRED, as two separate corpus fixtures rather than as one unit-test assertion"
    requirement: ANLZ-04
    verification:
      - kind: unit
        ref: "packages/automation/test/corpus/safe/add-column-now-default.sql (SAFE) + review-required/add-column-volatile-default.sql (REVIEW_REQUIRED)"
        status: pass
    human_judgment: false
  - id: D8
    description: "The full pnpm test suite (Phase 1, Phase 2, and all of Phase 3 so far) stays green, and tsc --noEmit is clean"
    verification:
      - kind: other
        ref: "pnpm test"
        status: pass
      - kind: other
        ref: "pnpm exec tsc --noEmit -p packages/automation/tsconfig.json"
        status: pass
    human_judgment: false

duration: ~40min (approximate -- required-reading, live-probing, and derivation passes preceded explicit start-time capture, matching this phase's own established caveat in 03-01/02/03/04)
completed: 2026-09-08
status: complete
---

# Phase 3 Plan 5: Shared Catalogue Corpus (D-13) Summary

**A 34-fixture, manifest-driven corpus under `packages/automation/test/corpus/` -- real, app-agnostic `.sql` files plus one committed `manifest.json` -- exercises every reachable BLOCKED operation, every REVIEW REQUIRED form (including two genuine D-06 unmatched-statement cases), the full USUALLY SAFE set, and all three same-file safe-form pairings, with every expected outcome derived by running the real analyzer rather than assumed from rule-catalogue prose.**

## Performance

- **Duration:** ~40 min (approximate)
- **Started:** ~2026-09-08T13:30:00Z (approximate)
- **Completed:** 2026-09-08T14:09:13Z
- **Tasks:** 3
- **Files modified:** 37 (all created: 2 harness/schema files, 1 manifest, 34 `.sql` fixtures)

## Accomplishments

- `test/corpus-manifest-schema.ts` ships `CorpusManifestSchema`/`loadCorpusManifest`, deliberately separate from `src/classifier/rules-schema.ts` (policy that ships with the library vs. test expectations that never do), with `group`/`pairId`/`half` fields already reserved for plan 03-06's adversarial and real-migration fixtures
- `test/corpus.test.ts` is the harness: a per-fixture verdict/rule-id diff against the manifest (34 cases), structural integrity (no orphan `.sql` file, no dangling manifest row -- both directions manually verified to fail loudly, naming the file), a rule-coverage check against the shipped 37-rule catalogue with a 7-entry justified exception list, a concurrency check (`Promise.all` vs sequential, deep-equal over the whole corpus), and a guard that no corpus `.sql` file ever encodes its expected verdict in a comment
- 34 real `.sql` fixtures: 7 BLOCKED (every operation that can actually be expressed as parseable SQL -- see Deviations for the 8th), 13 REVIEW_REQUIRED (11 rule-matched forms plus 2 genuine D-06 unmatched-statement cases with empty `expectedRuleIds`), and 14 SAFE (10 single-operation forms including the `now()`/`clock_timestamp()` STABLE-vs-VOLATILE pair, 3 same-file safe-form pairings, and 1 near-miss control)
- Every fixture's expected outcome was derived by actually running the candidate SQL through the real, installed `analyzeSql`/`loadDefaultRules` in a disposable probe script and recording the observed output -- not hand-derived from reading `rules.json`'s rationale text -- which caught two genuine plan-text-vs-analyzer disagreements before they became silently-wrong manifest rows (see Deviations)
- `pnpm test` grew from 214 to 255 passing tests across this plan's five commits; `tsc --noEmit` stays clean throughout

## Task Commits

1. **Task 1: The corpus manifest schema and the harness that diffs every fixture against it** (`tdd="true"`)
   - RED: `f15cf7a` (test) -- 0 tests ran (module resolution error: `corpus-manifest-schema.ts` did not exist)
   - GREEN: `c2a02b7` (feat) -- 10/10 pass, seeded with the first 3 fixtures
2. **Task 2: Fixtures for the whole BLOCKED set and every REVIEW REQUIRED form** - `aa75b1c` (feat) -- 28/28 pass
3. **Task 3: Fixtures for the USUALLY SAFE set and the three safe-form pairings** - `178b510` (feat) -- 41/41 pass
   - Follow-up: `86de98d` (docs) -- fixed a stale "four concerns" count in `corpus.test.ts`'s own header comment, caught during final plan-level review; no behavior change

**Plan metadata:** commit follows this summary.

## Files Created/Modified

- `packages/automation/test/corpus-manifest-schema.ts` - `CorpusManifestSchema`, `loadCorpusManifest`
- `packages/automation/test/corpus.test.ts` - the harness (5 describe blocks, 41 test cases)
- `packages/automation/test/corpus/manifest.json` - 34 rows, the expectation of record
- `packages/automation/test/corpus/blocked/*.sql` - 7 fixtures (drop-table, drop-schema, drop-database, truncate, drop-column, delete-without-where, update-without-where)
- `packages/automation/test/corpus/review-required/*.sql` - 13 fixtures (11 rule-matched lock-hazard/compatibility forms + 2 D-06 unmatched-statement cases)
- `packages/automation/test/corpus/safe/*.sql` - 14 fixtures (10 single-operation SAFE forms + 3 pairings + 1 near-miss control)

## Decisions Made

See `key-decisions` in frontmatter for the full list. Most load-bearing: **corpus fixtures are derived by execution, not by reading prose** -- every expected verdict/rule-id set in this plan was produced by actually running the candidate SQL through the real analyzer and reasoning about whether the observed output was correct, which is what surfaced both deviations below rather than shipping two silently-wrong manifest rows.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Corpus/analyzer disagreement, investigated per corpus_integrity] The 8th BLOCKED fixture (enum value removal) cannot exist as parseable SQL**
- **Found during:** Task 2, while deriving the BLOCKED fixture set
- **Issue:** The plan's action text lists "removing a value from an enum type" (`ALTER TYPE ... DROP VALUE`) as one of eight BLOCKED fixtures, with expected rule id `alter-type-drop-value`. Live-probed against the installed `libpg-query@18.1.4` (the pg18 line this plan inherited, upgraded from pg17 after 03-04): `parse()` throws `"dropping an enum value is not implemented"` for this statement unconditionally, before any `AlterEnumStmt` AST node is ever constructed -- confirming 03-02-SUMMARY.md's identical finding under the prior pg17 line still holds. A corpus fixture, which must be genuinely parseable SQL that `analyzeSql` can classify (not throw `AnalyzerParseError` on), cannot exist for a statement PostgreSQL's own grammar rejects outright.
- **Fix:** `blocked/` ships the seven operations that ARE genuinely reachable (drop-table, drop-schema, drop-database, truncate, drop-column, delete-without-where, update-without-where). `alter-type-drop-value` is listed in `corpus.test.ts`'s `RULE_COVERAGE_EXCEPTIONS` with a comment naming the live-verified grammar rejection as the reason. The plan's own artifact estimate ("roughly thirty-four .sql fixtures") is still met exactly: 7 + 13 + 14 = 34.
- **Files affected:** `packages/automation/test/corpus/blocked/` (7 files instead of a literal 8), `packages/automation/test/corpus.test.ts`
- **Verification:** `corpus.test.ts`'s rule-coverage test passes with `alter-type-drop-value` in the justified exception list; `pnpm test` green throughout
- **Committed in:** `aa75b1c` (Task 2 commit), with the reasoning documented in that commit's own message

**2. [Rule 1 - Corpus/analyzer disagreement, investigated per corpus_integrity] The plan's literal near-miss shape produces SAFE, not REVIEW_REQUIRED**
- **Found during:** Task 3, while deriving the near-miss control fixture
- **Issue:** The plan's action text specifies the near-miss control as "the same unvalidated-then-validate pair where the second statement names a different constraint," expecting REVIEW_REQUIRED. Live-verified (probe script, `analyzeSql` run against `ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (...) NOT VALID; ALTER TABLE orders VALIDATE CONSTRAINT orders_status_check_v2;`) that this shape resolves **SAFE**, not REVIEW_REQUIRED: `add-check-constraint-not-valid` and `validate-constraint` both match their respective statements UNCONDITIONALLY, independent of whether a `pair-not-valid-validated` pairing ever fires -- exactly matching 03-02-SUMMARY.md's own documented key-decision that "the pair-not-valid-validated pairing does not change either statement's verdict in this implementation." A near-miss built on this shape would only demonstrate ordinary independent-SAFE behavior, not a controlled contrast on name-matching.
- **Fix:** Substituted the concurrent-index-then-unique-constraint pairing shape for the near-miss control instead (`safe/near-miss-index-name-mismatch.sql`: `CREATE INDEX CONCURRENTLY orders_customer_id_idx ...` followed by `ADD CONSTRAINT ... UNIQUE USING INDEX orders_other_idx` -- a deliberately mismatched name). Live-verified this DOES produce REVIEW_REQUIRED: without an index-name match, no ordinary rule matches `AddUniqueConstraint` with a non-null `usingIndexName`, so it falls through to D-06's unmatched-statement REVIEW_REQUIRED. This preserves the plan's underlying intent (exact name equality governs the pairing, not a fuzzy or approximate match) on a shape where that intent is actually observable.
- **Files affected:** `packages/automation/test/corpus/safe/near-miss-index-name-mismatch.sql`, `packages/automation/test/corpus/manifest.json` (with the substitution explained in the `why` field)
- **Verification:** `corpus.test.ts`'s per-fixture test passes with `expectedVerdict: REVIEW_REQUIRED` and `expectedRuleIds: ["create-index-concurrently"]`; `pnpm test` green throughout
- **Committed in:** `178b510` (Task 3 commit), with the reasoning documented in that commit's own message and the manifest row's own `why` field

---

**Total deviations:** 2 auto-fixed (both Rule 1 -- genuine plan-text-vs-analyzer disagreements investigated per this plan's own `corpus_integrity` instructions, resolved in favor of the analyzer's real, already-tested behavior rather than the plan's literal wording)
**Impact on plan:** Both were necessary for the plan's own literal instructions to be satisfiable at all -- one because the specified SQL text cannot parse under real PostgreSQL grammar, the other because the specified fixture shape does not produce the verdict the plan predicted under the analyzer's own already-documented, already-tested pairing semantics. Neither was resolved by weakening a rule, the D-02/D-07 floors, or forcing a manifest expectation to match a wrong result -- both were investigated first (live probe scripts against the real analyzer), confirmed as genuine disagreements, and resolved in the direction the evidence pointed. No scope creep: no new rule, no new StatementKind, and no fixture beyond what each task's own action text and acceptance criteria required (adjusted only where literally unsatisfiable).

## Issues Encountered

None beyond the two deviations above -- every task's `<verify>`/`<acceptance_criteria>` passed as specified once those two adjustments were applied, and `pnpm test` stayed green throughout (214 → 224 → 242 → 255 across this plan's five commits, zero regressions in any pre-existing Phase 1/2/3 suite). `tsc --noEmit -p packages/automation/tsconfig.json` is clean at every commit.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Ready:** The shared corpus D-13 specifies now exists as a real, manifest-driven artifact -- files-plus-manifest, not SQL inlined in test code -- so plan 03-06 can hand this same directory to `squawk-cli` unchanged and add its own `adversarial`/`app-shaped`/`real-migration` rows to the same `manifest.json` (the schema already reserves `group`/`pairId`/`half` for exactly this). Phase 4's runner and Phase 5's CI both inherit this corpus as their regression suite.
- **Carried forward, unaffected by this plan:** the PL/pgSQL-recursion and dynamic-SQL rules (`do-block-container`, `create-function-container`, `container-body-not-inspected`, `nesting-depth-exceeded`, `unresolvable-dynamic-sql`) and `empty-input` remain exercised only by their own dedicated suites (`plpgsql.test.ts`, `dynamic-sql.test.ts`, `language-sql-bodies.test.ts`, `analyze-edges.test.ts`), not by this corpus -- a deliberate scope boundary (this plan's own objective is "the generic, app-agnostic half of the catalogue"), not a gap. If a future plan wants these in the shared corpus too, the `RULE_COVERAGE_EXCEPTIONS` entries in `corpus.test.ts` name exactly which ids and why, so removing an entry and adding its fixture is a bounded, well-documented change.
- **Not yet exercised:** the `must_haves` prohibition on "no parameter/flag/env var may weaken a verdict" still has no counter-example -- same standing note as every prior plan in this phase, unchanged by this plan (no new CLI surface was added).

---
*Phase: 03-safety-analyzer*
*Completed: 2026-09-08*

## Self-Check: PASSED

All key files confirmed present on disk via `[ -f ]`: `packages/automation/test/corpus-manifest-schema.ts`, `packages/automation/test/corpus.test.ts`, `packages/automation/test/corpus/manifest.json`, this SUMMARY. 34 `.sql` fixtures confirmed on disk via `find`. All 5 commits (`f15cf7a`, `c2a02b7`, `aa75b1c`, `178b510`, `86de98d`) confirmed present via `git log --oneline --all`. Plan-level `<verification>` re-run: `pnpm test` 255/255 green (up from 214 at plan start, zero regressions in any pre-existing suite); `pnpm exec tsc --noEmit -p packages/automation/tsconfig.json` clean; every corpus fixture's actual verdict and rule ids equal its manifest row (34/34); the rule-coverage check finds a fixture for every catalogue rule id except the 7 justified exceptions; the concurrent and sequential runs of the whole corpus produce identical results; no corpus `.sql` file carries a verdict word in a comment (verified both by the automated guard and a manual `grep`).
