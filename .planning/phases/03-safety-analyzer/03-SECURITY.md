---
phase: "03"
slug: "safety-analyzer"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-09-08"
---

# Phase 03 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

Register origin: **authored at plan time**. All seven plan files (`03-01` through `03-07`)
carried a parseable `<threat_model>` block, so this audit verifies that the mitigations named
there exist in the implementation — it does not retroactively construct a register.

Verification depth: **ASVS L1** (`workflow.security_asvs_level: 1`), blocking threshold
`workflow.security_block_on: high`. L1 depth is evidence-of-mitigation-present in the named
component, corroborated by the phase's own test suite (301 tests across 30 files, all passing
at audit time). It is not an L2 boundary-placement review or an L3 end-to-end trace.

---

## Trust Boundaries

Consolidated from the seven plan-time threat models.

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| migration SQL text → analyzer | The entire SQL corpus is untrusted by this project's own threat model: an AI agent authors it. This is the boundary ANLZ-01's real-parser requirement exists to police. | Arbitrary PostgreSQL DDL/DML text |
| `rules.json` → classifier | The policy file is a second, independent untrusted input — an agent editing the SQL can edit the policy in the same pull request (D-02). | Rule definitions: match facts, verdicts, rationales |
| dollar-quoted / procedural body → recursive parser | The most direct evasion route: text PostgreSQL will execute but a shallow analyzer treats as an inert string. | Embedded SQL inside DO blocks and function bodies |
| dynamic `EXECUTE` argument → analysis | Content the analyzer cannot see at all; the boundary where static analysis genuinely ends. | Unresolvable runtime-composed SQL |
| filesystem → adapter | Migration files and the journal are read from disk; a mismatch between them decides whether a migration was actually examined. | Migration `.sql` files, `_journal.json` |
| CLI exit code → CI and audit log | Phase 5 branches on these codes and Phase 7 records them; a collision would silently misreport a verdict. | Integer verdict codes |
| npm registry → workspace | A new development dependency enters the repository; the package name is the only link between the install and the project the research examined. | `libpg-query`, `squawk-cli` package contents |
| spawned squawk process → comparison report | External tool output is parsed and turned into a committed document. | squawk JSON stdout, exit code, signal |
| corpus fixture / manifest → test outcome | The manifest is the expectation of record; a row edited to match a wrong result would make the suite green while the analyzer is wrong. | Expected verdicts and rule ids |

---

## Threat Register

31 unique threats. `T-03-04` appears in both `03-02-PLAN.md` and `03-05-PLAN.md`, and `T-03-SC`
in both `03-01-PLAN.md` and `03-07-PLAN.md` (different supply-chain events); each is recorded
once below with the union of its evidence.

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-03-01 | Tampering | `src/inspector/inspect.ts` | high | mitigate | Classification derives from the real PostgreSQL AST only. Verified: `inspect.ts` contains **zero** `RegExp`, `.match(`, `.replace(` or `.includes(` calls over SQL text (grep count 0). | closed |
| T-03-02 | Tampering | `src/classifier/floor.ts`, `src/rules/rules.json` | high | mitigate | `assertFloorNotWeakened` re-runs all `D02_FLOOR_FACTS` + `D07_FLOOR_FACTS` through the real `classifyFacts` at load time and throws `RulesFileError` on any non-BLOCKED result. `floor.ts:65-77`. | closed |
| T-03-03 | Repudiation | `src/cli.ts`, `parseTopLevel` | high | mitigate | D-08: `AnalyzerParseError` maps to `EXIT_CODES.PARSE_FAILURE` (30) with no classification emitted — `cli.ts:114`, `cli.ts:128-132`. | closed |
| T-03-04 | Tampering | `src/classifier/classify.ts`, `function-volatility.ts` | medium | mitigate | D-06: unmatched operations resolve REVIEW_REQUIRED, never SAFE. Non-weakenable via `assertUnmatchedDefaultsToReview` over 16 `D06_UNMATCHED_CANARY_FACTS` entries (`floor.ts`). Unrecognised default functions resolve to `unknown-function`. | closed |
| T-03-05 | Information Disclosure | `parseTopLevel` error path | low | mitigate | All error text routed through `safeErrorMessage` — `inspect.ts:77-78`, `inspect-plpgsql.ts:405`, `cli.ts:79,162`. No error object serialised or field-walked. | closed |
| T-03-06 | Spoofing | `EXIT_CODES` | medium | mitigate | `types.ts:190-196` — frozen, non-adjacent (0/10/20/30/40); none equals 1, so a generic Node crash cannot be read as a verdict. | closed |
| T-03-07 | Tampering | `applySafeFormPairing` | high | mitigate | `isFloorOperation` checks each finding against `D02_FLOOR_FACTS` before lowering — `classify.ts:70-78`, guard applied per-finding at `classify.ts:114-115`. | closed |
| T-03-08 | Tampering | `classifyFacts` severity resolution | medium | mitigate | Most-severe-wins reduce over all matching rules, rules sorted by id so file order is irrelevant — `classify.ts:40-66`. | closed |
| T-03-09 | Tampering | `rules.json` fact names | medium | mitigate | `test/rules-catalogue.test.ts:184-188` — every rule match key must exist in `VALID_FACT_NAMES` (mirrored `StatementFacts` keys); a mistyped fact name fails the suite. | closed |
| T-03-10 | Repudiation | finding order | low | mitigate | Deterministic sort by statement index then nested path — `analyze.ts:102-104,154` (`compareFindings`). | closed |
| T-03-11 | Spoofing | CLI exit codes | high | mitigate | Same frozen five codes as T-03-06; `test/cli.test.ts` asserts each against its own fixture. | closed |
| T-03-12 | Repudiation | `enumerateMigrationFiles` | high | mitigate | Both mismatch directions are hard errors naming the offender — `drizzle-migrations.ts:11,69-70,83`. A migration not examined can never look like one that passed. | closed |
| T-03-13 | Tampering | core purity | medium | mitigate | `test/adapter.test.ts:20,97-99` asserts no core module's source contains the `node:fs` specifier, keeping the D-11 seam a checked property. | closed |
| T-03-14 | Information Disclosure | CLI report output | low | mitigate | Report emits paths, verdicts, rule ids and rationale only; errors go through `safeErrorMessage`. The analyzer opens no database connection and holds no credential. | closed |
| T-03-15 | Tampering | CLI path arguments | low | **accept** | See Accepted Risks `AR-03-01`. | closed |
| T-03-16 | Tampering | `inspect-plpgsql.ts` | high | mitigate | Embedded SQL is re-parsed through `inspect.ts`'s own `parseTopLevel` — `inspect-plpgsql.ts:60,299`; never interpreted locally. Matched adversarial fixture pairs assert both directions. | closed |
| T-03-17 | Tampering | dynamic `EXECUTE` | high | mitigate | D-07: unresolvable argument is BLOCKED, enforced through `D07_FLOOR_FACTS` in `assertFloorNotWeakened` — no rules edit can lower it (`floor.ts`). | closed |
| T-03-18 | Denial of Service | recursion | medium | mitigate | `MAX_NESTING_DEPTH = 8` (`inspect-plpgsql.ts:67`); exceeding it produces a BLOCKED finding rather than truncated analysis or stack exhaustion (`inspect-plpgsql.ts:382`). | closed |
| T-03-19 | Tampering | container statements | medium | mitigate | `do-block-container` / `create-function-container` rules in `rules.json:202-216` grant SAFE only when `bodyInspected`, with `container-body-not-inspected` covering the negative case. Avoids the permanent-REVIEW friction that manufactures override pressure. | closed |
| T-03-20 | Tampering | corpus coverage | high | mitigate | `test/corpus.test.ts:240-249` — every shipped catalogue rule id must appear in at least one manifest row's `expectedRuleIds`, with justified exceptions themselves validated as real rule ids. | closed |
| T-03-21 | Repudiation | expected values in SQL comments | medium | mitigate | D-13: `test/corpus.test.ts:274-289` scans every corpus `.sql` line comment for verdict words and fails on any hit. | closed |
| T-03-22 | Tampering | shared analyzer state | medium | mitigate | `test/corpus.test.ts:260-270` — full-corpus `Promise.all` run asserted identical to the sequential run, pinning no-mutable-module-state before Phases 4/5 call the library repeatedly in one process. | closed |
| T-03-23 | Tampering | adversarial coverage | high | mitigate | `test/corpus.test.ts:124-156` — `D14_ADVERSARIAL_PAIR_IDS` is an explicit expected list, so a shape missing entirely fails; a pairId group with only one half fails the suite. | closed |
| T-03-24 | Tampering | evasion by quoting and nesting | high | mitigate | Five matched drop/inert pairs shipped under `test/corpus/adversarial/`: `do-block`, `dollar-quoted-string`, `function-body`, `inline-comment`, `quoted-identifier`. | closed |
| T-03-25 | Repudiation | manifest edits | high | mitigate | `03-06-PLAN.md` Task 3 states expected real-migration verdicts up front and requires divergence to be investigated and recorded rather than absorbed into the manifest; `must_haves` carries the same prohibition for adversarial fixtures. Process control, evidenced in the plan and summary rather than in code. | closed |
| T-03-26 | Tampering | reserved churn | medium | mitigate | `03-06-PLAN.md:199,206` — verify command asserts `git status --porcelain` reports no change to `apps/recipe-app/src/db/schema.ts` or `apps/recipe-app/drizzle/`. | closed |
| T-03-27 | Tampering | squawk output parsing | medium | mitigate | `scripts/squawk-comparison.ts:64-96` — `reject: false`; stdout, exitCode and signal read independently. Only unparseable stdout or a signal-terminated process counts as failure, so a non-zero "violations found" exit cannot silently cover a fraction of the corpus. | closed |
| T-03-28 | Repudiation | `docs/30-squawk-comparison.md` | medium | mitigate | Document ships with an explicit preamble on what the comparison does not establish; unestablished items read UNKNOWN rather than being smoothed over. | closed |
| T-03-29 | Tampering | guardrail scope | high | mitigate | `tests/guardrails.test.ts:58-64` — `sourceSurfaceFiles` now enumerates `packages/`, so the connection-string, direct-sync and direct-environment-read checks cover the new package by default. | closed |
| T-03-30 | Elevation of Privilege | squawk as a permanent dependency | low | **accept** | See Accepted Risks `AR-03-02`. | closed |
| T-03-SC | Tampering | `libpg-query` and `squawk-cli` installs | high | mitigate | `libpg-query` audited OK in `03-RESEARCH.md` (Package Legitimacy Audit) and pinned exactly at `18.1.4` in `packages/automation/package.json`. `squawk-cli` was `[SUS]`-flagged on the recency signal and gated behind a blocking, never-auto-approvable human checkpoint in plan `03-07` before install; it sits in `devDependencies`, not `dependencies`. | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-03-01 | T-03-15 | CLI path arguments are not validated against a privilege boundary. The CLI runs with the developer's own privileges and reads only what that user could already read; there is no boundary for a path argument to cross, and the command opens no database connection. **Revisit if the CLI is ever exposed as a service.** | Accepted at plan time in `03-03-PLAN.md` | 2026-09-08 |
| AR-03-02 | T-03-30 | `squawk-cli` remains a development dependency and a one-time calibration per D-15; it is never on the runtime verdict path, so a future compromise of that package cannot influence a verdict. Confirmed present in `devDependencies` only. **Revisit if it is ever promoted into the standing test suite.** | Accepted at plan time in `03-07-PLAN.md` | 2026-09-08 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-09-08 | 31 | 31 | 0 | `/gsd-secure-phase 3` (orchestrator, ASVS L1 short-circuit — no auditor subagent spawned) |
| 2026-09-08 | 31 | 31 | 0 | `/gsd-secure-phase 3` re-audit (State A, ASVS L1 short-circuit — register re-derived from plans, high-severity evidence re-checked) |

### Audit 2026-09-08

| Metric | Count |
|--------|-------|
| Threats found | 31 |
| Closed | 31 |
| Open | 0 |

**Method.** State B (no prior SECURITY.md; plans and summaries present). Register built from the
`<threat_model>` blocks in all seven plan files. Each mitigation was located in the named
component by direct inspection, and the phase test suite was run for behavioural corroboration:
**301 tests across 30 files, all passing.**

**Gap noted — not a threat, a process observation.** None of the seven `*-SUMMARY.md` files
contains a `## Threat Flags` section, and none mentions threats at all. Step 2b of this workflow
had nothing to incorporate. Mitigation evidence was therefore taken entirely from the
implementation rather than from what execution reported about it. This does not leave any threat
open — every mitigation was independently located — but it does mean the summaries carry no
record of threat disposition. Worth closing in future phases so the audit has two independent
sources rather than one.

**Depth caveat.** ASVS L1 verifies that each named mitigation is present and that the suite
covering it passes. It does not establish that a mitigation is placed on every path that reaches
the boundary (L2) or trace a hostile input end to end (L3). Raise
`workflow.security_asvs_level` to 2 via `/gsd-settings` if Phase 5's CI integration should be
audited at boundary-placement depth.

### Re-Audit 2026-09-08 (State A)

| Metric | Count |
|--------|-------|
| Threats found | 31 |
| Closed | 31 |
| Open | 0 |

**Method.** State A — a prior `03-SECURITY.md` existed, so this run audited it rather than
authoring it. The register was re-derived independently from the `<threat_model>` blocks of all
seven plan files rather than read back from the existing document: **31 unique threats**
confirmed, with `T-03-04` again appearing in `03-02` and `03-05` and `T-03-SC` in `03-01` and
`03-07`. No threat present in a plan is missing from the register, and no register row lacks a
plan-file origin. `register_authored_at_plan_time` re-confirmed **true**.

**Re-checked evidence.** Every threat at or above the blocking threshold
(`workflow.security_block_on: high` — 14 threats: T-03-01, -02, -03, -07, -11, -12, -16, -17,
-20, -23, -24, -25, -29, -SC) was re-located in the named component this run, not carried over
on trust. Confirmed directly:

- `src/inspector/inspect.ts` still returns a grep count of **0** for `RegExp` / `.match(` /
  `.replace(` / `.includes(` (T-03-01).
- `assertFloorNotWeakened` still iterates `[...D02_FLOOR_FACTS, ...D07_FLOOR_FACTS]` and throws
  `RulesFileError` — `floor.ts:65-69`; `assertUnmatchedDefaultsToReview` at `floor.ts:145-149`
  (T-03-02, T-03-04, T-03-17).
- `AnalyzerParseError` → `EXIT_CODES.PARSE_FAILURE` at `cli.ts:114,128-132`; `EXIT_CODES` still
  `Object.freeze`d at `types.ts:190-196` with no code equal to 1 (T-03-03, T-03-06, T-03-11).
- `isFloorOperation` guards every lowering site in `classify.ts` (`:138`, `:141`, `:211`), not
  only the entry point (T-03-07).
- Both journal-mismatch directions still throw naming the offender —
  `drizzle-migrations.ts:68-70` and `:82-84` (T-03-12).
- `inspect-plpgsql.ts` still imports and re-enters `parseTopLevel` from `inspect.ts` (`:60`) and
  caps at `MAX_NESTING_DEPTH = 8` (`:67`) (T-03-16, T-03-18).
- All five adversarial drop/inert pairs present under `test/corpus/adversarial/`;
  `D14_ADVERSARIAL_PAIR_IDS` still fails on both a missing shape (`corpus.test.ts:163`) and an
  unexpected one (`:184-185`) (T-03-23, T-03-24).
- `tests/guardrails.test.ts:64` still returns true for `packages/`-prefixed files (T-03-29).
- `libpg-query` pinned exactly at `18.1.4` in `dependencies`; `squawk-cli` present only in
  `devDependencies`, confirming `AR-03-02`'s standing condition still holds (T-03-SC, T-03-30).

**Suite re-run.** `pnpm vitest run` — **301 tests across 30 files, all passing**, identical to
the figures the first audit recorded. No drift.

**Prior gap re-checked, still open as a process observation.** None of the seven
`*-SUMMARY.md` files has gained a `## Threat Flags` section since the first audit, so Step 2b
again had nothing to incorporate and mitigation evidence again rests on a single source (the
implementation) rather than two. Not a threat and not blocking — recorded again so it does not
quietly become the norm for Phase 4 onward.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-09-08 · re-audited 2026-09-08 (State A, register re-derived and
high-severity evidence re-checked independently; no change in status)
