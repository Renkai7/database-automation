# Project Context

This is a **database-deployment safety system**, not a migration script collection.
Read `docs/original-brief.md` for the full brief and `docs/decisions.md` for what has
actually been decided.

## Non-negotiables

- **Prefer architectural enforcement over remembered caution.** If a safeguard depends
  on an agent choosing to behave, it is not a safeguard.
- **Drizzle ORM, not Prisma.**
- **No production database access from the local machine.** Production changes go
  through CI with credentials that never touch a developer workstation.
- **Do not connect anything to a real production database** until the safety
  architecture exists and has been tested.
- **Never log or commit credentials.**

## Working style for this repo

- Document as we go — the owner does not have existing notes on their own operation,
  so capturing the current state is a real deliverable, not overhead.
- **Mark unverified things UNKNOWN.** Do not record assumptions as facts. This project
  exists partly because undocumented assumptions about a database are dangerous.
- Record decisions in `docs/decisions.md` with an explicit status. A proposal is not
  a decision.

## Current phase

Discovery. `docs/00-current-state.md` has open questions that need owner input before
the architecture documents can be written honestly.
