---
phase: 04-migration-runner-history-tests
reviewed: 2026-09-08T00:00:00Z
depth: standard
files_reviewed: 62
files_reviewed_list:
  - apps/recipe-app/drizzle.config.ts
  - apps/recipe-app/drizzle/0002_oval_maelstrom.sql
  - apps/recipe-app/drizzle/0003_backfill_steps_timer_label.sql
  - apps/recipe-app/drizzle/0004_redundant_apocalypse.sql
  - apps/recipe-app/drizzle/meta/0002_snapshot.json
  - apps/recipe-app/drizzle/meta/0003_snapshot.json
  - apps/recipe-app/drizzle/meta/0004_snapshot.json
  - apps/recipe-app/drizzle/meta/_journal.json
  - apps/recipe-app/src/db/schema.ts
  - apps/recipe-app/src/db/seed.ts
  - docs/30-migration-runner.md
  - docs/30-squawk-comparison.md
  - docs/decisions.md
  - docs/migration-history-status.json
  - package.json
  - packages/automation/src/adapter/drizzle-migrations.ts
  - packages/automation/src/classifier/floor.ts
  - packages/automation/src/index.ts
  - packages/automation/src/inspector/inspect.ts
  - packages/automation/src/rules/rules.json
  - packages/automation/src/runner/client.ts
  - packages/automation/src/runner/exit-codes.ts
  - packages/automation/src/runner/ledger.ts
  - packages/automation/src/runner/run-migrations.ts
  - packages/automation/src/runner/runner-table.ts
  - packages/automation/src/runner/split-statements.ts
  - packages/automation/src/runner/timeouts.ts
  - packages/automation/src/runner/transaction-policy.ts
  - packages/automation/src/types.ts
  - packages/automation/test/adapter.test.ts
  - packages/automation/test/corpus.test.ts
  - packages/automation/test/corpus/adversarial/comment-mentions-set-lock-timeout.sql
  - packages/automation/test/corpus/adversarial/set-lock-timeout-in-do-block.sql
  - packages/automation/test/corpus/app-shaped/generated-drop-ingredients-table.sql
  - packages/automation/test/corpus/blocked/alter-database-set-lock-timeout.sql
  - packages/automation/test/corpus/blocked/alter-system-set-statement-timeout.sql
  - packages/automation/test/corpus/blocked/reset-all.sql
  - packages/automation/test/corpus/manifest.json
  - packages/automation/test/corpus/review-required/create-database.sql
  - packages/automation/test/corpus/review-required/reindex-index.sql
  - packages/automation/test/corpus/review-required/set-search-path.sql
  - packages/automation/test/corpus/review-required/vacuum-analyze.sql
  - packages/automation/test/corpus/usually-safe/create-index-concurrently-standalone.sql
  - packages/automation/test/inspector-facts.test.ts
  - packages/automation/test/ledger.test.ts
  - packages/automation/test/rules-catalogue.test.ts
  - packages/automation/test/run-migrations.test.ts
  - packages/automation/test/runner-table.test.ts
  - packages/automation/test/split-statements.test.ts
  - packages/automation/test/timeout-disarm-floor.test.ts
  - packages/automation/test/transaction-hostile.test.ts
  - packages/automation/test/transaction-policy.test.ts
  - scripts/db-migrate-recover.ts
  - scripts/db-migrate.ts
  - scripts/db-reset.ts
  - scripts/drill-assertions.ts
  - scripts/history-status.ts
  - scripts/history-suite.ts
  - scripts/verify-migration-state.ts
  - tests/db-migrate-recover.test.ts
  - tests/db-reset.test.ts
  - tests/dev-database-baseline.test.ts
  - tests/guardrails.test.ts
  - tests/history-status.test.ts
  - tests/history/blocked-replay.test.ts
  - tests/history/empty-db-full-history.test.ts
  - tests/history/existing-db-newest-only.test.ts
  - tests/history/partial-failure-recovery.test.ts
  - tests/history/support.ts
  - tests/history/tamper-then-refuse.test.ts
  - tests/history/timeouts-and-concurrently.test.ts
  - tests/migrate.test.ts
  - tests/target-pin.test.ts
  - vitest.config.ts
  - vitest.history.config.ts
findings:
  critical: 0
  warning: 3
  info: 2
  total: 5
status: issues_found
---

# Phase 04: Code Review Report

**Reviewed:** 2026-09-08
**Depth:** standard
**Files Reviewed:** 62 (of the files listed in `required_reading`; several files, e.g.
`packages/automation/test/rules-catalogue.test.ts` and `packages/automation/test/inspector-facts.test.ts`,
were confirmed via `git log` to be untouched by this phase's diff and reviewed only for context)
**Status:** issues_found (no BLOCKER-tier findings; three WARNING-tier findings)

## Summary

This phase's central claim — classify-then-execute on the exact in-memory buffer, with a BLOCKED
verdict that cannot be overridden by any flag, environment variable, or configuration value — holds
up under adversarial reading. I traced every gap the task explicitly asked me to look for:

- `run-migrations.ts`: Phase A (classify everything) runs fully before Phase B (execute anything),
  so a parse failure anywhere aborts before any statement runs (D-08). The unresolved-marker check
  runs before even Phase A. `RunMigrationsOptions` is a closed, three-key surface
  (`migrations`/`rules`/`now`) and `run-migrations.test.ts` proves an injected fourth key is inert.
  The BLOCKED branch throws unconditionally with no config read anywhere near it. I did not find a
  path by which the executed statement text could diverge from the classified text: both
  `analyzeSql` and `splitStatements` parse the identical `file.sql` string that
  `enumerateMigrationFiles` read exactly once from disk.
- `floor.ts`: `assertFloorNotWeakened`/`assertUnmatchedDefaultsToReview` re-derive verdicts through
  the real `classifyFacts`, never a duplicated copy of the matching logic, and are exercised by
  `timeout-disarm-floor.test.ts`'s four tampering shapes (weakening the rule, deleting it,
  enumerating `disarmsTimeout`'s two legal values, enumerating `transactionHostile`'s two legal
  values) — all four are proven to throw `RulesFileError`. I checked whether the enumeration
  exploit could also defeat the D-02 floor specifically (not just D-06's default) and confirmed it
  cannot: a genuine floor rule's BLOCKED still wins the worst-verdict-wins reduction even when an
  exploit rule also matches with SAFE.
- `inspect.ts`: `transactionHostile`/`disarmsTimeout` are read from AST shape (`concurrent`,
  `setstmt.kind`/`setstmt.name`), never derived from statement text, and the `VAR_RESET_ALL` case
  (no `name` field at all) is handled by unconditional disarm rather than a name check that would
  silently miss it. Nested survival through DO blocks is exercised live in both
  `transaction-hostile.test.ts` and the corpus's `set-lock-timeout-in-do-block.sql`/
  `comment-mentions-set-lock-timeout.sql` adversarial pair.
- `transaction-policy.ts`: reads only `finding.facts.transactionHostile`, no string/regex
  vocabulary of its own; `transaction-policy.test.ts` proves a nested (non-empty `nestedPath`)
  hostile finding is counted exactly like a top-level one.
- `runner-table.ts`/`db-migrate-recover.ts`: recovery only ever transitions a marker's `state` to
  `resolved` and never touches `_journal.json` or issues `DROP INDEX`/`DELETE` — enforced both by
  unit tests and by `tests/guardrails.test.ts`'s literal source scans (verified those scans
  actually examine non-vacuous file lists, per the file's own self-check).
- `client.ts`/`timeouts.ts`: `assertTimeoutsInEffect` is called in `scripts/db-migrate.ts` right
  after connect, before `ensureDrizzleLedger`/`ensureRunnerTable`/`runMigrations`, so no migration
  can run before the real `pg_settings` values are confirmed. It queries `pg_settings.setting`
  (the raw integer), never `SHOW`, closing the human-formatted-string gap the code comments flag.
- `guardrails.test.ts`: confirmed the "does drizzle-kit migrate/push appear anywhere" scans
  genuinely enumerate non-empty file lists (the suite's own vacuous-enumeration self-check), and
  that the only files in the repository containing those two-token phrases are under
  `.planning/`/`docs/`, which are deliberately excluded from the scan.

No BLOCKER-tier finding survived this pass. The three WARNINGs below are real gaps worth closing,
but none of them currently lets unsafe SQL execute or weakens a verdict against the shipped
`rules.json` — I traced each one to the specific precondition (a currently-absent rule shape, or a
hand-edited journal value) that would be needed before it became exploitable, and none of those
preconditions exist in the reviewed code today.

## Warnings

### WR-01: `inspectDropStmt` only examines the first object of a multi-object DROP statement

**File:** `packages/automation/src/inspector/inspect.ts:300-327` (`inspectDropStmt`)
**Issue:** PostgreSQL allows `DROP TABLE a, b;`, `DROP SCHEMA a, b;`, and `DROP INDEX a, b;` — one
statement naming multiple objects. `inspectDropStmt` reads only `dropStmt.objects[0]`:

```ts
const target = (dropStmt.objects as unknown[] | undefined)?.[0];
const { schema, name } = readQualifiedName(target);
```

Every object after the first is silently discarded before it ever becomes its own `StatementFacts`
or `Finding` — the exact bug shape Phase 3's CR-02 fix addressed for multi-subcommand `ALTER
TABLE` (`inspectAlterTableStmt` now correctly fans out to one `StatementFacts` per subcommand;
`inspectDropStmt` was never given the equivalent treatment). Unlike `inspectTruncateStmt`, which
carries an explicit comment documenting and accepting the same first-object-only limitation for
multi-table `TRUNCATE`, this function has no such acknowledgment.

**Why this is not a BLOCKER today:** every `rules.json` rule that matches `DropTable`/`DropSchema`/
`DropIndex` matches on `statementKind` alone (see `rules.json`'s `drop-table`/`drop-schema` rows,
and `create-index-concurrently`/`drop-index-not-concurrently` for `DropIndex`) — none matches on
`schema`, `table`, or `indexName`. So today, dropping a second or third table/schema/index in the
same statement still produces the same `statementKind`, and the D-02 floor still forces BLOCKED
regardless of which object's name ended up in the single finding produced. Verified against the
shipped rules: no verdict is currently weakened by this gap.

**Why it is still a real gap:** (1) the audit record (`runner.migration_runs.findings`) and the
printed REVIEW_REQUIRED findings block would report only the first table/schema/index name for a
multi-object drop, which is misleading to a human or an auditor reading the record after the fact
— they would see "DROP TABLE ingredients" in the log when the actual statement also dropped a
second table the record never names. (2) The project's own stated design goal is rules as
"extensible data" (`CLAUDE.md`, `docs/decisions.md`) — the moment any future rule adds a
table/schema/index-name condition (e.g., an allowlist-by-schema rule, which is a natural next
step for a multi-tenant or per-schema policy), this becomes a real, silent under-classification of
every object after the first, with no test in this corpus that would catch it (the corpus has no
multi-object DROP fixture, unlike the multi-subcommand ALTER TABLE case CR-02 already covers).

**Fix:** mirror `inspectAlterTableStmt`'s fan-out. Change `inspectDropStmt`'s return type to
`StatementFacts[]` and map every entry of `dropStmt.objects`, exactly as the CR-02 fix already did
for `AlterTableStmt.cmds`:

```ts
function inspectDropStmt(dropStmt: Record<string, unknown>): StatementFacts[] {
  const objects = (dropStmt.objects as unknown[] | undefined) ?? [];
  const concurrently = Boolean(dropStmt.concurrent);
  return objects.map((target) => {
    const { schema, name } = readQualifiedName(target);
    switch (dropStmt.removeType) {
      case "OBJECT_TABLE":
        return { ...EMPTY_FACTS, statementKind: "DropTable", schema, table: name };
      case "OBJECT_SCHEMA":
        return { ...EMPTY_FACTS, statementKind: "DropSchema", schema: name };
      case "OBJECT_INDEX":
        return { ...EMPTY_FACTS, statementKind: "DropIndex", schema, indexName: name, concurrently, transactionHostile: concurrently };
      default:
        return { ...EMPTY_FACTS, statementKind: "Unrecognized" };
    }
  });
}
```
and add a corpus fixture (`DROP TABLE a, b;`) asserting two findings, the same way
`multi-subcommand-alter-table-all-safe.sql` pins CR-02's fix for `ALTER TABLE`.

### WR-02: A duplicated journal `when` timestamp can make a migration silently skip forever

**File:** `packages/automation/src/runner/run-migrations.ts:288-291`,
`packages/automation/src/adapter/drizzle-migrations.ts:67-78`
**Issue:** `runMigrations` decides which migrations are pending with a strict inequality against
the ledger's most recently applied timestamp:

```ts
const pending = ordered.filter(
  (file) => lastAppliedMillis === null || lastAppliedMillis < file.when,
);
```

`enumerateMigrationFiles` hard-fails on a journal with two entries sharing the same `idx` (proven
by `run-migrations.test.ts`'s "duplicate idx" test), but it performs no equivalent check on `when`.
If two journal entries ever carry the same `when` value — most plausibly via the `--custom`
generation flow this project already uses (`0003_backfill_steps_timer_label.sql` was produced this
way), where a developer or an agent could hand-edit or copy-paste a journal entry's `when` field —
the second migration to share that timestamp is never `< lastAppliedMillis` once the first one
applies, so it is treated as "already applied" and silently skipped on every future run, with no
error, no log line distinguishing it from a genuinely-already-applied migration, and no way to
detect the omission except by noticing the missing schema effect later.

**Why this is not a BLOCKER today:** it requires an already-unusual precondition (a hand-edited or
colliding `when` value) that does not exist in the committed journal today — `_journal.json`'s five
entries all carry distinct `when` values. It also fails toward "applies nothing" rather than
"applies something unreviewed," which is the safer of the two failure directions this project's
own principles rank. But the project explicitly treats "duplicate idx" as ordering ambiguity severe
enough to refuse the whole run (`enumerateMigrationFiles`'s own thrown error: "Ordering must be
total"), and a duplicated `when` is the same category of ambiguity for the one comparison this
runner actually uses to decide what still needs to run — the omission is inconsistent with the
project's own hard-fail-never-silently-degrade discipline (`CLAUDE.md`: "mark unverified things
UNKNOWN," and this repo's repeated "loud, not silent" precedent in `history-status.ts`,
`drill-assertions.ts`, etc.).

**Fix:** extend `enumerateMigrationFiles`'s existing duplicate-`idx` guard to also reject two
entries sharing the same `when`, with the same "ordering must be total, applying nothing" message
shape it already uses for `idx`.

### WR-03: `apps/recipe-app/src/db/seed.ts` calls `process.exit()` directly, against this repo's own established convention

**File:** `apps/recipe-app/src/db/seed.ts:100-108`
**Issue:**

```ts
seed()
  .then(() => {
    console.log("Seed complete.");
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error("Seed failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
```

Every other command entry point touched by this phase (`scripts/db-migrate.ts`,
`scripts/db-migrate-recover.ts`, `scripts/history-suite.ts`) deliberately avoids a synchronous
`process.exit()` in favor of setting `process.exitCode` once and letting the event loop drain —
each one's header comment states this explicitly, citing the reproduced Windows libuv crash after
a `libpg-query` WASM `parse()` call. `seed.ts` does not itself call `libpg-query`, so this is not
currently the specific crash this repo has hit, but it is the one command entry point in the
reviewed file set that does not follow the pattern the rest of the codebase treats as load-bearing,
which makes it an easy thing to copy from (or invoke programmatically from a process that does
also parse SQL, e.g. a future combined seed+migrate script) without anyone noticing the
inconsistency.
**Fix:** replace both `process.exit(...)` calls with `process.exitCode = ...` and let the script
return normally, matching `scripts/db-migrate.ts`'s own pattern.

## Info

### IN-01: `tests/guardrails.test.ts`'s "no `drizzle-kit migrate`" scan does not strip comment lines, unlike its sibling checks

**File:** `tests/guardrails.test.ts:317-334`
**Issue:** The check for `"drizzle-kit migrate"` (D-02) scans each file's raw content, including
comment lines. Its neighbors — the `db-migrate-recover.ts`-specific checks a few lines above — do
strip comment-only lines first specifically so a doc comment describing the constraint can't trip
the check proving the constraint holds. The `drizzle-kit migrate`/`drizzle-kit push` checks do not
do this (by explicit design choice per the test's own comment: "Unconditional: no per-file
allowlist... an exemption list is the mechanism by which a real invocation later hides behind 'it
is only a comment'"). This is a defensible choice, but it does mean a legitimate prose comment
inside `scripts/`, `tests/`, `apps/recipe-app/`, or `packages/` that ever needs to describe this
constraint in words (the way `docs/30-migration-runner.md` currently does, only that file is
outside the scanned surface) would break the build. Confirmed today: no such comment exists outside
`.planning/`/`docs/`, so the suite currently passes, but this is a maintenance trap worth naming —
a future contributor adding an explanatory comment inside the scanned surface will get a
confusing failure that looks like a real violation.
**Fix:** none required now; if this bites in practice, consider a narrow same-line marker (like the
runtime-concatenated needles this file already uses) rather than a broad comment-stripping
exemption, so the "no exemption list" property is preserved.

### IN-02: `scripts/db-reset.ts` not forwarding `db:migrate`'s console output is already a known, tracked gap

**File:** `docs/30-migration-runner.md:321-337`
**Issue:** Already documented and explicitly deferred by the team in `docs/30-migration-runner.md`'s
own "Anything surprising" section (`scripts/db-reset.ts` invokes `db:migrate` via `execa` with no
`stdio: "inherit"`, so per-migration verdict lines and the JSON run report are captured but never
printed during `pnpm db:reset`). Not a new finding — recorded here only so this review's coverage
of `docs/30-migration-runner.md` is visible, and to confirm the team's own stated reasoning (out of
this plan's `files_modified` scope, correctness unaffected since `runner.migration_runs` still
records everything) is sound. No action requested.

---

_Reviewed: 2026-09-08_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
