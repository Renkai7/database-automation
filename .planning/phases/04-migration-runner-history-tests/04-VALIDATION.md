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
| **Full suite command** | `pnpm test:history` (NEW script — `vitest run --config vitest.history.config.ts`) |
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
| TBD — plans not yet written | — | — | RUN-01…RUN-08, APP-02 | — | — | — | — | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vitest.history.config.ts` — new config mirroring `vitest.drill.config.ts`
- [ ] `tests/history/` directory and its test files
- [ ] `vitest.config.ts` `exclude` array gains `tests/history/**`, mirroring the existing `tests/drill/**` exclusion
- [ ] Committed history-test status file plus its read/write module, mirroring `scripts/drill-status.ts`
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
