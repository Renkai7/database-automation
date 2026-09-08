# Phase 4: Migration Runner & History Tests - Research

**Researched:** 2026-09-08
**Domain:** PostgreSQL migration execution engine (node-postgres driver, in-process re-classification, transaction/timeout policy) + Testcontainers-based migration-history proof
**Confidence:** HIGH — every load-bearing mechanism below was either read directly from installed source (`node_modules`) or verified live against the real pinned `postgres:17` dev container and the real installed `libpg-query@18.1.4` this session. No new external packages are introduced by this phase.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

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

**The execution engine**

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

**What the runner does with each verdict**

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

**Transactions**

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

**Timeouts**

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

**Partial failure and recovery**

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

**Proving it — the history tests**

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

**Where the runner lives**

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

**The real schema changes (APP-02)**

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

**Carried forward (binding, not re-decided here)**

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

### Deferred Ideas (OUT OF SCOPE)

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
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RUN-01 | The runner re-derives classification by parsing the actual SQL immediately before executing it, never trusting a verdict computed upstream | Pattern 1 (statement splitting), Pattern 3 (execution via the same buffer); `analyzeSql`'s existing pure-core contract is reused, not re-implemented. |
| RUN-02 | A BLOCKED classification is refused at execution with no override path | D-02 (no second migrate path) + D-17/floor.ts's `assertFloorNotWeakened` pattern extended for the new self-disarming rule; Pitfall 3 (don't reuse `EXIT_CODES` in a way that could blur BLOCKED with a "soft" outcome). |
| RUN-03 | Every migration execution is wrapped with `lock_timeout` and `statement_timeout` | Pattern 2 (`options` connect-time GUC application, verified live), D-15's `pg_settings`-based verification (Pitfall omitted for `SHOW`'s human formatting). |
| RUN-04 | Statements are not forced into a single transaction where doing so would break `CREATE INDEX CONCURRENTLY` and similar safe forms | Pattern 3 (explicit per-statement `client.query()`, never a whole-file query), Pattern 4 (the five new transaction-hostile AST shapes), Pitfall 1. |
| RUN-05 | An empty database plus the full migration history produces the expected schema, verified automatically | D-22/D-23's Testcontainers harness pattern (already proven in `tests/drill/`), Validation Architecture's `tests/history/empty-db-full-history.test.ts`. |
| RUN-06 | An existing database plus only the new migration applies cleanly, verified automatically | Code Examples' "is this migration new" comparison (verified against drizzle's own `dialect.js`), D-25's journal-minus-newest staging approach. |
| RUN-07 | The application starts successfully against the resulting schema | D-26, reusing `tests/smoke.test.ts` verbatim against the real pinned dev container after `db:reset`. |
| RUN-08 | A partially failed migration leaves a recoverable, clearly reported state — no silent journal manipulation | D-18/D-19/D-20's in-flight marker + runner-owned table pattern; Pitfall 4 (RESET ALL) and Pitfall 5 (canary-set maintenance) as adjacent correctness risks for the same subsystem. |
| APP-02 | The schema evolves through a sequence of real changes that exercise the SAFE, REVIEW REQUIRED, and BLOCKED paths | D-30/D-31/D-32's already-committed corpus fixtures (`recipes-add-notes-column.sql`, `steps-timer-label-set-not-null.sql`, `drop-ingredients-table.sql`) confirmed to match the real `schema.ts`/`seed.ts` state this session (seed's NULL `timer_label` rows verified present). |
</phase_requirements>

## Summary

Phase 4 does not need new libraries — it needs to compose four things that already exist and are
already proven in this repo: `analyzeSql` (Phase 3's pure classifier), `pg`'s `Client` (already the
project's Postgres driver), `@testcontainers/postgresql` (already proven in the Phase 2 drill
harness), and `scripts/env.ts`'s pinned-target/`QueryableClient` seam. This research is almost
entirely about the exact shapes and gotchas of composing those four things correctly, verified live
rather than assumed, because several of them are easy to get subtly wrong in ways that only surface
at runtime (Windows libuv crash on `process.exit()` after WASM parses; `SHOW` returning a
human-formatted timeout string instead of a comparable number; `libpg-query`'s statement-location
fields being silently discarded by the existing `parseTopLevel` wrapper; five previously-unhandled
AST node types the D-10/D-17 decisions require the inspector to learn).

Three findings are load-bearing and non-obvious enough to call out up front:

1. **`packages/automation`'s existing `parseTopLevel` throws away exactly the data D-03 needs.**
   `libpg-query`'s `parse()` return value carries `stmt_location`/`stmt_len` per top-level
   statement — verified live this session, this is precisely the AST-derived statement-boundary
   data D-03 calls for — but `inspect.ts`'s `parseTopLevel` (the only exported parse wrapper) maps
   the result down to bare `ParsedStatement` nodes and discards both fields before `analyzeSql` or
   the runner ever sees them. Statement splitting for execution needs a new function (or a changed
   contract) that preserves them; it is not sitting on the barrel already.
2. **The runner's exit-code contract is not `EXIT_CODES` from `types.ts`.** The analyzer's
   `EXIT_CODES.REVIEW_REQUIRED = 10` would make the runner's own D-06 contract ("exit 0 on success,
   including REVIEW_REQUIRED") impossible to express by reusing that enum directly — the runner
   needs its own, distinct set of process exit codes.
3. **`drizzle.__drizzle_migrations`'s `created_at` is the journal's `when` timestamp, not
   wall-clock time, and `hash` is `sha256(whole file text)`, not per-statement.** Read directly out
   of the installed `drizzle-orm@0.45.2` package. Getting either wrong breaks D-04's byte-compatibility
   promise silently — `drizzle-kit check`/`generate` would still run, but a future comparison against
   drizzle's own migrate() output would disagree.

**Primary recommendation:** Build the runner core as a small set of pure(ish) functions in
`packages/automation` — a statement splitter that preserves `stmt_location`/`stmt_len`, a
transaction-policy decision derived from the new `transactionHostile` fact, and a
byte-compatible `__drizzle_migrations` writer — orchestrated by a thin `scripts/db-migrate.ts` entry
point that owns the one `pg.Client` and the pinned-target assertion, exactly mirroring the
`scripts/env.ts` / `packages/automation` split already established in Phases 1–3.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Re-derive classification from the exact bytes about to run | `packages/automation` (pure core) | — | D-01/D-28: the package must not itself open a connection; `analyzeSql` is already pure and importable. |
| Statement splitting from AST locations | `packages/automation` (new module) | — | D-03: splitting must share the same parse that produced the verdict, not a second string-based rule. Belongs beside `analyze.ts`, not in the entry point. |
| Transaction/timeout policy decision (wrap vs. unwrap; refuse mixed files) | `packages/automation` (pure core) | — | D-09/D-11: derived from parsed facts (`transactionHostile`), not from the live connection. |
| Opening the one `pg.Client`, applying `options=-c ...`, verifying `SHOW`/`pg_settings` | `scripts/db-migrate.ts` (thin entry point) | — | D-27/D-28: the package cannot import `pg`; only the entry point may. |
| Pinned-target assertion (`assertLocalDevelopmentTarget`, `assertDevelopmentDatabase`) | `scripts/db-migrate.ts` (thin entry point) | `scripts/env.ts` (shared) | D-23 mirrors `db:backup`/`db:restore`'s existing pattern exactly. |
| Writing `drizzle.__drizzle_migrations` (byte-compatible) | `packages/automation` (pure logic) via injected `QueryableClient` | `scripts/db-migrate.ts` (executes it) | D-04/D-28: the SQL text and values are computed in the core; only the entry point's injected client actually sends them. |
| Runner-owned ledger table (in-flight marker, run report, failure state) | Development database (Postgres) | `packages/automation` (schema/DDL owner) | D-19: travels with the database; substrate for Phase 7's audit log. |
| History proof (empty DB + full history; existing DB + newest) | Test harness (`@testcontainers/postgresql`) | `packages/automation`/`scripts/db-migrate.ts` (the code under test) | D-22: Testcontainers gives genuine emptiness by construction; the pinned dev container cannot. |
| App-boot proof (RUN-07) | Real pinned dev container | `tests/smoke.test.ts` (reused verbatim) | D-26: the collision D-22 declined to solve by loosening the pin — app boot only runs against the real target. |

## Standard Stack

No new packages this phase. Everything the runner needs is already installed and already
version-verified in prior phases' research:

### Core (already installed, reused)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `pg` | 8.23.0 [VERIFIED: package.json] | The one driver the runner opens a connection through | Already the project's Postgres driver (Phase 1); supports the `options` startup parameter the runner needs for D-14 (verified live this session — see Code Examples). |
| `libpg-query` | 18.1.4 [VERIFIED: packages/automation/package.json] | Real Postgres AST — both the verdict and, newly, the statement boundaries | Already the analyzer's parser; D-03 reuses its `stmt_location`/`stmt_len` fields rather than adding a second SQL-splitting mechanism. |
| `@testcontainers/postgresql` | 12.1.0 [VERIFIED: package.json] | Genuinely-empty and pre-seeded Postgres instances for RUN-05/RUN-06 | Already proven end-to-end in `scripts/drill.ts`/`tests/drill/restore-drill.test.ts` (Phase 2); D-22/D-23 reuse the identical harness-constructs-the-connection pattern. |
| `vitest` | 5.0.0 [VERIFIED: package.json] | Test runner for `test:history` | Already the project's test runner; D-24 adds a third config (`vitest.history.config.ts`) alongside the existing `vitest.config.ts`/`vitest.drill.config.ts` pair. |
| `execa` | 10.0.1 [VERIFIED: package.json] | Spawning `drizzle-kit generate` for D-32's real BLOCKED-migration demonstration | Already the project's child-process wrapper (`scripts/db-reset.ts`, `scripts/drill.ts`). |
| `zod` | 4.5.4 [VERIFIED: package.json] | Schema-validating the runner-owned table's row shape and the run report, if a shape needs one | Already the project's validation library (`scripts/env.ts`, `scripts/drill-status.ts`, `packages/automation/src/classifier/rules-schema.ts`). |

### Installation

No `pnpm add` needed for this phase's core mechanism. If the runner-owned table's bootstrap needs a
committed schema definition (Claude's discretion, D-19), that can be plain SQL executed by the runner
itself at first run (`CREATE TABLE IF NOT EXISTS`), matching drizzle's own `dialect.js` bootstrap
pattern (see Code Examples) — no new dependency required either way.

### Alternatives Considered

Not applicable — CONTEXT.md's decisions (D-01 through D-29) already settled the make-vs-buy and
build-vs-wrap questions for this phase (rejecting `drizzle-kit migrate`, rejecting a
drizzle-migrator wrap, rejecting `pg-mem`). No open alternatives remain to research.

## Package Legitimacy Audit

**Not applicable this phase.** Phase 4 installs zero new external packages — it composes `pg`,
`libpg-query`, `@testcontainers/postgresql`, `vitest`, `execa`, and `zod`, all already installed and
already legitimacy-checked in Phases 1–3's research. If a plan later decides it needs a helper
package the discretion items don't obviously require (e.g., a CLI-arg parser for `db:migrate:recover`),
run `gsd-tools query package-legitimacy check` on it before adding it.

## Architecture Patterns

### System Architecture Diagram

```
                     ┌─────────────────────────────────────────────┐
                     │  scripts/db-migrate.ts  (thin entry point)   │
                     │  - assertLocalDevelopmentTarget(url)         │
                     │  - opens ONE pg.Client, options=-c ...       │
                     │  - assertDevelopmentDatabase(client)         │
                     │  - SELECT setting FROM pg_settings (D-15)    │
                     │  - checks runner-owned table for stale       │
                     │    in-flight marker BEFORE anything runs     │
                     └───────────────────┬───────────────────────────┘
                                         │ injects QueryableClient-shaped pg.Client
                                         ▼
        ┌───────────────────────────────────────────────────────────────────┐
        │            packages/automation  (pure core, no `pg` import)        │
        │                                                                     │
        │  enumerateMigrationFiles()                                         │
        │        │ MigrationFile[] { tag, idx, path, sql }                   │
        │        ▼                                                           │
        │  for each MigrationFile.sql:                                       │
        │     1. splitStatements(sql)  ──▶  [{ text, location, length }]     │◀── NEW: must be
        │        (libpg-query stmt_location/stmt_len, D-03)                  │    added — parseTopLevel
        │     2. analyzeSql(sql, rules) ──▶ AnalysisResult                   │    discards these today
        │        (same buffer, D-01 — the classified bytes ARE              │
        │         the split bytes, both come from the same parse)           │
        │     3. verdict === BLOCKED?  → refuse, exit non-zero, apply       │
        │        nothing further (D-02, no override)                        │
        │     4. any statement transactionHostile? (D-10, new fact)         │
        │        → file must be exactly one statement (D-11) or refuse      │
        │        naming the offending statement                            │
        │     5. wrap-or-not decision (D-09) → execute via injected client: │
        │        wrapped:  BEGIN; stmt; stmt; ...;                          │
        │                  INSERT INTO drizzle.__drizzle_migrations         │
        │                  (same txn, D-12); COMMIT                         │
        │        unwrapped: write in-flight marker (D-18); stmt (no BEGIN); │
        │                   INSERT ledger row; clear marker                 │
        └───────────────────────────────────────────────────────────────────┘
                                         │ writes
                                         ▼
                     ┌───────────────────────────────────────────────┐
                     │  Development Postgres (pinned or Testcontainers)│
                     │  - drizzle.__drizzle_migrations (D-04, untouched│
                     │    schema, byte-compatible hash/created_at)     │
                     │  - <runner-owned table> (D-19: in-flight marker,│
                     │    failure state, run report — NEW this phase) │
                     └───────────────────────────────────────────────┘

  RUN-05/06 harness (tests/history/*.test.ts):
     @testcontainers/postgresql → StartedPostgreSqlContainer
        │ (harness builds discrete host/port/user/pass — NEVER a connection string, D-23)
        ▼
     calls the SAME core functions above, injecting the container's client
        │
        ▼
     asserts resulting schema (table presence, or pg_dump --schema-only diff)

  RUN-07 (tests/smoke.test.ts, reused verbatim, D-26):
     pnpm db:reset (full teardown → db:migrate → db:seed) against the REAL pinned
     dev container → next dev server boots → smoke test hits it
```

### Recommended Project Structure

```
packages/automation/src/
├── runner/                       # NEW this phase — the D-27 pure core
│   ├── split-statements.ts       # D-03: stmt_location/stmt_len-based splitting
│   ├── transaction-policy.ts     # D-09/D-11: wrap-or-refuse decision from facts
│   ├── ledger.ts                 # D-04/D-12: drizzle-compatible hash/insert SQL builder
│   ├── runner-table.ts           # D-19: DDL + read/write helpers for the sidecar table
│   └── run-migrations.ts         # orchestrates the above against an injected QueryableClient
├── inspector/
│   └── inspect.ts                # EXTENDED: VacuumStmt, AlterSystemStmt, CreatedbStmt,
│                                  # ReindexStmt, VariableSetStmt branches (D-10/D-17)
├── classifier/
│   ├── floor.ts                  # EXTENDED: new D-17 floor facts + new D06 canaries
│   └── rules-schema.ts, classify.ts  # unchanged shape, new rule rows in rules.json
└── types.ts                      # EXTENDED: transactionHostile, disarmsTimeout facts;
                                   # possibly new StatementKind values (Vacuum/AlterSystem/
                                   # CreateDatabase/Reindex/SetGuc)

scripts/
├── db-migrate.ts                 # NEW — the pinned thin entry point (replaces
│                                  # `pnpm --filter recipe-app exec drizzle-kit migrate`)
├── db-migrate-recover.ts         # NEW — D-21's report-and-clear command
└── env.ts                        # unchanged; QueryableClient interface reused as-is

tests/history/                    # NEW — D-24's own suite, excluded from default vitest.config.ts
├── empty-db-full-history.test.ts # RUN-05
├── existing-db-newest-only.test.ts  # RUN-06
├── tamper-then-refuse.test.ts    # criterion 1 (D-23's temp migrations-dir mechanism)
└── blocked-replay.test.ts        # D-32's committed replay test

vitest.history.config.ts          # NEW — mirrors vitest.drill.config.ts, include tests/history/**
```

### Pattern 1: Reusing `libpg-query`'s own statement boundaries instead of splitting on `;`

**What:** `libpg-query`'s `parse()` result carries `stmt_location` (byte offset into the original
SQL string; **absent, not `0`, for the first statement**) and `stmt_len` (length **excluding** the
trailing statement delimiter) per entry in `stmts[]`.

**Verified live this session** against the installed `libpg-query@18.1.4`, parsing a 3-statement
file mixing a plain statement, an `ALTER TABLE`, a code comment, and a `CREATE INDEX CONCURRENTLY`:

```
[
  { "stmt_len": 23 },                          // first statement: no stmt_location key at all
  { "stmt_location": 25, "stmt_len": 31 },
  { "stmt_location": 69, "stmt_len": 39 }
]
```
Slicing `sql.slice(loc ?? 0, (loc ?? 0) + len)` for each entry recovered the exact statement text
for all three — including correctly excluding the comment between statements two and three from
both neighbors, and excluding the trailing semicolon from every statement.

**When to use:** This is the *only* correct way to satisfy D-03. Do not split on `;` (breaks on
`;` inside string/dollar-quoted literals, inside `DO $$ ... $$` bodies, inside comments) and do not
send the whole file as one `client.query()` call (see Pitfall 1 below).

**Gap to close:** `inspect.ts`'s exported `parseTopLevel(sql)` calls the same `parse()` but returns
only `entry.stmt`, discarding `stmt_location`/`stmt_len` before anything downstream can use them
(`packages/automation/src/inspector/inspect.ts:87-94`, read this session). A new function is
needed — either a second export from a new `runner/split-statements.ts` that calls `libpg-query`'s
`parse()` directly, or a changed `parseTopLevel` return shape both `analyze.ts` and the new splitter
consume. Building it as a **separate, small function that calls `parse()` a second time on the same
buffer** is architecturally clean (keeps `analyzeSql`'s existing contract untouched, avoids touching
every call site that destructures `ParsedStatement`) and costs one extra WASM parse per migration
file — negligible at migration-file volumes. Whichever shape is chosen, D-01's core property still
holds: both the verdict and the split come from parsing the *exact same bytes*.

```typescript
// Illustrative shape only — not existing code. Source for the underlying fields:
// libpg-query@18.1.4 parse() result, verified directly against the installed package this session.
export interface SplitStatement {
  text: string;      // sql.slice(location, location + length) -- excludes delimiter
  location: number;  // byte offset into the original file text
  length: number;
}

export async function splitStatements(sql: string): Promise<SplitStatement[]> {
  const result = await parse(sql); // same libpg-query.parse() analyzeSql's parseTopLevel calls
  return (result.stmts ?? []).map((entry) => {
    const location = entry.stmt_location ?? 0;
    const length = entry.stmt_len ?? sql.length - location;
    return { text: sql.slice(location, location + length), location, length };
  });
}
```

### Pattern 2: `pg`'s `options` connection parameter for D-14's connect-time timeouts

**What:** `pg`'s `Client`/`connection-parameters.js` accepts an `options` config key
[VERIFIED: `node_modules/pg/lib/connection-parameters.js:83,151`, read this session] and forwards
it as the libpq `options` startup-packet parameter, which PostgreSQL interprets as
command-line-style `-c NAME=VALUE` GUC assignments
[CITED: postgresql.org/docs/current/libpq-connect.html — "Sets command-line options to send to the
server at connection start... most commonly used to set command-line options for run-time
parameters via the `-c` option"; multiple settings separate with spaces, e.g.
`options=-c search_path=myschema -c statement_timeout=30000`].

**Verified live this session**, end to end, against the real pinned `postgres:17` dev container:

```typescript
import { Client } from "pg";
const client = new Client({
  connectionString: url, // the pinned RECIPE_DEV_DATABASE_URL
  options: "-c lock_timeout=3000 -c statement_timeout=30000",
});
await client.connect();
// SELECT name, setting, unit FROM pg_settings WHERE name IN ('lock_timeout','statement_timeout')
// returned: [{name:"lock_timeout", setting:"3000", unit:"ms"}, {name:"statement_timeout", setting:"30000", unit:"ms"}]
```
This is the exact mechanism D-14 specifies (connection options, not `SET`/`SET LOCAL` issued after
connect) and it is confirmed working with this exact driver version against this exact server
version — no fallback needed.

**D-15's verification gotcha, verified live this session:** `SHOW lock_timeout` returns a
human-formatted string (`"3s"`, `"30s"`), not the raw millisecond integer — confirmed against the
real dev container (`SET lock_timeout='3000ms'; SHOW lock_timeout;` → `3s`). Use
`SELECT setting FROM pg_settings WHERE name = 'lock_timeout'` instead: it returns the raw stored
value in the unit named by `pg_settings.unit` (`"ms"` for both timeout GUCs), verified live as
`"3000"`/`"30000"` for the values above — directly comparable to the pinned constants without
parsing a unit suffix.

### Pattern 3: Transaction wrapping via explicit `BEGIN`/`COMMIT` queries, never `client.query()` on the whole file

**What:** `pg`'s `Client.query(text)` with a plain string (no `name`, no `values`, no
`queryMode: 'extended'`) takes the **simple query protocol** path
[VERIFIED: `node_modules/pg/lib/query.js:35-41,163,180`, read this session]. PostgreSQL's simple
query protocol treats a multi-statement string as one implicit transaction block: if any statement
fails, none of the preceding statements in that same message are committed, and execution stops at
the first error [CITED: postgresql.org/docs/current/protocol-flow.html §"Multiple Statements in a
Simple Query"]. This is exactly why D-03 rejected sending the whole file as one query — it silently
reintroduces forced-transaction-wrapping and destroys per-statement failure reporting even for a
single `client.query(wholeFileText)` call, independent of anything drizzle does.

**The correct pattern**, verified live this session against the real dev container:

```typescript
// Wrapped path (D-09 default): issue BEGIN, then ONE client.query() call PER split statement
// (never per file, never per multi-statement string), then the ledger insert, then COMMIT.
await client.query("BEGIN");
for (const stmt of splitStatements) {
  await client.query(stmt.text); // one statement per call -- simple query protocol, single statement
}
await client.query(ledgerInsertSql); // D-12: same transaction
await client.query("COMMIT");
```
```typescript
// Unwrapped path (D-09 exception, D-11's single-statement guarantee):
// no BEGIN at all -- each client.query() call is its own implicit single-statement transaction.
await client.query(stmt.text); // e.g. CREATE INDEX CONCURRENTLY ...
await client.query(ledgerInsertSql); // separate implicit transaction, per D-18's in-flight marker need
```

**Verified live this session**, reproducing the exact server-side restriction:
```
client.query("BEGIN"); client.query("CREATE INDEX CONCURRENTLY idx ON t(c)");
  → error: CREATE INDEX CONCURRENTLY cannot run inside a transaction block
client.query("CREATE INDEX CONCURRENTLY idx2 ON t(c)");  // no explicit BEGIN
  → succeeds
```
This is the concrete proof that D-09's auto-unwrap-when-`transactionHostile` decision is not just
correct in principle but mechanically necessary with this exact driver against this exact server —
and that the runner's own explicit `BEGIN`/`COMMIT` calls (not `pg`'s built-in `client.query()`
transaction helpers, which don't exist as a separate API surface here — it's plain queries) are the
right level of control.

### Pattern 4: The five new AST node shapes D-10 and D-17 require the inspector to learn

`inspect.ts` currently dispatches on top-level node-type keys with an explicit `if ("X" in stmt)`
chain [VERIFIED: `packages/automation/src/inspector/inspect.ts:423-449`, read this session] and
falls through to `Unrecognized` for anything not named. **None of the five statement kinds D-10's
`transactionHostile` fact needs, and D-17's disarm rule needs, currently have a branch** — they all
currently resolve to `Unrecognized` (REVIEW_REQUIRED via D-06's default), not to a specifically-named
kind carrying the new fact. Every shape below was parsed live against the installed
`libpg-query@18.1.4` this session:

```typescript
// VACUUM ANALYZE recipes;
{ VacuumStmt: { options: [...], rels: [{ VacuumRelation: { relation: { relname: "recipes", ... } } }], is_vacuumcmd: true } }

// ALTER SYSTEM SET statement_timeout = 0;
{ AlterSystemStmt: { setstmt: { kind: "VAR_SET_VALUE", name: "statement_timeout", args: [...] } } }

// CREATE DATABASE foo;
{ CreatedbStmt: { dbname: "foo" } }

// REINDEX INDEX CONCURRENTLY idx_a;   (transaction-hostile)
{ ReindexStmt: { kind: "REINDEX_OBJECT_INDEX", relation: {...}, params: [{ DefElem: { defname: "concurrently", ... } }] } }
// REINDEX INDEX idx_a;   (plain -- NOT transaction-hostile; no "concurrently" DefElem in params)
{ ReindexStmt: { kind: "REINDEX_OBJECT_INDEX", relation: {...} } }  // params absent entirely

// SET lock_timeout = '0';         -- disarms
{ VariableSetStmt: { kind: "VAR_SET_VALUE", name: "lock_timeout", args: [...] } }
// SET LOCAL statement_timeout = 0;  -- is_local:true, still disarms for the session's remaining txn
{ VariableSetStmt: { kind: "VAR_SET_VALUE", name: "statement_timeout", is_local: true, args: [...] } }
// SET lock_timeout TO DEFAULT;    -- ALSO disarms (default is 0 = disabled)
{ VariableSetStmt: { kind: "VAR_SET_DEFAULT", name: "lock_timeout" } }
// RESET lock_timeout;             -- ALSO disarms
{ VariableSetStmt: { kind: "VAR_RESET", name: "lock_timeout" } }
// RESET ALL;                      -- ALSO disarms EVERYTHING, but carries NO `name` field at all
{ VariableSetStmt: { kind: "VAR_RESET_ALL" } }

// ALTER DATABASE recipe_dev SET statement_timeout = 0;   -- deferred discretion item, confirmed distinct node
{ AlterDatabaseSetStmt: { dbname: "recipe_dev", setstmt: { kind: "VAR_SET_VALUE", name: "statement_timeout", ... } } }
// ALTER ROLE recipe_app SET lock_timeout = 0;             -- deferred discretion item, confirmed distinct node
{ AlterRoleSetStmt: { role: {...}, setstmt: { kind: "VAR_SET_VALUE", name: "lock_timeout", ... } } }
```

**Implication for D-17's rule:** matching only `VariableSetStmt` where `name` equals
`"lock_timeout"` or `"statement_timeout"` **misses `RESET ALL`**, which disarms both GUCs (and
every other session GUC) but carries no `name` field to match on at all. The inspector's
`VariableSetStmt` branch needs to treat `kind: "VAR_RESET_ALL"` as unconditionally disarming,
independent of the name-matching logic used for the other four `kind` values.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Statement boundary detection | A semicolon-splitting regex, even a "smart" one that tracks quote/comment state | `libpg-query`'s `stmt_location`/`stmt_len` (Pattern 1) | Already the real Postgres grammar's own statement boundaries; a hand-rolled splitter reintroduces exactly the dollar-quote/comment/embedded-`;` fragility D-10 in Phase 3 already fought and fixed once. |
| Deciding whether a statement can run in a transaction | A hardcoded keyword list (`"CONCURRENTLY"`, `"VACUUM"`, ...) checked against the raw SQL text | The `transactionHostile` StatementFacts field, set once per AST node type in the inspector | Matches this project's own established principle (D-10's rationale): "a second place that reasons about SQL semantics... drifting from the analyzer's vocabulary." A runner-local keyword list is the exact split `03-CONTEXT.md`'s pure-core seam forbids. |
| Verifying a GUC took effect | Regex-parsing `SHOW lock_timeout`'s human-formatted output (`"3s"`) | `SELECT setting FROM pg_settings WHERE name = ...` (raw ms integer, verified live) | `SHOW`'s output format is for humans and is unit-suffixed inconsistently (`"3s"` vs `"500ms"` vs bare `"0"`); `pg_settings.setting` is the machine-comparable value the GUC subsystem itself stores. |
| Deciding which migrations are "new" against an existing database | Comparing filenames or re-implementing drizzle's own newest-timestamp logic from scratch | The journal's own `idx`/`when` fields, already exposed by `enumerateMigrationFiles` | The exact comparison drizzle's own `dialect.js` uses (`lastDbMigration.created_at < migration.folderMillis`) is now a verified reference implementation (see Code Examples) — reuse the shape rather than re-deriving it from first principles. |
| Manufacturing a competing lock for criterion 2's slow-lock test | A `pg_sleep()`-based fake or a mocked client | A second real `pg.Client` that opens its own transaction and takes a real conflicting lock (`LOCK TABLE ... IN ACCESS EXCLUSIVE MODE`, left uncommitted) on the same table the migration under test targets | This is what actually exercises `lock_timeout` against a real competing lock rather than a sleep that exercises `statement_timeout` on an unrelated code path — the two GUCs guard different failure modes and criterion 2 asks specifically about `lock_timeout`. |

**Key insight:** every "don't hand-roll" item above already has a working reference implementation
somewhere in this repo or in `node_modules` — the discipline this phase needs is finding and reusing
that reference (as this research did), not re-deriving the mechanism from general Postgres knowledge.

## Common Pitfalls

### Pitfall 1: Sending the whole migration file as one `client.query()` call quietly reintroduces forced transaction wrapping

**What goes wrong:** Even without drizzle's migrator involved at all, calling
`client.query(entireFileText)` once (rather than once per split statement) puts every statement in
that file under PostgreSQL's own simple-query-protocol implicit transaction — `CREATE INDEX
CONCURRENTLY` fails with the same "cannot run inside a transaction block" error as if it had been
explicitly wrapped in `BEGIN`/`COMMIT`.
**Why it happens:** It looks like "one query, no transaction," but the server-side behavior is
identical to explicit wrapping for a multi-statement message [CITED: postgresql.org protocol-flow.html].
**How to avoid:** Always call `client.query()` once per statement from the D-03 split, never once
per file.
**Warning signs:** A test with a `CREATE INDEX CONCURRENTLY` fixture fails with the exact error
message above even though the runner code has no visible `BEGIN`.

### Pitfall 2: Calling `process.exit()` after `libpg-query` WASM parses, on Windows

**What goes wrong:** `packages/automation/src/cli.ts`'s own header comment records a **reproduced,
live** Windows libuv crash (`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`, raw exit code
`3221226505`) from calling `process.exit()` synchronously right after two or more `libpg-query`
parse calls in one process [VERIFIED: `packages/automation/src/cli.ts:16-23`, read this session].
The runner will call `analyzeSql` (which parses) once per migration file, potentially several times
per invocation — the exact pattern that triggered the crash.
**Why it happens:** Forcing the process closed while libuv is still tearing down a WASM module's own
async handle races the WASM runtime's own cleanup.
**How to avoid:** Copy the existing pattern exactly: a `run(): Promise<number>` that never calls
`process.exit()`, with `process.exitCode = code` set once at the very end and the event loop let
drain naturally.
**Warning signs:** A `db:migrate` invocation that runs correctly under `node`/`tsx` directly but
crashes with an unrecognizable exit code specifically on Windows CI or a Windows dev machine, and
specifically when more than one migration file is processed in the same run.

### Pitfall 3: Reusing `EXIT_CODES` from `packages/automation`'s `types.ts` for the runner's own process exit code

**What goes wrong:** `EXIT_CODES.REVIEW_REQUIRED` is `10` — a non-zero code. D-06 requires the
runner to **exit 0** when it successfully applied a REVIEW_REQUIRED migration (report loudly,
proceed locally). Reusing the analyzer's enum directly for the runner's own process exit would
violate D-06 by construction.
**Why it happens:** The two contracts look similar (both are "what verdict happened") but answer
different questions — the analyzer's exit code communicates a *verdict*; the runner's exit code
communicates *whether the run succeeded at doing what it was allowed to do*.
**How to avoid:** Define a separate, small exit-code set for the runner (or simply 0/non-zero plus
the machine-readable report D-06 requires), never importing `EXIT_CODES` for this purpose.
**Warning signs:** `pnpm db:reset`'s CR-02-era post-check (`assertMigrationHistoryApplied`) starts
failing intermittently on a database whose committed history includes `0001_busy_thunderbolt.sql`
(the real, intentional REVIEW_REQUIRED migration, D-07) because the migrate step now exits non-zero
on a migration that actually applied successfully.

### Pitfall 4: `RESET ALL` disarming the timeout GUCs with no `name` field to match on

**What goes wrong:** A D-17 rule written to match `VariableSetStmt` entries where `name` is
`"lock_timeout"` or `"statement_timeout"` will not fire for `RESET ALL;`, which resets every
session GUC — including both timeouts — back to their defaults (`0` = disabled), but whose AST node
carries no `name` field at all (`kind: "VAR_RESET_ALL"`, verified live this session).
**Why it happens:** `RESET ALL` is a distinct `VariableSetStmt.kind` value from `VAR_RESET`, and its
whole point is "reset everything," so PostgreSQL's own grammar gives it no per-GUC name to inspect.
**How to avoid:** Treat `kind === "VAR_RESET_ALL"` as unconditionally disarming in the inspector,
independent of the name-based matching used for `VAR_SET_VALUE`/`VAR_SET_DEFAULT`/`VAR_RESET`.
**Warning signs:** An adversarial fixture for `RESET ALL` classifies something other than BLOCKED
even after the D-17 floor rule ships for the four named-GUC forms.

### Pitfall 5: Forgetting to extend `D06_UNMATCHED_CANARY_FACTS` when adding the two new StatementFacts fields

**What goes wrong:** `floor.ts`'s `assertUnmatchedDefaultsToReview` self-check is deliberately
extended, by convention, with one new canary entry per new boolean/enum field added to
`StatementFacts` [VERIFIED: `packages/automation/src/classifier/floor.ts:94-136`, read this
session — the file's own comment states this explicitly: "any rule broad enough to achieve...
enumerates every value of some other small-domain field... necessarily matches at least one of
these canaries"]. Adding `transactionHostile`/`disarmsTimeout` (or equivalent) to `StatementFacts`
without adding matching canary rows (`{ ...EMPTY_FACTS, statementKind: "Unrecognized",
transactionHostile: true }`, etc.) silently reopens the exact enumeration-based blanket-SAFE
exploit `03-VERIFICATION.md`'s gap closure already fixed once for every *other* field.
**Why it happens:** The self-check is not automatically derived from `StatementFacts`'s type
definition — it is a hand-maintained list, by design (so it can be audited), which means it can also
be forgotten.
**How to avoid:** Any task that adds a field to `StatementFacts` must add its canary row(s) to
`D06_UNMATCHED_CANARY_FACTS` in the same change, and should assert this via a test that walks
`Object.keys(EMPTY_FACTS)` against the canary set's field coverage.
**Warning signs:** None visible at ship time — this is a latent gap that only a targeted adversarial
test (or a future incident) would surface, exactly the shape of bug this repo's own commit history
(the CR-01/gap-closure entries in STATE.md) shows has happened before with this exact mechanism.

## Code Examples

### Byte-compatible `drizzle.__drizzle_migrations` writer (D-04)

```javascript
// Source: node_modules/.pnpm/drizzle-orm@0.45.2.../drizzle-orm/pg-core/dialect.js:44-72
// AND node_modules/.pnpm/drizzle-orm@0.45.2.../drizzle-orm/migrator.js:1-30
// (both read directly this session -- this is drizzle's own migrate() implementation, not a
// paraphrase). The runner must replicate this table shape and hashing scheme exactly, not
// approximate it, per D-04.

// 1. Table shape (created once, IF NOT EXISTS, in schema "drizzle"):
//    CREATE SCHEMA IF NOT EXISTS drizzle;
//    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
//      id SERIAL PRIMARY KEY,
//      hash text NOT NULL,
//      created_at bigint
//    );

// 2. Hash: sha256 hex digest of the WHOLE migration file's raw text (not per-statement, not
//    the split statements re-joined -- the literal bytes read from the .sql file):
import crypto from "node:crypto";
const hash = crypto.createHash("sha256").update(rawFileText).digest("hex");

// 3. created_at: the JOURNAL ENTRY's `when` field (folderMillis) -- NOT Date.now(), NOT the
//    actual execution wall-clock time. This is what drizzle-kit's own generate step embeds
//    into _journal.json and what its migrate()/check() compare against.
//    insert into drizzle.__drizzle_migrations ("hash", "created_at") values ($1, $2)
//    -- values: [hash, journalEntry.when]

// 4. "Is this migration new?" comparison drizzle itself uses (replicate this, don't invent a
//    different rule): the most recent row's created_at, compared against each candidate
//    migration's own journal `when`:
//    if (!lastDbMigration || Number(lastDbMigration.created_at) < migration.folderMillis) {
//      /* apply it */
//    }
```

### Manufacturing a real competing lock for criterion 2 (illustrative pattern, not existing code)

```typescript
// A second, independent pg.Client opens its own uncommitted transaction and takes a real
// conflicting lock on the same table/row the migration under test needs -- this is what
// actually exercises lock_timeout rather than statement_timeout or a sleep.
const blocker = new Client({ connectionString: testDbUrl });
await blocker.connect();
await blocker.query("BEGIN");
await blocker.query("LOCK TABLE recipes IN ACCESS EXCLUSIVE MODE");
// (left open, uncommitted, on purpose)

// The runner, in a separate connection with lock_timeout=3000 applied via `options` (Pattern 2),
// attempts a migration needing a conflicting lock on `recipes` (e.g. ADD COLUMN with a volatile
// default, or any ALTER TABLE): it must fail with a lock_timeout error within ~3s, not hang.

await blocker.query("ROLLBACK"); // release the lock afterward
await blocker.end();
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `drizzle-kit migrate` as the migration executor | A custom runner that re-classifies the exact bytes immediately before executing (this phase) | This phase, per D-01/D-02 | `drizzle-kit migrate` becomes structurally unreachable from any script or code path in this repo — a test must assert this (D-02). `drizzle-kit generate`/`check` remain in use unchanged. |
| Trusting a tool's exit code as proof of what it did | Independently re-querying the database after any tool claims success | Established in Phase 1 (`assertMigrationHistoryApplied`, built because `drizzle-kit migrate` was observed exiting zero on Windows without applying SQL) | D-15 (verify timeouts took effect) and D-29 (keep `assertMigrationHistoryApplied` after the new runner replaces `drizzle-kit migrate`) both apply this same established project precedent to new code, not a new principle. |

**Deprecated/outdated:** Nothing in this phase's dependency set is deprecated. `libpg-query`'s
pg13–pg17 dist-tag lines remain parse-only (no `parsePlPgSQL`); this repo is already, deliberately,
on the pg18-line default per Phase 3's D-05 (see `.claude/CLAUDE.md`'s Version Compatibility table).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The runner-owned table's exact name/columns and how it is created on a database that has never seen it (left to Claude's discretion per CONTEXT.md) — this research assumes a plain `CREATE TABLE IF NOT EXISTS` executed by the runner itself at first run is sufficient, mirroring drizzle's own bootstrap pattern, rather than requiring its own Drizzle-generated migration. | Architecture Patterns, Code Examples | If wrong, the table might need to be created via a committed migration instead (making it visible to `drizzle-kit check`, which might be desirable) — a planning decision, not a technical blocker either way. |
| A2 | `ALTER DATABASE ... SET` / `ALTER ROLE ... SET` are explicitly deferred in CONTEXT.md as an open discretion item; this research confirms both are distinct, real AST node types (`AlterDatabaseSetStmt`, `AlterRoleSetStmt`) wrapping the same `setstmt` shape as `VariableSetStmt`, but does not decide whether D-17 should cover them. | Architecture Patterns Pattern 4 | If the planner decides not to cover them and a migration later uses either form to disarm the timeouts at the database/role level (persisting across sessions, not just within the migration's own connection), the floor would not catch it. Low risk this phase (dev-only, disposable database) but worth flagging for the Phase 7 production runner. |
| A3 | Manufacturing the criterion-2 competing lock via a second `pg.Client` holding an uncommitted `LOCK TABLE ... ACCESS EXCLUSIVE` is the standard, reliable technique — not verified against this repo's own eventual test file (does not exist yet), only reasoned from general Postgres locking semantics. | Code Examples | Low risk — this is a well-established testing pattern (used by e.g. the `eugene` tool's own test suite per its public design, and reasoned from documented Postgres lock modes) but was not independently re-verified live this session against a fixture resembling the recipe schema's actual column types. |

## Open Questions

1. **Where does `splitStatements` live, and does `analyzeSql` change shape to expose it, or does the runner call `libpg-query`'s `parse()` a second time?**
   - What we know: `stmt_location`/`stmt_len` are present on the raw `parse()` result and are
     currently discarded by `parseTopLevel`. Either approach is architecturally sound.
   - What's unclear: Whether re-parsing twice per migration file (once via `analyzeSql`, once via a
     new splitter) is acceptable, or whether `AnalysisResult`/`Finding` should be extended to carry
     `{ location, length }` per top-level `statementIndex` so a single parse serves both needs.
   - Recommendation: Re-parsing twice is simpler, touches zero existing call sites, and the perf
     cost (one extra WASM parse per migration file, files typically under a few KB) is negligible —
     recommend this unless the plan has a specific reason to unify the two parses.

2. **Exact shape of the runner's own exit-code / run-report contract (D-06's discretion item).**
   - What we know: Exit 0 on success (including REVIEW_REQUIRED-applied migrations); the report is
     "always complete, never a summary"; consumed by Phase 5's CI and Phase 7's audit log.
   - What's unclear: The precise JSON field names/shape.
   - Recommendation: Model it closely on `AnalysisResult`/`Finding`'s existing shape (per-migration
     verdict, complete findings, ruleIds, rationales) plus timing and the wrap/unwrap decision, since
     Phase 5 will need to render exactly the same kind of "complete, never summarized" data the CLI
     already renders for the analyzer alone.

3. **Whether the runner-owned table's DDL should be a committed Drizzle migration or runtime-bootstrapped DDL.**
   - What we know: D-19 requires it to be in-database, separate from `__drizzle_migrations`, and the
     eventual Phase 7 audit-log substrate.
   - What's unclear: Whether making it a normal committed migration (visible to `drizzle-kit
     check`/`generate`, appearing in the journal like any other schema change) is preferable to the
     runner creating it imperatively on first connect.
   - Recommendation: A committed migration is more consistent with this project's "documentation and
     visible history" values (STATE.md's repeated emphasis on `_journal.json` as the audit
     mechanism) — but either satisfies D-19's literal requirements. Flag for the plan-checker rather
     than pre-deciding.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker Desktop (Windows, WSL2 backend) | `@testcontainers/postgresql` for RUN-05/RUN-06 | ✓ [VERIFIED: `docker compose ps` succeeded this session against the running dev container] | Not separately queried this session, but already proven working for the Phase 2 drill harness on this exact machine | — |
| `postgres:17` Docker image | RUN-05/RUN-06 Testcontainers instances; the pinned dev container | ✓ [VERIFIED: `docker compose ps` shows `database-automation-db-1` running `postgres:17`, healthy, this session] | 17 (Debian variant, matching `01-CONTEXT.md` D-12/`02-CONTEXT.md`'s drill image choice) | — |
| `pg` driver's `options` startup parameter support | D-14's connect-time timeout mechanism | ✓ [VERIFIED live this session: connected with `options: "-c lock_timeout=3000 -c statement_timeout=30000"` and confirmed via `pg_settings`] | 8.23.0 | — |
| `libpg-query`'s `stmt_location`/`stmt_len` fields | D-03's statement splitting | ✓ [VERIFIED live this session against `libpg-query@18.1.4`] | 18.1.4 | — |
| Node.js `process.exitCode` (non-forcing exit) | Avoiding the Windows libuv WASM crash (Pitfall 2) | ✓ (already the established pattern in `cli.ts`, Node 24.19.0 per `.claude/CLAUDE.md`) | 24.19.0 | — |

**Missing dependencies with no fallback:** None identified.

**Missing dependencies with fallback:** None identified — every dependency this phase needs was
already installed and already proven working in this exact environment before this research began.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 5.0.0 [VERIFIED: package.json] |
| Config files | `vitest.config.ts` (default, fast suite); `vitest.drill.config.ts` (existing, Docker-dependent drill suite); `vitest.history.config.ts` — **new this phase**, mirroring `vitest.drill.config.ts`'s shape exactly (D-24) |
| Quick run command | `pnpm test` (excludes `tests/drill/**` and, once added, `tests/history/**`; runs the cheap D-24 status-file assertion instead) |
| Full suite command | `pnpm test:history` (new script, `vitest run --config vitest.history.config.ts`) — Docker-dependent, slow, mirrors existing `pnpm test:drill` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RUN-01 | Tamper-then-refuse: a migration classified SAFE upstream but altered to BLOCKED afterward is still refused at execution | integration | `pnpm exec vitest run tests/history/tamper-then-refuse.test.ts` | ❌ Wave 0 |
| RUN-02 | BLOCKED refused with no override path (no flag/env/config) | unit + integration | `pnpm exec vitest run packages/automation/test/` (unit: no override surface exists) + the runner's own integration test | ❌ Wave 0 (new runner unit tests) |
| RUN-03 | Every migration runs under `lock_timeout`/`statement_timeout`; a slow-locking migration times out cleanly | integration | new test manufacturing a competing lock (Code Examples pattern) | ❌ Wave 0 |
| RUN-04 | `CREATE INDEX CONCURRENTLY` still succeeds (statements not force-wrapped) | integration | same suite as RUN-03, positive case | ❌ Wave 0 |
| RUN-05 | Empty database + full history → expected schema | integration (Testcontainers) | `pnpm exec vitest run tests/history/empty-db-full-history.test.ts` | ❌ Wave 0 |
| RUN-06 | Existing database + newest migration only → applies cleanly | integration (Testcontainers) | `pnpm exec vitest run tests/history/existing-db-newest-only.test.ts` | ❌ Wave 0 |
| RUN-07 | App boots against the resulting schema | smoke (reused verbatim) | `pnpm exec vitest run tests/smoke.test.ts` (after `pnpm db:reset`, D-26) | ✓ (existing file, D-08 built it for this) |
| RUN-08 | Partial failure is reported clearly, recoverable without hand-editing `_journal.json` | integration | new test exercising the in-flight-marker/stale-marker path (D-18/D-20) plus `db:migrate:recover` | ❌ Wave 0 |
| APP-02 | Real SAFE / REVIEW REQUIRED / BLOCKED schema changes through the runner | manual-run + committed replay test (BLOCKED only, D-32) | `pnpm exec vitest run tests/history/blocked-replay.test.ts` for the BLOCKED half; SAFE/REVIEW REQUIRED are demonstrated by a real, once-run `pnpm db:migrate` invocation recorded in D-33's docs | Partial — BLOCKED replay ❌ Wave 0; SAFE/REVIEW REQUIRED are one-time, documented, not perpetually re-asserted (matches D-26's precedent of not perpetually re-testing every historical migration) |

### Sampling Rate
- **Per task commit:** `pnpm test` (fast suite; includes the D-24 cheap status-file check once the history suite has run at least once)
- **Per wave merge:** `pnpm test:history` (Testcontainers-backed, slow) plus `pnpm test:drill` (unaffected by this phase but shares Docker infrastructure — worth a sanity run if Docker resource limits are tight)
- **Phase gate:** Both `pnpm test` and `pnpm test:history` green, plus a real (non-automated, manually observed and documented per D-33) run of the SAFE/REVIEW REQUIRED/BLOCKED demonstrations, before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `vitest.history.config.ts` — new config, mirrors `vitest.drill.config.ts`
- [ ] `tests/history/` directory + its four test files listed above
- [ ] `vitest.config.ts`'s `exclude` array needs `tests/history/**` added, mirroring the existing `tests/drill/**` exclusion
- [ ] A committed history-test status file (D-24's own fact, separate from `docs/restore-drill-status.json`) plus its own read/write module, mirroring `scripts/drill-status.ts`'s shape
- [ ] Framework install: none — vitest is already installed

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture, Design and Threat Modeling | yes | This entire phase *is* an architectural control (D12): re-derive classification at the one point that cannot be bypassed from inside the system. No control here should ever be described as "the agent will remember to check" — every gate must be a structural refusal (D-02's no-second-path test, D-11's mixed-file refusal, D-14's connect-time-not-post-connect timeouts). |
| V2 Authentication | no | No new authentication surface — the runner connects using the same pinned, already-validated `RECIPE_DEV_DATABASE_URL` every other local script uses. |
| V3 Session Management | no | N/A — no user sessions; a single short-lived `pg.Client` connection per invocation. |
| V4 Access Control | no | N/A this phase — CONN-05 (separate runtime vs. migration credentials) is explicitly Phase 6's requirement, not this phase's. |
| V5 Input Validation | yes | Migration SQL is untrusted input (an AI agent writes it) — the analyzer's `libpg-query`-based parsing (never regex) is the control, already built in Phase 3 and reused, not re-implemented, here. |
| V6 Cryptography | no | N/A — no new cryptographic material this phase (the `__drizzle_migrations.hash` column is an integrity check, not a security boundary; `sha256` is drizzle's own established scheme, reused for compatibility, not chosen fresh here). |
| V7 Error Handling and Logging | yes | `safeErrorMessage` (never print a raw error object, only `.message`) is the established pattern (`scripts/log.ts`) and must be reused by every new entry point (`scripts/db-migrate.ts`, `scripts/db-migrate-recover.ts`) — never a bespoke error-printing path that might interpolate a connection string or password. |
| V14 Configuration | yes | `lock_timeout`/`statement_timeout` as pinned source constants (D-13), applied at connect time (D-14) and verified after connect (D-15) — configuration-as-code, not environment-variable-tunable, per this project's established non-negotiable ("prefer architectural enforcement over remembered caution"). |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| A migration disarms its own safety rail (`SET lock_timeout = 0` or equivalent) to force an otherwise-refused operation through unbounded | Tampering / Elevation of Privilege | D-17's widened code floor: any rule that would grant a non-BLOCKED verdict to a `VariableSetStmt`/`AlterSystemStmt`/`AlterDatabaseSetStmt`/`AlterRoleSetStmt` naming `lock_timeout`/`statement_timeout` (including `VAR_RESET_ALL`, Pitfall 4) fails schema validation via `assertFloorNotWeakened`, exactly like a rules file trying to downgrade `DROP TABLE`. |
| A migration file is altered after upstream classification but before execution (CI approves one SQL, a different SQL runs) | Tampering | D-01/D-03: the runner reads the file once, classifies that buffer, executes that same buffer — no second read of the file exists between classification and execution. |
| A long-running lock from a migration blocks the application indefinitely (denial of service against the app, not an attacker, but the same failure shape) | Denial of Service | `lock_timeout`/`statement_timeout` applied at connect time (D-14), verified in effect before executing anything (D-15). |
| An error message leaks the pinned connection string or a role password | Information Disclosure | `safeErrorMessage` — only `Error.message` is ever printed, never the error object; this is a project-wide, already-tested pattern (`scripts/log.ts`), reused rather than re-invented for the runner's own error paths. |
| A partial failure is silently marked "applied," and later migrations are layered on an inconsistent schema | Tampering / Repudiation (the audit trail says something false happened) | D-18's in-flight marker + D-20's refuse-on-stale-marker: the runner-owned table makes "mid-flight" a loud, named, queryable state rather than an invisible window. |

## Sources

### Primary (HIGH confidence — read directly from installed source, or verified live against the real running environment, this session)
- `packages/automation/src/types.ts`, `src/analyze.ts`, `src/inspector/inspect.ts`, `src/classifier/floor.ts`, `src/classifier/rules-schema.ts`, `src/adapter/drizzle-migrations.ts`, `src/cli.ts`, `src/index.ts` — read in full or in relevant part this session.
- `scripts/env.ts`, `scripts/verify-migration-state.ts`, `scripts/db-reset.ts`, `scripts/drill.ts`, `scripts/drill-status.ts`, `scripts/log.ts`, `tests/drill/restore-drill.test.ts`, `vitest.config.ts`, `vitest.drill.config.ts`, `docker-compose.yml`, `package.json`, `apps/recipe-app/{package.json,drizzle.config.ts,src/db/schema.ts,src/db/seed.ts,drizzle/meta/_journal.json,drizzle/0001_busy_thunderbolt.sql}` — read this session.
- `node_modules/pg/lib/{connection-parameters.js,query.js}` — read this session (`options` config support; simple-query-protocol dispatch).
- `node_modules/.pnpm/drizzle-orm@0.45.2.../drizzle-orm/{migrator.js,node-postgres/migrator.js,pg-core/dialect.js}` — read this session (byte-compatible ledger table shape, hash scheme, "is this migration new" comparison, and confirmation that drizzle's own `migrate()` wraps ALL pending migrations for a run in one transaction).
- Live probes against the installed `libpg-query@18.1.4`, this session: `stmt_location`/`stmt_len` per top-level statement; AST shapes for `VacuumStmt`, `AlterSystemStmt`, `CreatedbStmt`, `ReindexStmt` (concurrent vs. plain), `VariableSetStmt` (`VAR_SET_VALUE`/`VAR_SET_DEFAULT`/`VAR_RESET`/`VAR_RESET_ALL`), `AlterDatabaseSetStmt`, `AlterRoleSetStmt`.
- Live probes against the real, running, pinned `postgres:17` dev container (`docker compose ps` confirmed healthy), this session: `SHOW` vs. `pg_settings.setting` formatting for `lock_timeout`/`statement_timeout`; `pg`'s `options` connection parameter actually setting both GUCs at connect time; `CREATE INDEX CONCURRENTLY` failing inside an explicit `BEGIN` and succeeding standalone, with the exact server error text.
- `.planning/phases/04-migration-runner-history-tests/04-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `docs/decisions.md` (D12 read in full), `CLAUDE.md`, `.claude/CLAUDE.md` — read this session.

### Secondary (MEDIUM confidence — official documentation, fetched directly)
- postgresql.org/docs/current/libpq-connect.html — `options` connection parameter, `-c` GUC syntax.
- postgresql.org/docs/current/protocol-flow.html §"Multiple Statements in a Simple Query" — implicit transaction wrapping and stop-at-first-error behavior for multi-statement simple-query messages.
- postgresql.org/docs/17/{sql-createdatabase.html, sql-vacuum.html, sql-altersystem.html, sql-createindex.html, sql-reindex.html} — "cannot be executed inside a transaction block" statements for `CREATE DATABASE`, `VACUUM`, `ALTER SYSTEM`, `CREATE INDEX CONCURRENTLY`, `REINDEX CONCURRENTLY`, fetched and quoted directly.

### Tertiary (LOW confidence)
- General reasoning about the standard "second client holds an uncommitted conflicting lock" technique for testing `lock_timeout` (Assumption A3) — not independently verified against a fixture built from this repo's actual schema this session.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; every existing package's relevant behavior (not just its version) was verified live or read from source this session.
- Architecture: HIGH — the runner's core mechanisms (statement splitting, transaction wrapping, timeout application/verification, byte-compatible ledger writes) were each proven against the real installed dependencies and the real running dev container, not reasoned from documentation alone.
- Pitfalls: HIGH for the five listed (each has a concrete, session-verified trigger); MEDIUM for anything not explicitly covered (e.g., the exact shape of the D-18/D-20 stale-marker recovery flow, which is architecture already fully specified in CONTEXT.md but whose test technique this research did not independently prototype).

**Research date:** 2026-09-08
**Valid until:** 30 days for the Postgres/AST-shape findings (stable across patch releases of `libpg-query`/PostgreSQL 17); 7 days for anything tied to this specific machine's Docker/container state (already volatile by nature, re-verify at execution time rather than trusting this document's live-probe results as still-current).
