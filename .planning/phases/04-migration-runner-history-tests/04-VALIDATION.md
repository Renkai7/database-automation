---
phase: "4"
slug: "migration-runner-history-tests"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: validated
nyquist_compliant: true
wave_0_complete: true
created: "2026-09-08"
validated: "2026-09-08"
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded by `/gsd-plan-phase` from `04-RESEARCH.md` § Validation Architecture.
> The Per-Task Verification Map is a stub until plans exist; `/gsd-validate-phase` fills it.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 5.0.0 (already installed — no Wave 0 framework install) |
| **Config file** | `vitest.config.ts` (fast suite); `vitest.drill.config.ts` (existing Docker suite); `vitest.history.config.ts` — NEW this phase |
| **Quick run command** | `pnpm test` |
| **Full suite command** | `pnpm test:history` (NEW script — `tsx scripts/history-suite.ts`, which spawns `vitest run --config vitest.history.config.ts` and records the PASS/FAIL result D-24 requires; vitest alone cannot write that record) |
| **Measured runtime** | `pnpm test` — **54.9s** (45 files / 447 tests); `pnpm test:history` — **21.7s** (6 files / 14 tests). Measured 2026-09-08 during this audit, both green. The history suite is the *faster* of the two despite being Testcontainers-backed — the fast suite carries a real Next.js production build for `tests/smoke.test.ts`. |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test`
- **After every plan wave:** Run `pnpm test:history` (Testcontainers-backed, slow)
- **Before `/gsd-verify-work`:** Both `pnpm test` and `pnpm test:history` green, plus the one-time documented SAFE / REVIEW REQUIRED / BLOCKED demonstration runs
- **Max feedback latency:** **~55s** — the fast suite, not the history suite (measured 2026-09-08). Both suites together are under 80s, so the "run both before verify" rule costs less than the fast suite alone was assumed to.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01 T1 | 04-01 | 1 | RUN-01, RUN-03 | T-04-01, T-04-04 | classified bytes are executed bytes; timeouts verified before execution | integration | `pnpm exec vitest run tests/migrate.test.ts` | ✓ existing | ✅ green |
| 04-01 T3 | 04-01 | 1 | RUN-02 | T-04-02, T-04-03 | BLOCKED refused with no override surface; no second migrate path | unit + structural | `pnpm exec vitest run packages/automation/test/run-migrations.test.ts tests/guardrails.test.ts` | ✓ existing | ✅ green |
| 04-02 T1 | 04-02 | 2 | RUN-04 | T-04-16 | transaction-hostility and self-disarm are analyzer facts | unit | `pnpm exec vitest run packages/automation/test/transaction-hostile.test.ts packages/automation/test/inspector-facts.test.ts` | ✓ existing | ✅ green |
| 04-02 T3 | 04-02 | 2 | RUN-02 | T-04-11, T-04-12, T-04-15 | timeout disarm is BLOCKED and non-weakenable | unit | `pnpm exec vitest run packages/automation/test/timeout-disarm-floor.test.ts packages/automation/test/rules-catalogue.test.ts` | ✓ existing | ✅ green |
| 04-02 T4 | 04-02 | 2 | RUN-02 | T-04-13, T-04-14 | nested disarm caught; comment mention not falsely flagged | corpus | `pnpm exec vitest run packages/automation/test/corpus.test.ts packages/automation/test/plpgsql.test.ts` | ✓ existing | ✅ green |
| 04-03 T2 | 04-03 | 2 | RUN-05, RUN-06 | — | history is consistent against empty and existing databases | integration (Testcontainers) | `pnpm exec vitest run --config vitest.history.config.ts tests/history/empty-db-full-history.test.ts tests/history/existing-db-newest-only.test.ts` | ✓ existing | ✅ green |
| 04-03 T3 | 04-03 | 2 | RUN-01 | T-04-18, T-04-19, T-04-20 | tamper after classification still refused; result recorded | integration (Testcontainers) | `pnpm exec vitest run --config vitest.history.config.ts tests/history/tamper-then-refuse.test.ts` | ✓ existing | ✅ green |
| 04-04 T1 | 04-04 | 3 | RUN-04 | T-04-27, T-04-28 | wrap/unwrap from facts only; mixed file refused | unit | `pnpm exec vitest run packages/automation/test/transaction-policy.test.ts packages/automation/test/run-migrations.test.ts` | ✓ existing | ✅ green |
| 04-04 T2 | 04-04 | 3 | RUN-03, RUN-04 | T-04-26, T-04-30 | lock times out in a bounded window; CONCURRENTLY succeeds | integration (Testcontainers) | `pnpm exec vitest run --config vitest.history.config.ts tests/history/timeouts-and-concurrently.test.ts` | ✓ existing | ✅ green |
| 04-05 T1 | 04-05 | 4 | RUN-08 | T-04-33, T-04-34 | marker written before, resolved after; unresolved marker blocks | unit | `pnpm exec vitest run packages/automation/test/runner-table.test.ts packages/automation/test/run-migrations.test.ts` | ✓ existing | ✅ green |
| 04-05 T2 | 04-05 | 4 | RUN-08 | T-04-35, T-04-37 | recovery reports, resolves, repairs nothing, takes no target | integration + structural | `pnpm exec vitest run tests/db-migrate-recover.test.ts tests/guardrails.test.ts` | ✓ existing | ✅ green |
| 04-05 T3 | 04-05 | 4 | RUN-08 | T-04-33, T-04-36 | whole partial-failure cycle end to end | integration (Testcontainers) | `pnpm exec vitest run --config vitest.history.config.ts tests/history/partial-failure-recovery.test.ts` | ✓ existing | ✅ green |
| 04-06 T1 | 04-06 | 5 | APP-02 | T-04-41 | real SAFE change applied through the runner | manual-run + corpus | `pnpm db:analyze:migrations` (exit 10 — re-confirmed this audit) | ✓ existing | ✅ green (perpetual half via corpus; live run is Manual-Only) |
| 04-06 T2 | 04-06 | 5 | APP-02 | T-04-42, T-04-44 | real REVIEW REQUIRED change applied after its backfill | manual-run + integration | `pnpm db:reset` | ✓ existing | ✅ green (perpetual half via corpus; live run is Manual-Only) |
| 04-06 T3 | 04-06 | 5 | APP-02 | T-04-45 | new real migrations pinned in the corpus manifest | corpus | `pnpm exec vitest run packages/automation/test/corpus.test.ts packages/automation/test/anlz-07.test.ts` | ✓ existing | ✅ green |
| 04-07 T1 | 04-07 | 6 | APP-02 | T-04-48, T-04-49, T-04-50 | real BLOCKED change refused, reverted, replayed | integration (Testcontainers) | `pnpm exec vitest run --config vitest.history.config.ts tests/history/blocked-replay.test.ts` | ✓ existing | ✅ green |
| 04-07 T2 | 04-07 | 6 | RUN-07 | T-04-51 | the app boots against the runner-produced schema | smoke (reused verbatim) | `pnpm exec vitest run tests/smoke.test.ts` | ✓ existing | ✅ green |
| 04-07 T3 | 04-07 | 6 | RUN-01…RUN-08, APP-02 | T-04-52, T-04-54 | record and traceability are honest | structural | `pnpm test` | ✓ existing | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**How the two `manual-run` rows (04-06 T1, T2) are classified, stated plainly.** Their listed
commands are demonstration commands against the real dev database, not assertions — `pnpm db:reset`
asserts nothing on its own. They are marked green because the *behaviour* they demonstrate is
perpetually re-asserted by `packages/automation/test/corpus.test.ts`: the corpus manifest (66 entries)
pins `0002_oval_maelstrom` (SAFE), `0003_backfill_steps_timer_label` and `0004_redundant_apocalypse`
(both REVIEW_REQUIRED), and the reverted `generated-drop-ingredients-table.sql` (BLOCKED) with their
expected verdicts — verified present in the manifest during this audit. The one-time live run itself
stays in Manual-Only below and is not claimed as automated.

---

## Wave 0 Requirements

- [x] `vitest.history.config.ts` — new config mirroring `vitest.drill.config.ts` (plan 04-03 Task 1) — present
- [x] `tests/history/` directory and its six test files (plans 04-03, 04-04, 04-05, 04-07) — all six present, 14 tests green
- [x] `vitest.config.ts` `exclude` array gains `tests/history/**`, mirroring the existing `tests/drill/**` exclusion (plan 04-03 Task 1) — confirmed: `exclude: [...configDefaults.exclude, "tests/drill/**", "tests/history/**"]`, spread onto vitest's defaults rather than replacing them
- [x] Committed history-test status file plus its read/write module, mirroring `scripts/drill-status.ts` (plan 04-03 Task 1; first recorded PASS in plan 04-03 Task 3) — `docs/migration-history-status.json` records `{"outcome":"PASS","suiteConfig":"vitest.history.config.ts"}`, rewritten by this audit's own green run via `scripts/history-suite.ts`
- [x] Framework install: none — vitest already installed (5.0.0)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| A real recipe-app schema change landing SAFE, and one landing REVIEW REQUIRED, run once through `pnpm db:migrate` | APP-02 | One-time demonstration against the real dev database; not perpetually re-asserted (the BLOCKED half IS automated as a replay test) | Run the change through the runner, record the observed outcome in the phase docs |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies — 17/17 rows resolve to a real, existing test file
- [x] Sampling continuity: no 3 consecutive tasks without automated verify — no run of even two
- [x] Wave 0 covers all MISSING references — Wave 0 fully satisfied; nothing left MISSING
- [x] No watch-mode flags — every command is `vitest run`; `pnpm test:history` wraps `vitest run --config …` in `scripts/history-suite.ts`. Scanned `package.json`, `scripts/history-suite.ts`, and all three vitest configs: zero watch invocations
- [x] Feedback latency measured and recorded — 54.9s fast / 21.7s history (2026-09-08)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** validated 2026-09-08 — audited by `/gsd-validate-phase 4`, both suites executed live, not taken from the recorded PASS.

---

## Validation Audit 2026-09-08

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

**Method.** State A audit. Every test path named in the Per-Task Verification Map was checked to
exist on disk, then both suites were run live rather than read off `docs/migration-history-status.json`:

| Suite | Command | Result |
|---|---|---|
| Fast | `pnpm test` | 45 files / **447 tests passed**, 54.9s |
| History | `pnpm test:history` | 6 files / **14 tests passed**, 21.7s |
| Demonstration | `pnpm db:analyze:migrations` | exit **10**, as recorded |

No gaps were found, so no `gsd-nyquist-auditor` subagent was spawned and no test files were
generated — this audit changed `04-VALIDATION.md` only.

**Note on the 447 vs 440 count.** `04-VERIFICATION.md` (2026-09-08) records 440 passing tests. The
count is now 447 because three post-verification fix commits (`1c4fde0`, `c3c861d`, `d12ffc0`) closed
the three ⚠️ warnings that verification report had listed as open — multi-object `DROP` truncation,
duplicate journal `when`, and `seed.ts`'s `process.exit` — each adding regression tests. The delta is
accounted for, not unexplained drift.

**Not closed by this audit, and not this audit's to close:** the production PostgreSQL major version
remains UNKNOWN (`docs/decisions.md` D16). It does not affect validation coverage — every test here
runs against the pinned PostgreSQL 17 dev/CI target — but it is restated rather than allowed to go
quiet.
