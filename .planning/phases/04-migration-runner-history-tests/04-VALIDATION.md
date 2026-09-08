---
phase: "4"
slug: "migration-runner-history-tests"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-09-08"
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
| **Estimated runtime** | UNKNOWN — Testcontainers-backed; measure on first green run |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test`
- **After every plan wave:** Run `pnpm test:history` (Testcontainers-backed, slow)
- **Before `/gsd-verify-work`:** Both `pnpm test` and `pnpm test:history` green, plus the one-time documented SAFE / REVIEW REQUIRED / BLOCKED demonstration runs
- **Max feedback latency:** UNKNOWN for the history suite until first measured; `pnpm test` stays the fast inner loop

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01 T1 | 04-01 | 1 | RUN-01, RUN-03 | T-04-01, T-04-04 | classified bytes are executed bytes; timeouts verified before execution | integration | `pnpm exec vitest run tests/migrate.test.ts` | ❌ new | ⬜ pending |
| 04-01 T3 | 04-01 | 1 | RUN-02 | T-04-02, T-04-03 | BLOCKED refused with no override surface; no second migrate path | unit + structural | `pnpm exec vitest run packages/automation/test/run-migrations.test.ts tests/guardrails.test.ts` | ❌ new | ⬜ pending |
| 04-02 T1 | 04-02 | 2 | RUN-04 | T-04-16 | transaction-hostility and self-disarm are analyzer facts | unit | `pnpm exec vitest run packages/automation/test/transaction-hostile.test.ts packages/automation/test/inspector-facts.test.ts` | ❌ new | ⬜ pending |
| 04-02 T3 | 04-02 | 2 | RUN-02 | T-04-11, T-04-12, T-04-15 | timeout disarm is BLOCKED and non-weakenable | unit | `pnpm exec vitest run packages/automation/test/timeout-disarm-floor.test.ts packages/automation/test/rules-catalogue.test.ts` | ❌ new | ⬜ pending |
| 04-02 T4 | 04-02 | 2 | RUN-02 | T-04-13, T-04-14 | nested disarm caught; comment mention not falsely flagged | corpus | `pnpm exec vitest run packages/automation/test/corpus.test.ts packages/automation/test/plpgsql.test.ts` | ❌ new | ⬜ pending |
| 04-03 T2 | 04-03 | 2 | RUN-05, RUN-06 | — | history is consistent against empty and existing databases | integration (Testcontainers) | `pnpm exec vitest run --config vitest.history.config.ts tests/history/empty-db-full-history.test.ts tests/history/existing-db-newest-only.test.ts` | ❌ new | ⬜ pending |
| 04-03 T3 | 04-03 | 2 | RUN-01 | T-04-18, T-04-19, T-04-20 | tamper after classification still refused; result recorded | integration (Testcontainers) | `pnpm exec vitest run --config vitest.history.config.ts tests/history/tamper-then-refuse.test.ts` | ❌ new | ⬜ pending |
| 04-04 T1 | 04-04 | 3 | RUN-04 | T-04-27, T-04-28 | wrap/unwrap from facts only; mixed file refused | unit | `pnpm exec vitest run packages/automation/test/transaction-policy.test.ts packages/automation/test/run-migrations.test.ts` | ❌ new | ⬜ pending |
| 04-04 T2 | 04-04 | 3 | RUN-03, RUN-04 | T-04-26, T-04-30 | lock times out in a bounded window; CONCURRENTLY succeeds | integration (Testcontainers) | `pnpm exec vitest run --config vitest.history.config.ts tests/history/timeouts-and-concurrently.test.ts` | ❌ new | ⬜ pending |
| 04-05 T1 | 04-05 | 4 | RUN-08 | T-04-33, T-04-34 | marker written before, resolved after; unresolved marker blocks | unit | `pnpm exec vitest run packages/automation/test/runner-table.test.ts packages/automation/test/run-migrations.test.ts` | ❌ new | ⬜ pending |
| 04-05 T2 | 04-05 | 4 | RUN-08 | T-04-35, T-04-37 | recovery reports, resolves, repairs nothing, takes no target | integration + structural | `pnpm exec vitest run tests/db-migrate-recover.test.ts tests/guardrails.test.ts` | ❌ new | ⬜ pending |
| 04-05 T3 | 04-05 | 4 | RUN-08 | T-04-33, T-04-36 | whole partial-failure cycle end to end | integration (Testcontainers) | `pnpm exec vitest run --config vitest.history.config.ts tests/history/partial-failure-recovery.test.ts` | ❌ new | ⬜ pending |
| 04-06 T1 | 04-06 | 5 | APP-02 | T-04-41 | real SAFE change applied through the runner | manual-run + corpus | `pnpm db:analyze:migrations` (exit 10) | ✓ existing | ⬜ pending |
| 04-06 T2 | 04-06 | 5 | APP-02 | T-04-42, T-04-44 | real REVIEW REQUIRED change applied after its backfill | manual-run + integration | `pnpm db:reset` | ✓ existing | ⬜ pending |
| 04-06 T3 | 04-06 | 5 | APP-02 | T-04-45 | new real migrations pinned in the corpus manifest | corpus | `pnpm exec vitest run packages/automation/test/corpus.test.ts packages/automation/test/anlz-07.test.ts` | ✓ existing | ⬜ pending |
| 04-07 T1 | 04-07 | 6 | APP-02 | T-04-48, T-04-49, T-04-50 | real BLOCKED change refused, reverted, replayed | integration (Testcontainers) | `pnpm exec vitest run --config vitest.history.config.ts tests/history/blocked-replay.test.ts` | ❌ new | ⬜ pending |
| 04-07 T2 | 04-07 | 6 | RUN-07 | T-04-51 | the app boots against the runner-produced schema | smoke (reused verbatim) | `pnpm exec vitest run tests/smoke.test.ts` | ✓ existing | ⬜ pending |
| 04-07 T3 | 04-07 | 6 | RUN-01…RUN-08, APP-02 | T-04-52, T-04-54 | record and traceability are honest | structural | `pnpm test` | ✓ existing | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vitest.history.config.ts` — new config mirroring `vitest.drill.config.ts` (plan 04-03 Task 1)
- [ ] `tests/history/` directory and its six test files (plans 04-03, 04-04, 04-05, 04-07)
- [ ] `vitest.config.ts` `exclude` array gains `tests/history/**`, mirroring the existing `tests/drill/**` exclusion (plan 04-03 Task 1)
- [ ] Committed history-test status file plus its read/write module, mirroring `scripts/drill-status.ts` (plan 04-03 Task 1; first recorded PASS in plan 04-03 Task 3)
- [ ] Framework install: none — vitest already installed

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| A real recipe-app schema change landing SAFE, and one landing REVIEW REQUIRED, run once through `pnpm db:migrate` | APP-02 | One-time demonstration against the real dev database; not perpetually re-asserted (the BLOCKED half IS automated as a replay test) | Run the change through the runner, record the observed outcome in the phase docs |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency measured and recorded
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
