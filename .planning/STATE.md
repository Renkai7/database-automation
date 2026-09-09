---
gsd_state_version: "1.0"
current_phase: 05
current_phase_name: CI Pipeline Gate
status: executing
stopped_at: Completed 05-04-PLAN.md
last_updated: "2026-09-09T16:11:19.077Z"
last_activity: 2026-09-09
last_activity_desc: Phase 05 execution started
state_head: 243d895153f054e893c57e18b601307c897b135a
progress:
  total_phases: 7
  completed_phases: 0
  total_plans: 35
  completed_plans: 31
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-09-06)

**Core value:** A schema change reaches production without anyone hand-running SQL, and no AI mistake can destroy production data — because the architecture prevents it, not because anyone remembered to be careful.
**Current focus:** Phase 05 — CI Pipeline Gate

## Current Position

Phase: 05 (CI Pipeline Gate) — EXECUTING
Plan: 5 of 8
Status: Ready to execute
Last activity: 2026-09-09 — Phase 05 execution started

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**

- Total plans completed: 27
- Average duration: - min
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 8 | - | - |
| 02 | 5 | - | - |
| 03 | 7 | - | - |
| 04 | 7 | - | - |

**Recent Trend:**

- Last 5 plans: none yet
- Trend: -

*Updated after each plan completion*
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 01-local-environment P01 | 25min | 3 tasks | 10 files |
| Phase 01 P02 | 20min | 2 tasks | 18 files |
| Phase 01 P03 | 35min | 2 tasks | 5 files |
| Phase 01-local-environment P04 | 20min | 3 tasks | 6 files |
| Phase 01 P05 | 20min | 2 tasks | 10 files |
| Phase 01 P06 | 55min | 2 tasks | 5 files |
| Phase 01 P07 | 25min | 2 tasks | 6 files |
| Phase 01-local-environment P08 | 20min | 2 tasks | 2 files |
| Phase 02 P01 | 55min | 2 tasks | 9 files |
| Phase 02 P02 | 30min | 3 tasks | 6 files |
| Phase 02 P03 | 20min | 3 tasks | 7 files |
| Phase 02 P04 | 55min | 3 tasks | 9 files |
| Phase 02 P05 | 25min | 3 tasks | 6 files |
| Phase 03 P01 | 35min | 3 tasks | 19 files |
| Phase 03 P02 | 29min | 3 tasks | 10 files |
| Phase 03 P03 | 20min | 2 tasks | 14 files |
| Phase 03 P04 | 50 min | 2 tasks | 9 files |
| Phase 03 P05 | 40 min | 3 tasks | 37 files |
| Phase 03-safety-analyzer P06 | ~35min | 3 tasks | 16 files |
| Phase 03-safety-analyzer P07 | 50min | 3 tasks | 9 files |
| Phase 04 P01 | 31min | 3 tasks | 22 files |
| Phase 04-migration-runner-history-tests P02 | 20min | 3 tasks | 22 files |
| Phase 04 P03 | 20min | 3 tasks | 11 files |
| Phase 04 P04 | 17min | 2 tasks | 7 files |
| Phase 04 P05 | 55min | 3 tasks | 11 files |
| Phase 04 P06 | 24 min | 3 tasks | 18 files |
| Phase 04 P07 | 21min | 3 tasks | 8 files |
| Phase 05-ci-pipeline-gate P01 | 14 min | 3 tasks | 3 files |
| Phase 05-ci-pipeline-gate P02 | 35 min | 2 tasks | 1 files |
| Phase 05 P03 | 45min | 3 tasks | 6 files |
| Phase 05 P04 | 20min | 3 tasks | 6 files |

## Accumulated Context

### Decisions

Decisions are logged in `docs/decisions.md` (D1-D12). Recent decisions affecting current work:

- D4 (OPEN): Staging connectivity mechanism — Tailscale subnet-route vs. restricted SSH tunnel. Not settled yet; resolving it is explicit work inside Phase 6, not an assumption carried into it.
- D9 (ACCEPTED): PostgreSQL 17 pinned across dev/staging/production — the Phase 1 environment and the Phase 3 rule catalogue both depend on this being correct.
- D12 (ACCEPTED): The Migration Runner (Phase 4) re-derives classification from the actual SQL immediately before executing — the only architecturally non-bypassable enforcement point. Every earlier gate (pre-commit, even the Phase 5 CI check) sits on a bypassability spectrum and should be described honestly as such.
- [Phase 01-local-environment]: Redeploy investigation confirmed migrate-on-boot in AI-Diagramming-Tool; D8 moved PROPOSED to ACCEPTED and D14 was opened.
- [Phase 01-local-environment]: Pinned @types/node to 24.13.3 instead of the pnpm-resolved latest 26.4.1, to match the installed Node runtime (v24.19.0).
- [Phase 01]: [Phase 01-02] apps/recipe-app ships without 'type: module' — Next 16.3.4's next.config.ts compiler emits CJS, which conflicted with the plan-specified ESM package type
- [Phase 01]: [Phase 01-02] zod installed at the workspace root, not in apps/recipe-app, because scripts/env.ts resolves bare imports relative to its own root-level directory
- [Phase 01]: [Phase 01-02] tests/smoke.test.ts kills its spawned server via taskkill /T /F on win32 to avoid orphaning the nested next-server process that plain execa .kill() left running
- [Phase 01]: [Phase 01-03] seed.ts rewritten to insert through Drizzle's own table objects (drizzle(client,{schema}) over a one-shot pg.Client) instead of raw SQL, so a schema column rename breaks the seed at type-check time.
- [Phase 01]: [Phase 01-04] Installed pg + @types/pg at the workspace root (Rule 3) -- scripts/db-query.ts and scripts/db-reset.ts resolve bare imports from their own directory upward, same pnpm-workspace resolution issue plan 01-02 hit with zod. — pg was only present in apps/recipe-app/node_modules; root-level CLI scripts under scripts/ could not resolve it.
- [Phase 01]: [Phase 01-05] Dropped desktop app-shell 'Kitchen' nav bar; used uniform back/save icon nav row at all breakpoints since the appshell chrome pointed at unbuilt sections (D-07)
- [Phase 01]: [Phase 01-05] Servings stepper always renders in the meta row regardless of active tab, rather than the phone frame's tab-gated placement (documented simplification for the human-check step)
- [Phase 01]: 01-06: Chose the stronger D-16 fix (host+port+database-name as source constants) over a hostname-only allowlist, per 01-VERIFICATION.md's explicit instruction to pick whichever satisfies D-16's literal text. — A hostname-only allowlist still lets .env redirect to a different local database on the same host, which is literally 'another database' reached through an environment override.
- [Phase 01]: [Phase 01] 01-07: scripts/log.ts is deliberately import-free and side-effect-free so it can be imported from a test (or future consumer) without triggering scripts/env.ts's import-time environment validation.
- [Phase 01]: [Phase 01] 01-07: assertMigrationHistoryApplied checks only migration count and recipe-core table presence -- seed row counts stay tests/db-reset.test.ts's own independent responsibility, so the rebuild's self-check is not coupled to fixture data.
- [Phase 01]: [Phase 01-08] Guarded RecipeScreen's servings multiplier against a non-positive base-servings divisor (WR-03 application half); database-level CHECK constraint deferred to Phase 4 (T-01-31).
- [Phase 01]: [Phase 01-08] Made the two Phase 1 REQUIREMENTS.md traceability rows agree (both read 'Gap closure done — awaiting re-verification'); deliberately did not tick any Phase 1 requirement checkbox or mark APP-01 complete despite it being in this plan's own requirements frontmatter, per the plan's explicit prohibition against claiming verified completion on gap-closure work alone.
- [Phase 02]: [Phase 02] 02-01: Used import.meta.main (not process.argv/pathToFileURL) to guard backup.ts/drill.ts CLI entry points -- avoids tripping the plan's own no-target-argument-ok gate while keeping drill.ts able to import and call runBackup() in-process without re-triggering the CLI path.
- [Phase 02]: [Phase 02] 02-01: scripts/drill.ts's runStep logs-and-rethrows instead of process.exit(1) (unlike backup.ts's/db-reset.ts's) so the outer try/finally always stops the disposable Testcontainers container, even on a failed step.
- [Phase 02]: [Phase 02] 02-01: Only BKP-02 and BKP-03 marked complete in REQUIREMENTS.md -- BKP-04 and BKP-07 stay Pending because this plan's own success_criteria frames both as explicitly partial (tiers 1-2 of 4; drill mechanics without the committed pass/fail record).
- [Phase 02]: [Phase 02] 02-02: contentHashes/spotChecks compared via explicit field-order arrays (not raw JSON.stringify of query-result objects) so the comparison never depends on pg driver vs zod parser key-ordering incidentals.
- [Phase 02]: [Phase 02] 02-02: tests/backup-manifest.test.ts updated (Rule 1 deviation, not in this plan's own files_modified) -- its fixture and key-set regression guard needed the three new required manifest fields or pnpm test would break.
- [Phase 02]: [Phase 02] 02-03: restoreIntoDevContainer/verifyRestoredRowCounts exported from scripts/restore.ts and reused by scripts/restore-cluster.ts rather than duplicated -- single place the copy-in/pg_restore/cleanup and row-count-verification logic lives.
- [Phase 02]: [Phase 02] 02-03: db:restore:cluster's pre-flight role check treats the pinned role already existing (this repo's normal docker compose rebuild outcome) as an honest NOT EXERCISED verdict, not an error -- pnpm db:drill is the command that exercises the globals-restore path on every run.
- [Phase 02]: [Phase 02] 02-03: BKP-05 left Pending in REQUIREMENTS.md -- this plan builds the tooling half (argument-free, target-pinned restore commands); the human-performed destruction test is explicitly plan 02-05's job per this plan's own success_criteria.
- [Phase 02]: [Phase 02] 02-04: recordAutomatedDrillResult accepts only the automated outcome -- the human half is read from disk or defaulted to its honest UNKNOWN starting state, never accepted as a parameter, so no code path can set the human fact.
- [Phase 02]: [Phase 02] 02-04: Added an optional onStepTiming callback to scripts/restore.ts's restoreIntoContainer (Rule 3 deviation, outside this plan's own files_modified) to populate the required globalsRestore/dataRestore duration fields without forking the restore logic.
- [Phase 02]: [Phase 02] 02-04: D-20's three-outcome boundary implemented as control flow -- the container-start step sits outside any try/catch leading to a status write, so a never-ran drill structurally cannot touch docs/restore-drill-status.json.
- [Phase 02]: [Phase 02] 02-05: The plan's DROP TABLE recipes CASCADE constraint-gap prediction did not hold on the real run -- pnpm db:restore is a full-database restore, so both foreign keys returned intact; recorded honestly in docs/20-restore-runbook.md rather than reconciled with the original prediction.
- [Phase 02]: [Phase 02] 02-05: Act-2 globals restore verdict was NOT EXERCISED on this machine (rebuilt cluster is never role-empty) -- recorded as a real, open risk in docs/00-current-state.md R1 and the runbook, not closed by the drill's overall PASS.
- [Phase 02]: [Phase 02] 02-05: scripts/restore-cluster.ts's misleading 'final line of output' comment (verdict actually prints second-to-last) recorded in .planning/WINDOWS.md rather than fixed, since the file is outside plan 02-05's files_modified.
- [Phase 03]: [Phase 03] 03-01: libpg-query@17.7.4 exports no PL/pgSQL parsing function at all (no parsePlPgSQL) -- a divergence from 03-RESEARCH.md Pattern 4/Assumption A4, pinned by test/libpg-query-contract.test.ts. Plan 04's D-05 recursion into DO blocks/function bodies must resolve this differently than the research sketched.
- [Phase 03]: [Phase 03] 03-01: analyzeSql checks sql.trim().length === 0 before calling libpg-query's parse(), because parse() rejects empty/whitespace-only text with "Query cannot be empty" rather than resolving with zero statements -- otherwise D-06's empty-input contract would be misreported as a D-08 parse failure.
- [Phase 03]: [Phase 03] 03-01: packages/automation needed its own @types/node devDependency plus an explicit tsconfig "types": ["node"] -- TypeScript 7.0.2's automatic @types walk-up did not resolve node:fs/process in this nested workspace package without it (Rule 3 deviation).
- [Phase 03]: AlterTypeDropValue is permanently unreachable via real SQL -- PostgreSQL's own grammar rejects ALTER TYPE ... DROP VALUE unconditionally at parse time — Confirmed live against libpg-query@17.7.4; kept in StatementKind/rules.json as documentation of FEATURES.md's BLOCKED entry, excluded (with citation) from the per-kind coverage test rather than faked with a hand-built AST
- [Phase 03]: FactMatchSchema extended to accept null as a match value, and RulesFileSchema gained an optional top-level notes field — Rule 2/3 deviations: add-unique-constraint needs usingIndexName:null to distinguish safe forms, and the lock_timeout/statement_timeout exclusion needed a schema-validated place to live rather than being silently stripped
- [Phase 03]: [Phase 03] 03-03: analyze.ts imported node:fs (via loadDefaultRules), violating the plan's own must-have core-purity truth inherited from 03-01 -- extracted loadDefaultRules into a new sibling adapter, src/adapter/default-rules.ts, so src/inspector/, src/classifier/, and src/analyze.ts are now mechanically proven filesystem-free (Rule 1 deviation)
- [Phase 03]: [Phase 03] 03-03: a synchronous process.exit() called immediately after 2+ libpg-query WASM parse() calls in one process reproducibly crashed on this Windows machine with a genuine libuv assertion failure (raw exit code 3221226505) -- cli.ts's main() restructured into run(): Promise<number>, which never calls process.exit(); process.exitCode is applied once run() settles instead, letting the event loop drain naturally (Rule 1 deviation, found by this task's own multi-file CLI verify step)
- [Phase 03]: D-05/D-07 shipped: PL/pgSQL recursion into DO/function bodies via reconstructed statement text fed back through parsePlPgSQL, plus a non-weakenable D07_FLOOR_FACTS floor for unresolvable dynamic SQL
- [Phase 03]: [Phase 03] 03-05: Corpus fixtures derived by execution, not by reading rules.json prose -- every expected verdict/rule-id was produced by running the candidate SQL through the real, installed analyzer in a disposable probe script and reasoning about whether the observed output was correct. This caught two genuine plan-text-vs-analyzer disagreements: (1) the plan's 8th BLOCKED fixture (ALTER TYPE ... DROP VALUE) cannot exist as parseable SQL at all -- PostgreSQL's own grammar rejects it unconditionally (re-confirmed live against libpg-query@18.1.4); blocked/ ships 7 fixtures instead of 8, with the id in the rule-coverage exception list. (2) The plan's literal near-miss control (unvalidated-then-validate pair with a mismatched constraint name) resolves SAFE under the real analyzer, not REVIEW_REQUIRED as predicted, because both halves match unconditionally regardless of pairing (matches 03-02-SUMMARY.md's own documented finding) -- substituted the concurrent-index-then-unique-constraint shape with a mismatched index name instead, which genuinely demonstrates exact-name matching. ANLZ-02 and ANLZ-04 marked complete in REQUIREMENTS.md (all declaring plans -- 03-01/02/03/05 -- now have summaries); ANLZ-07 stays Pending until 03-06 (its other declaring plan) completes.
- [Phase 03]: [Gap closure, post-03-04] Orchestrator spot-check against the real CLI found a false-SAFE defect: do-block-container/create-function-container matched unconditionally on statementKind alone, so a `LANGUAGE sql` (or `BEGIN ATOMIC`, or any non-plpgsql-language) function body was never re-parsed yet still earned SAFE -- confirmed live, e.g. `CREATE FUNCTION g() RETURNS void AS $$ DROP TABLE ingredients $$ LANGUAGE sql;` classified SAFE and exited 0. Fixed in two parts, both TDD RED->GREEN, no PLAN.md (task spec only): (1) StatementFacts gains `bodyInspected`, set truthfully at the single decision point (inspect-plpgsql.ts's new `planContainerBody`); the two container SAFE rules now require `bodyInspected:true`, and a new `container-body-not-inspected` rule (REVIEW_REQUIRED, analyzer-integrity) matches `bodyInspected:false` generically across `statementKind: [DoBlock, CreateFunction]` -- any uninspectable language (plperl, c, future ones) lands there, not a per-language allowlist. (2) `LANGUAGE sql` bodies are now genuinely inspected: dollar-quoted/single-quoted text is re-parsed through the ordinary `parseTopLevel`/`inspectStatement` path (never pattern-matched), and the `BEGIN ATOMIC ... END` form is read directly off `CreateFunctionStmt.sql_body` (probed live against libpg-query@18.1.4: arrives as already-parsed AST nodes, not text). `inspectPlPgSqlBody`/`reconstructPlPgSqlStatement` generalised into `inspectContainerBody`/`planContainerBody`, applied identically at the top level and to a nested container found inside another body. Verified against the real CLI (exit 20/10/0 as expected) in addition to 13 new unit/integration tests. Commits: `399e35f` (RED), `b9c5e64` (GREEN). Full `pnpm test`: 214/214 (201 -> 214); `tsc --noEmit` clean.
- [Phase 03]: D-14 adversarial pair-integrity is a structural corpus-test invariant: a shape with only one half fails the suite, live-verified by temporarily deleting a manifest row and confirming the named failure. — Prevents the false-positive half of the adversarial pairing from quietly rotting away (PITFALLS.md C2), rather than relying on future contributors to remember to add both halves.
- [Phase 03]: D16: recorded the safety analyzer's classification contract in docs/decisions.md as a project-level decision, with both deliberate exclusions and the zod-resolution item as an open Phase 7 task
- [Phase 03]: squawk-cli comparison found no squawk-favouring gap over the 49-file corpus, but squawk missed a real DROP TABLE hidden in a DO block that this analyzer's D-05 recursion caught
- [Phase 03]: [Gap closure, post-03-VERIFICATION.md, no PLAN.md] 03-VERIFICATION.md found that 03-REVIEW.md's CR-01 fix (rejecting an empty `match: {}` rule) closed only the trivial zero-key case -- the SAME blanket-SAFE effect is reachable by enumerating every legal value of a field (most naturally `statementKind`) instead of leaving `match` empty, since `ruleMatches`'s array branch matches unconditionally once every legal value is listed. Reproduced live before any fix: a rule enumerating all 28 shipped `StatementKind` values with verdict SAFE passed both `parseRulesFile` and `assertFloorNotWeakened`, then `classifyFacts({statementKind:"Unrecognized"}, rules)` returned SAFE -- disabling D-06's "SAFE must be earned" default for CLUSTER/REINDEX/ALTER SYSTEM/any uncatalogued DDL, while leaving the D-02/D-07 floor untouched (worst-verdict-wins still protects the eight named floor operations). Closed by building the second load-time self-check 03-REVIEW.md's own CR-01 fix section had proposed and left unbuilt: `floor.ts` gained `D06_UNMATCHED_CANARY_FACTS`/`assertUnmatchedDefaultsToReview`, mirroring `assertFloorNotWeakened`'s re-derive-through-the-real-`classifyFacts` pattern but protecting D-06's REVIEW_REQUIRED default instead of D-02/D-07's BLOCKED floor, wired into `classify.ts`'s `loadRules` alongside it. The canary set is deliberately `EMPTY_FACTS`-based (every field at its neutral default, one field varied per canary) specifically so the check cannot itself be defeated by the same enumeration trick it exists to catch: any rule broad enough to grant blanket SAFE to every uncatalogued statement -- by enumerating any single field's legal-value domain, not just `statementKind` -- necessarily matches at least one canary. `nestingLimitExceeded` was deliberately excluded from the varied fields (a genuinely catalogued BLOCKED case via `nesting-depth-exceeded`, not an unmatched one) to avoid a false positive against the shipped rules file. TDD RED (`d41954f`) -> GREEN (`f7ff627`), one commit per phase, no PLAN.md per this gap-closure task's own instructions. The RED test derives the exploit rule's `statementKind` enumeration from the shipped `rules.json` itself (not a hardcoded 28-value snapshot) so it cannot silently rot. Regression coverage added in `rules-catalogue.test.ts`: the exploit is rejected, the shipped rules file still loads, CLUSTER/REINDEX still classify REVIEW_REQUIRED end-to-end via `analyzeSql`, and the D-02/D-07 floor stays BLOCKED. `pnpm test`: 301/301 (was 296/296); `tsc --noEmit` clean. `03-VERIFICATION.md`'s gap section updated in place (`gap_closure` frontmatter block + inline note) rather than deleted, so the original finding stays the historical record; a full `/gsd-verify-work` re-run is still the authoritative confirmation and has not yet happened.
- [Phase 03]: [Review-fix pass, post-03-07, no PLAN.md] 03-REVIEW.md's two Criticals were both real false-SAFE paths, reproduced live against the real analyzer before any fix: (1) CR-02 -- `inspectAlterTableStmt` inspected only `cmds[0]`, so a multi-subcommand `ALTER TABLE` (e.g. `ADD COLUMN notes text, DROP COLUMN secret_data`) silently discarded every subcommand after the first; `inspectStatement`'s contract changed to `StatementFacts[]` (one entry per subcommand for ALTER TABLE, single-element elsewhere), with `analyze.ts`/`inspect-plpgsql.ts` building one Finding per subcommand and worst-verdict-wins across them. (2) CR-01 -- an empty `match: {}` rule vacuously matched every statement (`Array.prototype.every` on zero conditions), silently granting blanket SAFE to any unmatched statement kind without touching a D-02/D-07 floor rule; `FactMatchSchema` now `.refine`s to reject an empty match object at load time. Also fixed: WR-01 (fixed `$$` PL/pgSQL body-reconstruction delimiter collided with a body's own nested `$$`-tagged literal, turning valid PostgreSQL into a parse failure -- replaced with a collision-verified `$gsd_N$` tag), WR-02 (embedded-statement reparse silently kept only the first statement -- now fails loud via a new `reparseEmbeddedSql` guard unless the reparse yields exactly one statement), WR-04 (`cli.test.ts` mutated the real shipped `rules.json` on disk for its RULES_INVALID case -- removed; that behaviour is already unit-tested via `tracer.test.ts`'s in-memory `loadRules` weakening). WR-03 (pure-core imports reach outside the package boundary via `scripts/log.ts`) deliberately left open per this pass's own instructions -- a tracked Phase-7 extractability concern, not a safety issue. IN-02 (unverified suspicion of a false-SAFE variant of WR-01) investigated with a disposable probe script against the real `libpg-query` package and resolved ABSENT: `parsePlPgSQL` returns one `plpgsql_funcs` entry per embedded DO/FUNCTION construct in the reconstructed text, and `extractEmbeddedSql`'s walk is a deep, generic, unconditional tree traversal, so an injected DROP TABLE in a second embedded construct was still found and classified in every crafted case; the WR-01 fix also makes the underlying truncation mechanism structurally impossible going forward. Corpus fixtures + manifest rows added for the CR-02 case (blocked + safe halves). Every fix was TDD RED->GREEN with its own regression test file and its own atomic commit (`cd33399`, `7f4d505`, `c7e807b`, `fe3b30f`, `a282148`, `bc4c172`). Full `pnpm test`: 296/296 (was 278/278); `tsc --noEmit` clean.
- [Phase 04]: 04-01: Two-phase classify-then-execute in runMigrations (classify all pending migrations before executing any), derived directly from D-08's own wording distinction between 'apply nothing further' (BLOCKED) and 'applying nothing at all' (parse failure). — Only reading that satisfies both D-08 sentences literally; proven via a recording fake client in packages/automation/test/run-migrations.test.ts.
- [Phase 04]: 04-01: User checkpoint decision -- the D-02 no-second-migrate-path guardrail in tests/guardrails.test.ts is unconditional with no per-file allowlist, mirroring the existing drizzle-kit push guardrail idiom exactly. — Six prose mentions reworded (not five -- packages/automation/src/runner/timeouts.ts's own D-15 comment also carried the phrase and was found only once the unconditional whole-source-surface scan ran).
- [Phase 04]: [Phase 04] 04-02: D-17's widened floor covers ALL scopes (session/cluster/database/role) per the checkpoint decision cover-all-scopes -- disarms-timeout-guc matches disarmsTimeout:true unconditionally, so ALTER DATABASE/ALTER ROLE SET are floored, not left as a gap. — User's explicit checkpoint decision: database/role-scoped forms are the MORE dangerous ones since they persist beyond the migration's own session, so Phase 7's production runner inherits the protection rather than the gap.
- [Phase 04]: [Phase 04] 04-02: D06_UNMATCHED_CANARY_FACTS deliberately excludes a disarmsTimeout:true canary (only transactionHostile:true added) -- disarms-timeout-guc matches disarmsTimeout:true unconditionally by design, making that combination a genuinely catalogued BLOCKED case, mirroring the existing nestingLimitExceeded exclusion. — Including it would make assertUnmatchedDefaultsToReview reject the shipped rules file itself (a stronger, not weaker, verdict). Equivalent enumeration-exploit coverage proven instead via timeout-disarm-floor.test.ts and a parallel transactionHostile-enumeration test. Recorded as unmet-truth #4 in WINDOWS.md for transparency against the plan's literal must_haves wording.
- [Phase 04]: [Phase 04] 04-03: tests/history/support.ts is a plain non-test module, not exported-from/imported-into one of the two test files -- importing a *.test.ts file from another duplicates its registered tests in vitest (live-verified: a 2-test fixture became 3).
- [Phase 04]: [Phase 04] 04-03: scripts/history-suite.ts uses stdio: "inherit" on the vitest child process -- execa does not forward a child's stdout/stderr to the parent by default (verified live), so pnpm test:history was silent without it.
- [Phase 04]: [Phase 04] 04-04: decideTransactionPolicy counts hostile findings across the whole array (top-level and nested D-05 findings alike) and refuses on any combination beyond exactly one finding that is hostile -- including two hostile findings sharing one file, since a file is one unit.
- [Phase 04]: [Phase 04] 04-04: applyMigration computes the transaction policy before splitStatements/execution, so a mixed-file refusal is provably zero-statement (proven on the recorded client call sequence, not merely on the thrown error type).
- [Phase 04]: [Phase 04] 04-05: resolveMarker (state -> resolved) is reserved exclusively for db:migrate:recover's own outcome -- the ordinary run-migrations.ts success/failure paths use two new helpers (markMarkerApplied/markMarkerFailed) instead, so a normal successful unwrapped migration still ends up applied. — Required because tests/history/empty-db-full-history.test.ts (04-03, unmodified) asserts every row for a clean run's run_id is applied -- calling resolveMarker on every ordinary success would have broken that pre-existing assertion.
- [Phase 04]: [Phase 04] 04-05: Case A's fixture inserts two steps rows sharing one recipe_id at DIFFERENT positions (0 and 1) so the pre-existing UNIQUE(recipe_id, position) constraint does not block the insert, while the new CREATE UNIQUE INDEX CONCURRENTLY (recipe_id) still genuinely fails. — Real duplicate data is what makes criterion 4's failure genuine rather than artificial fault injection.
- [Phase 04]: [Phase 04] 04-05: Added a direct real-database test for must-have truth 6 (a wrapped failure is self-cleaning and does not block the next run) ahead of Case A, rather than resting only on the implicit proof already present in 04-04's own timeouts-and-concurrently.test.ts Case B/C sequence. — The must-have truth is explicit in the plan; giving it its own direct proof avoids depending on a sibling file's test never being edited or removed.
- [Phase 04]: [Phase 04] 04-06: EXPECTED_FULL_HISTORY_COLUMNS actually lives in tests/history/support.ts, edited there rather than tests/history/empty-db-full-history.test.ts as the plan's read_first named — That is where the constant this task must update actually lives; the test file merely imports it
- [Phase 04]: [Phase 04] 04-06: tests/history/existing-db-newest-only.test.ts's RUN-06 assertion widened from a table-added check to a full schema-shape inequality check — The real newest migrations now alter existing tables' columns rather than creating tables, so the original table-list assumption no longer held
- [Phase 04]: [Phase 04] 04-06: docs/30-squawk-comparison.md updated by hand against a disposable squawk probe over exactly the three new real migrations, never through the full generator script — Regenerating would have destroyed every hand-filled disagreement analysis already committed to that file; followed the CR-02/Phase-4-plan-02 append-at-end precedent already established there
- [Phase 04]: 04-07: BLOCKED demonstration's real generated SQL diverges from the Phase 3 hand-written mirror (quoted identifier, added CASCADE) -- both fixtures kept side by side rather than one replacing the other.
- [Phase 04]: 04-07: pnpm db:reset does not forward db:migrate's own console output (scripts/db-reset.ts's execa call carries no stdio: inherit) -- verified live, confirmed harmless via direct query against runner.migration_runs, recorded as a documentation finding rather than fixed (file outside this plan's files_modified).
- [Phase 04]: 04-07: Did not tick RUN-07/APP-02 checkboxes in REQUIREMENTS.md per this plan's own explicit acceptance criterion -- a deliberate divergence from the generic executor workflow's default close-out behavior.
- [Phase 05-ci-pipeline-gate]: [Phase 05] 05-01: D-03 owner decision accept-all -- every finding in docs/40-public-release-audit.md (3123 rows, all 2784 UNKNOWN_HIGH_ENTROPY entries included) dispositioned ACCEPT-AS-PUBLIC via dated 2026-09-09 sign-off. No history rewrite; SHAs cited by existing phase records keep resolving. Plan 05-02 cleared to proceed. — Decision rests on file-level distribution evidence (single .env.example path ever added, always placeholder-only; findings dominated by planning-doc prose, test fixtures, lockfile hashes/cited SHAs) plus the confirmed fact this project has never connected to a real staging/production database (D2/D3). The sign-off explicitly records that the 3123 rows' individual diff content was not read one by one -- strong evidence, not exhaustive proof of absence, per CLAUDE.md's mark-unverified-UNKNOWN discipline.
- [Phase 05-ci-pipeline-gate]: D-01 authorized (push-now, conditional on re-audit): owner required the pre-publication audit refreshed to live HEAD before the push. Re-ran the scanner (250 commits, 9323 findings), extended the existing accept-all disposition without reopening it, and recorded the bounded residual gap (this refresh's own recording commit is structurally unscanned) before proceeding. — The owner's condition made re-auditing a prerequisite to the irreversible push, not optional diligence -- doing it first kept the audit record honest about what was actually being published.
- [Phase 05-ci-pipeline-gate]: D-02 confirmed public: repository created with --public, and gh repo view reads back visibility PUBLIC, matching D-02's recorded choice rather than the flag alone. — Removes CI-03's plan-tier risk and resolves the Phase 7 environment-protection-bypass blocker; the owner's actual plan tier stays UNKNOWN and is made not to matter.
- [Phase 05]: [Phase 05] 05-03: Fixed pnpm run's stdout banner corrupting the analyzer's JSON output (Rule 1) -- switched scripts/ci/analyze-gate.ts to pnpm exec tsx, found live on the plan's own real CI run (PR #1, run 34372008995).
- [Phase 05]: [Phase 05] 05-03: Real pull request proof (Renkai7/database-automation#1) confirmed the analyze check reports exactly 'analyze' as its check name, gh 2.100.0 is on the runner, and the sticky comment persists as one comment across repeated pushes -- settles 05-RESEARCH.md assumptions A1/A3 for plan 05-08's ruleset config.
- [Phase 05]: 05-04: No production-code deviations; gsd_run check tdd-red-evidence cannot classify Vitest TAP output (missing Node --test summary footer), RED verified manually across all 3 tasks — Vitest tap/tap-flat reporters lack the # tests/# pass/# fail footer parseNodeTestSummary expects; the classifier still lists every failing test name correctly, but misreads the missing footer as zero_tests_discovered even on genuine RED

### Pending Todos

- Brief early investigation into why production redeploys were needed so often historically (root cause still unidentified). Does not block Phase 1-7 since D8 — migrations never run at startup — is a direct fix regardless of cause, but the investigation belongs early (Phase 1) so the fix addresses the real cause.

### Blockers/Concerns

- **Phase 6**: Coolify's actual volume/backup/networking behavior on this specific instance is community-sourced only (MEDIUM confidence) — must be verified hands-on before staging connectivity is trusted, not assumed from GitHub issues/vendor docs alone.
- **Phase 7**: Whether this repository's GitHub plan tier permits disabling environment-protection bypass on a private repo is unconfirmed (documented as public-repo-only on Free/Pro/Team). Until verified, the production REVIEW REQUIRED gate is only conditionally non-bypassable.
- **Phase 7 (honesty constraint, not a defect to fix)**: A solo founder can self-approve a GitHub environment review. The REVIEW REQUIRED gate buys deliberation with assembled context, not independent review — must never be described or implemented as equivalent to a second reviewer.
- Phase 02: executor sandbox permission settings deny Read/Write/Bash access to the committed environment template file and the developer's local (gitignored) environment file -- even a bare directory listing referencing either filename is denied. 02-01 could not add the RECIPE_BACKUP_DESTINATION documentation block to the template or persist it locally; verified end-to-end instead by supplying it as an inline shell variable. Later plans in this phase (02-02..02-05) that also touch either file will hit the same wall -- either grant that permission for future runs, or have a human apply those specific edits manually.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260907-ir1 | Fix UAT gap G-01-2: raise tablet body-copy type scale in recipe-app globals.css | 2026-09-07 | f598dea | [260907-ir1-fix-uat-gap-g-01-2-raise-tablet-body-cop](./quick/260907-ir1-fix-uat-gap-g-01-2-raise-tablet-body-cop/) |
| 260907-r6z | Add decision D15 to docs/decisions.md documenting the proposed packaging/reuse strategy for the backup-restore-drill tooling | 2026-09-07 | 2699dc5 | [260907-r6z-add-decision-d15-to-docs-decisions-md-do](./quick/260907-r6z-add-decision-d15-to-docs-decisions-md-do/) |
| 260908-kdl | tick APP-01 and refresh the REQUIREMENTS.md footer note | 2026-09-08 | 3af8bfb | [260908-kdl-tick-app-01-and-refresh-the-requirements](./quick/260908-kdl-tick-app-01-and-refresh-the-requirements/) |
| 260909-a83 | add guardrail test forbidding ../../../scripts imports from packages/automation/src | 2026-09-09 | 642022d | [260909-a83-add-guardrail-test-forbidding-scripts-im](./quick/260909-a83-add-guardrail-test-forbidding-scripts-im/) |

## Deferred Items

Items acknowledged and deferred at milestone close, most recent first:

| Category | Item | Status | Deferred At | Milestone |
|----------|------|--------|-------------|-----------|
| Advanced Analysis | ADV-01 trace-based lock verification, ADV-02 schema drift detection, ADV-03 pgroll-style expand/contract tooling | Deferred (v2) | Roadmap creation | v1 |
| Platform | PLAT-01 reusable package extraction, PLAT-02 per-app policy config, PLAT-03 multi-app support | Deferred (Phase 8+, out of v1) | Roadmap creation | v1 |

## Session Continuity

Last session: 2026-09-09T16:11:18.976Z
Stopped at: Completed 05-04-PLAN.md
Resume file: None
