---
phase: 03-safety-analyzer
plan: 02
subsystem: database
tags: [libpg-query, zod, postgres-ast, migration-safety, vitest, rules-engine]

# Dependency graph
requires:
  - phase: 03-safety-analyzer
    provides: "plan 03-01's packages/automation workspace, the complete src/types.ts public contract, the D-02 code floor, analyzeSql/loadRules, and the observed libpg-query@17.7.4 parse()/parseSync() failure-shape contract"
provides:
  - "The full D-04 FEATURES.md section 1 fact vocabulary in src/inspector/inspect.ts -- every StatementKind except DoBlock/CreateFunction/ExecuteDynamic (plan 03-04's D-05 job)"
  - "src/inspector/function-volatility.ts: the curated PostgreSQL function-volatility table and classifyDefaultVolatility, encoding the STABLE-vs-VOLATILE correction (now() is SAFE, clock_timestamp() is REVIEW_REQUIRED)"
  - "The complete schema-validated FEATURES.md section 1 rule catalogue in src/rules/rules.json (29 base rules + 3 pairing-documentation rules), including the deliberate lock_timeout/statement_timeout exclusion"
  - "classifyFacts hardened as order-independent (most-severe-wins, ruleIds sorted ascending) and applySafeFormPairing implementing D-09's three same-file safe-form pairings, guarded against ever lowering a D-02 floor operation"
  - "Deterministic finding order (ascending statementIndex, then nestedPath) in analyze.ts"
affects: [03-03, 03-04, 03-05, 03-06, 03-07, phase-04-migration-runner, phase-05-ci-gate, phase-07-audit]

# Actuals (#2632)
actuals:
  tokens: 22059
  tasks: 3
  commits: 6
  plan_head_before: bbb8c01261fd9dac193671a3adbfe7c139ab1b9c

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Rules-file sentinel-match entries: a documentation-bearing rule (id + rationale, no independent classification role) is given a match object that is structurally impossible for the inspector to ever produce, so it can be looked up by id from a code path (applySafeFormPairing) without ever firing through ordinary per-statement classifyFacts -- proven by a dedicated inertness test, not just asserted."
    - "Pairing/lowering passes take the loaded rules object as a parameter (never a second hardcoded copy of a rule's id/rationale text) -- the same 'same function/data, never a duplicate' discipline floor.ts's assertFloorNotWeakened already established in 03-01, now applied to classify.ts's applySafeFormPairing."
    - "AST-shape claims are verified by a disposable Node probe script against the actually-installed libpg-query package before being encoded into inspector logic, not assumed from documentation -- this surfaced two load-bearing corrections (DROP DATABASE is DropdbStmt, not DropStmt; TruncateStmt.relations wraps each RangeVar) that pure documentation reading would have missed."

key-files:
  created:
    - packages/automation/src/inspector/function-volatility.ts
    - packages/automation/test/inspector-facts.test.ts
    - packages/automation/test/rules-catalogue.test.ts
    - packages/automation/test/classifier.test.ts
    - packages/automation/test/pairing.test.ts
  modified:
    - packages/automation/src/inspector/inspect.ts
    - packages/automation/src/rules/rules.json
    - packages/automation/src/classifier/classify.ts
    - packages/automation/src/analyze.ts
    - packages/automation/src/classifier/rules-schema.ts

key-decisions:
  - "ALTER TYPE ... DROP VALUE is grammatically valid PostgreSQL syntax whose own grammar action unconditionally raises 'dropping an enum value is not implemented' (gram.y) -- confirmed live against the installed libpg-query@17.7.4 parser. AlterTypeDropValue can therefore never reach inspectStatement from real SQL text; it stays in StatementKind/rules.json as documentation of FEATURES.md's BLOCKED entry, and inspector-facts.test.ts's per-kind coverage check explicitly excludes it (with the citation) rather than silently leaving it uncovered or hand-building a fake AST node to force coverage."
  - "DROP DATABASE parses to its own AST node type (DropdbStmt with a bare dbname field), never a DropStmt -- confirmed live; the plan text's phrasing ('the drop node splits by its remove type into DropTable, DropSchema, DropDatabase and DropIndex') reads as one node type but is actually two, handled as two dispatch branches in inspectStatement."
  - "TruncateStmt.relations is an ARRAY field, so each entry is wrapped { RangeVar: {...} } like every other array field in this AST, unlike the singular relation field every other statement type (AlterTableStmt/DeleteStmt/UpdateStmt/IndexStmt/CreateStmt) uses directly -- found via the RED->GREEN cycle itself (one genuine bug: TRUNCATE's table fact was null on the first GREEN run), not via the initial AST probe."
  - "FactMatchSchema extended to accept null as a match value (Rule 3 deviation, rules-schema.ts) -- required for add-unique-constraint's usingIndexName: null match, which distinguishes the naive inline-index-build form from the USING-an-existing-index form; classify.ts's factMatches() type widened to match (behavior unchanged, === already handles null)."
  - "RulesFileSchema gained an optional top-level notes: z.string() field (Rule 2/3 deviation) so the lock_timeout/statement_timeout exclusion's documentation survives schema validation rather than being silently stripped as an unknown key by zod's default strip behavior."
  - "The pair-not-valid-validated pairing does not change either statement's VERDICT in this implementation: task 2's own add-foreign-key-not-valid/add-check-constraint-not-valid/validate-constraint rules already classify each half SAFE independently, matching FEATURES.md's description of NOT VALID and VALIDATE CONSTRAINT as intrinsically weak-locked on their own regardless of what precedes or follows them. This pairing's only observable effect for that combination is setting pairedWith and adding a more specific rule id for Phase 5's rendering -- unlike the other two pairings (concurrent-index+unique, validated-check+SET NOT NULL), which genuinely lower a naive REVIEW_REQUIRED to SAFE. Documented rather than silently assumed to be a no-op-vs-real-fix distinction the reader would have to reverse-engineer."
  - "The three pairing rules in rules.json are given deliberately-unreachable sentinel match objects (e.g. ValidateConstraint + notValid:true, a combination PostgreSQL's own grammar cannot produce) rather than living in a separate non-matchable structure, so Phase 5/7 can treat them 'like any other rule' (plan's own phrasing) without knowing about a second collection -- proven inert by a dedicated pairing.test.ts case, not just asserted in a comment."

patterns-established:
  - "A statement-kind dispatch function (inspectStatement) delegates to one small per-node-type function each, rather than one large switch -- each helper is independently readable and each StatementKind's fact derivation is grep-able by its own function name."
  - "A table-driven fact test (inspector-facts.test.ts) asserts partial StatementFacts via toMatchObject against real parser output for every behavior, never a hand-built AST -- the pattern plan 03-04's own PL/pgSQL adversarial fixtures should follow."

requirements-completed: [ANLZ-02, ANLZ-03, ANLZ-04]

coverage:
  - id: D1
    description: "The inspector reduces the full D-04 statement catalogue (AddColumn incl. defaultVolatility, SetNotNull/DropNotNull/AlterColumnType/DropColumn, AddUniqueConstraint/AddCheckConstraint/AddForeignKey with notValid/usingIndexName/checkProvesNotNull, DropConstraint/ValidateConstraint, CreateIndex/DropIndex with concurrently, Delete/Update with hasWhereClause, CreateTable, RenameColumn/RenameTable, CommentOn, DropTable/DropSchema/DropDatabase/Truncate) to StatementFacts against the real parser"
    requirement: ANLZ-02
    verification:
      - kind: unit
        ref: "packages/automation/test/inspector-facts.test.ts (47 table-driven cases + coverage/citation assertions)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A now() default is SAFE, a clock_timestamp() default is REVIEW_REQUIRED -- the Pitfall 1 STABLE-vs-VOLATILE correction, asserted both at the fact level and end to end through the loaded rules file"
    requirement: ANLZ-04
    verification:
      - kind: unit
        ref: "packages/automation/test/inspector-facts.test.ts#classifyDefaultVolatility distinguishes now() (stable) from clock_timestamp() (volatile) in the same case"
        status: pass
      - kind: integration
        ref: "packages/automation/test/classifier.test.ts#a now() default is SAFE and a clock_timestamp() default is REVIEW_REQUIRED, asserted in one test"
        status: pass
    human_judgment: false
  - id: D3
    description: "The complete FEATURES.md section 1 catalogue ships as schema-validated rules.json data: every named rule id present, unique, categorized into all five categories, five-word-minimum rationale, no mistyped fact name/value type, no session-level timeout rule (with the exclusion recorded in a top-level notes field)"
    requirement: ANLZ-03
    verification:
      - kind: unit
        ref: "packages/automation/test/rules-catalogue.test.ts (10 cases)"
        status: pass
    human_judgment: false
  - id: D4
    description: "classifyFacts is independent of rules-array ordering (most-severe-wins over ALL matching rules, ruleIds sorted ascending) and a file's findings list stays complete (never short-circuited on the first BLOCKED)"
    requirement: ANLZ-02
    verification:
      - kind: unit
        ref: "packages/automation/test/classifier.test.ts#shuffling the rules array changes no verdict and no ruleIds set for a fixed set of inputs"
        status: pass
      - kind: integration
        ref: "packages/automation/test/classifier.test.ts#a file with a BLOCKED and a REVIEW_REQUIRED statement returns file verdict BLOCKED and two findings, in statement order"
        status: pass
    human_judgment: false
  - id: D5
    description: "The three D-09 same-file safe-form pairings (NOT VALID->VALIDATE CONSTRAINT, CREATE INDEX CONCURRENTLY->ADD CONSTRAINT UNIQUE USING INDEX, validated CHECK->SET NOT NULL) resolve correctly, the one-character-different near-miss does not pair, and no pairing can ever lower a D-02 floor operation even alongside a would-be partner"
    requirement: ANLZ-04
    verification:
      - kind: integration
        ref: "packages/automation/test/pairing.test.ts (8 cases, including the DROP TABLE floor-guard case and the sentinel-inertness case)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The full pnpm test suite (Phase 1, Phase 2, and all of Phase 3 so far) stays green throughout"
    verification:
      - kind: other
        ref: "pnpm test"
        status: pass
    human_judgment: false

duration: ~29min (approximate -- session start inferred from STATE.md's prior last_updated timestamp, not an explicit capture at this plan's own start; see 03-01-SUMMARY.md's identical caveat)
completed: 2026-09-08
status: complete
---

# Phase 3 Plan 2: Full Classification Catalogue Summary

**The analyzer now discriminates the whole FEATURES.md section 1 catalogue through a real-parser-verified fact vocabulary, a 32-rule schema-validated rules.json (correcting the project's own earlier now()-is-volatile research mistake), and a same-file safe-form pairing pass that can never lower a D-02 floor verdict.**

## Performance

- **Duration:** ~29 min (approximate)
- **Started:** ~2026-09-08T12:11:47Z (approximate)
- **Completed:** 2026-09-08T12:40:38Z
- **Tasks:** 3
- **Files modified:** 10 (5 created, 5 modified)

## Accomplishments

- `inspect.ts` now discriminates every StatementKind the D-04 catalogue needs (23 real, real-SQL-reachable kinds) by dispatching on the AST's own node-type/subtype/contype tags, verified against the actually-installed `libpg-query@17.7.4` parser via a disposable probe script rather than assumed from documentation -- which surfaced two corrections documentation alone would have missed: `DROP DATABASE` is its own `DropdbStmt` node (never a `DropStmt`), and `TruncateStmt.relations` wraps each entry in `{ RangeVar: {...} }` unlike every singular `relation` field
- `function-volatility.ts` encodes 03-RESEARCH.md's Pitfall 1 correction as code: `now()`/`current_timestamp` are STABLE (fast add-column path), never grouped with genuinely VOLATILE functions like `clock_timestamp()`/`gen_random_uuid()` -- an unrecognized function name fails safe to `unknown-function` (REVIEW REQUIRED via D-06), never a guessed SAFE
- `rules.json` grew from the 7-floor-rule/empty-input tracer seed to the complete 29-rule FEATURES.md section 1 catalogue across all five categories (irreversible-data-loss, lock-hazard, compatibility, usually-safe, analyzer-integrity), with a top-level `notes` field recording the deliberate `lock_timeout`/`statement_timeout` exclusion (D-04: that's RUN-02's job, not this analyzer's)
- `classifyFacts` confirmed order-independent (most-severe-wins, ruleIds sorted ascending, proven by a rule-array-shuffle test) and `applySafeFormPairing` added: the three D-09 same-file safe-form pairings, each guarded independently per-finding against ever lowering a D-02 floor operation, with pairing-rule id/rationale sourced from the loaded rules file rather than duplicated as a second hardcoded copy
- Deterministic finding order (ascending statementIndex, then nestedPath) added to `analyze.ts`, running before the pairing pass so its own "earlier"/"later" comparisons are correct

## Task Commits

Each task was committed with a full RED-GREEN cycle (`tdd="true"` for tasks 1 and 3; task 2 is `type="auto"`):

1. **Task 1: The full fact vocabulary**
   - RED: `73cca43` (test) -- 37 failed / 10 passed against the unmodified 03-01 inspector, all genuine per-assertion mismatches
   - GREEN: `0631cde` (feat) -- 47/47 pass; one bug found and fixed during GREEN (TruncateStmt's array-wrapping, see Deviations)
2. **Task 2: Ship the complete FEATURES.md section 1 catalogue as rules data** - `c4d8600` (feat) -- includes a Rule 3 blocking-issue fix to `rules-schema.ts` (see Deviations)
3. **Task 3: Classifier semantics -- severity resolution, complete findings, deterministic order, and same-file safe-form pairing**
   - RED: `72af764` (test) -- 4 failed / 7 passed (the 7 passes document 03-01's already-correct severity behavior; the 4 failures are this task's genuine RED)
   - GREEN: `e661205` (feat) -- 21/21 pass
   - Follow-up: `591fb5c` (test) -- closed a plan-level `<verification>` gap (now()/clock_timestamp() asserted end to end, not just at the fact level); no production code change

**Plan metadata:** commit follows this summary.

## Files Created/Modified

- `packages/automation/src/inspector/function-volatility.ts` - the curated volatility table + `classifyDefaultVolatility`
- `packages/automation/src/inspector/inspect.ts` - full StatementKind discrimination, generalized `readQualifiedName`, new `readRangeVar`, `checkExpressionProvesNotNull`
- `packages/automation/src/rules/rules.json` - 21 new base rules + top-level `notes` + 3 pairing-documentation rules (32 rules total)
- `packages/automation/src/classifier/classify.ts` - `applySafeFormPairing`, `withPairingRuleApplied`, `isFloorOperation`
- `packages/automation/src/classifier/rules-schema.ts` - `FactMatchSchema` gains `z.null()`; `RulesFileSchema` gains optional `notes`
- `packages/automation/src/analyze.ts` - `compareFindings`, pairing pass wired in before verdict computation
- `packages/automation/test/inspector-facts.test.ts`, `rules-catalogue.test.ts`, `classifier.test.ts`, `pairing.test.ts` - the four new test suites (167 total tests project-wide, up from 98 at plan start)

## Decisions Made

See `key-decisions` in frontmatter for the full list. Most load-bearing: **`ALTER TYPE ... DROP VALUE` is permanently unreachable via real SQL** (PostgreSQL's own grammar rejects it unconditionally at parse time), and **the `pair-not-valid-validated` pairing changes no verdict in this implementation** because both halves are already independently SAFE via task 2's own rules -- both documented explicitly rather than left for a future reader to rediscover.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `FactMatchSchema` could not express `usingIndexName: null`**
- **Found during:** Task 2
- **Issue:** Task 2's own action text requires `add-unique-constraint` to match `AddUniqueConstraint` with `usingIndexName: null` (distinguishing the naive inline-index-build form from the USING-an-existing-index form), but `rules-schema.ts`'s `FactMatchSchema` only accepted `string | boolean | Array<string | boolean>` -- `null` would fail schema validation, making the rules file itself un-loadable.
- **Fix:** Added `z.null()` to `FactMatchSchema`'s union; widened `classify.ts`'s `factMatches()` parameter type to match (`===` already handles `null` correctly, no logic change).
- **Files modified:** `packages/automation/src/classifier/rules-schema.ts`, `packages/automation/src/classifier/classify.ts`
- **Verification:** `pnpm exec tsc --noEmit` passes; `rules-catalogue.test.ts`'s `add-unique-constraint matches usingIndexName null` case passes
- **Committed in:** `c4d8600` (Task 2 commit)

**2. [Rule 2 - Missing Critical] `RulesFileSchema` had no field for the timeout-exclusion documentation**
- **Found during:** Task 2
- **Issue:** Task 2's action text requires recording the deliberate `lock_timeout`/`statement_timeout` exclusion "in a top-level `notes` string on the rules file if the schema permits one" -- the schema did not, and zod's default strip behavior would have silently dropped an ad-hoc `notes` key rather than erroring, defeating the point of writing it down.
- **Fix:** Added an optional `notes: z.string()` field to `RulesFileSchema`.
- **Files modified:** `packages/automation/src/classifier/rules-schema.ts`
- **Verification:** `rules-catalogue.test.ts`'s timeout-exclusion test asserts `rulesFile.notes` is defined and mentions the exclusion
- **Committed in:** `c4d8600` (Task 2 commit)

**3. [Rule 1 - Bug] `TruncateStmt.relations` array-wrapping**
- **Found during:** Task 1, GREEN phase (running the RED-authored tests against the new implementation)
- **Issue:** `inspectTruncateStmt` read `relations[0]` as a bare `RangeVar`, matching the pattern every OTHER statement type's singular `relation` field uses -- but `relations` is an ARRAY field, and (confirmed live) every array field in this AST wraps each element in its own node-type tag, so the real shape is `relations[0].RangeVar`, not `relations[0]` directly. Result: `TRUNCATE t` reported `table: null` instead of `"t"`.
- **Fix:** Unwrap the `RangeVar` tag before calling `readRangeVar`.
- **Files modified:** `packages/automation/src/inspector/inspect.ts`
- **Verification:** `inspector-facts.test.ts`'s `TRUNCATE yields Truncate` case passes; full suite re-run green
- **Committed in:** `0631cde` (Task 1 GREEN commit, folded in before committing rather than as a separate fix-up commit)

---

**Total deviations:** 3 auto-fixed (1 bug, 1 missing-critical, 1 blocking)
**Impact on plan:** All three were necessary for the plan's own literal instructions to be satisfiable at all (a rules file that can't express `usingIndexName: null` can't ship task 2's own named rule; a schema that silently drops `notes` can't record the exclusion task 2 asks for; a `TRUNCATE` that reports the wrong table is a real bug caught by the RED-GREEN cycle working as intended). No scope creep -- no field, rule, or code path was added beyond what task 2/task 1 explicitly required.

## Issues Encountered

**gsd-tools.cjs / `workflow.tdd_mode` unavailable in this execution environment.** Tasks 1 and 3 are `tdd="true"`. The full RED-GREEN cycle was still executed genuinely for both (implementation reverted to the pre-plan state, real test failures captured, implementation restored, tests re-run to confirm GREEN -- see the Task Commits section above and each RED commit's message for the exact failed/passed counts observed). `gsd_run check tdd-red-evidence` could not be invoked to machine-validate the RED evidence record (`gsd-tools.cjs` was not present at any of the expected paths in this environment, and `.planning/config.json`'s `workflow` object has no `tdd_mode` key, so strict gate enforcement is not configured for this project regardless). This is recorded here per the TDD reference's own instruction ("If RED or GREEN gate commits are missing, add a `## TDD Gate Compliance` section") -- the commits themselves are present and correctly ordered; only the automated verb-level double-check was unavailable.

## TDD Gate Compliance

| Task | RED commit | GREEN commit | REFACTOR | Status |
|------|-----------|---------------|----------|--------|
| 1 (fact vocabulary) | `73cca43` | `0631cde` | none needed | Pass (manually verified: 37 failed/10 passed -> 47/47 passed) |
| 3 (classifier semantics + pairing) | `72af764` | `e661205` | none needed | Pass (manually verified: 4 failed/7 passed -> 21/21 passed) |

`gsd_run check tdd-red-evidence` unavailable in this environment (see Issues Encountered) -- RED evidence captured and recorded manually in each RED commit's message instead of machine-validated.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Ready:** The full D-04 catalogue is real, schema-validated data with a hardened, order-independent classifier and a same-file pairing pass. Plan 03-03 (adversarial fixtures / squawk cross-check, if that is its scope) can build directly against this catalogue and the inspector's fact vocabulary without renegotiation.
- **Carried forward from 03-01, still unresolved:** `libpg-query@17.7.4` exports no PL/pgSQL parsing function at all -- plan 03-04's D-05 recursion into `DO`/function bodies still needs its own mechanism, not addressed by this plan (out of scope, as planned).
- **New for 03-04:** `AlterTypeDropValue` is confirmed permanently unreachable via real SQL (PostgreSQL's own grammar rejects `ALTER TYPE ... DROP VALUE` unconditionally). If a future phase ever needs enum-narrowing detection, it will need a different signal than this statement kind (e.g. comparing a `CREATE TYPE ... AS ENUM` recreation's value list against the prior one), since this exact AST shape can never arrive.
- **Not yet exercised:** the `must_haves` prohibition on "no parameter/flag/env var may weaken a verdict" still has no counter-example and is still not something an automated test can prove as a negative -- same standing note as 03-01's D7, unchanged by this plan (no new CLI surface was added).

---
*Phase: 03-safety-analyzer*
*Completed: 2026-09-08*

## Self-Check: PASSED
