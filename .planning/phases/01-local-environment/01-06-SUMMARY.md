---
phase: 01-local-environment
plan: 06
subsystem: database
tags: [zod, drizzle-kit, environment-validation, security, gap-closure]

requires:
  - phase: 01-local-environment (01-01..01-05)
    provides: scripts/env.ts's shared validation module, apps/recipe-app/drizzle.config.ts, db-query/db-reset CLI scripts, tests/guardrails.test.ts's structural-constraint suite
provides:
  - "scripts/env.ts: DEV_DATABASE_HOST_ALLOWLIST, EXPECTED_DEV_DATABASE_PORT, and assertLocalDevelopmentTarget() -- the source-level development target pin (D-16)"
  - "apps/recipe-app/drizzle.config.ts calling the shared target assertion explicitly, closing the migrate path's guard gap (WR-02)"
  - "tests/target-pin.test.ts: end-to-end proof that db-query, db-migrate, and db-reset each refuse a redirected connection target before doing any work"
  - "tests/guardrails.test.ts: two named fixture allowlists replacing the blanket *.test.ts exemption (WR-01), plus two new mechanical assertions for the target pin and the drizzle-config wiring"
affects: [01-07, 01-08, phase-04-migration-runner, phase-05-ci-pipeline]

actuals:
  tokens: 6100
  tasks: 2
  commits: 3
  plan_head_before: cfa622b447190fe52a71f10748d43f18c09c5563

tech-stack:
  added: []
  patterns:
    - "Source-level target pin: host/port/database-name as named constants in scripts/env.ts, checked by a synchronous assertion function, wired into both a zod schema refinement and a redundant accessor-level re-check -- only credentials remain environment-sourced"
    - "Value-free rejection messages: every thrown error names the violated constraint and the ALLOWED value, never the REJECTED value, so an operator learns what failed without any output path ever echoing a credential or a redirected host"
    - "Guardrail suite fixture allowlists: two separate, explicitly enumerated file lists (not a blanket *.test.ts exemption) so newly added test files are covered by default"

key-files:
  created:
    - tests/target-pin.test.ts
  modified:
    - scripts/env.ts
    - scripts/env.test.ts
    - apps/recipe-app/drizzle.config.ts
    - tests/guardrails.test.ts

key-decisions:
  - "Chose the stronger of 01-VERIFICATION.md's two offered fixes: host, port, AND database name are now source-level constants (not just a loopback hostname allowlist), because a hostname-only allowlist still lets .env redirect to a different local database, which is literally 'another database' reached through an environment override -- exactly what D-16 forbids."
  - "Switched RECIPE_DEV_DATABASE_URL's zod validator from the deprecated z.string().url() to the top-level z.url() (zod 4.5.4 marks the chained form @deprecated at the type level; behavior is equivalent)."
  - "assertLocalDevelopmentTarget() is wired in three deliberately overlapping places (schema refinement, wrapped module-parse, and getDevDatabaseUrl()) rather than one, matching 01-RESEARCH.md's three-independent-layers framing -- redundant today by design, so a future loosening of any one layer does not silently reopen the gap."

patterns-established:
  - "Pattern: pin identifying connection-target components as named source constants and assert them synchronously pre-connect, in every process that imports the shared env module, rather than relying on any single call site to remember to check."

requirements-completed: [ENV-02, ENV-03]

coverage:
  - id: D1
    description: "A redirected RECIPE_DEV_DATABASE_URL (non-loopback host, wrong port, or wrong database name) is rejected before any connection is opened, in every process that imports scripts/env.ts -- including the one drizzle-kit migrate runs in."
    requirement: "ENV-03"
    verification:
      - kind: unit
        ref: "scripts/env.test.ts#scripts/env.ts — development target pin (D-16)"
        status: pass
      - kind: integration
        ref: "tests/target-pin.test.ts#development target pin — end-to-end (D-16)"
        status: pass
    human_judgment: false
  - id: D2
    description: "db:reset refuses a redirected target before tearing anything down -- the container and its seeded data survive an attempted redirect."
    requirement: "ENV-04"
    verification:
      - kind: integration
        ref: "tests/target-pin.test.ts#refuses db-reset when RECIPE_DEV_DATABASE_URL is redirected, and never tears anything down"
        status: pass
    human_judgment: false
  - id: D3
    description: "No rejection path on any of the three entry points (db-query, db-migrate, db-reset) prints a connection-string scheme prefix, a password, or the rejected value."
    requirement: "ENV-03"
    verification:
      - kind: unit
        ref: "scripts/env.test.ts (message-shape assertions across host/port/database-name rejection cases)"
        status: pass
      - kind: integration
        ref: "tests/target-pin.test.ts#assertNoLeak"
        status: pass
    human_judgment: false
  - id: D4
    description: "apps/recipe-app/drizzle.config.ts calls the shared target assertion explicitly rather than inheriting it from a sibling process's earlier check (closes WR-02's TOCTOU-shaped gap)."
    requirement: "ENV-02"
    verification:
      - kind: unit
        ref: "tests/guardrails.test.ts#apps/recipe-app/drizzle.config.ts calls the shared target assertion (D-16, closes the PARTIAL key link)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The guardrail suite's connection-string-prefix and direct-env-read checks are covered by named, explicit fixture allowlists instead of a blanket *.test.ts exemption, and mechanically assert the target pin and drizzle-config wiring exist."
    requirement: "ENV-03"
    verification:
      - kind: unit
        ref: "tests/guardrails.test.ts (9 assertions, up from 7)"
        status: pass
    human_judgment: false

duration: 55min
completed: 2026-09-07
status: complete
---

# Phase 1 Plan 06: Development Target Pin (Gap Closure) Summary

**Host, port, and database name for the local development connection are now source-level constants in `scripts/env.ts`, enforced pre-connect by every process (including `drizzle-kit migrate`'s own config) — closing 01-VERIFICATION.md's one blocking gap (D-16 / CR-01 / WR-01 / WR-02).**

## Performance

- **Duration:** 55 min
- **Tasks:** 2 completed
- **Files modified:** 5 (1 created, 4 modified)

## Accomplishments

- `scripts/env.ts` now defines `DEV_DATABASE_HOST_ALLOWLIST`, `EXPECTED_DEV_DATABASE_PORT`, and reuses the existing `EXPECTED_DEV_DATABASE_NAME` as the three pinned, source-level components of the development target, enforced by a new synchronous `assertLocalDevelopmentTarget(url)`.
- The assertion is wired into three overlapping layers: a zod schema refinement (rejects before any client is constructed), a wrapped module-level parse (forwards the assertion's own value-free errors unchanged, sanitises genuine zod failures), and a redundant re-check inside `getDevDatabaseUrl()`.
- `apps/recipe-app/drizzle.config.ts` — the config driving `drizzle-kit migrate`/`generate`, previously the one entry point with zero environment assertion — now imports and calls `assertLocalDevelopmentTarget` explicitly, closing WR-02's TOCTOU-shaped gap.
- `tests/target-pin.test.ts` (new) proves end-to-end, via real child processes, that `db-query`, `db-migrate`, and `db-reset` all refuse a redirected `RECIPE_DEV_DATABASE_URL`, and — the load-bearing assertion — that `db-reset` refuses *before* tearing anything down: the container and its seeded data survive.
- `tests/guardrails.test.ts` replaced its blanket `*.test.ts` exemption with two named, explicit fixture allowlists (`FIXTURE_FILES_WITH_CONNECTION_STRINGS`, `FIXTURE_FILES_READING_DEV_CONNECTION_VARIABLE`), so a newly added test file — including this plan's own `tests/target-pin.test.ts` — is covered by default. Added two mechanical assertions for the target pin and the drizzle-config wiring (9 assertions total, up from 7).

## Task Commits

Task 1 (`type="tracer" tdd="true"`) followed the RED → GREEN cycle: the two test commits were verified RED against the pre-fix source (see "TDD Gate Compliance" below) before the implementation commit.

1. **Task 1 — RED: failing tests for the development target pin** — `ed5a00b` (test)
2. **Task 1 — GREEN: pin the target in source, guard the migrate path** — `475661a` (feat)
3. **Task 2: narrow the guardrail suite's fixture exemptions, add D-16 assertions** — `48d5db5` (test)

_Note: Task 2 is `type="auto"`, not TDD — its commit is typed `test` because its only change is to `tests/guardrails.test.ts` itself (no production source touched), which fits the `test` commit-type table entry ("Test-only changes") better than `feat`._

## Files Created/Modified

- `scripts/env.ts` — added `DEV_DATABASE_HOST_ALLOWLIST`, `EXPECTED_DEV_DATABASE_PORT`, `assertLocalDevelopmentTarget()`; wired into the schema refinement, a wrapped module-parse, and `getDevDatabaseUrl()`.
- `apps/recipe-app/drizzle.config.ts` — calls `assertLocalDevelopmentTarget` before handing the URL to `dbCredentials.url`; comment corrected to no longer claim inherited protection.
- `scripts/env.test.ts` — added cases for host/port/database-name rejection, the four accepted loopback spellings, and the pinned-constants export.
- `tests/target-pin.test.ts` (new) — end-to-end child-process proof across `db-query`, `db-migrate`, `db-reset`.
- `tests/guardrails.test.ts` — two named fixture allowlists, a runtime-concatenated connection-string needle, rewritten self-matching comments, and two new D-16 assertions.

## Decisions Made

See `key-decisions` in frontmatter: the stronger host+port+database-name pin was chosen over a hostname-only allowlist (the weaker option was explicitly rejected by the plan as not satisfying D-16's literal text); `z.url()` replaces the deprecated `z.string().url()`; the assertion is wired redundantly across three layers by design.

## TDD Gate Compliance

Task 1 carried `tdd="true"`. Gate sequence, confirmed by re-running each phase against the actual source state (not merely inferred from commit order):

| Gate | Commit | Verification |
|------|--------|--------------|
| RED | `ed5a00b` | Reverted `scripts/env.ts` and `apps/recipe-app/drizzle.config.ts` to their pre-fix (HEAD) content via `git checkout HEAD --`, then ran `pnpm exec vitest run scripts/env.test.ts` (4 of 14 tests failed, each on the new target-pin assertion, not a setup crash) and `pnpm exec vitest run tests/target-pin.test.ts` (the `db-reset` case failed — `survivalCheck.exitCode` was `1`, not `0` — because the pre-fix code tore down the real container via `docker compose down -v` *before* the redirected URL was ever rejected; this is the exact gap the plan closes). Restored the local dev database to a clean seeded state via `pnpm db:reset` afterward. |
| GREEN | `475661a` | Restored the fixed source, re-ran both files: `scripts/env.test.ts` 14/14 pass, `tests/target-pin.test.ts` 3/3 pass (survival assertion held). |
| REFACTOR | — (none needed) | No cleanup pass was needed after GREEN; implementation was minimal on first pass. |

`workflow.tdd_mode` is not set in `.planning/config.json` for this project, so the strict `gsd_run check tdd-red-evidence` machine-gate was not invoked — RED evidence above was established manually by reverting source and re-running, which is the same underlying proof the automated gate would have required.

## Deviations from Plan

None — plan executed exactly as written. The two tasks' `<action>` and `<acceptance_criteria>` were followed directly; no Rule 1-4 deviations were needed.

## Issues Encountered

- **Precondition not initially met:** Task 1's `<precondition>` required the `db` compose service running and healthy with the seed intact. It was not running at plan start (`pnpm db:query` returned `ECONNREFUSED`). Resolved via the project's own standard, safe, idempotent automation (`pnpm db:up`), which is exactly what `db-reset.ts` itself does at the start of every rebuild — not a judgment call requiring a human. Re-verified the precondition afterward (8 ingredients), then proceeded.
- **RED-phase side effect:** Verifying RED evidence for the `db:reset` case in `tests/target-pin.test.ts` necessarily ran the real (pre-fix) `db-reset.ts` against a redirected environment variable, which — because the pre-fix code had no pre-connect guard — destroyed and recreated the real local container (proving the gap). Restored to a clean, fully-migrated, reseeded state via `pnpm db:reset` (normal environment) before proceeding to GREEN.
- **Regex mismatch on first guardrails run:** The new `DEV_DATABASE_HOST_ALLOWLIST` array-extraction regex in `tests/guardrails.test.ts` initially truncated at the bracketed IPv6 literal's own closing `]` character (`"[::1]"` contains a `]` before the array's real closing bracket). Fixed by anchoring the match to `] as const` instead of a bracket-depth-blind `[^\]]*`. Caught immediately by the test itself; fixed before the commit.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- 01-VERIFICATION.md's failed truth #6 (D-16) now holds as built: repointing `db:query`, `db:migrate`, or `db:reset` at another database requires a source diff in `scripts/env.ts`, not a `.env` edit.
- WR-01 (blanket test-file exemption) and WR-02 (TOCTOU-shaped migrate-path gap) are both closed.
- ENV-04 and ENV-05 requirement IDs are also declared by sibling gap-closure plan 01-07 and remain `Pending` in REQUIREMENTS.md until that plan's own SUMMARY exists (shared-ID gate, #2388) — only ENV-02 and ENV-03 were marked complete by this plan's execution.
- Plan 01-07 (CR-02's `db-reset.ts` self-verification hardening, and the outstanding UI-SPEC row) and 01-08 (final Phase 1 completion bookkeeping) remain to close out this phase.
- Full `pnpm test` suite: 38/38 green, including the Docker-daemon-stopped run of `tests/guardrails.test.ts` alone (9/9).

## Self-Check: PASSED

All created/modified files confirmed present on disk (`tests/target-pin.test.ts`, `scripts/env.ts`, `apps/recipe-app/drizzle.config.ts`, `scripts/env.test.ts`, `tests/guardrails.test.ts`, this SUMMARY.md); all three task commits (`ed5a00b`, `475661a`, `48d5db5`) confirmed present in `git log`. Plan-level `<verification>` re-run: full `pnpm test` 38/38 green; `pnpm exec vitest run tests/guardrails.test.ts` 9/9 green with the Docker daemon stopped; `pnpm db:query`/`pnpm db:migrate` both succeed against the real local environment.

---
*Phase: 01-local-environment*
*Completed: 2026-09-07*
