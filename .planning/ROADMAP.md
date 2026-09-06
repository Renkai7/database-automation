# Roadmap: Database Deployment Automation

## Overview

This project builds a safety pipeline for PostgreSQL schema changes, bottom-up: prove the
local development loop and disaster recovery first, then build and adversarially test the
classifier that decides SAFE / REVIEW REQUIRED / BLOCKED, then the runner that enforces that
verdict at the only non-bypassable point, then wire that into a CI gate nobody can click
around, then extend reach to staging over a private connection, and finally to production
behind an honestly-described self-approval gate and a complete audit trail. Every stage is
proven at a point where failure is free before it is relied on at a point where failure is
expensive. A greenfield recipe application rides along as the schema-churn fixture that
exercises the SAFE, REVIEW REQUIRED, and BLOCKED paths — including one real
expand-and-contract migration — it is test material, not a deliverable in its own right.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

- [ ] **Phase 1: Local Environment** - A disposable local Postgres dev loop works end-to-end, and the database can be destroyed and rebuilt in one command
- [ ] **Phase 2: Backup & Restore Drill** - The owner has personally destroyed and restored real data, timed it, and an automated restore test proves it against a genuinely fresh instance
- [ ] **Phase 3: Safety Analyzer** - Migration SQL is parsed and classified SAFE / REVIEW REQUIRED / BLOCKED, proven against adversarial fixtures
- [ ] **Phase 4: Migration Runner & History Tests** - A runner re-derives classification at execution time, and the full migration history is proven consistent
- [ ] **Phase 5: CI Pipeline Gate** - A destructive migration cannot merge — not even by the repository owner
- [ ] **Phase 6: Private Staging Connectivity** - CI and the dev machine reach staging with zero inbound ports, and the open connectivity decision is resolved and verified
- [ ] **Phase 7: Production Runner, Environment Gate & Audit Log** - Schema changes reach production under supervision, behind an honestly-described self-approval gate and a complete audit trail

## Phase Details

### Phase 1: Local Environment

**Goal**: The owner has a disposable local Postgres environment for schema work: a Drizzle schema edit becomes an applied migration, the recipe app boots against it, Claude Code queries the database directly with no Coolify terminal relaying, and the database can be destroyed and rebuilt in one command. (Includes a brief non-blocking investigation into why past production redeploys were needed so often, so the later startup-migration fix addresses the real cause rather than an assumed one.)
**Depends on**: Nothing (first phase)
**Requirements**: ENV-01, ENV-02, ENV-03, ENV-04, ENV-05, APP-01
**Success Criteria** (what must be TRUE):

  1. `docker compose up` brings up a PostgreSQL 17 container matching production's extensions; every environment (local/staging/production) has its own distinctly-named connection variable so no generic variable can silently point at the wrong one; and Claude Code queries the local database directly, with no command relayed through a Coolify terminal.
  2. A schema edit to the recipe app's Drizzle schema, run through the documented loop, produces a migration, applies locally, and the app boots against the resulting schema.
  3. The destroy-and-rebuild command tears down and recreates the local database in one step, leaving a clean, freshly-migrated schema with no manual cleanup.

**Plans**: 5 plans

Plans:
**Wave 1**

- [ ] 01-01-PLAN.md — Workspace, PostgreSQL 17 container, connection-variable template, and the timeboxed redeploy investigation

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 01-02-PLAN.md — Tracer: one seeded recipe reaches an HTTP response, plus the environment-safety module

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 01-03-PLAN.md — Full recipe core schema, deterministic seed, and the blocking schema apply

**Wave 4** *(blocked on Wave 3 completion)*

- [ ] 01-04-PLAN.md — Direct database access (`db:query`), one-command destroy and rebuild (`db:reset`), and the guardrail suite

**Wave 5** *(blocked on Wave 4 completion)*

- [ ] 01-05-PLAN.md — Port the Recipe Page to real rows, plus not-found and error paths

### Phase 2: Backup & Restore Drill

**Goal**: The owner has personally proven — by destroying and restoring real data — that backups actually work, timed the procedure, and written the runbook from what actually happened. An automated restore test asserts real content against a genuinely fresh instance, not just an exit code.
**Depends on**: Phase 1
**Requirements**: BKP-01, BKP-02, BKP-03, BKP-04, BKP-05, BKP-06, BKP-07, BKP-08
**Success Criteria** (what must be TRUE):

  1. The owner has personally dropped a real table, restored using a backup that included both the `pg_dumpall --globals-only` roles dump and the data dump, confirmed the table's data returned, and timed the whole procedure — writing the runbook from what actually happened, not from documentation written in advance.
  2. An automated restore test runs against a genuinely fresh (never pre-seeded) disposable database matching production's image and extensions, asserts row counts, referential integrity, and spot-checked values rather than trusting an exit code, and its pass/fail/skipped status is visibly reported — not silently swallowed.

**Plans**: TBD

### Phase 3: Safety Analyzer

**Goal**: Every migration's SQL is classified SAFE, REVIEW REQUIRED, or BLOCKED by parsing real Postgres grammar, and the classifier has been shown — by deliberate attack — to resist being fooled in either direction.
**Depends on**: Phase 2
**Requirements**: ANLZ-01, ANLZ-02, ANLZ-03, ANLZ-04, ANLZ-05, ANLZ-06, ANLZ-07
**Success Criteria** (what must be TRUE):

  1. Feeding the analyzer a real `DROP TABLE` statement returns BLOCKED, and feeding it a genuinely safe migration (e.g. an additive nullable column) returns SAFE — demonstrated by an automated test, not by reading the code.
  2. The same statement type is classified differently based on context: a volatile `ADD COLUMN ... DEFAULT` is flagged differently than a non-volatile one, and a `NOT VALID` constraint followed by `VALIDATE CONSTRAINT`, or an index built `CONCURRENTLY`, is recognized as its safe form rather than matched on keyword alone.
  3. Adversarial fixtures — a `DROP TABLE` hidden inside a SQL comment, inside a dollar-quoted string, inside a `DO` block, and inside a function body — are fed to the analyzer, and none of them produce an incorrect classification in either direction: a real drop hidden this way is still caught, and a comment merely mentioning "DROP TABLE" is not falsely flagged.
  4. Every classification rule lives in a schema-validated rules file; adding or changing a rule means editing that data file, not the classifier's code, and an invalid rules file fails validation rather than being silently accepted.
  5. Running the same corpus of migrations through the analyzer and through `squawk-cli` produces a comparison report, and every disagreement between the two has been examined and explained.

**Plans**: TBD

### Phase 4: Migration Runner & History Tests

**Goal**: Migrations execute only under a runner that re-derives its own verdict from the actual SQL immediately before running it, refuses anything BLOCKED with no override, and the full migration history is proven consistent against both an empty and an existing database.
**Depends on**: Phase 3
**Requirements**: RUN-01, RUN-02, RUN-03, RUN-04, RUN-05, RUN-06, RUN-07, RUN-08, APP-02
**Success Criteria** (what must be TRUE):

  1. A migration classified SAFE upstream but altered afterward to contain a BLOCKED operation is still refused at execution — proving the runner re-parses and re-classifies the actual SQL rather than trusting an earlier verdict — and there is no flag, override, or config path that lets a BLOCKED migration execute.
  2. Every migration executes under `lock_timeout` and `statement_timeout`: a deliberately slow-locking migration times out and fails cleanly instead of hanging, while a migration containing `CREATE INDEX CONCURRENTLY` still succeeds — proving statements aren't force-wrapped into one transaction that would break it.
  3. Applying the full migration history to an empty database, and applying only the newest migration to an existing already-migrated database, both produce the expected schema automatically in an automated test, and the recipe app starts successfully against the result.
  4. A migration deliberately made to fail partway through leaves a state that is reported clearly rather than silently marked applied, and recovering from it never requires hand-editing `_journal.json`.
  5. Running a real recipe-app schema change of each kind — one that lands SAFE, one REVIEW REQUIRED, one BLOCKED — through the runner produces the expected outcome for each.

**Plans**: TBD

### Phase 5: CI Pipeline Gate

**Goal**: A pull request containing a destructive migration cannot be merged — not because CI fails quietly, but because the repository owner is structurally unable to click around it.
**Depends on**: Phase 4
**Requirements**: CI-01, CI-02, CI-03, CI-04, CI-05, CI-06
**Success Criteria** (what must be TRUE):

  1. A pull request is opened containing a migration the analyzer classifies BLOCKED; the required check fails, and the repository owner — using their own admin/owner permissions — is unable to merge it, because the branch ruleset's bypass list is empty.
  2. Every pull request's required checks run the analyzer, both migration history test axes (empty-database and existing-database), and the application test suite, and the PR itself shows the safety classification and the reasoning behind it directly on the PR — not only buried in a build log.
  3. A migration file is hand-edited after being generated, or an edit is made to a migration that a previous merge already applied — each is caught mechanically by a CI check and fails the build, without relying on a reviewer noticing.
  4. Inspecting the CI workflow shows migrations run as their own isolated pipeline step, invoked by the pipeline — never triggered by the application container starting up.

**Plans**: TBD

### Phase 6: Private Staging Connectivity

**Goal**: CI and the development machine can reach staging Postgres over a private path with zero inbound ports opened on the server, and the open question of which mechanism to use (Decision D4) is resolved and verified against the owner's actual Coolify instance — not assumed from community reports.
**Depends on**: Phase 5
**Requirements**: CONN-01, CONN-02, CONN-03, CONN-04, CONN-05
**Success Criteria** (what must be TRUE):

  1. Decision D4 (Tailscale subnet-route vs. restricted SSH tunnel) is resolved with a documented choice and rationale, verified hands-on against this specific Coolify instance's actual networking and volume/backup behavior rather than taken on community reports alone.
  2. CI can connect to and query staging Postgres, and so can the development machine, while a check of the server confirms no new inbound database port is open and the "Publicly Accessible" toggle for the database remains off.
  3. Running `drizzle-kit push` from a developer machine against the staging connection variable fails or is structurally impossible — proven by attempting it — while it continues to work normally against the local development container.
  4. A schema change merged to the staging branch/pipeline reaches the staging database automatically, with no application redeploy and no one pasting a command into a Coolify terminal, using a migration credential that is different from — and more restricted than — the application's own runtime database credential.

**Plans**: TBD

### Phase 7: Production Runner, Environment Gate & Audit Log

**Goal**: A schema change reaches production through the same gated pipeline proven in staging, with no application redeploy, a REVIEW REQUIRED migration pausing for a deliberate — if solo — decision, and a complete, secret-free audit trail plus status view that lets the owner supervise rather than operate.
**Depends on**: Phase 6
**Requirements**: PROD-01, PROD-02, PROD-03, PROD-04, PROD-05, PROD-06, AUD-01, AUD-02, AUD-03, AUD-04, APP-03
**Success Criteria** (what must be TRUE):

  1. The production migration credential exists only in the production secret store — grepping the local machine's environment files, shell history, and any agent context/config finds it nowhere, it is never visible to Claude Code — and every migration attempt in every environment, including blocked and failed ones, is recorded with migration id, git commit, environment, result, classification, and timestamp, with no secret or credential findable anywhere in the record or its logging.
  2. A REVIEW REQUIRED migration halts before touching production and presents the diff, the reason it was flagged, the staging result, and current backup status together in one place; the owner has verified — against this repository's actual GitHub plan tier — whether environment-protection bypass can be fully disabled and documented the result either way; the approval step is completed by the owner themself, described plainly as self-approval that buys deliberation with assembled context, not independent review.
  3. A schema change reaches production with no application redeploy; CI has committed a `pg_dump --schema-only` snapshot of production so the real schema can be inspected without anyone holding a production credential; and a production migration deliberately made to fail halts the deployment rather than continuing on top of a broken schema.
  4. The owner can open one status view combining safety classification, dev/staging/test results, backup status, production readiness, and a live per-rule override-frequency count — so a rule being routinely overridden becomes visible rather than a silent habit.
  5. At least one real schema change to the recipe app — for example, dropping a column still in use — ships as an expand step in one release and a contract step in a later release rather than as a single destructive migration, traced through the full pipeline into production.

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Local Environment | 0/5 | Planned | - |
| 2. Backup & Restore Drill | 0/TBD | Not started | - |
| 3. Safety Analyzer | 0/TBD | Not started | - |
| 4. Migration Runner & History Tests | 0/TBD | Not started | - |
| 5. CI Pipeline Gate | 0/TBD | Not started | - |
| 6. Private Staging Connectivity | 0/TBD | Not started | - |
| 7. Production Runner, Environment Gate & Audit Log | 0/TBD | Not started | - |
