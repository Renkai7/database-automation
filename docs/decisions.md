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

---

## D15 — Proposed packaging strategy for the backup/restore-drill tooling
**Status:** PROPOSED · 2026-09-07

**Current state:** The Phase 1-2 tooling is roughly 2,400 lines of script plus 1,900 of
test. Most of it is already generic, with no project coupling in its logic:
`scripts/log.ts`, `scripts/db-query.ts`, `scripts/restore.ts`,
`scripts/restore-cluster.ts`, `scripts/drill.ts`, and `scripts/drill-status.ts`.

The coupling that does exist, stated plainly rather than softened: `scripts/backup.ts`
hardcodes the recipe table list (`RECIPE_CORE_TABLES = ["ingredients", "recipes",
"steps"]`) and a spot-check projection (`slug`, `base_servings`, `base_kcal`), and
`scripts/drill-assertions.ts` mirrors that same projection as
`RECIPE_SPOT_CHECK_FIELDS`. The drill assertions currently embed a recipe-specific
projection — this is not minor coupling, and the tooling is not already reusable as
shipped. `scripts/backup.ts` additionally hardcodes `-U recipe_app -d recipe_dev` inside
its `pg_dump`/`pg_dumpall` invocation arguments. `scripts/env.ts` pins
`DEV_DATABASE_HOST_ALLOWLIST`, `EXPECTED_DEV_DATABASE_PORT` ("5432"),
`EXPECTED_DEV_DATABASE_NAME` ("recipe_dev"), and `EXPECTED_DEV_DATABASE_ROLE`
("recipe_app"). The environment variable names themselves are also project-scoped:
`RECIPE_DEV_DATABASE_URL` and `RECIPE_BACKUP_DESTINATION`.

**Why:** Those pinned constants in `scripts/env.ts` are not an oversight to clean up —
they are `D-16`, a phase-context decision recorded in that file's own comments (`D-16 /
CR-01`), and they exist precisely so that widening what this workspace's tooling can
reach is a reviewable source diff, never routine configuration. `D-16` is a phase-context
decision, not an entry in this log — there is no `D16` heading here. The obvious
packaging move is to turn those pinned constants into environment variables so each
consuming project configures its own target. That move must not happen: it would convert
this repository's strongest safeguard into exactly what `CLAUDE.md`'s non-negotiables
forbid — a safeguard that depends on someone remembering to set it correctly, rather than
one the architecture enforces.

**Proposed resolution:** Configuration that lives in source, not in the environment. A
`db-safety.config.ts` sits in the consuming repository, committed to version control,
imported at module load, and validated with zod so a malformed config fails loudly at
startup rather than silently under-constraining the target. Because it is source rather
than environment, changing it stays a reviewable diff — the exact property `D-16` was
protecting. The package supplies mechanism; the config supplies identity.

**Proposed package shape (three layers, split by what each layer is):**
1. **npm package** — the scripts, the assertion mechanism, the drill harness, and the
   guardrail test suite: the things a consuming project imports.
2. **Scaffold/template** — `docker-compose.yml`, an environment-file example, and the CI
   workflow once Phase 5 exists: things a project copies rather than imports, because
   they must live in the consumer's own tree.
3. **Claude Code plugin/skill** — the agent-facing layer: the conventions, the rule
   against echoing a supplied value back, the rule against reading `process.env`
   directly (already enforced here by `tests/guardrails.test.ts`), and the slash
   commands. This layer matters because it is what makes a new project *behave* like
   this one, rather than merely holding the same files — copied files without the
   conventions produce a project that has the tooling and still does the unsafe thing.

**Consequence:** What does not transfer. Drill evidence never transfers — a passing
restore drill in this repository proves nothing about another project, because what a
drill proves is that this specific data, on this specific machine, came back. Every
consuming project must destroy and restore its own real data and time it for itself. The
script transfers; the proof never does. This is D7's consequence re-arming in each new
project: backup status stays UNKNOWN until a human has performed the restore, for that
project, again. Also non-transferable: the Coolify and Hetzner specifics, and the
PostgreSQL 17 major-version pin from D9.

**Timing:** Do not extract yet. Phases 3-7 hold most of the reusable value — the safety
analyzer is more portable than any Phase 1-2 code, since its interface is SQL in and a
verdict out with no database identity involved at all — and building them will reshape
whatever shared surface an extraction would expose. Extracting now would freeze an API
against a sample size of one. Extract at the end of Phase 5, once the analyzer, the
migration runner, and the CI gate all exist and a second real consuming project is
available to prove the seams.

**Recommended preparatory step (not yet done):** Before Phase 3 begins, consolidate the
identity currently spread across `scripts/env.ts`, `scripts/backup.ts`, and
`scripts/drill-assertions.ts` into a single config module at the repository root,
keeping it in source with the same reviewable-diff guarantee, so Phase 3 writes against
that config instead of adding a fourth hardcoding site. This is a recommendation only.

**Open questions (UNKNOWN):**
- The distribution mechanism for the npm layer — private registry versus git
  dependency — is UNKNOWN; it has not been decided.
- Whether these are even the right seams to extract along is UNKNOWN, because no second
  consuming project exists yet to test them against.

---

## D16 — The safety analyzer's classification contract
**Status:** ACCEPTED · 2026-09-08

Phase 3 built `packages/automation`, a PostgreSQL migration-safety classifier. Its contract,
carried here from phase planning (`03-CONTEXT.md`) as a project-level decision rather than
something that lives only in one phase's planning documents:

- **Three verdicts plus a distinct fourth outcome for a parse failure.** Every classified
  migration file gets exactly one of SAFE, REVIEW_REQUIRED, or BLOCKED. A file libpg-query
  cannot parse produces none of those three — it is a thrown, distinct error, never silently
  folded into BLOCKED or any other verdict. Collapsing a parse failure into a verdict would make
  "the analyzer is broken" indistinguishable from "the migration is dangerous" in any later
  audit record, and PostgreSQL itself would reject the same SQL — the honest statement is that
  the input is unparseable, not that it is borderline-dangerous.
- **Classification is derived from a real PostgreSQL parse tree, never from pattern matching.**
  The classifier is built on `libpg-query`, the actual PostgreSQL grammar compiled to
  WebAssembly, not a regex or string-matching approximation of it. A hand-rolled parser drifts
  from real Postgres grammar on edge cases (comments, dollar-quoting, quoted identifiers);
  `libpg-query` **is** the grammar, so the resulting AST is authoritative by construction.
- **Rules are a schema-validated JSON data file with a required rationale per rule.** The rules
  catalogue (`packages/automation/src/rules/rules.json`) is data, not code, validated by zod on
  every load — a rule with no stated reason for its verdict is a schema violation, not a
  permitted entry.
- **A code floor fixes BLOCKED for the named irreversible-data-loss operations and for
  unresolvable dynamic SQL, self-checked at load time.** `DROP TABLE`, `DROP SCHEMA`,
  `DROP DATABASE`, `TRUNCATE`, `DROP COLUMN`, `DELETE`/`UPDATE` without a row-scoping `WHERE`,
  and an `EXECUTE` argument the analyzer cannot statically resolve can never be classified
  weaker than BLOCKED — a rules file that tries fails schema validation loudly, and the analyzer
  refuses to run rather than falling back to a silently weaker floor. Because the rules file is
  data an agent can edit, this is the one property that must not be data-configurable: a
  one-line diff to "downgrade DROP TABLE to SAFE" would otherwise disarm the entire system.
- **An unmatched operation resolves to REVIEW REQUIRED because SAFE must be earned.** A
  PostgreSQL feature the catalogue has never heard of stops for a human rather than sailing
  through un-reviewed. This default was load-bearing evidence in the phase's own squawk
  comparison (`docs/30-squawk-comparison.md`): every adversarial destructive operation probed
  outside the `DROP TABLE`-shaped set (`DROP OWNED BY`, unscoped `DELETE`/`UPDATE`,
  `COPY ... FROM PROGRAM`, `CREATE RULE ... DO INSTEAD DELETE`, `ALTER TABLE ... DETACH
  PARTITION`, `REASSIGN OWNED BY`) landed BLOCKED or REVIEW_REQUIRED, never SAFE — the
  earn-SAFE default, not catalogue completeness, is the analyzer's real safety property.
- **A one-migration-file window for safe-form pairing.** Two-statement safe forms (`ADD
  CONSTRAINT ... NOT VALID` followed by `VALIDATE CONSTRAINT`, `CREATE UNIQUE INDEX
  CONCURRENTLY` followed by `ADD CONSTRAINT ... UNIQUE USING INDEX`, and the three-step
  validated-check-then-`SET NOT NULL` form) are only recognized when both halves appear in the
  same file. Nothing outside that file's own text ever raises a verdict.
- **Distinct exit codes chosen so a crashed analyzer can never be read as a verdict.** The CLI's
  process exit code space is partitioned so a non-zero exit from an internal analyzer failure
  cannot land on the same number as a BLOCKED or REVIEW_REQUIRED verdict — a script driving the
  analyzer from its exit code alone cannot mistake "the tool crashed" for "the tool disapproved."

**Two deliberate exclusions, recorded so a later reader does not restore them as oversights:**

1. **The session-timeout rules** (`require-lock-timeout`, `require-statement-timeout` in
   squawk's own catalogue) are not part of this project's rules. They describe how the runner
   opens its database session, not what a given SQL statement does — flagging every migration
   for a property the Phase 4 runner is already responsible for setting (RUN-02) would be a
   false positive by construction, and would manufacture exactly the review-fatigue this
   catalogue's REVIEW REQUIRED tier exists to avoid.
2. **Constant folding of dynamic SQL arguments.** An `EXECUTE`d statement built from string
   concatenation that could, in principle, be resolved to a static value at analysis time is not
   attempted — any unresolvable dynamic SQL argument is BLOCKED outright (the code floor above),
   accepting that any legitimate need for dynamic SQL in a migration must be rewritten as static
   statements. For this project's actual migrations that is not a real loss; asking a human to
   approve SQL nobody — not the analyzer, not the reviewer — can actually read would be the
   weakest possible form of the gate.

**Open item, not done:** `packages/automation/src/classifier/rules-schema.ts` and
`packages/automation/test/corpus-manifest-schema.ts` both `import { z } from "zod"` without
`packages/automation/package.json` declaring `zod` as a dependency of its own — it resolves only
because Node's module resolution walks up to the workspace root, where the root `package.json`
declares it (`03-01-SUMMARY.md`'s own recorded note). This is fine today under this repository's
established resolution precedent (the same pattern this phase's `squawk-comparison.ts` script
also relies on for `execa`), but it is a real gap, not a decision: `packages/automation` is not
yet independently installable outside this workspace. **This is a named, undone task for Phase
7's extraction** (D15 above) — `zod` (and, if the squawk-comparison script or its equivalent
survives extraction, `execa`) must become an explicit declared dependency of
`packages/automation/package.json` before that package is published or consumed anywhere
outside this monorepo.

**Open question, status UNKNOWN — the production PostgreSQL major version.** This gap was
flagged in the project's original stack research and was never closed; it is recorded again here
rather than left to go stale silently. It governs three things: the `libpg-query` PG-version
dist-tag, the `postgres:*-alpine` client image tag used for backup/restore (D9), and whether
Phase 3's parser choice needs revisiting. Phase 3 shipped on `libpg-query`'s default (pg18) dist
line — an upgrade from the 17.7.4 originally installed, needed because `parsePlPgSQL` (D-05's
recursion into DO-block and function bodies) ships only on that line — while dev/CI stays pinned
to PostgreSQL 17 (D9). That mismatch does not block on the unresolved production version:
parsing with a newer grammar than the target server is the safe direction for a safety analyzer,
because a newer grammar is a near-superset of an older one, so the only failure mode is accepting
syntax an older server would reject — never missing a real hazard such as `DROP TABLE`. This
reasoning is why the still-unknown production version did not block this phase, not a reason to
stop tracking it as an open question.

**Why this belongs in the project decision log, not only in phase planning:** `03-CONTEXT.md`'s
decisions (D-01 through D-16 there) are phase-scoped planning artifacts. This entry is the
durable summary a later phase — most concretely, Phase 4's runner and Phase 7's extraction — can
read without reopening Phase 3's full planning history.

---

## D17 — The code floor widens to "irreversible data loss or self-disarming"
**Status:** ACCEPTED · 2026-09-08

`packages/automation`'s code floor (D16 above; `04-CONTEXT.md` D-17) now fixes BLOCKED for a
second class of statement alongside the original irreversible-data-loss set: a migration that
sets, resets or defaults `lock_timeout` or `statement_timeout`, at **every** scope —
session (`SET`/`SET LOCAL`/`RESET`/`RESET ALL`), cluster-wide (`ALTER SYSTEM SET`),
database-wide (`ALTER DATABASE ... SET`) or role-wide (`ALTER ROLE ... SET`). No rules file may
assign anything weaker than BLOCKED to a disarming statement; the analyzer refuses to run rather
than classify with a weakened floor (`assertFloorNotWeakened`, `D17_FLOOR_FACTS`).

**Why every scope, not just the session-scoped forms (Phase 4 plan 02's own checkpoint
decision):** the database- and role-scoped forms were the ones `04-CONTEXT.md` explicitly left to
discretion. They are covered, not recorded as a gap, precisely because they are the *more*
dangerous forms of the same act — they persist beyond the migration's own session, onto every
later connection, so leaving them uncovered would hand Phase 7's production runner a gap rather
than a protection. All four disarming node shapes route through one shared fact
(`StatementFacts.disarmsTimeout`) and one shared inspector helper, so there is no per-scope
allowlist to drift.

**Why this is architecturally the same act as downgrading DROP TABLE:** a migration disarming its
own safety rail is an attempt to remove the constraint rather than to satisfy it — the identical
shape the original D02/`03-CONTEXT.md` D-02 floor exists to make un-editable. The floor's stated
definition is deliberately a principle ("irreversible data loss or self-disarming"), not a list
that grew an unexplained member, so a future candidate is judged against the reasoning rather than
against an enumeration.

**Consequence, recorded rather than left implicit:** `D06_UNMATCHED_CANARY_FACTS` (the D-06
"SAFE must be earned" self-check) gained a `transactionHostile: true` canary, but deliberately did
**not** gain a `disarmsTimeout: true` canary — that combination is now a genuinely catalogued case
(BLOCKED, via `disarms-timeout-guc`), so including it would make the self-check reject the shipped
rules file itself, exactly like the pre-existing `nestingLimitExceeded` exclusion. See
`packages/automation/src/classifier/floor.ts`'s own comment for the full reasoning.

---

## D18 — `idle_in_transaction_session_timeout` is deliberately not set or floored this phase
**Status:** ACCEPTED, revisit at Phase 7 · 2026-09-08

Unlike `lock_timeout`/`statement_timeout` (D19 below), the Phase 4 runner does not set
`idle_in_transaction_session_timeout` at connect time, and D17's widened floor does not treat
disarming it as a floor violation.

**Why:** the runner's own transaction discipline (`04-CONTEXT.md` D-09/D-11) means nothing in it
ever leaves a transaction open and idle — every wrapped migration runs `BEGIN` immediately
followed by its statements and `COMMIT`, with no interactive or user-driven pause in between. A
third pinned timeout would therefore be a value with nothing behind it, the same reasoning D16 (via
`04-CONTEXT.md` D-16) already used to decline a concurrent-index timeout exemption: a number
invented without evidence is worse than no number, because it invites a false sense of coverage.

**Revisit condition:** if a later phase (most plausibly Phase 6 or 7, once staging/production
introduce operator-driven or long-lived sessions) introduces any code path that can hold a
transaction open across an interactive or network-bound pause, this decision must be reopened —
that is precisely the scenario `idle_in_transaction_session_timeout` exists to bound.

---

## D19 — The Phase 4 runner's pinned session timeouts
**Status:** ACCEPTED · 2026-09-08

`lock_timeout = 3000ms` and `statement_timeout = 30000ms` are pinned source constants
(`04-CONTEXT.md` D-13), applied as libpq connect-time startup options (`options=-c
lock_timeout=3000 -c statement_timeout=30000`, D-14) and independently re-verified against
`pg_settings` before any migration statement executes (D-15) — never trusted from a `SET` issued
after connect, and never merely assumed to have taken effect.

**One pair applies to everything, including concurrent index builds** (D-16, no exemption): a
`CREATE INDEX CONCURRENTLY` build that outruns `statement_timeout` fails loudly and the operator
makes a deliberate decision, rather than the runner quietly granting one class of statement
unbounded runtime. A longer, separate timeout for concurrent builds was considered and declined
for lack of evidence — revisit at Phase 7 once real data volumes make the number empirical rather
than invented.

**Implementation note:** these constants and their connect-time application are the Phase 4
runner's own concern (`packages/automation/src/runner/`, `scripts/db-migrate.ts`) — this entry
records the decision made in phase planning so it is discoverable without reopening
`04-CONTEXT.md`, mirroring D16's own "durable summary" role for the safety analyzer's contract.

---

## D20 — The runner executes SQL itself; it does not wrap drizzle's own migrator
**Status:** ACCEPTED · 2026-09-08

`packages/automation`'s migration runner (`04-CONTEXT.md` D-01) reads each migration file once,
hands that exact in-memory buffer to the in-process safety analyzer for classification, and then
executes that same buffer statement by statement itself, through `pg` — never a second read of
the file, and never a call into `drizzle-orm`'s own programmatic `migrate()`.

**Why:** wrapping drizzle's own migrator was considered and rejected on two independent grounds.
First, it re-reads the migration files itself, which means the bytes the analyzer classified and
the bytes actually executed are not provably the same object — reopening exactly the gap D12
(re-derive classification at execution time) exists to close. Second, it wraps each migration
file in its own transaction unconditionally, which breaks RUN-04's requirement that statements
are not forced into a transaction that would break `CREATE INDEX CONCURRENTLY` and similar safe
forms. A hybrid that borrowed drizzle-kit's own journal-reading internals was also rejected, as a
dependency on internals that are not a stable public API.

**Consequence:** the runner owns statement splitting (derived from the same `libpg-query` AST the
classifier already parses, `04-CONTEXT.md` D-03), the transaction wrap/unwrap decision
(`04-CONTEXT.md` D-09/D-11), and the ledger write (`drizzle.__drizzle_migrations`, kept
byte-compatible with drizzle's own format so `drizzle-kit generate`/`check` keep working
unchanged, D-04) — all built on top of owning execution rather than delegating it.

---

## D21 — `drizzle-kit migrate` is structurally unreachable from this repository
**Status:** ACCEPTED · 2026-09-08

`db:migrate` is the gated runner (D20 above); nothing in the repository invokes `drizzle-kit`'s
own `migrate` sub-command, and a guardrail test (`tests/guardrails.test.ts`) asserts no package
script or code path reaches it, scanning the whole tracked source surface with no per-file
allowlist. `drizzle-kit generate` and `drizzle-kit check` are untouched and remain in use for
authoring and validating migrations.

**Why:** the same reasoning `01-CONTEXT.md` D-14 used to reject a `docker-entrypoint-initdb.d`
init script — a second, ungated path by which schema state can arrive is precisely the drift this
system exists to detect, and it must not exist inside the system's own repository. A renamed
escape hatch (e.g. `db:migrate:raw`) was considered and rejected: it is an override path under a
different name, exactly the pattern `PITFALLS.md` §C2 identifies as the start of a slide toward
routine overriding.

**Reversibility:** one-way in intent. Restoring a raw migrate path later reintroduces the ungated
route this decision closes — a future pull request that adds one, under any name, is a
safety-relevant change and should be reviewed as such, not merged as ordinary configuration.

---

## D22 — The runner-owned `runner.migration_runs` table is bootstrapped imperatively, not by a Drizzle migration
**Status:** ACCEPTED · 2026-09-08

The runner records its in-flight marker, failure state, and per-migration run report in a
separate, runner-owned Postgres table (`runner.migration_runs`, `04-CONTEXT.md` D-19), created
with `CREATE ... IF NOT EXISTS` at first connect — never as a committed Drizzle migration.
`drizzle.__drizzle_migrations` stays byte-compatible with drizzle's own format (D-04); this table
holds only what that schema has no room for.

**Why imperative bootstrap, not a migration, for three reasons:**
1. **Chicken-and-egg.** The table has to exist in order to record the very run that would create
   it if it were itself a migration — the first run that applies it would have nothing to record
   its own outcome into until after it committed.
2. **It is runner infrastructure, not application schema.** `drizzle-kit generate` diffs
   `apps/recipe-app/src/db/schema.ts` against the database; `runner.migration_runs` is not part
   of that application schema and should not appear in that diff.
3. **RUN-05/RUN-06's schema assertions must stay a statement about the application's schema.**
   Folding runner infrastructure into the migration history would make "the migration history
   produces the expected schema" a claim about two different things at once.

**Consequence:** this table is the substrate Phase 7's audit log is built on top of, rendering an
existing artifact rather than inventing one from scratch.

---

## D23 — Recovery reports and resolves; it never repairs
**Status:** ACCEPTED · 2026-09-08

`pnpm db:migrate:recover` (`04-CONTEXT.md` D-21) is a report-and-clear command, and nothing more.
It names the exact state of every unresolved marker it finds — which migration, which statement
(of how many), and any `INVALID` index the database currently holds — then clears (resolves) the
marker so `db:migrate` can proceed again. It never edits `_journal.json` and never drops or
rebuilds anything itself.

**Why:** automatic repair was considered and rejected. Putting destructive capability (for
example, dropping an `INVALID` index on its own initiative) inside the one component whose entire
job is refusing destructive operations has the wrong shape — it would mean the safety tool and
the thing it protects against share a code path. The operator's own action, taken with full
knowledge of what the report named, is what resolves the underlying state; the recovery command's
job ends at making that state visible and un-stuck.

---

## D24 — Two Testcontainers-vs-real-container harnesses for the history tests, deliberately
**Status:** ACCEPTED · 2026-09-08

RUN-05 and RUN-06 (full history against a genuinely empty database; the newest migration against
an already-migrated one) run against `@testcontainers/postgresql` instances. RUN-07 (the
application boots against the resulting schema) runs `tests/smoke.test.ts` against the real,
pinned local development container, after a full-history `pnpm db:reset` (`04-CONTEXT.md` D-22).

**Why two harnesses, not one:** neither can honestly do the other's job. Testcontainers gives
"genuinely empty" by construction, with a dynamically assigned port — exactly what RUN-05/RUN-06
need to prove, and exactly what the application's own connection cannot be, because
`01-CONTEXT.md` D-16's `assertLocalDevelopmentTarget` pins the app to
`127.0.0.1:5432/recipe_dev` specifically so that guard cannot be silently loosened into a
remotely-pointable one. Loosening that pin to let the app boot against a Testcontainers instance
was considered and declined — it is the exact collision `02-CONTEXT.md` D-14 already declined to
solve by loosening the pin, and doing so here would weaken the single guard that makes the whole
workspace structurally local.

**Consequence:** RUN-07's proof is necessarily against the one real container this repository
runs, reusing the smoke test built for exactly this purpose (`01-CONTEXT.md` D-08, D-26) rather
than against a disposable stand-in.

---

## D25 — The `packages/automation` package boundary is test-held by a frozen, ratcheted debt inventory
**Status:** ACCEPTED · 2026-09-09

`tests/guardrails.test.ts` now enforces `.planning/v1-MILESTONE-AUDIT.md`'s single recorded
integration defect (also 03-REVIEW-WR-03): `packages/automation` — the unit Phase 7's package
extraction (PLAT-01) plans to publish standalone — currently escapes its own package root through
four relative imports of `scripts/log.ts`'s `safeErrorMessage`, in `cli.ts`,
`inspector/inspect.ts`, `inspector/inspect-plpgsql.ts`, and `runner/run-migrations.ts`. Those four
imports bypass the package's declared dependency set entirely; they resolve by filesystem
relative-path depth, which a future edit to directory structure could silently break or silently
widen without any test noticing. This decision does **not** remove them. It converts the boundary
from something held by a developer keeping relative-path depth in sync — remembered caution, the
exact anti-pattern CLAUDE.md's first non-negotiable names — into something a test fails on.

**Mechanism:** `KNOWN_PACKAGE_BOUNDARY_ESCAPES`, a map of file path to the exact specifier
strings it escapes with, populated with today's four entries and no others. The guardrail scans
every TypeScript file under `packages/automation/`, resolves each relative import against the
package root, and asserts the live result is exactly equal — in both directions — to this
constant.

**Why this shape over a per-file allowlist** (the `FIXTURE_FILES_WITH_CONNECTION_STRINGS` idiom
already used twice elsewhere in the same file): an allowlist exempts *files*, so a fifth escaping
import added to `cli.ts` — a file already on the list — would still pass; nothing in that shape
can distinguish "one recorded escape" from "one recorded escape plus a new one." The chosen
inventory shape exempts nothing: it records the exact *specifiers* each file escapes with, so a
second escape in an already-listed file lengthens that file's array and fails, the one property a
per-file allowlist structurally cannot have. It is also non-vacuous by construction — the expected
state is a non-empty four-entry map, so a detector broken by a bad regex, a renamed directory, or
a gitignore change produces `{}` and fails the comparison — unlike the two `toEqual([])` gates
already in this same file, which a silently-broken detector satisfies trivially by finding
nothing.

**Why not the unconditional, zero-exemption shape** used for the `drizzle-kit migrate` ban
(`tests/guardrails.test.ts`, "a gate with a second door is not a gate"): that ban was unconditional
because it had zero real instances to accommodate — six prose mentions were reworded to make it
pass clean, at no cost. This boundary has four real code instances that cannot be removed within
this task's scope (removing them is Phase 7's decision, not a docs or test-authoring decision).
Shipping an unconditional ban here would mean shipping a permanently red default suite, and a red
default suite is precisely the condition under which guardrails get deleted rather than respected.
The frozen inventory preserves the unconditional ban's actual intent — no second door, no
exemption — without requiring a debt that is out of scope to pay before the record can exist.

**The inventory is a ratchet.** It may only shrink. Removing one of the four entries without also
deleting it from `KNOWN_PACKAGE_BOUNDARY_ESCAPES` fails the guardrail (a key present in the
inventory but absent from the live scan), so the record cannot go quietly stale. Adding an entry —
recording a new escape rather than removing it — is a deliberate architectural decision requiring
its own new decision record, not routine test maintenance.

**`apps/recipe-app` is deliberately out of scope.** `src/db/client.ts` and `src/db/seed.ts` both
import `scripts/env.ts` via a relative path that similarly escapes their own directory tree. They
are left alone on purpose: an *application* consuming a repo-root shared module is not a
package-extractability violation the way `packages/automation` doing so is — `packages/automation`
is the specific unit whose own `package.json` `name` and `exports` imply an isolation these four
imports break, and it is the only one Phase 7 plans to extract and publish standalone. Widening
this guardrail to the app would be a different, real decision, and is not made here.

**Consequence, stated without softening:** this closes the audit's single recorded integration
defect as a *containment*, not as a removal. The boundary can no longer widen undetected by any
mechanism this test's scan covers. It is not yet clean — the four imports remain exactly as they
were, and stay someone's open debt until Phase 7's package extraction pays each one down and
deletes its line from `KNOWN_PACKAGE_BOUNDARY_ESCAPES`.

---

## D26 — The `main-protection` branch ruleset is live, with an empty bypass list, on the real repository
**Status:** ACCEPTED · 2026-09-09

`05-CONTEXT.md` D-04 is applied, not merely committed as a payload: `POST /repos/{owner}/{repo}/rulesets`
created ruleset id `22668397` on `Renkai7/database-automation`, targeting `refs/heads/main`, with
`enforcement: "active"`. Read back from the API (never trusted from the request that created it):
`bypass_actors` is present in the response and has length 0; `current_user_can_bypass` reads
`"never"` for the repository owner's own account. The six required status check contexts
(`analyze`, `tamper-checks`, `test`, `test-history`, `migrate`, `ruleset-config-check`) are present
verbatim, matching the sorted context list in `.github/rulesets/main-protection.json` character for
character, which itself matches every job's `name:` in `.github/workflows/pr-gate.yml` — confirmed
by direct comparison, not assumed.

**Observed, not merely configured:** a direct push was attempted from a real local branch —
`git push origin HEAD:main` — and refused by GitHub with:

```
remote: error: GH013: Repository rule violations found for refs/heads/main.
remote: - Changes must be made through a pull request.
remote: - 6 of 6 required status checks are expected.
```

This is the half of D-04 that a passing pull-request check alone does not exercise: the ruleset
blocks the ordinary `git push`, not only an unmerged pull request. This closes CI-03's live
enforcement half; `docs/40-ci-gate-merge-attempt.md` (plan `05-08` Task 2) is the paired
observation for the pull-request half, with the merge attempt performed by the owner personally.

**Working-mode change, recorded here as the primary reference:** every commit that must reach
`origin/main` from this point forward — including `.planning/` documentation — travels through a
branch and a pull request whose six checks pass. Local commits are unaffected; only publishing to
`main` is gated. This is D-04's accepted, recorded consequence, not a surprise discovered later.

— **Reversibility:** one-way in intent, matching D-04's own standing. Removing the ruleset,
widening `bypass_actors`, or dropping a required check is a safety-relevant change requiring its
own decision record, not routine configuration. `scripts/ci/apply-ruleset.ts` deliberately has no
delete path.

**Payload bug found and fixed while applying it (Rule 1/3 deviation, not a decision to reopen):**
the committed `.github/rulesets/main-protection.json`'s `pull_request` rule carried only
`required_approving_review_count`; the live API's schema requires four more boolean fields
(`dismiss_stale_reviews_on_push`, `require_code_owner_review`, `require_last_push_approval`,
`required_review_thread_resolution`) and rejected the payload outright with HTTP 422 until they
were added, each `false`, preserving D-04's original intent (require a pull request, no minimum
approving-review count) exactly. `scripts/ci/check-ruleset-config.ts` also had a live bug of its
own severity: `runCheckRulesetConfig` filtered `rulesetsMatchingMain` against the LIST endpoint's
summary response, but that endpoint omits `conditions` entirely — confirmed live — so the match set
was always empty and the check reported "the gate is absent" even against a correctly configured,
live ruleset. Both fixed; see `b35c995`.

---

## D27 — The ruleset self-check runs inside the thing it audits, live and confirmed
**Status:** ACCEPTED · 2026-09-09

`05-CONTEXT.md` D-05's check (`scripts/ci/check-ruleset-config.ts`) was run locally against the now-live
ruleset, using the owner's own admin-scoped `gh` credential, and passed: bypass list confirmed
present and empty, enforcement confirmed active, every required rule type and status check context
confirmed present. Its honest limit is stated in the module's own header and repeated here as
required by `05-CONTEXT.md` D-05: **this check runs inside the thing it audits.** Someone who can
edit the ruleset can also delete this check. It raises the cost of tampering and makes it visible;
it does not make tampering impossible. That is `docs/decisions.md` D12's bypassability spectrum,
restated at this layer.

---

## D28 — Tamper detection (CI-05) is live as committed; falsification against real pull requests is Task 2's job
**Status:** ACCEPTED, falsification pending

`05-CONTEXT.md` D-09/D-10's two checks — append-only diff and schema-drift regeneration — are live
in `.github/workflows/pr-gate.yml`'s `tamper-checks` job and passed on this plan's own observation
pull request (`#3`) against a clean tree. **Recorded consequence, unchanged from `05-CONTEXT.md`
D-10:** Phase 4's `D-32` workflow — generating a BLOCKED migration and then reverting both the file
and its journal entry — would be refused if attempted through a pull request now that `main` is
protected, because the journal-entry disappearance is exactly what the journal-level append-only
check exists to catch. This entry records the mechanism as live; Task 2 of this plan performs the
actual falsification against real pull requests (an edit to an already-applied migration, and a
hand-edit that changes what the SQL does) and its results belong in `docs/40-ci-gate-merge-attempt.md`,
not restated here.

---

## D29 — The `migrate` job satisfies CI-06 without loosening the local-development-target pin
**Status:** ACCEPTED

`05-CONTEXT.md` D-14's dedicated `migrate` job — a structurally separate pipeline step running the
real, unmodified `pnpm db:migrate` entry point against a `postgres:17` service container reachable
at `127.0.0.1:5432/recipe_dev` — is live in `.github/workflows/pr-gate.yml` and passed on PR `#3`.
`scripts/env.ts`'s `assertLocalDevelopmentTarget` pin (`01-CONTEXT.md` D-16) is satisfied honestly
by shaping the CI database to match it; the pin itself was never touched. This closes CI-06's first
clause (migrations run as their own pipeline step); the second clause (nothing at application
startup triggers a migration) is `05-CONTEXT.md` D-15's guardrail, shipped in plan `05-07`, and this
plan's Task 2 human-check step 6 reads it directly to confirm no drift.

---

## D30 — Open Question 1 is settled: a workflow's own `GITHUB_TOKEN` cannot observe `bypass_actors` at all, confirmed live — a phase-blocking finding, not resolved by this entry
**Status:** OPEN finding, ACCEPTED as fact — resolved by D31's split decision below. This entry's own observation stands unmodified; only its "no option chosen yet" closing sentence is superseded.

`05-RESEARCH.md`'s open question — whether a workflow token under `administration: write` can read
an existing ruleset's `bypass_actors` — is answered as an observed fact, and the answer is the
sharpest of the three outcomes the plan pre-committed to: **not just insufficient permission, but no
declarative path to request it at all.** Plan `05-06` already confirmed live that `administration`
is not a recognized key in a workflow's `permissions:` block (`gh workflow run` on a scratch trigger
returned `HTTP 422: Invalid Argument - failed to parse workflow: Unexpected value 'administration'`).
This entry confirms the next link: with the live `main-protection` ruleset actually in place, a real
pull request (`#3`) was opened and `ruleset-config-check` ran under the workflow's own default
`GITHUB_TOKEN` (`contents: read`, the only grantable scope). Its own job log reads, verbatim:

```
[check-ruleset-config] 1 ruleset(s) failed verification (this check runs inside the thing it
audits -- it raises the cost of tampering and makes it visible, it does not make tampering
impossible):
ruleset "main-protection" (id 22668397): [check-ruleset-config] "bypass_actors" is ABSENT from
the API response. GitHub omits this field entirely when the calling token lacks write access to
the ruleset -- an absent field is NOT the same as an empty list. This check cannot confirm the
bypass list is empty when it has no visibility into the field at all; it is refusing to guess.
```

`assertBypassListEmpty` did exactly what `05-CONTEXT.md` D-05 requires: it failed CLOSED rather
than silently passing on an absent field. That correctness is exactly what makes this a genuine,
unresolved problem rather than a bug to route around: **`ruleset-config-check` is a required status
check that can never report success under the current `GITHUB_TOKEN`-only permission model, and a
required check that never succeeds blocks every pull request permanently** — including the
demonstration pull requests Task 2 of this plan must open and this plan's own Task 3 documentation
pull request.

**This is the phase-blocking finding `05-CONTEXT.md` D-04/D-05 and `05-RESEARCH.md`'s own
pre-committed three-outcome protocol name explicitly.** The fallback the research already named —
a fine-grained PAT or GitHub App token with real ruleset-read rights, held as a repository secret
— reopens `05-CONTEXT.md`'s "no credentials in CI beyond the default workflow token" boundary, and
per that same document is **the owner's decision, not an implementation detail.** Recording it here
rather than deciding it silently is this entry's entire purpose. Options surfaced for that decision,
none selected by this entry:

1. **A fine-grained PAT or GitHub App token, held as a repository secret**, granted read access to
   repository administration/rulesets only, used exclusively by `ruleset-config-check`. Reopens the
   no-extra-credentials boundary; the credential's blast radius (read-only on ruleset config) would
   need to be argued explicitly against that boundary, not assumed acceptable.
2. **Remove `ruleset-config-check` from the ruleset's required contexts**, keeping the job itself
   running as a non-required, always-visible signal. Preserves the no-extra-credentials boundary at
   the cost of D-05's check no longer being a required gate — its failure would no longer block a
   merge, only be visible in the checks list.
3. **Narrow the check to assert only what `contents: read` can see** (enforcement active, required
   rule types and contexts present) and drop the `bypass_actors` assertion entirely from the
   required gate. Keeps the check required but removes the specific property — an empty bypass list
   — that is D-04's entire point ("the bypass list is empty" is the phase in one sentence, per
   `05-CONTEXT.md`) from continuous machine verification, leaving it confirmed only by the one-time
   observation in D26 above.

No option is chosen here. This plan does not proceed past this finding by picking one silently.

---

## D31 — D30 resolved: split the check rather than add a credential
**Status:** ACCEPTED · 2026-09-09

The owner's decision, made explicitly rather than assumed, is a combination of D30's options 2 and
3: **`ruleset-config-check` stays required**, narrowed to assert only what a `contents: read`
`GITHUB_TOKEN` can genuinely observe — `enforcement` is `"active"`, and every required rule type
(`deletion`, `non_fast_forward`, `pull_request`, `required_status_checks`) and required-check
context is present. It no longer asserts `bypass_actors` is empty. A second, separate job —
`ruleset-bypass-audit` — runs on every pull request, is deliberately **not** listed in
`.github/rulesets/main-protection.json`'s `required_status_checks`, and asserts `bypass_actors` is
present and empty using the exact same `assertBypassListEmpty` function `ruleset-config-check` used
to call, imported and reused unmodified rather than reimplemented, so its fail-closed behavior
(never passes on an absent, `null`, or non-array field — the Pitfall 1 false negative D-05 exists
to refuse) is identical in both places.

**Option 1 — a fine-grained PAT or GitHub App token held as a repository secret — was explicitly
rejected, not merely left unchosen:**
- `05-CONTEXT.md`'s own domain section states the phase boundary plainly: "No credentials in CI
  beyond the default `GITHUB_TOKEN`." That boundary exists for a sequencing reason — adding a
  credential before Phase 6's connectivity decision inverts this project's own sequencing
  constraint (no remote access until the safety architecture exists and has been tested).
- `05-CONTEXT.md` D-18 already rejected a credential-holding CI automation on exactly these
  grounds, for a different mechanism (a fully automated merge-refusal test) — "a credential-holding
  automation inside the repository whose purpose is minimising credential surface." The reasoning
  is identical here: a PAT scoped to ruleset-read is a smaller blast radius than a merge-capable
  token, but it is still a new standing credential added to close a gap this phase's entire premise
  is to avoid opening.
- An expiring PAT would additionally re-create the exact "no pull request can merge" outage D30
  just produced, on a timer, the next time it lapses — an unacceptable operational hazard for a
  solo founder with no team to notice and rotate it before every pull request starts failing again.

**Why not option 2 alone (remove the required check entirely, keep it only as a visible signal):**
that would drop D-05's continuous re-verification of enforcement, rule types, and required-check
contexts from the required gate too — properties a `contents: read` token genuinely CAN observe,
and which D-05 explicitly names as readable this way. `ruleset-config-check` narrowed (this entry)
keeps those two properties hard-gated exactly as D-05 intended; only the one property the token
cannot see moves out.

**Why not option 3 alone (narrow the required check and stop there):** that would silently drop
continuous verification of the empty bypass list altogether, leaving it checked only by the D26
one-time observation. The owner's decision preserves D-05's visibility function for that property
by keeping `ruleset-bypass-audit` running and loud on every pull request — it is degraded from a
hard gate to a visible signal, not removed.

**D-05's own two stated properties, and which stays hard-gated (05-CONTEXT.md D-05):**
1. "A required check has been removed" — stays hard-gated. `ruleset-config-check`'s
   `assertRequiredRules` still fails if any of the six contexts, or any of the four rule types
   (including `pull_request`, the direct-push block), disappears from the live ruleset.
2. "Direct-push blocking has been disabled" — stays hard-gated, via the same `assertRequiredRules`
   call asserting the `pull_request` and `non_fast_forward`/`deletion` rule types are present.
3. **The bypass list is non-empty** — this is the property that moves from hard-gated to
   advisory-only. It is still checked, on every pull request, by `ruleset-bypass-audit`; it no
   longer blocks a merge if it fails.

**The residual honest limit, stated plainly so this gate is never described as stronger than it
is:** the empty bypass list is no longer continuously verified as a hard merge gate. It is verified
continuously only by the advisory `ruleset-bypass-audit` job (which fails loudly and visibly, but
does not block a merge), and by the one-time performed observation already recorded in D26 above
(`bypass_actors` read back present and empty via the owner's own admin-scoped `gh` credential at
the moment the ruleset was applied). This is `05-CONTEXT.md` D-05's own bypassability spectrum,
one notch further down than D-05 originally described: the check that audits the ruleset already
ran inside the thing it audits and could be deleted by whoever could edit the ruleset; this split
additionally means the specific bypass-list assertion no longer blocks a merge on its own even
while it is running. It raises the cost of an unnoticed non-empty bypass list; it does not prevent
one from merging silently if `ruleset-bypass-audit`'s red run goes unread.

**No new credential was added.** This is the load-bearing constraint the whole decision turns on,
and it holds: neither script gained a new secret, a new token, or a new permission scope. Both
`ruleset-config-check` and `ruleset-bypass-audit` run with only the workflow-level default
(`contents: read`).

**Guardrail consequence, recorded so it is not rediscovered as a surprise:** `tests/guardrails.test.ts`'s
D-11 second-half job/context set-equality guardrail is narrowed, not loosened or deleted, to allow
`ruleset-bypass-audit` as a single, explicitly enumerated, commented exception
(`ADVISORY_NON_REQUIRED_JOBS`) — matching the `CI_WORKFLOW_FILES_WITH_EPHEMERAL_DSN` idiom already
used elsewhere in that file. The fatal direction (every required context must have a matching job)
remains unconditional.

**Reversibility:** the split itself is reversible in either direction — folding the advisory check
back into the required gate, or dropping it, are both ordinary configuration changes, not
safety-relevant ones on D-04's standing. What is NOT reversible without its own decision record is
adding a credential to make `bypass_actors` observable to the required check directly; that
remains option 1, rejected above, and reopening it later requires arguing against this same
reasoning explicitly, not merely reverting this entry.
