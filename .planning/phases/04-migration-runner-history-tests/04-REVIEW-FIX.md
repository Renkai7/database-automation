---
phase: 04-migration-runner-history-tests
fixed_at: 2026-09-08T19:50:00Z
review_path: .planning/phases/04-migration-runner-history-tests/04-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 04: Code Review Fix Report

**Fixed at:** 2026-09-08
**Source review:** .planning/phases/04-migration-runner-history-tests/04-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 3 (WR-01, WR-02, WR-03 -- Critical + Warning tier; the two Info findings
  IN-01/IN-02 were out of scope for this run, and IN-02 explicitly requested no action)
- Fixed: 3
- Skipped: 0

## Fixed Issues

### WR-01: `inspectDropStmt` only examined the first object of a multi-object DROP statement

**Files modified:** `packages/automation/src/inspector/inspect.ts`,
`packages/automation/src/analyze.ts` (doc-comment accuracy only, no behavior change),
`packages/automation/test/corpus/manifest.json`,
`packages/automation/test/corpus/blocked/multi-object-drop-table.sql` (new),
`packages/automation/test/multi-object-drop.test.ts` (new), `docs/30-squawk-comparison.md`
**Commit:** `1c4fde0`
**Applied fix:** `inspectDropStmt` changed from returning a single `StatementFacts` (reading only
`dropStmt.objects[0]`) to returning `StatementFacts[]`, mapping every entry of `objects` --
mirroring `inspectAlterTableStmt`'s existing CR-02 fan-out exactly, including the `OBJECT_TABLE`/
`OBJECT_SCHEMA`/`OBJECT_INDEX` switch per object and the `concurrently`/`transactionHostile`
derivation for `DropIndex`. The single call site in `inspectStatement` was updated from
`[inspectDropStmt(...)]` to `inspectDropStmt(...)` directly (it already returns an array). Added a
regression corpus fixture (`DROP TABLE a, b;`) registered in `manifest.json` following the
`multi-subcommand-alter-table.sql` precedent, plus a dedicated test file
(`multi-object-drop.test.ts`, mirroring `multi-subcommand-alter-table.test.ts`) asserting exactly
two findings, distinct `nestedPath` values, correct per-object `table`/`schema` facts, a
`DROP SCHEMA a, b` case, and that a single-object `DROP TABLE a;` is unaffected (still one finding,
empty `nestedPath`).

Adding the new corpus fixture also triggered `squawk-comparison-report.test.ts`'s sync check
(every manifest entry must have a row in `docs/30-squawk-comparison.md`) -- ran the real,
installed `squawk-cli` binary against the new fixture (`ban-drop-table`, `prefer-robust-stmts`,
`require-lock-timeout`, `require-statement-timeout`, byte-identical to the existing single-object
`drop-table.sql` row), appended the row by hand (never regenerated the file, which would have
destroyed the existing hand-filled disagreement analysis), and updated the two counts the test
actually checks (`Corpus files compared: 66`, `## Comparison table (66 rows)`) plus the executive
summary's "29 of 66 rows disagree" line and a new audit-note section documenting the addition,
matching the file's own established precedent for prior additions (CR-02, Phase 4 plans 02/06/07).

### WR-02: A duplicated journal `when` timestamp can make a migration silently skip forever

**Files modified:** `packages/automation/src/adapter/drizzle-migrations.ts`,
`packages/automation/test/run-migrations.test.ts`
**Commit:** `c3c861d`
**Applied fix:** Extended `enumerateMigrationFiles`'s existing duplicate-`idx` guard with an
identical duplicate-`when` guard, using the same "Ordering must be total -- applying nothing"
message shape (naming the duplicated `when` value and both offending tags). Both checks now run
in the same loop over sorted journal entries. Added a test mirroring the existing "a journal with
two entries sharing an idx..." test exactly, with distinct `idx` values and a shared `when`
instead, asserting the thrown error names the duplicated `when` value.

### WR-03: `seed.ts` calls `process.exit()` directly, against the repo's own convention

**Files modified:** `apps/recipe-app/src/db/seed.ts`
**Commit:** `d12ffc0`
**Applied fix:** Replaced both `process.exit(0)`/`process.exit(1)` calls with
`process.exitCode = 0`/`process.exitCode = 1`, letting the script return normally rather than
forcing a synchronous exit -- matching `scripts/db-migrate.ts`'s own established pattern (cited in
the review as the load-bearing convention protecting against a reproduced Windows libuv crash
after a `libpg-query` WASM `parse()` call). Added a short header comment explaining why, so a
future reader copying this file understands the convention rather than reintroducing the drift.

## Skipped Issues

None -- all three in-scope findings were fixed.

## Verification

All verification ran in the main checkout (this repo's `.planning/config.json` has
`workflow.use_worktrees: false`, so per the fixer's documented opt-out path, no isolated worktree
was created for this run -- edits and commits happened directly in the working tree the user was
already on). This means the numbers below are reproducible by running the same commands from this
same checkout right now.

- **TypeScript (Tier 2, per fix):** `npx tsc --noEmit -p packages/automation/tsconfig.json` and
  `npx tsc --noEmit -p apps/recipe-app/tsconfig.json` -- both clean, no errors, run after each
  relevant fix.
- **Default suite (`pnpm test` / `vitest run`, excludes `tests/drill/**` and `tests/history/**`
  per `vitest.config.ts`):** run after all three fixes were applied and again as a final check --
  **45 test files, 447 tests, all passed.**
- **Migration-history suite (`pnpm test:history`, Docker/Testcontainers-backed, exercises
  `enumerateMigrationFiles` directly -- the function WR-02 modified):** Docker Desktop was
  available in this environment (confirmed via `docker version`); ran the real suite --
  **6 test files, 14 tests, all passed**, confirming the WR-02 duplicate-`when` guard did not
  regress the real migration-history proof (the committed `_journal.json` has no duplicate `idx`
  or `when` values, so this is the "does the new check let a legitimate journal through cleanly"
  proof, not a test of the throw path itself -- that path is covered by the new unit test).
- **Restore-drill suite (`pnpm test:drill`):** not run. None of the three fixed findings touch
  backup/restore code, and this suite is unrelated to any of them -- running it would not add
  verification signal for these specific changes.
- No production database was touched or connected to at any point (the history suite uses
  Testcontainers-managed ephemeral Postgres containers, and `pnpm test:history`/the default suite
  never read a production connection string).
- No credentials were logged or committed in any of the three commits.

## Notes for the developer

- WR-01's fix is a straightforward structural mirror of the already-shipped CR-02 fan-out
  (`inspectAlterTableStmt`), applied to `inspectDropStmt`. No logic judgment call was required
  beyond following that existing pattern, so this is not flagged for extra human logic review.
- WR-02's fix follows the same "same message shape, same category of ambiguity" instruction the
  review gave verbatim. Verified the real migration-history suite still passes with the new guard
  in place.
- WR-03 is the lowest-risk of the three (documentation-of-convention fix, no logic change to
  program behavior beyond how the process exit code is set).

---

_Fixed: 2026-09-08_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
