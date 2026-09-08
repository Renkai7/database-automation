---
phase: 03-safety-analyzer
plan: 03
subsystem: database
tags: [libpg-query, drizzle, cli, exit-codes, vitest, windows, libuv]

# Dependency graph
requires:
  - phase: 03-safety-analyzer
    provides: "plan 03-01's packages/automation workspace, src/types.ts's EXIT_CODES/AnalyzerParseError/RulesFileError contract, and plan 03-02's complete 32-rule catalogue + hardened classifyFacts"
provides:
  - "src/adapter/drizzle-migrations.ts: enumerateMigrationFiles, the only module (alongside the CLI) permitted Drizzle/journal knowledge -- enumerates apps/recipe-app/drizzle/*.sql against meta/_journal.json, hard-failing on either mismatch direction"
  - "src/adapter/default-rules.ts: loadDefaultRules relocated out of analyze.ts so the pure core stays provably free of filesystem imports (D-11)"
  - "The complete CLI surface (src/cli.ts): --json, --migrations, five distinct exit codes (0/10/20/30/40) via EXIT_CODES exclusively, worst-verdict-wins across multiple files with no short-circuiting, a per-finding human report"
  - "db:analyze:migrations root package.json script"
  - "packages/automation's \"./adapter\" package.json exports subpath"
  - "A Windows-specific fix for a genuine libuv crash when process.exit() races WASM async-handle teardown after 2+ libpg-query parses in one process"
affects: [phase-04-migration-runner, phase-05-ci-gate, phase-07-audit]

# Actuals (#2632)
actuals:
  tokens: 9045
  tasks: 2
  commits: 4
  plan_head_before: 046186b7045a3fb0e9ae1d15622a8911e3c5e1d7

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-adapter split under src/adapter/: drizzle-migrations.ts (Drizzle/journal knowledge) and default-rules.ts (bundled rules-catalogue loading) are the only two source modules, alongside cli.ts, permitted a node:fs import -- src/inspector/, src/classifier/, and src/analyze.ts are mechanically checked to have none, via a purity test built at runtime so its own source never contains the literal it searches for (tests/guardrails.test.ts's established idiom, applied inside packages/automation for the first time)."
    - "CLI entry points return their intended exit code from an async run() function rather than calling process.exit() at all; the caller applies process.exitCode once run() settles. Avoids a real Windows libuv race this task's own multi-file <verify> step surfaced."

key-files:
  created:
    - packages/automation/src/adapter/drizzle-migrations.ts
    - packages/automation/src/adapter/default-rules.ts
    - packages/automation/test/adapter.test.ts
    - packages/automation/test/cli.test.ts
  modified:
    - packages/automation/src/analyze.ts
    - packages/automation/src/cli.ts
    - packages/automation/src/index.ts
    - packages/automation/package.json
    - package.json (root)
    - packages/automation/test/tracer.test.ts
    - packages/automation/test/parse-failure.test.ts
    - packages/automation/test/classifier.test.ts
    - packages/automation/test/analyze-edges.test.ts
    - packages/automation/test/pairing.test.ts

key-decisions:
  - "analyze.ts's own must_have truth (\"no module under src/inspector, src/classifier or src/analyze.ts imports node:fs\") was violated by the code this plan inherited from 03-01: loadDefaultRules lived inside analyze.ts and imported node:fs directly. Fixed by extracting loadDefaultRules (and its DEFAULT_RULES_PATH constant) into a new sibling adapter, src/adapter/default-rules.ts -- kept separate from drizzle-migrations.ts because rules-catalogue loading has no Drizzle-specific knowledge, matching that module's own deliberately narrow scope. This is a Rule 1 (bug) deviation: analyzeSql's own behavior is unchanged, only the import's location moved, but it required mechanically updating the loadDefaultRules import path in 5 pre-existing test files plus cli.ts."
  - "A synchronous process.exit() called immediately after two or more libpg-query WASM parse() calls in one Node process reproducibly crashes on this Windows machine with a genuine libuv assertion failure (\"Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\\win\\async.c, line 94\", raw exit code 3221226505) -- process.exit() races libuv's own teardown of a WASM module's async handle. This was NOT present in plan 03-01/03-02 because no prior test spawned the CLI against more than one file in a single process. Fixed by restructuring cli.ts's main() into run(): Promise<number>, which returns the intended exit code instead of ever calling process.exit(); the caller applies process.exitCode once run() settles, letting the event loop drain naturally instead of forcing termination. Reproduced and confirmed fixed by direct manual invocation before writing this into the automated test suite."
  - "The CLI has no override flag or environment variable for which rules file loads, matching the plan's own literal argument surface (--json, --migrations, and file paths only) and the must_haves prohibition (no parameter may emit a verdict weaker than rules-plus-floor produce). test/cli.test.ts's RULES_INVALID (exit 40) case therefore proves the real spawned binary's behavior by temporarily backing up and overwriting the actual bundled src/rules/rules.json on disk (weakening drop-table to SAFE, mirroring tracer.test.ts's in-memory precedent), restoring the original content in a finally block so a failed assertion can never leave the real rules file corrupted."
  - "Two Windows-only test artifacts needed no production-code change: `pnpm run <script>` prints its own \"> package@ script ...\" banner ahead of the script's real stdout on this machine, so --json output is extracted via a bracket-depth scan from the first \"[\" rather than assuming stdout is JSON in its entirety; and nested cmd.exe invocation can double backslashes in a path argument passed through pnpm's Windows shim, so the multi-file test compares file basenames rather than full paths."

patterns-established:
  - "A filesystem-touching module gets its own file under src/adapter/ scoped to exactly one kind of disk knowledge (Drizzle journal vs. bundled rules catalogue) rather than one adapter module accreting unrelated fs responsibilities."
  - "A CLI entry point's main logic is an async function returning its intended numeric exit code; the single call site at the bottom of the file applies process.exitCode once and never calls process.exit() directly."

requirements-completed: [ANLZ-01, ANLZ-02]

coverage:
  - id: D1
    description: "enumerateMigrationFiles enumerates the recipe app's two real migrations against meta/_journal.json in journal order, and hard-fails (naming the offending tag or filename) on either mismatch direction rather than skipping silently"
    requirement: ANLZ-01
    verification:
      - kind: unit
        ref: "packages/automation/test/adapter.test.ts#with no arguments returns exactly two entries for this repository, tagged 0000_bumpy_khan then 0001_busy_thunderbolt"
        status: pass
      - kind: unit
        ref: "packages/automation/test/adapter.test.ts#throws naming the tag and the path it looked for when a journal entry has no matching SQL file"
        status: pass
      - kind: unit
        ref: "packages/automation/test/adapter.test.ts#throws naming the file when a SQL file present in the migrations directory has no journal entry"
        status: pass
    human_judgment: false
  - id: D2
    description: "The classifier core (src/inspector/, src/classifier/, src/analyze.ts) never imports a filesystem module -- only the two adapter modules and the CLI do"
    requirement: ANLZ-01
    verification:
      - kind: unit
        ref: "packages/automation/test/adapter.test.ts#no module under src/inspector/, src/classifier/, or src/analyze.ts imports a filesystem module (D-11)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The CLI exits 0/10/20/30/40 for SAFE/REVIEW_REQUIRED/BLOCKED/parse-failure/rules-invalid respectively, five distinct codes none of them 1"
    requirement: ANLZ-02
    verification:
      - kind: integration
        ref: "packages/automation/test/cli.test.ts#a SAFE input exits 0 / a REVIEW_REQUIRED input exits 10 / a BLOCKED input exits 20 / an unparseable input exits 30 / a rules file that weakens the D-02 drop-table floor exits 40"
        status: pass
    human_judgment: false
  - id: D4
    description: "Given several input files the CLI exits with the code for the most severe verdict and still prints a report section for every file, including ones after the first BLOCKED"
    requirement: ANLZ-02
    verification:
      - kind: integration
        ref: "packages/automation/test/cli.test.ts#three input files whose verdicts are SAFE, BLOCKED and REVIEW_REQUIRED exit 20 and print a section for all three"
        status: pass
    human_judgment: false
  - id: D5
    description: "--json emits a parseable array whose entries carry a path, a verdict and a complete findings array with rule ids and rationale text"
    requirement: ANLZ-02
    verification:
      - kind: integration
        ref: "packages/automation/test/cli.test.ts#--json emits a parseable array whose entries carry a path, a verdict and findings with rule ids and rationale"
        status: pass
    human_judgment: false
  - id: D6
    description: "The human report names, for every finding, the statement index, the verdict, the rule ids and the rationale"
    requirement: ANLZ-02
    verification:
      - kind: integration
        ref: "packages/automation/test/cli.test.ts#the human report for a BLOCKED file names the statement index, the verdict, the rule id and the rationale"
        status: pass
    human_judgment: false
  - id: D7
    description: "--migrations sources inputs from enumerateMigrationFiles and runs to completion against the repository's two real migrations, printing a section for each"
    requirement: ANLZ-02
    verification:
      - kind: integration
        ref: "packages/automation/test/cli.test.ts#--migrations analyses every file the adapter enumerates instead of paths given on the command line"
        status: pass
      - kind: other
        ref: "pnpm db:analyze:migrations"
        status: pass
    human_judgment: false
  - id: D8
    description: "The full pnpm test suite (Phase 1, Phase 2, and all of Phase 3 so far) stays green"
    verification:
      - kind: other
        ref: "pnpm test"
        status: pass
    human_judgment: false
  - id: D9
    description: "The must_haves prohibition that no parameter/flag/env var may emit a verdict weaker than rules-plus-floor produce still has no counter-example (carried forward from 03-01's D7/03-02's standing note)"
    verification: []
    human_judgment: true
    rationale: "Same standing note as 03-01-SUMMARY.md's D7 and 03-02-SUMMARY.md's closing note: the CLI's argument surface (--json, --migrations, file paths) has no such parameter today, confirmed by reading cli.ts's complete argument-handling code, but proving a negative for all future diffs is not something this plan's automated tests can assert -- flagged for ongoing human attention, unchanged by this plan."

duration: ~20min (approximate -- required-reading pass preceded explicit start-time capture, matching 03-01/03-02's own identical caveat)
completed: 2026-09-08
status: complete
---

# Phase 3 Plan 3: File-Facing Surfaces (Drizzle Adapter + CLI) Summary

**A `src/adapter/` pair (Drizzle migration enumeration + default-rules loading) keeps the classifier core provably filesystem-free, and the CLI now has five non-adjacent exit codes, a `--migrations` flag, and a `--json` machine contract -- with a genuine Windows libuv crash (`process.exit()` racing libpg-query WASM teardown after 2+ parses) found and fixed along the way.**

## Performance

- **Duration:** ~20 min (approximate)
- **Started:** ~2026-09-08T12:44:00Z (approximate)
- **Completed:** 2026-09-08T13:01:50Z
- **Tasks:** 2
- **Files modified:** 14 (4 created, 10 modified)

## Accomplishments

- `src/adapter/drizzle-migrations.ts`'s `enumerateMigrationFiles` enumerates the recipe app's two real migrations against `meta/_journal.json` in journal order, hard-failing (naming the offending tag or filename) on either mismatch direction rather than skipping silently
- Fixed a real violation of this plan's own must-have truth inherited from 03-01: `analyze.ts` imported `node:fs` (via `loadDefaultRules`), which a new purity test in `test/adapter.test.ts` now mechanically proves is false for `src/inspector/`, `src/classifier/`, and `src/analyze.ts` -- `loadDefaultRules` moved to a new sibling adapter, `src/adapter/default-rules.ts`
- The CLI (`src/cli.ts`) now has five distinct, non-adjacent exit codes driven exclusively by `EXIT_CODES` (0/10/20/30/40), a `--migrations` flag sourcing inputs from the adapter instead of positional paths, worst-verdict-wins across multiple files with no short-circuiting (D-10), and a `--json` machine contract carrying the complete findings list
- Found and fixed a genuine Windows-specific bug: a synchronous `process.exit()` called right after two or more `libpg-query` WASM `parse()` calls in one process crashed with a real libuv assertion failure (raw exit code 3221226505) -- `cli.ts`'s `main()` was restructured into `run(): Promise<number>`, which never calls `process.exit()`, letting Node's event loop drain naturally via `process.exitCode`
- `db:analyze:migrations` added to the root `package.json`, confirmed to run to completion against the repository's two real migrations

## Task Commits

Each task was committed with a full RED-GREEN cycle (`tdd="true"` for both):

1. **Task 1: The Drizzle adapter -- the one module allowed to know about files and journals**
   - RED: `61d4fd3` (test) -- 0 tests ran (module resolution error: `src/adapter/drizzle-migrations.ts` did not exist)
   - GREEN: `f604304` (feat) -- 5/5 pass; includes the Rule 1 purity fix (analyze.ts's `loadDefaultRules` extraction) required for the purity assertion itself to pass
2. **Task 2: The CLI surface -- five distinct outcome codes, a complete human report, and machine JSON**
   - RED: `bb88b54` (test) -- 4/9 failed against the task-1 CLI (no `RULES_INVALID` handling, no `--migrations`, and a genuine multi-file process crash), 5/9 already passed (inherited correctly from task 1)
   - GREEN: `a6a2742` (feat) -- 9/9 pass; includes the Rule 1 libuv-crash fix

**Plan metadata:** commit follows this summary.

## Files Created/Modified

- `packages/automation/src/adapter/drizzle-migrations.ts` - `DEFAULT_MIGRATIONS_DIR`, `DEFAULT_JOURNAL_PATH`, `enumerateMigrationFiles`, `MigrationFile`
- `packages/automation/src/adapter/default-rules.ts` - `loadDefaultRules`, relocated out of `analyze.ts` (Rule 1 fix)
- `packages/automation/src/analyze.ts` - `node:fs` import and `loadDefaultRules`/`DEFAULT_RULES_PATH` removed; `analyzeSql` itself unchanged
- `packages/automation/src/cli.ts` - `--migrations` flag, `RulesFileError` -> `EXIT_CODES.RULES_INVALID` handling, `main()` restructured into `run(): Promise<number>` (libuv-crash fix)
- `packages/automation/src/index.ts` - barrel gains `enumerateMigrationFiles`/`DEFAULT_MIGRATIONS_DIR`/`DEFAULT_JOURNAL_PATH`/`MigrationFile`, `loadDefaultRules`'s source updated
- `packages/automation/package.json` - `"./adapter"` exports subpath
- `package.json` (root) - `db:analyze:migrations` script
- `packages/automation/test/adapter.test.ts` - `enumerateMigrationFiles` behavior (4 cases) + the core purity assertion
- `packages/automation/test/cli.test.ts` - all five exit codes, multi-file worst-verdict-wins, `--json`, `--migrations`, human-report content
- `packages/automation/test/tracer.test.ts`, `parse-failure.test.ts`, `classifier.test.ts`, `analyze-edges.test.ts`, `pairing.test.ts` - `loadDefaultRules` import path updated to `../src/adapter/default-rules` (mechanical, required by the Rule 1 extraction)

## Decisions Made

See `key-decisions` in frontmatter for the full list. Most load-bearing: **the plan's own must-have truth that `analyze.ts` never imports a filesystem module was false on disk at the start of this plan** (inherited from 03-01's `loadDefaultRules` placement) and required a genuine extraction, not just a new adapter file; and **a real Windows libuv crash** was found by this task's own multi-file `<verify>` step, not injected artificially -- fixed at the CLI's exit-handling architecture level, not papered over.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `analyze.ts` imported `node:fs`, violating the plan's own must-have core-purity truth**
- **Found during:** Task 1, while implementing the purity test the task's own action text specifies
- **Issue:** `loadDefaultRules` and `DEFAULT_RULES_PATH` lived inside `src/analyze.ts` (inherited from plan 03-01) and imported `readFileSync`/`fileURLToPath`, so the module-level `import { readFileSync } from "node:fs"` made `analyze.ts` fail the plan's own must_haves truth ("no module under src/inspector, src/classifier or src/analyze.ts imports node:fs") before any new code was written.
- **Fix:** Extracted `loadDefaultRules`/`DEFAULT_RULES_PATH` into a new sibling adapter module, `packages/automation/src/adapter/default-rules.ts` (kept separate from `drizzle-migrations.ts` since rules-catalogue loading has no Drizzle-specific knowledge). `analyzeSql` itself is byte-for-byte unchanged; only the import's location moved.
- **Files modified:** `packages/automation/src/analyze.ts`, `packages/automation/src/adapter/default-rules.ts` (new), `packages/automation/src/index.ts`, `packages/automation/src/cli.ts`, plus the `loadDefaultRules` import line in `tracer.test.ts`, `parse-failure.test.ts`, `classifier.test.ts`, `analyze-edges.test.ts`, `pairing.test.ts`
- **Verification:** `test/adapter.test.ts`'s purity assertion passes; full `pnpm test` (172/172 at the time) green
- **Committed in:** `f604304` (Task 1 GREEN commit)

**2. [Rule 1 - Bug] A synchronous `process.exit()` after 2+ `libpg-query` WASM parses crashed the process on Windows**
- **Found during:** Task 2, running the plan's own multi-file `<verify>`/acceptance criteria against the real CLI
- **Issue:** `cli.ts`'s `main()` called `process.exit(EXIT_CODES[...])` at several points. When two or more input files were analysed in one invocation (each internally calling `libpg-query`'s WASM `parse()`), the immediately-following `process.exit()` reproducibly crashed with `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94` and a raw exit code of 3221226505 -- `process.exit()` racing libuv's own teardown of a WASM module's async handle. Confirmed deterministic (100% reproduction across repeated manual runs) and confirmed absent for single-file invocations.
- **Fix:** Restructured `main()` into `run(): Promise<number>`, which returns the intended exit code from every path instead of calling `process.exit()` anywhere. The single call site at the bottom of the file (`run().then(...).catch(...)`) sets `process.exitCode` and lets Node's event loop drain naturally, which sidesteps the race entirely.
- **Files modified:** `packages/automation/src/cli.ts`
- **Verification:** Manually reproduced the crash before the fix (3 separate manual runs, 100% reproduction) and confirmed clean exit-code-20 output after the fix (3 separate manual runs); `test/cli.test.ts`'s multi-file and `--json` multi-file cases pass; full `pnpm test` (181/181) green
- **Committed in:** `a6a2742` (Task 2 GREEN commit)

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both were necessary for the plan's own literal acceptance criteria to be satisfiable at all -- a purity assertion that fails against the code it's supposed to prove correct, and a CLI whose own `<verify>` step (a real multi-file `--json` run) crashes, are not things Task 1/2 could have been marked complete over. No scope creep: no behavior beyond what each task's own action text and acceptance criteria required was added.

## Issues Encountered

Two test-only Windows artifacts, neither a production-code defect, both fixed inside `test/cli.test.ts` itself:
- `pnpm run <script>` prints its own `"> package@ script ..."` banner ahead of the script's real stdout on this machine (and an `"ELIFECYCLE"` footer after, on non-zero exit) -- the `--json` test parses via a bracket-depth scan from the first `"["` rather than assuming stdout is JSON in its entirety.
- Nested `cmd.exe` invocation (pnpm's Windows script-running chain) can double backslashes in a path argument built via `node:path`'s `join` -- the multi-file test compares file basenames rather than full paths, which is what the acceptance criterion ("a section for each of the three input paths") actually needs to prove.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Ready:** The analyzer now has both file-facing surfaces the phase's own success criteria require -- a Drizzle-aware adapter and a CLI with machine-readable exit codes and JSON -- with the classifier core mechanically proven filesystem-free. Plan 03-04 (D-05 PL/pgSQL recursion) and any later plan that spawns the CLI can build directly on this without renegotiation.
- **Carried forward from 03-01/03-02, still unresolved:** `libpg-query@17.7.4` exports no PL/pgSQL parsing function at all -- plan 03-04's D-05 recursion into `DO`/function bodies still needs its own mechanism (unaffected by this plan).
- **New for any future plan that spawns this CLI more than once per process, or from a long-lived process:** the libuv crash this plan fixed was specific to `process.exit()` racing WASM handle teardown after 2+ `libpg-query` parses -- the `run(): Promise<number>` pattern this plan established (never call `process.exit()`, apply `process.exitCode` once) should be the template for Phase 4's runner if it ever needs its own CLI entry point, not a one-off patch.
- **Not yet exercised:** the `must_haves` prohibition on "no parameter/flag/env var may weaken a verdict" still has no counter-example -- same standing note as 03-01's D7/03-02's closing note, unchanged by this plan (the CLI's argument surface grew by exactly `--migrations`, which sources inputs differently but runs the identical `analyzeSql`/`loadDefaultRules` path).

---
*Phase: 03-safety-analyzer*
*Completed: 2026-09-08*

## Self-Check: PASSED

All key files confirmed present on disk via `[ -f ]`: `packages/automation/src/adapter/drizzle-migrations.ts`, `packages/automation/src/adapter/default-rules.ts`, `packages/automation/test/adapter.test.ts`, `packages/automation/test/cli.test.ts`, this SUMMARY. All 4 task commits (`61d4fd3`, `f604304`, `bb88b54`, `a6a2742`) confirmed present via `git log --oneline --all`. Plan-level `<verification>` re-run: `pnpm test` 181/181 green; `pnpm exec tsc --noEmit -p packages/automation/tsconfig.json` clean; `pnpm db:analyze --json packages/automation/test/fixtures/tracer-drop-table.sql` exits 20 with valid JSON; `pnpm db:analyze:migrations` analyses both real migrations, prints a section for each, exits 10 (REVIEW_REQUIRED, correctly -- the second migration's plain foreign keys); core purity assertion passes.
