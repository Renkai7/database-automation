# Phase 6: Private Staging Connectivity - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-09
**Phase:** 6-Private Staging Connectivity
**Areas discussed:** D4 resolution + verification, How the runner targets staging, Credentials & who holds what, Staging shape & trigger

---

## D4 resolution + verification

### Q1 — Which connectivity mechanism?

The first question offered was whether to lock a mechanism now or run recon first. The owner
instead asked a question of their own: *"How about WireGuard? Does that work for this?"* — which
reframed the shortlist. A full comparison was given (Tailscale is WireGuard plus a coordination
layer; raw WireGuard needs an inbound UDP listener and has no good ephemeral-CI story; Headscale
is the self-hosted middle at the cost of running a service). The owner then stated the deciding
constraint: *"I am aiming for a self-hosted setup with control. If WireGuard grants that then I
would go with it. With that being said, if WireGuard becomes a new project to set up then we may
need to defer it for another milestone or project since this project is about automating our
database and the security for it."*

| Option | Description | Selected |
|--------|-------------|----------|
| Restricted SSH + permitopen | Fully self-hosted with no control plane and no third party at all, no new service, no new inbound port, minutes to set up. D5 already argues port 22 is open regardless. Weaker/coarser ACLs and a long-lived CI key, both stated honestly in the record. | ✓ |
| Headscale (self-hosted) | Full control plus ephemeral nodes and declarative ACLs. But a service to run, secure, upgrade and back up; needs a public HTTPS endpoint and domain; hosting it on the same box makes the access path depend on the box it accesses. | |
| Raw WireGuard | Self-hosted, same crypto as Tailscale. Server side is quick; the CI side is the real work (static long-lived key with no per-run identity, or peer-provisioning automation that gives CI write access to the server). Adds inbound UDP/51820 and hand-written routing to the Docker subnet. | |
| Tailscale (hosted) | Best CI story by a distance — OAuth + GitHub OIDC creates a short-lived ephemeral tagged node per run that removes itself. Literally zero inbound ports. Cost is a third-party control plane. | |

**User's choice:** Restricted SSH + permitopen.
**Notes:** Chosen on the owner's own framing — restricted SSH is *more* self-hosted than Headscale
(no control plane at all) while costing one `authorized_keys` line. The owner followed up with two
questions: whether the choice leaves the door open to WireGuard later, and whether the setup would
transfer to Forgejo. Both were answered at length; the WireGuard answer produced Q2 below, and the
Forgejo answer was recorded as a deferred idea at MEDIUM confidence.

### Q2 — How hard to enforce the mechanism-agnostic seam?

| Option | Description | Selected |
|--------|-------------|----------|
| Enforce the seam explicitly | Connectivity established by a separate named step whose only contract is "after me, the staging URL connects." Rules out the forced-command variant; forces the staging pin to assert database + role rather than a literal host:port. | ✓ |
| Keep it clean, don't over-constrain | Write it the natural way with SSH, keep tunnel setup in its own step, but don't rule out the forced-command variant if recon shows it's the only thing Coolify allows. | |
| Don't design for the swap | Build the most direct thing that works; treat a future WireGuard/Headscale move as its own project with its own rewrite. | |

**User's choice:** Enforce the seam explicitly.
**Notes:** This is what makes the WireGuard deferral honest rather than notional. Two binding
consequences were recorded: `ARCHITECTURE.md:144`'s forced-command variant is out, and the staging
pin cannot use a literal host:port — resolved in the runner area by asserting something stronger,
never by weakening the guard.

### Q3 — How wide should the hands-on Coolify recon go?

| Option | Description | Selected |
|--------|-------------|----------|
| Close all of §4 as a document | Answer every open item in `docs/00-current-state.md` §4 and §6 and commit the result. Criterion 1 names volume/backup explicitly, so a connectivity-only recon wouldn't satisfy it as written. Feeds Phase 7 too. | ✓ |
| Targeted to connectivity | Verify only what the SSH tunnel decision depends on. Faster; leaves §4 partly UNKNOWN and defers criterion 1's volume/backup clause. | |
| Verify as you go | No separate recon task — record whatever turned out to be decision-relevant. | |

**User's choice:** Close all of §4 as a document.

### Q4 — How is "no new inbound database port" proven?

| Option | Description | Selected |
|--------|-------------|----------|
| Performed record, three vantages | External scan from off-host, host-side `ss -tlnp`, and the Coolify toggle state — recorded verbatim, following D-18's precedent. Each answers a different question. | ✓ |
| Performed record + continuous CI probe | The above plus a scheduled CI job attempting a connection to the public IP on 5432. Caveat: puts the host IP in GitHub Secrets on a public repository and risks leaking it into a log. | |
| Host-side and Coolify only | Skips the external vantage — the one that actually reflects the threat model. | |

**User's choice:** Performed record, three vantages.

---

## How the runner targets staging

### Q1 — What shape does the staging runner take?

| Option | Description | Selected |
|--------|-------------|----------|
| A second pinned entry point | `scripts/db-migrate-staging.ts`, a thin sibling over the identical `runMigrations` core. "No command accepts a target" stays literally true. ~40 lines of duplicated wiring, assertions deliberately divergent. | ✓ |
| One entry point, --env flag | Single code path, no duplication, flag names an environment not a URL. But reintroduces "a command accepts a target" in spirit. | |
| One entry point, inferred | Least code, most dangerous — destination becomes a property of ambient environment rather than of the command. | |

**User's choice:** A second pinned entry point.

### Q2 — What is the staging pin pinned on, given it can't use a literal host:port?

| Option | Description | Selected |
|--------|-------------|----------|
| Ask the server, not the URL | Static half checks only mechanism-independent facts; load-bearing half is dynamic — `SELECT current_database()` and `current_user`. Stronger than the dev pin, because it's a fact from the server rather than a string in a URL. | ✓ |
| Static database-name pin only | Mirrors the dev pin's shape, skips the round trip. But trusts a connection string that under a tunnel describes a local port, not the destination. | |
| Environment label in the connection | Explicit and readable, but asserts what the caller claims rather than what is true. | |

**User's choice:** Ask the server, not the URL.

### Q3 — Closing the loopback collision

A hazard surfaced during discussion and was presented before this question: `ssh -L` makes a
remote staging database appear at `127.0.0.1:5432`, so two of `assertLocalDevelopmentTarget`'s
three checks already match staging with a tunnel open — only the database name stands between
`drizzle-kit push` and the staging schema.

| Option | Description | Selected |
|--------|-------------|----------|
| Server-side environment marker | The dev container's init script (already mounted) seeds a marker reading `development`; staging's reads `staging`. Absent or unreadable is treated as failure, never as pass. A tunnel cannot fake it. | ✓ |
| Naming and port discipline only | Require `recipe_staging` and a non-5432 forwarded port. Zero new code, but both are conventions someone must remember. | |
| Pin on the connected role | Also check `current_user`. Uses credentials CONN-05 requires anyway, but weaker if a role name is ever reused, and entangles the guard with the credential design. | |

**User's choice:** Server-side environment marker.
**Notes:** Marker mechanism (table vs. database `COMMENT` vs. custom GUC) left to Claude's
discretion. Naming and port hygiene come along as free extras, explicitly not as the guard.

### Q4 — What form does CONN-03's proof take?

| Option | Description | Selected |
|--------|-------------|----------|
| Performed record + automated test | Owner opens the tunnel and actually runs `drizzle-kit push`, recording verbatim; alongside it a Testcontainers test with the `staging` marker asserts refusal, plus the positive half. | ✓ |
| Automated test only | Never goes stale, but criterion 3's wording is "proven by attempting it," and a test asserting an assertion is not that claim. | |
| Performed record only | Most literal reading, cheapest. Proves it once; nothing keeps proving it. | |

**User's choice:** Performed record + automated test.

---

## Credentials & who holds what

### Q1 — Which reading of "more restricted than the application's credential"?

Presented with the tension named up front: the migrator does DDL, which is normally the *more*
privileged job, and `0003_backfill_steps_timer_label.sql` is a committed `UPDATE` backfill that a
no-data-access role would refuse.

| Option | Description | Selected |
|--------|-------------|----------|
| Each denied what the other needs | `recipe_app` DML-only; `recipe_migrator` owns the schema but is NOSUPERUSER/NOCREATEDB/NOCREATEROLE, one database, connection-limited, CI-tunnel-only. Neither is the Coolify superuser. | ✓ |
| Migrator gets no data access | Best match to the threat model — reshape the schema, never read a row. Blocked by Postgres having no clean write-without-read, and by the committed 0003 backfill. | |
| Restrict by reachability only | Simplest to implement, hardest to verify as a privilege claim. | |

**User's choice:** Each denied what the other needs.

### Q2 — How do the roles come into existence?

| Option | Description | Selected |
|--------|-------------|----------|
| Committed idempotent SQL, run once | Creates all roles, sets grants, and sets `ALTER DEFAULT PRIVILEGES` so future migrations' tables are auto-granted to the app role. Run once over the tunnel with the Coolify credential; Phase 7 reruns it against production. | ✓ |
| Bootstrap by hand, record after | Less machinery, but makes production a from-notes repeat and turns privileges into a claim about a document. | |
| Keep the Coolify credential as the app role | Avoids touching the app's DATABASE_URL, but the generated user is typically the owner, so the app keeps DDL — defeating half of criterion 4. | |

**User's choice:** Committed idempotent SQL, run once.
**Notes:** The `ALTER DEFAULT PRIVILEGES` clause was called out as the load-bearing part —
without it every new migration needs a remembered manual grant.

### Q3 — Which credential does the dev machine get?

| Option | Description | Selected |
|--------|-------------|----------|
| A third read-only role | `recipe_readonly`, SELECT only. Makes "no one pasting a command" structurally true — the machine physically lacks a credential that could migrate. | ✓ |
| The app role | No new role, sees what the app sees. But carries INSERT/UPDATE/DELETE, so a runaway agent could mutate staging from the laptop. | |
| No standing credential | Strictest; makes criterion 2's demonstration depend on a retrieval mechanism that doesn't exist. | |

**User's choice:** A third read-only role.

### Q4 — May Claude Code see the staging credential?

| Option | Description | Selected |
|--------|-------------|----------|
| Split by capability, not environment | A credential that can only read may be agent-visible; one that can change anything may not. Read-only staging URL sits locally and is used freely; migrator credential and CI SSH key live only in GitHub. Two distinct SSH keys, independently revocable. | ✓ |
| Staging credential kept from the agent | Minimal blast radius, but depends on an agent choosing to behave — not a safeguard — and defeats the inspection this project exists to enable. | |
| No staging credential locally at all | Cleanest local surface; makes criterion 2's demonstration depend on a retrieval mechanism this phase would then have to build. | |

**User's choice:** Split by capability, not environment.

---

## Staging shape & trigger

### Q1 — What gets provisioned in Coolify?

Presented with the observation that criterion 4's "with no application redeploy" is only an
observable claim if an application is actually running.

| Option | Description | Selected |
|--------|-------------|----------|
| Postgres + the recipe app | Makes criterion 4 verifiable — the app keeps serving on an unchanged container while the schema changes underneath. Exercises `recipe_app`'s grants for real. | ✓ |
| Postgres only | Cheapest and most focused, but "no application redeploy" becomes a claim about something that isn't there. | |
| Postgres + a connection probe | Proves continuity cheaply, but is bespoke, and "the app kept running" would still be untested. | |

**User's choice:** Postgres + the recipe app.

### Q2 — What triggers the staging migration?

| Option | Description | Selected |
|--------|-------------|----------|
| Merge to main | main is already protected by the Phase 5 ruleset with required checks and an empty bypass list. No new branch model, no extra merge step on a solo repo. | ✓ |
| A dedicated staging branch | Decouples merged from deployed; costs a second protected branch and an extra merge per change. | |
| Manual dispatch | Maximum control, but criterion 4 says "automatically." | |

**User's choice:** Merge to main.

### Q3 — Where do the staging secrets live?

| Option | Description | Selected |
|--------|-------------|----------|
| A staging Environment, branch-restricted | Environment holds both secrets with its deployment branch rule restricted to main. The restriction is load-bearing: on a public repo, branch PRs do receive repository secrets. Exactly the shape Phase 7 adds reviewers to. | ✓ |
| Repository-level secrets | Simplest, but every job including PR-branch jobs can read them. | |
| Environment with protection rules now | Proves the approval machinery early, but pulls Phase 7's gate forward and makes staging non-automatic. | |

**User's choice:** A staging Environment, branch-restricted.

### Q4 — What happens when a staging migration fails?

| Option | Description | Selected |
|--------|-------------|----------|
| Fail loudly, no snapshot | Workflow fails and opens/updates a tracking issue (restore-drill.yml's pattern); schema left as the runner left it; no automatic rollback. Staging is rebuildable from migrations plus seed. | ✓ |
| Fail loudly, with pre-migration dump | Rehearses PROD-02's "current backup status" in the cheap environment. Real work, and arguably Phase 7's. | |
| Fail the workflow only | Lightest, but a red push-to-main run is easy to miss. | |

**User's choice:** Fail loudly, no snapshot.

---

## Claude's Discretion

- The environment marker's mechanism (table, database `COMMENT`, or custom GUC) — the decision is
  that a fail-closed server-side marker exists; the shape is open.
- Tunnel lifecycle in CI: composite action vs. script vs. inline steps, how it waits for the
  forwarded port, and what happens if the tunnel dies mid-migration.
- Whether the dev machine's tunnel is on-demand or a persistent helper, and how it's documented
  for Windows.
- SSH key passphrase handling and how CI supplies one.
- The bootstrap script's location, name, and idempotency mechanism, and whether it is invoked
  through a `pnpm` script.
- Whether `recipe_migrator` owns `runner.migration_runs` and the drizzle ledger on staging.
- Filenames and locations for the three performed records, and whether the recon updates
  `docs/00-current-state.md` in place or lands as a new numbered document.
- How staging's seed data is managed.
- Whether the role-bootstrap SQL passes through the safety analyzer.
- The staging workflow's file layout and job naming.

## Deferred Ideas

- WireGuard or Headscale as the connectivity mechanism — a later milestone or its own project,
  deferred on the owner's own reasoning. The enforced seam keeps the swap cheap.
- Forgejo migration — MEDIUM confidence assessment recorded in CONTEXT.md: most of the repository
  transfers, the ruleset-checking jobs and Phase 7's environment gate do not, and the SSH choice
  makes the move easier than Tailscale would have.
- A continuous CI probe asserting no public database port — declined on public-repo IP-leak grounds.
- A pre-migration `pg_dump` of staging, and extending Phase 2's backup tooling past its local pin —
  Phase 7 scope.
- A migration role with no data access at all — blocked by Postgres semantics and the committed
  0003 backfill; revisit if backfills ever separate from schema migrations.
- Environment protection rules, required reviewers, the REVIEW REQUIRED self-approval gate, the
  real audit log, and per-rule override-frequency counting — Phase 7, unchanged.
- Automatic database rollback — `PROJECT.md` Out of Scope.
- Retrofitting the other Coolify applications onto this pipeline — Phase 7 at the earliest; the
  recon will surface facts about them, to be recorded and not acted on.
