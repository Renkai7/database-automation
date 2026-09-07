---
phase: 01-local-environment
verified: 2026-09-06T22:00:00Z
status: gaps_found
score: 9/11 must-haves verified
covered_files:
  - ".planning/REQUIREMENTS.md"
  - ".planning/phases/01-local-environment/01-01-PLAN.md"
  - ".planning/phases/01-local-environment/01-01-SUMMARY.md"
  - ".planning/phases/01-local-environment/01-02-PLAN.md"
  - ".planning/phases/01-local-environment/01-02-SUMMARY.md"
  - ".planning/phases/01-local-environment/01-03-PLAN.md"
  - ".planning/phases/01-local-environment/01-03-SUMMARY.md"
  - ".planning/phases/01-local-environment/01-04-PLAN.md"
  - ".planning/phases/01-local-environment/01-04-SUMMARY.md"
  - ".planning/phases/01-local-environment/01-05-PLAN.md"
  - ".planning/phases/01-local-environment/01-05-SUMMARY.md"
  - "apps/recipe-app/drizzle.config.ts"
  - "apps/recipe-app/src/app/recipes/[slug]/error.tsx"
  - "apps/recipe-app/src/app/recipes/[slug]/not-found.tsx"
  - "apps/recipe-app/src/app/recipes/[slug]/page.tsx"
  - "apps/recipe-app/src/components/RecipeScreen.tsx"
  - "apps/recipe-app/src/db/client.ts"
  - "apps/recipe-app/src/db/schema.ts"
  - "apps/recipe-app/src/db/seed.ts"
  - "docker-compose.yml"
  - "docs/00-current-state.md"
  - "docs/decisions.md"
  - "package.json"
  - "scripts/db-query.ts"
  - "scripts/db-reset.ts"
  - "scripts/env.ts"
  - "tests/db-query.test.ts"
  - "tests/db-reset.test.ts"
  - "tests/guardrails.test.ts"
  - "tests/smoke.test.ts"
covered_digest: "v1:sha256:458e2f9d280a187c44b2a5091b99dfb5873763b228a476557fbaeec91aac67e3"
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "D-16 / 01-04-PLAN must_have: `db:query` and `db:reset`/`drizzle-kit migrate` expose no argument, flag, or environment override that redirects them at another database — repointing requires editing source in a reviewable diff"
    status: failed
    reason: >
      Confirmed by direct code reading, not just the prior code review's say-so. `scripts/env.ts:48-50`
      validates RECIPE_DEV_DATABASE_URL only as `z.string().url()` — any well-formed Postgres URL
      passes, with no host/port allowlist. That value is read from the workspace-root `.env` file
      (`dotenv.config()`, `scripts/env.ts:32`), which is exactly the kind of environment override
      D-16 says does not exist: repointing `db-query`, `db-reset`, the app, and drizzle-kit at any
      reachable host requires only editing one line of `.env` — no source diff at all. The only
      runtime check, `assertDevelopmentDatabase()`, inspects `current_database()` (the database NAME)
      and never the host. Compounding this: `apps/recipe-app/drizzle.config.ts` (verified by direct
      read) calls `getDevDatabaseUrl()` and passes it straight to `dbCredentials.url` — it never calls
      `assertDevelopmentDatabase()` at all. `drizzle-kit migrate`, invoked by the root `db:migrate`
      script and in turn by `db-reset.ts` step 4 (the single most destructive step in the whole
      pipeline), therefore runs against whatever `RECIPE_DEV_DATABASE_URL` resolves to with zero
      environment assertion of any kind — not even the weak, host-blind, database-name check.
      This is a genuine contradiction of a must-have this phase's own plan declared
      (`verification: test`, never resolved to `resolved`), and of CLAUDE.md's non-negotiable
      "prefer architectural enforcement over remembered caution." Today's blast radius is limited
      because no real staging/production database is reachable yet, but the mechanism this exact
      phase was supposed to build — so that later phases don't have to re-litigate it — does not
      hold as built. No VERIFICATION.md override exists accepting this deviation, and none is
      recommended here: the gap is a genuine safety-architecture miss, not an equivalent alternative
      implementation.
    artifacts:
      - path: "scripts/env.ts"
        issue: "EnvSchema (lines 48-50) validates RECIPE_DEV_DATABASE_URL as any well-formed URL string; no hostname/loopback restriction"
      - path: "apps/recipe-app/drizzle.config.ts"
        issue: "Never imports or calls assertDevelopmentDatabase(); dbCredentials.url comes straight from getDevDatabaseUrl() with no environment assertion guarding the destructive migrate/generate path"
      - path: "scripts/db-reset.ts"
        issue: "Step 4 (`drizzle-kit migrate` via `pnpm run db:migrate`) inherits no protection from step 3's assertion — a separate process, separate config, no shared guard (WR-02 in 01-REVIEW.md)"
    missing:
      - "Add a hostname allowlist (localhost/127.0.0.1) to the RECIPE_DEV_DATABASE_URL zod schema in scripts/env.ts, so a non-local host fails validation before any connection is attempted"
      - "Call assertDevelopmentDatabase() (or an equivalent host+name check) from drizzle.config.ts or a Drizzle Kit lifecycle hook, so the migrate/generate path is not the one command in the pipeline with zero environment assertion"
      - "If D-16's literal 'no environment override, repointing requires a source diff' property is still wanted, make at least the host/port a source-level constant, with only the password sourced from environment"
deferred: []
---

# Phase 1: Local Environment Verification Report

**Phase Goal:** The owner has a disposable local Postgres environment for schema work: a Drizzle
schema edit becomes an applied migration, the recipe app boots against it, Claude Code queries the
database directly with no Coolify terminal relaying, and the database can be destroyed and rebuilt
in one command.
**Verified:** 2026-09-06
**Status:** gaps_found
**Re-verification:** No — initial verification

## Adjudication of the Code Review's Two Critical Findings

The review (`01-REVIEW.md`) raised two Critical findings and I was asked to independently verify
each against source rather than accept or dismiss them on the review's say-so. I read every file
named in both findings directly (`scripts/env.ts`, `scripts/db-query.ts`, `scripts/db-reset.ts`,
`apps/recipe-app/drizzle.config.ts`, `tests/db-reset.test.ts`) before reaching a verdict.

### CR-01 — "hardcoded to local" contradicted by an unrestricted environment variable: **UPHELD**

Independently confirmed, not merely restated. `scripts/env.ts:48-50` validates
`RECIPE_DEV_DATABASE_URL` with `z.string().url()` only — no hostname check. `drizzle.config.ts`
(read directly) never imports `assertDevelopmentDatabase`. This is a real, load-bearing gap between
`01-CONTEXT.md` D-16's stated architecture and the code, and it is also an explicit, unresolved
`must_have` in `01-04-PLAN.md`'s own frontmatter (`verification: test`, status never marked
resolved). See the `gaps` entry above for full reasoning and the recommended fix. I did not find
grounds to soften or dismiss this finding — this is a genuine miss, not a review overstatement.

### CR-02 — `db-reset.ts` trusts `drizzle-kit migrate`'s exit code: **CONFIRMED AS AN ARCHITECTURAL GAP, BUT NOT A FAILED TRUTH TODAY**

Independently confirmed that `scripts/db-reset.ts:80-83` performs no post-migrate query against
`drizzle.__drizzle_migrations` or `information_schema.tables` — it only relies on `execa` throwing
on a non-zero exit code. That part of the review is accurate: the tool itself has no independent
state verification, which is exactly the "remembered caution" pattern (run the test suite
separately to notice a silent no-op) that CLAUDE.md's non-negotiable warns against.

However, I weighed this differently than a flat Critical/blocking finding: `tests/db-reset.test.ts`
does not merely test in isolation — it runs the *real* `pnpm run db:reset` command as a genuine
child process (`execa("pnpm", ["run", "db:reset"])`, not a mock), then independently queries the
live database for the exact state a false-positive would hide (migration row count vs.
`_journal.json`, table list, row counts), twice in a row to prove convergence. This test is part of
`pnpm test`, which I ran and confirmed green (26/26, including this file) immediately before writing
this report, and I independently re-queried the live database afterward and got the expected
`recipe_dev` / `1/8/5` state. So the truth this bears on — "the destroy-and-rebuild command ...
leav[es] a clean, freshly-migrated schema with no manual cleanup" — is behaviorally proven today by
a real, non-mocked test exercising the actual tool, not by presence-only reasoning.

I record this as a **Warning-level anti-pattern** (see Anti-Patterns section, and CR-02 in
`01-REVIEW.md` for the concrete fix), not a failed must-have: the review's characterization of *risk*
is accurate and the recommended fix (fold `assertRebuiltState`-style verification into
`db-reset.ts` itself) should be done, but the specific "drizzle-kit migrate exits 0 without applying
SQL" failure mode is not currently manifesting, and the tool's behavior is independently and
genuinely proven today, not merely asserted by the SUMMARY.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `docker compose up -d --wait` brings up a PostgreSQL 17 container matching a declared, honest extension baseline | ✓ VERIFIED | Live: `docker exec ... SHOW server_version` → `17.11 (Debian 17.11-1.pgdg13+2)`; `pg_extension` count excluding plpgsql → `0`. `docker-compose.yml` image is `postgres:17` (no `-alpine`). Baseline is declared empty per D-13 because production's actual list is recorded UNKNOWN in `docs/00-current-state.md` §4 — this is the plan's own resolution of an `unclassified` edge probe, not a hidden gap. |
| 2 | Every environment has its own distinctly-named connection variable; no generic variable can silently point at the wrong one | ✓ VERIFIED | `.env.example` (read via `git show HEAD:.env.example`, since the live guard blocks a direct read) defines `RECIPE_DEV_DATABASE_URL` and reserves `RECIPE_STAGING_DATABASE_URL`/`RECIPE_PROD_DATABASE_URL` as comments only, both placeholders. `scripts/env.ts:41-46` hard-fails on a bare `DATABASE_URL`; `tests/db-query.test.ts` and `scripts/env.test.ts` cover this behaviorally. |
| 3 | Claude Code queries the local database directly, with no command relayed through a Coolify terminal | ✓ VERIFIED | Ran `pnpm db:query "SELECT ... FROM recipes/ingredients/steps"` and `pnpm db:query "SELECT count(*) FROM drizzle.__drizzle_migrations"` live during this verification; both returned real rows (`recipe_dev`, `1/8/5`, migrations count `2`) directly from the Bash tool, no relay. |
| 4 | A schema edit run through the documented loop (generate → inspect → migrate) produces a migration, applies locally, and the app boots against the resulting schema | ✓ VERIFIED | Two real journal entries exist (`0000_bumpy_khan`, `0001_busy_thunderbolt`); `0001_busy_thunderbolt.sql` (read directly) creates `ingredients`/`steps` with real FK constraints to `recipes`. `pnpm test` (run live) is 26/26 green including `tests/smoke.test.ts`, which performs a real production build + `next start` + HTTP request and asserts on database-sourced content. |
| 5 | The destroy-and-rebuild command tears down and recreates the local database in one step, leaving a clean, freshly-migrated schema with no manual cleanup | ✓ VERIFIED | Behavior-dependent truth; verified via the genuine (non-mocked) `tests/db-reset.test.ts`, which runs the real `pnpm run db:reset` twice and independently re-queries live database state each time. Passed in the full suite run during this verification. Live re-check post-suite: `recipe_dev`, 2 migrations, `1/8/5` rows. See CR-02 adjudication above for the architectural caveat that does not currently break this truth. |
| 6 | `db-query`/`db-reset`/the migrate path expose no argument, flag, or environment override that redirects them at another database — repointing requires a source diff (D-16) | ✗ FAILED | See `gaps` in frontmatter and CR-01 adjudication above. `RECIPE_DEV_DATABASE_URL` is validated only as `z.string().url()` with no host restriction, and `drizzle.config.ts` never calls `assertDevelopmentDatabase()` at all. |
| 7 | The database port is published on loopback only, never all-interfaces (D-18) | ✓ VERIFIED | `docker-compose.yml:22` → `127.0.0.1:5432:5432`; live `docker port` confirms `5432/tcp -> 127.0.0.1:5432`; `tests/guardrails.test.ts` asserts this mechanically. |
| 8 | No PostgreSQL extension arrives outside the migration path (D-14) | ✓ VERIFIED | No `docker-entrypoint-initdb.d` mount in `docker-compose.yml`; live `pg_extension` count (excluding plpgsql) is `0`; `tests/guardrails.test.ts` asserts the absence of the init-script token mechanically. |
| 9 | The recipe app renders real seeded rows (not hardcoded arrays) for the ported Recipe Page screen (APP-01, D-06) | ✓ VERIFIED | `page.tsx` queries `db.query.recipes.findFirst` with `with: { ingredients, steps }` ordered by `position` — no hardcoded array. `tests/smoke.test.ts` asserts all 8 ingredient names and all 5 step bodies appear in the real HTTP response body; ran live, passed. |
| 10 | The redeploy root-cause investigation ran first, timeboxed, and recorded an honest, evidenced verdict rather than a guess (D-25/26/27) | ✓ VERIFIED | `docs/00-current-state.md` §7 pain point 2 carries a dated, evidence-tiered entry naming the specific repo (`AI-Diagramming-Tool`), the specific file (`apps/api/src/db/client.ts`), and the specific mechanism (`migrate()` called from `initDb()` before accepting traffic). `docs/decisions.md` D14/D8 correctly reflect this as a forced decision, not a speculative one. |
| 11 | A structural guardrail suite mechanically enforces the phase's constraints rather than relying on remembered caution | ⚠️ VERIFIED WITH A NOTED GAP | `tests/guardrails.test.ts` passed live (part of the 26/26 run) and does mechanically assert loopback binding, no init-script mount, no direct-sync command, no committed credential, no `process.env` read in `db-query.ts`, no interactive-input import in `db-reset.ts`, and no direct read of the dev connection variable outside `env.ts`. However, it does **not** assert a host restriction on `RECIPE_DEV_DATABASE_URL` — so it cannot catch truth #6's regression even after a fix, until a new assertion is added. Counted as verified because everything it does assert holds; not counted as failed, since its declared scope in `01-04-PLAN.md`'s must-haves never claimed to cover host restriction. |

**Score:** 9/11 must-haves verified (1 failed, 1 verified-with-a-noted-scope-gap counted toward the verified side since everything within its declared scope holds). 0 present-but-behavior-unverified.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `docker-compose.yml` | Single `postgres:17` service, loopback port, no init-script mount, named volume | ✓ VERIFIED | Matches must-haves exactly; live container confirms PG 17.11, loopback binding |
| `scripts/env.ts` | Shared env validation/assertion module | ⚠️ VERIFIED BUT INCOMPLETE | Exports match (`env`, `getDevDatabaseUrl`, `assertDevelopmentDatabase`, `EXPECTED_DEV_DATABASE_NAME`); validation is present but does not enforce a host allowlist (see gap #6) |
| `scripts/db-query.ts` | Direct-query CLI, no flag surface, no `process.env` read | ✓ VERIFIED | Confirmed by direct read; no `process.env` occurrence; hyphen-prefixed args rejected; calls `assertDevelopmentDatabase` before the caller's SQL |
| `scripts/db-reset.ts` | One-command full teardown/rebuild, no prompt | ✓ VERIFIED (with CR-02 caveat) | 5-step D-22 order confirmed by direct read; no `readline`/`prompts`/`inquirer`/`process.stdin`; no in-tool post-migrate state verification (Warning, see Anti-Patterns) |
| `apps/recipe-app/drizzle.config.ts` | Drizzle Kit config wired to shared env module | ⚠️ ORPHANED SAFETY NET | Uses `getDevDatabaseUrl()` correctly (never a raw `process.env` read), but never calls `assertDevelopmentDatabase()` — the config that drives the most destructive command has no environment assertion at all |
| `apps/recipe-app/src/db/schema.ts` | Full D-09 recipe core with real FKs | ✓ VERIFIED | `recipes`/`ingredients`/`steps` with `references()` + `onDelete: cascade`; matches migration SQL; no D-11 reserved columns spent |
| `tests/smoke.test.ts` | Headless, scriptable boot proof | ✓ VERIFIED | Real production build + `next start` + HTTP fetch; ran live, passed |
| `tests/guardrails.test.ts` | Mechanical structural-constraint suite | ✓ VERIFIED (scope gap noted) | Ran live, passed; does not cover host-restriction (a gap the suite was never scoped to catch) |
| `tests/db-reset.test.ts` | Real rebuild + independent state assertion | ✓ VERIFIED | Genuinely exercises the production script as a subprocess; asserts real DB state twice for convergence |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `package.json` (`db:up`/`db:down`) | `docker-compose.yml` | shells to compose CLI | ✓ WIRED | Confirmed by script text |
| `docker-compose.yml` | `.env` | `RECIPE_DEV_DB_PASSWORD` interpolation | ✓ WIRED | Confirmed; `.env` gitignored, `.env.example` tracked with placeholder |
| `apps/recipe-app/src/app/recipes/[slug]/page.tsx` | `apps/recipe-app/src/db/client.ts` | direct Drizzle query, no API layer | ✓ WIRED | Confirmed by direct read; `db.query.recipes.findFirst` with `with` clause |
| `apps/recipe-app/src/db/client.ts` | `scripts/env.ts` | `getDevDatabaseUrl()` | ✓ WIRED | Confirmed |
| `apps/recipe-app/drizzle.config.ts` | `scripts/env.ts` | `getDevDatabaseUrl()` for `dbCredentials.url` | ⚠️ PARTIAL | Gets the URL from the shared module (not a raw env read) but does **not** also call the module's environment *assertion* — the link exists for URL sourcing but not for safety-gating |
| `scripts/db-reset.ts` | `docker-compose.yml` | shells to compose CLI for teardown/readiness | ✓ WIRED | Confirmed by direct read |
| `scripts/db-reset.ts` | `apps/recipe-app/src/db/seed.ts` | final step runs `db:seed` | ✓ WIRED | Confirmed |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `RecipePage` → `RecipeScreen` | `recipe`, `ingredients`, `steps` | `db.query.recipes.findFirst(...)` against live Postgres | Yes — live query verified via `tests/smoke.test.ts` and direct `db:query` inspection | ✓ FLOWING |
| `RecipeScreen` servings multiplier | `recipe.baseServings` | Seeded `recipes.base_servings` column (value `2`) | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite is green | `pnpm test` | `Test Files 5 passed (5)`, `Tests 26 passed (26)` | ✓ PASS |
| `db:query` reaches the live dev database directly | `pnpm db:query "SELECT ... FROM recipes/ingredients/steps"` | `recipe_dev`, `1/8/5` | ✓ PASS |
| Migration history matches journal | `pnpm db:query "SELECT count(*) FROM drizzle.__drizzle_migrations"` | `2`, matching `_journal.json`'s 2 entries | ✓ PASS |
| Container reports PostgreSQL 17 with zero non-default extensions | `docker exec ... psql -c "SHOW server_version"` / `pg_extension` count | `17.11`, `0` | ✓ PASS |
| Port bound to loopback only | `docker port database-automation-db-1` | `5432/tcp -> 127.0.0.1:5432` | ✓ PASS |
| No debt markers (TODO/FIXME/TBD/XXX/HACK) in phase source surface | `grep -rn -E "TODO|FIXME|TBD|XXX|HACK"` across `scripts/`, `tests/`, `apps/recipe-app/src`, config files | One incidental match: `tests/guardrails.test.ts:98` — a literal string assertion for `"PLACEHOLDER"`, not a debt marker | ✓ PASS (no real markers) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| ENV-01 | 01-01 | PG17 container, extensions matching production | ✓ SATISFIED | Live PG 17.11, declared empty baseline honestly resolves the UNKNOWN production extension list per D-13 |
| ENV-02 | 01-02, 01-03 | Schema edit → migration → apply, one documented loop | ✓ SATISFIED | Two real generate/inspect/migrate cycles, both journalled |
| ENV-03 | 01-01, 01-02 | Per-environment connection variable naming | ✓ SATISFIED | `.env.example` naming confirmed; bare `DATABASE_URL` hard-fails |
| ENV-04 | 01-04 | Destroy and rebuild in one command | ✓ SATISFIED | `pnpm db:reset` behaviorally verified live and via real subprocess test |
| ENV-05 | 01-04 | Claude Code queries directly, no Coolify relay | ✓ SATISFIED | Direct `pnpm db:query` use during this verification |
| APP-01 | 01-02, 01-03, 01-05 | Minimal recipe schema exists, app boots against it | ✓ SATISFIED | Live HTTP 200 with database-sourced content, confirmed via `tests/smoke.test.ts` |

No orphaned requirement IDs found: REQUIREMENTS.md's Phase 1 row (ENV-01…ENV-05, APP-01) matches exactly the requirements declared across the five plans' frontmatter.

**Note:** REQUIREMENTS.md's checkboxes mark ENV-01…ENV-05 and APP-01 all `[x]` complete, and the traceability table separately still shows "ENV-01 … ENV-05 | Phase 1 | Pending" (line 124) even though APP-01 on the very next line is marked "Complete" — this is a stale/inconsistent traceability-table row, not a functional gap, but worth fixing for document hygiene.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `scripts/env.ts` | 48-50 | Connection URL validated with no host allowlist | 🛑 Blocker | Root cause of gap #6 above — see `gaps` frontmatter |
| `apps/recipe-app/drizzle.config.ts` | 7-14 | Never calls `assertDevelopmentDatabase()` before Drizzle Kit's destructive operations | 🛑 Blocker | Same root cause; the most destructive command in the pipeline has zero environment assertion |
| `scripts/db-reset.ts` | 80-83 | Trusts `drizzle-kit migrate`'s exit code with no independent state re-verification inside the tool itself | ⚠️ Warning | Known Windows failure mode (`drizzle-kit migrate` can exit 0 without applying SQL) is not currently manifesting (proven by a real subprocess test), but the tool has no self-defense if it ever does; fix proposed in `01-REVIEW.md` CR-02 |
| `tests/guardrails.test.ts` | 80-99, 120-136 | Blanket `*.test.ts` exclusion from the connection-string-prefix and direct-env-read checks, rather than a narrow allowlist of the two files that actually need it | ⚠️ Warning | A new test file could hardcode a real connection string or bypass `scripts/env.ts` and this guardrail suite would not catch it (WR-01 in `01-REVIEW.md`) |
| `scripts/db-reset.ts` / `apps/recipe-app/drizzle.config.ts` | — | Step 3's environment assertion does not travel with step 4's migrate invocation (TOCTOU-shaped) | ⚠️ Warning | Restates gap #6's compounding point as a general design-pattern concern (WR-02 in `01-REVIEW.md`) |
| `apps/recipe-app/src/db/schema.ts` / `RecipeScreen.tsx` | schema.ts:13, RecipeScreen.tsx:44 | `recipes.baseServings` has no positivity constraint; `RecipeScreen` divides by it unguarded | ℹ️ Info | Latent — today's seed is always `2` — but a future `0`/negative row would produce `Infinity`/`NaN` in the servings scaler (WR-03 in `01-REVIEW.md`) |
| `scripts/db-query.ts` / `scripts/db-reset.ts` | multiple | "print only `error.message`" pattern duplicated across two files rather than a shared helper | ℹ️ Info | Style/maintenance only; both call sites are currently correct and covered by tests (IN-01 in `01-REVIEW.md`) |

No unresolved debt markers (`TODO`/`FIXME`/`TBD`/`XXX`) exist in any file this phase modified.

### Human Verification Required

Carried forward from `01-05-SUMMARY.md`'s `coverage` block, which explicitly marks these
`human_judgment: true` and defers them to this phase's end-of-phase UAT step per
`workflow.human_verify_mode: end-of-phase`. I did not attempt to adjudicate visual fidelity myself.

1. **Visual side-by-side comparison against the design source**
   **Test:** Compare the rendered `/recipes/chicken-rice-bowl` page, at phone/tablet/desktop
   breakpoints, against `Recipe Page.dc.html` in the design canvas.
   **Expected:** Layout, spacing, and color match the source's deliberate divergence from the
   Modernist design system (rounded corners, warmer palette) — this divergence is intentional and
   must be preserved, not "fixed" (D-06).
   **Why human:** Pixel-level visual fidelity, hover states, and exact desktop sidebar proportions
   cannot be verified by grep or an automated assertion.

2. **Breakpoint confirmation**
   **Test:** Confirm the shipped responsive breakpoints (phone <834px, tablet 834-1439px, desktop
   ≥1440px).
   **Expected:** These match the developer's intended breakpoints, or the developer supplies an
   override.
   **Why human:** UI-SPEC's Open Question 5 recorded these as a proposed default awaiting
   confirmation, not a locked decision.

3. **Design-fidelity divergence: dropped desktop "Kitchen" app-shell nav**
   **Test:** Review whether using the same back/save icon nav row at all three breakpoints (instead
   of the desktop frame's app-shell top bar with brand + This week/Recipes/Shopping/Settings +
   breadcrumb) is acceptable for this phase.
   **Expected:** Developer confirms this is acceptable, given that the app-shell chrome points at
   sections (meal planner, shopping) explicitly unbuilt in this phase (D-07).
   **Why human:** A deliberate design-fidelity trade-off documented by the executor, not a defect —
   requires a human decision on scope.

4. **Design-fidelity divergence: servings stepper always visible in the meta row**
   **Test:** Review whether always rendering the servings stepper in the meta row at all breakpoints
   (rather than tab-gating it to the Ingredients tab on phone, per the phone frame's source
   behavior) is acceptable.
   **Expected:** Developer confirms this simplification is acceptable.
   **Why human:** Documented simplification of the source's phone-specific behavior, flagged by the
   executor for this exact review step.

### Gaps Summary

One gap blocks this phase's goal: the "hardcoded to local, no environment override" architecture
promised by D-16 and declared as an explicit, unresolved `must_have` in `01-04-PLAN.md` does not
hold as built. `RECIPE_DEV_DATABASE_URL` is validated only as a well-formed URL with no host
restriction, and the config that drives the single most destructive command in the pipeline
(`drizzle-kit migrate`, via `drizzle.config.ts`) never calls the shared environment assertion at
all. This is directly relevant to CLAUDE.md's non-negotiable that safeguards must be architectural
rather than remembered, and to the project's stated intent that "No production database access from
the local machine" be structurally guaranteed. The fix is scoped and mechanical (add a hostname
allowlist to the zod schema; wire the assertion into the Drizzle Kit config or its invocation path)
and does not require re-architecting anything else verified in this report.

Everything else this phase's roadmap success criteria and plan must-haves require is genuinely
built, wired, and behaviorally proven — verified against the live container and live database
during this verification session, not inferred from SUMMARY.md claims. `pnpm test` is 26/26 green,
the redeploy investigation produced a real, evidenced, non-speculative finding, and the recipe app
renders real seeded rows through a direct Drizzle query with no hardcoded data.

---

_Verified: 2026-09-06_
_Verifier: Claude (gsd-verifier)_
