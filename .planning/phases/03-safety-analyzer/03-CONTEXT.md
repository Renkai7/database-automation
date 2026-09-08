# Phase 3: Safety Analyzer - Context

**Gathered:** 2026-09-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 3 builds the component every later phase's trust rests on: migration SQL is parsed
with the real PostgreSQL grammar (`libpg-query`) into an operation list, and each operation
is classified SAFE / REVIEW REQUIRED / BLOCKED by rules that live in a schema-validated data
file rather than in code. The classifier is proven by adversarial fixtures designed to fool
it in both directions, and cross-checked once against `squawk-cli` with every disagreement
examined and explained.

This is also the phase in which `packages/automation/` comes into existence
(`01-CONTEXT.md` D-02) — the analyzer is its first tenant and the reason it now has
something app-agnostic to hold.

Requirements in scope: ANLZ-01, ANLZ-02, ANLZ-03, ANLZ-04, ANLZ-05, ANLZ-06, ANLZ-07.

**Explicitly not this phase:**

- **No execution of anything.** The analyzer never connects to a database and never runs a
  migration. The runner that acts on a verdict is Phase 4 (RUN-01 … RUN-08, D12).
- **No `lock_timeout` / `statement_timeout` enforcement.** Those are properties of how the
  runner opens its session, not of what the SQL says — Phase 4, RUN-02. See D-04.
- **No CI wiring, no PR rendering** (Phase 5), **no override mechanism** (Phase 5/7), **no
  audit log** (Phase 7), **no remote database of any kind** (D2, D3).
- **No spending of the reserved churn material.** `01-CONTEXT.md` D-11 reserves specific
  recipe-app schema changes for Phases 4 and 7. This phase writes *fixtures that mirror
  them* (D-16) and does not touch `apps/recipe-app/src/db/schema.ts`.

</domain>

<decisions>
## Implementation Decisions

### The rules file

- **D-01:** A rule matches a **documented facts vocabulary**, not the raw parse tree. The
  inspector's job is to reduce a parsed statement to a flat set of facts about the operation
  (its kind, the table and column it touches, whether a default expression is volatile,
  whether an index is `CONCURRENTLY`, whether a constraint is `NOT VALID`, and so on). A
  rule matches those facts by equality and set membership only — **no expressions, no
  computed conditions**. Adding a rule for something the inspector can already observe is
  pure data; teaching the analyzer to observe something genuinely new is an inspector change,
  which means a code diff and a test.
  A predicate DSL over the AST was considered and rejected: it is a programming language
  written in a config file, it cannot be meaningfully schema-validated, and a subtly wrong
  expression fails silently open — the one failure direction this project cannot afford.
  A pure verdict lookup table was also rejected as not satisfying ANLZ-03's "extensible
  data" at all.
  — **Reversibility:** costly — the fact names become the vocabulary the rules file, the
  test manifest, the squawk comparison report and (at Phase 7) the audit records are all
  written against; renaming or restructuring them later touches every one of those.

- **D-02:** A **code floor fixes the BLOCKED verdict for a named set of operations, and the
  rules file cannot lower it.** The floor covers the irreversible-data-loss set from
  `.planning/research/FEATURES.md` §1: `DROP TABLE`, `DROP SCHEMA`, `DROP DATABASE`,
  `TRUNCATE`, `DROP COLUMN`, and `DELETE`/`UPDATE` without a row-scoping `WHERE`. Rules may
  add new rules and may raise severity; a rules file that assigns a floor operation anything
  weaker than BLOCKED **fails schema validation loudly and the analyzer refuses to run** —
  it does not fall back to the floor silently.
  This exists because ANLZ-03 and safety pull against each other: rules-as-data means an
  agent can edit the rules, and "downgrade `DROP TABLE` to SAFE" would otherwise be a
  one-line diff that disarms the entire system. `.planning/research/PITFALLS.md` §C2 is the
  named failure mode. Protecting the file with a CI check instead was rejected — that leaves
  the analyzer self-weakening until Phase 5 exists, and makes the guarantee a property of
  configuration the owner maintains rather than of the analyzer itself, which is the exact
  inversion the project's non-negotiables forbid.
  — **Reversibility:** one-way in intent — removing the floor later, or adding a rules-file
  escape that overrides it, converts a structurally non-weakenable classifier into a
  configurable one. Treat any future PR that touches the floor as a safety-relevant change,
  exactly as `01-CONTEXT.md` D-16 requires for `db:query` and `02-CONTEXT.md` D-06 requires
  for the restore commands.

- **D-03:** The rules file is **JSON with a required `rationale` field per rule**, validated
  by **zod** (already a workspace dependency at 4.5.4 — no new dependency). The rationale is
  required, not optional: CI-05 requires the pull request to show the classification *and
  the reasoning behind it*, so the "why" has to be structured data the pipeline can render,
  not a comment a human reads in the file. A rule therefore cannot be added without stating
  why it exists.
  YAML was rejected: it costs a parser dependency, and its main advantage — comments — is
  invisible to Phase 5's PR output, so a rationale field would be needed regardless. A
  TypeScript module was rejected because it is code that can import, branch and compute,
  which reopens exactly the hardcoded-conditionals problem ANLZ-03 closes.

- **D-04:** The **full `.planning/research/FEATURES.md` §1 catalogue ships in this phase** —
  the complete BLOCKED set, every REVIEW REQUIRED two-step form (volatile `ADD COLUMN`
  default, `SET NOT NULL`, `ALTER COLUMN ... TYPE`, `UNIQUE` constraint, non-`CONCURRENTLY`
  index creation, unvalidated foreign key), the rename/compatibility rules kept as their own
  category distinct from the lock-hazard rules, and the explicit USUALLY SAFE set. Phase 5
  then wires in a gate that is real on day one rather than one that is mostly holes.
  **Excluded deliberately:** squawk's `require-lock-timeout` and `require-statement-timeout`
  equivalents. Those describe how the *session* executes, not what the SQL says, and RUN-02
  makes the Phase 4 runner responsible for setting them on every migration. An analyzer rule
  flagging every migration for a property the runner guarantees would be a false positive by
  construction — the first step toward `PITFALLS.md` §C2's routine overriding.

### Classifying the unknown

- **D-05:** The analyzer **recurses into nested bodies**. Dollar-quoted bodies of `DO` blocks
  and `CREATE [OR REPLACE] FUNCTION` are re-parsed and their contents classified, so a real
  `DROP TABLE` hidden inside one hits the D-02 floor and is BLOCKED — which is what the
  phase's success criterion 3 demands in as many words. Refusing every block containing DDL
  without looking inside was rejected: it would make a legitimate trigger-function migration
  permanently unclassifiable-as-safe, and that friction is precisely what manufactures
  pressure for an override path.
  Accepted cost: PL/pgSQL is a different grammar from plain SQL, so this is real work with
  real edge cases. The adversarial fixture pairs (D-14) are how those edges get found.

- **D-06:** **An operation that parses but matches no rule is REVIEW REQUIRED.** SAFE must be
  positively earned by a matching rule — which is why D-04's explicit USUALLY SAFE set
  matters and is not merely "the absence of a match". A PostgreSQL feature the catalogue has
  never heard of stops for a human rather than sailing through. Fail-open-to-SAFE was
  rejected because it would make "the analyzer said SAFE" sometimes mean "the analyzer had
  no opinion", and every later phase's trust is built on that sentence meaning one thing.
  Defaulting to BLOCKED was rejected as reserving-by-inflation: BLOCKED is for named
  irreversible data loss, and an unfamiliar-but-harmless statement would have no path
  forward.

- **D-07:** **Unresolvable dynamic SQL is BLOCKED.** An `EXECUTE` inside a function body
  whose argument the analyzer cannot resolve statically could be anything, including a drop.
  Classifying it REVIEW REQUIRED would mean asking a human to approve SQL that nobody — not
  the analyzer, not the reviewer — can actually read, which is the weakest possible form of
  the gate. Accepted cost: any legitimate need for dynamic SQL in a migration must be
  rewritten as static statements. For this project's actual migrations that is not a real
  loss. Constant-folding resolvable `EXECUTE` arguments was considered and deferred, not
  rejected (see Deferred Ideas).

- **D-08:** **A parse failure is a hard error, not a verdict.** If `libpg-query` cannot parse
  the input, the analyzer's own premise — that it is reasoning about real PostgreSQL grammar
  — did not hold, so it has no standing to classify anything. It reports the failure, exits
  non-zero, and emits no classification at all. Downstream consumers must handle this as a
  fourth outcome distinct from the three verdicts.
  This is the same reasoning as `02-CONTEXT.md` D-20: a drill that could not run is not a
  skipped drill. Collapsing a parse failure into BLOCKED would make "the analyzer is broken"
  indistinguishable from "the migration is dangerous" in the Phase 7 audit record — and
  PostgreSQL itself would reject the same SQL, so the honest statement is that the input is
  broken, not that it is borderline.

### Unit of judgment and interface

- **D-09:** **The window is one migration file.** Statements are classified individually, but
  safe-form pairing is resolved within the file — `ADD CONSTRAINT ... NOT VALID` followed by
  `VALIDATE CONSTRAINT`, or `CREATE UNIQUE INDEX CONCURRENTLY` followed by
  `ADD CONSTRAINT ... USING INDEX`, is recognised as its safe form when both statements are
  in the same file. This matches what the Phase 4 runner executes as a unit and what Phase 5
  renders on a pull request.
  Consequence, recorded rather than discovered later: a two-step pattern deliberately split
  across two migration files reads as the naive form in the first file. That is arguably
  correct — each file executes separately — but it is the shape expand-and-contract work
  takes, so Phase 7 should expect it. Widening the window to the whole pending set was
  rejected because a file's verdict would then depend on which other files happen to be
  pending, and D12 requires the runner to re-derive a verdict it can trust from the SQL in
  front of it.

- **D-10:** **Worst verdict wins, and the complete findings list is always reported.** The
  file's verdict is the most severe statement verdict; the result object always carries every
  per-statement finding, and the analyzer never short-circuits on the first BLOCKED. Phase 5
  has to render reasoning on a PR, and a report that hides the second problem behind the
  first means fixing one issue and rediscovering the next on the following run.

- **D-11:** **The classifier core is a pure function of SQL text plus rules** — no
  filesystem, no Drizzle knowledge, no database connection. A separate thin adapter
  enumerates `apps/recipe-app/drizzle/*.sql` against `meta/_journal.json` for the file-based
  entry points. This keeps the core app-agnostic for the Phase 7 extraction, and it lets
  D12's runner hand the classifier **the exact bytes it is about to execute** rather than a
  path it would have to trust — which is the whole point of re-deriving classification at
  execution time.
  — **Reversibility:** costly — the pure-core/adapter seam is what makes `packages/automation`
  extractable; letting Drizzle-specific knowledge leak into the core later would have to be
  unpicked across the classifier, the CLI, and the Phase 4 runner.

- **D-12:** **Library first, thin CLI over it.** The classifier is an importable function
  (D12 requires the Phase 4 runner to call it in-process — it must never shell out to a CLI
  to decide whether to run). A small command wraps it for the owner and for Phase 5, emitting
  both a human-readable report and machine JSON, with **distinct exit codes per verdict** so
  CI can branch without parsing text, and a further distinct non-zero code for D-08's parse
  failure. This continues the established repo pattern of splitting modules from their entry
  points so both directions are testable.

### The corpus and the squawk cross-check

- **D-13:** The corpus is **hand-written `.sql` files plus a committed manifest** mapping each
  file to its expected verdict and expected findings. The SQL stays readable as SQL, the same
  directory can be handed to `squawk-cli` unchanged, and adding a case is a file plus a
  manifest row. SQL inlined in test files was rejected because squawk needs real files on
  disk and the corpus would stop being a shared artifact two tools consume. Encoding the
  expected verdict in a leading SQL comment was rejected on principle: this suite's entire
  purpose includes proving comments are inert, so putting load-bearing data in a comment is
  the wrong precedent here of all places.
  The corpus covers the full D-04 catalogue, the D-14 adversarial shapes, the two genuine
  existing Drizzle migrations (`0000_bumpy_khan.sql`, `0001_busy_thunderbolt.sql`), and the
  D-16 app-shaped group.

- **D-14:** **Adversarial fixtures ship as matched pairs, and the manifest enforces the
  pairing.** Every adversarial shape — SQL comment, dollar-quoted string, `DO` block,
  function body, quoted identifier colliding with a keyword — appears twice: once where the
  hidden statement is genuinely executable and must be caught, once where `DROP TABLE`
  appears only as inert text and must **not** be flagged. A shape present with only one half
  fails the corpus check. This makes "cannot be fooled in either direction" a structural
  property of the corpus rather than a claim about how thorough the tests happen to be, and
  it protects the false-positive direction, which is the half that quietly rots and which
  `PITFALLS.md` §C2 identifies as the start of the slide toward routine overriding.

- **D-15:** **`squawk-cli` is a one-time calibration in this phase, producing a committed
  comparison report** — not a permanent dependency of the test suite. Both tools run over the
  same corpus, every disagreement is examined, and each one is explained in the report
  (analyzer correct / squawk correct / different-by-design, with the reason). That is
  literally what success criterion 5 asks for. squawk's standing value here is as a
  rule-catalogue reference and as an independent sanity check on a classifier nobody has yet
  seen work; its rule set is fixed in a compiled Rust binary and its output is lint warnings
  rather than this system's three-tier verdict, so wiring it permanently into the fast suite
  would add a maintained expected-disagreement list for little ongoing signal. Keeping it as
  a re-runnable command was considered; see Deferred Ideas.

- **D-16:** The corpus includes a **separate, app-shaped fixture group** mirroring
  `01-CONTEXT.md` D-11's reserved churn changes, written as fixture SQL against
  `recipes` / `ingredients` / `steps` without touching the real schema: a nullable `notes`
  column (expected SAFE), a volatile-default or `SET NOT NULL` change (expected REVIEW
  REQUIRED), and `DROP TABLE ingredients` (expected BLOCKED). Phase 4 then makes those
  changes for real already knowing the verdict each should produce, at zero cost to the
  reserved material. It is kept **separate from the generic catalogue fixtures**, which stay
  app-agnostic, so `packages/automation` does not become coupled to the fixture app's schema
  — the coupling `01-CONTEXT.md` D-01's workspace seam exists to prevent.

### Carried forward (binding, not re-decided here)

- **`packages/automation/` is created in this phase** and the analyzer is its first tenant
  (`01-CONTEXT.md` D-02). It gets its own `package.json` from day one so Phase 7's extraction
  is a publish rather than an architecture change (`.planning/research/ARCHITECTURE.md`).
- **`libpg-query` only — never regex or string matching** (D10, ANLZ-01).
- **PostgreSQL 17 semantics may be assumed** by the rules (D9). The `libpg-query` dist-tag
  must be pinned to match the PG17 server pin, not left on the package default.
- **`squawk-cli`'s npm package ships a `win32-x64` binary**, so it runs on this Windows
  machine with no extra setup (`.planning/research/STACK.md`).

### Claude's Discretion

- The package's exact name, internal module layout, and the file path of the rules JSON
  inside it — constrained only by D-11's pure-core/adapter seam and by the package being
  independently extractable.
- The concrete fact names in the D-01 vocabulary, and the rule id scheme — with one
  constraint worth honouring now: Phase 7 needs a **per-rule override-frequency count**
  (PROD-04 / roadmap criterion 4), so rule ids should be stable identifiers intended to
  survive catalogue edits, not positional or generated ones.
- The exact exit-code numbers for the three verdicts and for D-08's parse failure, and
  whether findings locate a statement by line/column or by statement index.
- The JSON result shape, subject to D-10 (always complete) and to it being the thing Phase 5
  renders and Phase 7 records.
- Filenames and locations of the corpus manifest and of the D-15 comparison report — the
  `docs/` numbering convention (`00-`, `10-`, `20-`) is the obvious home for the report.
- How far PL/pgSQL recursion goes in practice (nested blocks, exception handlers) beyond what
  the D-14 fixture pairs require, and whether the recursion is depth-limited.
- Whether the corpus manifest and the rules file share a validation module or have separate
  zod schemas.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase requirements and goal

- `.planning/ROADMAP.md` § "Phase 3: Safety Analyzer" — the goal and the five success
  criteria this phase is verified against. Criterion 2 (context-awareness) and criterion 3
  (adversarial, both directions) are the sharp ones.
- `.planning/REQUIREMENTS.md` — ANLZ-01 … ANLZ-07 are this phase's requirements. The Out of
  Scope table lists anti-features that must not be reintroduced.

### Binding prior decisions

- `docs/decisions.md` — **D10** (parse, never pattern-match; `libpg-query` on the AST, squawk
  as second opinion; Atlas rejected because its PostgreSQL destructive-change analyzers moved
  behind a paid tier), **D9** (PostgreSQL 17 pinned everywhere; *analyzer rules may assume
  PG17 semantics* — this is the decision that makes context-aware classification tractable),
  **D12** (classification is re-derived at execution time by the Phase 4 runner, so the
  classifier must be importable and pure), **D3**/**D2** (no production or remote access —
  this phase touches no database at all).
- `.planning/phases/01-local-environment/01-CONTEXT.md` — **required reading.** Directly
  binding: **D-02** (`packages/automation/` appears in Phase 3), **D-01** (pnpm workspace
  seam; the package must stay independently extractable), **D-03** (the never-promote
  asymmetry for local-only commands — the analyzer is the opposite case: it is genuinely
  app-agnostic and belongs in the package), **D-11** (the reserved churn table — Phase 3
  must not spend it; D-16 mirrors it as fixtures instead), **D-09** (the recipe core schema
  the app-shaped fixtures are written against), **D-16** (the pin-in-source precedent that
  D-02's code floor follows).
- `.planning/phases/02-backup-restore-drill/02-CONTEXT.md` — **D-20** (a thing that could not
  run is not a thing that was skipped — the direct precedent for D-08), **D-19** (hard-fail
  rather than warn; warnings are the "remembered caution" pattern this project forbids),
  **D-13**/**D-15** (assertion depth and honestly-recorded limits), and the established
  practice of splitting testable modules from destructive entry points.
- `CLAUDE.md` and `.claude/CLAUDE.md` — non-negotiables. Especially: prefer architectural
  enforcement over remembered caution (D-02 is this phase's instance of it); mark unverified
  things UNKNOWN; never log or commit credentials.

### Research

- `.planning/research/FEATURES.md` **§1 "PostgreSQL Migration Safety Rule Catalogue"** — the
  single most important input to this phase. The BLOCKED set, the REVIEW REQUIRED two-step
  forms with their version notes, the USUALLY SAFE set, and the verified list of what squawk,
  Strong Migrations, atlas and eugene actually check. D-04 adopts this catalogue wholesale.
- `.planning/research/PITFALLS.md` **§C "Safety analyzer failure modes"** — C1 (why regex
  fails, and the exact adversarial shapes D-14 pairs must cover) and C2 (how a gate becomes
  decorative through routine overriding — the reasoning behind D-02, D-04's exclusion, and
  D-14's false-positive half). Also §D (AI-agent-specific hazards) and
  §"Pitfall-to-Phase Mapping".
- `.planning/research/ARCHITECTURE.md` — "Component Responsibilities" (Migration Inspector
  and Safety Classifier as separate, pure, stateless components — the D-11 seam), "Recommended
  Project Structure" (`inspector/`, `classifier/`, `rules/` inside the extractable package;
  note `01-CONTEXT.md` D-01 supersedes the directory *names* while adopting the rationale),
  and "Pattern 1: Enforcement-point honesty".
- `.planning/research/STACK.md` — `libpg-query` 17.7.4 and the PG-version dist-tag rule,
  `squawk-cli` v2.64.0 with its `win32-x64` binary, zod for rule-config validation, `execa`
  for spawning squawk, vitest, and the explicit "what NOT to use" list (regex; drizzle-kit
  `--strict` as the safety system; Atlas CE `migrate lint` as the sole gate).
- `.planning/research/SUMMARY.md`.

### Existing code this phase builds on

- `package.json` (root) — the workspace, the existing `db:*` script naming convention the new
  command follows, and the current dependency set (`zod` 4.5.4, `execa`, `vitest` 5, `tsx`
  are already present; `libpg-query` and `squawk-cli` are new).
- `pnpm-workspace.yaml`, `tsconfig.base.json` — what `packages/automation` has to slot into.
- `scripts/log.ts` — `safeErrorMessage`, the single tested definition of "print only the
  error's own message". D-08's hard failure must use it.
- `scripts/verify-migration-state.ts` — the established shape for a separate,
  independently-testable module that is provable in the failing direction as well as the
  passing one. The classifier should be built the same way.
- `scripts/drill-assertions.ts` and `tests/drill-assertions.test.ts` — the closest existing
  analogue to a pure logic module with a substantial fixture-driven test suite.
- `apps/recipe-app/drizzle/0000_bumpy_khan.sql`, `0001_busy_thunderbolt.sql`, and
  `meta/_journal.json` — the only genuine migrations in the repo; both belong in the corpus,
  and the journal is what D-11's thin adapter reads.
- `apps/recipe-app/src/db/schema.ts` — `recipes` / `ingredients` / `steps` and their
  `ON DELETE CASCADE` foreign keys, which the D-16 app-shaped fixtures are written against.
  **This file is not modified in this phase.**
- `vitest.config.ts` — the fast default suite the analyzer's tests join. `libpg-query` is
  WASM and needs no Docker, so these are fast tests and belong here, not in
  `vitest.drill.config.ts`.

</canonical_refs>

<code_context>
## Existing Code Insights

Phases 1 and 2 delivered a working local environment and a proven backup/restore path. Phase 3
adds the first genuinely app-agnostic component and, with it, the `packages/` half of the
workspace that has been empty since Phase 1.

### Reusable Assets

- **`scripts/log.ts`** — `safeErrorMessage` is the tested never-leak-a-credential output rule.
  Any new entry point uses it.
- **`scripts/verify-migration-state.ts` / `scripts/drill-assertions.ts`** — both are the
  pattern to copy: pure logic in a module, entry point separate, tested in both directions.
- **`zod` 4.5.4** — already a root dependency; validates the D-03 rules file and the D-13
  corpus manifest with nothing new installed.
- **`execa` 10** — already present; the tool for spawning `squawk.exe` for the D-15 comparison.
- **`vitest` 5 with the fast/slow split** — `vitest.config.ts` already excludes the slow
  Docker suite, so the analyzer's tests land in the fast suite by default with no config work.
- **The two real Drizzle migrations** — genuine ORM-generated SQL for the corpus, so it is not
  entirely hand-written.

### Established Patterns

- **Architectural enforcement over remembered caution.** `01-CONTEXT.md` D-16 pinned the dev
  target in source; `02-CONTEXT.md` D-06 refused a target parameter; this phase's D-02 code
  floor is the same move applied to the rules file.
- **Hard-fail, never warn.** `01-CONTEXT.md` D-20 and `02-CONTEXT.md` D-19 both rejected
  warnings explicitly. D-02 (invalid rules file) and D-08 (parse failure) follow.
- **A thing that could not run is not a thing that passed.** `02-CONTEXT.md` D-20 is the
  direct precedent for D-08's fourth outcome.
- **Modules split from entry points**, so a test can exercise them without side effects.
- **UNKNOWN is a valid answer** — anything the analyzer cannot determine is REVIEW REQUIRED or
  BLOCKED (D-06, D-07), never silently SAFE.
- **Documentation is a deliverable** — the D-15 comparison report is phase output, not overhead.

### Integration Points

- **New:** `packages/automation/` with its own `package.json`, registered in
  `pnpm-workspace.yaml`. First tenant: the inspector, the classifier, the rules file.
- **New:** a root `package.json` script wrapping the CLI (D-12), following the existing `db:*`
  naming convention.
- **New dependencies:** `libpg-query` (PG17 dist-tag, per D9) and `squawk-cli` (dev-only,
  D-15).
- **Reads:** `apps/recipe-app/drizzle/*.sql` and `meta/_journal.json`, through the thin
  adapter only (D-11) — the core never touches the filesystem.
- **Consumed by Phase 4:** the importable classifier function, called in-process by the runner
  immediately before execution (D12/RUN-01). The result shape and the D-08 fourth outcome are
  that contract.
- **Consumed by Phase 5:** the CLI's exit codes and JSON output, plus the per-rule `rationale`
  (D-03) that CI-05 renders on the pull request.
- **Consumed by Phase 7:** rule ids as the key for the override-frequency count, and the
  verdict record for the audit log.

</code_context>

<specifics>
## Specific Ideas

- **"SAFE must be earned."** The single sentence that captures D-06: the whole system's trust
  rests on "the analyzer said SAFE" meaning one thing, so it must never also mean "the
  analyzer had no opinion."
- **The rules file is both the extensibility requirement and the obvious bypass.** D-02 exists
  because those are the same file. A gate whose policy an agent can edit is not a gate.
- **Asking a human to approve SQL nobody can read is not review.** The reasoning behind D-07 —
  and a direct application of the project's standing honesty constraint about what the
  REVIEW REQUIRED gate actually buys.
- **The false-positive half of the adversarial set is the half that rots.** D-14 enforces the
  pairing structurally for that reason: a comment mentioning `DROP TABLE` being flagged is
  exactly the friction that starts the slide toward routine overriding.
- **`lock_timeout` is not an analyzer rule.** It describes the session, not the SQL, and Phase
  4 owns it. Flagging every migration for it would be a false positive by construction.
- **Phase 4 should not discover a miscalibrated rule by running a real schema change.** D-16
  mirrors the reserved churn as fixtures so the expected verdicts are known before the real
  changes are made.
- **A parse failure is not a fourth kind of danger — it is the analyzer failing.** Reporting it
  as BLOCKED would put "the tool broke" and "the migration was destructive" in the same row of
  the Phase 7 audit log.

</specifics>

<deferred>
## Deferred Ideas

- **Rules-file fingerprint carried in every verdict.** Considered as a strengthening of D-02:
  hash the rules file and record it alongside each verdict so weakening edits to *non-floor*
  rules become visible after the fact. Not built now — the floor covers the catastrophic case
  and the fingerprint has no consumer until an audit record exists. Revisit at **Phase 7**
  alongside AUD-01 … AUD-04 and the per-rule override-frequency count.
- **`squawk-cli` as a permanent second opinion in the test suite.** Rejected as the default by
  D-15, not rejected outright. It becomes worth revisiting if the catalogue is edited often
  enough that silent drift is a real risk — at which point the cost is maintaining an
  expected-disagreement list. A re-runnable comparison command is the cheap middle ground and
  is left to Claude's discretion.
- **Constant-folding resolvable `EXECUTE` arguments** so a literal or constant-concatenated
  dynamic statement is classified normally instead of BLOCKED (D-07). More precise, more
  machinery to prove correct. Revisit only if a legitimate migration is actually blocked by it.
- **Widening the window to the pending set**, so a two-step safe form split across two
  migration files is recognised (D-09). This is the shape expand-and-contract actually takes,
  so it belongs with **Phase 7**'s APP-03 work rather than being built speculatively now.
- **Per-application rules overrides / policy layering.** Already deferred project-wide as
  PLAT-02 (Phase 8+, out of v1). This phase ships one rules file for one application.
- **Any override or bypass mechanism for REVIEW REQUIRED.** `PITFALLS.md` §C2's explicit
  warning sign is an override mechanism built before the first real override happened. BLOCKED
  is non-overridable by construction (D-02); the REVIEW REQUIRED approval path is **Phase 5
  and Phase 7** work, with override logging and frequency counting as part of the audit trail.
- **`eugene trace` lock verification against a live throwaway Postgres.** Already deferred as
  ADV-01 (v2). Static classification is this phase's scope; `.planning/research/STACK.md` also
  notes eugene has no Windows binary and is a CI-time tool.
- **Schema drift detection and committed `pg_dump --schema-only` snapshots** (ADV-02, D3's
  visibility mechanism) — **Phase 7**. Related machinery, different purpose.

</deferred>

---

*Phase: 3-Safety Analyzer*
*Context gathered: 2026-09-07*
