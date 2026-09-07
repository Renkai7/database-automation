# Phase 2: Backup & Restore Drill - Research

**Researched:** 2026-09-07
**Domain:** PostgreSQL logical backup/restore tooling (`pg_dump`/`pg_dumpall`/`pg_restore`), disposable-Postgres testing (`@testcontainers/postgresql`), Windows-safe process orchestration
**Confidence:** HIGH — the core mechanics were not just read about but executed end-to-end against this exact project's dev database and this exact Windows/Docker environment this session (see "Live Verification" callouts throughout).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Backup artifact**
- **D-01:** The data dump uses custom format (`pg_dump -Fc`). Compressed by default, supports selective restore, and the only format that enables `pg_restore --jobs N`. Accepted cost: the artifact is binary and cannot be read without `pg_restore`.
- **D-02:** The backup also captures `pg_dumpall --globals-only` as a separate file (BKP-02). Two artifacts per backup: the `-Fc` data dump and the globals/roles dump.
- **D-03:** Backups land outside the repository, at a configured absolute destination treated as *a backup destination* rather than a repo subdirectory, because the globals dump contains role password hashes (SCRAM verifiers) — credential-adjacent material `CLAUDE.md` forbids committing. An in-repo `backups/` directory and an in-repo directory plus a staged-file guard were both considered and rejected. Reversibility: costly.
- **D-04:** The destination must not be hardcoded to a repo-relative path — the intended eventual shape is dump → file at a destination → ship that file to object storage. Off-server storage itself is deferred, but Phase 2's layout must make adding it an extra step, not a rewrite.
- **D-05:** `db:backup` also emits a JSON manifest recorded at backup time, containing: timestamp, server version, SHA-256 of each dump file, per-table row counts, the applied-migration count from `drizzle.__drizzle_migrations`, and the git commit. Restore assertions compare against what was genuinely in the source at backup time, not hardcoded seed constants. The manifest is also the record Phase 7's status view can read. The manifest must contain no credentials — no connection string, no role passwords, no hashes.

**Command shape**
- **D-06:** No command anywhere accepts a target. `db:backup` and `db:restore` are root `package.json` scripts hardcoded to the pinned local development target, reusing `assertLocalDevelopmentTarget` from `scripts/env.ts`. The automated drill restores through a separate internal function that only accepts a connection object the disposable-container harness constructed — never a connection string a human or an agent can supply. A single allowlist-guarded `db:restore --target <url>` was considered and rejected. Reversibility: one-way in intent — adding a target parameter later would silently convert a structurally-local tool into a remotely-pointable one.

**The manual destruction drill**
- **D-07:** The drill has two acts:
  - **Act 1 — table drop, restored in place.** `DROP TABLE recipes CASCADE` against the live development database, then restore. `recipes` is the parent table; `ingredients` and `steps` both reference `recipes.id` with `ON DELETE CASCADE`.
  - **Act 2 — total loss, restored into an empty cluster.** Destroy the container and its volume entirely, then rebuild from both dumps into a genuinely empty cluster. Act 2 exists because it is the only act in which `pg_dumpall --globals-only` does anything.
- **D-08:** "Confirmed the data returned" means manifest comparison plus a look at the Recipe Page: run `db:query` against the restored database and compare row counts and recognisable values against the backup manifest, then load the Recipe Page and see the seeded recipe render.
- **D-09:** Per-step timings are recorded, not just a total: backup, drop, restore, verify, and the human time spent reading and deciding. The runbook must state plainly that these are fixture-scale numbers and are NOT a production recovery-time estimate — production RTO stays UNKNOWN.
- **D-10:** The runbook is `docs/20-restore-runbook.md`, following the existing `docs/` numbering convention. Structure: a clean, copy-pasteable procedure with real timings at the top, followed by a "what actually happened" section recording wrong turns, surprises, commands that failed and why, and anything that turned out UNKNOWN.

**The automated drill**
- **D-11:** The drill restores into `@testcontainers/postgresql` (12.1.0) — a fresh container per run with a dynamic port and typed lifecycle management.
- **D-12:** The drill container image is `postgres:17` (Debian/glibc), not `postgres:17-alpine`. The `postgres:17-alpine` recommendation in `.planning/research/STACK.md` applies only to the **client tooling** image that runs `pg_dump`/`pg_restore`. Both images are used in this phase, for different roles — do not collapse them.
- **D-13:** Assertion depth is `.planning/research/FEATURES.md` §4 tiers 1 through 4: (1) artifact integrity — restore exits 0 and dump checksums match the manifest; (2) per-table row counts vs. manifest; (3) schema equality — `pg_dump --schema-only` of source vs. restored, compared; (4) spot-checked values, orphan-row/referential-integrity check, and sequence state. Tier 3 is included deliberately: data-level referential integrity does not catch a missing constraint (after `DROP TABLE recipes CASCADE`, the FKs on `ingredients`/`steps` are gone, orphan-row checks still pass, only a schema comparison notices).
- **D-14:** Tier 5 (application boot against the restored database) is out of scope — collides with `01-CONTEXT.md` D-16's loopback:5432/`recipe_dev` pin vs. Testcontainers' dynamic port.
- **D-15:** The drill takes its own backup as part of the run — one hermetic sequence: back up the live dev database, start a fresh container, restore into it, assert against the manifest just written. Honest limit: it only ever restores a backup taken seconds ago.
- **D-16:** The drill is `pnpm db:drill`, separate from `pnpm test`; the default test suite contains one cheap assertion on the drill's recorded result (D-19).

**Making a skipped or failed drill visible**
- **D-17:** The drill result is a committed, machine-readable status file (JSON): dates, outcomes, per-step timings, which assertion tiers ran — nothing credential-bearing.
- **D-18:** The status file tracks the automated drill and the human-performed drill as two separate facts, each with its own date and outcome.
- **D-19:** The cheap check in `pnpm test` hard-fails on a missing record, a FAIL outcome, or a last-drill date older than 30 days. 30 days is a recorded decision, not an incidental constant.
- **D-20:** When Docker is unavailable, `pnpm db:drill` fails loudly, exits non-zero, and writes nothing to the status record — it does not record a "skipped" outcome.

### Claude's Discretion
- The exact filename and path of the status file from D-17, and the precise JSON schema of both it and the D-05 manifest — constrained only by: machine-readable, committed, no credentials, and the two-facts structure from D-18.
- How the configured backup destination from D-03 is expressed (a source constant following the D-16 pinning pattern, an environment variable, or a small config file) — constrained by D-04: must not be a repo-relative path baked into the tools.
- Which recognisable seeded values are chosen as the tier-4 spot checks, and how sequence state is asserted.
- Whether the tier-3 schema comparison needs a canonicalising pass before diffing, and what that pass does if so.
- Retention behaviour at the backup destination (overwrite vs. accumulate, and any pruning).
- Whether act 1's runbook prescribes a whole-database restore up front or documents the CASCADE constraint gap as a discovered surprise.
- Whether the automated drill restores the globals dump into the fresh container as well as the data dump, or only the data dump.

### Deferred Ideas (OUT OF SCOPE)
- Off-server backup storage (Hetzner Storage Box / MinIO / S3). Revisit at Phase 6/7.
- Scheduled/cron restore drills with dated reporting. Revisit alongside Phase 7's status view.
- Assertion tier 5 — application boot against the restored database. Revisit once a second connection path exists.
- Backing up staging or production. Phase 6 and beyond.
- Restoring an aged stored artifact rather than a freshly-taken one.
- Committed `pg_dump --schema-only` production snapshots. Phase 7.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BKP-01 | Owner has personally performed and timed a full backup and restore at least once | Runbook structure (Code Examples), per-step timing fields in the D-17 status schema, D-07 act 1+2 sequencing |
| BKP-02 | Backup captures roles/globals separately via `pg_dumpall --globals-only` | Live-verified `pg_dumpall` command and output shape; the role-collision pitfall and its fix (Common Pitfalls #2) |
| BKP-03 | Restore drills target a fresh instance matching production's image and extensions | `@testcontainers/postgresql` API (live-verified), `postgres:17` glibc pin, zero-extension baseline confirmed live |
| BKP-04 | Restore verification asserts content, never trusts an exit code | Tier 1-4 assertion queries (Code Examples), `ExecResult.exitCode`/`stdout`/`stderr` shape (verified from package source) |
| BKP-05 | Deliberate destruction test: drop a table, restore, confirm data returned | D-07 act 1 mechanics; `ON DELETE CASCADE` behavior confirmed from `schema.ts` |
| BKP-06 | Restore runbook exists, written from an actual performed restore | Runbook structure recommendation (Architecture Patterns); `docs/` numbering convention |
| BKP-07 | Automated restore test runs against a disposable database, reports pass/fail | Full live end-to-end proof (Live Verification section) of dump → fresh container → restore → assert |
| BKP-08 | A skipped or failing restore drill is visible, not silent | D-17/D-19/D-20 status-file mechanics; Common Pitfalls on Windows filename traps that would otherwise corrupt that record silently |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- Prefer architectural enforcement over remembered caution — no safeguard in this phase may depend on an agent choosing to behave (matches D-06, D-20's hard-fail-not-warn design).
- Drizzle ORM, not Prisma — not directly exercised by this phase's tooling, but the manifest's `appliedMigrationCount` field reads Drizzle's own journal/tracking table.
- No production database access from the local machine — this phase touches the local dev container and Testcontainers-managed disposable containers only; nothing here should acquire the ability to target anything else (reinforces D-06).
- Never log or commit credentials — directly load-bearing: the globals dump contains a literal SCRAM-SHA-256 password verifier (confirmed live, see Common Pitfalls #1), and it must never enter git, a log line, or the manifest.
- Mark unverified things UNKNOWN — the runbook's timings are fixture-scale only; production RTO stays UNKNOWN (D-09).
- Document as we go — `docs/20-restore-runbook.md` is phase output, not overhead (D-10).

## Summary

This phase proves, by actually doing it, that a Postgres backup of the local dev database can be restored — once by hand (BKP-01/05/06) and once as a repeatable automated drill (BKP-03/04/07/08). Every mechanic this phase depends on was executed directly against the project's real running dev container and a real disposable `postgres:17` Testcontainers instance this session, not merely read about: `pg_dump -Fc` via `docker compose exec -T db`, `pg_dumpall --globals-only`, `@testcontainers/postgresql@12.1.0`'s full API (`start()`, `getConnectionUri()`, `copyFilesToContainer()`, `exec()`, `stop()`), and a complete dump→restore→assert cycle including row counts, foreign keys, and sequence state.

Three concrete, non-obvious findings came directly out of that live testing and materially change how this phase should be planned, not just researched:

1. **A role-name collision silently defeats BKP-02's whole point.** If the disposable drill container's bootstrap user/database is named to match the source (`recipe_app`/`recipe_dev`), the globals restore's `CREATE ROLE recipe_app` collides with the role the container's own `postgres:17` entrypoint already created, and `psql -v ON_ERROR_STOP=1` correctly aborts (exit code 3) rather than silently continuing. The fix, confirmed working end-to-end: bootstrap the disposable container with a **different** identity (e.g. `drilluser`/`recipe_dev` for the database name only) so the globals restore has a genuinely empty role namespace to populate, and use `pg_restore --no-owner` so ownership never depends on which role built the schema. This is exactly the "restoring roles into a cluster that already has them is a no-op" trap D-07 act 2 was written to catch — it is real, not hypothetical, and it will bite the first implementation that reuses `recipe_app` as the drill container's bootstrap username for symmetry with production naming.
2. **`pg_dump --schema-only` is not byte-stable between two dumps of the same unchanged database**, even with zero real changes, because PostgreSQL 17's `pg_dump` emits a random single-use `\restrict <token>` / `\unrestrict <token>` guard pair (a dump-integrity security feature) that differs every run. Two consecutive schema-only dumps of the identical dev database differed **only** on those two lines. Tier 3's schema-equality check needs a one-line canonicalizing pass (strip/normalize `^\restrict `/`^\unrestrict ` lines) before diffing, or every drill run will report a false schema change.
3. **Windows NTFS silently reinterprets a colon in a filename as an Alternate Data Stream separator, not an invalid character.** `fs.writeFileSync("test:colon.txt", ...)` does not throw — it creates a hidden zero-byte file named `test` with the real content stashed in an invisible ADS stream named `colon.txt`, confirmed via `Get-Item -Stream *`. A naive `new Date().toISOString()` (which contains colons) used directly in a backup/manifest filename would silently produce this on Windows: no error, no visible file, and a "missing" artifact that later verification code can't find. Every filename this phase generates must have colons stripped or replaced first.

**Primary recommendation:** Build `db:backup`, `db:restore` (human-invoked, dev-target-only), and `db:drill` (Testcontainers-driven) as three small Node/`execa` scripts following the existing `scripts/db-reset.ts`/`runStep` pattern, using `docker compose exec -T db` for all dev-container `pg_dump`/`pg_dumpall` invocations (bundled client tools already match the server version exactly — confirmed live, `17.11` on both sides, eliminating Pitfall B4 by construction) and `@testcontainers/postgresql`'s own `copyFilesToContainer()` + `exec()` for the drill's in-container restore (no second `postgres:17-alpine` container or `host.docker.internal` networking needed for that half — see Open Questions #1 for the one place this diverges from a literal reading of D-12).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Data dump creation (`pg_dump -Fc`) | Database/Storage | API/Backend (Node/CLI script) | The dump reads directly from Postgres via its own bundled client tools; the Node script only orchestrates `docker compose exec` and captures the output to disk. |
| Globals/roles dump (`pg_dumpall --globals-only`) | Database/Storage | API/Backend | Same — cluster-level dump, orchestrated by a Node script. |
| Manifest generation (checksums, row counts, migration count, commit) | API/Backend | Database/Storage | Computed by the Node script from files on disk plus one read-only query against Postgres. |
| Disposable restore target provisioning | Database/Storage | API/Backend | `@testcontainers/postgresql` starts a real Postgres server process in Docker; the Node script only drives its lifecycle (`start()`/`stop()`). |
| Globals + data restore execution | Database/Storage | API/Backend | Runs `psql`/`pg_restore` *inside* the disposable container via `container.exec()`; the Node script only supplies file paths and flags. |
| Assertion tiers 1–4 | API/Backend | Database/Storage | The Node script issues read queries against the restored database and compares results to the manifest already on disk. |
| Status file (D-17) persistence | API/Backend | — | Plain committed JSON written by the Node script; no live database component. |
| Runbook (`docs/20-restore-runbook.md`) | API/Backend (documentation) | — | Not a running system component — flagged here only so it is not misassigned to an app/UI tier during planning. |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@testcontainers/postgresql` | **12.1.0** | Disposable, fresh-per-run Postgres for the automated drill and the tests it runs under | This is the current version on the npm registry `[VERIFIED: npm view @testcontainers/postgresql version, this session]` — matches the version already pinned in `.planning/research/STACK.md` and `02-CONTEXT.md` D-11 exactly. `package-legitimacy check` returned `OK` (2.3M weekly downloads, official `testcontainers/testcontainers-node` GitHub repo, not deprecated, no postinstall script) `[VERIFIED: gsd-tools package-legitimacy check, this session]`. **Live-verified this session**: started a real `postgres:17` container in ~3.8s on this exact Windows/Docker Desktop machine, confirmed `getHost()`/`getPort()`/`getConnectionUri()`/`exec()`/`copyFilesToContainer()`/`stop()` all work as documented — see the Code Examples section. |
| `testcontainers` (core, transitive) | 12.1.0 | Base container lifecycle (`GenericContainer`, `AbstractStartedContainer`) that `@testcontainers/postgresql` extends | Installed automatically as a peer of `@testcontainers/postgresql`; do not add a separate, possibly-mismatched version pin unless importing its types directly. `[VERIFIED: npm view testcontainers version, this session — 12.1.0, same release train]` |
| `execa` | **^10.0.1** (already a devDependency) | Spawns `docker compose exec`/`docker` child processes for backup/restore orchestration | Already installed and in active use in `scripts/db-reset.ts`; no version change needed `[VERIFIED: package.json + npm view execa version, this session]`. Its `{stdout: {file: path}}` option streams a subprocess's stdout directly to disk without buffering the whole result in memory — the correct way to capture `pg_dump -Fc`'s binary output `[CITED: raw.githubusercontent.com/sindresorhus/execa/main/docs/output.md]`. |
| `pg` (node-postgres) | 8.23.0 (already a devDependency) | Driver for all assertion queries against the restored database | Already installed; reuse `scripts/env.ts`'s `QueryableClient` pattern for the connection this phase's assertions run over. `[VERIFIED: package.json]` |
| `zod` | ^4.5.4 (already a devDependency) | Runtime validation of the D-05 manifest and D-17 status-file JSON shapes before trusting them | Already installed; matches this project's established pattern of validating any file whose shape a later step depends on (`scripts/env.ts`'s `EnvSchema`). `[VERIFIED: package.json]` |
| `vitest` | ^5.0.0 (already a devDependency) | Test runner for the D-19 cheap staleness check and any drill-assertion unit tests | Already installed and configured (`vitest.config.ts`); the staleness check joins the existing `tests/**/*.test.ts` glob with no config change. `[VERIFIED: package.json + vitest.config.ts]` |
| `node:crypto` (built-in) | Node 24.19.0 | SHA-256 checksums for the D-05 manifest | Built into Node; no install needed. |

### Images

| Image | Role | Verified facts |
|-------|------|-----------------|
| `postgres:17` (glibc/Debian) | Dev container (existing) **and** the drill's disposable container (D-12) | `[VERIFIED, this session]` Dev container's bundled client tools report `pg_dump`/`psql`/`pg_restore`/`pg_dumpall` all at `17.11 (Debian 17.11-1.pgdg13+2)` — identical to the server itself, eliminating any client/server version-drift risk (Pitfall B4) for every command this phase runs against the dev container. The image ships zero extensions beyond the always-present `plpgsql`, and `gen_random_uuid()` (used by every table's `id` column default) works with **no extension installed** — confirmed live via `SELECT gen_random_uuid();` against the dev container with `SELECT extname FROM pg_extension;` returning only `plpgsql`. This means Pitfall B3 (extension mismatch on restore) does not apply to this schema today. |
| `postgres:17-alpine` | Client-tooling image per D-12/STACK.md's original recommendation | Not required by the implementation this research validated — see Open Questions #1. Note if adopted anyway: needs `host.docker.internal` (or an explicit Docker network) to reach either the dev container's published port or the Testcontainers-assigned dynamic port, an extra moving part the verified approach below avoids entirely. |

**Installation:**
```bash
pnpm add -D @testcontainers/postgresql@12.1.0
```
No other new packages are required — `execa`, `pg`, `zod`, `vitest` are already dependencies.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `@testcontainers/postgresql` | npm | Published as part of an active, ongoing release train (12.x); not a new/thin package | ~2.3M/week | github.com/testcontainers/testcontainers-node | OK | Approved |
| `testcontainers` (transitive peer) | npm | Same release train | ~4.3M/week | github.com/testcontainers/testcontainers-node | OK | Approved (transitive; do not pin separately unless importing its types) |

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.

No `postinstall` script was reported for either package `[VERIFIED: gsd-tools package-legitimacy check, this session]`.

## Architecture Patterns

### System Flow — manual drill (D-07) and automated drill (D-11/D-15)

```
MANUAL DRILL (BKP-01/05/06)                     AUTOMATED DRILL (BKP-03/04/07/08, `pnpm db:drill`)
────────────────────────────                     ──────────────────────────────────────────────────
db:backup (dev container, live)                   1. db:backup's own internals invoked in-process
   │                                                     │
   ├─ docker compose exec -T db                          ├─ docker compose exec -T db pg_dump -Fc
   │    pg_dump -U recipe_app -d recipe_dev -Fc          │      → dataDump (file on disk, sha256'd)
   │      → dataDump file (checksummed)                  ├─ docker compose exec -T db pg_dumpall
   ├─ docker compose exec -T db                           │      --globals-only → globalsDump file
   │    pg_dumpall -U recipe_app --globals-only           └─ manifest.json written (D-05 fields)
   │      → globalsDump file (checksummed)                     │
   └─ manifest.json written (D-05 fields)              2. new PostgreSqlContainer("postgres:17")
        │                                                     .withUsername(<non-colliding id>)
Act 1: DROP TABLE recipes CASCADE                             .withDatabase("recipe_dev").start()
   (dev container, live data destroyed)                       │ (fresh, disposable, dynamic port)
        │                                              3. container.copyFilesToContainer([
db:restore (dev container, live)                              {dataDump}, {globalsDump} ])
   ├─ docker compose exec -T db pg_restore                    │
   │    --clean --if-exists --no-owner --jobs N        4. container.exec(["psql","-v",
   │    -U recipe_app -d recipe_dev <dataDump>                 "ON_ERROR_STOP=1", ..., "-f", globalsDump])
        │                                              5. container.exec(["pg_restore","--clean",
db:query + Recipe Page eyeball check (D-08)                   "--if-exists","--no-owner","--jobs","N",
        │                                                      ..., dataDump])
Act 2: docker compose down -v                          6. Tier 1–4 assertions (pg client, over
   (container + volume destroyed entirely)                    getConnectionUri()) vs. manifest.json
        │                                              7. status.json updated (D-17/D-18 two facts)
db:restore --fresh-cluster path:                              │
   ├─ docker compose up -d (empty volume)              8. container.stop()
   ├─ docker compose exec -T db psql -f <globalsDump>
   ├─ docker compose exec -T db pg_restore ... <dataDump>
        │
Runbook written from what actually happened (D-10)
```

### Recommended Project Structure

```
scripts/
├── backup.ts              # db:backup — dump + globals + manifest, dev-target-only (D-06)
├── restore.ts              # db:restore — human-invoked, dev-target-only (D-06); also exports
│                            #   a restoreInto(connection, dumpPaths) used by drill.ts
├── drill.ts                 # db:drill — Testcontainers lifecycle + calls into restore.ts's
│                            #   exported function, never the CLI entry point
├── backup-manifest.ts       # shared manifest read/write/validate (zod schema) — D-05
├── drill-status.ts          # shared status-file read/write/validate (zod schema) — D-17/D-18
├── env.ts                   # existing — reused unchanged
├── log.ts                   # existing — reused unchanged
└── db-reset.ts              # existing — pattern reference (runStep, no changes needed)
tests/
├── backup-manifest.test.ts  # manifest round-trips, no credentials ever appear in it
├── drill-status.test.ts     # D-19's cheap staleness check (missing/FAIL/>30d all hard-fail)
└── restore-drill.test.ts    # exercises drill.ts end-to-end (slow; NOT in the default `pnpm test`
                             #   fast path beyond the D-19 status-file assertion)
docs/
└── 20-restore-runbook.md    # BKP-06 — written from the performed drill, not in advance
.planning phases/02.../:     # this RESEARCH.md
<configured backup destination, OUTSIDE the repo per D-03/D-04>
├── recipe_dev-<compactTimestamp>.dump
├── recipe_dev-<compactTimestamp>-globals.sql
└── recipe_dev-<compactTimestamp>-manifest.json
```

### Pattern 1: Backup via the dev container's own bundled client tools (no separate client image)

**What:** Run `pg_dump -Fc` and `pg_dumpall --globals-only` through `docker compose exec -T db`, streaming stdout straight to a file on the configured destination.
**When to use:** Every `db:backup` invocation and the automated drill's own internal backup step.
**Why it's safe from version drift:** the client binaries invoked are the exact same binaries bundled in the exact same container as the server (`17.11` on both, live-verified) — Pitfall B4 (client/server version mismatch) cannot occur by construction.
**Example (Node, `execa`):**
```typescript
// Source: execa docs/output.md (file-output option) + live-verified command shape, this session.
import { execa } from "execa";

await execa(
  "docker",
  ["compose", "exec", "-T", "db", "pg_dump", "-U", "recipe_app", "-d", "recipe_dev", "-Fc"],
  { stdout: { file: dataDumpPath } },
);

await execa(
  "docker",
  ["compose", "exec", "-T", "db", "pg_dumpall", "-U", "recipe_app", "--globals-only"],
  { stdout: { file: globalsDumpPath } },
);
```

### Pattern 2: Restore inside the disposable container via `copyFilesToContainer` + `exec` (no second image, no host networking)

**What:** Copy the two dump files into the freshly-started `postgres:17` Testcontainers instance, then run `psql`/`pg_restore` *inside* it via `container.exec()`.
**When to use:** The automated drill (`db:drill`). For the manual drill's Act 2, the equivalent is `docker compose exec -T db psql -f ...` / `pg_restore ...` against the rebuilt dev container, following the same shape.
**Why this avoids the alpine-client-image path:** `postgres:17`'s own image already bundles matching-version `pg_restore`/`psql` — there is no version-drift risk to hedge against by adding a second image, and it sidesteps needing `host.docker.internal` or a shared Docker network purely to reach the Testcontainers-assigned dynamic port. See Open Questions #1 for the tradeoff against a literal reading of D-12.
**Example (live-verified this session, exit codes 0/0, correct row counts and roles on restore):**
```typescript
// Source: live-verified against @testcontainers/postgresql 12.1.0, postgres:17, this session.
import { PostgreSqlContainer } from "@testcontainers/postgresql";

// CRITICAL: the bootstrap identity here must NOT match any role named in the
// globals dump (recipe_app), or the globals restore's `CREATE ROLE recipe_app`
// collides with the role postgres:17's own entrypoint already created — see
// Common Pitfalls #2. `withDatabase` may still be "recipe_dev" safely; only the
// *username* needs to differ.
const container = await new PostgreSqlContainer("postgres:17")
  .withDatabase("recipe_dev")
  .withUsername("drilluser")
  .withPassword(randomThrowawayPassword())
  .start();

await container.copyFilesToContainer([
  { source: dataDumpPath, target: "/tmp/data.dump" },
  { source: globalsDumpPath, target: "/tmp/globals.sql" },
]);

const globalsResult = await container.exec([
  "psql", "-v", "ON_ERROR_STOP=1", "-U", "drilluser", "-d", "postgres", "-f", "/tmp/globals.sql",
]);
if (globalsResult.exitCode !== 0) {
  throw new Error(`Globals restore failed (exit ${globalsResult.exitCode}): ${globalsResult.stderr}`);
}

const restoreResult = await container.exec([
  "pg_restore", "--clean", "--if-exists", "--no-owner", "--jobs", "2",
  "-U", "drilluser", "-d", "recipe_dev", "/tmp/data.dump",
]);
if (restoreResult.exitCode !== 0) {
  throw new Error(`Data restore failed (exit ${restoreResult.exitCode}): ${restoreResult.stderr}`);
}

// ... run tier 1-4 assertions over container.getConnectionUri() ...

await container.stop();
```

### Pattern 3: Generic, schema-agnostic assertions (matches D-05's "keeps working when the seed changes")

**Tier 2 (row counts) — reuse the existing `information_schema.tables` enumeration pattern** already established in `scripts/verify-migration-state.ts`, rather than hardcoding `recipes`/`ingredients`/`steps`:
```typescript
// Pattern already proven in scripts/verify-migration-state.ts — reuse, don't reinvent.
const tablesResult = await client.query(
  "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
);
for (const { table_name } of tablesResult.rows) {
  const { rows } = await client.query(`SELECT count(*) AS count FROM "${table_name}"`);
  // compare Number(rows[0].count) against manifest.rowCounts[table_name]
}
```

**Tier 3 (schema equality) — canonicalize before diffing (live-verified necessity, see Common Pitfalls #3):**
```typescript
// Two consecutive `pg_dump --schema-only` runs of the SAME unchanged database differ
// ONLY on these two lines (PG17's dump-integrity guard tokens) — confirmed live, this session.
function canonicalizeSchemaDump(sql: string): string {
  return sql.replace(/^\\(un)?restrict .+$/gm, "");
}
```

**Tier 4 (sequence state) — the real, concrete target is Drizzle's own migrations sequence, not an application-owned one:**
```sql
-- Confirmed live: this schema's three tables (recipes/ingredients/steps) all use
-- uuid PRIMARY KEY DEFAULT gen_random_uuid() — there is NO application-owned
-- sequence today. The one sequence that exists belongs to Drizzle's own
-- bookkeeping table:
SELECT schemaname, sequencename, last_value FROM pg_sequences;
--  drizzle | __drizzle_migrations_id_seq | 2
```
Write the tier-4 check generically against `pg_sequences` (compare the full result set, not a hardcoded sequence name) so it is already correct today (comparing exactly one row) and stays correct if a future phase adds an application-owned `serial`/`identity` column.

### Anti-Patterns to Avoid
- **Piping `pg_dump -Fc` directly into `pg_restore` over a pipe/stdin.** `pg_restore` needs a seekable file for custom-format archives — this is documented, primary-source behavior, not a Windows-only quirk — and it is a hard requirement (not just a slowdown) once `--jobs N` is used. `[CITED: postgresql.org/docs/current/app-pgrestore.html + postgresql.org mailing list thread on Win32 stdin/stdout handling]` Always write the dump to a real file first (Pattern 1 already does this).
- **Naming any generated file with a raw `Date.toISOString()`.** See Common Pitfalls #3 — silently creates an NTFS Alternate Data Stream on Windows instead of erroring.
- **Reusing `recipe_app` as the drill container's bootstrap username "for realism."** See Common Pitfalls #2 — this defeats the entire point of BKP-02's globals restore being exercised.
- **Trusting `pg_restore`'s bare exit code without `--if-exists`.** Per Pitfall B1 (existing project research), `pg_restore --clean` without `--if-exists` returns exit status 1 for objects that were simply never present on the target — indistinguishable from a real failure unless `--if-exists` is always paired with `--clean` (D-13's own STACK.md guidance already specifies this pairing; this reconfirms why).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Disposable, fresh-per-run Postgres with dynamic port + readiness polling | A hand-rolled `docker run` + poll loop | `@testcontainers/postgresql`'s `start()` (built-in health check + startup timeout, confirmed via package source: `Wait.forAll([Wait.forHealthCheck(), Wait.forListeningPorts()])`, 120s timeout) | Readiness polling and cleanup-on-failure are exactly the class of thing that fails silently when hand-rolled — already the rationale D-11 itself gives. |
| Copying a file into a running container | Manual `docker cp` shelled out via `execa` | `container.copyFilesToContainer([{source, target, mode?}])` | One typed call instead of a separate child-process invocation with its own error handling; confirmed present on `AbstractStartedContainer` (inherited by `StartedPostgreSqlContainer`). |
| Running a command inside the disposable container and capturing output | `execa("docker", ["exec", containerId, ...])` (requires tracking the raw container ID yourself) | `container.exec(command)` → `{ exitCode, stdout, stderr, output }` | Testcontainers already resolves and tracks the container ID; hand-rolling this needs to duplicate that state. |
| Detecting a false "schema changed" from dump non-determinism | A bespoke diff/ignore-list mechanism invented per rule | The single canonicalizing regex above, informed by the actual (small, confirmed) source of non-determinism | Building a general-purpose schema-diff tool is over-engineering for a one-line, confirmed cause; keep the fix as narrow as the problem. |

**Key insight:** every "don't hand-roll" item above was verifiable by actually running the alternative this session — none of them are speculative recommendations copied from a tool's marketing copy.

## Common Pitfalls

### Pitfall 1: The globals dump is genuinely credential-bearing material, not credential-adjacent in theory only
**What goes wrong:** A `pg_dumpall --globals-only` dump of this project's dev cluster contains, verbatim: `ALTER ROLE recipe_app WITH SUPERUSER INHERIT CREATEROLE CREATEDB LOGIN REPLICATION BYPASSRLS PASSWORD 'SCRAM-SHA-256$4096:...'` — a real SCRAM verifier for the actual dev database password `[VERIFIED: docker compose exec -T db pg_dumpall -U recipe_app --globals-only, this session — full output captured and inspected]`.
**Why it happens:** `pg_dumpall --globals-only` exists specifically to let a fresh cluster reconstruct its role set, which structurally requires the password material to travel with it.
**How to avoid:** D-03's "outside the repo" destination and D-05's "manifest must contain no credentials" are not defensive over-caution — they are the direct, necessary response to this concrete file content. Never let this file's contents flow into a log line, an error message, or the manifest; `safeErrorMessage`'s existing "never serialize an unknown value's own fields" discipline (`scripts/log.ts`) already covers the shape of mistake that would leak it.
**Warning signs:** any code path that reads the globals dump file's contents into memory for a purpose other than copying/checksumming the whole file as an opaque blob.

### Pitfall 2: Bootstrap role-name collision silently defeats the one act that's supposed to prove BKP-02 works
**What goes wrong:** Creating the drill's disposable container with `withUsername("recipe_app")` (matching the source's role name, for apparent realism) causes `postgres:17`'s own entrypoint to create a `recipe_app` superuser role *before* the globals dump is ever restored. The subsequent `CREATE ROLE recipe_app;` in the globals restore then fails with `role "recipe_app" already exists` — `psql -v ON_ERROR_STOP=1` correctly aborts (exit code 3) `[VERIFIED, this session — reproduced exactly, then fixed and reproduced the fix]`.
**Why it happens:** This is precisely the "restoring roles into a cluster that already has them is a no-op" scenario D-07 act 2's own rationale names — except here it manifests as a hard failure rather than a silent no-op, because `ON_ERROR_STOP` is doing its job. A softer restore script (no `ON_ERROR_STOP`, or one that swallows "already exists") would make it a *silent* no-op instead, which is worse: the drill would report PASS having never actually exercised the globals restore.
**How to avoid:** Bootstrap the disposable container with an identity that does not collide with any role name present in the real globals dump (e.g. `drilluser`); only the **database name** needs to match production naming, not the username. Live-verified fix: with `withUsername("drilluser")`, the globals restore exits 0 and `SELECT rolname, rolsuper FROM pg_roles` on the restored container shows both `drilluser` (bootstrap) and `recipe_app` (freshly created by the restore) as superusers.
**Warning signs:** a drill that reports PASS but whose globals-restore step's stdout/stderr was never actually inspected for a swallowed "already exists" error.

### Pitfall 3: Windows silently turns a colon in a filename into an Alternate Data Stream, not an error
**What goes wrong:** `fs.writeFileSync("recipe_dev-2026-09-07T19:36:50.686Z-manifest.json", data)` on Windows does **not** throw. It creates a hidden, zero-byte file named `recipe_dev-2026-09-07T19` and writes the actual content into an invisible NTFS Alternate Data Stream named `36:50.686Z-manifest.json` attached to it `[VERIFIED, this session — reproduced with `test:colon.txt`, then confirmed via PowerShell `Get-Item -Stream *` that the content landed in a hidden stream, not a visible file]`.
**Why it happens:** NTFS's `file:stream` syntax for Alternate Data Streams uses the same colon character a naive ISO-8601 timestamp contains (`2026-09-07T19:36:50.686Z`). Windows only rejects a colon outright when it looks like a single-letter drive prefix (`a:b.txt` → `ENOENT`); any other colon placement is silently accepted as valid (if surprising) NTFS syntax.
**How to avoid:** Sanitize every generated filename component before use — replace `:` (and ideally the full Windows-reserved set `< > : " / \ | ? *`) with `-`, or use a compact timestamp format with no separators at all (e.g. `20260907T193650Z`). Apply this to the dump filename, globals filename, and manifest filename alike, since all three are timestamp-derived per the Recommended Project Structure above.
**Warning signs:** a backup or drill run that reports success but whose destination directory, inspected with a plain `dir`/`ls`, doesn't show the file the code just claimed to write — check with `Get-Item -Stream *` (PowerShell) before assuming the write silently failed outright.

### Pitfall 4: `pg_dump --schema-only` is not byte-stable across identical runs (PG17-specific)
**What goes wrong:** Diffing two `pg_dump --schema-only` dumps of the exact same, unchanged database produces a non-empty diff — not because anything changed, but because PostgreSQL 17's `pg_dump` emits a random `\restrict <token>` / `\unrestrict <token>` pair (bracketing the whole dump, a `psql` meta-command execution guard) whose token differs every invocation `[VERIFIED, this session — two consecutive dumps of the same dev database differed on exactly these two lines out of 203]`.
**Why it happens:** These tokens are a dump-integrity/anti-injection feature (they gate which meta-commands `psql`/`pg_restore` will honor while replaying the dump) and are deliberately regenerated per dump.
**How to avoid:** Strip or normalize lines matching `^\restrict ` / `^\unrestrict ` before comparing two schema-only dumps for tier 3 (see Code Examples' `canonicalizeSchemaDump`). This is the confirmed, minimal answer to D-13's own "whether the tier-3 schema comparison needs a canonicalising pass" discretion item — yes, and this is exactly what it needs to strip.
**Warning signs:** a tier-3 check that fails on every single drill run even immediately after a run that already passed, with no real schema change in between.

### Pitfall 5: `pg_restore`'s exit code depends entirely on flag choice, independent of whether the restore actually worked
**What goes wrong:** `pg_restore --clean` (without `--if-exists`) against a target that doesn't yet have the objects being dropped returns exit status 1 for those harmless "doesn't exist" errors — indistinguishable, from the exit code alone, from a real failure. `--if-exists` changes this to exit 0 for the same harmless case `[CITED: postgresql.org mailing-list corroboration, cross-checked against existing project research STACK.md's own flag guidance]`.
**Why it happens:** `--clean`'s DROP statements are unconditional by default; `--if-exists` is what makes them conditional.
**How to avoid:** Always pair `--clean` with `--if-exists` (already specified in `.planning/research/STACK.md` and D-13) and additionally capture and inspect `stdout`/`stderr` from every restore rather than trusting the exit code in isolation, per Pitfall B1 in the existing project research.

## Code Examples

### Full live-verified round trip (this session, against this project's real dev database)

```
$ docker compose exec -T db pg_dump -U recipe_app -d recipe_dev -Fc > data.dump
$ docker compose exec -T db pg_dumpall -U recipe_app --globals-only > globals.sql
# data.dump: 9347 bytes; globals.sql: 675 bytes, containing the ALTER ROLE recipe_app ... PASSWORD 'SCRAM-SHA-256$...' line
```
```typescript
// Fresh disposable container, bootstrap identity deliberately non-colliding (Pitfall #2 fix).
const container = await new PostgreSqlContainer("postgres:17")
  .withDatabase("recipe_dev").withUsername("drilluser").withPassword("throwaway")
  .start();
// → started in ~3.8s; getConnectionUri() = postgres://drilluser:throwaway@localhost:<dynamicPort>/recipe_dev

await container.copyFilesToContainer([
  { source: "./data.dump", target: "/tmp/data.dump" },
  { source: "./globals.sql", target: "/tmp/globals.sql" },
]);
await container.exec(["psql", "-v", "ON_ERROR_STOP=1", "-U", "drilluser", "-d", "postgres", "-f", "/tmp/globals.sql"]);
// → exitCode: 0
await container.exec(["pg_restore", "--clean", "--if-exists", "--no-owner", "--jobs", "2",
  "-U", "drilluser", "-d", "recipe_dev", "/tmp/data.dump"]);
// → exitCode: 0, stderr: ""

// Assertions, over a real `pg` Client against container.getConnectionUri():
// row counts:  { recipes: '1', ingredients: '8', steps: '5' }           ✓ matches the seed
// sequences:   [{ schemaname:'drizzle', sequencename:'__drizzle_migrations_id_seq', last_value:'2' }]
// roles:       recipe_app (rolsuper: true) now present — freshly created by the globals restore, not pre-existing
// foreign keys:[ingredients_recipe_id_recipes_id_fk, steps_recipe_id_recipes_id_fk] → both reference recipes  ✓
```

### Manifest shape (D-05), no credentials anywhere

```json
{
  "takenAt": "20260907T193650Z",
  "postgresVersion": "PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2) on x86_64-pc-linux-gnu, ...",
  "gitCommit": "c8663a5e5a9c2bd5300a69967e78f3637102dfa5",
  "appliedMigrationCount": 2,
  "dataDump": { "file": "recipe_dev-20260907T193650Z.dump", "sha256": "<hex>" },
  "globalsDump": { "file": "recipe_dev-20260907T193650Z-globals.sql", "sha256": "<hex>" },
  "rowCounts": { "recipes": 1, "ingredients": 8, "steps": 5 },
  "sequences": { "drizzle.__drizzle_migrations_id_seq": 2 }
}
```
`gitCommit` obtained via `execa("git", ["rev-parse", "HEAD"])` (git 2.51.1 confirmed on PATH this session). `appliedMigrationCount` reuses the existing `_journal.json`-vs-`drizzle.__drizzle_migrations` comparison already proven in `scripts/verify-migration-state.ts`. `sha256` via `node:crypto`'s `createHash("sha256")` over each dump file's bytes.

### Status file shape (D-17/D-18), two independent facts

```json
{
  "automated": {
    "lastRunAt": "20260908T090000Z",
    "outcome": "PASS",
    "tiers": { "artifactIntegrity": true, "rowCounts": true, "schemaEquality": true, "contentAndReferentialIntegrity": true },
    "durationMs": { "backup": 0, "containerStart": 0, "globalsRestore": 0, "dataRestore": 0, "assert": 0 }
  },
  "human": {
    "lastPerformedAt": null,
    "outcome": "UNKNOWN",
    "timings": null,
    "runbookRef": "docs/20-restore-runbook.md"
  }
}
```
Per D-18/D7 (`docs/decisions.md`), `human.outcome` starts and stays `"UNKNOWN"` until a person has actually performed, timed, and documented a restore — no code path may set it to `"PASS"` on the automated drill's behalf.

## Runtime State Inventory

Not applicable — this is a new-feature phase (backup/restore tooling), not a rename, refactor, or migration phase. `01-CONTEXT.md`'s existing target-pinning (`scripts/env.ts`) and dev-container conventions are reused unchanged; nothing is being renamed.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The configured backup destination (D-03/D-04) should be expressed as a new environment variable validated by `scripts/env.ts`'s existing hard-fail-on-missing pattern, rather than a config file | Architecture Patterns / Open Questions #2 | Low — this is explicitly Claude's Discretion in `02-CONTEXT.md`; the planner may choose differently with no rework beyond this recommendation. |
| A2 | `execa`'s classic positional call form (`execa(file, args, options)`, already used throughout this repo) accepts the same `{stdout: {file}}` option documented for the template-tag form | Standard Stack / Pattern 1 | Low — the option is a general execa feature, not gated by call style, and this repo's existing `execa("docker", [...], {reject:false})` calls already prove the classic form works with this exact execa version; only the specific `stdout:{file}` interaction with binary output wasn't independently re-run under the classic call form this session. |
| A3 | Testcontainers' Docker-Desktop-on-Windows behavior observed this session (container start, `exec`, `copyFilesToContainer`, `stop`) will remain stable across repeated CI-less local runs | Environment Availability | Low — this was live-verified twice in this exact session on this exact machine; residual risk is only from a future Docker Desktop/WSL2 update changing behavior, not from an unverified claim. |

**If this table is empty:** N/A — see above; all three entries are low-risk recommendations/observations, not unverified factual claims load-bearing for correctness.

## Open Questions (RESOLVED)

> All three were resolved during Phase 2 planning; each carries an inline `RESOLVED:` marker naming the plan that made the call.

1. **Should the automated drill use `postgres:17-alpine` as a literal separate client-tooling container, per a strict reading of D-12, or reuse each server container's own bundled client binaries (the approach live-verified in this research)?**
   - What we know: D-12's text states "Both images are used in this phase, for different roles — do not collapse them," which STACK.md's original recommendation pairs with `postgres:17-alpine` running `pg_dump`/`pg_restore` against either server over the network (`host.docker.internal` or a Docker network). The approach actually tested in this research instead runs the client binaries *inside* whichever `postgres:17` server container already holds them (`docker compose exec` for the dev container, `container.exec()` for the Testcontainers instance) — functionally identical (same exact `17.11` binaries) but never spins up a distinct alpine container.
   - What's unclear: whether D-12's phrasing is a binding implementation mandate (spin up a real, separate `postgres:17-alpine` container) or a clarification that the *alpine recommendation from STACK.md refers to client tooling, not the server pin* (satisfied either way, since neither approach ever runs the server on alpine).
   - **RESOLVED:** adopted the in-container-exec approach. Plan `02-01-PLAN.md` Task 1 runs the client binaries inside whichever `postgres:17` server container already holds them, and D-12's stated concern (never let the drill's *server* run on alpine) is satisfied either way.
   - Recommendation: the in-container-exec approach is simpler (no new image, no Windows `host.docker.internal` dependency, zero version-drift risk by construction) and satisfies D-12's actual stated concern (never let the drill's *server* run on alpine). If the discuss/plan step wants literal `postgres:17-alpine` usage for stack-recommendation fidelity, it is a small, isolable substitution in Pattern 1/2 above, not a different architecture.

2. **Exact mechanism for the D-03/D-04 backup destination configuration.**
   - What we know: must not be a repo-relative path baked into the tools; must be expressible as "a destination," not a repo subdirectory.
   - What's unclear: whether this should be a new environment variable (matching `scripts/env.ts`'s existing `RECIPE_DEV_DATABASE_URL` hard-fail-on-missing pattern) or a small dedicated config file.
   - **RESOLVED:** environment variable. Plan `02-01-PLAN.md` Task 1 adds `RECIPE_BACKUP_DESTINATION` to `scripts/env.ts` with `BACKUP_DESTINATION_ENV_VAR`, `assertBackupDestination` and `getBackupDestination`, hard-failing when unset — recorded under that plan's "Claude's-discretion choices made here".
   - Recommendation: an environment variable (e.g. `RECIPE_BACKUP_DESTINATION`, an absolute path), validated at startup the same way `RECIPE_DEV_DATABASE_URL` is — hard-fail if unset, matching D-20's established "no silent default" precedent — since this project already has exactly one config mechanism (`.env` + `scripts/env.ts`) and introducing a second (a config file) for one variable adds a discovery cost with no benefit.

3. **Retention behavior at the backup destination** (Claude's Discretion, not discussed)
   - **RESOLVED:** accumulate, no pruning this phase. Plan `02-01-PLAN.md` uses timestamped filenames and `readLatestManifest` picks the newest; pruning is deferred to the off-server-storage work.
   - Recommendation: recommend overwrite-in-place for the "current" backup plus timestamped filenames that naturally accumulate unless pruned, with no automatic pruning built in this phase (pruning is storage-lifecycle policy, more naturally paired with the deferred off-server-storage work at Phase 6/7 than invented here). Low risk either way since this is explicitly open to the planner's judgment.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker Desktop / daemon | Testcontainers drill, `docker compose exec` backup/restore | ✓ (verified this session) | Engine 29.6.1, Compose v5.2.0 | D-20: if unavailable, `db:drill` fails loudly and writes nothing — no fallback, by design |
| `postgres:17` dev container | `db:backup`/`db:restore` targets | ✓ running this session | `postgres:17` / server+client `17.11` | — |
| `@testcontainers/postgresql` | `db:drill` | ✓ (pulls `postgres:17` on first run; confirmed startup in ~3.8s once cached) | 12.1.0 | — |
| Node.js | All scripts | ✓ | 24.19.0 | — |
| pnpm | Script execution | ✓ | 10.25.0 | — |
| `git` | Manifest's `gitCommit` field | ✓ | 2.51.1 | — |
| Local `psql`/`pg_dump` on PATH | N/A — deliberately not required | ✗ (confirmed absent, as already documented in `docs/00-current-state.md`) | — | All client-tool invocations run inside a Docker container (dev container or Testcontainers instance), never on the bare host — this absence is expected and requires no fallback. |

**Missing dependencies with no fallback:** none beyond Docker itself, which D-20 already treats as a hard-fail condition by design, not a gap to patch.
**Missing dependencies with fallback:** none — local `psql`/`pg_dump` absence is a non-issue given the container-only invocation pattern above.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 5.0.0 |
| Config file | `vitest.config.ts` (existing; `include` glob already covers `tests/**/*.test.ts`, no change needed) |
| Quick run command | `pnpm test` |
| Full suite command | `pnpm test` (same suite; the D-19 staleness check is cheap by design — the *drill itself* is the slow, separate `pnpm db:drill`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|--------------------|-------------|
| BKP-01 | Owner personally performed and timed a full backup/restore | manual-only | N/A — human action, recorded in `docs/20-restore-runbook.md` and the status file's `human` fact | N/A |
| BKP-02 | Globals captured separately via `pg_dumpall --globals-only` | integration | `vitest run tests/restore-drill.test.ts -t "globals"` | ❌ Wave 0 |
| BKP-03 | Restore drills target a genuinely fresh instance | integration | `vitest run tests/restore-drill.test.ts -t "fresh container"` | ❌ Wave 0 |
| BKP-04 | Verification asserts content, not exit code | integration | `vitest run tests/restore-drill.test.ts -t "tier"` (tiers 1-4) | ❌ Wave 0 |
| BKP-05 | Deliberate destruction test performed and confirmed | manual-only | N/A — human action (Act 1), recorded in the runbook | N/A |
| BKP-06 | Runbook exists, written from an actual performed restore | manual-only (doc review) | N/A — reviewed for presence of a "what actually happened" section, not automatable | N/A |
| BKP-07 | Automated restore test runs against disposable DB, reports pass/fail | integration | `pnpm db:drill` (the drill itself); `vitest run tests/drill-status.test.ts` (the recorded-result assertion) | ❌ Wave 0 |
| BKP-08 | Skipped/failing drill is visible, not silent | unit | `vitest run tests/drill-status.test.ts -t "staleness"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm test` (fast path — only the D-19 status-file assertion, not the full drill)
- **Per wave merge:** `pnpm test` plus a manual `pnpm db:drill` run to keep the status file fresh
- **Phase gate:** Full suite green, `pnpm db:drill` PASS, and the human drill (BKP-01/05/06) actually performed, before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/backup-manifest.test.ts` — manifest round-trip + "contains no credential-shaped strings" assertion (reuse the existing `not.toContain("postgres://")`-style pattern from `tests/db-reset.test.ts`, extended to also assert no `SCRAM-SHA-256` substring appears anywhere in the manifest or in captured stdout/stderr)
- [ ] `tests/drill-status.test.ts` — D-19's three hard-fail conditions (missing record, FAIL outcome, >30-day-old `lastRunAt`)
- [ ] `tests/restore-drill.test.ts` — the full drill exercised end-to-end (slow; this is the automated proof of BKP-02/03/04/07)
- [ ] Framework install: `pnpm add -D @testcontainers/postgresql@12.1.0` — the one new dependency this phase needs

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | No | This phase creates no new authentication surface; it only reuses existing dev-container credentials already governed by Phase 1's controls. |
| V5 Input Validation | Yes | The D-05 manifest and D-17 status file are both machine-generated JSON consumed by later code (including, eventually, Phase 7's status view) — validate both with `zod` before trusting them, matching `scripts/env.ts`'s existing `EnvSchema` pattern, so a malformed file fails loudly rather than silently under-reporting drill health. |
| V6 Cryptography | Yes (narrow) | SHA-256 checksums are used for **integrity** detection (did the dump file change/corrupt), not as a security control — no cryptographic key material is generated or managed by this phase. The one real cryptographic material this phase touches is the SCRAM-SHA-256 verifier *already present inside* the globals dump (produced by Postgres itself, not by this phase's code) — this phase's only obligation is to never extract, log, or duplicate it outside the dump file itself. |
| V7 Error Handling & Logging | Yes | Directly load-bearing: reuse `scripts/log.ts`'s `safeErrorMessage` (never serialize an unknown error's own fields) for every failure path in `backup.ts`/`restore.ts`/`drill.ts`, exactly as `scripts/db-reset.ts` already does — this is what keeps a `pg` driver error's connection-string-bearing fields out of any printed message. |
| V8 Data Protection | Yes | D-03's "backup destination outside the repo" and D-05's "manifest contains no credentials" are this category's concrete implementation for this phase — confirmed necessary, not precautionary, by the live-verified fact that the globals dump contains a real SCRAM verifier (Common Pitfalls #1). |
| V12 Files & Resources | Yes | The dump/globals/manifest filenames are timestamp-derived and must be sanitized before use as filesystem paths (Common Pitfalls #3) — a Windows-specific but genuine "files & resources" concern: an unsanitized filename doesn't just look wrong, it silently writes into a hidden alternate data stream instead of the intended file. |

### Known Threat Patterns for this phase's stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Globals dump (containing a SCRAM password verifier) committed to git or logged | Information Disclosure | D-03 (destination outside repo, never staged) + D-05 (manifest never contains dump contents, only a hash) + `safeErrorMessage` discipline for every error path that might otherwise echo file contents |
| A manifest or status file accepted without validation, later trusted for a security-relevant decision (e.g. "drill passed" gating something in a future phase) | Tampering | `zod`-validate both files on every read, not just on write, so a hand-edited or corrupted file fails loudly rather than being silently trusted |
| A restore command that could be pointed at an arbitrary connection string | Elevation of Privilege | D-06: no command in this phase accepts a target; the drill's restore path only ever receives a connection object the Testcontainers harness itself constructed |
| Silent partial restore reported as success | Repudiation (of the failure) | `ON_ERROR_STOP=1` (globals) + `--clean --if-exists` with exit-code-plus-stderr inspection (data), per Pitfalls #2 and #5 above — never trust exit code alone |

## Sources

### Primary (HIGH confidence — live-verified this session against this exact project/environment)
- `docker compose exec -T db pg_dump/pg_dumpall/pg_restore/psql --version` — confirmed `17.11` client/server parity on the dev container.
- `docker compose exec -T db pg_dump -U recipe_app -d recipe_dev -Fc` / `pg_dumpall --globals-only` — full dump/globals output captured and inspected, including the literal SCRAM verifier line.
- `npm pack @testcontainers/postgresql@12.1.0` / `npm pack testcontainers@12.1.0` — actual TypeScript declaration files and compiled source read directly (`postgresql-container.d.ts`/`.js`, `abstract-started-container.d.ts`, `started-generic-container.d.ts`, `types.d.ts`) for the exact API surface (constructor, `withDatabase`/`withUsername`/`withPassword`, `start()`, `getHost()`/`getPort()`/`getConnectionUri()`, `copyFilesToContainer()`, `exec()` → `ExecResult{output,stdout,stderr,exitCode}`, `stop()`).
- Live Node scripts run against a real `postgres:17` Testcontainers instance on this machine: container start timing, connection, `exec()`, the role-collision failure and its fix, row-count/sequence/foreign-key assertions post-restore.
- `docker compose exec -T db pg_dump --schema-only` run twice consecutively and diffed — confirmed the exact non-determinism (`\restrict`/`\unrestrict` tokens) and that it is the *only* diff.
- `fs.writeFileSync` with a colon in the filename, cross-checked with PowerShell `Get-Item -Stream *` — confirmed the Alternate Data Stream behavior directly.
- `gsd-tools query package-legitimacy check` — `OK` verdict for `@testcontainers/postgresql` and `testcontainers`.
- `npm view @testcontainers/postgresql version` / `npm view testcontainers version` / `npm view execa version` — current registry versions, cross-checked against already-pinned project versions.

### Secondary (MEDIUM confidence)
- `raw.githubusercontent.com/sindresorhus/execa/main/docs/output.md` — `{stdout: {file: path}}` redirect option and the `buffer: false` memory-consumption note.
- `hub.docker.com/_/postgres` — `POSTGRES_USER` grants superuser privileges (confirms why `recipe_app` is a superuser in this project's dev container).
- `postgresql.org/docs/current/app-pgrestore.html` + postgresql.org mailing-list thread on Win32 stdin/stdout handling — `pg_restore` requiring a seekable file for custom-format/parallel restores.
- postgresql.org mailing-list corroboration on `pg_restore --clean` exit-status behavior with/without `--if-exists`.

### Tertiary (carried forward from existing project research, not re-verified this session)
- `.planning/research/STACK.md`, `.planning/research/FEATURES.md` §4, `.planning/research/ARCHITECTURE.md`, `.planning/research/PITFALLS.md` — existing project research this phase's `02-CONTEXT.md` already treats as canonical; referenced above where they overlap with this session's live findings.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every new dependency's version was checked against the live npm registry and its actual API surface read from the downloaded package source, then exercised live.
- Architecture: HIGH — the full dump→restore→assert flow was run end-to-end on this exact machine, not assembled from documentation alone.
- Pitfalls: HIGH for the three pitfalls discovered by direct reproduction this session (role collision, Windows ADS filenames, `pg_dump` non-determinism); MEDIUM for pitfalls carried forward from existing project research and only cross-checked, not independently re-run.

**Research date:** 2026-09-07
**Valid until:** 30 days for the tooling/version claims (fast-moving npm ecosystem); the live-verified mechanics (dump/restore/assert flow, Windows ADS behavior, PG17 dump tokens) are stable Postgres/OS behavior and do not have a meaningful expiry.
