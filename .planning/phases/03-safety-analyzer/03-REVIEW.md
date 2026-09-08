---
phase: 03-safety-analyzer
reviewed: 2026-09-08T00:00:00Z
depth: standard
files_reviewed: 34
files_reviewed_list:
  - packages/automation/src/types.ts
  - packages/automation/src/analyze.ts
  - packages/automation/src/inspector/inspect.ts
  - packages/automation/src/inspector/inspect-plpgsql.ts
  - packages/automation/src/inspector/function-volatility.ts
  - packages/automation/src/classifier/classify.ts
  - packages/automation/src/classifier/floor.ts
  - packages/automation/src/classifier/rules-schema.ts
  - packages/automation/src/rules/rules.json
  - packages/automation/src/index.ts
  - packages/automation/src/cli.ts
  - packages/automation/src/adapter/drizzle-migrations.ts
  - packages/automation/src/adapter/default-rules.ts
  - packages/automation/scripts/squawk-comparison.ts
  - packages/automation/package.json
  - packages/automation/tsconfig.json
  - package.json
  - vitest.config.ts
  - packages/automation/test/adapter.test.ts
  - packages/automation/test/analyze-edges.test.ts
  - packages/automation/test/anlz-07.test.ts
  - packages/automation/test/classifier.test.ts
  - packages/automation/test/cli.test.ts
  - packages/automation/test/corpus-manifest-schema.ts
  - packages/automation/test/corpus.test.ts
  - packages/automation/test/corpus/manifest.json
  - packages/automation/test/dynamic-sql.test.ts
  - packages/automation/test/inspector-facts.test.ts
  - packages/automation/test/language-sql-bodies.test.ts
  - packages/automation/test/libpg-query-contract.test.ts
  - packages/automation/test/pairing.test.ts
  - packages/automation/test/parse-failure.test.ts
  - packages/automation/test/plpgsql.test.ts
  - packages/automation/test/rules-catalogue.test.ts
  - packages/automation/test/tracer.test.ts
  - tests/guardrails.test.ts
findings:
  critical: 2
  warning: 4
  info: 2
  total: 8
status: resolved
resolved: 2026-09-08T00:00:00Z
resolution_summary: >
  CR-01, CR-02, WR-01, WR-02, WR-04 fixed (TDD RED->GREEN, one commit per finding); IN-02
  investigated and resolved absent (no false-SAFE variant found, and the WR-01 fix makes the
  underlying truncation mechanism structurally impossible). WR-03 deliberately NOT fixed --
  already tracked as a Phase-7 extractability concern, not a safety issue; left open per the
  fix instructions. IN-01 is a documented, reasoned deviation (libpg-query pg18 pin), not a
  defect -- no action taken.
---

# Phase 3: Code Review Report — Safety Analyzer

**Reviewed:** 2026-09-08
**Depth:** standard
**Files Reviewed:** 34
**Status:** issues_found

## Summary

The analyzer's architecture is sound and its adversarial-fixture discipline (D-14) is genuinely
good: the do-block/function-body/dollar-quoting/quoted-identifier/inline-comment evasion pairs are
real, the corpus harness enforces both halves of every pair structurally, and the post-03-04
"LANGUAGE sql body silently earned SAFE" defect that the task brief cites as precedent has in fact
been closed correctly and is now covered by dedicated regression tests
(`language-sql-bodies.test.ts`).

However, two independently reproducible **false-SAFE** paths remain, both proven empirically
against the real `analyzeSql` entry point (not asserted from static reading), and both squarely in
the "could produce a FALSE SAFE" category this review was asked to hunt for:

1. A multi-subcommand `ALTER TABLE` statement only has its first subcommand inspected — a later,
   genuinely destructive subcommand in the same statement is silently never classified at all.
2. A rule with an empty (or sufficiently broad) `match` object is accepted by the rules schema and
   silently grants blanket SAFE to every statement kind the catalogue does not otherwise recognize,
   defeating D-06's "SAFE must be earned" default without touching any D-02/D-07 floor rule.

Both are demonstrated below with the exact input and the exact `analyzeSql` output that proves
them. A handful of lower-severity issues (a legitimate-SQL false-parse-failure path, a silent
first-statement-only pick in the PL/pgSQL reparse step, an extractability leak, and a
production-rules-file-mutating test) round out the Warning tier.

## Critical Issues

### CR-01: A rule with an empty `match` object grants blanket SAFE to everything D-06 would otherwise default to REVIEW_REQUIRED, and the floor self-check does not catch it

**File:** `packages/automation/src/classifier/rules-schema.ts:18-21` (schema gap), exploited via
`packages/automation/src/classifier/classify.ts:32-36` (`ruleMatches`), not caught by
`packages/automation/src/classifier/floor.ts:58-68` (`assertFloorNotWeakened`)

**Issue:** `FactMatchSchema` is `z.record(z.string(), ...)` with no minimum-key constraint, so a
rule whose `match` is `{}` (or, more subtly, an array that enumerates every legal value of some
field) is accepted by `parseRulesFile`. `ruleMatches` implements "every entry in `match` holds" as
`Object.entries(rule.match).every(...)`, and `Array.prototype.every` on an empty array is
vacuously `true` — so an empty-match rule matches **every** `StatementFacts` value, including every
statement kind the catalogue has no explicit opinion on.

`assertFloorNotWeakened` only re-derives the verdict for the eight named `D02_FLOOR_FACTS` /
`D07_FLOOR_FACTS` entries. Those stay protected because their own specific BLOCKED rules
(`drop-table`, `unresolvable-dynamic-sql`, etc.) still match and "worst verdict wins" over the
catch-all's SAFE. But **every currently-unmatched statement kind** — `CLUSTER`, `REINDEX`,
`ALTER SYSTEM`, `CREATE TABLE AS`, any future PostgreSQL DDL the inspector has no branch for — goes
from D-06's REVIEW_REQUIRED default straight to SAFE, silently, the moment such a rule exists. This
is exactly D-02's own stated tension ("rules-as-data means an agent can edit the rules") applied to
the one property D-02/D-07 do **not** cover: the unmatched-statement default itself.

Verified directly against the real library (not asserted from reading): loading the shipped rules
file with one extra rule appended —
```json
{ "id": "blanket-catch-all", "category": "usually-safe", "match": {}, "verdict": "SAFE",
  "rationale": "..." }
```
— passes `loadRules` with no `RulesFileError` (the floor self-check is satisfied), and
`analyzeSql("CLUSTER t USING idx;", rules)` then returns file verdict **SAFE** with
`ruleIds: ["blanket-catch-all"]`, where the same input against the unmodified shipped rules
returns REVIEW_REQUIRED with no matching rule. A single, innocuous-looking "catch remaining cases"
rule — exactly the kind of edit `PITFALLS.md` §C2 warns an agent will reach for under review
fatigue — silently disables D-06 for every statement kind the catalogue doesn't already name.

**Why it matters here:** D-06 is described in this phase's own context as the sentence the whole
system's trust rests on ("SAFE must be earned... the analyzer said SAFE must never also mean the
analyzer had no opinion"). This is a rules-file-only edit (no code change) that breaks that
sentence for an open-ended set of inputs, while leaving the floor self-check green.

**Fix:**
```ts
// rules-schema.ts
const FactMatchSchema = z
  .record(z.string(), z.union([z.string(), z.boolean(), z.null(), z.array(z.union([z.string(), z.boolean()]))]))
  .refine((match) => Object.keys(match).length > 0, {
    message: "a rule's match object must reference at least one fact — an empty match matches every statement unconditionally",
  });
```
This closes the trivial (zero-effort) exploit. It does not close the broader "enumerate every legal
value of a field" variant, so also add a load-time self-check alongside `assertFloorNotWeakened`
that re-derives the verdict for a representative sample of *unmatched* fact sets (e.g. several
`Unrecognized`-kind `StatementFacts` with differing incidental fields) and throws `RulesFileError`
if any of them resolves to anything other than `REVIEW_REQUIRED` — mirroring the floor check but
protecting D-06's default instead of D-02's named set.

---

### CR-02: `ALTER TABLE` with more than one subcommand only classifies the first — a later destructive subcommand is never observed, and the file verdict can be SAFE

**File:** `packages/automation/src/inspector/inspect.ts:224-264` (`inspectAlterTableStmt`)

**Issue:** `inspectAlterTableStmt` reads `alterTableStmt.cmds` (an array — PostgreSQL's grammar
allows `ALTER TABLE t sub1, sub2, sub3;`) and inspects only `cmds?.[0]`. Every subsequent
subcommand in the same statement is discarded before it ever reaches `StatementFacts`,
`classifyFacts`, or the D-02 floor. The module header documents this as a "KNOWN LIMITATION" and
records it as `UNKNOWN whether a future migration could combine subcommands` — but this system's
own threat model is exactly "an AI agent writes SQL by hand," not only "SQL drizzle-kit generated,"
so this is not a theoretical gap.

Verified directly against the real library:
```
ALTER TABLE orders ADD COLUMN notes text, DROP COLUMN secret_data;
```
`analyzeSql` returns file verdict **SAFE**, `statementCount: 1`, and exactly **one** finding — for
the `AddColumn`/`notes` subcommand only (`add-column-nullable-no-default`, SAFE). The `DROP COLUMN
secret_data` subcommand is not present anywhere in the result: no finding, no rule id, no mention.
The D-02 floor (`drop-column`, BLOCKED) never sees it because `inspectStatement` never produced a
fact set for it at all — this is not a misclassification the floor could catch, it is a statement
the analyzer never looked at, silently reported as if it approved the whole thing.

**Why it matters here:** this is precisely the failure shape named in this review's brief — "a
statement... silently skipped rather than classified" — reproduced with plain SQL, no PL/pgSQL or
dollar-quoting evasion required. `ADD COLUMN ..., DROP COLUMN ...` is not an exotic construct; it's
the natural way to write "add this column and remove that one" as a single statement.

**Fix:** `inspectAlterTableStmt` must produce one fact set per subcommand, not one for the whole
statement. The cleanest shape consistent with this codebase's own D-05 recursion precedent (one
statement → multiple findings, joined by `nestedPath`) is to change `inspectStatement`'s contract
for `AlterTableStmt` to return an array of `StatementFacts` (or route through the same
container/multi-finding machinery `analyze.ts`'s `inspectAndClassifyStatement` already has for
`DoBlock`/`CreateFunction`), and have `analyze.ts` build one `Finding` per subcommand, keeping
`nestedPath: [statementIndex, subcommandIndex]` so D-10's "always the complete findings list"
holds for subcommands too. At minimum, until that lands, `cmds.length > 1` must not silently fall
through to inspecting `cmds[0]` alone — fail closed (e.g. a dedicated `statementKind:
"Unrecognized"` outcome, or a new floor-covered "multi-subcommand-alter-table" fact) rather than
reporting only a fraction of what the statement does.

## Warnings

### WR-01: PL/pgSQL body reconstruction uses a fixed `$$` delimiter, which collides with a nested dollar-quoted literal in the body and turns valid PostgreSQL into a parse failure

**File:** `packages/automation/src/inspector/inspect-plpgsql.ts:207-222` (`planFromTextBody`'s
`reconstructPlPgSql` lambdas at the two call sites in `planContainerBody`, lines 238 and 256)

**Issue:** When a `DO`/`CREATE FUNCTION` body is declared `LANGUAGE plpgsql`, the extracted body
text is re-wrapped as `` `DO $$${body}$$ LANGUAGE plpgsql;` `` (or the `CREATE FUNCTION` equivalent)
before being handed to `parsePlPgSQL`. This assumes the body text contains no literal `$$`
substring. That assumption is false for a common, legal PL/pgSQL idiom: a body whose *outer*
dollar-quote uses a distinct tag (e.g. `$outer$`) and which embeds a dollar-quoted string literal
using the empty tag internally (e.g. `quote_literal($$safe$$)`), which is ordinary valid SQL syntax
usable anywhere a string literal is valid.

Verified directly:
```sql
DO $outer$
BEGIN
  PERFORM quote_literal($$safe$$);
  DROP TABLE orders;
END;
$outer$ LANGUAGE plpgsql;
```
`analyzeSql` **throws** `AnalyzerParseError: syntax error at or near "safe$$"` — the reconstruction
truncates at the first embedded `$$`, and the resulting garbled text fails to parse. Per D-08 this
fails loud rather than silently approving anything, so this is *not* the false-SAFE direction — but
it means a legitimate, syntactically valid migration that PostgreSQL itself would execute without
complaint cannot be classified at all by this analyzer. Per this review's brief, that is exactly
the "opposite direction" friction that "manufactures pressure for an override path."

**Fix:** Reconstruct using a delimiter tag guaranteed not to collide with the body's own content —
e.g. generate a tag from a fixed prefix plus a counter/random suffix and verify it does not appear
as a substring of `body` before using it (regenerate on collision), rather than a hardcoded `$$`.

---

### WR-02: The PL/pgSQL embedded-statement reparse silently keeps only the first statement `parseTopLevel` returns, with no check that exactly one was produced

**File:** `packages/automation/src/inspector/inspect-plpgsql.ts:374` (inside
`inspectContainerBody`'s `"plpgsql"` branch)

**Issue:** `const [stmt] = await parseTopLevel(\`${entry.query};\`);` destructures only the first
element of whatever `parseTopLevel` returns for one `PLpgSQL_stmt_execsql`'s raw query text, and
`if (!stmt) { continue; }` silently skips the statement entirely if none was produced. Nothing
asserts `stmts.length === 1`. This is inconsistent with `inspect.ts`'s own stated discipline one
call away: `parseTopLevel` itself treats an array entry with no `stmt` as a hard parse failure
specifically because "silently dropping it would remove a real statement from classification,
which is the one direction this analyzer must never fail in" (`inspect.ts:80-81`). The same
principle is not applied here: if `entry.query` (raw text from the PL/pgSQL tree) ever yielded more
than one statement when reparsed, every statement after the first would be silently discarded with
no error and no finding — the exact "statement silently skipped" failure shape.

I could not construct a concrete input that reaches this path (PL/pgSQL's own grammar separates
statements at the procedural level before `PLpgSQL_stmt_execsql.sqlstmt.PLpgSQL_expr.query` is
populated, so `entry.query` should always be exactly one statement's text) — flagging this as a
defensive gap and an inconsistency with the codebase's own stated standard, not as a proven
false-SAFE.

**Fix:** Mirror `inspect.ts`'s own guard: `const stmts = await parseTopLevel(...); if (stmts.length !== 1) { throw new AnalyzerParseError(...) }`, so a violated assumption fails loud (D-08) instead of silently discarding statements.

---

### WR-03: The "pure core" (`src/analyze.ts`, `src/inspector/`, `src/classifier/`) imports outside the `packages/automation` package boundary, undermining the stated Phase-7 extractability goal

**File:** `packages/automation/src/inspector/inspect.ts:36`, `inspect-plpgsql.ts:58`,
`packages/automation/src/cli.ts:25` (all `../../../[../]scripts/log`)

**Issue:** `03-CONTEXT.md` D-11 states the pure-core/adapter seam exists specifically "so Phase 7's
extraction is a publish rather than an architecture change," and `packages/automation`'s own
`package.json` declares it with no dependency on anything at the repo root. Yet three modules
inside the package reach outside it with a relative import into the repo root's own
`scripts/log.ts` (`safeErrorMessage`). If `packages/automation` is ever extracted/published on its
own (the explicitly stated Phase 7 goal this seam exists to serve), these three imports break —
`scripts/log.ts` will not exist in the published tree. Notably, `scripts/squawk-comparison.ts`
(also inside this package) gets this right: it defines its own local `safeErrorMessage` rather than
reaching across the boundary, showing the correct pattern was available and simply wasn't applied
inside `src/`.

**Why it matters here:** this is a real, if slow-burning, contradiction of a decision this phase's
own context marks "costly to reverse" ("letting Drizzle or filesystem knowledge leak back into the
core later would have to be unpicked across the classifier, the CLI and the Phase 4 runner"). A
cross-package-root import is the same category of leak, just via `scripts/` instead of Drizzle.

**Fix:** Duplicate the ~1-line `safeErrorMessage` inside `packages/automation` (as
`squawk-comparison.ts` already does), or promote it to a tiny shared workspace package both the
root scripts and `packages/automation` depend on explicitly rather than via a relative reach across
the package boundary.

---

### WR-04: `cli.test.ts`'s RULES_INVALID case mutates the real, shipped `src/rules/rules.json` on disk in place

**File:** `packages/automation/test/cli.test.ts:110-130`

**Issue:** To exercise the CLI's exit-40 path end-to-end through the real spawned binary (necessary
because D-02 deliberately gives the CLI no parameter to load an alternate rules file), this test
reads the actual shipped `rules.json`, writes a weakened copy over it, runs the CLI, and restores
the original in a `finally` block. If the test process is killed or crashes between the write and
the `finally` (a timeout, an OOM, a CI runner interrupt), the repository's real, tracked policy
file — the one every other invocation of this tool loads by default — is left on disk with
`drop-table` set to `SAFE`. The D-02 floor self-check does convert that outcome into a loud failure
rather than a silent one (every subsequent `db:analyze` invocation would itself refuse to start
with `RULES_INVALID` until someone notices and restores the file from git), so this is not a
false-SAFE risk in practice — but it is a real repo-hygiene and CI-flakiness hazard for a file this
project treats as safety-critical, self-inflicted by the test suite.

**Fix:** Write the weakened rules file to a temporary location and have the test spawn the CLI with
`cwd`/an env var pointed at a package copy resolved from that temp path (accepting that this
requires a narrow, test-only escape hatch that D-02's "no parameter may route around the bundled
rules file" would need to explicitly exempt), or accept covering this path at the unit level only
(as `tracer.test.ts` and `dynamic-sql.test.ts` already do via `loadRules` directly) and drop the
full-process exit-code assertion for this one case rather than mutating the real file.

## Info

### IN-01: `libpg-query` is pinned to the pg18 line while the rules catalogue and project docs still describe "PostgreSQL 17 semantics" — a documented, reasoned deviation, flagged for visibility only

**File:** `packages/automation/package.json:11`, `packages/automation/src/inspector/inspect.ts:29-34`

**Issue:** `03-CONTEXT.md` states "PostgreSQL 17 semantics may be assumed by the rules (D9)" and
"the `libpg-query` dist-tag must be pinned to match the PG17 server pin, not left on the package
default," but `package.json` pins `libpg-query` at `18.1.4` (the pg18 line, not the `pg17`
dist-tag). This is not an oversight: `03-01-SUMMARY.md`/`03-04-SUMMARY.md`/`03-07-SUMMARY.md`
record that the pg17 line ships no PL/pgSQL parsing API at all, forcing the upgrade for D-05's
recursion to be buildable, and the "newer grammar is a superset, so the failure direction is
accepting syntax an older server would reject, never missing a real hazard" reasoning is recorded
in `.claude/CLAUDE.md` and `docs/decisions.md` D16. Not asserting this as a defect — it is already
tracked as an open, explicitly-UNKNOWN item (the production PostgreSQL major version). Recording it
here only so it surfaces in this review's own findings list rather than being assumed resolved.

### IN-02: Unverified — the same `$$`-collision reconstruction bug (WR-01) may have a false-SAFE variant, not just a false-parse-failure one

**File:** `packages/automation/src/inspector/inspect-plpgsql.ts:207-222`

**Issue:** WR-01 above is confirmed to fail loud (`AnalyzerParseError`) for the input I constructed.
I was not able to rule out, within this review's time budget, whether a more carefully crafted body
— one where the truncated reconstruction happens to still be syntactically valid PL/pgSQL on its
own, and the leftover trailing text after the premature `$$` also happens to parse as valid
trailing SQL — could cause a genuinely dangerous statement placed after the collision point to be
silently omitted from classification (a parse *success* on a truncated body, rather than a parse
failure) rather than surfaced as either a finding or a hard error. I have not constructed such an
input and am not asserting this happens; flagging it as a follow-up worth a deliberate adversarial
attempt, per this review's instruction to mark unverified suspicions as Info rather than Critical.

---

## Resolution (2026-09-08)

All findings addressed in a dedicated review-fix pass (TDD RED→GREEN, one commit per finding,
no PLAN.md). `pnpm test`: 296/296 (was 278/278 before this pass). `npx tsc --noEmit` clean in
`packages/automation`.

| Finding | Status | Fix |
|---|---|---|
| CR-01 (empty `match` blanket-SAFE) | **Fixed** | `FactMatchSchema` now `.refine`s to reject a `match` object with zero keys, so `parseRulesFile`/`loadRules` throw `RulesFileError` before such a rule can ever reach `classifyFacts`. Commit `7f4d505`. Regression tests in `test/rules-catalogue.test.ts` (the exact `blanket-catch-all` reproduction from this review, plus a positive control proving a real condition is still accepted). |
| CR-02 (multi-subcommand `ALTER TABLE` loses every subcommand after the first) | **Fixed** | `inspectStatement` now returns `StatementFacts[]` (one entry per `AlterTableCmd` subcommand for `ALTER TABLE`, a single-element array for every other statement kind); `analyze.ts` and `inspect-plpgsql.ts` build one `Finding` per subcommand, worst-verdict-wins across them, `nestedPath` identifies each. Commit `cd33399`. Regression tests in `test/multi-subcommand-alter-table.test.ts` (the exact `ADD COLUMN ..., DROP COLUMN ...` reproduction, plus a 3-subcommand case and D-05-composition case). Corpus fixtures + manifest rows added (commit `c7e807b`): `blocked/multi-subcommand-alter-table.sql` (BLOCKED), `safe/multi-subcommand-alter-table-all-safe.sql` (SAFE, proves completeness even with no hazard). |
| WR-01 ($$ delimiter collision in PL/pgSQL body reconstruction) | **Fixed** | `pickDollarQuoteTag` chooses a `$gsd_N$` tag verified not to occur in the body before reconstructing, instead of a hardcoded `$$`. Commit `fe3b30f`. Regression tests in `test/dollar-quote-collision.test.ts`, including the exact `$outer$` / `quote_literal($$safe$$)` reproduction from this review. |
| WR-02 (embedded-statement reparse silently keeps only the first statement) | **Fixed** | New exported `reparseEmbeddedSql` throws `AnalyzerParseError` unless the reparse yields exactly one statement (covers both the "more than one" and the previously-silent "zero" cases). Commit `a282148`. Unit-tested directly in `test/embedded-reparse-guard.test.ts` since no real PL/pgSQL grammar has been found that reaches this path with more than one statement (as this review itself noted). |
| WR-03 (pure-core imports reach outside the package boundary via `scripts/log.ts`) | **Deliberately not fixed** | Confirmed still open, per the fix instructions given for this pass: a Phase-7 extractability concern, not a safety issue, already tracked. Left as-is. |
| WR-04 (`cli.test.ts` mutates the shipped `rules.json` on disk) | **Fixed** | Removed the mutating RULES_INVALID end-to-end test from `cli.test.ts`; its throwing behaviour is already covered at the unit level by `tracer.test.ts`'s `loadRules`-based test (in-memory weakened copy, never touches disk). Commit `bc4c172`. No test in the suite mutates `src/rules/rules.json` after this fix — confirmed via `git status`/`git diff` showing zero changes to that file across the whole pass. |
| IN-01 (`libpg-query` pinned to pg18 while docs describe PG17 semantics) | **No action** | Reconfirmed as a documented, reasoned deviation (newer grammar is a superset; failure direction is accepting syntax an older server would reject, never missing a real hazard) — not a defect. |
| IN-02 (unverified: does the WR-01 collision have a false-SAFE variant?) | **Investigated — resolved absent** | Verified live against the installed `libpg-query` package (disposable probe script, discarded, per this project's "reason from real behaviour" discipline): fed the OLD fixed-`$$` reconstruction several crafted bodies designed to make the truncated-and-reassembled text still parse as valid multi-statement SQL. `parsePlPgSQL` returns one `plpgsql_funcs` entry per embedded DO/FUNCTION construct found in the text (not just the first), and `extractEmbeddedSql`'s `walk` is a deep, generic, unconditional traversal of the entire returned tree — so an injected `DROP TABLE` inside a second, syntactically-valid embedded DO block was still found and classified. A variant where the trailing content is a bare (non-DO-wrapped) SQL statement instead failed to parse at all (fail loud, not silent). No input tried produced a false SAFE: every attempt either failed loud (`AnalyzerParseError`) or was still fully classified (caught by the generic walk). This is proven for the OLD reconstruction shape specifically; the WR-01 fix (commit `fe3b30f`) additionally makes the premature-truncation mechanism this question depends on structurally impossible going forward, since the chosen delimiter tag is verified not to occur in the body at all. |

---

_Reviewed: 2026-09-08_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_Resolution pass: 2026-09-08_
