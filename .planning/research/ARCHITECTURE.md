# Architecture Research

**Domain:** PostgreSQL migration-safety / deployment-gating system (self-hosted Coolify + Hetzner, GitHub Actions, Drizzle ORM)
**Researched:** 2026-09-06
**Confidence:** MEDIUM-HIGH (GitHub/SSH/Tailscale mechanics are HIGH — official docs; Coolify-specific behavior is MEDIUM — community reports and changelog, not a formal spec; schema-diff tool comparisons are MEDIUM)

## Standard Architecture

### System Overview

The brief's "Database Controller" sketch (Migration Inspector → Safety Classifier → Environment Manager → Deployment Gate → {Tests, Backups, Audit Log}) is a reasonable *conceptual* model but it draws its boxes around **logical responsibilities**, not around **trust boundaries**. For a system whose entire premise is "architecture prevents the mistake, not caution," trust boundaries are the correct axis to design around. Redrawn that way:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  UNTRUSTED ZONE — developer machine / AI agent                          │
│  ┌─────────────┐   ┌──────────────────┐                                 │
│  │ Drizzle      │──▶│ drizzle-kit       │  (generates SQL, never applies │
│  │ schema.ts    │   │ generate          │   to anything but local dev)   │
│  └─────────────┘   └────────┬─────────┘                                 │
│                              ▼                                          │
│                     migration .sql + journal committed to git           │
└───────────────────────────┬───────────────────────────────────────────-┘
                             │  git push / PR
┌────────────────────────────▼──────────────────────────────────────────┐
│  ADVISORY ZONE — pre-commit hook, local scripts                        │
│  (fast feedback only — bypassable with --no-verify; never the gate)    │
└────────────────────────────┬────────────────────────────────────────--┘
                             │
┌────────────────────────────▼──────────────────────────────────────────┐
│  ENFORCEMENT ZONE — CI, running on GitHub's or a self-hosted runner    │
│  ┌────────────────┐  ┌──────────────────┐  ┌─────────────────────┐    │
│  │ Migration        │  │ Safety Classifier │  │ Migration Runner    │    │
│  │ Inspector         │─▶│ (SAFE/REVIEW/    │─▶│ (applies migration,  │    │
│  │ (parse SQL,      │  │  BLOCKED, data-  │  │  transactional,      │    │
│  │  static rules)   │  │  driven rules)   │  │  one env at a time)  │    │
│  └────────────────┘  └──────────────────┘  └──────────┬───────────┘    │
│           ▲                     │                         │             │
│           │              BLOCKED → fail job         writes to           │
│           │              REVIEW → env protection            │           │
│  ┌────────┴────────┐     rule gates production       ┌──────▼───────┐   │
│  │ Schema Snapshot   │                                │ Audit Log     │   │
│  │ (pg_dump --schema-│                                │ (append-only, │   │
│  │  only, committed) │                                │  DB or file)  │   │
│  └────────────────--┘                                └───────────────┘   │
└──────────────────────────────┬──────────────────────────────────────---┘
                                │ private network only (Tailscale/SSH), no public DB port
┌───────────────────────────────▼────────────────────────────────────────┐
│  TRUSTED DATA ZONE — Postgres containers on Coolify/Hetzner             │
│  Dev (local Docker) ── Staging (Coolify) ── Production (Coolify)        │
│  Each behind its own credential; prod credential exists only in CI      │
│  secret store, never on a developer machine.                           │
└──────────────────────────────────────────────────────────────────────-┘
```

The brief's "Environment Manager" box dissolves under this redraw: dev/staging/prod are not a component the controller manages at runtime, they are **connection profiles + credential scopes** selected by which CI environment/job is running. Treating "Environment Manager" as a live piece of software invites building unnecessary orchestration. It should be config (per-environment `.env`/secrets + a `DATABASE_URL` resolved by CI context), not a service.

### Component Responsibilities

| Component | Responsibility | Real boundary / notes |
|-----------|----------------|------------------------|
| **Migration Inspector** | Parse each new migration's SQL into a list of operations (CREATE TABLE, DROP COLUMN, ALTER TYPE, etc.) | Pure, stateless, deterministic function of the SQL file. No DB connection needed — it reads text. Runs identically on a laptop or in CI. |
| **Safety Classifier** | Map operation list → SAFE / REVIEW REQUIRED / BLOCKED using a data-driven rule table | Pure function of the Inspector's output + a rules file (YAML/JSON), not code — this is what "extensible data rather than hardcoded" (PROJECT.md requirement) means concretely. No DB access. |
| **Schema Snapshot / Visibility** | Produce and store a schema-only artifact of each real environment so it can be reasoned about without a live connection | One-directional: DB → snapshot → git. Never the reverse. Distinct from the Inspector — the Inspector reasons about a *diff* (the migration), the Snapshot reasons about *current state*. |
| **Deployment Gate** | Decide whether a classified migration is allowed to run against a given environment, and enforce human approval when required | This is not one artifact — it is the *composition* of GitHub branch/ruleset protection + environment protection rules + the Migration Runner refusing to proceed on BLOCKED. There is no single "Gate" service to build; it is policy configuration plus a runner that respects the classifier's verdict. |
| **Migration Runner** | Connect to exactly one environment's database with a scoped credential and apply pending migrations transactionally | The only component that needs live DB access on the enforcement side. Should be a small, dumb, replaceable piece (a script/container, not a persistent service) — see Q3/Q6. |
| **Tests** | Verify (a) migration applies cleanly to empty DB and to existing DB, (b) app boots and passes integration tests against the resulting schema | Two distinct test types with different fixtures: history-replay test (empty DB) and forward-apply test (seeded/existing DB). Both belong to the app repo's CI, invoking the shared runner. |
| **Backups** | Scheduled dump, off-server storage, and a *tested* restore procedure | Backups are infrastructure-adjacent (Coolify/Hetzner cron + object storage), not application logic. The automation package's job is limited to the automated restore-drill script and recording its result in the audit log — not owning backup storage itself. |
| **Audit Log** | Append-only record: migration id, commit, environment, classification, result, timestamp, no secrets | Sink, not a service. Simplest correct implementation: a row in a small `_migration_audit` table in each environment's own database (already reachable by the runner that just wrote to it) plus a GitHub Actions job summary. A separate audit *service* is unwarranted complexity for a solo founder. |

**What's missing from the brief's sketch:**

1. **Secrets/credential boundary** is implied but not modeled as a component. It deserves explicit design: which credential the Runner uses per environment, and where it's minted (GitHub Environment secrets, one per env, least-privilege DB role — not the Postgres superuser).
2. **Rollback/forward-fix policy** is a stated philosophy (D8, expand-contract) but has no owning component. It should live as documentation + Safety Classifier rules (e.g., a bare `DROP COLUMN` without a prior `ADD COLUMN` release is flagged REVIEW), not as automated rollback machinery — the brief explicitly rejects automatic DB rollback.
3. **Drift detection** (does the live DB actually match migration history?) is absent from the sketch entirely and is a known failure mode of purely file-based migration systems — see Q5.
4. **Notification/status surface** for the "supervise via status summary" requirement is implied but not a component — it's the natural output of the Audit Log + a GitHub Actions job summary or a simple status page/CLI reading the audit table. Don't build a dashboard service for v1.

## Recommended Project Structure

Given D-series decisions (one repo, two folders; central-vs-app split deferred to Phase 7), the MVP structure should already draw the seam so Phase 7's extraction is a `git subtree`/package-publish exercise, not a rewrite:

```
database-automation/
├── automation/                    # the reusable "controller" — app-agnostic
│   ├── src/
│   │   ├── inspector/              # parse migration SQL -> operation list
│   │   ├── classifier/             # operation list + rules.yaml -> verdict
│   │   ├── rules/                  # default rules.yaml (data, not code)
│   │   ├── runner/                 # apply migrations to one target DB
│   │   ├── snapshot/               # pg_dump --schema-only wrapper + diff
│   │   ├── audit/                  # write/read audit records
│   │   └── restore-drill/          # automated restore-test script
│   ├── cli.ts                      # `automation classify|apply|snapshot|audit`
│   └── package.json                # this is the thing Phase 7 extracts
├── app/                            # recipe app — the thin test fixture
│   ├── src/
│   ├── drizzle/
│   │   ├── schema.ts
│   │   └── migrations/             # generated SQL + journal, committed
│   └── drizzle.config.ts
├── .github/
│   └── workflows/
│       ├── ci.yml                  # inspector + classifier + tests on every PR
│       ├── snapshot.yml            # scheduled/triggered prod schema snapshot
│       └── deploy-migration.yml    # gated runner job, per environment
├── ops/
│   ├── schema-snapshots/           # committed pg_dump --schema-only artifacts
│   │   ├── staging.sql
│   │   └── production.sql
│   └── rules.yaml                  # (or automation/src/rules/ — one source of truth)
└── docs/                           # existing: brief, decisions, current-state, roadmap
```

### Structure Rationale

- **`automation/` as an installable unit even inside one repo:** give it its own `package.json` from day one. It costs nothing now and means Phase 7 ("stop reinventing this per SaaS app") is `npm publish` or `git subtree split`, not an architecture change.
- **`ops/schema-snapshots/` separate from `app/`:** these are facts about *deployed reality*, not application source. Keeping them outside `app/` avoids conflating "what the code says the schema is" (drizzle/migrations) with "what production actually has" (snapshot) — the whole point of D3's visibility mechanism is that these can diverge and that divergence is exactly what you want to detect.
- **`rules.yaml` as data:** the PROJECT.md requirement is explicit — classification rules must be extensible data, not hardcoded conditionals. One YAML file, loaded by the classifier, is the simplest thing that satisfies this and is trivially diffable in PR review.

## Architectural Patterns

### Pattern 1: Enforcement-point honesty (Q2) — which gates are real

This is the single most consequential design decision. Rank by actual bypassability:

| Enforcement point | Who can skip it | Verdict |
|---|---|---|
| **Local pre-commit hook** | Anyone, via `git commit --no-verify`; also simply not installed on a fresh clone unless a setup step runs `pre-commit install` / husky | **Advisory only.** An AI agent told "run the safety check before committing" can also be told (or hallucinate its way into) skipping it. Never treat as a safety boundary — use only for fast local feedback. |
| **CI status check (required)** on a plain branch protection rule | Repository **admins can bypass by default** unless "Do not allow bypassing the above settings" is explicitly enabled; without that, an admin (often the solo founder's own account) can force-merge | **Conditionally real.** Becomes genuinely enforced only when bypass is explicitly disabled in the branch protection / ruleset settings. This is a one-checkbox difference between "policy" and "architecture" — verify it is set. |
| **GitHub *repository ruleset*** (the newer mechanism, distinct from classic branch protection) | Can be configured with an **empty bypass list**, which GitHub documents as enforced even against org owners unless explicitly added to the bypass actors list | **Non-bypassable when configured correctly.** This is the mechanism to use for "no one, including me, can merge past a BLOCKED classification" — prefer rulesets over classic branch protection for this reason. |
| **GitHub *environment protection rule*** (required reviewers on an `environment:` in the workflow) | Same admin-bypass caveat applies unless "Allow administrators to bypass configured protection rules" is turned off for that environment; the option to disallow bypass is documented as **public-repo-only on Free/Pro/Team** plans (works on private repos with GitHub Team/Enterprise) | **Real gate for the production deploy job specifically**, and the most natural fit for "human approves this REVIEW-classified migration before it touches prod" — it literally pauses the job awaiting approval. Confirm plan tier supports disabling bypass on a private repo. |
| **Runtime check inside the migration runner itself** (the runner refuses to execute a migration file whose classification is BLOCKED, regardless of who invoked it or from where) | Only bypassable by someone with the production DB credential running `psql`/`drizzle-kit` by hand outside the pipeline entirely — i.e., bypassing the *entire system*, not one check | **The only check that is architecturally non-bypassable from inside the system.** This is the actual backstop: even if CI config is misconfigured, or a human merges past a warning, the runner itself must re-derive the classification from the SQL it is about to run and refuse BLOCKED operations unless an explicit override flag/credential is supplied. |

**Design conclusion:** build the runtime check in the Migration Runner first and treat it as the true boundary; layer CI status checks and environment protection rules on top for early feedback and human-in-the-loop review, but never let "CI passed" alone be sufficient justification to skip re-checking at the point of execution. This directly matches the brief's principle: a check a hurried human or an agent can skip locally is not the same as one enforced where the SQL actually lands.

A second-order implication: because an **AI agent with shell access on the developer machine can, in principle, edit `.github/workflows/*.yml` or `rules.yaml` in the same PR that contains the dangerous migration**, the classifier's rule file and the runner's BLOCKED-refusal logic should not trust the caller's own claimed classification — the Runner should re-run the Inspector+Classifier against the actual migration SQL immediately before applying it, not consume a classification computed earlier in the pipeline and passed along as a variable. Recompute at the last possible moment, next to the credential that can do damage.

### Pattern 2: Migrations as a separate gated step, never at boot (Q3)

Four concrete mechanisms for running a migration against a Dockerized Postgres on a remote host, without redeploying the app:

| Mechanism | How it works | Fit for this project |
|---|---|---|
| **GitHub Actions job over a private network** (Tailscale or SSH tunnel) reaching the DB directly | The workflow job (GitHub-hosted runner + an ephemeral Tailscale node, or an SSH port-forward) runs `drizzle-kit migrate` or an equivalent script from CI, connecting straight to Postgres | **Recommended.** Keeps the credential in GitHub Secrets, keeps execution auditable in Actions logs, requires no new long-lived infrastructure. This is the direct implementation of D3's "change" mechanism. |
| **One-off container run on the host** (`docker run --rm --network <coolify-net> migration-image`) triggered via SSH from CI | CI SSHes in (restricted key, `command=` forcing exactly one script) and the *forced command* runs a throwaway migration container attached to the Postgres container's Docker network | Viable and arguably *more* private than opening any DB port at all — the migration container never needs a port published, only Docker-network membership on the host. Slightly more moving parts (needs an image build/push step or a mounted script) but keeps zero DB exposure, even over Tailscale. Good staging/production option if you want to avoid advertising Docker subnet routes over Tailscale entirely. |
| **Coolify scheduled task / one-off command** | Coolify's Scheduled Tasks feature runs `docker exec` inside an *already-running* application container on a cron or manual trigger — it is explicitly container-scoped, not a general job runner | **Does not fit cleanly.** It requires a running, named container to exec into, is a cron/manual UI action rather than something CI can gate on classification, and community reports (GitHub issue #7115) note one-off completion jobs get flagged "unhealthy" by Coolify's healthcheck monitor because it isn't designed for run-once jobs. Usable as a manual break-glass mechanism, not as the primary gated pipeline step. |
| **A small persistent migration-runner service** (always-on container with an internal API/webhook that CI calls) | Adds a long-lived service with its own credential and network surface, on call to apply migrations | **Not recommended for a solo founder.** It's a new attack surface (a service with prod DB credentials, always running) replacing a one-off process that runs for seconds. Violates "avoid enterprise complexity." Only reconsider at Phase 7 if a shared multi-tenant controller genuinely needs a stable API — even then, prefer it invoked by CI, not internet-facing. |

**Coolify-specific mechanics that matter here (confidence: MEDIUM — community sources, not a formal spec):**

- Coolify databases default to **private networking only**: the app and DB share an internal Docker network and the app reaches Postgres via an internal hostname like `postgresql-<uuid>:5432`, with no host port bound.
- The **"Publicly Accessible" toggle** on a Coolify database resource starts an nginx TCP proxy that maps a (dynamic) public port on the host to the container, and is explicitly meant to be a temporary "connect from my laptop" convenience — leaving it on is the exposure D4/D5 correctly identify as the option to avoid.
- Because Coolify manages the Docker network per resource, **the internal network name/subnet is stable as long as the resource is not deleted and recreated** — this matters for the subnet-router approach in Pattern 3 below, since advertised routes need a stable CIDR.
- Practically: never turn on "Publicly Accessible." Reach the DB either (a) from something already inside the host's private network (SSH tunnel or Docker exec, per above), or (b) via a mesh VPN where the *host itself* — not the database container — is the tailnet member.

### Pattern 3: Connectivity without inbound ports (Q4) — Tailscale/Headscale vs restricted SSH

Both approaches avoid opening a new inbound port to the internet; they differ in mechanism and blast radius.

**Tailscale/Headscale, concretely:**
1. Install the Tailscale client **on the Hetzner host itself** (not inside the Postgres container) — this is a single outbound-only agent that dials Tailscale's (or your own Headscale server's) coordination service; no inbound port is opened on the host's public interface at all.
2. Two ways to reach the Postgres container from there:
   - **(a) Bind the container's port to the host's Tailscale interface only** — e.g. run Postgres (or a small proxy) so its port is published as `100.x.y.z:5432:5432` (the host's Tailscale IP) rather than `0.0.0.0:5432:5432`. Simple, but requires Coolify's "publicly accessible" port mapping to target a specific interface, which is not native to its public-port toggle (that toggle binds broadly) — likely needs a manual docker-compose override outside Coolify's UI toggle to bind only the tailnet IP.
   - **(b) Advertise the Docker bridge network as a subnet route** — run `tailscale up --advertise-routes=<docker-network-subnet>/24` on the host (found via `docker network inspect <coolify-network> | grep Subnet`), then approve the route in the Tailscale admin console. Peers on the tailnet can then reach the Postgres container directly at its **internal Docker IP** (e.g. `172.x.x.x:5432`) with no port ever published on the host at all. This is the cleaner option because it needs zero change to how Coolify manages the container's networking — the container keeps its default no-published-port config.
   - Caveat: Coolify recreates/reassigns container IPs within its network on redeploy, so (b) means CI must resolve the current container IP or a stable internal DNS name per run rather than hardcoding an IP — use the Docker network's internal DNS (Coolify assigns each service a resolvable hostname, e.g. `postgresql-<uuid>`) if the subnet router forwards DNS, or query the container IP via a small script at connection time.
3. **GitHub Actions joining the tailnet**: the official `tailscale/github-action` runs inside the workflow job, authenticates using an OAuth client or auth key (stored as a GitHub secret) and a GitHub-issued OIDC/JWT identity, and creates a short-lived **ephemeral node** tagged (e.g. `tag:ci`) for ACL scoping; the node is automatically removed from the tailnet after the job finishes (or shortly after going offline). Subsequent workflow steps can then reach any tailnet peer/subnet route the ACL permits — including the Coolify host's advertised Docker subnet.
4. Headscale is a self-hosted, open-source, API-compatible reimplementation of the Tailscale coordination server. Same client mechanics; you avoid dependency on Tailscale's hosted control plane, at the cost of running and securing one more service yourself — a real tradeoff for "avoid enterprise complexity" and worth weighing only if avoiding a third-party SaaS dependency is a stronger constraint than operational simplicity.

**Restricted SSH tunnel, concretely:**
1. Generate a dedicated keypair used only by CI (never a human's personal key).
2. In the Hetzner host's `authorized_keys`, constrain that specific public key with options, e.g.:
   ```
   restrict,permitopen="localhost:5432",command="/bin/false" ssh-ed25519 AAAA... ci-migration-key
   ```
   - `restrict` disables PTY, X11, agent, and general port/socket forwarding except what's explicitly re-permitted.
   - `permitopen="host:port"` re-enables *only* local-forwarding (`ssh -L`) to that one destination — here, the Postgres container's published-or-internal address as seen from the host.
   - `command="/bin/false"` (or a specific script) means even if someone connects interactively with this key, they get no shell — only the forwarding tunnel functions.
   - Optionally add `from="<GitHub Actions IP ranges or self-hosted runner IP>"` to further restrict source IP, though GitHub-hosted runner IPs are a large, changing range, making this weak in practice for GitHub-hosted runners (stronger if using a self-hosted runner with a fixed IP).
3. CI opens `ssh -L 5433:<postgres-target>:5432 ci-migration-key@host` in the background, then connects its migration tool to `localhost:5433`. Port 22 must already be reachable from the runner (true for GitHub-hosted runners; the host's SSH is presumably already exposed for Coolify's own management per current-state D5).
4. This requires **no new service and no third-party control plane** — it's pure OpenSSH configuration, which fits "avoid enterprise complexity" well. Its weakness relative to Tailscale is coarser network-level ACLs (Tailscale ACLs are declarative and independently auditable; SSH's equivalent is scattered `authorized_keys` lines) and that compromise of the CI secret key yields a forwarding tunnel to Postgres directly, whereas a compromised Tailscale ephemeral-node auth key yields access only within whatever the tailnet ACL/tags grant.

**Recommendation:** Tailscale via subnet-route advertisement (3b above) for the reasons D4 already lists (zero inbound ports, ACL-restrictable, no change to Coolify's container networking) — the restricted SSH key is a legitimate, lower-dependency fallback if avoiding a mesh-VPN control plane is preferred, and D5's existing risk analysis (port 22 is already open regardless) supports it as sound, just operationally coarser.

### Pattern 4: Schema visibility without production credentials (Q5)

The `pg_dump --schema-only`, committed-to-git pattern (D3) is sound as a **visibility** mechanism but has real failure modes worth designing around rather than discovering later:

- **Non-determinism / diff noise:** `pg_dump` does not guarantee stable object ordering across runs, so two schema-only dumps of an *unchanged* database can produce a large textual diff purely from reordering, function-body whitespace, or dependency-resolution order — this pollutes the git history and makes "did the schema actually change" hard to answer from `git diff` alone. Mitigation: post-process the dump with a canonicalizing sort (or use a tool built for this) before committing, or diff *semantically* rather than textually (see below).
- **It shows only committed environment state, not agent-reachable truth:** the snapshot is only as fresh as the last CI run that produced it — an agent reasoning from a stale snapshot can propose a migration against a schema that no longer matches production. Mitigation: regenerate the snapshot as part of (or immediately after) every successful production migration, not on a separate unrelated schedule, so "snapshot age" tracks "time since last known-good migration," and consider a periodic scheduled snapshot as a drift check independent of migrations.
- **It doesn't itself detect drift** — a manual `ALTER TABLE` run by hand against production (exactly the failure mode this whole project exists to prevent) would silently change reality until the next snapshot run picks it up; the pattern is a *record*, not a *detector*, unless something diffs the live DB against the migration history's expected end-state on a schedule.

**Better-known alternatives / complements, honestly assessed:**

- **Atlas** (ariga/atlas) is the most complete answer to "detect drift," not just "snapshot schema": it can inspect a live database's actual state, compare it against the state your migration history implies, and fail CI when they diverge — its stated design point is exactly the gap above ("migration runners never re-inspect the database itself, so drift is invisible until something breaks"). Its core inspect/diff functionality is open source; drift *monitoring-as-a-service* and some CI conveniences are gated behind Atlas Cloud/Pro. For this project, Atlas's open-source CLI can be run inside the existing GitHub Actions pipeline (still requiring the same private-network connectivity as the Migration Runner) purely for the inspect/diff step, without adopting its opinionated declarative-migration workflow in place of Drizzle.
- **migra** is a purpose-built Postgres schema *diff* tool (schema A vs schema B → SQL to reconcile) and is a better fit than parsing `pg_dump` text for computing "did drift occur" semantically — but the original project is deprecated (as of 2024) with only a community fork continuing maintenance, which is a real adoption risk for a dependency sitting between CI and production visibility.
- **Recommendation:** keep D3's `pg_dump --schema-only` snapshot as the cheap, dependency-free visibility artifact an agent reads (it requires nothing beyond Postgres client tools, already needed anyway) — but treat it as necessary, not sufficient, and add a lightweight drift check as a *later* phase: either Atlas's open-source inspect/diff run periodically against each environment (reusing the same private-network connectivity already built for the Runner), or, at minimum, a scheduled job that re-derives expected schema state from migration history and fails loudly if a live inspect disagrees. Do not build this in the MVP; flag it as Phase 4/5 hardening once the core pipeline is proven (see build order).

### Pattern 5: Central automation vs. per-application code (Q6)

| Lives in each app repo | Lives in the shared `automation` package |
|---|---|
| Drizzle `schema.ts` and generated migration SQL + journal (source of truth for *this app's* schema) | Migration Inspector (SQL → operations) |
| App-specific `drizzle.config.ts` (connection resolution per environment) | Safety Classifier + default `rules.yaml` (app repos may extend/override, not replace) |
| App-specific integration tests that exercise the schema | Migration Runner (generic: given a `DATABASE_URL` and a migrations folder, apply safely) |
| A small per-app config file (the brief's sketch: `migrationPolicy: { dropTable: block, ... }`) declaring any app-specific rule overrides and which environments are enabled | Schema Snapshot tool, restore-drill script, audit-log read/write helpers |
| CI workflow file that *calls* the shared automation (not one that reimplements it) | The CLI/Action/workflow surface that apps call into |

**Distribution mechanism, ranked for this context:**

1. **Reusable GitHub Actions workflow** (`workflow_call`) for the *pipeline shape itself* — "on PR: classify + test; on merge to main with approval: run migration against target env." This standardizes the job/environment/secrets wiring across every future SaaS app with one line (`uses: org/database-automation/.github/workflows/migrate.yml@v1`), which is exactly the brief's stated goal for SaaS #2/#3/#4. Reusable workflows are the right fit because they standardize *entire job configuration* including which `environment:` gates apply — composite actions cannot own environment-protection semantics, only steps within a job.
2. **An npm package** (`@yourorg/db-automation` or similar) for the actual logic (Inspector, Classifier, Runner, Snapshot) that the reusable workflow installs and invokes via a CLI. This is what makes the logic testable, versionable, and usable locally (an agent or developer can run `npx db-automation classify` on their machine against a local migration file, independent of CI).
3. **A CLI** (thin wrapper over the npm package, the same `automation/cli.ts` from the project structure above) is the actual interface both the reusable workflow and any local developer/agent invocation call — don't build two separate interfaces (a "CI mode" and a "local mode"); one CLI, invoked identically in both places, is simpler and guarantees CI and local behavior can't drift apart.

For v1 (one repo, two folders, per D-series decisions), skip step 1 entirely — there is only one app, so a reusable workflow has no second caller yet. Build the npm-package-shaped internal module and the CLI now (structure it as if it were already a package, per the Recommended Project Structure above), and defer actually publishing it and extracting a reusable workflow to Phase 7, when SaaS #2 creates the second caller that justifies the abstraction.

## Data Flow

### The complete change lifecycle (developer/agent machine → production)

```
1. Agent/developer edits app/drizzle/schema.ts (local machine, dev DB is local Docker)
       ↓
2. `drizzle-kit generate` diffs schema.ts against dev DB's current migration history,
   writes a new .sql file + updates meta/_journal.json
       ↓
3. Migration Inspector parses the new .sql → operation list (local run, fast feedback;
   also re-run identically in CI — never trust a locally-computed verdict)
       ↓
4. Safety Classifier scores operations against rules.yaml → SAFE / REVIEW / BLOCKED
   (local pre-commit hook may show this — ADVISORY ONLY, does not block a bypassed commit)
       ↓
5. Migration applied to local dev DB; app integration tests run against it
       ↓
6. Commit (schema.ts + migration .sql + journal) pushed; PR opened
       ↓
7. CI (GitHub Actions): re-run Inspector + Classifier on the committed SQL (authoritative,
   not the local result) → required status check via a repository ruleset with an empty
   bypass list (non-bypassable, including by admins)
       ↓  BLOCKED → job fails, PR cannot merge, full stop.
       ↓  SAFE/REVIEW → job passes; REVIEW is additionally annotated on the PR
       ↓
8. Merge to main → deploy-migration workflow targets `environment: staging` first
       ↓
9. CI job connects over private network (Tailscale ephemeral node or restricted SSH tunnel)
   to the Coolify-hosted staging Postgres; Migration Runner RE-DERIVES the classification
   from the actual SQL file about to run (not a passed-through variable) and refuses if BLOCKED
       ↓
10. Runner applies migration transactionally to staging; writes an audit row
    (migration id, commit sha, env, classification, result, timestamp — no secrets)
       ↓
11. Staging smoke tests / app deploy to staging (separately — app deploy is decoupled
    from migration per D8) run and must pass
       ↓
12. deploy-migration workflow targets `environment: production` — a GitHub environment
    protection rule pauses here; if classification is REVIEW REQUIRED, a human must approve
    (SAFE-classified migrations may be configured to auto-proceed once this trust is earned)
       ↓
13. Same Runner, same re-derivation-of-classification, same private-network path,
    now against production, using a credential that exists only in this GitHub Environment's
    secret store (never on any developer machine — D3)
       ↓
14. Audit row written for production. Schema snapshot job runs `pg_dump --schema-only`
    against production over the same private connection, commits the refreshed snapshot
    to ops/schema-snapshots/production.sql
       ↓
15. Owner/agent supervises via the audit log + PR/job summary — never operates the
    database directly for routine changes
```

Two flows run in parallel to the above and deserve separate diagrams but are not gated on migrations:

- **Backup flow:** scheduled dump (Coolify/Hetzner cron or object-storage lifecycle) → off-server storage → periodic automated restore-drill against a disposable DB → result recorded in the audit log (status stays UNKNOWN until a human has personally timed a restore, per D7).
- **Drift-detection flow** (later phase, per Pattern 4): scheduled job inspects live schema of each environment over the same private connection, compares against migration-history-implied state, raises an alert (not silent) on mismatch.

## Anti-Patterns

### Anti-Pattern 1: Treating "CI passed" as sufficient authorization for the Runner to act

**What people do:** Have CI compute a classification once, pass it downstream as a job output/artifact, and have the production job trust that value when deciding whether to run.
**Why it's wrong:** Anything between the classification step and the runner step — a re-triggered workflow, a modified artifact, a compromised Action dependency, a rebased branch — can cause the SQL that actually executes to differ from the SQL that was classified. This exactly reopens the "remembered caution" hole the whole project exists to close.
**Do this instead:** The Runner re-parses and re-classifies the exact migration file it is about to execute, immediately before executing it, using the same Inspector/Classifier code. Treat the earlier CI classification as a fast-feedback/PR-annotation convenience, not as the authorization.

### Anti-Pattern 2: Migrating at application container startup

**What people do:** Bake `drizzle-kit migrate` (or equivalent) into the app's entrypoint/boot sequence so "deploy = migrate."
**Why it's wrong:** This is the exact problem statement in PROJECT.md's origin story — it means the only way to run a migration is to restart the app, and the only way to restart is to redeploy, with zero gate between "migration generated" and "migration runs against user data," and it means every redeploy (even one with no schema change) re-runs migration logic against a live database as a side effect of an unrelated code change.
**Do this instead:** Migrations are a distinct, gated pipeline step (Pattern 2 above) that completes and is verified *before* the new app version is deployed; the app container never touches migration tooling at boot (D8).

### Anti-Pattern 3: A "public database port, briefly" workflow

**What people do:** Flip Coolify's "Publicly Accessible" toggle on when someone needs to connect from a laptop or CI, intending to flip it back off afterward.
**Why it's wrong:** It is trivial to forget to revert, the public port is dynamically assigned and easy to lose track of, and — per D5's own analysis — an exposed Postgres port is a materially worse risk than SSH already being open, because Postgres was never hardened as an internet-facing daemon.
**Do this instead:** Never enable it. Build the private-network path (Tailscale subnet route or restricted SSH tunnel) once, and use it for every human-in-the-loop connection too — no laptop should have a route to production Postgres.

### Anti-Pattern 4: Building the multi-project controller before the second project exists

**What people do:** Generalize the classifier, runner, and config schema for N hypothetical future apps up front (the brief's own controller diagram is seductive to over-build from).
**Why it's wrong:** The brief and PROJECT.md both explicitly warn against this (D6's stated risk, Out of Scope section) — abstractions designed against imagined requirements from a single real caller tend to be wrong in ways only a second real caller reveals.
**Do this instead:** Structure the code as if it will be extracted (npm-package shape, one CLI) but keep the actual extraction, publishing, and reusable-workflow distribution deferred to Phase 7, when SaaS #2 supplies the second real caller.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Coolify (self-hosted) | Manages Postgres containers as "database resources" on a private-by-default Docker network per resource; app and DB share that network via internal DNS hostname | Never enable "Publicly Accessible." Container IP/network is stable while the resource isn't recreated — relevant if advertising it as a Tailscale subnet route. |
| Tailscale (or self-hosted Headscale) | Host joins tailnet as a persistent node (optionally advertising the Coolify Docker network's subnet); GitHub Actions joins as an ephemeral, tagged, auto-expiring node via the official Action | ACL/tag scoping (e.g. `tag:ci` can reach `tag:db-host` only on port 5432) is the practical replacement for network-level firewalling. |
| GitHub Actions | Runs Inspector/Classifier on every PR (repository ruleset gate); runs the gated Migration Runner job per environment (environment protection rule gate) | Prefer *repository rulesets* over classic branch protection for the PR-time gate (supports genuinely non-bypassable config); use *environment protection rules* for the human-approval gate before production. |
| GitHub Secrets / Environments | One secret set per environment (`development` local-only, `staging`, `production`), least-privilege DB role per credential | Production migration credential exists only in the `production` GitHub Environment's secret store — never in a developer's `.env`, matching D3/PROJECT.md's constraint verbatim. |
| Hetzner (host) | SSH already reachable for Coolify's own management (per D5) | If using the restricted-SSH-tunnel option, add a dedicated CI-only key constrained with `restrict,permitopen,command` — never reuse an interactive admin key for this. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Migration Inspector ↔ Safety Classifier | Function call, in-process (same CLI invocation); operation-list data structure passed directly | No network hop; keep both pure/stateless so they can be unit-tested without any database. |
| Safety Classifier ↔ Deployment Gate (CI/environment config) | Classifier's verdict is surfaced as a CI job outcome/annotation; the *actual* gating is GitHub policy configuration, not a call the Classifier makes | Don't build a "gate" API — the gate is which GitHub features (ruleset, environment protection) are wired to which job outcomes. |
| Migration Runner ↔ target database | Direct Postgres connection (`node-postgres`/Drizzle client) over the private network path (Tailscale or SSH tunnel), one environment's credential at a time | Runner must be parameterized by environment, never hold multiple environments' credentials simultaneously in the same process/job. |
| Migration Runner ↔ Audit Log | Runner writes an audit row as part of the same transaction/job that applies the migration (or immediately after, same job) | Keep this synchronous with the migration itself — an audit entry that can silently fail to write while the migration itself succeeds defeats the auditability requirement. |
| `automation/` package ↔ `app/` | CLI invocation from the app's CI workflow (`npx`/direct script call), passing the app's migrations folder and `DATABASE_URL` as arguments/env | This is the seam Phase 7 will formalize as npm package + reusable workflow; keep it a clean function/CLI boundary now so extraction is mechanical later. |

## Build Order

Ordered by genuine dependency, not by the brief's presentation order:

1. **Local dev loop (D1, D2):** Docker Postgres, Drizzle schema/migrate, no remote connectivity at all. Nothing else can be tested without this existing.
2. **Migration Inspector + Safety Classifier as pure functions**, with `rules.yaml` as data, unit-tested against hand-written SQL fixtures (including deliberately destructive ones) — no database or network dependency yet, so this can be built and hardened immediately after step 1 in parallel with app schema work.
3. **Migration Runner (local target only)** — apply classified migrations to the local dev DB, re-deriving classification immediately before applying, refusing BLOCKED. Proves the "runtime check is the real gate" pattern before any remote environment exists to make that mistake expensive.
4. **Backup + restore drill against the local/disposable DB (D7)** — moved this early deliberately (already decided); it has no dependency on remote connectivity and closes the single confirmed operational risk (R1) while cost is zero.
5. **CI wiring: repository ruleset + PR-time Inspector/Classifier check** — now that the logic exists and is trusted locally, wire it as a genuinely non-bypassable PR gate. This is pure GitHub configuration plus invoking step 2's CLI; no new logic.
6. **Private connectivity to a remote (staging) database** (Q4) — the first point at which credentials and network exposure matter; do this only once steps 2-5 exist so there is something worth protecting the connection *for*, per the sequencing constraint ("no connection to a real production database until the safety architecture exists and has been tested" — staging is the appropriate first remote target).
7. **Migration Runner extended to remote target + environment protection rule for production** — same Runner code as step 3, now parameterized by environment and credential; production environment protection rule added last since it depends on production actually existing as a target.
8. **Schema snapshot pipeline (D3 visibility)** — depends on step 6's connectivity existing; can be built alongside step 7 since it's a read-only sibling operation over the same private connection.
9. **Audit log + status summary surface** — depends on step 7 (there must be real migration runs to audit); wire this in as the Runner is extended, not as an afterthought, since retrofitting audit logging is where auditability gaps usually get introduced.
10. **Drift detection (Atlas or equivalent)** — explicitly deferred; only valuable once there is a real production environment (step 7) and a snapshot baseline (step 8) to compare against. Treat as hardening, not MVP.
11. **Extraction to shared package + reusable workflow (Phase 7)** — explicitly deferred until a second application exists to justify the abstraction (D6, Out of Scope).

The key dependency insight: **everything that is pure logic (Inspector, Classifier, Runner-against-local) should be built and hardened with zero network/credential exposure before any remote connectivity decision is implemented** — this lets the destructive-operation testing the PROJECT.md requires ("proven by attempting them") happen at zero cost, and means the connectivity mechanism (Q4) is protecting a system already known to behave correctly, rather than being designed concurrently with unproven safety logic.

## Sources

- [Networking in Coolify | Coolify Docs](https://next.coolify.io/docs/core/networking-in-coolify) — MEDIUM (vendor docs, actively evolving product)
- [Databases you can host with Coolify](https://coolify.io/docs/databases) — MEDIUM
- [Using Coolify's Internal Postgres Database URL | Zixian Chen](https://zixianchen.com/blog/using-postgres-coolify-internal-database-url) — LOW-MEDIUM (third-party blog, illustrative not authoritative)
- [\[Bug\]: port mapping on PostgreSQL exposes port to the public · Issue #8581 · coollabsio/coolify](https://github.com/coollabsio/coolify/issues/8581) — MEDIUM (maintainer-tracked issue)
- [Scheduled Tasks | Coolify Docs](https://next.coolify.io/docs/applications/operations/scheduled-tasks) — MEDIUM
- [\[Enhancement\]: Per-service toggle... one-off jobs \"unhealthy\" · Issue #7115 · coollabsio/coolify](https://github.com/coollabsio/coolify/issues/7115) — MEDIUM
- [Subnet routers · Tailscale Docs](https://tailscale.com/docs/features/subnet-routers) — HIGH (official docs)
- [Configure a subnet router · Tailscale Docs](https://tailscale.com/docs/features/subnet-routers/how-to/setup) — HIGH
- [Tailscale GitHub Action · Tailscale Docs](https://tailscale.com/docs/integrations/github/github-action) — HIGH
- [Connect GitHub CI/CD workflows to private infrastructure without public exposure · Tailscale Docs](https://tailscale.com/docs/solutions/connect-github-CICD-workflows-to-private-infrastructure-without-public-exposure) — HIGH
- [Private connections for every GitHub Actions runner (Tailscale blog)](https://tailscale.com/blog/private-connections-for-github-actions) — HIGH (vendor, but describing their own mechanism)
- [authorized_keys(5) — Debian Manpages](https://manpages.debian.org/experimental/openssh-server/authorized_keys.5.en.html) — HIGH (canonical OpenSSH reference)
- [OpenSSH/Cookbook/Tunnels - Wikibooks](https://en.wikibooks.org/wiki/OpenSSH/Cookbook/Tunnels) — MEDIUM
- [Deployments and environments - GitHub Docs](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments) — HIGH (official docs)
- [Reviewing deployments - GitHub Docs](https://docs.github.com/actions/managing-workflow-runs/reviewing-deployments) — HIGH
- [About protected branches - GitHub Docs](https://docs.github.com/repositories/configuring-branches-and-merges-in-your-repository/defining-the-mergeability-of-pull-requests/about-protected-branches) — HIGH
- [Available rules for rulesets - GitHub Docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets) — HIGH
- [GitHub Repository Rules are now generally available - GitHub Blog](https://github.blog/news-insights/product-news/github-repository-rules-are-now-generally-available/) — HIGH
- [Bypass list for Ruleset... · community discussion #86534](https://github.com/orgs/community/discussions/86534) — MEDIUM (community discussion, corroborates docs)
- [Schema Drift Detection (Database Drift) | Atlas Docs](https://atlasgo.io/monitoring/drift-detection) — MEDIUM (vendor docs)
- [Database Schema Drift Detection for Versioned Migrations | Atlas Docs](https://atlasgo.io/versioned/drift-detection) — MEDIUM
- [Detect Migrations Drift in CI | Atlas](https://atlasgo.io/faq/desired-state-drift) — MEDIUM
- [GitHub - ariga/atlas](https://github.com/ariga/atlas) — MEDIUM
- [GitHub - djrobstep/migra: DEPRECATED](https://github.com/djrobstep/migra) — MEDIUM (confirms deprecation status directly)
- [Git: How to skip hooks - Adam Johnson](https://adamj.eu/tech/2023/02/13/git-skip-hooks/) — MEDIUM
- [Composite Actions vs. Reusable Workflows: How to Choose for Distribution](https://zenn.dev/takish/articles/0fda8e94f7acb5?locale=en) — MEDIUM
- Project documents (required reading): `PROJECT.md`, `docs/original-brief.md`, `docs/decisions.md` — HIGH (primary source for constraints/decisions)

---
*Architecture research for: PostgreSQL migration-safety and deployment-gating system*
*Researched: 2026-09-06*
