# Phase 3: Safety Analyzer - Research

**Researched:** 2026-09-08
**Amended:** 2026-09-08 — `## Open Questions` closed during planning; see that section (now
`## Open Questions (RESOLVED)`) for how each was settled. Note that the exit-code numbering this
research proposed there was **rejected** in favour of a different scheme; read the resolution,
not the recommendation.
**Domain:** PostgreSQL migration-safety static analysis (real-parser AST classification, data-driven rule engine, adversarial testing)
**Confidence:** MEDIUM-HIGH — core stack versions and package legitimacy are tool-verified this session (HIGH); `libpg-query`/PL-pgSQL API shape is web-corroborated but not hands-on-verified in this environment (MEDIUM); one load-bearing correction to the phase's own prior research is sourced directly from official PostgreSQL documentation (CITED, MEDIUM-HIGH).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**The rules file**
- **D-01:** A rule matches a **documented facts vocabulary**, not the raw parse tree. The
  inspector's job is to reduce a parsed statement to a flat set of facts about the operation
  (its kind, the table and column it touches, whether a default expression is volatile,
  whether an index is `CONCURRENTLY`, whether a constraint is `NOT VALID`, and so on). A
  rule matches those facts by equality and set membership only — **no expressions, no
  computed conditions**. Adding a rule for something the inspector can already observe is
  pure data; teaching the analyzer to observe something genuinely new is an inspector change,
  which means a code diff and a test. A predicate DSL over the AST was rejected (unauditable,
  fails silently open). A pure verdict lookup table was rejected as not satisfying ANLZ-03.
  Reversibility: costly — fact names become the vocabulary the rules file, test manifest,
  squawk comparison report, and Phase 7 audit records are all written against.
- **D-02:** A **code floor fixes the BLOCKED verdict for a named set of operations, and the
  rules file cannot lower it.** The floor covers `DROP TABLE`, `DROP SCHEMA`, `DROP DATABASE`,
  `TRUNCATE`, `DROP COLUMN`, and `DELETE`/`UPDATE` without a row-scoping `WHERE`. Rules may
  add rules and raise severity; a rules file that assigns a floor operation anything weaker
  than BLOCKED **fails schema validation loudly and the analyzer refuses to run** — never a
  silent fallback. Protecting the file with a CI check instead was rejected (self-weakening
  until Phase 5 exists). Reversibility: one-way in intent.
- **D-03:** The rules file is **JSON with a required `rationale` field per rule**, validated
  by **zod** (already a workspace dependency at 4.5.4 — no new dependency). CI-05 requires the
  PR to show classification *and* reasoning, so rationale must be structured data. YAML
  rejected (parser dependency; comments invisible to Phase 5 PR output). TypeScript module
  rejected (reopens hardcoded-conditionals problem).
- **D-04:** The **full `.planning/research/FEATURES.md` §1 catalogue ships in this phase** —
  complete BLOCKED set, every REVIEW REQUIRED two-step form (volatile `ADD COLUMN` default,
  `SET NOT NULL`, `ALTER COLUMN ... TYPE`, `UNIQUE` constraint, non-`CONCURRENTLY` index
  creation, unvalidated foreign key), rename/compatibility rules as their own category, and
  the explicit USUALLY SAFE set. **Excluded deliberately:** `require-lock-timeout` /
  `require-statement-timeout` equivalents — session properties, owned by the Phase 4 runner
  (RUN-02), not the SQL. Flagging every migration for this would be a false positive by
  construction.

**Classifying the unknown**
- **D-05:** The analyzer **recurses into nested bodies**. Dollar-quoted bodies of `DO` blocks
  and `CREATE [OR REPLACE] FUNCTION` are re-parsed and their contents classified, so a real
  `DROP TABLE` hidden inside one hits the D-02 floor and is BLOCKED. Refusing every block
  containing DDL without looking inside was rejected (manufactures override pressure).
  Accepted cost: PL/pgSQL is a different grammar — real work, real edge cases.
- **D-06:** **An operation that parses but matches no rule is REVIEW REQUIRED.** SAFE must be
  positively earned by a matching rule. Fail-open-to-SAFE rejected (would make "SAFE"
  ambiguous). Defaulting to BLOCKED rejected (reserving-by-inflation).
- **D-07:** **Unresolvable dynamic SQL is BLOCKED.** An `EXECUTE` whose argument the analyzer
  cannot resolve statically could be anything, including a drop. REVIEW REQUIRED would mean
  asking a human to approve SQL nobody can read. Constant-folding resolvable `EXECUTE`
  arguments deferred, not rejected.
- **D-08:** **A parse failure is a hard error, not a verdict.** If `libpg-query` cannot parse
  the input, it reports the failure, exits non-zero, and emits no classification. Downstream
  consumers handle this as a fourth outcome distinct from the three verdicts. Collapsing into
  BLOCKED would make "the analyzer is broken" indistinguishable from "the migration is
  dangerous" in the Phase 7 audit record.

**Unit of judgment and interface**
- **D-09:** **The window is one migration file.** Safe-form pairing (`NOT VALID` →
  `VALIDATE CONSTRAINT`, `CREATE UNIQUE INDEX CONCURRENTLY` → `ADD CONSTRAINT ... USING
  INDEX`) is resolved within the file. A two-step pattern split across two files reads as the
  naive form in the first file — recorded as expected, not a bug; Phase 7 should expect this
  shape from expand/contract work. Widening the window to the whole pending set rejected.
- **D-10:** **Worst verdict wins, and the complete findings list is always reported.** Never
  short-circuits on first BLOCKED.
- **D-11:** **The classifier core is a pure function of SQL text plus rules** — no filesystem,
  no Drizzle knowledge, no database connection. A separate thin adapter enumerates
  `apps/recipe-app/drizzle/*.sql` against `meta/_journal.json` for file-based entry points.
  Reversibility: costly — this seam is what makes `packages/automation` extractable.
- **D-12:** **Library first, thin CLI over it.** The classifier is an importable function
  (Phase 4 runner calls it in-process — never shells out). A small command wraps it, emitting
  both human-readable and machine JSON, with **distinct exit codes per verdict** plus a
  further distinct non-zero code for D-08's parse failure.

**The corpus and the squawk cross-check**
- **D-13:** The corpus is **hand-written `.sql` files plus a committed manifest** mapping each
  file to its expected verdict and findings. SQL stays readable, the same directory hands to
  `squawk-cli` unchanged. Encoding the expected verdict in a leading SQL comment rejected on
  principle (this suite exists to prove comments are inert). Corpus covers full D-04
  catalogue, D-14 adversarial shapes, the two genuine Drizzle migrations, and D-16.
- **D-14:** **Adversarial fixtures ship as matched pairs, and the manifest enforces the
  pairing.** Every adversarial shape (comment, dollar-quoted string, `DO` block, function
  body, quoted identifier colliding with a keyword) appears twice: hidden-and-executable
  (must be caught) and inert-text-only (must not be flagged). A shape present with only one
  half fails the corpus check.
- **D-15:** **`squawk-cli` is a one-time calibration in this phase, producing a committed
  comparison report** — not a permanent test-suite dependency. Every disagreement is examined
  and explained (analyzer correct / squawk correct / different-by-design).
- **D-16:** The corpus includes a **separate, app-shaped fixture group** mirroring
  `01-CONTEXT.md` D-11's reserved churn: a nullable `notes` column (SAFE), a volatile-default
  or `SET NOT NULL` change (REVIEW REQUIRED), and `DROP TABLE ingredients` (BLOCKED) — written
  against `recipes`/`ingredients`/`steps` fixture SQL, never touching the real schema. Kept
  separate from the generic catalogue fixtures so `packages/automation` stays
  schema-agnostic.

**Carried forward (binding, not re-decided here)**
- `packages/automation/` is created in this phase with its own `package.json` from day one.
- `libpg-query` only — never regex or string matching (D10, ANLZ-01).
- PostgreSQL 17 semantics may be assumed by the rules (D9). The `libpg-query` dist-tag must
  be pinned to match the PG17 server pin, not left on the package default.
- `squawk-cli`'s npm package ships a `win32-x64` binary — runs on this Windows machine with
  no extra setup.

### Claude's Discretion

- The package's exact name, internal module layout, and the file path of the rules JSON
  inside it — constrained only by D-11's pure-core/adapter seam and independent
  extractability.
- The concrete fact names in the D-01 vocabulary, and the rule id scheme — with one
  constraint worth honouring: Phase 7 needs a **per-rule override-frequency count**
  (PROD-04 / roadmap criterion 4), so rule ids should be stable, hand-assigned identifiers
  intended to survive catalogue edits, not positional or generated.
- The exact exit-code numbers for the three verdicts and D-08's parse failure, and whether
  findings locate a statement by line/column or by statement index.
- The JSON result shape, subject to D-10 (always complete) and Phase 5/7 consumption.
- Filenames/locations of the corpus manifest and the D-15 comparison report — the `docs/`
  numbering convention (`00-`, `10-`, `20-`) is the obvious home for the report.
- How far PL/pgSQL recursion goes in practice (nested blocks, exception handlers) beyond what
  D-14's fixture pairs require, and whether recursion is depth-limited.
- Whether the corpus manifest and rules file share a validation module or separate zod
  schemas.

### Deferred Ideas (OUT OF SCOPE)

- Rules-file fingerprint carried in every verdict — revisit Phase 7 (AUD-01…04, override
  frequency).
- `squawk-cli` as a permanent second opinion in the test suite — revisit only if the
  catalogue is edited often enough that silent drift is a real risk.
- Constant-folding resolvable `EXECUTE` arguments — revisit only if a legitimate migration
  is actually blocked by D-07.
- Widening the safe-form-pairing window to the pending set — belongs with Phase 7's APP-03.
- Per-application rules overrides / policy layering — PLAT-02, Phase 8+, out of v1.
- Any override or bypass mechanism for REVIEW REQUIRED — Phase 5/7 work; BLOCKED is
  non-overridable by construction (D-02).
- `eugene trace` lock verification against a live throwaway Postgres — ADV-01 (v2).
- Schema drift detection and committed `pg_dump --schema-only` snapshots — ADV-02, Phase 7.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ANLZ-01 | Migration SQL parsed into an operation list using `libpg-query`, never regex | "Standard Stack" pins `libpg-query@pg17` (17.7.4); "Architecture Patterns → Pattern 1" gives the `parse()` API shape and error handling contract for D-08 |
| ANLZ-02 | Every operation classified SAFE / REVIEW REQUIRED / BLOCKED | "Architecture Patterns → Pattern 2" (fact vocabulary + rule matcher), "Don't Hand-Roll" (D-06 unmatched-defaults-to-REVIEW is the mechanism) |
| ANLZ-03 | Classification rules are a schema-validated data file, extensible without code changes | "Architecture Patterns → Pattern 3" (zod rule schema + D-02 floor self-check at load time), "Code Examples" (rules JSON shape) |
| ANLZ-04 | Context-aware classification: volatile vs non-volatile `ADD COLUMN` defaults, `NOT VALID`+`VALIDATE CONSTRAINT`, `CONCURRENTLY` | "Common Pitfalls → Pitfall 1" (the STABLE-vs-VOLATILE correction — load-bearing for getting this requirement right), "Architecture Patterns → Pattern 2" (defaultVolatility fact + static function-volatility table) |
| ANLZ-05 | Adversarial fixtures (comments, dollar-quoted strings, `DO` blocks, function bodies) prove the analyzer cannot be fooled in either direction | "Architecture Patterns → Pattern 4" (PL/pgSQL recursion mechanics), "Common Pitfalls → Pitfall 2" (embedded-SQL re-parse gap), "Code Examples" (adversarial fixture pair shape) |
| ANLZ-06 | Analyzer output cross-checked against `squawk-cli` on a shared corpus, disagreements investigated | "Architecture Patterns → Pattern 5" (squawk invocation + JSON reporter), "Package Legitimacy Audit" (squawk-cli verdict) |
| ANLZ-07 | A real `DROP TABLE` is blocked and a genuinely safe migration passes, by test | "Validation Architecture" (req→test map), "Code Examples" (corpus manifest + floor self-test) |
</phase_requirements>

## Summary

This phase's own `03-CONTEXT.md` already carries sixteen binding decisions (D-01…D-16) that
settle architecture, file format, and process — that work does not need to be redone here.
What this research adds is the implementation-level detail the planner needs to turn those
decisions into tasks: the actual `libpg-query` API surface (`parse()` for top-level SQL,
`parsePlPgSQL()` for the nested-body recursion D-05 requires), a concrete fact-vocabulary and
rule-schema design that satisfies D-01/D-02/D-03 together, and — the one genuinely new
finding — a **correction to a claim repeated in this project's own prior research**: PITFALLS.md
and FEATURES.md both group `now()`/`clock_timestamp()` together as "volatile," but
`now()`/`current_timestamp` are PostgreSQL-classified **STABLE**, and PostgreSQL's own
documentation states the PG11 fast-default optimization applies to any **non-volatile**
default — STABLE included, not only IMMUTABLE. Classifying a `DEFAULT now()` column add as
REVIEW REQUIRED would misfire ANLZ-04's own stated test case and manufacture exactly the
review-fatigue D-04 warns against. This is corrected with a direct quote from
`postgresql.org` below.

Because the classifier has no database connection (D-11), function volatility cannot be
looked up from `pg_proc` at runtime — it must be a **static, curated table** the inspector
ships in code, covering the built-in functions realistically found in a `DEFAULT` expression.
An unrecognized function name must resolve to "unknown volatility," which D-06 already
handles correctly (unmatched → REVIEW REQUIRED, not SAFE) — this is a case where D-06's
general policy quietly closes a gap that would otherwise need a separate rule.

The other genuinely open technical question is how deep the D-05 recursion actually goes:
`libpg-query`'s PL/pgSQL parser (`parsePlPgSQL`) produces a structural tree for control flow
and variable declarations, but embedded SQL statements inside that tree (an `EXECUTE`d
statement, an `INSERT`/`UPDATE`/`SELECT` inside a `PLpgSQL_stmt_execsql` node) are carried as
**raw query-text fields**, not as further-parsed AST nodes — the recursive step is: extract
that text, feed it back through `parse()`, and classify the result exactly as if it were a
top-level statement. This is real, documented complexity (independently corroborated by
`pglast`'s own docs, which describe the identical gap in the Python binding built on the same
C library) and the planner should budget a dedicated spike/prototype task for it rather than
treating it as a subtask of "write the inspector."

**Primary recommendation:** build the classifier exactly as `03-CONTEXT.md` specifies —
`libpg-query@pg17` → facts → zod-validated JSON rules with a code-enforced BLOCKED floor
self-tested at load time — and budget the PL/pgSQL recursion (`parsePlPgSQL` + re-parse of
embedded query text) as its own task with its own adversarial fixtures, not as an
afterthought to the top-level classifier.

## Architectural Responsibility Map

This project has no browser/CDN/SSR tiers — it is a backend automation library consumed by a
CLI and (from Phase 4 onward) by an in-process runner. The standard web-tier table is adapted
accordingly.

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| SQL → AST parsing | `packages/automation` (library core) | — | D-11: pure function, no I/O; must run identically locally and in CI |
| Fact extraction (inspector) | `packages/automation` (library core) | — | D-01: the facts vocabulary is the seam between "what changed" and "was it flagged" |
| Rule matching / verdict computation | `packages/automation` (library core) | — | D-01/D-02: equality/set-membership only; the BLOCKED floor is enforced here, in code |
| Rules data (JSON) | `packages/automation` (data file, versioned in git) | — | D-03: data, not code — but still lives inside the extractable package, not the app |
| PL/pgSQL recursion (DO/function bodies) | `packages/automation` (library core) | — | D-05: same purity constraint as top-level parsing; no DB needed for `parsePlPgSQL` |
| Corpus fixtures + manifest | `packages/automation` (test fixtures) | — | D-13: shared artifact both this analyzer and `squawk-cli` consume unchanged |
| squawk cross-check | Dev-only script / one-time report generator | `packages/automation` (invokes the classifier as a library) | D-15: not a runtime dependency of the classifier itself, but its comparison logic calls into the same package |
| CLI surface (`analyze`, exit codes) | Thin wrapper over `packages/automation` | Root `package.json` script (`db:*` convention) | D-12: library first, CLI is presentation |
| Adapter (enumerate `drizzle/*.sql` + journal) | `packages/automation` (adapter module, NOT the core) | `apps/recipe-app` (source of the files it reads) | D-11: the only piece of this phase allowed to touch the filesystem/Drizzle conventions |
| Consumer: in-process classification at execution time | Phase 4 (Migration Runner) | — | Out of scope this phase — D12 already requires this be importable, not shelled out to |
| Consumer: PR rendering of verdict + rationale | Phase 5 (CI) | — | Out of scope this phase — D-03's `rationale` field exists specifically to feed this |
| Consumer: override-frequency audit | Phase 7 | — | Out of scope this phase — this is why rule ids must be stable now |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `libpg-query` | `17.7.4` via the `pg17` dist-tag `[VERIFIED: npm registry — confirmed via \`npm view libpg-query dist-tags --json\` this session; dist-tag \`pg17\` = \`17.7.4\`, same value as \`latest\`]` | Real PostgreSQL grammar compiled to WASM — the parser the classifier is built on (ANLZ-01) | D10 already settled this is the only acceptable parsing mechanism; the WASM-only packaging line removes the historical Windows node-gyp build failures the phase's own STACK.md flags |
| `zod` | `4.5.4` `[VERIFIED: npm registry — \`npm view zod version\` = 4.5.4, matches the already-installed root workspace dependency; \`gsd_run query package-legitimacy check\` returned verdict SUS with reason "too-new" despite 246.7M weekly downloads and the canonical \`colinhacks/zod\` repo — see Package Legitimacy Audit note below]` | Validates the D-03 rules JSON and (optionally) the D-13 corpus manifest | Already a workspace dependency (root `package.json`); no new install. Matches the existing `scripts/env.ts`/`scripts/backup-manifest.ts` zod-schema style already established in this repo |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `squawk-cli` | `2.64.0` `[VERIFIED: npm registry — \`npm view squawk-cli version\` = 2.64.0; \`optionalDependencies\` confirmed to include \`@squawk-cli/win32-x64\`: 2.64.0 via \`npm view squawk-cli optionalDependencies --json\`]` | One-time (D-15) comparison corpus run, dev dependency only | Never a runtime dependency of the classifier — invoke it from a standalone comparison-report script, not from the library core |
| `execa` | `10.0.1` `[VERIFIED: npm registry — \`npm view execa version\` = 10.0.1, matches the already-installed root workspace \`^10.0.1\`]` | Spawns `squawk.exe` for the D-15 comparison report | Already a workspace dependency; matches this repo's existing convention (`scripts/restore.ts`/`restore-cluster.ts` already use it to spawn `pg_dump`/`pg_restore`) |
| `vitest` | `5.0.0` (installed) | Runs the corpus/adversarial test suite | Already the project's only test runner; `libpg-query` is WASM and needs no Docker, so this phase's tests belong in the fast default suite (`vitest.config.ts`), never `vitest.drill.config.ts` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `libpg-query`-based custom classifier | Adopt Atlas `migrate lint` wholesale | Rejected project-wide (D10) — the Postgres-specific destructive-change analyzers this project needs are Pro-gated as of late 2025 |
| `squawk-cli` as one-time calibration | `squawk-cli` as permanent CI dependency | Rejected by D-15 as the default — its rule set is fixed/compiled, not this project's extensible-data model; revisit only if catalogue drift becomes a real risk (Deferred) |
| Static classification only | `eugene trace` (live-DB lock tracing) | Explicitly out of scope this phase (no DB connection, D-11) and deferred project-wide as ADV-01 (v2); also no Windows binary |
| JSON rules file | YAML rules file | Rejected by D-03 — comments (YAML's advantage) are invisible to Phase 5's PR rendering, so a structured `rationale` field is needed regardless, closing the gap YAML would have filled |

**Installation:**
```bash
pnpm --filter automation add libpg-query@pg17
pnpm --filter automation add -D squawk-cli
# zod and execa are already root workspace dependencies — no new install needed if
# packages/automation resolves them via the workspace root (matches how apps/recipe-app
# currently resolves zod per docs/decisions.md's own note on root-level installs, Rule 3).
```

**Version verification performed this session:**
- `npm view libpg-query dist-tags --json` → `pg17: "17.7.4"` (matches `latest`).
- `npm view squawk-cli version` → `2.64.0`; `npm view squawk-cli optionalDependencies --json`
  confirms `@squawk-cli/win32-x64` at the same version.
- `npm view zod version` → `4.5.4` (matches installed).
- `npm view execa version` → `10.0.1` (matches installed).
- `npm view drizzle-orm`/`drizzle-kit` not re-queried this session — already confirmed installed
  at `0.45.2`/`0.31.10` in `apps/recipe-app/package.json`, matching D11 in `docs/decisions.md`.

## Package Legitimacy Audit

| Package | Registry | Age (latest publish) | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|----------------------|-----------|--------------|---------|-------------|
| `libpg-query` | npm | Published 2026-07-21 | 685,374/wk | `github.com/constructive-io/libpg-query-node` | OK | Approved |
| `squawk-cli` | npm | Published 2026-09-01 | 446,754/wk | `github.com/sbdchd/squawk` | **SUS** (reason: `too-new`) | Approved, flagged — see note |
| `zod` | npm | Published 2026-08-29 | 246,731,317/wk | `github.com/colinhacks/zod` | **SUS** (reason: `too-new`) | Approved, flagged — see note; already an installed workspace dependency, no new install action |

**Packages removed due to `[SLOP]` verdict:** none.
**Packages flagged as suspicious `[SUS]`:** `squawk-cli`, `zod` — both flagged only on the
`too-new` signal (time since the package's **latest version** was published, not the
package's age or trustworthiness). Both have well-established, canonical GitHub source repos
matching their npm listing and download counts in the hundreds of thousands to hundreds of
millions per week — the `too-new` signal here is a **recency-of-latest-release** false
positive on two actively-maintained, high-adoption packages, not a hallucination/typosquat
signal. `zod` is already an installed root workspace dependency (present before this phase),
so no new install action is gated on it. `squawk-cli` **is** a new dev-dependency install for
this phase — per the gate protocol, **the planner must still add a `checkpoint:human-verify`
task before `pnpm add -D squawk-cli`** despite this assessment, since the gate's own rule is
mechanical (any SUS verdict requires the checkpoint) and this note is not a substitute for
that step.

## Architecture Patterns

### System Architecture Diagram

```
                     ┌─────────────────────────────────────────────┐
                     │  Migration .sql file (top-level SQL text)    │
                     │  apps/recipe-app/drizzle/000N_*.sql          │
                     │  OR a hand-written corpus fixture (D-13)     │
                     └───────────────────┬───────────────────────--┘
                                          │  read as bytes (adapter only, D-11)
                                          ▼
                     ┌─────────────────────────────────────────────┐
                     │  libpg-query `parse(sql)`                    │
                     │  → { version, stmts: [{ stmt: {...} }] }     │
                     │  Failure here = D-08's fourth outcome,       │
                     │  never a verdict.                            │
                     └───────────────────┬───────────────────────--┘
                                          │  per top-level statement
                                          ▼
              ┌───────────────────────────────────────────────────┐
              │  INSPECTOR — statement → facts (D-01)               │
              │  statementKind, table, column, defaultVolatility,   │
              │  concurrently, notValid, hasWhereClause, ...        │
              │                                                      │
              │  If statement is DoStmt or CreateFunctionStmt:       │
              │    → parsePlPgSQL(statementSQL)                     │
              │    → walk PLpgSQL_stmt_execsql / _stmt_exec_sql      │
              │      nodes, extract embedded query text              │
              │    → RECURSE: feed text back into `parse()`         │
              │      (D-05) — same inspector, same rule pass         │
              │    → EXECUTE with unresolved dynamic argument         │
              │      → synthesize an "unresolved-dynamic-sql" fact   │
              │      (D-07, no recursion possible — nothing to parse)│
              └───────────────────┬───────────────────────────────-┘
                                   │  fact set(s), tagged with sourceContext
                                   │  (top-level / inside-do-block / inside-function)
                                   ▼
              ┌───────────────────────────────────────────────────┐
              │  CLASSIFIER — facts + rules.json → verdict (D-02)   │
              │  1. Load rules.json, zod-validate (D-03)             │
              │  2. LOAD-TIME SELF-CHECK: run each D-02 floor        │
              │     operation's canonical fact set through the       │
              │     loaded rules; any non-BLOCKED result             │
              │     → refuse to start (D-02, "fails loudly")         │
              │  3. Per statement: first matching rule wins;          │
              │     no match → REVIEW REQUIRED (D-06)                │
              │  4. Same-file pairing pass (D-09): NOT VALID +        │
              │     VALIDATE CONSTRAINT, CREATE UNIQUE INDEX          │
              │     CONCURRENTLY + ADD CONSTRAINT USING INDEX         │
              └───────────────────┬───────────────────────────────-┘
                                   │  per-statement findings, always complete (D-10)
                                   ▼
              ┌───────────────────────────────────────────────────┐
              │  RESULT — file verdict = worst statement verdict    │
              │  { verdict, findings[], parseError? }                │
              └───────┬───────────────────────────┬─────────────--┘
                      │                             │
                      ▼                             ▼
        ┌───────────────────────┐    ┌─────────────────────────────┐
        │ CLI (`analyze` cmd)    │    │ Phase 4 Runner (future,      │
        │ human report + JSON    │    │ in-process import, D12)      │
        │ distinct exit codes    │    │ — NOT built this phase       │
        │ per verdict + parse    │    └─────────────────────────────┘
        │ failure (D-08, D-12)   │
        └───────────────────────┘

   Parallel, one-time (D-15):
   ┌────────────────┐      ┌──────────────┐      ┌───────────────────────┐
   │ Corpus (D-13)   │─────▶│ This analyzer│      │ squawk-cli --reporter  │
   │ .sql files +    │      │ (as a library│      │ json (spawned via      │
   │ manifest.json   │      │ call)        │      │ execa)                 │
   └────────────────┘      └──────┬───────┘      └───────────┬───────────┘
                                    │                          │
                                    └──────────┬───────────────┘
                                               ▼
                                 ┌───────────────────────────────┐
                                 │ Comparison report (committed)  │
                                 │ every disagreement explained    │
                                 └───────────────────────────────┘
```

### Recommended Project Structure

`03-CONTEXT.md` leaves the exact module layout to discretion, constrained only by D-11's
pure-core/adapter seam. The prior-phase `ARCHITECTURE.md` sketch (`inspector/`, `classifier/`,
`rules/`) is a reasonable starting point, adjusted for `01-CONTEXT.md` D-01's workspace seam
(package lives at `packages/automation/`, not `automation/` at repo root):

```
packages/automation/
├── package.json                 # its own manifest from day one (01-CONTEXT.md D-02)
├── src/
│   ├── inspector/                # statement -> facts (D-01), pure, no I/O
│   │   ├── inspect.ts            # top-level: calls libpg-query parse()
│   │   ├── inspect-plpgsql.ts    # D-05: parsePlPgSQL() + embedded-SQL recursion
│   │   └── function-volatility.ts# static curated table (see Pitfall 1)
│   ├── classifier/                # facts + rules.json -> verdict (D-02)
│   │   ├── classify.ts
│   │   ├── rules-schema.ts       # zod schema (D-03)
│   │   └── floor.ts              # D-02 code floor + load-time self-check
│   ├── rules/
│   │   └── rules.json            # the extensible data file (D-03)
│   ├── adapter/                   # ONLY module allowed filesystem/Drizzle knowledge (D-11)
│   │   └── drizzle-migrations.ts # enumerates apps/recipe-app/drizzle/*.sql + journal
│   └── cli.ts                     # thin wrapper (D-12), distinct exit codes
├── test/
│   ├── corpus/                    # D-13: hand-written .sql fixtures
│   │   ├── manifest.json          # D-13/D-14: file -> expected verdict/findings
│   │   ├── blocked/
│   │   ├── review-required/
│   │   ├── safe/
│   │   ├── adversarial/           # D-14: matched hidden/inert pairs
│   │   └── app-shaped/            # D-16: recipes/ingredients/steps fixture SQL
│   └── *.test.ts
└── scripts/
    └── squawk-comparison.ts       # D-15: one-time report generator (dev-only)
```

### Pattern 1: `libpg-query` top-level parsing (ANLZ-01, D-08)

**What:** Parse a migration file's SQL text into an array of top-level statement ASTs.
**When to use:** The entry point for every top-level statement in a migration file, and the
re-entry point for every embedded SQL string recursed into per D-05.

```typescript
// Source: constructive-io/libpg-query-node README (WebFetch, cross-checked against a second
// independent fetch of the same repo) — [CITED: github.com/launchql/libpg-query-node, MEDIUM
// confidence per the research-plan seam's classify-confidence for a single-fetch webfetch
// source; corroborated by a second independent fetch of the same content]
import { parse } from "libpg-query";

// parse() is async and returns { version: number, stmts: Array<{ stmt: Record<string, unknown> }> }.
// Per the general shape of WASM-bound parser bindings (not directly observed failing in this
// session — [ASSUMED], flag for an early spike task): an unparseable input causes the returned
// promise to reject rather than resolve with an empty/partial result. D-08 requires this
// rejection be caught explicitly and turned into the fourth outcome, never swallowed into a
// verdict.
export async function parseTopLevel(sql: string): Promise<ParsedStatement[]> {
  let result: { version: number; stmts: Array<{ stmt: Record<string, unknown> }> };
  try {
    result = await parse(sql);
  } catch (error) {
    // D-08: a hard error, not a verdict. safeErrorMessage (scripts/log.ts) already establishes
    // this repo's "never leak more than an Error's own .message" convention — reuse it here
    // rather than reintroducing a second definition of the same rule.
    throw new AnalyzerParseError(safeErrorMessage(error));
  }
  return result.stmts.map((entry) => entry.stmt);
}
```

**Open item for the planner:** the exact rejection shape (does `parse()` throw a plain `Error`,
or something with a `.cursorPosition`/`.message` PostgreSQL-style parse-error payload?) was not
directly observed this session — no Node.js execution environment with `libpg-query` installed
was available to verify by actually feeding it malformed SQL. Budget this as the first thing a
spike task confirms, since D-08's "report the failure" contract depends on knowing what shape
that failure actually is.

### Pattern 2: Fact vocabulary and the volatile-default correction (ANLZ-04, D-01)

**What:** The concrete starting fact vocabulary D-01 requires, and the single highest-value
correction this research found.

**Fact vocabulary (starting proposal, Claude's Discretion per CONTEXT.md):**

| Fact | Type | Derived from |
|------|------|--------------|
| `statementKind` | enum (`DropTable`, `DropSchema`, `DropDatabase`, `Truncate`, `DropColumn`, `DeleteNoWhere`, `UpdateNoWhere`, `AddColumnWithDefault`, `AddColumnNullable`, `SetNotNull`, `AlterColumnType`, `AddUniqueConstraint`, `CreateIndex`, `AddForeignKey`, `RenameColumn`, `RenameTable`, `CreateTable`, `CommentOn`, `AddCheckConstraintNotValid`, `ValidateConstraint`, `Unrecognized`) | AST node type + subcommand discrimination (e.g. `AlterTableStmt.cmds[].subtype`) |
| `schema`, `table`, `column` | string \| null | AST relation/column-def nodes |
| `concurrently` | boolean | `IndexStmt.concurrent` / `DropStmt` concurrent flag |
| `notValid` | boolean | `Constraint.skip_validation` |
| `defaultVolatility` | enum (`none`, `literal`, `immutable`, `stable`, `volatile`, `unknown-function`) | see below |
| `hasWhereClause` | boolean | `DeleteStmt.whereClause` / `UpdateStmt.whereClause` presence |
| `sourceContext` | enum (`top-level`, `do-block`, `function-body`) + nesting depth | set by the recursive inspector step (D-05) |
| `dynamicSqlUnresolved` | boolean | `EXECUTE` whose argument is not a string literal / constant-foldable expression (D-07) |

**The correction (load-bearing for `defaultVolatility`):** the phase's own prior research —
`.planning/research/PITFALLS.md` Pitfall A3 ("volatile defaults (`random()`, `now()`/
`clock_timestamp()`, `nextval()` ...")  and `.planning/research/FEATURES.md` §1 (same
grouping) — both list `now()` alongside genuinely volatile functions. This is incorrect.
PostgreSQL's official documentation states, verbatim:

> "When a column is added with `ADD COLUMN` and a non-volatile `DEFAULT` is specified, the
> default value is evaluated at the time of the statement and the result stored in the
> table's metadata... In neither case is a rewrite of the table required."
> "Adding a column with a volatile `DEFAULT` (e.g., `clock_timestamp()`)... will cause the
> entire table and its indexes to be rewritten."
> `[CITED: postgresql.org/docs/current/sql-altertable.html, MEDIUM-HIGH — direct WebFetch of
> the official documentation page, cross-checked against an independent WebSearch summarizing
> the identical distinction from a second source (EnterpriseDB's own blog on PG11 defaults)]`

`now()` and `current_timestamp` are PostgreSQL-catalogued **STABLE**, not VOLATILE — STABLE
functions are evaluated **once** at `ALTER TABLE` time and the single resulting value is
stored in `pg_attribute.attmissingval`, exactly like a literal. The correct threshold is
**VOLATILE vs non-volatile (STABLE or IMMUTABLE both qualify for the fast path)**, not
"has a function call" vs "is a literal." Classifying `DEFAULT now()` as REVIEW REQUIRED would
be a **false positive** — the exact "blanket blocking produces review fatigue" anti-pattern
`FEATURES.md` §6 itself warns against, self-inflicted by a wrong fact.

**Because the classifier is a pure function with no database connection (D-11), function
volatility cannot be looked up from `pg_proc` at runtime.** It must be a small, static, curated
table shipped in code (`function-volatility.ts` in the structure above):

```typescript
// [ASSUMED — general PostgreSQL built-in-function knowledge, cross-checked for random()/
// gen_random_uuid()/now() specifically via WebSearch this session against postgresql.org
// mailing-list threads and pgpedia.info; NOT independently re-verified for every entry below.
// This table is a starting point for a task, not a verified-complete catalogue — treat as a
// draft the implementer expands as adversarial fixtures surface gaps.]
export const KNOWN_VOLATILE_FUNCTIONS = new Set([
  "clock_timestamp", "statement_timestamp", "transaction_timestamp",
  "random", "random_normal", "gen_random_uuid", "uuid_generate_v4",
  "nextval", "txid_current", "pg_backend_pid",
]);
export const KNOWN_STABLE_FUNCTIONS = new Set([
  "now", "current_timestamp", "current_date", "current_time", "localtimestamp",
]);
// Anything not in either set (including any user-defined function — this project has none
// today, but a future migration could reference one) resolves to "unknown-function". D-06
// already handles this correctly: no matching rule -> REVIEW REQUIRED, never SAFE. This is a
// case where D-06's general policy closes a gap without needing a dedicated rule for it.
```

### Pattern 3: Rule schema and the D-02 floor as a load-time self-check (ANLZ-03)

**What:** A zod schema satisfying D-03 (JSON, required `rationale`), and a concrete mechanism
for D-02's "fails schema validation loudly and the analyzer refuses to run" — implemented as
a **load-time self-test**, not a per-classification override, matching the decision's literal
wording.

```typescript
// Source: pattern matches this repo's own established zod-schema style — see
// scripts/backup-manifest.ts's DumpFileSchema/ContentHashSchema (read this session,
// lines 44-55) for the precedent of small, composed schemas with .regex()-validated fields.
// [VERIFIED: scripts/backup-manifest.ts:44-55] — quoted for the pattern this mirrors:
// `const DumpFileSchema = z.object({ file: z.string().min(1), sha256: z.string().regex(...) });`
import { z } from "zod";

const FactMatchSchema = z.record(
  z.string(),
  z.union([z.string(), z.boolean(), z.array(z.union([z.string(), z.boolean()]))]),
); // equality or set-membership only — D-01's explicit "no expressions" constraint

const RuleSchema = z.object({
  id: z.string().min(1), // stable, hand-assigned — Phase 7's override-frequency key
  match: FactMatchSchema,
  verdict: z.enum(["SAFE", "REVIEW_REQUIRED", "BLOCKED"]),
  rationale: z.string().min(1), // D-03: required, feeds Phase 5's PR rendering (CI-05)
});

export const RulesFileSchema = z.object({
  version: z.number().int(),
  rules: z.array(RuleSchema),
});

// D-02: the named irreversible-data-loss operations, expressed as the MINIMAL fact set each
// one is guaranteed to produce -- this is the canonical synthetic input the self-check below
// runs through the loaded rule table.
const FLOOR_OPERATIONS: Array<Record<string, unknown>> = [
  { statementKind: "DropTable" },
  { statementKind: "DropSchema" },
  { statementKind: "DropDatabase" },
  { statementKind: "Truncate" },
  { statementKind: "DropColumn" },
  { statementKind: "DeleteNoWhere", hasWhereClause: false },
  { statementKind: "UpdateNoWhere", hasWhereClause: false },
];

/**
 * D-02: loaded once at process start. Runs each floor operation's canonical fact set through
 * the classifier's own matching logic (the same function used at real classification time,
 * not a duplicate). Any floor operation that resolves to anything other than BLOCKED --
 * including "no rule matched", which D-06 would otherwise treat as REVIEW REQUIRED -- means
 * the rules file is invalid. Throws; the analyzer refuses to start. Never silently falls back
 * to a hardcoded floor verdict for real classification traffic.
 */
export function assertFloorNotWeakened(
  rulesFile: z.infer<typeof RulesFileSchema>,
  classifyFacts: (facts: Record<string, unknown>, rules: typeof rulesFile.rules) => string,
): void {
  for (const facts of FLOOR_OPERATIONS) {
    const verdict = classifyFacts(facts, rulesFile.rules);
    if (verdict !== "BLOCKED") {
      throw new Error(
        `Rules file validation failed: floor operation ${JSON.stringify(facts)} resolved to ` +
          `"${verdict}", not BLOCKED. The rules file cannot weaken the code floor (D-02).`,
      );
    }
  }
}
```

### Pattern 4: PL/pgSQL recursion (ANLZ-05, D-05)

**What:** The mechanism for recursing into `DO` blocks and `CREATE FUNCTION` bodies.
**When to use:** Whenever the top-level inspector encounters a `DoStmt` or
`CreateFunctionStmt` (or `CREATE OR REPLACE FUNCTION`) node.

```typescript
// Source: WebSearch corroboration of libpg-query-node's exported parsePlPgSQL function and
// its documented input/output shape, cross-checked against two independent search results
// describing the same function signature and against pglast's own documented limitation
// (structurally equivalent Python binding on the identical C library) that embedded SQL
// inside PL/pgSQL statements is carried as raw query text, not further-typed AST nodes.
// [CITED: search results describing @libpg-query/parser's parsePlPgSQL and pglast's own docs
// at pglast.readthedocs.io, MEDIUM confidence -- not independently re-verified against the
// specific npm package this project installs (`libpg-query`, not `@libpg-query/parser` --
// confirm the function is exported under the same name from the exact installed package as
// an early spike-task step)]
import { parsePlPgSQL } from "libpg-query";

// parsePlPgSQL() takes the FULL statement text (the whole CREATE FUNCTION ... AS $$ ... $$
// LANGUAGE plpgsql; declaration, or the whole DO $$ ... $$ block), not just the dollar-quoted
// body -- per the corroborated usage example. It returns PLpgSQL_function nodes whose `action`
// holds a PLpgSQL_stmt_block tree of procedural statements (IF/LOOP/RETURN/...).
//
// The recursive step this project's D-05 actually needs: walk that tree for statement kinds
// that embed real SQL as a raw string -- PLpgSQL_stmt_execsql (a bare SQL statement) and
// PLpgSQL_stmt_dynexecute (an EXECUTE) are the two that matter here -- extract the embedded
// query TEXT, and feed it back through parseTopLevel() (Pattern 1) for full classification.
// A PLpgSQL_stmt_dynexecute whose argument is not a resolvable string literal is D-07's
// "unresolvable dynamic SQL" case: synthesize `{ dynamicSqlUnresolved: true }` directly,
// since there is no SQL text to recurse into.
export async function inspectPlPgSqlBody(
  fullStatementSql: string,
  sourceContext: "do-block" | "function-body",
): Promise<Fact[]> {
  const tree = await parsePlPgSQL(fullStatementSql);
  const embeddedFacts: Fact[] = [];
  for (const embeddedSql of extractEmbeddedSqlText(tree)) {
    // Exact field names/traversal not directly verified this session -- [ASSUMED, budget as
    // the primary spike-task deliverable]. extractEmbeddedSqlText is illustrative, not a
    // verified API.
    const statements = await parseTopLevel(embeddedSql);
    for (const stmt of statements) {
      embeddedFacts.push({ ...inspectStatement(stmt), sourceContext });
    }
  }
  return embeddedFacts;
}
```

**Confidence caveat, stated plainly for the planner:** the exact field names inside
`PLpgSQL_function`/`PLpgSQL_stmt_block` (`action`, `datums`, per one search result) were not
independently confirmed against the installed package's actual TypeScript types this session
— no Node environment with the package installed was available to inspect
`node_modules/libpg-query`'s type declarations directly. **This is the single piece of this
research most likely to need adjustment once implementation starts**, and per D-05's own
text ("real work, real edge cases") that is an accepted, named cost — not a surprise. Treat
the first PL/pgSQL fixture pair (D-14) as the acceptance test for this API sketch, not the
sketch as ground truth for the fixture.

### Pattern 5: `squawk-cli` invocation for the D-15 comparison (ANLZ-06)

**What:** Spawn `squawk` against the shared corpus directory, parse its JSON output, and
diff against this analyzer's own verdicts.

```typescript
// Source: squawkhq.com/docs/cli, WebFetch this session.
// [CITED: squawkhq.com/docs/cli, MEDIUM confidence -- official docs, single fetch]
import { execa } from "execa";

// --pg-version pins squawk's own version-conditional rules to PG17, matching D9's project-wide
// pin -- without this flag squawk may apply defaults for a different (older) target version,
// which would produce spurious disagreements this phase's comparison report would then have
// to explain away as "different-by-design" when they are really a squawk misconfiguration.
const { stdout } = await execa("squawk", [
  "--reporter", "json",
  "--pg-version", "17.0",
  ...corpusSqlFilePaths,
]);
const squawkFindings = JSON.parse(stdout);
// squawk's own process exit code is non-zero whenever it finds ANY violation (this is a
// linter's normal convention) -- execa throws on non-zero exit by default. Wrap this call in
// execa's `{ reject: false }` option (or a try/catch) and read `.stdout`/`.exitCode`
// separately, never treat squawk's own exit code as a pass/fail signal for THIS analyzer's
// comparison report -- squawk exiting non-zero on a corpus file that is EXPECTED to contain a
// violation (most of D-13's corpus, by design) is the normal case, not a script failure.
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Parsing PostgreSQL SQL into a syntax tree | A hand-rolled tokenizer/parser, even a "good enough" regex cascade | `libpg-query` (`parse()`) | Already settled by D10 project-wide — a hand-rolled parser drifts from real Postgres grammar on edge cases; `libpg-query` **is** the grammar |
| Parsing PL/pgSQL procedural bodies | A custom `DO $$ ... $$` / function-body tokenizer | `libpg-query`'s `parsePlPgSQL()` | Same reasoning as above, one level deeper — PL/pgSQL has its own real grammar with its own edge cases (nested blocks, exception handlers) that a hand-rolled version would not track |
| Determining whether a function is safe to use as a fast `ADD COLUMN` default | Guessing from the function name's shape (e.g. "no parens = safe") | The static curated volatility table (Pattern 2), defaulting unknown functions to REVIEW REQUIRED via D-06 | A guess is exactly the kind of unverified assumption `CLAUDE.md` forbids recording as fact; the curated table is explicit about what it does and doesn't know, and the unknown case fails safe by construction (D-06), not by luck |
| Rule "extensibility" via a mini predicate language embedded in JSON | A DSL that lets a rule express `column.length > 10` or similar computed conditions | Equality/set-membership matching only, computed facts pre-derived by the inspector (D-01) | Already rejected explicitly by D-01: a predicate DSL in a config file is a programming language that cannot be meaningfully schema-validated and fails silently open on a subtly wrong expression — the one failure direction this project cannot afford |
| Enforcing "BLOCKED cannot be weakened" | A CI check on the rules file, or a runtime per-call override that ignores the rules file's verdict for floor operations | The load-time self-check in Pattern 3 | Already rejected by D-02: a CI check leaves the analyzer self-weakening until Phase 5 exists; the self-check makes "the analyzer refuses to run" true at every invocation, including local ones, from day one |

**Key insight:** every "don't hand-roll" item in this table maps to a decision this phase's
own `CONTEXT.md` already made — the risk in this phase is not *making* a wrong architectural
call (that's been done), it's an implementer quietly reintroducing a rejected approach under
time pressure (e.g., "just add a quick regex check for this one edge case the parser doesn't
handle yet"). Treat any code review comment along those lines as a direct regression against
D-01/D10, not a minor style note.

## Common Pitfalls

### Pitfall 1: Conflating "has a function-call default" with "volatile default"

**What goes wrong:** A `DEFAULT now()` (or any STABLE default) is misclassified REVIEW
REQUIRED when PostgreSQL itself would take the fast, metadata-only path.
**Why it happens:** This project's own prior research (`PITFALLS.md` A3, `FEATURES.md` §1)
groups `now()` with genuinely volatile functions like `clock_timestamp()`. The imprecision is
easy to miss because both produce a value that "looks time-dependent."
**How to avoid:** Use PostgreSQL's actual three-way volatility categorization
(IMMUTABLE / STABLE / VOLATILE), not a binary "literal vs function call" test. Only VOLATILE
forces the rewrite; STABLE and IMMUTABLE both qualify for the fast path. See Pattern 2 above.
**Warning signs:** A rule or test fixture that asserts `DEFAULT now()` is REVIEW REQUIRED —
this is the wrong expected verdict per official PostgreSQL documentation and should be
corrected, not encoded as a "known limitation."

### Pitfall 2: Treating `parsePlPgSQL`'s output as a complete, re-parseable AST

**What goes wrong:** Assuming the PL/pgSQL parse tree contains fully-typed nested SQL AST
nodes (so that walking it alone would be enough to classify embedded statements), when in
fact embedded SQL is carried as raw text that must be **fed back through `parse()`**
separately.
**Why it happens:** The top-level `parse()` output looks like a complete, recursively-typed
tree, so it's natural to assume the same is true one level down. It is a documented,
independently-corroborated limitation of the underlying C library (confirmed for both the
Node binding used here and the structurally-equivalent Python `pglast` binding on the same
library) that PL/pgSQL's embedded-SQL fields are not further typed.
**How to avoid:** Design the inspector's PL/pgSQL path from the start as "walk for embedded
query-text fields, then recurse into `parseTopLevel()`," never as "walk a fully-typed tree."
**Warning signs:** A PL/pgSQL adversarial fixture (D-14) passes for the "obviously safe"
case but the "hidden `DROP TABLE` inside a function body" case silently returns SAFE instead
of BLOCKED — that is this exact gap, not a rule-catalogue miss.

### Pitfall 3: The repo's own guardrail suite does not scan `packages/`

**What goes wrong:** Assuming `tests/guardrails.test.ts`'s structural checks (no committed
connection strings, no `drizzle-kit push`, no direct `process.env` reads) automatically cover
whatever this phase adds under `packages/automation/`.
**Why it happens:** The guardrail suite's own file-enumeration function is scoped to a fixed
allowlist that does not currently include `packages/` at all.
`[VERIFIED: tests/guardrails.test.ts:46-62]` — quoted directly:
```
  if (ALLOWED_ROOT_FILES.includes(file)) return true;
  if (file.startsWith("scripts/")) return true;
  if (file.startsWith("tests/")) return true;
  if (file.startsWith("apps/recipe-app/") && !file.startsWith("apps/recipe-app/design/")) {
    return true;
  }
  // Deliberately excluded: .planning/ and docs/ are prose ABOUT these constraints and
  // would otherwise match every assertion below that they describe.
  return false;
```
**How to avoid:** This phase's own new code has no connection strings or `process.env` reads
to worry about (D-11: the classifier core never touches a database at all), so the immediate
risk is low — but if this phase's plan adds *any* new structural guardrail specific to
`packages/automation/` (e.g., "the classifier core never imports `node:fs`"), it must add its
own explicit check rather than assuming the existing `sourceSurfaceFiles()` helper already
covers the new directory. Consider whether `sourceSurfaceFiles()` itself should gain a
`packages/` branch as part of this phase's own work, since Phase 7's extraction will make this
gap matter more, not less.
**Warning signs:** A new guardrail test added under `packages/automation/` that references
`sourceSurfaceFiles()` and silently always passes because the directory it's testing was never
in scope.

### Pitfall 4: Trusting `squawk`'s process exit code as the comparison signal

**What goes wrong:** A comparison script that wraps the `squawk` invocation in a naive
try/catch and treats "squawk exited non-zero" as "squawk failed to run," aborting the
comparison, when in fact squawk exits non-zero on every corpus file that legitimately
contains a lint violation — which is most of D-13's corpus, by design.
**Why it happens:** Non-zero exit conventionally means "something went wrong" for most CLI
tools; squawk's specific convention (non-zero = violations found, not process failure) is
easy to conflate with that general pattern.
**How to avoid:** Use `execa`'s `{ reject: false }` option and inspect `.stdout`/`.exitCode`
independently; only treat a squawk invocation as a genuine failure if `stdout` is not valid
JSON or the process was killed by a signal.
**Warning signs:** The D-15 comparison report silently omitting most of the corpus because
the generator script bailed out on the first file with an expected violation.

### Pitfall 5: Windows path/filename hazards recur for any new dated artifact

**What goes wrong:** A dated report filename (D-15's comparison report, following the
`docs/` `00-`/`10-`/`20-` numbering convention) built from a raw ISO timestamp silently
produces a zero-byte file on Windows if it contains a colon.
**Why it happens:** This is not hypothetical for this repository — it already happened once.
`[VERIFIED: scripts/backup-manifest.ts:18-28]`, quoted:
```
// RESEARCH.md Pitfall 3 (live-verified): Windows NTFS silently reinterprets a colon in a
// filename as an Alternate Data Stream separator rather than throwing -- a raw
// `Date.toISOString()` used directly in a filename does not error, it writes the real content
// into a hidden stream and leaves a zero-byte file with the visible name.
export function compactTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
```
**How to avoid:** If the D-15 comparison report's filename (or any future dated artifact this
phase produces) embeds a timestamp, reuse `compactTimestamp` from
`scripts/backup-manifest.ts` rather than reintroducing a raw `toISOString()` call. If the
report is instead a fixed filename (e.g. `docs/30-squawk-comparison.md`, no timestamp in the
name, timestamp only in the file's own content), this pitfall does not apply — but the choice
should be deliberate, not accidental.
**Warning signs:** A comparison-report filename containing a literal `:` character anywhere
in a path segment.

## Code Examples

### Corpus manifest shape (D-13, D-14, D-16)

```typescript
// Illustrative shape, not a verified API -- follows this repo's own established manifest
// style (scripts/backup-manifest.ts's zod-schema-plus-JSON-file pattern, read this session).
import { z } from "zod";

const CorpusEntrySchema = z.object({
  file: z.string().min(1),                    // relative path under test/corpus/
  expectedVerdict: z.enum(["SAFE", "REVIEW_REQUIRED", "BLOCKED"]),
  expectedFindingRuleIds: z.array(z.string()).min(1), // D-10: findings always present
  // D-14: every adversarial shape must supply BOTH halves. `pairId` links a
  // "hidden-and-executable" fixture to its "inert-text-only" counterpart; the manifest-level
  // corpus check (a dedicated test) fails loudly if any pairId has only one entry.
  adversarialPairId: z.string().optional(),
  adversarialHalf: z.enum(["hidden-executable", "inert-text-only"]).optional(),
});

export const CorpusManifestSchema = z.object({
  entries: z.array(CorpusEntrySchema),
});
```

### Adversarial fixture pair example (D-14) — dollar-quoted string shape

```sql
-- test/corpus/adversarial/dollar-quote-hidden-executable.sql
-- pairId: dollar-quote-drop-table
-- This DO block's dollar-quoted body contains a REAL, executable DROP TABLE -- must be caught.
DO $$
BEGIN
  DROP TABLE ingredients;
END;
$$;
```

```sql
-- test/corpus/adversarial/dollar-quote-inert-text-only.sql
-- pairId: dollar-quote-drop-table
-- The words "DROP TABLE" appear only inside a dollar-quoted STRING LITERAL being inserted as
-- data -- never executed as SQL. Must NOT be flagged.
DO $$
BEGIN
  INSERT INTO audit_log (message) VALUES ($tag$a comment mentions DROP TABLE ingredients$tag$);
END;
$$;
```

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|----------------|
| A1 | `libpg-query`'s `parse()` rejects its promise (rather than resolving with a partial/error result) on unparseable SQL | Pattern 1 | D-08's parse-failure handling could silently misfire if the actual failure mode is a resolved-with-error-field shape instead of a rejection — budget as the first thing a spike task confirms |
| A2 | The exact field names inside `parsePlPgSQL`'s returned `PLpgSQL_function`/`PLpgSQL_stmt_block` tree (`action`, `datums`, `PLpgSQL_stmt_execsql`, `PLpgSQL_stmt_dynexecute`) | Pattern 4 | The D-05 recursion implementation would need rework if the actual field names differ — this is the single highest-uncertainty item in this research and should be the first PL/pgSQL fixture's acceptance test, not assumed correct going in |
| A3 | The static curated function-volatility table (Pattern 2) is complete enough for this project's actual migration corpus | Pattern 2, Common Pitfalls | An unlisted volatile function used in a real `ADD COLUMN DEFAULT` would resolve to `unknown-function`, which D-06 already fails safe to REVIEW REQUIRED (not SAFE) — so the risk is a false REVIEW, not a false SAFE, which is the safe failure direction |
| A4 | `parsePlPgSQL` is exported under that exact name from the specific `libpg-query` npm package this project installs (some search results referenced `@libpg-query/parser`, a related but distinct package) | Pattern 1, Pattern 4 | If the function lives under a different export name or a sibling package, the recursion mechanism (D-05) would need a different import — verify against the installed package's own type declarations as the first implementation step |
| A5 | `squawk --pg-version 17.0` is the correct flag/value syntax to pin squawk's own version-conditional rules to PG17 | Pattern 5 | If the flag or value format is wrong, squawk would silently use its own default target version, producing spurious disagreements in the D-15 comparison report that would need to be explained away rather than avoided |

**None of these assumptions block starting the phase** — D-05 itself already names PL/pgSQL
recursion as "real work, real edge cases," and the corrective information above (Pitfall 1,
the STABLE/VOLATILE distinction) is CITED at MEDIUM-HIGH confidence, not assumed. The five
items above should each resolve within the first PL/pgSQL-touching implementation task via a
short spike (install the package, run `parse()`/`parsePlPgSQL()` against a real fixture,
inspect the returned shape directly) before the inspector module is written against them as
if they were confirmed.

## Open Questions (RESOLVED)

**All three questions below were closed during phase planning (2026-09-08).** Each carries an
inline RESOLVED marker naming the plan and task that settled it. Nothing in this section is an
open contract any longer; read the resolution line, not the original recommendation, as the
project's position. Where the resolution **diverges** from the recommendation this research
originally proposed, the divergence is stated explicitly — the recommendation is kept only so
the reasoning trail is legible, and is superseded.

1. **Exact `parsePlPgSQL` output shape and its export path**
   - What we know: the function exists, takes a full statement (not just the body), and
     returns a `PLpgSQL_function`-rooted tree; embedded SQL is carried as raw text per a
     documented, cross-library limitation.
   - What's unclear: precise field names and whether it is exported from `libpg-query` itself
     or a sibling package.
   - **RESOLVED — 03-01 Task 2** ("Pin the libpg-query failure contract"), which replaces the
     throwaway script with a *committed* contract-pinning test,
     `packages/automation/test/libpg-query-contract.test.ts`. That test asserts on the real
     installed package and names the exact PL/pgSQL parsing symbol it exports, so plan 03-04
     imports a verified name rather than an assumed one. This also closes **Assumptions Log
     A1** (does `parse` reject, or resolve with an error field) and **A4** (is the PL/pgSQL
     entry point exported from this package at all) by execution rather than by citation.
     Divergence from the recommendation: a throwaway script would have left the answer in a
     transcript, so the plan pins it in a test that keeps failing if the package's shape ever
     changes. 03-01 Task 2 further requires that any observed divergence from Pattern 1 or
     Pattern 4 be recorded in the plan summary — a wrong research assumption is a finding, not
     a failure. The precise field names inside the returned tree remain confirmed-at-execution
     by that test, which is the point: they are no longer an assumption anyone is acting on.
   - Recommendation (superseded by the above): first implementation task is a throwaway script
     that installs the package and inspects real output against a `DO $$ DROP TABLE x; $$;`
     fixture, before writing the inspector's traversal logic.

2. **CLI exit code numbering (Claude's Discretion per CONTEXT.md)**
   - What we know: D-12 requires distinct codes per verdict plus a distinct parse-failure
     code; no numbering is locked.
   - What's unclear: the specific integers.
   - Recommendation (SUPERSEDED — do not implement): `0 = SAFE`, `1 = REVIEW_REQUIRED`,
     `2 = BLOCKED`, `3 = parse failure`. This proposal was **rejected during planning** and
     must not be used; it is retained only to show what was considered.
   - **RESOLVED — 03-01 Task 1**, which locks a **different** scheme in
     `packages/automation/src/types.ts` as the frozen `EXIT_CODES` object:
     **`SAFE = 0`, `REVIEW_REQUIRED = 10`, `BLOCKED = 20`, `PARSE_FAILURE = 30`,
     `RULES_INVALID = 40`** — five codes, not four. Two reasons the ascending-by-one proposal
     above was rejected: (a) the numbers are deliberately **non-adjacent and none equals 1**,
     so Node's own generic exit 1 from an uncaught exception can never be misread as a verdict
     — "the analyzer crashed" and "this migration needs review" must not be the same integer
     in the Phase 7 audit record (threat T-03-06 in 03-01, T-03-11 in 03-03); and (b) the
     proposal had no code at all for a rules file that fails the D-02 floor self-check, which
     is a fifth distinct outcome, not a parse failure. 03-03 Task 2 asserts each of the five
     codes against its own fixture in `packages/automation/test/cli.test.ts`. The
     collision check the recommendation asked for was performed: the root `package.json`'s
     existing `db:*` scripts rely on no exit-code convention, and the new scripts follow the
     same `db:*` naming (`db:analyze`, `db:analyze:migrations`).

3. **Whether corpus manifest and rules-file share a zod schema module**
   - What we know: both need zod validation; Claude's Discretion per CONTEXT.md.
   - What's unclear: whether sharing a `FactMatchSchema`-shaped building block between them is
     worth the coupling.
   - **RESOLVED — 03-05 Task 1**, which adopts the recommendation unchanged: the corpus
     manifest is validated by `packages/automation/test/corpus-manifest-schema.ts`, kept
     deliberately separate from the rules-file schema at
     `packages/automation/src/classifier/rules-schema.ts`. The stated reason is the one above —
     one file is policy, the other is test expectations — and the separation also keeps the
     schema that validates the test corpus out of the shipped source tree. No shared building
     block is factored out in this phase; that stays available if real duplication appears.
   - Recommendation (adopted as-is by the above): keep them separate initially (they validate
     genuinely different things — one is policy, one is test expectations) and only factor out
     a shared module if real duplication appears once both are written.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|--------------|-----------|---------|----------|
| Node.js | Running `libpg-query` (WASM, no native build) and the CLI/tests | ✓ `[VERIFIED: node --version → v24.19.0, run this session]` | 24.19.0 | — |
| pnpm | Installing the new `packages/automation` dependencies | ✓ (per `package.json`'s pinned `packageManager`) | 10.25.0 | — |
| Docker | NOT required this phase | n/a | — | D-11: the classifier core has no database connection; `@testcontainers/postgresql` (already a workspace dependency from Phase 2) is not needed for anything in this phase's scope |
| `squawk.exe` (Windows binary) | D-15 one-time comparison | ✓ (ships via `@squawk-cli/win32-x64` optional dependency, confirmed this session) | 2.64.0 | — |

**Missing dependencies with no fallback:** none — every dependency this phase needs is either
already installed (`zod`, `execa`, `vitest`) or a plain npm install with a confirmed Windows
binary (`libpg-query` WASM, `squawk-cli` win32-x64).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `vitest` 5.0.0 (already installed, root `vitest.config.ts`) |
| Config file | `vitest.config.ts` — `[VERIFIED: vitest.config.ts:1-16]`, quoted: `include: ["scripts/**/*.test.ts", "tests/**/*.test.ts", "apps/**/*.test.ts"]`. **This include list does not currently match `packages/**` either** — the phase's plan must add a `packages/**/*.test.ts` glob (or an equivalent) to this config, or the new test suite will not run at all under `pnpm test`. |
| Quick run command | `pnpm test` (once the config include list covers `packages/`) |
| Full suite command | `pnpm test` — this phase's tests have no Docker dependency (D-11), so there is no separate "full" tier the way Phase 2's `vitest.drill.config.ts` split required |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|--------------|
| ANLZ-01 | Migration SQL parsed via `libpg-query`, never regex | unit | `pnpm test -- inspector` | ❌ Wave 0 |
| ANLZ-02 | Every operation classified into one of three verdicts | unit (corpus-driven) | `pnpm test -- classifier` | ❌ Wave 0 |
| ANLZ-03 | Rules are schema-validated data; invalid rules file refuses to run | unit | `pnpm test -- rules-schema` (including the D-02 floor self-check, Pattern 3) | ❌ Wave 0 |
| ANLZ-04 | Context-aware: volatile vs non-volatile defaults, `NOT VALID`+`VALIDATE`, `CONCURRENTLY` | unit (corpus-driven, incl. the `now()` STABLE case from Pitfall 1) | `pnpm test -- classifier` | ❌ Wave 0 |
| ANLZ-05 | Adversarial fixtures resist fooling in both directions | unit (corpus-driven, D-14 pairing enforced by a dedicated manifest-integrity test) | `pnpm test -- corpus-integrity` | ❌ Wave 0 |
| ANLZ-06 | Cross-checked against `squawk-cli`, disagreements explained | manual-only generator + committed artifact review | `tsx packages/automation/scripts/squawk-comparison.ts` (D-15: one-time, not a CI-gated automated test) | ❌ Wave 0 |
| ANLZ-07 | Real `DROP TABLE` blocked, genuinely safe migration passes, by test | unit (corpus-driven, the two genuine Drizzle migrations from D-13 plus a hand-written `DROP TABLE`) | `pnpm test -- corpus` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm test` (fast, no Docker — every test this phase adds belongs in
  the default suite per D-11).
- **Per wave merge:** `pnpm test` (same command — there is no slower tier this phase needs).
- **Phase gate:** Full suite green before `/gsd-verify-work`, plus the D-15 comparison report
  committed and every disagreement in it annotated (this is a documentation deliverable, not
  something `pnpm test` can assert automatically — success criterion 5 requires a human-read
  explanation, not just a passing script).

### Wave 0 Gaps

- [ ] `vitest.config.ts`'s `include` array needs a `packages/**/*.test.ts` (or equivalent)
      glob — currently scoped only to `scripts/**`, `tests/**`, `apps/**`
      `[VERIFIED: vitest.config.ts:9]`.
- [ ] `packages/automation/package.json` — does not exist yet (01-CONTEXT.md D-02, this
      phase's own first deliverable).
- [ ] `packages/automation/test/corpus/manifest.json` and the corpus `.sql` fixture tree —
      does not exist yet; this **is** the phase's core test fixture work, not pre-existing
      infrastructure to reuse.
- [ ] No existing shared fixture/harness for "run this file's SQL through the classifier and
      assert against a manifest row" — needs to be written as part of Wave 0, analogous to how
      `tests/drill-assertions.test.ts` (read this session) builds a `queueClient` fake for
      `scripts/drill-assertions.ts`'s structural interface; this phase's equivalent harness
      loads a corpus entry, runs the classifier, and diffs findings against
      `expectedFindingRuleIds`.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|-------------------|
| V1 Architecture | yes | D-11's pure-core/no-filesystem/no-DB boundary IS the architectural control this category asks for — the classifier cannot be tricked into reading or writing anything beyond the SQL text and rules file it's given |
| V2 Authentication | no | This phase has no user-facing auth surface — it's a CLI/library with no accounts |
| V3 Session Management | no | Same — no sessions |
| V4 Access Control | no | Not this phase's concern; who is *allowed* to run the analyzer or merge past its verdict is Phase 5 (CI-03's ruleset) |
| V5 Input Validation | **yes — the core of this phase** | The **entire migration-SQL corpus is untrusted input** by this project's own threat model (an AI agent authors it). `libpg-query` parsing to a real AST (ANLZ-01) IS the input-validation control; `zod` validation of the rules JSON (ANLZ-03) is a second, independent input-validation control on a different untrusted input (the rules file itself, per D-02's own threat model: "an agent can edit the rules") |
| V6 Cryptography | no | Nothing in this phase computes or stores anything requiring cryptography |

### Known Threat Patterns for this phase's stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-----------------------|
| Malicious/adversarial SQL text designed to fool a naive analyzer (comments, dollar-quoting, `DO` blocks, function bodies hiding a real `DROP TABLE`) | Tampering | Real-parser AST classification (D10/ANLZ-01) + D-05's recursion into nested bodies + D-14's structurally-enforced adversarial pair corpus |
| The rules file itself edited to weaken a BLOCKED classification (an AI agent, under the same threat model that makes the SQL untrusted, can also edit `rules.json` in the same PR) | Tampering | D-02's code floor + Pattern 3's load-time self-check — this is this phase's single most important STRIDE mitigation, since it is the one place D-01's own "extensible data" requirement and this project's safety requirement directly pull against each other |
| A parse failure silently treated as a benign/default verdict, masking either a genuinely malformed migration or an analyzer bug | Repudiation / Denial of Service (of the safety guarantee itself) | D-08's fourth outcome — hard error, non-zero exit, no classification emitted |
| An unrecognized SQL construct (a PostgreSQL feature the rule catalogue has never seen) silently passing as SAFE | Tampering (of the trust boundary "SAFE means reviewed", not of data) | D-06 — SAFE must be positively earned by a matching rule; no match defaults to REVIEW REQUIRED |
| Dynamic SQL (`EXECUTE` with a non-literal, unresolvable argument) hiding an arbitrary statement from static analysis entirely | Tampering / Information Disclosure (of what the migration actually does) | D-07 — unresolvable dynamic SQL is BLOCKED outright, since neither the analyzer nor a human reviewer can actually read what it does |

## Sources

### Primary (HIGH confidence)
- `.planning/phases/03-safety-analyzer/03-CONTEXT.md` — read in full this session; all sixteen
  binding decisions (D-01…D-16) quoted/summarized above.
- `.planning/REQUIREMENTS.md` — ANLZ-01…07 read directly.
- `docs/decisions.md` — D9, D10, D11, D12, D15 read directly; D9/D10/D12 are directly binding
  on this phase.
- `npm view libpg-query dist-tags --json`, `npm view squawk-cli version`,
  `npm view squawk-cli optionalDependencies --json`, `npm view zod version`,
  `npm view execa version`, `npm view @testcontainers/postgresql version` — all run this
  session against the live npm registry.
- `gsd_run query package-legitimacy check --ecosystem npm libpg-query squawk-cli zod` — run
  this session.
- Repository files read directly this session (quoted where load-bearing):
  `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `apps/recipe-app/package.json`,
  `apps/recipe-app/src/db/schema.ts`, `apps/recipe-app/drizzle/0000_bumpy_khan.sql`,
  `apps/recipe-app/drizzle/0001_busy_thunderbolt.sql`,
  `apps/recipe-app/drizzle/meta/_journal.json`, `vitest.config.ts`, `scripts/log.ts`,
  `scripts/env.ts`, `scripts/verify-migration-state.ts`, `scripts/drill-assertions.ts`,
  `scripts/backup-manifest.ts`, `tests/drill-assertions.test.ts`, `tests/guardrails.test.ts`.

### Secondary (MEDIUM confidence)
- `postgresql.org/docs/current/sql-altertable.html` (direct WebFetch this session,
  cross-checked against an independent WebSearch summary of the same PG11 fast-default
  mechanism) — the volatile-default correction (Pitfall 1, Pattern 2).
- `github.com/launchql/libpg-query-node` README (WebFetch, corroborated by a second
  independent WebFetch of the same repository) — `parse()` API shape.
- `squawkhq.com/docs/cli` (WebFetch) — CLI flags, `--reporter json`, `--pg-version`.
- WebSearch results on `parsePlPgSQL` (cross-checked against `pglast`'s own documented
  identical limitation on the same underlying C library) — PL/pgSQL recursion mechanics
  (Pattern 4); flagged throughout as the research area needing the most implementation-time
  verification.

### Tertiary (LOW confidence)
- WebSearch results on `gen_random_uuid()`'s volatility history (corrected from an initial
  mistaken IMMUTABLE classification to VOLATILE, per a PostgreSQL commit message referenced in
  search results but not independently opened this session) — included in the static
  volatility table (Pattern 2) but marked `[ASSUMED]` pending direct verification.

## Metadata

**Confidence breakdown:**
- Standard stack (package versions, legitimacy): HIGH — every version and legitimacy verdict
  was tool-confirmed against the live npm registry this session.
- Architecture (fact vocabulary, rule schema, floor self-check): MEDIUM-HIGH — directly
  derived from this phase's own already-binding CONTEXT.md decisions; the implementation
  sketches are illustrative, not verified against a running `libpg-query` install.
- `libpg-query`/PL-pgSQL API shape specifically: MEDIUM — web-corroborated from multiple
  independent sources but not hands-on-verified in this environment; explicitly flagged as
  the top implementation-time verification item (Open Question 1 — **now RESOLVED**, routed to
  03-01 Task 2's committed contract test rather than left open; Assumptions A1/A2/A4 are pinned
  by that same test).
- Pitfalls: MEDIUM-HIGH — the volatile-default correction is CITED directly from official
  PostgreSQL documentation with a verbatim quote; the other pitfalls are either
  `[VERIFIED]` against this repository's own source (guardrail scope, Windows filename
  precedent) or straightforward operational corollaries of the CITED finding.

**Research date:** 2026-09-08
**Valid until:** ~30 days for the package-version/legitimacy findings (stable, slow-moving
ecosystem); the `libpg-query` API-shape findings should be treated as valid only until the
first spike task actually installs and exercises the package — at that point, replace the
`[ASSUMED]`/web-corroborated claims in Pattern 1/Pattern 4 with directly observed behavior
rather than extending this research's shelf life for them.
