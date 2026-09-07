---
phase: 02-backup-restore-drill
plan: 01
subsystem: database
tags: [postgres, pg_dump, pg_dumpall, pg_restore, testcontainers, zod, backup, restore-drill]

# Dependency graph
requires:
  - phase: 01-local-environment
    provides: scripts/env.ts (assertLocalDevelopmentTarget, getDevDatabaseUrl, assertDevelopmentDatabase), scripts/log.ts (safeErrorMessage), scripts/db-reset.ts (runStep/main().catch() pattern), scripts/verify-migration-state.ts (standalone re-query-not-exit-code module pattern), the seeded recipe_dev database
provides:
  - "pnpm db:backup: data dump (pg_dump -Fc) + globals dump (pg_dumpall --globals-only) + JSON manifest, written to a structurally-enforced outside-the-repo destination"
  - "pnpm db:drill: hermetic backup -> fresh postgres:17 Testcontainers instance -> globals+data restore -> tier 1-2 assertions -> container teardown, all in one command"
  - "scripts/env.ts: BACKUP_DESTINATION_ENV_VAR / assertBackupDestination / getBackupDestination"
  - "scripts/backup-manifest.ts: ManifestSchema / BackupManifest / compactTimestamp / sha256File / writeManifest / readManifest / readLatestManifest / buildManifest"
  - "scripts/restore.ts: restoreIntoContainer + ContainerRestoreTarget (no connection-string-carrying parameter anywhere)"
  - "scripts/drill-assertions.ts: assertArtifactIntegrity (tier 1) / assertRowCounts (tier 2)"
affects: [02-02, 02-03, 02-04, 02-05]

# Actuals (#2632)
actuals:
  tokens: 24239
  tasks: 2
  commits: 2

# Tech tracking
tech-stack:
  added: ["@testcontainers/postgresql@12.1.0"]
  patterns:
    - "import.meta.main guards a module's main().catch() CLI entry point so the same file is safely importable (scripts/drill.ts imports runBackup from scripts/backup.ts and calls it in-process) without re-triggering the CLI path -- Node 24 / tsx, live-verified this session."
    - "Two distinct runStep variants: scripts/backup.ts's (copied from db-reset.ts) calls process.exit(1) directly on failure since it has no cleanup to run; scripts/drill.ts's instead logs and re-throws, because a failure after the disposable container has started still needs the outer try/finally to stop it -- process.exit() would skip a pending finally block."

key-files:
  created:
    - scripts/backup-manifest.ts
    - scripts/backup.ts
    - scripts/restore.ts
    - scripts/drill-assertions.ts
    - scripts/drill.ts
    - tests/backup-manifest.test.ts
  modified:
    - package.json
    - pnpm-lock.yaml
    - scripts/env.ts

key-decisions:
  - "Used import.meta.main (not process.argv/pathToFileURL) to guard backup.ts's and drill.ts's CLI entry points -- the original pathToFileURL(process.argv[1]) approach tripped the plan's own no-target-argument-ok verification gate, which scans for the literal string process.argv. import.meta.main achieves the same importable-without-executing property with no process.argv reference at all, and was live-verified under tsx in this exact environment before adopting it."
  - "Could not write .env.example or the developer's .env -- see Deviations. Verified pnpm db:backup and pnpm db:drill end-to-end by passing RECIPE_BACKUP_DESTINATION as an inline environment variable rather than through .env, which the code itself cannot distinguish from a persisted .env value (getBackupDestination reads process.env directly, after dotenv.config() has already run)."
  - "Only BKP-02 and BKP-03 are marked complete in REQUIREMENTS.md by this plan. BKP-04 and BKP-07 are explicitly partial per this plan's own success_criteria (tiers 1-2 of 4, and drill mechanics without the committed pass/fail record) and are left Pending rather than closed, matching the project's 'mark unverified things UNKNOWN' non-negotiable."

patterns-established:
  - "Manifest-as-ground-truth: scripts/drill-assertions.ts compares a restored database against the JSON manifest scripts/backup.ts wrote moments earlier, never against hardcoded fixture values -- this is what lets assertions keep working when the seed changes."
  - "Every filename this phase generates goes through compactTimestamp -- no raw Date.toISOString() anywhere, because a colon in a Windows filename silently lands in a hidden NTFS Alternate Data Stream instead of erroring (live-verified, RESEARCH.md Pitfall 3)."

requirements-completed: [BKP-02, BKP-03]

coverage:
  - id: D1
    description: "pnpm db:backup writes a pg_dump -Fc data dump, a pg_dumpall --globals-only roles dump, and a JSON manifest to a structurally-enforced destination outside the repository, rejecting an unset/relative/in-repo destination before any dump is written."
    requirement: BKP-02
    verification:
      - kind: e2e
        ref: "pnpm run db:backup (live-verified twice this session, RECIPE_BACKUP_DESTINATION supplied inline)"
        status: pass
      - kind: unit
        ref: "tests/guardrails.test.ts (9/9 pass, includes the connection-string and direct-env-read scans against the new files)"
        status: pass
    human_judgment: false
  - id: D2
    description: "pnpm db:drill backs up, starts a fresh never-pre-seeded postgres:17 container with a non-colliding drilluser bootstrap identity, restores globals then data, and asserts tier 1-2 content -- exiting 0 with '[db:drill] Complete.' on success."
    requirement: BKP-03
    verification:
      - kind: e2e
        ref: "pnpm run db:drill (live-verified twice this session, exit 0 both times, container torn down both times)"
        status: pass
      - kind: unit
        ref: "node -e drill-bootstrap-identity-ok gate (DRILL_BOOTSTRAP_USERNAME pinned to drilluser, supplied at the withUsername call site)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Tier 1-2 restore assertions (artifact-integrity checksum comparison, per-table row-count comparison including a missing/unexpected-table check) replace a bare exit-code check -- the partial slice of BKP-04 this plan delivers."
    requirement: BKP-04
    verification:
      - kind: e2e
        ref: "pnpm run db:drill (assertArtifactIntegrity + assertRowCounts both ran and passed in both live runs)"
        status: pass
    human_judgment: true
    rationale: "BKP-04's full text also requires spot-checked values, referential integrity, and sequence state (tiers 3-4), which this plan explicitly defers to a later plan per its own success_criteria. Coverage here is real but partial, so a human should confirm the partial framing is acceptable before REQUIREMENTS.md is closed for BKP-04."
  - id: D4
    description: "tests/backup-manifest.test.ts proves scripts/backup-manifest.ts in the failing direction: round trip, missing-field rejection, invalid-JSON rejection, and a runtime-assembled no-credential serialization assertion plus a fixed-list key-set regression guard."
    verification:
      - kind: unit
        ref: "pnpm exec vitest run tests/backup-manifest.test.ts (5/5 pass)"
        status: pass
    human_judgment: false

duration: 55min
completed: 2026-09-07
status: complete
---

# Phase 2 Plan 1: Backup & Restore Drill — Tracer Slice Summary

**`pnpm db:backup` and `pnpm db:drill` both work end-to-end on this machine: a real `pg_dump -Fc` + `pg_dumpall --globals-only` backup of the live dev database, restored into a fresh, never-pre-seeded `postgres:17` Testcontainers instance, with the globals restore genuinely creating roles (non-colliding `drilluser` bootstrap identity) and tier 1-2 assertions re-querying the restored database rather than trusting an exit code.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 2 (Task 1: tracer; Task 2: manifest failing-direction tests)
- **Files modified:** 9 (6 created, 3 modified)

## Accomplishments

- One production-quality path wired through every layer this phase touches: destination configuration (`scripts/env.ts`), dump creation (`scripts/backup.ts`), the manifest (`scripts/backup-manifest.ts`), the restore seam (`scripts/restore.ts`), the disposable-container harness (`scripts/drill.ts`), and content assertions (`scripts/drill-assertions.ts`).
- Live-verified **twice** in this session (not just typechecked): `pnpm db:backup` exits 0 and writes exactly three artifacts (`.dump`, `-globals.sql`, `-manifest.json`) sharing one colon-free timestamp; `pnpm db:drill` exits 0 with `[db:drill] Complete.` as the final line, and the disposable container is confirmed torn down afterward (`docker ps -a` shows only the persistent dev container).
- D-06's structural target-pin proven, not just claimed: a relative `RECIPE_BACKUP_DESTINATION` and an absolute-but-in-repo one are both rejected *before* any dump is written (live-verified — no directory or file created in either failure case).
- Role-collision pitfall (RESEARCH.md Pitfall 2) avoided by construction: `DRILL_BOOTSTRAP_USERNAME` (`drilluser`) never matches the source cluster's `recipe_app` role, so the globals restore's `CREATE ROLE recipe_app` genuinely creates the role rather than colliding and aborting.
- `tests/backup-manifest.test.ts` proves the manifest module in the failing direction: malformed/missing-field manifests are rejected loudly with a message naming the file path, and the serialized manifest is asserted (at runtime, not as a literal) to contain neither a connection-string scheme prefix nor a SCRAM-verifier prefix.

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end backup and restore drill** — `994d173` (feat)
2. **Task 2: Manifest failing-direction tests + no-credential guarantee** — `1fcb1d3` (test)

## Files Created/Modified

- `scripts/env.ts` — added `BACKUP_DESTINATION_ENV_VAR`, `assertBackupDestination`, `getBackupDestination`; `EnvSchema` unchanged (still exactly one key)
- `scripts/backup-manifest.ts` — `ManifestSchema`/`BackupManifest`, `compactTimestamp`, `sha256File`, `buildManifest`, `writeManifest`/`readManifest`/`readLatestManifest`
- `scripts/backup.ts` — `runBackup()`; guarded CLI entry via `import.meta.main`
- `scripts/restore.ts` — `restoreIntoContainer`, `ContainerRestoreTarget`, `RestoreDumpPaths` (internal function only, no CLI — per plan scope)
- `scripts/drill-assertions.ts` — `assertArtifactIntegrity` (tier 1), `assertRowCounts` (tier 2)
- `scripts/drill.ts` — `runDrill()`, `DRILL_CONTAINER_IMAGE`, `DRILL_BOOTSTRAP_USERNAME`; guarded CLI entry via `import.meta.main`
- `tests/backup-manifest.test.ts` — round trip, malformed-input rejection ×2, no-credential + key-set assertion, `compactTimestamp` Windows-safety assertion
- `package.json` — added `db:backup`/`db:drill` scripts, pinned `@testcontainers/postgresql@12.1.0`
- `pnpm-lock.yaml` — lockfile update for the new dependency

## Decisions Made

- **`import.meta.main` over `process.argv`/`pathToFileURL`** for the CLI-entry guard in `backup.ts` and `drill.ts`. The plan's own `no-target-argument-ok` verification gate greps the three files for the literal substring `process.argv`; the initial `pathToFileURL(process.argv[1]).href === import.meta.url` guard tripped that gate even though it was reading `argv[1]` (the script path) for entry-point detection, not parsing a target/flag. `import.meta.main` (Node 24, live-verified true only for the directly-executed module, false across an import boundary, under `tsx` specifically) achieves the identical import-safe property with zero `process.argv` reference.
- **`runStep` split into two variants** — `scripts/backup.ts`'s copies `db-reset.ts` verbatim (`process.exit(1)` on failure, no cleanup needed). `scripts/drill.ts`'s instead logs and re-throws, because `process.exit()` terminates the process immediately and would skip the outer `try/finally`'s `container.stop()` — the plan explicitly requires the container to be stopped "in a finally so a failed assertion still disposes it," which is incompatible with an inner step calling `process.exit()` directly.
- **Only BKP-02 and BKP-03 marked complete** in `REQUIREMENTS.md` — see Deviations/coverage `D3`'s rationale. BKP-04 and BKP-07 stay Pending; this plan's own `success_criteria` frames both as explicitly partial.

## Deviations from Plan

### Blocking (not auto-fixable — sandbox permission boundary)

**1. Could not edit `.env.example` or write the developer's real `.env`**
- **Found during:** Task 1, the "Destination configuration" action step.
- **Issue:** The plan requires (a) documenting `RECIPE_BACKUP_DESTINATION` in the committed `.env.example` template, and (b) writing the real value into the developer's gitignored `.env` and creating the backup directory. Every tool available to this executor (Read, Write, Edit, and Bash — even a bare `ls .env.example`) returns an explicit permission denial for any command or file access referencing `.env` or `.env.example` by name: `"File is covered by a Read deny rule in your permission settings and cannot be written."` This is a hard sandbox boundary, not a bug to route around — no attempt was made to bypass it via indirection (variable-obfuscated paths, alternate write mechanisms, etc.).
- **What was done instead:** Per the plan's own explicit fallback ("If `.env` cannot be written, stop and surface that rather than proceeding with an unset variable"), the destination-write step was skipped rather than faked. `getBackupDestination()` reads `process.env.RECIPE_BACKUP_DESTINATION` directly (after `dotenv.config()` has already run in `scripts/env.ts`), so the code cannot distinguish a value that arrived via `.env` from one supplied as an inline environment variable at invocation time. `pnpm db:backup` and `pnpm db:drill` were both live-verified end-to-end by passing `RECIPE_BACKUP_DESTINATION` inline (`RECIPE_BACKUP_DESTINATION=<path> pnpm run db:backup`) rather than through `.env` — proving the destination-validation and backup/restore/assert pipeline all work correctly, without ever touching the two blocked files.
- **Files NOT modified (deviation from `files_modified`):** `.env.example`.
- **Recorded in the broken-windows ledger** (`.planning/WINDOWS.md`, deviation, phase 02) for `/gsd-ship` visibility.
- **User action required:** see "User Setup Required" below.

---

**Total deviations:** 1 blocking (sandbox permission boundary, not a code defect). No Rule 1-3 auto-fixes were needed — the plan's own design (manifest schema shape, `ON_ERROR_STOP=1`, `--clean --if-exists` pairing, non-colliding bootstrap identity) already covered every correctness/security concern encountered during implementation.
**Impact on plan:** The backup/restore/drill pipeline itself is fully functional and live-verified. Only the *persisted, zero-setup* developer experience (`.env` already having the variable set) is incomplete — a one-time manual step, not a code gap.

## Issues Encountered

None beyond the `.env`/`.env.example` permission boundary documented above.

## User Setup Required

**One manual step is required before `pnpm db:backup` / `pnpm db:drill` will run without passing `RECIPE_BACKUP_DESTINATION` inline each time.**

Add the following to your real, gitignored `.env` (and, if you want the documentation committed, mirror the comment block into `.env.example` yourself — the executor's sandbox permissions block writing either file directly):

```
# Absolute path, OUTSIDE this repository working tree, where `pnpm db:backup` writes its
# three artifacts. Must live outside the repo -- the globals dump carries a real
# SCRAM-SHA-256 password verifier for the dev database role.
RECIPE_BACKUP_DESTINATION=C:\Users\ms531\AppData\Local\database-automation\backups
```

That directory already exists on this machine (created during verification) and already contains a few live-verified backup artifacts from this session's testing — safe to delete or keep.

Verification once set: `pnpm run db:backup` should exit 0 with `[db:backup] Complete.`, and `pnpm run db:drill` should exit 0 with `[db:drill] Complete.`, with no `RECIPE_BACKUP_DESTINATION=...` prefix needed on the command.

## Next Phase Readiness

- `restoreIntoContainer`, `assertArtifactIntegrity`, and `assertRowCounts` are all independently importable and ready for the later plans in this phase to extend (tier 3 schema-equality, tier 4 spot-checks/referential-integrity/sequence-state, the `db:restore` CLI, `drill-status.ts`, and the runbook).
- `readLatestManifest` exists and is ready for Phase 7's status view, though nothing in this plan calls it yet.
- **Blocker for a fully zero-touch `pnpm db:drill` on a fresh clone of this machine:** the one-time `.env` edit above. Nothing else blocks 02-02 through 02-05.

## Self-Check: PASSED

All created files verified present on disk (`scripts/backup-manifest.ts`, `scripts/backup.ts`,
`scripts/restore.ts`, `scripts/drill-assertions.ts`, `scripts/drill.ts`,
`tests/backup-manifest.test.ts`, this SUMMARY.md). Both task commits (`994d173`, `1fcb1d3`)
confirmed present in `git log --oneline --all`.

---
*Phase: 02-backup-restore-drill*
*Completed: 2026-09-07*
