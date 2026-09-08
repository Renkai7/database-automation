# Phase 3: Safety Analyzer - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-07
**Phase:** 3-Safety Analyzer
**Areas discussed:** Rules-as-data trust boundary, Verdict on the unknown, Unit of judgment, Corpus & squawk cross-check

---

## Rules-as-data trust boundary

### How expressive should a single rule be?

| Option | Description | Selected |
|--------|-------------|----------|
| Facts vocabulary | Inspector emits documented facts per operation; rules match by equality/set membership only. New rule for an observable fact is data; a new detection is a code diff plus a test. | ✓ |
| Predicate DSL over the AST | Rules carry condition expressions over the raw parse tree. Maximum extensibility, but a programming language in a config file that cannot be meaningfully schema-validated and fails silently open. | |
| Verdict table only | Inspector both detects and names every situation; rules file is a flat name→verdict map. Simplest, but nothing new is expressible as data. | |

**User's choice:** Facts vocabulary
**Notes:** Recorded as CONTEXT D-01, with a `costly` reversibility rating — the fact names become the vocabulary the rules file, corpus manifest, comparison report and Phase 7 audit records are all written against.

### What stops the rules file from being the bypass?

| Option | Description | Selected |
|--------|-------------|----------|
| Code floor, rules only tighten | A named BLOCKED set is fixed in code; rules may add and raise severity but never lower a floor operation. A weakening rules file fails validation loudly. | ✓ |
| Floor plus fingerprint in the verdict | The floor, plus a rules-file hash carried in every verdict so non-floor weakening is visible after the fact. | |
| No floor — protect the file in CI instead | Rules file is the sole source of truth; weakening edits caught by a Phase 5 required check. | |

**User's choice:** Code floor, rules only tighten
**Notes:** CONTEXT D-02, rated `one-way in intent`. The fingerprint option was not discarded — moved to Deferred Ideas for Phase 7, when an audit record exists to consume it. CI-only protection was rejected because it leaves the analyzer self-weakening until Phase 5 and makes the guarantee a property of configuration rather than of the analyzer.

### What format is the rules file?

| Option | Description | Selected |
|--------|-------------|----------|
| JSON + required rationale | No new dependency (zod already installed); rationale is required because CI-05 needs the reasoning as renderable data, not a comment. | ✓ |
| YAML | Comments allowed, matches ARCHITECTURE.md's sketch; costs a parser dependency and comments are invisible to Phase 5's PR output. | |
| TypeScript module | Type-checked at author time, but it is code that can import, branch and compute. | |

**User's choice:** JSON + required rationale
**Notes:** CONTEXT D-03. Note this diverges from `.planning/research/ARCHITECTURE.md`'s `rules.yaml` sketch — the rationale is the CI-05 requirement, not file-format preference.

### How much of the rule catalogue ships in this phase?

| Option | Description | Selected |
|--------|-------------|----------|
| Full FEATURES §1 catalogue | Complete BLOCKED set, all REVIEW two-step forms, rename/compat category, explicit USUALLY SAFE set. | ✓ |
| Core subset now, grow as data later | BLOCKED set plus only the context-aware forms criterion 2 names. | |
| Full catalogue with worst-case assumptions | Everything, plus an explicit stance that rules depending on unknowable facts assume the dangerous case. | |

**User's choice:** Full FEATURES §1 catalogue
**Notes:** CONTEXT D-04. Claude raised, and the user accepted, that squawk's `require-lock-timeout` / `require-statement-timeout` equivalents are excluded — they describe the session, not the SQL, and RUN-02 makes the Phase 4 runner responsible for them.

---

## Verdict on the unknown

### A DO block or function body contains a real DROP TABLE

| Option | Description | Selected |
|--------|-------------|----------|
| Recurse and classify inside | Re-parse dollar-quoted bodies of DO blocks and CREATE FUNCTION; a DROP inside hits the code floor. | ✓ |
| Do not recurse — whole block BLOCKED | Refuse any block containing DDL without looking inside. Trivially correct in the catching direction; makes trigger-function migrations permanently unsafe. | |
| Recurse, ambiguous inside becomes BLOCKED | Recurse, with anything unresolvable inside a body falling to BLOCKED rather than REVIEW. | |

**User's choice:** Recurse and classify inside
**Notes:** CONTEXT D-05. Accepted cost recorded: PL/pgSQL is a different grammar and this will have edge cases, which is what the D-14 fixture pairs exist to find.

### An operation parses but no rule matches

| Option | Description | Selected |
|--------|-------------|----------|
| REVIEW REQUIRED — SAFE must be earned | Nothing is SAFE unless a rule positively says so; the explicit USUALLY SAFE set carries that weight. | ✓ |
| SAFE — only listed dangers are flagged | Conventional linter behaviour; blind spots become silent passes. | |
| BLOCKED | Maximum caution; makes unfamiliar-but-harmless statements hard stops. | |

**User's choice:** REVIEW REQUIRED — SAFE must be earned
**Notes:** CONTEXT D-06. The deciding argument: every later phase's trust rests on "the analyzer said SAFE" meaning exactly one thing.

### Unresolvable dynamic SQL inside a function body

| Option | Description | Selected |
|--------|-------------|----------|
| BLOCKED | EXECUTE with a string the analyzer cannot resolve could be anything; REVIEW would ask a human to approve unreadable SQL. | ✓ |
| REVIEW REQUIRED | Consistent with the no-match default; keeps BLOCKED strictly for named irreversible operations. | |
| BLOCKED only if fully unresolvable | Constant-fold resolvable arguments and classify the result normally. | |

**User's choice:** BLOCKED
**Notes:** CONTEXT D-07. The constant-folding option was not rejected outright — moved to Deferred Ideas, to revisit only if a legitimate migration is actually blocked by this.

### libpg-query cannot parse the file at all

| Option | Description | Selected |
|--------|-------------|----------|
| Hard failure, not a verdict | Errors, exits non-zero, emits no classification — a fourth outcome distinct from the three verdicts. | ✓ |
| BLOCKED | Single code path downstream; reports an analyzer malfunction as a migration hazard. | |
| REVIEW REQUIRED | Routes to a human; invites approving a file the analyzer never understood. | |

**User's choice:** Hard failure, not a verdict
**Notes:** CONTEXT D-08. Direct precedent cited: `02-CONTEXT.md` D-20 — a drill that could not run is not a skipped drill.

---

## Unit of judgment

### What is the analyzer's window?

| Option | Description | Selected |
|--------|-------------|----------|
| One migration file | Statements classified individually; safe-form pairing resolved within the file. Matches what the runner executes and what Phase 5 renders. | ✓ |
| The pending set | Recognises safe forms split across files; makes a file's verdict depend on what else is pending. | |
| One statement, strictly | Most predictable; makes NOT VALID + VALIDATE permanently unrecognisable as safe. | |

**User's choice:** One migration file
**Notes:** CONTEXT D-09. Consequence recorded rather than left to be discovered: a two-step pattern split across two files reads as the naive form in the first file, which is the shape expand-and-contract takes — flagged for Phase 7.

### How do per-statement verdicts combine, and what is reported?

| Option | Description | Selected |
|--------|-------------|----------|
| Worst wins, all findings always reported | Most severe verdict wins; complete per-statement findings always carried; never short-circuits. | ✓ |
| Worst wins, only the deciding findings | Tighter output; hides the real amount of work behind the first block. | |
| Worst wins, short-circuit on first BLOCKED | Fastest; least useful to read afterwards. | |

**User's choice:** Worst wins, all findings always reported
**Notes:** CONTEXT D-10.

### What does the analyzer take as input?

| Option | Description | Selected |
|--------|-------------|----------|
| SQL text in, result out; thin adapter finds files | Pure core with no filesystem, Drizzle or database knowledge; a separate adapter reads drizzle files against `_journal.json`. | ✓ |
| Analyzer owns migration discovery | One entry point; couples the extractable package to Drizzle's journal format. | |
| Directory in, with a text entry point alongside | Both surfaces first-class; two code paths to keep honest. | |

**User's choice:** SQL text in, result out; thin adapter finds files
**Notes:** CONTEXT D-11, rated `costly` reversibility. The deciding argument is D12: the runner must be able to hand the classifier the exact bytes it is about to execute, not a path.

### What does the analyzer expose to a caller?

| Option | Description | Selected |
|--------|-------------|----------|
| Library first, thin CLI over it | Importable function (D12 requires in-process call), wrapped by a command emitting readable report plus machine JSON with distinct exit codes. | ✓ |
| Library only this phase | Smallest phase; the owner cannot run the analyzer by hand until Phase 5. | |
| CLI first, library extracted later | Fastest to something demonstrable; defers the seam D12 makes non-negotiable. | |

**User's choice:** Library first, thin CLI over it
**Notes:** CONTEXT D-12.

---

## Corpus & squawk cross-check

### Where does the fixture corpus come from?

| Option | Description | Selected |
|--------|-------------|----------|
| Hand-written .sql files, verdict in a manifest | One directory of real SQL plus a committed manifest of expected verdicts and findings; squawk can consume the same directory. | ✓ |
| SQL inline in the test files | Expectation and input read together; squawk needs files on disk, so the corpus stops being a shared artifact. | |
| Expected verdict as a comment header in each file | Self-contained; puts load-bearing data in comments, in the one suite whose purpose includes proving comments inert. | |

**User's choice:** Hand-written .sql files, verdict in a manifest
**Notes:** CONTEXT D-13. Corpus covers the full catalogue, the adversarial pairs, the two genuine Drizzle migrations, and the app-shaped group.

### Is squawk permanent or a calibration exercise?

| Option | Description | Selected |
|--------|-------------|----------|
| Calibration now, committed report | Both tools over the corpus once; every disagreement examined and explained in a committed report. | ✓ |
| Permanent second opinion in the test suite | Catches later drift; makes squawk a forever dependency of the fast suite plus a maintained expected-disagreement list. | |
| Calibration now, plus a script kept for re-running | Middle ground; a command nobody is required to run is a command nobody runs. | |

**User's choice:** Calibration now, committed report
**Notes:** CONTEXT D-15. The permanent-second-opinion option is recorded in Deferred Ideas rather than discarded; keeping a re-runnable comparison command is left to Claude's discretion.

### How is "cannot be fooled in either direction" enforced?

| Option | Description | Selected |
|--------|-------------|----------|
| Matched pairs, enforced by the manifest | Every adversarial shape ships twice — genuinely executable and merely inert text; a shape with one half missing fails the corpus check. | ✓ |
| Both directions covered, pairing not enforced | Simpler manifest; a later shape added with only its catch-direction case passes unnoticed. | |
| Catch-direction is the priority | Cheaper now; false positives are the friction that starts routine overriding. | |

**User's choice:** Matched pairs, enforced by the manifest
**Notes:** CONTEXT D-14.

### Should the corpus mirror the D-11 reserved churn changes?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, as a separate app-shaped fixture group | Generic fixtures stay app-agnostic; a small recipe-shaped group mirrors the reserved SAFE/REVIEW/BLOCKED changes so Phase 4 knows its verdicts in advance. | ✓ |
| No — keep the corpus entirely app-agnostic | Cleanest boundary; Phase 4 discovers its verdicts by running the real changes. | |
| Yes, mixed into the main corpus | More natural to read; couples the extractable package to the fixture app's schema. | |

**User's choice:** Yes, as a separate app-shaped fixture group
**Notes:** CONTEXT D-16. No real schema change is made — `apps/recipe-app/src/db/schema.ts` is untouched this phase.

---

## Claude's Discretion

Recorded in full in CONTEXT.md `<decisions>` § "Claude's Discretion":

- Package name, internal module layout, rules JSON path.
- Concrete fact names and the rule id scheme — with the constraint that rule ids should be stable, since Phase 7 keys its override-frequency count on them.
- Exit-code numbering, and whether findings locate statements by line/column or statement index.
- The JSON result shape, subject to always being complete.
- Filenames and locations of the corpus manifest and the squawk comparison report.
- How deep PL/pgSQL recursion goes beyond what the fixture pairs require.
- Whether the rules file and corpus manifest share a validation module.

## Deferred Ideas

- Rules-file fingerprint carried in every verdict — Phase 7, alongside the audit log.
- squawk as a permanent second opinion in the test suite — revisit if catalogue drift becomes real.
- Constant-folding resolvable EXECUTE arguments — revisit only if a legitimate migration is blocked.
- Widening the window to the pending set for cross-file safe forms — Phase 7 (APP-03).
- Per-application rules overrides / policy layering — already deferred as PLAT-02.
- Any override or bypass mechanism for REVIEW REQUIRED — Phase 5 and Phase 7.
- `eugene trace` lock verification — already deferred as ADV-01 (v2).
- Schema drift detection and committed schema-only snapshots — Phase 7 (ADV-02, D3).

---

*Areas discussed: 4 of 4 selected. No scope creep raised during discussion.*
