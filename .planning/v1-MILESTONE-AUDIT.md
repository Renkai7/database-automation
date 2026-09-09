---
milestone: v1
audited: 2026-09-08T21:30:00Z
status: gaps_found
audit_scope: mid-milestone
audit_note: >
  Phases 5-7 of 7 are not started. The 22 requirements assigned to them are recorded
  unsatisfied because they are unbuilt, not because delivered work failed. Read the
  "delivered scope" figures for the audit's real signal. This audit supersedes the
  2026-09-08T18:00:00Z audit, which predated Phase 4.
scores:
  requirements: 30/52
  requirements_in_delivered_scope: 30/30
  phases: 4/7
  integration: 7/8
  flows: 4/4
gaps:
  requirements:
    - id: "CI-01 … CI-06"
      status: "unsatisfied"
      phase: "Phase 5 — CI Pipeline Gate"
      claimed_by_plans: []
      completed_by_plans: []
      verification_status: "missing"
      evidence: >
        Not started. No phase directory, no plans. Integration checker confirms no
        `.github/` directory exists at all — there is no CI workflow of any kind.
    - id: "CONN-01 … CONN-05"
      status: "unsatisfied"
      phase: "Phase 6 — Private Staging Connectivity"
      claimed_by_plans: []
      completed_by_plans: []
      verification_status: "missing"
      evidence: >
        Not started. Decision D4 (Tailscale subnet-route vs. restricted SSH tunnel)
        still unresolved — it is this phase's first success criterion and gates planning.
    - id: "PROD-01 … PROD-06, AUD-01 … AUD-04, APP-03"
      status: "unsatisfied"
      phase: "Phase 7 — Production Runner, Environment Gate & Audit Log"
      claimed_by_plans: []
      completed_by_plans: []
      verification_status: "missing"
      evidence: "Not started. No phase directory."
  integration:
    - seam: "packages/automation → root scripts/log"
      severity: "defect"
      status: "boundary violation, persistent AND widened by Phase 4"
      evidence: >
        Four instances confirmed by direct grep: cli.ts:25 (`../../../scripts/log`),
        inspector/inspect.ts:41, inspector/inspect-plpgsql.ts:58, and — new in Phase 4 —
        runner/run-migrations.ts:27 (`../../../../scripts/log`).
        packages/automation/package.json declares only libpg-query as a runtime dependency;
        it has no dependency edge on the root package or scripts/. This is a real pnpm
        workspace (pnpm-workspace.yaml lists apps/*, packages/*), so each package's
        package.json name/exports imply an isolation the imports do not respect. It resolves
        today only because relative filesystem imports bypass node module resolution.
        apps/recipe-app/src/db/client.ts:3 does the same thing (`../../../../scripts/env`),
        so this is a repo-wide pattern, not an isolated slip.
      affects: >
        No REQ-ID directly. Blocks clean Phase 7 package extraction. Directly contradicts
        this project's "architectural enforcement over remembered caution" non-negotiable:
        the boundary is held by developers keeping relative-path depth in sync, not by a
        declared dependency or a guardrail test — unlike the drizzle-kit migrate ban at
        tests/guardrails.test.ts:317-334, which IS test-enforced.
      first_reported: "Phase 3 audit — unclosed, and one instance added since"
    - seam: "committed migration-history PASS record → runner source changes"
      severity: "warning"
      status: "gate exists and runs by default, but is change-blind"
      evidence: >
        vitest.config.ts:12 excludes tests/history/** from the default suite (deliberate,
        documented, Docker-dependent — vitest.history.config.ts is the separate entry point).
        The default suite DOES gate the committed record: tests/history-status.test.ts:153-161
        hard-fails unless docs/migration-history-status.json is a committed PASS. But
        scripts/history-status.ts carries no staleness rule by design, on the stated rationale
        that history tests are deterministic against committed migrations so time alone cannot
        stale them. That rationale covers passage of time, not passage of code: nothing ties
        the PASS record to a hash of the runner source it validates, so editing
        run-migrations.ts / ledger.ts / runner-table.ts without re-running `pnpm test:history`
        leaves a stale-but-schema-valid PASS the default suite accepts. Contrast the drill's
        equivalent gate, which is age-based (MAX_DRILL_AGE_DAYS, proven both directions at
        tests/drill-status.test.ts:93-119) and so degrades safely.
      affects: "RUN-05, RUN-06, RUN-08 — validated only as freshly as the last manual test:history run."
  flows: []
tech_debt:
  - phase: 01-local-environment
    items:
      - "01-VERIFICATION.md frontmatter says `status: passed`; the body (line 88) says `**Status:** human_needed` and its own Gaps Summary states 'a phase with every truth verified and zero gaps still is not passed while human verification items are outstanding.' The frontmatter was flipped in a still-uncommitted working-tree edit. The two halves of the same file contradict each other. Carried unchanged from the previous audit."
      - "5 open human-verification items, none dispositioned: design-canvas visual comparison; breakpoint confirmation (<834 / 834-1439 / >=1440); dropped desktop app-shell nav (D-07); servings stepper always visible; A-07 recipe-header partial UI-SPEC row."
      - "01-REVIEW WR-02 (Info): scripts/env.ts:56 DEV_DATABASE_HOST_ALLOWLIST holds a bare '::1' that no parser ever produces — dead entry, no bypass."
      - "01-REVIEW WR-03 (Warning): scripts/db-reset.ts:20 waitForReadyFallback hardcodes 'recipe_app'/'recipe_dev' instead of importing EXPECTED_DEV_DATABASE_NAME. A rename would silently probe the wrong name."
      - "01-REVIEW IN-02 (Info): tests/guardrails.test.ts:44 CONNECTION_STRING_SCHEME_PREFIX matches postgres:// only, not postgresql://."
      - "01-VERIFICATION.md:171 asserts both Phase 1 traceability rows read 'Gap closure done — awaiting re-verification'. They now read 'Complete — verified 2026-09-07'. Stale artifact row."
      - "Nyquist PARTIAL: 01-08-D1 / GAP-2 (servings-guard negative direction) is a real automation gap that was deferred to Phase 4. Phase 4 has now completed WITHOUT closing it — the deferral target has passed."
  - phase: 02-backup-restore-drill
    items:
      - "Accepted gap (owner decision 2026-09-07, recorded in frontmatter as gap_disposition: accepted-by-owner): per-step timings for backup/drop/restore/verify were never separately measured; only two aggregate ranges exist, and human decision time is labelled inferred, not measured. The roadmap success criterion is still met."
      - "02-REVIEW WR-03 (Warning, most significant): restoreIntoDevContainer relies on call-site discipline rather than internal enforcement of the pinned role/database — in direct tension with the 'architectural enforcement over remembered caution' non-negotiable. The integration checker re-confirms every current call site does assert (backup.ts:24,56,71; restore.ts:22-24,276,279,293; restore-cluster.ts:24-26,131,134,142,228), so there is no live bypass; the contract is the debt, not a defect."
      - "02-REVIEW WR-01…WR-08 (remainder, all open): dead finally cleanup in backup.ts; missing import.meta.main guard on restore-cluster.ts; unvalidated manifest keys interpolated into SQL identifiers; silent cleanup-failure swallowing; a weak substring assertion in a safety-critical test; duplicated manifest-resolution helper; same-second backup filename collision."
      - "WINDOWS.md: 3 open entries (env.example sandbox-permission gap; a restore-cluster.ts comment defect the owner hit during the timed drill; a Phase 1 no-genuine-RED-phase deviation)."
  - phase: 03-safety-analyzer
    items:
      - "Production PostgreSQL major version remains UNKNOWN (docs/decisions.md D16). Dev/CI is pinned to PG17 (D9) while the analyzer parses with libpg-query's pg18 grammar — a deliberate, argued choice (newer grammar is a near-superset, so the failure direction is rejecting valid syntax, never missing a hazard), but the underlying fact is still unverified. Blocks a confident pin of the postgres:*-alpine client image tag."
      - "03-REVIEW WR-03: the packages/automation → scripts/log boundary violation, deferred to Phase 7's package extraction. Now widened by Phase 4 — see the integration defect above."
      - "DROP OWNED BY <role> classifies REVIEW_REQUIRED, not BLOCKED — an open owner judgement call on whether it belongs on the D-02 floor."
      - "RulesFile structural-typing / loadRules-vs-classifyFacts entry-point-convention note, recommended for Phase 7 planning attention."
  - phase: 04-migration-runner-history-tests
    items:
      - "04-VERIFICATION.md's Anti-Patterns table (lines 135-139) is STALE: all three findings it lists as open (multi-object DROP truncation, duplicate journal `when`, seed.ts process.exit) were fixed after it was written, per 04-REVIEW-FIX.md (status: all_fixed, 3/3) at commits 1c4fde0, c3c861d, d12ffc0. Verified against source: inspect.ts:305-317 now fans out one StatementFacts per DROP object; the duplicate-`when` guard landed in adapter/drizzle-migrations.ts; seed.ts:110,114 now set process.exitCode. The verification report should be reconciled or annotated so a later reader does not re-open closed findings."
      - "docs/migration-history-status.json records lastRunAt: 2026-09-09T00:02:00.240Z — one day ahead of the 2026-09-08 run date. Most likely container/system clock skew, not a functional defect, but unverified. Worth a sanity check given this project's own 'mark unverified things UNKNOWN' rule."
      - "No /gsd-verify-work UAT pass has been run for Phase 4; the verifier reported no human-verification items were required."
  - phase: cross-cutting
    items:
      - "REQUIREMENTS.md's footer note (lines 144-158) has grown into a change-log and now describes superseded states. Consider trimming to the current fact."
      - "Decision D4 (Tailscale subnet-route vs. restricted SSH tunnel) remains unresolved. It is Phase 6's first success criterion and gates that phase's planning."
      - "Two slow suites (tests/drill/**, tests/history/**) are now excluded from the default run, each gated by a committed status record. Only one of the two gates degrades safely over time. Phase 5's CI work is the natural place to give both a real trigger."
nyquist:
  compliant_phases: ["02-backup-restore-drill", "03-safety-analyzer", "04-migration-runner-history-tests"]
  partial_phases: ["01-local-environment"]
  not_validated_phases: []
  missing_phases: []
  overall: partial
  detail: >
    01-VALIDATION.md is status: validated with nyquist_compliant: false — a genuine PARTIAL,
    not an unreconciled draft. 30 of 36 coverage items are automated; 6 are manual-only, and
    one of those (01-08-D1 / GAP-2, the servings-guard negative direction) is a real automation
    gap that was explicitly deferred to Phase 4. Phase 4 is now complete and did not close it,
    so the deferral no longer has a target. Re-running /gsd-validate-phase 01 will not flip
    this — the gap is a missing test, not an unreconciled file.
---

# Milestone v1 — Audit Report

**Audited:** 2026-09-08
**Scope:** mid-milestone (4 of 7 phases executed)
**Status:** `gaps_found`

## Reading this report

The FAIL gate forces `gaps_found` because 22 of 52 v1 requirements are unsatisfied. All 22
belong to Phases 5-7, which have no directory, no plan, and no code. That is the roadmap
working as designed, not a delivery failure.

**Within delivered scope, all 30 requirements assigned to Phases 1-4 are satisfied**, confirmed
by three independent sources with zero disagreements. The previous audit's one bookkeeping
discrepancy (the stale `APP-01` checkbox) has been closed.

**The headline change since the last audit:** the end-to-end flow that previously broke at
`classified` now completes. Phase 4 closed it. That was the milestone's whole remaining point
at the 3-phase mark.

## Requirements Coverage — 3-Source Cross-Reference

| Req | Traceability | Phase VERIFICATION | SUMMARY frontmatter | Checkbox | Final |
|-----|--------------|--------------------|---------------------|----------|-------|
| ENV-01 | Complete | SATISFIED | 01-01 | `[x]` | **satisfied** |
| ENV-02 | Complete | SATISFIED | 01-02, 01-03, 01-06 | `[x]` | **satisfied** |
| ENV-03 | Complete | SATISFIED | 01-01, 01-02, 01-06 | `[x]` | **satisfied** |
| ENV-04 | Complete | SATISFIED | 01-04, 01-07 | `[x]` | **satisfied** |
| ENV-05 | Complete | SATISFIED | 01-04, 01-07 | `[x]` | **satisfied** |
| APP-01 | Complete | SATISFIED | 01-02, 01-05 | `[x]` | **satisfied** |
| BKP-01 | Complete | SATISFIED | 02-05 | `[x]` | **satisfied** |
| BKP-02 | Complete | SATISFIED | 02-01 | `[x]` | **satisfied** |
| BKP-03 | Complete | SATISFIED | 02-01 | `[x]` | **satisfied** |
| BKP-04 | Complete | SATISFIED | 02-02 | `[x]` | **satisfied** |
| BKP-05 | Complete | SATISFIED | 02-05 | `[x]` | **satisfied** |
| BKP-06 | Complete | SATISFIED | 02-05 | `[x]` | **satisfied** |
| BKP-07 | Complete | SATISFIED | 02-04 | `[x]` | **satisfied** |
| BKP-08 | Complete | SATISFIED | 02-04 | `[x]` | **satisfied** |
| ANLZ-01 | Complete | SATISFIED | 03-01, 03-03, 03-04 | `[x]` | **satisfied** |
| ANLZ-02 | Complete | SATISFIED | 03-01, 03-02, 03-03, 03-05 | `[x]` | **satisfied** |
| ANLZ-03 | Complete | SATISFIED | 03-01, 03-02 | `[x]` | **satisfied** |
| ANLZ-04 | Complete | SATISFIED | 03-02, 03-05 | `[x]` | **satisfied** |
| ANLZ-05 | Complete | SATISFIED | 03-04, 03-06 | `[x]` | **satisfied** |
| ANLZ-06 | Complete | SATISFIED | 03-07 | `[x]` | **satisfied** |
| ANLZ-07 | Complete | SATISFIED | 03-05, 03-06 | `[x]` | **satisfied** |
| RUN-01 | Complete | SATISFIED | 04-01, 04-03 | `[x]` | **satisfied** |
| RUN-02 | Complete | SATISFIED | 04-01, 04-02 | `[x]` | **satisfied** |
| RUN-03 | Complete | SATISFIED | 04-01, 04-04 | `[x]` | **satisfied** |
| RUN-04 | Complete | SATISFIED | 04-04 | `[x]` | **satisfied** |
| RUN-05 | Complete | SATISFIED | 04-03 | `[x]` | **satisfied** |
| RUN-06 | Complete | SATISFIED | 04-03 | `[x]` | **satisfied** |
| RUN-07 | Complete | SATISFIED | 04-07 | `[x]` | **satisfied** |
| RUN-08 | Complete | SATISFIED | 04-05 | `[x]` | **satisfied** |
| APP-02 | Complete | SATISFIED | 04-06, 04-07 | `[x]` | **satisfied** |
| CI-01…06 | Pending | — | — | `[ ]` | **unsatisfied** (Phase 5 not started) |
| CONN-01…05 | Pending | — | — | `[ ]` | **unsatisfied** (Phase 6 not started) |
| PROD-01…06, AUD-01…04, APP-03 | Pending | — | — | `[ ]` | **unsatisfied** (Phase 7 not started) |

**All three sources agree on all 30 delivered requirements.** No checkbox is stale this pass.

**Orphan detection:** none. Every REQ-ID the traceability table assigns to Phases 1-4 appears in
at least one phase VERIFICATION.md requirements table *and* in at least one SUMMARY's
`requirements-completed` frontmatter. No requirement was assigned and then silently unverified.

Two SUMMARYs carry an empty `requirements-completed` (`01-08`, `02-03`). Both are gap-closure /
infrastructure plans that deliberately declared no new requirement IDs — not a coverage hole.

## Phase Verification Summary

| Phase | VERIFICATION status | Score | Gaps remaining |
|-------|---------------------|-------|----------------|
| 01 Local Environment | `passed` in frontmatter / `human_needed` in body — **contradictory** | 6/6 truths | 0 blocking; 5 human-judgment items open |
| 02 Backup & Restore Drill | `passed` + `gap_disposition: accepted-by-owner` | 33/34 must-haves | 1 accepted (per-step timings) |
| 03 Safety Analyzer | `passed` | 5/5 truths | 0 |
| 04 Migration Runner & History Tests | `passed` | 5/5 must-haves | 0 blocking; anti-pattern table stale (see below) |

### The Phase 1 verification contradiction (unchanged, still open)

`01-VERIFICATION.md` carries `status: passed` in its frontmatter, but its body reads
`**Status:** human_needed` and its Gaps Summary states plainly: *"a phase with every truth
verified and zero gaps still is not `passed` while human verification items are outstanding."*
The frontmatter was changed from `human_needed` to `passed` in an edit that is **still
uncommitted** in the working tree; none of the 5 human-verification items has been dispositioned.

This is the one finding in this audit that could mislead a later reader, because the frontmatter
is what tooling reads. Either disposition the 5 items and let the status stand, or revert the
frontmatter to `human_needed`. Do not leave the file arguing with itself.

Phase 2 has a superficially similar mismatch (`status: passed` in frontmatter, `gaps_found` in
the body) but it is **legitimate**: the frontmatter carries an explicit `gap_disposition:
accepted-by-owner` block with the dated decision and its reasoning. That is a documented
reconciliation. Phase 1 has no such record.

### Phase 4's stale anti-pattern table

`04-VERIFICATION.md` lists three open warnings. All three were fixed after it was written —
`04-REVIEW-FIX.md` records `status: all_fixed`, 3 of 3, and each fix was independently confirmed
against source during this audit:

| Finding | Verification says | Actual state |
|---|---|---|
| `inspectDropStmt` reads only `objects[0]` | ⚠️ open | **Fixed** (`1c4fde0`) — `inspect.ts:305-317` fans out one `StatementFacts` per object, with a new corpus fixture and `multi-object-drop.test.ts` |
| No duplicate journal `when` guard | ⚠️ open | **Fixed** (`c3c861d`) — guard landed in `adapter/drizzle-migrations.ts` |
| `seed.ts` uses `process.exit()` | ℹ️ open | **Fixed** (`d12ffc0`) — `seed.ts:110,114` now set `process.exitCode` |

Reconcile or annotate the verification report so a later reader does not re-open closed findings.

## Cross-Phase Integration

Verified against source by `gsd-integration-checker`, with file:line evidence, not from phase
narratives.

| Seam | Status | Detail |
|------|--------|--------|
| Phase 1 → Phase 2 (env guardrails) | WIRED | `backup.ts:24,56,71`, `restore.ts:22-24,276,279,293`, `restore-cluster.ts:24-26,131,134,142,228` all call `getDevDatabaseUrl()` then `assertDevelopmentDatabase(client)` before any query executes. |
| Phase 1 → recipe-app fixture | WIRED | `drizzle.config.ts:16-17` calls `getDevDatabaseUrl()` then `assertLocalDevelopmentTarget(url)` synchronously at config-load time. |
| **Phase 3 → Phase 4 (analyzer → runner)** | **WIRED** | `run-migrations.ts:308-323` classifies every pending migration via `analyzeSql(file.sql, rules)` on the exact in-memory bytes in Phase A, strictly before any execution in Phase B (330-367). The BLOCKED branch (335-360) throws `MigrationRefusedError` unconditionally. `runMigrations`'s parameter surface is a closed four keys (`client`, `migrations`, `rules`, `now`, 262-266); `db-migrate.ts:98-99` sources them only from `enumerateMigrationFiles`/`loadDefaultRules`. **No flag, env var, or config path reaches the BLOCKED branch.** |
| `db:migrate` → drizzle-kit's own migrate | WIRED | `package.json:10` routes `db:migrate` to `scripts/db-migrate.ts`, never `drizzle-kit migrate`; `tests/guardrails.test.ts:317-334` test-enforces that the string is unreachable anywhere in the source surface, with no per-file allowlist. |
| Transaction policy → analyzer facts only | WIRED | `transaction-policy.ts:56-68` reads only `finding.facts.transactionHostile` — no duplicated SQL-semantics knowledge in the runner. |
| ANLZ-06 squawk cross-check | WIRED (by design, not a gate) | `squawk-comparison-report.test.ts` runs in the default suite; deliberately not invoked from the gating path, per the project's own decision that squawk is a second opinion, not the policy engine. |
| Drill test → default suite | WIRED | `tests/drill-status.test.ts:93-119` proves the 30-day `MAX_DRILL_AGE_DAYS` hard-fail in both directions; `:66-68` gates the committed record in the default suite; `:144-168` proves the recorder never overwrites the separate `human` fact. |
| History suite → default suite | WARNING | The gate exists and runs by default (`history-status.test.ts:153-161` hard-fails on a non-PASS record), but is change-blind — see the integration warning in frontmatter. |
| **`packages/automation` → root `scripts/log`** | **DEFECT** | Four instances: `cli.ts:25`, `inspect.ts:41`, `inspect-plpgsql.ts:58`, and now `runner/run-migrations.ts:27`. `packages/automation/package.json` declares no such dependency. Phase 4 widened this rather than closing it. |
| Phase 5 CI | EXPECTED-GAP | No `.github/` directory exists at all. |

**7/8 delivered-scope seams sound.** The one defect is the package-boundary import, which is now
one instance worse than at the last audit.

## End-to-End Flows

| Flow | Status |
|------|--------|
| Live dev DB → backup → restore into fresh container → content asserted → status recorded | COMPLETE |
| Migration SQL (incl. adversarial forms) → analyzer CLI → exit code + report + JSON | COMPLETE |
| Test entry point → covers Phase 1-4 assertions | COMPLETE with two disclosed exclusions (`test:drill`, `test:history`), both gated by committed status records in the default suite |
| **Schema change → migration generated → classified → applied → app boots** | **COMPLETE** — was BREAKS AT `classified` at the last audit |

**4/4 complete.** The fourth flow is traced end to end: schema edit → `db:generate` (config-gated
by `assertLocalDevelopmentTarget`) → real migration file (5 real journal entries in
`meta/_journal.json`) → `db:migrate` → `runMigrations` classifies before executing → BLOCKED
refused with no override. This is not only unit-tested: `packages/automation/test/corpus/manifest.json:582`
records a live run in which a real `drizzle-kit generate`-produced `DROP TABLE ingredients CASCADE`
was refused through `pnpm db:migrate`, added zero ledger rows, and was reverted.

The app-boot link (RUN-07) is genuinely automated, contrary to an initial UNKNOWN from the
integration pass: `tests/smoke.test.ts` performs a real production build, a real `next start`, and
real HTTP fetches asserting database-sourced content, and it is inside the default `pnpm test`
glob. One honest caveat: it asserts the app boots against whatever schema the dev database
currently holds — it does not itself run a migration first. The migrate→boot ordering was proven
by a documented manual `pnpm db:reset` → smoke run recorded in `docs/30-migration-runner.md`,
not by an automated sequence.

## Nyquist Validation Coverage

| Phase | VALIDATION.md | status | nyquist_compliant | Verdict | Action |
|-------|---------------|--------|-------------------|---------|--------|
| 01 Local Environment | exists | validated | false | **PARTIAL** | See note — re-running validate-phase will not close it |
| 02 Backup & Restore Drill | exists | validated | true | **COMPLIANT** | none |
| 03 Safety Analyzer | exists | validated | true | **COMPLIANT** | none |
| 04 Migration Runner & History Tests | exists | validated | true | **COMPLIANT** | none |

Phase 01 is a genuine PARTIAL, not an unreconciled draft: 30 of 36 coverage items are automated,
6 are manual-only, and one of those six (01-08-D1 / GAP-2 — the servings-guard's negative
direction) is a real automation gap that was explicitly **deferred to Phase 4**.

**Phase 4 is now complete and did not close it.** The deferral no longer has a target. This is
the one Nyquist item that has actually degraded since the last audit — not because anything
broke, but because the phase it was parked against has shipped. Decide whether it moves to a
later phase or gets closed directly.

## Tech Debt

See the `tech_debt` block in this document's frontmatter for the itemised list. Summary:

| Phase | Items | Most significant |
|-------|-------|------------------|
| 01 Local Environment | 7 | The VERIFICATION.md status contradiction (still uncommitted); 5 undecided human-judgment items; the orphaned Phase-4 deferral |
| 02 Backup & Restore Drill | 4 | WR-03 — `restoreIntoDevContainer` enforces its target by call-site convention, not internal contract |
| 03 Safety Analyzer | 4 | Production PostgreSQL major version still UNKNOWN (D16) |
| 04 Migration Runner & History Tests | 3 | Stale anti-pattern table (3 findings closed but still recorded open); unexplained 1-day clock skew in the history status record |
| Cross-cutting | 3 | Decision D4 (staging connectivity mechanism) unresolved — gates Phase 6 |

**Total: 21 items across 5 groupings.** None blocks Phase 5.

## What actually needs a decision

1. **Resolve the Phase 1 verification status contradiction.** Frontmatter and body disagree and
   the edit is still uncommitted. Carried unchanged across two audits now.
2. **Close or re-home the package-boundary defect.** It is the only integration defect, it got
   worse in Phase 4, and it directly contradicts a stated non-negotiable — the boundary is held
   by convention, not enforcement. A guardrail test forbidding `../../../scripts/` imports from
   `packages/automation/src/**` would make it architectural, and this repo already has the
   pattern for exactly that at `tests/guardrails.test.ts:317-334`.
3. **Re-home the orphaned Phase 1 Nyquist deferral** (servings-guard negative direction) now that
   Phase 4 has shipped without it.
4. **Reconcile `04-VERIFICATION.md`'s anti-pattern table** with `04-REVIEW-FIX.md`.
5. **Decide on 02-REVIEW WR-03** — the restore path's call-site-convention contract.
6. **Close D16** (production PostgreSQL major version) before Phase 5/6 pin a client image.
7. **Resolve D4** (Tailscale vs. restricted SSH tunnel) — it is Phase 6's first success criterion
   and gates that phase's planning.

---

*Audited by `/gsd-audit-milestone`. Supersedes the 2026-09-08T18:00:00Z audit, which predated
Phase 4.*
