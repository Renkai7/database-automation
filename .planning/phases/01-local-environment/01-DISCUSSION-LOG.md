# Phase 1: Local Environment - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-06
**Phase:** 1-Local Environment
**Areas discussed:** Repo layout & workspace, What "the app" is, Phase-1 schema scope, Extension parity with prod, How Claude Code reaches the DB, Connection var naming & guard, Destroy/rebuild & seed data, Redeploy root-cause probe

All eight surfaced gray areas were selected for discussion.

---

## Repo layout & workspace

**Q: What layout should the repo take?**

| Option | Description | Selected |
|--------|-------------|----------|
| pnpm workspace: apps/ + packages/ | Design import already at `apps/recipe-app/design/`, so nothing moves; Phase 7 extraction becomes a package publish | ✓ |
| Flat: app/ + automation/ | Exactly as ARCHITECTURE.md draws it; means moving the one thing already committed | |
| Single package, folders only | Least ceremony; the automation/app seam has to be introduced later | |

**Q: What form do Phase 1's database commands take?**

| Option | Description | Selected |
|--------|-------------|----------|
| First commands of the automation CLI | Real CLI in Phase 1; ARCHITECTURE.md's "one interface so CI and local can't drift" argument | |
| Root package.json scripts, replaced later | Fastest to the success criteria; automation package appears in Phase 3 | ✓ |
| Root scripts that shell into the CLI | Both from day one; more moving parts | |

**User's choice:** Asked Claude to recommend. Claude recommended root scripts.
**Notes:** Claude's stated reasoning, accepted by the owner: of the three commands only
`migrate` has a future in the shared package; `reset` and `query` are the opposite, because
ENV-05's access mechanism must be structurally local-only and a `query` command inside the
app-agnostic CLI is precisely what could later be pointed at staging. The seam
ARCHITECTURE.md cares about is the workspace boundary, which the layout choice already draws.

**Q: Where does the recipe app run during local development?**

| Option | Description | Selected |
|--------|-------------|----------|
| On the host (pnpm dev) | Compose defines only Postgres; fastest loop; hot reload works | ✓ |
| Containerized in the same compose file | Prod parity; slower on Windows; pulls image-build concerns into a database phase | |
| Host by default, container as opt-in profile | Both, at the cost of two boot paths | |

---

## What "the app" is

**Q: What does the recipe app get built on?**

| Option | Description | Selected |
|--------|-------------|----------|
| Next.js (App Router) | Server components query Drizzle directly — no API layer to build; heaviest dependency | ✓ |
| Vite + React SPA + tiny API | `.dc.html` maps cleanly to JSX, but needs an API layer the fixture is meant to avoid | |
| Plain Node/Fastify + server templates | Thinnest thing that boots; porting the binding model to templates is hand work | |

**Q: How much of the imported design gets ported in Phase 1?**

| Option | Description | Selected |
|--------|-------------|----------|
| One screen, wired to real rows | Smallest thing that satisfies APP-01 honestly | ✓ |
| All four screens, one wired to data | Front-loads in-scope UI work; a lot of non-database work in a database phase | |
| One screen, static markup only | Fastest; weakens "boots against the resulting schema" | |

**Q: How should "the app boots against the schema" be proven?**

| Option | Description | Selected |
|--------|-------------|----------|
| Automated smoke test | Mechanically checkable; reused by Phase 4 RUN-07 and Phase 5 CI with no rework | ✓ |
| Health endpoint the runner can poll | Simpler; proves connectivity rather than that the page renders data | |
| Manual — open the page and look | Zero setup; later phases would need an automated equivalent built from scratch | |

---

## Phase-1 schema scope

**Q: Which screen is wired to real database rows?**

| Option | Description | Selected |
|--------|-------------|----------|
| Recipe Page | Most schema exercised; servings scaler gives quantities a reason to be real data | ✓ |
| Kitchen Home | Least schema; the one file confirmed byte-exact from the import | |
| Recipe Builder | Proves inserts, but a form is the app depth D13 keeps out of scope | |

**Q: How much schema does Phase 1 create?**

| Option | Description | Selected |
|--------|-------------|----------|
| Recipe core: recipes + ingredients + steps | Real FKs and an ordering column; something for later phases to threaten | ✓ |
| recipes only | Maximum churn preserved, but no relationships to test context-awareness against | |
| Recipe core + tags + usage counters | Closer to the screens; spends Phase 4's additive-change material | |

**Q: Reserve specific later schema changes now?**

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — name them in CONTEXT.md | Stops Phase 1 spending them; gives Phase 4/7 planners something concrete | ✓ |
| No — leave it to Phase 4 and 7 | Keeps Phase 1 focused; risks artificial churn later | |
| Reserve only the expand-and-contract one | Protects the hardest case only | |

**Notes:** Recorded in CONTEXT.md D-11 as a table of reserved paths (SAFE / REVIEW REQUIRED /
BLOCKED / expand-and-contract), explicitly marked reserved rather than planned.

---

## Extension parity with prod

**Q: What extensions does Phase 1 install?**

| Option | Description | Selected |
|--------|-------------|----------|
| None — declare an empty baseline | PG17 has `gen_random_uuid()` in core; assumes nothing about an UNKNOWN production | ✓ |
| A minimal set the schema actually needs | e.g. citext; commits to an extension before there's a reason | |
| Guess at production's likely set, verify later | Records an assumption as near-fact — the failure mode CLAUDE.md forbids | |

**Q: How are extensions declared, whenever they are added?**

| Option | Description | Selected |
|--------|-------------|----------|
| A Drizzle migration (CREATE EXTENSION) | Gated and auditable like all schema state; hits a superuser wall at Phase 6 | ✓ |
| Container init script (initdb.d) | No privilege problem; ungated, empty-volume-only, no Coolify equivalent | |
| Defer — decide when first needed | No forcing function while none are installed | |

**User's choice:** Asked Claude to recommend. Claude recommended the Drizzle migration.
**Notes:** Claude's reasoning, accepted: an init script establishes a second, ungated path by
which schema state arrives — the exact drift the system exists to detect — and it should not
be the precedent set in the foundation. The superuser-vs-migration-credential tension is real
and was recorded as a known issue for Phase 6 rather than solved by building a bypass. Since
Phase 1 installs none, this is recorded intent, not built code.

**Q: Which PostgreSQL 17 image?**

| Option | Description | Selected |
|--------|-------------|----------|
| postgres:17 (Debian/glibc) | glibc collation matches typical production; larger image | ✓ |
| postgres:17-alpine | Smaller/faster; musl collation diverges — silent sort and index-ordering bugs | |
| Decide after confirming what Coolify runs | Honest, but leaves a moving part in the foundation | |

---

## How Claude Code reaches the DB

**Context given before the question:** with Next.js on the host, `127.0.0.1:5432` must be
published for the app regardless, so the question was only what the *agent* uses.

**Q: What mechanism does Claude Code use?**

| Option | Description | Selected |
|--------|-------------|----------|
| A pnpm db:query script (node-postgres) | No new dependency; works on Windows where `psql` isn't on PATH | ✓ |
| docker exec psql into the container | Full psql meta-commands; structurally local-only; needs Docker per query | |
| A PostgreSQL MCP server | Most ergonomic by a distance; configured by connection string, so it generalises the wrong way | |

**Q: What role does the agent connect as?**

| Option | Description | Selected |
|--------|-------------|----------|
| Same dev role as the app | Nothing extra to build; dev DB is disposable; ENV-05 needs modify rights | ✓ |
| A separate agent role, read-write | Establishes the CONN-05 pattern early at low cost | |
| Separate role, read-only + explicit write path | Strongest habit; arguably contradicts ENV-05 | |

**Q: What structurally stops the mechanism being pointed elsewhere?**

| Option | Description | Selected |
|--------|-------------|----------|
| Hardcode local — no connection parameter at all | Repointing requires editing source in a diff, not passing a flag | ✓ |
| A runtime guard rejecting non-local hosts | Testable, but implies the mechanism is meant to be parameterised | |
| Nothing yet — Phase 6 handles it | Defers; by Phase 6 the tooling is habitual | |

---

## Connection var naming & guard

**Context given before the question:** Coolify injects database URLs into linked services by
default, so a bare `DATABASE_URL` in the environment is the platform's normal behaviour, not
a hypothetical.

**Q: What naming scheme?**

| Option | Description | Selected |
|--------|-------------|----------|
| RECIPE_DEV_DATABASE_URL etc. | App-prefixed and environment-explicit; survives Phase 7's second app | ✓ |
| DEV_DATABASE_URL etc. | Shorter; collides in a shared CI environment with two apps | |
| DATABASE_URL_LOCAL etc. | Sorts adjacent to a bare `DATABASE_URL` — visually the opposite of the goal | |

**Q: What happens if a bare `DATABASE_URL` is present?**

| Option | Description | Selected |
|--------|-------------|----------|
| Hard-fail — refuse to start | Catches stray globals, leftover exports, and Coolify auto-injection, loudly | ✓ |
| Never read it — silently ignore | Satisfies ENV-03 as literally written; wrong variable stays invisible | |
| Warn but continue | Rejected as the "remembered caution" pattern the non-negotiables forbid | |

**Q: Assert at connect time that the right database was reached?**

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — assert the environment on connect | Catches a correctly-named variable holding the wrong URL; reused by Phase 4 and 7 | ✓ |
| No — naming is enough for a local-only phase | Nothing else exists to reach yet (D2) | |
| Yes, but only in the destructive commands | Check where the damage would be; simpler read path | |

---

## Destroy/rebuild & seed data

**Q: How deep does the one-command rebuild go?**

| Option | Description | Selected |
|--------|-------------|----------|
| Full: compose down -v → up → migrate → seed | From genuinely nothing every time; slowest; matches BKP-03 and RUN-05 | ✓ |
| In-container: DROP/CREATE DATABASE → migrate → seed | Far faster; clean schema but not a clean instance | |
| Full teardown, seeding behind a flag | Two states available; more surface to keep working | |

**Q: What seed data?**

| Option | Description | Selected |
|--------|-------------|----------|
| Deterministic seed from the design's own content | Screen renders the designed data; Phase 2 gets recognisable values to assert on | ✓ |
| Generated fake data with a fixed seed | More volume for timing a restore; meaningless values weaken spot-checks | |
| No seed — empty schema after rebuild | Simplest; Phase 2 has to invent fixture data first | |

**Q: Does `db:reset` confirm before destroying?**

| Option | Description | Selected |
|--------|-------------|----------|
| No prompt — the environment assertion is the guard | Structural rather than interactive; stays scriptable for Phase 2 and 4 | ✓ |
| Prompt unless --yes is passed | Protects nobody once automation passes `--yes` | |
| Always prompt | Would block Phase 4's automated history tests, forcing a second destructive path | |

---

## Redeploy root-cause probe

**Context given before the question:** "migrations are already decoupled from deploys" is
owner-stated and marked unverified in current-state §2. If it is wrong, D8 is already the fix;
if it is right, something else drives redeploys and D8 won't touch it.

**Q: What evidence can actually be reached?** (multi-select)

| Option | Description | Selected |
|--------|-------------|----------|
| Existing SaaS repos on this machine | Read Dockerfile/entrypoint — the check that can overturn the premise | ✓ |
| Coolify deployment history | Turns "too often" into a number with triggers | ✓ |
| Owner recollection only | Always available; weakest | ✓ |
| Git history of the existing apps | Whether redeploys clustered with schema changes or something unrelated | ✓ |

**User's choice:** All four available.

**Q: Where do the findings land?**

| Option | Description | Selected |
|--------|-------------|----------|
| docs/00-current-state.md, under §7 pain points | Findings sit next to the claim they resolve, including "still UNKNOWN" | ✓ |
| A new decision entry (D14) in docs/decisions.md | Only appropriate if the finding changes a decision | |
| Both — findings in current-state, decision if warranted | More writing; preserves the fact/decision distinction | |

**Notes:** CONTEXT.md D-27 keeps the conditional from the third option — a decisions.md entry
is opened only if the evidence forces one — while the unconditional home for findings is §7.

**Q: How is it kept from eating the phase?**

| Option | Description | Selected |
|--------|-------------|----------|
| First task, strictly timeboxed, UNKNOWN acceptable | Cheap while it's early; no guess dressed as a finding | ✓ |
| Last task, after the environment works | Clean critical path; most likely to get dropped | |
| Split it out as its own throwaway task | Can't distort the plan or success criteria | |

---

## Claude's Discretion

Recorded in CONTEXT.md `<decisions>`:

- Exact shape of the environment marker (database-name convention vs. `_environment` table vs.
  a Postgres setting), constrained so a restored dump cannot carry a stale marker across.
- TypeScript config, build tooling, lint setup, and the Next.js scaffold within D-05.
- Healthcheck strategy and readiness polling for the compose service.
- Column types and naming within the recipe core, subject to the reserved-churn constraint.
- How the Claude Design binding model maps onto React components.
- Which of the two candidate SAFE changes is reserved for Phase 4 (they are alternatives).

Two questions were explicitly handed to Claude to decide: the form of the Phase 1 database
commands, and how extensions get declared. Both recommendations were stated with reasoning
and accepted.

## Deferred Ideas

- Porting `Kitchen Home`, `Meal Planner`, `Recipe Builder` — later phases.
- Tags, usage counters, meal-plan days, meal slots, shopping items — reserved churn for
  Phases 4 and 7.
- `packages/automation/` and its CLI — Phase 3.
- Credential separation between app runtime and migration execution — Phase 6 (CONN-05).
- The superuser-vs-migration-credential tension for `CREATE EXTENSION` — Phase 6.
- A container-based app boot path — revisit only if parity demands it.
- Backup, restore, and restore-drill work — Phase 2 in full.

No scope creep occurred during discussion; every area stayed inside the Phase 1 boundary.
