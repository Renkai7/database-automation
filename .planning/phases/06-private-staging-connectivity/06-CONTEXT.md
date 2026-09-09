# Phase 6: Private Staging Connectivity - Context

**Gathered:** 2026-09-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 6 is where this project touches a real, persistent, remote database for the first time.
Every database in Phases 1-5 was either a local Docker container or an ephemeral one living
inside a CI job. Staging is neither: it survives between runs, it lives on infrastructure the
owner does not fully have documented, and reaching it requires a network path that does not
exist today.

Three things are therefore inside this phase that a reader might assume are prerequisites:

1. **Nothing for this application is provisioned in Coolify yet.** `docs/00-current-state.md` §4
   records that Coolify on Hetzner exists and is in use, but "nothing for *this* app has been
   provisioned." Creating the staging Postgres resource, and deploying the recipe app alongside
   it, is work inside this phase.
2. **The Coolify instance's actual behaviour is undocumented.** §4 and §6 are lists of open
   checkboxes. Criterion 1 requires D4 to be settled "verified hands-on against this specific
   Coolify instance's actual networking and volume/backup behavior rather than taken on
   community reports alone" — so the recon is a deliverable, not a preliminary.
3. **`docs/decisions.md` D4 is still OPEN.** Closing it with a written rationale is criterion 1.

Requirements in scope: CONN-01, CONN-02, CONN-03, CONN-04, CONN-05.

**Explicitly not this phase:**

- **No production database of any kind.** D3 stands unchanged: production gets no live connection
  from the local machine, and Phase 7 owns the production runner, the environment gate and the
  audit log. Staging is where the shape is rehearsed.
- **No approval or override mechanism, and no environment protection rules.** D-03 below
  configures a GitHub Environment for *secret scoping only*. Required reviewers, the REVIEW
  REQUIRED self-approval gate and PROD-02's assembled-context screen are Phase 7. Adding an
  approval step here would directly contradict criterion 4's "automatically."
- **No audit log.** AUD-01 … AUD-04 remain Phase 7. `05-CONTEXT.md` D-08's "GitHub is the record"
  stopgap continues to apply, and continues not to be an audit trail.
- **No automatic database rollback.** `PROJECT.md` Out of Scope, reaffirmed by D-16 below.
- **No WireGuard, Headscale or Tailscale.** D-01 settles the mechanism as restricted SSH; the
  mesh-VPN options are deferred with a recorded reason and a seam that keeps them cheap.
- **No expand-and-contract work.** APP-03 stays reserved for Phase 7 (`01-CONTEXT.md` D-11's
  fourth churn row).
- **No extension of the backup tooling past its local pin.** D-16 declines a pre-migration staging
  snapshot; PROD-02's "current backup status" requirement is Phase 7's to solve.

</domain>

<decisions>
## Implementation Decisions

### D4: the connectivity mechanism (criterion 1)

- **D-01:** **D4 closes as a restricted SSH key with `permitopen`.** One line in
  `authorized_keys` of the form
  `restrict,permitopen="<stable-destination>:5432",command="/bin/false" ssh-ed25519 …` — a key
  that cannot open a shell, cannot run a command, and can forward exactly one TCP destination.
  The owner's stated goal is a self-hosted setup with control, qualified by "if it becomes a new
  project to set up, defer it — this project is about automating the database."
  Restricted SSH satisfies both halves better than the alternatives: it is **more** self-hosted
  than Headscale (there is no control plane at all, no account, no third party, nothing to run),
  it adds no new service and no new inbound port because port 22 is already open for Coolify's own
  host management, and `docs/decisions.md` **D5** already worked the risk through and concluded
  the combination to avoid is "no SSH, but a public database port" — not SSH itself.
  **Rejected, with reasons that must survive into the record:**
  - **Headscale** — gives the control the owner wants, and is a project: a public HTTPS endpoint,
    a domain, TLS, a container to run, secure, upgrade and back up. Worse, hosting it on the same
    Coolify box makes the control plane for reaching the infrastructure depend on the
    infrastructure it reaches.
  - **Raw WireGuard** — same crypto as Tailscale, and the server half is genuinely quick. The CI
    half is the project: every GitHub Actions run is a fresh machine, so it needs either one
    long-lived static private key in Secrets with no per-run identity and manual revocation, or
    peer-provisioning automation that gives CI write access to the server's config — the exact
    thing this project exists to avoid. It also opens inbound UDP/51820 (excellent as inbound
    ports go — WireGuard does not answer unauthenticated packets — but CONN-01 is worded "no
    inbound port opened on the server") and needs hand-written `ip_forward`, `AllowedIPs` and
    MASQUERADE rules to reach the Coolify Docker subnet.
  - **Hosted Tailscale** — the best CI story by a distance (OAuth + GitHub OIDC mints a
    short-lived tagged ephemeral node per run that removes itself), and literally zero inbound
    ports. Rejected on the one axis the owner named: the control plane is third-party.
  **Honest weaknesses of the choice, to be stated wherever it is described:** access control is
  scattered `authorized_keys` lines rather than a declarative auditable policy; the CI key is
  long-lived with manual revocation (though confined to forwarding one port, unlike a WireGuard
  key which grants a network path); and each job needs shell plumbing to raise the tunnel and
  wait for the port.
  — **Reversibility:** reversible by design — see D-02, which is what makes it so.

- **D-02:** **The connection is a mechanism-agnostic seam, enforced explicitly.** Connectivity is
  established by a separate, named step whose entire contract is "after me, the staging URL
  connects." Nothing downstream may reference SSH. Two consequences follow and are binding:
  1. **`ARCHITECTURE.md:144`'s forced-command variant is ruled out.** Having CI SSH in under a
     forced command that runs a one-off migration container on the Docker network is genuinely
     private and arguably elegant — and it bakes SSH into the *structure* of how migrations
     execute, so it would not port to WireGuard at all.
  2. **The staging pin cannot assert a literal host and port.** That value is mechanism-dependent:
     `127.0.0.1:<localport>` under `ssh -L`, a peer address under WireGuard. Resolved in D-05 by
     asserting something better rather than by weakening the guard to fit the tunnel.
  What a later swap actually costs: one workflow step, one `authorized_keys` line, one keypair,
  one wait-for-port helper. Nothing architectural.

- **D-03:** **The hands-on recon closes all of `docs/00-current-state.md` §4 and §6 as a committed
  document.** Server count and specs, Coolify version, whether port 22 is open, the Hetzner Cloud
  Firewall's inbound rules, whether any database public port is enabled anywhere today, whether
  Coolify databases are managed *resources* or services in a compose stack, whether the Docker
  network subnet and the container's address are stable across redeploys, volume and backup
  behaviour, and where secrets live.
  A connectivity-only recon was rejected because criterion 1 names volume/backup behaviour
  explicitly, which is broader than connectivity — and because the same facts are Phase 7's inputs.
  **The subnet-stability answer is load-bearing for D-01:** `permitopen` is a static destination
  allowlist while `ARCHITECTURE.md:164` warns Coolify reassigns container addresses on redeploy.
  The recon must establish what stable destination the tunnel can name — Postgres bound to the
  host's loopback, the Docker subnet allowed at 5432, or something else this instance permits.

- **D-04:** **Criterion 2's "no new inbound database port" is proven by one performed record
  covering three vantages**, written verbatim into `docs/` following `05-CONTEXT.md` D-18's
  precedent: an external scan from off-host (what an attacker sees), host-side listener
  enumeration via `ss -tlnp` (what is actually bound), and the Coolify "Publicly Accessible"
  toggle state. Each answers a different question — a Hetzner firewall can hide a live listener,
  and a listener can sit behind a closed firewall that one rule change would expose.
  A continuous CI probe of the host's public IP was considered and **not taken**: it would put the
  host IP into GitHub Secrets on a public repository and risk leaking it into a job log.

### How the runner reaches staging

- **D-05:** **A second pinned entry point, `scripts/db-migrate-staging.ts`** — a thin sibling of
  `scripts/db-migrate.ts` over the identical `runMigrations` core, reusing the D-27/D-28
  pure-core/thin-adapter seam that already exists. It reads its own environment variable and
  asserts its own staging pin.
  This keeps `01-CONTEXT.md` D-16 and `02-CONTEXT.md` D-06's **"no command accepts a target"**
  literally true: each command has exactly one possible destination, fixed in source. It also
  means `db:migrate` on the development machine can never reach staging even by accident, because
  it is a different command reading a different variable.
  Rejected: a `db:migrate --env staging` flag (reintroduces "a command accepts a target" in
  spirit — the exact shape `04-CONTEXT.md` D-23 took care to argue around), and inferring the
  environment from whichever variable happens to be present (makes the destination a property of
  ambient environment rather than of the command).
  Cost accepted: roughly 40 lines of duplicated wiring, with the assertions deliberately divergent.

- **D-06:** **The staging pin asks the server, it does not trust the URL.** The static half checks
  only mechanism-independent facts — the database name is `recipe_staging`, and the URL is
  explicitly refused if it would satisfy the development pin. The load-bearing half is dynamic:
  connect, then `SELECT current_database()` and `current_user`, and refuse unless both match.
  This is **stronger** than the development pin, not a concession to D-02: it is a fact reported
  by the server rather than a string someone typed into a connection string, and it is indifferent
  to how the packet arrived. `assertDevelopmentDatabase` in `scripts/env.ts` already establishes
  the pattern.

- **D-07:** **A server-side environment marker closes the loopback collision, fail-closed.**
  **The hazard, found during discussion and created by D-01:** `ssh -L` makes a *remote* staging
  database appear at `127.0.0.1:5432`. `assertLocalDevelopmentTarget` requires loopback, port
  5432, and database `recipe_dev` — so with a tunnel open, two of its three checks already match
  staging, and only the database *name* stands between `drizzle-kit push` and the staging schema.
  If staging were ever named `recipe_dev` — plausible, since that name would come from copying the
  compose file — the development pin passes and `push` rewrites staging directly. That is exactly
  the failure CONN-03 exists to prevent.
  **The fix:** the development container's init script (already mounted per `01-CONTEXT.md` D-14)
  seeds a marker on the database reading `development`; staging's reads `staging`.
  `assertDevelopmentDatabase` additionally requires the marker to read `development`, and treats
  an **absent or unreadable marker as failure, never as pass**. A tunnel cannot fake it — the
  answer comes from the server actually connected to.
  Naming staging `recipe_staging` and forwarding to a local port other than 5432 come along as
  free hygiene; they are **not** the guard. Both are conventions someone must remember, which is
  the shape `CLAUDE.md`'s first non-negotiable rejects.
  — **Reversibility:** costly — the marker becomes a precondition of the development guard, so
  removing it later means every developer container, every Testcontainers fixture and every CI
  service container that seeds one must be revisited together.

- **D-08:** **CONN-03 is proven twice: a performed attempt and an automated test.** The owner
  opens the tunnel and actually runs `drizzle-kit push`, recording verbatim what it says —
  criterion 3 says "proven by attempting it," and a test asserting an assertion is not that claim.
  Alongside it, a test spins up a Testcontainers Postgres carrying the `staging` marker, points the
  development guard at it and asserts refusal — plus the positive half criterion 3 also requires,
  that `push` still works normally against the real development container.
  This is the project's established pattern: perform once by hand, then verify continuously
  (`02-CONTEXT.md` D-10 plus the automated drill; `05-CONTEXT.md` D-18 plus D-05).

### Credentials (CONN-05)

- **D-09:** **Three roles, each denied what the others need.** Criterion 4 requires the migration
  credential to be "different from — and **more restricted than** — the application's own runtime
  database credential," which reads oddly given the migrator is the one doing DDL. The reading
  this phase is verified against:
  - **`recipe_app`** — DML only: `SELECT`/`INSERT`/`UPDATE`/`DELETE` plus sequence usage. No
    `CREATE`, `ALTER` or `DROP`. The application can never change the schema.
  - **`recipe_migrator`** — owns the schema and may run backfill DML, but is `NOSUPERUSER`,
    `NOCREATEDB`, `NOCREATEROLE`, confined to the one staging database, connection-limited, and
    reachable only over the CI tunnel.
  - **`recipe_readonly`** — `SELECT` and nothing else. This is the development machine's
    credential (D-11).
  "More restricted" therefore means: neither role is the superuser Coolify generates, the
  migrator's reach stops at one database, and the application's stops at the data.
  **Rejected, and worth recording because it is the better fit to the threat model:** a migrator
  with no data access at all — an agent-driven credential that can reshape the schema but can
  never read a row. Postgres has no clean write-without-read (an `UPDATE … WHERE` needs `SELECT`
  on the referenced columns), and `apps/recipe-app/drizzle/0003_backfill_steps_timer_label.sql` is
  a committed `UPDATE` backfill that such a role would refuse. Also rejected: restricting by
  reachability alone, which is simplest and unverifiable as a privilege claim.

- **D-10:** **The roles are created by a committed, idempotent SQL bootstrap script, run once over
  the tunnel with a performed record.** It creates all three roles, sets their grants, and —
  critically — sets `ALTER DEFAULT PRIVILEGES FOR ROLE recipe_migrator … GRANT … TO recipe_app`
  so every table a future migration creates is automatically granted to the application role.
  Without that, each new migration needs a remembered manual grant, which is precisely the failure
  shape `CLAUDE.md`'s first non-negotiable rejects.
  The Coolify-issued credential is used exactly once, for this bootstrap, and then goes unused
  routinely. Phase 7 reruns the same script against production.
  Rejected: interactive bootstrap with notes written afterwards (makes production a from-notes
  repeat rather than a re-run, and turns "what privileges does staging have" into a claim about a
  document rather than a file you can diff), and leaving the application on the Coolify-generated
  owner (that user is typically the database owner, so the app would keep full DDL — defeating
  half of criterion 4).
  — **Reversibility:** costly — the application's `DATABASE_URL` in Coolify is repointed off the
  generated credential onto `recipe_app`, so reverting means editing the deployed application's
  environment, not just the database.

- **D-11:** **The development machine gets `recipe_readonly` and only that.** Criterion 2 requires
  the machine to connect to and query staging; a `SELECT`-only role satisfies it fully. The
  consequence is what matters: criterion 4's "no one pasting a command into a Coolify terminal"
  and CONN-04's automatic-only path become **structurally** true rather than procedurally true —
  the machine physically lacks a credential that could migrate.

- **D-12:** **Secrets split by capability, not by environment.** The rule: *a credential that can
  only read may live on the development machine and be agent-visible; a credential that can change
  anything may not.*
  - `recipe_readonly`'s staging URL sits in the local gitignored environment file alongside the
    development URL, and Claude Code uses it freely. That is the origin pain point from
    `PROJECT.md` being solved, not a lapse.
  - `recipe_migrator`'s credential and the CI SSH key exist only in GitHub, and never touch the
    machine — D3's logic applied to staging: access that does not exist cannot be misused.
  - **Two distinct SSH keys**, CI's and the owner's, each its own `authorized_keys` line with its
    own `permitopen`, independently revocable.
  Rejected: keeping the staging credential on the machine but instructing the agent not to read it
  — that depends on an agent choosing to behave, which `CLAUDE.md` says is not a safeguard, and it
  would defeat the inspection this project was started to enable.
  Phase 7 tightens along the same axis rather than a new one: production's read path is a
  committed `pg_dump --schema-only` snapshot (D3), not a connection.

### Staging's shape and how a change reaches it (CONN-04)

- **D-13:** **Staging is a Postgres resource *and* the recipe app deployed alongside it.**
  Criterion 4's "with no application redeploy" is only an observable claim if an application is
  actually running — with a database alone, that half of the criterion is a statement about
  something that is not there, and it would carry into Phase 7 as an untested assumption. Watching
  the app keep serving on an unchanged container while the schema changes underneath is the exact
  inverse of the pain point that started this project (`PROJECT.md` Context; root cause confirmed
  in `docs/00-current-state.md` §7 and `docs/decisions.md` D14). It also exercises `recipe_app`'s
  DML-only grants for real.
  `PROJECT.md` already scopes the app as a thin fixture that need only boot and hold a real schema,
  so this is not a licence to deepen it.
  Rejected: Postgres only (cheapest, leaves criterion 4 half-unverifiable), and a bespoke
  always-on connection probe instead of the app (proves continuity cheaply, but is a thing invented
  for the test, and "the app kept running" would still be untested).

- **D-14:** **Merge to `main` triggers the staging migration.** `main` is already protected by the
  Phase 5 ruleset with required checks and an empty bypass list, so anything reaching it has
  passed the analyzer, both history axes and both tamper checks. A push-to-`main` workflow then
  migrates staging. The roadmap's wording ("the staging branch/pipeline") permits either shape;
  this one adds no second protected branch and no extra merge step on a single-developer
  repository, and the thing gating staging is the gate Phase 5 already proved works.
  Rejected: a dedicated `staging` branch (decouples merged from deployed, at the cost of a second
  protected branch and an extra merge per change), and `workflow_dispatch` (criterion 4 says
  "automatically", which a manual trigger does not satisfy).

- **D-15:** **A GitHub Environment named `staging`, with its deployment branch rule restricted to
  `main`, holds the SSH key and the `recipe_migrator` credential.** The branch restriction is the
  load-bearing part, not the Environment itself: on a public repository, pull requests from
  branches **do** receive repository secrets, so repository-level secrets would let an unmerged
  change add a step that reads the staging migration credential. Scoping to `main` means only a
  post-merge job can reach them.
  This is `05-CONTEXT.md` D-14's anticipated move — the existing `migrate` job shape gains an
  environment and a credential rather than a new shape being invented. **No protection rules and
  no required reviewers here**; that is Phase 7's, and adding one now would contradict criterion
  4's "automatically."

- **D-16:** **A failed staging migration fails loudly and opens or updates a tracking issue; the
  schema is left as the runner left it; there is no pre-migration snapshot.**
  `.github/workflows/restore-drill.yml` already establishes the tracking-issue pattern for a
  workflow with no pull request to comment on. No automatic rollback — `PROJECT.md` puts that
  explicitly out of scope, and `docs/decisions.md` D23 already holds that recovery reports and
  resolves but never repairs (`db:migrate:recover`). Staging is rebuildable from the migration
  history plus the seed, so a snapshot would be ceremony.
  **Recorded because it is a real argument that was declined, not overlooked:** taking a
  pre-migration `pg_dump` of staging over the tunnel would rehearse PROD-02's "current backup
  status" requirement in the cheap environment — this project's usual pattern — and somebody must
  eventually extend Phase 2's backup tooling past its local pin. Declined here as Phase 7's scope.

### Carried forward (binding, not re-decided here)

- **The runner is the wall; every gate upstream of it sits on a bypassability spectrum and must be
  described honestly as such** (`docs/decisions.md` D12). The tunnel, the Environment branch
  restriction and the ruleset are all upstream gates.
- **Classification is re-derived at execution time** (D12). The staging runner re-classifies every
  migration it applies; the PR gate's verdict is not carried over as a token.
- **BLOCKED is the wall; REVIEW REQUIRED proceeds with complete findings** (`04-CONTEXT.md` D-05,
  `05-CONTEXT.md` D-06). Staging is where REVIEW REQUIRED migrations are actually observed. No
  override path is built in this phase either.
- **Migrations never run at application startup** (D8). D-13 deploys the app to staging; the app's
  boot path must not gain a migrate call, and `tests/guardrails.test.ts` already asserts this
  (`05-CONTEXT.md` D-15).
- **Hard-fail, never warn** (`01-CONTEXT.md` D-20). A tunnel that did not come up is not a
  migration that succeeded.
- **PostgreSQL 17 pinned across dev/staging/production** (D9). Staging's Postgres is 17.
- **Production's PostgreSQL major version is still UNKNOWN** (`docs/decisions.md` D16). Unchanged
  by this phase; staging's version being confirmed does not close it.
- **The runner's exit-code contract is `RUNNER_EXIT_CODES`** (`packages/automation/src/runner/exit-codes.ts`).
- **A parse failure (exit 30) and an invalid rules file (exit 40) are reported distinctly from
  BLOCKED** (`03-CONTEXT.md` D-08, `04-CONTEXT.md` D-08).
- **Never log or commit credentials** (`CLAUDE.md`) — sharpened here, because this is the first
  phase in which real credentials to a persistent remote database exist at all.
- **Mark unverified things UNKNOWN** (`CLAUDE.md`). The Forgejo portability assessment below is
  marked MEDIUM confidence for exactly this reason.

### Claude's Discretion

- **The environment marker's mechanism** — a table, a database `COMMENT`, or a custom GUC set via
  `ALTER DATABASE … SET`. The decision is that a server-side marker exists and is checked
  fail-closed (D-07); the shape is open. Whichever is chosen must be seedable from the existing
  init-script mount, from Testcontainers fixtures, and from the CI service container.
- **Tunnel lifecycle in CI** — whether it is a composite action, a script, or inline steps; how it
  waits for the forwarded port; and what it does if the tunnel dies mid-migration.
- **Whether the development machine's tunnel is on-demand or a persistent helper**, and how it is
  documented for Windows (OpenSSH ships with Windows 11).
- **SSH key passphrase handling**, and how CI supplies one if the keys are passphrase-protected.
- **The bootstrap script's location, name and idempotency mechanism** (`DO $$` blocks, `IF NOT
  EXISTS`, or a re-runnable grant-only shape), and whether it is invoked through a `pnpm` script.
- **Whether `recipe_migrator` owns `runner.migration_runs` and the drizzle ledger on staging**, or
  whether those are bootstrapped separately — `04-CONTEXT.md` D-22 already made the runner table
  imperative rather than a Drizzle migration.
- **Filenames and locations for the recon record (D-03), the port-proof record (D-04), and the
  CONN-03 performed record (D-08)** — following `docs/`'s `00-`/`10-`/`20-`/`30-`/`40-` numbering.
  Whether D-03 updates `docs/00-current-state.md` in place or lands as a new numbered document.
- **How staging's seed data is managed**, and whether `db:seed` is reachable against staging at all
  (note D-11: `recipe_readonly` cannot write, so seeding is not a development-machine operation).
- **Whether the role-bootstrap SQL is passed through the safety analyzer.** It is not a Drizzle
  migration and contains `CREATE ROLE`/`GRANT`, which the rule catalogue may not classify; decide
  and record rather than leave implicit.
- **The staging workflow's file layout** — a new workflow or a job added to an existing one, and
  the job/check naming (Phase 5's required-check names are ruleset configuration and must stay
  stable).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase requirements and goal

- `.planning/ROADMAP.md` § "Phase 6: Private Staging Connectivity" — the goal and the four success
  criteria this phase is verified against. Criterion 1 (D4 resolved *and verified hands-on*),
  criterion 3 (`drizzle-kit push` proven to fail) and criterion 4's "more restricted than" clause
  are the sharp ones.
- `.planning/REQUIREMENTS.md` — CONN-01 … CONN-05 are this phase's requirements. Its Out of Scope
  table lists anti-features that must not be reintroduced.

### Binding prior decisions

- `docs/decisions.md` — **D4** (the OPEN decision this phase closes; D-01 is its resolution),
  **D5** (SSH vs. exposed database port — the direct basis for D-01, and its "to verify: whether
  port 22 is in fact open" is D-03's assignment), **D2/D3** (no production access; D-12 applies
  D3's logic to staging), **D8** (migrations never at application startup — D-13 deploys an app,
  so this matters again), **D9** (PostgreSQL 17 pinned), **D12** (classification re-derived at
  execution time; the bypassability spectrum), **D14** (the confirmed migrate-on-boot root cause
  that D-13 exists to disprove for this app), **D16** (production's PG major is UNKNOWN), **D21**
  (`drizzle-kit migrate` structurally unreachable), **D23** (recovery reports, never repairs —
  behind D-16).
- `docs/00-current-state.md` **§4** (the infrastructure UNKNOWNs D-03 closes), **§6** (backups and
  secrets UNKNOWNs, also in D-03's scope), **§7** (the two owner-stated pain points and the
  confirmed migrate-on-boot root cause), **§8** risk **R5** ("avoiding SSH may push toward riskier
  exposure options" — D-01 resolves it in the opposite direction to the one R5 feared).
- `.planning/phases/05-ci-pipeline-gate/05-CONTEXT.md` — **required reading.** Directly binding:
  **D-14** (the `migrate` job shape this phase adds an environment and credential to — D-15 is its
  execution), **D-18** (the performed-record precedent behind D-04 and D-08), **D-17** (pure core,
  thin adapter — the seam D-05 reuses and the one that survives a Forgejo move), **D-06** (BLOCKED
  fails, REVIEW REQUIRED proceeds), **D-04** (the ruleset that makes D-14's merge-to-main trigger
  trustworthy), **D-02** (the repository is public — the reason D-15's branch restriction matters
  and D-04 declines a CI probe), **D-15** (the startup-migration guardrail).
- `.planning/phases/04-migration-runner-history-tests/04-CONTEXT.md` — **required reading.**
  **D-23** (`--migrations-dir` names a directory, not a target — the argument D-05 preserves),
  **D-27/D-28** (the pure-core/thin-adapter seam and the only-entry-point-holds-a-connection rule
  D-05 reuses), **D-22** (the runner table bootstrapped imperatively), **D-05** (complete findings,
  never a summary), **D-15** (verify, do not trust — the shape of D-06's dynamic check).
- `.planning/phases/01-local-environment/01-CONTEXT.md` — **D-16** (`assertLocalDevelopmentTarget`
  and pin-in-source; D-06 and D-07 extend it rather than loosen it), **D-14** (the container init
  script mount D-07's marker rides on), **D-20** (hard-fail, never warn), **D-12** (`postgres:17`
  Debian).
- `.planning/phases/02-backup-restore-drill/02-CONTEXT.md` — **D-06** (no command accepts a
  target), **D-10** (the runbook written from a performed act), **D-19** (the staleness gate).
- `CLAUDE.md` and `.claude/CLAUDE.md` — non-negotiables. Especially: prefer architectural
  enforcement over remembered caution (D-07 and D-10 are this phase's instances, and D-07's
  "naming discipline is not the guard" note is the explicit application); no database port exposed
  to the public internet; remote access must add no inbound attack surface (D-01); mark unverified
  things UNKNOWN; never log or commit credentials.

### Research

- `.planning/research/ARCHITECTURE.md` — **Pattern 3, lines 155-181** is the single most relevant
  passage: the Tailscale-vs-restricted-SSH mechanics, the literal `permitopen` line D-01 uses, and
  line 181's recommendation (which D-01 departs from, with reasons recorded). **Line 144** is the
  forced-command variant D-02 rules out. **Line 164** is the Coolify container-IP instability
  caveat that makes D-03's subnet-stability question load-bearing. **Lines 306-318** map the
  platform surface and state the one-environment-credential-per-process rule.
- `.planning/research/PITFALLS.md` — **line 535** ("reachable" is not "safely scoped" — the row
  that names D4 directly) and **line 550** (never open the port even temporarily, not even for a
  quick check).
- `.planning/research/SUMMARY.md`, `FEATURES.md`, `STACK.md` — background; STACK.md's
  `@testcontainers/postgresql` version is what D-08's test uses.

### Existing code this phase builds on

- `scripts/env.ts` — `assertLocalDevelopmentTarget`, `assertDevelopmentDatabase`,
  `DEV_DATABASE_HOST_ALLOWLIST`, `EXPECTED_DEV_DATABASE_PORT`/`_NAME`/`_ROLE`, and the
  import-time zod validation. D-06's staging pin is modelled on it; D-07 extends
  `assertDevelopmentDatabase` with the marker check.
- `scripts/db-migrate.ts` — the pinned thin entry point D-05 clones for staging. Note its header
  comments on "no command accepts a target" and on never forcing a synchronous exit.
- `scripts/db-migrate-recover.ts` — the recovery path D-16 relies on rather than a rollback.
- `apps/recipe-app/drizzle.config.ts` — calls `assertLocalDevelopmentTarget` explicitly so the
  guard travels with `generate`/`push`. This is the file criterion 3 is really about, and the one
  D-07's hazard would have defeated.
- `apps/recipe-app/drizzle/0003_backfill_steps_timer_label.sql` — the committed `UPDATE` backfill
  that rules out a no-data-access migration role (D-09).
- `packages/automation/src/index.ts`, `runner/exit-codes.ts` — the barrel D-05's entry point
  imports from, and the exit-code contract.
- `.github/workflows/pr-gate.yml` — the `migrate` job (line ~309) is the shape D-15 extends; note
  the `concurrency` block and the per-job `timeout-minutes` guards.
- `.github/workflows/restore-drill.yml` — the scheduled-workflow-with-tracking-issue pattern D-16
  reuses ("Open or update the tracking issue on failure").
- `docker-compose.yml` and the container init-script mount — where D-07's `development` marker is
  seeded.
- `tests/guardrails.test.ts` — home for source-surface assertions; D-08's guard tests and the
  startup-migration assertion live here.
- `tests/history/support.ts` — the existing Testcontainers harness D-08's marker test builds on.
- `package.json` (root) — the script surface; D-05 adds a staging migrate script to it.

</canonical_refs>

<code_context>
## Existing Code Insights

Almost nothing in this phase is new analysis logic. The runner, the analyzer, the classifier and
both history axes already exist and are exercised in CI. What is new is **infrastructure that does
not exist yet** — a Coolify Postgres resource, a deployed application, three database roles, an
SSH tunnel — plus two guard extensions and one new thin entry point.

### Reusable Assets

- **The runner core** — `runMigrations` and everything under `packages/automation/src/runner/`
  takes an already-constructed client and holds no connection of its own (D-28). D-05's staging
  entry point is therefore genuinely thin.
- **`assertDevelopmentDatabase`** — already does the "ask the server what it is" round trip that
  D-06 generalises and D-07 strengthens.
- **The container init-script mount** (`01-CONTEXT.md` D-14) — D-07's marker needs no new
  mechanism, only a new statement in an existing script.
- **`tests/history/support.ts`'s Testcontainers harness** — D-08's marker-refusal test is a new
  fixture in an established harness, not new infrastructure.
- **`.github/workflows/restore-drill.yml`'s tracking-issue step** — D-16's failure handling is a
  copy of a working pattern, including its "no pull request to comment on" problem.
- **The `migrate` job in `pr-gate.yml`** — D-15 adds `environment: staging` and a credential to a
  job shape that already runs the real `pnpm db:migrate` entry point.
- **`docs/20-restore-runbook.md` and `docs/30-migration-runner.md`** — worked examples of records
  written from performed acts, the model for D-03, D-04 and D-08.

### Established Patterns

- **Architectural enforcement over remembered caution.** D-07 (a server-side marker instead of a
  naming convention), D-10 (`ALTER DEFAULT PRIVILEGES` instead of a remembered grant) and D-11
  (the machine lacks the credential rather than being trusted not to use it) are this phase's
  instances. Each replaces something a person would otherwise have to remember.
- **Verify, do not trust the caller's account of itself.** `assertTimeoutsInEffect` re-queries
  `pg_settings`; `assertMigrationHistoryApplied` re-reads the ledger; D-06 re-asks the server which
  database it is. Same move, third phase running.
- **Perform once by hand, then verify continuously.** D-04 and D-08 both pair a performed record
  with a mechanism that keeps proving it.
- **Pure core, thin adapter.** D-05 reuses the seam; and per the Forgejo assessment below, that
  seam is about to pay off in a way nobody anticipated when it was drawn.
- **No command accepts a target.** Preserved literally by D-05's separate-entry-point choice.
- **Documentation is a deliverable.** D-03 is the clearest instance yet — the recon output is a
  primary artefact of this phase, not a byproduct.

### Integration Points

- **New infrastructure:** a Coolify Postgres resource (PostgreSQL 17), the recipe app deployed to
  staging, two SSH keypairs with `authorized_keys` entries, and three database roles.
- **New in `scripts/`:** `db-migrate-staging.ts` (D-05), the staging pin alongside the development
  one in `env.ts` (D-06), and the role-bootstrap SQL (D-10).
- **Changed in `scripts/env.ts`:** `assertDevelopmentDatabase` gains the fail-closed marker check
  (D-07). This is a change to the most safety-critical function in the repository — every existing
  caller is affected, and every test fixture and CI service container must seed the marker.
- **Changed in `docker-compose.yml` / the init script:** the `development` marker (D-07).
- **New in `.github/`:** a staging Environment with a `main`-only deployment branch rule (D-15) and
  a push-to-`main` staging migration workflow (D-14, D-16).
- **New in `docs/`:** the recon record (D-03), the port-proof record (D-04), and the CONN-03
  performed record (D-08). `docs/00-current-state.md` §4/§6 stop being open checkboxes.
- **New in `tests/`:** the marker-refusal test (D-08).
- **Changed in Coolify:** the application's `DATABASE_URL` is repointed off the generated owner
  onto `recipe_app` (D-10).
- **Consumed by Phase 7:** the bootstrap script reruns against production; the staging Environment
  gains protection rules and required reviewers; D-12's capability split extends to the production
  credential; D-16's declined pre-migration snapshot becomes PROD-02's "current backup status."

</code_context>

<specifics>
## Specific Ideas

- **"Self-hosted with control, but not a new project to set up."** The owner's framing, and the
  sentence that decided D-01. Restricted SSH wins because it is *more* self-hosted than Headscale
  while costing one line in `authorized_keys`.
- **Tailscale *is* WireGuard.** Same data plane; Tailscale adds coordination, NAT traversal and
  identity. The real choice was never about the tunnel primitive — it was about who runs the
  control plane and how CI gets an identity.
- **The tunnel is what made `drizzle-kit push` dangerous again.** `ssh -L` puts a remote database
  at `127.0.0.1:5432`, which is exactly what the development guard trusts. D-07 exists because the
  D-01 decision opened a hole that did not exist in Phase 1.
- **A marker on the server beats a name in a URL.** D-06 and D-07 are the same idea twice: ask the
  thing you are connected to what it is, and fail closed when it will not say.
- **Deploying the app is not app work — it is what makes "no redeploy" a fact.** Without a running
  application, criterion 4's central claim is unobservable and would reach Phase 7 as an
  assumption.
- **The Environment's branch restriction is the control, not the Environment.** On a public
  repository, branch pull requests receive repository secrets; scoping to `main` is what stops an
  unmerged change from reading the migration credential.
- **`ALTER DEFAULT PRIVILEGES` is a safety feature here, not plumbing.** Without it every future
  migration needs a remembered grant, and remembered anything is what this project rejects.
- **The seam is the deferral.** WireGuard/Headscale stay cheap to adopt precisely because D-02
  forbids anything downstream from knowing SSH is involved.

</specifics>

<deferred>
## Deferred Ideas

- **WireGuard or Headscale as the connectivity mechanism** — a later milestone or its own project,
  not Phase 6. Deferred on the owner's own reasoning: this project is about automating the database,
  and standing up a mesh VPN would displace it. D-02's seam is what keeps the swap cheap — one
  workflow step, one `authorized_keys` line, one keypair, one wait-for-port helper. Revisit if a
  tunnel ever needs to serve more than this one purpose, or if per-run CI identity becomes worth
  the control-plane cost.
- **Forgejo migration** — the owner's stated future intent, not a current constraint, so nothing in
  this phase is contorted for it. Assessment recorded at **MEDIUM confidence — reasoned from
  general knowledge, not verified against current Forgejo documentation or a running instance.**
  - *Transfers cleanly:* everything in `packages/automation`, every script, the runner, the
    analyzer, the tests, `docker-compose.yml`, the migration history, the three-role design, and
    the SSH mechanism itself — which is **more** portable than Tailscale would have been, since
    Tailscale's good CI story depends on GitHub's OIDC token and Forgejo Actions does not match it.
    D-01 made the eventual migration easier.
  - *Does not transfer:* `ruleset-config-check` and `ruleset-bypass-audit` (`05-CONTEXT.md` D-05)
    query GitHub's rulesets API, which has no Forgejo equivalent — D30/D31's entire `bypass_actors`
    finding is a GitHub-specific artefact; the sticky-comment plumbing (though `05-CONTEXT.md`
    D-17's pure renderer ports untouched — that seam pays for itself here); and **Phase 7's
    environment-protection gate, which is the largest transfer risk** — GitHub Environments with
    required reviewers have no direct Forgejo equivalent, so that gate would need a different
    mechanism entirely. D-15's Environment is on that list too.
  - *Also worth noting:* `05-CONTEXT.md` D-02's reason for the repository being public (GitHub
    gates rulesets by plan tier) evaporates on self-hosted Forgejo. Publishing was already treated
    as the one-way act, so this is a future option, not an undo.
  - A cheap deliverable if wanted later: a written portability ledger naming which artefacts are
    GitHub-shaped. Not proposed for this phase.
- **A continuous CI probe asserting no public database port** — declined by D-04 because it would
  put the host IP in GitHub Secrets on a public repository and risk leaking it into a job log.
  Revisit if an external vantage becomes available that does not require that.
- **A pre-migration `pg_dump` of staging, and extending Phase 2's backup tooling past its local
  pin** — declined by D-16 as Phase 7 scope. It is the natural rehearsal for PROD-02's "current
  backup status," and somebody must extend that tooling eventually.
- **A migration role with no data access at all** — the better fit to the threat model, blocked by
  Postgres's lack of write-without-read and by the committed `0003` backfill (D-09). Revisit if
  backfills ever move to a separate mechanism from schema migrations.
- **Environment protection rules, required reviewers, and the REVIEW REQUIRED self-approval gate**
  — Phase 7, unchanged. D-15 deliberately builds the Environment without them.
- **The real audit log (AUD-01 … AUD-04) and per-rule override-frequency counting** — Phase 7,
  unchanged.
- **Automatic database rollback** — `PROJECT.md` Out of Scope, reaffirmed by D-16.
- **A staging read path for Claude Code beyond `SELECT`** — not proposed and not wanted; D-12's
  capability split is the rule.
- **Retrofitting the other Coolify applications onto this pipeline** — Phase 7 at the earliest,
  per `PROJECT.md`. D-03's recon will surface facts about them (`docs/00-current-state.md` §5's
  open questions) — record what it finds, act on none of it.

</deferred>

---

*Phase: 6-Private Staging Connectivity*
*Context gathered: 2026-09-09*
