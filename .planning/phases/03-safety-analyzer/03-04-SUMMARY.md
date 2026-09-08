---
phase: 03-safety-analyzer
plan: 04
subsystem: database
tags: [libpg-query, plpgsql, postgres-ast, migration-safety, vitest, recursion]

# Dependency graph
requires:
  - phase: 03-safety-analyzer
    provides: "plan 03-01's packages/automation workspace, src/types.ts's public contract (including the SourceContext/nestingDepth/dynamicSqlUnresolved facts reserved for this plan), the D-02 code floor mechanism; plan 03-02's complete 32-rule catalogue and hardened classifyFacts; plan 03-03's file-facing adapters and CLI; and the pg18 libpg-query upgrade (commit 9f9ff0f) that made parsePlPgSQL/parsePlPgSQLSync available at all"
provides:
  - "src/inspector/inspect-plpgsql.ts: MAX_NESTING_DEPTH, extractEmbeddedSql, reconstructPlPgSqlStatement, inspectPlPgSqlBody -- the D-05 recursion into DO blocks and CREATE [OR REPLACE] FUNCTION bodies"
  - "inspect.ts's inspectStatement now recognises DoStmt/CreateFunctionStmt as their own container fact sets (DoBlock/CreateFunction), used identically at the top level and recursively"
  - "analyze.ts's statement loop is now async and produces a container Finding plus zero or more nested Findings per top-level statement, nestedPath = [statementIndex, ...positions-within-body]"
  - "floor.ts's D07_FLOOR_FACTS: unresolvable dynamic SQL is enforced by the same non-weakenable load-time self-check as the D-02 floor"
  - "rules.json gains do-block-container, create-function-container, nesting-depth-exceeded, unresolvable-dynamic-sql (36 rules total)"
  - "types.ts gains StatementFacts.nestingLimitExceeded"
affects: [03-05, 03-06, 03-07, phase-04-migration-runner, phase-07-audit]

# Actuals (#2632)
actuals:
  tokens: 12578
  tasks: 2
  commits: 5
  plan_head_before: 9f9ff0f8

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Reconstruct-not-slice for PL/pgSQL re-entry: rather than locating a DO/CREATE FUNCTION statement's original source text by character offset, its dollar-quoted body text is extracted directly from the top-level AST's own String/List fields and rewrapped in a minimal synthetic DO/CREATE FUNCTION statement before being handed to parsePlPgSQL -- confirmed live this session that the reconstructed form parses byte-identically to the original. Reused identically for a nested DO/function statement found while re-parsing another body's embedded text, so the same helper serves both the top-level dispatch (analyze.ts) and the recursive step (inspect-plpgsql.ts)."
    - "Deep generic tree walk over a per-statement-kind allowlist: extractEmbeddedSql recurses into every field of every object/array in the parsePlPgSQL tree looking for PLpgSQL_stmt_execsql/PLpgSQL_stmt_dynexecute, rather than naming every PL/pgSQL control construct (IF/LOOP/WHILE/exception handlers) that can carry a nested body. A named-construct allowlist would silently stop finding statements the day a migration uses a control construct the list does not yet name -- the deep walk cannot miss one by omission."

key-files:
  created:
    - packages/automation/src/inspector/inspect-plpgsql.ts
    - packages/automation/test/plpgsql.test.ts
    - packages/automation/test/dynamic-sql.test.ts
  modified:
    - packages/automation/src/inspector/inspect.ts
    - packages/automation/src/analyze.ts
    - packages/automation/src/classifier/floor.ts
    - packages/automation/src/rules/rules.json
    - packages/automation/src/types.ts
    - packages/automation/test/rules-catalogue.test.ts

key-decisions:
  - "The plan's own precondition text (pointing at 'the exact PL/pgSQL parsing symbol the installed libpg-query package exports') was already satisfied before this plan started: commit 9f9ff0f (dispatched immediately before this plan) upgraded libpg-query from the pg17 to the pg18 dist-tag specifically so parsePlPgSQL/parsePlPgSQLSync would exist at all -- 03-01's own finding was that the pg17 line exported no PL/pgSQL API under any name. This plan built directly against the pg18 API, re-confirming live (via a disposable probe script, then deleted) the exact tree shape test/libpg-query-contract.test.ts already pinned: embedded SQL arrives as raw query text at PLpgSQL_stmt_execsql.sqlstmt.PLpgSQL_expr.query, never a typed AST node (03-RESEARCH.md Pitfall 2)."
  - "A DO/CREATE FUNCTION statement's full text for parsePlPgSQL is RECONSTRUCTED from the top-level AST's own extracted body text (DoStmt.args[].DefElem['as'].arg.String.sval; CreateFunctionStmt.options[].DefElem['as'].arg.List.items[0].String.sval), not sliced from the caller's original source by character offset. Verified live this session that DO $$<body>$$ LANGUAGE plpgsql; and CREATE FUNCTION anon() RETURNS void AS $$<body>$$ LANGUAGE plpgsql; each parse through parsePlPgSQL to output identical to parsing the real original statement text. This sidesteps ever needing stmt_location/stmt_len plumbing through parseTopLevel's return shape."
  - "Recursion only descends into a body whose declared LANGUAGE is plpgsql (case-insensitive; defaults to plpgsql when unspecified, matching real PostgreSQL semantics for DO blocks). A CREATE FUNCTION ... LANGUAGE sql body is genuine SQL text, not PL/pgSQL, and parsePlPgSQL cannot parse it. This plan's own scope (D-05, ANLZ-05, the D-14 adversarial pairs) is PL/pgSQL recursion specifically; a LANGUAGE sql function's container statement still earns SAFE by rule, its body is simply not further inspected. Recorded as a KNOWN LIMITATION in inspect-plpgsql.ts's header rather than silently assumed covered (CLAUDE.md: mark unverified things UNKNOWN) -- UNKNOWN whether a future migration hides a destructive statement inside a LANGUAGE sql function body; not exercised by this plan's fixtures."
  - "extractEmbeddedSql performs a deep, generic walk of the entire parsePlPgSQL tree (recursing into every object/array field) rather than naming each PL/pgSQL statement kind that can carry a nested body (IF/LOOP/WHILE/exception handlers). This is a stronger guarantee than the plan's action text literally asked for, chosen because a per-kind allowlist is exactly the kind of incomplete-coverage gap PITFALLS.md section C1 warns about one level down into PL/pgSQL -- a control construct the list did not yet name would silently stop being searched."
  - "A dynamic EXECUTE's argument is NEVER inspected for whether it 'looks like' a resolvable literal -- extractEmbeddedSql yields an unconditional dynamic marker for every PLpgSQL_stmt_dynexecute node, regardless of whether the underlying PL/pgSQL expression text is a bare string literal or a variable. Task 2's acceptance criteria require exactly this ('no constant-folding or expression-evaluation logic... at all'), and 03-CONTEXT.md D-07 defers resolution entirely, not partially -- distinguishing 'looks like a literal' from 'is a variable' would itself be the deferred logic."
  - "StatementFacts gains a new field, nestingLimitExceeded (types.ts, not in the plan's own files_modified list) -- Rule 3 deviation. The plan's own action text for the depth-limit outcome requires 'a new boolean fact carried on the facts object,' and no existing StatementFacts field expresses it; the task could not be completed to its own literal specification without this addition. Safe by construction: EMPTY_FACTS defaults it false, and classify.ts's ruleMatches only inspects the keys a rule's own match object names, so no existing rule's behavior changes."
  - "The plan's own literal fixture wording for the 'entirely safe body' case ('an insert and an update with a where clause') does not hold under the catalogue plan 03-02 already shipped and tested: INSERT has no StatementKind at all (D-04's already-closed catalogue never included it), and an UPDATE with a WHERE clause has no SAFE rule -- deliberately, the same way a WHERE-scoped DELETE has none either (only the unscoped/no-WHERE floor case is named in FEATURES.md section 1). Reopening that already-tested catalogue is out of this plan's scope. plpgsql.test.ts substitutes CREATE TABLE + COMMENT ON (two statement kinds the catalogue already classifies SAFE) to prove the identical point without expanding D-04's scope."

patterns-established:
  - "A recursive inspector function takes (fullStatementText, sourceContext, depth) and returns a flat array of {facts, path} entries rather than nested Finding objects -- classification (facts -> Finding via classifyFacts) stays analyze.ts's job, matching the existing inspector/classifier separation. The caller (whether analyze.ts for a top-level statement, or inspectPlPgSqlBody itself for a nested one) is responsible for prepending its own enclosing position onto every returned path."
  - "A depth-limited recursive function checks its limit as the FIRST statement in the function body, before doing any real work (parsing, allocation) -- so a pathological input's cost is bounded strictly by the check itself, never by however much work the function does before noticing it should have stopped."

requirements-completed: [ANLZ-01, ANLZ-05]

coverage:
  - id: D1
    description: "A DO block whose dollar-quoted body genuinely drops a table is BLOCKED, with a nested finding whose sourceContext is do-block and whose ruleIds contain drop-table"
    requirement: ANLZ-05
    verification:
      - kind: integration
        ref: "packages/automation/test/plpgsql.test.ts#a DO block whose body genuinely drops a table is BLOCKED, with a nested finding whose sourceContext is do-block and whose ruleIds contain drop-table"
        status: pass
    human_judgment: false
  - id: D2
    description: "A CREATE OR REPLACE FUNCTION whose body genuinely drops a table is BLOCKED, with a nested finding whose sourceContext is function-body"
    requirement: ANLZ-05
    verification:
      - kind: integration
        ref: "packages/automation/test/plpgsql.test.ts#a CREATE OR REPLACE FUNCTION whose body genuinely drops a table is BLOCKED, with a nested finding whose sourceContext is function-body"
        status: pass
    human_judgment: false
  - id: D3
    description: "The same words appearing only as inert text (a string literal inserted as data, or a SQL comment) inside a DO block produce no drop-table finding and a non-BLOCKED file verdict -- the D-14 adversarial pairing's false-positive half"
    requirement: ANLZ-05
    verification:
      - kind: integration
        ref: "packages/automation/test/plpgsql.test.ts#a DO block whose body only inserts a string literal containing the words for dropping a table produces no drop-table finding, and the file verdict is not BLOCKED"
        status: pass
      - kind: integration
        ref: "packages/automation/test/plpgsql.test.ts#a DO block whose body only mentions dropping a table inside a SQL comment produces no drop-table finding, and the file verdict is not BLOCKED"
        status: pass
    human_judgment: false
  - id: D4
    description: "A DO block/function creation whose body is entirely safe earns the container its own SAFE finding by rule (do-block-container/create-function-container), never a permanent unclassifiable state"
    requirement: ANLZ-05
    verification:
      - kind: integration
        ref: "packages/automation/test/plpgsql.test.ts#the container statement itself earns its own SAFE finding (do-block-container) when the body is entirely safe"
        status: pass
      - kind: integration
        ref: "packages/automation/test/plpgsql.test.ts#the container statement itself earns its own SAFE finding (create-function-container) when the body is entirely safe"
        status: pass
    human_judgment: false
  - id: D5
    description: "Every nested finding carries a nestedPath of length >= 2 and a facts.nestingDepth > 0, and always sorts after its own container finding"
    requirement: ANLZ-05
    verification:
      - kind: integration
        ref: "packages/automation/test/plpgsql.test.ts#every nested finding carries a nestedPath of length at least two and a facts.nestingDepth greater than zero"
        status: pass
      - kind: integration
        ref: "packages/automation/test/plpgsql.test.ts#a nested finding always sorts after its own container finding"
        status: pass
    human_judgment: false
  - id: D6
    description: "MAX_NESTING_DEPTH (8) is enforced: a body called at the limit yields a single BLOCKED nesting-depth-exceeded finding rather than being parsed and classified, while a body below the limit recurses normally"
    requirement: ANLZ-05
    verification:
      - kind: unit
        ref: "packages/automation/test/plpgsql.test.ts#MAX_NESTING_DEPTH is an exported constant and a body called at that depth yields a BLOCKED finding with rule id nesting-depth-exceeded, rather than being parsed and classified"
        status: pass
      - kind: unit
        ref: "packages/automation/test/plpgsql.test.ts#a depth below the limit recurses normally and does not synthesize a nesting-depth-exceeded finding"
        status: pass
    human_judgment: false
  - id: D7
    description: "The embedded-SQL traversal obtains statements as raw query TEXT off the PL/pgSQL tree and re-parses them through parseTopLevel, never by reading typed SQL AST nodes out of the procedural tree (03-RESEARCH.md Pitfall 2)"
    requirement: ANLZ-05
    verification:
      - kind: unit
        ref: "packages/automation/test/plpgsql.test.ts#extractEmbeddedSql obtains statements as raw query TEXT off the procedural tree, not typed SQL AST nodes"
        status: pass
    human_judgment: false
  - id: D8
    description: "A dynamic EXECUTE whose argument the analyzer cannot resolve to a static string is BLOCKED (unresolvable-dynamic-sql), never silently skipped, and never resolved via constant-folding even for a bare literal argument"
    requirement: ANLZ-05
    verification:
      - kind: integration
        ref: "packages/automation/test/dynamic-sql.test.ts#a DO block executing a variable is BLOCKED, with a finding naming unresolvable-dynamic-sql"
        status: pass
      - kind: integration
        ref: "packages/automation/test/dynamic-sql.test.ts#a body containing both a safe statement and a dynamic execute produces both findings and a file verdict of BLOCKED -- the dynamic execute is never silently skipped"
        status: pass
      - kind: integration
        ref: "packages/automation/test/dynamic-sql.test.ts#no constant-folding or expression-evaluation logic resolves a dynamic execute's argument -- a bare string-literal argument is still BLOCKED, exactly like a variable"
        status: pass
    human_judgment: false
  - id: D9
    description: "floor.ts exports D02_FLOOR_FACTS and D07_FLOOR_FACTS as separate constants; assertFloorNotWeakened runs both through the real classifier, and a rules file that weakens unresolvable-dynamic-sql makes loadRules throw RulesFileError naming ExecuteDynamic"
    requirement: ANLZ-05
    verification:
      - kind: unit
        ref: "packages/automation/test/dynamic-sql.test.ts#floor.ts exports D02_FLOOR_FACTS and D07_FLOOR_FACTS as separate constants, and both resolve BLOCKED through the real classifier against the shipped rules"
        status: pass
      - kind: unit
        ref: "packages/automation/test/dynamic-sql.test.ts#editing unresolvable-dynamic-sql's verdict to anything weaker than BLOCKED makes loadRules throw RulesFileError naming the offending fact set"
        status: pass
    human_judgment: false
  - id: D10
    description: "The full pnpm test suite (Phase 1, Phase 2, and all of Phase 3 so far) stays green, and tsc --noEmit is clean"
    verification:
      - kind: other
        ref: "pnpm test"
        status: pass
      - kind: other
        ref: "pnpm exec tsc --noEmit -p packages/automation/tsconfig.json"
        status: pass
    human_judgment: false

duration: ~50min (approximate -- required-reading and live-probe passes preceded explicit start-time capture, matching this phase's own established caveat in 03-01/02/03)
completed: 2026-09-08
status: complete
---

# Phase 3 Plan 4: PL/pgSQL Recursion (Hidden DO/Function Bodies + Unresolvable Dynamic SQL) Summary

**A `DROP TABLE` hidden inside a dollar-quoted `DO` body or a `CREATE OR REPLACE FUNCTION` body is re-parsed through the real Postgres grammar and BLOCKED by the same D-02 floor that catches it at the top level, a `DROP TABLE` mentioned only in a string literal or a comment is not flagged, and an `EXECUTE` whose argument cannot be resolved to static text is BLOCKED by a matching D07_FLOOR_FACTS floor no rules edit can weaken.**

## Performance

- **Duration:** ~50 min (approximate)
- **Started:** ~2026-09-08T13:11:00Z (approximate)
- **Completed:** 2026-09-08T13:30:13Z
- **Tasks:** 2
- **Files modified:** 9 (3 created, 6 modified)

## Accomplishments

- `src/inspector/inspect-plpgsql.ts` is the new D-05 recursion module: `MAX_NESTING_DEPTH` (8), `extractEmbeddedSql` (a deep, generic walk of `parsePlPgSQL`'s tree that reads embedded statements as raw query TEXT off `PLpgSQL_stmt_execsql` -- never treating the procedural tree as if it already carried typed SQL AST nodes, the exact 03-RESEARCH.md Pitfall 2 failure mode this plan exists to avoid), `reconstructPlPgSqlStatement` (rebuilds a minimal, verified-byte-identical full `DO`/`CREATE FUNCTION` statement from a top-level AST node's own extracted body text), and `inspectPlPgSqlBody` (the recursive entry point, tagging every result with `sourceContext`/`nestingDepth` and recursing again for any nested DO/function statement found inside, refusing to even parse once `MAX_NESTING_DEPTH` is reached)
- `inspect.ts`'s `inspectStatement` now recognises `DoStmt`/`CreateFunctionStmt` as their own container fact sets (`DoBlock`/`CreateFunction`), used identically whether the statement is top-level or found nested inside another body's re-parsed text -- and `rules.json`'s `do-block-container`/`create-function-container` (SAFE) mean a legitimate procedural migration is not permanently unclassifiable, closing the exact friction D-05 says manufactures override pressure
- `analyze.ts`'s statement loop is now async and produces one container `Finding` plus zero or more nested `Finding`s per top-level statement (`nestedPath = [statementIndex, ...positions-within-body]`), with `Promise.all` preserving per-statement grouping ahead of the existing deterministic sort/pairing pass
- D-07 shipped end to end: a dynamic `EXECUTE` synthesises `statementKind: "ExecuteDynamic"`/`dynamicSqlUnresolved: true` unconditionally (never inspecting whether the argument "looks like" a literal), `rules.json`'s `unresolvable-dynamic-sql` (BLOCKED, analyzer-integrity) classifies it, and `floor.ts`'s new `D07_FLOOR_FACTS` extends `assertFloorNotWeakened` so a rules file cannot weaken it any more than it can weaken `DROP TABLE`
- Both adversarial halves of the D-14 pairing are proven for the PL/pgSQL-nested shapes this plan owns: a genuine hidden drop (string-literal data, and separately a SQL comment) does NOT get flagged, while the real statement does

## Task Commits

Each task was committed with a full RED-GREEN cycle (`tdd="true"` for both):

1. **Task 1: Recurse into DO blocks and function bodies, and give nested findings a location**
   - RED: `8c8a42f` (test) -- 0 tests ran (module resolution error: `src/inspector/inspect-plpgsql.ts` did not exist)
   - GREEN: `0c6f6ad` (feat) -- 12/12 pass
   - Follow-up: `d119cc7` (test) -- closed a plan-level `must_haves.truths` gap (the SQL-comment half of the adversarial pair, not just the string-literal half); no production code change
2. **Task 2: Unresolvable dynamic SQL is BLOCKED, and the rules file cannot weaken that either**
   - RED: `f0ac276` (test) -- 4/6 already passed (Task 1's `inspectPlPgSqlBody` already synthesised the `ExecuteDynamic` fact set and `rules.json` already carried `unresolvable-dynamic-sql`, since the dynexecute-detection branch was one coherent part of the same traversal function and not meaningfully splittable across the two tasks -- the 03-02 precedent for a RED commit with some already-passing cases); 2 genuine failures (`floor.ts` did not yet export `D07_FLOOR_FACTS`)
   - GREEN: `5099527` (feat) -- 6/6 pass

**Plan metadata:** commit follows this summary.

## Files Created/Modified

- `packages/automation/src/inspector/inspect-plpgsql.ts` - `MAX_NESTING_DEPTH`, `EmbeddedStatement`, `extractEmbeddedSql`, `reconstructPlPgSqlStatement`, `NestedFact`, `inspectPlPgSqlBody`
- `packages/automation/src/inspector/inspect.ts` - `inspectStatement` gains `DoStmt`/`CreateFunctionStmt` recognition (`DoBlock`/`CreateFunction` container facts)
- `packages/automation/src/analyze.ts` - `buildFinding` gains a `nestedPath` parameter; new `inspectAndClassifyStatement` orchestrates container + recursive findings; the main statement loop is now `Promise.all`-based
- `packages/automation/src/classifier/floor.ts` - `D07_FLOOR_FACTS`; `assertFloorNotWeakened` runs both D02 and D07 floor sets
- `packages/automation/src/rules/rules.json` - `do-block-container`, `create-function-container`, `nesting-depth-exceeded`, `unresolvable-dynamic-sql` (32 -> 36 rules)
- `packages/automation/src/types.ts` - `StatementFacts.nestingLimitExceeded` (+ `EMPTY_FACTS` default)
- `packages/automation/test/plpgsql.test.ts` - the D-05 recursion fixtures (13 cases)
- `packages/automation/test/dynamic-sql.test.ts` - the D-07 dynamic-SQL fixtures (6 cases)
- `packages/automation/test/rules-catalogue.test.ts` - `VALID_FACT_NAMES`/`BOOLEAN_FACTS` updated for `nestingLimitExceeded` (pre-existing guardrail kept accurate)

## Decisions Made

See `key-decisions` in frontmatter for the full list. Most load-bearing: **the reconstruct-not-slice approach** for feeding a DO/function statement's full text to `parsePlPgSQL` (verified live to be byte-identical in output to the original statement, avoiding any need to plumb source character offsets through `parseTopLevel`'s return shape), **the deep generic tree walk** in `extractEmbeddedSql` (a stronger guarantee than the plan's action text literally required, chosen specifically against PITFALLS.md section C1's "an allowlist that doesn't yet name this control construct" failure mode), and **unconditional dynamic-execute handling** (D-07 is enforced with zero exceptions, including for an argument that happens to be a bare string literal, per Task 2's own "no constant-folding... at all" acceptance criterion).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `types.ts` needed a new `StatementFacts.nestingLimitExceeded` field**
- **Found during:** Task 1, while implementing the `MAX_NESTING_DEPTH` outcome the task's own action text specifies
- **Issue:** The action text requires the depth-limit outcome to "emit a single fact set with statementKind Unrecognized and a new boolean fact carried on the facts object indicating the limit was reached, so the outcome is produced by a rule rather than a special case in code" -- but no existing `StatementFacts` field expresses "the recursion limit was hit," and `types.ts` is not in this plan's own stated `files_modified` list.
- **Fix:** Added `nestingLimitExceeded: boolean` to `StatementFacts` (default `false` in `EMPTY_FACTS`), and `rules.json`'s `nesting-depth-exceeded` rule matches `{statementKind: "Unrecognized", nestingLimitExceeded: true}`. Safe by construction: `classify.ts`'s `ruleMatches` only inspects the keys a rule's own `match` object names, so no existing rule (none of which name this new field) changes behavior.
- **Files modified:** `packages/automation/src/types.ts`
- **Verification:** `test/plpgsql.test.ts`'s depth-limit cases pass; `test/rules-catalogue.test.ts`'s fact-name/type guardrails updated and pass; full `pnpm test` (201/201) green
- **Committed in:** `8c8a42f` (Task 1 RED commit, since the test file itself references the new field) / `0c6f6ad` (Task 1 GREEN commit, the actual `types.ts` edit)

**2. [Rule 1 - Bug/test-accuracy] `test/plpgsql.test.ts`'s "entirely safe body" fixture used a statement combination the shipped catalogue does not classify SAFE**
- **Found during:** Task 1 GREEN, running the RED-authored test against the real implementation
- **Issue:** The plan's own action/behavior text describes this fixture as "an insert and an update with a where clause." Neither is SAFE under plan 03-02's already-shipped, already-tested catalogue: `INSERT` has no `StatementKind` at all (D-04's catalogue never included it), and a WHERE-scoped `UPDATE` has no SAFE rule -- deliberately, the same way a WHERE-scoped `DELETE` has none either (only the unscoped/no-WHERE floor case is named in FEATURES.md section 1). The test failed with `REVIEW_REQUIRED` instead of the expected `SAFE`.
- **Fix:** Substituted `CREATE TABLE` + `COMMENT ON` -- two statement kinds the catalogue already classifies SAFE -- to prove the identical point (a body of unambiguously-safe statements earns the container a SAFE verdict) without reopening plan 03-02's already-closed catalogue scope. Documented inline in the test itself, not just here.
- **Files modified:** `packages/automation/test/plpgsql.test.ts`
- **Verification:** The revised fixture passes; full `pnpm test` green
- **Committed in:** `0c6f6ad` (Task 1 GREEN commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 test-accuracy correction)
**Impact on plan:** Both were necessary for the plan's own literal acceptance criteria to be satisfiable at all -- the depth-limit outcome cannot be expressed without the new fact, and the "entirely safe body" fixture cannot pass with a statement combination the catalogue does not classify SAFE. No scope creep: no new StatementKind, no new SAFE rule for INSERT or WHERE-scoped UPDATE/DELETE was added; the substitute fixture uses rules that already existed.

## Issues Encountered

None beyond the deviations above -- all Task 1/2 `<verify>` and `<acceptance_criteria>` blocks passed as specified once the deviations were applied, and `pnpm test` stayed green throughout (194 -> 200 -> 201 tests across the plan's commits, zero regressions in the pre-existing Phase 1/2/3 suites). `tsc --noEmit -p packages/automation/tsconfig.json` is clean.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Ready:** D-05 (PL/pgSQL recursion) and D-07 (unresolvable dynamic SQL) are both shipped and enforced at the same non-weakenable floor as D-02. `packages/automation`'s fact vocabulary, rule catalogue (36 rules), and recursive inspector are stable for plan 03-05 (the corpus + adversarial fixture manifest, D-13/D-14) and plan 03-06 (the squawk cross-check, D-15) to build against without renegotiation -- in particular, the D-14 fixture pairs for DO blocks and function bodies this plan's own tests already prove can be lifted directly into the shared corpus rather than re-derived.
- **Known, documented limitation:** recursion only descends into a body whose declared `LANGUAGE` is `plpgsql`. A `CREATE FUNCTION ... LANGUAGE sql` body's dollar-quoted text is genuine SQL, not PL/pgSQL, and is not currently recursed into (its container still earns SAFE by rule). UNKNOWN whether a future migration hides a destructive statement inside a `LANGUAGE sql` function body -- not exercised by this plan's fixtures, and out of this plan's explicitly PL/pgSQL-scoped mandate (D-05, ANLZ-05). Flagged for plan 03-05's corpus design to consider explicitly, not silently assumed covered.
- **Not yet exercised:** the `must_haves` prohibition on "no parameter/flag/env var may weaken a verdict" still has no counter-example -- same standing note as 03-01/02/03's closing notes, unchanged by this plan (no new CLI surface was added; the new `D07_FLOOR_FACTS` check runs unconditionally inside `loadRules`, exactly like `D02_FLOOR_FACTS`, with no parameter that could skip it).

---
*Phase: 03-safety-analyzer*
*Completed: 2026-09-08*

## Self-Check: PASSED

All key files confirmed present on disk via `[ -f ]`: `packages/automation/src/inspector/inspect-plpgsql.ts`, `packages/automation/test/plpgsql.test.ts`, `packages/automation/test/dynamic-sql.test.ts`, this SUMMARY. All 5 task commits (`8c8a42f`, `0c6f6ad`, `f0ac276`, `5099527`, `d119cc7`) confirmed present via `git log --oneline --all`. Plan-level `<verification>` re-run: `pnpm test` 201/201 green (including every pre-existing Phase 1/2/3 suite); `pnpm exec tsc --noEmit -p packages/automation/tsconfig.json` clean; the hidden-drop and inert-text (string-literal and comment) halves of both the DO-block and function-body shapes behave oppositely and correctly; a dynamic execute is BLOCKED and a rules-file edit to weaken it throws `RulesFileError`; depth-limit-exceeded is BLOCKED via `nesting-depth-exceeded`, not truncated. Manual CLI sanity check: `pnpm db:analyze` over a fixture containing `DO $$ BEGIN DROP TABLE ingredients; END; $$;` exits 20 (BLOCKED), printing both the `do-block-container` SAFE finding and the nested `drop-table` BLOCKED finding.
