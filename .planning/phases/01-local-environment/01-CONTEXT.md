# Phase 1: Local Environment - Context

**Gathered:** 2026-09-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 1 delivers a disposable local PostgreSQL 17 development environment and the loop
that runs on top of it: a Drizzle schema edit becomes a generated migration, applies
locally, and the recipe app boots against the resulting schema. Claude Code queries that
database directly with no command relayed through a Coolify terminal, and the whole
database can be destroyed and rebuilt in one command.

Requirements in scope: ENV-01, ENV-02, ENV-03, ENV-04, ENV-05, APP-01.

Also folded in by the roadmap: a brief, timeboxed, non-blocking investigation into why
past production redeploys were needed so often, so that D8's fix addresses the real cause
rather than an assumed one.

**Explicitly not this phase:** no remote connectivity of any kind (D2), no safety analyzer
(Phase 3), no migration runner with re-derived classification (Phase 4), no CI (Phase 5),
no backup or restore work (Phase 2). Recipe app functionality beyond one screen rendering
real rows is out of scope (D6, D13).

</domain>

<decisions>
## Implementation Decisions

### Repository layout

- **D-01:** The repo is a **pnpm workspace** with `apps/` and `packages/`. The recipe app
  stays at `apps/recipe-app/`, where the Claude Design import already lives; the automation
  package's eventual home is `packages/automation/`.
  This supersedes the flat `automation/` + `app/` layout drawn in
  `.planning/research/ARCHITECTURE.md` — that document's *rationale* (draw the extraction
  seam now so Phase 7 is a package publish, not a rewrite) is adopted; only its directory
  names are not.
  — **Reversibility:** costly — moving the workspace root later rewrites every import path,
  every script path, `drizzle.config.ts`, the compose file's bind mounts, and any CI
  workflow path filter written against it.

- **D-02:** `packages/automation/` is **not created in Phase 1**. It appears in Phase 3 when
  the analyzer gives it something app-agnostic to hold. The workspace boundary chosen in
  D-01 is the seam ARCHITECTURE.md cares about, and it exists from day one regardless.

- **D-03:** Phase 1's database commands are **root `package.json` scripts** — `db:reset`,
  `db:query`, `db:migrate`.
  Deliberate asymmetry to preserve: `db:reset` and `db:query` are local-development
  conveniences that must **never** be promoted into the shared automation package, because
  a `query` command living in the app-agnostic CLI is precisely the thing that could later
  be pointed at staging. `db:migrate` is the opposite — it is a placeholder that Phase 4's
  safety-checking runner takes over behind the same script name.

- **D-04:** The recipe app runs **on the host** via `pnpm dev`. `docker-compose.yml` defines
  exactly one thing: the development PostgreSQL container. No app container in Phase 1.

### What the recipe app is

- **D-05:** **Next.js (App Router)**. Server components query Drizzle directly, so no
  separate API layer has to be built for a fixture that is not supposed to have one.
  — **Reversibility:** costly — the ported screen, the data-access layer, and the smoke
  test all bind to the framework's conventions.

- **D-06:** **One screen is ported and wired to real database rows: `Recipe Page`.** It
  exercises the most schema (recipes + ingredients + ordered steps) and its servings scaler
  gives quantities a reason to be real data rather than markup.
  Carry forward from `apps/recipe-app/design/IMPORT.md`: `Recipe Page.dc.html` deliberately
  departs from the Modernist design system (rounded corners, warmer palette) and its own
  notes say so — **that divergence is intentional and must be preserved**, not "fixed".
  Also from IMPORT.md: this file was *transcribed* rather than decoded byte-exact, so if a
  rendering discrepancy appears, re-fetch it from the source design project before debugging
  it as a styling bug.

- **D-07:** The remaining three screens (`Kitchen Home`, `Meal Planner`, `Recipe Builder`)
  stay as design files in Phase 1. Porting them is not Phase 1 work.

- **D-08:** "The app boots against the resulting schema" is proven by an **automated smoke
  test** — start the app, hit the route, assert it returns rows from the migrated schema.
  This is built to be reused verbatim by Phase 4's RUN-07 and Phase 5's CI, so it must be
  scriptable and headless, not a visual check.

### Schema scope

- **D-09:** Phase 1 creates the **recipe core only: `recipes` + `ingredients` + `steps`**,
  with real foreign keys and an ordering column on steps. Three related tables, not one —
  a schema with no relationships is a weak fixture for a classifier whose whole point is
  context-awareness.
  — **Reversibility:** one-way — every table added here is schema the pipeline must
  subsequently treat as real; removing one later is itself a destructive migration that has
  to go through the very gate this project is building.

- **D-10:** Tags, usage counters (`used 14×, last 24 Aug`), meal-plan days, meal slots, and
  shopping items are **deliberately not built in Phase 1**. They are reserved churn material.

- **D-11:** Reserved schema changes are **named in this document** so Phase 1 does not spend
  them. These are reserved, not planned — the owning phase decides the specifics:

  | Reserved for | Intended path | Candidate change | Why it fits |
  |---|---|---|---|
  | Phase 4 (APP-02) | SAFE | Add a nullable `notes` column to `recipes`, or add a `tags` table | Purely additive; no rewrite, no scan |
  | Phase 4 (APP-02) | REVIEW REQUIRED | Add a `NOT NULL` column with a **volatile** default, or `SET NOT NULL` on an existing column | Exercises the PG17-specific context rules D9 depends on |
  | Phase 4 (APP-02) | BLOCKED | `DROP TABLE ingredients` or `DROP COLUMN` on a column the ported screen reads | Genuinely destructive against a table with real dependents |
  | Phase 7 (APP-03) | Expand-and-contract | Rename/restructure a column the `Recipe Page` screen actively reads — expand in one release, contract in a later one | APP-03 needs a column *genuinely still in use*; this is the hardest case to manufacture artificially, so it is protected |

  **Phase 1 must not make any of these changes.**

### PostgreSQL image and extensions

- **D-12:** Image is **`postgres:17` (Debian/glibc)**, not `postgres:17-alpine`. musl's
  collation differs from glibc, which produces "sorts correctly in dev, differently in
  production" bugs and can invalidate index-ordering assumptions. Parity beats image size.
  Note this is a *server* choice and is separate from `.planning/research/STACK.md`'s
  recommendation of `postgres:17-alpine` for the **client tooling** image used by
  `pg_dump`/`pg_restore` — that guidance still stands for Phase 2.

- **D-13:** Phase 1 installs **no extensions**. An empty extension set is the declared,
  pinned baseline. PG17 has `gen_random_uuid()` in core, so the usual reason to reach for
  `pgcrypto` does not apply.
  This is not a claim about production. `docs/00-current-state.md` §4 lists Coolify's setup
  as UNKNOWN and it stays UNKNOWN — ENV-01's "matching production's extensions" is satisfied
  by declaring a baseline honestly, not by guessing at one.

- **D-14:** When an extension *is* eventually needed, it is declared as a **Drizzle migration
  (`CREATE EXTENSION`)**, not a `docker-entrypoint-initdb.d` init script. An init script
  creates a second, ungated path by which schema state arrives — one that fires only on an
  empty volume and has no equivalent on a managed Coolify database. That is exactly the drift
  this system exists to detect, and the precedent should not be set in the foundation.
  **Known tension, recorded now rather than discovered later:** most contrib extensions
  require superuser, while Phase 6's migration credential (CONN-05) is deliberately *less*
  privileged than the application's. Whoever adds the first extension will hit this wall.
  Solving it belongs to Phase 6's credential design, not to Phase 1 building a bypass.

### How Claude Code reaches the database

- **D-15:** Access is a **`pnpm db:query` script built on `node-postgres`**, invoked through
  the Bash tool. `psql` is verified as not on PATH on this Windows machine
  (`docs/00-current-state.md` §2), and `pg` is already a required dependency, so this adds
  nothing new.

- **D-16:** The script is **hardcoded to local**. It reads the development connection
  variable and nothing else — there is no argument, flag, or environment override that
  redirects it at another database. Repointing it requires editing source in a diff, not
  passing a parameter. This is the architectural form of the constraint rather than a guard
  someone has to remember, per the project's non-negotiables.
  — **Reversibility:** one-way in intent — adding a connection parameter later would silently
  convert a structurally-local tool into a remotely-pointable one. Treat any future PR that
  parameterises it as a safety-relevant change.

- **D-17:** The agent connects as the **same development role as the app**. The dev database
  is disposable so damage is genuinely free, and ENV-05 requires inspect *and* modify.
  Credential separation is a Phase 6 concern (CONN-05), not a Phase 1 one.

- **D-18:** Because Next.js runs on the host (D-04), the container publishes `5432` **to
  `127.0.0.1` only** — never `0.0.0.0`. The app needs the port regardless; it must not be
  reachable from the local network.

### Connection variables and environment guards

- **D-19:** Connection variables are **app-prefixed and environment-explicit**:
  `RECIPE_DEV_DATABASE_URL`, with `RECIPE_STAGING_DATABASE_URL` and
  `RECIPE_PROD_DATABASE_URL` as the reserved names for later phases. Only the dev one exists
  in Phase 1. The prefix means a shared CI environment holding a second app's variables in
  Phase 7 cannot collide.

- **D-20:** A bare `DATABASE_URL` present in the environment causes a **hard failure** —
  tooling and app both refuse to start. This is not defensive paranoia: Coolify injects
  database URLs into linked services by default, so the collision is the platform's normal
  behaviour, not a hypothetical. A warning was explicitly rejected as the "remembered
  caution" pattern the project's non-negotiables forbid.

- **D-21:** Connections **assert the environment they reached**. The connection checks a
  marker — database name, or a row in a small `_environment` table — and aborts if it does
  not say `development`. This catches what naming alone cannot: a correctly-named variable
  holding the wrong URL. Built once here, reused by the Phase 4 runner and the Phase 7
  production job.
  The marker's shape is Claude's discretion (see below), but it must be something a restore
  cannot silently carry across environments — a value baked into a dump that is then restored
  elsewhere would defeat the check, which matters directly for Phase 2.

### Destroy and rebuild

- **D-22:** `db:reset` performs a **full teardown**: `docker compose down -v` → `up` → wait
  for healthy → `drizzle-kit migrate` → seed. Every rebuild starts from genuinely nothing —
  container and volume both destroyed. This is slower than an in-container
  `DROP DATABASE`/`CREATE DATABASE`, and that cost is accepted: it is the only variant that
  proves the migration history applies to a truly empty instance, which Phase 4's RUN-05 and
  Phase 2's BKP-03 ("genuinely fresh, never pre-seeded") both require.

- **D-23:** Seed data is a **deterministic, committed seed derived from the imported design's
  own recipe content**. Fixed values, fixed row counts. The wired `Recipe Page` then renders
  the actual designed data, and Phase 2 gets recognisable values to spot-check rather than
  meaningless generated strings — BKP-04 asserts row counts, spot-checked values, referential
  integrity and sequence state, all of which need known content to assert against.

- **D-24:** `db:reset` **does not prompt**. The environment assertion from D-21 is the guard,
  and it is structural rather than interactive. A prompt that automation routinely passes
  `--yes` to protects nobody, and an unconditional prompt would block Phase 4's automated
  migration-history tests from reusing this command, forcing a second destructive path to
  exist.

### Redeploy root-cause investigation

- **D-25:** Runs as the **first task of the phase, strictly timeboxed**, with "still UNKNOWN"
  an explicitly acceptable outcome. It must not become blocking work, and it must not produce
  a guess dressed as a finding.

- **D-26:** Evidence sources, in order of decisiveness:
  1. **The existing SaaS repos on this machine** — read their Dockerfile / entrypoint / start
     command and establish whether migrations really are decoupled from boot. This is the one
     check that can *overturn* the premise: `docs/00-current-state.md` §2 records "migrations
     are already decoupled from application deploys" as owner-stated and unverified. If it is
     wrong, D8 is already the fix and the investigation is complete.
  2. **Coolify deployment history** — turns "too often" into a count with triggers attached.
  3. **Git history of the existing apps** — whether redeploys clustered with schema changes
     or with something unrelated (config, env vars, dependency bumps).
  4. **Owner recollection** — recorded explicitly as recollection, never as evidence.

- **D-27:** Findings land in **`docs/00-current-state.md` §7**, next to the pain point they
  address — including a plain "still UNKNOWN" if the evidence is not there. A decision entry
  in `docs/decisions.md` is opened **only if** the finding actually forces one (for example,
  if migrations turn out to run at startup after all, which would move D8 from PROPOSED toward
  confirmed-necessary). A finding is not a decision.

### Claude's Discretion

- The exact shape of the environment marker in D-21 (database-name convention vs. an
  `_environment` table vs. a Postgres setting) — constrained only by the requirement that a
  restored dump cannot carry a stale marker into the wrong environment.
- TypeScript configuration, build tooling, lint setup, and the specific Next.js project
  scaffold within the D-05 choice.
- Healthcheck strategy and readiness polling for the compose service.
- Exact column types and naming within the D-09 recipe core, as long as the imported
  `Recipe Page` screen's fields are representable and D-10/D-11's reserved material is not
  spent.
- How the ported screen's Claude Design binding model (`<sc-if>`, `<sc-for>`, `{{ }}`,
  `DCLogic`) maps onto React components — IMPORT.md notes the CSS and tokens carry over
  unchanged, which is what keeps styling identical.
- Which of the two candidate SAFE changes in D-11 is reserved (they are alternatives, not
  both required).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project decisions and constraints
- `docs/decisions.md` — D1-D13 with explicit statuses. Directly binding on this phase:
  **D1** (dev DB is a local Docker container), **D2** (no remote connectivity in this phase),
  **D9** (PostgreSQL 17 pinned across all environments; version-conditional analyzer rules
  depend on it), **D11** (drizzle-orm 0.45.2 / drizzle-kit 0.31.10, not the v1 rc line —
  the rc removes `_journal.json`, which the audit requirement needs), **D13** (UI imported
  as-is, backend stays thin). Note statuses: D1, D2, D8 are PROPOSED, not ACCEPTED.
- `docs/00-current-state.md` — the operational inventory. §2 confirmed facts (Windows 11,
  Docker 29.6.1, Node v24.19.0, pnpm 10.25.0, **no local PostgreSQL, `psql` not on PATH**),
  §4 the Coolify UNKNOWNs that must stay UNKNOWN, §7 the two pain points, §8 open risks.
  **This phase writes back into §7.**
- `docs/original-brief.md` — the source brief.
- `CLAUDE.md` and `.claude/CLAUDE.md` — non-negotiables. Especially: prefer architectural
  enforcement over remembered caution; mark unverified things UNKNOWN; Drizzle not Prisma;
  never log or commit credentials.

### Requirements and plan
- `.planning/REQUIREMENTS.md` — ENV-01…ENV-05 and APP-01 are this phase's requirements;
  the Out of Scope table lists anti-features that must not be reintroduced.
- `.planning/ROADMAP.md` § "Phase 1: Local Environment" — goal and the three success criteria
  this phase is verified against.
- `docs/10-roadmap.md` — the earlier hand-written roadmap.

### Architecture and stack research
- `.planning/research/ARCHITECTURE.md` — **read with D-01 in mind**: its "Recommended Project
  Structure" section proposes `automation/` + `app/`, which this phase supersedes; its
  rationale, build order (step 1 is exactly this phase), and anti-patterns still apply
  unchanged. Anti-Pattern 2 (migrating at container startup) is the direct ancestor of D8.
- `.planning/research/STACK.md` — pinned versions and the reasoning behind them. Note its
  `postgres:17-alpine` recommendation applies to the **client tooling** image (Phase 2), not
  the server image chosen in D-12.
- `.planning/research/PITFALLS.md`, `.planning/research/FEATURES.md`,
  `.planning/research/SUMMARY.md`.

### The recipe app fixture
- `apps/recipe-app/design/IMPORT.md` — provenance of the design hand-off, which files are
  byte-exact vs. transcribed, what the screens imply about the schema, and the explicit
  warning not to build the whole data model up front. **Required reading before touching
  anything under `apps/recipe-app/design/`.**
- `apps/recipe-app/design/Recipe Page.dc.html` — the screen being ported in this phase.
- `apps/recipe-app/design/_ds/modernist-0c208813-c83e-4bbd-ab62-e70d3e2809b9/` — the design
  system: `styles.css`, `_ds_manifest.json`, `readme.md`. Tokens and CSS carry over unchanged.
- `apps/recipe-app/design/support.js` — the `DCLogic` binding runtime that has to be ported
  to React components.

</canonical_refs>

<code_context>
## Existing Code Insights

The repository contains **no application code at all** — 34 tracked files, all documentation
and design assets. There is no `package.json`, no `docker-compose.yml`, no
`drizzle.config.ts`, and no workspace file. Phase 1 creates the entire runnable surface.

### Reusable Assets
- `apps/recipe-app/design/` — four Claude Design canvas screens plus a complete design system
  (Archivo, accent `#ec3013` on `#f3f2f2`, zero corner radius, 2px rules, grayscale
  photography). CSS and design tokens transfer unchanged; only the binding model needs
  porting.
- The design's own recipe content is the source for D-23's deterministic seed — no fixture
  data needs inventing.
- `docs/` already holds the decision log, current-state inventory and brief that this phase
  reads from and (per D-27) writes back into.

### Established Patterns
- **Documentation is a deliverable, not overhead.** `CLAUDE.md` states the owner had no
  written notes on their own operation before this project; capturing state is real output.
- **Explicit status on every decision.** `docs/decisions.md` marks each entry
  PROPOSED / ACCEPTED / REJECTED / SUPERSEDED / OPEN. New entries must carry a status, and a
  proposal must never be recorded as settled.
- **UNKNOWN is a valid, required answer.** Several current-state items are deliberately
  unresolved. Do not close them by inference.

### Integration Points
- `apps/recipe-app/` is the fixed home of the recipe app — the design import already occupies
  it, and D-01 keeps it there.
- `packages/automation/` is the reserved slot Phase 3 fills; the workspace must be configured
  to accommodate it without restructuring.
- `docs/00-current-state.md` §7 is written to by D-27.
- `docs/decisions.md` is appended to only if the D-27 investigation forces a decision.
- The D-08 smoke test is an integration point for Phase 4 (RUN-07) and Phase 5 (CI-01) — build
  it to be invoked by something other than a human.

</code_context>

<specifics>
## Specific Ideas

- **The `Recipe Page` design divergence is intentional.** It departs from Modernist with
  rounded corners and a warmer palette, and its own notes say so. Preserve it; do not
  normalise it to the design system.
- **`Recipe Page.dc.html` was transcribed, not decoded byte-exact.** If a rendering
  discrepancy appears, re-fetch it from the source design project before debugging it as a
  styling bug (IMPORT.md).
- **The seed should render as the designed data.** The point of seeding from the design's own
  recipe content is that the ported screen looks like the hand-off, and Phase 2 can assert on
  values a human recognises.
- **Reserved churn is a real constraint, not a note.** D-11's table exists so Phase 1 does not
  accidentally build the change Phase 7 needs to *add*. Phase 7's expand-and-contract case in
  particular requires a column genuinely still in use, which cannot be manufactured after the
  fact.
- **`postgres:17` over `postgres:17-alpine` is a correctness choice, not a preference.**
  Collation behaviour differs between musl and glibc; the failure mode is silent divergence in
  sort and index ordering between dev and production.

</specifics>

<deferred>
## Deferred Ideas

- **Porting `Kitchen Home`, `Meal Planner`, and `Recipe Builder`** — design files stay
  unported. Later phases, driven by what the pipeline needs to exercise (D-07).
- **Tags, usage counters, meal-plan days, meal slots, shopping items** — reserved churn
  material for Phases 4 and 7 (D-10, D-11).
- **`packages/automation/` and its CLI** — Phase 3, when the analyzer gives it something
  app-agnostic to hold (D-02).
- **Credential separation between app runtime and migration execution** — CONN-05, Phase 6.
  Phase 1 deliberately uses one dev role (D-17).
- **The superuser-vs-migration-credential tension for `CREATE EXTENSION`** — surfaced in D-14,
  resolved in Phase 6's credential design.
- **A container-based app boot path** — rejected for Phase 1 (D-04); revisit if staging or
  production parity ever demands it.
- **Backup, restore, and restore-drill work** — Phase 2 in full. Phase 1 only makes the
  choices (D-22, D-23) that Phase 2 depends on.

</deferred>

---

*Phase: 1-Local Environment*
*Context gathered: 2026-09-06*
