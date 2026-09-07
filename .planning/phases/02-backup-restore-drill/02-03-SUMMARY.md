---
phase: 02-backup-restore-drill
plan: 03
subsystem: database
tags: [postgres, pg_restore, pg_dumpall, restore, restore-drill, cli]

# Dependency graph
requires:
  - phase: 02-backup-restore-drill
    provides: "02-01: scripts/restore.ts (restoreIntoContainer, ContainerRestoreTarget, RestoreDumpPaths), scripts/backup-manifest.ts (readManifest/readLatestManifest/sha256File), scripts/backup.ts (runBackup); 02-02: the four assertion tiers wired into pnpm db:drill"
provides:
  - "pnpm db:restore: argument-free, dev-target-pinned in-place whole-database restore of the newest backup (act 1)"
  - "pnpm db:restore:cluster: argument-free, dev-target-pinned globals-then-data restore into a rebuilt cluster (act 2), with an explicit printed verdict on whether the globals restore was genuinely exercised"
  - "scripts/env.ts: EXPECTED_DEV_DATABASE_ROLE"
  - "scripts/restore.ts: restoreIntoDevContainer, DevContainerRestoreOptions, verifyRestoredRowCounts (all reused by scripts/restore-cluster.ts)"
  - "scripts/restore-cluster.ts (new file)"
  - "tests/restore-cli.test.ts: end-to-end refusal proof for all three dev-target commands"
  - "tests/guardrails.test.ts: permanent structural guard against process.argv/stdin/prompt-library usage across all four Phase 2 command scripts"
affects: [02-04, 02-05]

# Actuals (#2632)
actuals:
  tokens: 7400
  tasks: 3
  commits: 4
  plan_head_before: 791ef00

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "restoreIntoDevContainer(dumps, options) in scripts/restore.ts mirrors restoreIntoContainer's shape but targets the pinned dev container via `docker compose cp`/`docker compose exec` instead of a Testcontainers ContainerRestoreTarget object -- reused unchanged by scripts/restore-cluster.ts for its own data-restore step, so the copy-in/pg_restore/cleanup-in-finally sequence exists in exactly one place."
    - "import.meta.main guards scripts/restore.ts's own CLI entry point (main().catch()) -- load-bearing here specifically because this plan makes restore.ts importable by a second consumer (scripts/restore-cluster.ts, for restoreIntoDevContainer/verifyRestoredRowCounts) in addition to scripts/drill.ts's existing import of restoreIntoContainer. Without the guard, either import would trigger a live db:restore run."
    - "D-06's asymmetry applied to modes, not just targets: scripts/restore-cluster.ts is a separate file from scripts/restore.ts rather than a --cluster flag, so which restore runs is chosen by which file is invoked, never by a parameter a future caller could widen."
    - "Pre-flight role check before a globals restore: query pg_roles for login-capable, non-pg_* roles, branch on whether the pinned application role is already present, and print an explicit EXERCISED/NOT EXERCISED verdict either way -- never a silent skip, never a tolerated 'already exists' error. Re-queries the role list after a genuine restore rather than trusting psql's exit code as proof the role now exists."

key-files:
  created:
    - scripts/restore-cluster.ts
    - tests/restore-cli.test.ts
  modified:
    - scripts/env.ts
    - scripts/restore.ts
    - scripts/backup.ts
    - package.json
    - tests/guardrails.test.ts

key-decisions:
  - "restoreIntoDevContainer and verifyRestoredRowCounts are exported from scripts/restore.ts and imported by scripts/restore-cluster.ts, rather than duplicated -- both scripts restore the data dump and verify row counts identically; the shared function is the single place that logic lives."
  - "scripts/restore-cluster.ts's manifest-filename resolution duplicates a small readdir-and-sort helper rather than importing scripts/backup-manifest.ts's readLatestManifest, because that function does not return the manifest's own filename and this plan's own verify block requires both scripts to name the manifest file they restored from in their final summary line -- backup-manifest.ts is outside this plan's files_modified, so a signature change there was avoided in favor of a small local resolver (shared, in turn, between restore.ts and restore-cluster.ts)."
  - "The pre-flight role check treats 'the pinned application role already exists' (the normal outcome after this repo's own docker compose down -v / up -d rebuild, since the postgres:17 entrypoint creates it from POSTGRES_USER before anything else runs) as the expected, non-error case -- printed as an honest verdict rather than treated as a failure or silently skipped. This matches 02-CONTEXT.md D-07's own discretion note: pnpm db:drill (non-colliding bootstrap identity) is the command that actually exercises the globals-restore code path on every run; db:restore:cluster's job is to be honest about which branch it took, not to force the collision case never to happen."
  - "[Rule 1] scripts/backup.ts's completion line now literally names the manifest file it wrote (derived from the data dump's own stamped filename, not a new return value on runBackup) -- this plan's own <verify> block for Task 1 re-runs pnpm db:backup and requires stdout to name the manifest file, which the prior 'and the manifest' wording did not satisfy. Same precedent as 02-02-SUMMARY.md's out-of-files_modified fix to tests/backup-manifest.test.ts."

patterns-established:
  - "A CLI script that is also an import target for a sibling script (restore.ts, imported by both drill.ts and restore-cluster.ts) always guards its own main().catch() with import.meta.main -- this is now the second and third consumer of that pattern (backup.ts, drill.ts were the first two in 02-01), confirming it as this workspace's general rule for any script/library-in-one-file module, not a one-off fix."

requirements-completed: []

coverage:
  - id: D1
    description: "pnpm db:restore resolves the newest manifest at the configured destination, verifies the data dump's SHA-256 before restoring anything, asserts the pinned development database, restores via docker compose cp + pg_restore --clean --if-exists --no-owner --jobs 2 inspecting exit code and stderr, removes the temporary in-container file in a finally, and re-queries every table in the manifest's row counts rather than trusting the exit code. Reads no command-line arguments."
    requirement: BKP-05
    verification:
      - kind: e2e
        ref: "pnpm db:backup then pnpm db:restore (live-verified this session): restored 1/8/5 seeded rows, both foreign-key constraints on ingredients/steps present, no .dump file left under the container's /tmp"
        status: pass
      - kind: e2e
        ref: "pnpm db:restore against an empty/missing-manifest destination and against a checksum-corrupted data dump (both live-verified this session): both fail loudly before any write, naming the destination or the corrupted file respectively"
        status: pass
      - kind: unit
        ref: "tests/restore-cli.test.ts (3/3 pass) -- refusal + no-leak + unchanged-seeded-row-count proof for db:backup/db:restore/db:restore:cluster under a redirected target"
        status: pass
    human_judgment: false
  - id: D2
    description: "pnpm db:restore:cluster refuses to run when the development container is unreachable (assumes act 2's own teardown/rebuild already happened), verifies both dump checksums before touching the cluster, runs a pre-flight role check, and prints an explicit EXERCISED/NOT EXERCISED verdict on the globals restore as both an inline log line and the final line of output -- never a silent skip, never a tolerated 'already exists' error, and a post-restore role re-query rather than trusting psql's exit code as proof."
    requirement: BKP-02
    verification:
      - kind: e2e
        ref: "pnpm db:backup, pnpm db:reset, pnpm db:restore:cluster (live-verified this session): correctly hit the NOT EXERCISED branch (this repo's real rebuild always recreates recipe_app from POSTGRES_USER before the script runs), restored 1/8/5 seeded rows, left no dump or globals file inside the container"
        status: pass
      - kind: e2e
        ref: "pnpm db:restore:cluster against a torn-down (docker compose down, not yet up) container (live-verified this session): refused with a clear instruction naming the required rebuild sequence, before resolving any manifest"
        status: pass
    human_judgment: true
    rationale: "The genuinely-role-empty (EXERCISED) branch of the pre-flight check could not be exercised live in this session, because this repository's own docker compose down -v / up -d rebuild always recreates the pinned application role from POSTGRES_USER before the script ever runs -- exactly the case 02-CONTEXT.md's own discretion note anticipates and names pnpm db:drill (already live-verified in 02-01/02-02, non-colliding bootstrap identity) as the command that does exercise that path on every run. The branch's logic (ON_ERROR_STOP=1 restore, post-restore role re-query, EXERCISED verdict) is implemented and structurally identical to the already-live-verified restoreIntoDevContainer/restoreIntoContainer restore logic reused throughout this phase, but a human should confirm this coverage framing is acceptable rather than this plan asserting the branch is proven by a run that could never reach it in this environment."
  - id: D3
    description: "tests/guardrails.test.ts gains a permanent structural assertion covering all four Phase 2 command scripts (backup.ts, restore.ts, restore-cluster.ts, drill.ts): none may reference process.argv, process.stdin, or an interactive prompt library, with every needle assembled at run time and a failure message naming D-06."
    requirement: BKP-05
    verification:
      - kind: unit
        ref: "tests/guardrails.test.ts (10/10 pass, including the new assertion)"
        status: pass
    human_judgment: false
  - id: D4
    description: "tests/restore-cli.test.ts proves, end-to-end, that pnpm db:backup/db:restore/db:restore:cluster all refuse a redirected RECIPE_DEV_DATABASE_URL, leak neither the connection-string scheme prefix nor the fixture password, and leave the real local development database's seeded row count unchanged (checked via pnpm db:query, not merely a non-zero exit)."
    requirement: BKP-05
    verification:
      - kind: e2e
        ref: "tests/restore-cli.test.ts (3/3 pass, live child processes against the real dev container)"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-09-07
status: complete
---

# Phase 2 Plan 3: Restore CLI — In-Place and Cluster-Rebuild Commands Summary

**`pnpm db:restore` (act 1, in-place whole-database restore) and `pnpm db:restore:cluster` (act 2, globals-then-data restore into a rebuilt cluster with an honest EXERCISED/NOT EXERCISED verdict) are both argument-free, dev-target-pinned commands, live-verified end-to-end against the real local development container, with a permanent guardrail and an end-to-end refusal test locking the no-target property in place.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 3 (Task 1: `db:restore`; Task 2: `db:restore:cluster`; Task 3: refusal test + structural guardrail)
- **Files modified:** 7 (2 created, 5 modified)

## Accomplishments

- `pnpm db:restore` live-verified twice this session: restores the newest backup's data dump into the pinned development database, returning the seeded 1/8/5 row counts with both foreign-key constraints on `ingredients`/`steps` present (proving the restore is whole-database, not selective), and leaving no `.dump` file inside the container afterward.
- `pnpm db:restore` live-verified to fail loudly and before any write in both required failure modes: an empty backup destination (no manifest) and a checksum-corrupted data dump.
- `pnpm db:restore:cluster` live-verified against a real `docker compose down -v` / `up -d --wait` rebuild: correctly detects that the container's own entrypoint already recreated the pinned application role, prints the honest `globals restore: NOT EXERCISED` verdict naming why and pointing at `pnpm db:drill`, then restores the data dump to the seeded 1/8/5 state with no leftover dump/globals files.
- `pnpm db:restore:cluster` live-verified to refuse cleanly, before resolving any manifest, when the development container has been torn down and not yet brought back up.
- Neither restore command, nor `scripts/backup.ts`/`scripts/drill.ts`, references `process.argv`, `process.stdin`, or an interactive prompt library — now a permanent, run-time-needle-built assertion in `tests/guardrails.test.ts` rather than a claim resting on the plan text alone.
- `tests/restore-cli.test.ts` proves all three dev-target commands refuse a redirected `RECIPE_DEV_DATABASE_URL` before any write, leak nothing, and leave the real local development database's seeded row count unchanged — extending `tests/target-pin.test.ts`'s pattern to this phase's own commands.
- `pnpm test`: 73/73 passing (was 69/69 before this plan).

## Task Commits

Each task was committed atomically:

1. **Task 1: `pnpm db:restore` — in-place data restore pinned to the development target** — `c698a51` (feat)
2. **Task 2: `pnpm db:restore:cluster` — act-2 rebuild path with an explicit globals verdict** — `77d2c55` (feat, also carries the Task-1-driven `scripts/backup.ts` fix, see Deviations)
3. **Task 3: end-to-end refusal test and structural guardrail** — `b0b4e7c` (test)
4. **Fix: remove a self-matching literal from `tests/restore-cli.test.ts`'s own doc comment** — `4af314b` (fix)

## Files Created/Modified

- `scripts/env.ts` — added `EXPECTED_DEV_DATABASE_ROLE` (pinned to `docker-compose.yml`'s `POSTGRES_USER`)
- `scripts/restore.ts` — added `restoreIntoDevContainer`, `DevContainerRestoreOptions`, `verifyRestoredRowCounts` (both exported and reused by `scripts/restore-cluster.ts`), a local manifest-resolution-with-filename helper, and the `db:restore` CLI entry (`main()`, guarded by `import.meta.main`); `restoreIntoContainer`/`ContainerRestoreTarget`/`RestoreDumpPaths` unchanged
- `scripts/restore-cluster.ts` (new) — `pnpm db:restore:cluster`'s full CLI: reachability check, manifest resolution, dual checksum verification, dev-database assertion, pre-flight role check with printed verdict, data restore (via `restoreIntoDevContainer`), row-count verification
- `scripts/backup.ts` — completion line now names the manifest file it wrote (Rule 1 deviation, see below)
- `package.json` — added `db:restore` and `db:restore:cluster` scripts
- `tests/restore-cli.test.ts` (new) — end-to-end refusal proof for `db:backup`/`db:restore`/`db:restore:cluster`
- `tests/guardrails.test.ts` — new assertion covering `process.argv`/`process.stdin`/prompt-library usage across all four Phase 2 command scripts

## Decisions Made

- **`restoreIntoDevContainer`/`verifyRestoredRowCounts` exported from `scripts/restore.ts` and reused by `scripts/restore-cluster.ts`**, rather than duplicated — both scripts' data-restore and row-count-verification steps are identical, so the shared functions are the single place that logic lives (matches the plan's own Task 2 instruction: "Restore the data dump exactly as `scripts/restore.ts` does").
- **A local, duplicated-once manifest-filename resolver** in `scripts/restore.ts` (shared with `restore-cluster.ts`) rather than changing `scripts/backup-manifest.ts`'s `readLatestManifest` signature — that function is outside this plan's `files_modified`, and this plan's own `<verify>` block requires both restore commands to name the manifest file they restored from, which the existing function's return shape (manifest only, no filename) does not provide.
- **The pre-flight role check's "role already present" branch is the expected outcome for this repo's own rebuild sequence**, not an error — `docker compose down -v` / `up -d --wait` always recreates `recipe_app` from `POSTGRES_USER` before `db:restore:cluster` ever runs, per 02-CONTEXT.md's own discretion note. The script states this honestly (`NOT EXERCISED`, naming `pnpm db:drill` as the command that does exercise the path) rather than tolerating a role-collision error or pretending the restore happened.
- **[Rule 1] `scripts/backup.ts`'s completion message fixed to name the manifest file it wrote.** Found while live-verifying Task 1's own `<verify>` block, which re-runs `pnpm db:backup` and requires stdout to name the manifest file — the prior wording ("...and the manifest.") did not satisfy this. Fixed by deriving the manifest filename from the data dump's own stamped filename (`.replace(/\.dump$/, "-manifest.json")`) rather than adding a second return value to `runBackup()`, which would have widened that function's return type for `scripts/drill.ts`'s existing consumer. Verified: `pnpm db:backup`'s completion line now reads `...and manifest recipe_dev-<stamp>-manifest.json.`; `pnpm test` still 73/73.
- **[Rule 1] Removed a self-matching literal from `tests/restore-cli.test.ts`'s own doc comment.** The comment explaining why the file "never reads the dev connection variable directly" originally spelled that expression out literally (`process.env.RECIPE_DEV_DATABASE_URL`), tripping `tests/guardrails.test.ts`'s own ENV-03/WR-01 scan against its own prose. Reworded to describe the same guarantee without the literal substring — the same self-match-avoidance discipline `tests/guardrails.test.ts` itself already documents and follows.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Verify-gate gap] `scripts/backup.ts`'s completion line did not name the manifest file**
- **Found during:** Task 1, live-verifying `pnpm db:backup` against this plan's own `<verify>` block ("fails_when: ... stdout does not name the manifest file it wrote").
- **Issue:** `scripts/backup.ts` (owned by plan 02-01, not in this plan's `files_modified`) printed `"...Wrote <dump>, <globals>, and the manifest."` — generic, never naming the actual filename.
- **Fix:** Derived the manifest filename from the data dump's own stamped filename and included it literally in the completion line.
- **Files modified:** `scripts/backup.ts`.
- **Verification:** `pnpm db:backup` re-run live; output now reads `...and manifest recipe_dev-<stamp>-manifest.json.`. `pnpm test` unaffected (73/73).
- **Commit:** `77d2c55` (folded into Task 2's commit for sequencing reasons — the fix was made and verified during Task 1's own live-verification pass, before Task 2's files were staged).

**2. [Rule 1 - Bug] `tests/restore-cli.test.ts`'s own doc comment tripped the guardrail it was describing**
- **Found during:** Task 3, running `pnpm test` after committing.
- **Issue:** A doc comment explaining the file's self-match-avoidance discipline spelled out the exact literal (`process.env.RECIPE_DEV_DATABASE_URL`) that `tests/guardrails.test.ts`'s ENV-03/WR-01 assertion scans the whole source surface for — `pnpm test` regressed to 72/73 immediately after Task 3's commit.
- **Fix:** Reworded the comment to describe the same guarantee without the literal substring.
- **Files modified:** `tests/restore-cli.test.ts`.
- **Verification:** `pnpm test` re-run — 73/73.
- **Commit:** `4af314b`.

---

**Total deviations:** 2 auto-fixed (both Rule 1 — one a pre-existing gap in a file outside this plan's `files_modified` that this plan's own verify block exposed; one a self-inflicted regression in this plan's own new test file, caught and fixed within the same session before handoff).
**Impact on plan:** No scope creep. Both fixes are narrowly scoped to keeping this plan's own verify gates and the full test suite green.

## Known Stubs

None. Both restore commands are production-quality, fully wired, and live-verified against the real development container — no placeholder data paths, no unwired UI, no hardcoded empty values.

## Issues Encountered

None beyond the pre-existing `.env`/`.env.example` sandbox-permission boundary already documented in `02-01-SUMMARY.md`/`02-02-SUMMARY.md` and tracked in `.planning/WINDOWS.md` (entry 2, still open). This plan's live verification used the same inline-`RECIPE_BACKUP_DESTINATION` workaround established by 02-01/02-02; the residual gap (the variable is still not persisted in the developer's real `.env`) is unchanged, not newly introduced or newly resolved by this plan.

The genuinely-role-empty branch of `db:restore:cluster`'s pre-flight check (the `EXERCISED` verdict path) could not be exercised live in this session — see coverage `D2`'s `rationale` above. This is a coverage-framing note for a human to confirm, not a defect: the branch's code is implemented and structurally identical to already-live-verified restore logic, but no rebuild sequence available in this environment produces a genuinely role-empty pinned-target cluster (this repo's own `docker compose down -v`/`up -d` always recreates the role from `POSTGRES_USER` first, exactly as `02-CONTEXT.md` documents).

## User Setup Required

None new beyond what `02-01-SUMMARY.md`/`02-02-SUMMARY.md` already documented (adding `RECIPE_BACKUP_DESTINATION` to the real, gitignored `.env`). No new environment variable or external service was introduced by this plan.

## Requirements Traceability Note

This plan's frontmatter lists `requirements: [BKP-02, BKP-05]`, but **neither checkbox in `.planning/REQUIREMENTS.md` was changed by this plan**:

- **BKP-02** was already marked complete by plan 02-01 (the globals-capture half); this plan adds the globals-*restore* half, which is additional evidence for an already-complete requirement, not a new completion.
- **BKP-05** ("A deliberate destruction test has been performed: drop a table, restore, confirm the data returned") explicitly requires the owner to have *personally performed* the destruction test. This plan's own `success_criteria` states plainly: "the owner has an argument-free, target-pinned command for both acts of the destruction test. **The performance of the test itself is plan 02-05.**" Marking BKP-05 complete here would assert a human action that has not yet happened — left `Pending`, matching this project's "mark unverified things UNKNOWN" non-negotiable and the identical precedent set by 02-01-SUMMARY.md for BKP-04/BKP-07.

## Next Phase Readiness

- `restoreIntoDevContainer`, `verifyRestoredRowCounts`, and `EXPECTED_DEV_DATABASE_ROLE` are all independently importable and ready for plan 02-04 (the committed drill-status record) and plan 02-05 (the runbook and the actual human-performed destruction test) to build on.
- Both restore commands are structurally proven to refuse a redirected target (D-06/BKP-05's tooling half) — plan 02-05's actual manual drill can now be performed with the real tooling rather than a stand-in.
- No blockers for 02-04/02-05 beyond the pre-existing `.env`/`.env.example` gap already tracked in `.planning/WINDOWS.md`, and the coverage-framing note above (D2's `rationale`) for a human to confirm before REQUIREMENTS.md treats BKP-02's restore half as fully exercised in every branch.

## Self-Check: PASSED

All created/modified files verified present on disk (`scripts/env.ts`, `scripts/restore.ts`,
`scripts/restore-cluster.ts`, `scripts/backup.ts`, `package.json`, `tests/restore-cli.test.ts`,
`tests/guardrails.test.ts`, this SUMMARY.md). All four commits (`c698a51`, `77d2c55`, `b0b4e7c`,
`4af314b`) confirmed present in `git log --oneline --all`. `pnpm test` green (73/73). `pnpm
db:backup`, `pnpm db:restore`, `pnpm db:reset`, `pnpm db:restore:cluster`, and `pnpm db:drill`
all re-run live this session with the final committed code; container left running, healthy,
and at the seeded 1/8/5 row-count state.

---
*Phase: 02-backup-restore-drill*
*Completed: 2026-09-07*
