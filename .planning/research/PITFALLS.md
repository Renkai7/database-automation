# Pitfalls Research

**Domain:** PostgreSQL migration-safety automation, self-hosted backup/restore, AI-agent database access
**Researched:** 2026-09-06
**Confidence:** HIGH for Postgres locking/DDL/backup mechanics (official docs + corroborated community sources); MEDIUM for Coolify-specific behavior (GitHub issues, vendor docs — smaller sample, version-sensitive); MEDIUM for Drizzle-specific tooling behavior (official docs + practitioner writeups, evolving tool).

## Critical Pitfalls

### A. Migration locking and DDL hazards

#### Pitfall A1: `ACCESS EXCLUSIVE` lock silently blocks reads, not just writes

**What goes wrong:**
An `ALTER TABLE` (e.g., `ADD COLUMN ... DEFAULT`, `ALTER COLUMN TYPE`, `DROP COLUMN`, adding a `CHECK` constraint) takes `ACCESS EXCLUSIVE` on the target table for at least a moment. Every other statement — including plain `SELECT` — needs at least `ACCESS SHARE`, which conflicts with `ACCESS EXCLUSIVE`. If any other session holds even a read lock on that table when the `ALTER TABLE` runs, the DDL blocks until that transaction ends; meanwhile new reads queue up too (see A2). Teams routinely assume `ALTER TABLE ADD COLUMN` is "just a metadata change" and forget that Postgres still needs exclusive access to make the catalog change, even when the change itself is instantaneous.

**Why it happens:**
Confusion between "the operation completes fast" and "the operation needs the strongest lock while it runs." A fast operation on an idle table is invisible; the same operation against a table with even one long-running transaction (an ORM holding a transaction open, a slow analytics query, a stuck connection from a prior deploy) becomes a full outage.

**How to avoid:**
- Never run schema DDL without `lock_timeout` set (see A7).
- Check `pg_stat_activity` / `pg_locks` for long-running transactions against the target table before migrating.
- Prefer statements documented as needing only `SHARE UPDATE EXCLUSIVE` or weaker (e.g., `ADD COLUMN` with no default post-PG11, `CREATE INDEX CONCURRENTLY`, `VALIDATE CONSTRAINT`).

**Warning signs:**
- Migrations that "usually" finish in milliseconds but occasionally hang for the length of the longest concurrent transaction.
- App-level timeouts/5xx spikes correlated with deploy timestamps, with no corresponding CPU/IO spike (the DB isn't overloaded — it's blocked).

**Phase to address:** Phase 2 (safety analyzer must classify lock strength per statement) and Phase 3 (test asserts migrations complete under a simulated concurrent transaction).

---

#### Pitfall A2: Lock queue starvation — one blocked statement stalls every subsequent query

**What goes wrong:**
Postgres lock acquisition is FIFO per relation. If an `ALTER TABLE` requesting `ACCESS EXCLUSIVE` is queued behind one long-running `SELECT`, every query that arrives *after* the `ALTER TABLE` — even ordinary `SELECT`s that would not conflict with the original holder — also queues behind the `ALTER TABLE`, not the original blocker. This is Postgres's anti-starvation behavior (a new lock request is granted only if it doesn't conflict with anything already granted *or waiting*). The practical effect: one slow query + one DDL statement can freeze an entire table for every client, turning a single stuck transaction into a full application outage.

**Why it happens:**
This is undocumented-feeling because it only manifests under concurrency. In dev, with one connection, DDL always runs instantly. The failure mode requires: a live table, a concurrent long transaction, and a DDL statement queuing behind it — exactly the production conditions that don't exist in a solo founder's disposable dev database.

**How to avoid:**
- Always set `lock_timeout` before DDL so the ALTER fails fast and releases the queue instead of blocking it indefinitely.
- Run schema migrations during low-traffic windows even when they're theoretically fast.
- Kill/identify long-running transactions before migrating (`pg_stat_activity` check as a pre-migration gate).

**Warning signs:**
- A migration that took 2 seconds in staging takes 8 minutes in production and correlates with total request failure, not partial degradation.
- Support reports of "the whole site went down" during what was expected to be a routine column addition.

**Phase to address:** Phase 2 (analyzer flags any statement requiring `ACCESS EXCLUSIVE`), Phase 6 (production runbook mandates `lock_timeout` + pre-flight check for long transactions before any production migration).

---

#### Pitfall A3: Table rewrites on type changes and volatile-default column adds

**What goes wrong:**
`ALTER TABLE ... ALTER COLUMN TYPE` almost always rewrites the entire table (and rebuilds indexes) unless the type change is provably binary-compatible (e.g., `varchar(20)` → `varchar(50)`, or dropping a `NOT NULL`-adjacent constraint). A full rewrite holds `ACCESS EXCLUSIVE` for the duration of rewriting every row — on a large table this is minutes to hours of total unavailability for that table, not a lock queue problem but a "how long is the lock held" problem. Similarly, `ADD COLUMN ... DEFAULT <expr>` used to (pre-PG11) rewrite the whole table just to backfill the default into every existing row.

**Why it happens (and version matters):**
Before **PostgreSQL 11**, any `ADD COLUMN` with a default value forced a full table rewrite. **PostgreSQL 11** changed this: for **non-volatile** defaults, Postgres stores the default in the catalog (`attmissingval`) and only materializes it lazily on read/write — no rewrite, `ACCESS EXCLUSIVE` held only briefly. However, **volatile defaults** (`random()`, `now()`/`clock_timestamp()`, `nextval()` in some cases, `gen_random_uuid()`) still force a full rewrite even on PG11+, because the value must be evaluated per-row, not once. Teams get burned by assuming "PG11 fixed ADD COLUMN defaults" without checking whether their specific default expression is volatile.

**How to avoid:**
- Analyzer must distinguish `ADD COLUMN ... DEFAULT <literal/immutable-fn>` (safe post-PG11) from `ADD COLUMN ... DEFAULT <volatile-fn>` (still a rewrite — flag as REVIEW REQUIRED regardless of Postgres version).
- For genuine type changes, prefer expand-and-contract: add new column of the new type, backfill in batches, swap reads, drop old column later — never an in-place `ALTER COLUMN TYPE` on a large populated table.
- Confirm the production Postgres major version explicitly; do not assume "modern Postgres" behavior applies without checking (the project should pin/verify this, per Phase 0's "version-matched to eventual production version").

**Warning signs:**
- A migration passes fine against the small recipe-app dev database but the analyzer has no rule distinguishing volatile vs immutable defaults — the first time this bites is in production against a table too big to eyeball.

**Phase to address:** Phase 2 (classification rule: volatile default = REVIEW REQUIRED/rewrite warning, immutable default post-PG11 = SAFE), Phase 0 (pin exact Postgres major version early since correctness of several rules depends on it).

---

#### Pitfall A4: `CREATE INDEX` without `CONCURRENTLY` blocks all writes; `CONCURRENTLY` itself can fail and leave a broken index

**What goes wrong:**
Plain `CREATE INDEX` takes a `SHARE` lock on the table, which blocks all writes (`INSERT`/`UPDATE`/`DELETE`) for the duration of the index build — on a large table, that's a write outage lasting as long as the build. `CREATE INDEX CONCURRENTLY` avoids this by building the index in two passes without holding a blocking lock, but it has its own failure mode: if it fails partway (e.g., a uniqueness violation is found, or the session is killed), it leaves behind an **invalid index** that still consumes disk, still shows up in `\d`, and silently degrades write performance (every write still updates it) without ever being used by the planner. Teams that don't know to check `pg_index.indisvalid` after a `CONCURRENTLY` failure end up carrying dead weight indefinitely, or worse, retry the same `CREATE INDEX CONCURRENTLY` and get a "relation already exists" error, blocking pipeline progress.

**Why it happens:**
`CONCURRENTLY` cannot run inside a transaction block, which trips up naive migration runners that wrap every migration file in a single transaction (Drizzle's default migrator does this) — the migration silently fails or the tool errors confusingly. Cleanup after a failed `CONCURRENTLY` build isn't automatic; you must `DROP INDEX` the invalid one manually before retrying.

**How to avoid:**
- Analyzer flags plain `CREATE INDEX` on any table above a configurable row-count/size threshold as REVIEW REQUIRED, recommending `CONCURRENTLY`.
- Migration runner must special-case `CONCURRENTLY` statements to run outside the wrapping transaction (Drizzle's default `migrate()` runs each migration in a transaction — statements using `CONCURRENTLY` must be excluded from that or run via a separate non-transactional path).
- Post-migration check: query `pg_index` for `indisvalid = false` and treat that as a migration failure requiring cleanup, not a silent partial success.

**Warning signs:**
- Index count creeps up over time relative to actually-used indexes (`pg_stat_user_indexes` shows zero scans on some).
- A retried migration errors with "relation already exists" instead of completing.

**Phase to address:** Phase 2 (flag non-concurrent index creation), Phase 3 (migration test asserts no invalid indexes remain after apply).

---

#### Pitfall A5: `SET NOT NULL` forces a full-table scan — partially fixed in PG12, but only if you do the extra step

**What goes wrong:**
`ALTER TABLE ... ALTER COLUMN ... SET NOT NULL` must verify no existing row violates the constraint, which requires scanning the whole table while holding `ACCESS EXCLUSIVE`. On a large table this is a long exclusive lock, not just a queue problem (compounds with A1/A2).

**Why it happens (version matters):**
**PostgreSQL 12** added an optimization: if a **validated** `CHECK (col IS NOT NULL)` constraint already exists on the column, `SET NOT NULL` can skip the scan because it can prove the invariant from the existing constraint's validation state. This only helps if you deliberately structure the migration as three steps: (1) `ADD CONSTRAINT ... CHECK (col IS NOT NULL) NOT VALID` (near-instant, no scan), (2) `VALIDATE CONSTRAINT` (scans the table but only needs `SHARE UPDATE EXCLUSIVE`, which does not block reads/writes), (3) `SET NOT NULL` (now free, since the constraint already proved it). Teams that just write `SET NOT NULL` directly get the full-scan-under-exclusive-lock behavior regardless of Postgres version — the optimization is opt-in via this specific pattern, not automatic.

**How to avoid:**
- Analyzer should never pass a bare `SET NOT NULL` on an existing populated table as SAFE — always REVIEW REQUIRED, with the suggested rewrite (NOT VALID check → VALIDATE → SET NOT NULL) surfaced as guidance.
- On a genuinely small/empty table (like early recipe-app iterations) this doesn't matter — flag by table size where feasible, not just statement shape.

**Warning signs:**
- A `SET NOT NULL` migration that works instantly in the disposable dev DB (few rows) but has never been tested against a table with realistic row counts.

**Phase to address:** Phase 2 (classification + suggested rewrite pattern), Phase 3 (test the three-step pattern works end to end, not just the naive one-liner).

---

#### Pitfall A6: Adding a foreign key without `NOT VALID` + `VALIDATE CONSTRAINT`

**What goes wrong:**
`ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY ...` by default validates all existing rows immediately, requiring a scan of both tables while holding locks that block writes on both. Exactly like A5, the fix is `ADD CONSTRAINT ... FOREIGN KEY (...) REFERENCES ... NOT VALID` (instant) followed by a separate `VALIDATE CONSTRAINT` (scans under a much weaker lock, non-blocking to normal traffic). Teams skip `NOT VALID` because it requires two migrations/statements instead of one and the difference is invisible on small tables.

**Why it happens:**
Same root cause as A5 — the "obvious" one-line SQL to add a constraint is also the unsafe one, and the safe two-step pattern isn't the default suggested by most ORM-generated migrations, including Drizzle's `generate`.

**How to avoid:**
- Analyzer flags any `ADD CONSTRAINT ... FOREIGN KEY` without `NOT VALID` on a populated table as REVIEW REQUIRED, and treats the `NOT VALID` + follow-up `VALIDATE CONSTRAINT` pattern as the SAFE idiom.
- Since Drizzle-generated migrations won't emit this pattern automatically, the project needs either a post-generation rewrite step or documented manual pattern for adding FKs to non-trivial tables.

**Warning signs:**
- FK-adding migrations that work fine in the recipe app (tiny tables) give false confidence that the same shape is safe once the app has real data volume.

**Phase to address:** Phase 2 (rule + suggested rewrite), Phase 7 possibly (if a reusable "safe migration templates" library gets extracted for the generalized controller).

---

#### Pitfall A7: Missing `lock_timeout` / `statement_timeout` turns every migration into a potential indefinite hang

**What goes wrong:**
Without `lock_timeout`, a migration that queues behind a lock (A1/A2) waits *forever* — there is no default cap. Without `statement_timeout`, a migration that starts a genuine long-running operation (an accidental full scan, a runaway `VALIDATE CONSTRAINT` on a huge table) also runs unbounded. Combined with a CI/CD pipeline, an unbounded migration step means a deploy that hangs indefinitely rather than failing fast and loudly.

**Why it happens:**
These are session-level GUCs that must be set explicitly per migration connection; they aren't Postgres defaults, and ORMs/migration tools don't set them unless told to. Teams add them only after their first real incident.

**Why this matters specifically for migrations (not just general DB hygiene):**
A migration is a one-shot, unattended, often unattended-at-3am operation running inside a deploy pipeline. A regular application query that hangs affects one request; a migration that hangs holds a lock queue that can freeze the entire table (A2) for the full duration of the pipeline timeout (or indefinitely, if the pipeline itself has no timeout) — turning a bounded, recoverable problem into an unbounded incident that requires manual intervention to even see, let alone fix.

**How to avoid:**
- Every migration-runner invocation sets `SET lock_timeout = '<n>s'; SET statement_timeout = '<m>s';` before running DDL, with `<n>` short (seconds) since if you can't get the lock quickly, retrying later is almost always better than waiting.
- The migration pipeline step itself has an outer timeout independent of the DB-level ones, so a hang is visible as a failed CI job, not a silently stuck deploy.
- On timeout, the pipeline fails loudly rather than retrying automatically (retrying a DDL statement that timed out on lock acquisition, without checking why, can pile up more waiters).

**Warning signs:**
- No `lock_timeout`/`statement_timeout` set anywhere in the migration runner configuration — this is directly greppable and should fail a checklist review before Phase 5/6.

**Phase to address:** Phase 3 (build the timeout-setting into the migration runner as part of "automated migration testing" infrastructure) and Phase 6 (production runbook enforces this as non-negotiable before first real migration).

---

### B. Backup and restore (highest priority — the confirmed operational risk)

#### Pitfall B1: A dump that succeeds and a restore that is silently incomplete are different things

**What goes wrong:**
`pg_dump` exiting 0 only means the *dump process* didn't error — it says nothing about whether the resulting file, when restored, reproduces a working database. Classic failure shapes: `pg_restore` reports errors for individual objects (a missing extension, a permission failure, an ownership mismatch) but continues past them and still exits with a partial success status unless `--exit-on-error` is used; a plain-text (`.sql`) dump run through `psql` continues past errors line-by-line by default unless `ON_ERROR_STOP=1` is set, silently skipping failed statements and reporting "done" at the end. The single most dangerous property of both tools: **partial completion looks identical to full completion unless you specifically check for it.**

**Why it happens:**
The tools are designed to be resilient/best-effort by default (skip what fails, keep going) because that's the right behavior for some use cases (e.g., restoring into an environment that already has some objects). That default is exactly wrong for disaster recovery, where "did everything actually come back" is the only question that matters.

**How to avoid:**
- Restore with `pg_restore --exit-on-error` (or for `psql`-based text restores, `psql -v ON_ERROR_STOP=1`), so any failure aborts immediately and visibly instead of silently continuing.
- Never trust a restore based on the exit code alone — verify content (see B7 for what a genuine assertion looks like).
- Capture and review `stderr` from every restore, not just the exit code, since partial restores can still exit non-zero-but-buried-in-a-long-log, or zero-with-warnings depending on flags.

**Warning signs:**
- A restore runbook that says "run `pg_restore` and check it didn't error" without specifying which flags make errors fatal, and without a post-restore content check.

**Phase to address:** Phase 1 — this is the phase's entire purpose. The manual drill in Phase 1 must deliberately include a broken/partial dump scenario, not just the happy path, so the owner learns what a silent partial restore actually looks like before automating around it.

---

#### Pitfall B2: `pg_dump` does not include roles, tablespaces, or other cluster-level objects — restoring into a fresh server fails on ownership/permissions

**What goes wrong:**
`pg_dump` operates on a single database and deliberately excludes global (cluster-level) objects: roles/users, tablespaces, and cluster-wide settings. If a restore target is a fresh Postgres instance (exactly the disaster-recovery scenario — the whole point of testing restore), the dump will try to `ALTER TABLE ... OWNER TO <role>` or grant privileges to roles that don't exist on the target, and either fail those specific statements (if using `pg_restore` without stopping on error, silently) or fail the whole restore (depending on flags). This is the single most common "worked until disaster day" backup gap: routine same-server dump/restore tests never exercise this path because the roles already exist there.

**Why it happens:**
Roles are cluster-level, not database-level, in Postgres's object model, so `pg_dump` (which is scoped to one database) structurally cannot include them. This is correct, documented behavior — the gap is procedural: teams don't realize they need a *separate* `pg_dumpall --globals-only` (or equivalent) step, taken and stored alongside the data dump, restored *first* on a fresh target.

**How to avoid:**
- Backup procedure must produce two artifacts: `pg_dumpall --globals-only` (roles, cluster settings) and `pg_dump` (the actual data), both stored together and versioned together.
- The restore drill (Phase 1) must restore onto a genuinely fresh Postgres instance/container — not one that already happens to have the right roles pre-created — or this gap will never surface until it matters.
- Automated restore test (Phase 1/6) provisions a disposable database *and* disposable role set from scratch each time.

**Warning signs:**
- The restore runbook was only ever tested by restoring into the same container/instance the dump came from (roles already present, gap invisible).

**Phase to address:** Phase 1 (must be caught by the first restore drill precisely because it's designed to use a disposable, from-scratch target).

---

#### Pitfall B3: Extension dependencies break restores when the target doesn't have the extension pre-installed (or has a different version)

**What goes wrong:**
If the source database uses any extension (`pgcrypto`, `uuid-ossp`, `pg_trgm`, PostGIS, etc. — even Drizzle-adjacent projects commonly reach for `pgcrypto`/`uuid-ossp` for UUID generation), the dump includes `CREATE EXTENSION` statements. Restoring onto a target where that extension binary isn't installed on the OS/container image fails that statement (and, depending on error-handling flags, either aborts or silently skips it — after which every dependent object like a `DEFAULT gen_random_uuid()` column also fails or behaves unexpectedly).

**Why it happens:**
Extensions are compiled/installed at the OS or container-image level, separate from the SQL-level `CREATE EXTENSION` call. A disposable restore-test container built from a generic `postgres:16` image won't have PostGIS or other non-bundled extensions unless the image is deliberately built to match.

**How to avoid:**
- The disposable restore-test environment's Postgres image must match the production image exactly (extensions included), not just the major version number.
- Document exactly which extensions are in use and pin them in the Dockerfile/compose file used for both the real database and the restore-test database.

**Warning signs:**
- Restore-test container built from a bare `postgres:<version>` image while the real app schema uses extensions not in that base image.

**Phase to address:** Phase 0 (pin the exact image including extensions from the start) and Phase 1 (restore drill must use that same pinned image, not a generic one).

---

#### Pitfall B4: Version mismatch between `pg_dump` and the server (client too old, or dump taken with a newer client than the restore target's server)

**What goes wrong:**
`pg_dump`/`pg_restore` binaries are generally expected to be **the same major version as, or newer than**, the server being dumped/restored against; an older client dumping a newer server (or a dump format written by a newer `pg_dump` being fed to an older `pg_restore`) produces cryptic syntax or "unsupported version" errors, sometimes mid-restore rather than up front. In CI/automation, this manifests when the CI runner's Postgres client tools are pinned to a different version than the actual database version (very possible if the client tools come from a generic base image and get silently updated over time while the database stays pinned).

**Why it happens:**
Backup and restore tooling isn't versioned as tightly as the schema/migrations are — nobody pins `pg_dump`'s version the way they pin the ORM version, because it "just usually works," until a routine base-image update in CI silently bumps the client tools past the database's actual version.

**How to avoid:**
- Run backup/restore tooling from a container image whose Postgres client-tools version is explicitly pinned to match the server's major version, and treat a version bump to that image as a change requiring the restore drill to be re-run.
- Automated restore test (Phase 1) is itself the regression check for this — if it runs on every relevant change, a version-mismatch break gets caught immediately rather than discovered during a real incident.

**Warning signs:**
- Backup tooling and database server versions are pinned independently (e.g., database version pinned in Coolify, but backup script runs from `latest` postgres-client image or whatever the CI runner ships).

**Phase to address:** Phase 1 (automated restore test catches this as a side effect if it always runs against a freshly-provisioned, version-pinned target) and Phase 6 (production backup job pins its own client-tools version explicitly).

---

#### Pitfall B5: Backups stored on the same machine/volume as the database they protect

**What goes wrong:**
If backups land on the same disk (or even the same host) as the live database, the single most common disaster scenarios — disk failure, host loss, accidental `rm`/volume deletion, ransomware, a bad `docker volume prune` — destroy the backup and the data simultaneously. This is not a hypothetical for this project: it runs on Coolify/Hetzner, and Coolify has documented, real incidents (see Section E) where volume recreation or Docker cleanup settings deleted database volumes. If backups live in a sibling volume on the same host, or the same disk, they die in the same event.

**Why it happens:**
It's the path of least resistance — writing a backup file next to the database is one line of config; shipping it off-host requires setting up S3/object storage credentials and a second system to reason about. Solo founders defer the "off-server" step indefinitely because local backups "work" in every test that doesn't involve losing the host.

**How to avoid:**
- Backups must be pushed to storage physically/logically separate from the database host — S3-compatible object storage (Hetzner Object Storage, Backblaze B2, etc.) is the practical minimum for a solo founder; this is a small, one-time integration cost, not an "enterprise" complexity.
- Verify the offsite copy is actually retrievable (not just "upload succeeded") as part of the automated restore test — restore *from the offsite copy*, not from a local file left over from the backup job, so the test also proves the offsite path works end to end.

**Warning signs:**
- Backup files visible via the same `docker exec`/volume you'd use to inspect the live database — if losing that container/host would take out both, the backup strategy has already failed, it just hasn't been asked to prove it yet.

**Phase to address:** Phase 1 (design the restore drill to pull from off-host storage from day one, even against the local Docker Postgres, so the pattern is established before Phase 6) and Phase 6 (production backups must land in off-server object storage as a hard requirement, not a nice-to-have).

---

#### Pitfall B6: Logical dump (pg_dump) vs physical/PITR (pgBackRest, WAL-G, Barman) — choosing the wrong one, or assuming you need the complex one

**What goes wrong (two failure directions):**
1. Relying solely on nightly logical dumps for a system that actually needs point-in-time recovery (PITR) — losing up to 24 hours of data on any incident, when a physical backup + WAL archiving solution could recover to seconds before the incident.
2. The opposite and more common founder-scale mistake: over-building. Standing up pgBackRest/WAL-G/Barman (continuous WAL archiving, base backups, PITR tooling) for a project with **no real users and no production data yet** adds real operational complexity (a WAL archive destination, retention/pruning logic, a second class of restore procedure to test) that has no payoff until there's data worth losing more than "the last nightly dump" of.

**Why it happens:**
Backup tooling advice online skews toward "always do continuous PITR, logical dumps aren't enough" because it's written for teams with real production traffic and real users, where losing hours of data is unacceptable. That advice doesn't transfer cleanly to a pre-revenue solo project whose actual near-term risk is *never having tested a restore at all* (the confirmed risk in this project), not *losing 4 hours of transactions*.

**How to avoid — the actual recommendation for this project:**
Nightly logical `pg_dump` (plus the roles/globals dump from B2), pushed off-host (B5), with a *proven, automated, regularly-exercised* restore procedure, is sufficient for a solo founder with no live third-party user data yet. The priority is **restore competence**, not **recovery-point granularity**. Revisit PITR (pgBackRest/WAL-G) as a Phase 7-or-later concern, explicitly triggered by "real user data now exists and losing a day of it is unacceptable" — not before. Building PITR now, before it's needed, is exactly the kind of complexity this project's constraints ("avoid enterprise complexity," "robust without an infrastructure team") warn against.

**Warning signs:**
- Time spent evaluating/configuring pgBackRest or WAL-G before a single restore of a plain `pg_dump` has ever been proven — this is solving a harder problem before the easier one is solved, exactly the ordering this roadmap otherwise avoids.

**Phase to address:** Phase 1 (logical dump + restore proof is the whole scope), explicitly deferred: PITR tooling is out of scope until Phase 7 or a milestone triggered by real user data existing.

---

#### Pitfall B7: A trustworthy restore verification asserts content, not just process success

**What goes wrong:**
Teams that do get as far as an "automated restore test" often just assert that `pg_restore` returned exit code 0 — which, per B1, does not prove the data came back. A genuinely trustworthy check must go further.

**What a real assertion looks like (concrete checklist for Phase 1's automated test):**
- Restore lands on a freshly provisioned, disposable target (proves B2/B3/B4 gaps would be caught).
- Row counts for every table match a recorded pre-backup baseline (not just "table exists").
- A content-level spot check: pick specific known rows/values (e.g., a seeded recipe with a known ID) and assert their actual field values, not just presence — this catches corruption/truncation that row counts alone would miss.
- Foreign key / constraint integrity holds after restore (run the app's own migration-verification query, or a simple referential-integrity query) — this catches partial restores where a parent table came back but a child table's rows referencing it didn't.
- Sequences/auto-increment state is correct post-restore (a common silent gap: data restores but sequences reset, causing future ID collisions) — checked explicitly, not assumed.
- The test measures and records **how long the restore took** — per the brief and PROJECT.md, timing the restore is itself a first-class output, not an afterthought, because "we have backups" without an answer to "how long until we're back up" is not actually an answer.
- The whole check runs unattended and reports PASS/FAIL/UNKNOWN — never defaulting silently to PASS if a step it depends on (e.g., the backup job itself) didn't run.

**Why teams stop short of this:**
Row-count-only or exit-code-only checks are much less work to write and *look* like real verification when read casually in a status dashboard. The gap only becomes visible during an actual disaster, which is exactly the scenario this project is trying to de-risk before it exists.

**Warning signs:**
- "Backup status: PASS" derived from "backup job didn't error," with no corresponding restore having ever run — per PROJECT.md/roadmap, this must show `UNKNOWN` until Phase 1 completes, never `PASS` by default.

**Phase to address:** Phase 1 (design the assertion set), Phase 6 (the same assertion set runs against real production backups on a schedule, feeding the status summary).

---

### C. Safety analyzer failure modes

#### Pitfall C1: Regex-based SQL analysis produces false confidence, and breaks on real SQL shapes

**What goes wrong:**
A naive analyzer built on regexes/string matching over migration SQL (`if sql.match(/DROP TABLE/i)`) breaks down on real-world SQL in specific, predictable ways:
- **Multi-statement files:** a migration file with several `;`-separated statements — a regex scanning the whole file for `DROP` will flag or miss based on the wrong statement, and can't tell you *which* statement is the problem for reporting.
- **Comments:** `-- DROP TABLE users; (this used to do X, now it doesn't)` inside a comment is not executable SQL, but a naive regex flags it as destructive (false positive) or, worse, a real dangerous statement inside a `/* ... */` block gets treated as a comment by a differently-naive parser and skipped (false negative).
- **Dollar-quoted strings:** Postgres function bodies use `$$ ... $$` or `$tag$ ... $tag$` quoting, inside which arbitrary SQL-looking text (including the literal words `DROP TABLE`) can appear as a string literal, not executable SQL. A regex has no concept of quote-state and will misfire on both false positives (text inside `$$` matching a "dangerous" pattern) and false negatives (an actual dangerous statement built dynamically via string concatenation inside a function body, invisible to surface-level scanning).
- **`DO $$ ... $$` blocks:** procedural blocks can contain conditional logic that decides *whether* to run a dangerous statement at runtime (e.g., `IF (SELECT count(*) FROM x) = 0 THEN DROP TABLE y; END IF;`) — static analysis of any kind, not just regex, cannot fully evaluate this, but regex specifically can't even reliably locate the statement inside the block to flag it.
- **Quoted identifiers:** `ALTER TABLE "DROP TABLE"` (an absurd but legal table name) or more realistically a column/table named in a way that collides textually with a keyword confuses naive matching in both directions.
- **`CREATE OR REPLACE FUNCTION` bodies:** the function body itself is a string/dollar-quoted blob containing what is effectively a second, nested SQL/PLpgSQL program that a top-level regex pass over "the migration" either ignores entirely (missing genuinely dangerous logic inside functions/triggers) or mis-scans as flat SQL.

**Why it happens:**
Regex-based checks are the fastest thing to build and demo — they look like they work against the two or three example migrations used to build them. The failure surface only appears once real, varied migration files (generated by an ORM's migration generator, or hand-written raw SQL for the cases the ORM can't express) are run through it. Real tools that survive contact with production (e.g., Squawk) are built on an actual Postgres SQL parser (`libpg_query`, the real parser extracted from Postgres itself), specifically because regex cannot correctly handle dollar-quoting and comments.

**How to avoid:**
- Build the analyzer on a real SQL parser (a `libpg_query`-based library, or equivalent), not regex/string matching, from the start — this is a Phase 2 architecture decision, not an optimization to defer.
- Explicitly test the analyzer against adversarial inputs designed to break naive parsing: a dangerous statement inside a comment, inside a dollar-quoted string, inside a `DO` block, and inside a `CREATE OR REPLACE FUNCTION` body — per the roadmap's own Phase 2 exit criterion ("test it adversarially"), this test set should include parser-breaking shapes, not just "does it catch `DROP TABLE`."
- Treat anything the parser can't fully classify (e.g., dynamic SQL built inside a function body, a `DO` block with conditional logic) as REVIEW REQUIRED by default — the analyzer's job is to be conservative when it can't be certain, not to guess.

**Warning signs:**
- The analyzer's test suite only contains clean, single-statement, ORM-generated example migrations — no comments, no functions, no dollar-quoting, no `DO` blocks.
- Any implementation detail described as "we scan the SQL text for keywords."

**Phase to address:** Phase 2 (architecture choice: real parser, not regex) — this is the single most important technical decision in that phase, since it determines whether every later phase's trust in "the analyzer said SAFE" is warranted.

---

#### Pitfall C2: The safety gate becomes decorative because it gets routinely overridden

**What goes wrong:**
Once a gate exists, the first false positive (a genuinely safe migration flagged REVIEW REQUIRED or BLOCKED) creates pressure to add an override/bypass mechanism ("just this once," "I know what I'm doing," "the analyzer doesn't understand this case"). Once an override path exists and gets used successfully once, it becomes the path of least resistance for every subsequent friction point, especially under deadline pressure. Within a few uses, the override is habitual, and the gate has been reduced to a formality that everyone (in this case, an AI agent *and* the owner) routes around rather than a real check. This is a well-documented failure mode of any static analysis gate (linters, security scanners) in normal software engineering, and it's *more* acute here because the "operator" reviewing overrides is a solo founder under no external pressure (see F1) and an AI agent that, unless architecturally prevented, can and will find the path of least resistance to make a task succeed.

**Why it happens:**
False positives are inevitable in any classifier that must be conservative (see C1's "when uncertain, flag REVIEW REQUIRED"). If the *only* response to a false positive is "override it," overriding becomes normalized rather than exceptional. The fix isn't fewer false positives (impossible to fully eliminate) — it's making overrides costly, visible, and rare by design.

**How to avoid:**
- Distinguish BLOCKED (mechanically un-overridable — the brief's own model: `DROP DATABASE`, `DROP SCHEMA`, `TRUNCATE`, etc. should have no override path to production at all, only a "do this via an explicit, logged, out-of-band procedure" escape hatch) from REVIEW REQUIRED (overridable, but every override is itself logged as part of the audit trail from Phase 6, with the specific reason recorded, not just a checkbox).
- Track override frequency per rule over time — if one rule is overridden almost every time it fires, that's a signal the rule's classification is miscalibrated (should move to SAFE with a narrower REVIEW trigger), not a signal to keep overriding it. This turns "the gate gets routinely overridden" from a silent failure into a visible metric that prompts fixing the rule.
- For an AI agent specifically: the agent should never have the ability to self-approve an override for its own generated migration — an override on REVIEW REQUIRED should require the human-in-the-loop step from the brief's "Human Role" section, not an agent flag.

**Warning signs:**
- An "override" flag/comment mechanism exists in the codebase before the first real override has actually happened for a legitimate reason (built defensively "just in case" rather than in response to a real false positive).
- Override usage isn't logged anywhere the owner would see it in the status summary.

**Phase to address:** Phase 2 (design BLOCKED as truly non-overridable from the start, distinct from REVIEW REQUIRED), Phase 6 (override logging becomes part of the audit trail; override frequency becomes a visible metric in the status summary).

---

### D. AI-agent-specific hazards

#### Pitfall D1: The agent hand-edits a generated migration file instead of changing the schema and regenerating

**What goes wrong:**
Drizzle's model is schema-first: you edit the TypeScript schema, then `drizzle-kit generate` diffs it against the last snapshot to produce SQL. If an agent instead directly edits the generated `.sql` file (to "fix" something, or because it's faster than reasoning about the schema diff), the SQL file and the TypeScript schema definition diverge — the schema no longer accurately describes what the SQL actually does, and the *next* `generate` call computes its diff against a snapshot that doesn't match reality, producing a migration that's wrong in a way that's hard to detect because each individual file "looks" fine in isolation.

**Why it happens:**
An agent under pressure to make a specific SQL statement do something reasons about it as "just SQL to fix" rather than "the output of a system that must stay internally consistent." This is a very natural failure mode for a coding agent, since editing files directly is its normal, successful pattern for every other kind of code.

**How to avoid:**
- Treat generated migration files as build artifacts, not source — the schema (TypeScript) is the only thing that should be hand-edited; any needed change to migration SQL happens by changing the schema and regenerating, or by writing a deliberate new raw-SQL migration for cases Drizzle can't express (with that raw SQL still going through the same safety pipeline, per the brief).
- CI check (Phase 4) that diffs `drizzle-kit generate`'s output against what's committed — if generating from the current schema produces a different result than what's checked in, the build fails, catching hand-edits immediately regardless of whether the agent or the human made them.

**Warning signs:**
- A generated migration file's content doesn't match what running `generate` fresh from the current schema would produce.

**Phase to address:** Phase 0 (establish the "schema is the source, SQL is generated" discipline in the very first walkthrough) and Phase 4 (CI enforces it mechanically via the diff check).

---

#### Pitfall D2: Editing a migration that has already been applied

**What goes wrong:**
Once a migration has been applied to any environment (even just the local dev database) and its hash/journal entry recorded, editing that migration file's SQL after the fact creates a mismatch: environments that already applied the old content are now out of sync with environments that will apply the edited content, and Drizzle's own drift detection (which hashes migration file contents) will flag or silently misbehave depending on how the discrepancy is discovered. This is especially dangerous once a migration reaches staging or production — an agent "fixing" a mistake by editing history rather than adding a new corrective migration means different environments now disagree about what "migration 0007" actually contains.

**Why it happens:**
It genuinely looks like the simplest fix in the moment — the mistake is right there in the file, editing it feels more direct than writing a new migration to correct it. This is the database equivalent of amending a public git commit that others have already pulled.

**How to avoid:**
- Hard rule, enforced by tooling not just convention: once a migration file is committed (or, more strictly, once it has been applied anywhere outside pure local scratch work), it is immutable — mistakes are fixed with a new, forward migration, never an edit.
- CI check (Phase 4) that fails the build if any previously-merged migration file's content changes in a PR diff.

**Warning signs:**
- A git diff on a PR touches a migration file with a timestamp/number earlier than the newest one in the PR.

**Phase to address:** Phase 4 (CI check: no diffs to already-merged migration files, ever) — this is a cheap, mechanical, high-value check.

---

#### Pitfall D3: `drizzle-kit push` silently diverges from migration history

**What goes wrong:**
`drizzle-kit push` reconciles the live database directly to match the current schema with no SQL artifact and no journal entry — it's designed for rapid local prototyping. If `push` is used anywhere near a shared or persistent database (including, critically, if an agent defaults to `push` because it's the faster/simpler command and the project's tooling doesn't prevent it), the database's actual structure drifts away from what the migration history (`generate`+`migrate`) says it should be. The stated risk is concrete: `push` can silently drop columns if the current schema no longer includes them, with no confirmation prompt in non-interactive/scripted use, and no record in git of what happened.

**Why it happens:**
`push` is genuinely the right tool for the fast local dev loop the brief describes ("Claude may modify the Drizzle schema... apply migrations... experiment with schema designs"), so it's reasonable for it to be in the agent's toolbox — the danger is scope creep: the same convenient command being reached for against staging or, worse, in a moment of confusion, against something resembling production.

**How to avoid:**
- Architecturally restrict which connection strings/environments `push` is even capable of targeting — e.g., the tooling wrapper only allows `push` against a connection string tagged `development`, and refuses to run it at all against anything tagged `staging`/`production`, independent of what the agent intends.
- The disposable local dev database (Phase 0's Docker container) is exactly the right place for `push` to live permanently — the goal isn't to ban `push`, it's to make it structurally incapable of reaching anywhere it would cause the drift problem.

**Warning signs:**
- Any script, CI job, or documented procedure that runs `drizzle-kit push` against a connection string that isn't hardcoded to the disposable dev container.

**Phase to address:** Phase 0 (establish `push` as dev-only from day one), Phase 5 (staging pipeline uses `generate`+`migrate` exclusively — never `push` — and the connection-string separation from Phase 5/6 should make this a structural guarantee, not a documented convention).

---

#### Pitfall D4: Resolving a failed migration by deleting journal entries

**What goes wrong:**
Drizzle tracks applied migrations in `meta/_journal.json` plus a table in the target database. If a migration fails partway (e.g., a DDL statement errors mid-file, or the runner is killed) and an agent "resolves" the resulting inconsistency by deleting the journal entry (or the corresponding row in the migrations tracking table) rather than diagnosing the actual failure, the tool's own bookkeeping now disagrees with the database's real state. The next `migrate` run may then re-attempt a migration that partially applied (erroring on "already exists" for whatever did succeed), or skip a migration the tool now thinks was never attempted, silently leaving the schema in an inconsistent state that only surfaces later, confusingly, when a *different* migration fails for an unrelated reason.

**Why it happens:**
Deleting the "this failed" record is the fastest way to make the error message go away, and an agent optimizing for "get the task to a green state" will find this path unless something more clearly correct is available and cheap. It's the database-migration equivalent of `git reset --hard` to make a merge conflict disappear.

**How to avoid:**
- Never treat journal/tracking-table edits as a normal recovery step — a failed migration should be diagnosed (what statement failed, why, what state did it leave the schema in) and fixed with either a corrective forward migration or, if genuinely nothing applied, a clean re-run — not resolved by editing tooling metadata.
- Migration runner should wrap each migration in a transaction where possible (Drizzle's default does this for statements that support it) so "partially applied" is less likely in the first place — but the analyzer/runner must specifically flag any migration containing a statement that *can't* run in a transaction (like `CREATE INDEX CONCURRENTLY`, per A4) since those are exactly the ones that can leave partial state.
- Document the actual recovery procedure (diagnose → forward-fix) as part of Phase 3/6 runbooks so there's a clearly correct alternative faster than "just delete the journal entry."

**Warning signs:**
- Any git history showing a commit that only touches `meta/_journal.json` or a migrations-tracking table, with no corresponding new migration file.

**Phase to address:** Phase 3 (document and test the real failed-migration recovery procedure) and Phase 6 (production runbook explicitly forbids journal/tracking-table edits as a resolution).

---

#### Pitfall D5: Destructive commands run against the wrong environment because of an ambient connection string

**What goes wrong:**
If "which database am I talking to" is determined by an environment variable that's merely *set* in the current shell/session (e.g., a leftover `DATABASE_URL` export from testing something against staging earlier in the session), an agent running what it believes is a routine dev-database command — including ones the brief explicitly grants freedom for, like resetting/recreating the database — executes against whatever the ambient variable actually points to. This is one of the most common real-world causes of accidental production data loss in general (not Postgres-specific), and it's specifically dangerous for an AI agent because the agent has no built-in instinct to double-check "wait, which database is this" the way a human pausing before typing `DROP TABLE` might.

**Why it happens:**
Ambient, implicit configuration (an env var that's "just there" from a previous step) is convenient and is exactly how most local tooling defaults work. The danger compounds with an AI agent because agents execute many commands per session without re-verifying context between them, and a connection string is not visually distinctive the way a production URL/hostname in a browser tab might be to a human.

**How to avoid:**
- This is precisely why PROJECT.md's constraint ("no production database credentials on the local development machine") is architectural, not a policy — if the credential structurally cannot exist in the agent's environment, no ambient-variable mistake can reach production, full stop. This is the single most important mitigation and it's already a stated constraint of this project.
- For staging (which *does* need to be reachable per Phase 5), the connection mechanism should make the target environment visually/structurally unambiguous — e.g., distinct hostnames per environment, a wrapper script that prints and requires confirmation of the target environment before any destructive-shaped command, or connections scoped so a single ambient variable can't silently point somewhere unexpected because there is deliberately no single generic `DATABASE_URL` used across environments.
- Any tool/script the agent uses for destructive dev operations (reset, recreate) should assert the target matches an expected dev-only marker (e.g., a sentinel database name or a required `--i-know-this-is-dev` style flag) before proceeding, rather than trusting whatever connection string happens to be set.

**Warning signs:**
- A single generically-named environment variable (`DATABASE_URL`) used interchangeably across dev/staging in scripts or documentation, distinguished only by "make sure you set it right first."

**Phase to address:** Phase 0 (establish per-environment, non-generic connection variable naming from the start), Phase 5 (staging connectivity design must make the target unambiguous, not just reachable), and the architectural constraint already correctly captured in PROJECT.md for production.

---

### E. Coolify / self-hosted specific

#### Pitfall E1: Database volume recreated/deleted on container restart or Docker cleanup, losing data

**What goes wrong:**
Coolify-managed databases run in Docker with persistent volumes. Documented real issues include: persistent storage being rebuilt into a *new* volume on certain restart paths (silently orphaning the old data), and database volumes being deleted outright during a container restart when the server's Docker cleanup ("Delete Unused Volumes") setting is enabled — the two interacting badly, since a restart plus aggressive cleanup can look, from the outside, like the database container "just came back empty."

**Why it happens:**
Coolify sits on top of Docker's normal volume/container lifecycle, and general-purpose Docker cleanup settings (reasonable for stateless app containers) are actively dangerous for stateful database containers if not scoped/excluded correctly. This is a real, reported class of issue in Coolify's own issue tracker, not a hypothetical.

**How to avoid:**
- Verify (don't assume) exactly how the recipe app's Postgres volume is configured in Coolify, and explicitly confirm the server's Docker cleanup settings won't touch it — treat this as a checklist item before Phase 5, not something to discover during an incident.
- The Phase 1 backup/restore capability is the actual mitigation regardless of the root cause — since this is a documented, real Coolify failure mode, the project's off-host backup (B5) is not optional hardening, it is the direct answer to a known platform risk, not a hypothetical one.
- Do not rely on the Postgres volume surviving container restarts as an assumption anywhere in the design; always treat the live volume as potentially ephemeral and the off-host backup as the actual source of truth for recoverability.

**Warning signs:**
- Docker cleanup / "delete unused volumes" enabled on the Hetzner server without an explicit check that it excludes the database volume.
- No test has been done of what happens to the staging database across a Coolify-triggered restart.

**Phase to address:** Phase 5 (verify Coolify volume behavior explicitly when provisioning staging, before trusting it) and Phase 6 (production backup cadence must assume the live volume can disappear without warning).

---

#### Pitfall E2: Coolify does not handle Postgres major-version upgrades — it only swaps the image

**What goes wrong:**
Upgrading the "internal" Postgres managed by Coolify (e.g., bumping from Postgres 15 to 16) only updates the Docker image; Coolify does not run `pg_upgrade` or migrate on-disk data format for you. Pointing a newer major-version Postgres binary at an old version's data directory without a proper upgrade path fails to start, or worse, corrupts data if forced. Coolify's own upgrade path keeps the previous volume for rollback, which helps, but the expectation that "upgrading the version" is a safe one-click operation is false for Postgres major versions generally, and Coolify's tooling doesn't hide that reality.

**Why it happens:**
A PaaS-style "upgrade" button implies the platform handles the hard part; for stateful databases in general (not just Coolify) major-version upgrades are inherently more involved than an image bump, and it's easy to assume the platform abstracts that away when it doesn't.

**How to avoid:**
- Treat any Postgres major-version change (dev, staging, or production) as requiring the same rigor as a schema migration: take a fresh backup first, verify a restore path exists, and follow Postgres's documented major-version upgrade procedure (`pg_upgrade` or dump/restore) rather than trusting an in-place image swap.
- Given this project's small scale, dump/restore-based upgrades (dump on old version, spin up new version, restore) are simpler and safer than `pg_upgrade` in place, and exercise the exact restore capability Phase 1 is already building — reuse it rather than building a separate upgrade procedure.

**Warning signs:**
- A Postgres version bump planned or performed without a preceding fresh backup specifically taken for that purpose.

**Phase to address:** Phase 1 (the restore capability built here should be explicitly reused for future version upgrades, not just disaster recovery) and Phase 6 (document that version upgrades follow the backup-then-dump/restore path, never a bare image swap).

---

### F. Project-process pitfall

#### Pitfall F1: No real users means no pressure forces the safety work, so it gets deferred until data exists — which is the exact retrofit problem this project exists to avoid

**What goes wrong:**
PROJECT.md names this directly: the owner's other SaaS apps hold only the owner's own data, so there is no urgent external pressure driving safety work, and that absence of pressure is itself identified as a risk to *this* project. The mechanism: without a live incident, an angry user, or a compliance deadline forcing the issue, every piece of this roadmap (especially the parts that feel like "extra work now for a problem that doesn't exist yet" — Phase 1's restore drills chief among them) is competing against the more immediately rewarding work of building the recipe app's features or moving on to the next SaaS idea. The project can stall indefinitely in a state of "the safety system is basically designed, I'll finish hardening it once real data justifies the effort" — at which point real data already exists, and the project has silently become exactly the retrofit scenario (safety work built around live, valuable data, under pressure) that starting greenfield was supposed to prevent.

**Why it happens:**
This isn't a technical pitfall, it's a motivation/sequencing one, and it's the single largest risk to the project's actual goal because every other pitfall in this document is preventable by following the roadmap — this one is a risk *to following the roadmap at all*. Solo-founder side projects without external deadlines very reliably lose momentum on "invisible" infrastructure work (nothing user-facing changes when a restore drill succeeds) in favor of visible feature work.

**How to counter it — concrete, structural mitigations, not willpower:**
- **Make each phase's exit criterion a falsifiable, demonstrable claim, not a vague "improve safety" goal** — the roadmap already does this well (e.g., Phase 1's exit is "a restore has been performed by hand, timed, and documented"), which matters because a concrete, checkable claim is much harder to quietly skip than an open-ended aspiration. Preserve this property in every future phase and refuse to soften an exit criterion into something unfalsifiable when it gets inconvenient.
- **Sequence the roadmap so safety infrastructure is a hard prerequisite for the reward, not parallel to it** — the existing roadmap does this: production (Phase 6, the "real" milestone) architecturally cannot happen before Phases 1–5 pass, because there is no production connection until the safety architecture is proven (PROJECT.md's own sequencing constraint). This converts "safety work competing with feature work for attention" into "safety work being the only path to the outcome the founder actually wants" (a working, supervised production pipeline) — use that ordering as leverage, don't let a shortcut ("just connect to production once to see it work, we'll finish Phase 2's edge cases later") erode it.
- **Treat the recipe app's schema churn as mandatory exercise, not optional polish** — the roadmap's own "note on schema churn" (adding tags, splitting ingredients, non-null columns, renames, eventual drops) exists specifically so the pipeline gets exercised against realistic migration shapes before it matters; skipping or rushing that churn to "get to the interesting part" quietly undermines Phase 2/3's adversarial testing goals.
- **Set an explicit, non-negotiable gate before any real user data enters the system**: production access (per PROJECT.md's sequencing constraint and Phase 6) requires Phases 1–5 exit criteria demonstrably met — not "mostly done," not "good enough for now." If real user data or a real launch pressure arrives before that gate is met, the correct response is to delay the launch, not to backfill the safety work under pressure — which is the one sequence this entire project was built to avoid.
- **Revisit PROJECT.md's Context section at each phase transition** (it already has a built-in evolution process) and explicitly re-answer "is deferred safety work still deferred for a good reason, or just deferred" — making this an explicit checklist item at every transition, rather than assuming momentum will carry the project through phases it finds tedious.

**Warning signs:**
- Any temptation to skip or abbreviate the Phase 1 restore drill because "the recipe app doesn't have real data anyway, so what's the risk."
- Any proposal to connect to a real production database, or route real user data through the pipeline, before Phase 6's stated exit criteria are met.
- Roadmap phases starting to blur together or get merged "to move faster," especially skipping the adversarial-testing exit criteria in Phase 2/3 in favor of "it looks like it works."
- Long gaps in development where feature work on the recipe app (or a new SaaS idea) visibly progresses while Phases 1–3 remain unfinished.

**Phase to address:** All phases — this is a cross-cutting process risk, not a single-phase technical fix. The concrete lever is Phase 6's gate (no production access until 1–5 are demonstrably done) and Phase 1's early placement (restore drills happen while there's zero cost to getting it wrong) — both already correctly designed into the roadmap; the risk is *not following through* on them under time/motivation pressure, not a design gap.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|-----------------|------------------|
| Using `drizzle-kit push` against anything beyond the local dev container | Faster iteration, no migration file to write | Silent schema drift from migration history (D3); no audit trail | Never beyond the disposable local dev database |
| Skipping the `NOT VALID` + `VALIDATE CONSTRAINT` two-step for FKs/NOT NULL on small tables | One migration instead of two | Muscle memory forms around the unsafe one-liner; breaks the first time it's used on a real-sized table | Acceptable only while every table is genuinely tiny (early recipe-app phases) — must not persist as a habit into Phase 5/6 |
| Regex/string-matching first pass for the safety analyzer, "we'll swap in a real parser later" | Ships Phase 2 faster | False confidence (C1) baked into every phase that trusts the analyzer's output afterward | Never — the parser choice is foundational, not an implementation detail to defer |
| Nightly logical dump only, no PITR | Simple, cheap, easy to reason about | Up to ~24h of data loss window on incident | Acceptable indefinitely for this project, per B6 — revisit only when real user data with a tighter RPO requirement exists |
| Single generic `DATABASE_URL` env var reused across environments, distinguished by convention | Less config to manage | Enables D5 (wrong-environment destructive command) | Never, once more than one real environment exists (i.e., from Phase 5 onward) |
| Manual restore drill without automation | Fast to demonstrate once | No regression protection — a later dependency/version bump (B4) silently breaks restore with nobody noticing | Acceptable only for the very first manual drill in Phase 1; automation must follow immediately per that phase's own exit criterion |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|-----------------|-------------------|
| `pg_dump`/`pg_restore` | Trusting exit code 0 as proof of a usable backup | Assert content (row counts, spot-checked values, referential integrity, sequence state) per B7, on a freshly provisioned target per B2 |
| Coolify-managed Postgres | Assuming the "upgrade" button safely handles major-version changes | Treat major-version bumps as backup-then-dump/restore operations, never a bare image swap (E2) |
| Coolify volumes + Docker cleanup | Assuming the database volume is stable across restarts | Verify cleanup settings explicitly exclude the DB volume; treat the volume as potentially ephemeral regardless (E1) |
| Drizzle Kit (`push` vs `generate`/`migrate`) | Using `push` anywhere beyond local dev because it's faster | Restrict `push` to a connection string structurally scoped to the disposable dev database only (D3) |
| GitHub Actions CI running migrations | Not distinguishing "migration test failed" from "migration test timed out because it hung on a lock" | Set `lock_timeout`/`statement_timeout` in the CI migration step itself (A7), independent of the job-level timeout |
| Tailscale / SSH connectivity to staging (Decision D4, still open) | Treating "reachable" as equivalent to "safely scoped" | Whichever mechanism is chosen, ensure the staging target is unambiguous to any tool/agent connecting to it (ties to D5) |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|-----------------|
| Bare `ALTER COLUMN TYPE` on a growing table | Migration step in CI/CD starts taking noticeably longer over successive months, eventually timing out | Expand-and-contract for type changes (A3); analyzer flags type changes as REVIEW REQUIRED unconditionally | Breaks once table size makes the rewrite duration exceed the pipeline's tolerance — often the first time it's tried against anything beyond the tiny recipe-app fixture data |
| Plain `CREATE INDEX` (no `CONCURRENTLY`) | Fine in dev/staging with light traffic; a production deploy causes a visible write-latency spike or outage during the build | Always default to `CONCURRENTLY` for indexes on any table above a small row-count threshold (A4) | Breaks at whatever row count makes the index build take longer than the app's write-availability tolerance — can be surprisingly low under concurrent write load |
| `SET NOT NULL` / FK addition without the `NOT VALID` pattern | Instant in a nearly-empty table; a long, lock-holding scan once the table has real rows | Adopt the two-step pattern as the default idiom, not an exception (A5/A6) | Breaks as soon as the target table has enough rows that a full scan takes longer than `lock_timeout` — could be the very first time it's run against real data |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Production migration credentials reachable from the local dev machine, even temporarily "just to debug something" | Any local-machine compromise or agent mistake becomes a production database compromise | Architectural exclusion, per PROJECT.md's own constraint — no exception path should exist, including for debugging |
| Exposing the database port to the internet for "just a quick check" | Direct attack surface on the database, bypassing the entire pipeline's safety model | Use the chosen zero-inbound-port mechanism (Tailscale, or restricted SSH with `permitopen`) exclusively; never open the port even temporarily |
| Logging full connection strings or credentials in migration audit logs (Phase 6) | Credential leakage via logs, which are often less carefully access-controlled than the secrets store itself | Audit log records id/commit/environment/result/classification/timestamp only, per the brief — explicitly exclude connection strings and secrets from any log line, including error messages from failed migrations (DB errors sometimes echo the connection string) |
| Reusing one role/credential across dev, staging, and production "to keep things simple" | A single leaked credential compromises every environment at once; also removes the least-privilege separation the brief calls for | Separate credentials per environment and per purpose (app runtime vs. migration), exactly as PROJECT.md's constraints already specify |

## UX Pitfalls

| Pitfall | User Impact (the owner, as sole "user" of the supervision UI) | Better Approach |
|---------|------------------------------------------------------------|-------------------|
| Status summary shows "Backup: PASS" derived only from the backup job's own exit code | False confidence exactly like B1/B7 — the one thing this project must not reproduce in its own dashboard | Backup status reflects the most recent successful *verified restore*, not the most recent backup job's exit code; show `UNKNOWN` until a restore has actually been proven, per PROJECT.md's own stated principle |
| REVIEW REQUIRED migrations presented with no actionable "why" | Owner has to go read raw SQL or logs to understand what to approve, so approvals become rubber-stamps (feeds C2) | Surface the specific rule that triggered, in plain language, with the suggested safe rewrite pattern where one exists (e.g., "this adds a FK without NOT VALID — consider the two-step pattern") |
| Migration failure reported as a bare stack trace / exit code in CI | Owner can't tell "lock timeout, try again later" from "genuinely broken migration" without deep investigation | Distinguish and clearly label failure categories (lock-timeout / statement-timeout / SQL error / test assertion failure) so the appropriate response is obvious at a glance |

## "Looks Done But Isn't" Checklist

- [ ] **Backup job exists and runs on schedule:** Often missing an actual restore ever having been performed — verify the status reflects a proven restore (B7), not just a successful backup run.
- [ ] **Migration safety analyzer is "built":** Often missing adversarial test coverage and a real parser under the hood — verify it correctly classifies statements hidden inside comments, dollar-quoted strings, `DO` blocks, and function bodies (C1), not just top-level clean statements.
- [ ] **"Migrations run in CI" is implemented:** Often missing `lock_timeout`/`statement_timeout` on the actual migration-running connection — verify these GUCs are set in the runner itself, not assumed from server defaults (A7).
- [ ] **Restore-test environment exists:** Often missing role/global-object restoration and extension parity with production — verify it restores onto a genuinely fresh instance including `pg_dumpall --globals-only` and matching extensions (B2/B3), not a pre-seeded one.
- [ ] **Staging connectivity works:** Often missing an explicit check that the connection mechanism can't be confused with another environment — verify there's no shared generic `DATABASE_URL` pattern that could point an agent at the wrong place (D5).
- [ ] **"CI blocks destructive migrations":** Often missing a check that BLOCKED classifications have no override path at all — verify REVIEW REQUIRED and BLOCKED are architecturally distinct, not the same mechanism with a different label (C2).

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|------------------|
| B1/B7 — a real restore attempt reveals it was never actually recoverable | LOW (if caught in Phase 1, against fake data) / CATASTROPHIC (if caught during a real incident) | This is precisely why Phase 1 exists early: the entire point is to pay this cost now, cheaply, deliberately, rather than later, expensively, by accident |
| A2 — a production migration is discovered mid-deploy to be stuck in a lock queue | MEDIUM | Identify and terminate the blocking session (`pg_terminate_backend`) if safe to do so, or wait out the `statement_timeout`/`lock_timeout` if configured (A7) so it fails cleanly instead of requiring manual intervention |
| D4 — journal/tracking-table state has already been hand-edited to "resolve" a failed migration | MEDIUM–HIGH | Manually reconcile the tracking table against the database's actual schema state (inspect `information_schema` directly), restore from the most recent verified backup if the true state can't be confidently reconstructed, then re-derive migration history going forward |
| E1 — a Coolify-managed database volume was unexpectedly recreated/emptied | LOW (if off-host backups per B5 exist and have been restore-tested) / HIGH (if not) | Restore from the most recent off-host backup using the already-proven Phase 1 procedure — this is the direct payoff of having built and tested that procedure before it was needed |
| C2 — discovery that a safety rule has been overridden so often it's effectively decorative | LOW | Use the override-frequency signal (per C2's prevention strategy) to recalibrate that specific rule's classification rather than treating it as a process failure to punish |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|-------------------|----------------|
| A1/A2 — `ACCESS EXCLUSIVE` locks and lock-queue starvation | Phase 2 (classify lock strength), Phase 6 (pre-flight long-transaction check) | Analyzer correctly flags any statement requiring `ACCESS EXCLUSIVE`; production runbook includes a pre-migration `pg_stat_activity` check |
| A3 — table rewrites (type changes, volatile defaults) | Phase 0 (pin PG version), Phase 2 (classify volatile vs. immutable defaults) | Adversarial test migration with a volatile default is classified REVIEW REQUIRED, not SAFE |
| A4 — `CREATE INDEX` without `CONCURRENTLY` / invalid index cleanup | Phase 2 (flag), Phase 3 (post-migration `pg_index.indisvalid` check) | Migration test suite includes a deliberately-failed `CONCURRENTLY` build and asserts cleanup is required/detected |
| A5/A6 — `SET NOT NULL` / FK addition full scans | Phase 2 (classify + suggest two-step rewrite) | Analyzer test suite includes both the naive and the `NOT VALID`+`VALIDATE` forms, classified differently |
| A7 — missing `lock_timeout`/`statement_timeout` | Phase 3 (build into runner), Phase 6 (enforce in production runbook) | Runner configuration greppable/testable for these GUCs being set on every migration connection |
| B1–B7 — backup/restore failure modes (top priority) | Phase 1 (all), reinforced Phase 6 | Automated restore test asserts content (row counts, spot values, referential integrity, sequence state) against a fresh target including globals and matching extensions, with timing recorded |
| C1 — regex-based analyzer false confidence | Phase 2 (build on a real parser from the start) | Adversarial test set includes comments, dollar-quoted strings, `DO` blocks, and function bodies, per the roadmap's own Phase 2 exit criterion |
| C2 — safety gate becomes decorative | Phase 2 (BLOCKED vs. REVIEW REQUIRED architecture), Phase 6 (override logging + frequency metric) | Audit log records every override with a reason; override frequency per rule is visible in the status summary |
| D1/D2 — hand-editing generated/applied migrations | Phase 0 (establish discipline), Phase 4 (CI diff check) | CI fails if regenerating from the current schema differs from committed SQL, or if any already-merged migration file's content changes in a PR |
| D3 — `drizzle-kit push` drift | Phase 0 (dev-only from the start), Phase 5 (staging pipeline never uses `push`) | `push` structurally cannot target anything but the local disposable container; staging/production pipelines use `generate`+`migrate` exclusively |
| D4 — deleting journal entries to resolve failures | Phase 3 (document real recovery procedure), Phase 6 (forbid as production resolution) | Runbook exists and has been exercised at least once against a deliberately-failed migration in a disposable environment |
| D5 — wrong-environment destructive commands | Phase 0 (per-environment variable naming), Phase 5 (unambiguous staging target) | No generic `DATABASE_URL` shared across environments; destructive dev commands assert a dev-only marker before proceeding |
| E1 — Coolify volume loss on restart/cleanup | Phase 5 (verify Coolify volume/cleanup config), Phase 6 (backup cadence assumes volume is ephemeral) | Explicit confirmation that Docker cleanup settings exclude the DB volume; off-host backup is the trusted source of recoverability regardless |
| E2 — Coolify major-version upgrade doesn't migrate data | Phase 1 (reuse restore capability), Phase 6 (documented upgrade procedure) | Version upgrades documented and tested as backup-then-dump/restore, never a bare image swap |
| F1 — no user pressure defers safety work into a retrofit | All phases; concrete gate at Phase 6 | Production access remains architecturally blocked until Phases 1–5 exit criteria are demonstrably met — not "mostly met" |

## Sources

- PostgreSQL official docs and commit/mailing-list messages: ALTER TABLE behavior across versions, `attmissingval` optimization (PG11), `SET NOT NULL` constraint-skipping optimization (PG12) — HIGH confidence.
- Crunchy Data, Citus/Microsoft, EDB, and independent practitioner blog posts (Xata, thebuild.com, dev.to) on lock queue behavior, `lock_timeout`, and table-rewrite triggers — HIGH confidence (corroborated across multiple independent sources describing the same documented Postgres locking mechanism).
- Squawk (squawkhq.com) documentation on the `NOT VALID` constraint pattern and its own parser-based (not regex-based) architecture — HIGH confidence (widely-used, open-source Postgres migration linter, cited as the credible-tool baseline).
- Community writeups on `pg_dump`/`pg_restore` failure modes (SimpleBackups, Seedfast, Vucense, Netguru) — MEDIUM confidence (practitioner-sourced, consistent with official `pg_restore`/`pg_dumpall` documentation on scope of what a dump does and does not include).
- Coolify official docs (`coolify.io/docs`) and Coolify GitHub issues (`coollabsio/coolify` #5099, #5343, #3474, #7279) on volume recreation, Docker cleanup interaction, and version-upgrade handling — MEDIUM confidence (primary-source project issues/docs, but Coolify evolves quickly and specific behavior should be re-verified against the version actually deployed before Phase 5).
- Drizzle ORM official docs (`orm.drizzle.team`) and practitioner guides on `push` vs. `generate`/`migrate` semantics and journal/drift mechanics — MEDIUM confidence (official docs plus consistent practitioner corroboration; tooling is actively evolving).
- AI-agent-specific hazards (D1–D5) are synthesized from the documented mechanics above applied to this project's specific brief and constraints (PROJECT.md, original-brief.md) rather than a single external source — treat as reasoned inference at HIGH confidence in the underlying Postgres/Drizzle mechanics, MEDIUM confidence in the specific agent-behavior framing.

---
*Pitfalls research for: PostgreSQL migration-safety automation (solo founder, AI-agent-operated, self-hosted on Coolify/Hetzner)*
*Researched: 2026-09-06*
