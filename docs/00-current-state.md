# Current State — Operational Inventory

**Purpose:** Establish a factual baseline before designing what replaces it.
Nothing here is aspirational. Unverified things stay marked UNKNOWN.

**Status:** IN PROGRESS · started 2026-09-06 · updated 2026-09-06

---

## 1. Project shape

**This is a greenfield build.** The vehicle is a **recipe application** that does not
yet exist — it will be built from scratch, alongside and *through* the database
automation being designed here.

> **The recipe app is the test fixture, not the goal.** Its purpose is to generate real
> schema changes that exercise the pipeline. If this project ends with a polished recipe
> app and a weak database pipeline, it has failed.

**Why this matters:** the usual version of this problem is retrofitting safety onto a
live database holding real users' data, where every experiment is risky and a restore
drill is terrifying. Here the guardrails get built *before* anything of value exists.
Destructive scenarios can be triggered deliberately. Backups can be restored over and
over. The app arrives into a finished safety system rather than the reverse.

## 2. Confirmed facts

| Fact | Source |
|---|---|
| Recipe app is greenfield — no code, schema, or database exists yet | owner |
| No production data at risk for this application | owner |
| A UI hand-off will be supplied by the owner | owner |
| **A database backup restore has been drilled and timed by hand (2026-09-07)** — see `docs/20-restore-runbook.md`; the globals/roles restore path remains unproven on a genuinely role-empty cluster | Phase 2 drill |
| Migrations are already decoupled from application deploys (existing setup) | owner |
| Owner does not currently use SSH access to the Hetzner host | owner |
| Local: Windows 11, Docker 29.6.1, Node v24.19.0, pnpm 10.25.0 | verified |
| Local: no PostgreSQL running (nothing on :5432), `psql` not on PATH | verified |

## 3. Resolved by greenfield status

These were open questions that the greenfield answer settles:

- No existing schema drift for this app — there is no schema.
- No untrusted migration history — there is no history.
- No hand-applied production changes to reconcile.
- No irreplaceable data to protect *during construction*.

The safety system still must be real, because the recipe app is meant to reach
production eventually and the pipeline is meant to be reused for later applications.

## 4. Still UNKNOWN — infrastructure

Coolify on Hetzner exists and is in use, but its details are unconfirmed, and nothing
for *this* app has been provisioned.

- [ ] One Hetzner server or several? Type/specs?
- [ ] Coolify version?
- [ ] Is SSH (port 22) currently open on the server?
      *(Very likely yes — Coolify manages hosts over SSH — but unverified.)*
- [ ] Is a Hetzner Cloud Firewall in use? What is allowed inbound today?
- [ ] Are any database public ports currently enabled in Coolify?
- [ ] Are Coolify databases managed *resources* or services in a compose stack?

## 5. Existing applications

Separate from the recipe app, the owner has existing SaaS work on this infrastructure.

**Confirmed:** those applications hold **only the owner's own data — no third-party
user data.** A data-loss incident there would be the owner's own loss, not a breach of
anyone else's trust.

**Consequence for this project:** there is no urgent live exposure driving the timeline.
This work is preparation for the future, when real users do exist. That is the right
time to build it — but it also means the deadline pressure that would normally force
the safety work is absent, which is exactly how such work gets deferred. See risk R6.

- [ ] Are those applications in scope for this pipeline later, or is the recipe app
      standalone for now? *(Relevant at Phase 7.)*
- [ ] Do their production credentials exist on the local Windows machine?

## 6. Still UNKNOWN — backups and secrets

- [ ] Are backups configured for any existing production database today?
- [ ] Where would backups go — same server, or off-server (S3 / Hetzner Storage Box)?
- [ ] Where do secrets live — Coolify env vars only, or a secret manager?

---

## 7. Owner-stated pain points

1. **Claude Code cannot reach the databases.** Coolify runs them as Docker containers
   with no route from the local machine, so every inspection required manually running
   commands in the Coolify terminal and relaying output by hand.
2. **Production redeploys were required too often.** Root cause still unidentified —
   migrations are reportedly already decoupled, so something else is driving them.

   Investigation (2026-09-06): D-26 tier 1 reached and decisive. Enumerated the 18 git
   repositories under `C:/Users/ms531/Documents/Software Projects/` (immediate siblings of
   this repo, depth ≤3, `node_modules` excluded) and inspected each one's Dockerfile,
   `docker-compose*.yml`, `Procfile`, and `package.json` start/entrypoint scripts for a wired
   migration command (`drizzle-kit migrate`, `prisma migrate deploy`, `knex migrate`,
   `sequelize db:migrate`, `alembic upgrade`, `rails db:migrate`, direct `psql -f`). Tier 2
   (Coolify deployment history) was not attempted — not reachable from this machine, per D2.
   Tier 3 (git history of the app found) was not attempted — tier 1 was already decisive, so
   the timebox was spent confirming it instead. Tier 4 (owner recollection): none solicited
   beyond the owner statement already recorded above, which this finding contradicts.

   Root cause confirmed: `AI-Diagramming-Tool` — a sibling repository deployed to Coolify at
   `app.frametrue.dev` / `frametrue.dev` per its own `docker-compose.coolify.yml` (env var
   `DATABASE_URL` injected by Coolify at deploy time) — runs its Drizzle migrations at
   application boot, not as a decoupled step. `apps/api/src/index.ts` calls `initDb()` before
   accepting any traffic; for the hosted-Postgres path, `initDb()`
   (`apps/api/src/db/client.ts`) imports `drizzle-orm/node-postgres/migrator` and runs
   `migrate(db, { migrationsFolder })` against `DATABASE_URL` on every container start. That
   repo's own test, `apps/api/src/test/pg-pool-migrate-on-boot.test.ts` (titled "initDb()
   migrates before first request (HOST-02)"), exists specifically to prove this behavior.
   This directly contradicts the owner-stated premise recorded above ("migrations are already
   decoupled") and names the exact mechanism that would force a redeploy (container restart)
   every time a schema change ships — a precise structural match for this pain point. Not
   established: whether this specific app is the one the owner recalls causing redeploys, or
   whether other apps built the same way also do this — tier 1 stopped at the first decisive
   hit per the timebox, so the two other candidate repos with their own Dockerfile
   (`Fitness Coach`, `saas-boilerplate`) were not individually inspected for the same pattern
   and stay UNKNOWN. See `docs/decisions.md` D14 for the resulting decision-log entry and D8's
   updated status.

## 8. Open risks

| # | Risk | Status |
|---|---|---|
| R1 | **Restore drilled and timed by hand (2026-09-07) — both a table-drop-in-place restore and a full container/volume rebuild restore succeeded.** Scope: owner's own data only, no third-party data at risk today. Evidence: `docs/20-restore-runbook.md`. Open sub-risk carried forward, not closed: the globals/roles restore path was NOT EXERCISED in this drill (see runbook) — only `pnpm db:drill`'s disposable container currently proves it. | **DRILLED AND TIMED (see docs/20-restore-runbook.md); globals-restore path still unproven on a genuinely role-empty cluster** |
| R2 | Possibly a single superuser credential used for all purposes | Unverified |
| R5 | Avoiding SSH may push toward riskier exposure options instead | Under discussion |
| R6 | Greenfield comfort may cause safety work to be deferred until data exists — at which point it is a retrofit again | Active, by design |

*(R3 schema drift and R4 untrusted history no longer apply to the recipe app.)*
