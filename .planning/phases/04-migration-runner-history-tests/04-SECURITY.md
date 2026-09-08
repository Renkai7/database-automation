---
phase: "04"
slug: "migration-runner-history-tests"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-09-08"
---

# Phase 4 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

**Register origin:** authored at plan time. All seven `04-0N-PLAN.md` files carried a
parseable `<threat_model>` block, so this audit **verifies mitigations against the
implementation** — it does not construct a register retroactively.

**Verification depth:** ASVS L1 (`workflow.security_asvs_level: 1`). Each mitigation was
confirmed to exist in the named source file at grep depth. L1 does not include L2
boundary-placement analysis or L3 end-to-end trace verification.

**Blocking threshold:** `workflow.security_block_on: high` — open threats at `high` or
`critical` block phase advancement.

---

## Trust Boundaries

Consolidated from the seven plan threat models.

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| migration `.sql` file → runner | An AI agent (or `drizzle-kit generate`) authors this SQL; it is untrusted input to the execution engine. | Arbitrary DDL/DML |
| migration SQL → inspector | Untrusted SQL parsed into `StatementFacts` by the real Postgres grammar. | Parsed AST |
| `DO` block / function body → recursive inspector | SQL nested one level down, where a keyword scanner would not look. | Nested SQL text |
| `rules.json` → classifier | The rules file is editable data; the D-02/D-07/D-17 floor is what keeps that safe. | Rule definitions |
| parsed facts → transaction policy | The only input allowed to change whether a `BEGIN` is issued. | `Finding[]` |
| runner → development PostgreSQL | The only point at which schema state reaches the database. | DDL statements, credentials |
| runner connection → PostgreSQL lock manager | Where an unbounded lock wait would become an outage. | Lock requests |
| unwrapped statement execution → ledger insert | The one window where execution and recording are not atomic. | In-flight marker row |
| `runner.migration_runs` → the next run's decision to proceed | A row in the database gates every subsequent migration. | Run state, error messages |
| `RECIPE_DEV_DATABASE_URL` (`.env`) → `scripts/db-migrate.ts` | An environment value crosses into a process that opens a connection and executes DDL. | Connection string (secret) |
| `process.argv` → migrate / recover commands | Command-line input crosses into a process that reads a migrations directory. | Flag values (never a DB target) |
| test harness → Testcontainers PostgreSQL | The harness constructs the connection from discrete fields; nothing outside it can supply one. | Throwaway credentials |
| `docs/migration-history-status.json` → `pnpm test` | A committed file is trusted as evidence by the default suite. | Suite outcome record |
| operator → `pnpm db:migrate:recover` | A human decides that an unknown database state has been resolved. | Marker resolution |
| committed migrations directory → every future `pnpm db:reset` | Anything left behind here is replayed on every rebuild forever. | Migration bytes |
| `docs/` → future readers | Documentation is a deliverable in this project; a false claim here is a real defect. | Operational claims |

---

## Threat Register

55 threats, consolidated across seven plans. 47 `mitigate`, 8 `accept`. All closed.

### From 04-01 (migration runner core)

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-04-01 | Tampering | migration file altered between classification and execution | critical | mitigate | Verified: `run-migrations.ts` performs no filesystem read; the single read is `drizzle-migrations.ts:105`, and the same `file.sql` string reaches `analyzeSql` (`:312`) and `splitStatements` (`:140`). | closed |
| T-04-02 | Elevation of Privilege | a caller supplies a flag/env/config that lets BLOCKED through | critical | mitigate | Verified: `RunMigrationsOptions` is exactly `{migrations, rules, now?}` (`run-migrations.ts:47-51`); `db-migrate.ts` `parseArgs` accepts only `--migrations-dir` and rejects all else via `ONLY_ACCEPTED_FLAG_MESSAGE`. | closed |
| T-04-03 | Tampering | a second, ungated route applies schema state (drizzle-kit's own `migrate`) | high | mitigate | Verified: `tests/guardrails.test.ts:317` asserts the runtime-concatenated `drizzle-kit migrate` token appears in no source-surface file; the `push` equivalent is asserted at `:125`. | closed |
| T-04-04 | Denial of Service | a migration takes an unbounded lock and blocks the application | high | mitigate | Verified: `RUNNER_CONNECTION_OPTIONS` applies both GUCs as libpq startup options (`timeouts.ts:36`); `pg_settings` is re-queried (`:52`, never `SHOW`) and `REFUSED_TIMEOUTS_NOT_IN_EFFECT` (exit 71) refuses otherwise. | closed |
| T-04-05 | Information Disclosure | a connection string or role password reaches stdout/stderr or a stored row | high | mitigate | Verified: `safeErrorMessage` (`scripts/log.ts:13`) is used on 47 error paths across `packages/automation/src` and `scripts`; `runner.migration_runs` has no credential-capable column. | closed |
| T-04-06 | Repudiation | a migration applies without an accurate record of what it was and why it was allowed | high | mitigate | Verified: `insertLedgerRow` (`run-migrations.ts:178`) lands between `BEGIN` (`:166`) and `COMMIT` (`:180`); `recordRunEntry` writes findings, state, statement count and timing. | closed |
| T-04-07 | Spoofing | the runner connects to a database other than the pinned development target | high | mitigate | Verified: `db-migrate.ts` calls `assertLocalDevelopmentTarget` on the URL before any connection, then `assertDevelopmentDatabase` on the live client; `guardrails.test.ts:361` asserts the call is mandatory across the surface. | closed |
| T-04-08 | Tampering | `drizzle.__drizzle_migrations` drifts from drizzle's own format | medium | mitigate | Verified: `migrationHash` is `sha256` over the whole raw file text (`ledger.ts:16`); `insertLedgerRow` documents `createdAtMillis` as the journal `when`, never `Date.now()` (`:41-42`). | closed |
| T-04-09 | Denial of Service | the process crashes on Windows after WASM parses, masking the real outcome | medium | mitigate | Verified: `run(): Promise<number>` (`db-migrate.ts:65`) with `process.exitCode` assigned once (`:125`, `:129`); no `process.exit(` call on the path. | closed |
| T-04-10 | Tampering | npm dependency substitution | low | accept | AR-01 — plan installs zero new packages. | closed |

### From 04-02 (timeout-disarm detection and rule floor)

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-04-11 | Elevation of Privilege | a migration disarms `lock_timeout`/`statement_timeout` to force an unbounded operation through | high | mitigate | Verified: `disarmsTimeout` fact emitted for `SetGuc`/`AlterSystem`/`AlterDatabaseSet`/`AlterRoleSet` (`inspect.ts:470-514`); `D17_FLOOR_FACTS` (`floor.ts:66-70`) is a `FLOOR_GROUPS` member, so `assertFloorNotWeakened` refuses to run on a weakened rules file. | closed |
| T-04-12 | Tampering | a rules-file edit weakens the new floor member | high | mitigate | Verified: `assertFloorNotWeakened` re-derives through the real `classifyFacts` (`floor.ts:100-104`); `timeout-disarm-floor.test.ts` covers weakened verdict (`:97`), deleted row (`:108`) and enumeration-blanket-SAFE (`:117`). | closed |
| T-04-13 | Tampering | a disarming statement hidden inside a `DO` block or function body | high | mitigate | Verified: committed adversarial fixture `corpus/adversarial/set-lock-timeout-in-do-block.sql` exercises D-05's recursion. | closed |
| T-04-14 | Spoofing | a comment or dollar-quoted string merely mentioning a disarm is falsely flagged | medium | mitigate | Verified: matched false-positive partner fixture `corpus/adversarial/comment-mentions-set-lock-timeout.sql`. | closed |
| T-04-15 | Elevation of Privilege | a new `StatementFacts` field ships without its canary, reopening the blanket-SAFE exploit | high | mitigate | Verified: `rules-catalogue.test.ts:453` walks `Object.keys(EMPTY_FACTS)` and fails on any field lacking a canary. | closed |
| T-04-16 | Tampering | `RESET ALL` bypasses a name-matching disarm rule | high | mitigate | Verified: `inspect.ts:455` returns `true` from the `VAR_RESET_ALL` branch without reading `name`; `corpus/blocked/reset-all.sql` pins the verdict. | closed |
| T-04-17 | Tampering | npm dependency substitution | low | accept | AR-02 — plan installs zero new packages. | closed |

### From 04-03 (migration-history test suite)

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-04-18 | Tampering | a migration approved upstream is altered before execution | critical | mitigate | Verified: `tests/history/tamper-then-refuse.test.ts` present, asserting refusal against a real container rather than a thrown error alone. | closed |
| T-04-19 | Repudiation | the history suite's result is claimed rather than recorded | high | mitigate | Verified: `scripts/history-status.ts` defines a zod-validated record; `assertHistoryStatusPassed` (`:127`) hard-fails on missing/malformed/never-run/FAIL. Committed record reads `outcome: PASS`. | closed |
| T-04-20 | Spoofing | a suite that never ran is reported as passing | high | mitigate | Verified: `lastRunAt: z.string().nullable()` (`:39`) with a distinct null failure path (`:132-134`); `runHistorySuite` writes nothing when vitest could not start. | closed |
| T-04-21 | Tampering | a history test accidentally targets the developer's real database | high | mitigate | Verified: no `RECIPE_DEV_DATABASE_URL` read anywhere under `tests/history/`; `getConnectionUri` appears only in prohibition comments — every client is built from discrete container fields (`support.ts:46`). | closed |
| T-04-22 | Tampering | the tamper fixture mutates the committed migrations directory | medium | mitigate | Verified: `mkdtempSync` copy (`tamper-then-refuse.test.ts:42`); `git status --porcelain apps/recipe-app/drizzle` is empty at audit time. | closed |
| T-04-23 | Information Disclosure | a container password or connection string reaches test output | medium | mitigate | Verified: `randomBytes(24)` throwaway passwords (`support.ts:29`); no connection-string literal in the history files. | closed |
| T-04-24 | Denial of Service | a failed assertion leaks a running container | low | mitigate | Verified: container stop and temp-directory removal in `finally` blocks. | closed |
| T-04-25 | Tampering | npm dependency substitution | low | accept | AR-03 — no new packages; `@testcontainers/postgresql` 12.1.0 and `vitest` 5.0.0 legitimacy-checked in earlier phases. | closed |

### From 04-04 (transaction policy and timeout enforcement)

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-04-26 | Denial of Service | a migration waits indefinitely on a lock | high | mitigate | Verified: `lock_timeout` applied at connect and re-checked against `pg_settings`; `tests/history/timeouts-and-concurrently.test.ts` proves a real competing lock fails within a bounded window. | closed |
| T-04-27 | Tampering | a migration author changes the wrap decision via comment directive or filename | high | mitigate | Verified: `decideTransactionPolicy(findings: Finding[])` (`transaction-policy.ts:56`) takes no other input; the runner holds no keyword list. | closed |
| T-04-28 | Tampering | a file mixing hostile and ordinary statements half-applies | high | mitigate | Verified: `MixedTransactionFileError` thrown at `transaction-policy.ts:67` and handled at `run-migrations.ts:113` — before `splitStatements`/execution (`:105` comment). | closed |
| T-04-29 | Repudiation | a statement fails but the migration is recorded as applied | high | mitigate | Verified: `RunEntryState` includes `failed` with a nullable `statement_index` column (`runner-table.ts:22`, `:34`, `:55`); no ledger row is inserted on the failure path. | closed |
| T-04-30 | Denial of Service | the runner silently grants unbounded runtime to a class of statement | medium | mitigate | Verified: exactly one pair of constants — `LOCK_TIMEOUT_MS = 3000`, `STATEMENT_TIMEOUT_MS = 30000` (`timeouts.ts:26`, `:30`); no exemption path. | closed |
| T-04-31 | Information Disclosure | a lock-timeout error message carries connection details into the run record | medium | mitigate | Verified: `error_message` populated through `safeErrorMessage` only. | closed |
| T-04-32 | Tampering | npm dependency substitution | low | accept | AR-04 — plan installs zero new packages. | closed |

### From 04-05 (partial-failure markers and recovery)

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-04-33 | Repudiation | a partially applied migration is later recorded, or read, as fully applied | high | mitigate | Verified: `writeInFlightMarker` issued BEFORE the unwrapped statement and resolved only after the ledger row lands (`runner-table.ts:246-258`). | closed |
| T-04-34 | Tampering | later migrations are applied on top of an unknown database state | high | mitigate | Verified: `readUnresolvedMarkers` throws `UnresolvedMarkersError` carrying every offending marker (`runner-table.ts:127-145`), refusing the whole run before classification. | closed |
| T-04-35 | Elevation of Privilege | the safety tool acquires destructive capability by repairing schema on its own initiative | high | mitigate | Verified: `guardrails.test.ts:283` asserts `db-migrate-recover.ts` references neither `_journal.json` nor `DROP INDEX` nor `process.exit`. | closed |
| T-04-36 | Tampering | recovery is used to make an inconvenient record disappear | medium | mitigate | Verified: `resolveMarker` updates `state`/`finished_at` and never deletes; no `DELETE` statement exists in `runner-table.ts` (`:337` documents the invariant). | closed |
| T-04-37 | Spoofing | the recovery command is pointed at a database other than the pinned development one | high | mitigate | Verified: `assertLocalDevelopmentTarget` (`db-migrate-recover.ts:100`) then `assertDevelopmentDatabase` (`:105`) before any read; no argument or prompt input. | closed |
| T-04-38 | Information Disclosure | a stored `error_message` or printed report carries a credential | medium | mitigate | Verified: `safeErrorMessage` on every path; fast-suite leak assertion in `tests/db-migrate-recover.test.ts`. | closed |
| T-04-39 | Denial of Service | two concurrent runner invocations interleave against the same database | medium | accept | AR-05 — recorded as a `backstop` truth, deferred to Phase 7. Below the `high` blocking threshold. | closed |
| T-04-40 | Tampering | npm dependency substitution | low | accept | AR-06 — plan installs zero new packages. | closed |

### From 04-06 (schema change through the gated path)

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-04-41 | Tampering | schema state reaches the database through a direct schema-sync command | high | mitigate | Verified: `guardrails.test.ts:125` asserts the `drizzle-kit push` token's absence across the source surface. | closed |
| T-04-42 | Tampering | a generated migration is hand-edited after generation | high | mitigate | Verified: the backfill is its own file (`0003_backfill_steps_timer_label.sql`) with its own journal entry and snapshot, separate from the drizzle-generated `0004_redundant_apocalypse.sql`. | closed |
| T-04-43 | Tampering | an applied, committed migration's bytes are changed | high | mitigate | Verified: `git status --porcelain apps/recipe-app/drizzle` is empty — `0000_bumpy_khan.sql` and `0001_busy_thunderbolt.sql` unmodified; corpus manifest pins 7 verdicts. | closed |
| T-04-44 | Denial of Service | `SET NOT NULL` fails against real NULL rows, leaving the database mid-change | high | mitigate | Verified: journal order places the backfill `UPDATE steps SET timer_label = '' WHERE timer_label IS NULL` (0003) strictly before `ALTER COLUMN ... SET NOT NULL` (0004). | closed |
| T-04-45 | Repudiation | the demonstration is claimed rather than observed | medium | mitigate | Verified: verbatim runner output committed to `docs/30-migration-runner.md`; verdicts pinned in the corpus manifest. | closed |
| T-04-46 | Information Disclosure | a credential is pasted into the new documentation | medium | mitigate | Verified: no `postgres://`/`postgresql://` prefix and no password literal in `docs/30-migration-runner.md`; the file states the invariant at `:342`. | closed |
| T-04-47 | Tampering | npm dependency substitution | low | accept | AR-07 — no new packages; `drizzle-kit` 0.31.10 already pinned. | closed |

### From 04-07 (blocked-migration demonstration and documentation)

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-04-48 | Tampering | a BLOCKED migration left in committed history and replayed by every rebuild | critical | mitigate | Verified: `git status --porcelain apps/recipe-app/drizzle` is empty and the journal is unmodified. See Audit Note 1 — two unrelated untracked agent-guidance files exist elsewhere under `apps/recipe-app/`; no migration artifact is among them. | closed |
| T-04-49 | Elevation of Privilege | the destructive demonstration actually executes against the development database | high | mitigate | Verified: refusal asserted against the live database and replayed against a throwaway container in `tests/history/blocked-replay.test.ts`, never trusted from an exit code. | closed |
| T-04-50 | Repudiation | the refusal is claimed in documentation but not reproducible | high | mitigate | Verified: `tests/history/blocked-replay.test.ts` replays the exact generated bytes from the committed corpus fixture `corpus/app-shaped/generated-drop-ingredients-table.sql`. | closed |
| T-04-51 | Tampering | a stable reusable test asset is quietly extended | medium | mitigate | Verified: `git status --porcelain tests/smoke.test.ts` is empty. | closed |
| T-04-52 | Repudiation | a requirement is marked complete on the strength of implementation alone | medium | mitigate | Verified: RUN-01…RUN-08 and APP-02 traceability rows read "Implemented — awaiting phase verification"; RUN-07/APP-02 checkboxes left unticked. | closed |
| T-04-53 | Information Disclosure | a credential is written into `docs/30-migration-runner.md` | high | mitigate | Verified: no connection-string prefix and no password literal in the file; runner output is produced through `safeErrorMessage` by construction. | closed |
| T-04-54 | Repudiation | an unverified fact (production's PostgreSQL major version) recorded as known | medium | mitigate | Verified: `UNKNOWN` appears 7 times in `docs/decisions.md`, including D16's production-version gap. | closed |
| T-04-55 | Tampering | npm dependency substitution | low | accept | AR-08 — plan installs zero new packages. | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above `workflow.security_block_on` count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-01 | T-04-10 | Plan 04-01 installs zero new packages; `04-RESEARCH.md` §Package Legitimacy Audit records "not applicable this phase". No install task exists, so no legitimacy checkpoint is required. | Plan author (04-01-PLAN.md) | 2026-09-08 |
| AR-02 | T-04-17 | Plan 04-02 installs zero new packages. | Plan author (04-02-PLAN.md) | 2026-09-08 |
| AR-03 | T-04-25 | Plan 04-03 installs zero new packages; `@testcontainers/postgresql` 12.1.0 and `vitest` 5.0.0 were legitimacy-checked in earlier phases. | Plan author (04-03-PLAN.md) | 2026-09-08 |
| AR-04 | T-04-32 | Plan 04-04 installs zero new packages. | Plan author (04-04-PLAN.md) | 2026-09-08 |
| AR-05 | T-04-39 | Nothing in this phase serialises two simultaneous runner invocations. Recorded as a `backstop` truth rather than claimed as handled: the development database is single-operator and disposable, and Phase 7's production runner is where a lock would be earned by evidence rather than invented now. Severity `medium` — below the `high` blocking threshold. | Plan author (04-05-PLAN.md), carried in 04-05-SUMMARY.md | 2026-09-08 |
| AR-06 | T-04-40 | Plan 04-05 installs zero new packages. | Plan author (04-05-PLAN.md) | 2026-09-08 |
| AR-07 | T-04-47 | Plan 04-06 installs zero new packages; `drizzle-kit` 0.31.10 already pinned and installed. | Plan author (04-06-PLAN.md) | 2026-09-08 |
| AR-08 | T-04-55 | Plan 04-07 installs zero new packages. | Plan author (04-07-PLAN.md) | 2026-09-08 |

*Accepted risks do not resurface in future audit runs.*

---

## Audit Notes

Observations that are not open threats but that a later reader should not have to rediscover.
Recorded rather than smoothed over, per this project's "mark unverified things UNKNOWN" rule.

1. **`git status --porcelain apps/recipe-app` is not literally empty.** T-04-48's plan-time
   acceptance criterion phrased the check at the `apps/recipe-app` level. At audit time two
   untracked files exist there — `apps/recipe-app/AGENTS.md` and `apps/recipe-app/CLAUDE.md`
   — both agent-guidance documents unrelated to Phase 4. The subtree the threat actually
   concerns, `apps/recipe-app/drizzle/`, **is** empty under `git status --porcelain`, and no
   migration artifact is among the untracked files. The threat is closed on that evidence,
   not on the broader criterion's literal wording.

2. **`docs/migration-history-status.json` has an uncommitted modification** at audit time.
   The working-tree record reads `{"lastRunAt": "2026-09-08T23:48:54.813Z", "outcome": "PASS"}`.
   This is the T-04-19/T-04-20 evidence artifact; until it is committed, the committed
   evidence and the working tree differ by one line. Not a threat — the mechanism that
   makes the record trustworthy (`assertHistoryStatusPassed`) is verified present — but the
   record should be committed so the evidence is durable.

3. **Verification depth is L1.** `workflow.security_asvs_level` is `1`, so mitigations were
   confirmed to exist at the named locations. No L2 boundary-placement review or L3
   end-to-end trace was performed, and no independent security auditor subagent was spawned
   (the L1 short-circuit applies: register authored at plan time, zero open threats). If a
   later phase raises the ASVS level, this register should be re-audited at that depth.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-09-08 | 55 | 55 | 0 | /gsd-secure-phase (orchestrator, L1) |

Audit performed at commit `ca1561d`. State B — SECURITY.md created from seven plan threat
models plus implementation evidence.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-09-08
