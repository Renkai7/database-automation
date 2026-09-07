---
phase: 01-local-environment
plan: 04
subsystem: infra
tags: [pg, node-postgres, execa, docker-compose, drizzle-kit, vitest]

requires:
  - phase: 01-local-environment
    provides: "scripts/env.ts (getDevDatabaseUrl, assertDevelopmentDatabase), the full recipes/ingredients/steps recipe core with two applied migrations, and the deterministic 1/8/5 seed"
provides:
  - "pnpm db:query \"<SQL>\" — a pg.Client one-shot CLI hardcoded to the local dev database, no flag/env-based redirect possible"
  - "pnpm db:reset — full docker compose down -v -> up -d --wait -> assert -> migrate -> seed, non-interactive, convergent on repeat runs"
  - "tests/guardrails.test.ts — a Docker-free mechanical check for the phase's structural constraints (loopback port, no init-script mount, no drizzle-kit push, no leaked credential, no env-module bypass)"
affects: [01-05, phase-02, phase-04]

actuals:
  tokens: 4800
  tasks: 3
  commits: 4
  plan_head_before: 3a5ea41e5a4180f4e5315c5fd1a7acd84d2b05e3

tech-stack:
  added: ["pg 8.23.0 (workspace root)", "@types/pg 8.23.1 (workspace root)"]
  patterns:
    - "One-shot pg.Client (not Pool) for every root-level CLI script, matching 01-RESEARCH.md Pattern 5"
    - "Argument-count-plus-hyphen-prefix rejection as the entire flag-surface guard for db:query, rather than a parser library — D-16 requires zero flag surface, not a well-behaved one"
    - "db:reset step orchestration: name-and-abort-on-first-failure via a small runStep(name, action) helper, never a bare Promise.all or fire-and-forget chain"
    - "Guardrail assertions are pure git-ls-files-enumerated file reads with no Docker/DB dependency, so the suite can run in every environment including CI"

key-files:
  created:
    - scripts/db-query.ts
    - scripts/db-reset.ts
    - tests/db-query.test.ts
    - tests/db-reset.test.ts
    - tests/guardrails.test.ts
  modified:
    - package.json
    - pnpm-lock.yaml

key-decisions:
  - "pg + @types/pg installed at the workspace root (Rule 3, same pnpm-workspace resolution issue as zod in plan 01-02) — scripts/db-query.ts and scripts/db-reset.ts live under the root scripts/ directory and resolve bare imports from their own directory upward, not from apps/recipe-app/node_modules."
  - "tests/guardrails.test.ts's connection-string-prefix and direct-env-read checks are scoped to exclude *.test.ts files. Taken fully literally, the plan's own 'scan the whole source surface' wording would flag scripts/env.test.ts's pre-existing, legitimate fake-credential fixtures and this plan's own tests/db-query.test.ts fixtures — the opposite of the leaked-credential anti-pattern the checks exist to catch. Documented inline in the test file and here rather than silently narrowed."

requirements-completed: [ENV-04, ENV-05]

coverage:
  - id: D1
    description: "pnpm db:query \"<SQL>\" opens a direct connection to the local dev database, prints rows, and refuses every redirect shape (zero args, hyphen-prefixed arg, two args, bare DATABASE_URL) with no credential ever printed (ENV-05, D-15/D-16/D-17)"
    requirement: ENV-05
    verification:
      - kind: integration
        ref: "tests/db-query.test.ts (7 tests, all pass)"
        status: pass
      - kind: integration
        ref: "pnpm db:query \"SELECT count(*) AS ingredient_count FROM ingredients;\" — printed 8"
        status: pass
    human_judgment: false
  - id: D2
    description: "pnpm db:reset performs a full docker compose down -v -> up -d --wait -> assert -> migrate -> seed teardown-and-rebuild non-interactively, converging to identical row counts (1/8/5) on a second consecutive run (ENV-04, D-22/D-24)"
    requirement: ENV-04
    verification:
      - kind: integration
        ref: "tests/db-reset.test.ts (real command run twice via execa, asserted against live information_schema and row counts)"
        status: pass
      - kind: integration
        ref: "docker compose exec -T db psql ... row-count query — printed 1/8/5 after a manual pnpm db:reset run"
        status: pass
    human_judgment: false
  - id: D3
    description: "A Docker-free guardrail suite mechanically asserts the phase's structural constraints: loopback-only port, no init-script mount, no drizzle-kit push reference, no leaked connection-string prefix outside .env.example, db-query.ts has no process.env read, db-reset.ts has no interactive-prompt import or stdin read, no non-test file bypasses scripts/env.ts to read the dev connection variable directly"
    verification:
      - kind: unit
        ref: "tests/guardrails.test.ts (7 tests, all pass, re-run with the db container stopped)"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-09-07
status: complete
---

# Phase 01 Plan 04: Direct-Query, One-Command Reset, and Structural Guardrails Summary

**`pnpm db:query` (a flag-less, argument-count-gated `pg.Client` CLI) and `pnpm db:reset` (a five-step, name-and-abort teardown/rebuild) give Claude Code and the developer the two commands ENV-04/ENV-05 exist to hand over, backed by a Docker-free guardrail suite that fails mechanically the moment any of Phase 1's structural constraints regresses.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-09-07T21:02:00Z (approx)
- **Completed:** 2026-09-07T21:09:00Z (approx)
- **Tasks:** 3 (2 `tdd="true"`, 1 plain `auto`)
- **Files modified:** 7 (5 created, 2 modified) across four commits

## Accomplishments
- Built `scripts/db-query.ts`: a one-shot `pg.Client` CLI accepting exactly one positional argument (the SQL text). Any hyphen-prefixed argument, zero arguments, or more than one argument is rejected before a client is even constructed. Imports `getDevDatabaseUrl`/`assertDevelopmentDatabase` from the shared `scripts/env.ts` and never reads `process.env` itself, so a bare `DATABASE_URL` in the child environment aborts at import time — before any connection is opened — via `env.ts`'s existing D-20 hard failure.
- Verified `pnpm db:query "SELECT count(*) AS ingredient_count FROM ingredients;"` against the live seeded database prints `8`, and that a scratch insert-then-delete succeeds without disturbing the seeded 1/8/5 row counts.
- Built `scripts/db-reset.ts`: `docker compose down -v` → `docker compose up -d --wait` (with a bounded `pg_isready` poll fallback per Assumption A4, in case the installed Compose build predates `--wait`) → `assertDevelopmentDatabase` → `pnpm run db:migrate` → `pnpm run db:seed`, each step named and the whole run aborting non-interactively on the first failure. No `readline`/`prompts`/`inquirer` import and no stdin read anywhere — the environment assertion is the structural guard D-24 calls for, not a confirmation prompt.
- Ran `pnpm db:reset` manually and via `tests/db-reset.test.ts` (which runs the real command twice through `execa`): both runs converge to the same live-database state — `drizzle.__drizzle_migrations` row count matches `_journal.json`'s 2 entries, `information_schema.tables` lists exactly `recipes`/`ingredients`/`steps` plus Drizzle's own migrations table, and row counts are `1`/`8`/`5` both times.
- Built `tests/guardrails.test.ts`: 7 assertions enumerated via `git ls-files`, scoped to the source surface (root `package.json`/`docker-compose.yml`/`.env.example`, everything under `scripts/` and `tests/`, and `apps/recipe-app/` minus `design/`) — loopback-only port publication, no container init-script mount, no `drizzle-kit push` reference anywhere (search literal built at runtime so the test can't match its own describing text), no leaked `postgres://` connection-string prefix outside `.env.example`, `db-query.ts` has no `process.env` read, `db-reset.ts` has no interactive-prompt import or stdin read, and no non-test file bypasses `scripts/env.ts` to read `RECIPE_DEV_DATABASE_URL` directly. Confirmed the suite passes with the `db` container stopped (no Docker/database dependency in the assertions themselves).
- Ran the full `vitest` suite (5 files, 24 tests) green, and left the development database up, healthy, migrated, and seeded (1/8/5) for plan 01-05.
- Marked `ENV-04` and `ENV-05` complete in `.planning/REQUIREMENTS.md` (neither is shared with any sibling plan in this phase, so both mark immediately).

## Task Commits

Each task was committed atomically:

1. **Task 1: The direct-query script Claude Code uses, structurally hardcoded to local** - `703a56a` (feat)
2. **Task 2: One-command destroy and rebuild** - `b64760a` (feat)
3. **Task 3: Guardrail suite for the phase's structural constraints** - `50d8085` (test)

**Self-caught fix (folded into the deviation ledger below):** `161abf4` (fix)

**Plan metadata:** committed alongside this summary.

## Files Created/Modified
- `scripts/db-query.ts` - one-shot `pg.Client` CLI, exactly one positional SQL argument, no flag surface, no `process.env` read
- `scripts/db-reset.ts` - five-step named, abort-on-first-failure teardown/rebuild orchestration; no interactive-prompt import or stdin read
- `tests/db-query.test.ts` - 7 execa-driven child-process tests covering print/modify/usage/hyphen-arg/multi-arg/bare-`DATABASE_URL`/no-credential-leak
- `tests/db-reset.test.ts` - runs the real `db:reset` command twice, asserting live-database convergence both times
- `tests/guardrails.test.ts` - 7 Docker-free structural assertions over the enumerated source surface
- `package.json`, `pnpm-lock.yaml` - added `pg`/`@types/pg` at the workspace root

## Decisions Made
See `key-decisions` in frontmatter for full rationale. Summary: `pg`/`@types/pg` moved to the workspace root (module-resolution requirement, matching plan 01-02's zod precedent, not a preference); the two broadest guardrail assertions (connection-string prefix, direct-env-read) are scoped to exclude `*.test.ts` fixture files, since those files legitimately construct fake credentials specifically to test `scripts/env.ts`'s own rejection/assertion logic.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `pg` unresolvable from `scripts/` when installed only into `apps/recipe-app`**
- **Found during:** Task 1, before writing any code — confirmed via `node -e "require.resolve('pg')"` from the workspace root, which failed with `MODULE_NOT_FOUND`.
- **Issue:** `scripts/db-query.ts` and `scripts/db-reset.ts` live at the workspace root and would resolve the bare specifier `pg` relative to their own directory chain, walking up from `scripts/` — not from `apps/recipe-app/node_modules`, where `pg` was the only place it existed (as a dependency of the recipe app). Identical root cause to plan 01-02's zod deviation.
- **Fix:** Ran `pnpm add -Dw pg@8.23.0 @types/pg@8.23.1`, matching the versions already used/approved for `apps/recipe-app`.
- **Files modified:** `package.json`, `pnpm-lock.yaml`
- **Verification:** `node -e "require.resolve('pg')"` from the workspace root now succeeds; both new scripts import and use `pg` without error.
- **Committed in:** `703a56a` (Task 1 commit)

**2. [Rule 1 - Bug] Ambiguous hyphen-prefixed comment text in `scripts/db-query.ts`**
- **Found during:** Self-check before finalizing Task 1 — Task 1's own acceptance criteria require no string beginning with two hyphens anywhere in the file outside the printed usage message.
- **Issue:** A doc comment described the deliberately-absent flags as `--url/--env/--database`, which are themselves literal two-hyphen-prefixed strings, creating ambiguity against the file's own acceptance criterion even though the intent (no such flags exist) was correct.
- **Fix:** Reworded the comment to convey the same meaning ("no url, env, or database flag of any kind") with no hyphen-prefixed substring anywhere in the file.
- **Files modified:** `scripts/db-query.ts`
- **Verification:** Re-ran `tests/db-query.test.ts` (7/7 still passing) and confirmed zero occurrences of `--` in the file.
- **Committed in:** `161abf4` (standalone fix commit, after the Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 Rule 3 blocking, 1 Rule 1 bug)
**Impact on plan:** Both fixes were necessary for the documented commands to work at all (`pg` resolution) and for Task 1's own acceptance criteria to hold unambiguously (comment wording). No scope creep — no functionality was added beyond what the plan already specified.

## Issues Encountered
None beyond the two self-caught deviations above, both resolved before moving to the next task.

## User Setup Required
None - no external service configuration required. No new secrets were introduced; `pg`/`@types/pg` are ordinary npm packages already approved at the phase's package-legitimacy checkpoint (01-01) at the same version pinned in `apps/recipe-app`.

## Next Phase Readiness
- `pnpm db:query` and `pnpm db:reset` are both live, tested, and documented — plan 01-05 (and any later phase reusing these commands, e.g. Phase 4's automated migration-history tests) can invoke them directly.
- `tests/guardrails.test.ts` is in place and green; any future change that reintroduces an all-interfaces port binding, an init-script mount, a `drizzle-kit push` reference, a leaked connection string, a direct `process.env` read in `db-query.ts`, an interactive prompt in `db-reset.ts`, or a bypass of `scripts/env.ts` will fail this suite immediately.
- The development database was left up, healthy, migrated (2 journal entries), and seeded (1 recipe / 8 ingredients / 5 steps) at the end of this plan — plan 01-05's build and smoke test can read from it directly with no further setup. Per this plan's own exclusive-access window, `pnpm db:reset` was not left running mid-teardown; the final state is the post-rebuild, fully-seeded state.
- No new entries were added to `.planning/WINDOWS.md` by this plan; the one pre-existing open entry (plan 01-02's no-RED-phase note) is unrelated and remains open from before.

---
*Phase: 01-local-environment*
*Completed: 2026-09-07*

## Self-Check: PASSED

- All key-files.created (`scripts/db-query.ts`, `scripts/db-reset.ts`, `tests/db-query.test.ts`, `tests/db-reset.test.ts`, `tests/guardrails.test.ts`) confirmed present on disk.
- `git log --oneline --all` confirms all four commits exist: `703a56a` (Task 1), `b64760a` (Task 2), `50d8085` (Task 3), `161abf4` (self-caught fix).
- Re-ran every plan-level `<verification>` command immediately before writing this summary: `pnpm db:query "SELECT count(*) AS ingredient_count FROM ingredients;"` printed `8`; `pnpm db:query` with zero args, a hyphen-prefixed arg, two args, and a bare `DATABASE_URL` in the child environment each exited non-zero; `pnpm db:reset` completed non-interactively and a second consecutive run converged to identical `1/8/5` row counts; `pnpm exec vitest run tests/guardrails.test.ts` passed with the `db` container stopped; `pnpm exec vitest run` reported 5 files / 24 tests passing with no failures or skips.
- Confirmed the development database is left up, healthy, and seeded (`1/8/5`) for plan 01-05.
