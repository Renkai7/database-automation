# Feature Research

**Domain:** PostgreSQL migration safety / deployment-gating systems
**Researched:** 2026-09-06
**Confidence:** MEDIUM (web search cross-checked against official tool docs and postgresql.org; no PROJECT.md-scale operational data exists yet — this is greenfield)

## Summary

Real tools in this space (squawk, Strong Migrations, atlas lint, eugene, pgroll, Reshape, and
GitLab/GitHub's internal migration guidelines) converge on the same short list of PostgreSQL
lock/rewrite hazards, and on the same rejection of two tempting ideas: automatic down-migrations,
and running migrations at app startup. The owner's draft brief already has the right shape but
several items are mis-classified or missing the mechanism that makes them dangerous — corrected
below in the rule catalogue (Section 1) and in the anti-feature assessment (Section 6).

---

## 1. PostgreSQL Migration Safety Rule Catalogue

This is the actionable core: each rule should become a literal analyzer check (regex/AST match
on the generated SQL → lock/rewrite reasoning → classification). Locking behavior is stated for
the currently-supported PostgreSQL versions (12+); version deltas are called out explicitly
because the project's dev/staging/prod may not all run the same major version, and because an
agent-authored migration is likely to be generated on whatever version Docker happens to default
to.

### BLOCKED by default (irreversible data loss on a live table)

| Operation | Why dangerous | Locking / mechanism |
|---|---|---|
| `DROP TABLE`, `DROP DATABASE`, `DROP SCHEMA` | Unrecoverable without a backup restore; often affects more than the author realizes (cascades) | `ACCESS EXCLUSIVE`; `DROP ... CASCADE` silently removes dependent FKs/views too |
| `TRUNCATE` | Same as DROP TABLE for data; frequently used by mistake for "clear this table" during dev and typo'd into a real migration | `ACCESS EXCLUSIVE`; also invalidates all `CONCURRENTLY`-built indexes' visibility assumptions if mixed in the same transaction |
| `DROP COLUMN` | Unrecoverable; also **breaks old application code still running during a rolling deploy** — the old app version's queries referencing the column start failing mid-rollout, not just on the DB side | `ACCESS EXCLUSIVE` (fast, metadata-only — the surprise here is not the lock, it's the loss + compatibility break) |
| Uncontrolled/unparameterized `DELETE` or `UPDATE` without a `WHERE` clause scoped to the intended rows | Mass data corruption; easy for an AI agent to generate a migration that accidentally omits a filter | Full table lock proportional to rows touched; also generates enormous WAL/replication lag |
| `ALTER TYPE ... DROP VALUE` / narrowing an enum, or any type change that is lossy (e.g. `numeric(10,2)` → `integer`, `text` → `varchar(n)` where existing data exceeds `n`) | Silent truncation or errors mid-migration; data loss that is not reversible from the DB alone | Requires table rewrite; fails partway through leaving a half-migrated table if any row violates the new type |

### REVIEW REQUIRED (safe *if done via the two-step pattern*, dangerous if done naively — this is the largest and most valuable category)

Each of these has a **naive form** (one statement, `ACCESS EXCLUSIVE` for the full duration) and a
**safe form** (two or more statements, weaker locks). The analyzer's job is to detect the naive
form and either rewrite/suggest the safe form or require human sign-off.

| Operation | Naive form hazard | Safe form | Version note |
|---|---|---|---|
| **`ADD COLUMN ... DEFAULT <value>`** | Pre-PG11: full table rewrite under `ACCESS EXCLUSIVE`, blocking all reads/writes for the duration. | PG11+: constant, non-volatile defaults are stored as catalog metadata (`pg_attribute.atthasmissing`/`attmissingval`) and backfilled lazily on read — near-instant, no rewrite. | **PG11 changed this.** But a **volatile default** (`clock_timestamp()`, `random()`, `nextval()`, any function without `IMMUTABLE`/`STABLE`) still forces a full rewrite *even on PG11+/18*, because the value differs per row and can't be stored as one metadata entry. The analyzer must classify by *volatility of the default expression*, not just "has a default." |
| **`SET NOT NULL` on an existing column** | Full table scan under `ACCESS EXCLUSIVE` to verify no NULLs exist — blocks reads and writes for the scan duration, proportional to table size. | 1) `ADD CONSTRAINT chk CHECK (col IS NOT NULL) NOT VALID` (instant, no scan). 2) `VALIDATE CONSTRAINT chk` (only `SHARE UPDATE EXCLUSIVE` — concurrent reads/writes continue). 3) `SET NOT NULL` (PG12+ detects the validated check constraint proves non-nullability and **skips its own scan** — brief `ACCESS EXCLUSIVE` for catalog update only). | **PG12+ required** for step 3 to skip the scan. On PG11 and earlier, `SET NOT NULL` always re-scans regardless of an existing validated check constraint — the safe pattern only fully pays off on PG12+. |
| **`ALTER COLUMN ... TYPE ...`** | Always takes `ACCESS EXCLUSIVE`, even for a metadata-only change. If a rewrite is needed, the lock is held for the full rewrite duration (minutes to hours on large tables). Indexes on the column are always rebuilt regardless. | No universal "safe form" without a rewrite — but rewrite can often be **avoided entirely**: increasing `varchar(n)` length or dropping the limit; increasing numeric precision or making it unconstrained; certain `interval`/`timestamp`/`timestamptz` widenings; or a `USING` clause that is a no-op where the old type is binary-coercible to the new type (e.g. `varchar`→`text`). If a rewrite genuinely can't be avoided, the pgroll/Reshape "shadow column + trigger + backfill in batches, then swap" pattern is the practical answer, not a single `ALTER`. | No PG version removes the `ACCESS EXCLUSIVE` requirement — this is a structural constraint of the catalog design, not a solvable optimization. |
| **Adding a `UNIQUE` constraint** | `ADD CONSTRAINT ... UNIQUE` builds the backing index while holding `ACCESS EXCLUSIVE` for the entire build — blocks reads *and* writes on a large table. | 1) `CREATE UNIQUE INDEX CONCURRENTLY idx ON t(col)` — takes `SHARE UPDATE EXCLUSIVE` only (concurrent DML continues); cannot run inside a transaction block, and if it fails it leaves an `INVALID` index that must be dropped manually before retry. 2) `ALTER TABLE t ADD CONSTRAINT t_col_uniq UNIQUE USING INDEX idx` — attaches the existing index to a constraint, metadata-only, near-instant `ACCESS EXCLUSIVE`. | No version gate; `CONCURRENTLY` has existed since PG8.2. The gotcha is purely "did the migration author use the two-step form." |
| **`CREATE INDEX` without `CONCURRENTLY`** | Takes a `SHARE` lock on the table for the entire build — blocks all `INSERT`/`UPDATE`/`DELETE` (writes), though `SELECT` is unaffected. On a large table this can be minutes to hours of write downtime. | `CREATE INDEX CONCURRENTLY` takes `SHARE UPDATE EXCLUSIVE` (scans the table twice, waits out existing transactions) and only briefly takes `ACCESS EXCLUSIVE` at the very end to flip catalog visibility. Cannot run inside the same transaction as other DDL — needs its own non-transactional migration step. | No version gate. `DROP INDEX CONCURRENTLY` and `REINDEX CONCURRENTLY` exist for the same reason on the removal/rebuild side (PG12+ for `REINDEX CONCURRENTLY`). |
| **Adding a foreign key** | Plain `ADD CONSTRAINT fk FOREIGN KEY (col) REFERENCES other(id)` scans and locks both the altered table and the referenced table while validating every existing row. | 1) `ADD CONSTRAINT fk ... NOT VALID` — instant, only enforces on new/changed rows going forward. 2) `VALIDATE CONSTRAINT fk` — separate statement, only `SHARE UPDATE EXCLUSIVE` on the altered table plus `ROW SHARE` on the referenced table; does not block concurrent writes. | No version gate. This is the FK analogue of the `SET NOT NULL` pattern and should be flagged by the same class of rule. |
| **Renaming a column or table** | Not a lock hazard — it's an **instant metadata change**. The real hazard is application compatibility: any code (old app version mid-deploy, ORM cache, raw SQL elsewhere) still referencing the old name breaks immediately and everywhere, with no rollout window. | Expand/contract: add the new name as an additional object (view alias, or a genuinely new column kept in sync via trigger/backfill), migrate all readers/writers to it, then remove the old name in a later, separate migration once nothing references it. | No version gate; this is a compatibility rule, not a lock rule — worth keeping as its own analyzer category so it isn't confused with the lock-hazard rules above. |
| Adding a column to a very wide/hot table even when "safe" per the rules above | The metadata-only paths above avoid rewrites, but a table with many concurrent long-running transactions can still stall waiting to acquire even a brief `ACCESS EXCLUSIVE` at the end of an otherwise-safe operation, because `ACCESS EXCLUSIVE` must queue behind every existing lock and itself blocks all new lock acquisition attempts that queue behind *it* (lock queue pile-up). | `SET lock_timeout` on the migration session so it fails fast and rolls back instead of blocking every subsequent query for the retry window; retry with backoff. | Applies at any version — this is why `lock_timeout`/`statement_timeout` wrapping (squawk's `require-lock-timeout`, `require-statement-timeout`) is table stakes for the analyzer/runner, independent of the specific DDL rule. |

### Long-running transactions / queuing (cross-cutting hazard, not a single statement)

A migration that is individually "safe" can still cause an outage if it runs inside a transaction
alongside other slow statements, or if the migration session itself holds a long-running
transaction open (e.g. it also does a large backfill in the same transaction as a schema change).
Any `ACCESS EXCLUSIVE` lock request queues behind all currently-held locks *and* blocks all new
lock requests behind itself, so a single slow, unrelated query holding even a weak lock on a table
can turn a "1-second" DDL statement into an outage that cascades to every other query needing that
table. The practical response: keep every DDL statement in its own short transaction, never mix a
data backfill with a schema-changing statement in the same transaction, and always set
`lock_timeout` (fail fast and retry) rather than let a DDL statement wait indefinitely.

### USUALLY SAFE (no special handling needed)

`CREATE TABLE`, `ADD COLUMN` nullable with no default (or non-volatile default on PG11+), `CREATE INDEX CONCURRENTLY`, `COMMENT ON`, adding a check constraint as `NOT VALID` (without yet validating it), dropping a constraint that no code depends on (metadata-only, but still worth a warning since "no code depends on it" is an application-level fact the DB can't verify).

### What the tools actually check (verified against source/docs)

- **squawk** (Rust, ~40 rules): `adding-field-with-default`, `adding-not-nullable-field`, `ban-drop-column`, `ban-drop-table`, `ban-drop-database`, `ban-drop-not-null`, `changing-column-type`, `constraint-missing-not-valid`, `disallowed-unique-constraint`, `require-concurrent-index-creation`, `require-concurrent-index-deletion`, `renaming-column`, `renaming-table`, `require-lock-timeout`, `require-statement-timeout`, `prefer-robust-stmts`, `ban-concurrent-index-creation-in-transaction` (CONCURRENTLY cannot run inside a transaction block — a real footgun if a tool wraps all migration statements in one transaction by default), `transaction-nesting`. Purely static/text-based — no DB connection required, so it is fast and dependency-free, but it cannot see actual table size or existing data, so it can't distinguish "this table has 12 rows" from "this table has 200M rows."
- **Strong Migrations** (Ruby): the same core list (volatile default, `SET NOT NULL`, non-concurrent index, unique/exclusion constraint, JSON column — `json` lacks an equality operator and breaks `SELECT DISTINCT`), plus Rails-specific ones (renaming an in-use enum value, renaming a schema).
- **atlas lint** (Go, schema-as-code): broader than text-pattern matching — it computes an actual schema diff against the *previously deployed* migration history (not just parsing the new file), so it also catches data-dependent changes like "adding a NOT NULL column with no default to a table that already has rows" which a purely textual linter can miss if the default is added in a separate statement. Configured declaratively (`destructive.error = true`, `data_depend.error = true`) in `atlas.hcl`, run via `atlas migrate lint` in CI at PR time.
- **eugene** (Rust, kaaveland): the most rigorous of the group — `eugene lint` does static analysis like squawk, but `eugene trace` actually **executes the migration inside a real transaction against a real (throwaway) Postgres instance** and records every lock acquired plus contention against concurrent statements it simulates. This catches lock-strength surprises that depend on actual table state (e.g., a "safe" operation that unexpectedly escalates because of an existing partial index or trigger) that no static tool can predict. This is the closest thing to a true safety oracle, at the cost of needing a real database to run against — directly relevant here since the project already runs disposable dev/staging Postgres containers.
- **GitHub/GitLab internal guidance** (as documented in public engineering blogs, not internal docs): converges on the identical list — no naive `SET NOT NULL`, no naive `ADD COLUMN DEFAULT` pre-PG11 equivalent-risk operations, no non-concurrent index builds, no naive unique constraints, plus organizational rules like "one schema-changing operation per migration/PR" and mandatory `lock_timeout`/`statement_timeout` on every migration session so a stuck migration self-aborts rather than blocking production traffic indefinitely.

---

## 2. Expand-and-Contract / Multi-Phase Migration Support

The brief already names expand-and-contract as the intended strategy for destructive changes.
What dedicated tooling (pgroll, Reshape) adds beyond "the team remembers to do three separate
releases":

- **pgroll** (Xata, Go, actively maintained) implements expand/contract via **versioned views +
  triggers**, not raw table access. On `pgroll start`, it performs the additive physical changes,
  then exposes a **new schema version as a set of views** over the physical tables; for a breaking
  column change it adds a new physical column and installs a trigger that syncs old↔new on every
  write, so the old and new application versions can run **simultaneously**, each querying its own
  view version, during the whole rollout window. `pgroll complete` (contract) drops the old
  columns/views/triggers once the new app version is fully deployed and confirmed. Migrations are
  authored as structured YAML/JSON rather than raw SQL, which is exactly the kind of
  machine-checkable format that suits an AI-agent-driven pipeline (the agent fills in a schema, not
  free-form SQL). Rollback during the migration window is nearly free because the old schema
  version's views are untouched until `complete` is run.
- **Reshape** (Fabian Lindfors, Rust, PG12+) uses the same view+trigger encapsulation idea but
  appears less actively maintained as of 2026 than pgroll; pgroll is the more current choice for
  this pattern if a dedicated expand/contract tool is adopted.
- **What this buys over manual discipline:** the tool guarantees both schema versions are
  genuinely live and kept in sync (via the trigger, not via "remember to write to both columns in
  app code"), which removes an entire class of bug where the manual expand/contract process is
  followed correctly in the migration but the application code forgets to dual-write during the
  transition window.
- **Relevance to this project:** given the solo-founder scope and the explicit decision to avoid
  "enterprise complexity," adopting a full view-based tool like pgroll is a **differentiator, not
  table stakes** — the discipline can be achieved manually (documented three-release pattern) for
  v1, with pgroll considered later if renames/type-changes/column-removals become frequent enough
  that manual dual-write bugs start happening.

---

## 3. Gating and Approval

Real-world gating mechanisms, roughly in order of maturity:

1. **CI status checks** — the safety classifier runs as a CI job; a `BLOCKED` result fails the
   build and the branch cannot merge (branch protection requiring the check to pass). This is
   automatic and requires no human in the loop for the common case.
2. **GitHub Environment protection rules** — a `production` environment with `required reviewers`
   pauses any job that deploys to it until a listed reviewer approves; supports wait timers and
   branch restrictions; only one of the listed reviewers needs to approve. Custom deployment
   protection rules can also call an external service for automated go/no-go (e.g. a monitoring
   tool asserting "no active incident").
3. **Manual approval steps** — the generic pattern behind (2): a pipeline pauses at a gate and
   waits for an explicit human action before continuing. Doesn't require GitHub specifically; any
   CI system with a manual-approval primitive works the same way.
4. **Policy-as-code** (OPA/Conftest with Rego rules) — codifies "a migration classified BLOCKED
   cannot deploy, REVIEW REQUIRED needs an approval record attached" as a machine-checked rule
   rather than a wiki page. Most public examples target Terraform/IaC, but the pattern transfers
   directly: feed the safety classifier's JSON verdict into a Conftest policy as the CI gate input.
   This is meaningfully more than what a solo founder needs for v1 — the classifier's own
   SAFE/REVIEW/BLOCKED output *is* the policy; a separate Rego layer only earns its cost once there
   are multiple repos/teams needing the same policy enforced consistently (i.e., post-Phase-7
   multi-project platform, not this project).

**What's realistic for a solo founder with no other reviewer:** GitHub's `required reviewers` gate
assumes a *different* person approves — that model doesn't fit a team of one. The workable
adaptation is:

- **SAFE** migrations deploy automatically after CI passes — no human gate needed, this is the
  entire point of the classifier.
- **REVIEW REQUIRED** migrations pause for the owner's own explicit action (a manual `workflow_dispatch`
  approval, or a required environment with the owner as the sole listed reviewer approving their
  own deployment — GitHub does allow the environment's reviewer list to include the person who
  triggered the run, so self-approval is mechanically fine even though it's not a second pair of
  eyes). The value of this gate for a solo founder is not "someone else catches it" — it's forcing
  a **deliberate second look with the full context (diff, classification reason, staging test
  results) assembled in one place**, rather than the migration silently rolling through in a batch
  of otherwise-routine deploys. A time-delay/wait-timer on the same environment adds a "sleep on it"
  effect for genuinely large changes, cheaply.
- **BLOCKED** migrations never reach the gate — they fail CI outright and require either editing
  the migration to change its classification (e.g., adding `NOT VALID` to a plain FK add) or an
  explicit, logged override mechanism (see Auditability) rather than a bypassable button.

---

## 4. Backup Verification

A "backup succeeded" exit code proves almost nothing — a truncated file, a corrupt dump, or a
schema that no longer matches the application can all report success at the backup step and still
fail on restore. Real automated restore tests assert, roughly in increasing order of confidence:

1. **Artifact integrity** — the restore *process* exits 0, the backup file's checksum matches what
   was recorded at backup time (catches transfer/storage corruption between backup and restore).
2. **Row counts** — query row counts per table on the restored database and compare against the
   expected counts (from the source database at backup time, or against a sane minimum threshold).
   Cheap, catches gross failures like a dump that silently stopped partway.
3. **Schema equality** — `pg_dump --schema-only` on the restored database, diffed against the
   expected schema (normalizing comments/whitespace) to catch silently-missing tables, columns,
   constraints, or indexes that a row-count check alone would not reveal.
4. **Data checksums** — aggregate hash (e.g. per-table checksum of a canonical row ordering) on
   critical tables to catch silent corruption that row counts miss (same row count, wrong data).
5. **Application boot / smoke test** — start the actual application against the restored database:
   confirm it boots, its migration tool reports "up to date" (no unexpectedly-missing migrations),
   and a handful of representative queries succeed. This is the strongest real-world signal because
   it exercises the same code paths production traffic would, not just the DBA's mental model of
   what "correct" means.

**Scheduling and reporting:** best practice is a tiered cadence — automated integrity checks after
every backup (cheap, catches obvious problems immediately), a fuller restore-and-assert drill on a
weekly/periodic schedule against a disposable database, and the report itself should be
**machine-generated with a real timestamp** (a purpose-built tool like `restoredrill` exists
specifically because a report is "much harder to fake" than a person's memory of having checked —
directly relevant here since the project's confirmed risk is "restore has never been tested" and a
skipped drill needs to be *visible*, not silently assumed-fine).

**For this project specifically:** the PROJECT.md already commits to "an automated restore test
runs against a disposable database" as an active requirement — the concrete addition from research
is *what to assert* (all five levels above, not just "the restore command didn't error") and *how
to report it* (a dated artifact/log entry the owner can see in the status summary, not just a CI
green checkmark that could mean "the restore command ran" rather than "the restored data is
correct").

---

## 5. Auditability

What mature systems record for every production migration (this is the concrete field list the
owner's brief already sketches, confirmed against real practice — no significant corrections
needed here, only completeness additions marked with `+`):

| Field | Why it matters |
|---|---|
| Migration identifier (filename/id) | Ties the DB-side record to the file in the repo |
| Git commit SHA | Answers "what code shipped alongside this schema change" |
| `+` Application/repository name | Needed the moment there is more than one app (Phase 7), cheap to record from day one |
| Deployment/CI run identifier | Lets you jump from an audit record straight to the CI logs that produced it |
| Environment (dev/staging/production) | Same migration id can appear multiple times across environments; must disambiguate |
| Timestamp (start and end, not just one) | Duration reveals lock-hold time after the fact — useful forensic signal even without live monitoring |
| Migration result (success/failure/rolled-back-forward-fix) | The basic pass/fail |
| Safety classification (SAFE/REVIEW REQUIRED/BLOCKED) + the specific rule(s) that fired | Reconstructs *why* a human gate was or wasn't required, after the fact |
| `+` Approval record for REVIEW REQUIRED migrations (who approved, when) | Even for a solo founder, this proves the deliberate-second-look gate was actually exercised, not silently skipped |
| Warnings / non-blocking notices surfaced at classification time | Distinguishes "flagged and proceeded anyway" from "never flagged" |
| The actual SQL executed | Needed to reconstruct exactly what ran, independent of what the source migration file *claims* to contain (relevant if a migration is regenerated or edited) |
| `+` Lock/duration telemetry if available (e.g. from an eugene-trace-style run) | Turns "was this actually safe" from a guess into a measured fact |
| Explicitly: no secrets, no full connection strings, no credentials | Standard log-hygiene requirement, already in the brief |

The single most important audit *property*, beyond the field list, is that this record must be
**append-only and independent of the migration succeeding** — a failed or blocked migration
attempt is exactly as important to have on record as a successful one, arguably more so.

---

## 6. Anti-Features — Assessment of the Brief's Own Lists and Additions

The owner's brief already gets the two headline anti-features right in principle (no automatic
rollback, migrations never at startup) and lists them as explicit constraints. Corrections and
extensions below.

### Automatic down-migrations / rollback scripts — **confirmed anti-feature, brief is correct**

Cross-checked against Rails/Laravel/Atlas/Liquibase/Flyway community consensus: this is close to
unanimous. The mechanism, stated precisely (the brief states the conclusion but not the mechanism —
worth having explicitly for the requirements doc):

- Data **written after** the up-migration ran is not represented in any down-script and is
  silently destroyed or corrupted when the down-script runs (e.g., a down for a lossy column merge
  or a `DROP COLUMN` cannot resurrect data without a separate backup — no tool can auto-generate
  the inverse of a lossy operation).
- Down paths are exercised far less often than up paths and are frequently broken exactly when
  needed, under incident pressure — the worst possible time to discover a bug.
- App code and DB schema can be rolled back independently in a real deployment; a DB-only rollback
  can leave a running app version incompatible with the now-older schema, which is a worse failure
  mode than the original problem.
- **What to build instead** (already in the brief, confirmed correct): backwards-compatible
  (expand/contract) migrations by default, verified backups + tested restore as the actual safety
  net, and forward-fix migrations for correcting mistakes. This project's requirement to make
  restore drilling routine and cheap (disposable dev DB) is precisely what makes "we don't do
  automatic rollback" a safe policy instead of a reckless one — the two decisions are a matched
  pair, not independent choices.

### Blanket blocking of all ALTER statements — **the brief already avoids this correctly; worth stating explicitly as a named anti-pattern**

The brief explicitly says "not every ALTER statement is dangerous, so safety checks should
understand context rather than blindly rejecting every schema alteration" — this is correct and
matches every real tool surveyed (squawk, Strong Migrations, atlas, eugene all allow the large
majority of `ALTER TABLE ... ADD COLUMN` variants and index operations through as SAFE). The
anti-feature worth naming explicitly for the requirements doc: **a system that blocks by
statement-keyword** (e.g. "any `ALTER TABLE` requires review") rather than by **specific
lock/rewrite mechanism** produces so much review-fatigue noise that the human gate gets rubber-
stamped without real attention — which defeats its own purpose. Concretely: `ALTER TABLE ADD
COLUMN email text` (nullable, no default) and `ALTER TABLE SET NOT NULL` on an unindexed column of
a 50M-row table are both "ALTER TABLE" statements but have opposite risk profiles; a keyword-level
blocker cannot distinguish them, a mechanism-level classifier can.

### Letting the application run migrations at startup — **confirmed anti-feature, brief is correct and this is already Decision D8**

Cross-checked and the mechanism is well documented: with multiple instances/replicas starting
concurrently (rolling deploy, autoscaling, container restart, or simply two `pnpm start` processes
briefly overlapping), each instance's startup hook can race to run the same migration
simultaneously — lock contention, partial/duplicate application, or crash loops. Beyond the race:
it silently re-couples schema-change timing to deploy timing (the exact problem the project exists
to solve per its own origin story), adds startup latency on every boot even with zero pending
migrations, and — most importantly for this project's threat model — **removes the human/CI
checkpoint** where a classified, gated migration could otherwise be reviewed before touching
production; a migration embedded in app startup bypasses the entire safety pipeline being built.
Standard, confirmed-correct fix: migrations run as an explicit, single, separate pipeline step
before the new app version receives traffic; if multiple migration runners could ever coincide, an
advisory lock or the migration tool's own lock table is defense in depth (Drizzle Kit does not
currently provide this itself, so the pipeline step must be serialized structurally — e.g., a
single CI job, not a job matrix, applies migrations).

### Additional anti-features surfaced by research, not in the brief

| Anti-Feature | Surface appeal | Why problematic | Alternative |
|---|---|---|---|
| Wrapping an entire migration file's statements in one transaction by default | Feels safer ("atomic, all-or-nothing") | `CREATE INDEX CONCURRENTLY` (and `REINDEX CONCURRENTLY`, `ALTER TYPE ... ADD VALUE` before PG12) **cannot run inside a transaction block at all** — a naive "wrap everything in BEGIN/COMMIT" runner will hard-fail on exactly the statements the safety rules recommend using. squawk has a dedicated rule for this (`ban-concurrent-index-creation-in-transaction`). | Each DDL statement that requires `CONCURRENTLY` runs in its own autocommit/non-transactional step; only genuinely atomic groups of statements share a transaction. |
| A single central "database controller" / multi-project platform built before one app has proven the pipeline | Feels like the "proper" architecture, and the brief's own author sketches this diagram | Explicitly the brief's own stated Phase-7 deferral and PROJECT.md's Out-of-Scope item — premature abstraction before the rule set, gating shape, and audit format have been proven against a single real app risks building the wrong reusable interface | Ship the pipeline against the recipe-app fixture first; extract a reusable controller only once a second app needs it |
| Fully automatic (no human touchpoint at all) deployment for *every* classification tier, including REVIEW REQUIRED | Appealing "full automation" goal for a solo founder who doesn't want to be a DBA | Removes the one deliberate-attention checkpoint that exists specifically because a classifier can be wrong (false negative) or a rule set incomplete — for a system whose entire premise is "no AI mistake can destroy production," the REVIEW REQUIRED tier existing but being auto-approved makes it decorative | Auto-deploy only SAFE; require an explicit (even if self-approved) action for REVIEW REQUIRED, as described in Section 3 |
| Trying to statically predict lock duration/impact with 100% accuracy from SQL text alone | Sounds like the ideal end-state for a classifier | Static analyzers (squawk, Strong Migrations) cannot see real table size, existing indexes, or concurrent load — they classify *lock type*, not *actual impact*, and can be both over- and under-cautious | Combine static classification (fast, always-on) with an eugene-trace-style run against a real disposable database that mirrors production data volume when a migration is REVIEW REQUIRED, rather than trying to make static rules omniscient |

---

## Feature Landscape

### Table Stakes (Not credible without these)

| Feature | Why Expected | Complexity | Notes |
|---|---|---|---|
| Static SQL safety classifier (SAFE/REVIEW/BLOCKED) with an extensible rule table, not hardcoded logic | This is the stated core value of the project; every real competitor tool (squawk, Strong Migrations, atlas) leads with exactly this | MEDIUM | Rules should be data (a table of pattern → classification → reason), matching the brief's own explicit requirement |
| Lock-timeout/statement-timeout wrapping on every migration execution | Prevents an individually "safe" statement from queuing indefinitely behind unrelated locks and cascading into an outage | LOW | squawk's `require-lock-timeout`/`require-statement-timeout` rules exist precisely for this; cheap to add universally |
| `NOT VALID` + separate `VALIDATE CONSTRAINT` pattern support (FK and CHECK) | The single highest-value safe-pattern across every tool surveyed | LOW–MEDIUM | Classifier must recognize the two-statement form as SAFE and the one-statement form as REVIEW/BLOCKED |
| `CONCURRENTLY` recognition for indexes and unique constraints | Same as above — universally the difference between "blocks writes for the build" and "doesn't" | LOW–MEDIUM | Must also detect the transaction-wrapping anti-pattern (Section 6) so `CONCURRENTLY` statements aren't broken by the runner itself |
| Migration applies cleanly to an empty DB and to an existing DB (both directions tested) | Already an active PROJECT.md requirement; standard practice across all migration tooling (Drizzle, Flyway, Atlas all test this) | MEDIUM | Requires a disposable DB spun up twice per CI run (fresh + existing-then-new) |
| Migrations run as a dedicated pipeline step, never at app startup | Confirmed anti-pattern avoidance (Section 6); already Decision D8 | LOW–MEDIUM | Needs a single-runner guarantee (no job matrix) or an advisory lock as defense in depth |
| No automatic down-migrations; forward-fix as the recovery strategy | Confirmed anti-feature avoidance (Section 6); already in Out of Scope | LOW (it's an absence, not a build) | Must be paired with reliable backups + tested restore, or "no rollback" is reckless rather than sound |
| Automated restore test against a disposable database, asserting beyond exit-code (row counts + schema diff at minimum) | Already an active PROJECT.md requirement and the confirmed #1 operational risk | MEDIUM–HIGH | Section 4's tiered assertion list; app-boot smoke test is the strongest signal but highest complexity |
| Production migration audit record (id, commit, environment, result, classification, timestamp, no secrets) | Already an active PROJECT.md requirement; matches every mature system surveyed | LOW–MEDIUM | Append-only; must record failed/blocked attempts, not only successes |
| CI status check that fails the build on BLOCKED classification | Minimum viable gating mechanism; works with zero additional infrastructure | LOW | GitHub required-status-check on the classifier job |

### Differentiators (Where this system can stand out for its actual user — a solo founder with an AI agent)

| Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|
| Trace-based (eugene-style) lock verification against a real disposable DB, in addition to static rules | Catches lock-strength surprises that depend on actual data/table state — static tools alone can't see this; directly usable here since dev DB is already a disposable Docker container | MEDIUM–HIGH | Best reserved for REVIEW REQUIRED migrations rather than run on every commit, to keep CI fast |
| Self-approval gate with full context assembled (diff + classification reason + staging results) for REVIEW REQUIRED tier | Solves the "no second reviewer exists" problem honestly rather than pretending a team-oriented approval flow fits a team of one | LOW–MEDIUM | GitHub environment reviewer list can include the triggering user; a wait-timer adds a "sleep on it" effect cheaply |
| Expand/contract tooling (pgroll-style view+trigger dual-schema) for column renames/type changes/removals | Removes an entire class of manual dual-write bugs during multi-release transitions | HIGH | Differentiator, not table stakes, per Section 2 — adopt only once manual expand/contract discipline starts producing bugs |
| Status-summary dashboard for the owner (the brief's own mockup: migration id, classification, per-environment pass/fail, backup status, production readiness) | Directly satisfies the "supervise, don't operate" requirement from PROJECT.md | MEDIUM | This is presentation over data the other table-stakes features already produce — sequence it after the underlying data exists |
| Scheduled, reported restore drills (not just an on-demand restore test) with a dated, tool-generated artifact | Makes a skipped drill *visible* rather than silently assumed-fine — directly targets the confirmed operational risk | LOW–MEDIUM | A cron job + a status file/log entry is sufficient; doesn't need a dedicated third-party tool for v1 |

### Anti-Features (Deliberately NOT built)

| Anti-Feature | Why Requested (surface appeal) | Why Problematic | Alternative |
|---|---|---|---|
| Automatic down-migrations / rollback scripts | "If something goes wrong, just roll it back" feels safe | Cannot represent data written after the up-migration ran; untested paths break under pressure; app/schema version mismatch risk | Backwards-compatible migrations + verified restore + forward-fix (already project policy) |
| Blocking every `ALTER TABLE` statement regardless of mechanism | Simple to implement, feels maximally cautious | Produces review-fatigue noise that gets rubber-stamped, defeating the point of a human gate; also blocks the safe two-statement patterns the system should be encouraging | Classify by lock/rewrite mechanism, not by statement keyword |
| Running migrations at application startup | Removes a manual deploy step; simple mental model | Multi-instance race conditions; re-couples schema change timing to deploy timing (the origin problem); bypasses the entire gating pipeline | Dedicated, single, separate pipeline step before the app receives traffic |
| Wrapping all migration statements in one transaction by default | Feels atomic and safe | Hard-fails on `CREATE INDEX CONCURRENTLY` and similar statements that cannot run in a transaction block — breaks the very safe-patterns the rules recommend | Per-statement transaction boundaries; only group genuinely atomic statements |
| Building the multi-project "Database Deployment Controller" before one app proves the pipeline | The brief's own author sketches this as an eventual architecture | Premature abstraction — the reusable interface can't be designed correctly before one real pipeline has been proven | Ship against the recipe-app fixture first (already PROJECT.md Out of Scope / Phase 7 deferral) |
| Fully automatic deployment for REVIEW REQUIRED migrations (no human touchpoint at all) | "Full automation" is the stated aspiration | Removes the one deliberate-attention checkpoint the classifier's REVIEW tier exists to create; makes the tier decorative | Auto-deploy SAFE only; explicit (self-)approval action for REVIEW REQUIRED |
| Relying on static SQL analysis alone as the sole safety oracle | Fast, no DB dependency, looks "complete" once the rule list is long | Cannot see real table size/data/concurrent load; both over- and under-cautious relative to actual risk | Pair static classification with disposable-DB trace verification for the REVIEW tier |

## Feature Dependencies

```
Static SQL safety classifier (rule table)
    └──requires──> Concrete rule catalogue (Section 1) as data, not hardcoded logic

CI status check gate (BLOCKED fails build)
    └──requires──> Static SQL safety classifier

Self-approval gate for REVIEW REQUIRED
    └──requires──> Static SQL safety classifier (needs a classification + reason to show)
    └──requires──> Staging migration test results (needs pass/fail to show in the gate context)

Automated restore test (row counts + schema diff + app-boot)
    └──requires──> Disposable database provisioning (already a project constraint: dev DB in Docker)

Scheduled restore drill reporting
    └──requires──> Automated restore test (drill = the test, run on a schedule, with a report)

Audit record (id, commit, environment, classification, result)
    └──requires──> Static SQL safety classifier (supplies the classification field)
    └──requires──> CI pipeline execution context (supplies commit SHA, run id, timestamps)

Status-summary dashboard for the owner
    └──requires──> Audit record
    └──requires──> Automated restore test results
    └──requires──> Static SQL safety classifier output

Trace-based (eugene-style) lock verification
    └──enhances──> Static SQL safety classifier (adds a second, data-aware opinion for REVIEW tier)

Expand/contract tooling (pgroll-style)
    └──enhances──> Manual expand/contract discipline (not a hard requirement; upgrade path)

Migrations as a dedicated pipeline step
    └──conflicts──> Running migrations at application startup
```

### Dependency Notes

- **The classifier is the load-bearing feature.** Nearly every other table-stakes and
  differentiator feature either produces input to it (rule catalogue) or consumes its output
  (CI gate, approval gate, audit record, status dashboard). It should be built and stabilized
  before the gating/audit/dashboard layers that display its verdicts.
- **Restore testing and "no automatic rollback" are a matched pair, not independent decisions.**
  Removing automatic rollback is only a sound policy because verified, drilled backups exist as
  the actual safety net — building one without the other leaves a real gap.
- **Trace-based verification enhances rather than replaces static classification** — it's
  reasonable to ship static-only classification first (matches every tool surveyed as a v1) and
  add disposable-DB tracing for the REVIEW tier once the classifier itself is stable, since tracing
  needs somewhere real to run and adds meaningful CI time.
- **Migrations-as-pipeline-step directly conflicts with migrations-at-startup** — this isn't a
  sequencing dependency, it's a mutual exclusion; the architecture must pick one, and the project
  has already correctly picked the pipeline-step model (Decision D8).

## MVP Definition

### Launch With (v1)

- [ ] Static SQL safety classifier with an extensible rule table encoding Section 1's catalogue
      (at minimum: DROP/TRUNCATE family → BLOCKED; volatile-default ADD COLUMN, naive SET NOT
      NULL, naive ALTER TYPE, naive unique constraint, naive FK add, non-concurrent CREATE INDEX
      → REVIEW; everything else default SAFE) — this is the stated core value and the highest-risk
      item to get architecturally wrong
- [ ] Lock/statement timeout wrapping on every migration execution — cheap, universal, prevents
      an individually-safe statement from cascading into an outage
- [ ] Migration history tested against both an empty DB and an existing DB in CI
- [ ] Migrations run as an isolated pipeline step, never at application startup
- [ ] CI status check that fails the build on BLOCKED classification
- [ ] Automated restore test against a disposable DB asserting at minimum row counts + schema
      diff (app-boot smoke test can be v1.x if it adds too much complexity to reach first ship)
- [ ] Production migration audit record (id, commit, environment, classification, result,
      timestamp) written on every attempt, success or failure

### Add After Validation (v1.x)

- [ ] Self-approval gate with assembled context (diff + reason + staging result) for REVIEW
      REQUIRED migrations — trigger: once a real REVIEW-classified migration actually occurs
      against the recipe-app fixture and the owner needs to act on it
- [ ] App-boot smoke test as part of the restore drill — trigger: once the basic restore assertions
      are proven reliable and the recipe app has a meaningful boot sequence to test against
- [ ] Scheduled/reported restore drills (cron + dated artifact) rather than on-demand only —
      trigger: once the manual restore procedure has been personally performed and timed at least
      once (already a PROJECT.md requirement)
- [ ] Status-summary dashboard aggregating classifier/audit/restore data — trigger: once enough of
      the underlying data exists that a dashboard is presenting real history rather than an empty
      shell

### Future Consideration (v2+)

- [ ] Trace-based (eugene-style) lock verification against a real disposable DB for REVIEW-tier
      migrations — defer until the static classifier and staging pipeline are stable; adds CI time
      and infrastructure for a marginal accuracy gain that matters more once real production data
      volumes exist
- [ ] pgroll-style versioned-view expand/contract tooling — defer until manual expand/contract
      discipline (documented three-release pattern) starts producing real bugs from missed
      dual-writes; premature before then
- [ ] Multi-project "Database Deployment Controller" — explicitly deferred to Phase 7 per
      PROJECT.md; do not build before one app has proven the pipeline
- [ ] Policy-as-code (OPA/Conftest) layer over the classifier's verdicts — only earns its cost once
      multiple repos/teams need the same policy enforced consistently; the classifier's own output
      is sufficient policy for a single solo-founder project

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---|---|---|---|
| Static SQL safety classifier (extensible rule table) | HIGH | MEDIUM | P1 |
| Lock/statement timeout wrapping | HIGH | LOW | P1 |
| Migration history tested empty-DB + existing-DB | HIGH | MEDIUM | P1 |
| Migrations as dedicated pipeline step (no startup migrations) | HIGH | LOW–MEDIUM | P1 |
| CI status check gate on BLOCKED | HIGH | LOW | P1 |
| Automated restore test (row counts + schema diff) | HIGH | MEDIUM–HIGH | P1 |
| Production migration audit record | HIGH | LOW–MEDIUM | P1 |
| Self-approval gate with assembled context | MEDIUM | LOW–MEDIUM | P2 |
| App-boot smoke test in restore drill | MEDIUM | MEDIUM | P2 |
| Scheduled/reported restore drills | MEDIUM | LOW–MEDIUM | P2 |
| Status-summary dashboard | MEDIUM | MEDIUM | P2 |
| Trace-based (eugene-style) lock verification | MEDIUM | HIGH | P3 |
| pgroll-style expand/contract tooling | LOW (for v1 scale) | HIGH | P3 |
| Multi-project controller | LOW (for v1 scope) | HIGH | P3 |
| Policy-as-code layer | LOW (for solo founder) | MEDIUM–HIGH | P3 |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

## Competitor / Reference Tool Analysis

| Feature | squawk | Strong Migrations | atlas lint | eugene | This project's approach |
|---|---|---|---|---|---|
| Rule input | Static SQL text (AST) | Static SQL text, Rails-integrated | Schema diff vs. deployed history | Static AST (`lint`) or real transaction trace (`trace`) | Static rule table (data, extensible per brief) for v1; trace-style verification as v2+ differentiator |
| DB required | No | No | No (uses migration history metadata) | Only for `trace` mode | No for v1 classifier; disposable dev DB available for future trace mode |
| Data-dependent detection (e.g. table size, existing violations) | No | No | Partial (diff-aware) | Yes (`trace` mode sees real data) | Not in v1; explicitly flagged as a P3 differentiator gap |
| CI integration model | CLI exit code | Raises exception in migration run | `atlas migrate lint` CI command | CLI producing JSON/Markdown for CI comments | Classifier output feeds CI status check + audit record directly |
| Expand/contract support | None (linting only) | None (linting only) | None (linting only) | None (linting only) | Manual discipline v1; pgroll-style tooling considered v2+ |
| Approval/gating | None (linter only, gating is external) | None | None (linter only) | None (linter only) | Built-in: CI gate (BLOCKED) + self-approval gate (REVIEW), since this project is a full pipeline, not just a linter |

## Sources

- [Squawk — Rules Overview](https://squawkhq.com/docs/rules) — MEDIUM confidence (official docs, cross-checked)
- [Squawk — adding-field-with-default](https://squawkhq.com/docs/adding-field-with-default/) — MEDIUM
- [Strong Migrations (ankane/strong_migrations)](https://github.com/ankane/strong_migrations) — MEDIUM (official README)
- [Atlas — Migration Analyzers](https://atlasgo.io/lint/analyzers) / [Verifying Migration Safety](https://atlasgo.io/versioned/lint) — MEDIUM (official docs)
- [eugene (kaaveland/eugene)](https://github.com/kaaveland/eugene) and [Introduction — Eugene Documentation](https://kaveland.no/eugene/) — MEDIUM (official docs/repo + author's blog)
- [brandur.org — A Missing Link in Postgres 11: Fast Column Creation with Defaults](https://brandur.org/postgres-default) — MEDIUM (cross-checked against postgresql.org mailing list threads)
- [Crunchy Data — When Does ALTER TABLE Require a Rewrite?](https://www.crunchydata.com/blog/when-does-alter-table-require-a-rewrite) — MEDIUM
- [DEV Community — The SET NOT NULL Downtime Trap in PostgreSQL](https://dev.to/andrewpsy/the-set-not-null-downtime-trap-in-postgresql-1o71) and [PostgreSQL mailing list — Validating check constraints without a table scan](https://www.postgresql.org/message-id/CAKkG4_%3DpL3s0cpr4d4hWcobRcdBF0%3D73RMcasiSz8vM9dcubxw%40mail.gmail.com) — MEDIUM
- [pgfence — The Postgres Lock Mode Cheat Sheet](https://pgfence.com/blog/postgres-lock-mode-cheat-sheet/) — MEDIUM
- [Medium — Postgres Story: unique constraint with minimum locks](https://medium.com/@raminorujov/postgres-story-how-to-efficiently-implement-a-unique-constraint-with-minimum-locks-aa3f72b8cf1b) and [PostgreSQL docs — CREATE INDEX](https://www.postgresql.org/docs/current/sql-createindex.html) — MEDIUM
- [PostgresPro mailing list — Reducing lock strength of adding foreign keys](https://postgrespro.com/list/thread-id/1854569) — MEDIUM
- [Bytebase — How to Use Postgres CREATE INDEX CONCURRENTLY](https://www.bytebase.com/blog/postgres-create-index-concurrently/) — MEDIUM
- [Xata — Introducing pgroll](https://xata.io/blog/pgroll-schema-migrations-postgres), [Schema changes and the power of expand-contract with pgroll](https://xata.io/blog/pgroll-expand-contract), [How pgroll works under the hood](https://xata.io/blog/pgroll-internals), [xataio/pgroll](https://github.com/xataio/pgroll) — MEDIUM (official project blog + repo)
- [fabianlindfors/reshape](https://github.com/fabianlindfors/reshape) and [Zero-downtime schema migrations in Postgres using Reshape](https://fabianlindfors.se/blog/schema-migrations-in-postgres-using-reshape/) — MEDIUM
- [GitHub Docs — Deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments) — MEDIUM (official docs)
- [Open Policy Agent — Using OPA in CI/CD Pipelines](https://www.openpolicyagent.org/docs/cicd) — MEDIUM (official docs)
- [ahmadpiran/restoredrill](https://github.com/ahmadpiran/restoredrill) — MEDIUM (project README)
- [pgDash — Automated Testing of PostgreSQL Backups](https://pgdash.io/blog/testing-postgres-backups.html) — MEDIUM
- [JetBrains Blog — Database Migrations in the Real World](https://blog.jetbrains.com/idea/2025/02/database-migrations-in-the-real-world/) — MEDIUM
- [Atlas — The Myth of Down Migrations](https://atlasgo.io/blog/2024/04/01/migrate-down) and [Liquibase — Database Rollbacks & Fix Forward in DevOps](https://www.liquibase.com/blog/database-rollbacks-the-devops-approach-to-rolling-back-and-fixing-forward) — MEDIUM
- Owner's original brief (`docs/original-brief.md`) — primary source for the project's own draft classification, assessed and corrected above

---
*Feature research for: PostgreSQL migration safety and deployment-gating system*
*Researched: 2026-09-06*
