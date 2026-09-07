# Requirements: Database Deployment Automation

**Defined:** 2026-09-06
**Core Value:** A schema change reaches production without anyone hand-running SQL, and no AI mistake can destroy production data — because the architecture prevents it, not because anyone remembered to be careful.

## v1 Requirements

### Environment (ENV)

- [x] **ENV-01**: Development PostgreSQL runs as a local Docker container pinned to PostgreSQL 17, including any extensions production will use
- [x] **ENV-02**: A Drizzle schema edit can be turned into a generated migration, inspected, and applied locally in one documented loop
- [x] **ENV-03**: Connection variables are named per environment, so no single generic variable can silently point at the wrong database
- [x] **ENV-04**: The development database can be destroyed and rebuilt from scratch with one command
- [x] **ENV-05**: Claude Code can query and inspect the development database directly, with no manual relaying of commands through a Coolify terminal

### Backup and Restore (BKP)

- [ ] **BKP-01**: The owner has personally performed and timed a full backup and restore at least once
- [x] **BKP-02**: The backup procedure captures roles and globals separately via `pg_dumpall --globals-only`, not only a database dump
- [x] **BKP-03**: Restore drills target a genuinely fresh instance matching the production image and extensions — never a pre-seeded container
- [x] **BKP-04**: Restore verification asserts content — row counts, spot-checked values, referential integrity, sequence state — and never treats an exit code as proof
- [ ] **BKP-05**: A deliberate destruction test has been performed: drop a table, restore, confirm the data returned
- [ ] **BKP-06**: A restore runbook exists, written from an actual performed restore rather than from documentation
- [x] **BKP-07**: An automated restore test runs against a disposable database and reports pass or fail
- [x] **BKP-08**: A skipped or failing restore drill is visible, not silent

### Safety Analyzer (ANLZ)

- [ ] **ANLZ-01**: Migration SQL is parsed into an operation list using `libpg-query`, the real PostgreSQL parser — never regex or string matching
- [ ] **ANLZ-02**: Every operation is classified SAFE, REVIEW REQUIRED, or BLOCKED
- [ ] **ANLZ-03**: Classification rules are data (a schema-validated rules file), extensible without changing code
- [ ] **ANLZ-04**: Classification is context-aware: it distinguishes volatile from non-volatile `ADD COLUMN` defaults, and recognises the `NOT VALID` + `VALIDATE CONSTRAINT` and `CONCURRENTLY` safe forms rather than matching on statement keywords
- [ ] **ANLZ-05**: The analyzer test suite includes adversarial fixtures — comments, dollar-quoted strings, `DO` blocks, and function bodies — proving it cannot be fooled in either direction
- [ ] **ANLZ-06**: Analyzer output is cross-checked against `squawk-cli` on a shared corpus, with disagreements investigated
- [ ] **ANLZ-07**: A real `DROP TABLE` is blocked and a genuinely safe migration passes — demonstrated by test, not asserted

### Migration Runner (RUN)

- [ ] **RUN-01**: The runner re-derives classification by parsing the actual SQL immediately before executing it, never trusting a verdict computed upstream
- [ ] **RUN-02**: A BLOCKED classification is refused at execution with no override path
- [ ] **RUN-03**: Every migration execution is wrapped with `lock_timeout` and `statement_timeout`
- [ ] **RUN-04**: Statements are not forced into a single transaction where doing so would break `CREATE INDEX CONCURRENTLY` and similar safe forms
- [ ] **RUN-05**: An empty database plus the full migration history produces the expected schema, verified automatically
- [ ] **RUN-06**: An existing database plus only the new migration applies cleanly, verified automatically
- [ ] **RUN-07**: The application starts successfully against the resulting schema
- [ ] **RUN-08**: A partially failed migration leaves a recoverable, clearly reported state — no silent journal manipulation

### Pipeline Gate (CI)

- [ ] **CI-01**: Every pull request runs the analyzer, both migration test axes, and the application tests
- [ ] **CI-02**: A BLOCKED classification fails the build
- [ ] **CI-03**: The gate is enforced by a GitHub repository ruleset with an empty bypass list, so it cannot be waved through by the repository owner
- [ ] **CI-04**: The safety classification and its reasoning are surfaced on the pull request itself
- [ ] **CI-05**: Hand-edited migration files, and edits to already-applied migrations, are detected mechanically
- [ ] **CI-06**: Migrations run as their own pipeline step and never at application startup

### Connectivity (CONN)

- [ ] **CONN-01**: Staging PostgreSQL is reachable from CI and from the development machine with no inbound port opened on the server
- [ ] **CONN-02**: Coolify's public-port toggle is never enabled for any database
- [ ] **CONN-03**: `drizzle-kit push` is structurally restricted to the local development container and cannot reach a shared database
- [ ] **CONN-04**: A schema change reaches staging through the pipeline with no application redeploy and no manual terminal use
- [ ] **CONN-05**: Application runtime and migration execution use separate credentials with different privileges

### Production (PROD)

- [ ] **PROD-01**: The production migration credential exists only in the production secret store — never on the local machine and never in an agent's context
- [ ] **PROD-02**: A REVIEW REQUIRED migration pauses for explicit approval, presented with assembled context: the diff, the reason it was flagged, the staging result, and current backup status
- [ ] **PROD-03**: Production schema changes apply without an application redeploy
- [ ] **PROD-04**: CI commits a `pg_dump --schema-only` snapshot of production to the repository, so the real schema can be reasoned about without any production credential
- [ ] **PROD-05**: A failed production migration halts the deployment when continuing would be unsafe
- [ ] **PROD-06**: The owner can see a single status summary — safety classification, development, staging, tests, backup, production readiness — and supervise rather than operate

### Audit (AUD)

- [ ] **AUD-01**: Every migration attempt is recorded, including blocked and failed ones — not only successes
- [ ] **AUD-02**: Each record carries migration identifier, git commit, environment, result, safety classification, and timestamp
- [ ] **AUD-03**: No secrets or database credentials appear in any log or audit record
- [ ] **AUD-04**: Override frequency per rule is visible, so a rule being routinely overridden prompts fixing the rule rather than becoming a silent habit

### Recipe App Fixture (APP)

The recipe app is a thin test fixture. These requirements exist to exercise the pipeline, not to build a product.

- [ ] **APP-01**: A minimal recipe schema exists and the application boots against it
- [ ] **APP-02**: The schema evolves through a sequence of real changes that exercise the SAFE, REVIEW REQUIRED, and BLOCKED paths
- [ ] **APP-03**: At least one expand-and-contract change is carried out across multiple releases rather than as a single destructive migration

## v2 Requirements

Acknowledged and deliberately deferred. Not in the current roadmap.

### Advanced Analysis

- **ADV-01**: Trace-based lock verification — execute a migration against a disposable database and record the locks actually taken (eugene-style), rather than reasoning statically
- **ADV-02**: Schema drift detection between the committed migration history and a live environment
- **ADV-03**: `pgroll`-style tooling support for expand-and-contract migrations

### Platform

- **PLAT-01**: Extraction into a reusable package a second application can adopt via a small config file
- **PLAT-02**: Per-application migration policy configuration
- **PLAT-03**: Support for applications beyond the recipe fixture

## Out of Scope

| Feature | Reason |
|---------|--------|
| Automatic down-migrations / rollback scripts | Cannot represent post-migration data; untested paths fail under pressure. Strategy is backwards-compatible migrations, backups, and forward fixes. Confirmed as an anti-feature across every tool researched. |
| Migrations at application startup | Causes multi-instance races and bypasses the gating pipeline entirely. This is the direct cause of the redeploy problem the project exists to fix. |
| Blanket blocking of all `ALTER` statements | Produces review fatigue and rubber-stamping, which makes the gate decorative. Classification must be context-aware instead. |
| Wrapping all migration statements in one transaction | Hard-breaks `CREATE INDEX CONCURRENTLY` and similar safe forms. |
| Atlas as the analysis engine | Its PostgreSQL destructive-change analyzers moved behind a paid tier in late 2025 — precisely the capability we would adopt it for. |
| Drizzle v1.0 release-candidate line | Removes `_journal.json`, which the audit-trail requirement depends on. Pin the stable 0.x line. |
| `pg-mem` for migration testing | Not a real PostgreSQL engine, so it cannot prove real migration behaviour. |
| Production database access from the local machine | Architecturally excluded, not deferred. Visibility comes from committed schema snapshots. |
| Retrofitting the existing SaaS applications | Out of scope for v1. Revisit once the pipeline is proven. |
| Policy-as-code layer | Unnecessary complexity for a single project and a single operator. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| ENV-01 … ENV-05 | Phase 1 | Complete — verified 2026-09-07 (UAT 5/5, security threats_open: 0) |
| APP-01 | Phase 1 | Complete — verified 2026-09-07 (UAT 5/5, security threats_open: 0) |
| BKP-01 … BKP-08 | Phase 2 | Pending |
| ANLZ-01 … ANLZ-07 | Phase 3 | Pending |
| RUN-01 … RUN-08 | Phase 4 | Pending |
| APP-02 | Phase 4 | Pending |
| CI-01 … CI-06 | Phase 5 | Pending |
| CONN-01 … CONN-05 | Phase 6 | Pending |
| PROD-01 … PROD-06 | Phase 7 | Pending |
| AUD-01 … AUD-04 | Phase 7 | Pending |
| APP-03 | Phase 7 | Pending |

**Coverage:**

- v1 requirements: 52 total
- Mapped to phases: 52 ✓
- Unmapped: 0 ✓

---
*Requirements defined: 2026-09-06*
*Last updated: 2026-09-07 after 01-08 gap-closure work — the two Phase 1 traceability rows now
carry one identical status ("Gap closure done — awaiting re-verification") instead of
contradicting each other; no requirement checkbox above was ticked, since that status names
work pending re-verification, not verified completion. Previously updated 2026-09-06 after
roadmap revision (Phase 1 split into Phase 1 + Phase 2; downstream phases renumbered 3-7; 100%
coverage preserved).*
