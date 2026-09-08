---
phase: "02"
slug: "backup-restore-drill"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: validated
nyquist_compliant: true
wave_0_complete: true
created: "2026-09-07"
validated: "2026-09-08"
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded from `02-RESEARCH.md` § Validation Architecture and the five PLAN.md
> `<verify>` blocks; audited and corrected by `/gsd-validate-phase` on 2026-09-08
> against the live tree, with every listed command actually executed.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 5.0.0 |
| **Config file** | `vitest.config.ts` (fast suite; excludes `tests/drill/**`) and `vitest.drill.config.ts` (slow suite; includes only `tests/drill/`) — the split added by 02-04 Task 3 |
| **Quick run command** | `pnpm test` |
| **Full suite command** | `pnpm test` (fast) + `pnpm test:drill` (slow) |
| **Measured runtime** | **Fast suite ≈43 s** — 33 files / 321 tests; two runs on 2026-09-08 measured 43.9 s and 43.3 s. **Slow suite 12.9 s** — 1 test, which spawns the real `pnpm db:drill` end-to-end. |

*The fast suite is repo-wide, not Phase-02-scoped: it grew from 81 tests at this
phase's close to 321 as Phase 03 landed. The runtime figure above is therefore a
whole-repo measurement, not an attribute of this phase's own tests.*

---

## Sampling Rate

- **After every task commit:** `pnpm test`
- **After every plan wave:** `pnpm test`, plus one `pnpm test:drill` run (which invokes
  `pnpm db:drill` for real) to keep `docs/restore-drill-status.json` fresh
- **Before `/gsd-verify-work`:** fast suite green, `pnpm test:drill` green, and the human
  drill (BKP-01 / BKP-05 / BKP-06) actually performed
- **Measured feedback latency:** **≈43 s** for the fast suite, measured 2026-09-08.

> **The original `< 15 s` latency budget is withdrawn, not quietly met.** It was set
> when this suite was Phase-02-sized (81 tests, ~10 s). Phase 03 grew it to 321 tests
> and ≈43 s. Recording the measured figure rather than restating an unmet target is
> required by this project's "do not record assumptions as facts" non-negotiable. If
> sub-15-second feedback is wanted again it needs a deliberate decision (a watch-mode
> subset, or a third suite tier) — it is not something this phase can claim.

---

## Per-Task Verification Map

All commands below were executed against the live tree on 2026-09-08. Status reflects
that run, not an expectation.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | BKP-02, BKP-03, BKP-04, BKP-07 | T-02-01 | Globals dump handled as an opaque blob; no verifier reaches stdout, git or the manifest | integration (tracer) | `pnpm test:drill` | ✅ | ✅ green |
| 02-01-01 | 01 | 1 | BKP-02 | T-02-01 | Drill container bootstraps as `drilluser`, so the globals restore genuinely creates roles | source assertion | `node -e "...drill-bootstrap-identity-ok..."` (02-01-PLAN Task 1) | ✅ | ✅ green |
| 02-01-01 | 01 | 1 | BKP-03 | T-02-03 | No command script parses `process.argv` — the no-target property is structural | source assertion | `pnpm exec vitest run tests/guardrails.test.ts` | ✅ | ✅ green |
| 02-01-02 | 01 | 1 | BKP-02 | T-02-01 | Manifest provably carries no connection string and no SCRAM verifier | unit | `pnpm exec vitest run tests/backup-manifest.test.ts` | ✅ | ✅ green |
| 02-02-01 | 02 | 2 | BKP-04 | T-02-11 | Tier 3 schema equality; PG17 guard tokens canonicalised, never skipped | integration | `pnpm test:drill` | ✅ | ✅ green |
| 02-02-02 | 02 | 2 | BKP-04 | T-02-11 | Tier 4 content fingerprints, spot checks, orphan rows, sequence state | integration | `pnpm test:drill`; spot-check probe `docker compose exec -T db psql -U recipe_app -d recipe_dev -tAc "SELECT count(*) FROM steps WHERE timer_label IS NULL;"` (returns 2 — non-vacuous) | ✅ | ✅ green |
| 02-02-03 | 02 | 2 | BKP-04 | T-02-12 | Every tier proven in the failing direction, so no tier can silently no-op | unit | `pnpm exec vitest run tests/drill-assertions.test.ts` | ✅ | ✅ green |
| 02-03-01 | 03 | 3 | BKP-02, BKP-05 | T-02-14 | `db:restore` acts only on the pinned dev target; no dump is left inside the container | integration | `pnpm exec vitest run tests/restore-cli.test.ts` (refusal path + unchanged row counts); positive restore path covered by `pnpm test:drill` | ✅ | ✅ green |
| 02-03-02 | 03 | 3 | BKP-02 | T-02-13 | `db:restore:cluster` prints an explicit verdict on whether the globals restore was exercised | integration | `pnpm exec vitest run tests/restore-cli.test.ts` | ✅ | ✅ green |
| 02-03-03 | 03 | 3 | BKP-05 | T-02-15 | No-target property locked by a permanent structural guardrail, not by convention | unit + integration | `pnpm exec vitest run tests/guardrails.test.ts` | ✅ | ✅ green |
| 02-04-01 | 04 | 4 | BKP-07, BKP-08 | T-02-22 | Two-fact record; code may never write the `human` half | unit | `pnpm exec vitest run tests/drill-status.test.ts` (the "never writes the human fact — leaves it byte-identical" case) | ✅ | ✅ green |
| 02-04-01 | 04 | 4 | BKP-08 | T-02-19 | Status record provably carries no credential-shaped string | unit | `pnpm exec vitest run tests/restore-docs.test.ts` | ✅ | ✅ green |
| 02-04-02 | 04 | 4 | BKP-08 | T-02-20 | Staleness gate fails on a missing record, a FAIL outcome, and a >30-day-old run | unit | `pnpm exec vitest run tests/drill-status.test.ts` | ✅ | ✅ green |
| 02-04-03 | 04 | 4 | BKP-07 | T-02-21 | Slow drill test excluded from the fast suite by construction | unit + config assertion | `pnpm test:drill`; `node -e "...suite-split-ok..."` (02-04-PLAN Task 3) | ✅ | ✅ green |
| 02-05-01 | 05 | 5 | BKP-01 | T-02-22 | Pre-flight the drill and stage the backup the owner restores from | integration | `pnpm test:drill` | ✅ | ✅ green |
| 02-05-02 | 05 | 5 | BKP-01, BKP-05 | T-02-22 | Owner performs and times both acts — `gate="blocking-human"`, auto-approval impossible | manual-only | N/A — human action | N/A | ✅ performed 2026-09-07 |
| 02-05-03 | 05 | 5 | BKP-06 | T-02-22 | Runbook written after the fact, carrying measured timings and the CASCADE finding | doc-structure assertion | `pnpm exec vitest run tests/restore-docs.test.ts` | ✅ | ✅ green |
| 02-05-03 | 05 | 5 | BKP-01 | T-02-22 | Human fact recorded only from the owner's report, automated half undisturbed | doc-structure assertion | `pnpm exec vitest run tests/restore-docs.test.ts` | ✅ | ✅ green |
| 02-05-03 | 05 | 5 | — (plan-level) | T-02-22 | `00-current-state.md` §6 production UNKNOWNs stay unticked; R1 cites the runbook | doc-structure assertion | `pnpm exec vitest run tests/restore-docs.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements — complete

- [x] `pnpm add -D @testcontainers/postgresql@12.1.0`
- [x] `tests/backup-manifest.test.ts` — manifest round-trip + no-credential-shaped-string assertion
- [x] `tests/drill-assertions.test.ts` — failing-direction fixtures for every tier-3 and tier-4 assertion (14 cases)
- [x] `tests/restore-cli.test.ts` and `tests/guardrails.test.ts` — no-target refusal + permanent structural guardrail
- [x] `tests/drill-status.test.ts` — D-19's three hard-fail conditions, plus the human-fact-immutability case
- [x] `tests/drill/restore-drill.test.ts` — the full drill end-to-end (slow suite)
- [x] `vitest.drill.config.ts` plus a `tests/drill/` exclude in `vitest.config.ts`
- [x] `tests/restore-docs.test.ts` — **added by this validation pass**; see the audit below

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Owner personally performs and times a full backup and restore | BKP-01 | The requirement is that a human did it — an automated proxy would defeat the point | Plan 02-05 Task 2, `gate="blocking-human"`. **Performed 2026-09-07**; recorded in `docs/restore-drill-status.json`'s human fact and `docs/20-restore-runbook.md`. |
| Deliberate destruction test: drop a table, restore, confirm the data returned | BKP-05 | Same — the drill is only proof if the owner ran it against real data | Plan 02-05 Task 2. **Performed 2026-09-07.** |
| Runbook reads as truthful, not merely well-structured | BKP-06 | Whether prose reflects lived experience is not machine-checkable; only its required structure is | `tests/restore-docs.test.ts` now asserts the structure continuously. A human still reads it for truthfulness. |
| Per-step timings (backup / drop / restore / verify) and separately-clocked human decision time | BKP-01 (plan-added must-have, D-09) | Cannot be reconstructed retroactively — it needs a fresh stopwatched drill | **Open and accepted.** `02-VERIFICATION.md` records this as the phase's one gap, `gap_disposition: accepted-by-owner` on 2026-09-07: only two aggregate ranges exist (3–4 min first-run, 1–2 min copy-paste-only) and the human component is explicitly labelled *inferred, not measured*. The roadmap Success Criterion ("timed the whole procedure") is met; the plan's stricter self-imposed elaboration is not. Discharging it requires re-performing the drill with per-step timing capture. |
| Act-2 globals restore against a genuinely role-empty cluster | BKP-02 | The local machine's rebuilt cluster is never role-empty, so `pnpm db:restore:cluster` reports "NOT EXERCISED" | **Open risk, carried forward** from 02-05-SUMMARY and `docs/00-current-state.md` R1. Only `pnpm db:drill`'s disposable container exercises that path — which it does, green, every `pnpm test:drill` run. |
| `pnpm db:restore` / `pnpm db:restore:cluster` positive path against the live dev DB | BKP-05 | These commands rewrite or rebuild the live development database; running them as routine sampling would destroy dev state | Run deliberately, not on every commit. Follow `docs/20-restore-runbook.md`. The refusal/guardrail half is continuously covered by `tests/restore-cli.test.ts`; the positive restore path is continuously covered against a disposable container by `pnpm test:drill`. |

---

## Validation Audit 2026-09-08

| Metric | Count |
|--------|-------|
| Gaps found | 5 |
| Resolved | 5 |
| Escalated | 0 |

**Evidence gathered this pass** — every command in the map above was executed, not assumed:
`pnpm test` (33 files / 321 tests green, ≈43 s), `pnpm test:drill` (1/1 green, 12.9 s, which
ran the real `pnpm db:drill` → `automated.outcome: PASS`, all four tiers true, human fact
byte-identical, dev DB row counts unchanged), 5 read-only `psql` probes, and all 8 `node -e`
assertions from the PLAN `<verify>` blocks.

| ID | Finding | Disposition |
|----|---------|-------------|
| G1 | Row 02-04-01's `status-two-facts-ok` command asserted `human.outcome === 'UNKNOWN'` — true only *before* Plan 02-05's drill set it to `PASS`. It exited 1 on this run and would do so permanently: a point-in-time check that had been recorded as a regression check. | **Resolved (map correction).** The underlying invariant — code may never write the human half — was already durably covered by `tests/drill-status.test.ts`'s "never writes the human fact — leaves it byte-identical" case, green. Row repointed there. No new test needed. |
| G2 | `runbook-structure-ok`, `human-fact-recorded-ok`, `current-state-updated-ok` and `status-no-credentials-ok` existed **only** as one-off `node -e` strings inside PLAN `<verify>` blocks. Nothing in `pnpm test` re-ran them, so BKP-01/BKP-06/BKP-08's documented properties could regress silently — deleting the runbook's "What actually happened" section, or blanking the human fact, would have gone undetected. | **Resolved (new test).** `tests/restore-docs.test.ts` created: 12 cases folding all four assertions into the sampled fast suite. Each predicate is factored into a named helper and exercised **both** against the real committed file and against a deliberately mutated in-memory copy, so none can pass vacuously. Credential needles are assembled at runtime to stay compatible with `tests/guardrails.test.ts`'s source-surface scan. |
| G3 | Rows 02-03-01 and 02-03-02 named `pnpm db:restore` / `pnpm db:restore:cluster` as their automated command. Both rewrite or rebuild the live dev database, so they can never be routine sampling — the map was specifying something that must not be run on a commit cadence. | **Resolved (map correction).** Rows repointed to `tests/restore-cli.test.ts` (refusal path, unchanged row counts) with the positive restore path covered by `pnpm test:drill` against a disposable container. The live commands are now listed under Manual-Only as deliberate, occasional actions. |
| G4 | `tests/restore-cli.test.ts` was a Wave 0 deliverable, present and green, but had no row in the Per-Task Verification Map — coverage that existed but was not tracked. | **Resolved.** Now cited by rows 02-03-01 and 02-03-02. |
| G5 | Sign-off claimed "Feedback latency < 15 s (fast suite)" and the infrastructure table said "~10 s". Measured: ≈43 s. The suite grew from 81 to 321 tests when Phase 03 landed. | **Resolved (contract corrected).** The `< 15 s` budget is withdrawn and the measured ≈43 s recorded in its place, with the reason stated. Restating an unmet target as if satisfied would violate this project's "do not record assumptions as facts" non-negotiable. |

---

## Validation Sign-Off

- [x] All tasks have automated verification or an explicitly justified manual-only entry
- [x] Wave 0 complete — every listed test file exists and is green
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] No watch-mode flags in any recorded command
- [x] Every recorded command executed on 2026-09-08 and observed green
- [x] Every doc/status assertion is non-vacuous — proven in the failing direction, not merely passing today
- [ ] ~~Feedback latency < 15s (fast suite)~~ — **budget withdrawn, not met.** Measured ≈43 s; see Sampling Rate.
- [x] `nyquist_compliant: true` — every requirement (BKP-01 … BKP-08) has automated verification that runs green, with the residual human-judgment items honestly enumerated under Manual-Only rather than papered over.

**Approval:** validated 2026-09-08 by `/gsd-validate-phase`.
