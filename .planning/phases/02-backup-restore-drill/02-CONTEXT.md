# Phase 2: Backup & Restore Drill - Context

**Gathered:** 2026-09-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 2 proves — by actually doing it — that a backup of the local development PostgreSQL
can be restored. The owner personally destroys real data, restores it, times the procedure,
and writes the runbook from what actually happened. Alongside that, an automated restore
drill takes a backup, restores it into a genuinely fresh disposable instance, and asserts
real content rather than an exit code. A skipped or failing drill is made structurally
visible.

Requirements in scope: BKP-01, BKP-02, BKP-03, BKP-04, BKP-05, BKP-06, BKP-07, BKP-08.

**Explicitly not this phase:** no remote or production database of any kind (D2, D3) — this
phase backs up the local development container only. No off-server backup storage. No
scheduled/cron backups. No safety analyzer (Phase 3), no migration runner (Phase 4), no CI
(Phase 5), no status dashboard (Phase 7). No new recipe-app schema — the reserved churn
material in `01-CONTEXT.md` D-11 must not be spent here.

</domain>

<decisions>
## Implementation Decisions

### Backup artifact

- **D-01:** The data dump uses **custom format (`pg_dump -Fc`)**. Compressed by default,
  supports selective restore (directly needed for the drop-one-table act), and the only
  format that enables `pg_restore --jobs N`. Matches `.planning/research/STACK.md`.
  Accepted cost: the artifact is binary and cannot be read without `pg_restore`.

- **D-02:** The backup **also captures `pg_dumpall --globals-only` as a separate file**
  (BKP-02). Two artifacts per backup: the `-Fc` data dump and the globals/roles dump.

- **D-03:** Backups land **outside the repository**, at a configured absolute destination
  treated as *a backup destination* rather than a repo subdirectory. Rationale: the globals
  dump contains role password hashes (SCRAM verifiers), which is credential-adjacent
  material, and `CLAUDE.md` requires that credentials are never committed. Keeping dumps
  out of the working tree makes that structural rather than a `.gitignore` line that has to
  keep holding — the same posture as `01-CONTEXT.md` D-16 (pinning the dev target in source)
  and D-20 (hard-failing on a bare `DATABASE_URL`). An in-repo `backups/` directory and an
  in-repo directory plus a staged-file guard were both considered and rejected.
  — **Reversibility:** costly — the destination is referenced by the backup tool, the
  restore tool, the drill harness, the status record, and the runbook; changing its shape
  later means changing all of them plus reissuing the runbook.

- **D-04:** The destination must **not be hardcoded to a repo-relative path**, because the
  intended eventual shape is *dump → file at a destination → ship that file to object
  storage*. Off-server storage itself is deferred (see Deferred Ideas), but Phase 2's layout
  must make adding it an extra step rather than a rewrite.

- **D-05:** `db:backup` **also emits a JSON manifest** recorded at backup time, containing:
  timestamp, server version, SHA-256 of each dump file, per-table row counts, the applied-
  migration count from `drizzle.__drizzle_migrations`, and the git commit. The restore
  assertions then compare against what was genuinely in the source at backup time rather
  than against hardcoded seed constants — so they keep working when the seed changes, and
  they stay honest if a backup was taken from a half-seeded database. The manifest is also
  the record Phase 7's status view can read. **The manifest must contain no credentials** —
  no connection string, no role passwords, no hashes.

### Command shape

- **D-06:** **No command anywhere accepts a target.** `db:backup` and `db:restore` are root
  `package.json` scripts hardcoded to the pinned local development target, reusing
  `assertLocalDevelopmentTarget` from `scripts/env.ts`. The automated drill restores through
  a **separate internal function that only accepts a connection object the disposable-
  container harness constructed** — never a connection string a human or an agent can
  supply. This preserves `01-CONTEXT.md` D-03's asymmetry rule: a restore command taking a
  destination is precisely the tool that could later be pointed at staging. A single
  allowlist-guarded `db:restore --target <url>` was considered and rejected for that reason.
  — **Reversibility:** one-way in intent — adding a target parameter later would silently
  convert a structurally-local tool into a remotely-pointable one. Treat any future PR that
  parameterises either command as a safety-relevant change, exactly as D-16 requires for
  `db:query`.

### The manual destruction drill

- **D-07:** The drill has **two acts**:
  - **Act 1 — table drop, restored in place.** `DROP TABLE recipes CASCADE` against the live
    development database, then restore. `recipes` is the parent table; `ingredients` and
    `steps` both reference `recipes.id` with `ON DELETE CASCADE`, so the drop also removes
    those foreign-key constraints. This is criterion 1's literal "dropped a real table" and
    it is the sharpest single-table case available in the current schema.
  - **Act 2 — total loss, restored into an empty cluster.** Destroy the container and its
    volume entirely, then rebuild from both dumps into a genuinely empty cluster.
  Act 2 exists because it is **the only act in which `pg_dumpall --globals-only` does
  anything** — restoring roles into a cluster that already has them is a no-op. Without it,
  BKP-02's globals dump is produced but never exercised, leaving an untested step in the
  runbook, which is the exact failure mode this phase exists to prevent.

- **D-08:** "Confirmed the data returned" means **manifest comparison plus a look at the
  Recipe Page**: run `db:query` against the restored database and compare row counts and
  recognisable values against the backup manifest, then load the Recipe Page and see the
  seeded recipe render. `01-CONTEXT.md` D-23 seeded from the design's own recipe content
  specifically so restored data is recognisable to a human rather than meaningless. Both
  checks are things that would genuinely be done during an incident. Running the automated
  assertion suite by hand was rejected because it would require the automated assertions to
  exist before the manual drill, inverting the phase's ordering; eyeballing alone was
  rejected because it cannot detect act 1's failure mode (rows back, constraints missing).

- **D-09:** **Per-step timings are recorded**, not just a total: backup, drop, restore,
  verify, and the human time spent reading and deciding. The runbook must state plainly that
  these are **fixture-scale numbers and are NOT a production recovery-time estimate** —
  production RTO stays UNKNOWN. Human decision time matters because it is the part that does
  not shrink with data volume and usually dominates a real incident.

- **D-10:** The runbook is **`docs/20-restore-runbook.md`**, following the existing `docs/`
  numbering convention (`00-current-state.md`, `10-roadmap.md`). Structure: a clean,
  copy-pasteable procedure with real timings at the top — what is wanted at 3am, not a
  narrative — followed by a **"what actually happened"** section recording wrong turns,
  surprises, commands that failed and why, and anything that turned out UNKNOWN. A
  clean-procedure-only runbook was rejected: it would read exactly like one written in
  advance from documentation, which is what BKP-06 exists to prevent.

### The automated drill

- **D-11:** The drill restores into **`@testcontainers/postgresql`** (12.1.0, per
  `.planning/research/STACK.md`) — a fresh container per run with a dynamic port and typed
  lifecycle management. "Genuinely fresh, never pre-seeded" (BKP-03) is then satisfied by
  construction rather than by discipline. The dynamic port also reinforces D-06: the drill's
  connection is one the harness built, not one anyone typed. A dedicated compose service and
  a raw `docker run` were both considered and rejected — each would mean hand-writing
  readiness polling, cleanup-on-failure and port allocation, which are the three things that
  fail silently when wrong.

- **D-12:** The drill container image is **`postgres:17` (Debian/glibc), not
  `postgres:17-alpine`.** BKP-03's "matching production's image" points at the server pin in
  D9 / `01-CONTEXT.md` D-12. The `postgres:17-alpine` recommendation in
  `.planning/research/STACK.md` applies only to the **client tooling** image that runs
  `pg_dump` / `pg_restore`. Both images are used in this phase, for different roles — do not
  collapse them.

- **D-13:** Assertion depth is **`.planning/research/FEATURES.md` §4 tiers 1 through 4**:
  1. artifact integrity — restore exits 0 and the dump checksums match the manifest;
  2. per-table row counts compared against the manifest;
  3. **schema equality** — `pg_dump --schema-only` of source vs restored, compared;
  4. spot-checked values, orphan-row / referential-integrity check, and sequence state.

  Tier 3 is included deliberately even though BKP-04 does not name it: **data-level
  referential integrity does not catch a missing constraint.** After `DROP TABLE recipes
  CASCADE`, the foreign keys on `ingredients` and `steps` are gone; orphan-row checks still
  pass; only a schema comparison notices. That is act 1's lesson, asserted generically.
  `.planning/research/ARCHITECTURE.md`'s `pg_dump` diff-noise warning is about snapshots
  committed over time — here both dumps come from the same `pg_dump` invocation-pair in the
  same run, so ordering non-determinism is largely not in play. If it turns out to be, the
  fix is canonicalising the dump before comparison, not dropping the tier.

- **D-14:** **Tier 5 (application boot against the restored database) is out of scope for
  this phase.** It collides with `01-CONTEXT.md` D-16: the app's connection is pinned to
  loopback:5432/`recipe_dev`, and a Testcontainers instance has a dynamic port. Making the
  app bootable against the drill container would mean either loosening that pin — a
  safety-relevant change — or building a second connection path. Recorded as deferred, not
  rejected.

- **D-15:** The drill **takes its own backup as part of the run** — one hermetic sequence:
  back up the live development database, start a fresh container, restore into it, assert
  against the manifest just written. This exercises the entire pipeline (backup code,
  manifest, restore code, assertions) every run and works on any machine with Docker and a
  seeded development database. Its honest limit is recorded rather than glossed: **it only
  ever restores a backup taken seconds ago**, so it proves the procedure works, not that a
  stored artifact survived storage. The manifest checksum covers the corruption case.
  Restoring a stored artifact was rejected as the default because it makes the test
  unrunnable on a fresh clone and in CI.

- **D-16:** The drill is **`pnpm db:drill`, separate from `pnpm test`**, and the default test
  suite contains **one cheap assertion on the drill's recorded result** (see D-19). A slow,
  Docker-dependent test inside the default suite is the one that eventually gets marked
  skipped to make the suite fast again — which is precisely the silent failure BKP-08
  forbids. A fast test asserting on the drill's *record* cannot be quietly disabled without
  the suite going red.

### Making a skipped or failed drill visible

- **D-17:** The drill result is a **committed, machine-readable status file** (JSON). Git-
  tracked so its age is visible in history and blame rather than living on one laptop;
  machine-readable so the cheap staleness check can assert on it. It holds dates, outcomes,
  per-step timings and which assertion tiers ran — **nothing credential-bearing**. This is
  also the record Phase 7's status view reads, so building it now means that phase renders
  an existing artifact rather than inventing one.

- **D-18:** The status file tracks the **automated drill and the human-performed drill as
  two separate facts**, each with its own date and outcome (the human entry also carries the
  timings and a runbook reference). They are different claims: an automated drill proves the
  restore path still works today; only the human drill proves a person can actually do it
  under pressure. Collapsing them into one field would let a green automated run silently
  upgrade the status that **D7 requires stay UNKNOWN until a human has performed, timed and
  documented a restore.**

- **D-19:** The cheap check in `pnpm test` **hard-fails on a missing record, a FAIL outcome,
  or a last-drill date older than 30 days.** Age is treated as evidence going stale, not as a
  nag. D-20 in `01-CONTEXT.md` already set this precedent — a warning was explicitly rejected
  as the "remembered caution" pattern this project forbids — and warnings about backups are
  the most ignored class of warning there is. **30 days is a recorded decision, not an
  incidental constant**, so it can be revisited with a stated reason rather than drifted.
  Accepted cost: if the project goes quiet, the suite goes red — which is honest, because the
  backup evidence genuinely is stale by then.

- **D-20:** When Docker is unavailable, `pnpm db:drill` **fails loudly, exits non-zero, and
  writes nothing to the status record.** It does not record a "skipped" outcome — the record
  keeps showing the last drill that actually happened and simply ages until D-19's staleness
  check goes red. A drill that could not run is indistinguishable from one that was never
  run. An exit-zero skip-with-warning was explicitly rejected: that is the exact pattern
  BKP-08 names, and a CI pipeline would read it as a pass.

### Claude's Discretion

- The exact filename and path of the status file from D-17, and the precise JSON schema of
  both it and the D-05 manifest — constrained only by: machine-readable, committed, no
  credentials, and the two-facts structure from D-18.
- How the configured backup destination from D-03 is expressed (a source constant following
  the D-16 pinning pattern, an environment variable, or a small config file) — constrained
  by D-04: it must not be a repo-relative path baked into the tools.
- Which recognisable seeded values are chosen as the tier-4 spot checks, and how sequence
  state is asserted.
- Whether the tier-3 schema comparison needs a canonicalising pass before diffing, and what
  that pass does if so.
- Retention behaviour at the backup destination (overwrite vs. accumulate, and any pruning)
  — not discussed; pick something defensible and record it.
- Whether act 1's runbook prescribes a whole-database restore up front or documents the
  CASCADE constraint gap as a discovered surprise — either is consistent with D-10, but the
  gap must appear in the runbook one way or the other.
- Whether the automated drill restores the globals dump into the fresh container as well as
  the data dump, or only the data dump — not discussed; note that D-07 act 2 covers the
  globals path manually regardless.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase requirements and goal
- `.planning/ROADMAP.md` § "Phase 2: Backup & Restore Drill" — the goal and the two success
  criteria this phase is verified against.
- `.planning/REQUIREMENTS.md` — BKP-01 … BKP-08 are this phase's requirements. The Out of
  Scope table lists anti-features that must not be reintroduced.

### Binding prior decisions
- `.planning/phases/01-local-environment/01-CONTEXT.md` — **required reading.** Directly
  binding here: **D-12** (`postgres:17` glibc server image, and the note that
  `postgres:17-alpine` is the *client tooling* image for this phase), **D-13** (no
  extensions — a declared baseline, not a claim about production), **D-16** (the dev target
  is pinned in source; no parameter redirects it), **D-21** (the environment marker is
  `current_database()`, chosen *specifically* because a stored row would survive a restore
  into the wrong database), **D-22** (`db:reset` full teardown — the existing "genuinely
  fresh" path), **D-23** (deterministic seed from the design's own recipe content, chosen so
  Phase 2 has recognisable values to spot-check), **D-03** (the never-promote asymmetry for
  local-only commands), **D-11** (reserved churn material Phase 2 must not spend).
- `docs/decisions.md` — **D3** (no production access from the local machine; visibility via
  committed schema snapshots), **D7** (restore drills move early; *backup status stays
  UNKNOWN, never PASS, until a restore has been performed by hand, timed and documented* —
  binding on D-18), **D9** (PostgreSQL 17 pinned everywhere; client image pinned to server
  major, which removes the `pg_dump`/`pg_restore` version drift that produces restores which
  appear to succeed but are incomplete), **D2** (no remote connectivity in this phase).
- `docs/00-current-state.md` — §2 confirmed local facts (Windows 11, Docker 29.6.1, Node
  v24.19.0, pnpm 10.25.0, **no local PostgreSQL, `psql` not on PATH** — client tools must run
  via Docker), **§6 the backup UNKNOWNs, which must stay UNKNOWN**, §8 risk R1 ("restore has
  never been tested" — CONFIRMED; this phase closes it).
- `CLAUDE.md` and `.claude/CLAUDE.md` — non-negotiables. Especially: prefer architectural
  enforcement over remembered caution; mark unverified things UNKNOWN; never log or commit
  credentials.

### Research
- `.planning/research/FEATURES.md` §4 "Backup Verification" — the five assertion tiers D-13
  selects from, and the reasoning that a "backup succeeded" exit code proves almost nothing.
- `.planning/research/STACK.md` — `@testcontainers/postgresql` 12.1.0, the
  `postgres:17-alpine` **client tooling** pattern for running `pg_dump`/`pg_restore` from
  Windows via Docker, `-Fc` vs `-Fd` format reasoning, and the
  `pg_restore --clean --if-exists --no-owner --jobs N` flag guidance for restore drills.
- `.planning/research/ARCHITECTURE.md` — the backup flow sketch, the placement of the
  restore-drill script inside the automation package's scope (and backup *storage* outside
  it), and the `pg_dump` diff-noise caveat relevant to D-13's tier 3.
- `.planning/research/PITFALLS.md`, `.planning/research/SUMMARY.md`.

### Existing code this phase builds on
- `scripts/env.ts` — `assertLocalDevelopmentTarget`, `getDevDatabaseUrl`,
  `assertDevelopmentDatabase`, and the pinned `EXPECTED_DEV_DATABASE_NAME` /
  `EXPECTED_DEV_DATABASE_PORT` / `DEV_DATABASE_HOST_ALLOWLIST` constants. D-06 reuses these.
- `scripts/log.ts` — `safeErrorMessage`, the single tested definition of "print only the
  error's own message, never the error object". Every new script must use it.
- `scripts/db-reset.ts` — the existing `down -v` → up → assert → migrate → verify → seed
  sequence, and its `runStep` pattern for naming the failing step.
- `scripts/verify-migration-state.ts` — `assertMigrationHistoryApplied`, the precedent for
  re-querying the database instead of trusting an exit code. The drill's assertions are the
  same idea applied to restored content.
- `apps/recipe-app/src/db/schema.ts` — `recipes` / `ingredients` / `steps`, the FK
  relationships and `ON DELETE CASCADE` that make D-07 act 1 what it is.
- `apps/recipe-app/src/db/seed.ts` — the deterministic seed the spot-checked values come from.
- `apps/recipe-app/drizzle/meta/_journal.json` — the applied-migration count the manifest
  records.
- `docker-compose.yml` — the `postgres:17` dev service, loopback-only port publication, and
  the deliberate absence of an init-script mount.
- `package.json` — the existing `db:*` script conventions the new commands follow.
- `vitest.config.ts` and `tests/` — the existing suite the D-16 staleness check joins.

</canonical_refs>

<code_context>
## Existing Code Insights

Phase 1 delivered a complete, working local environment. Phase 2 adds tooling on top of it;
it does not restructure anything.

### Reusable Assets
- **`scripts/env.ts`** — the pin-and-assert module. `assertLocalDevelopmentTarget` is exactly
  the guard `db:backup` and `db:restore` need under D-06; `assertDevelopmentDatabase` is the
  pre-write environment marker check. Neither needs extending.
- **`scripts/log.ts`** — `safeErrorMessage` is the tested never-leak-a-credential output rule.
  Relevant because backup tooling handles connection strings and role dumps.
- **`scripts/db-reset.ts`** — its `runStep` helper (name the failing step, do not continue)
  is the pattern the multi-step backup and drill scripts should follow.
- **`scripts/verify-migration-state.ts`** — the direct precedent for the whole phase: a
  separate, independently-testable module that re-queries the database rather than trusting
  an exit code, deliberately split out so it is provable in the failing direction as well as
  the passing one. The drill's assertion module should be built the same way.
- **The deterministic seed** — recognisable recipe content already exists, so no fixture data
  needs inventing for spot checks.
- **`execa`, `pg`, `zod`, `vitest`, `tsx`, `dotenv`** are already dependencies.
  `@testcontainers/postgresql` is the one new dependency D-11 introduces.

### Established Patterns
- **Architectural enforcement over remembered caution.** D-16 and D-20 in Phase 1 both chose
  a structural mechanism over a warning or a prompt. D-06, D-19 and D-20 in this phase
  continue that line.
- **Re-query, never trust an exit code.** `verify-migration-state.ts` exists because
  `drizzle-kit migrate` was observed exiting zero on Windows without applying SQL. The same
  scepticism is the whole premise of BKP-04.
- **Modules that touch the database are split from their entry points** so a test can import
  them without triggering a real destructive run.
- **UNKNOWN is a valid, required answer.** Production's extension list, production's backup
  configuration, and production RTO all stay UNKNOWN in this phase.
- **Documentation is a deliverable.** The runbook is phase output, not overhead.

### Integration Points
- New root `package.json` scripts: `db:backup`, `db:restore`, `db:drill`.
- The status file from D-17 is read by the new staleness test in `tests/`, and later by
  Phase 7's status view (PROD-04 / the owner status summary).
- The manifest from D-05 is written by `db:backup` and read by the drill's assertions.
- `docs/20-restore-runbook.md` is new; `docs/00-current-state.md` §6 and §8 should be updated
  once the drill has actually been performed (R1 moves from CONFIRMED-untested to
  drilled-and-timed; the §6 backup UNKNOWNs about *production* stay UNKNOWN).
- `docs/decisions.md` — D7's consequence clause is discharged by this phase; a status update
  there is appropriate once the human drill has happened.

</code_context>

<specifics>
## Specific Ideas

- **The globals dump must actually be restored, not just produced.** D-07 act 2 exists for
  exactly this reason. A runbook containing a step nobody has ever executed is the failure
  mode this phase is built against.
- **`DROP TABLE recipes CASCADE` is chosen because it is the case that fools a naive check.**
  The rows come back; the foreign keys do not. Orphan-row checks still pass. Only the tier-3
  schema comparison notices. This should be visible in both the runbook and the test suite.
- **Timings must be labelled as fixture-scale.** A single instant-looking number risks being
  read later as "restores take 40 seconds", which is precisely the unearned confidence this
  project exists to prevent. Production RTO stays UNKNOWN.
- **The two dump-related images are different on purpose.** `postgres:17` (glibc) for any
  server — dev container and drill container both. `postgres:17-alpine` for the client
  tooling that runs `pg_dump`/`pg_restore`. Collapsing them reintroduces the collation
  divergence D-12 rejected.
- **The owner's instinct about object storage is correct and is recorded, not dismissed.**
  Dump → file → ship to Hetzner Storage Box / MinIO / S3 is the real pattern. It cannot be
  exercised honestly in a phase with no remote anything (D2, D3), so the phase builds the
  local half in a shape that accepts it later.
- **Nothing in this phase may spend the reserved churn material.** `01-CONTEXT.md` D-11
  reserves specific schema changes for Phases 4 and 7. The drill destroys and restores data;
  it does not add or alter schema.

</specifics>

<deferred>
## Deferred Ideas

- **Off-server backup storage (Hetzner Storage Box / MinIO / S3).** Raised by the owner and
  correct as the eventual shape. Deferred because Phase 2 backs up the local development
  database only (D2, D3), and `.planning/research/ARCHITECTURE.md` places backup *storage* as
  infrastructure-adjacent (Coolify/Hetzner cron + object storage) rather than automation-
  package work. D-03/D-04 shape the local destination so adding this is an extra step, not a
  rewrite. Revisit at Phase 6/7, when a remote environment exists to store from.
- **Scheduled / cron restore drills with dated reporting.** `.planning/research/FEATURES.md`
  lists these; the roadmap does not require them in Phase 2. The D-17 status record and the
  D-19 staleness check are the groundwork. Revisit alongside Phase 7's status view.
- **Assertion tier 5 — application boot against the restored database.** Rejected for this
  phase by D-14 because of the D-16 target pin versus Testcontainers' dynamic port. It is the
  strongest available signal, and Phase 1's D-08 smoke test was deliberately built to be
  reusable, so this is worth revisiting once a second connection path exists for some other
  reason.
- **Backing up staging or production.** Phase 6 and beyond. Nothing in this phase touches a
  database it did not create locally.
- **Restoring an aged stored artifact rather than a freshly-taken one.** D-15 records this as
  the honest limit of the hermetic drill. It becomes meaningful once backups are actually
  stored somewhere over time — i.e. alongside the off-server storage item above.
- **Committed `pg_dump --schema-only` production snapshots (D3's visibility mechanism).**
  Phase 7. The tier-3 schema comparison built here is related machinery but a different
  purpose, and reuse should be considered rather than assumed.

</deferred>

---

*Phase: 2-Backup & Restore Drill*
*Context gathered: 2026-09-07*
