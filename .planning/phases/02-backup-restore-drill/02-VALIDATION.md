---
phase: "02"
slug: "backup-restore-drill"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-09-07"
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Content carried over from `02-RESEARCH.md` § Validation Architecture and the
> five PLAN.md `<verify>` blocks. Lifecycle flags stay at `draft` /
> `nyquist_compliant: false` — only `/gsd-validate-phase` §6 may flip them.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 5.0.0 |
| **Config file** | `vitest.config.ts` (existing; the `include` glob already covers `tests/**/*.test.ts`). Plan 02-04 Task 3 adds an `exclude` for `tests/drill/` plus a second `vitest.drill.config.ts` that includes only that directory. |
| **Quick run command** | `pnpm test` |
| **Full suite command** | `pnpm test` (fast suite) + `pnpm test:drill` (slow suite, added by 02-04 Task 3) |
| **Estimated runtime** | ~10 s fast suite; the drill itself (`pnpm db:drill`) takes minutes and is deliberately kept out of `pnpm test` |

---

## Sampling Rate

- **After every task commit:** `pnpm test`
- **After every plan wave:** `pnpm test`, plus one `pnpm db:drill` run to keep `docs/restore-drill-status.json` fresh
- **Before `/gsd-verify-work`:** fast suite green, `pnpm test:drill` green, `pnpm db:drill` PASS, and the human drill (BKP-01 / BKP-05 / BKP-06) actually performed
- **Max feedback latency:** 15 seconds for the fast suite

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | BKP-02, BKP-03, BKP-04, BKP-07 | T-02-01 | Globals dump handled as an opaque blob; no verifier reaches stdout, git or the manifest | integration (tracer) | `pnpm db:drill` | ❌ W0 | ⬜ pending |
| 02-01-01 | 01 | 1 | BKP-02 | T-02-01 | Drill container bootstraps as `drilluser`, so the globals restore genuinely creates roles | source assertion | `node -e "...DRILL_BOOTSTRAP_USERNAME..."` | ✅ | ⬜ pending |
| 02-01-01 | 01 | 1 | BKP-03 | T-02-03 | No command script parses `process.argv` — the no-target property is structural | source assertion | `node -e "...no-target-argument-ok..."` | ✅ | ⬜ pending |
| 02-01-02 | 01 | 1 | BKP-02 | T-02-01 | Manifest provably carries no connection string and no SCRAM verifier | unit | `pnpm exec vitest run tests/backup-manifest.test.ts` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 2 | BKP-04 | T-02-11 | Tier 3 schema equality; PG17 guard tokens canonicalised, never skipped | integration | `pnpm db:drill` | ❌ W0 | ⬜ pending |
| 02-02-02 | 02 | 2 | BKP-04 | T-02-11 | Tier 4 content fingerprints, spot checks, orphan rows, sequence state | integration | `docker compose exec -T db psql -U recipe_app -d recipe_dev -tAc "SELECT count(*) FROM steps WHERE timer_label IS NULL;"` | ✅ | ⬜ pending |
| 02-02-03 | 02 | 2 | BKP-04 | T-02-12 | Every tier proven in the failing direction, so no tier can silently no-op | unit | `pnpm exec vitest run tests/drill-assertions.test.ts` | ❌ W0 | ⬜ pending |
| 02-03-01 | 03 | 3 | BKP-02, BKP-05 | T-02-14 | `db:restore` acts only on the pinned dev target; no dump is left inside the container | integration | `pnpm db:restore` | ❌ W0 | ⬜ pending |
| 02-03-02 | 03 | 3 | BKP-02 | T-02-13 | `db:restore:cluster` prints an explicit verdict on whether the globals restore was exercised | integration | `pnpm db:restore:cluster` | ❌ W0 | ⬜ pending |
| 02-03-03 | 03 | 3 | BKP-05 | T-02-15 | No-target property locked by a permanent structural guardrail, not by convention | unit + integration | `pnpm exec vitest run tests/guardrails.test.ts` | ❌ W0 | ⬜ pending |
| 02-04-01 | 04 | 4 | BKP-07, BKP-08 | T-02-22 | Two-fact record; code may never write the `human` half | integration | `node -e "...status-two-facts-ok..."` | ✅ | ⬜ pending |
| 02-04-01 | 04 | 4 | BKP-08 | T-02-19 | Status record provably carries no credential-shaped string | source assertion | `node -e "...status-no-credentials-ok..."` | ✅ | ⬜ pending |
| 02-04-02 | 04 | 4 | BKP-08 | T-02-20 | Staleness gate fails on a missing record, a FAIL outcome, and a >30-day-old run | unit | `pnpm exec vitest run tests/drill-status.test.ts` | ❌ W0 | ⬜ pending |
| 02-04-03 | 04 | 4 | BKP-07 | T-02-21 | Slow drill test excluded from the fast suite by construction | unit + config assertion | `pnpm test:drill` | ❌ W0 | ⬜ pending |
| 02-05-01 | 05 | 5 | BKP-01 | T-02-22 | Pre-flight the drill and stage the backup the owner restores from | integration | `pnpm db:drill` | ❌ W0 | ⬜ pending |
| 02-05-02 | 05 | 5 | BKP-01, BKP-05 | T-02-22 | Owner performs and times both acts — `gate="blocking-human"`, auto-approval impossible | manual-only | N/A — human action | N/A | ⬜ pending |
| 02-05-03 | 05 | 5 | BKP-06 | T-02-22 | Runbook written after the fact, carrying measured timings and the CASCADE finding | doc-structure assertion | `node -e "...runbook-structure-ok..."` | ✅ | ⬜ pending |
| 02-05-03 | 05 | 5 | BKP-01 | T-02-22 | Human fact recorded only from the owner's report, automated half undisturbed | integration | `node -e "...human-fact-recorded-ok..."` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*"File Exists ❌ W0" means the test file is created by this phase's own Wave 0 work below — not that the check is missing.*

---

## Wave 0 Requirements

- [ ] `pnpm add -D @testcontainers/postgresql@12.1.0` — the one new dependency this phase needs
- [ ] `tests/backup-manifest.test.ts` — manifest round-trip plus a "contains no credential-shaped string" assertion (extend the `not.toContain("postgres://")` pattern from `tests/db-reset.test.ts` to also reject any SCRAM verifier substring in the manifest and in captured stdout/stderr)
- [ ] `tests/drill-assertions.test.ts` — failing-direction fixtures for every tier-3 and tier-4 assertion
- [ ] `tests/restore-cli.test.ts` and `tests/guardrails.test.ts` — the no-target refusal test and the permanent structural guardrail
- [ ] `tests/drill-status.test.ts` — D-19's three hard-fail conditions (missing record, FAIL outcome, >30-day-old `lastRunAt`)
- [ ] `tests/drill/restore-drill.test.ts` — the full drill exercised end-to-end (slow suite; the automated proof of BKP-02/03/04/07)
- [ ] `vitest.drill.config.ts` plus a `tests/drill/` exclude in `vitest.config.ts` — the fast/slow suite split

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Owner personally performs and times a full backup and restore | BKP-01 | The requirement is that a human did it — an automated proxy would defeat the point | Plan 02-05 Task 2, `gate="blocking-human"`. Perform act 1 (drop a table, restore in place) and act 2 (rebuild the cluster, restore globals then data), timing both. |
| Deliberate destruction test: drop a table, restore, confirm the data returned | BKP-05 | Same — the drill is only proof if the owner ran it against real data | Plan 02-05 Task 2. `DROP TABLE recipes CASCADE`, then `pnpm db:restore`, then confirm rows and foreign keys returned. |
| Runbook written from an actual performed restore | BKP-06 | Whether prose reflects lived experience is not machine-checkable; only its required structure is | Plan 02-05 Task 3 asserts structure (a "What actually happened" section, a retained UNKNOWN, the CASCADE finding, a measured timing). A human reads it for truthfulness. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies — *the deterministic probe confirms 43/43 commands carry a `<fails_when>`; the file-existence half is the Wave 0 work above*
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s (fast suite)
- [ ] `nyquist_compliant: true` set in frontmatter — **not this run.** plan-phase seeds this contract; `/gsd-validate-phase` §6 owns the flip once Wave 0 lands and the map is green.

**Approval:** pending
