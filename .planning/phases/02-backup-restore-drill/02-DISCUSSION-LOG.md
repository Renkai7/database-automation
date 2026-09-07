# Phase 2: Backup & Restore Drill - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-07
**Phase:** 2-Backup & Restore Drill
**Areas discussed:** Backup artifact & command shape, The manual destruction drill, Automated drill (target + assertion depth), Making a skipped or failed drill visible

---

## Backup artifact & command shape

### Q1 — What format should the data dump use?

| Option | Description | Selected |
|--------|-------------|----------|
| Custom format (`pg_dump -Fc`) | Compressed by default, supports selective restore, only format enabling `pg_restore --jobs N`. STACK.md's recommendation. Binary, so not human-readable. | ✓ |
| Plain SQL (`pg_dump -Fp`) | Human-readable and greppable, restorable with psql alone; no selective or parallel restore, larger. | |
| Both — `-Fc` plus a plain dump | `-Fc` is the real artifact, plain dump exists for inspection. Doubles storage, second thing to drift. | |

**User's choice:** Custom format (`pg_dump -Fc`)
**Notes:** Selective restore matters directly for the drop-one-table act of the manual drill.

### Q2 — Where should backup files land on disk?

| Option | Description | Selected |
|--------|-------------|----------|
| Outside the repo entirely | Nothing can be staged; no `.gitignore` rule has to keep holding; globals dump carries role password hashes. Path needs configuring; invisible when browsing the repo. | ✓ |
| `backups/` in-repo, gitignored | Simplest bind mount and obvious runbook path, but data plus role hashes sit in the working tree behind a `.gitignore` line. | |
| In-repo with a committed staged-dump guard | Keeps convenience, makes protection mechanical and tested. One more guard to build. | |

**User's choice:** Outside the repo entirely — after asking for a recommendation
**Notes:** The user initially answered "not sure — which do you recommend?" and observed that
the common pattern is to keep backups as a file and store that file in something like Hetzner
or MinIO. That observation was accepted as correct and shaped the decision two ways: object
storage was recorded as a deferred idea (Phase 2 has no remote anything under D2/D3, and
ARCHITECTURE.md places backup storage as infrastructure-adjacent rather than automation-package
work), and the Phase 2 destination was required not to be a repo-relative path so adding object
storage later is an extra step rather than a rewrite. Recommendation given was "outside the
repo", on three grounds: the globals dump contains SCRAM verifiers and `CLAUDE.md` forbids
committing credentials; it is the shape that survives contact with Phases 6/7; and the in-repo
plus guard option is more machinery defending a weaker position.

### Q3 — How should the restore path be shaped, given D-03's warning about target-parameterised commands?

| Option | Description | Selected |
|--------|-------------|----------|
| Two paths, neither takes a target | Root scripts hardcoded to the pinned dev target; the drill restores through an internal function accepting only a harness-built connection. | ✓ |
| One `db:restore --target <url>`, allowlist-guarded | Less duplication, truer runbook; but creates exactly the parameterised tool D-03 forbids, and the guard is loosenable in a one-line diff. | |
| No restore command — runbook uses raw `pg_restore` | Closest to what you would type in a real incident; but the manual drill becomes longer, more error-prone and harder to time consistently. | |

**User's choice:** Two paths, neither takes a target

### Q4 — Besides the two dump files, what should `db:backup` emit?

| Option | Description | Selected |
|--------|-------------|----------|
| A JSON manifest recorded at backup time | Timestamp, server version, per-file SHA-256, per-table row counts, applied-migration count, git commit. Assertions compare against real source state, not seed constants; feeds Phase 7's status view. | ✓ |
| Dump files plus a checksum file only | Corruption detectable, but content unknown; couples the test to fixture data and passes silently on a half-seeded source. | |
| Just the two dump files | Simplest; no way to detect a truncated dump, and no record of what the backup was a backup of. | |

**User's choice:** A JSON manifest recorded at backup time

---

## The manual destruction drill

### Q1 — What should the manual drill actually destroy?

| Option | Description | Selected |
|--------|-------------|----------|
| Two acts: table drop, then total loss | Act 1 `DROP TABLE recipes CASCADE` restored in place (criterion 1's literal requirement); act 2 full container and volume destruction restored from both dumps — the only act where the globals dump does anything. | ✓ |
| One act: drop `recipes CASCADE`, restore in place | Sharpest single-table case; CASCADE removes the FKs on ingredients and steps so a naive restore leaves the schema silently wrong. Globals never exercised. | |
| One act: drop `ingredients`, restore in place | Leaf table, clean single-table restore, app visibly breaks. Easiest case: no constraint fallout, no globals, no empty cluster. | |
| One act: total loss only | Most realistic disaster and does exercise globals, but does not literally satisfy "dropped a real table" and never tests selective restore. | |

**User's choice:** Two acts: table drop, then total loss
**Notes:** Schema was checked first — `recipes` is the parent; `ingredients` and `steps` both
reference `recipes.id` with `ON DELETE CASCADE`, which is what makes act 1 instructive.

### Q2 — What counts as "confirmed the data returned"?

| Option | Description | Selected |
|--------|-------------|----------|
| Manifest comparison plus a look at the Recipe Page | `db:query` row counts and recognisable values against the manifest, then load the page. Objective before/after plus the check a human actually believes. | ✓ |
| Run the automated assertion suite by hand | Rigorous and reuses one definition of correct, but requires the automated assertions to exist first, inverting the phase's ordering. | |
| Eyeball it | Fastest, closest to instinct; cannot detect rows-back-without-constraints, which is act 1's whole point. | |

**User's choice:** Manifest comparison plus a look at the Recipe Page

### Q3 — What timing should be recorded, given everything is near-instant at seed scale?

| Option | Description | Selected |
|--------|-------------|----------|
| Per-step timings, explicitly labelled fixture-scale | Each step plus human decision time; stated plainly as not a production RTO estimate, which stays UNKNOWN. | ✓ |
| Total wall clock only | Literally what BKP-01 asks; but a single instant-looking total risks being read later as a recovery-time guarantee. | |
| Per-step plus a scaling note | More useful, but the scaling note is a judgement written in advance about unobserved behaviour. | |

**User's choice:** Per-step timings, explicitly labelled fixture-scale

### Q4 — What shape should the runbook take?

| Option | Description | Selected |
|--------|-------------|----------|
| Procedure first, then "what actually happened" | `docs/20-restore-runbook.md`; copy-pasteable procedure with real timings on top, wrong turns and surprises recorded below. | ✓ |
| Clean procedure only | Shortest and most usable under pressure, but indistinguishable from one written in advance from documentation. | |
| Keep it as a phase artifact under `.planning/` | Keeps the record with the plans; but it is an operational document, and `docs/` is where operators already look. | |

**User's choice:** Procedure first, then "what actually happened"

---

## Automated drill: target + assertion depth

Framing note given before the questions: BKP-03's "matching production's image" points at the
`postgres:17` (glibc) server pin from D9 / `01-CONTEXT.md` D-12; the `postgres:17-alpine`
recommendation applies only to the client tooling that runs `pg_dump`/`pg_restore`.

### Q1 — What should the automated drill restore into?

| Option | Description | Selected |
|--------|-------------|----------|
| `@testcontainers/postgresql` | Fresh `postgres:17` per run, dynamic port, typed lifecycle. STACK.md already recommends 12.1.0. BKP-03 satisfied by construction. New dependency, slow first pull. | ✓ |
| A dedicated compose service, recreated per run | No new dependency, visible in the same compose file; but a fixed port and a named service, with hand-rolled readiness, teardown and port handling. | |
| Raw `docker run` managed by the test | Zero new dependencies and total control; means hand-writing the three things that fail silently when wrong. | |

**User's choice:** `@testcontainers/postgresql`

### Q2 — How deep should the assertions go?

| Option | Description | Selected |
|--------|-------------|----------|
| Tiers 1+2+3+4 including schema-only dump diff | BKP-04 minimum plus `pg_dump --schema-only` source vs restored. Data-level referential integrity does not catch a missing FK constraint — after `DROP TABLE recipes CASCADE` orphan checks still pass and only a schema comparison notices. | ✓ |
| BKP-04 minimum only (tiers 1+2+4) | Exactly the requirement, nothing speculative; cannot distinguish rows-back from rows-back-without-constraints. | |
| Everything including app boot (tiers 1–5) | Strongest signal and D-08's smoke test was built to be reusable; collides with D-16's pinned target versus a dynamic Testcontainers port. | |

**User's choice:** Tiers 1+2+3+4 including schema-only dump diff

### Q3 — Where does the drill get the backup it restores?

| Option | Description | Selected |
|--------|-------------|----------|
| Takes its own backup as part of the run | Hermetic backup → fresh container → restore → assert. Exercises the whole pipeline every run; only ever restores a seconds-old backup, with the manifest checksum covering corruption. | ✓ |
| Restores the most recent stored backup | Tests an artifact that has actually sat on disk; but depends on external state, unrunnable on a fresh clone or in CI, and a stale artifact makes failure ambiguous. | |
| Both — self-contained by default, stored artifact optionally | Covers both cases; adds a second code path and a mode selector close to the target parameter just ruled out. | |

**User's choice:** Takes its own backup as part of the run

### Q4 — How should the drill relate to `pnpm test`?

| Option | Description | Selected |
|--------|-------------|----------|
| Separate command plus a cheap staleness check in `pnpm test` | `pnpm db:drill` runs the real thing; the fast suite asserts a recent recorded result exists. A fast test on the record cannot be quietly disabled without the suite going red. | ✓ |
| Part of the default `pnpm test` run | Nothing to remember; but makes every run slow and Docker-dependent, and the predictable end state is someone adding a skip condition. | |
| Separate command only | Fastest default suite; nothing notices when the drill has not run for months, which fails BKP-08 directly. | |

**User's choice:** Separate command plus a cheap staleness check in `pnpm test`

---

## Making a skipped or failed drill visible

### Q1 — What form should the drill result record take?

| Option | Description | Selected |
|--------|-------------|----------|
| A committed machine-readable status file | Git-tracked JSON with date, outcome, timings and tiers run. Age visible in history; assertable by the staleness check; the record Phase 7's status view reads. | ✓ |
| A committed markdown status section | Easiest to read; the staleness check would have to parse prose, and a hand-updated line is the easiest thing to forget. | |
| An uncommitted local file at the backup destination | Sits with the artifacts it describes; but a fresh clone has no history, and Phase 7 has nothing to read. | |

**User's choice:** A committed machine-readable status file

### Q2 — Should the record distinguish a human-performed drill from an automated pass?

| Option | Description | Selected |
|--------|-------------|----------|
| Two separate facts, tracked separately | Last automated drill and last human drill each with their own date and outcome. Collapsing them lets a green automated run upgrade a status D7 requires stay UNKNOWN. | ✓ |
| One status field with an explicit UNKNOWN state | Enforces D7's rule but discards the automated drill's positive signal entirely. | |
| One status field, either drill can set it | Simplest, always latest evidence; directly contradicts D7. | |

**User's choice:** Two separate facts, tracked separately

### Q3 — What should `pnpm db:drill` do when Docker is not available?

| Option | Description | Selected |
|--------|-------------|----------|
| Fail loudly, never touch the status record | Exits non-zero, writes nothing; the record ages until the staleness check goes red. A drill that could not run is indistinguishable from one never run. | ✓ |
| Record an explicit SKIPPED outcome and exit non-zero | More informative; but puts a fresh timestamp on the record, risking recent activity being read as recent evidence. | |
| Skip cleanly with a warning, exit zero | Convenient; the precise pattern BKP-08 names, and CI would read it as a pass. | |

**User's choice:** Fail loudly, never touch the status record

### Q4 — What makes the cheap check in `pnpm test` fail?

| Option | Description | Selected |
|--------|-------------|----------|
| Missing, FAIL, or older than 30 days — all hard-fail | Age treated as evidence going stale. D-20 already rejected warnings as the "remembered caution" pattern. 30 days recorded as a decision so it can be revisited with a reason. Suite goes red if the project goes quiet — honest, because the evidence is stale. | ✓ |
| Hard-fail on missing or FAIL; warn on age | Keeps the suite green during quiet periods; but the one condition that creeps up silently is the one that never stops anything. | |
| Two-stage: warn at 30 days, hard-fail at 90 | More forgiving; a warning with extra steps for the first 60 days, and two thresholds to justify instead of one. | |

**User's choice:** Missing, FAIL, or older than 30 days — all hard-fail

---

## Claude's Discretion

Recorded in CONTEXT.md `<decisions>` § "Claude's Discretion":

- Exact filename, path and JSON schema of the status file and the backup manifest.
- How the configured backup destination is expressed (source constant, env var, or config file).
- Which seeded values are chosen as tier-4 spot checks, and how sequence state is asserted.
- Whether the tier-3 schema comparison needs a canonicalising pass before diffing.
- Retention behaviour at the backup destination (overwrite vs accumulate) — not discussed.
- Whether act 1's runbook prescribes a whole-database restore or documents the CASCADE
  constraint gap as a discovered surprise.
- Whether the automated drill restores the globals dump as well as the data dump — not
  discussed; act 2 of the manual drill covers the globals path regardless.

## Deferred Ideas

- Off-server backup storage (Hetzner Storage Box / MinIO / S3) — raised by the user, accepted
  as the correct eventual shape, deferred to a phase with a remote environment to store from.
- Scheduled / cron restore drills with dated reporting.
- Assertion tier 5 — application boot against the restored database (blocked by the D-16
  target pin versus Testcontainers' dynamic port).
- Backing up staging or production.
- Restoring an aged stored artifact rather than a freshly-taken one.
- Committed `pg_dump --schema-only` production snapshots (D3's visibility mechanism, Phase 7).

## Areas Offered But Not Explored

At the end of each area and at the close of the discussion, further threads were offered and
declined. Recorded here so they are not mistaken for oversights:

- How role password hashes in the globals dump are handled in the manifest and in logs.
- Whether backups accumulate or overwrite.
- Whether `db:backup` refuses to run against a non-development target.
- Whether the manual drill is re-run once the automated test exists.
- How spot-checked values stay meaningful if the seed changes in a later phase.
