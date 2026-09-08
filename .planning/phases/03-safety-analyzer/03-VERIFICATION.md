---
phase: 03-safety-analyzer
verified: 2026-09-08T16:45:00Z
status: passed
score: 5/5 must-haves verified
covered_files: [".planning/REQUIREMENTS.md", ".planning/phases/03-safety-analyzer/03-01-PLAN.md", ".planning/phases/03-safety-analyzer/03-01-SUMMARY.md", ".planning/phases/03-safety-analyzer/03-02-PLAN.md", ".planning/phases/03-safety-analyzer/03-02-SUMMARY.md", ".planning/phases/03-safety-analyzer/03-03-PLAN.md", ".planning/phases/03-safety-analyzer/03-03-SUMMARY.md", ".planning/phases/03-safety-analyzer/03-04-PLAN.md", ".planning/phases/03-safety-analyzer/03-04-SUMMARY.md", ".planning/phases/03-safety-analyzer/03-05-PLAN.md", ".planning/phases/03-safety-analyzer/03-05-SUMMARY.md", ".planning/phases/03-safety-analyzer/03-06-PLAN.md", ".planning/phases/03-safety-analyzer/03-06-SUMMARY.md", ".planning/phases/03-safety-analyzer/03-07-PLAN.md", ".planning/phases/03-safety-analyzer/03-07-SUMMARY.md", ".planning/phases/03-safety-analyzer/03-CONTEXT.md", ".planning/phases/03-safety-analyzer/03-REVIEW.md", ".planning/phases/03-safety-analyzer/COVERAGE.md", "docs/30-squawk-comparison.md", "docs/decisions.md", "packages/automation/scripts/squawk-comparison.ts", "packages/automation/src/adapter/default-rules.ts", "packages/automation/src/adapter/drizzle-migrations.ts", "packages/automation/src/analyze.ts", "packages/automation/src/classifier/classify.ts", "packages/automation/src/classifier/floor.ts", "packages/automation/src/classifier/rules-schema.ts", "packages/automation/src/cli.ts", "packages/automation/src/index.ts", "packages/automation/src/inspector/function-volatility.ts", "packages/automation/src/inspector/inspect-plpgsql.ts", "packages/automation/src/inspector/inspect.ts", "packages/automation/src/rules/rules.json", "packages/automation/src/types.ts", "packages/automation/test/rules-catalogue.test.ts"]
covered_digest: "v1:sha256:f7636f6d99f3f55acb5c269b917b981429e347cd47e0eaf4a9b9edd46501ac66"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 4/5
  gaps_closed:
    - "The classifier resists being fooled in either direction by deliberate attack on the rules file itself (D-06's 'SAFE must be earned' default)"
  gaps_remaining: []
  regressions: []
---

# Phase 3: Safety Analyzer Verification Report

**Phase Goal:** Every migration's SQL is classified SAFE, REVIEW REQUIRED, or BLOCKED by parsing
real Postgres grammar, and the classifier has been shown — by deliberate attack — to resist being
fooled in either direction.
**Verified:** 2026-09-08T16:45:00Z
**Status:** passed
**Re-verification:** Yes — after gap closure (commits `d41954f`, `f7ff627`, `98788dc`)

## What changed since the last verification

`floor.ts` gained `D06_UNMATCHED_CANARY_FACTS` (15 fact sets, each `EMPTY_FACTS` with exactly one
field varied away from its neutral default) and `assertUnmatchedDefaultsToReview`, which
re-derives the verdict for every canary through the real `classifyFacts` and throws
`RulesFileError` unless all 15 resolve to `REVIEW_REQUIRED`. `classify.ts`'s `loadRules` now calls
this alongside the pre-existing `assertFloorNotWeakened`. I did not take the SUMMARY/gap-closure
narrative's word for this — I re-derived the finding independently against the actual code, then
went further than the closure record and than the orchestrator's own reproduction list.

## Independent re-verification of the closed gap

I built a throwaway probe script (`node --import tsx`, deleted before finishing; confirmed via
`git status --short` that the working tree is unchanged) and ran every rules-file payload through
the real `loadRules`/`classifyFacts` functions — not a reading of the code, an actual execution
against the shipped `rules.json` (confirmed 37 rules, matching the SUMMARY's count).

**The five reproductions the orchestrator asked me to confirm or refute, run live:**

| # | Attack | Result |
|---|--------|--------|
| 1 | Enumerate all 28 `StatementKind` values → SAFE | **REJECTED** — `RulesFileError`: statementKind "Unrecognized" resolved to SAFE, not REVIEW_REQUIRED |
| 2 | Same, plus an extra match field (`bodyInspected: [true,false]`) | **REJECTED** — same failure mode |
| 3 | The original empty `match: {}` | **REJECTED** — by `rules-schema.ts`'s `FactMatchSchema.refine` (schema-level, pre-dates this gap closure) |
| 4 | All 28 kinds *except* `"Unrecognized"` | **REJECTED** — caught by the `AddUniqueConstraint`/`usingIndexName` canary, not the `Unrecognized` canary, confirming the canary set's stated "defense in depth beyond the never-heard-of-kind shape" claim is real, not aspirational |
| 5 | A floor-weakening rule (`DropTable` → SAFE) | **Loads** (as the orchestrator observed) — but I additionally called `classifyFacts` directly on `DropTable` facts under the loaded, exploited rules file: it still returns `BLOCKED` (`ruleIds: ["drop-table", "drop-table-safe-exploit"]`), because the catalogue's own `drop-table` BLOCKED rule also matches and worst-verdict-wins. This is not a live weakening of the floor — it is the documented, intended behavior (`assertFloorNotWeakened` only fires when the *net* verdict changes) |

All five match the orchestrator's independently-reported results exactly. The shipped,
unmodified `rules.json` still loads with no error (37 rules, unchanged).

**Beyond the orchestrator's list, I devised five further attack shapes not in the original
reproduction, specifically targeting the general exploit *class* (small-domain-field
enumeration) rather than the one already-demonstrated instance, to test whether the fix closes
the class or only the specific reproduction:**

| # | Novel attack | Result |
|---|--------------|--------|
| 6 | Enumerate `nestingLimitExceeded: [true, false]` alone, no `statementKind` key — targets the one boolean field the canary set deliberately does *not* vary | **REJECTED** — every canary's neutral default for this field (`false`) is still inside `[true, false]`, so the canary check catches it via the shared default, exactly as `floor.ts`'s own design comment claims |
| 7 | Enumerate `defaultVolatility`'s full 5-value domain alone | **REJECTED** |
| 8 | Enumerate `sourceContext`'s full 3-value domain alone | **REJECTED** |
| 9 | Split the 28 `statementKind` values across **two separate rules** (14 + 14), each individually narrower than the full enumeration, to test whether the check only catches a single all-in-one rule | **REJECTED** — the second rule alone still matches enough canaries |
| 10 | Single-scalar match `{ table: null }` (not an enumeration, the neutral-default value shared by every canary) | **REJECTED** |

All ten held. This is meaningfully stronger evidence than "the one demonstrated reproduction is
now blocked" — it is evidence the fix closes the *general shape* of the exploit class, which is
what the fix's own design comment in `floor.ts` claims but which nothing in the gap-closure
record had actually tested beyond the original reproduction.

**Regression suite:** ran only the targeted test group first (`npx vitest run -t "D-06 gap
closure"`, 5/5 passed — the tests in `rules-catalogue.test.ts` that derive the exploit's
`statementKind` list from the shipped `rules.json` itself, not a hardcoded snapshot), then the
full suite once (`pnpm test` from repo root): **301/301 passing, 30 test files** (was 296/296).
`npx tsc --noEmit` in `packages/automation`: clean, no output.

**Live CLI spot-check (fresh, this session):** `DROP TABLE orders;` → `BLOCKED`, exit 20,
`drop-table` finding; `ALTER TABLE orders ADD COLUMN notes text;` → `SAFE`, exit 0,
`add-column-nullable-no-default` finding. Both temp fixtures deleted; working tree confirmed
clean (`git status --short packages/automation` → empty).

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A real `DROP TABLE` is BLOCKED and a genuinely safe additive migration is SAFE, by automated test (SC1/ANLZ-07) | ✓ VERIFIED | Live CLI re-run this session (see above); `test/anlz-07.test.ts` in the 301/301 run |
| 2 | Classification is context-aware: volatile vs. non-volatile `ADD COLUMN DEFAULT`, `NOT VALID`+`VALIDATE CONSTRAINT`, `CONCURRENTLY` recognized as safe forms (SC2/ANLZ-04) | ✓ VERIFIED | Unchanged since last pass; `pairing.test.ts` passing in the current 301/301 run (quick regression check — no code in this area changed) |
| 3 | Adversarial fixtures (comment, dollar-quoted string, DO block, function body) neither miss a real hidden drop nor falsely flag inert text (SC3/ANLZ-05) | ✓ VERIFIED | `test/corpus.test.ts` D-14 pair-integrity check passing (part of the 301/301 run); see "Adversarial claim assessment" below for the full judgment this score carries |
| 4 | Every classification rule lives in a schema-validated rules file; an invalid rules file fails validation rather than being silently accepted, AND a structurally-valid but policy-defeating rule is also rejected (SC4/ANLZ-03) | ✓ VERIFIED | Gap closed and independently re-verified above: 10/10 attack payloads (5 from the prior gap report, 5 novel ones I devised this round) rejected at `loadRules` time; shipped `rules.json` still loads; floor stays BLOCKED under every payload |
| 5 | Corpus run through both the analyzer and `squawk-cli` produces a comparison report with every disagreement examined and explained (SC5/ANLZ-06) | ✓ VERIFIED | Unchanged since last pass; `docs/30-squawk-comparison.md` unmodified — 49/49 corpus files, 21 disagreements, all labelled |

**Score:** 5/5 truths verified (0 present, behavior-unverified)

### Adversarial claim assessment (the phase's central, judgment-requiring claim)

The phase goal's operative sentence is that the classifier "has been shown — by deliberate attack
— to resist being fooled in either direction." I am not taking the prior verification's or this
session's own evidence at face value; here is the full record, weighed honestly.

**The track record across the whole phase, unchanged by this closure:**

1. `DROP TABLE`/`TRUNCATE` inside a `LANGUAGE sql` function body classified SAFE — found by
   independent probing *after* plan 03-04 self-reported a passing check. Fixed, regression-tested
   (`language-sql-bodies.test.ts`), confirmed present.
2. An empty `match: {}` rule blanket-matched everything — found by the code-review gate
   (03-REVIEW.md CR-01), not by any plan's own tests. Fixed (the trivial case) at review time.
3. Multi-subcommand `ALTER TABLE` classified only the first subcommand — found by the code-review
   gate (CR-02). Fixed, regression-tested, reconfirmed live in the prior verification round.
4. The "enumerate every legal value" variant of CR-01 — found by the *verifier*, after the
   review's own fix left it explicitly named as unclosed. Now fixed (this closure) and
   independently re-verified above, including against five attack shapes beyond the one
   originally demonstrated.

**The phase's own dedicated adversarial-test plan (03-06) found zero of these four.** Its five
matched pairs were derived by running the already-built analyzer and recording its actual output
— a structural corpus check, not an attempt to break the classifier; 03-06-SUMMARY.md says so
directly ("no analyzer defect was found by this plan"). Every real defect in this phase's history
was found by something *other* than the mechanism the phase goal's language implies was doing the
attacking.

**What tips this from "still a gap" (my last verdict) to "adequately evidenced" (this verdict):**
the difference is not that a fourth defect got fixed — it is *how* it was fixed. The CR-01 patch
closed one reproduction. This closure closed a *class*: `assertUnmatchedDefaultsToReview` re-derives
the verdict for a set of canaries built specifically so that "any rule broad enough to grant
blanket SAFE to an uncatalogued statement necessarily matches at least one canary" is a structural
property of the canary set, not a claim resting on having enumerated every possible attack shape in
advance. I tested that structural claim directly this session with five attack shapes the fix's own
author never demonstrated (splitting the enumeration across two rules to dodge single-rule
detection; enumerating a field the canary set deliberately excludes from variation; enumerating
three other small-domain fields alone) — all five were caught by the *existing* canary set with no
changes required. That is real evidence the fix generalizes, not just evidence it patches the one
hole that was found.

**What still tempers full confidence, honestly:** the process that is supposed to do this
systematically (03-06, an "adversarial-fixture" plan) has a zero-discovery track record across the
whole phase; three of four real defects were found by a human code-review pass and one by
verification-level probing, not by the designed mechanism. Nothing in this closure changes that
process gap — a *future* rule addition to `rules.json` that introduces a genuinely new field or a
new small-domain value is protected by the canary set only insofar as someone remembers to keep the
canary set in sync with `types.ts`'s field list (there is no test asserting the canary set's field
coverage tracks `StatementFacts`'s own field list 1:1 — I did not find one, and did not find this
gap significant enough to reopen the phase over, since every currently-defined field is in fact
covered, verified above).

**One more observation, raised because the orchestrator specifically asked me to judge it, not
because it is a phase-3 defect:** `assertFloorNotWeakened`/`assertUnmatchedDefaultsToReview` run
inside `loadRules`, not inside `classifyFacts`/`analyzeSql` themselves. `RulesFile` (from
`rules-schema.ts`) is a plain zod-inferred structural type, not branded/opaque — so nothing at the
type level stops a future in-process caller from hand-constructing a `RulesFile`-shaped object
literal and passing it straight to `analyzeSql`, skipping both guards entirely. I confirmed this
live: calling `classifyFacts` directly (bypassing `loadRules`) with the enumerate-all-28 exploit
rule returns `SAFE` for an unmatched statement with no error of any kind. **This is not currently
exploitable in this repo**: `index.ts`'s public barrel exports only `analyzeSql`, `loadDefaultRules`,
and `loadRules` (never `classifyFacts` or the raw schema types), and the one real consumer today,
`cli.ts`, always obtains its `RulesFile` via `loadDefaultRules()`. But it is a safeguard that
currently depends on every future caller *choosing* to call `loadRules`/`loadDefaultRules` rather
than constructing the shape by hand — which is exactly the "remembered caution" pattern this
project's own CLAUDE.md names as a non-negotiable to avoid ("if a safeguard depends on an agent
choosing to behave, it is not a safeguard"). I am recording this as a forward-looking design note
for Phase 4 (the in-process runner) and Phase 7 (package extraction), not as a phase-3 gap: it is
outside CR-01/D-06's actual scope (the rules-*file* as a data attack surface, which is what D-02's
"an AI agent editing the rules file under review fatigue" threat model targets), no in-repo
consumer bypasses it today, and branding `RulesFile` now would be speculative hardening against a
runner that does not exist yet. Recommend Phase 4's plan explicitly re-affirm (and ideally
type-enforce, e.g. a branded/nominal `RulesFile` or a `Symbol`-keyed private field) that its runner
only ever obtains rules via `loadRules`/`loadDefaultRules`.

**Conclusion on the claim:** with the gap closed and independently stress-tested beyond its
original reproduction, I judge the phase goal's "resist being fooled in either direction by
deliberate attack" claim **adequately evidenced** for the rules-file attack surface D-02/D-06 exist
to protect — ten independent attack payloads across two verification rounds, including five this
session that were never demonstrated by the fix's own author, were all correctly rejected, and the
named catastrophic floor operations were separately reconfirmed non-weakenable under every variant.
The honest qualification that survives is about *process*, not current defect count: the phase's
own designed adversarial mechanism (03-06) never found a defect on its own, and the demonstrated
discovery pattern (code review, then verifier probing, twice) is a real signal that "run the
existing analyzer over a fixed corpus and check it agrees with itself" is not, by itself, a
sufficient adversarial-testing practice going forward — worth carrying into Phase 4/5 planning as a
process note, not as a reason to withhold a passed verdict from a phase whose every currently-known
defect is fixed and independently re-attacked without a new finding.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/automation/src/inspector/inspect.ts` | Real PostgreSQL AST parsing (`libpg-query`), never regex | ✓ VERIFIED | Unchanged since last pass |
| `packages/automation/src/classifier/classify.ts` | Pure `facts + rules → verdict` function | ✓ VERIFIED | `classifyFacts` unchanged; `loadRules` now calls both `assertFloorNotWeakened` and `assertUnmatchedDefaultsToReview` |
| `packages/automation/src/classifier/floor.ts` | Non-weakenable D-02/D-07 floor, AND non-weakenable D-06 default | ✓ VERIFIED | `assertFloorNotWeakened` (D-02/D-07) and the new `assertUnmatchedDefaultsToReview` (D-06) both confirmed live, including under 10 attack variants |
| `packages/automation/src/classifier/rules-schema.ts` | Schema-validated rules file (zod) | ✓ VERIFIED | `.refine` (empty match) plus `floor.ts`'s two load-time self-checks together close both the structural and policy-defeating cases |
| `packages/automation/test/corpus/manifest.json` | Corpus manifest, D-14 pairs, D-16 app-shaped group, real migrations | ✓ VERIFIED | Unchanged since last pass — 51 entries |
| `docs/30-squawk-comparison.md` | Committed, fully-annotated D-15 comparison report | ✓ VERIFIED | Unchanged since last pass |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `classify.ts`'s `loadRules` | `floor.ts`'s `assertFloorNotWeakened` AND `assertUnmatchedDefaultsToReview` | both called in sequence, same `classifyFacts` passed to both | ✓ WIRED | Confirmed by reading `classify.ts` lines 239-243 and by the live probe: an exploit rejected by only one of the two checks (e.g. the empty-match case, caught by schema not floor.ts) is still rejected overall |
| `index.ts` (public barrel) | `classifyFacts` | deliberately NOT re-exported | ✓ VERIFIED (prohibition) | Only `analyzeSql`, `loadDefaultRules`, `loadRules` are exported; a package consumer using only the barrel cannot reach the unguarded function directly |
| `cli.ts` | `loadDefaultRules()` | the CLI's only rules-loading path | ✓ WIRED | Confirmed: no code path in `cli.ts` constructs or accepts a `RulesFile` from anywhere else |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Real `DROP TABLE` is BLOCKED | `node --import tsx src/cli.ts <drop.sql>` | `BLOCKED`, exit 20, `drop-table` | ✓ PASS |
| Additive nullable column is SAFE | `node --import tsx src/cli.ts <add-column.sql>` | `SAFE`, exit 0, `add-column-nullable-no-default` | ✓ PASS |
| Enumerate-all-28-statementKind exploit (the closed gap) | `loadRules` with the exploit rule appended to the real shipped `rules.json` | `RulesFileError` thrown | ✓ PASS |
| 4 more orchestrator-listed exploit variants (extra field, empty match, all-except-Unrecognized, floor-weaken) | same | all rejected or (floor-weaken case) loaded with no net weakening | ✓ PASS |
| 5 novel exploit variants devised this session (split-rule, excluded-field, 3 other single-field enumerations) | same | all rejected | ✓ PASS |
| CLUSTER / REINDEX (real uncatalogued SQL) still REVIEW_REQUIRED under the shipped rules | `analyzeSql` via `rules-catalogue.test.ts` | REVIEW_REQUIRED for both | ✓ PASS (in suite) |
| D-02/D-07 floor stays BLOCKED under the shipped rules with the new check active | `rules-catalogue.test.ts` | BLOCKED for all 8 floor fact sets | ✓ PASS (in suite) |
| Full test suite | `pnpm test` (run once, root) | 301/301 passing, 30 test files | ✓ PASS |
| `tsc --noEmit` | `npx tsc --noEmit` in `packages/automation` | clean, no output | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|-----------------|--------------|--------|----------|
| ANLZ-01 | 03-01, 03-03 | Parse via `libpg-query`, never regex | ✓ SATISFIED | Unchanged |
| ANLZ-02 | 03-01, 03-02, 03-03, 03-05 | Every operation classified SAFE/REVIEW/BLOCKED | ✓ SATISFIED | Unchanged; `classifyFacts` always returns one of the three verdicts |
| ANLZ-03 | 03-01, 03-02 | Rules are a schema-validated data file | ✓ SATISFIED | Was PARTIALLY SATISFIED last round; now fully satisfied — both the structural and policy-defeating attack classes are rejected at load time, independently re-verified |
| ANLZ-04 | 03-02, 03-05 | Context-aware classification (volatility, NOT VALID/VALIDATE, CONCURRENTLY) | ✓ SATISFIED | Unchanged |
| ANLZ-05 | 03-04, 03-06 | Adversarial fixtures prove resistance in both directions | ✓ SATISFIED | Was PARTIALLY SATISFIED last round; see "Adversarial claim assessment" for the full, qualified reasoning behind this upgrade |
| ANLZ-06 | 03-07 | squawk-cli cross-check with disagreements explained | ✓ SATISFIED | Unchanged |
| ANLZ-07 | 03-05, 03-06 | Real DROP TABLE blocked, genuinely safe migration passes, by test | ✓ SATISFIED | Unchanged; re-confirmed live this session |

No orphaned requirements: all seven ANLZ-01…07 IDs appear in at least one plan's `requirements:`
frontmatter and are cross-referenced in `.planning/REQUIREMENTS.md`.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers found in `floor.ts`, `classify.ts`, `rules-schema.ts`, or `rules-catalogue.test.ts` (the files touched by this closure) | — | — |

Known open items, recorded per the verification notes, not anti-patterns:
- Production PostgreSQL major version remains UNKNOWN (`docs/decisions.md` D16) — flagged for
  Phase 5, does not block this phase.
- WR-03 (pure-core imports reaching `scripts/log.ts` outside the package boundary) is deliberately
  deferred to Phase 7's extraction, per `03-REVIEW.md`'s explicit resolution note.
- `DROP OWNED BY <role>` classifies REVIEW_REQUIRED, not BLOCKED — an open judgment call for the
  owner, not a defect.
- The `RulesFile` structural-typing / entry-point-convention observation above (not a phase-3 gap;
  recommend carrying into Phase 4/7 planning).

### Squawk Cross-Check Sanity

Unchanged since the prior verification round — `docs/30-squawk-comparison.md` was not modified by
this closure. Not re-run this session (no code in scope for the closure touches this path).

## Gaps Summary

None. The single gap from the prior verification round — the CR-01/D-06 "enumerate every legal
value" bypass — is closed and independently re-verified above, including against five attack
shapes beyond the ones originally demonstrated. `pnpm test`: 301/301. `tsc --noEmit`: clean. No
regressions found in the truths that were previously VERIFIED.

One forward-looking, non-blocking design note is recorded above (the `loadRules`-vs-`classifyFacts`
entry-point boundary) for Phase 4/7 planning attention — it is not a phase-3 defect and does not
change this verdict.

---

_Verified: 2026-09-08T16:45:00Z_
_Verifier: Claude (gsd-verifier)_
