# Implementation Roadmap

Walking the brief's workflow end to end, using a greenfield recipe app as the test
fixture. Each phase states what it **proves**, not merely what it builds — a phase is
done when its claim has been demonstrated, not when its code exists.

**Ordering principle:** every capability is proven at a stage where failure is free,
before it is relied on at a stage where failure is expensive.

---

## Phase 0 — Local foundation

**Proves:** a schema change can become a tested, committed migration without any
network access to anything.

- Postgres in Docker Compose, version-matched to the eventual production version
- TypeScript / pnpm project, Drizzle ORM + Drizzle Kit configured
- First recipe schema — deliberately minimal, so later phases have real changes to make
- `schema edit → drizzle-kit generate → inspect SQL → apply → test → commit` by hand once

**Exit:** the loop works locally and is written down step by step.

---

## Phase 1 — Backup and restore drills *(early, deliberately)*

**Proves:** a backup can actually be restored, by a procedure the owner has personally
performed.

This sits early rather than late because **a restore has never been tested**, and the
only cost-free moment to learn it is now, against a container full of fake recipes.
Practising restores after real users exist means learning under pressure.

- `pg_dump` / `pg_restore` against the local container, run manually
- Deliberate destruction: drop a table, restore, verify the data returned
- Measure it — how long does a restore take, and what exactly is lost?
- Write the restore runbook from what actually happened, not from documentation
- Then automate: restore into a disposable database and assert row counts

**Exit:** a restore has been performed by hand, timed, and documented; an automated
restore check exists.

> Per the brief: a backup is not trustworthy because the job reported success.
> Until this phase passes, backup status is UNKNOWN, never PASS.

---

## Phase 2 — Migration safety analyzer

**Proves:** dangerous SQL is caught mechanically, not by anyone remembering to look.

- Parse generated migration SQL; classify `SAFE` / `REVIEW REQUIRED` / `BLOCKED`
- Context-aware, per the brief: a nullable `ADD COLUMN` is not `SET NOT NULL` on a
  populated table
- Rules are data, not hardcoded — the brief's lists are seeds, not the full set
- **Test it adversarially:** write migrations that *should* be blocked and confirm they
  are. An analyzer that has never rejected anything is unproven.

**Exit:** the analyzer blocks a real `DROP TABLE` and correctly passes a safe migration.

---

## Phase 3 — Automated migration testing

**Proves:** the migration history is internally consistent and the app runs against it.

- Empty database → entire migration history → expected final schema
- Existing database → new migration only
- Application starts successfully against the resulting schema
- Expected tables and columns exist

**Exit:** both axes run green from a single command.

---

## Phase 4 — CI pipeline

**Proves:** none of the above can be skipped by forgetting.

- GitHub Actions: on every PR, run the analyzer, both migration test axes, and app tests
- Safety classification surfaced on the PR itself
- `BLOCKED` classification fails the build

**Exit:** a PR containing a destructive migration cannot go green.

---

## Phase 5 — Staging on Coolify

**Proves:** migrations apply to a remote database without a deploy, and without exposing
the database to the internet.

- Provision the recipe app + Postgres in Coolify
- Resolve the connectivity decision (see decision **D4**)
- **Migrations run as their own gated step, never at application startup** — this is the
  direct fix for the redeploy problem
- Separate credentials for app runtime vs. migrations

**Exit:** a schema change reaches staging through the pipeline, with no redeploy and no
manual terminal use.

---

## Phase 6 — Production

**Proves:** the protected destination works, and the owner supervises rather than operates.

- Production environment marked protected; approval gate on `REVIEW REQUIRED`
- Migration credentials exist only in CI secrets — never on the local machine
- Scheduled off-server backups, with the Phase 1 automated restore test running against them
- Audit log: migration id, commit, environment, result, classification, timestamp — no secrets
- The status summary from the brief, showing safety / dev / staging / tests / backup / production

**Exit:** a routine safe migration deploys with supervision only; a destructive one stops
and explains itself.

---

## Phase 7 — Generalize *(not before this point)*

Extract the pipeline into something a second application can adopt via a small config
file, per the controller sketch at the end of the brief. Deliberately last: the brief
says not to build the multi-project platform first.

---

## Tracks running throughout

- **Documentation.** Written as we go. The owner had no operational notes; producing
  them is a deliverable, not overhead.
- **UI.** A hand-off will be supplied. It shapes the schema but does not block phases 0–4.

## A note on schema churn

The recipe app's schema is *supposed* to change repeatedly — adding tags, splitting
ingredients into their own table, making a column non-null, renaming something,
eventually dropping a column. That churn is not a detour. It is the test material that
proves the pipeline, including the expand-and-contract pattern from the brief.
