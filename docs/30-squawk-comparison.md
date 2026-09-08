# squawk-cli comparison report

D-15's one-time calibration: this analyzer and squawk-cli, an independent, externally-maintained PostgreSQL migration linter, run over the identical corpus, and every disagreement between them is examined and explained below.

## Run metadata

- **Run date:** 2026-09-08T17:18:17.347Z
- **squawk version:** squawk 2.64.0
- **PostgreSQL version pin:** 17.0 (D9's project-wide pin)
- **Corpus files compared:** 66

## What "agreement" means here

The two tools do not speak the same language: squawk emits lint warnings (zero or more per file, no overall file-level verdict) and this analyzer emits a single three-tier file verdict (SAFE / REVIEW_REQUIRED / BLOCKED). This report defines agreement as: **squawk flagged something on a file this analyzer did not call SAFE, or squawk flagged nothing on a file this analyzer called SAFE.** Anything else -- including squawk flagging a SAFE-verdict file, or squawk flagging nothing on a REVIEW_REQUIRED or BLOCKED file -- is a disagreement, examined by hand below.

## Executive summary

29 of 66 rows disagree under this report's agreement definition. Every one is examined below and
resolves to one of two labels -- **24 different-by-design**, **5 analyzer-correct** -- and **zero
squawk-correct**. No row in this run showed squawk catching a hazard this catalogue's `rules.json`
missed; that is a specific claim about this 64-file corpus on this run, not a claim that squawk
never catches anything this project's rules could miss on a different input.

The five analyzer-correct rows matter for different reasons. `delete-without-where.sql` and
`update-without-where.sql` show squawk has no rule at all for an unscoped `DELETE`/`UPDATE` --
this project's D-02 floor covers ground squawk's own catalogue does not. More significant:
**`adversarial/do-block-drop.sql` shows squawk producing zero findings for a file containing a
real, reachable `DROP TABLE` hidden inside a `DO` block** -- squawk's static, non-recursive rule
engine does not appear to descend into a container body's dollar-quoted text at all, while this
analyzer's D-05 recursion (`parsePlPgSQL` + re-parse of the embedded query text) catches it
correctly. That is the same category of defect -- a destructive statement hidden inside a
container body -- that this phase's own mid-phase false-SAFE bug (commits `399e35f`/`012eba0`)
exposed and fixed in this analyzer's own earlier code; seeing an independent, widely-used linter
miss the same class of hazard entirely is the strongest evidence in this comparison that D-05's
recursion investment was necessary, not academic.

Phase 4 plan 02 added two more analyzer-correct rows, both about D-17's timeout self-disarm rule
(`disarms-timeout-guc`): squawk produced zero findings for both `blocked/reset-all.sql` (a bare
`RESET ALL;`) and `adversarial/set-lock-timeout-in-do-block.sql` (a `SET lock_timeout = '0';`
hidden inside a `DO` block, ahead of an `ALTER TABLE`) -- squawk's rule catalogue has no rule at
all watching for a migration disarming its own session timeouts, only rules requiring that a
migration *set* them (`require-lock-timeout`/`require-statement-timeout`, already excluded from
this catalogue per D-04 for the unrelated reason that they describe session setup rather than SQL
content). The nested case additionally reconfirms the same DO-block-recursion gap
`do-block-drop.sql` already established: squawk did not descend into the body at all, for either
reason.

The remaining 24 different-by-design rows split into three buckets, none of them a gap in this
catalogue's stated scope (`.planning/research/FEATURES.md` §1's migration lock/rewrite/data-loss
hazard list, per D-04):
- **Session properties** (`require-lock-timeout`, `require-statement-timeout`) -- D-04's two
  explicitly and deliberately excluded rules; they describe how the runner opens its session
  (RUN-02's responsibility), not what the SQL says.
- **Rerun idempotency** (`prefer-robust-stmts`, squawk's `IF EXISTS`/`IF NOT EXISTS` check) -- a
  property scripts that might be rerun after a partial failure need; this project's migrations
  are tracked once in Drizzle's `_journal.json` (D11) and applied exactly once, so this is not a
  property this execution model needs.
- **Schema-design style** (`prefer-bigint-over-int`) -- a future-capacity recommendation with no
  lock, rewrite, or data-loss mechanism, outside this catalogue's stated migration-safety scope.

One row is new since this report was last annotated (see the audit note below) and adds a
finding of its own. `safe/multi-subcommand-alter-table-all-safe.sql` and its `blocked/`
counterpart were added by CR-02 to pin that this analyzer examines *every* subcommand of a
multi-subcommand `ALTER TABLE`, not just the first. squawk's output on the safe fixture is
byte-identical to its output on the single-subcommand `safe/add-column-nullable-no-default.sql`,
and on the blocked fixture it raises nothing beyond the `ban-drop-column` it would have raised
for a lone `DROP COLUMN`. squawk therefore emits no signal whatsoever about subcommand count.
That is not a point against squawk -- flagging each subcommand is not what its rules are for --
but it does establish that the CR-02 defect was outside this comparison's reach: squawk could
not have caught it, so the corpus and the analyzer's own unit tests are the only things standing
between that class of bug and a false SAFE.

**Audit note (Phase 4 plan 02):** ten rows are new since this report was last annotated, added by
04-02-PLAN.md task 4 to prove D-17's timeout-disarm rule (`disarms-timeout-guc`) end to end:
`blocked/reset-all.sql`, `blocked/alter-system-set-statement-timeout.sql`,
`blocked/alter-database-set-lock-timeout.sql`, `review-required/set-search-path.sql`,
`review-required/vacuum-analyze.sql`, `review-required/create-database.sql`,
`review-required/reindex-index.sql`, `usually-safe/create-index-concurrently-standalone.sql`, and
the matched adversarial pair `adversarial/set-lock-timeout-in-do-block.sql` /
`adversarial/comment-mentions-set-lock-timeout.sql`. This edit was made by hand against a
squawk run over exactly these ten files (never a full regeneration of this report, which would
have destroyed every hand-filled disagreement above) -- appended to the end of the comparison
table below rather than reinserted at their manifest position, matching the CR-02 precedent just
above. Five of the ten agree (squawk flags `require-lock-timeout`/`require-statement-timeout` on
any file containing `ALTER SYSTEM`, `ALTER DATABASE`, `VACUUM` or `REINDEX`, which this analyzer's
own BLOCKED/REVIEW_REQUIRED verdict on those same files satisfies); the five disagreements are
detailed individually below (two analyzer-correct, three different-by-design), already folded
into the executive summary's totals above.

## What this comparison does and does not establish

It establishes that two independently-built tools looking at the same SQL agree where they should and differ only where a reason can be given. It does **not** establish that either tool is correct -- both could share a blind spot -- and it is a one-time calibration rather than a standing check (D-15): it goes stale the moment either tool's rule catalogue changes. Anything this run could not determine is recorded as UNKNOWN below, never smoothed over and never silently dropped.

## Comparison table (66 rows)

| File | Group | Analyzer verdict | Analyzer rule ids | squawk rules | Agreement |
|---|---|---|---|---|---|
| `packages/automation/test/corpus/blocked/drop-table.sql` | catalogue | BLOCKED | `drop-table` | `ban-drop-table`, `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout` | agree |
| `packages/automation/test/corpus/blocked/drop-schema.sql` | catalogue | BLOCKED | `drop-schema` | `require-lock-timeout`, `require-statement-timeout` | agree |
| `packages/automation/test/corpus/blocked/drop-database.sql` | catalogue | BLOCKED | `drop-database` | `ban-drop-database`, `require-lock-timeout`, `require-statement-timeout` | agree |
| `packages/automation/test/corpus/blocked/truncate.sql` | catalogue | BLOCKED | `truncate` | `require-lock-timeout`, `require-statement-timeout` | agree |
| `packages/automation/test/corpus/blocked/drop-column.sql` | catalogue | BLOCKED | `drop-column` | `ban-drop-column`, `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout` | agree |
| `packages/automation/test/corpus/blocked/delete-without-where.sql` | catalogue | BLOCKED | `delete-without-where` | (no findings) | **disagree** |
| `packages/automation/test/corpus/blocked/update-without-where.sql` | catalogue | BLOCKED | `update-without-where` | (no findings) | **disagree** |
| `packages/automation/test/corpus/blocked/multi-subcommand-alter-table.sql` | catalogue | BLOCKED | `add-column-nullable-no-default`, `drop-column` | `ban-drop-column`, `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout` | agree |
| `packages/automation/test/corpus/review-required/set-not-null.sql` | catalogue | REVIEW_REQUIRED | `set-not-null` | `adding-not-nullable-field`, `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout` | agree |
| `packages/automation/test/corpus/review-required/add-column-volatile-default.sql` | catalogue | REVIEW_REQUIRED | `add-column-volatile-default` | `adding-field-with-default`, `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout` | agree |
| `packages/automation/test/corpus/review-required/alter-column-type.sql` | catalogue | REVIEW_REQUIRED | `alter-column-type` | `changing-column-type`, `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout` | agree |
| `packages/automation/test/corpus/review-required/add-unique-constraint.sql` | catalogue | REVIEW_REQUIRED | `add-unique-constraint` | `constraint-missing-not-valid`, `disallowed-unique-constraint`, `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout` | agree |
| `packages/automation/test/corpus/review-required/create-index-not-concurrently.sql` | catalogue | REVIEW_REQUIRED | `create-index-not-concurrently` | `prefer-robust-stmts`, `require-concurrent-index-creation`, `require-lock-timeout`, `require-statement-timeout` | agree |
| `packages/automation/test/corpus/review-required/drop-index-not-concurrently.sql` | catalogue | REVIEW_REQUIRED | `drop-index-not-concurrently` | `prefer-robust-stmts`, `require-concurrent-index-deletion`, `require-lock-timeout`, `require-statement-timeout` | agree |
| `packages/automation/test/corpus/review-required/add-foreign-key-validated.sql` | catalogue | REVIEW_REQUIRED | `add-foreign-key-validated` | `adding-foreign-key-constraint`, `constraint-missing-not-valid`, `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout` | agree |
| `packages/automation/test/corpus/review-required/rename-column.sql` | catalogue | REVIEW_REQUIRED | `rename-column` | `prefer-robust-stmts`, `renaming-column`, `require-lock-timeout`, `require-statement-timeout` | agree |
| `packages/automation/test/corpus/review-required/rename-table.sql` | catalogue | REVIEW_REQUIRED | `rename-table` | `prefer-robust-stmts`, `renaming-table`, `require-lock-timeout`, `require-statement-timeout` | agree |
| `packages/automation/test/corpus/review-required/drop-not-null.sql` | catalogue | REVIEW_REQUIRED | `drop-not-null` | `ban-drop-not-null`, `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout` | agree |
| `packages/automation/test/corpus/review-required/drop-constraint.sql` | catalogue | REVIEW_REQUIRED | `drop-constraint` | `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout` | agree |
| `packages/automation/test/corpus/review-required/add-column-unknown-default-function.sql` | catalogue | REVIEW_REQUIRED | (none) | `adding-field-with-default`, `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout` | agree |
| `packages/automation/test/corpus/review-required/unfamiliar-statement-create-sequence.sql` | catalogue | REVIEW_REQUIRED | (none) | `require-lock-timeout`, `require-statement-timeout` | agree |
| `packages/automation/test/corpus/safe/create-table.sql` | catalogue | SAFE | `create-table` | `prefer-robust-stmts` | **disagree** |
| `packages/automation/test/corpus/safe/add-column-nullable-no-default.sql` | catalogue | SAFE | `add-column-nullable-no-default` | `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout` | **disagree** |
| `packages/automation/test/corpus/safe/add-column-literal-default.sql` | catalogue | SAFE | `add-column-nonvolatile-default` | `prefer-bigint-over-int`, `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout` | **disagree** |
| `packages/automation/test/corpus/safe/add-column-now-default.sql` | catalogue | SAFE | `add-column-nonvolatile-default` | `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout` | **disagree** |
| `packages/automation/test/corpus/safe/create-index-concurrently.sql` | catalogue | SAFE | `create-index-concurrently` | `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout` | **disagree** |
| `packages/automation/test/corpus/safe/drop-index-concurrently.sql` | catalogue | SAFE | `drop-index-concurrently` | `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout` | **disagree** |
| `packages/automation/test/corpus/safe/comment-on.sql` | catalogue | SAFE | `comment-on` | `require-lock-timeout`, `require-statement-timeout` | **disagree** |
| `packages/automation/test/corpus/safe/add-check-constraint-not-valid.sql` | catalogue | SAFE | `add-check-constraint-not-valid` | `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout` | **disagree** |
| `packages/automation/test/corpus/safe/add-foreign-key-not-valid.sql` | catalogue | SAFE | `add-foreign-key-not-valid` | `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout` | **disagree** |
| `packages/automation/test/corpus/safe/validate-constraint.sql` | catalogue | SAFE | `validate-constraint` | `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout` | **disagree** |
| `packages/automation/test/corpus/safe/pairing-not-valid-then-validate.sql` | catalogue | SAFE | `add-check-constraint-not-valid`, `pair-not-valid-validated`, `validate-constraint` | `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout` | **disagree** |
| `packages/automation/test/corpus/safe/pairing-concurrent-index-then-unique.sql` | catalogue | SAFE | `create-index-concurrently`, `pair-concurrent-index-unique` | `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout` | **disagree** |
| `packages/automation/test/corpus/safe/pairing-validated-check-then-set-not-null.sql` | catalogue | SAFE | `add-check-constraint-not-valid`, `pair-not-valid-validated`, `pair-validated-check-set-not-null`, `set-not-null`, `validate-constraint` | `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout` | **disagree** |
| `packages/automation/test/corpus/safe/near-miss-index-name-mismatch.sql` | catalogue | REVIEW_REQUIRED | `create-index-concurrently` | `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout` | agree |
| `packages/automation/test/corpus/safe/multi-subcommand-alter-table-all-safe.sql` | catalogue | SAFE | `add-column-nullable-no-default` | `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout` | **disagree** |
| `packages/automation/test/corpus/adversarial/inline-comment-drop.sql` | adversarial | BLOCKED | `drop-table` | `ban-drop-table`, `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout` | agree |
| `packages/automation/test/corpus/adversarial/inline-comment-inert.sql` | adversarial | SAFE | `add-column-nullable-no-default` | `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout` | **disagree** |
| `packages/automation/test/corpus/adversarial/dollar-quoted-string-drop.sql` | adversarial | BLOCKED | `create-function-container`, `drop-table` | `require-lock-timeout`, `require-statement-timeout` | agree |
| `packages/automation/test/corpus/adversarial/dollar-quoted-string-inert.sql` | adversarial | REVIEW_REQUIRED | (none) | (no findings) | **disagree** |
| `packages/automation/test/corpus/adversarial/do-block-drop.sql` | adversarial | BLOCKED | `do-block-container`, `drop-table` | (no findings) | **disagree** |
| `packages/automation/test/corpus/adversarial/do-block-inert.sql` | adversarial | SAFE | `do-block-container` | (no findings) | agree |
| `packages/automation/test/corpus/adversarial/function-body-drop.sql` | adversarial | BLOCKED | `create-function-container`, `drop-table` | `require-lock-timeout`, `require-statement-timeout` | agree |
| `packages/automation/test/corpus/adversarial/function-body-inert.sql` | adversarial | REVIEW_REQUIRED | `create-function-container` | `require-lock-timeout`, `require-statement-timeout` | agree |
| `packages/automation/test/corpus/adversarial/quoted-identifier-drop.sql` | adversarial | BLOCKED | `drop-table` | `ban-drop-table`, `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout` | agree |
| `packages/automation/test/corpus/adversarial/quoted-identifier-inert.sql` | adversarial | SAFE | `create-table` | `prefer-bigint-over-int`, `prefer-robust-stmts` | **disagree** |
| `packages/automation/test/corpus/app-shaped/recipes-add-notes-column.sql` | app-shaped | SAFE | `add-column-nullable-no-default` | `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout` | **disagree** |
| `packages/automation/test/corpus/app-shaped/steps-timer-label-set-not-null.sql` | app-shaped | REVIEW_REQUIRED | `set-not-null` | `adding-not-nullable-field`, `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout` | agree |
| `packages/automation/test/corpus/app-shaped/drop-ingredients-table.sql` | app-shaped | BLOCKED | `drop-table` | `ban-drop-table`, `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout` | agree |
| `apps/recipe-app/drizzle/0000_bumpy_khan.sql` | real-migration | SAFE | `create-table` | `prefer-bigint-over-int`, `prefer-robust-stmts` | **disagree** |
| `apps/recipe-app/drizzle/0001_busy_thunderbolt.sql` | real-migration | REVIEW_REQUIRED | `add-foreign-key-validated`, `create-table` | `adding-foreign-key-constraint`, `constraint-missing-not-valid`, `prefer-bigint-over-int`, `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout` | agree |
| `packages/automation/test/corpus/blocked/reset-all.sql` | catalogue | BLOCKED | `disarms-timeout-guc` | (no findings) | **disagree** |
| `packages/automation/test/corpus/blocked/alter-system-set-statement-timeout.sql` | catalogue | BLOCKED | `disarms-timeout-guc` | `require-lock-timeout`, `require-statement-timeout` | agree |
| `packages/automation/test/corpus/blocked/alter-database-set-lock-timeout.sql` | catalogue | BLOCKED | `disarms-timeout-guc` | `require-lock-timeout`, `require-statement-timeout` | agree |
| `packages/automation/test/corpus/review-required/set-search-path.sql` | catalogue | REVIEW_REQUIRED | `set-guc-non-timeout` | (no findings) | **disagree** |
| `packages/automation/test/corpus/review-required/vacuum-analyze.sql` | catalogue | REVIEW_REQUIRED | `vacuum-in-migration` | `require-lock-timeout`, `require-statement-timeout` | agree |
| `packages/automation/test/corpus/review-required/create-database.sql` | catalogue | REVIEW_REQUIRED | `create-database-in-migration` | `require-lock-timeout`, `require-statement-timeout` | agree |
| `packages/automation/test/corpus/review-required/reindex-index.sql` | catalogue | REVIEW_REQUIRED | `reindex-in-migration` | `require-concurrent-reindex`, `require-lock-timeout`, `require-statement-timeout` | agree |
| `packages/automation/test/corpus/usually-safe/create-index-concurrently-standalone.sql` | catalogue | SAFE | `create-index-concurrently` | `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout` | **disagree** |
| `packages/automation/test/corpus/adversarial/set-lock-timeout-in-do-block.sql` | adversarial | BLOCKED | `add-column-nullable-no-default`, `disarms-timeout-guc`, `do-block-container` | (no findings) | **disagree** |
| `packages/automation/test/corpus/adversarial/comment-mentions-set-lock-timeout.sql` | adversarial | SAFE | `add-column-nullable-no-default`, `do-block-container` | `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout` | **disagree** |
| `apps/recipe-app/drizzle/0002_oval_maelstrom.sql` | real-migration | SAFE | `add-column-nullable-no-default` | `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout` | **disagree** |
| `apps/recipe-app/drizzle/0003_backfill_steps_timer_label.sql` | real-migration | REVIEW_REQUIRED | (none) | (no findings) | **disagree** |
| `apps/recipe-app/drizzle/0004_redundant_apocalypse.sql` | real-migration | REVIEW_REQUIRED | `set-not-null` | `adding-not-nullable-field`, `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout` | agree |
| `packages/automation/test/corpus/app-shaped/generated-drop-ingredients-table.sql` | app-shaped | BLOCKED | `drop-table` | `ban-drop-table`, `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout` | agree |
| `packages/automation/test/corpus/blocked/multi-object-drop-table.sql` | catalogue | BLOCKED | `drop-table` | `ban-drop-table`, `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout` | agree |

## Disagreements (29)

Every row below needs one of exactly three labels -- **analyzer-correct**, **squawk-correct**, or **different-by-design** -- each with a stated reason. Placeholders below are filled in by hand, not generated: this generator records *what* disagrees, not *why*.

### `packages/automation/test/corpus/blocked/delete-without-where.sql`

- **Analyzer verdict:** BLOCKED (`delete-without-where`)
- **squawk:** (no findings)
- **Corpus expectation:** A DELETE with no WHERE clause removes every row in the table, which is almost never the intended scope of a migration.
- **Verdict on the disagreement:** analyzer-correct
- **Reason:** squawk's rule catalogue (confirmed against `.planning/research/FEATURES.md` §1's "What the tools actually check" list, cross-checked against the live JSON output above) has no rule for an unscoped `DELETE` at all -- it ships `ban-drop-table`/`ban-drop-column`/`ban-drop-database`/`ban-drop-not-null` but nothing for mass-row deletion. This project's D-02 code floor exists precisely to catch irreversible data loss squawk's own rule set does not cover, and it fired correctly here.

### `packages/automation/test/corpus/blocked/update-without-where.sql`

- **Analyzer verdict:** BLOCKED (`update-without-where`)
- **squawk:** (no findings)
- **Corpus expectation:** An UPDATE with no WHERE clause overwrites every row in the table, which is almost never the intended scope of a migration.
- **Verdict on the disagreement:** analyzer-correct
- **Reason:** Same gap as `delete-without-where.sql` immediately above: squawk's documented rule catalogue has no equivalent of `ban-update-without-where`. This analyzer's D-02 floor covers `UPDATE` without `WHERE` explicitly (`.planning/phases/03-safety-analyzer/03-CONTEXT.md` D-02's named floor set), closing a real gap squawk's rule set leaves open.

### `packages/automation/test/corpus/safe/create-table.sql`

- **Analyzer verdict:** SAFE (`create-table`)
- **squawk:** `prefer-robust-stmts`
- **Corpus expectation:** Creating a brand new table has no existing rows to lock, scan or rewrite and no application code can yet depend on it -- the simplest SAFE case.
- **Verdict on the disagreement:** different-by-design
- **Reason:** `prefer-robust-stmts` is squawk's idempotency check -- it wants `IF NOT EXISTS` so the same script can be rerun after a partial failure without erroring. This project's migrations are never rerun that way: D11 (project-wide decisions) tracks every migration once in Drizzle's `_journal.json` and applies it exactly once via `drizzle-orm/node-postgres/migrator`, so "can this statement be safely repeated" is not a property this execution model needs. The statement itself has no lock or rewrite hazard, which is what `create-table`'s SAFE verdict actually certifies.

### `packages/automation/test/corpus/safe/add-column-nullable-no-default.sql`

- **Analyzer verdict:** SAFE (`add-column-nullable-no-default`)
- **squawk:** `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout`
- **Corpus expectation:** Adding a nullable column with no default is a metadata-only change that requires no table rewrite and no scan of existing rows.
- **Verdict on the disagreement:** different-by-design
- **Reason:** Two separate reasons bundled in one row. `require-lock-timeout`/`require-statement-timeout` are D-04's explicitly and deliberately excluded pair -- they describe how the runner opens its session, not what this SQL statement does, and RUN-02 makes the Phase 4 runner responsible for setting both on every migration regardless of its content; flagging every migration for a property the runner already guarantees would be a false positive by construction. `prefer-robust-stmts` is the same rerun-idempotency concern as `create-table.sql` above, which this project's one-shot journal-tracked migration model does not need.

### `packages/automation/test/corpus/safe/add-column-literal-default.sql`

- **Analyzer verdict:** SAFE (`add-column-nonvolatile-default`)
- **squawk:** `prefer-bigint-over-int`, `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout`
- **Corpus expectation:** A literal default is evaluated once and stored in the table's own metadata, so PostgreSQL's fast add-column path applies and no rewrite is required.
- **Verdict on the disagreement:** different-by-design
- **Reason:** `require-lock-timeout`/`require-statement-timeout` and `prefer-robust-stmts` are the same session-property and rerun-idempotency exclusions explained above. `prefer-bigint-over-int` is a different kind of rule entirely -- a future-capacity design recommendation (32-bit `integer`/`serial` columns can exhaust their ~2.1 billion value range) with no lock, rewrite, or data-loss mechanism at all. `.planning/research/FEATURES.md` §1 and this project's D-04 scope the rules catalogue to migration *safety* -- will executing this SQL lock or destroy data -- not general schema-design style. Adding it here would expand this catalogue's stated contract into a category it was never meant to cover, so it is recorded as different-by-design rather than a gap to close.

### `packages/automation/test/corpus/safe/add-column-now-default.sql`

- **Analyzer verdict:** SAFE (`add-column-nonvolatile-default`)
- **squawk:** `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout`
- **Corpus expectation:** now() is catalogued STABLE, not VOLATILE (03-RESEARCH.md's Pitfall 1 correction) -- it is evaluated once at ALTER TABLE time and stored in metadata exactly like a literal, so PostgreSQL's fast add-column path applies. Expecting REVIEW_REQUIRED here would be a false positive on a genuinely safe migration, the exact review-fatigue anti-pattern this catalogue exists to avoid; its counterpart (a clock_timestamp() default, review-required/add-column-volatile-default.sql) is genuinely VOLATILE and correctly expects REVIEW_REQUIRED -- the two fixtures together make the STABLE-vs-VOLATILE distinction visible in the corpus, not only in a unit test.
- **Verdict on the disagreement:** different-by-design
- **Reason:** The same session-property (`require-lock-timeout`/`require-statement-timeout`, D-04) and rerun-idempotency (`prefer-robust-stmts`) exclusions as the other `ADD COLUMN` rows above. Notably, squawk itself does not object to `now()` specifically as a volatile-looking default here -- it has no volatility-aware default rule at all (`adding-field-with-default` fires unconditionally whenever any default is present, as seen on the genuinely-volatile `add-column-volatile-default.sql` fixture), so squawk's silence on the STABLE-vs-VOLATILE distinction is a difference in what it inspects, not a contradiction of this analyzer's verdict.

### `packages/automation/test/corpus/safe/create-index-concurrently.sql`

- **Analyzer verdict:** SAFE (`create-index-concurrently`)
- **squawk:** `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout`
- **Corpus expectation:** CREATE INDEX CONCURRENTLY takes only SHARE UPDATE EXCLUSIVE, letting concurrent reads and writes continue for almost the entire build.
- **Verdict on the disagreement:** different-by-design
- **Reason:** Same D-04 session-property exclusion and rerun-idempotency reasoning as the other rows above. Worth noting as a corroboration rather than a contradiction: squawk did **not** raise its `ban-concurrent-index-creation-in-transaction` or non-concurrent-index rules here, i.e. squawk agrees the `CONCURRENTLY` form itself is the safe one -- the entire disagreement is the two session-property rules plus the idempotency rule, not any lock-hazard rule.

### `packages/automation/test/corpus/safe/drop-index-concurrently.sql`

- **Analyzer verdict:** SAFE (`drop-index-concurrently`)
- **squawk:** `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout`
- **Corpus expectation:** DROP INDEX CONCURRENTLY takes only SHARE UPDATE EXCLUSIVE, letting concurrent reads and writes continue for almost the entire drop.
- **Verdict on the disagreement:** different-by-design
- **Reason:** Same D-04 session-property exclusion and rerun-idempotency reasoning as `create-index-concurrently.sql` above; squawk again does not raise any lock-hazard rule against the `CONCURRENTLY` form itself.

### `packages/automation/test/corpus/safe/comment-on.sql`

- **Analyzer verdict:** SAFE (`comment-on`)
- **squawk:** `require-lock-timeout`, `require-statement-timeout`
- **Corpus expectation:** COMMENT ON only updates catalog metadata text, taking no meaningful lock and touching no row in the table it describes.
- **Verdict on the disagreement:** different-by-design
- **Reason:** Only D-04's excluded session-property pair fires here (`prefer-robust-stmts` does not apply to `COMMENT ON`) -- same reasoning as the other rows: session properties are the Phase 4 runner's responsibility (RUN-02), not a fact about this specific statement.

### `packages/automation/test/corpus/safe/add-check-constraint-not-valid.sql`

- **Analyzer verdict:** SAFE (`add-check-constraint-not-valid`)
- **squawk:** `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout`
- **Corpus expectation:** A check constraint added NOT VALID is instant and enforces only on new or changed rows, deferring the table scan to a separate, weaker-locked VALIDATE CONSTRAINT step.
- **Verdict on the disagreement:** different-by-design
- **Reason:** Same D-04 session-property exclusion and rerun-idempotency reasoning as the other `SAFE`-verdict rows above. squawk's own `constraint-missing-not-valid` rule -- which fired on the naive `add-unique-constraint.sql` fixture -- does not fire here, confirming squawk itself recognizes the `NOT VALID` form as the safe one; the disagreement is entirely the two excluded categories, not a lock-hazard rule.

### `packages/automation/test/corpus/safe/add-foreign-key-not-valid.sql`

- **Analyzer verdict:** SAFE (`add-foreign-key-not-valid`)
- **squawk:** `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout`
- **Corpus expectation:** A foreign key added NOT VALID is instant and enforces only on new or changed rows, deferring the scan of both tables to a separate, weaker-locked VALIDATE CONSTRAINT step.
- **Verdict on the disagreement:** different-by-design
- **Reason:** Same reasoning as `add-check-constraint-not-valid.sql` above. squawk's `adding-foreign-key-constraint`/`constraint-missing-not-valid` rules -- which fired on the naive `add-foreign-key-validated.sql` fixture -- do not fire here, again confirming squawk recognizes the `NOT VALID` safe form itself; the disagreement is only the excluded session-property and idempotency categories.

### `packages/automation/test/corpus/safe/validate-constraint.sql`

- **Analyzer verdict:** SAFE (`validate-constraint`)
- **squawk:** `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout`
- **Corpus expectation:** VALIDATE CONSTRAINT takes only SHARE UPDATE EXCLUSIVE on the altered table, letting concurrent reads and writes continue while it scans for constraint violations -- true on its own regardless of what statement (if any) preceded it in the same file.
- **Verdict on the disagreement:** different-by-design
- **Reason:** Same D-04 session-property exclusion and rerun-idempotency reasoning as the other `SAFE`-verdict rows above; squawk raises no lock-hazard rule against `VALIDATE CONSTRAINT` itself.

### `packages/automation/test/corpus/safe/pairing-not-valid-then-validate.sql`

- **Analyzer verdict:** SAFE (`add-check-constraint-not-valid`, `pair-not-valid-validated`, `validate-constraint`)
- **squawk:** `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout`
- **Corpus expectation:** The complete two-step safe form for adding a validated constraint without a table-scanning lock: a check constraint added NOT VALID, then validated by its own VALIDATE CONSTRAINT naming the exact same constraint on the exact same table in this same file -- the applySafeFormPairing pass adds pair-not-valid-validated to both statements' findings alongside each half's own already-SAFE rule id.
- **Verdict on the disagreement:** different-by-design
- **Reason:** Same D-04 session-property exclusion and rerun-idempotency reasoning as the other `SAFE`-verdict rows above. squawk evaluates each of the file's two statements independently and has no concept of D-09's same-file safe-form pairing at all -- it simply finds neither statement individually objectionable beyond the two excluded categories, which is a difference in mechanism (per-statement rules vs. a same-file pairing pass) rather than a disagreement about the outcome.

### `packages/automation/test/corpus/safe/pairing-concurrent-index-then-unique.sql`

- **Analyzer verdict:** SAFE (`create-index-concurrently`, `pair-concurrent-index-unique`)
- **squawk:** `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout`
- **Corpus expectation:** The complete two-step safe form for adding a unique constraint without blocking writes during the index build: an index built CONCURRENTLY, then attached via ADD CONSTRAINT ... UNIQUE USING INDEX naming that exact index -- without the pairing, the second statement would be an unmatched D-06 REVIEW_REQUIRED (no ordinary rule matches AddUniqueConstraint with a non-null usingIndexName), so pair-concurrent-index-unique is the only thing that resolves it to SAFE.
- **Verdict on the disagreement:** different-by-design
- **Reason:** Same D-04 session-property exclusion and rerun-idempotency reasoning, plus the same per-statement-vs-same-file-pairing mechanism difference as `pairing-not-valid-then-validate.sql` above. Notably squawk's own `disallowed-unique-constraint` rule -- which fired on the naive `add-unique-constraint.sql` fixture -- does not fire on the second statement here, confirming squawk itself recognizes `ADD CONSTRAINT ... UNIQUE USING INDEX` as the safe attachment form even without D-09's explicit pairing concept.

### `packages/automation/test/corpus/safe/pairing-validated-check-then-set-not-null.sql`

- **Analyzer verdict:** SAFE (`add-check-constraint-not-valid`, `pair-not-valid-validated`, `pair-validated-check-set-not-null`, `set-not-null`, `validate-constraint`)
- **squawk:** `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout`
- **Corpus expectation:** The complete three-step safe form for enforcing NOT NULL without an ACCESS EXCLUSIVE scan: a CHECK (col IS NOT NULL) constraint added NOT VALID, validated (itself pairing via pair-not-valid-validated), then SET NOT NULL on that same column -- PostgreSQL 12+ detects the validated check constraint and skips SET NOT NULL's own table scan, which pair-validated-check-set-not-null is what lowers the naive REVIEW_REQUIRED set-not-null finding to SAFE.
- **Verdict on the disagreement:** different-by-design
- **Reason:** Same D-04 session-property exclusion, rerun-idempotency, and pairing-mechanism reasoning as the two rows above. squawk's `adding-not-nullable-field` rule -- which fired on the naive standalone `set-not-null.sql` fixture -- does not fire on the third statement here: squawk has no cross-statement PG12+ validated-constraint awareness the way D-09's pairing does, but it also raises no objection, landing on the same practical outcome through a different (and narrower) mechanism.

### `packages/automation/test/corpus/safe/multi-subcommand-alter-table-all-safe.sql`

- **Analyzer verdict:** SAFE (`add-column-nullable-no-default`)
- **squawk:** `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout`
- **Corpus expectation:** CR-02's completeness counterpart: two subcommands in one ALTER TABLE, both harmless nullable ADD COLUMNs with no default. Proves the multi-subcommand fix produces a finding for EVERY subcommand (not just the first, and not just when one is dangerous) -- both findings carry the same add-column-nullable-no-default rule id, so the corpus harness's set-based expectedRuleIds comparison would not by itself catch a regression that dropped one of the two identical findings; test/multi-subcommand-alter-table.test.ts's own length-2 assertion covers that gap directly.
- **Verdict on the disagreement:** different-by-design
- **Reason:** Same two excluded categories as every other SAFE-verdict row above. `require-lock-timeout`/`require-statement-timeout` are D-04's explicitly and deliberately excluded pair -- they describe how the runner opens its session, which RUN-02 makes the Phase 4 runner responsible for setting on every migration regardless of content, not what this statement does. `prefer-robust-stmts` is the rerun-idempotency concern this project's one-shot, journal-tracked migration model (D11) does not need. Both `ADD COLUMN`s are nullable with no default, so PostgreSQL's fast add-column path applies to each and no rewrite or scan occurs -- which is what the SAFE verdict certifies. Worth recording specifically, because it is the point of this fixture: squawk's findings here are byte-identical to those on the single-subcommand `safe/add-column-nullable-no-default.sql` row, and it raised nothing on the multi-subcommand `blocked/` counterpart beyond the `ban-drop-column` it would have raised anyway. squawk therefore gives no signal at all about how many subcommands an ALTER TABLE carries -- the exact blind spot CR-02 fixed in this analyzer, where only the first subcommand was being examined. This comparison neither corroborates nor contradicts that fix; it establishes that squawk could not have caught it.

### `packages/automation/test/corpus/adversarial/inline-comment-inert.sql`

- **Analyzer verdict:** SAFE (`add-column-nullable-no-default`)
- **squawk:** `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout`
- **Corpus expectation:** D-14's false-positive half, the one PITFALLS.md C2 warns rots first: a leading line comment mentions dropping the table in prose, but the actual statement is an ordinary nullable ADD COLUMN. A regex matching 'drop' in a comment would flag this; the real parser only sees the SQL statement, never the comment text.
- **Verdict on the disagreement:** different-by-design
- **Reason:** Same D-04 session-property exclusion and rerun-idempotency reasoning as the other `ADD COLUMN` rows above -- not related to the comment at all. Worth stating positively rather than as a disagreement: squawk, like this analyzer, ignored the misleading "drop" text in the comment entirely and evaluated only the real `ADD COLUMN` statement, corroborating this fixture's actual point (comments are inert to a real parser) rather than contradicting it.

### `packages/automation/test/corpus/adversarial/dollar-quoted-string-inert.sql`

- **Analyzer verdict:** REVIEW_REQUIRED ((none))
- **squawk:** (no findings)
- **Corpus expectation:** D-14's false-positive half: the words DROP TABLE orders appear only as DATA -- a dollar-quoted string literal (custom tag $evasion_tag$, proving tagged quoting specifically) being inserted as an ordinary column value. INSERT has no StatementKind in this catalogue at all (D-04 never included it, same limitation 03-04/03-05 already documented), so this resolves REVIEW_REQUIRED via D-06's unmatched-statement default -- never BLOCKED, and no drop rule id anywhere in its findings.
- **Verdict on the disagreement:** different-by-design
- **Reason:** Neither tool treats the dollar-quoted "DROP TABLE orders" text as an executable drop -- both correctly parse it as an inert data literal, which is this adversarial fixture's actual point (D-14/PITFALLS.md C2). The row still registers as a raw disagreement only because of how each tool treats an `INSERT` statement it has no specific rule for: squawk has no `INSERT`-related rule at all and stays silent, while this analyzer's D-06 earn-SAFE default resolves any unmatched statement kind to REVIEW_REQUIRED rather than SAFE. That is a difference in each tool's default-outcome policy for an unrecognized statement, not a disagreement about the drop-in-data hazard.

### `packages/automation/test/corpus/adversarial/do-block-drop.sql`

- **Analyzer verdict:** BLOCKED (`do-block-container`, `drop-table`)
- **squawk:** (no findings)
- **Corpus expectation:** D-14/PITFALLS.md C1: the drop is guarded by real control flow (an IF around it, deciding at runtime whether to run), not sitting at the top of the body -- extractEmbeddedSql's deep generic tree walk (not a named-construct allowlist) finds it regardless of which branch it is nested inside, exactly the standard PITFALLS.md C1's IF-guarded-DROP example demands.
- **Verdict on the disagreement:** analyzer-correct -- the single most important disagreement in this report
- **Reason:** This file contains a real, unconditionally-reachable-at-runtime `DROP TABLE` hidden inside a `DO` block's dollar-quoted body, and squawk produced **zero findings** for it -- not even its blanket session-property rules, which fire on every other DDL statement in this corpus. squawk's own documentation (`.planning/research/FEATURES.md` §1: "Purely static/text-based") describes a rule engine that does not recurse into procedural body text the way `parsePlPgSQL` does; it appears to not descend into the `DO` block's body at all. This is exactly the class of hazard D-05's recursive PL/pgSQL inspection was built for, and it is the same category of defect -- a destructive statement hidden inside a container body -- that this phase's own mid-phase false-SAFE bug (fixed in commits `399e35f`/`012eba0`) exposed in this analyzer's own earlier code. Here the roles are reversed: this analyzer's recursion catches it and an independent, widely-used linter does not, on the same file. That is the strongest evidence in this whole comparison that D-05's recursion work was not academic.

### `packages/automation/test/corpus/adversarial/quoted-identifier-inert.sql`

- **Analyzer verdict:** SAFE (`create-table`)
- **squawk:** `prefer-bigint-over-int`, `prefer-robust-stmts`
- **Corpus expectation:** D-14's false-positive half: a table is CREATED whose quoted name is itself the phrase "drop table" -- proving an identifier that reads like an entire dangerous statement is not treated as one. This is a genuine CreateStmt node classified SAFE by create-table; nothing about the identifier's text is ever inspected.
- **Verdict on the disagreement:** different-by-design
- **Reason:** Both tools agree the misleadingly-named identifier is inert -- neither treats it as an executable drop, which is this fixture's actual point. The raw disagreement is entirely the unrelated `prefer-bigint-over-int` (out-of-scope design recommendation, same reasoning as `add-column-literal-default.sql` above) and `prefer-robust-stmts` (rerun-idempotency, same as `create-table.sql` above) findings.

### `packages/automation/test/corpus/app-shaped/recipes-add-notes-column.sql`

- **Analyzer verdict:** SAFE (`add-column-nullable-no-default`)
- **squawk:** `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout`
- **Corpus expectation:** D-16: mirrors 01-CONTEXT.md D-11's reserved 'nullable notes column' churn on the real recipes table without touching apps/recipe-app/src/db/schema.ts -- a metadata-only ADD COLUMN with no default requires no table rewrite and no scan, so Phase 4 already knows this lands SAFE before spending the real change.
- **Verdict on the disagreement:** different-by-design
- **Reason:** Same D-04 session-property exclusion and rerun-idempotency reasoning as the other `ADD COLUMN ... nullable, no default` rows above.

### `apps/recipe-app/drizzle/0000_bumpy_khan.sql`

- **Analyzer verdict:** SAFE (`create-table`)
- **squawk:** `prefer-bigint-over-int`, `prefer-robust-stmts`
- **Corpus expectation:** The repository's first genuine Drizzle-generated migration, referenced in place rather than copied (the same bytes the runner would execute): a single CREATE TABLE statement for recipes. New tables have no existing rows to lock, scan or rewrite -- create-table matches unconditionally, regardless of the uuid/now() column defaults inside it, which only matter for ADD COLUMN, not table creation.
- **Verdict on the disagreement:** different-by-design
- **Reason:** Same reasoning as `add-column-literal-default.sql` (`prefer-bigint-over-int`, out-of-scope design recommendation) and `create-table.sql` (`prefer-robust-stmts`, rerun-idempotency) above. This is the first of this corpus's two real, currently-deployed Drizzle migrations, and squawk raises no lock-hazard or data-loss rule against it at all -- both tools agree it is safe on the dimension this project's catalogue actually classifies.

### `packages/automation/test/corpus/blocked/reset-all.sql`

- **Analyzer verdict:** BLOCKED (`disarms-timeout-guc`)
- **squawk:** (no findings)
- **Corpus expectation:** D-17/Pitfall 4 (04-RESEARCH.md): RESET ALL disarms lock_timeout and statement_timeout along with every other session GUC, but its AST node (VariableSetStmt, kind VAR_RESET_ALL) carries no name field at all -- a name-matching rule would miss it entirely. disarms-timeout-guc catches it because setstmtDisarmsTimeout treats VAR_RESET_ALL as unconditionally disarming, with no name check.
- **Verdict on the disagreement:** analyzer-correct
- **Reason:** squawk's rule catalogue has no rule at all watching for a migration disarming its own session timeouts -- it ships `require-lock-timeout`/`require-statement-timeout` (requiring a migration *set* them, already excluded from this catalogue per D-04 for an unrelated reason) but nothing detecting a `RESET`/`SET`/`ALTER SYSTEM`/`ALTER DATABASE`/`ALTER ROLE` that turns them back off. This project's D-17 floor exists precisely to catch a migration disarming its own safety rail, ground squawk's own catalogue does not cover, and it fired correctly here.

### `packages/automation/test/corpus/review-required/set-search-path.sql`

- **Analyzer verdict:** REVIEW_REQUIRED (`set-guc-non-timeout`)
- **squawk:** (no findings)
- **Corpus expectation:** An ordinary session-level SET that does not touch lock_timeout or statement_timeout is not a floor violation, but it is not nothing either -- set-guc-non-timeout gives it a named REVIEW_REQUIRED rule id instead of falling through to the Unrecognized default, distinguishing "a SET the catalogue has an opinion on" from "a statement kind the catalogue has never seen."
- **Verdict on the disagreement:** different-by-design
- **Reason:** Same default-outcome-policy difference `dollar-quoted-string-inert.sql` above already established for an `INSERT` squawk has no rule for: squawk simply has no rule watching a plain `SET`/`RESET` statement at all (confirmed live: it stayed silent on `RESET ALL;` and on a `SET lock_timeout` hidden inside a DO block too, not just this file), so its silence reflects "no rule exists," while this analyzer's D-06 earn-SAFE default gives an uncatalogued-but-named GUC set its own explicit REVIEW_REQUIRED rule id rather than leaving it entirely unclassified. Not a hazard disagreement -- a policy-for-the-unrecognized-case disagreement.

### `packages/automation/test/corpus/usually-safe/create-index-concurrently-standalone.sql`

- **Analyzer verdict:** SAFE (`create-index-concurrently`)
- **squawk:** `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout`
- **Corpus expectation:** The positive half of criterion 2: a standalone CREATE INDEX CONCURRENTLY on a real recipe-core column (recipes.slug) is the statement the runner must be able to execute unwrapped -- transactionHostile true, but that is not itself a hazard the classifier flags; the existing create-index-concurrently rule already grants SAFE, so no duplicate rule row was added.
- **Verdict on the disagreement:** different-by-design
- **Reason:** Byte-identical bucket to `safe/create-index-concurrently.sql` above -- the two session-property rules plus the rerun-idempotency rule, not any lock-hazard rule. squawk again does not raise its non-concurrent-index rule here, i.e. it agrees the `CONCURRENTLY` form itself is the safe one.

### `packages/automation/test/corpus/adversarial/set-lock-timeout-in-do-block.sql`

- **Analyzer verdict:** BLOCKED (`add-column-nullable-no-default`, `disarms-timeout-guc`, `do-block-container`)
- **squawk:** (no findings)
- **Corpus expectation:** D-17's nested coverage rides on D-05's existing recursion: a DO block whose body genuinely executes SET lock_timeout = '0' before an ALTER TABLE ADD COLUMN is still caught one level down, live-verified via analyzeSql -- the container itself earns its own SAFE finding (bodyInspected true), the disarming SET earns disarms-timeout-guc at sourceContext do-block, and the harmless ADD COLUMN earns its own SAFE finding, with worst-verdict-wins making the whole file BLOCKED.
- **Verdict on the disagreement:** analyzer-correct
- **Reason:** A double gap for squawk, compounding the two findings recorded elsewhere in this report: squawk's static, non-recursive rule engine does not descend into a `DO` block's dollar-quoted body at all (the same defect `adversarial/do-block-drop.sql` already established), *and* even if it did, it has no rule detecting a timeout self-disarm in the first place (the same gap `blocked/reset-all.sql` above establishes). This analyzer's D-05 recursion plus D-17's widened floor catch it regardless.

### `packages/automation/test/corpus/adversarial/comment-mentions-set-lock-timeout.sql`

- **Analyzer verdict:** SAFE (`add-column-nullable-no-default`, `do-block-container`)
- **squawk:** `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout`
- **Corpus expectation:** D-17's false-positive half: the exact words "SET lock_timeout = '0';" appear only inside a -- comment and inside a dollar-quoted string literal ($msg$...$msg$) passed to RAISE NOTICE, never executed as a SET statement -- extractEmbeddedSql finds no PLpgSQL_stmt_execsql/dynexecute in the body (RAISE is neither), so no disarms-timeout-guc finding appears anywhere; live-verified via analyzeSql to classify SAFE via the container's own SAFE finding plus a genuinely harmless top-level ADD COLUMN, proving comments and inert string data are inert exactly as this project's own stated purpose requires.
- **Verdict on the disagreement:** different-by-design
- **Reason:** Same session-property-plus-idempotency bucket as every other SAFE-verdict row in this report (`require-lock-timeout`, `require-statement-timeout`, `prefer-robust-stmts`) -- squawk raises nothing about the comment or the dollar-quoted text itself, i.e. it agrees the mentioned text is inert; the disagreement is entirely the same three routinely-excluded rules every other SAFE row in this corpus also triggers.

### `apps/recipe-app/drizzle/0002_oval_maelstrom.sql`

- **Analyzer verdict:** SAFE (`add-column-nullable-no-default`)
- **squawk:** `prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout`
- **Corpus expectation:** 04-06/D-30: the real, generated ADD COLUMN notes -- a metadata-only ADD COLUMN with no default requires no table rewrite and no scan, exactly matching the Phase 3 corpus prediction (app-shaped/recipes-add-notes-column.sql) checked against reality.
- **Verdict on the disagreement:** different-by-design
- **Reason:** Byte-identical bucket to `app-shaped/recipes-add-notes-column.sql` above (its own real-schema mirror) -- the same D-04 session-property exclusion and rerun-idempotency reasoning applies. This is the real, applied migration that fixture predicted; the disagreement is unchanged by it being real rather than mirrored.

### `apps/recipe-app/drizzle/0003_backfill_steps_timer_label.sql`

- **Analyzer verdict:** REVIEW_REQUIRED ((none))
- **squawk:** (no findings)
- **Corpus expectation:** 04-06/D-31: the real, hand-authored backfill (a single scoped `UPDATE steps SET timer_label = '' WHERE timer_label IS NULL`) that must run before the SET NOT NULL migration, since the seed genuinely leaves NULL rows. It demonstrates the update-without-where floor rule from the PASSING side -- a scoped UPDATE matches no rule at all (D-06's unmatched-statement default applies), where the same statement without a WHERE would be BLOCKED.
- **Verdict on the disagreement:** different-by-design
- **Reason:** Same default-outcome-policy difference `review-required/set-search-path.sql` and `adversarial/dollar-quoted-string-inert.sql` above already established: squawk has no rule watching a scoped `UPDATE` at all (confirmed live: zero findings, exit 0), so its silence reflects "no rule exists" rather than "this is safe" -- while this analyzer's D-06 earn-SAFE default gives any unmatched statement its own explicit REVIEW_REQUIRED verdict rather than leaving it unclassified. Not a hazard disagreement about the `UPDATE` itself (both tools implicitly treat a `WHERE`-scoped `UPDATE` as unremarkable) -- a policy-for-the-unrecognized-case disagreement, the same category as those two rows.

## Annotation provenance (2026-09-08 Nyquist audit)

This report was regenerated and re-annotated during `/gsd-validate-phase 3`, which found it had
gone stale: it was hand-annotated at commit `ed47eb1` against a 49-row corpus, and commit
`c7e807b` (CR-02) later added two fixtures without refreshing it. Nothing detected that drift, so
`packages/automation/test/squawk-comparison-report.test.ts` now asserts every manifest entry has
a row here, that none of the generator's own unfilled verdict/reason placeholders survive into a
commit (the check matches that placeholder token literally, so this note deliberately does not
spell it out — writing it here would trip the very assertion it describes), and that the stated
row counts match the table.

What changed, so a reader knows what carries what authority:

- The 21 pre-existing disagreement explanations were carried across **verbatim**, matched by file
  path. The regenerated analyzer verdict and squawk findings under each were checked against the
  values those reasons were originally written for; none had changed.
- **One reason is newly written and has not yet had its human read:**
  `safe/multi-subcommand-alter-table-all-safe.sql`. It is drafted by the same agent that ran the
  audit, not confirmed by the owner, and 03-07 Task 2's `<human-check>` over it is still
  outstanding. Treat it as drafted until that read happens.
- The **counts in the Executive summary were wrong before this pass and are corrected here.** It
  claimed 19 different-by-design / 2 analyzer-correct over 21 rows; the file actually carried
  18 / 3, and its own prose named three analyzer-correct files while calling them "two". The
  labels on individual rows were right -- only the tally over them was off. It now reads
  19 / 3 over 22 rows, which matches a count of the verdict lines below.

## Audit note (Phase 4 plan 06)

Three rows are new since this report was last annotated, added when 04-06-PLAN.md spent two of
`01-CONTEXT.md` D-11's reserved recipe-app churn rows for real: `apps/recipe-app/drizzle/0002_oval_maelstrom.sql`
(the SAFE `notes` column, D-30), `apps/recipe-app/drizzle/0003_backfill_steps_timer_label.sql`
(the REVIEW REQUIRED backfill, D-31), and `apps/recipe-app/drizzle/0004_redundant_apocalypse.sql`
(the REVIEW REQUIRED `SET NOT NULL`, D-31). This edit was made by hand against a squawk run over
exactly these three files (never a full regeneration of this report, which would have destroyed
every hand-filled disagreement above) -- appended to the end of the comparison table, matching
the CR-02 and Phase 4 plan 02 precedents above. Two of the three disagree (`0002_oval_maelstrom.sql`
and `0003_backfill_steps_timer_label.sql`, both different-by-design, detailed individually above);
`0004_redundant_apocalypse.sql` agrees. Already folded into the executive summary's totals above.

## Audit note (Phase 4 plan 07)

One row is new since this report was last annotated, added when 04-07-PLAN.md spent
`01-CONTEXT.md` D-11's third and final reserved recipe-app churn row for real:
`packages/automation/test/corpus/app-shaped/generated-drop-ingredients-table.sql` -- the exact
bytes `drizzle-kit generate` produced (`DROP TABLE "ingredients" CASCADE;`) when `ingredients`
was removed from `schema.ts` for real, refused BLOCKED by the runner, then reverted (D-32). This
edit was made by hand against a squawk run over exactly this one file (never a full regeneration
of this report, which would have destroyed every hand-filled disagreement above) -- appended to
the end of the comparison table, matching the CR-02, Phase 4 plan 02, and Phase 4 plan 06
precedents above. The row agrees: squawk's `ban-drop-table`, `prefer-robust-stmts`,
`require-lock-timeout`, and `require-statement-timeout` findings are byte-identical in rule-id
set to the Phase 3 hand-written mirror's own row
(`packages/automation/test/corpus/app-shaped/drop-ingredients-table.sql`), even though the SQL
text itself differs (quoted identifier, added `CASCADE` -- see `docs/30-migration-runner.md`'s
own "Anything surprising" section) -- squawk's `ban-drop-table` rule matches on the statement
kind, the same way this analyzer's `drop-table` rule does, so the textual difference changes
neither tool's verdict. No new disagreement to add; already folded into the executive summary's
totals above (still 29 disagreements, now over 65 rows instead of 64).

## Audit note (04-REVIEW.md WR-01 fix)

One row is new since this report was last annotated, added when `/gsd-code-review --fix`
addressed WR-01 (`inspectDropStmt` only examined the first object of a multi-object `DROP`
statement, the exact bug shape CR-02 already fixed for multi-subcommand `ALTER TABLE`):
`packages/automation/test/corpus/blocked/multi-object-drop-table.sql` (`DROP TABLE a, b;`),
pinning that the fix produces one finding per named object. This edit was made by hand against a
squawk run over exactly this one file (never a full regeneration of this report, which would have
destroyed every hand-filled disagreement above) -- appended to the end of the comparison table,
matching the CR-02, Phase 4 plan 02, Phase 4 plan 06, and Phase 4 plan 07 precedents above. The
row agrees: squawk's `ban-drop-table`, `prefer-robust-stmts`, `require-lock-timeout`, and
`require-statement-timeout` findings are byte-identical in rule-id set to the single-object
`blocked/drop-table.sql` row -- squawk's `ban-drop-table` rule matches on the statement kind, the
same way this analyzer's `drop-table` rule does, so squawk gives no signal at all about how many
objects a single `DROP` names, mirroring the multi-subcommand `ALTER TABLE` precedent exactly. No
new disagreement to add; already folded into the executive summary's totals above (still 29
disagreements, now over 66 rows instead of 65).

## Rows this run could not establish (0)

None -- squawk produced a parseable result for every corpus file.
