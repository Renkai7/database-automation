---
phase: "5"
slug: "ci-pipeline-gate"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-09-09"
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded from `05-RESEARCH.md` § Validation Architecture. The Per-Task
> Verification Map is filled by `/gsd-validate-phase` once PLAN.md task IDs exist.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 5.0.0 (verified `package.json`) |
| **Config file** | `vitest.config.ts` (fast suite), `vitest.history.config.ts` (Testcontainers, `tests/history/**`), `vitest.drill.config.ts` (Testcontainers, `tests/drill/**`) |
| **Quick run command** | `pnpm test` |
| **Full suite command** | `pnpm test && pnpm test:history` |
| **Estimated runtime** | UNKNOWN — measure on first CI run; `pnpm test` is the fast DB-light suite, `pnpm test:history` pays Testcontainers startup |

Drill (`vitest.drill.config.ts`) is scheduled, not per-PR, per D-13 — it is
deliberately outside this phase's per-PR sampling loop.

---

## Sampling Rate

- **After every task commit:** Run `pnpm test`
- **After every plan wave:** Run `pnpm test && pnpm test:history`
- **Before `/gsd-verify-work`:** Full suite must be green, **plus** a real pull
  request opened against the remote exercising every required check at least
  once, **plus** D-18's personally-performed merge-refusal attempt.
- **Max feedback latency:** UNKNOWN until first measured run — target the fast
  suite staying under ~60s so per-task sampling stays honest.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| _pending_ | — | — | — | — | — | — | — | — | ⬜ pending |

*Populated by `/gsd-validate-phase` after PLAN.md task IDs exist.*

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Unit tests for the D-09 append-only git-diff logic (synthetic fixtures, not real git mutation)
- [ ] Unit tests for the D-10 journal-entry comparison logic (synthetic before/after journal JSON pairs)
- [ ] Unit tests for the pure renderer (`AnalysisResult[] → markdown`), including the D-07 "introduced by this PR" vs "pre-existing" grouping and the D-16 zero-findings case
- [ ] `tests/guardrails.test.ts` extension proving application source never triggers a migration at boot (D-15)
- [ ] Fixture-driven unit tests for the D-05 ruleset self-check's assertion logic (sample API response JSON in, pass/fail out) — separate from the live API call

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Repository owner cannot merge a PR with a failing required check | CI-03 | No test inside the system can prove GitHub's own enforcement against the owner's own permissions; only the owner performing the attempt settles it (D-18) | Open a PR containing a known-BLOCKED migration; wait for required checks to report failure; attempt to merge using owner/admin permissions; record that the merge button is unavailable and that no bypass path was offered |
| Analyzer verdict + reasoning visible on the PR | CI-04 | Posting can only be observed on a real PR with a live token; the renderer half is unit-testable, the posting half is not | On the same PR, confirm a single sticky comment shows the classification and its reasoning, and that a re-run edits that comment rather than adding a second |
| Every required check actually runs on a PR | CI-01 | A check that never runs leaves the PR Pending — a workflow-structure fact, observable only on a real run | On the same PR, confirm analyzer, both history axes, and the app test suite each report a completed check |
| Migrations run as their own isolated pipeline step | CI-06 | Half is a structural fact about the checked-in YAML, not a runtime assertion | Inspect the workflow file: the migrate job is a distinct job invoked by the pipeline, with no migration invocation in any app container entrypoint/CMD/startup hook |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency measured and recorded (currently UNKNOWN)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
