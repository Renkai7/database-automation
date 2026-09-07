---
phase: 01-local-environment
plan: 01
subsystem: infra
tags: [pnpm, docker-compose, postgresql, drizzle, vitest, workspace]

requires: []
provides:
  - "pnpm workspace resolving apps/* and packages/* (packages/ empty)"
  - "Single postgres:17 (Debian/glibc) dev container, loopback-only, empty extension baseline"
  - "Root db:* script surface (db:up/down/generate/migrate/seed/reset/query, dev, test)"
  - ".env.example connection-variable template (RECIPE_DEV_DATABASE_URL + reserved staging/prod names)"
  - "Root vitest.config.ts and tsconfig.base.json"
  - "Dated, evidence-tiered redeploy root-cause investigation write-back in docs/00-current-state.md section 7"
affects: [01-02, 01-03, 01-04, 01-05]

actuals:
  tokens: 13590
  tasks: 3
  commits: 2
  plan_head_before: 678acf51a90f9a7454bc8579ae064910244d6be7

tech-stack:
  added: ["pnpm workspaces", "docker-compose", "postgres:17", "vitest 5.0.0", "tsx", "execa", "dotenv", "typescript 7.0.2"]
  patterns:
    - "docker compose up -d --wait for readiness, no hand-rolled polling"
    - "loopback-only port publication (127.0.0.1:5432:5432)"
    - "empty declared extension baseline; extensions only ever arrive via Drizzle migration, never an init-script mount"
    - "app-prefixed, environment-explicit connection variable names (RECIPE_DEV_DATABASE_URL)"

key-files:
  created:
    - pnpm-workspace.yaml
    - package.json
    - tsconfig.base.json
    - vitest.config.ts
    - docker-compose.yml
    - .env.example
    - pnpm-lock.yaml
  modified:
    - .gitignore
    - docs/00-current-state.md
    - docs/decisions.md

key-decisions:
  - "Root package.json declares the full db:* script surface now, including db:seed/db:reset/db:query targets whose implementation files don't exist until plans 01-02/01-03/01-04 — deliberate forward declaration per the plan, not a stub bug."
  - "@types/node pinned to the 24.x line (24.13.3) instead of the pnpm-resolved 26.4.1 latest, to match the actually-installed Node runtime (v24.19.0) rather than a future major with different type surface."
  - "Task 1's investigation forced D8 PROPOSED -> ACCEPTED and opened D14 (see docs/decisions.md) — carried into this SUMMARY as already-committed prior work, not re-decided here."

requirements-completed: [ENV-01, ENV-03]

coverage:
  - id: D1
    description: "Timeboxed D-25/D-26/D-27 redeploy root-cause investigation, written back to docs/00-current-state.md section 7 with a dated, evidence-tiered verdict"
    verification:
      - kind: other
        ref: "node -e section-7 investigation-entry regex check (plan Task 1 <automated> verify)"
        status: pass
    human_judgment: true
    rationale: "The verdict's honesty (no guess dressed as a finding) is a judgment call the automated regex check cannot make — it only confirms the entry's shape, not its truthfulness."
  - id: D2
    description: "Single postgres:17 (Debian/glibc) dev container, loopback-only port, pg_isready healthcheck, named volume, zero non-default extensions"
    requirement: ENV-01
    verification:
      - kind: integration
        ref: "docker compose up -d --wait (reports Healthy)"
        status: pass
      - kind: integration
        ref: "docker compose exec db psql -c 'SHOW server_version' (17.11 Debian 17.11-1.pgdg13+2)"
        status: pass
      - kind: integration
        ref: "docker compose exec db psql -tAc 'SELECT count(*) FROM pg_extension WHERE extname <> plpgsql' (0)"
        status: pass
      - kind: unit
        ref: "node -e compose-guards-ok (loopback mapping present, no 0.0.0.0, no init-script mount)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Committed .env.example naming RECIPE_DEV_DATABASE_URL and reserving RECIPE_STAGING_DATABASE_URL/RECIPE_PROD_DATABASE_URL as comments, with the real .env generated locally and gitignored"
    requirement: ENV-03
    verification:
      - kind: unit
        ref: "git check-ignore .env exits zero; git check-ignore .env.example exits non-zero"
        status: pass
    human_judgment: false
  - id: D4
    description: "pnpm workspace resolves apps/* and packages/* with packages/ empty, and the root package.json declares the full db:* script surface"
    verification:
      - kind: unit
        ref: "docker compose config --services prints a single service name (db); ls packages/ confirms absence"
        status: pass
    human_judgment: false
  - id: D5
    description: "Root vitest.config.ts and tsconfig.base.json establish a real test-runner configuration"
    verification:
      - kind: unit
        ref: "pnpm exec vitest run --passWithNoTests exits 0 against real config (no 'no configuration found' error)"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-09-06
status: complete
---

# Phase 01 Plan 01: Local Environment Foundation Summary

**pnpm workspace + a healthy loopback-only postgres:17 dev container with a zero-extension baseline, a committed RECIPE_DEV_DATABASE_URL template, a root vitest runner, and a dated redeploy-investigation write-back that confirmed migrate-on-boot as the root cause and forced D8 to ACCEPTED.**

## Performance

- **Duration:** ~25 min across two executor sessions (Task 1 + checkpoint in session 1; Task 3 + this summary in session 2)
- **Started:** 2026-09-06T23:50:00Z (approx, Task 1 start)
- **Completed:** 2026-09-07T00:15:00Z (approx)
- **Tasks:** 3 (1 auto, 1 checkpoint:human-verify, 1 auto)
- **Files modified:** 10 (7 created, 3 modified) across both task commits

## Accomplishments
- Ran the D-25/D-26/D-27 timeboxed redeploy investigation: tier 1 (existing sibling repos) was decisive — `AI-Diagramming-Tool` runs Drizzle migrations at application boot via `initDb()`, directly contradicting the owner-stated "already decoupled" premise. This forced D8 from PROPOSED to ACCEPTED and opened a new D14 entry (both in `docs/decisions.md`), per D-27's rule that a finding opens a decision only when it forces one.
- Cleared the package-legitimacy checkpoint: the developer approved `next` 16.3.4, `zod` 4.5.4, `pg` 8.23.0, and `tsx` latest at the researched/audited versions, noting Next.js 16's removed synchronous-`params` shim for plans 01-02/01-05.
- Stood up the pnpm workspace (`apps/*` + `packages/*`, `packages/` deliberately empty per D-02) with the full root `db:*` script surface declared per D-03, including forward-declared targets (`db:seed`, `db:reset`, `db:query`) that later plans implement.
- Brought up a healthy `postgres:17` (Debian/glibc, not Alpine) container: loopback-only port publication, named volume, `pg_isready` healthcheck, and a verified-empty extension baseline (0 non-default extensions) — no `docker-entrypoint-initdb.d`-style mount anywhere in the compose file.
- Committed `.env.example` naming `RECIPE_DEV_DATABASE_URL` and reserving the staging/prod names as comments; generated the real, gitignored `.env` locally with a randomly generated password that was never printed to stdout/stderr.
- Established `vitest.config.ts` (forks pool, `fileParallelism: false`, 180s timeouts) and `tsconfig.base.json` as the shared root configuration for every later plan in this phase.

## Task Commits

Each task was committed atomically:

1. **Task 1: Timeboxed redeploy root-cause investigation, written back to current-state section 7** - `a4abf80` (docs)
2. **Task 2: Verify package legitimacy before the first dependency install** - checkpoint, no commit (developer approved researched versions)
3. **Task 3: pnpm workspace, PostgreSQL 17 container, connection-variable template, and test runner** - `597103d` (feat)

**Plan metadata:** committed alongside this summary.

## Files Created/Modified
- `pnpm-workspace.yaml` - workspace globs `apps/*` + `packages/*`
- `package.json` - root manifest, `db:*`/`dev`/`test` scripts, workspace-root dev dependencies (vitest, execa, tsx, typescript, dotenv, @types/node)
- `pnpm-lock.yaml` - resolved lockfile, committed for auditability (T-01-01 mitigation)
- `tsconfig.base.json` - shared strict TS compiler options
- `vitest.config.ts` - root test-runner config covering `scripts/`, `tests/`, `apps/`
- `docker-compose.yml` - single `db` service, `postgres:17`, loopback port, named volume, healthcheck, empty extension baseline
- `.env.example` - committed connection-variable template
- `.env` - real, gitignored local env file (password generated locally, never logged)
- `.gitignore` - added `.next/`, `*.tsbuildinfo`, `coverage/`
- `docs/00-current-state.md` - section 7 pain point 2 investigation write-back (Task 1)
- `docs/decisions.md` - D8 PROPOSED -> ACCEPTED, new D14 entry (Task 1, forced by finding)

## Decisions Made
- **@types/node pinned to 24.13.3, not the resolved-latest 26.4.1** — the installed Node runtime is v24.19.0; letting `pnpm add` resolve to a future major's type definitions risked type-checking against APIs that don't exist in the actual runtime. Re-installed pinned to the 24.x line.
- **db:seed/db:reset/db:query declared now, implemented later** — the plan explicitly calls for this forward declaration so plans 01-02/01-03/01-04 never have to re-edit the root manifest; this is not a stub, it's scoped scaffolding the plan itself specifies.
- **Container left running (healthy) at the end of this plan** — no plan requirement dictates a particular end-state, and leaving it up avoids an unnecessary cold-start for whichever plan runs next.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] docker-compose.yml header comments tripped their own verify-guard regex**
- **Found during:** Task 3 (running the plan's `<verify>` compose-guards check immediately after authoring the file)
- **Issue:** The compose file's own explanatory comments used the literal substrings `0.0.0.0` (in "never 0.0.0.0") and `initdb` (inside "docker-entrypoint-initdb.d"), both of which the plan's automated guard regex-matches against the whole file, not just the port/volume declarations — so the guard failed against comments intended to *document* the prohibition, not violate it.
- **Fix:** Reworded both comments to convey the same meaning ("all-interfaces host component", "container-startup script-mount convention") without the literal trigger substrings.
- **Files modified:** `docker-compose.yml`
- **Verification:** Re-ran the plan's `node -e` compose-guards check; printed `compose-guards-ok`.
- **Committed in:** `597103d` (part of Task 3 commit — fixed before commit, not a separate commit)

**2. [Rule 1 - Bug] @types/node resolved to a Node major newer than the installed runtime**
- **Found during:** Task 3, installing workspace-root dev dependencies
- **Issue:** `pnpm add -Dw @types/node` (no version specified, per the plan's unpinned instruction) resolved to `26.4.1`, describing a Node major ahead of the actually-installed `v24.19.0` — a latent source of "types say this API exists, runtime disagrees" bugs.
- **Fix:** Re-ran `pnpm add -Dw @types/node@24.13.3` to pin to the latest 24.x release matching the installed runtime.
- **Files modified:** `package.json`, `pnpm-lock.yaml`
- **Verification:** `package.json` now lists `"@types/node": "^24.13.3"`.
- **Committed in:** `597103d` (part of Task 3 commit)

---

**Total deviations:** 2 auto-fixed (2 Rule 1 bugs, both self-authored and caught before commit)
**Impact on plan:** Both fixes are necessary for correctness (a passing verify-guard that actually verifies something, and type definitions matching the real runtime). No scope creep — no files touched beyond what Task 3 already specified.

## Issues Encountered
None beyond the two self-caught deviations above, both resolved before the Task 3 commit.

## User Setup Required
None - no external service configuration required. The `.env` file was generated automatically by Task 3 with a locally generated random password; no value was printed or logged.

## Next Phase Readiness
- The pnpm workspace, dev PostgreSQL container, connection-variable naming convention, and test runner are all in place for plan 01-02 (Drizzle schema, recipe app scaffold, `scripts/env.ts`) to build on directly.
- `db:seed`, `db:reset`, and `db:query` are declared as root scripts but point at files that do not exist yet — plans 01-02 (seed), 01-03, and 01-04 (`db-reset.ts`, `db-query.ts`) must create them. This is intentional scaffolding per the plan, not a regression to fix.
- The redeploy investigation reached a confirmed root cause (tier 1, `AI-Diagramming-Tool` migrate-on-boot) rather than "still UNKNOWN" — D8 is now ACCEPTED. One honestly-recorded gap remains open: whether other candidate repos (`Fitness Coach`, `saas-boilerplate`) share the same pattern was not established, since tier 1 stopped at the first decisive hit per the D-25 timebox. This does not block any Phase 1 work.
- The PostgreSQL container was left running (healthy) at the end of this plan; `pnpm db:down` (once wired) or `docker compose down -v` tears it down if a clean slate is needed before the next plan.

---
*Phase: 01-local-environment*
*Completed: 2026-09-06*

## Self-Check: PASSED

- All key-files.created (`pnpm-workspace.yaml`, `package.json`, `tsconfig.base.json`, `vitest.config.ts`, `docker-compose.yml`, `.env.example`, `pnpm-lock.yaml`) confirmed present on disk.
- `git log --oneline --all` confirms all three task/plan commits exist: `a4abf80` (Task 1), `597103d` (Task 3), and this metadata commit.
- Re-ran every plan-level `<verification>` command immediately before writing this summary: `docker compose up -d --wait` reports Healthy; `SHOW server_version` returns `17.11`; extension count is `0`; `docker compose config --services` prints one service; `pnpm exec vitest run --passWithNoTests` exits 0 against real config; `git check-ignore .env.example` exits non-zero (not ignored, as required).
- Re-ran Task 1's automated acceptance check against `docs/00-current-state.md` section 7: printed `investigation-section-ok`.
