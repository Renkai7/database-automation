---
phase: 03-safety-analyzer
plan: 01
subsystem: database
tags: [libpg-query, zod, postgres-ast, migration-safety, vitest]

# Dependency graph
requires:
  - phase: 01-local-environment
    provides: "the pnpm workspace (packages/* glob) and packages/automation's reserved slot (01-CONTEXT.md D-02); scripts/log.ts's safeErrorMessage convention"
provides:
  - "packages/automation, a new pnpm workspace member with its own package.json"
  - "The complete public contract (Verdict, StatementFacts, Finding, AnalysisResult, EXIT_CODES, AnalyzerParseError, RulesFileError) in src/types.ts that plans 02-07 build against"
  - "analyzeSql(sql, rules) -- pure, importable, no filesystem/DB/network -- the exact shape Phase 4's runner will call in-process"
  - "The D-02 code floor as a load-time self-check (assertFloorNotWeakened) wired into loadRules"
  - "A thin CLI (db:analyze) with five distinct, non-adjacent exit codes"
  - "The observed (not assumed) libpg-query@17.7.4 failure-shape and export-surface contract"
affects: [03-02, 03-03, 03-04, 03-05, 03-06, 03-07, phase-04-migration-runner]

# Actuals (#2632)
actuals:
  tokens: 12173
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: ["libpg-query@17.7.4 (pg17 dist-tag)", "@types/node (packages/automation devDependency)"]
  patterns:
    - "Rules-as-data with a code-enforced floor: assertFloorNotWeakened runs the same classifyFacts function real classification uses against canonical floor fact sets at load time (D-02)"
    - "Pure-core/thin-adapter split: analyzeSql takes SQL text + a loaded rules object only; loadDefaultRules is the one filesystem touch, kept out of the pure function (D-11)"
    - "Non-adjacent exit codes (0/10/20/30/40) so a generic crash (exit 1) can never be mistaken for a verdict (D-12)"

key-files:
  created:
    - packages/automation/package.json
    - packages/automation/tsconfig.json
    - packages/automation/src/types.ts
    - packages/automation/src/inspector/inspect.ts
    - packages/automation/src/classifier/rules-schema.ts
    - packages/automation/src/classifier/floor.ts
    - packages/automation/src/classifier/classify.ts
    - packages/automation/src/rules/rules.json
    - packages/automation/src/analyze.ts
    - packages/automation/src/index.ts
    - packages/automation/src/cli.ts
    - packages/automation/test/fixtures/tracer-drop-table.sql
    - packages/automation/test/tracer.test.ts
    - packages/automation/test/libpg-query-contract.test.ts
    - packages/automation/test/parse-failure.test.ts
    - packages/automation/test/analyze-edges.test.ts
  modified:
    - package.json (added db:analyze script)
    - vitest.config.ts (include glob now covers packages/**/*.test.ts)

key-decisions:
  - "libpg-query@17.7.4 exports NO PL/pgSQL parsing function under any name (no parsePlPgSQL, no PL/pgSQL export at all) -- a real divergence from 03-RESEARCH.md Pattern 4 / Assumption A4, observed directly and pinned by test/libpg-query-contract.test.ts. Plan 04 (D-05 recursion into DO blocks/function bodies) needs a different mechanism than the one 03-RESEARCH.md sketched -- possibly a different package, or a hand-written narrow PL/pgSQL body scanner, since D10 forbids regex-based SQL parsing but a DO/function-body $$...$$ delimiter scan to extract the body text (not to interpret SQL) may be a defensible different case."
  - "libpg-query's parse() rejects empty and whitespace-only SQL with \"Query cannot be empty\" rather than resolving with zero statements -- analyzeSql checks sql.trim().length === 0 before calling the parser at all, so D-06's empty-input contract is never misreported as a D-08 parse failure. Comment-only text needs no such guard: libpg-query resolves it with an empty stmts array on its own."
  - "classifyFacts reports ALL matching rule ids (sorted ascending), not only the ids at the winning severity -- matches the plan's literal 'all matching rule ids are reported' wording and keeps D-10's completeness property at the single-statement level, not just across statements."

patterns-established:
  - "Module header comments state the module's role, its no-side-effects-at-import guarantee, and which repo precedent it copies (scripts/verify-migration-state.ts, scripts/backup-manifest.ts) -- every new packages/automation/src file follows this."
  - "floor.ts takes classifyFacts as an injected function parameter rather than importing classify.ts, so classify.ts can import floor.ts without a circular dependency while still guaranteeing 'the same function, never a duplicate copy.'"

requirements-completed: [ANLZ-01, ANLZ-02, ANLZ-03]

coverage:
  - id: D1
    description: "CLI over a real DROP TABLE fixture exits 20 (BLOCKED) and prints the rule id drop-table"
    requirement: ANLZ-01
    verification:
      - kind: integration
        ref: "packages/automation/test/tracer.test.ts#the CLI exits 20 and prints BLOCKED for the fixture"
        status: pass
      - kind: other
        ref: "pnpm db:analyze packages/automation/test/fixtures/tracer-drop-table.sql; test $? -eq 20"
        status: pass
    human_judgment: false
  - id: D2
    description: "analyzeSql(sql, rules) returns the same BLOCKED verdict for SQL text alone -- no filesystem, database, or network argument in its signature"
    requirement: ANLZ-01
    verification:
      - kind: unit
        ref: "packages/automation/test/tracer.test.ts#analyzeSql classifies the fixture BLOCKED with exactly one finding carrying rule id drop-table"
        status: pass
    human_judgment: false
  - id: D3
    description: "A rules file that assigns the D-02 drop-table floor operation a verdict weaker than BLOCKED makes loadRules throw RulesFileError, with no classification emitted"
    requirement: ANLZ-03
    verification:
      - kind: unit
        ref: "packages/automation/test/tracer.test.ts#refuses to load a rules file whose drop-table rule is weakened to SAFE (D-02 floor)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Unparseable SQL produces AnalyzerParseError (no AnalysisResult) and the CLI exits 30 printing no verdict word"
    requirement: ANLZ-01
    verification:
      - kind: unit
        ref: "packages/automation/test/parse-failure.test.ts#analyzeSql on unparseable input rejects with AnalyzerParseError carrying only the parser's own complaint"
        status: pass
      - kind: integration
        ref: "packages/automation/test/parse-failure.test.ts#the CLI over an unparseable file exits 30 and prints no verdict word"
        status: pass
    human_judgment: false
  - id: D5
    description: "Adjacent statements (semicolon-only and Drizzle statement-breakpoint-separated) each produce their own finding, never merged"
    requirement: ANLZ-01
    verification:
      - kind: unit
        ref: "packages/automation/test/analyze-edges.test.ts#semicolon-adjacent statements with no intervening whitespace produce two findings"
        status: pass
      - kind: unit
        ref: "packages/automation/test/analyze-edges.test.ts#statements separated by Drizzle's statement-breakpoint marker produce two findings"
        status: pass
    human_judgment: false
  - id: D6
    description: "Empty, whitespace-only, and comment-only input yields statementCount 0, verdict REVIEW_REQUIRED, one empty-input finding -- never SAFE, never a parse failure"
    requirement: ANLZ-02
    verification:
      - kind: unit
        ref: "packages/automation/test/analyze-edges.test.ts#analyzeSql(%s) yields statementCount 0, REVIEW_REQUIRED, one empty-input finding"
        status: pass
      - kind: unit
        ref: "packages/automation/test/analyze-edges.test.ts#analyzeSql(%s) never raises AnalyzerParseError"
        status: pass
    human_judgment: false
  - id: D7
    description: "The rules file cannot be weakened by any runtime parameter, flag, or environment variable (must_haves prohibition)"
    verification: []
    human_judgment: true
    rationale: "The plan's own must_haves.prohibitions entry marks this 'status: unverified, verification: flagged' -- the CLI and analyzeSql accept no such parameter today (confirmed by reading cli.ts/analyze.ts's full argument surface), but proving a negative ('will never gain one') is not something an automated test in this plan can assert; a human/reviewer should confirm no such surface exists in this and future plans' diffs."

duration: 35min
completed: 2026-09-08
status: complete
---

# Phase 3 Plan 1: Safety Analyzer Tracer Summary

**A real `DROP TABLE` travels libpg-query parse -> StatementFacts -> zod-validated rules.json -> the D-02 code floor -> a BLOCKED verdict -> CLI exit code 20, with `packages/automation` now existing as its own pnpm workspace member.**

## Performance

- **Duration:** 35 min
- **Started:** 2026-09-08T11:35:00Z (approximate -- required-reading pass preceded explicit timestamp capture)
- **Completed:** 2026-09-08T12:09:45Z
- **Tasks:** 3
- **Files modified:** 19 (16 created, 3 modified: root `package.json`, `vitest.config.ts`, `pnpm-lock.yaml`)

## Accomplishments

- `packages/automation/` created as a pnpm workspace member (`libpg-query@17.7.4` via the `pg17` dist-tag), with the complete public contract fixed in `src/types.ts` for plans 02-07 to build against
- One real `DROP TABLE` proven end to end: `parseTopLevel` (libpg-query AST) -> `inspectStatement` (StatementFacts) -> `classifyFacts` (rules.json) -> BLOCKED verdict -> CLI exit code 20, both via `analyzeSql` directly and via a spawned `pnpm db:analyze` process
- The D-02 code floor implemented as a load-time self-check (`assertFloorNotWeakened`) that runs the loaded rules through the *same* `classifyFacts` function real classification uses; a rules file that weakens `drop-table` to SAFE makes `loadRules` throw `RulesFileError`
- D-08's parse-failure contract pinned by observation, not citation: `libpg-query`'s `parse()` rejects (never resolves-with-an-error-field) on malformed SQL, carrying a `sqlDetails.cursorPosition`; `AnalyzerParseError` wraps `safeErrorMessage` plus that cursor position, and the CLI exits 30 printing no verdict word
- D-06's empty-input contract: empty, whitespace-only, and comment-only input all resolve to `statementCount` 0, verdict `REVIEW_REQUIRED`, one `empty-input` finding -- never SAFE, never a parse failure -- with adjacent statements (semicolon-only and Drizzle's `--> statement-breakpoint` marker) proven to stay separate findings against the real parser

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end tracer** - `b36f6f3` (feat)
2. **Task 2: Pin the libpg-query failure/PL-pgSQL contract** - `ffd775e` (test)
3. **Task 3: Empty-input and adjacent-statement contract** - `d0caacc` (feat)

**Plan metadata:** commit follows this summary.

_Note: Task 2's production code (inspect.ts's parseTopLevel, cli.ts's parse-failure handling) was already correct from Task 1 -- it was written informed by the same observed libpg-query behavior a live smoke test surfaced before any code was written, so Task 2's commit is test-only._

## Files Created/Modified

- `packages/automation/package.json` - workspace member manifest; `libpg-query` dependency, `@types/node` devDependency (deviation, see below)
- `packages/automation/tsconfig.json` - extends the repo's base config; explicit `types: ["node"]` (deviation, see below)
- `packages/automation/src/types.ts` - the complete public contract: `Verdict`, `StatementKind`, `StatementFacts`, `Finding`, `AnalysisResult`, `EXIT_CODES`, `AnalyzerParseError`, `RulesFileError`
- `packages/automation/src/inspector/inspect.ts` - `parseTopLevel`/`inspectStatement`; DropTable recognised, everything else `Unrecognized`
- `packages/automation/src/classifier/rules-schema.ts` - zod schemas for the D-03 rules file
- `packages/automation/src/classifier/floor.ts` - `D02_FLOOR_FACTS` + `assertFloorNotWeakened`
- `packages/automation/src/classifier/classify.ts` - `classifyFacts` + `loadRules`
- `packages/automation/src/rules/rules.json` - the tracer seed catalogue: 7 D-02 floor rules + `empty-input`
- `packages/automation/src/analyze.ts` - `analyzeSql`, `loadDefaultRules`
- `packages/automation/src/index.ts` - the public barrel
- `packages/automation/src/cli.ts` - the thin CLI, distinct exit codes, `--json` flag
- `packages/automation/test/fixtures/tracer-drop-table.sql` - the tracer fixture
- `packages/automation/test/tracer.test.ts`, `libpg-query-contract.test.ts`, `parse-failure.test.ts`, `analyze-edges.test.ts` - the four test suites
- `package.json` (root) - added `db:analyze` script
- `vitest.config.ts` (root) - `include` now covers `packages/**/*.test.ts`; `exclude`/timeouts/`pool`/`fileParallelism` untouched

## Decisions Made

- **libpg-query@17.7.4 has no PL/pgSQL parsing export at all** (see key-decisions in frontmatter) -- a significant, load-bearing divergence from 03-RESEARCH.md's Pattern 4/Assumption A4 that plan 04 (D-05 recursion) must resolve differently than the research sketched.
- **`analyzeSql` special-cases trim-empty input before calling the parser** rather than relying on the parser to report zero statements for empty/whitespace text, because it does not (it rejects instead) -- see key-decisions.
- **`classifyFacts` reports every matching rule id**, not only those at the winning severity, matching D-10's completeness property at single-statement granularity.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `packages/automation` needed its own `@types/node` devDependency and an explicit `"types": ["node"]` in its `tsconfig.json`**
- **Found during:** Task 3 (running `tsc --noEmit` as due-diligence beyond the plan's vitest-only `<verify>`)
- **Issue:** With no `types` override, TypeScript 7.0.2 could not resolve `node:fs`, `node:url`, or the `process` global inside this nested workspace package at all (`Cannot find name 'node:fs'` / `'process'`), even though `apps/recipe-app` (which declares its own `@types/node`) type-checks cleanly. The automatic `@types` walk-up that works for `apps/recipe-app` did not resolve the same way for `packages/automation`'s directory nesting under this TypeScript version.
- **Fix:** Added `@types/node` (`^24.13.3`, matching the root/`apps/recipe-app` pin) to `packages/automation/package.json`'s `devDependencies`, and `"types": ["node"]` to `packages/automation/tsconfig.json`'s `compilerOptions`. `pnpm exec tsc --noEmit -p packages/automation/tsconfig.json` now exits 0.
- **Files modified:** `packages/automation/package.json`, `packages/automation/tsconfig.json`, `pnpm-lock.yaml`
- **Verification:** `tsc --noEmit` exits 0 for the package; `pnpm test` still 98/98 green afterward
- **Committed in:** `d0caacc` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary so the package has a working compile-time type-check at all; no scope creep -- the plan's own literal tsconfig spec (`extends` + `include` only) simply did not anticipate this TypeScript-version-specific resolution gap. No change to any runtime behavior or verified contract.

## Issues Encountered

None beyond the deviation above -- all three tasks' `<verify>` and `<acceptance_criteria>` blocks passed as specified, and `pnpm test` stayed green throughout (84 -> 89 -> 98 tests across the three task commits, zero regressions in the pre-existing Phase 1/Phase 2 suites).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Ready:** `packages/automation`'s public contract (`src/types.ts`, `src/index.ts`) is fixed and stable for plans 02-07 to build against without renegotiation. `classify.ts`/`floor.ts`/`rules-schema.ts` are ready to receive the full D-04 catalogue (plan 02) without structural changes.
- **Blocker/concern for plan 04 (D-05, PL/pgSQL recursion):** `libpg-query@17.7.4` exports no PL/pgSQL parsing function at all -- 03-RESEARCH.md's `parsePlPgSQL` sketch (Pattern 4) does not exist in the installed package. Plan 04 will need to either (a) find and evaluate an alternative package with a real PL/pgSQL parser, or (b) design a narrower mechanism (e.g., extracting a `DO $$ ... $$` / `CREATE FUNCTION ... AS $$ ... $$` body's raw text via the outer statement's own AST fields -- which libpg-query's top-level `parse()` *does* expose for `DoStmt`/`CreateFunctionStmt` -- and re-feeding embedded SQL substrings found by a structural, non-regex extraction back through `parseTopLevel`). This should be resolved as an explicit early step of plan 04, not discovered mid-implementation.
- **Not yet exercised:** the `must_haves` prohibition ("no parameter/flag/env var may emit a verdict weaker than rules+floor produce") has no counter-example today but is not something this plan's automated tests can prove as a negative going forward -- flagged in `coverage` (D7) for ongoing human attention as later plans add CLI surface.

---
*Phase: 03-safety-analyzer*
*Completed: 2026-09-08*

## Self-Check: PASSED

All 12 key files (11 source/test files + this SUMMARY) confirmed present on disk via `[ -f ]`; all 3 task commits (`b36f6f3`, `ffd775e`, `d0caacc`) confirmed present via `git log --oneline --all`. Plan-level `<verification>` re-run: `pnpm test` 98/98 green; `pnpm db:analyze` over the tracer fixture exits 20 with `BLOCKED`/`drop-table` in stdout.
