---
phase: 02-backup-restore-drill
verified: 2026-09-07T23:30:00Z
status: gaps_found
score: 33/34 must-haves verified
covered_files: [".planning/REQUIREMENTS.md",".planning/phases/02-backup-restore-drill/02-01-PLAN.md",".planning/phases/02-backup-restore-drill/02-01-SUMMARY.md",".planning/phases/02-backup-restore-drill/02-02-PLAN.md",".planning/phases/02-backup-restore-drill/02-02-SUMMARY.md",".planning/phases/02-backup-restore-drill/02-03-PLAN.md",".planning/phases/02-backup-restore-drill/02-03-SUMMARY.md",".planning/phases/02-backup-restore-drill/02-04-PLAN.md",".planning/phases/02-backup-restore-drill/02-04-SUMMARY.md",".planning/phases/02-backup-restore-drill/02-05-PLAN.md",".planning/phases/02-backup-restore-drill/02-05-SUMMARY.md",".planning/phases/02-backup-restore-drill/02-REVIEW.md","docs/00-current-state.md","docs/20-restore-runbook.md","docs/README.md","docs/decisions.md","docs/restore-drill-status.json","package.json","scripts/backup-manifest.ts","scripts/backup.ts","scripts/drill-assertions.ts","scripts/drill-status.ts","scripts/drill.ts","scripts/env.ts","scripts/restore-cluster.ts","scripts/restore.ts","tests/backup-manifest.test.ts","tests/drill-assertions.test.ts","tests/drill-status.test.ts","tests/drill/restore-drill.test.ts","tests/guardrails.test.ts","tests/restore-cli.test.ts","vitest.config.ts","vitest.drill.config.ts"]
covered_digest: "v1:sha256:6c01173a401c4b7851b89ff1b8327abe5fffac71f2e7698c9577ff3bd45e4e69"
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "The runbook records per-step timings for backup, drop, restore and verify, and separately the human time spent reading and deciding (02-05-PLAN.md must_have, D-09)."
    status: partial
    reason: "docs/20-restore-runbook.md explicitly and honestly states per-step timings were NOT SEPARATELY MEASURED during the drill — only two aggregate ranges exist (3-4 min first-run, 1-2 min copy-paste-only). The human reading-and-deciding time is not a measured figure either; the document itself labels it 'inferred... not measured' from the gap between the two aggregate ranges. This is a real, disclosed shortfall against the plan's own stated must-have, not a fabrication — the executor chose honesty over inventing numbers, consistent with this project's 'mark unverified UNKNOWN' rule. The roadmap-level success criterion ('timed the whole procedure') is still satisfied by the aggregate figures; only the plan's stricter, self-imposed per-step requirement is unmet."
    artifacts:
      - path: "docs/20-restore-runbook.md"
        issue: "No per-step timing breakdown (backup/drop/restore/verify) exists for either act; human decision time is inferred, not separately clocked."
    missing:
      - "Nothing further can be added retroactively without re-performing the drill with a stopwatch per step — this is a one-time human action, not a code fix. Options for a human decision: (a) accept as-is (the aggregate timing plus honest disclosure satisfies the roadmap's actual success criterion), or (b) schedule a follow-up drill with per-step timing capture before treating BKP-01/D-09 as fully discharged in the stricter sense the plan intended."
---

# Phase 2: Backup and Restore Drill Verification Report

**Phase Goal:** The owner has personally proven — by destroying and restoring real data — that
backups actually work, timed the procedure, and written the runbook from what actually happened.
An automated restore test asserts real content against a genuinely fresh instance, not just an
exit code.

**Verified:** 2026-09-07T23:30:00Z
**Status:** gaps_found (one disclosed, non-fabricated shortfall against a plan-added must-have;
see below — this is a soft, honestly-surfaced gap, not a cover-up)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths — Roadmap Success Criteria

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | Owner personally dropped a real table, restored using a backup including both the globals dump and the data dump, confirmed the data returned, and timed the whole procedure — runbook written from what actually happened | ✓ VERIFIED | `docs/20-restore-runbook.md` "What actually happened" section; `docs/restore-drill-status.json` human fact (`outcome: PASS`, `lastPerformedAt: 2026-09-07`); `docs/decisions.md` D7 consequence-discharged note. Aggregate timing recorded (3-4 min / 1-2 min); see gap below on per-step granularity. |
| SC2 | An automated restore test runs against a genuinely fresh (never pre-seeded) disposable database matching production's image/extensions, asserts row counts, referential integrity, and spot-checked values — not just an exit code — and its pass/fail/skipped status is visibly reported, never silently swallowed | ✓ VERIFIED | `scripts/drill.ts` (fresh `postgres:17` Testcontainers container per run, non-colliding bootstrap user); `scripts/drill-assertions.ts` (4 tiers: artifact integrity, row counts, schema equality, content/referential/sequence integrity — all reject their own vacuous case); `scripts/drill-status.ts` (`recordAutomatedDrillResult`, `assertDrillStatusFresh`); `docs/restore-drill-status.json` committed; `tests/drill-status.test.ts` (staleness gate proven in all 3 failing directions); `tests/drill/restore-drill.test.ts` (end-to-end proof the drill reports, not merely runs); no `"skipped"` outcome exists anywhere in the schema (D-20). |

### Observable Truths — Plan-Level Must-Haves (34 total, merged and deduplicated across 02-01..02-05)

| # | Truth (abbreviated) | Status | Evidence |
|---|---|---|---|
| 1 | `db:backup` writes 3 artifacts (data `-Fc`, globals, manifest) outside repo | ✓ VERIFIED | `scripts/backup.ts`; `scripts/env.ts` `assertBackupDestination` rejects in-repo paths |
| 2 | Filenames free of Windows ADS characters | ✓ VERIFIED | `compactTimestamp` regex-tested in `tests/backup-manifest.test.ts` |
| 3 | `db:drill` takes backup, starts never-pre-seeded `postgres:17`, restores globals then data, asserts content | ✓ VERIFIED | `scripts/drill.ts` full sequence read directly |
| 4 | Drill bootstrap identity collides with no source role | ✓ VERIFIED | `DRILL_BOOTSTRAP_USERNAME = "drilluser"` ≠ `recipe_app`; `withUsername(DRILL_BOOTSTRAP_USERNAME)` |
| 5 | Every restore step's exit code AND stderr inspected, never a bare exit-code check | ✓ VERIFIED | `restore.ts`/`restore-cluster.ts` throw with captured `stderr` on non-zero exit |
| 6 | No command accepts a target parameter | ✓ VERIFIED | `tests/guardrails.test.ts` "no Phase 2 command script reads process.argv..." — permanent structural test, confirmed present and passing |
| 7 | No connection string/password verifier in manifest/stdout/stderr/git file | ✓ VERIFIED | `ManifestSchema`/`DrillStatusSchema` have no such field; globals dump only ever copied/hashed |
| 8 | Drill compares schema-only source vs. restored, fails on diff | ✓ VERIFIED | `assertSchemaEquality` in `scripts/drill-assertions.ts`, wired in `drill.ts` |
| 9 | Canonicalizes PG17 per-invocation guard tokens | ✓ VERIFIED | `canonicalizeSchemaDump` strips `\restrict`/`\unrestrict` lines |
| 10 | Every table content-fingerprinted at backup, re-fingerprinted after restore | ✓ VERIFIED | `contentHashes` in manifest + `assertContentHashes` |
| 11 | Named spot-checks incl. NULL timer label proving NULL-vs-empty-string survives | ✓ VERIFIED | `spotChecks.steps` preserves `timerLabel: null`; asserted in `assertSpotCheckedValues` |
| 12 | Every FK checked for orphans; every sequence's last value compared | ✓ VERIFIED | `assertNoOrphanRows` (enumerates from information_schema, rejects zero-constraint case), `assertSequenceState` |
| 13 | Drill against DB with no recipe-core tables fails loudly, not vacuously | ✓ VERIFIED | `runBackup` throws naming the missing table before any dump byte is written |
| 14 | `db:restore` restores newest dump in place into pinned dev DB | ✓ VERIFIED | `scripts/restore.ts` `main()` |
| 15 | `db:restore:cluster` restores globals then data into rebuilt cluster | ✓ VERIFIED | `scripts/restore-cluster.ts` `main()` |
| 16 | Neither restore command, nor any command in the phase, reads a CLI argument | ✓ VERIFIED | Same guardrail test as #6, covers all 4 command scripts |
| 17 | Both restore commands refuse a redirected connection var, before writing anything | ✓ VERIFIED | `assertDevelopmentDatabase`/`assertLocalDevelopmentTarget` run before any write; `tests/restore-cli.test.ts` asserts unchanged seeded row counts after refusal |
| 18 | `db:restore:cluster` states explicitly whether globals restore was exercised or a no-op | ✓ VERIFIED | `restore-cluster.ts` pre-flight role check, verbatim verdict strings; runbook confirms this fired as "NOT EXERCISED" in the real run |
| 19 | Neither restore command leaves a dump/globals file in the container after finishing (success or failure) | ✓ VERIFIED (WARNING noted) | `finally` blocks in `restore.ts`/`restore-cluster.ts` remove temp files unconditionally on both paths. **Caveat already tracked in 02-REVIEW.md WR-05** — the `rm` result is never inspected (`{ reject: false }`), so a failed cleanup would be silent. Not a live exploit today (no observed failure); recorded as pre-existing known debt, not a new gap. |
| 20 | `docs/restore-drill-status.json` committed, two-fact record, no credential | ✓ VERIFIED | File read directly; contains no connection-string/SCRAM-prefix string |
| 21 | Automated and human facts tracked as two independent facts | ✓ VERIFIED | `DrillStatusSchema` `{ automated, human }` |
| 22 | No code path can set the human fact's outcome | ✓ VERIFIED | `recordAutomatedDrillResult`'s signature (`AutomatedDrillOutcome`) has no parameter capable of naming/influencing `human`; carries `existingHuman` through unchanged — read directly in `scripts/drill-status.ts` |
| 23 | A drill that could not run exits non-zero and writes nothing (no "skipped" outcome) | ✓ VERIFIED | `runDrill()`: nothing before container start touches the status file; `backup.ts`'s own `runStep` calls `process.exit(1)` directly on backup failure, so `runDrill` never resumes in that case; no "skipped" enum value exists anywhere |
| 24 | A drill that ran and failed an assertion records FAIL and exits non-zero | ✓ VERIFIED | `drill.ts` lines 252-281, **and** CR-01 (a container-stop failure suppressing this write) confirmed fixed at commit `e1ce940` — container stop now runs in its own try/catch, never in the `finally` that could swallow `drillError` |
| 25 | `pnpm test` hard-fails when record missing/FAIL/stale > 30 days | ✓ VERIFIED | `assertDrillStatusFresh` + `tests/drill-status.test.ts`'s "live gate" case against the real committed record, run as part of the green `pnpm test` |
| 26 | Slow drill test lives outside default suite, has its own command | ✓ VERIFIED | `vitest.config.ts` excludes `tests/drill/**`; `vitest.drill.config.ts` includes only that dir; `pnpm test` (81/81) confirmed not to collect it |
| 27 | Owner personally dropped real table, restored, destroyed container+volume, rebuilt, timed the drill (BKP-01/05, D-07) | ✓ VERIFIED | `docs/20-restore-runbook.md`, `docs/restore-drill-status.json` human fact, `docs/decisions.md` D7 discharge note — all cross-consistent |
| 28 | Runbook exists, opens with clean procedure carrying real timings, closes with "What actually happened" | ✓ VERIFIED | `docs/20-restore-runbook.md` read in full |
| 29 | Runbook states timings are fixture-scale, NOT a production RTO estimate; RTO stays UNKNOWN | ✓ VERIFIED | Explicit paragraph above the first step |
| 30 | Runbook records per-step timings (backup/drop/restore/verify) and separately measured human decision time | ✗ **FAILED** (see gap below) | Runbook explicitly states per-step timings were NOT separately measured; human time is "inferred... not measured," not a distinct clocked figure |
| 31 | Runbook records the `DROP TABLE ... CASCADE` constraint-gap finding | ✓ VERIFIED | Per this task's own explicit instruction: the predicted gap did *not* occur on this run (both FKs returned, because `db:restore` is a whole-database restore), and the runbook records this correction honestly with the likely reason — this is the required behavior, not a gap |
| 32 | Runbook records the act-2 role-non-emptiness finding, verbatim verdict, where globals path is genuinely exercised | ✓ VERIFIED | Verdict quoted verbatim in "What actually happened"; also cross-confirmed against the literal string in `scripts/restore-cluster.ts` |
| 33 | `docs/restore-drill-status.json` human fact carries real date/outcome/timings/runbookRef, set by a person | ✓ VERIFIED | JSON file read directly: `lastPerformedAt: "2026-09-07"`, `outcome: "PASS"`, timings populated, `runbookRef` present — and structurally could only have been hand-edited, since `recordAutomatedDrillResult` cannot touch this object |
| 34 | `docs/00-current-state.md` risk R1 moves to drilled-and-timed; §6 production UNKNOWNs remain UNKNOWN | ✓ VERIFIED | R1 row and confirmed-facts row read directly; §6's three checkboxes remain unticked |

**Score:** 33/34 truths verified (1 disclosed, honestly-recorded shortfall — see gap).

### Requirements Coverage

All 8 `BKP-*` requirements are declared across the five plans' `requirements` frontmatter and none
are orphaned against `.planning/REQUIREMENTS.md`:

| Requirement | Source Plan(s) | Status | Evidence |
|---|---|---|---|
| BKP-01 | 02-05 | ✓ SATISFIED | Owner-performed drill, runbook, status record |
| BKP-02 | 02-01, 02-03 | ✓ SATISFIED | Globals dump genuinely restored (drill: non-colliding bootstrap); `restore-cluster.ts` states honestly when the globals path is a no-op rather than tolerating/hiding it |
| BKP-03 | 02-01 | ✓ SATISFIED | Drill target is a fresh, never-pre-seeded `postgres:17` container every run |
| BKP-04 | 02-01, 02-02 | ✓ SATISFIED | 4 assertion tiers (artifact integrity, row counts, schema equality, content/referential/sequence), none vacuous-passable |
| BKP-05 | 02-03, 02-05 | ✓ SATISFIED | Tooling (`db:restore`/`db:restore:cluster`) + owner-performed destruction test, both acts |
| BKP-06 | 02-05 | ✓ SATISFIED | Runbook written from the performed run, with an honestly-recorded plan-prediction correction |
| BKP-07 | 02-01, 02-04 | ✓ SATISFIED | Committed machine-readable record + non-zero exit on failure |
| BKP-08 | 02-04 | ✓ SATISFIED | No "skipped" outcome possible by construction; staleness gate hard-fails `pnpm test` |

`.planning/REQUIREMENTS.md`'s own Phase 2 traceability row is itself honest about scope: it states
all 8 checkboxes are complete but that "phase-level UAT/security verification not yet run" —
consistent with this being the first verification pass.

### Anti-Patterns / Code Review Cross-Check

`02-REVIEW.md` (1 Critical, 8 Warnings, 3 Info) was read and cross-checked against the current
code, not merely trusted:

- **CR-01** (a `finally`-block container-stop failure could suppress a FAIL write) — confirmed
  **FIXED** at commit `e1ce940`; verified directly in `scripts/drill.ts` (container stop now runs
  in its own try/catch, decoupled from the `drillError`/status-write logic).
- **WR-01 through WR-08** — all confirmed still present and accurately described (dead `finally`
  cleanup in `backup.ts`; missing `import.meta.main` guard on `restore-cluster.ts`; `restoreIntoDevContainer`
  relies on call-site discipline rather than internal enforcement of the pinned role/database, in
  tension with this project's "architectural enforcement over remembered caution" non-negotiable;
  unvalidated manifest keys interpolated into SQL identifiers; silent cleanup-failure swallowing;
  a weak substring assertion in a safety-critical test; duplicated manifest-resolution helper;
  same-second backup filename collision). None of these are newly discovered by this verification —
  they are pre-existing, disclosed findings from the phase's own code review and are recorded here
  as known, open debt rather than re-litigated as new gaps. WR-03 in particular is worth the next
  phase's attention given the project's stated non-negotiable on architectural (not
  discipline-based) enforcement.
- **`.planning/WINDOWS.md`** — 3 open entries, all pre-existing and disclosed (env.example
  sandbox-permission gap; a `restore-cluster.ts` comment defect the owner actually hit during the
  timed drill; a Phase 1 no-genuine-RED-phase deviation). Not re-reported as new gaps per
  instructions.

### Human Verification Required

None. Every truth in this phase was either directly verifiable in the codebase/documentation, or
was itself a completed human-action checkpoint whose evidence (the owner's report, transcribed
into the runbook and the status record) has already been produced and was read directly as part of
this verification.

### Gaps Summary

One gap, disclosed rather than hidden by the phase's own executor: the plan (`02-05-PLAN.md`)
committed to recording **per-step** timings (backup, drop, restore, verify) plus a **separately
measured** human decision time. What was actually produced is two aggregate ranges (3-4 min
first-run, 1-2 min copy-paste-only) and an explicitly-labeled *inferred* (not measured) estimate of
the human-decision component. The runbook says this outright rather than fabricating numbers to
satisfy the plan's original shape — which is exactly the behavior this project's "mark unverified
UNKNOWN, do not record assumptions as facts" non-negotiable calls for.

This does **not** fail the roadmap's actual success criterion ("timed the whole procedure" — met
by the aggregate figures) or any of BKP-01/05/06's literal wording. It fails only the plan's own
stricter, self-imposed elaboration of D-09. Because it is a plan-added must-have (not a roadmap
Success Criterion) and was surfaced honestly rather than concealed, this is presented as a single
disclosed gap for a human decision — accept as-is, or schedule a follow-up timed drill — rather
than as a blocking defect requiring code changes. No override has been recorded for it yet; see the
frontmatter `gaps` entry above for the exact override text a human could add to accept it.

---

*Verified: 2026-09-07T23:30:00Z*
*Verifier: Claude (gsd-verifier)*
