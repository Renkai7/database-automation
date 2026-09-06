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

---

## D8 — Migrations never run at application startup
**Status:** PROPOSED · 2026-09-06

Migration execution is a separate, gated pipeline step. The application container never
migrates itself on boot.

**Why:** This is the direct fix for the redeploy problem. Coupling the two means the only
way to migrate is to restart the app, and the only way to restart is to redeploy — with
no gate between "migration generated" and "migration runs against user data". Decoupled,
deploys become boring because the schema is already correct when the new container starts.
