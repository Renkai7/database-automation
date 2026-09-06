# Database Deployment Automation

## What This Is

A safety system around PostgreSQL schema changes for a solo founder who develops with AI
coding agents. It gives an agent real access to development databases and a governed path
to production, so that routine database work is automated while an agent mistake cannot
damage production data. A greenfield recipe application is built alongside it as the test
fixture that exercises the pipeline.

## Core Value

A schema change reaches production without anyone hand-running SQL, and no AI mistake can
destroy production data — because the architecture prevents it, not because anyone
remembered to be careful.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Claude Code can inspect and modify a development database directly, with no manual
      relaying of commands through a Coolify terminal
- [ ] A schema change becomes a generated, inspected, tested, committed migration
- [ ] Migration SQL is automatically classified SAFE / REVIEW REQUIRED / BLOCKED before it
      can advance, with rules that are extensible data rather than hardcoded
- [ ] Destructive operations are blocked mechanically — proven by attempting them
- [ ] Migration history applies cleanly to an empty database, and new migrations apply to
      an existing one
- [ ] A backup can be restored by a procedure the owner has personally performed and timed
- [ ] An automated restore test runs against a disposable database
- [ ] Migrations run as a gated pipeline step, never at application startup, so schema
      changes require no redeploy
- [ ] Remote databases are reachable without exposing a database port to the internet
- [ ] Production migration credentials exist only in CI, never on the local machine
- [ ] Every production migration is auditable: id, commit, environment, result,
      classification, timestamp — with no secrets logged
- [ ] The owner supervises via a status summary rather than operating the database

### Out of Scope

- **Multi-project platform** — deferred to Phase 7. The brief explicitly says not to build
  the reusable controller before one application proves the pipeline.
- **Production access from the local machine** — architecturally excluded, not deferred.
  Visibility comes from committed schema snapshots; changes come from CI.
- **Prisma** — Drizzle ORM is the chosen ORM.
- **A polished recipe application** — it is a thin test fixture. Depth was explicitly
  scoped down so pipeline work is not displaced by app work.
- **Automatic database rollback** — DB rollback is often more dangerous than app rollback.
  The strategy is backwards-compatible migrations, backups, and forward fixes.
- **Retrofitting the existing SaaS apps** — out of scope for v1; revisit at Phase 7.

## Context

**Origin.** Two concrete problems drove this. First, Claude Code could not reach databases
running as Docker containers inside Coolify, so every inspection meant the owner pasting
commands into the Coolify terminal and relaying output by hand. Second, production
redeploys were needed too often to apply schema changes, which the owner judged unworkable
for a professional environment. The root cause of the redeploys is still unidentified —
migrations are reportedly already decoupled from deploys in the existing setup.

**Greenfield advantage.** Nothing exists yet. The guardrails get built before anything of
value does, so destructive scenarios can be triggered deliberately and restores practised
repeatedly at zero cost. This inverts the usual retrofit problem.

**Confirmed risk.** A database backup restore has **never** been tested. This is the single
confirmed operational risk and is why restore drills sit at Phase 1 rather than near
production — the only cost-free moment to learn the procedure is while the data is fake.

**Existing applications.** The owner has other SaaS work on the same Coolify/Hetzner
infrastructure. Those hold only the owner's own data — no third-party user data — so there
is no urgent live exposure. That also removes the deadline pressure that would normally
force safety work, which is itself a risk to this project.

**Prior discovery.** Committed in `docs/`: `original-brief.md` (source brief),
`00-current-state.md` (operational inventory), `decisions.md` (D1-D8), `10-roadmap.md`
(8-phase plan). The owner had no written notes on their own operation before this; producing
them is a deliverable.

**Local environment (verified).** Windows 11, Docker 29.6.1, Node v24.19.0, pnpm 10.25.0.
No local PostgreSQL running; `psql` not on PATH.

**Pending input.** A UI hand-off for the recipe app will be supplied by the owner. It shapes
the schema but does not block the database work.

## Constraints

- **Tech stack**: PostgreSQL, Drizzle ORM + Drizzle Kit, Node.js/TypeScript, pnpm, GitHub
  Actions, Coolify, Hetzner — the owner's existing self-hosted stack. **Not Prisma.**
- **Security**: No production database credentials on the local development machine —
  the central architectural constraint, not a preference.
- **Security**: No database port exposed to the public internet. Remote access must use a
  mechanism that adds no inbound attack surface.
- **Operating model**: Solo founder. Must be robust without requiring an infrastructure
  team to run it. Avoid enterprise complexity.
- **Platform**: Development is on Windows, so tooling must work there — not Linux-only scripts.
- **Sequencing**: No connection to a real production database until the safety architecture
  exists and has been tested.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Prefer architectural enforcement over remembered caution | A safeguard that depends on an agent choosing to behave is not a safeguard | — Pending |
| Greenfield recipe app as test fixture (D6) | Safety machinery can be tested destructively at zero cost; the app arrives into a finished system | — Pending |
| Recipe app stays a thin fixture | Prevents pipeline work being displaced by app work | — Pending |
| One repo, two folders (automation + app) | Simplest to build; the central-vs-app boundary is drawn at Phase 7 | — Pending |
| Backup restore drills move to Phase 1 (D7) | Restore has never been tested; learning it during an incident is the failure mode | — Pending |
| Migrations never run at application startup (D8) | Direct fix for the redeploy problem; decouples schema changes from deploys | — Pending |
| No production DB access from the local machine (D3) | Access that does not exist cannot be leaked or misused | — Pending |
| Dev database runs as a local Docker container (D1) | Recreatable and disposable, so a destructive mistake is harmless | — Pending |
| Staging connectivity mechanism (D4) | Tailscale preferred (zero inbound ports); restricted SSH key with permitopen as alternative | — Pending, open |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-09-06 after initialization*
