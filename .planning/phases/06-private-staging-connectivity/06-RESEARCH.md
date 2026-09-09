# Phase 6: Private Staging Connectivity - Research

**Researched:** 2026-09-09
**Domain:** Private network connectivity to a self-hosted Coolify/Postgres instance (restricted SSH tunneling), GitHub Environments/secrets scoping, PostgreSQL least-privilege role design, CI-triggered migrations
**Confidence:** MEDIUM — the SSH/OpenSSH mechanics, PostgreSQL role/privilege semantics, and GitHub Environments API shape are HIGH (official docs, fetched directly this session). Coolify's specific networking/volume/backup behavior is MEDIUM (community sources, cross-checked, never a formal spec) — and per this phase's own criterion 1, that gap is closed by **hands-on verification against the owner's real instance**, not by this document. Where this document's recommendation depends on that unverified behavior, it is flagged explicitly as a hypothesis to confirm, not a fact.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D4 closes as a restricted SSH key with `permitopen` (D-01).** One line in `authorized_keys` of the form `restrict,permitopen="<stable-destination>:5432",command="/bin/false" ssh-ed25519 …`. Rejected: Headscale (a new project/service to run), raw WireGuard (no per-run CI identity without either a static key or peer-provisioning automation; opens inbound UDP), hosted Tailscale (best CI story, rejected on the owner's own "self-hosted with control" framing — third-party control plane).

**The connection is a mechanism-agnostic seam, enforced explicitly (D-02).** Connectivity is established by a separate, named step whose entire contract is "after me, the staging URL connects." Nothing downstream may reference SSH. `ARCHITECTURE.md:144`'s forced-command variant is ruled out. The staging pin cannot assert a literal host and port.

**The hands-on recon closes all of `docs/00-current-state.md` §4 and §6 as a committed document (D-03).** Server count/specs, Coolify version, port 22 status, Hetzner Cloud Firewall inbound rules, any enabled database public port, resource-vs-compose-service management, Docker network/container address stability across redeploys, volume/backup behavior, secret locations. The subnet-stability answer is load-bearing for D-01's `permitopen` destination.

**Criterion 2's "no new inbound database port" is proven by one performed record covering three vantages (D-04):** external scan from off-host, host-side `ss -tlnp`, and the Coolify "Publicly Accessible" toggle state — written verbatim following `05-CONTEXT.md` D-18's precedent. A continuous CI probe was considered and declined (host IP in GitHub Secrets on a public repo, log-leak risk).

**A second pinned entry point, `scripts/db-migrate-staging.ts` (D-05):** a thin sibling of `scripts/db-migrate.ts` over the identical `runMigrations` core, reading its own environment variable and asserting its own staging pin. Keeps "no command accepts a target" literally true. Rejected: a `--env staging` flag, or inferring environment from ambient variables.

**The staging pin asks the server, it does not trust the URL (D-06).** Static half checks only mechanism-independent facts (database name `recipe_staging`, refused if it would satisfy the dev pin). Dynamic half: `SELECT current_database()` and `current_user`, refused unless both match.

**A server-side environment marker closes the loopback collision, fail-closed (D-07).** `ssh -L` makes a remote staging database appear at `127.0.0.1:5432`; the dev container's init script seeds a marker reading `development`, staging's reads `staging`. `assertDevelopmentDatabase` additionally requires the marker to read `development`; absent/unreadable is always failure, never pass. **[Research finding: this decision's stated seeding mechanism — an "already mounted" container init script — does not exist in this repository and is blocked by a live guardrail test. See RESEARCH.md Common Pitfalls, Pitfall 1, for the corrected mechanism that preserves this decision's intent.]**

**CONN-03 is proven twice: a performed attempt and an automated test (D-08).** The owner opens the tunnel and actually runs `drizzle-kit push`, recording verbatim what it says. Alongside it, a Testcontainers test carrying the `staging` marker asserts refusal, plus the positive half (push still works against the real dev container).

**Three roles, each denied what the others need (D-09):** `recipe_app` (DML only, no CREATE/ALTER/DROP), `recipe_migrator` (owns the schema, NOSUPERUSER/NOCREATEDB/NOCREATEROLE, one database, connection-limited, CI-tunnel-only), `recipe_readonly` (SELECT only, the dev machine's credential). Rejected: a migrator with no data access at all (blocked by Postgres's lack of write-without-read and the committed `0003` backfill), restricting by reachability alone.

**The roles are created by a committed, idempotent SQL bootstrap script, run once over the tunnel with a performed record (D-10).** Creates all three roles, sets grants, and sets `ALTER DEFAULT PRIVILEGES FOR ROLE recipe_migrator … GRANT … TO recipe_app` so future migrations' tables are auto-granted. The Coolify-issued credential is used exactly once, for this bootstrap. Phase 7 reruns the same script against production. **[Research finding: `ALTER DEFAULT PRIVILEGES` alone is not sufficient — see Pitfall 4 for the required present-tense `GRANT` this decision's script must also contain.]**

**The development machine gets `recipe_readonly` and only that (D-11).** Makes "no one pasting a command" and CONN-04's automatic-only path structurally true.

**Secrets split by capability, not by environment (D-12).** A credential that can only read may live on the development machine and be agent-visible; a credential that can change anything may not. `recipe_readonly`'s staging URL sits locally, agent-visible. `recipe_migrator`'s credential and the CI SSH key exist only in GitHub. Two distinct SSH keys, independently revocable.

**Staging is a Postgres resource *and* the recipe app deployed alongside it (D-13).** Makes criterion 4's "no application redeploy" an observable claim rather than a statement about something that isn't there.

**Merge to `main` triggers the staging migration (D-14).** `main` is already protected by the Phase 5 ruleset with required checks and an empty bypass list. Rejected: a dedicated `staging` branch, `workflow_dispatch` (not "automatic").

**A GitHub Environment named `staging`, with its deployment branch rule restricted to `main`, holds the SSH key and the `recipe_migrator` credential (D-15).** The branch restriction is load-bearing, not the Environment itself: on a public repository, pull requests from (non-fork) branches do receive repository secrets. No protection rules and no required reviewers here — that is Phase 7's.

**A failed staging migration fails loudly and opens or updates a tracking issue; the schema is left as the runner left it; there is no pre-migration snapshot (D-16).** `.github/workflows/restore-drill.yml`'s tracking-issue pattern is reused. No automatic rollback. Staging is rebuildable from migration history plus seed.

**Carried forward, binding, not re-decided here:** the runner is the wall, every gate upstream sits on a bypassability spectrum (D12); classification is re-derived at execution time (D12); BLOCKED is the wall, REVIEW REQUIRED proceeds (04/05-CONTEXT.md); migrations never run at application startup (D8); hard-fail, never warn (01-CONTEXT.md D-20); PostgreSQL 17 pinned across dev/staging/production (D9); production's PostgreSQL major version is still UNKNOWN (D16); the runner's exit-code contract is `RUNNER_EXIT_CODES`; a parse failure (exit 30) and an invalid rules file (exit 40) are reported distinctly from BLOCKED; never log or commit credentials; mark unverified things UNKNOWN.

**Explicitly not this phase:** no production database of any kind; no approval/override mechanism or environment protection rules; no audit log; no automatic database rollback; no WireGuard, Headscale, or Tailscale; no expand-and-contract work; no extension of backup tooling past its local pin.

### Claude's Discretion

- The environment marker's mechanism (table, database `COMMENT`, or custom GUC via `ALTER DATABASE … SET`) — decision is that a server-side marker exists and is checked fail-closed (D-07); shape is open. Must be seedable from the existing init-script mount, Testcontainers fixtures, and the CI service container. **[Research note: "the existing init-script mount" does not exist — see Pitfall 1.]**
- Tunnel lifecycle in CI — composite action vs. script vs. inline steps; how it waits for the forwarded port; what happens if the tunnel dies mid-migration.
- Whether the development machine's tunnel is on-demand or a persistent helper, and how it is documented for Windows.
- SSH key passphrase handling, and how CI supplies one if the keys are passphrase-protected.
- The bootstrap script's location, name, and idempotency mechanism (`DO $$` blocks, `IF NOT EXISTS`, or a re-runnable grant-only shape), and whether it is invoked through a `pnpm` script.
- Whether `recipe_migrator` owns `runner.migration_runs` and the drizzle ledger on staging, or whether those are bootstrapped separately.
- Filenames and locations for the recon record (D-03), the port-proof record (D-04), and the CONN-03 performed record (D-08); whether D-03 updates `docs/00-current-state.md` in place or lands as a new numbered document.
- How staging's seed data is managed, and whether `db:seed` is reachable against staging at all.
- Whether the role-bootstrap SQL is passed through the safety analyzer. **[Research finding: it cannot be meaningfully classified — see Pitfall 3.]**
- The staging workflow's file layout — a new workflow or a job added to an existing one, and job/check naming (Phase 5's required-check names are ruleset configuration and must stay stable).

### Deferred Ideas (OUT OF SCOPE)

- WireGuard or Headscale as the connectivity mechanism — a later milestone or its own project. The enforced seam (D-02) keeps the swap cheap.
- Forgejo migration — MEDIUM confidence assessment already recorded in `06-CONTEXT.md`; most of the repository transfers, the ruleset-checking jobs and Phase 7's environment gate do not.
- A continuous CI probe asserting no public database port — declined on public-repo IP-leak grounds.
- A pre-migration `pg_dump` of staging, and extending Phase 2's backup tooling past its local pin — Phase 7 scope.
- A migration role with no data access at all — blocked by Postgres semantics and the committed `0003` backfill.
- Environment protection rules, required reviewers, the REVIEW REQUIRED self-approval gate, the real audit log, and per-rule override-frequency counting — Phase 7, unchanged.
- Automatic database rollback — `PROJECT.md` Out of Scope.
- Retrofitting the other Coolify applications onto this pipeline — Phase 7 at the earliest.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-------------------|
| CONN-01 | Staging PostgreSQL is reachable from CI and from the development machine with no inbound port opened on the server | Pattern 1 (verified `restrict`/`permitopen` syntax), Pattern 2 (CI tunnel lifecycle), Pitfall 2 (stable-destination hazard and recommended loopback-bind hypothesis to verify via D-03), Validation Architecture (D-04's performed record is the actual proof mechanism, not an automated test). |
| CONN-02 | Coolify's public-port toggle is never enabled for any database | Pattern 5 / Pitfall 5 (Coolify toggle behavior, MEDIUM confidence, explicitly flagged as pending hands-on confirmation), D-04's three-vantage record structure. |
| CONN-03 | `drizzle-kit push` is structurally restricted to the local development container and cannot reach a shared database | Pitfall 1 (corrected marker-seeding mechanism), Code Examples (dev-pin marker check), Validation Architecture (Testcontainers marker-refusal test + performed record). |
| CONN-04 | A schema change reaches staging through the pipeline with no application redeploy and no manual terminal use | Pattern 5 (GitHub Environment/branch-restriction mechanics, verified endpoint shape), Architecture Diagram (full CI trigger-to-execution flow). |
| CONN-05 | Application runtime and migration execution use separate credentials with different privileges | Pattern 4 (verified role-bootstrap SQL, corrected per Pitfall 4), Pitfall 3 (why the bootstrap script sits outside the safety analyzer's gated path), Validation Architecture (new privilege-boundary test). |
</phase_requirements>

## Summary

Phase 6's technical shape is already almost entirely decided in `06-CONTEXT.md` (D-01 through D-16) — this is not a phase where research proposes among live options. What remains for planning is threefold: (1) surface one load-bearing discrepancy between `06-CONTEXT.md`'s stated implementation detail and the actual repository state, verified by reading the source directly, because building on the stated-but-false premise would break an existing guardrail test; (2) supply the concrete, version-checked technical mechanics — SSH `authorized_keys` option semantics, PostgreSQL role-privilege syntax, GitHub Environments API shape — that the eleven Claude's-Discretion items and the four performed-record requirements need in order to be planned as concrete tasks rather than open questions; and (3) make explicit which claims about Coolify's actual behavior are "documented, community-sourced, MEDIUM confidence" versus "must be established by the hands-on recon this phase's own criterion 1 requires," so the plan does not silently promote a community report to a verified fact.

**The one load-bearing discrepancy, found by reading source directly:** `06-CONTEXT.md` D-07 states the environment marker will be seeded via "the development container's init script (already mounted per `01-CONTEXT.md` D-14)." No such mount exists. `docker-compose.yml`'s own header comment says the opposite ("there is deliberately no such mount below"), and `tests/guardrails.test.ts` contains a live, passing guardrail — `docker-compose.yml contains no container init-script mount (D-14)` — that would fail the moment such a mount was added. `01-CONTEXT.md` D-14 is about extension installation via Drizzle migrations, not an init-script mount at all; the actual rejection-of-init-script decision is `docs/decisions.md` D21. Planning must not add a `docker-entrypoint-initdb.d` mount for the marker. See **Common Pitfalls, Pitfall 1** for the corrected mechanism, which reuses this project's own established `D22` pattern (imperative bootstrap at first connect) instead.

**Primary recommendation:** Treat this phase as "wire up already-decided infrastructure, verify it hands-on, and fill eleven discretion gaps with concrete mechanics" rather than "evaluate options." No new npm dependency is needed anywhere in this phase — OpenSSH (already present on both the Ubuntu runner and Windows 11), the existing `pg` driver, and `gh` (already used in `pr-gate.yml`) cover every mechanical need.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Private network path to staging Postgres | Host (Hetzner) / OS (OpenSSH) | CI runner (ephemeral SSH client) | The tunnel is host-level OS configuration (`authorized_keys`), not application code; CI and the dev machine are both *clients* of the same host-side restriction. |
| Environment identity assertion (dev vs. staging) | Database / Storage (server-side marker + `current_database()`) | API/Backend (`scripts/env.ts`) | Per D-06/D-07/D-21's existing pattern: the server is asked, never the connection string trusted — this is a database-tier fact surfaced through a backend-tier assertion function. |
| Migration execution (staging) | API/Backend (CI job, thin entry point) | Database (role-scoped) | `scripts/db-migrate-staging.ts` is backend/pipeline code; the privilege boundary that makes it safe lives in the database tier (role grants). |
| Secret storage (SSH key, `recipe_migrator` credential) | CI/Backend (GitHub Environment secrets) | — | Never client/browser, never local machine (D-12) — this is exclusively a CI-tier concern. |
| Read-only staging inspection (dev machine / Claude Code) | API/Backend (local script, `recipe_readonly` role) | Database | The dev machine is a thin client of a database-enforced read boundary — the local script tier cannot elevate what the role tier denies. |
| Application continuity proof (no redeploy) | CDN/Static or App-runtime (recipe app container) | — | This is specifically about *not* touching the deploy/runtime tier while the database tier changes underneath it — the app tier's job this phase is to do nothing. |
| Staging trigger (merge to `main`) | CI/Backend (GitHub Actions) | — | Pure pipeline-tier concern; no browser or API surface involved. |

## Package Legitimacy Audit

**No new external packages are introduced by this phase.** Every mechanism this phase needs is covered by tooling already present in the environment or already a dependency of this repository:

| Need | Considered package(s) | Decision | Why |
|------|----------------------|----------|-----|
| SSH tunnel client (CI) | `node-ssh`, `ssh2`, `tunnel-ssh` (npm) | **Rejected — use the OS `ssh` binary** | `ubuntu-latest` GitHub-hosted runners ship OpenSSH client preinstalled [ASSUMED — standard GitHub-hosted runner image content, not re-verified this session; low risk, trivially confirmed by the workflow's first real run printing `ssh -V`, matching this repo's own precedent of confirming `gh --version` live in `pr-gate.yml`]. A background `ssh -N -L ...` process plus a poll loop needs no library. |
| SSH tunnel client (dev machine) | — | **Use Windows 11's built-in OpenSSH client** | Already recorded project-wide knowledge (`.claude/CLAUDE.md` Constraints: "Windows is the development machine"); `06-CONTEXT.md`'s own Claude's Discretion list already assumes this ("OpenSSH ships with Windows 11"). |
| Wait-for-port-open helper | `wait-on`, `wait-port` (npm) | **Rejected — hand-roll with `node:net`** | A ~15-line retry loop using `net.createConnection` avoids a new dependency for a problem this small; matches the project's existing style of small, purpose-built TS helpers under `scripts/`. |
| Role bootstrap execution | — | **Use the existing `pg` client** (`8.23.0`, already a devDependency) | No new client library needed; the bootstrap script is plain SQL run through the same `Client` class `db-migrate.ts` already uses. |
| External port-scan vantage (D-04, owner's performed record) | `nmap` (external tool, not npm) | **Recommend PowerShell's built-in `Test-NetConnection`** | Zero-install on the Windows dev machine (the "external vantage" per D-04 just needs to be a machine other than the host itself — the dev machine, scanning outbound, qualifies). `nmap` is a valid alternative if already installed but requires an install step this project doesn't otherwise need. |
| Hetzner firewall inspection (D-03 recon) | `hcloud` CLI | **Optional, not required** | The Hetzner Cloud web console covers the same information with zero setup; `hcloud firewall list` / `hcloud firewall describe <name>` are the CLI equivalents [CITED: github.com/hetznercloud/cli docs, cross-checked via WebSearch, MEDIUM confidence] if the owner already has the CLI configured. |

Nothing here requires the Package Legitimacy Gate's registry-verdict protocol, because nothing is being installed.

## Standard Stack

This phase adds **zero new npm packages**. What it uses, already present:

| Tool | Version (this repo) | Purpose | Why Standard |
|------|---------------------|---------|---------------|
| OpenSSH client | OS-provided (Ubuntu runner; Windows 11 built-in) | The D-01 tunnel mechanism itself | `06-CONTEXT.md` D-01's entire premise — no library, no service, one `authorized_keys` line. |
| `pg` | `8.23.0` (root devDependency, verified in `package.json`) [VERIFIED: package.json] | Role bootstrap script's SQL client; `db-migrate-staging.ts`'s connection | Already the project's sole Postgres client, per D9/D20. |
| `gh` CLI | Preinstalled on GitHub-hosted runners, confirmed live in `pr-gate.yml`'s `analyze` job (`gh --version` step) [VERIFIED: .github/workflows/pr-gate.yml, "Confirm the GitHub CLI is available" step] | Environment/secret setup (one-time, owner-run) and any `gh api` calls the staging workflow's tracking-issue step needs (mirrors `restore-drill.yml`'s `gh issue create`/`gh issue comment`) | Established project precedent, D-16 (`docs/decisions.md`) reuse pattern. |
| `zod` | `^4.5.4` [VERIFIED: package.json] | Any new env-schema surface `scripts/env.ts` gains for the staging pin | Already the project's schema-validation library (D-16 note in `docs/decisions.md`). |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Restricted SSH + `permitopen` (D-01, already decided) | Tailscale, Headscale, raw WireGuard | Already exhaustively compared and rejected in `06-CONTEXT.md` D-01. Not re-litigated here. |
| Hand-rolled wait-for-port TS helper | `wait-port` npm package | A one-file, ~15-line helper avoids a new supply-chain dependency for a problem with no real complexity; see Code Examples. |
| `Test-NetConnection` (Windows-native) for the external port-scan vantage | `nmap` | `nmap` gives richer output (service fingerprinting) but requires an install step; `Test-NetConnection` is sufficient to answer "is TCP 5432 reachable from outside the host" and needs nothing installed. |

**Installation:** None required.

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────── DEVELOPER MACHINE (Windows) ───────────────────────────┐
│                                                                                      │
│   Claude Code / owner            ssh -L <localport>:<pinned-dest>:5432 user@host    │
│        │                                    │                                       │
│        ▼                                    ▼                                       │
│   RECIPE_STAGING_READONLY_URL ──────► 127.0.0.1:<localport>  (on-demand or          │
│   (recipe_readonly role,              persistent helper — Claude's Discretion)      │
│    agent-visible per D-12)                                                          │
└──────────────────────────────────────────────┬─────────────────────────────────────┘
                                                 │  restricted key: restrict,
                                                 │  permitopen="<pinned-dest>:5432",
                                                 │  command="/bin/false"
                                                 ▼
┌──────────────────────────── HETZNER HOST (Coolify) ───────────────────────────────┐
│  sshd (port 22, already open for Coolify's own management — D5)                    │
│        │  permitopen re-enables local forwarding to exactly one destination        │
│        ▼                                                                            │
│  <pinned-dest>:5432 ── e.g. 127.0.0.1:5432 on the HOST if Postgres is bound to      │
│                         host loopback (D-03's recon question — see Pitfall 2)       │
│        │                                                                             │
│        ▼                                                                            │
│  ┌──────────────────────────── Coolify-managed Docker network ─────────────────┐   │
│  │   postgresql-<uuid> container (PostgreSQL 17, private-networking-only        │   │
│  │   by default — "Publicly Accessible" toggle OFF, verified per D-04)          │   │
│  │                                                                               │   │
│  │   roles: recipe_app (DML-only) · recipe_migrator (DDL, no superuser,         │   │
│  │          one-db, connection-limited) · recipe_readonly (SELECT-only)         │   │
│  │                                                                               │   │
│  │   recipe-app container (deployed, D-13) ── DATABASE_URL → recipe_app role    │   │
│  └───────────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────────┘
                                                 ▲
                                                 │  restricted key: restrict,
                                                 │  permitopen="<pinned-dest>:5432",
                                                 │  command="/bin/false"  (SEPARATE
                                                 │  key from the owner's, D-12)
┌────────────────────────── GITHUB ACTIONS (push to main) ──────────────────────────┐
│  push-to-main workflow, environment: staging (branch-restricted to main, D-15)     │
│        │                                                                            │
│  1. Open ssh -N -L <localport>:<pinned-dest>:5432 in background (CI SSH key)        │
│  2. Wait for <localport> to accept TCP (node:net poll loop)                         │
│  3. pnpm db:migrate:staging  ──► scripts/db-migrate-staging.ts                      │
│        │       reads RECIPE_STAGING_MIGRATOR_DATABASE_URL (Environment secret)      │
│        │       asserts: db name == recipe_staging (static) AND                      │
│        │                current_database()/current_user match (dynamic, D-06)       │
│        ▼                                                                            │
│  runMigrations(client, {migrations, rules})  ── identical runner core, D-05/D-27    │
│        │                                                                            │
│  4. On failure: open/update tracking issue (D-16, mirrors restore-drill.yml)        │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
scripts/
├── db-migrate.ts              # existing (dev) -- untouched
├── db-migrate-staging.ts      # NEW (D-05) -- thin sibling, own env var, own pin
├── env.ts                     # CHANGED -- staging pin (D-06) + marker check (D-07) added
├── bootstrap-roles.ts          # NEW (D-10) -- idempotent SQL, run once over the tunnel
└── ci/
    └── wait-for-port.ts        # NEW -- shared by CI tunnel step and (optionally) a dev helper
.github/
├── environments/               # documentation only -- GitHub Environments are not files
└── workflows/
    └── staging-migrate.yml     # NEW (D-14/D-15/D-16) -- or a job appended to pr-gate.yml's
                                 # sibling; Claude's Discretion on file layout
docs/
├── 50-staging-connectivity-recon.md   # NEW (D-03) -- closes 00-current-state.md §4/§6
├── 51-staging-port-proof.md           # NEW (D-04) -- three-vantage performed record
└── 52-staging-push-refusal.md         # NEW (D-08) -- performed drizzle-kit push record
```

### Pattern 1: The restricted-SSH `authorized_keys` line (D-01)

**What:** A single `authorized_keys` entry on the Hetzner host that permits exactly one thing: local port forwarding to one destination, for one key.

**Verified syntax** [VERIFIED: man.openbsd.org sshd(8), AUTHORIZED_KEYS FILE FORMAT, fetched this session]:
- `restrict` — quoting the manual directly: *"Enable all restrictions, i.e. disable port, agent and X11 forwarding, as well as disabling PTY allocation and execution of ~/.ssh/rc."* This is the default-deny baseline; individual permissions are then re-enabled explicitly.
- `permitopen="host:port"` — quoting directly: *"Limit local port forwarding with the ssh(1) -L option such that it may only connect to the specified host and port."* Multiple entries are comma-separated; a port of `*` matches any port (do not use `*` here — name the literal Postgres port). **No pattern matching or name lookup occurs on the specified hostname** — it is treated as a literal, so whatever destination `permitopen` names must be the literal, resolvable-by-sshd string (see Pitfall 2 for why this makes D-03's subnet-stability question load-bearing).
- `command="/bin/false"` — quoting directly: *"Specifies that the command is executed whenever this key is used for authentication. The command supplied by the user (if any) is ignored."* An interactive login attempt with this key gets `/bin/false` (immediate exit, no shell) instead of a shell — the key can still open the forwarding channel `permitopen` allows, because port-forwarding is a distinct SSH channel type from the shell/command channel `command=` governs.

**Concrete line** (matches `06-CONTEXT.md`'s own quoted form and `ARCHITECTURE.md:71-78`):
```
restrict,permitopen="127.0.0.1:5432",command="/bin/false" ssh-ed25519 AAAA... ci-staging-migrate-key
```
Two separate lines, two separate keypairs (D-12): one for the CI-only key, one for the owner's own dev-machine key — independently revocable, per `06-CONTEXT.md`'s explicit requirement.

**When to use:** Exactly once, for each of the two keys D-12 requires. Not extended to any third key without its own decision.

### Pattern 2: CI opens the tunnel, waits, then runs the pinned entry point

**What:** A background `ssh -N -L` process plus a synchronous wait, then the migration command, all inside one job step (or a composite action — Claude's Discretion).

**Why this shape:** `06-CONTEXT.md` D-02 requires the connectivity step to be a separate, named step whose only contract is "after me, the staging URL connects" — nothing downstream may reference SSH. The wait step is what makes that contract true; without it, `db:migrate:staging`'s first connection attempt would race the tunnel's startup.

**Example** (GitHub Actions step, Ubuntu runner):
```yaml
- name: Establish the private tunnel to staging Postgres (D-02: this is the only SSH-aware step)
  run: |
    mkdir -p ~/.ssh
    echo "${{ secrets.STAGING_SSH_PRIVATE_KEY }}" > ~/.ssh/ci_staging_key
    chmod 600 ~/.ssh/ci_staging_key
    ssh-keyscan -H "${{ secrets.STAGING_SSH_HOST }}" >> ~/.ssh/known_hosts
    ssh -N -L 5433:127.0.0.1:5432 \
        -i ~/.ssh/ci_staging_key \
        -o ExitOnForwardFailure=yes \
        "ci-migrate@${{ secrets.STAGING_SSH_HOST }}" &
    echo "TUNNEL_PID=$!" >> "$GITHUB_ENV"

- name: Wait for the forwarded port
  run: pnpm exec tsx scripts/ci/wait-for-port.ts 127.0.0.1 5433

- name: Run the staging migration (no step after this references SSH)
  run: pnpm db:migrate:staging
  env:
    RECIPE_STAGING_MIGRATOR_DATABASE_URL: postgres://recipe_migrator:${{ secrets.RECIPE_MIGRATOR_PASSWORD }}@127.0.0.1:5433/recipe_staging

- name: Tear down the tunnel
  if: always()
  run: kill "$TUNNEL_PID" 2>/dev/null || true
```
`ExitOnForwardFailure=yes` makes the SSH client itself exit non-zero if `permitopen` refuses the forward, rather than silently leaving an unusable tunnel — important because `06-CONTEXT.md`'s own "carried forward" rule (`01-CONTEXT.md` D-20) requires hard-fail, never warn. `ssh-keyscan` populates `known_hosts` for a fixed, known host — do not use `StrictHostKeyChecking=no` (silently accepts any host key, defeating the point of host verification); `ssh-keyscan` against the one pinned staging host is the honest equivalent for a CI job with no interactive prompt available.

### Pattern 3: The wait-for-port helper (no new dependency)

```typescript
// scripts/ci/wait-for-port.ts -- polls a TCP port until it accepts a connection or times out.
// Hand-rolled rather than a `wait-port`/`wait-on` npm dependency (see Package Legitimacy Audit).
import { createConnection } from "node:net";

function tryConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port }, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });
}

async function waitForPort(host: string, port: number, timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await tryConnect(host, port)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${host}:${port} to accept a connection.`);
}

const [host, portArg] = process.argv.slice(2);
waitForPort(host, Number(portArg)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
```

### Pattern 4: The role bootstrap (D-09/D-10)

**Verified from PostgreSQL 17 official docs, fetched this session:**
- `CREATE ROLE` has **no `IF NOT EXISTS` clause in any PostgreSQL version through 17** [VERIFIED: postgresql.org/docs/17/sql-createrole.html, fetched this session — the fetched page content shows no such clause, and this matches well-established PostgreSQL behavior]. Idempotency requires an explicit `DO` block checking `pg_roles`.
- `ALTER DEFAULT PRIVILEGES` applies **only to objects created after** the statement runs — quoting the docs directly: *"It does not affect privileges assigned to already-existing objects."* [VERIFIED: postgresql.org/docs/17/sql-alterdefaultprivileges.html, fetched this session]. **This is a real gap in `06-CONTEXT.md` D-10 as written**: at bootstrap time, `recipe_app`, `recipes`, `ingredients`, and `steps` already exist (created by the Coolify-owner credential during earlier migrations). `ALTER DEFAULT PRIVILEGES` alone grants `recipe_app` nothing on those tables — the bootstrap script needs **both** an explicit one-time `GRANT ... ON ALL TABLES IN SCHEMA public TO recipe_app` for what already exists **and** the `ALTER DEFAULT PRIVILEGES` clause for everything created afterward. This is exactly the kind of gap the phase's own idempotent-and-rerunnable design (run once for staging, rerun for production in Phase 7) needs to get right the first time.

**Example, corrected and complete:**
```sql
-- scripts/bootstrap-roles.sql (or .ts wrapping equivalent statements -- Claude's Discretion on
-- location/mechanism). Idempotent: safe to rerun (D-10's "committed, idempotent" requirement).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'recipe_migrator') THEN
    CREATE ROLE recipe_migrator WITH LOGIN PASSWORD :'migrator_password'
      NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 5;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'recipe_readonly') THEN
    CREATE ROLE recipe_readonly WITH LOGIN PASSWORD :'readonly_password' CONNECTION LIMIT 5;
  END IF;
  -- recipe_app already exists (created by the Coolify-issued credential); this block only
  -- narrows it, never creates it, per D-10's "leaving the application on the Coolify-generated
  -- owner" rejection.
END $$;

-- recipe_migrator owns the schema going forward
ALTER SCHEMA public OWNER TO recipe_migrator;

-- recipe_app: DML only, on what exists TODAY --
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO recipe_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO recipe_app;

-- recipe_app: DML only, on everything recipe_migrator creates FROM NOW ON --
ALTER DEFAULT PRIVILEGES FOR ROLE recipe_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO recipe_app;
ALTER DEFAULT PRIVILEGES FOR ROLE recipe_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO recipe_app;

-- recipe_readonly: SELECT only, present and future
GRANT USAGE ON SCHEMA public TO recipe_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO recipe_readonly;
ALTER DEFAULT PRIVILEGES FOR ROLE recipe_migrator IN SCHEMA public
  GRANT SELECT ON TABLES TO recipe_readonly;

-- explicitly revoke DDL from recipe_app (belt-and-suspenders -- role has none by default,
-- but this makes the intent readable in the script itself)
REVOKE CREATE ON SCHEMA public FROM recipe_app;
```
Run once, by hand, over the tunnel, using the Coolify-issued credential (superuser or database owner, which can set default privileges on `recipe_migrator`'s behalf even without `SET ROLE`, per the docs: *"in practice, superusers can set default privileges for any role"* [CITED: postgresql.org/docs/17/sql-alterdefaultprivileges.html]).

### Pattern 5: GitHub Environment with branch-restricted secrets (D-15)

**Verified endpoint shape** [CITED: docs.github.com REST API, Deployment Environments, fetched this session]:
```
PUT /repos/{owner}/{repo}/environments/{environment_name}
{
  "deployment_branch_policy": {
    "protected_branches": false,
    "custom_branch_policies": true
  }
}
```
A **separate** endpoint manages the actual branch-name patterns once `custom_branch_policies` is `true` — `POST /repos/{owner}/{repo}/environments/{environment_name}/deployment-branch-policies` with body `{"name": "main"}` [ASSUMED — this sub-endpoint's exact path was not returned by this session's fetch of the environments page, which explicitly deferred to a separate "Deployment branch policies" doc not fetched this session; the shape is standard REST-API-documented behavior from training knowledge, not verified via tool this session. **Confirm the exact path with a live `gh api` call before the plan depends on it**, the same way Phase 5's D26 confirmed its ruleset payload live rather than trusting the documented shape.].

**Plan tier confirmed:** *"Users with GitHub Free plans can only configure environments for public repositories"* [CITED: docs.github.com, fetched this session]. This repository is confirmed public (`docs/decisions.md` D-02, Phase 5) — so the full Environments feature set (secrets, branch policies, optional reviewers) is available regardless of the owner's actual plan tier, mirroring exactly how D-02 already resolved the identical tier question for Phase 5's ruleset and for Phase 7's environment-protection gate.

**Required reviewers is confirmed separate** from the branch policy [CITED: docs.github.com, fetched this session] — the Environment can be created with a branch restriction and zero reviewers, satisfying `06-CONTEXT.md`'s explicit "no protection rules and no required reviewers here" requirement without any extra configuration to suppress.

**Recommended setup path:** Do this **once, interactively, with the owner's own admin-scoped `gh` credential**, not from inside a workflow's default `GITHUB_TOKEN` — mirroring `docs/decisions.md` D26's precedent for the ruleset (`administration` is not a grantable `GITHUB_TOKEN` permission, confirmed live in Phase 5, D30) and D31's explicit rejection of adding a new CI-held credential to work around that. There is no reason to expect Environment creation to be grantable to `GITHUB_TOKEN` when ruleset administration was not.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Waiting for a TCP port to open | A sleep-and-hope delay, or a bespoke retry framework | The ~15-line `node:net` poll loop in Pattern 3 | Simple enough that a dependency (or an under-engineered `sleep 5`) is worse than the code itself; a fixed sleep is also exactly the kind of "remembered timing" the project's non-negotiables reject. |
| Idempotent role creation | A DROP-then-CREATE script (destructive on rerun) | The `DO $$ ... IF NOT EXISTS ... $$` pattern (Pattern 4) | `DROP ROLE` on rerun would revoke every grant made since the last bootstrap and orphan any objects the role owns — catastrophic on a script meant to be safely rerunnable in production too (Phase 7). |
| Verifying "no inbound database port" | Trusting the Coolify UI toggle's stated state alone | The three-vantage performed record D-04 already specifies (external scan, `ss -tlnp`, UI toggle) | `PITFALLS.md` line 535, quoted in `06-CONTEXT.md`'s own canonical refs: "reachable" is not "safely scoped" — a firewall can hide a live listener, and a listener can sit behind a firewall rule one change away from exposure. Each vantage answers a different question; none alone is sufficient. |
| The environment marker's storage | A new dependency (e.g., a feature-flag library) | A one-column table under a `runner`-owned schema, or `ALTER DATABASE ... SET` (Claude's Discretion, both zero-dependency) | Postgres already has both mechanisms natively; anything else is unnecessary surface area for a one-bit fact. |

**Key insight:** Every mechanism this phase needs — TCP polling, idempotent SQL, GitHub API calls — is small enough, and specific enough to this project's own established idioms, that reaching for a library would trade a five-minute build for a new supply-chain dependency and an unfamiliar API. This mirrors the project's own D-01 reasoning almost exactly: prefer the thing that adds no new moving part.

## Common Pitfalls

### Pitfall 1: `06-CONTEXT.md` D-07's stated marker mechanism contradicts a live guardrail test — read the actual repo state, not the plan's restated premise

**What goes wrong:** `06-CONTEXT.md` D-07 says the marker is seeded via "the development container's init script (already mounted per `01-CONTEXT.md` D-14)." If a plan takes that sentence at face value and adds a `docker-entrypoint-initdb.d` volume mount to `docker-compose.yml`, `tests/guardrails.test.ts`'s existing test — *"docker-compose.yml contains no container init-script mount (D-14)"* [VERIFIED: tests/guardrails.test.ts:344-354, quoted below] — fails immediately, and the plan has reintroduced exactly the thing `docs/decisions.md` D21 rejected: *"a second, ungated path by which schema state can arrive."*

**Verified evidence (read directly this session):**
- `tests/guardrails.test.ts:344-354`:
  ```
  it("docker-compose.yml contains no container init-script mount (D-14)", () => {
    const compose = readFileSync("docker-compose.yml", "utf-8");
    const initScriptToken = ["docker-entrypoint-", "initdb.d"].join("");
    expect(
      compose,
      "D-14: schema state must arrive only via a Drizzle migration, never a container-startup init-script mount",
    ).not.toContain(initScriptToken);
  });
  ```
- `docker-compose.yml:1-9` (header comment, quoted): *"it arrives as a Drizzle migration (`CREATE EXTENSION ...`), never through the Postgres image's container-startup script-mount convention (D-14) — there is deliberately no such mount below."*
- `01-CONTEXT.md:125` D-14 is titled about **extension** installation via Drizzle migrations — it never mentions an init-script mount at all. The actual "no init-script mount" decision is `docs/decisions.md` **D21** ("`drizzle-kit migrate` is structurally unreachable from this repository"), which explicitly generalizes the reasoning to any second ungated schema-state path.
- `assertDevelopmentDatabase` (the function D-07 proposes to extend) is called from **13 separate files**, not only `db-migrate.ts` [VERIFIED: grep across the tracked tree found call sites in `apps/recipe-app/src/db/seed.ts`, `scripts/backup.ts`, `scripts/db-migrate-recover.ts`, `scripts/db-migrate.ts`, `scripts/db-query.ts`, `scripts/db-reset.ts`, `scripts/restore-cluster.ts`, `scripts/restore.ts`, `scripts/verify-migration-state.ts`, plus test files]. Any marker-seeding mechanism must be ready **before the first of these entry points connects after every `db:reset`**, not only before `db:migrate`.

**Why it happens:** `06-CONTEXT.md` was written from planning-time memory of the project's general pattern ("the container init script is already mounted"), not from re-reading the current `docker-compose.yml` and guardrail suite at context-gathering time.

**How to avoid — the corrected mechanism, reusing this project's own D22 pattern:** Bootstrap the marker **imperatively, on first connect, exactly the way `runner.migration_runs` is bootstrapped** (`docs/decisions.md` D22: `CREATE ... IF NOT EXISTS` at connect time, never a Drizzle migration, never a container mount):
- For the **development** target: add an `ensureDevelopmentMarker(client)` call inside (or immediately before) `assertDevelopmentDatabase`'s dev-target path, that idempotently creates the marker and seeds it `'development'` if absent (`ON CONFLICT DO NOTHING` or equivalent) — self-healing, so every `db:reset` naturally reseeds it on the next entry point's first connection, with no docker-compose change required.
- For the **staging** target: the equivalent check must be **read-only** — never auto-insert. An absent marker fails closed (per D-07's own requirement). The marker is seeded exactly once, by the D-10 bootstrap script, alongside the role grants.
- For **Testcontainers fixtures** (D-08's marker-refusal test): seed the marker explicitly in the test's own setup, right after `startEmptyPostgres17()` — this already matches `tests/history/support.ts`'s established pattern of connecting and running arbitrary SQL against a freshly started container, so no new harness capability is needed.
- For the **CI service container** (`pr-gate.yml`'s `migrate` job and any future staging-shaped test job): the self-healing dev-path bootstrap covers it automatically, since `pnpm db:migrate` is the first thing to connect in that job today — confirmed by reading `pr-gate.yml`'s `migrate` job, whose only step is `pnpm db:migrate`.

**Warning signs:** A plan step that edits `docker-compose.yml` to add a `volumes:` entry under `docker-entrypoint-initdb.d/`, or a plan step that assumes the marker "already exists" without a bootstrap call anywhere in the entry-point code paths.

### Pitfall 2: `permitopen`'s destination must be a stable, literal `host:port` — Coolify's per-resource container addressing may not be

**What goes wrong:** `ARCHITECTURE.md:164` (already cited in `06-CONTEXT.md`'s canonical refs) warns Coolify can reassign a resource's internal Docker IP on redeploy. `permitopen` performs **no pattern matching or name lookup** on its argument [VERIFIED: man.openbsd.org sshd(8), quoted in Pattern 1 above] — it must name one literal, sshd-resolvable destination, fixed at the time the `authorized_keys` line is written. If that destination is the container's Docker-internal IP and Coolify reassigns it, every future tunnel attempt silently targets a stale, possibly-reused address.

**Why it happens:** Docker containers on a bridge network commonly get non-deterministic IP reassignment across recreation; Coolify's community-sourced behavior (this session's WebSearch, MEDIUM confidence) confirms the container is reachable by a stable **name** (`postgresql-<uuid>`) from *other containers on the same Docker network* — but that name is resolved via Docker's embedded DNS, which is **not** ordinarily reachable from the bare host's own resolver (the host is not itself a member of the container network's DNS scope by default). `sshd` runs as a host process, so a hostname `permitopen` cannot resolve is not usable, regardless of whether it's "stable" from inside the network.

**How to avoid:** The strongest candidate destination — to verify hands-on per D-03, not assume — is **binding Postgres's port to the host's own loopback interface** (`127.0.0.1:5432` on the Hetzner host, exactly mirroring this repository's own local dev `docker-compose.yml` pattern: `"127.0.0.1:5432:5432"`). That gives `permitopen="127.0.0.1:5432"` a destination that is stable by construction — loopback never changes — and reachable by `sshd` without any DNS resolution at all. `ARCHITECTURE.md:63` already flags that Coolify's own "Publicly Accessible" toggle does not natively support binding to a single interface (it binds broadly), so achieving a loopback-only bind likely needs a manual `docker-compose` override outside Coolify's UI toggle — **this is exactly the kind of Coolify-specific mechanic D-03's recon must establish hands-on** (does Coolify allow a custom port-binding override for a "resource"-type database, or only for a "service"-in-a-compose-stack type; `06-CONTEXT.md` D-03 already names this exact distinction as an open recon question).

**Fallback if loopback-binding isn't achievable:** advertise/use the Docker bridge network's subnet directly from the host (the host's own network namespace can typically route to a bridge-network container IP even without DNS, since Docker attaches the bridge interface to the host itself) — but this reopens the redeploy-reassignment risk `ARCHITECTURE.md:164` names, so it is the weaker of the two options and should only be used if the recon rules out the loopback-bind path.

**Warning signs:** A plan that writes `permitopen="postgresql-<uuid>:5432"` (a Docker-internal DNS name) without first confirming, hands-on, that the host's own `sshd` process can actually resolve it.

### Pitfall 3: The role-bootstrap SQL is not classifiable by the existing safety analyzer — a verified gap, not a hypothetical one

**What goes wrong:** `06-CONTEXT.md`'s Claude's Discretion list asks "whether the role-bootstrap SQL is passed through the safety analyzer." Reading `packages/automation/src/types.ts:29-64` directly [VERIFIED: packages/automation/src/types.ts:29-64] shows the complete, closed `StatementKind` union: `EmptyInput | DropTable | DropSchema | DropDatabase | Truncate | DropColumn | Delete | Update | CreateTable | AddColumn | SetNotNull | DropNotNull | AlterColumnType | AddUniqueConstraint | AddCheckConstraint | AddForeignKey | DropConstraint | ValidateConstraint | CreateIndex | DropIndex | RenameColumn | RenameTable | AlterTypeDropValue | CommentOn | DoBlock | CreateFunction | ExecuteDynamic | Vacuum | AlterSystem | CreateDatabase | Reindex | SetGuc | AlterDatabaseSet | AlterRoleSet | Unrecognized`. There is **no** `CreateRole`, `GrantStmt`, `AlterDefaultPrivileges`, or `RevokeStmt` kind. Every statement in Pattern 4's bootstrap SQL (`CREATE ROLE`, `GRANT`, `ALTER DEFAULT PRIVILEGES`, `REVOKE`) would classify as `Unrecognized`.

**Why it happens:** The analyzer's catalogue was built against Drizzle-generated schema-migration SQL (`CREATE TABLE`, `ALTER TABLE`, etc.) — role/privilege DDL was never in scope for Phases 3-4.

**How to avoid:** Per `docs/decisions.md` D16's "SAFE must be earned" default, an `Unrecognized` statement resolves to `REVIEW_REQUIRED`, never `SAFE` — so running the bootstrap through the analyzer would not silently approve anything, but it also adds no real signal: every statement in the script would land on the identical, uninformative "uncatalogued" verdict. **Recommend recording an explicit decision** (not leaving it implicit) that the bootstrap script is deliberately run **outside** the gated `db:migrate`/`runMigrations` path — it is not a migration file under `apps/recipe-app/drizzle/`, it is never picked up by `enumerateMigrationFiles`, and it is run by hand, once, using the Coolify-issued credential rather than through the runner. This is consistent with `06-CONTEXT.md` D-10's own description ("run once over the tunnel with a performed record") and avoids extending the analyzer's rule catalogue for a script that runs exactly twice in this project's lifetime (staging now, production in Phase 7).

**Warning signs:** A plan task that tries to wire the bootstrap script through `packages/automation`'s `analyzeSql`/`classifyFacts` and is surprised every statement comes back `REVIEW_REQUIRED` with no rule ID.

### Pitfall 4: `ALTER DEFAULT PRIVILEGES` does not retroactively grant anything on already-existing tables

**What goes wrong:** Already covered in Pattern 4 above, restated here because it is a genuine correctness gap in `06-CONTEXT.md` D-10 as written, not just a documentation nuance: if the bootstrap script contains only the `ALTER DEFAULT PRIVILEGES` clauses (as D-10's prose implies) and omits the explicit `GRANT ... ON ALL TABLES IN SCHEMA public TO recipe_app` for tables that already exist, `recipe_app` ends up with **zero** access to every table created before the bootstrap ran — which, at bootstrap time, is every table the recipe app currently has (`recipes`, `ingredients`, `steps`). The application would then fail every query the moment its `DATABASE_URL` is repointed onto `recipe_app`.

**Why it happens:** `ALTER DEFAULT PRIVILEGES`'s name is easy to misread as "sets privileges, including current ones" — the PostgreSQL docs are explicit that it only governs objects created *after* the statement runs [VERIFIED: postgresql.org/docs/17/sql-alterdefaultprivileges.html, quoted in Pattern 4].

**How to avoid:** Include both the explicit present-tense `GRANT ... ON ALL TABLES IN SCHEMA public` and the future-tense `ALTER DEFAULT PRIVILEGES` in the same bootstrap script, as shown in Pattern 4.

**Warning signs:** The application boots against staging (D-13's own success criterion) but every database query fails with a permission-denied error immediately after `recipe_app`'s credential is repointed.

### Pitfall 5: Treating Coolify's documented behavior as a substitute for the hands-on recon

**What goes wrong:** This document (and the wider web) describes Coolify's networking, "Publicly Accessible" toggle, and container-address stability at MEDIUM confidence, cross-checked across several community sources but never a formal spec. `06-CONTEXT.md` criterion 1 and D-03 are explicit that this phase's entire premise is **not** trusting that — the recon must be performed "against this specific Coolify instance's actual networking and volume/backup behavior."

**Why it happens:** Research documents can read as authoritative even when honestly hedged; a planner working quickly might treat "Coolify databases default to private networking only" as settled fact rather than as this session's best cross-checked understanding, pending the owner's own hands-on check.

**How to avoid:** Every claim in this document about Coolify's specific behavior (networking defaults, toggle mechanics, redeploy address stability, backup configuration location) is tagged `[CITED]` or noted MEDIUM confidence precisely so the plan can distinguish "safe to build on" from "must be the first thing the recon confirms." Do not silently promote any Coolify-specific claim in this document to `[VERIFIED]` without the owner's own hands-on check against the real instance.

**Warning signs:** A plan step that skips or shortcuts D-03's recon because "the research already covered Coolify's behavior."

## Code Examples

### Staging pin, modeled on the existing dev pin (D-06)

```typescript
// scripts/env.ts additions (illustrative -- exact shape is planning's to finalize)

export const EXPECTED_STAGING_DATABASE_NAME = "recipe_staging";

// Static half: mechanism-independent facts only -- no literal host:port (D-02).
// Explicitly refuses a URL that would ALSO satisfy the dev pin (06-CONTEXT.md D-06).
export function assertStagingConnectionShape(url: string): void {
  const parsed = parseConnectionString(url);
  if (parsed.database === EXPECTED_DEV_DATABASE_NAME) {
    throw new Error(
      "RECIPE_STAGING_MIGRATOR_DATABASE_URL must not target the development database name.",
    );
  }
  if (parsed.database !== EXPECTED_STAGING_DATABASE_NAME) {
    throw new Error(
      `RECIPE_STAGING_MIGRATOR_DATABASE_URL database name must be "${EXPECTED_STAGING_DATABASE_NAME}".`,
    );
  }
}

// Dynamic half: ask the server, never trust the URL (D-06). Composes with the environment
// marker check (D-07) -- both must pass.
export async function assertStagingDatabase(client: QueryableClient): Promise<void> {
  const { rows } = await client.query(
    "SELECT current_database() AS name, current_user AS role",
  );
  const row = rows[0] as { name?: string; role?: string } | undefined;
  if (row?.name !== EXPECTED_STAGING_DATABASE_NAME || row?.role !== "recipe_migrator") {
    throw new Error(
      "Refusing to proceed: connected target does not report itself as staging " +
        "(expected database recipe_staging, role recipe_migrator).",
    );
  }
}
```

### Dev-pin marker check, corrected per Pitfall 1

```typescript
// D-07, corrected mechanism (see Pitfall 1) -- self-healing for dev, read-only for staging.
async function ensureDevelopmentMarker(client: QueryableClient & { query: (t: string) => Promise<unknown> }): Promise<void> {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS runner;
    CREATE TABLE IF NOT EXISTS runner.environment_marker (name text PRIMARY KEY);
    INSERT INTO runner.environment_marker (name) VALUES ('development')
      ON CONFLICT DO NOTHING;
  `);
}

async function readEnvironmentMarker(client: QueryableClient): Promise<string | null> {
  const { rows } = await client.query("SELECT name FROM runner.environment_marker LIMIT 1");
  return (rows[0] as { name?: string } | undefined)?.name ?? null;
}
// assertDevelopmentDatabase (dev path): call ensureDevelopmentMarker, then require
// readEnvironmentMarker === "development". Absent/unreadable -> fail, never pass (D-07).
// The staging equivalent MUST NOT call an "ensure" -- read-only, fail closed on absence.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| A single generic `DATABASE_URL` distinguished by convention | Per-environment, per-purpose named variables plus server-side verification (D-06/D-07, extending ENV-03) | This project's own Phase 1 (D-16) | Removes the class of bug `PITFALLS.md`'s Integration Gotchas table names explicitly ("a shared generic `DATABASE_URL` pattern that could point an agent at the wrong place"). |
| Trusting a connection string's stated environment | Asking the connected server what it actually is (`current_database()`, `current_user`, a server-side marker) | Established in this project at D-21 (Phase 1), extended here by D-06/D-07 | A tunnel, a restore, or a typo cannot spoof a fact the server itself reports. |

**Deprecated/outdated:** Nothing in this phase's own domain is being deprecated — this is new infrastructure, not a migration off an old pattern.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | GitHub-hosted `ubuntu-latest` runners ship OpenSSH client preinstalled | Package Legitimacy Audit | Low — trivially caught by the first real CI run's `ssh -V` failing; add an explicit install step (`apt-get install -y openssh-client`) as a fallback if it fails. |
| A2 | The deployment-branch-policy sub-endpoint is `POST /repos/{owner}/{repo}/environments/{environment_name}/deployment-branch-policies` with body `{"name": "main"}` | Pattern 5 | Medium — if the exact path differs, the one-time `gh api` setup command needs correcting; does not affect architecture, only the exact command. Confirm live before relying on it, mirroring D26's precedent of confirming API shape live rather than trusting documentation. |
| A3 | The host's own network namespace can route directly to a Docker bridge-network container IP without DNS (the Pitfall 2 fallback) | Common Pitfalls, Pitfall 2 | Medium — this is standard Docker networking behavior but was not verified against this specific Hetzner/Coolify host this session; if wrong, the fallback destination for `permitopen` doesn't work and only the loopback-bind path remains viable. |
| A4 | Coolify's "Publicly Accessible" toggle does not support binding to a single interface (loopback-only) natively, requiring a manual docker-compose override | Pattern 5 / Pitfall 2 | Medium — sourced from `ARCHITECTURE.md`'s own MEDIUM-confidence Coolify research plus this session's cross-check; this is precisely one of the facts D-03's hands-on recon must confirm or refute against the real instance. |

**If this table is empty:** N/A — see entries above; none of them are load-bearing for the phase's core decisions (D-01 through D-16 are already locked), only for specific command/path details the recon and the one-time setup steps will confirm live.

## Open Questions

1. **Does the recipe app's existing Coolify deployment (if any exists yet — `06-CONTEXT.md` D-13 implies it does not) already have a database "resource" provisioned, or does this phase provision it from zero?**
   - What we know: `docs/00-current-state.md` §4 states "nothing for *this* app has been provisioned" as of Phase 5's close.
   - What's unclear: whether provisioning the Postgres resource is itself gated by any Coolify-side prerequisite (e.g., a project/environment must exist in Coolify's own UI first) beyond what D-13 already scopes.
   - Recommendation: fold into D-03's recon — this is exactly the kind of Coolify-instance-specific mechanic the recon exists to close.

2. **Exact deployment-branch-policy REST path (A2 above).**
   - What we know: the environment-creation `PUT` endpoint and its `deployment_branch_policy.custom_branch_policies` field are confirmed live.
   - What's unclear: the separate endpoint's exact path/verb for adding `main` as an allowed pattern.
   - Recommendation: confirm with a single `gh api` call against the real repository before the plan's one-time setup task depends on it, exactly as Phase 5 did for the ruleset payload shape.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| OpenSSH client (Windows dev machine) | D-01 tunnel, dev-machine half | ✓ (per project's own prior documentation) [ASSUMED — carried from `.claude/CLAUDE.md`'s own constraint note, not re-probed this session] | Windows 11 built-in | None needed if absent — would require enabling the optional Windows feature, a one-time OS-level step outside this phase's code. |
| OpenSSH client (GitHub Actions `ubuntu-latest`) | D-01 tunnel, CI half | Not probed this session (no CI run available to inspect) [ASSUMED] | Standard on GitHub-hosted runner images | `apt-get install -y openssh-client` as an explicit workflow step if the assumption is wrong. |
| `gh` CLI (CI) | Environment/tracking-issue steps | ✓ — confirmed live in `pr-gate.yml`'s `analyze` job [VERIFIED: .github/workflows/pr-gate.yml] | Whatever ships on `ubuntu-latest`; `gh 2.100.0` confirmed live per `docs/decisions.md` D26/`05-CONTEXT.md` | None needed. |
| `hcloud` CLI (owner's machine, D-03 recon) | Hetzner Cloud Firewall inspection | UNKNOWN — not established this session | — | Hetzner Cloud web console (no install needed). |
| `nmap` or equivalent (owner's machine, D-04 external vantage) | External port-scan record | UNKNOWN | — | PowerShell's built-in `Test-NetConnection -ComputerName <host> -Port 5432`, zero-install on Windows 11. |

**Missing dependencies with no fallback:** None identified — every dependency above has a documented fallback or is a one-time OS-level enablement outside this phase's own scope.

**Missing dependencies with fallback:** `hcloud` CLI and `nmap`/`Test-NetConnection` as noted above.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `vitest` `^5.0.0` [VERIFIED: package.json] |
| Config file | `vitest.config.ts` (root, unit/integration suite), `vitest.drill.config.ts` (restore-drill suite) |
| Quick run command | `pnpm test` |
| Full suite command | `pnpm test && pnpm test:history && pnpm test:drill` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|--------------|
| CONN-01 | Staging reachable from CI and dev machine, no inbound port opened | Manual/performed record (D-04) — automation cannot observe the negative claim "no port is open" from inside the system itself | N/A — see `docs/51-staging-port-proof.md` (recommended filename) | ❌ Wave 0 — new performed-record document |
| CONN-02 | Coolify public-port toggle never enabled | Performed record (D-04, one vantage of three) + recon document (D-03) | N/A — UI-state observation | ❌ Wave 0 |
| CONN-03 | `drizzle-kit push` structurally restricted to dev container | unit/integration (automated half) + performed record (manual half, D-08) | `pnpm exec vitest run tests/staging-target-pin.test.ts -x` (new file, name illustrative) | ❌ Wave 0 — new test file, mirrors `tests/target-pin.test.ts`'s existing pattern |
| CONN-04 | Schema change reaches staging with no redeploy, no manual terminal use | Integration (workflow itself is the test) + manual observation that the app kept serving | The `staging-migrate` workflow's own pass/fail on a real merge to `main` | ❌ Wave 0 — new workflow |
| CONN-05 | App runtime and migration execution use separate, differently-privileged credentials | integration | A new test asserting `recipe_app`'s role cannot `CREATE`/`ALTER`/`DROP` against a Testcontainers instance seeded with the bootstrap SQL, mirroring `tests/history/support.ts`'s harness pattern | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm test` (fast unit/integration suite, excludes Testcontainers-heavy history/drill suites)
- **Per wave merge:** `pnpm test && pnpm test:history` (the marker-refusal Testcontainers test lives here, per D-08)
- **Phase gate:** Full suite green, **plus** all three performed records (D-03 recon, D-04 port-proof, D-08 push-refusal) committed with verbatim output, before `/gsd-verify-work`.

### Wave 0 Gaps

- [ ] `tests/staging-target-pin.test.ts` (or equivalent name) — Testcontainers-based marker-refusal test (D-08's automated half): seed a container with the `staging` marker, assert the dev guard refuses it; seed one with `development`, assert `drizzle-kit push`-equivalent behavior still succeeds.
- [ ] `tests/roles-privilege-boundary.test.ts` (illustrative name) — covers CONN-05, asserting `recipe_app` cannot execute DDL, `recipe_readonly` cannot execute DML, against a Testcontainers instance seeded with the bootstrap SQL from Pattern 4.
- [ ] `scripts/ci/wait-for-port.ts` — new, no existing equivalent (Pattern 3).
- [ ] `docs/50-staging-connectivity-recon.md`, `docs/51-staging-port-proof.md`, `docs/52-staging-push-refusal.md` (or whatever numbering discretion settles on) — the three performed-record documents this phase's criteria depend on; none exist yet.
- [ ] Framework install: none — `vitest` and `@testcontainers/postgresql` are already present.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|-------------------|
| V2 Authentication | Yes | SSH public-key authentication (restricted keys, no passwords) for the tunnel; PostgreSQL role passwords for the three database roles. |
| V3 Session Management | Partial | Not a web-session concern; the closest analogue is the tunnel's lifetime (D-02's "one named step" contract) and the CI job's short-lived credential exposure window. |
| V4 Access Control | Yes | The three-role least-privilege design (D-09) is the core access-control mechanism this phase builds — `recipe_app` denied DDL, `recipe_migrator` denied superuser/multi-database reach, `recipe_readonly` denied any write. |
| V5 Input Validation | Yes | `scripts/env.ts`'s zod-backed schema, extended with the staging pin (D-06) — already the project's established pattern. |
| V6 Cryptography | Yes — never hand-rolled | SSH transport encryption (OpenSSH, not reimplemented); PostgreSQL connection encryption is whatever the existing `pg` client + connection string negotiate (verify TLS is in effect for the staging connection specifically, since it now crosses a network boundary the local dev connection never did — recommend an explicit check, not an assumption, since the tunnel encrypts the SSH hop but the `pg` protocol itself inside the forwarded port is still the thing actually carrying credentials and data end-to-end from the CI/dev-machine process's perspective). |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Loopback-collision spoofing: a tunneled remote database appearing to satisfy the local dev pin | Spoofing | D-07's server-side marker, fail-closed on absence (already decided; see Pitfall 1 for the corrected mechanism). |
| Credential leakage via error messages or logs | Information Disclosure | `safeErrorMessage` (already established, `scripts/log.ts`) — reused unmodified by the new staging entry point and bootstrap script; never `console.log`/`JSON.stringify` a raw `Error` object or a connection string. |
| SSH key compromise granting more than intended | Elevation of Privilege | `restrict,permitopen,command="/bin/false"` scopes the CI key to forwarding exactly one `host:port` and nothing else — verified syntax in Pattern 1. Two independently-revocable keys (D-12) limit blast radius per compromise. |
| Repository-secret exposure to an unmerged branch PR | Information Disclosure / Elevation of Privilege | GitHub Environment scoped to `main`-only deployment branch policy (D-15) — verified this is the load-bearing control on a public repository, where branch (non-fork) PRs otherwise do receive repository-level secrets. |
| A failed/interrupted bootstrap leaving `recipe_app` without access to pre-existing tables | Denial of Service (of the application, against its own database) | Pitfall 4's corrected bootstrap script (explicit present-tense `GRANT` alongside the future-tense `ALTER DEFAULT PRIVILEGES`). |
| Unbounded `recipe_migrator` connections exhausting the server's connection budget from a stuck/retrying CI job | Denial of Service | `CONNECTION LIMIT` on both new roles (Pattern 4) — a concrete, small number (5 is illustrative; Claude's Discretion / planning to set a real value) rather than unlimited. |

## Sources

### Primary (HIGH confidence)
- `man.openbsd.org` sshd(8), AUTHORIZED_KEYS FILE FORMAT — `restrict`/`permitopen`/`command` semantics, fetched and quoted directly this session.
- `postgresql.org/docs/17/sql-createrole.html` — CREATE ROLE syntax, no `IF NOT EXISTS`, fetched directly this session.
- `postgresql.org/docs/17/sql-alterdefaultprivileges.html` — retroactivity and executing-role semantics, fetched directly this session.
- This repository's own tracked source, read directly this session: `docker-compose.yml`, `tests/guardrails.test.ts`, `scripts/env.ts`, `scripts/db-migrate.ts`, `packages/automation/src/types.ts`, `apps/recipe-app/drizzle.config.ts`, `.github/workflows/pr-gate.yml`, `.github/workflows/restore-drill.yml`, `package.json`, `tests/history/support.ts`, `tests/target-pin.test.ts`.

### Secondary (MEDIUM confidence)
- `docs.github.com` REST API, Deployment Environments and "Using environments for deployment" — fetched directly this session; the deployment-branch-policies sub-endpoint's exact path was not directly confirmed (see Assumption A2).
- WebSearch, cross-checked across 2+ independent sources: Coolify's "Publicly Accessible" toggle mechanism (Nginx TCP proxy, dynamic port), Coolify database resources' Docker-network addressing and redeploy stability, `hcloud firewall list`/`describe` command existence.

### Tertiary (LOW confidence)
- Whether GitHub-hosted `ubuntu-latest` runners ship OpenSSH client preinstalled — not independently probed this session, standard assumption carried from general runner-image knowledge (Assumption A1).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages, every tool's presence/behavior either verified in this repo directly or confirmed via official docs this session.
- Architecture: MEDIUM-HIGH — the SSH/GitHub/Postgres mechanics are HIGH; the Coolify-specific parts of the diagram (container addressing, toggle behavior) are MEDIUM and explicitly flagged as pending the phase's own hands-on recon.
- Pitfalls: HIGH for Pitfalls 1, 3, and 4 (each backed by a direct source-read this session, with verbatim quotes); MEDIUM for Pitfall 2 (depends on the still-unverified Coolify networking specifics) and Pitfall 5 (explicitly about the limits of documented-vs-verified knowledge).

**Research date:** 2026-09-09
**Valid until:** 30 days for the SSH/PostgreSQL/GitHub API mechanics (stable, slow-moving); effectively until the D-03 recon is performed for anything Coolify-specific — those claims should be treated as provisional the moment the recon produces a contradicting observation.
