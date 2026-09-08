# Migration Runner

**Status:** All three sections below — SAFE, REVIEW REQUIRED, and BLOCKED — are written from
real runs performed on 2026-09-08, against the pinned local development database. Read
`Anything surprising` before trusting a number in this document blindly — it is written from
actual output, not from what was expected in advance. This is the **complete** D-33 record:
plan 04-06 wrote the SAFE and REVIEW REQUIRED sections; plan 04-07 fills the BLOCKED section
below and closes out the document.

## What the runner is

`pnpm db:migrate` (`scripts/db-migrate.ts`) is the runner: the one, thin, pinned entry point
that is allowed to open a real database connection on the migrate path (D-27/D-28). It reads
each committed migration file once, hands **the exact same bytes** to the in-process safety
analyzer (`analyzeSql`, `packages/automation`) for classification, then executes that same
buffer statement by statement — never a second read, never trusting a verdict computed
upstream (D-12, `docs/decisions.md`). `drizzle-kit migrate` is structurally unreachable from
this repository (D-02); `drizzle-kit generate`/`check` remain in use for authoring migrations.

`pnpm db:reset` calls `pnpm db:migrate` as a real command (not an internal function call), so
every full teardown-and-rebuild exercises the same gated path a developer runs directly.

## Pinned timeouts

`lock_timeout = 3000ms` and `statement_timeout = 30000ms` (`packages/automation/src/runner/timeouts.ts`,
D-13) are pinned source constants, not environment-variable-tunable. They are applied as libpq
connect-time startup options (`options=-c lock_timeout=3000 -c statement_timeout=30000`, D-14)
— never a `SET` issued after connect — so there is no window in which the session exists
without them. Before executing anything, the runner re-queries `pg_settings` directly (never
`SHOW`, which returns a human-formatted string like `"3s"` rather than a comparable integer) and
refuses to proceed if either GUC does not read back exactly as pinned (D-15,
`assertTimeoutsInEffect`). One pair of values applies to everything, including
`CREATE INDEX CONCURRENTLY` — no exemption for any statement kind (D-16).

## What the runner does with each verdict

- **SAFE** — applies, exits 0.
- **REVIEW REQUIRED** — proceeds locally, but only after printing the **complete** findings
  list first: every statement's verdict, every matched rule id (or `(no rule matched)` when
  none matches, per D-06's "SAFE must be earned" unmatched-statement default), and every
  rationale — never a summary (D-05). The development database is disposable and there is no
  second person available to review; the gate that actually blocks is Phase 5's CI.
- **BLOCKED** — refused unconditionally, no flag, no config, no environment variable can
  override it (RUN-02). See "The BLOCKED change" section below.
- A parse failure refuses the entire run and applies nothing (D-08) — not exercised by any
  change in this document; every migration below parsed cleanly.

Exit 0 means "applied everything it was asked to apply, including anything that classified
REVIEW REQUIRED" (D-06) — the runner also always emits a complete, machine-readable JSON run
report to stdout, one entry per migration considered (including skipped ones).

## The SAFE change: a nullable `notes` column on `recipes`

**Schema edit** (`apps/recipe-app/src/db/schema.ts`, `recipes` table): added

```ts
notes: text("notes"),
```

— nullable, no default, spending one of `01-CONTEXT.md` D-11's reserved churn rows (D-30). The
`tags` table alternative remains unspent.

**Command run:** `pnpm db:generate` (this is `drizzle-kit generate`), then `pnpm db:migrate`.

**Generated SQL** (`apps/recipe-app/drizzle/0002_oval_maelstrom.sql`), produced by `drizzle-kit
generate` and never hand-edited:

```sql
ALTER TABLE "recipes" ADD COLUMN "notes" text;
```

**The runner's actual output, pasted verbatim:**

```
[db:migrate] 0000_bumpy_khan: skipped
[db:migrate] 0001_busy_thunderbolt: skipped
{
  "runId": "d50091fb-be1f-4848-9ae8-10a43b520a81",
  "entries": [
    {
      "tag": "0000_bumpy_khan",
      "idx": 0,
      "verdict": null,
      "state": "skipped",
      "statementCount": 0,
      "wrapped": null,
      "durationMs": null
    },
    {
      "tag": "0001_busy_thunderbolt",
      "idx": 1,
      "verdict": null,
      "state": "skipped",
      "statementCount": 0,
      "wrapped": null,
      "durationMs": null
    },
    {
      "tag": "0002_oval_maelstrom",
      "idx": 2,
      "verdict": "SAFE",
      "state": "applied",
      "statementCount": 1,
      "wrapped": true,
      "durationMs": 4
    }
  ],
  "worstVerdict": "SAFE"
}
[db:migrate] 0000_bumpy_khan: skipped
[db:migrate] 0001_busy_thunderbolt: skipped
[db:migrate] 0002_oval_maelstrom: applied (SAFE)
```

(The runner does not print a separate findings block for a SAFE migration — that printing is
reserved for REVIEW REQUIRED, per D-05 above. The JSON report and the tag/state/verdict lines
above are the runner's complete output for this run.)

Verdict `SAFE`, rule id `add-column-nullable-no-default` — matching the Phase 3 corpus
prediction (`packages/automation/test/corpus/app-shaped/recipes-add-notes-column.sql`) exactly.
Confirmed live against the development database:
`information_schema.columns` reports `recipes.notes` present with `is_nullable = YES`.

## The REVIEW REQUIRED change: backfill then `SET NOT NULL` on `steps.timer_label`

**Why two migrations, not one:** the seed genuinely leaves some `steps` rows with a NULL
`timer_label` (D-31). A bare `SET NOT NULL` would *fail at execution*, not merely classify, so
the backfill runs first as its own file.

**Migration A — the backfill (hand-authored, custom).** Generated as an empty file via
`pnpm --filter recipe-app exec drizzle-kit generate --custom --name=backfill_steps_timer_label`
(the `--custom` flag is available in the installed drizzle-kit 0.31.10), then written by hand:

`apps/recipe-app/drizzle/0003_backfill_steps_timer_label.sql`:

```sql
UPDATE steps SET timer_label = '' WHERE timer_label IS NULL;
```

The `WHERE` clause is the point: it demonstrates the floor's `update-without-where` rule from
the *passing* side — the same statement with no `WHERE` classifies BLOCKED unconditionally
(`packages/automation/test/corpus/blocked/update-without-where.sql`); with a scoping `WHERE`,
it matches no catalogued rule at all and falls through to D-06's REVIEW REQUIRED
unmatched-statement default.

**Migration B — the constraint (generated).** Schema edit (`apps/recipe-app/src/db/schema.ts`,
`steps` table):

```ts
timerLabel: text("timer_label").notNull().default(""),
```

— following `ingredients.unit`'s own precedent in the same file. Generated via `pnpm
db:generate`:

`apps/recipe-app/drizzle/0004_redundant_apocalypse.sql`:

```sql
ALTER TABLE "steps" ALTER COLUMN "timer_label" SET DEFAULT '';
ALTER TABLE "steps" ALTER COLUMN "timer_label" SET NOT NULL;
```

**Command run:** `pnpm db:generate` (twice — once for the custom backfill, once for the
generated constraint migration), then a single `pnpm db:migrate` applying both.

**The runner's actual output, pasted verbatim (complete findings, both migrations):**

```
[db:migrate] 0003_backfill_steps_timer_label: REVIEW_REQUIRED -- proceeding locally. Findings:
  statement 0: REVIEW_REQUIRED [(no rule matched)] No rule matched this operation; SAFE must be earned by a matching rule (D-06).
[db:migrate] 0004_redundant_apocalypse: REVIEW_REQUIRED -- proceeding locally. Findings:
  statement 0: REVIEW_REQUIRED [(no rule matched)] No rule matched this operation; SAFE must be earned by a matching rule (D-06).
  statement 1: REVIEW_REQUIRED [set-not-null] SET NOT NULL on an existing column forces a full table scan under ACCESS EXCLUSIVE to verify no NULLs exist, blocking reads and writes for the scan's duration.
{
  "runId": "1d88cec9-f66d-48e6-9334-7e0ba1367c56",
  "entries": [
    { "tag": "0000_bumpy_khan", "idx": 0, "verdict": null, "state": "skipped", "statementCount": 0, "wrapped": null, "durationMs": null },
    { "tag": "0001_busy_thunderbolt", "idx": 1, "verdict": null, "state": "skipped", "statementCount": 0, "wrapped": null, "durationMs": null },
    { "tag": "0002_oval_maelstrom", "idx": 2, "verdict": null, "state": "skipped", "statementCount": 0, "wrapped": null, "durationMs": null },
    { "tag": "0003_backfill_steps_timer_label", "idx": 3, "verdict": "REVIEW_REQUIRED", "state": "applied", "statementCount": 1, "wrapped": true, "durationMs": 5 },
    { "tag": "0004_redundant_apocalypse", "idx": 4, "verdict": "REVIEW_REQUIRED", "state": "applied", "statementCount": 2, "wrapped": true, "durationMs": 3 }
  ],
  "worstVerdict": "REVIEW_REQUIRED"
}
[db:migrate] 0000_bumpy_khan: skipped
[db:migrate] 0001_busy_thunderbolt: skipped
[db:migrate] 0002_oval_maelstrom: skipped
[db:migrate] 0003_backfill_steps_timer_label: applied (REVIEW_REQUIRED)
[db:migrate] 0004_redundant_apocalypse: applied (REVIEW_REQUIRED)
```

Both migrations classified `REVIEW_REQUIRED` and the process exited 0 (D-05: REVIEW REQUIRED
proceeds locally). Confirmed live against the development database:
`information_schema.columns` reports `steps.timer_label` with `is_nullable = NO` and
`column_default = ''::text`; a `SELECT count(*) FROM steps WHERE timer_label IS NULL` query
returns `0`.

**Then `pnpm db:reset` was run end to end** (full teardown → runner-applied history → seed →
independent post-check). It completed cleanly with no manual change required — Drizzle's
`db.insert(steps).values(...)` omits the `timerLabel` property entirely for the two seed rows
that have no timer, rather than sending an explicit `NULL`, so PostgreSQL applies the column's
own `''` default. The seeded rows were confirmed live: the two timer-less steps store `''`, the
three with a timer keep their real values (`'12 min'`, `'8 min'`, `'4 min'`).

## The BLOCKED change: `DROP TABLE ingredients` — generated for real, refused, reverted (D-32)

**Schema edit** (`apps/recipe-app/src/db/schema.ts`): the `ingredients` table and its
`ingredientsRelations` were removed for real — the export deleted entirely, and
`recipesRelations`'s `many(...)` block stopped naming `ingredients` so the file still
type-checked. Nothing else was touched.

**Command run:** `pnpm db:generate` (this is `drizzle-kit generate`), then `pnpm db:migrate`.

**Generated SQL** (captured as `apps/recipe-app/drizzle/0005_plain_scalphunter.sql` at generation
time, produced by `drizzle-kit generate` and never hand-edited):

```sql
DROP TABLE "ingredients" CASCADE;
```

This is **not** what the Phase 3 hand-written mirror predicted
(`packages/automation/test/corpus/app-shaped/drop-ingredients-table.sql`: unquoted
`DROP TABLE ingredients;`, no `CASCADE`) — see `Anything surprising` below.

**The runner's actual output, pasted verbatim:**

```
0005_plain_scalphunter: BLOCKED -- refused. No flag, environment variable, or configuration
value can change this outcome.
 ELIFECYCLE  Command failed with exit code 21.
```

Unlike the SAFE and REVIEW REQUIRED runs above, no JSON run report is printed here: the runner
throws `MigrationRefusedError` the moment a `BLOCKED` verdict is found (Phase B of
`runMigrations`, before it ever returns a report), so `db:migrate`'s `console.log(JSON.stringify(report, ...))`
line is never reached for a run that hits this refusal branch. The one-line error message above,
plus the `pnpm` wrapper's own exit-code line, is the runner's complete stdout/stderr for this run
— not an abbreviation of a longer report.

**Confirmed live against the development database, before any revert:**
- Exit code: `21` (`RUNNER_EXIT_CODES.REFUSED_BLOCKED`).
- `runner.migration_runs`' newest row: `state = 'refused'`, `verdict = 'BLOCKED'`, `findings`
  containing exactly one entry with `ruleIds: ["drop-table"]` and rationale "DROP TABLE
  permanently destroys the table and every row it holds; there is no automated way to recover
  the data afterward."
- `drizzle.__drizzle_migrations` still held exactly 5 rows (unchanged) — nothing from the
  refused migration was applied.
- `SELECT count(*) FROM ingredients` still returned `8` — the live table and its seeded rows
  were untouched.

**Revert.** `apps/recipe-app/src/db/schema.ts`, `apps/recipe-app/drizzle/meta/_journal.json`,
and the generated `0005_plain_scalphunter.sql` file and its `meta/0005_snapshot.json` were
restored/removed. Confirmed afterward: `git status --porcelain apps/recipe-app` printed nothing
but two pre-existing, unrelated untracked files (`AGENTS.md`, `CLAUDE.md`, present before this
demonstration began and outside the schema/migrations/journal/snapshot surface this check
guards); `git hash-object apps/recipe-app/drizzle/meta/_journal.json` matched the committed
blob at `HEAD` exactly.

**Made permanent.** The exact bytes above are committed as
`packages/automation/test/corpus/app-shaped/generated-drop-ingredients-table.sql`, with a new
`app-shaped` manifest entry recording the observed verdict. `tests/history/blocked-replay.test.ts`
replays the refusal against a fresh, disposable `postgres:17` container — proving the
`ingredients` table still exists after the refusal, the ledger holds exactly the committed
journal's entry count and no more, and the refusal repeats identically on a second attempt —
so this demonstration never has to be taken on trust again.

## Recovering from a partial failure

`pnpm db:migrate:recover` (D-21, plan 04-05) is the only recovery path. It **reports** the exact
state of every unresolved marker it finds — which migration, which statement (of how many), and
whether any index it left behind is `INVALID` — and then **resolves** the marker so `db:migrate`
can proceed again. It states plainly, in its own output, that nothing was repaired: it never
edits the committed migration journal and never drops or rebuilds anything itself. If a failed
`CREATE INDEX CONCURRENTLY` left an `INVALID` index, that index is still there after recovery —
dropping it (or rebuilding it) is the operator's own action, taken with full knowledge of what
the report named, not something this pipeline does on its own initiative.

## What this does not do

- **No approval or override mechanism for REVIEW REQUIRED.** REVIEW REQUIRED proceeds locally
  with its complete findings printed (D-05); nothing in this pipeline lets a human approve or
  override a verdict yet. That path — a required-reviewers gate with assembled context — is
  Phase 5 and Phase 7 work, not built here.
- **No remote or production database of any kind.** Every run recorded in this document, in
  every section, was against the pinned local development container only. Staging is Phase 6;
  production is Phase 7.
- **No audit log yet.** `runner.migration_runs` (D-19) is the substrate a future audit log will
  read from, but no audit log itself exists in this phase.
- **Production's PostgreSQL major version is still UNKNOWN** (`docs/decisions.md` D16). Nothing
  in this document changes that; it is recorded again here, not assumed away, per this project's
  own non-negotiable to mark unverified things UNKNOWN rather than quietly resolve them.

## Anything surprising

- **No divergence between the Phase 3 corpus predictions and the observed verdicts for SAFE and
  REVIEW REQUIRED.** All three real migrations in those two sections classified exactly as
  `docs/decisions.md` D-30/D-31 and the committed `app-shaped/` corpus fixtures predicted:
  `notes` landed SAFE (`add-column-nullable-no-default`); the constraint migration landed
  REVIEW_REQUIRED (`set-not-null`).
- **The backfill's own verdict was not separately predicted in advance** (only the constraint
  migration had a committed corpus fixture) — observed live as REVIEW_REQUIRED with no matched
  rule id, which is the expected shape for a scoped `UPDATE ... WHERE ...` under D-06's
  unmatched-statement default. Recorded now in `packages/automation/test/corpus/manifest.json`
  so this is regression-tested going forward, not merely remembered.
- **The seed needed no explicit empty-string value.** The plan anticipated a possible need to
  set `timerLabel: ""` explicitly on the two timer-less seed rows if Drizzle emitted an
  explicit `NULL` instead of omitting the column. It did not: Drizzle's insert genuinely omits
  an unset column, letting PostgreSQL's own column default apply. Only `seed.ts`'s comment
  needed updating (it previously asserted these rows store SQL NULL, which stopped being true).
- **The BLOCKED demonstration's generated SQL diverged from the Phase 3 hand-written mirror, in
  two small but real ways.** The committed prediction
  (`packages/automation/test/corpus/app-shaped/drop-ingredients-table.sql`) reads
  `DROP TABLE ingredients;` — unquoted, no `CASCADE`. The real bytes `drizzle-kit generate`
  produced were `DROP TABLE "ingredients" CASCADE;` — the identifier quoted, and a `CASCADE`
  added. Both are cosmetic in the sense that the classifier still floors both to `BLOCKED` via
  the same `drop-table` rule (it matches on the `DropStmt` AST node's `statementKind`, never on
  the literal text), but it is exactly why this plan committed the REAL generated bytes as a
  second, separate corpus fixture rather than only trusting the hand-written mirror stayed
  accurate — the two fixtures together make the prediction-versus-reality gap visible in the
  corpus itself, not only in this prose.
- **`pnpm db:reset` does not forward `db:migrate`'s own console output.** `scripts/db-reset.ts`
  invokes the migrate step via a plain `execa("pnpm", ["run", "db:migrate"])` call with no
  `stdio: "inherit"`, so none of `db:migrate`'s own per-migration verdict lines or JSON run
  report are visible in a `pnpm db:reset` run's console output — they are captured by `execa`
  into its result object, which `db-reset.ts` never reads or prints. This does not affect
  correctness: the runner still classifies and records every migration in
  `runner.migration_runs` exactly as it does when invoked directly, and the independent
  `assertMigrationHistoryApplied()` post-check still verifies the resulting schema. Confirmed
  live during this plan's RUN-07 proof: after `pnpm db:reset` completed with no verdict lines
  printed, a direct query against `runner.migration_runs` showed all five real migrations
  recorded `applied`, with `0001_busy_thunderbolt`/`0003_backfill_steps_timer_label`/
  `0004_redundant_apocalypse` all correctly `REVIEW_REQUIRED` and `0000_bumpy_khan`/
  `0002_oval_maelstrom` correctly `SAFE` — the verdicts are real and recorded, just not printed
  to this particular command's own console. Recorded here as a documentation-accuracy finding,
  not fixed: `scripts/db-reset.ts` is outside this plan's `files_modified`, and adding
  `stdio: "inherit"` there is a one-line, low-risk change better made deliberately in a plan that
  owns that file.
- **UNKNOWN, unaffected by this phase's work:** production's PostgreSQL major version remains
  UNKNOWN (`docs/decisions.md` D16) and does not bear on anything recorded in this document —
  every run above was against the pinned local development database only.

No connection string, role password, or other credential appears anywhere in this document.
