# Phase 1: Local Environment - Research

**Researched:** 2026-09-06
**Domain:** Local PostgreSQL 17 dev environment (Docker Compose, Windows), Drizzle ORM 0.45/Drizzle Kit 0.31 migration loop, Next.js App Router recipe fixture, direct-DB-access tooling for Claude Code
**Confidence:** MEDIUM-HIGH — core mechanics (Docker Compose healthchecks, Drizzle CLI surface, node-postgres, Next.js App Router) are well-documented and cross-checked; several claims tied to *this* project's specific infrastructure (Coolify's actual extension list, the redeploy root cause) are correctly UNKNOWN per CONTEXT.md and stay UNKNOWN here.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

D-01 through D-27 in `01-CONTEXT.md` are binding on this phase. The subset most load-bearing for implementation (full text in `01-CONTEXT.md`):

- **D-01/D-02:** pnpm workspace, `apps/` + `packages/`. `packages/automation/` is NOT created in Phase 1 (Phase 3 concern).
- **D-03:** Root `package.json` scripts: `db:reset`, `db:query`, `db:migrate`. `db:reset`/`db:query` must never be promoted into the shared automation package.
- **D-04:** Recipe app runs on the host via `pnpm dev`. `docker-compose.yml` defines exactly one thing: the dev Postgres container. No app container in Phase 1.
- **D-05:** Next.js (App Router). Server Components query Drizzle directly — no separate API layer.
- **D-06/D-07:** Only `Recipe Page` is ported and wired to real DB rows. `Kitchen Home`/`Meal Planner`/`Recipe Builder` stay as unported design files. Recipe Page's intentional Modernist departure (rounded corners, warmer palette) must be preserved, not "fixed."
- **D-08:** "App boots against the resulting schema" is proven by an automated, scriptable, headless smoke test — reused verbatim by Phase 4 RUN-07 and Phase 5 CI.
- **D-09/D-10/D-11:** Schema is `recipes` + `ingredients` + `steps` only, with real FKs and an ordering column on steps. Tags/usage counters/meal-plan/shopping are reserved churn material — Phase 1 must not spend them (see D-11's reserved-change table).
- **D-12:** Image is `postgres:17` (Debian/glibc), NOT `postgres:17-alpine` — collation parity.
- **D-13:** Phase 1 installs no extensions — declared, pinned empty baseline (not a claim about production, which stays UNKNOWN).
- **D-14:** Any future extension is added via a Drizzle migration (`CREATE EXTENSION`), never a `docker-entrypoint-initdb.d` init script.
- **D-15/D-16/D-17:** ENV-05 access is a `pnpm db:query` script on `node-postgres`, hardcoded to local only (no flag/arg can redirect it — a future parameterization is a safety-relevant change), connecting as the same dev role as the app.
- **D-18:** Postgres port publishes to `127.0.0.1` only, never `0.0.0.0`.
- **D-19/D-20:** Connection vars are `RECIPE_DEV_DATABASE_URL` (with `RECIPE_STAGING_DATABASE_URL`/`RECIPE_PROD_DATABASE_URL` reserved for later). A bare `DATABASE_URL` present anywhere causes a hard failure, never a warning.
- **D-21:** Connections assert the environment they reached via a marker that cannot be silently carried across environments by a restore. Marker shape is Claude's discretion (see Pattern 3 in this document for the recommended shape).
- **D-22/D-24:** `db:reset` = full teardown (`down -v` → `up` → wait-healthy → `drizzle-kit migrate` → seed), no prompt.
- **D-23:** Seed data is deterministic, committed, derived from the imported design's own recipe content.
- **D-25/D-26/D-27:** The redeploy root-cause investigation runs first, strictly timeboxed, "still UNKNOWN" is an acceptable outcome; findings land in `docs/00-current-state.md` §7.

### Claude's Discretion

- Exact shape of the D-21 environment marker (database-name convention vs. `_environment` table vs. Postgres setting) — constrained only by restore-safety. This research recommends `current_database()` (Pattern 3).
- TypeScript configuration, build tooling, lint setup, and the specific Next.js scaffold within the D-05 choice.
- Healthcheck strategy and readiness polling for the compose service.
- Exact column types/naming within the D-09 recipe core, provided the ported screen's fields are representable and D-10/D-11's reserved material is not spent.
- How the ported screen's `<sc-if>`/`<sc-for>`/`{{ }}`/`DCLogic` binding model maps onto React components.
- Which of D-11's two candidate SAFE reserved changes is actually reserved (alternatives, not both required).

### Deferred Ideas (OUT OF SCOPE)

- Porting `Kitchen Home`, `Meal Planner`, `Recipe Builder` (D-07).
- Tags, usage counters, meal-plan days, meal slots, shopping items (D-10/D-11) — reserved for Phases 4 and 7.
- `packages/automation/` and its CLI (Phase 3, D-02).
- Credential separation between app runtime and migration execution (CONN-05, Phase 6; Phase 1 uses one dev role, D-17).
- The superuser-vs-migration-credential tension for `CREATE EXTENSION` (D-14; resolved in Phase 6).
- A container-based app boot path (rejected for Phase 1, D-04).
- Backup, restore, and restore-drill work (Phase 2 in full; Phase 1 only makes the choices D-22/D-23 that Phase 2 depends on).
- No remote connectivity of any kind (D-2/D2); no safety analyzer (Phase 3); no migration runner with re-derived classification (Phase 4); no CI (Phase 5).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|---------------------|
| ENV-01 | Development PostgreSQL runs as a local Docker container pinned to PostgreSQL 17, including any extensions production will use | Pattern 1 (Compose service definition, `postgres:17` bookworm/glibc image, `pg_isready` healthcheck, loopback-only port). Extensions: D-13's empty baseline is the honest answer since production's list is UNKNOWN (Open Question 3) — `gen_random_uuid()` needs no extension on PG13+ (State of the Art table). |
| ENV-02 | A Drizzle schema edit can be turned into a generated migration, inspected, and applied locally in one documented loop | Pattern 2 (`generate` → inspect → `migrate`, with the exact CLI invocations and `drizzle.config.ts` shape). Anti-Patterns section explicitly excludes `push` from this loop. |
| ENV-03 | Connection variables are named per environment, so no single generic variable can silently point at the wrong database | Pattern 4 (shared zod env module, hard-fail on bare `DATABASE_URL`) + Pattern 3 (`current_database()` restore-safe marker) — the two together are the concrete implementation of D-19/D-20/D-21. |
| ENV-04 | The development database can be destroyed and rebuilt from scratch with one command | Recommended Project Structure (`scripts/db-reset.ts` / script chain) + Pattern 1 (`docker compose up -d --wait` for the readiness step inside the rebuild) + Don't Hand-Roll table (why not a hand-rolled poll). |
| ENV-05 | Claude Code can query and inspect the development database directly, with no manual relaying of commands through a Coolify terminal | Pattern 5 (`pg.Client`-based `db:query` script) + Security Domain (why raw-SQL passthrough is an accepted, scoped risk here) + Environment Availability table (this design deliberately routes around the confirmed-absent `psql`). |
| APP-01 | A minimal recipe schema exists and the application boots against it | Pattern 6 (Next.js Server Component + Drizzle wiring) + Pitfall 1 (Next.js 16 awaited `params`, directly relevant to the `/recipes/[id]` route this requirement needs) + Validation Architecture's APP-01 row (the D-08 automated smoke test shape). |
</phase_requirements>

## Summary

Phase 1 has no existing code to extend — it creates the entire runnable surface (pnpm workspace, Docker Compose Postgres, Drizzle schema/migrations, a thin Next.js recipe app, and the `db:query`/`db:reset`/`db:migrate` scripts). Every implementation choice of substance was already locked in `01-CONTEXT.md` (D-01 through D-27); this research is about **how to execute those decisions correctly**, not about picking among alternatives. The two structurally important findings are: (1) an environment marker for D-21 must be based on something a `pg_dump`/`pg_restore` cycle does **not** carry with it — the actual connected database name (`current_database()`), not a row inside a table, or D-21's own stated constraint ("a restore cannot silently carry a stale marker into the wrong environment") is violated by the marker mechanism itself; and (2) Next.js 16 (current latest) removes the Next.js 15 synchronous-params compatibility shim entirely, so the ported `Recipe Page` route's dynamic segment (`params`) **must** be awaited — this is a first-run breakage, not an edge case, for exactly the route D-06 requires.

Drizzle's three CLI commands map cleanly onto Phase 1's lifecycle: `generate` (schema → SQL, no DB touch) is what ENV-02's "documented loop" produces, `migrate` (apply committed SQL, tracked in `_journal.json`) is what `db:reset`/`db:migrate` run, and `push` (direct sync, no SQL artifact) must never appear in any script this phase writes — D-11/PITFALLS.md agree it is a drift and data-loss vector the moment it touches anything beyond a true scratch database, and Phase 1's own dev container already gets everything it needs from `generate`+`migrate`.

**Primary recommendation:** Use `postgres:17` (Debian bookworm/glibc, confirmed the image's actual base — not Alpine) with a `pg_isready` healthcheck and `docker compose up -d --wait` (a Compose CLI flag, not a hand-rolled polling script) for readiness; build `db:query` as a single `pg.Client` (not `Pool`) CLI script gated by a shared env-validation module that hard-fails on a bare `DATABASE_URL` and asserts `current_database()` before running anything; and treat the Next.js recipe route, the seed script, and the Drizzle schema as the only net-new application code this phase needs beyond that.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| PostgreSQL 17 container, volume, healthcheck | Database / Storage | — | Docker Compose owns the container lifecycle; nothing in this phase runs a service "in front of" it (D-04: no app container). |
| Drizzle schema (`recipes`/`ingredients`/`steps`) + generated migrations | Database / Storage | — | Schema-as-code is the source of truth for the database tier; migrations are build artifacts of that schema, not application logic. |
| Recipe Page data fetch (`recipes` + `ingredients` + `steps` query) | Frontend Server (SSR) | — | D-05 locks Server Components querying Drizzle directly — no separate API/backend tier exists in this phase, so SSR *is* the backend for this capability. |
| Recipe Page interactivity (tab switch, servings stepper, favorite, "mark as cooked") | Browser / Client | — | All four are ephemeral client-only React state per the UI-SPEC's resolved Open Questions — no network round-trip, so nothing but the client tier is involved. |
| `db:query` (Claude Code's direct DB access) | Database / Storage | — | It is a direct Postgres client, structurally identical in trust level to `psql` — not part of the app's request path, so it does not belong to any app tier. Closest analog if forced into the standard five tiers is "Database/Storage," reached from the developer's machine rather than from another tier. |
| `db:reset` orchestration (down -v → up --wait → migrate → seed) | Database / Storage | — | Infrastructure lifecycle management; touches Docker and the DB, never the app process (D-04 keeps the app on the host, unmanaged by this command). |
| Environment-variable validation (`RECIPE_DEV_DATABASE_URL` presence, bare `DATABASE_URL` rejection) | Cross-cutting | Database / Storage, Frontend Server | Must run identically in the Next.js app's entry, `drizzle.config.ts`, and every CLI script — a single shared module, not tier-specific code, per D-19/D-20. |
| Environment marker assertion (D-21) | Database / Storage | Cross-cutting | The assertion itself is a query against `current_database()` (Database/Storage), but every consumer (app boot, `db:query`, future Phase 4 runner) calls it identically. |

## Standard Stack

### Core (already pinned — see `docs/decisions.md` D9/D11, `.planning/research/STACK.md`)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `drizzle-orm` | 0.45.2 | ORM + query layer | `[VERIFIED: npm registry]` — `npm view drizzle-orm version` returns `0.45.2` (2026-09-06), matching the pinned version already accepted in `docs/decisions.md` D11. Project constraint: not Prisma. |
| `drizzle-kit` | 0.31.10 | Schema diff, migration generation, journal | `[VERIFIED: npm registry]` — `npm view drizzle-kit version` returns `0.31.10`, matching D11. Do not use the v1.0.0-rc line (removes `_journal.json`, the audit mechanism this project depends on). |
| `pg` (node-postgres) | 8.23.0 (latest 8.x) | Postgres driver for `drizzle-orm/node-postgres` and the `db:query`/seed scripts | `[VERIFIED: npm registry]` — `npm view pg version` returns `8.23.0`. Standard driver Drizzle's own docs default to for self-hosted Postgres. |

### App / tooling additions this phase introduces

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| `next` | 16.3.4 (latest) | Recipe app framework (App Router, Server Components) | `[VERIFIED: npm registry]`. D-05 locks Next.js App Router. **See Pitfall "Next.js 16 removes the sync-params shim" below — this is the current latest major and changes route-param handling from what most existing Drizzle+Next.js tutorials show.** |
| `zod` | 4.5.4 (latest) | Runtime validation schema for `process.env` (D-19/D-20's hard-fail requirement) | `[VERIFIED: npm registry]`. `[CITED: dev.to/whoffagents type-safe-environment-variables-in-nodejs-with-zod]` — fail-fast env pattern: parse `process.env` against a schema at the top of the entry module, before any other import runs, and exit(1) on failure. |
| `tsx` | latest (86.3M weekly downloads) | Run TypeScript CLI scripts (`db:query`, seed) directly, no build step | `[VERIFIED: npm registry]`. Needed because `db:query`/seed are TypeScript but must run as one-off scripts, not through Next.js's bundler. |
| `dotenv` | 17.4.2 (latest) | Load `.env`/`.env.local` into `process.env` for CLI scripts and `drizzle.config.ts` (Next.js loads its own `.env*` automatically; standalone scripts do not) | `[VERIFIED: npm registry]`. |
| `vitest` | per `.planning/research/STACK.md` (5.0.0) | Test runner for the D-08 automated smoke test | Reuses the same runner already pinned for the automation package (Phase 3+), so Phase 1 does not introduce a second test framework the project later has to reconcile. |
| `execa` | per STACK.md (latest 9.x) | Spawn `next build`/`next start` (or the compose CLI) as a child process from the smoke test / `db:reset` | Nicer error handling and cross-platform quoting than raw `child_process`, which matters specifically because this project develops on Windows. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `pg.Client` for `db:query`/seed scripts | `pg.Pool` | `[CITED: node-postgres.com/features/pooling]` — a `Pool` is for long-lived processes reusing connections across many requests; a one-shot CLI script gets nothing from the pool overhead and must remember to call `pool.end()` anyway. Use `Client` here; keep `Pool` for the Next.js app's long-lived db module if a future phase needs concurrent query fan-out (not needed for one Server Component query in Phase 1). |
| `docker compose up -d --wait` for readiness | Hand-rolled polling loop (`pg_isready` in a retry loop from a Node/PowerShell script) | `[CITED: lours.me/posts/compose-tip-051-up-wait]` — `--wait` is a Compose CLI flag (added a few years ago, well within reach of the installed Docker 29.6.1) that blocks until every healthchecked service reports healthy and exits non-zero on failure; equivalent to a hand-rolled loop but with zero extra code and identical behavior on Windows/macOS/Linux. Only reach for a custom script if a non-Compose orchestration mechanism is ever needed. |
| `zod` for env validation | `@t3-oss/env-nextjs` | The T3 env package is Next.js-specific and wraps zod; since Phase 1 needs the *same* validation logic to also run inside plain CLI scripts (`db:query`, seed) that are not Next.js processes, a plain shared zod schema module (imported by all four call sites) is simpler than pulling in a Next-only wrapper for one of the four. |
| `next start` for the smoke test target | `next dev` | `next dev`'s dev-mode compiler/HMR overhead and non-production error pages make it a worse proxy for "the app boots against the resulting schema" than a real production build; `next build && next start` is slower to run once but is what the D-08 smoke test should actually exercise, since Phase 4/5 reuse it. |

**Installation:**
```bash
# app workspace
pnpm add drizzle-orm@0.45.2 pg next zod dotenv
pnpm add -D drizzle-kit@0.31.10 tsx typescript @types/pg

# test tooling (shared with the eventual automation package per STACK.md)
pnpm add -D vitest execa
```

**Version verification:** all versions above were confirmed via `npm view <pkg> version` on 2026-09-06 (same day as this research), matching the dates already recorded in `.planning/research/STACK.md` for `drizzle-orm`/`drizzle-kit`.

## Package Legitimacy Audit

Ran `gsd_run query package-legitimacy check --ecosystem npm` against every package this phase newly introduces (drizzle-orm/drizzle-kit/pg were already checked in `.planning/research/STACK.md`, re-verified here for completeness).

| Package | Registry | Published (latest) | Weekly Downloads | Source Repo | Verdict | Disposition |
|---------|----------|---------------------|-------------------|--------------|---------|-------------|
| `drizzle-orm` | npm | 2026-03-27 | 20.3M | github.com/drizzle-team/drizzle-orm | OK | Approved |
| `drizzle-kit` | npm | 2026-03-17 | 16.8M | github.com/drizzle-team/drizzle-orm | OK | Approved |
| `dotenv` | npm | 2026-04-12 | 178.1M | github.com/motdotla/dotenv | OK | Approved |
| `typescript` | npm | 2026-07-08 | 273.4M | github.com/microsoft/TypeScript | OK | Approved |
| `wait-on` | npm | 2026-07-21 | 10.8M | github.com/jeffbski/wait-on | OK | Approved (not required if `docker compose up --wait` is used; keep only if a future non-Compose wait is needed) |
| `next` | npm | 2026-08-31 | 55.3M | github.com/vercel/next.js | **SUS** | Flagged — reason is `too-new` (latest *version* published within the gate's freshness window), not identity risk. 55M weekly downloads and a long-established official repo make slopsquatting implausible; the flag exists because Next.js 16 itself is a very recent major. Planner should add a `checkpoint:human-verify` before pinning the exact minor/patch, mainly to confirm the version chosen has had time to shake out post-GA bugs (see Next.js 16 pitfall below), not because the package itself is suspect. |
| `zod` | npm | 2026-08-29 | 274.7M | github.com/colinhacks/zod | **SUS** | Same `too-new` reason, same read: 274M weekly downloads is one of the highest on the entire registry. Flag is about the latest patch's publish date, not the package. `checkpoint:human-verify` before pinning is still appropriate procedurally. |
| `pg` | npm | 2026-08-08 | 49.7M | github.com/brianc/node-postgres | **SUS** | Same `too-new` reason; `pg` is the de facto standard Postgres driver referenced throughout this project's own `STACK.md`. Procedural flag only. |
| `tsx` | npm | 2026-08-30 | 86.3M | github.com/privatenumber/tsx | **SUS** | Same `too-new` reason; widely used TS-execution tool. Procedural flag only. |

**Packages removed due to `[SLOP]` verdict:** none.
**Packages flagged as suspicious `[SUS]`:** `next`, `zod`, `pg`, `tsx` — all four flagged solely because their most recent published version is inside the tool's "too new" freshness window, not because of any identity, download-count, or missing-repo signal (all four have tens-to-hundreds of millions of weekly downloads and long-lived official GitHub repos). The planner should still insert a `checkpoint:human-verify` before the install step per protocol, but the substance of that check is "confirm this is still the version you want," not "confirm this package is real."

## Architecture Patterns

### System Architecture Diagram

```
 Developer / Claude Code (Windows host)
   │
   │  edits                          │ pnpm db:query "SELECT ..."
   ▼                                 ▼
 apps/recipe-app/src/db/schema.ts    scripts/db-query.ts (tsx, pg.Client)
   │                                    │  reads RECIPE_DEV_DATABASE_URL
   │ drizzle-kit generate               │  asserts current_database() == dev marker
   ▼                                    │
 drizzle/ (SQL + _journal.json)         │
   │ drizzle-kit migrate                │
   ▼                                    ▼
 ┌─────────────────────────────────────────────────────┐
 │  Docker container: postgres:17 (bookworm/glibc)      │
 │  127.0.0.1:5432 → 5432, named volume, pg_isready HC  │
 └─────────────────────────────────────────────────────┘
   ▲
   │ drizzle(pool, {schema}) — Server Component query
   │
 pnpm dev → Next.js (App Router, on host, NOT containerized)
   │  GET /recipes/[id]  (params now a Promise — must await)
   ▼
 Browser: Recipe Page (tabs / servings stepper / favorite / cooked —
          all client-only ephemeral state, no round-trip)

 db:reset = docker compose down -v → up -d --wait → drizzle-kit migrate → seed.ts
            (full rebuild; never a psql DROP/CREATE shortcut, per D-22)
```

### Recommended Project Structure

```
database-automation/
├── docker-compose.yml              # exactly one service: postgres:17 dev DB (D-04)
├── package.json                    # root workspace scripts: db:reset, db:query, db:migrate (D-03)
├── pnpm-workspace.yaml             # packages: ["apps/*", "packages/*"] — packages/ empty until Phase 3 (D-02)
├── scripts/
│   ├── env.ts                      # shared zod schema + hard-fail-on-bare-DATABASE_URL + current_database() assertion (D-19/D-20/D-21)
│   ├── db-query.ts                 # ENV-05: pg.Client, hardcoded to RECIPE_DEV_DATABASE_URL only (D-15/D-16)
│   └── db-reset.ts                 # orchestrates docker compose + migrate + seed (D-22/D-24), or a thin pnpm script chain
├── apps/
│   └── recipe-app/
│       ├── drizzle.config.ts       # reads RECIPE_DEV_DATABASE_URL via scripts/env.ts
│       ├── drizzle/                # generated SQL + meta/_journal.json — committed, never hand-edited
│       ├── src/
│       │   ├── db/
│       │   │   ├── schema.ts       # recipes, ingredients, steps (D-09)
│       │   │   ├── client.ts       # drizzle(pool, {schema}) singleton for Server Components
│       │   │   └── seed.ts         # D-23 deterministic seed from design content
│       │   └── app/
│       │       └── recipes/[id]/
│       │           ├── page.tsx    # Server Component: await params, query, render ported screen
│       │           └── error.tsx / not-found handling per UI-SPEC's resolved Open Question 1
│       └── design/                 # existing Claude Design import — read-only source for the port
└── docs/ .planning/                # existing
```

### Pattern 1: Postgres readiness in Docker Compose

**What:** `healthcheck` + `depends_on: condition: service_healthy` (not applicable here since there is no second container to gate — D-04 keeps the app on the host) plus `docker compose up -d --wait` for the `db:reset`/first-run case.
**When to use:** Any time a script needs to know "Postgres is actually accepting connections," not just "the container process started."
**Example:**
```yaml
# Source: pattern cross-checked across Docker Compose docs and community examples
# [CITED: last9.io/blog/docker-compose-health-checks, lours.me/posts/compose-tip-003-depends-on-healthcheck]
services:
  db:
    image: postgres:17
    environment:
      POSTGRES_USER: recipe_app
      POSTGRES_PASSWORD: ${RECIPE_DEV_DB_PASSWORD}
      POSTGRES_DB: recipe_dev
    ports:
      - "127.0.0.1:5432:5432"   # D-18: loopback only, never 0.0.0.0
    volumes:
      - recipe_dev_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U recipe_app -d recipe_dev"]
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 10s
volumes:
  recipe_dev_pgdata:
```
```bash
# Source: [CITED: lours.me/posts/compose-tip-051-up-wait]
docker compose up -d --wait   # blocks until healthy, exits non-zero on failure — no polling script needed
```

### Pattern 2: The Drizzle schema-edit → migration → apply loop (ENV-02)

**What:** `drizzle-kit generate` (diff schema.ts vs. last snapshot → SQL, no DB touch) → inspect the generated SQL → `drizzle-kit migrate` (apply + record in `meta/_journal.json`).
**When to use:** Every schema change, always in this order. `drizzle-kit push` never appears in any script this phase writes.
**Example:**
```bash
# Source: [CITED: orm.drizzle.team/docs/kit-overview, orm.drizzle.team/docs/drizzle-kit-generate]
pnpm exec drizzle-kit generate --config=apps/recipe-app/drizzle.config.ts
# → inspect the new file under apps/recipe-app/drizzle/
pnpm exec drizzle-kit migrate --config=apps/recipe-app/drizzle.config.ts
```
`drizzle.config.ts`:
```typescript
// Source: [CITED: orm.drizzle.team/docs/get-started-postgresql]
import { defineConfig } from "drizzle-kit";
import { getDevDatabaseUrl } from "../../scripts/env"; // shared validation (D-19/D-20)

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: getDevDatabaseUrl() },
});
```

### Pattern 3: Restore-safe environment marker (D-21) — use `current_database()`, not a data row

**What:** D-21 requires a marker that a restored dump cannot silently carry into the wrong environment. A row inside an `_environment` table is **inside the dump payload** — restoring dev's dump onto a staging-named database would insert a row claiming `"development"` into staging, defeating the check by the exact mechanism D-21 warns about. `current_database()` is a property of the **target connection**, not of the dumped rows — a `pg_dump` of a single database does not include a `CREATE DATABASE` statement, so restoring it into a differently-named database leaves that database's own name (and therefore the assertion) correct regardless of what was dumped.
**When to use:** Every connection this project ever opens (app boot, `db:query`, later the Phase 4 runner).
**Example:**
```typescript
// Source: original reasoning for this phase, applying D-21's own stated constraint literally
async function assertDevelopmentDatabase(client: Client, expectedName: string) {
  const { rows } = await client.query("SELECT current_database() AS name");
  if (rows[0].name !== expectedName) {
    throw new Error(
      `Refusing to proceed: connected to database "${rows[0].name}", expected "${expectedName}". ` +
      `This check exists so a correctly-named connection variable holding the wrong URL is still caught.`
    );
  }
}
```
This directly satisfies D-21's own reversibility test and is Claude's-discretion-compliant (the marker shape was left open; this is the shape that actually survives a restore, which the CONTEXT.md decision names as the binding constraint).

### Pattern 4: Env-prefixed connection variables + hard failure on bare `DATABASE_URL`

**What:** A single shared validation module, imported first by every entry point (Next.js app, `drizzle.config.ts`, `db:query`, `db:reset`, seed).
**Example:**
```typescript
// Source: [CITED: dev.to/whoffagents/type-safe-environment-variables-in-nodejs-with-zod-570i] pattern,
// adapted to this project's D-19/D-20 naming and hard-fail requirements.
import { z } from "zod";

if (process.env.DATABASE_URL) {
  // D-20: a bare DATABASE_URL is Coolify's default injection for linked services —
  // its mere presence is the platform's normal behavior, not a hypothetical, so this
  // must hard-fail, never warn.
  throw new Error(
    "DATABASE_URL is set but must never be used directly in this project. " +
    "Use RECIPE_DEV_DATABASE_URL (or the staging/prod equivalent) instead."
  );
}

const EnvSchema = z.object({
  RECIPE_DEV_DATABASE_URL: z.string().url(),
});

export const env = EnvSchema.parse(process.env); // throws + exits before any other code runs
```

### Pattern 5: `pg.Client` for one-shot CLI scripts (ENV-05)

**What:** `db:query` is invoked once per Bash-tool call, runs one statement, exits. A `Pool` would need an explicit `pool.end()` and buys nothing a single `Client` doesn't already provide for this shape.
**Example:**
```typescript
// Source: [CITED: node-postgres.com/features/pooling] — Client vs Pool guidance
import { Client } from "pg";
import { env } from "./env";
import { assertDevelopmentDatabase } from "./env"; // Pattern 3

const client = new Client({ connectionString: env.RECIPE_DEV_DATABASE_URL });
await client.connect();
await assertDevelopmentDatabase(client, "recipe_dev");
const result = await client.query(process.argv[2]); // D-16: no flag/arg redirects target — only the SQL text is a parameter
console.table(result.rows);
await client.end();
```

### Pattern 6: Next.js Server Component querying Drizzle directly (D-05)

**What:** No API route. The route file imports the `db` singleton and queries it inline.
**Example:**
```typescript
// Source: [CITED: orm.drizzle.team/docs/get-started-postgresql, strapi.io/blog/how-to-use-drizzle-orm-with-postgresql-in-a-nextjs-15-project]
// apps/recipe-app/src/db/client.ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../../../scripts/env";
import * as schema from "./schema";

export const db = drizzle(new Pool({ connectionString: env.RECIPE_DEV_DATABASE_URL }), { schema });
```
```typescript
// apps/recipe-app/src/app/recipes/[id]/page.tsx
// Source: [CITED: nextjs.org/docs/app/guides/upgrading/version-16] — params is a Promise in Next 16
import { notFound } from "next/navigation";
import { db } from "@/db/client";

export default async function RecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; // MUST await — Next 16 removed the Next 15 sync-access shim
  const recipe = await db.query.recipes.findFirst({ where: (r, { eq }) => eq(r.id, id) });
  if (!recipe) notFound();
  // ...render ported screen with recipe + its ingredients/steps
}
```

### Anti-Patterns to Avoid

- **`drizzle-kit push` anywhere near a script this phase writes:** no SQL artifact, no journal entry, can silently drop columns non-interactively. `[CITED: .planning/research/STACK.md, .planning/research/PITFALLS.md Pitfall D3]`. Confine `push` to nothing in this phase — `generate`+`migrate` cover the entire documented loop ENV-02 asks for.
- **An `_environment` marker table as the sole D-21 check:** restore-unsafe by construction (Pattern 3). If a data-visible marker is wanted *in addition* to the `current_database()` check for human-readability, it must never be the check a script trusts to abort.
- **A hand-rolled `pg_isready` polling loop in a Node or PowerShell script:** `docker compose up -d --wait` already does this, cross-platform, with no extra dependency (Alternatives Considered table).
- **Reading `params`/`searchParams` synchronously in the recipe route:** Next.js 16 fully removed the Next 15 warning-shim; this is not a deprecation warning to fix later, it is a runtime error/undefined-value bug in a fresh Next 16 project today.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Waiting for Postgres to accept connections before migrating | A custom retry/poll script (Node setTimeout loop, PowerShell `Start-Sleep` loop) | `docker compose up -d --wait` + a `pg_isready` healthcheck | Already solves exactly this, cross-platform, with clear non-zero exit on failure — a hand-rolled version would need to reinvent backoff, timeout, and failure reporting for no benefit. |
| Environment-variable parsing/validation | Manual `if (!process.env.X) throw` scattered across four entry points | One shared `zod` schema module imported everywhere | D-19/D-20 apply identically to the app, `drizzle.config.ts`, and every CLI script — four hand-written copies of the same check will drift the first time one of them is edited and the others aren't. |
| SQL parameterization / injection safety inside the app's own queries | Hand-built query strings | Drizzle's query builder (`db.query.recipes.findFirst(...)`, `db.select()...`) | Drizzle parameterizes automatically; string-built SQL anywhere in the Server Component route reopens exactly the injection surface an ORM exists to close. (The `db:query` CLI script is a deliberate, documented exception — see Security Domain below — because ENV-05 explicitly requires raw-query capability for a trusted local operator, not because raw SQL is fine in the app.) |

**Key insight:** almost everything genuinely novel in Phase 1 is *composition* of already-correct tools (Compose's own wait flag, Drizzle's own CLI, node-postgres's own Client/Pool split) rather than new logic — the actual custom code this phase needs is small: the shared env/marker module, the seed script, and the ported screen.

## Common Pitfalls

### Pitfall 1: Next.js 16 removes the Next 15 synchronous-params compatibility shim

**What goes wrong:** Code written against most current Drizzle+Next.js tutorials (which mostly predate Next 16, or target Next 15's transitional period) accesses `params.id` directly. In Next 16 this either throws or silently returns `undefined`, because `params` is a Promise and the old warn-but-still-work shim from Next 15 is gone.
**Why it happens:** `[CITED: nextjs.org/docs/app/guides/upgrading/version-16]` — sync access to `cookies()`, `headers()`, `draftMode()`, `params`, and `searchParams` is fully removed in v16, not merely deprecated.
**How to avoid:** Always `const { id } = await params;` in any dynamic route this phase creates. Run `npx next typegen` to get generated Promise types that make a missed `await` a type error rather than a runtime bug.
**Warning signs:** `id` is `undefined` inside the route despite a valid URL; TypeScript complains about awaiting a non-Promise if the codemod/typegen step was skipped and an older tutorial's types were copied verbatim.

### Pitfall 2: An `_environment` table marker defeats itself on restore

**What goes wrong:** Described in Pattern 3 above — a marker stored as data travels with a `pg_dump`/`pg_restore` cycle, so it can end up correctly-shaped but pointing at the wrong environment after a restore, which is the exact failure D-21 was written to prevent.
**Why it happens:** "Add a table that records what this is" is the first idea most people reach for; it's intuitive but ignores that the dump/restore boundary is precisely where the marker needs to be authoritative and a data row is not.
**How to avoid:** Use `current_database()` (Pattern 3) as the check a script trusts to abort. A human-readable `_environment` table can still exist for observability, but must never be the value gating destructive commands.
**Warning signs:** A restore drill (Phase 2) "passes" the environment check on a target that is not actually the environment the marker claims — this is the concrete, testable symptom to check for once Phase 2 exists.

### Pitfall 3: `drizzle-kit push` sneaking into a script "just for speed"

**What goes wrong:** `push` is genuinely faster for iterating locally, which makes it tempting to wire into `db:reset` or a "quick sync" script instead of the documented `generate`+`migrate` loop D-11/ENV-02 require.
**Why it happens:** `[CITED: .planning/research/PITFALLS.md Pitfall D3]` — it is the natural tool for the fast local dev loop the brief describes, so it is reasonable for it to exist in *some* form, but the danger is scope creep into anything this phase's committed scripts do.
**How to avoid:** `db:reset`/`db:migrate` call `drizzle-kit migrate` exclusively; `push` is not referenced by any committed script. If an interactive human wants `push` for scratch experimentation that never gets committed, that is outside this phase's scripted surface entirely.
**Warning signs:** Any `package.json` script or CI-adjacent tooling in this phase that shells out to `drizzle-kit push`.

### Pitfall 4: Ambient/leftover `DATABASE_URL` reaching a "routine" dev command

**What goes wrong:** `[CITED: .planning/research/PITFALLS.md Pitfall D5]` — an env var set earlier in a shell session (or injected by Coolify's default linked-service behavior, per D-20) silently redirects a command an agent believes is scoped to dev.
**Why it happens:** Ambient, implicit configuration is convenient and is how most tooling defaults work; an agent has no built-in instinct to double-check "which database is this" between commands.
**How to avoid:** Already architecturally closed by D-19/D-20 (app-prefixed names + hard failure on bare `DATABASE_URL`) plus Pattern 3's `current_database()` assertion — the combination means neither a wrong variable name nor a correctly-named variable holding a wrong URL can pass silently.
**Warning signs:** Any script in this phase reads `process.env.DATABASE_URL` (even as a fallback) instead of only `RECIPE_DEV_DATABASE_URL`.

### Pitfall 5: Treating a `[SUS]` package-legitimacy flag as a stop rather than a version-freshness check

**What goes wrong:** `next`, `zod`, `pg`, and `tsx` all flagged `[SUS]` in this phase's audit purely because their latest published version is recent — misreading that as "this package might be fake" would waste the checkpoint on the wrong question.
**Why it happens:** The gate's `too-new` heuristic looks at publish recency, which correlates with real slopsquatting risk for obscure packages but produces false-positive-shaped output for extremely high-download, long-established packages whose maintainers ship frequently.
**How to avoid:** At the `checkpoint:human-verify` step, confirm the *version choice* (is this the version you want to pin, given how recently it shipped) rather than re-litigating the package's identity — the download counts and repo provenance in the audit table above already establish identity.
**Warning signs:** N/A for this phase specifically — this is guidance for whoever executes the checkpoint, not a runtime symptom.

## Code Examples

See Architecture Patterns 1–6 above — each is sourced with `[CITED: ...]` inline and is the actual code shape this phase should use, not illustrative pseudocode.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|-------------------|---------------|--------|
| Next.js dynamic route `params` as a plain object | `params` as a `Promise`, `await`ed | Next.js 15 (transitional, with a sync-access warning shim) → Next.js 16 (shim fully removed) | Every dynamic route this phase writes (`/recipes/[id]`) must await `params` from day one; there is no grace period in a project starting on Next 16. |
| pgcrypto extension required for `gen_random_uuid()` | Built into Postgres core | PostgreSQL 13 | `[CITED: pgpedia.info/g/gen_random_uuid-function.html]` — directly supports D-13's stated reason for installing zero extensions in Phase 1: on PG17 there is no need to reach for `pgcrypto` just to generate UUIDs. |
| Hand-rolled `pg_isready` wait scripts in CI/local tooling | `docker compose up --wait` | Compose CLI feature, predates this project | `[CITED: lours.me/posts/compose-tip-051-up-wait]` — removes an entire category of flaky, hand-written readiness polling from `db:reset`. |

**Deprecated/outdated:** Next.js's synchronous `params`/`searchParams`/`cookies()`/`headers()` access — fully removed in v16, not merely discouraged.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Next.js 16.3.4 (current latest) is the right version to pin, rather than deliberately staying on 15.x for tutorial/ecosystem familiarity | Standard Stack, Pitfall 1 | If wrong, the route code shown (awaited `params`) is unnecessary for 15.x (though harmless — 15 already supports awaiting) but the "shim fully removed" pitfall framing would not apply; low risk either way since the awaited form works on both majors. |
| A2 | `pg.Client` (not `Pool`) is sufficient for `db:query`/seed's one-shot usage pattern | Pattern 5 | If Claude Code ends up issuing many queries in rapid succession within one session by re-invoking the script repeatedly, per-invocation connection setup cost is paid every time — acceptable for a disposable dev DB, but worth revisiting only if it becomes a measured friction point. |
| A3 | The recipe app's Drizzle config and app code live under `apps/recipe-app/` with root-level scripts passing `--config` flags, rather than the app owning its own `db:*` scripts that root scripts merely proxy | Recommended Project Structure | D-03 only fixes that the scripts are root-level; exact wiring (direct `--config` flag vs. `pnpm --filter`) is an implementation detail the planner can choose either way without contradicting any locked decision. |
| A4 | `docker compose up -d --wait` is supported by the Docker Compose version bundled with the confirmed-installed Docker 29.6.1 | Pattern 1, Don't Hand-Roll | If the bundled Compose version predates the `--wait` flag (unlikely given how recent Docker 29.6.1 is, but not directly checked against a Compose version number), the fallback is a trivial hand-rolled `pg_isready` loop — low-severity, easily detected the first time `db:reset` is run. |

## Open Questions (RESOLVED)

All three questions below are closed as of phase planning. Each carries an explicit **Status** line:
`RESOLVED` means an artifact now answers it and the line points at that artifact; `DEFERRED` means it
is deliberately left open, with the decision that authorised leaving it open. Per this project's
`CLAUDE.md`, a deferred question stays marked UNKNOWN — it is not closed by guessing an answer.

1. **Redeploy root-cause investigation (D-25/D-26) needs the existing SaaS repos' actual locations.** — **DEFERRED (D-25)**
   - What we know: the investigation's most decisive evidence source is reading those repos' Dockerfile/entrypoint/start command directly (D-26 #1), and this research session has no access to any SaaS repo other than this one and the Unreal/WarAge game-dev directories listed as additional working directories — neither of which is the "existing SaaS applications" referenced in `docs/00-current-state.md` §5.
   - What's unclear: where those repos live (this machine, another machine, GitHub only) is not recorded anywhere in `.planning/` or `docs/`.
   - Recommendation: the first task of Phase 1 execution (per D-25, timeboxed) should start by asking the owner for the repo path(s)/URLs, then grep their Dockerfile/entrypoint/`package.json` `start`/`postinstall` scripts for migration-related commands (`drizzle-kit migrate`, `prisma migrate deploy`, raw `psql`/`knex migrate` invocations) as the concrete first check — a "still UNKNOWN" outcome (D-25's explicitly acceptable result) is correct if the repos are unavailable within the timebox.
   - **Status: DEFERRED (D-25) — deliberately not answerable at research time.** The question is
     carried into execution rather than left dangling: plan `01-01-PLAN.md` Task 1 ("Timeboxed
     redeploy root-cause investigation, written back to current-state section 7") runs the D-26
     evidence ladder under a hard timebox and writes a dated entry naming the tier reached. Per D-25,
     "still UNKNOWN" is an accepted outcome of that task, and in that case the answer stays marked
     UNKNOWN in `docs/00-current-state.md` §7 rather than being guessed. Nothing in Phase 1 blocks on
     the answer.

2. **Exact seed content and base-servings value (UI-SPEC Open Questions 3–4) are unresolved planner decisions, not research gaps.** — **RESOLVED**
   - What we know: D-23 requires seed content derived from the design's own recipe data; the design hardcodes `mult = servings / 2` (base servings = 2) and a subtitle referencing the not-yet-built meal planner.
   - What's unclear: whether `recipes` gets a `subtitle` and a `base_servings` (or equivalent) column, and their exact seed values — the UI-SPEC already flags these as planner discretion within D-09's column-naming freedom.
   - Recommendation: resolve during planning, not research — no external unknown blocks this, it is a schema-shape decision already scoped to the planner by CONTEXT.md.
   - **Status: RESOLVED during planning.** `01-02-PLAN.md` → "Planner decisions recorded here"
     records the answers: `recipes.subtitle` is a text column seeded
     `Weeknight dinner · ready in 20 minutes` (UI-SPEC Open Question 3), and `recipes.base_servings`
     is an integer column seeded `2` (UI-SPEC Open Question 4), so the servings scaler's multiplier
     derives from a real column. The same section fixes the seeded slug `chicken-rice-bowl` and the
     rest of the deterministic seed values.

3. **Coolify's actual Postgres extension list remains UNKNOWN and correctly stays that way (D-13).** — **DEFERRED (D-13)**
   - What we know: `docs/00-current-state.md` §4 lists it as unconfirmed; D-13 declares an empty baseline for Phase 1 rather than guessing.
   - What's unclear: whether production genuinely uses zero extensions or Phase 1's empty baseline will need to grow later.
   - Recommendation: do not attempt to resolve this in Phase 1 — D-13 already made the correct call (declare an honest baseline, not a guessed one). Revisit only when Coolify's actual configuration is confirmed (a Phase 6+ concern per the canonical refs).
   - **Status: DEFERRED (D-13) — stays UNKNOWN on purpose, and that is the resolution.** This is not
     an unanswered question awaiting work; declining to answer it is the decision. `docs/00-current-state.md`
     §4 keeps it recorded as unconfirmed, and Phase 1 ships an empty extension baseline that is
     honest rather than a guessed mirror of production. Do not close this by inferring an extension
     list; it closes only when Coolify's actual configuration is read directly (Phase 6+).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|--------------|-----------|---------|----------|
| Docker Desktop | Postgres container (ENV-01), `db:reset` (ENV-04) | `[VERIFIED: docs/00-current-state.md §2]` ✓ | 29.6.1 | — |
| Node.js | Next.js app, all CLI scripts | `[VERIFIED: docs/00-current-state.md §2]` ✓ | 24.19.0 (Next 16 requires 20.9+, `[CITED: nextjs.org/docs/app/guides/upgrading/version-16]`) | — |
| pnpm | Workspace, all scripts | `[VERIFIED: docs/00-current-state.md §2]` ✓ | 10.25.0 | — |
| `psql` on PATH | Not required — this phase deliberately avoids depending on it | `[VERIFIED: docs/00-current-state.md §2]` ✗ (confirmed absent) | — | `pg.Client`-based `db:query` script (D-15) replaces the need for `psql` entirely; no fallback needed because nothing in this phase's design requires it. |
| Docker Compose `--wait` flag | Pattern 1 readiness | Not directly checked | — (bundled with Docker 29.6.1) | Hand-rolled `pg_isready` retry loop if the bundled Compose predates the flag (A4 above) — low risk, cheap to detect and fix on first `db:reset` run. |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** Docker Compose `--wait` flag support (A4) — falls back to a simple polling script if unavailable; `psql` absence has no fallback need since the whole design routes around it.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 5.0.0 (none installed yet — greenfield repo, confirmed 0 tracked app files in `01-CONTEXT.md`'s code-context section) |
| Config file | none — see Wave 0 |
| Quick run command | `pnpm vitest run --project smoke` (proposed; exact project/workspace wiring is a Wave 0 task) |
| Full suite command | `pnpm vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|-------------|
| ENV-01 | `docker compose up` brings a healthy PostgreSQL 17 container | integration/smoke | `docker compose up -d --wait && docker compose exec db pg_isready` (or a vitest test that connects and checks `SELECT version()`) | ❌ Wave 0 |
| ENV-02 | Schema edit → `generate` → inspect → `migrate` produces the expected schema | integration | vitest test: run `drizzle-kit generate`+`migrate` against a fresh container, then query `information_schema.tables`/`columns` and assert shape | ❌ Wave 0 |
| ENV-03 | Bare `DATABASE_URL` present causes hard failure in app and tooling | unit | vitest test: set `process.env.DATABASE_URL`, import the env module, assert it throws | ❌ Wave 0 |
| ENV-03 | Environment marker (D-21) aborts on a mismatched `current_database()` | unit | vitest test: connect, mock/override the expected name, assert the assertion function throws | ❌ Wave 0 |
| ENV-04 | `db:reset` produces a clean, freshly-migrated schema with no manual cleanup | integration | vitest test (or a plain script run in CI later): run `db:reset`, then assert `information_schema` matches the full migration history and seed row counts match D-23's fixed values | ❌ Wave 0 |
| ENV-05 | `db:query` connects directly, no Coolify terminal relay | manual + smoke | Manual: run `pnpm db:query "SELECT 1"` from the Bash tool and confirm output. Automated smoke: vitest test invoking the same script as a child process and asserting stdout | ❌ Wave 0 |
| APP-01 | App boots against the resulting schema (D-08's automated smoke test) | e2e/smoke | vitest test: `execa("pnpm", ["--filter", "recipe-app", "build"])` → `execa("pnpm", ["--filter", "recipe-app", "start"])` → `fetch("http://localhost:PORT/recipes/<seeded-id>")` → assert 200 + expected content → kill the server | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** targeted vitest file for the area just changed (e.g., env-validation tests after touching `scripts/env.ts`).
- **Per wave merge:** `pnpm vitest run` (full suite).
- **Phase gate:** Full suite green, plus a manual run of `db:reset` and `db:query` from the Bash tool (ENV-04/ENV-05 have a manual-verification component per their nature — a script that IS the Claude Code interface is partly validated by that same interface being used).

### Wave 0 Gaps
- [ ] `vitest.config.ts` (or workspace config) — none exists; this is the first test infrastructure in the repo.
- [ ] `docker-compose.yml` — does not exist yet; ENV-01/ENV-04 tests depend on it.
- [ ] `scripts/env.ts` + its test file — the shared validation module every other test depends on; build and test this first.
- [ ] Framework install: `pnpm add -D vitest execa` at the workspace root.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | No | No user-facing auth exists in Phase 1's scope (D13: backend stays thin, no login). |
| V3 Session Management | No | No sessions — the ported screen's interactive state is ephemeral client-only React state, not a server session. |
| V4 Access Control | No | Single dev-role credential (D-17); access control is deferred to Phase 6 (CONN-05). |
| V5 Input Validation | Yes | `zod` schema validates `process.env` shape (Pattern 4). Drizzle's query builder parameterizes all app-level queries (Don't Hand-Roll table) — the one deliberate exception is `db:query`'s raw-SQL passthrough, which is in-scope by design (ENV-05) and mitigated by being (a) hardcoded to a disposable dev DB only (D-16), (b) invoked only by the trusted local operator/agent via the Bash tool, never by an external request. |
| V6 Cryptography | No | No cryptographic operations in this phase's scope; `gen_random_uuid()` (if used for primary keys) is a core Postgres function, not custom crypto. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-----------------------|
| Ambient/leftover connection string silently redirecting a destructive command to the wrong database | Tampering / Elevation of Privilege (of intent) | D-19 (app-prefixed, environment-explicit variable names) + D-20 (hard failure on bare `DATABASE_URL`) + Pattern 3 (`current_database()` assertion) — three independent layers, per CLAUDE.md's "architectural enforcement over remembered caution." |
| Credential leakage via logs/console output | Information Disclosure | `db:query`/seed scripts must never `console.log` the full connection string (only the asserted database name, per Pattern 3's error message, which intentionally omits credentials). CLAUDE.md: "Never log or commit credentials" — applies to this phase's own tooling output, not only to git history. |
| Secrets committed to git (`.env` files) | Information Disclosure | `.env`/`.env.local` must be in `.gitignore` from the first commit this phase makes; `RECIPE_DEV_DATABASE_URL`'s password component is a local-only disposable-DB credential (low blast radius by design, per D-17), but the hygiene habit matters because the same pattern is reused for staging/prod variable names later. |
| SQL injection via `db:query`'s raw-SQL passthrough | Tampering | Accepted, scoped risk: the script only ever targets the disposable local dev database (D-16, structurally hardcoded, no parameter/flag can redirect it), and its only caller is the trusted local operator/agent via the Bash tool — not a network-facing input path. This is explicitly the deliberate asymmetry D-03 calls out ("must never be promoted into the shared automation package"). |

## Sources

### Primary (HIGH confidence)
- `npm view <pkg> version` direct registry queries (drizzle-orm, drizzle-kit, pg, next, zod, dotenv) — run 2026-09-06, this session.
- `gsd_run query package-legitimacy check` — run 2026-09-06, this session, against next/zod/pg/tsx/dotenv/typescript/wait-on/drizzle-orm/drizzle-kit.
- `docs/00-current-state.md` §2 — Windows 11, Docker 29.6.1, Node 24.19.0, pnpm 10.25.0, no local Postgres, `psql` not on PATH (read this session).
- `.planning/phases/01-local-environment/01-CONTEXT.md` — D-01 through D-27, all binding on this research (read this session).

### Secondary (MEDIUM confidence — WebSearch cross-checked against official/well-known sources)
- [Next.js Upgrading: Version 16](https://nextjs.org/docs/app/guides/upgrading/version-16) — official docs, sync request API removal, Node/TS/React minimums.
- [Drizzle ORM — Migrations](https://orm.drizzle.team/docs/migrations), [Migrations with Drizzle Kit](https://orm.drizzle.team/docs/kit-overview), [drizzle-kit generate](https://orm.drizzle.team/docs/drizzle-kit-generate) — official docs, `generate`/`migrate`/`push` semantics.
- [Drizzle ORM — PostgreSQL get-started](https://orm.drizzle.team/docs/get-started-postgresql) — official docs, `drizzle-orm/node-postgres` setup pattern.
- [node-postgres — Pooling](https://node-postgres.com/features/pooling) — official docs, `Pool` vs `Client` and `pool.end()`.
- [Docker Compose Tip #51: up --wait](https://lours.me/posts/compose-tip-051-up-wait/), [Docker Compose Tip #3: depends_on healthcheck](https://lours.me/posts/compose-tip-003-depends-on-healthcheck/) — practitioner blog, cross-checked against Docker's own `--wait` flag behavior description.
- [Last9 — Docker Compose Health Checks](https://last9.io/blog/docker-compose-health-checks/) — `pg_isready` healthcheck shape, cross-checked against the above.
- [pgPedia — gen_random_uuid() function](https://pgpedia.info/g/gen_random_uuid-function.html) — confirms PG13 made `gen_random_uuid()` a core function (supports D-13's stated reasoning).
- [Docker Hub — postgres image tags](https://hub.docker.com/_/postgres/tags) — confirms `postgres:17` defaults to the Debian bookworm (glibc) variant, matching D-12's stated choice.
- [dev.to — Type-Safe Environment Variables in Node.js with Zod](https://dev.to/whoffagents/type-safe-environment-variables-in-nodejs-with-zod-570i) — fail-fast env validation pattern.
- Strapi blog, Vercel template docs (Next.js + Drizzle + Postgres integration pattern) — cross-checked against Drizzle's own official docs above; used only for the Server Component wiring shape, which the official docs also confirm.

### Tertiary (LOW confidence / flagged for validation)
- The exact Docker Compose version bundled with the installed Docker 29.6.1, and whether it supports `--wait` — not independently confirmed against a version table; flagged as Assumption A4.
- Whether Next.js 16.3.4 specifically (vs. staying on 15.x) is the version the planner should pin — flagged as Assumption A1; both are viable, the research recommends 16 since it is current-latest-stable and the App Router/Server Component pattern this phase needs is unaffected either way beyond the `await params` requirement.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every version number verified against the live npm registry this session, cross-checked against `.planning/research/STACK.md`'s same-day research.
- Architecture: MEDIUM-HIGH — Docker Compose/Drizzle/Next.js mechanics are well-documented and cross-checked across 2+ sources each; the D-21 marker design (Pattern 3) is original reasoning applied to a locked constraint, not sourced from an external authority, so treat it as a strong recommendation rather than an industry-standard pattern.
- Pitfalls: MEDIUM-HIGH — Next.js 16 params change is confirmed via official docs; the AI-agent-specific hazards (push drift, ambient env vars) are carried forward from this project's own prior `PITFALLS.md` research, already cross-checked there.

**Research date:** 2026-09-06
**Valid until:** ~30 days for the Drizzle/Postgres/Compose mechanics (stable); ~14 days for the Next.js 16 pitfall specifically, since it is a very recent major version and its ecosystem guidance is still shifting quickly.
