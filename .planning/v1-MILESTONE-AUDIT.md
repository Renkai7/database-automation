---
milestone: v1
audited: 2026-09-08T18:00:00Z
status: gaps_found
audit_scope: mid-milestone
audit_note: >
  Phases 4-7 of 7 are not started. The 31 requirements assigned to them are
  recorded unsatisfied because they are unbuilt, not because delivered work
  failed. Read the "Delivered scope" figures for the audit's real signal.
scores:
  requirements: 21/52
  requirements_in_delivered_scope: 21/21
  phases: 3/7
  integration: 6/7
  flows: 3/4
gaps:
  requirements:
    - id: "APP-01"
      status: "partial"
      phase: "Phase 1 — Local Environment"
      claimed_by_plans: ["01-02-PLAN.md", "01-03-PLAN.md", "01-05-PLAN.md", "01-08-PLAN.md"]
      completed_by_plans: ["01-02-SUMMARY.md", "01-05-SUMMARY.md"]
      verification_status: "passed"
      evidence: >
        Three-source cross-reference disagrees on bookkeeping only. 01-VERIFICATION.md marks
        APP-01 SATISFIED with live HTTP smoke-test evidence; SUMMARY frontmatter for 01-02 and
        01-05 both list it; the REQUIREMENTS.md traceability row says "Complete — verified
        2026-09-07". But REQUIREMENTS.md:85 still reads "[ ]". Substantively satisfied — tick
        the checkbox. Carried unfixed from the earlier same-day audit.
    - id: "RUN-01 … RUN-08, APP-02"
      status: "unsatisfied"
      phase: "Phase 4 — Migration Runner & History Tests"
      claimed_by_plans: []
      completed_by_plans: []
      verification_status: "missing"
      evidence: "No phase directory, no plans, no SUMMARY, no VERIFICATION. ROADMAP.md lists Plans: TBD. Not started."
    - id: "CI-01 … CI-06"
      status: "unsatisfied"
      phase: "Phase 5 — CI Pipeline Gate"
      claimed_by_plans: []
      completed_by_plans: []
      verification_status: "missing"
      evidence: "Not started. No phase directory. Integration checker confirms no CI workflow exists at all."
    - id: "CONN-01 … CONN-05"
      status: "unsatisfied"
      phase: "Phase 6 — Private Staging Connectivity"
      claimed_by_plans: []
      completed_by_plans: []
      verification_status: "missing"
      evidence: "Not started. Decision D4 (Tailscale subnet-route vs. restricted SSH tunnel) still unresolved."
    - id: "PROD-01 … PROD-06, AUD-01 … AUD-04, APP-03"
      status: "unsatisfied"
      phase: "Phase 7 — Production Runner, Environment Gate & Audit Log"
      claimed_by_plans: []
      completed_by_plans: []
      verification_status: "missing"
      evidence: "Not started. No phase directory."
  integration:
    - seam: "packages/automation → scripts/log.ts"
      severity: "defect"
      status: "boundary violation, still present"
      evidence: >
        cli.ts:25 imports "../../../scripts/log"; inspector/inspect.ts:41 and
        inspector/inspect-plpgsql.ts:58 import "../../../../scripts/log".
        packages/automation/package.json declares only libpg-query as a runtime dependency
        and @types/node + squawk-cli as dev dependencies — no dependency edge on the root
        package or scripts/. Resolves today only because pnpm resolves relative paths on disk.
      affects: >
        No REQ-ID directly. Blocks clean Phase 7 package extraction; Phase 4's runner will
        consume this package through its exports map and inherit the fragility.
      first_reported: "earlier same-day audit — unchanged since"
    - seam: "db:generate / db:migrate / db:reset → db:analyze"
      severity: "expected-gap"
      status: "unwired"
      evidence: >
        package.json db:generate and db:migrate invoke drizzle-kit directly. Nothing invokes
        db:analyze between generation and application, and no CI config exists. A migration
        can reach the dev database today without ever being classified.
      affects: >
        RUN-01, RUN-02 (Phase 4), CI-01, CI-02 (Phase 5). Not a defect in delivered scope —
        the analyzer is correct, it is simply not yet a gate.
    - seam: "tests/drill/restore-drill.test.ts → default pnpm test"
      severity: "warning"
      status: "intentionally excluded, no automatic re-trigger"
      evidence: >
        vitest.config.ts excludes tests/drill/** (documented, Docker-dependency-driven). The
        staleness gate DOES run by default — tests/drill-status.test.ts:66-68 hard-fails
        pnpm test against a >30-day-old docs/restore-drill-status.json — so a stale drill is
        visible. What has no trigger is regenerating a fresh result: that needs a human or a
        future CI step to run pnpm test:drill.
      affects: "BKP-07 (partial), BKP-08 (visibility itself is wired). Closing the trigger half is Phase 5 scope."
  flows:
    - flow: "Schema change → migration generated → classified → applied → app boots"
      status: "breaks at 'classified'"
      severity: "expected-gap"
      evidence: "Every other link verified against source. The classify link belongs to Phase 4/5 and is not built."
tech_debt:
  - phase: 01-local-environment
    items:
      - "01-VERIFICATION.md frontmatter says status: passed; the body says Status: human_needed and lists 5 undecided human-verification items. The frontmatter was flipped in an uncommitted working-tree edit. The two halves of the same file now contradict each other."
      - "5 open human-verification items: design-canvas visual comparison; breakpoint confirmation (<834 / 834-1439 / >=1440); dropped desktop app-shell nav (D-07); servings stepper always visible; A-07 recipe-header partial UI-SPEC row."
      - "01-REVIEW WR-02 (Info): scripts/env.ts:56 DEV_DATABASE_HOST_ALLOWLIST holds a bare '::1' that no parser ever produces — dead entry, no bypass."
      - "01-REVIEW WR-03 (Warning): scripts/db-reset.ts:20 waitForReadyFallback hardcodes 'recipe_app'/'recipe_dev' instead of importing EXPECTED_DEV_DATABASE_NAME. A rename would silently probe the wrong name."
      - "01-REVIEW IN-02 (Info): tests/guardrails.test.ts:44 CONNECTION_STRING_SCHEME_PREFIX matches postgres:// only, not postgresql://."
      - "Deferred to Phase 4: database-level CHECK constraint on recipes.base_servings, and behavioural (not source-level) coverage of the servings-guard negative direction. Recorded as T-01-31, disposition transfer."
      - "01-VERIFICATION.md:171 asserts both Phase 1 traceability rows read 'Gap closure done — awaiting re-verification'. They now read 'Complete — verified 2026-09-07'. Stale artifact row."
  - phase: 02-backup-restore-drill
    items:
      - "Accepted gap (owner decision 2026-09-07): per-step timings for backup/drop/restore/verify were never separately measured; only two aggregate ranges exist, and human decision time is labelled inferred, not measured. The roadmap success criterion is still met."
      - "02-REVIEW WR-03 (Warning, most significant): restoreIntoDevContainer relies on call-site discipline rather than internal enforcement of the pinned role/database — in direct tension with this project's 'architectural enforcement over remembered caution' non-negotiable. The integration checker confirms every current call site does assert, so there is no live bypass; the contract is the debt, not a defect."
      - "02-REVIEW WR-01…WR-08 (remainder, all open): dead finally cleanup in backup.ts; missing import.meta.main guard on restore-cluster.ts; unvalidated manifest keys interpolated into SQL identifiers; silent cleanup-failure swallowing; a weak substring assertion in a safety-critical test; duplicated manifest-resolution helper; same-second backup filename collision."
      - "WINDOWS.md: 3 open entries (env.example sandbox-permission gap; a restore-cluster.ts comment defect the owner actually hit during the timed drill; a Phase 1 no-genuine-RED-phase deviation)."
  - phase: 03-safety-analyzer
    items:
      - "Production PostgreSQL major version remains UNKNOWN (docs/decisions.md D16). Dev/CI is pinned to PG17 (D9) while the analyzer parses with libpg-query's pg18 grammar — a deliberate, argued choice, not an oversight, but the underlying fact is still unverified. Blocks a confident pin of the postgres:*-alpine client image tag."
      - "03-REVIEW WR-03: the packages/automation → scripts/log boundary violation, deliberately deferred to Phase 7's package extraction. See the integration defect above."
      - "DROP OWNED BY <role> classifies REVIEW_REQUIRED, not BLOCKED — an open owner judgement call on whether it belongs on the D-02 floor."
      - "RulesFile structural-typing / loadRules-vs-classifyFacts entry-point-convention note, recommended for Phase 4/7 planning attention."
  - phase: cross-cutting
    items:
      - "REQUIREMENTS.md's footer (lines 144-149) describes a traceability state that no longer exists — it says both Phase 1 rows read 'Gap closure done — awaiting re-verification'. They now read 'Complete — verified 2026-09-07'. Update or drop the note."
      - "Decision D4 (Tailscale subnet-route vs. restricted SSH tunnel) remains unresolved. It is Phase 6's first success criterion and gates that phase's planning."
nyquist:
  compliant_phases: ["02-backup-restore-drill", "03-safety-analyzer"]
  partial_phases: ["01-local-environment"]
  not_validated_phases: []
  missing_phases: []
  overall: partial
  detail: >
    01-VALIDATION.md is status: validated with nyquist_compliant: false — a genuine PARTIAL,
    not an unreconciled draft. 30 of 36 coverage items are automated; 6 are manual-only, and
    one of those (01-08-D1 / GAP-2, the servings-guard negative direction) is a real automation
    gap deferred to Phase 4 rather than an inherently-human check. GAP-1 (ENV-01, live server
    version) and GAP-3 (ENV-02, schema scope) were both closed by
    tests/dev-database-baseline.test.ts.
---

# Milestone v1 — Audit Report

**Audited:** 2026-09-08
**Scope:** mid-milestone (3 of 7 phases executed)
**Status:** `gaps_found`

## Reading this report

The FAIL gate forces `gaps_found` because 31 of 52 v1 requirements are unsatisfied. All 31
belong to Phases 4-7, which have no directory, no plan, and no code. That is the roadmap
working as designed, not a delivery failure.

**Within delivered scope, all 21 requirements assigned to Phases 1-3 are satisfied**, confirmed
by three independent sources. One is a stale checkbox. Everything else below is debt and
carryover, not blocked work.

## Requirements Coverage — 3-Source Cross-Reference

| Req | Traceability | Phase VERIFICATION | SUMMARY frontmatter | Checkbox | Final |
|-----|--------------|--------------------|---------------------|----------|-------|
| ENV-01 | Complete | SATISFIED | 01-01 | `[x]` | **satisfied** |
| ENV-02 | Complete | SATISFIED | 01-02, 01-03, 01-06 | `[x]` | **satisfied** |
| ENV-03 | Complete | SATISFIED | 01-01, 01-02, 01-06 | `[x]` | **satisfied** |
| ENV-04 | Complete | SATISFIED | 01-04, 01-07 | `[x]` | **satisfied** |
| ENV-05 | Complete | SATISFIED | 01-04, 01-07 | `[x]` | **satisfied** |
| APP-01 | Complete | SATISFIED | 01-02, 01-05 | `[ ]` | **satisfied (checkbox stale)** |
| BKP-01 | Complete | SATISFIED | 02-05 | `[x]` | **satisfied** |
| BKP-02 | Complete | SATISFIED | 02-01 | `[x]` | **satisfied** |
| BKP-03 | Complete | SATISFIED | 02-01 | `[x]` | **satisfied** |
| BKP-04 | Complete | SATISFIED | 02-02 | `[x]` | **satisfied** |
| BKP-05 | Complete | SATISFIED | 02-05 | `[x]` | **satisfied** |
| BKP-06 | Complete | SATISFIED | 02-05 | `[x]` | **satisfied** |
| BKP-07 | Complete | SATISFIED | 02-04 | `[x]` | **satisfied** (see drill-trigger warning) |
| BKP-08 | Complete | SATISFIED | 02-04 | `[x]` | **satisfied** |
| ANLZ-01 | Complete | SATISFIED | 03-01, 03-03, 03-04 | `[x]` | **satisfied** |
| ANLZ-02 | Complete | SATISFIED | 03-01, 03-02, 03-03, 03-05 | `[x]` | **satisfied** |
| ANLZ-03 | Complete | SATISFIED | 03-01, 03-02 | `[x]` | **satisfied** |
| ANLZ-04 | Complete | SATISFIED | 03-02, 03-05 | `[x]` | **satisfied** |
| ANLZ-05 | Complete | SATISFIED | 03-04, 03-06 | `[x]` | **satisfied** |
| ANLZ-06 | Complete | SATISFIED | 03-07 | `[x]` | **satisfied** |
| ANLZ-07 | Complete | SATISFIED | 03-05, 03-06 | `[x]` | **satisfied** |
| RUN-01…08, APP-02 | Pending | — | — | `[ ]` | **unsatisfied** (Phase 4 not started) |
| CI-01…06 | Pending | — | — | `[ ]` | **unsatisfied** (Phase 5 not started) |
| CONN-01…05 | Pending | — | — | `[ ]` | **unsatisfied** (Phase 6 not started) |
| PROD-01…06, AUD-01…04, APP-03 | Pending | — | — | `[ ]` | **unsatisfied** (Phase 7 not started) |

**Orphan detection:** none. Every REQ-ID in the traceability table for Phases 1-3 appears in at
least one phase VERIFICATION.md requirements table *and* in at least one SUMMARY's
`requirements-completed` frontmatter. No requirement was assigned and then silently unverified.

## Phase Verification Summary

| Phase | VERIFICATION status | Score | Gaps remaining |
|-------|---------------------|-------|----------------|
| 01 Local Environment | `passed` in frontmatter / `human_needed` in body — **contradictory** | 6/6 truths | 0 blocking; 5 human-judgment items open |
| 02 Backup & Restore Drill | `passed`, gap accepted by owner 2026-09-07 | 33/34 must-haves | 1 accepted (per-step timings) |
| 03 Safety Analyzer | `passed` | 5/5 truths | 0 |
| 04-07 | missing | — | phases not started |

### The Phase 1 verification contradiction

`.planning/phases/01-local-environment/01-VERIFICATION.md` carries `status: passed` in its
frontmatter, but its body reads `**Status:** human_needed` and its Gaps Summary states plainly:
*"a phase with every truth verified and zero gaps still is not `passed` while human verification
items are outstanding."* The frontmatter was changed from `human_needed` to `passed` in an
uncommitted working-tree edit; none of the 5 human-verification items has been dispositioned.

This is the one finding in this audit that could mislead a later reader, because the frontmatter
is what tooling reads. Either disposition the 5 items and let the status stand, or revert the
frontmatter to `human_needed`. Do not leave the file arguing with itself.

## Cross-Phase Integration

Verified against source by `gsd-integration-checker`, not from phase narratives.

| Seam | Status | Detail |
|------|--------|--------|
| Phase 1 → Phase 2 (env guardrails) | WIRED | `restore.ts`, `restore-cluster.ts`, `backup.ts`, `db-reset.ts`, `drill.ts` all import and call `getDevDatabaseUrl()` + `assertDevelopmentDatabase()` before any query executes. `env.ts:193-204` re-validates at the live connection via `current_database()` (D-21) — designed to survive a restore that could otherwise carry a stale environment marker in table data. No path found where a restore can write to the wrong database. |
| Phase 1 → recipe-app fixture | WIRED | `apps/recipe-app/drizzle.config.ts:2,10-11` calls `assertLocalDevelopmentTarget(url)` at config-load time, before `defineConfig` evaluates — it executes on every `drizzle-kit generate`/`migrate`. |
| Phase 2 → Phase 3 (test suite) | WIRED | Both run under the same default `pnpm test`; the drill staleness gate hard-fails alongside the analyzer tests, so the two cannot silently diverge. |
| Phase 3 internal (package boundary) | **DEFECT** | `cli.ts:25`, `inspect.ts:41`, `inspect-plpgsql.ts:58` reach out of the package into root `scripts/log`. `packages/automation/package.json` declares no such dependency. Unchanged since the previous audit. |
| Phase 3 → dev loop (analyze chain) | EXPECTED-GAP | `db:analyze` is not chained into `db:generate`/`db:migrate`/`db:reset`, and no CI workflow exists. Phase 4/5 scope. |
| Drill test → default suite | WARNING | `tests/drill/restore-drill.test.ts` runs only under `pnpm test:drill`. Deliberate (Docker dependency, documented in `vitest.config.ts`). Staleness of the committed result *is* checked by default; only regeneration lacks a trigger. |
| Analyzer CLI internals | WIRED | Parse → facts → rules → floor → verdict → five distinct exit codes plus human report and machine JSON, exercised by its own adversarial fixture suite. |

**6/7 sound within delivered scope.** The one defect is the package-boundary import.

## End-to-End Flows

| Flow | Status |
|------|--------|
| Live dev DB → backup → restore into fresh container → content asserted → status recorded | COMPLETE — traced `backup.ts` → `restore-cluster.ts`/`restore.ts` → `drill.ts:33` → `drill-status.ts` → `docs/restore-drill-status.json` |
| Migration SQL (incl. adversarial forms) → analyzer CLI → exit code + report + JSON | COMPLETE — self-contained and correct; adversarial fixtures present for dollar-quote collision, embedded reparse, dynamic SQL, PL/pgSQL, and multi-subcommand `ALTER TABLE` |
| Test entry point → covers Phase 1, 2, 3 assertions | COMPLETE with one disclosed exclusion — the Testcontainers drill E2E is opt-in via `test:drill` |
| Schema change → migration generated → **classified** → applied → app boots | BREAKS AT `classified` — Phase 4/5 scope, expected |

**3/4 complete.** The fourth is the milestone's whole remaining point, and it is exactly what
Phase 4 exists to build.

## Nyquist Validation Coverage

| Phase | VALIDATION.md | status | nyquist_compliant | Verdict | Action |
|-------|---------------|--------|-------------------|---------|--------|
| 01 Local Environment | exists | validated | false | **PARTIAL** | See note below — re-running validate-phase will not close it |
| 02 Backup & Restore Drill | exists | validated | true | **COMPLIANT** | none |
| 03 Safety Analyzer | exists | validated | true | **COMPLIANT** | none |

Phase 01 is a genuine PARTIAL, not an unreconciled draft: 30 of 36 coverage items are automated,
6 are manual-only, and one of those six (01-08-D1 / GAP-2 — the servings-guard's negative
direction) is a real automation gap deferred to Phase 4 rather than an inherently-human check.
GAP-1 (ENV-01, live server version) and GAP-3 (ENV-02, schema scope) were both closed by
`tests/dev-database-baseline.test.ts`.

Re-running `/gsd-validate-phase 01` will not flip this to compliant on its own — the gap is a
missing test that Phase 4's database-constraint work is the natural place to add.

## Tech Debt

See the `tech_debt` block in this document's frontmatter for the itemised list. Summary:

| Phase | Items | Most significant |
|-------|-------|------------------|
| 01 Local Environment | 7 | The VERIFICATION.md status contradiction; 5 undecided human-judgment items |
| 02 Backup & Restore Drill | 4 | WR-03 — `restoreIntoDevContainer` enforces its target by call-site convention, not internal contract, against this project's own "architectural enforcement over remembered caution" non-negotiable |
| 03 Safety Analyzer | 4 | Production PostgreSQL major version still UNKNOWN (D16) |
| Cross-cutting | 2 | Decision D4 (staging connectivity mechanism) unresolved — gates Phase 6 |

**Total: 17 items across 4 groupings.** None blocks Phase 4.

## What actually needs a decision

1. **Resolve the Phase 1 verification status contradiction.** Frontmatter and body disagree; the
   frontmatter edit is uncommitted.
2. **Tick APP-01** in `REQUIREMENTS.md:85` and refresh the stale footer note (lines 144-149).
3. **Decide on 02-REVIEW WR-03** before Phase 4 builds on the restore path — it is the one open
   item that contradicts a stated non-negotiable rather than merely deferring work.
4. **Close D16** (production PostgreSQL major version) before Phase 5/6 pin a client image.
5. **Resolve D4** (Tailscale vs. restricted SSH tunnel) — it is Phase 6's first success criterion.

---

*Audited by `/gsd-audit-milestone`. Supersedes the earlier same-day audit at commit `a1bbbac`,
which predated the Nyquist validation work in commits `0160cac`…`2626cf8`.*
