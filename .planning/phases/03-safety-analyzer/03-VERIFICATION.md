---
phase: 03-safety-analyzer
verified: 2026-09-08T16:05:40Z
status: gaps_found
score: 4/5 must-haves verified
covered_files: [".planning/REQUIREMENTS.md", ".planning/phases/03-safety-analyzer/03-01-PLAN.md", ".planning/phases/03-safety-analyzer/03-01-SUMMARY.md", ".planning/phases/03-safety-analyzer/03-02-PLAN.md", ".planning/phases/03-safety-analyzer/03-02-SUMMARY.md", ".planning/phases/03-safety-analyzer/03-03-PLAN.md", ".planning/phases/03-safety-analyzer/03-03-SUMMARY.md", ".planning/phases/03-safety-analyzer/03-04-PLAN.md", ".planning/phases/03-safety-analyzer/03-04-SUMMARY.md", ".planning/phases/03-safety-analyzer/03-05-PLAN.md", ".planning/phases/03-safety-analyzer/03-05-SUMMARY.md", ".planning/phases/03-safety-analyzer/03-06-PLAN.md", ".planning/phases/03-safety-analyzer/03-06-SUMMARY.md", ".planning/phases/03-safety-analyzer/03-07-PLAN.md", ".planning/phases/03-safety-analyzer/03-07-SUMMARY.md", ".planning/phases/03-safety-analyzer/03-CONTEXT.md", ".planning/phases/03-safety-analyzer/03-REVIEW.md", ".planning/phases/03-safety-analyzer/COVERAGE.md", "docs/30-squawk-comparison.md", "docs/decisions.md", "packages/automation/scripts/squawk-comparison.ts", "packages/automation/src/adapter/default-rules.ts", "packages/automation/src/adapter/drizzle-migrations.ts", "packages/automation/src/analyze.ts", "packages/automation/src/classifier/classify.ts", "packages/automation/src/classifier/floor.ts", "packages/automation/src/classifier/rules-schema.ts", "packages/automation/src/cli.ts", "packages/automation/src/index.ts", "packages/automation/src/inspector/function-volatility.ts", "packages/automation/src/inspector/inspect-plpgsql.ts", "packages/automation/src/inspector/inspect.ts", "packages/automation/src/rules/rules.json", "packages/automation/src/types.ts"]
covered_digest: "v1:sha256:a861274918b550b5f3893658978c8a864c95ee198a3446370946b90b2fb3d418"
behavior_unverified: 0
overrides_applied: 0
gap_closure:
  closed: 2026-09-08
  commits: ["d41954f", "f7ff627"]
  summary: >
    Closed by a second load-time self-check: floor.ts's new D06_UNMATCHED_CANARY_FACTS /
    assertUnmatchedDefaultsToReview (mirroring assertFloorNotWeakened, called from
    classify.ts's loadRules alongside it) re-derives the verdict for a representative sample
    of unmatched StatementFacts through the real classifyFacts and throws RulesFileError
    unless every one resolves to REVIEW_REQUIRED. The exact enumerate-all-28-statementKind
    reproduction below is now rejected at load time (live-verified against the installed
    library, and covered by a permanent regression test in rules-catalogue.test.ts that
    derives the exploit's statementKind list from the shipped rules.json itself, not a
    hardcoded snapshot). CLUSTER/REINDEX stay REVIEW_REQUIRED and the D-02/D-07 floor stays
    BLOCKED under the closed rules file. pnpm test: 301/301 (was 296/296); tsc --noEmit
    clean. This closure was executed directly from this report's own "To close" instructions,
    without a PLAN.md; a full phase re-verification (/gsd-verify-work) is still the
    authoritative confirmation this gap is closed to the verifier's own standard.
gaps:
  - truth: "The classifier resists being fooled in either direction by deliberate attack on the rules file itself (D-06's 'SAFE must be earned' default)"
    status: resolved
    resolution: "See gap_closure above -- commits d41954f (RED test), f7ff627 (GREEN fix)."
    reason: >
      The code-review pass (03-REVIEW.md, CR-01) found that a rule whose `match` object is empty
      (`{}`) grants blanket SAFE to every unmatched statement kind, defeating D-06's default. The
      shipped fix (`FactMatchSchema.refine` in rules-schema.ts, commit 7f4d505) closes only the
      trivial zero-key case. The review's own text explicitly flagged that this does NOT close the
      broader variant -- "enumerate every legal value of a field" -- and recommended a second,
      load-time self-check (mirroring assertFloorNotWeakened but protecting D-06's default instead
      of D-02's floor). That second self-check was never built. I reproduced the broader bypass live
      against the actual installed library: a rules file with one added rule
      (`{"id":"enumerate-catch-all","match":{"statementKind":[...every StatementKind value...]},
      "verdict":"SAFE",...}`) passes both `parseRulesFile` and `assertFloorNotWeakened` with no error,
      and `classifyFacts({statementKind:"Unrecognized"}, rules)` then returns SAFE with
      `ruleIds:["enumerate-catch-all"]` -- the exact CLUSTER/REINDEX/ALTER SYSTEM/any-uncatalogued-
      DDL case CR-01 was raised to close. D-02's eight named floor operations remain protected
      (their own specific BLOCKED rules still match and worst-verdict-wins over the catch-all), so
      no catastrophic-named operation can be forced SAFE this way -- but the general "an operation
      the catalogue has never heard of stops for a human" guarantee (D-06, the sentence the review
      itself calls "the whole system's trust rests on") can currently be disabled by a single,
      superficially-plausible rule-file edit, which is exactly the threat model D-02/D-06 exist to
      resist (an AI agent editing the rules file under review fatigue, PITFALLS.md §C2).
    artifacts:
      - path: "packages/automation/src/classifier/rules-schema.ts"
        issue: "FactMatchSchema.refine rejects only a zero-key match object, not an exhaustive-enumeration match object"
      - path: "packages/automation/src/classifier/floor.ts"
        issue: "assertFloorNotWeakened only re-derives the eight named D-02/D-07 floor fact sets; it has no equivalent self-check protecting D-06's unmatched-statement default"
    missing:
      - "A load-time self-check (the one 03-REVIEW.md's CR-01 fix section explicitly proposed) that re-derives the verdict for a representative sample of *unmatched* StatementFacts (varied statementKind values not covered by any named catalogue rule) and throws RulesFileError if any resolves to anything other than REVIEW_REQUIRED"
      - "A regression test proving the enumerate-every-value bypass is rejected, alongside the existing empty-match regression test in rules-catalogue.test.ts"
---

# Phase 3: Safety Analyzer Verification Report

**Phase Goal:** Every migration's SQL is classified SAFE, REVIEW REQUIRED, or BLOCKED by parsing
real Postgres grammar, and the classifier has been shown — by deliberate attack — to resist being
fooled in either direction.
**Verified:** 2026-09-08T16:05:40Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A real `DROP TABLE` is BLOCKED and a genuinely safe additive migration is SAFE, by automated test (SC1/ANLZ-07) | ✓ VERIFIED | `test/anlz-07.test.ts` (in suite); independently re-run live: `node --import tsx src/cli.ts` against a fresh `DROP TABLE` fixture → `BLOCKED`, exit 20; against `ALTER TABLE orders ADD COLUMN notes text;` → `SAFE`, exit 0 |
| 2 | Classification is context-aware: volatile vs. non-volatile `ADD COLUMN DEFAULT`, `NOT VALID`+`VALIDATE CONSTRAINT`, `CONCURRENTLY` recognized as safe forms (SC2/ANLZ-04) | ✓ VERIFIED | Live CLI run: `DEFAULT clock_timestamp()` → REVIEW_REQUIRED (`add-column-volatile-default`); `DEFAULT now()` → SAFE (`add-column-nonvolatile-default`); pairing tests (`pairing.test.ts`, corpus `pairing-not-valid-then-validate.sql`, `pairing-concurrent-index-then-unique.sql`) pass in the 296/296 run |
| 3 | Adversarial fixtures (comment, dollar-quoted string, DO block, function body) neither miss a real hidden drop nor falsely flag inert text (SC3/ANLZ-05) | ✓ VERIFIED | `test/corpus.test.ts` D-14 pair-integrity check passes; 5 matched pairs, 10 fixtures, structurally enforced; independently re-ran two of the five shapes live (multi-subcommand `ALTER TABLE` attack and a `DO` block with real control flow around the drop) — both correctly BLOCKED. See "Adversarial claim assessment" below for the qualification this score carries. |
| 4 | Every classification rule lives in a schema-validated rules file; an invalid rules file fails validation rather than being silently accepted (SC4/ANLZ-03) | ✗ FAILED | `parseRulesFile`/`loadRules` do reject a structurally invalid file (missing fields, wrong types, empty `match`) — confirmed live. But a *structurally valid*, policy-defeating rule (exhaustive enumeration of every `StatementKind` value in `match`, verdict `SAFE`) is accepted with no error and silently grants blanket SAFE to every uncatalogued statement kind — reproduced live against the installed library (see gap below). This is a live, currently-exploitable false-SAFE path the phase's own code review identified and left open. |
| 5 | Corpus run through both the analyzer and `squawk-cli` produces a comparison report with every disagreement examined and explained (SC5/ANLZ-06) | ✓ VERIFIED | `docs/30-squawk-comparison.md`: 49/49 corpus files, 21 disagreements, each labelled and explained (analyzer-correct / different-by-design), zero unlabelled/placeholder rows, zero `UNKNOWN` outcomes; `do-block-drop.sql` result (squawk 0 findings on a real hidden DROP TABLE) cross-checked against a live re-run of that exact fixture through the CLI (correctly BLOCKED) |

**Score:** 4/5 truths verified (0 present, behavior-unverified)

### Adversarial claim assessment (the phase's central, judgment-requiring claim)

The phase goal's operative sentence is that the classifier "has been shown — by deliberate attack —
to resist being fooled in either direction." The evidence record for this phase does **not**
support that sentence read at face value, and the record itself explains why:

- **The phase's own adversarial plan (03-06) found nothing.** Its five matched pairs were derived
  by running the already-built analyzer and recording its actual output — a structural corpus
  check, not an attempt to break the classifier. 03-06-SUMMARY.md states this directly: "no
  analyzer defect was found by this plan (a null result reported honestly, not a foregone
  conclusion)."
- **Three real false-SAFE defects existed at the time 03-06 ran and were found elsewhere:**
  1. `DROP TABLE`/`TRUNCATE` inside a `LANGUAGE sql` function body classified SAFE — found by
     independent probing after 03-04 reported complete with a passing self-check (fixed
     `399e35f`/`012eba0`, confirmed present in current code and covered by
     `language-sql-bodies.test.ts`).
  2. An empty `match: {}` rule blanket-matched everything — found by the code-review gate, not by
     any plan's own tests (partially fixed, see the still-open gap above).
  3. Multi-subcommand `ALTER TABLE` classified only the first subcommand, silently dropping later
     subcommands including genuinely destructive ones — found by the code-review gate. I
     independently reproduced the original attack shape (`ALTER TABLE orders ADD COLUMN notes
     text, DROP COLUMN secret_data;`) against the current code and confirm it is now correctly
     BLOCKED (fix `cd33399`, confirmed present, regression test `multi-subcommand-alter-table.test.ts`
     confirmed present and passing).
- **The pattern across all three is the same and matches this phase's own framing exactly:** every
  defect was the analyzer silently discarding something (a nested body, later subcommands, an
  unmatched-statement default) rather than misjudging something it actually examined. Defect #3
  needed no adversarial intent — Drizzle generates multi-subcommand `ALTER TABLE` routinely — so it
  was a correctness bug the adversarial framing did not even need to find.
- **CR-01's fix is incomplete, and I found a fourth live instance of the same pattern** (documented
  as a gap above): the "enumerate every legal value" variant the review itself named as unclosed is,
  in fact, still open and exploitable today.

**Conclusion on the claim:** the classifier's *named, catastrophic* operations (D-02's floor: DROP
TABLE, DROP SCHEMA, DROP DATABASE, TRUNCATE, DROP COLUMN, unscoped DELETE/UPDATE) are genuinely
non-weakenable by any rules-file edit — this was verified directly, including under the CR-01
enumerate-catch-all rule, which still leaves every floor operation BLOCKED via worst-verdict-wins.
That specific, most-severe claim holds. But the broader "resist being fooled in either direction"
claim, read as covering the full rules-file attack surface (not just the eight named floor
operations), does not currently hold: I demonstrated, using the exact attack shape the phase's own
review proposed and left as a documented follow-up, that D-06's "an unfamiliar operation defaults to
REVIEW REQUIRED, never SAFE" guarantee can be disabled by one rules-file edit that passes both
schema validation and the floor self-check with no error. Given that D-02 exists specifically because
the rules file is an AI-agent-editable attack surface, and D-06 is described in this phase's own
context as "the sentence the whole system's trust rests on," this is a goal-relevant gap, not a
cosmetic one — even though it is narrower than a full defeat (the eight named catastrophic
operations are unaffected).

A weaker, accurate restatement the evidence *does* support: the classifier has been shown to resist
several real, independently-verified attacks (three defects found and fixed, one attack class
reproduced and confirmed fixed in this session), its named catastrophic-operation floor is provably
non-weakenable, and one specific, previously-identified attack against its general "unknown means
REVIEW REQUIRED" default remains open.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/automation/src/inspector/inspect.ts` | Real PostgreSQL AST parsing (`libpg-query`), never regex | ✓ VERIFIED | Uses `parsePlPgSQL`/parse-tree walking; no regex/string matching found in a scan of the module |
| `packages/automation/src/classifier/classify.ts` | Pure `facts + rules → verdict` function | ✓ VERIFIED | `classifyFacts` is a pure function; imported and used by `analyze.ts`, `floor.ts`'s self-check, and the CLI |
| `packages/automation/src/classifier/floor.ts` | Non-weakenable D-02/D-07 floor | ✓ VERIFIED, with the scope caveat above | `assertFloorNotWeakened` re-derives all 8 named fact sets through the real `classifyFacts`; confirmed live that it still holds under the CR-01 enumerate-catch-all rule |
| `packages/automation/src/classifier/rules-schema.ts` | Schema-validated rules file (zod) | ⚠️ PARTIAL | Structural validation (D-03) works; the `.refine` closing CR-01 covers only the empty-match case, not the enumerate-every-value case (see gap) |
| `packages/automation/test/corpus/manifest.json` | Corpus manifest, D-14 pairs, D-16 app-shaped group, real migrations | ✓ VERIFIED | 51 entries: 36 catalogue, 10 adversarial (5 balanced pairs), 3 app-shaped, 2 real-migration — counted directly from the JSON |
| `docs/30-squawk-comparison.md` | Committed, fully-annotated D-15 comparison report | ✓ VERIFIED | 49 rows, 21 disagreements, all labelled and explained, 0 unresolved |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `test/corpus.test.ts` | `test/corpus/manifest.json` | pair-integrity check groups by `pairId` | ✓ WIRED | Confirmed structurally (all 5 pairIds have exactly one `hidden-executable` and one `inert-text-only` row) |
| `test/corpus/manifest.json` | `apps/recipe-app/drizzle/0000_bumpy_khan.sql` | real-migration row referencing the genuine file in place | ✓ WIRED | Confirmed path present in manifest; `pnpm db:analyze:migrations` referenced in 03-06-SUMMARY as exiting 10 with report sections for both real migrations |
| `packages/automation/src/classifier/floor.ts` | `packages/automation/src/classifier/classify.ts` | `assertFloorNotWeakened` calls the real `classifyFacts`, no duplicate copy | ✓ WIRED | Confirmed by reading both modules; `loadRules` in `classify.ts` calls `assertFloorNotWeakened(rulesFile, classifyFacts)` |
| Rules file → CLI verdict | CLI has no parameter/flag/env that weakens a verdict | — | ✓ VERIFIED (prohibition) | `cli.ts`'s only flags are `--json` and `--migrations`; no rules-path or severity-override flag exists |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Real `DROP TABLE` is BLOCKED | `node --import tsx src/cli.ts <drop.sql>` | `BLOCKED`, exit 20, finding `drop-table` | ✓ PASS |
| Additive nullable column is SAFE | `node --import tsx src/cli.ts <add-column.sql>` | `SAFE`, exit 0, finding `add-column-nullable-no-default` | ✓ PASS |
| Multi-subcommand `ALTER TABLE` (CR-02 attack) is fully classified, not truncated | `ALTER TABLE orders ADD COLUMN notes text, DROP COLUMN secret_data;` | `BLOCKED`, exit 20, both subcommands reported (`add-column-nullable-no-default` SAFE + `drop-column` BLOCKED) | ✓ PASS |
| `DROP TABLE` inside a `DO` block with real control flow (D-14 shape) is caught | `DO $$ BEGIN IF true THEN DROP TABLE orders; END IF; END; $$;` | `BLOCKED`, exit 20, `drop-table` finding present | ✓ PASS |
| `LANGUAGE sql` function body hiding a drop (the original mid-phase defect) stays fixed | `CREATE FUNCTION do_bad() RETURNS void AS 'DROP TABLE orders;' LANGUAGE sql;` | `BLOCKED`, exit 20 | ✓ PASS |
| Volatile vs. non-volatile `ADD COLUMN DEFAULT` context-awareness | `DEFAULT clock_timestamp()` vs. `DEFAULT now()` | REVIEW_REQUIRED vs. SAFE respectively | ✓ PASS |
| Empty-`match` rule (CR-01 trivial case) is rejected at load time | `loadRules` with a `match: {}` rule appended to the real shipped `rules.json` | Threw `RulesFileError` naming the rule and the reason | ✓ PASS |
| **Enumerate-every-value `match` rule (CR-01 broad case) is accepted and produces a false SAFE** | `loadRules` with `match: {statementKind: [...all 28 StatementKind values...]}`, verdict `SAFE`, appended to the real shipped `rules.json`; then `classifyFacts({statementKind:"Unrecognized"}, rules)` | Rules file **loaded with no error**; `classifyFacts` returned **SAFE** with `ruleIds: ["enumerate-catch-all"]` for an otherwise-unmatched statement kind | ✗ **FAIL** |
| Full test suite | `pnpm test` (run once, root) | 296/296 passing, 30 test files | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|-----------------|--------------|--------|----------|
| ANLZ-01 | 03-01, 03-03 | Parse via `libpg-query`, never regex | ✓ SATISFIED | `inspector/inspect.ts` uses real AST parsing throughout |
| ANLZ-02 | 03-01, 03-02, 03-03, 03-05 | Every operation classified SAFE/REVIEW/BLOCKED | ✓ SATISFIED | `classifyFacts` always returns one of the three verdicts (D-06 default is REVIEW_REQUIRED, never unset) |
| ANLZ-03 | 03-01, 03-02 | Rules are a schema-validated data file | ⚠️ PARTIALLY SATISFIED | Schema validation exists and rejects structurally invalid files; does not yet reject a structurally-valid, policy-defeating rule (the CR-01 gap above bears directly on this requirement's intent) |
| ANLZ-04 | 03-02, 03-05 | Context-aware classification (volatility, NOT VALID/VALIDATE, CONCURRENTLY) | ✓ SATISFIED | Confirmed live and via `pairing.test.ts` |
| ANLZ-05 | 03-04, 03-06 | Adversarial fixtures prove resistance in both directions | ⚠️ PARTIALLY SATISFIED | The five D-14 shapes are structurally proven; the broader "cannot be fooled" claim the requirement's own wording implies is qualified by the still-open CR-01 gap (see "Adversarial claim assessment") |
| ANLZ-06 | 03-07 | squawk-cli cross-check with disagreements explained | ✓ SATISFIED | `docs/30-squawk-comparison.md`, 49/49 files, 21/21 disagreements labelled |
| ANLZ-07 | 03-05, 03-06 | Real DROP TABLE blocked, genuinely safe migration passes, by test | ✓ SATISFIED | `test/anlz-07.test.ts`, independently re-run live |

No orphaned requirements: all seven ANLZ-01…07 IDs appear in at least one plan's `requirements:` frontmatter and are cross-referenced in `.planning/REQUIREMENTS.md`.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers found in any file modified this phase | — | — |

Two items are explicitly open by deliberate, documented decision (not anti-patterns, recorded here
for completeness per the verification notes):
- Production PostgreSQL major version remains UNKNOWN (`docs/decisions.md` D16) — does not block
  this phase, flagged for Phase 5.
- WR-03 (pure-core imports reaching `scripts/log.ts` outside the package boundary) is deliberately
  deferred to Phase 7's extraction, per `03-REVIEW.md`'s explicit resolution note.
- `DROP OWNED BY <role>` classifies REVIEW_REQUIRED, not BLOCKED — an open judgment call for the
  owner (per verification notes), not a defect.

### Squawk Cross-Check Sanity

Independently spot-checked `docs/30-squawk-comparison.md`'s most significant claim — that squawk
produced zero findings for `adversarial/do-block-drop.sql`, a real DROP TABLE hidden in a DO block —
by re-running that exact fixture through this analyzer's own CLI: it correctly returns BLOCKED with
a `drop-table` finding. The report's framing (an independent linter missing a hazard this analyzer's
D-05 recursion catches) is consistent with what the code does today.

## Gaps Summary

**Status: closed (2026-09-08), pending re-verification.** The gap below was closed directly from
this report's own "To close" instructions (commits `d41954f` RED, `f7ff627` GREEN; no PLAN.md).
`floor.ts` gained `D06_UNMATCHED_CANARY_FACTS`/`assertUnmatchedDefaultsToReview`, wired into
`classify.ts`'s `loadRules` alongside `assertFloorNotWeakened`; the exact enumerate-all-28-
statementKind reproduction below is now rejected at load time (`RulesFileError`), live-verified
against the installed library, with a permanent regression test in `rules-catalogue.test.ts` that
derives the exploit's statementKind list from the shipped `rules.json` itself rather than a
hardcoded snapshot. `pnpm test`: 301/301. `tsc --noEmit` clean. See `gap_closure` in this report's
frontmatter for the full record. The original gap description is left intact below, unedited, as
the historical record of what was found; treat it as resolved per `gap_closure`, not as still open.
A full `/gsd-verify-work` pass is the authoritative confirmation of closure to the verifier's own
standard and has not yet been re-run.

One must-have fails: the rules-file schema validation (SC4/ANLZ-03) accepts a structurally valid but
policy-defeating rule that grants blanket SAFE to every uncatalogued statement kind, disabling D-06's
"SAFE must be earned" default. This is not a hypothetical — it was named as an open follow-up in the
phase's own code review (03-REVIEW.md, CR-01) and I reproduced it live against the current, shipped
code. It does not threaten the eight D-02/D-07 floor operations (confirmed those stay BLOCKED even
under the exploit), so the single most catastrophic class of mistake (a live `DROP TABLE` etc.) is
still structurally prevented. But the phase goal's "resist being fooled in either direction by
deliberate attack" claim, and ANLZ-03/ANLZ-05's requirement language, are not fully met while this
gap is open.

**To close:** implement the second self-check 03-REVIEW.md's own CR-01 fix section proposed —
re-derive the verdict for a representative sample of unmatched `StatementFacts` (varied
`statementKind` values with no catalogue rule) at rules-load time, alongside
`assertFloorNotWeakened`, and throw `RulesFileError` if any resolves to anything other than
REVIEW_REQUIRED. Add a regression test for the exact enumerate-every-value reproduction recorded in
this report, alongside the existing empty-match regression test in `rules-catalogue.test.ts`.

---

_Verified: 2026-09-08T16:05:40Z_
_Verifier: Claude (gsd-verifier)_
