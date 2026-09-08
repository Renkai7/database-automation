# Phase 4: Migration Runner & History Tests - Context

**Gathered:** 2026-09-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 4 is where execution becomes gated. Phase 3 built a classifier that has never run
against a database; this phase builds the component that *acts* on a verdict at the one
point that cannot be bypassed from inside the system (`docs/decisions.md` D12).

The runner owns the act of applying a migration: it reads the migration's bytes, hands
**those exact bytes** to the in-process classifier, refuses BLOCKED with no override, opens
its session under `lock_timeout` and `statement_timeout`, executes without forcing statements
into a transaction that would break `CREATE INDEX CONCURRENTLY`, and records what it did.
Alongside it, this phase proves the migration history is consistent — full history against an
empty database, newest migration against an existing one, the application booting against the
result — and reports a partially failed migration honestly rather than marking it applied.

It is also the phase in which the reserved recipe-app churn (`01-CONTEXT.md` D-11) is first
spent for real: one SAFE change, one REVIEW REQUIRED change, and one BLOCKED change that is
genuinely refused.

Requirements in scope: RUN-01, RUN-02, RUN-03, RUN-04, RUN-05, RUN-06, RUN-07, RUN-08, APP-02.

**Explicitly not this phase:**

- **No CI wiring and no PR rendering.** The runner produces a machine-readable report; Phase 5
  is what gates a merge on it (CI-01 … CI-05).
- **No approval or override mechanism for REVIEW REQUIRED.** `03-CONTEXT.md` deferred this to
  Phase 5/7 explicitly, and `PITFALLS.md` §C2 names an override built before the first real
  override as a warning sign. This phase's answer is D-05 below: report loudly, proceed
  locally, build no approval machinery.
- **No remote database of any kind.** D2/D3 stand. Staging is Phase 6, production is Phase 7.
  The runner is structurally pinned to the local development target (D-27).
- **No audit log.** Phase 7 (AUD-01 … AUD-04). This phase builds the table the audit log will
  later live in, but not the audit log itself.
- **No expand-and-contract work.** APP-03 is reserved for Phase 7 (`01-CONTEXT.md` D-11's
  fourth row) and must not be spent here.
- **No production runner.** D-25's core/entry-point split exists so Phase 7 adds a second thin
  entry point rather than rewriting; writing that entry point is Phase 7's work.

</domain>

<decisions>
## Implementation Decisions

### The execution engine

- **D-01:** The runner **executes the SQL itself through `pg`** — it reads each migration file
  once into memory, classifies that buffer, executes that same buffer, and writes the ledger
  row itself. RUN-01's "the actual SQL immediately before executing it" becomes literal rather
  than aspirational: there is no second read that could diverge from the classified one.
  Wrapping `drizzle-orm`'s programmatic `migrate()` was rejected on two independent grounds —
  it re-reads the files itself (so the classified bytes are not provably the executed bytes,
  which reopens exactly the gap D12 exists to close), and it wraps each migration file in a
  transaction, which breaks RUN-04 outright. A hybrid that borrowed drizzle-kit's journal
  reading was rejected as a dependency on internals that are not a stable public API.
  — **Reversibility:** costly — the ledger writing, statement splitting, transaction policy,
  timeout mechanism and failure recording are all built on top of owning execution; moving back
  to drizzle's migrator later would unpick all five.

- **D-02:** **`drizzle-kit migrate` is made structurally unreachable.** `db:migrate` becomes the
  runner, nothing in the repository invokes `drizzle-kit migrate`, and a test asserts no package
  script or code path reaches it. This is the same reasoning `01-CONTEXT.md` D-14 used to reject
  `docker-entrypoint-initdb.d`: a second, ungated path by which schema state arrives is the
  precise drift this system exists to detect, and it must not exist inside the system's own
  repository. A renamed escape hatch (`db:migrate:raw`) was rejected — it is an override path
  under a different name, which `PITFALLS.md` §C2 identifies as the start of the slide toward
  routine overriding.
  `drizzle-kit generate` and `drizzle-kit check` are untouched and stay in use.
  — **Reversibility:** one-way in intent — restoring a raw migrate path later reintroduces the
  ungated route. Treat any future PR that adds one as a safety-relevant change, exactly as
  `01-CONTEXT.md` D-16 requires for `db:query` and `02-CONTEXT.md` D-06 for the restore commands.

- **D-03:** **Statement boundaries come from the libpg-query AST**, not from drizzle's
  `--> statement-breakpoint` marker and not by sending the file as one multi-statement query.
  The parser already runs to produce the verdict and already reports each statement's location,
  so the unit classified and the unit executed are the same object by construction — there is no
  second splitting rule that could disagree with the first. It also works on SQL that carries no
  drizzle markers, which the tamper fixtures and any hand-written migration will not.
  Sending the whole file as one query was rejected because a multi-statement simple query is
  implicitly wrapped in a single transaction by the server, which breaks RUN-04 and destroys
  the per-statement failure reporting RUN-08 needs.

- **D-04:** **`drizzle.__drizzle_migrations` stays byte-compatible with drizzle's own format** —
  same table, same hash scheme — so `drizzle-kit generate`/`check` and the existing
  `scripts/verify-migration-state.ts` (which counts rows in it) keep working unchanged.
  See D-19: everything drizzle's schema has no room for goes in a *separate* runner-owned table,
  not into this one.

### What the runner does with each verdict

- **D-05:** **REVIEW REQUIRED proceeds locally, with the complete findings printed first** —
  every rule id and every rationale, never a summary. The development database is disposable
  (`01-CONTEXT.md` D-17), there is no second person available to review, and the gate that
  actually blocks is Phase 5's CI. Refusing locally was rejected because it breaks `db:reset` on
  existing committed history *today* (see D-07) and manufactures pressure for an override path
  in Phase 4 rather than Phase 5 — the exact sequence `PITFALLS.md` §C2 warns about. An
  interactive prompt was rejected on the grounds `01-CONTEXT.md` D-24 already established: a
  prompt automation passes `--yes` to protects nobody, and it would block RUN-05/06's automated
  history tests from reusing the runner.
  **BLOCKED is refused unconditionally with no flag, no config and no environment variable**
  (RUN-02) — that is the wall, and D-05 is what keeps it meaning something.

- **D-06:** **Exit 0 on success, plus a machine-readable run report.** The runner exits 0 when it
  applied everything it was asked to apply, including migrations that classified REVIEW REQUIRED,
  and always emits a structured record of per-migration verdict, findings and timings. Phase 5's
  CI gates on the report, not on the exit code, so `db:reset` and the test harnesses stay green.
  A distinct non-zero "applied but wanted review" code was rejected: every caller would have to
  special-case it, and non-zero-but-fine is a contract that gets misread once and then ignored.
  Stdout-only was rejected because it would push Phase 5 into parsing text or re-running the
  analyzer separately — re-creating the classify-upstream/execute-downstream split D12 closes.

- **D-07:** **`0001_busy_thunderbolt.sql` is left exactly as it is.** It is committed, applied,
  its hash is load-bearing for drizzle interop, and its REVIEW_REQUIRED classification (plain
  validated foreign keys, no `NOT VALID`) is *correct* — the corpus manifest records this
  explicitly. Leaving it means every `db:reset` exercises the real REVIEW REQUIRED path against
  real committed history for free, which is stronger proof than any fixture. **Record this as
  intentional so nobody later "fixes" it.** Rewriting it was rejected: changing applied,
  committed migration SQL is the class of act this project exists to prevent, and it would
  desynchronise the ledger row on every developer database. Suppressing the report for
  already-applied migrations was rejected because it would make the runner say different things
  about the same SQL depending on database state, weakening the "re-derive from the SQL in front
  of you" guarantee.

- **D-08:** **A parse failure refuses the entire run, exits non-zero, and applies nothing.**
  `03-CONTEXT.md` D-08's fourth outcome reaches the runner as `AnalyzerParseError`. If the
  analyzer could not parse the input it has no verdict, and "no verdict" can never mean
  "proceed". Skipping the unparseable file and applying the rest was rejected because it would
  apply migrations out of journal order, corrupting the exact history-consistency property
  RUN-05/06 exist to prove. Collapsing it into BLOCKED was rejected for `03-CONTEXT.md` D-08's
  own reason: it makes "the analyzer is broken" indistinguishable from "the migration is
  destructive" in Phase 7's audit record.

### Transactions

- **D-09:** **Wrapped by default; auto-unwrapped only when the file contains a statement
  PostgreSQL forbids inside a transaction.** The decision is derived from the same parse that
  produced the verdict — no directive, no comment, no config, no flag. Atomic-by-default is what
  makes most failure modes self-cleaning. Never wrapping was rejected because it would make
  half-applied migrations the normal case rather than the exception. Splitting a file into
  wrapped and unwrapped segments was rejected because the file would stop being one unit, so
  "this migration applied" would become a claim about several independent outcomes.
  A comment-based or naming-convention directive was rejected on `03-CONTEXT.md` D-13's
  principle: this system's whole purpose includes proving comments are inert, so load-bearing
  data must not live in one.

- **D-10:** **"Cannot run in a transaction" is a new `transactionHostile` fact in the analyzer's
  inspector** — an inspector change, therefore a code diff plus a test, exactly as
  `03-CONTEXT.md` D-01 requires for teaching the analyzer a new observable. It covers
  `CREATE INDEX CONCURRENTLY`, `DROP INDEX CONCURRENTLY`, `REINDEX CONCURRENTLY`, `VACUUM`,
  `CREATE DATABASE` and `ALTER SYSTEM` in one place, and Phase 5 and Phase 7 inherit it.
  Deriving it from the existing `concurrently` fact was rejected as silently missing several of
  those, which then fail at runtime with a confusing PostgreSQL error rather than being handled.
  A statement-kind list kept inside the runner was rejected as a second place that reasons about
  SQL semantics, drifting from the analyzer's vocabulary — the split `03-CONTEXT.md` D-11's
  pure-core seam exists to prevent.

- **D-11:** **A file mixing a transaction-hostile statement with ordinary DDL is refused**, naming
  the offending statement and saying to split it. This is structural rather than remembered: it
  makes "unwrapped" always mean "a single statement whose failure is its own", so a *half-applied
  file* becomes impossible by construction rather than being a case the recovery story has to
  handle. It matches the advice Strong Migrations and squawk both give independently.
  **Consequence, recorded rather than discovered later:** the only residual partial state in the
  whole system is a `CREATE INDEX CONCURRENTLY` that fails and leaves an `INVALID` index behind.
  D-17 through D-20 exist for exactly that case and no other.

- **D-12:** **For a wrapped file, the `__drizzle_migrations` row is inserted inside the same
  transaction**, so "applied" and "recorded" can never disagree — a crash mid-file rolls back
  both. Writing it after commit was rejected: a crash in the gap leaves a migration genuinely
  applied and unrecorded, which the next run would replay. Writing it optimistically before
  execution was rejected because the ledger would assert something untrue for the duration of
  every migration.

### Timeouts

- **D-13:** **`lock_timeout` and `statement_timeout` are pinned source constants — roughly 3s and
  30s** — living in the same pinning style as `EXPECTED_DEV_DATABASE_PORT` in `scripts/env.ts`
  (`01-CONTEXT.md` D-16). Changing either is a reviewed source diff, not configuration. 3s fails
  fast enough that criterion 2's slow-locking test runs quickly; 30s is generous for real DDL but
  bounded. Tighter values (1s/10s) were considered and rejected as inviting a loosening decision
  in Phase 7 with production data on the line. Environment variables with pinned defaults were
  rejected because they make the timeout a value the operator maintains rather than a property of
  the runner, and "set it to 0 in CI" becomes a one-line diff nobody reviews.
  The exact numbers are a recorded decision, not an incidental constant — the same treatment
  `02-CONTEXT.md` D-19 gave its 30-day threshold — so they can be revisited with a stated reason
  rather than drifted.

- **D-14:** **The timeouts are applied as libpq connection options (`options=-c ...`) at connect
  time**, not as a `SET` issued afterwards and not as `SET LOCAL`. There is then no window in
  which the session exists without them and no ordering bug that could skip them — the timeout
  becomes a property of how the runner opens a connection, the same architectural move as pinning
  the target. `SET LOCAL` was rejected because it does nothing for unwrapped files, which are
  exactly the `CONCURRENTLY` case, so a second mechanism would be needed regardless.

- **D-15:** **The runner verifies the timeouts are actually in effect before executing anything** —
  `SHOW lock_timeout` / `SHOW statement_timeout`, asserted against the pinned constants, refusing
  otherwise. This repo already holds one recorded instance of a tool exiting successfully without
  doing its job (`scripts/verify-migration-state.ts` exists because `drizzle-kit migrate` did
  exactly that on Windows), which is why "set it and trust it" is not good enough here.

- **D-16:** **No timeout exemption for concurrent index builds.** One pair of values applies to
  everything. A build that outruns `statement_timeout` fails loudly and the operator makes a
  deliberate decision, rather than the runner quietly granting unbounded runtime to a whole class
  of statement. Revisit in Phase 7 when real data volumes produce actual evidence; a "15 minutes
  for hostile statements" constant now would be a number with nothing behind it.

- **D-17:** **A migration that `SET`s its own `lock_timeout` or `statement_timeout` is BLOCKED, and
  the rule joins `03-CONTEXT.md` D-02's code floor** — a rules file that assigns it anything
  weaker fails schema validation and the analyzer refuses to run. This is a migration disarming
  its own safety rail, architecturally identical to a rules file downgrading `DROP TABLE`, which
  is the exact class the floor exists to make un-editable. It is caught inside `DO` blocks and
  function bodies too, which comes free from D-05's existing recursion, and it ships with an
  adversarial fixture pair (`03-CONTEXT.md` D-14) so the nested coverage is structural rather than
  incidental.
  **The floor's stated definition widens from "irreversible data loss" to "irreversible data loss
  or self-disarming"**, updated in `docs/decisions.md`, in `03-CONTEXT.md` D-02's successor entry,
  and in the analyzer's own floor module — so the floor stays a stated principle anyone can apply
  to a future candidate, rather than a list that grew an unexplained member.
  — **Reversibility:** one-way in intent — same standing as the original floor: any future PR that
  narrows the definition or adds a rules-file escape is a safety-relevant change.

### Partial failure and recovery

- **D-18:** **An in-flight marker is written before an unwrapped statement executes and cleared
  once its ledger row lands.** For an unwrapped file there is no transaction to make execution and
  recording atomic, so a run that finds a stale marker knows exactly which migration was mid-flight
  rather than having to guess. This converts an invisible window into a loud, named state — the
  same move `02-CONTEXT.md` D-20 made for a drill that could not run. Mandating `IF NOT EXISTS` on
  unwrapped SQL was rejected as a rule migration authors must remember (the "remembered caution"
  pattern the non-negotiables forbid) and because drizzle-kit does not generate that form.
  Accepting the window was rejected because "a replay usually fails loudly" is not a guarantee.

- **D-19:** **The in-flight marker, failure state and run report live in a runner-owned table in
  the same database.** It travels with the database it describes — restore it, clone it, point at
  a different one, and the state is still correct, which a file on disk cannot manage.
  `__drizzle_migrations` stays byte-compatible per D-04; this is a *separate* table holding only
  what drizzle's schema has no room for (verdict, rule ids, timings, in-flight and failure state).
  It is also the substrate Phase 7's audit log will be built on, so that phase renders an existing
  artifact rather than inventing one.
  **Recorded so it does not read as a contradiction:** D-04 chose "drizzle-compatible ledger, no
  sidecar" over "both"; this decision reintroduces a sidecar, deliberately, scoped to what drizzle
  cannot hold. The two together are the "both" option arrived at for a concrete reason.
  — **Reversibility:** costly — the runner, the recovery command, the history tests, Phase 5's CI
  reader and Phase 7's audit log are all written against this table's shape.

- **D-20:** **A run that finds a stale in-flight marker refuses everything and reports precisely** —
  which migration, which statement, and what to check in the database — exiting non-zero and
  applying nothing until resolved. Continuing past an unknown database state is how a partial
  failure becomes a silent one, and applying later migrations on top of it is the drift the history
  tests exist to catch. Automatic repair was rejected: it would put destructive capability (dropping
  an `INVALID` index on its own initiative) inside the component whose entire job is refusing
  destructive operations.

- **D-21:** **Recovery is `db:migrate:recover`, a report-and-clear command.** It reports the exact
  state — which migration, which statement, and what the database currently contains, including any
  `INVALID` index it finds — and clears the marker once the operator has resolved it. It never edits
  `_journal.json` (RUN-08) and it never repairs the schema itself. Treating `db:reset` as the
  recovery path was rejected: it satisfies RUN-08's letter on a disposable database but leaves
  Phase 7 starting from zero on the one thing it will need under pressure.
  Like every other command in this repo, it accepts **no target** (`02-CONTEXT.md` D-06).

### Proving it — the history tests

- **D-22:** **RUN-05/06 run against `@testcontainers/postgresql`; RUN-07's app boot runs against the
  real pinned dev container.** Two harnesses, because neither can honestly do the other's job:
  Testcontainers gives "genuinely empty" by construction with a dynamic port, and the app's
  connection is pinned to `127.0.0.1:5432/recipe_dev` — the exact collision `02-CONTEXT.md` D-14
  already declined to solve by loosening the pin. Loosening `assertLocalDevelopmentTarget` remains
  rejected: it is the single guard that makes the whole workspace structurally local.

- **D-23:** **The runner follows `02-CONTEXT.md` D-06's seam for the Testcontainers case** — the
  `db:migrate` command asserts the pinned development target exactly as `db:backup`/`db:restore`
  do, and a **separate internal function accepts only a connection object the harness constructed**.
  Never a connection string a human or an agent can supply. This is the established pattern being
  reused, not a new exception being carved.
  Separately, the runner **accepts a migrations-directory argument that defaults to the real path**,
  mirroring `enumerateMigrationFiles(migrationsDir, journalPath)`. A migrations *directory* is not a
  database target, so D-06's rule is untouched — but the two look alike, so this distinction is
  recorded explicitly rather than left to be re-litigated. This is how criterion 1's tamper test
  drives the real command against a temp directory without mutating the committed migrations folder.

- **D-24:** **The history tests get their own `test:history` suite, plus one cheap assertion in the
  default `pnpm test` suite on their recorded result** — the shape `02-CONTEXT.md` D-16/D-19 chose
  for the drill, and for the same reason: a slow Docker-dependent test inside the default suite is
  the one that eventually gets marked skipped to make the suite fast again. Folding them into
  `db:drill` was rejected because that command would stop meaning "the restore drill" and would
  muddy D-17/D-18's status record.
  **The cheap check hard-fails on a missing record or a FAIL outcome, but carries no staleness
  rule.** Unlike a restore drill, these tests are deterministic and run from committed migrations —
  nothing about them decays with time, so an age threshold would be a nag rather than evidence going
  stale, and a red suite for a reason that is not real is what teaches people to ignore red.
  Per `02-CONTEXT.md` D-18, the history result is its **own fact**, kept separate from the drill's;
  a green run of one must not silently upgrade the other.
  **Note the distinction:** the committed status file this check reads is the *test harness's*
  result. The runner's per-run report (D-06, D-19) lives in the database. They are different
  artifacts with different lifetimes.

- **D-25:** **RUN-06's "existing already-migrated database" is staged by applying the real journal's
  history minus its newest entry, then applying the newest.** Both halves derive from the committed
  journal, so the test always exercises whatever the actual newest migration is — including the
  APP-02 changes this phase adds — with no fixture to keep in sync. Restoring a Phase 2 backup to
  reach the prior state was rejected as coupling a migration test to the backup pipeline, so a
  restore bug would fail a migration test. A purpose-built fixture pair was rejected because it
  stops testing the migration that is actually about to reach production.

- **D-26:** **RUN-07 reuses `tests/smoke.test.ts` verbatim, run after a full-history `db:reset`.**
  `01-CONTEXT.md` D-08 built it for exactly this and said so; extending it to also assert the APP-02
  columns was rejected because it would stop being the stable, reusable asset three phases were told
  to reuse. Phase 5 gets the same asset again, unchanged.

### Where the runner lives

- **D-27:** **The runner's core lives in `packages/automation`; a thin entry point in `scripts/`
  holds the local pin.** The core takes migration files, rules and a client and does the
  classify-then-execute work; `scripts/db-migrate.ts` asserts the pinned development target and
  constructs the connection. This mirrors `03-CONTEXT.md` D-11's pure-core/adapter seam, honours
  `01-CONTEXT.md` D-03's statement that `db:migrate` is the one command that *does* get taken over
  by shared automation, and makes Phase 7's production runner a second thin entry point rather than
  a rewrite. Putting the whole thing in `scripts/` was rejected because Phase 7 would then have to
  promote a script written assuming a pinned local target. Putting the pin *inside* the package was
  rejected because the extractable artifact would carry a guard it must eventually shed.
  — **Reversibility:** costly — the same seam that makes `packages/automation` extractable; letting
  the pin or the driver leak into the core would have to be unpicked across the runner, the recovery
  command, the history harness and Phase 7's entry point.

- **D-28:** **`packages/automation` must not import `pg`.** The runner core defines a minimal client
  interface — the shape `scripts/env.ts`'s `QueryableClient` already establishes — and the caller
  injects a client. "This package cannot open a database connection by itself" stays a *structural*
  property rather than a convention, and both the local entry point and the Testcontainers harness
  simply pass what they already built. Adding `pg` as a package dependency was rejected precisely
  because it would grant the extractable safety package the one capability the project spends most
  of its effort constraining.

- **D-29:** **`db:reset` keeps calling `db:migrate` as a command, and keeps
  `assertMigrationHistoryApplied`.** It inherits the gate for free, and it keeps exercising the real
  path a developer runs rather than an internal function. The independent post-check stays: it
  exists because a migrate tool was once observed exiting zero without applying SQL, and a *brand
  new* migrate tool is exactly when an assertion that does not trust the tool's own account of
  itself earns its keep.

### The real schema changes (APP-02)

- **D-30:** **SAFE = a nullable `notes` column on `recipes`.** `03-CONTEXT.md` D-16 committed
  `recipes-add-notes-column.sql` as a fixture predicting SAFE precisely so Phase 4 could make the
  real change already knowing the expected verdict. The `tags` table alternative is left unspent —
  and note it would not have been a clean SAFE demonstration anyway, since an added foreign key
  without `NOT VALID` classifies REVIEW REQUIRED (which is exactly why `0001` does).

- **D-31:** **REVIEW REQUIRED = `SET NOT NULL` on `steps.timer_label`, preceded by a backfill.**
  It matches the committed `steps-timer-label-set-not-null.sql` fixture, and the live data makes it
  genuinely instructive: `apps/recipe-app/src/db/seed.ts` deliberately leaves some steps with a NULL
  `timer_label`, so a bare `SET NOT NULL` would *fail at execution*, not merely classify. The honest
  shape is a `WHERE timer_label IS NULL` backfill followed by the `SET NOT NULL` — which also
  demonstrates the floor's `UPDATE`-without-`WHERE` rule from the passing side.
  Running it unbackfilled and documenting the failure was rejected as conflating a classification
  demonstration with an execution failure, which D-18 through D-21 already cover deliberately.

- **D-32:** **BLOCKED = generated for real, refused, then reverted — with a committed replay test.**
  Edit `schema.ts`, run `drizzle-kit generate`, run the runner, watch it refuse, then revert both the
  generated migration and its journal entry. That satisfies criterion 5's "a real recipe-app schema
  change… through the runner" honestly, and the committed test replays the refusal permanently
  through D-23's temp migrations-directory mechanism, so it never has to be taken on trust again.
  Leaving a BLOCKED migration permanently in the committed history is not an option: `db:reset`
  replays that history on every rebuild and RUN-05 asserts on it.
  A permanently-outside-the-journal file was rejected as a hand-placed fixture rather than a real
  generated change. Reusing the existing `drop-ingredients-table.sql` corpus fixture alone was
  rejected because `03-CONTEXT.md` D-16 wrote it as a *mirror* so the real change could be made
  knowing the verdict — reusing it skips the thing it was written to enable.

- **D-33:** **A short `docs/` record of all three runs ships as phase output**, following
  `02-CONTEXT.md` D-10's precedent: what was actually run, what the runner actually printed for SAFE,
  REVIEW REQUIRED and BLOCKED, and anything surprising. Documentation is a deliverable in this
  project, and criterion 5 is a claim about what happened, not only about what a test asserts. The
  `docs/` numbering convention (`00-`, `10-`, `20-`, `30-`) is the obvious home.

### Carried forward (binding, not re-decided here)

- **`db:migrate` is the runner's name** — `01-CONTEXT.md` D-03 reserved it for exactly this.
- **No command accepts a target** (`01-CONTEXT.md` D-16, `02-CONTEXT.md` D-06). Adding one later is
  a safety-relevant change, not configuration.
- **The classifier is called in-process** with the exact bytes; it must never shell out to the CLI
  to decide whether to run (`03-CONTEXT.md` D-11/D-12, `docs/decisions.md` D12).
- **Hard-fail, never warn** (`01-CONTEXT.md` D-20, `02-CONTEXT.md` D-19/D-20). A thing that could not
  run is not a thing that passed.
- **PostgreSQL 17 everywhere** (D9); the drill/history container image is `postgres:17` Debian, not
  alpine (`01-CONTEXT.md` D-12, `02-CONTEXT.md` D-12).
- **`01-CONTEXT.md` D-11's fourth row (expand-and-contract) is reserved for Phase 7** and must not be
  spent here.
- **Production's PostgreSQL major version is still UNKNOWN** (`docs/decisions.md` D16). It does not
  block this phase; it must not be quietly assumed either.

### Claude's Discretion

- The runner-owned table's name, exact columns, and how it is bootstrapped on a database that does
  not yet have it — constrained by D-19 (in-database, holds in-flight/failure/run-report state, no
  credentials) and by it being the substrate Phase 7 extends.
- The precise `lock_timeout`/`statement_timeout` numbers within the ~3s/~30s intent of D-13, and
  whether `idle_in_transaction_session_timeout` is set alongside them.
- The run report's JSON shape, subject to D-06 (always complete, never a summary) and to it being
  what Phase 5 renders and Phase 7 records.
- Module layout inside `packages/automation` for the runner core, and the exact name/shape of the
  injected client interface required by D-28.
- Whether the D-31 backfill and the `SET NOT NULL` are one migration file or two, and what value the
  backfill writes.
- How the criterion-2 slow-lock test manufactures a competing lock, and how the criterion-4
  deliberate mid-migration failure is induced.
- What the history tests assert about the resulting schema — table presence, or a `pg_dump
  --schema-only` comparison in the spirit of `02-CONTEXT.md` D-13 tier 3 — and whether the seed runs
  in the throwaway containers.
- The filename and location of D-33's record, and of the D-24 history-test status file.
- Whether `ALTER DATABASE ... SET` and `ALTER ROLE ... SET` are treated as additional D-17 disarm
  vectors, or noted as a gap.
- The exact wording and mechanism of D-02's "no code path reaches `drizzle-kit migrate`" test.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase requirements and goal

- `.planning/ROADMAP.md` § "Phase 4: Migration Runner & History Tests" — the goal and the five
  success criteria this phase is verified against. Criterion 1 (tamper-then-refuse) and criterion 2
  (times out *and* `CREATE INDEX CONCURRENTLY` still succeeds) are the sharp ones.
- `.planning/REQUIREMENTS.md` — RUN-01 … RUN-08 and APP-02 are this phase's requirements. The Out of
  Scope table lists anti-features that must not be reintroduced.

### Binding prior decisions

- `docs/decisions.md` — **D12** (classification re-derived at execution time; this phase *is* D12,
  and its recorded honest limitation about self-approval matters for D-05), **D8** (migrations never
  run at application startup — confirmed necessary by D14's Phase 1 investigation), **D9**
  (PostgreSQL 17 pinned; analyzer rules may assume PG17 semantics), **D10** (parse, never
  pattern-match), **D11** (drizzle pinned to the stable line — `_journal.json` is the audit
  mechanism), **D2**/**D3** (no production or remote access), **D16** (the analyzer's classification
  contract; production's PG major is still UNKNOWN).
- `.planning/phases/01-local-environment/01-CONTEXT.md` — **required reading.** Directly binding:
  **D-03** (`db:migrate` is the placeholder this phase's runner takes over; `db:reset`/`db:query`
  must never be promoted), **D-11** (the reserved churn table — D-30/D-31/D-32 spend three of its
  four rows; the fourth is Phase 7's), **D-08** (the smoke test built for RUN-07's verbatim reuse),
  **D-14** (why a second ungated path to schema state is refused — the reasoning behind D-02),
  **D-16** (pin-in-source, and `assertLocalDevelopmentTarget`), **D-17** (the dev database is
  disposable — the premise D-05 rests on), **D-20/D-24** (hard-fail and no-prompt precedents),
  **D-22** (`db:reset`'s full teardown, which RUN-05 leans on), **D-09** (the recipe core schema),
  **D-12** (`postgres:17` Debian, not alpine).
- `.planning/phases/02-backup-restore-drill/02-CONTEXT.md` — **required reading.** Directly binding:
  **D-06** (no command accepts a target; the harness-only internal-function seam D-23 reuses),
  **D-11/D-12** (Testcontainers, `postgres:17` image), **D-14** (why app-boot-against-Testcontainers
  was declined — the collision D-22 resolves), **D-16** (slow suite separate from `pnpm test`),
  **D-17/D-18** (committed machine-readable status file; separate facts stay separate),
  **D-19/D-20** (hard-fail; a thing that could not run is not a thing that passed),
  **D-13** (assertion tiers, including schema comparison), **D-10** (the runbook precedent D-33
  follows).
- `.planning/phases/03-safety-analyzer/03-CONTEXT.md` — **required reading.** Directly binding:
  **D-11** (pure core / thin adapter; hand the classifier the exact bytes — the premise of D-01),
  **D-12** (library first, importable, distinct exit codes), **D-01** (the facts vocabulary and the
  no-expressions rule — D-10 adds a fact under it), **D-02** (the code floor — D-17 joins and widens
  it), **D-05** (recursion into DO blocks and function bodies — D-17's nested coverage),
  **D-06** (unmatched operations are REVIEW REQUIRED), **D-08** (parse failure is a hard error, not
  a verdict — the source of D-08 here), **D-10** (worst verdict wins, complete findings always),
  **D-13/D-14/D-16** (the corpus, the adversarial pairing rule D-17 extends, and the app-shaped
  fixtures D-30/D-31/D-32 turn into real changes).
- `CLAUDE.md` and `.claude/CLAUDE.md` — non-negotiables. Especially: prefer architectural enforcement
  over remembered caution (D-02, D-11, D-14, D-17, D-28 are this phase's instances); mark unverified
  things UNKNOWN; never log or commit credentials.

### Research

- `.planning/research/FEATURES.md` **§1** — the migration safety rule catalogue the analyzer already
  implements; relevant here for D-10's `transactionHostile` set and D-31's backfill shape.
- `.planning/research/PITFALLS.md` **§C** — C2 (how a gate becomes decorative through routine
  overriding) is the direct reasoning behind D-02, D-05 and D-17. Also §D (AI-agent-specific hazards)
  and the Pitfall-to-Phase Mapping.
- `.planning/research/ARCHITECTURE.md` — "Component Responsibilities" and "Pattern 1:
  Enforcement-point honesty"; the extraction seam D-27/D-28 preserve.
- `.planning/research/STACK.md` — `@testcontainers/postgresql` 12.1.0, `pg` as the Drizzle driver,
  `execa`, `vitest`, and the explicit "what NOT to use" list (drizzle-kit `--strict` as the safety
  system; `pg-mem` as a migration test database).
- `.planning/research/SUMMARY.md`.

### Existing code this phase builds on

- `packages/automation/src/index.ts` — the public barrel. `analyzeSql(sql, rules)`,
  `loadDefaultRules`, `enumerateMigrationFiles(migrationsDir, journalPath)`. The runner imports from
  here (D-01, D-23).
- `packages/automation/src/types.ts` — `StatementFacts` (where D-10's `transactionHostile` fact
  lands), `Verdict`, `Finding`, `AnalysisResult`, `AnalyzerParseError` (D-08), `EXIT_CODES`.
- `packages/automation/src/classifier/floor.ts` — the D-02 code floor D-17 joins and widens.
- `packages/automation/src/inspector/` — `inspect.ts`, `inspect-plpgsql.ts` (D-05 recursion, which
  D-17's nested coverage rides on).
- `packages/automation/src/adapter/drizzle-migrations.ts` — the journal enumerator, and the
  defaulted-parameter precedent D-23 mirrors.
- `packages/automation/test/corpus/` and `manifest.json` — the corpus D-17's new adversarial pair
  joins; `app-shaped/` holds the three fixtures D-30/D-31/D-32 turn into real changes; the manifest
  records that `0001_busy_thunderbolt.sql` is REVIEW_REQUIRED and why (D-07).
- `scripts/env.ts` — `assertLocalDevelopmentTarget`, `assertDevelopmentDatabase`, the pinned
  constants D-13 sits alongside, and the `QueryableClient` interface shape D-28 follows.
- `scripts/verify-migration-state.ts` — `assertMigrationHistoryApplied`, kept by D-29; also the
  narrow-scope, provable-in-both-directions module pattern the runner core should copy.
- `scripts/db-reset.ts` — currently calls `pnpm run db:migrate` then re-verifies; D-29 keeps that
  shape with the runner behind it.
- `scripts/drill.ts`, `tests/drill/restore-drill.test.ts`, `scripts/drill-status.ts`,
  `tests/drill-status.test.ts` — the working Testcontainers harness, harness-only-connection seam,
  and committed-status-file pattern D-22/D-23/D-24 all reuse.
- `scripts/log.ts` — `safeErrorMessage`, the single tested definition of "print only the error's own
  message". Every new entry point uses it.
- `tests/smoke.test.ts` — reused verbatim by D-26.
- `tests/guardrails.test.ts`, `tests/target-pin.test.ts` — where D-02's "no path reaches
  `drizzle-kit migrate`" assertion most naturally belongs.
- `apps/recipe-app/drizzle/`, `meta/_journal.json` — the real history D-25 derives both halves from.
- `apps/recipe-app/src/db/schema.ts` — edited for real in this phase (D-30/D-31/D-32), unlike Phase 3.
- `apps/recipe-app/src/db/seed.ts` — the NULL `timer_label` rows that make D-31 consequential.
- `vitest.config.ts`, `vitest.drill.config.ts` — the fast/slow split D-24's third config joins.
- `package.json` (root) — the `db:*` script naming convention `db:migrate:recover` follows.

</canonical_refs>

<code_context>
## Existing Code Insights

Phases 1–3 delivered a pinned local environment, a proven backup/restore path, and a classifier
that has never touched a database. Phase 4 connects the third to the first, and it is the first
phase in which `packages/automation` gains a component that *does* something rather than deciding
something.

### Reusable Assets

- **`analyzeSql` from `packages/automation`** — already importable, already pure, already accepts a
  SQL string rather than a path. D-01's "classify the buffer you are about to execute" needs no new
  API.
- **`enumerateMigrationFiles(migrationsDir, journalPath)`** — journal enumeration with both mismatch
  directions already hard-failing, and the defaulted-override signature D-23 copies.
- **`scripts/env.ts`** — `assertLocalDevelopmentTarget` (D-27's thin entry point), the pinned
  constants (D-13's home), `assertDevelopmentDatabase` (the D-21 marker check), and `QueryableClient`
  (the interface shape D-28 needs).
- **The drill harness** — `@testcontainers/postgresql` is installed and working, with the
  harness-constructs-the-connection seam already proven in `tests/drill/restore-drill.test.ts`.
  D-22/D-23 reuse the mechanism rather than inventing it.
- **`drill-status.ts` + its committed JSON + the cheap default-suite check** — the exact pattern
  D-24 needs for the history-test result.
- **`tests/smoke.test.ts`** — reused unchanged for RUN-07.
- **The app-shaped corpus fixtures** — three predictions already committed, so D-30/D-31/D-32 make
  real changes already knowing the expected verdict.

### Established Patterns

- **Architectural enforcement over remembered caution.** D-02 (no second migrate path), D-11 (mixed
  files refused), D-14 (timeouts at connect), D-17 (disarm on the floor) and D-28 (the package cannot
  connect) are this phase's five instances.
- **Hard-fail, never warn.** D-08, D-11, D-15, D-20 all follow `01-CONTEXT.md` D-20 and
  `02-CONTEXT.md` D-19/D-20.
- **Verify, don't trust the tool's own account of itself.** `assertMigrationHistoryApplied` exists
  because `drizzle-kit migrate` once exited zero without applying SQL; D-15 and D-29 apply the same
  scepticism to the new runner.
- **Modules split from entry points**, so a test can exercise them without side effects — D-27's core
  is the same move at package scale.
- **No command accepts a target; harnesses inject connections.** `01-CONTEXT.md` D-16 →
  `02-CONTEXT.md` D-06 → D-23 here.
- **Documentation is a deliverable** — D-33 follows `02-CONTEXT.md` D-10's runbook precedent.

### Integration Points

- **New:** the runner core in `packages/automation` (D-27), driver-free (D-28).
- **New:** `scripts/db-migrate.ts` (pinned entry point) and `db:migrate:recover` (D-21), both root
  `package.json` scripts following the `db:*` convention.
- **New:** a `test:history` vitest config and suite (D-24), plus a committed history-test status file.
- **New:** a runner-owned table in the development database (D-19).
- **Changed:** `db:migrate` stops being `drizzle-kit migrate` (D-02); `db:reset` inherits the gate
  with no edit to its own logic (D-29).
- **Changed in `packages/automation`:** a `transactionHostile` fact in the inspector (D-10), a
  timeout-disarm rule on the widened code floor (D-17), and the corpus/manifest entries and
  adversarial pair that prove both.
- **Changed in the app:** `apps/recipe-app/src/db/schema.ts` and two new migrations (D-30, D-31); a
  third generated, refused and reverted (D-32).
- **Consumed by Phase 5:** the run report (D-06/D-19) and the runner's refusal behaviour — CI gates
  on the report, and the same runner runs in CI.
- **Consumed by Phase 7:** the runner core as a second thin entry point (D-27), the runner-owned
  table as the audit-log substrate (D-19), and `db:migrate:recover` as the recovery path under
  pressure (D-21).

</code_context>

<specifics>
## Specific Ideas

- **"The classified bytes must be the executed bytes."** The single sentence behind D-01 and D-03 —
  a second read, or a second splitting rule, reopens the gap D12 exists to close.
- **A gate with a second door is not a gate.** D-02's reasoning, and the same objection
  `01-CONTEXT.md` D-14 raised against init scripts.
- **BLOCKED is the wall; making REVIEW REQUIRED a second wall weakens the first.** D-05's rationale —
  friction on the reviewable tier is what manufactures pressure for an override path, and the
  override arriving in Phase 4 instead of Phase 5 is the failure `PITFALLS.md` §C2 describes.
- **`0001` is a live specimen, not a defect.** It is the only REVIEW REQUIRED in real committed
  history, and every `db:reset` exercises it for free. Do not "fix" it.
- **Refusing mixed files means a half-applied file cannot exist.** D-11 turns RUN-08 from an open
  problem into exactly one named case — a failed `CREATE INDEX CONCURRENTLY` leaving an `INVALID`
  index.
- **A migration that turns off the timeouts is a rules file downgrading `DROP TABLE`.** Same shape,
  same answer: the floor. That is why D-17 widens the floor's definition rather than adding an
  unexplained member.
- **The runner sets the timeouts, then asks the server whether they took.** D-15 — this repo already
  has one recorded case of a tool succeeding without doing its job.
- **The recovery command reports; the operator decides.** D-21 — a safety tool that drops indexes on
  its own initiative has the wrong shape.
- **A migrations directory is not a database target.** D-23 records the distinction explicitly so the
  defaulted parameter is not later mistaken for the parameterisation `02-CONTEXT.md` D-06 forbade.
- **`timer_label` has real NULLs in the seed.** D-31 — the REVIEW REQUIRED demonstration is not just
  a classification; done naively it genuinely fails, which is a better lesson than a fixture.

</specifics>

<deferred>
## Deferred Ideas

- **A longer, separate `statement_timeout` for concurrent index builds.** D-16 declined it for lack
  of evidence. Revisit at **Phase 7**, when real data volumes make the number empirical rather than
  invented.
- **Automatic repair of an `INVALID` index left by a failed concurrent build.** D-20/D-21 declined to
  put destructive capability inside the safety tool. Revisit only if the manual path proves genuinely
  painful in practice.
- **`ALTER DATABASE ... SET` / `ALTER ROLE ... SET` as additional timeout-disarm vectors.** Noted
  during the timeout discussion, not settled. Either fold into D-17's rule during implementation or
  record explicitly as a known gap — do not leave it unstated.
- **`idle_in_transaction_session_timeout`.** Same connection-options mechanism as D-14, not discussed.
  Left to Claude's discretion for now; revisit if Phase 6/7 surfaces a need.
- **The `tags` table** (`01-CONTEXT.md` D-11's SAFE alternative) — unspent by D-30, still available as
  churn material for a later phase.
- **Expand-and-contract (APP-03)** — reserved for **Phase 7** by `01-CONTEXT.md` D-11's fourth row.
  Related: `03-CONTEXT.md`'s deferred "widen the classification window to the pending set", which is
  the same phase's problem.
- **Rules-file fingerprint carried in every verdict** — deferred by `03-CONTEXT.md` to **Phase 7**.
  Note that D-19's runner-owned table is now the obvious place to record it.
- **An approval/override path for REVIEW REQUIRED, with override logging and per-rule frequency
  counting** — **Phase 5 and Phase 7**, unchanged from `03-CONTEXT.md`. Explicitly not built here.
- **`eugene trace` lock verification** (ADV-01, v2) and **schema drift detection with committed
  `pg_dump --schema-only` snapshots** (ADV-02, Phase 7) — both unchanged.
- **Extending the smoke test to assert APP-02 columns** — declined by D-26 to keep it the stable
  reusable asset. If a later phase wants app-level schema assertions, they belong in a new test, not
  in that one.

</deferred>

---

*Phase: 4-Migration Runner & History Tests*
*Context gathered: 2026-09-08*
