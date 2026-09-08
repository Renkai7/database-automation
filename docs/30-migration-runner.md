# Migration Runner

**Status:** SAFE and REVIEW REQUIRED sections below are written from real runs performed on
2026-09-08, against the pinned local development database. Read `Anything surprising` before
trusting a number in this document blindly — it is written from actual output, not from what
was expected in advance. This is the **first half** of D-33's record; the BLOCKED demonstration
is a placeholder here (see below) and is filled by plan 04-07.

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
  override it (RUN-02). See the placeholder section below.
- A parse failure refuses the entire run and applies nothing (D-08) — not exercised by either
  change in this document; both migrations below parsed cleanly.

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

## The BLOCKED demonstration — placeholder

**Not yet filled.** Per D-32, the BLOCKED demonstration is generated for real, refused by the
runner, then reverted — with a committed replay test proving the refusal permanently. That
work is plan 04-07's, not this plan's. This section will be replaced with the same
schema-edit / generated-SQL / command / verbatim-output record once 04-07 runs.

## Anything surprising

- **No divergence between the Phase 3 corpus predictions and the observed verdicts.** All
  three real migrations classified exactly as `docs/decisions.md` D-30/D-31 and the committed
  `app-shaped/` corpus fixtures predicted: `notes` landed SAFE
  (`add-column-nullable-no-default`); the constraint migration landed REVIEW_REQUIRED
  (`set-not-null`).
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
- **UNKNOWN, unaffected by this phase's work:** production's PostgreSQL major version remains
  UNKNOWN (`docs/decisions.md` D16) and does not bear on anything recorded in this document —
  every run above was against the pinned local development database only.

No connection string, role password, or other credential appears anywhere in this document.
