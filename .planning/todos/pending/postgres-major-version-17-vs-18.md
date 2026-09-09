---
id: postgres-major-version-17-vs-18
title: Decide PostgreSQL major version (stay 17, or move to 18) before production exists
created: 2026-09-09
resolves_phase: 7
raised_in_phase: 6
kind: decision
priority: high
relates_to: [D9, D16, D34]
---

# Decide the PostgreSQL major version deliberately at Phase 7 planning

## What prompted this

While creating the staging PostgreSQL resource during Phase 6 setup, Coolify offered
**PostgreSQL 18 as its default**. Staging was pinned to **17** instead, per D9 — which names
dev, staging and production explicitly — so that staging stays a faithful rehearsal of dev/CI
and so `pg_dump`/`pg_restore` keep working against the pinned `postgres:17-alpine` client image.

That was the right call for Phase 6. It is not, on its own, an answer to the larger question.

## The actual question

**Should this project's pin move from PostgreSQL 17 to 18?**

Phase 6 was the wrong moment to decide it: the phase is built to isolate one risky assumption
(the `permitopen` tunnel), and a version change would have added a second variable to it.
Phase 7 planning is the right moment, because Phase 7 must settle production's major version
anyway — `docs/decisions.md` D16 still records it as **UNKNOWN**.

## Why this is genuinely open, not settled by D9

D9's own revisit trigger is *"Revisit if any environment must run an older major."* 18 is
**newer**, so the case that has actually arrived is not the one D9 anticipated. D9 should be
read as pinning *one* version everywhere, not as pinning *17 specifically* forever.

Arguments for moving to 18:

- Nothing is in production yet. This is the cheapest moment in the project's life to change it;
  the cost only rises after Phase 7.
- Coolify defaults fresh database resources to 18. A production database provisioned the same
  way would get 18, at which point dev/staging on 17 becomes the mismatch — the exact failure
  D9 exists to prevent, arrived from the other direction.
- The analyzer already parses with `libpg-query`'s **pg18** grammar. Aligning the server to the
  grammar would remove the (currently deliberate, currently safe) asymmetry.

Arguments for staying on 17:

- Phases 1–5 were proven on 17. Moving invalidates those proofs and means re-running the
  restore drill, the history tests and the blocked-replay refusal against 18.
- D9 warns analyzer rules "may assume PG17 semantics." Any such assumption must be found and
  re-checked against 18 rather than assumed to carry over.
- Staging will, by then, have been proven on 17.

## What a move would actually cost (every hard pin found in Phase 6)

- `docker-compose.yml:13` — `image: postgres:17`
- `scripts/drill.ts:43` — `DRILL_CONTAINER_IMAGE = "postgres:17"`
- `tests/history/support.ts:21` — `HISTORY_TEST_CONTAINER_IMAGE = "postgres:17"`
- `.github/workflows/pr-gate.yml:317` — `image: postgres:17`
- The `postgres:17-alpine` client image used for backup/restore
- The Coolify staging resource itself
- Re-running the Phase 1–5 proofs on the new major

Note the `pg_dump`/`pg_restore` rule that constrains any transition: the client major must be
**≥** the server major. A staging or production server moved to 18 while the client image stays
at 17 produces restores that fail — or appear to succeed while being incomplete, which D9 flags
as the more dangerous outcome. Client image and server must move together, client first.

## Definition of done

`docs/decisions.md` D9 is either reaffirmed at 17 with the Coolify-defaults-to-18 observation
recorded against it, or amended to 18 with every pin above updated and the Phase 1–5 proofs
re-run. Either way D16's UNKNOWN production major version is closed at the same time, since the
two questions are the same question.

**Do not let this be settled implicitly** by whatever version a production resource happens to
be provisioned with. That is precisely the undocumented-assumption failure mode this project
exists to prevent.
