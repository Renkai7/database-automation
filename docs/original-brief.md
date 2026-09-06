Yes. Since this will be a **dedicated database-deployment automation project**, I would give Claude Code a fairly strong project brief before it writes anything. The important part is making Claude understand that this project is **a safety system around database changes**, not merely a collection of migration scripts.

I’d start the repository with something like this as your initial Claude Code prompt:

# Database Deployment Automation

We are building a dedicated automation system for safely managing database schema changes for my SaaS applications.

I am a solo founder and use AI coding agents extensively. The purpose of this project is to let Claude Code handle most routine database-development work while making it difficult or impossible for an AI mistake to damage a production database.

## Current Stack

Assume the primary stack is:

* Claude Code
* PostgreSQL
* Drizzle ORM
* Drizzle Kit
* GitHub
* GitHub Actions or another CI pipeline
* Coolify
* Hetzner
* Node.js / TypeScript
* pnpm

Do not assume Prisma. We are using Drizzle ORM.

---

# Core Principle

Claude should have substantial freedom in development environments but extremely limited ability to affect production directly.

The architecture should enforce safety technically rather than relying only on prompts telling Claude to "be careful."

The desired model is:

Claude Code
↓
Development Database
↓
Generate Drizzle Migration
↓
Migration Safety Checks
↓
Git / Pull Request
↓
Automated Tests
↓
Staging Database
↓
Production Deployment
↓
Backups / Restore Capability

Production database changes should normally happen only through reviewed and validated migrations.

---

# Environment Model

We want at least three database environments.

## 1. Development

Claude has broad control.

Claude may:

* modify the Drizzle schema
* generate migrations
* apply migrations
* create test data
* reset development data
* recreate the database
* experiment with schema designs
* run integration tests

The development database must contain no irreplaceable production data.

A destructive mistake here should be harmless.

---

## 2. Staging

Staging exists to test migrations and application deployments in an environment resembling production.

Claude and automation may:

* apply committed migrations
* run integration tests
* run smoke tests
* verify schema compatibility
* test deployment behavior

Staging should also be disposable or recoverable.

Production credentials must never be reused for staging.

---

## 3. Production

Production contains real user data.

Claude Code should NOT normally have unrestricted production database credentials.

Claude should not manually SSH into the server or use the Coolify terminal for ordinary database changes.

Production schema changes should flow through the deployment system.

Example:

GitHub main branch
↓
CI validation
↓
migration safety checks
↓
staging migration
↓
tests
↓
approved production deployment
↓
Drizzle migration runner
↓
production database

---

# Critical Safety Rules

Treat these rules as architectural requirements.

## Claude must never casually execute destructive operations against production.

Examples requiring blocking, explicit escalation, or a special migration process include:

* DROP DATABASE
* DROP SCHEMA
* DROP TABLE
* TRUNCATE
* DROP COLUMN
* destructive type conversions
* removing constraints in dangerous ways
* mass DELETE operations
* mass UPDATE operations that could corrupt production data

Not every ALTER statement is dangerous, so safety checks should understand context rather than blindly rejecting every schema alteration.

---

# Production Credentials

Claude's normal development environment should not contain production database administrator credentials.

Separate credentials should exist for:

* application runtime
* development migrations
* staging migrations
* production migrations
* administrative / emergency operations

Use least-privilege permissions where practical.

Claude should not need the production superuser password.

Production migration credentials should preferably exist only inside the deployment environment or secret-management system.

---

# Migration Philosophy

Database environments are NOT merged together.

We move schema changes between environments using migration files stored in Git.

Expected concept:

Development schema change
↓
Drizzle generates SQL migration
↓
migration committed to Git
↓
same migration tested against staging
↓
same migration applied to production

The migration files are part of the application's source history.

We should always be able to answer:

* Which migration changed the database?
* When was it introduced?
* What SQL did it execute?
* Which application release introduced it?

---

# Drizzle Workflow

Use Drizzle's migration tooling rather than manually modifying production schemas whenever possible.

Claude should be responsible for:

1. Updating the Drizzle schema.
2. Generating migration files.
3. Inspecting generated SQL.
4. Running automated migration safety checks.
5. Applying migrations to development.
6. Running tests.
7. Testing migration history from a clean database where practical.
8. Committing migration files alongside the code that depends on them.

Do not build the architecture around directly editing production with raw SQL.

Raw SQL migrations may still be necessary in some cases, but they must go through the same safety pipeline.

---

# Migration Safety Analyzer

Create a safety layer that analyzes migrations before they can reach production.

Each migration should be classified into something like:

SAFE
REVIEW REQUIRED
DESTRUCTIVE / BLOCKED

Examples:

## Usually Safe

* CREATE TABLE
* ADD COLUMN when nullable or safely defaulted
* CREATE INDEX
* ADD non-destructive relation
* adding compatible constraints

## Review Required

* SET NOT NULL on existing columns
* adding UNIQUE constraints to tables with existing data
* changing column types
* renaming columns
* large data backfills
* changing foreign-key behavior
* large indexes on production tables

## Destructive / Block by Default

* DROP TABLE
* DROP COLUMN
* TRUNCATE
* DROP DATABASE
* DROP SCHEMA
* uncontrolled DELETE
* destructive data conversions

Do not treat this list as complete. Design the analyzer so additional rules can be added.

---

# Destructive Migration Strategy

When removing or replacing production schema, prefer expand-and-contract migrations.

Example:

Instead of immediately:

DROP COLUMN old_name

Prefer:

Release 1:

* add new_name
* application supports both fields

Release 2:

* migrate/backfill data
* application reads new_name

Release 3:

* stop using old_name

Later:

* remove old_name after confirming it is unused

The system should encourage reversible, backwards-compatible deployments.

---

# Migration Testing

Before production deployment, automation should attempt to verify that:

* migration SQL is syntactically valid
* migration history applies cleanly
* the application works against the resulting schema
* expected tables and columns exist
* application startup succeeds
* migration does not contain blocked operations
* staging migration succeeds

Where practical, test both:

Existing database
→ new migration

and:

Empty database
→ entire migration history
→ latest schema

---

# Backups

Database safety cannot depend entirely on preventing mistakes.

Production must also have recoverable backups.

The system should account for:

* scheduled PostgreSQL backups
* off-server backup storage
* retention policies
* restore documentation
* periodic restore testing

A backup should not be considered trustworthy merely because the backup job reported success.

We eventually want an automated restore test against a disposable database.

---

# Deployment Failure

Do not assume every migration can simply be rolled backward.

Database rollback can be more dangerous than application rollback.

Design deployment procedures around:

* backwards-compatible migrations
* application rollback compatibility
* backups
* forward-fix migrations when appropriate

Production migration failure should stop the application deployment when continuing would be unsafe.

---

# Auditability

The system should produce useful logs.

For every production migration we should eventually know:

* application/repository
* migration identifier
* Git commit
* deployment identifier
* timestamp
* environment
* migration result
* safety classification
* relevant warnings

Do not log secrets or full database credentials.

---

# Human Role

I do not want to manually perform routine database administration.

My role should primarily be supervision.

I should be able to see something like:

Migration:
20260906_add_organization_membership

Safety:
REVIEW REQUIRED

Reason:
Adds UNIQUE constraint to existing table.

Development:
PASS

Staging:
PASS

Application tests:
PASS

Backup status:
PASS

Production:
READY

For routine safe migrations, the system should eventually be capable of deploying automatically.

For suspicious or destructive migrations, it should stop and clearly explain why.

---

# Initial Scope

Do NOT attempt to build the entire finished platform at once.

First understand the problem and design the architecture.

Create documentation covering:

1. System architecture
2. Threat/failure model
3. Database environment model
4. Drizzle migration workflow
5. Production credential model
6. Migration safety rules
7. CI/CD flow
8. Backup and restore strategy
9. Logging/audit model
10. MVP implementation plan

Then propose a small first version.

The first MVP should ideally prove this flow:

Claude modifies Drizzle schema
↓
migration generated
↓
migration SQL analyzed
↓
development migration succeeds
↓
tests succeed
↓
Git records migration

Do not connect the MVP to a real production database until the safety architecture has been established and tested.

---

# Design Goals

Optimize for:

* simplicity
* strong defaults
* automation
* recoverability
* visibility
* least privilege
* easy debugging
* AI-agent friendliness

Avoid unnecessary enterprise complexity.

I am a solo SaaS founder. I need something robust enough to protect production data without creating an infrastructure team for myself.

Whenever there is a choice between:

"Claude must remember not to do something dangerous"

and

"the architecture prevents Claude from doing the dangerous thing"

prefer architectural enforcement.

---

# First Task

Before writing implementation code:

1. Analyze this project brief.
2. Identify any missing safety concerns.
3. Propose the architecture.
4. Show me the complete database-change lifecycle from Claude modifying a Drizzle schema through a production deployment.
5. Separate what belongs in this central automation repository from what must live inside each SaaS application's repository.
6. Propose the smallest useful MVP.
7. Create a phased implementation plan.

Do not begin implementing production access yet.

That last section is particularly important. I wouldn't tell Claude, **"Build all of this."** I'd let it reason through the system first.

### One architectural detail I'd have Claude investigate

You're actually creating something potentially more interesting than a database script.

I picture the dedicated project eventually becoming a small **Database Deployment Controller**:

```text
                         DATABASE CONTROLLER
┌────────────────────────────────────────────────────────────┐
│                                                            │
│   Migration Inspector       Environment Manager            │
│          │                         │                        │
│          ▼                         ▼                        │
│   Safety Classifier         Dev / Stage / Prod             │
│          │                         │                        │
│          └───────────┬─────────────┘                        │
│                      ▼                                     │
│                Deployment Gate                             │
│                      │                                     │
│        ┌─────────────┼──────────────┐                      │
│        ▼             ▼              ▼                      │
│      Tests         Backups       Audit Log                 │
│                                                            │
└───────────────────────┬────────────────────────────────────┘
                        │
            ┌───────────┴───────────┐
            ▼                       ▼
        SaaS App A               SaaS App B
        Drizzle                  Drizzle
        PostgreSQL               PostgreSQL
```

Then when you make SaaS #2, #3, #4, you don't reinvent your database safety system each time.

Each app might only need a tiny configuration file:

```yaml
project: my-saas

database:
  orm: drizzle

environments:
  development: enabled
  staging: enabled
  production: protected

migrationPolicy:
  dropTable: block
  dropColumn: requireApproval
  truncate: block
  addColumn: allow
```

Your central tool understands how to police it.

I'd **not build the multi-project platform initially**, though. Have Claude design the first version around one throwaway PostgreSQL application and prove that it can safely go:

**Drizzle schema → migration → inspect → test → staging**

without ever giving it production access.

Once *that* works, production is essentially the final protected destination rather than the experimental environment—which is precisely where we want to end up.
