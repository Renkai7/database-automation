---
phase: 02-backup-restore-drill
plan: 02
subsystem: database
tags: [postgres, pg_dump, testcontainers, vitest, backup, restore-drill, referential-integrity]

# Dependency graph
requires:
  - phase: 02-backup-restore-drill
    provides: "02-01: scripts/backup.ts (runBackup), scripts/backup-manifest.ts (ManifestSchema/BackupManifest), scripts/drill.ts (runDrill), scripts/drill-assertions.ts (assertArtifactIntegrity/assertRowCounts tiers 1-2), scripts/restore.ts (restoreIntoContainer), the seeded recipe_dev database"
provides:
  - "scripts/drill-assertions.ts: canonicalizeSchemaDump / assertSchemaEquality (tier 3) and assertContentHashes / assertSpotCheckedValues / assertNoOrphanRows / assertSequenceState (tier 4)"
  - "scripts/backup-manifest.ts: ManifestSchema extended with contentHashes, spotChecks, sequences -- and runBackup now hard-fails on a missing recipe-core table before populating any of them"
  - "scripts/drill.ts: DrillTierResults record and full tier 1-4 wiring; pnpm db:drill now runs and reports all four assertion tiers every run"
  - "tests/drill-assertions.test.ts: 14 fixture-driven tests proving every tier 3/4 assertion in the failing direction, including the DROP TABLE ... CASCADE regression, with no Docker required"
affects: [02-03, 02-04, 02-05]

# Actuals (#2632)
actuals:
  tokens: 12427
  tasks: 3
  commits: 3
  plan_head_before: c6cb64c

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Schema-dump canonicalisation strips PostgreSQL 17's per-invocation \\restrict/\\unrestrict guard-token pair and comment-only lines, collapses blank-line runs, and never touches an actual SQL statement -- proven directly by a unit test that removes a real foreign-key line and asserts the diff is still caught."
    - "Content-hash-per-table via `md5(coalesce(string_agg(t::text, chr(30) ORDER BY t::text), ''))` over a generic, schema-agnostic table enumeration -- an empty table hashes to md5('')'s fixed value rather than SQL NULL, so 'no rows' is still a comparable value rather than a silently-skipped one."
    - "Every tier-4 comparison (spot checks, sequence state) normalises both sides to an explicit, field-order array before comparing, rather than relying on JSON.stringify of a raw query-result object or a zod-parsed object -- removes any dependency on the pg driver's or zod's own incidental key ordering."
    - "Vacuous-comparison guards are structural, not incidental: assertSchemaEquality/assertContentHashes/assertSpotCheckedValues/assertNoOrphanRows/assertSequenceState each explicitly reject an empty-vs-empty or zero-enumeration case rather than letting it fall through to a passing equality check."

key-files:
  created:
    - tests/drill-assertions.test.ts
  modified:
    - scripts/drill-assertions.ts
    - scripts/drill.ts
    - scripts/backup-manifest.ts
    - scripts/backup.ts
    - tests/backup-manifest.test.ts

key-decisions:
  - "Restored-side and source-side schema dumps for tier 3 are both taken with --schema-only --no-owner --no-acl, the restored side executed inside the disposable container via its own pg_dump (container.exec), never over a second postgres:17-alpine image or host networking -- matches 02-01's already-adopted resolution of RESEARCH.md Open Question #1."
  - "Spot-check and sequence-state comparisons normalise to explicit field-order arrays (RECIPE_SPOT_CHECK_FIELDS/INGREDIENT_SPOT_CHECK_FIELDS/STEP_SPOT_CHECK_FIELDS constants) before JSON.stringify, instead of comparing raw objects -- removes a latent fragility where a zod-parsed manifest object's key order could differ from a live pg query result's key order and produce a false mismatch."
  - "tests/backup-manifest.test.ts updated to supply the three new required ManifestSchema fields (Rule 1 deviation -- not in this plan's own files_modified list, but required to keep pnpm test green after the schema change)."
  - "Committed directly to the main branch, no phase branch -- this repository has no git remote configured, and the run's isolation was explicitly set to none/sequential per the orchestrator's dispatch (mirrors 02-01's prior commits, which also landed on main)."

patterns-established:
  - "Tier assertions never trust an exit code or a bare equality of raw driver output -- every comparison either canonicalises first (schema dumps) or normalises to an explicit field order first (spot checks, sequences) before deciding pass/fail."

requirements-completed: [BKP-04]

coverage:
  - id: D1
    description: "Tier 3 (schema equality): pg_dump --schema-only of source vs. restored, canonicalised to strip PG17's per-invocation guard tokens and comment-only lines, then diffed -- catches the DROP TABLE ... CASCADE case (rows return, foreign keys do not) that tier 1/2/4-orphan-check all miss."
    requirement: BKP-04
    verification:
      - kind: e2e
        ref: "pnpm run db:drill (live-verified 4 times this session, schemaEquality:true every run including two consecutive runs with zero schema change between them -- proves the canonicalising pass removes the false-positive without weakening the tier)"
        status: pass
      - kind: unit
        ref: "tests/drill-assertions.test.ts — cases 1-4 (canonicalisation equivalence, green equality, red on a lost foreign key naming the constraint, red on an empty canonicalised side naming which side)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Tier 4 (content hashes, spot checks, orphan rows, sequence state): per-table md5 content fingerprint, named non-credential column projections from recipes/ingredients/steps (including the NULL-vs-empty-string-preserving steps.timerLabel), every foreign-key constraint checked for orphan rows via information_schema enumeration, and pg_sequences compared against the manifest."
    requirement: BKP-04
    verification:
      - kind: e2e
        ref: "pnpm run db:drill (live-verified 4 times this session, contentAndReferentialIntegrity:true every run; manifest on disk inspected directly and confirmed timerLabel round-trips as JSON null for both NULL steps, not an empty string)"
        status: pass
      - kind: unit
        ref: "tests/drill-assertions.test.ts — cases 5-9 plus green/vacuous-rejection cases for assertContentHashes/assertSpotCheckedValues/assertNoOrphanRows/assertSequenceState (14 tests total, no Docker required)"
        status: pass
    human_judgment: false
  - id: D3
    description: "runBackup now hard-fails, naming the missing table, when any of recipes/ingredients/steps is absent from the source database, before any tier-3/4 field is populated -- the vacuous-pass guard BKP-04's own prohibitions require."
    requirement: BKP-04
    verification:
      - kind: e2e
        ref: "pnpm run db:backup (live-verified as part of every db:drill run this session; the 'assert recipe-core tables present' step ran and passed against the seeded database every time)"
        status: pass
    human_judgment: false

duration: 30min
completed: 2026-09-07
status: complete
---

# Phase 2 Plan 2: Restore-Drill Assertion Depth — Tier 3/4 Summary

**`pnpm db:drill` now runs and reports all four assertion tiers every run — schema equality (catching the exact `DROP TABLE recipes CASCADE` case where rows return but foreign keys do not), per-table content hashes, named NULL-preserving spot checks, orphan-row referential-integrity checks enumerated from `information_schema`, and `pg_sequences` state comparison — each proven to go red for the specific failure it exists to catch by a 14-test, Docker-free unit suite.**

## Performance

- **Duration:** ~30 min
- **Tasks:** 3 (Task 1: tier 3 schema equality; Task 2: tier 4 content/referential/sequence assertions; Task 3: failing-direction unit tests)
- **Files modified:** 6 (1 created, 5 modified)

## Accomplishments

- Tier 3 (schema equality) implemented and live-verified across two consecutive `pnpm db:drill` runs with zero false schema difference reported between them — proves the `\restrict`/`\unrestrict` canonicalising pass removes exactly the confirmed non-determinism (RESEARCH.md Pitfall 4) without weakening the comparison.
- Tier 4 (content hashes, named spot checks, orphan-row check, sequence state) implemented, wired as `contentAndReferentialIntegrity`, and live-verified: the written manifest was inspected directly on disk and confirms `steps.timerLabel` round-trips as JSON `null` for both NULL-timer steps (positions 1 and 4) while the genuinely empty `ingredients.unit` for spring onions stays `""` — the exact NULL-vs-empty-string distinction the plan's `must_haves.truths` required proof of.
- `runBackup` now hard-fails, naming the missing table, before populating any tier-3/4 field, when `recipes`/`ingredients`/`steps` is absent from the source — closes the "manifest of empty comparisons that every tier passes vacuously" gap the plan's prohibitions named explicitly.
- Every tier-3/4 assertion rejects its own vacuous case (empty-vs-empty schema, zero content hashes, empty recorded spot-check projection for a non-empty table, zero foreign-key constraints found, zero recorded sequences) — each has a dedicated unit test proving the rejection fires.
- `tests/drill-assertions.test.ts` (14 tests, no Docker) proves all nine required cases plus five additional green/vacuous-rejection cases; case 3 is the direct regression test for the drill's whole reason to exist (a removed foreign-key line is caught, naming the constraint).
- `pnpm db:drill` live-verified 4 times this session (all four tiers `true` every run); `pnpm test` went from 55 to 69 passing tests, 0 failing.

## Task Commits

Each task was committed atomically:

1. **Task 1: Tier 3 — schema equality between source and restored database** — `8c95a01` (feat)
2. **Task 2: Tier 4 — content fingerprints, spot checks, orphan rows and sequence state** — `6a75b6c` (feat)
3. **Task 3: Prove every tier in the failing direction with fixture-driven unit tests** — `85f1f84` (test)

## Files Created/Modified

- `scripts/drill-assertions.ts` — added `SchemaDumpPair`, `canonicalizeSchemaDump`, `assertSchemaEquality` (tier 3); `assertContentHashes`, `assertSpotCheckedValues`, `assertNoOrphanRows`, `assertSequenceState` (tier 4)
- `scripts/drill.ts` — added `DrillTierResults`; wires tier 3 (schema dump comparison via `docker compose exec` + `container.exec`) and tier 4 (all four new assertions) into `runDrill`
- `scripts/backup-manifest.ts` — `ManifestSchema` gains `contentHashes`, `spotChecks`, `sequences` (all required; no field can hold a credential)
- `scripts/backup.ts` — `runBackup` adds the recipe-core-table precondition step, computes content hashes alongside row counts, and captures the three spot-check projections and sequence state into the manifest
- `tests/backup-manifest.test.ts` — fixture and `EXPECTED_MANIFEST_KEYS` updated for the three new required fields (Rule 1 deviation, see below)
- `tests/drill-assertions.test.ts` — new: 14 fixture-driven tests covering all nine required failing-direction cases plus 5 additional green/vacuous-rejection cases

## Decisions Made

- **Field-order-explicit comparison over raw `JSON.stringify` of query-result objects.** Both `assertSpotCheckedValues` and `assertSequenceState` normalise expected/actual rows to an array in a fixed, explicitly declared field order before comparing, rather than trusting that a `pg` query result's object key order matches a zod-parsed manifest object's key order. This removes a latent fragility that could otherwise produce a false mismatch unrelated to the actual data.
- **Recipe-core-table precondition placed early in `runBackup`**, before the destination directory is created or any dump is written — a backup attempted against an unmigrated database now fails fast rather than producing three artifacts and a vacuous manifest.
- **`tests/backup-manifest.test.ts` updated** even though it isn't in this plan's own `files_modified` — `ManifestSchema` gaining three new required fields would otherwise break `pnpm test` for a reason unrelated to that file's own intent. Tracked as a Rule 1 deviation below.
- **Committed directly to `main`, no phase branch.** This repository has no git remote; the orchestrator's dispatch explicitly set isolation to `none`/sequential for this run (matches how 02-01's commits also landed directly on `main`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test fixture regression] Updated `tests/backup-manifest.test.ts` for the three new required manifest fields**
- **Found during:** Task 2, immediately after extending `ManifestSchema`.
- **Issue:** `ManifestSchema` gained three new required fields (`contentHashes`, `spotChecks`, `sequences`). The existing `buildRealisticManifest()` fixture and `EXPECTED_MANIFEST_KEYS` regression guard in `tests/backup-manifest.test.ts` (written in plan 02-01, not touched by this plan's own `files_modified`) did not supply them, so `pnpm test` broke with two `ZodError` failures.
- **Fix:** Extended the fixture with realistic `contentHashes`/`spotChecks`/`sequences` values and added the three new keys to `EXPECTED_MANIFEST_KEYS`.
- **Files modified:** `tests/backup-manifest.test.ts`.
- **Verification:** `pnpm exec vitest run tests/backup-manifest.test.ts` (5/5 pass); `pnpm test` (69/69 pass).
- **Committed in:** `6a75b6c` (Task 2 commit).

---

**Total deviations:** 1 auto-fixed (Rule 1 — a test fixture broken by this task's own required schema-field addition, not a pre-existing or unrelated issue).
**Impact on plan:** No scope creep — the fix is scoped exactly to keeping the existing test suite consistent with the schema change this plan intentionally made.

## Issues Encountered

None beyond the pre-existing `.env`/`.env.example` sandbox-permission boundary already documented in `02-01-SUMMARY.md` and tracked in `.planning/WINDOWS.md` (entry 2, still open). This plan's live verification used the same inline-`RECIPE_BACKUP_DESTINATION` workaround 02-01 established; `pnpm run db:drill` without the inline variable still fails with "RECIPE_BACKUP_DESTINATION is not set" (confirmed this session), so the residual gap is unchanged, not newly introduced or newly resolved.

## User Setup Required

None new beyond what `02-01-SUMMARY.md` already documented (adding `RECIPE_BACKUP_DESTINATION` to the real, gitignored `.env`). No new environment variable or external service was introduced by this plan.

## Next Phase Readiness

- All four restore-drill assertion tiers (`artifactIntegrity`, `rowCounts`, `schemaEquality`, `contentAndReferentialIntegrity`) are implemented, wired, and independently importable for later plans in this phase (`db:restore` CLI, `drill-status.ts`'s committed pass/fail record, the runbook) to build on.
- `DrillTierResults` exists in `scripts/drill.ts` and is populated correctly every run, but nothing in this plan persists it to disk — that is explicitly plan 02-04's job (D-17) per this plan's own frontmatter.
- BKP-04 is now fully satisfied and marked complete in `.planning/REQUIREMENTS.md`. BKP-01, BKP-05, BKP-06, BKP-07, BKP-08 remain Pending, matching the phase's remaining plans.
- No blockers for 02-03 through 02-05 beyond the pre-existing `.env`/`.env.example` gap already tracked in `.planning/WINDOWS.md`.

## Self-Check: PASSED

All created/modified files verified present on disk (`scripts/drill-assertions.ts`, `scripts/drill.ts`,
`scripts/backup-manifest.ts`, `scripts/backup.ts`, `tests/backup-manifest.test.ts`,
`tests/drill-assertions.test.ts`, this SUMMARY.md). All three task commits (`8c95a01`, `6a75b6c`,
`85f1f84`) confirmed present in `git log --oneline --all`. `pnpm db:drill` re-run live 4 times
this session, all four tiers `true` every time. `pnpm test` green (69/69).

---
*Phase: 02-backup-restore-drill*
*Completed: 2026-09-07*
