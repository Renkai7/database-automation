# Decision Log

Running record of architectural decisions. Every entry carries a status so that
proposals are never mistaken for settled decisions.

**Statuses:** `PROPOSED` · `ACCEPTED` · `REJECTED` · `SUPERSEDED` · `OPEN`

---

## D1 — Dev database runs as a local Docker container
**Status:** PROPOSED · 2026-09-06

Postgres in Docker on the local Windows machine rather than a Windows-installed service.

**Why:** The brief requires dev to be recreatable and a destructive mistake there to be
harmless. A container gives a clean `down -v` reset and version-matches production.
Docker is already installed; no local Postgres currently is.

**Consequence:** The entire MVP loop needs no remote connectivity whatsoever.

---

## D2 — MVP is dev-only; no remote access in phase 1
**Status:** PROPOSED · 2026-09-06

Build and prove `schema change → generate migration → analyze SQL → apply to dev →
test → commit` entirely locally before any connectivity decision is made.

**Why:** Defers the exposure decision until the safety machinery exists. Matches the
brief's instruction not to connect the MVP to production until the architecture is tested.

---

## D3 — Production gets no live database connection from the local machine
**Status:** PROPOSED · 2026-09-06

Two mechanisms instead:
- **Visibility:** CI runs `pg_dump --schema-only` against production and commits the
  result to the repo, so the real production schema can be reasoned about with no
  credential and no network path.
- **Change:** migrations execute from CI using a credential held only in the secret
  store, gated by the safety analyzer.

**Why:** The brief's core principle — prefer architectural prevention over remembered
caution. Access that does not exist cannot be leaked or misused.

---

## D4 — Staging connectivity mechanism
**Status:** OPEN · 2026-09-06

Options under consideration:

| Option | Inbound ports | Notes |
|---|---|---|
| **Tailscale / Headscale** | **None** | Server dials out; private mesh; ACL-restrictable. Recommended. Bootstrappable via Hetzner web console without SSH. |
| **Restricted SSH key** | 22 (already open) | Key confined with `restrict,permitopen="host:5432",command="/bin/false"` — can forward to one port, cannot get a shell. |
| **Coolify public port** | New DB port | Simplest to set up, widest exposure. Not recommended. |

**Blocked on:** confirming Coolify's networking setup (§4 of current-state) and the
owner's preference.

---

## D5 — Risk assessment: SSH vs. exposed database port
**Status:** ACCEPTED (analysis, not yet an action) · 2026-09-06

Declining to *use* SSH does not reduce attack surface if Coolify already manages the
host over SSH — port 22 is then already open and listening regardless. Meanwhile an
exposed PostgreSQL port is the higher risk of the two: OpenSSH with password auth
disabled is heavily hardened, whereas Postgres is not designed as an internet-facing
daemon and a leaked password there is direct access to user data.

**Therefore:** "no SSH, but a public database port" is the one combination to avoid.

**To verify:** whether port 22 is in fact open (see current-state §4).

---

## D6 — A greenfield recipe app is the test fixture
**Status:** ACCEPTED · 2026-09-06

The pipeline is built and proven against a new recipe application with no users and no
data, rather than retrofitted onto a live system.

**Why:** Safety machinery can be tested destructively — including restore drills — at
zero cost. The app arrives into a finished safety system instead of the reverse.

**Consequence / risk:** the app is a fixture, not the deliverable. Guard against the
project drifting into app-building. See risk R6.

---

## D7 — Backup restore drills move early (Phase 1)
**Status:** ACCEPTED · 2026-09-06

Restore testing happens immediately after the local foundation, not near production.

**Why:** A restore has never been tested (confirmed risk R1). The only cost-free moment
to learn the procedure is while the data is fake. Learning it after real users exist
means learning it under pressure, during an incident.

**Consequence:** backup status stays UNKNOWN — never PASS — until a restore has been
performed by hand, timed, and documented.

**Consequence discharged — 2026-09-07:** A restore has now been performed by hand,
timed, and documented. The owner personally dropped `recipes` (with `CASCADE`) from the
live local development database and restored it in place, then destroyed the container
and its volume entirely and rebuilt the cluster from both dumps — both acts succeeded
and were confirmed via row counts, spot-checked values, and the rendered Recipe Page.
See `docs/20-restore-runbook.md` for the full procedure and what actually happened,
including one open sub-risk carried forward: the globals/roles restore path was not
genuinely exercised in this drill (the rebuilt cluster was never role-empty), so it
remains proven only by `pnpm db:drill`'s disposable container, not by this human drill.

---

## D8 — Migrations never run at application startup
**Status:** ACCEPTED · 2026-09-06 (moved from PROPOSED — see D14)

Migration execution is a separate, gated pipeline step. The application container never
migrates itself on boot.

**Why:** This is the direct fix for the redeploy problem. Coupling the two means the only
way to migrate is to restart the app, and the only way to restart is to redeploy — with
no gate between "migration generated" and "migration runs against user data". Decoupled,
deploys become boring because the schema is already correct when the new container starts.

**Confirmed necessary, not just a reasonable default:** D14's Phase 1 investigation found
this exact coupling — migrate-on-boot — live in an existing deployed application, which is
what moved this entry from PROPOSED to ACCEPTED.

---

## D9 — PostgreSQL 17 pinned across all environments
**Status:** ACCEPTED · 2026-09-06

Dev, staging, and production all run PostgreSQL 17. The client tooling image
(postgres:17-alpine) is pinned to match.

**Why:** Several migration safety rules are version-conditional, so the pinned version is
a dependency of the analyzer's rule catalogue rather than merely a container tag. PG11 made
non-volatile ADD COLUMN defaults near-instant while volatile defaults still rewrite the
table; PG12 allows SET NOT NULL to skip its table scan when a validated NOT VALID check
constraint already proves non-nullability. Pinning one version everywhere removes a class
of "safe in dev, locking in production" surprises.

Pinning the client image to the server major also removes the pg_dump/pg_restore version
drift that produces restores which appear to succeed but are incomplete.

**Consequence:** analyzer rules may assume PG17 semantics. Revisit if any environment
must run an older major.

---

## D10 — Safety analyzer parses SQL; it does not pattern-match
**Status:** ACCEPTED · 2026-09-06

The classifier is built on libpg-query (the real PostgreSQL parser compiled to WASM,
Windows-viable with no native build step), operating on the parsed AST. squawk-cli is used
as an independent second opinion and rule-catalogue reference.

**Why:** Regex-based SQL analysis fails in both directions — comments, dollar-quoted
strings, DO blocks and function bodies produce both false passes and false blocks. An
analyzer that can be fooled by a comment is worse than no analyzer, because it manufactures
confidence. Atlas was rejected: its PostgreSQL destructive-change analyzers moved behind a
paid tier in late 2025, which is precisely the capability we would adopt it for.

---

## D11 — Drizzle pinned to the stable line, not v1.0.0-rc
**Status:** ACCEPTED · 2026-09-06

drizzle-orm 0.45.2 and drizzle-kit 0.31.10.

**Why:** The v1.0.0 line is at rc.4 and is not recommended for production by its
maintainers. More decisively, it removes _journal.json entirely — the mechanism the
audit-trail requirement depends on.

---

## D12 — Classification is re-derived at execution time
**Status:** ACCEPTED · 2026-09-06

The migration runner parses and classifies the actual SQL immediately before executing it.
It never trusts a classification computed by an earlier pipeline stage and passed downstream.

**Why:** This is the only enforcement point that cannot be bypassed from inside the system.
Pre-commit hooks are advisory (--no-verify). Classic branch protection is admin-bypassable
by default, which for a solo founder means self-bypassable. GitHub rulesets with an empty
bypass list are non-bypassable at PR time, but a gate that classifies upstream and passes a
verdict downstream still lets anything that alters the SQL after classification through.

**Known limitation, recorded honestly:** GitHub environment "required reviewers" permits
self-approval. For a team of one, the REVIEW REQUIRED gate buys deliberation with assembled
context — the diff, the reason, staging results — not independent review. The system must
not imply a guarantee it cannot provide.

---

## D13 — UI imported as-is; backend stays thin
**Status:** ACCEPTED · 2026-09-06

The recipe app's UI comes from a Claude Design hand-off and is brought over without design
changes. Backend functionality remains minimal — enough to boot, hold a real schema, and
generate the schema churn the pipeline needs.

**Why:** A real designed UI gives the schema something concrete to model, which is better
test material than invented tables. The fixture constraint (D6) was always about backend
and feature depth displacing pipeline work, not about the UI looking unfinished.

**Boundary:** importing screens and styling is in scope. Building out the application
features those screens imply is not, unless the fixture scope is explicitly revisited.

**Blocked on:** Claude Design authorization. The claude_design MCP server is registered at
user scope but returns HTTP 403 until /design-login is run from an interactive session;
the built-in DesignSync tool reports the same. Import is pending that step.

---

## D14 — Redeploy root-cause investigation: migrate-on-boot confirmed in an existing app
**Status:** ACCEPTED · 2026-09-06

Phase 1's D-25/D-26/D-27 timeboxed investigation (tier 1: existing-repo inspection) found
that `AI-Diagramming-Tool` — a sibling repository deployed to Coolify at
`app.frametrue.dev`, per its own `docker-compose.coolify.yml` — runs Drizzle migrations at
application boot: `apps/api/src/index.ts` calls `initDb()` before accepting any traffic,
and `initDb()` (`apps/api/src/db/client.ts`) runs `drizzle-orm/node-postgres/migrator`'s
`migrate()` against `DATABASE_URL` on every container start. That repo's own
`pg-pool-migrate-on-boot.test.ts` exists specifically to prove this behavior.

**Why this is a decision, not just a finding:** it directly contradicts the owner-stated
premise recorded in `docs/00-current-state.md` §2 ("migrations are already decoupled from
application deploys"), and it names the exact mechanism — migrate-on-boot — that forces a
container restart (a redeploy) every time a schema change ships. That is a precise
structural match for pain point 2 in `docs/00-current-state.md` §7.

**Consequence:** D8 ("migrations never run at application startup") moves from PROPOSED to
ACCEPTED — confirmed necessary by direct evidence in the owner's own prior work, not merely
a reasonable-sounding default.

**Scope note, honestly recorded:** whether `AI-Diagramming-Tool` specifically is the app the
owner recalls causing redeploys, or a different app built the same way, was not
established — tier 1 stopped at this decisive hit per the D-25 timebox. Other candidate
repos with their own Dockerfile (`Fitness Coach`, `saas-boilerplate`) were not individually
inspected for the same pattern and remain UNKNOWN. Tiers 2-4 (Coolify deployment history,
git history, owner recollection) were not attempted, since tier 1 already satisfied D-26's
own stated stopping condition ("if a migration command is wired into a container start
path, then D8 is already the fix and the investigation is complete").
