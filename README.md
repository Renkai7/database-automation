# Database Deployment Automation

A safety system around database schema changes for solo-founder SaaS applications —
not a collection of migration scripts.

## Why this exists

Two concrete problems:

1. **Claude Code cannot reach the databases.** They run as Docker containers inside
   Coolify with no route from the development machine, so inspecting a table or
   verifying a migration meant manually running commands in the Coolify terminal and
   relaying the output by hand.
2. **Production redeploys were needed too often** to get schema changes applied — an
   approach that does not hold up in a professional environment.

Solving (1) means giving an AI agent real database access, which is only responsible
if the guardrails exist first. That is what most of this project is.

## Core principle

> When the choice is between *"Claude must remember not to do something dangerous"*
> and *"the architecture prevents Claude from doing the dangerous thing"*,
> prefer architectural enforcement.

## Stack

PostgreSQL · Drizzle ORM + Drizzle Kit · Node.js / TypeScript · pnpm · GitHub ·
Coolify · Hetzner. **Not Prisma.**

## Status

Discovery. No implementation code yet, by design — the brief calls for understanding
the problem and designing the architecture before building.

Start here: **[docs/00-current-state.md](docs/00-current-state.md)**

## CI

Every pull request runs six independent, required checks: `analyze`, `tamper-checks`, `test`,
`test-history`, `migrate`, `ruleset-config-check`. See `.github/workflows/pr-gate.yml`.

## Layout

```
docs/
  00-current-state.md   operational inventory — what exists today
  decisions.md          running decision log with explicit statuses
  README.md             documentation roadmap
  original-brief.md     the source project brief
```
