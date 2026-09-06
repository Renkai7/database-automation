<!-- GSD:project-start source:PROJECT.md -->

## Project

**Database Deployment Automation**

A safety system around PostgreSQL schema changes for a solo founder who develops with AI
coding agents. It gives an agent real access to development databases and a governed path
to production, so that routine database work is automated while an agent mistake cannot
damage production data. A greenfield recipe application is built alongside it as the test
fixture that exercises the pipeline.

**Core Value:** A schema change reaches production without anyone hand-running SQL, and no AI mistake can
destroy production data — because the architecture prevents it, not because anyone
remembered to be careful.

### Constraints

- **Tech stack**: PostgreSQL, Drizzle ORM + Drizzle Kit, Node.js/TypeScript, pnpm, GitHub
  Actions, Coolify, Hetzner — the owner's existing self-hosted stack. **Not Prisma.**
- **Security**: No production database credentials on the local development machine —
  the central architectural constraint, not a preference.
- **Security**: No database port exposed to the public internet. Remote access must use a
  mechanism that adds no inbound attack surface.
- **Operating model**: Solo founder. Must be robust without requiring an infrastructure
  team to run it. Avoid enterprise complexity.
- **Platform**: Development is on Windows, so tooling must work there — not Linux-only scripts.
- **Sequencing**: No connection to a real production database until the safety architecture
  exists and has been tested.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->

## Technology Stack

## Recommended Stack

### Core Framework

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `drizzle-orm` | **0.45.2** (stable) | ORM + query layer | Project constraint (not Prisma). This is the latest non-prerelease on npm, confirmed via `gh api repos/drizzle-team/drizzle-orm/releases` (published 2026-03-27). |
| `drizzle-kit` | **0.31.10** (stable) | Schema diffing, migration generation, migration journal | Latest non-prerelease, confirmed via GitHub Releases API (published 2026-03-17). Paired with drizzle-orm 0.45.2 as the current stable generation. |
| `libpg-query` | **17.7.4** | Real PostgreSQL parser (WASM) → AST for the safety analyzer | The literal Postgres C grammar compiled to WebAssembly. **This is the core dependency for the whole project's safety-analyzer decision** — see the dedicated section below. |
| Node.js | **24.19.0** (already installed) | Runtime | Verified in local environment; no upgrade needed. |
| pnpm | **10.25.0** (already installed) | Package manager | Project constraint. |

### Database

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| PostgreSQL | Match whatever tag Coolify/production runs (verify — not yet confirmed in this research) | Target database | Project constraint. Pin the exact major version across dev/staging/prod; it determines which `libpg-query`/`pgsql-parser` PG-version dist-tag to install and which `postgres:*-alpine` client image to use for backup/restore tooling. |
| `pg` (node-postgres) | latest 8.x | Driver used by `drizzle-orm/node-postgres` | Standard Drizzle Postgres driver; use this rather than `postgres.js` unless a specific need for the latter arises — it's the driver Drizzle's own docs default to for self-hosted Postgres (as opposed to serverless drivers like Neon's). |

### Infrastructure / Safety Pipeline

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `libpg-query` | 17.7.4 | Parse migration SQL into a real Postgres AST | See "SQL parsing" section. Build the safety classifier on top of this — it is the single most important dependency in the stack. |
| `pgsql-parser` (optional) | latest, tracks libpg-query | Parse **and** deparse (AST → SQL round-trip) | Only add if the analyzer needs to reconstruct/rewrite SQL (e.g. auto-inserting `CONCURRENTLY`); not needed for pure classification. |
| `squawk-cli` (npm) | v2.64.0 | Reference Postgres migration linter, runnable from Node/CI on Windows | Reuse as a second opinion / starter rule set rather than reimplementing common lint rules from scratch. See reuse-vs-build section. |
| `@testcontainers/postgresql` | 12.1.0 | Ephemeral Postgres for "empty DB → full history" and restore-drill tests | See Ephemeral Postgres section. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vitest` | 5.0.0 | Test runner | All test suites: unit tests for the classifier, integration tests against Testcontainers Postgres. |
| `zod` | latest 3.x/4.x (verify against drizzle-zod compat at implementation time) | Runtime validation of the safety-rule config schema (SAFE/REVIEW/BLOCKED rule definitions as extensible data) | The brief explicitly requires "rules... extensible data rather than hardcoded" — validate that data with zod so a malformed rule file fails loudly instead of silently under-blocking. |
| `commander` or `cac` | latest | CLI ergonomics for the pipeline's own commands (`analyze`, `apply`, `backup`, `restore-test`) | Either is fine and both work cleanly on Windows (pure JS, no native deps); `commander` is the safer default for longevity/familiarity. |
| `execa` | latest 9.x | Spawning `squawk.exe`, `pg_dump`/`pg_restore` (via Docker), and drizzle-kit as child processes | Nicer error handling and cross-platform quoting than raw `child_process`; matters on Windows where argument-quoting bugs are common with the built-in `spawn`. |
| `pino` | latest | Structured JSON audit logging (migration id, commit, environment, result, classification, timestamp) | Matches the auditability requirement directly; JSON-line output is trivial to ship to any log sink later. |

## Installation

# Core

# Safety analyzer core

# Only if AST->SQL round-trip / rewriting is needed later:

# pnpm add pgsql-parser pgsql-deparser @pgsql/types

# Reference linter (reuse, don't reimplement its rules from scratch)

# Testing

# Pipeline plumbing

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|--------------------------|
| `libpg-query` (WASM, real Postgres parser) | Regex-based SQL matching | Never, for this project. Regex cannot distinguish `ALTER TABLE x ADD COLUMN y ... NOT NULL DEFAULT z` (safe on PG11+) from `ALTER TABLE x ALTER COLUMN y SET NOT NULL` (table-scanning, blockable) reliably across quoting, comments, multi-statement files, and dialect edge cases. A real AST is the only way to satisfy "rules should understand context rather than blindly rejecting every schema alteration" from the brief. |
| Build the classifier on `libpg-query` AST + a small rules engine | Adopt Atlas's `migrate lint` wholesale | Only if a paid Atlas Pro subscription (~$9/dev/mo + $59/CI project/mo) is acceptable — the Postgres-specific destructive-change analyzers (PG301-PG311) that matter most for this project are Pro-gated as of Oct 2025. Not recommended for a solo-founder budget-conscious project when a comparable open capability (squawk + custom rules) exists for free. |
| `squawk-cli` as a reference/second-opinion linter | `eugene` (lock-tracing against a live temp Postgres) | Use `eugene trace` later, from **CI (Linux runner)**, once the pipeline needs actual lock-duration evidence rather than static classification. Do not depend on it from the Windows dev machine — no official Windows binary. |
| `@testcontainers/postgresql` for migration-history tests | Plain `docker compose up` + wait-for-healthy script | If you want zero extra npm dependency and are comfortable hand-rolling readiness polling; Testcontainers buys typed lifecycle management (start/stop, dynamic ports, log-wait strategies) for a small dependency cost. Recommended over compose for this project because tests need a **fresh, disposable** DB per run, which Testcontainers does natively. |
| `@testcontainers/postgresql` | `pg-mem` | Only for fast, unrelated unit tests that need *a* SQL-speaking object and don't care about real Postgres fidelity (e.g. testing a query-builder helper in isolation). Never for migration-safety or migration-history verification — pg-mem is not a real Postgres engine (missing extensions, most built-in functions, and a query planner that doesn't reflect real Postgres behavior). |
| `pg` (node-postgres) driver | `postgres.js` | If you later adopt a serverless/edge Postgres provider that specifically recommends `postgres.js` or its own driver; not relevant for a self-hosted Coolify/Hetzner Postgres container. |
| `vitest` | `node:test` | If you want literally zero test-framework dependency and are fine with a plainer `assert`-based API and weaker snapshot/mocking support. For a project that needs Testcontainers integration tests and clear CI output, Vitest is worth the dependency. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|--------------|
| Regex/string-matching to detect `DROP TABLE`, `DROP COLUMN`, etc. | Trivially defeated by comments, quoting, multi-line statements, `IF EXISTS`, schema-qualified names, and case variations; cannot understand context (e.g. `ADD COLUMN ... NOT NULL DEFAULT` is safe on modern Postgres, `SET NOT NULL` on an existing column is not) — exactly the nuance the brief asks for. | `libpg-query` → parse to AST → walk the AST for node types (`DropStmt`, `AlterTableStmt` subcommands, etc.) |
| `drizzle-kit`'s built-in `--strict` confirmation prompt as "the safety system" | It is an interactive CLI confirmation, not a policy engine — it does not classify by risk tier, is not extensible as data, doesn't produce an audit record, and (per community bug reports) has had regressions in the 1.0 beta line where destructive ops executed without confirmation. | The custom safety analyzer described in this document, run as a required pipeline gate independent of drizzle-kit's own prompts. |
| Drizzle Kit / Drizzle ORM v1.0.0-beta or -rc for this project | Explicitly not production-recommended by the maintainers; also removes/restructures `_journal.json`, the exact audit mechanism this pipeline is built around. | `drizzle-orm@0.45.2` + `drizzle-kit@0.31.10` (current stable). |
| `pg-mem` as the migration-safety test database | Not a real Postgres engine; cannot validate lock behavior, real constraint enforcement, or extension-dependent SQL — false confidence is worse than no test here. | `@testcontainers/postgresql` (real Postgres in Docker). |
| Atlas Community Edition's `migrate lint` as the sole safety gate | The PG-specific destructive/backward-incompatible analyzers that matter for this exact use case were moved to the paid Pro tier in late 2025; the free tier's remaining checks are generic and thinner than squawk's open rule set. | `libpg-query`-based custom analyzer, optionally cross-checked against `squawk-cli` (fully open source, Apache-2.0). |
| Reshape (fabianlindfors/reshape) as a dependency | No confirmed active maintenance; the original author appears to have moved on to a from-scratch successor project (ReshapeDB). Confidence: LOW — no formal deprecation notice found, but do not build production infrastructure on an unconfirmed-maintenance tool. | Use it only as design inspiration (the view-based expand/contract pattern) if/when this project needs true zero-downtime column renames; implement that pattern directly rather than taking the dependency. |
| pgroll as the migration engine | It replaces Drizzle's SQL-migration model outright (YAML/JSON migration definitions, dual-schema views, `search_path`-based client routing) — architecturally incompatible with the project's stated model of "Drizzle generates the SQL migration." | Keep Drizzle-generated SQL migrations as the source of truth; borrow the expand/contract *strategy* (already specified in the project brief) without adopting pgroll's engine. |
| `libpg-query`'s old native (`node-gyp`) binding generation | Historically caused Windows build failures (missing MSVC toolchain, node-gyp errors reported by multiple users). | The current `libpg-query` package line is WASM-only by design specifically to eliminate this — just use the current npm version, do not pin an old native-binding release. |

## Stack Patterns by Variant

- **Build, on top of `libpg-query`.** Do not adopt Atlas (Pro-gated for exactly the PG rules needed) or eugene (no Windows binary, and its most valuable mode — lock tracing — needs a running Postgres, making it a CI-time tool, not a Windows-dev-time one) as the primary engine.
- **Reuse `squawk-cli` as a second-opinion / bootstrap rule set**, not as the sole engine. Its rule catalog (`ban-drop-table`, `ban-drop-column`, `ban-drop-not-null`, `adding-not-nullable-field`, `changing-column-type`, `disallowed-unique-constraint`, `require-concurrent-index-creation`, etc.) is directly reusable prior art for defining this project's SAFE/REVIEW/BLOCKED taxonomy, and it runs natively on Windows (ships `squawk-windows-x64.exe`, wrapped by the `squawk-cli` npm package's `win32-x64` optional dependency — installable and invocable from a Node pipeline with no extra setup). Concretely: run `squawk --reporter json` against generated migration SQL as one signal, and combine its findings with a custom `libpg-query`-AST-based classifier that maps directly to this project's own extensible rule-config format (the brief requires rules as "extensible data," which squawk's own Rust-compiled rule set is not — it can inform the rule list, but the actual policy engine driving SAFE/REVIEW/BLOCKED decisions needs to be this project's own code operating on the parsed AST).
- **Why not just reimplement squawk's logic and skip libpg-query?** Because a hand-rolled parser (even a good one) will drift from real Postgres grammar over time and on edge cases; `libpg-query` **is** the actual Postgres grammar, so the AST is authoritative by construction. This removes an entire class of "the analyzer approved this SQL but Postgres parses it differently" bugs.
- **Why not just take a dependency on squawk as the sole gate?** Its rule set is fixed/compiled into a Rust binary — not the "extensible data" model the project explicitly asked for, and it has no concept of this project's three-tier SAFE/REVIEW/BLOCKED classification (its output is closer to lint warnings than a gating decision). It's a strong second opinion and rule-catalog reference, not a replacement for a purpose-built classifier.
- Add `eugene trace`, invoked only from CI (Linux runner or the `ghcr.io/kaaveland/eugene` Docker image), never depended on from the Windows dev machine.
- Don't adopt pgroll's engine; implement the view-based expand/contract pattern directly (informed by pgroll's/Reshape's design docs) so migrations stay Drizzle-authored SQL, matching the project's stated migration philosophy.
- Since the dev DB is already a Docker container, run client tools the same way: either `docker exec` into the running Postgres container, or run an ephemeral `postgres:<same-major>-alpine` container purely for its bundled client binaries, e.g. `docker run --rm -v ${PWD}:/backup postgres:17-alpine pg_dump -h host.docker.internal -U ... -Fc -f /backup/dump.dump dbname`. Always match (or exceed) the client major version to the server's major version — this is Postgres's own compatibility rule for `pg_dump`/`pg_restore`.
- For backups: prefer **custom format** (`pg_dump -Fc`) over plain-text SQL for anything beyond a quick manual look — it's compressed by default, supports selective restore, and is the only format that enables `pg_restore --jobs N` parallel restore (directory format `-Fd` also supports parallelism if pre-restore parallel *dump* is wanted too, at the cost of a directory-of-files output instead of one file).
- For restore drills specifically: dump with `-Fc`, restore with `pg_restore --clean --if-exists --no-owner --jobs <n>` into a disposable Testcontainers/Docker Postgres — `--clean --if-exists` lets a restore rerun cleanly against a target that already has the schema without erroring on "already exists," and `--jobs` meaningfully speeds up restore of anything non-trivial (rule of thumb: jobs ≈ CPU cores minus one).
- Use `@testcontainers/postgresql` from Vitest (`PostgreSqlContainer().start()` in `beforeAll`/`globalSetup`, generous timeout for first image pull). Run the entire `drizzle/` migrations folder against a freshly started container for the empty-DB case; run only the newest migration against a container pre-seeded with the prior migration history for the existing-DB case. Do not use `pg-mem` for either — it cannot validate real Postgres locking or constraint behavior, which is the entire point of these tests.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|------------------|-------|
| `drizzle-orm@0.45.2` | `drizzle-kit@0.31.10` | Current paired stable versions as of this research date (both published within days of each other in the same release cycle, 2026-03-17/27). Do not mix a 0.x drizzle-orm with a v1 beta/rc drizzle-kit or vice versa. |
| `libpg-query` | Postgres major version via npm dist-tag | The package defaults to the PG18 API; install `libpg-query@pg17` (or the tag matching your actual server) explicitly if the project's Postgres major version differs, to keep parser grammar and target server aligned. **Confirm the actual Postgres version Coolify/production will run before pinning this** — not yet established in this research pass. |
| `@testcontainers/postgresql@12.1.0` | Docker Desktop (Windows, WSL2 backend) | No Windows-specific caveats found in official docs beyond a reachable Docker daemon, which Docker Desktop provides. |
| `squawk-cli` (npm) | Windows x64 | Ships a `win32-x64` optionalDependency bundling `squawk.exe`; no separate download step needed beyond `pnpm add -D squawk-cli`. |

## Sources

- GitHub Releases API (`gh api repos/drizzle-team/drizzle-orm/releases`) — direct, unsummarized query for drizzle-orm and drizzle-kit version history and prerelease status. Confidence: HIGH (primary source, not LLM-summarized).
- GitHub Releases API (`gh api repos/sbdchd/squawk/releases/latest`) and repo contents API (`npm/` directory) — confirmed the Windows binary asset and npm `win32-x64` packaging directly from the source repo. Confidence: HIGH.
- GitHub contents API for `constructive-io/libpg-query-node/README.md` and `constructive-io/pgsql-parser/README.md` — confirmed WASM-only, cross-platform build, current npm package layout. Confidence: HIGH.
- `orm.drizzle.team/docs/kit-overview`, `/docs/drizzle-kit-check`, `/docs/migrations`, `/docs/latest-releases`, `/docs/latest-releases/drizzle-orm-v1beta2` (official Drizzle docs, fetched directly) — CLI command surface, `check` command scope/limits, programmatic migration API, v1 beta status and non-production recommendation. Confidence: MEDIUM-HIGH (official docs, fetched via summarizing tool rather than Context7 — Context7 MCP tool was unavailable in this environment).
- `squawkhq.com/docs/rules`, `/docs/cli`, `/docs/` (official Squawk docs) — full rule catalog, CLI flags including `--reporter json`. Confidence: MEDIUM (web-fetched, cross-checked against GitHub release assets).
- `atlasgo.io/versioned/lint` + web search cross-check on Atlas pricing change (Oct 2025 Pro-gating of `migrate lint` and PG301-PG311 analyzers). Confidence: MEDIUM — pricing/tier details can move; verify current Atlas pricing page before final decision if Atlas is ever reconsidered.
- `xata.io/blog/pgroll-internals`, `pgroll-expand-contract` and related blog posts (official pgroll team blog) — mechanism description (views, `search_path`, sync triggers). Confidence: MEDIUM.
- `github.com/fabianlindfors/reshape` (README fetched directly) + web search for maintenance-status signal. Confidence: LOW on the "unmaintained" characterization specifically — no formal deprecation notice was found, this is an inference from indirect signals (creator's newer project, third-party tool roundups). Treat as a caution flag, not a confirmed fact.
- `github.com/kaaveland/eugene` + `kaveland.no` blog posts (official author blog) — lint vs. trace modes, lock inspection via `pg_locks`. Confidence: MEDIUM.
- npm registry direct queries (`registry.npmjs.org/<pkg>/latest`) for `libpg-query`, `@testcontainers/postgresql`, `pg-mem`, `vitest` version numbers, cross-checked against GitHub release data where available. Confidence: MEDIUM-HIGH.
- Web search synthesis (2026 test-runner comparisons; pg_dump/pg_restore flag semantics; Windows Docker client-image pattern) — general consensus material without a single authoritative source; treat specific numeric claims (e.g. exact restore speedups) as illustrative, not verified benchmarks. Confidence: MEDIUM per the seam's `classify-confidence --provider websearch --verified` tier (cross-checked across 2+ independent search results).
- **Gap/low-confidence flag:** The exact PostgreSQL major version running in the project's Coolify/Hetzner containers was not established during this research pass (PROJECT.md notes "no local PostgreSQL running; `psql` not on PATH" but doesn't state the target server version). This must be confirmed before pinning `libpg-query`'s PG-version dist-tag and the `postgres:*-alpine` client image tag used for backup/restore.
- **Gap/low-confidence flag:** Context7 MCP tool was not available in this environment; all Drizzle documentation claims were verified instead via direct WebFetch of `orm.drizzle.team` official docs pages plus the GitHub Releases API for version ground truth. This is a reasonable substitute but slightly lower-confidence than a direct Context7 docs query would have been.

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
