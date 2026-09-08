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
