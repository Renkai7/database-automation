# Project Research Summary

**Project:** Database Deployment Automation
**Domain:** PostgreSQL migration safety / deployment-gating system (solo founder, AI-agent-driven development, self-hosted Coolify/Hetzner)
**Researched:** 2026-09-06
**Confidence:** MEDIUM-HIGH

## Executive Summary

This is a migration-safety pipeline: a classifier that reads real Postgres SQL and decides SAFE/REVIEW REQUIRED/BLOCKED, wired into a pipeline that makes BLOCKED mechanically impossible to reach production and REVIEW REQUIRED force a deliberate pause. All four research dimensions converge on the same foundational choice: build the classifier on libpg-query (the real Postgres C grammar compiled to WASM), never on regex/string matching. Regex breaks in both directions on real SQL, missing dangerous statements hidden in dollar-quoted function bodies or conditional DO blocks while false-positiving on comments or quoted identifiers. Every later feature (CI gate, audit record, dashboard) is downstream of the classifier being trustworthy.

Recommended approach: pin drizzle-orm 0.45.2 and drizzle-kit 0.31.10 (stable 0.x line -- the v1.0-rc line removes _journal.json, breaking the audit-trail mechanism this project depends on). Build the Inspector and Classifier as pure functions over a data-driven rules.yaml, reusing squawk-cli rule catalogue as a second opinion rather than reimplementing it. Sequence work so pure logic (Inspector, Classifier, local Runner, backup/restore drill) is built and adversarially tested with zero network/credential exposure before remote connectivity -- staging before production, no production connectivity until the safety architecture is proven. The most important architectural insight: trust boundaries, not logical components, drive the design. Everything upstream of the Migration Runner (pre-commit hooks, CI status checks, even GitHub environment protection rules) sits on a bypassability spectrum; the Runner re-deriving classification from the actual SQL immediately before execution is the only genuinely non-bypassable enforcement point.

Key risks are largely non-technical. Several rules are version-conditional (PG11 changed volatile-vs-non-volatile ADD COLUMN defaults; PG12 changed whether SET NOT NULL needs a full scan) -- the Postgres major version is an unresolved dependency of the rule catalogue and must be pinned before Phase 2. Backup success is not restore success: a pg_dump exit code of 0 proves nothing about recoverability -- roles need a separate pg_dumpall --globals-only, and extension/client-version mismatches produce restores that look complete but are not, so drills must target a genuinely fresh instance and assert content, never exit codes. Most honestly: for a solo founder with no other reviewer, GitHub required reviewers gate can be satisfied by self-approval -- REVIEW REQUIRED buys a deliberate second look with assembled context, not independent review, and should be described that way, not oversold. The single largest risk is process, not technology: there are no real users yet, removing the deadline pressure that normally forces safety work to completion.

## Key Findings

### Recommended Stack

Core stack settled with high confidence: drizzle-orm 0.45.2 + drizzle-kit 0.31.10 (stable 0.x -- never the v1.0 beta/rc line), libpg-query 17.7.4 as the real-parser foundation, testcontainers/postgresql for ephemeral real-Postgres tests (never pg-mem, which is not a real Postgres engine). squawk-cli ships a native Windows binary and is reused as a reference rule set, not the sole engine, since its rules are compiled into a fixed binary rather than the extensible data this project requires. Atlas Community Edition was rejected -- its Postgres-specific destructive-change analyzers moved to a paid Pro tier in late 2025.

Core technologies:
- libpg-query (WASM Postgres parser): foundation of the safety analyzer -- actual Postgres grammar, eliminating "analyzer approved it but Postgres parses it differently" bugs
- drizzle-orm 0.45.2 / drizzle-kit 0.31.10: pinned to stable, not v1 RC, specifically because v1 breaks _journal.json
- squawk-cli: reference rule catalogue, native Windows binary, reused not reimplemented
- testcontainers/postgresql: real disposable Postgres for history and restore-drill tests
- zod, pino, execa: rule-schema validation, structured audit logging, cross-platform process spawning

Unresolved gap: exact PostgreSQL major version for Coolify/production not established -- blocks pinning libpg-query dist-tag and correctly implementing version-conditional rules.

### Expected Features

Real competitor tools (squawk, Strong Migrations, atlas lint, eugene, pgroll) converge on an identical rule catalogue and reject the same two anti-features: automatic down-migrations and startup migrations.

Must have: static SQL classifier as an extensible rule table; lock/statement-timeout wrapping on every execution; NOT VALID + VALIDATE CONSTRAINT and CONCURRENTLY recognition; migration history tested against empty and existing DB; migrations as an isolated pipeline step; CI gate failing on BLOCKED; restore test asserting row counts + schema diff (not exit-code only); audit record on every attempt including failures.

Should have: trace-based (eugene-style) lock verification for REVIEW-tier migrations; self-approval gate with assembled context; status-summary dashboard; scheduled/reported restore drills making a skipped drill visible.

Defer: pgroll-style expand/contract tooling (until manual discipline produces real bugs); multi-project controller (Phase 7 per PROJECT.md); policy-as-code layer (unneeded for one project).

Confirmed anti-features: automatic rollback (cannot represent post-migration data, untested paths break under pressure); blanket ALTER-keyword blocking (causes review fatigue and rubber-stamping); startup migrations (multi-instance races, bypasses the gating pipeline); wrapping all statements in one transaction (breaks CREATE INDEX CONCURRENTLY).

### Architecture Approach

The brief Database Controller sketch draws boxes around logical responsibilities; research redraws it around trust boundaries -- untrusted zone (dev/agent machine), advisory zone (pre-commit hooks, trivially bypassed, never a gate), enforcement zone (CI: Inspector to Classifier to Runner plus audit log), trusted data zone (Postgres reachable only over private network). Environment Manager is not a live component -- it dissolves into connection profiles/credential scopes.

Major components:
1. Migration Inspector -- parses SQL to an operation list; pure, stateless, no DB connection
2. Safety Classifier -- maps operations to SAFE/REVIEW/BLOCKED via data-driven rules.yaml; pure, no DB access
3. Migration Runner -- the only enforcement-side component needing live DB access; re-derives classification from the actual SQL immediately before executing, never trusting an earlier-computed value
4. Schema Snapshot -- pg_dump --schema-only committed to git; a record, not a drift detector (drift detection deferred to a later phase)
5. Audit Log -- append-only sink, not a service; records failed/blocked attempts, not only successes

Recommended connectivity: Tailscale subnet-route advertisement as primary path to staging/production, restricted SSH tunnel as fallback. Never enable Coolify Publicly Accessible toggle.

### Critical Pitfalls

1. Regex-based SQL analysis produces false confidence -- breaks on comments, dollar-quoting, DO blocks, function bodies. Architectural decision (build on libpg-query), not a later patch; test suite must include adversarial inputs.
2. A classification trusted downstream instead of re-derived is not a real gate -- anything between classification and execution (re-triggered workflow, modified artifact, an agent editing rules.yaml or workflow files in the same PR as the dangerous migration) can desync SQL from its classification. The Runner must re-parse and re-classify immediately before executing -- the only architecturally non-bypassable point; every other gate sits on a bypassability spectrum and should be described honestly as such.
3. Several rules are version-conditional and the PG version is unresolved. PG11 changed ADD COLUMN DEFAULT rewrite behavior (only for non-volatile defaults); PG12 lets SET NOT NULL skip its scan only if preceded by a validated NOT VALID check constraint. Must resolve the target version before Phase 2 implements the rule catalogue.
4. pg_dump exit 0 does not prove recoverability. Drills must target a genuinely fresh instance, produce both pg_dumpall --globals-only and the data dump, match production exact image/extensions, and guard against client/server version mismatches -- none of which are visible from an exit code.
5. The safety gate becomes decorative if overrides are cheap. BLOCKED must have no override path into production; REVIEW overrides must be logged with a reason; override frequency per rule should be a visible metric prompting rule fixes, not a silent habit.

Cross-cutting AI-agent pitfalls: hand-editing generated migration SQL instead of regenerating from schema (creates invisible divergence); drizzle-kit push silently dropping columns if ever reachable outside the disposable local dev container.

## Implications for Roadmap

Genuine dependency order: pure logic before network/credential exposure, staging before production, restore competence before anything assumes backups work.

### Phase 0: Environment and Version Pinning
Rationale: Version-conditional rules and the libpg-query dist-tag cannot be correctly set without knowing the target Postgres major version -- flagged as an unresolved gap by three research files.
Delivers: Local Docker Postgres pinned to the confirmed target version/image (including extensions); Drizzle schema/migrate loop working locally; per-environment, non-generic connection variable naming.
Avoids: Pitfalls A3/A5 (rules implemented against wrong version assumption), D5 (ambient connection-string confusion), B3 (extension mismatch discovered only at restore time).

### Phase 1: Backup and Restore Drill
Rationale: The confirmed pre-existing operational risk, with zero dependency on remote connectivity or the classifier -- provable at zero cost against the disposable local DB first.
Delivers: A restore procedure personally performed and timed; automated restore test against a fresh disposable target asserting row counts, schema diff, and spot-checked content.
Addresses: FEATURES.md restore-test and backup-verification table stakes.
Avoids: Pitfalls B1, B2, B3, B4, B7 (silent partial restores, missing roles/globals, extension/version mismatches, exit-code-only false confidence).

### Phase 2: Migration Inspector and Safety Classifier
Rationale: The load-bearing feature every other component consumes; no database/network dependency, can be hardened in parallel with app schema work.
Delivers: libpg-query-based Inspector; Classifier scoring against a data-driven rules.yaml encoding the full BLOCKED/REVIEW/SAFE catalogue.
Uses: libpg-query 17.7.4, squawk-cli as reference, zod for rule-schema validation.
Avoids: Pitfall C1 -- the single most consequential technical decision; test suite must include comments, dollar-quoting, DO blocks, and function bodies as adversarial fixtures.

### Phase 3: Local Migration Runner and History Tests
Rationale: Proves the runtime check is the real gate against a target that costs nothing to break, before any remote environment exists.
Delivers: A Runner that re-derives classification immediately before applying and refuses BLOCKED; migration history tested against empty and existing DB via testcontainers/postgresql; lock/statement-timeout wrapping.
Avoids: Pitfall A7 (missing timeouts causing indefinite hangs); A4/D4 (invalid indexes and journal-entry mishandling after partial failure).

### Phase 4: CI Wiring (non-bypassable PR gate)
Rationale: Once Phase 2-3 logic is trusted locally, this is pure GitHub configuration plus invoking the existing CLI.
Delivers: A required, non-bypassable repository-ruleset status check failing the build on BLOCKED; mechanical checks for hand-edited or already-merged migration files.
Avoids: Pitfalls D1/D2 (schema/SQL divergence, editing already-applied migrations).

### Phase 5: Private Connectivity to Staging
Rationale: The first point where credentials/network exposure matter -- deliberately sequenced after the safety architecture is proven, per PROJECT.md explicit constraint.
Delivers: Tailscale subnet-route (or restricted SSH) connectivity from CI to Coolify-hosted staging Postgres; drizzle-kit push structurally restricted to the local dev container only.
Avoids: Anti-Pattern 3 (public DB port), Pitfall D3 (push reaching a shared database), Pitfall E1 (verify Coolify volume/cleanup behavior before trusting it).

### Phase 6: Production Runner, Environment Protection Gate, and Audit Log
Rationale: Same Runner code, now parameterized by environment/credential; production gate added last since it depends on production existing.
Delivers: GitHub environment protection rule pausing REVIEW REQUIRED migrations for explicit (self-)approval with assembled context; append-only audit record on every attempt including failures; production credential existing only in the production GitHub Environment secret store.
Avoids: Pitfall C2 (decorative override path). State honestly: for a solo founder this gate buys a deliberate second look, not independent review -- self-approval is mechanically permitted by GitHub and should never be described as equivalent to a second reviewer.

### Phase 7+ (deferred)
Schema drift detection, trace-based (eugene-style) lock verification, pgroll-style expand/contract tooling, and the multi-project Database Deployment Controller are all explicitly deferred until a second application or a proven, stable core pipeline justifies their cost.

### Phase Ordering Rationale

- Pure logic before network/credential exposure: Phases 2-3 have zero DB-network dependency and should be hardened while cheap, before Phase 5 introduces anything worth protecting.
- Restore drilling first: Phase 1 is sequenced immediately after environment setup because it is the confirmed pre-existing risk, and the only cost-free moment to learn the procedure is while the data is fake.
- Staging before production, always: matches PROJECT.md explicit sequencing constraint and the architecture research build-order analysis.
- Version pinning up front: three research files independently flag the Postgres major version as an unresolved rule-catalogue dependency; resolving it in Phase 0 avoids rules built on a wrong assumption.

### Research Flags

Needs deeper research during planning:
- Phase 2: exact rules.yaml schema and version-conditional rule boundaries should be re-verified against the confirmed Postgres major version.
- Phase 5: Coolify-specific networking mechanics (subnet-route stability across container recreation, internal DNS) are MEDIUM confidence, community-sourced -- verify hands-on before committing.
- Phase 6: confirm whether this repo GitHub plan tier supports disabling environment-protection bypass on a private repo (documented as public-repo-only on Free/Pro/Team).

Standard patterns (skip research-phase):
- Phase 1: restore-assertion checklist is well-established, HIGH-confidence official-docs practice.
- Phase 3: lock_timeout/statement_timeout and the NOT VALID/VALIDATE CONSTRAINT idiom are extensively documented, unambiguous Postgres mechanics.
- Phase 4: GitHub repository rulesets and required status checks are HIGH-confidence, officially documented.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH on versions (GitHub Releases API, primary source); MEDIUM on ecosystem-tool behavioral claims |
| Features | MEDIUM -- cross-checked against multiple real tools docs/rule catalogues, but no operational data exists (greenfield) |
| Architecture | MEDIUM-HIGH -- GitHub/SSH/Tailscale mechanics HIGH (official docs); Coolify-specific behavior MEDIUM (community reports, evolving product) |
| Pitfalls | HIGH for Postgres locking/DDL/backup mechanics; MEDIUM for Coolify- and Drizzle-tooling-specific failure modes |

Overall confidence: MEDIUM-HIGH. The core technical decision (parse, do not regex) and the core enforcement-honesty finding (re-derive classification at execution time) are corroborated independently across all four research files with high-confidence sourcing. Uncertainty is concentrated in operational/platform specifics (Coolify), not in what to build.

### Gaps to Address

- PostgreSQL major version unresolved -- flagged by STACK.md, FEATURES.md, and PITFALLS.md independently. Must be confirmed in Phase 0 before pinning libpg-query dist-tag and implementing version-conditional rules (PG11 ADD COLUMN defaults, PG12 SET NOT NULL optimization).
- GitHub plan tier vs. environment-protection bypass -- needs direct verification before Phase 6 production gate can be called genuinely non-bypassable rather than conditionally real.
- Coolify volume/cleanup behavior is community-sourced, not verified against this specific instance -- check the actual configuration before Phase 5, not just GitHub issue reports.
- Root cause of the original redeploys-needed-too-often problem is still unidentified per PROJECT.md -- does not block the roadmap since D8 is a direct architectural fix regardless of cause, but worth a brief early investigation.
- No researcher disagreement found on core architectural/technical recommendations -- the four files corroborate each other unusually tightly, which raises confidence but means these conclusions have not been stress-tested against a dissenting source.

## Sources

### Primary (HIGH confidence)
- GitHub Releases API (drizzle-orm, drizzle-kit, squawk) -- direct version/prerelease queries
- Official docs: orm.drizzle.team, docs.github.com (environments, protected branches, rulesets), tailscale.com/docs, postgresql.org

### Secondary (MEDIUM confidence)
- squawkhq.com/docs, atlasgo.io, xata.io (pgroll), kaveland.no/eugene
- Coolify vendor docs and GitHub issue tracker (#8581, #7115)
- Crunchy Data, brandur.org, pgfence, Bytebase engineering blogs
- npm registry queries for libpg-query, testcontainers/postgresql, vitest

### Tertiary (LOW confidence)
- fabianlindfors/reshape maintenance-status characterization (inferred, no formal deprecation notice)
- zixianchen.com blog on Coolify internal DB URLs

---
Research completed: 2026-09-06
Ready for roadmap: yes
