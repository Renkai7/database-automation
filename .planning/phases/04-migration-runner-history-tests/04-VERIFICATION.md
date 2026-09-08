---
phase: 04-migration-runner-history-tests
verified: 2026-09-08T00:00:00Z
status: passed
score: 5/5 must-haves verified
covered_files:
  - .planning/REQUIREMENTS.md
  - .planning/ROADMAP.md
  - .planning/phases/04-migration-runner-history-tests/04-01-PLAN.md
  - .planning/phases/04-migration-runner-history-tests/04-01-SUMMARY.md
  - .planning/phases/04-migration-runner-history-tests/04-02-PLAN.md
  - .planning/phases/04-migration-runner-history-tests/04-02-SUMMARY.md
  - .planning/phases/04-migration-runner-history-tests/04-03-PLAN.md
  - .planning/phases/04-migration-runner-history-tests/04-03-SUMMARY.md
  - .planning/phases/04-migration-runner-history-tests/04-04-PLAN.md
  - .planning/phases/04-migration-runner-history-tests/04-04-SUMMARY.md
  - .planning/phases/04-migration-runner-history-tests/04-05-PLAN.md
  - .planning/phases/04-migration-runner-history-tests/04-05-SUMMARY.md
  - .planning/phases/04-migration-runner-history-tests/04-06-PLAN.md
  - .planning/phases/04-migration-runner-history-tests/04-06-SUMMARY.md
  - .planning/phases/04-migration-runner-history-tests/04-07-PLAN.md
  - .planning/phases/04-migration-runner-history-tests/04-07-SUMMARY.md
  - .planning/phases/04-migration-runner-history-tests/04-CONTEXT.md
  - .planning/phases/04-migration-runner-history-tests/04-REVIEW.md
  - apps/recipe-app/drizzle/meta/_journal.json
  - apps/recipe-app/src/db/schema.ts
  - apps/recipe-app/src/db/seed.ts
  - docs/30-migration-runner.md
  - docs/decisions.md
  - packages/automation/src/classifier/floor.ts
  - packages/automation/src/index.ts
  - packages/automation/src/inspector/inspect.ts
  - packages/automation/src/rules/rules.json
  - packages/automation/src/runner/client.ts
  - packages/automation/src/runner/exit-codes.ts
  - packages/automation/src/runner/ledger.ts
  - packages/automation/src/runner/run-migrations.ts
  - packages/automation/src/runner/runner-table.ts
  - packages/automation/src/runner/split-statements.ts
  - packages/automation/src/runner/timeouts.ts
  - packages/automation/src/runner/transaction-policy.ts
  - packages/automation/test/corpus/manifest.json
  - packages/automation/test/timeout-disarm-floor.test.ts
  - scripts/db-migrate-recover.ts
  - scripts/db-migrate.ts
  - scripts/db-reset.ts
  - scripts/history-status.ts
  - scripts/history-suite.ts
  - tests/guardrails.test.ts
  - tests/history-status.test.ts
  - tests/history/blocked-replay.test.ts
  - tests/history/empty-db-full-history.test.ts
  - tests/history/existing-db-newest-only.test.ts
  - tests/history/partial-failure-recovery.test.ts
  - tests/history/tamper-then-refuse.test.ts
  - tests/history/timeouts-and-concurrently.test.ts
  - vitest.config.ts
  - vitest.history.config.ts
covered_digest: "v1:sha256:d8c780f04c84541ee5dee8a1d4ff982476a594739428649330dd535d6be0c3be"
behavior_unverified: 0
overrides_applied: 0
---

# Phase 4: Migration Runner & History Tests Verification Report

**Phase Goal:** Migrations execute only under a runner that re-derives its own verdict from the
actual SQL immediately before running it, refuses anything BLOCKED with no override, and the
full migration history is proven consistent against both an empty and an existing database.

**Verified:** 2026-09-08
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A migration classified SAFE upstream but altered to contain a BLOCKED operation is refused at execution, re-parsed from actual bytes, with no override path of any kind | ✓ VERIFIED | `tests/history/tamper-then-refuse.test.ts` mutates a temp copy of the oldest committed migration (never the committed dir), confirms the untampered bytes classify SAFE via `analyzeSql`, then drives the real `runMigrations` core against a fresh `postgres:17` Testcontainer. Asserts: `MigrationRefusedError` with `RUNNER_EXIT_CODES.REFUSED_BLOCKED`, zero ledger rows, no tables created, one `refused`/`BLOCKED` row in `runner.migration_runs` carrying rule id `drop-table`. Re-run twice to prove non-one-shot. `run-migrations.ts`'s BLOCKED branch (lines 335-360) throws unconditionally — no flag, env var, or config read anywhere near it (confirmed by direct code read: `RunMigrationsOptions` is a closed 3-key surface). `tests/guardrails.test.ts`'s `drizzle-kit migrate` scan (lines 317-334) has genuinely **no per-file allowlist** — confirmed by reading the test source directly; this was the explicit 04-01 Task 2 human checkpoint decision ("unconditional") and it holds. |
| 2 | Every migration executes under `lock_timeout`/`statement_timeout`; a slow-locking migration times out and fails cleanly; `CREATE INDEX CONCURRENTLY` still succeeds (statements not force-wrapped) | ✓ VERIFIED | `tests/history/timeouts-and-concurrently.test.ts` Case A proves `assertTimeoutsInEffect` reads real `pg_settings` integers matching the pinned constants (3000ms/30000ms) and is capable of failing (negative control with no connect-time options). Case B: a competing `LOCK TABLE ... ACCESS EXCLUSIVE` causes a real migration to fail in 3000ms–30000ms with "lock timeout" in the message, recorded `failed` in `runner.migration_runs`, no ledger row, no column added. Case C: `CREATE INDEX CONCURRENTLY` on its own succeeds (`indisvalid = true`, ledger row present, `wrapped: false`), while a file mixing `CREATE INDEX CONCURRENTLY` with an ordinary `ALTER TABLE` is refused as a negative control (`REFUSED_MIXED_FILE`, neither the index nor the column exists). `timeouts.ts`/`transaction-policy.ts` read confirms options are applied at connect-time only (D-14) and the wrap/unwrap decision reads only `finding.facts.transactionHostile` (no keyword list of its own). |
| 3 | Full history → empty DB, and newest-only → existing DB, both produce the expected schema automatically; the recipe app boots against the result | ✓ VERIFIED | `tests/history/empty-db-full-history.test.ts`: proves genuine emptiness first, then applies `enumerateMigrationFiles()`'s real committed journal to a fresh Testcontainer, asserting every migration `applied`, ledger count matches, and table/column shape matches `EXPECTED_FULL_HISTORY_COLUMNS` for `recipes`/`ingredients`/`steps`. `tests/history/existing-db-newest-only.test.ts`: stages history-minus-newest, re-applies the full list, asserts exactly 1 `applied` + N `skipped`, ledger count +1, and the resulting shape equals the full-history shape. RUN-07: `tests/smoke.test.ts` reused verbatim (confirmed via `git log` — last touched in Phase 1 commit `86c0d2e`, never modified by any Phase 4 commit) and is part of the default `pnpm test` glob the orchestrator already confirmed green (440/440); `docs/30-migration-runner.md`'s "Anything surprising" section documents a real `pnpm db:reset` → `vitest run tests/smoke.test.ts` (4/4) run against the runner-produced schema. |
| 4 | A migration deliberately failed partway leaves a clearly reported state, never silently marked applied; recovery never hand-edits `_journal.json` | ✓ VERIFIED | `tests/history/partial-failure-recovery.test.ts` runs 6 sequential real-database cases: a wrapped failure is self-cleaning (no marker, ledger/marker both rolled back); a genuine `CREATE UNIQUE INDEX CONCURRENTLY` failure (real duplicate data, not fault injection) leaves a `failed`/`wrapped:false` marker, zero ledger rows, and an `INVALID` index; the next run refuses with `REFUSED_STALE_MARKER` naming the migration tag and statement index, applying nothing; a hand-inserted `in_flight` marker refuses independently; `db:migrate:recover`'s exported `reportAndResolveMarkers` reports the migration, statement, and INVALID index, states "repaired nothing" in its own output, resolves the marker, and the INVALID index still exists afterward; only then does dropping it (the operator's own action) let a fresh migration apply normally. `scripts/db-migrate-recover.ts` read directly confirms no `_journal.json` reference, no `DROP INDEX`, no forced `process.exit` — independently corroborated by `tests/guardrails.test.ts`'s literal source scan. |
| 5 | A real SAFE, a real REVIEW REQUIRED, and a real BLOCKED recipe-app schema change each produced the expected outcome through the runner | ✓ VERIFIED | SAFE: `apps/recipe-app/drizzle/0002_oval_maelstrom.sql` (nullable `notes` column) — corpus manifest records `expectedVerdict: SAFE`, rule `add-column-nullable-no-default`. REVIEW REQUIRED: `0003_backfill_steps_timer_label.sql` (scoped backfill, unmatched-statement REVIEW_REQUIRED, demonstrating the update-without-WHERE floor from the passing side) + `0004_redundant_apocalypse.sql` (`SET DEFAULT`/`SET NOT NULL`, rule `set-not-null`) — both recorded REVIEW_REQUIRED in the manifest. BLOCKED: the committed journal (`meta/_journal.json`, 5 entries, `0000`–`0004`) contains **no** BLOCKED migration — confirmed by direct read; the real `drizzle-kit generate`-produced `DROP TABLE "ingredients" CASCADE;` was refused live, reverted, and is now permanently replayed by `tests/history/blocked-replay.test.ts` against the exact committed corpus fixture bytes (`generated-drop-ingredients-table.sql`), asserting refusal twice, `ingredients` still present, ledger count unchanged, and rule id `drop-table`. `docs/30-migration-runner.md` documents all three runs with an honest "Anything surprising" section (generated SQL diverged cosmetically from the Phase 3 hand-written mirror; `db:reset` doesn't forward `db:migrate`'s console output — both explained, neither hidden). |

**Score:** 5/5 truths verified (0 present-but-behavior-unverified)

### Human-Checkpoint Decisions (verified against code, not taken on trust)

| Decision | Requirement | Verified |
|---|---|---|
| 04-01 Task 2: "unconditional" — no per-file allowlist for the `drizzle-kit migrate` scan | `tests/guardrails.test.ts` lines 317-334 must scan the whole source surface with zero exemptions | ✓ Confirmed by direct read: the test's own comment states "Unconditional: no per-file allowlist... a gate with a second door is not a gate," and the `for (const file of files)` loop has no filter/allowlist applied before the `.not.toContain(forbidden)` assertion. `sourceSurfaceFiles()` is itself proven non-vacuous by a dedicated self-check test. |
| 04-02 Task 2: "cover-all-scopes" — D-17 floor must cover `SET`, `SET LOCAL`, `RESET`, `RESET ALL`, `ALTER SYSTEM SET`, `ALTER DATABASE ... SET`, `ALTER ROLE ... SET` | All seven scopes, not just session-scoped | ✓ Confirmed: `inspect.ts`'s `setstmtDisarmsTimeout` helper is shared by `VariableSetStmt` (covers SET/SET LOCAL/RESET/RESET ALL — `VAR_RESET_ALL` disarms unconditionally with no name check), `AlterSystemStmt`, `AlterDatabaseSetStmt`, and `AlterRoleSetStmt`. `floor.ts`'s `D17_FLOOR_FACTS` has exactly the 4 corresponding `statementKind`s, self-checked at rules-load time via `assertFloorNotWeakened`. `packages/automation/test/timeout-disarm-floor.test.ts`'s `disarmRows` array drives real SQL for all 8 concrete forms (including `ALTER ROLE ... SET`) through `analyzeSql` and asserts `BLOCKED` with rule id `disarms-timeout-guc` for every one. `docs/decisions.md` D17 records this explicitly, including the reasoning for why the two discretionary scopes were covered rather than left as a gap. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/automation/src/runner/run-migrations.ts` | Classify-then-execute orchestrator, no override surface | ✓ VERIFIED | Read in full; Phase A (classify all pending) strictly precedes Phase B (execute); BLOCKED/parse-failure/mixed-file all throw before any statement of the offending or later migration runs. |
| `packages/automation/src/runner/transaction-policy.ts` | Wrap/unwrap decision from `transactionHostile` fact only | ✓ VERIFIED | Pure function of `Finding[]`, imports only `../types`, no regex/keyword list. |
| `packages/automation/src/runner/timeouts.ts` | Pinned constants, connect-time application, post-connect verification | ✓ VERIFIED | `LOCK_TIMEOUT_MS=3000`, `STATEMENT_TIMEOUT_MS=30000`, `RUNNER_CONNECTION_OPTIONS` built from them, `assertTimeoutsInEffect` queries `pg_settings` (not `SHOW`). |
| `packages/automation/src/runner/runner-table.ts` | In-flight marker lifecycle, run report, INVALID index detection | ✓ VERIFIED | `writeInFlightMarker`/`markMarkerApplied`/`markMarkerFailed`/`resolveMarker`/`readUnresolvedMarkers`/`readInvalidIndexes` all present; `resolveMarker` never `DELETE`s. |
| `scripts/db-migrate.ts` / `scripts/db-migrate-recover.ts` | Pinned thin entry points, no target argument | ✓ VERIFIED | Both call `assertLocalDevelopmentTarget`/`assertDevelopmentDatabase`; `db-migrate-recover.ts` confirmed to hold none of `_journal.json`, `DROP INDEX`, or `process.exit(`. |
| `tests/history/*.test.ts` (6 files) | Real Testcontainers proofs for criteria 1-4 | ✓ VERIFIED | All read in full; each asserts against real Postgres state (ledger rows, `runner.migration_runs`, `pg_index`, `information_schema.columns`), not mocked. |
| `docs/migration-history-status.json` | Committed PASS record, no staleness rule | ✓ VERIFIED | `{"outcome":"PASS","suiteConfig":"vitest.history.config.ts", ...}`; `scripts/history-status.ts` confirmed to carry no age check by design. |
| `docs/30-migration-runner.md` | D-33 record of all three real runs | ✓ VERIFIED | 342 lines, dated 2026-09-08, includes an honest "Anything surprising" section and explicit UNKNOWN flag for production PostgreSQL version. |

### Key Link Verification

| From | To | Via | Status |
|---|---|---|---|
| `inspect.ts`'s `transactionHostile`/`disarmsTimeout` facts | `run-migrations.ts`'s BEGIN/no-BEGIN branch and `floor.ts`'s BLOCKED floor | `decideTransactionPolicy(findings)` / `assertFloorNotWeakened` | ✓ WIRED — both read only the analyzer's own fact vocabulary, no duplicated SQL-semantics knowledge in the runner. |
| `RUNNER_CONNECTION_OPTIONS` | `pg.Client({options})` → `assertTimeoutsInEffect` | connect-time libpq startup options | ✓ WIRED — proven by Case A's negative control (a client without the options fails the assertion). |
| `apps/recipe-app/src/db/schema.ts` → `drizzle-kit generate` | `pnpm db:migrate` → live dev DB | the one legitimate schema-arrival loop | ✓ WIRED — three real generated migrations (0002/0003/0004) applied through the real runner; documented in `docs/30-migration-runner.md`. |
| Committed corpus fixture bytes | `tests/history/blocked-replay.test.ts` / `tamper-then-refuse.test.ts` | `enumerateMigrationFiles(migrationsDir, journalPath)`'s defaulted override | ✓ WIRED — both tests replay real bytes against a fresh disposable container without touching the committed migrations directory. |

### Requirements Coverage

| Requirement | Source Plan(s) | Status | Evidence |
|---|---|---|---|
| RUN-01 | 04-01, 04-03 | ✓ SATISFIED | Classify-then-execute on the exact in-memory buffer; `tamper-then-refuse.test.ts`. |
| RUN-02 | 04-01 | ✓ SATISFIED | BLOCKED branch throws unconditionally; no allowlist in guardrails scan. |
| RUN-03 | 04-01, 04-04 | ✓ SATISFIED | Pinned timeouts, connect-time application, verified in effect; Case A/B. |
| RUN-04 | 04-04 | ✓ SATISFIED | `decideTransactionPolicy`; Case C (CONCURRENTLY succeeds, mixed file refused). |
| RUN-05 | 04-03 | ✓ SATISFIED | `empty-db-full-history.test.ts`. |
| RUN-06 | 04-03 | ✓ SATISFIED | `existing-db-newest-only.test.ts`. |
| RUN-07 | 04-07 | ✓ SATISFIED | `tests/smoke.test.ts` reused verbatim (git-confirmed untouched by Phase 4), documented real run in `docs/30-migration-runner.md`, part of the orchestrator's confirmed 440/440 `pnpm test`. |
| RUN-08 | 04-05 | ✓ SATISFIED | `partial-failure-recovery.test.ts`'s 6 sequential cases; `db-migrate-recover.ts` never touches `_journal.json`. |
| APP-02 | 04-06, 04-07 | ✓ SATISFIED | Three real schema changes (SAFE/REVIEW REQUIRED×2/BLOCKED-then-reverted) through the real runner against the pinned dev database, all regression-tested in the corpus manifest. |

No orphaned requirements: the phase's declared requirement set (`RUN-01`…`RUN-08`, `APP-02`) matches exactly what `REQUIREMENTS.md`'s traceability table assigns to Phase 4.

### Anti-Patterns Found (carried from `04-REVIEW.md`, independently spot-checked against source)

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `packages/automation/src/inspector/inspect.ts` | 300-327 | `inspectDropStmt` reads only `dropStmt.objects[0]` — a multi-object `DROP TABLE a, b;` silently drops every object after the first from the findings/audit record | ⚠️ Warning | Not exploitable against the shipped `rules.json` today (every DROP rule matches on `statementKind` alone, confirmed by direct read of `rules.json`'s `drop-table`/`drop-schema` rows) — the D-02 floor still forces BLOCKED regardless. Real gap for future audit-record fidelity and any future per-object rule. Does not affect any of the 5 success criteria today. |
| `packages/automation/src/runner/run-migrations.ts` | 288-291 | `enumerateMigrationFiles` hard-fails on a duplicate journal `idx` but performs no equivalent check on a duplicate `when` — a colliding `when` (most plausible via `--custom` generation) would make the second migration sharing it silently skip forever | ⚠️ Warning | Not present in the committed journal today (all 5 `when` values are distinct, confirmed by direct read of `meta/_journal.json`). Doesn't currently break criterion 3 (history is genuinely proven consistent for the real committed migrations), but is a latent gap inconsistent with the project's own hard-fail discipline. Worth closing in a follow-up. |
| `apps/recipe-app/src/db/seed.ts` | 100-108 | Direct `process.exit()` calls, against the pattern every other Phase 4 entry point deliberately follows (`process.exitCode` + natural return, to avoid a reproduced Windows libuv crash after a `libpg-query` WASM parse) | ℹ️ Info | `seed.ts` does not itself call `libpg-query`, so this is not currently the specific crash this repo has hit — but it is the one entry point in the reviewed set that doesn't follow the load-bearing convention. |

No BLOCKER-tier finding exists anywhere in the reviewed diff (confirmed independently by reading every file listed in `04-REVIEW.md`'s critical-path trace, not merely trusting its summary). No TBD/FIXME/XXX debt markers found in any file touched by this phase.

### Decisions Record (`docs/decisions.md`)

D12, D16, D17, D18, D19, D20, D21, D22, D23 all carry an explicit `**Status:** ACCEPTED · 2026-09-08` line, satisfying `CLAUDE.md`'s "record decisions with an explicit status" rule. D16's production-PostgreSQL-major-version gap is re-flagged as UNKNOWN rather than silently resolved, consistent with the project's own non-negotiable.

### Human Verification Required

None. Every success criterion is exercised by a real, already-green Testcontainers-backed test (independently read and confirmed to assert against real database state, not mocked) plus a live, documented run against the pinned development database. No visual, UX, or external-service-dependent behavior exists in this phase's scope.

### Gaps Summary

No gaps block phase completion. Three pre-existing, non-blocking warnings from `04-REVIEW.md` (multi-object `DROP` truncation, duplicate-journal-`when` silent skip, `seed.ts`'s `process.exit`) are real and worth a follow-up plan, but none of them defeats any of the five ROADMAP success criteria against the code and rules file as shipped today — each was independently traced to a specific, currently-absent precondition before being accepted as non-blocking, not merely taken on the review's word.

---

*Verified: 2026-09-08*
*Verifier: Claude (gsd-verifier)*
