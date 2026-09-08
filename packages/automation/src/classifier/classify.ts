// ANLZ-02/D-02: facts + rules.json -> verdict. A separate module rather than inline logic in
// analyze.ts, deliberately: the pure-function-with-injected-dependency shape
// scripts/drill-assertions.ts already establishes in this repo -- a plain function taking data
// in and returning data out, no hidden state, so floor.ts's load-time self-check can call the
// exact same matching logic real classification uses rather than a duplicate copy (the
// re-derive-never-trust discipline scripts/verify-migration-state.ts establishes).
//
// No imports beyond types and the rules schema, no side effects.
import { assertFloorNotWeakened, assertUnmatchedDefaultsToReview, D02_FLOOR_FACTS } from "./floor";
import { parseRulesFile, type Rule, type RulesFile } from "./rules-schema";
import { VERDICT_SEVERITY, type Finding, type StatementFacts, type Verdict } from "../types";

export interface ClassificationOutcome {
  verdict: Verdict;
  ruleIds: string[];
  rationales: string[];
}

/** A single rule's `match` value matches a single fact value: a scalar (including `null`, for
 * matching an absent value like `usingIndexName: null`) matches by strict equality, an array
 * matches by membership (D-01: equality/set-membership only). */
function factMatches(
  matchValue: string | boolean | null | Array<string | boolean>,
  factValue: unknown,
): boolean {
  if (Array.isArray(matchValue)) {
    return matchValue.includes(factValue as string | boolean);
  }
  return matchValue === factValue;
}

/** A rule matches a fact set when every entry in its `match` object holds. */
function ruleMatches(rule: RulesFile["rules"][number], facts: StatementFacts): boolean {
  const factRecord = facts as unknown as Record<string, unknown>;
  return Object.entries(rule.match).every(([key, matchValue]) => factMatches(matchValue, factRecord[key]));
}

/**
 * classifyFacts: every rule whose `match` entries all hold against `facts` is a matching rule.
 * When several rules match, the file verdict is the most severe among them (D-10's "worst
 * wins" applied at the single-statement level), and every matching rule id is reported --
 * sorted ascending, so the outcome never depends on the rules array's order in the file. When
 * none match, the verdict is REVIEW_REQUIRED with an empty ruleIds array and a rationale
 * stating that no rule matched and SAFE must be earned (D-06) -- SAFE is never the default.
 */
export function classifyFacts(facts: StatementFacts, rules: RulesFile["rules"]): ClassificationOutcome {
  const matched = rules.filter((rule) => ruleMatches(rule, facts));

  if (matched.length === 0) {
    return {
      verdict: "REVIEW_REQUIRED",
      ruleIds: [],
      rationales: ["No rule matched this operation; SAFE must be earned by a matching rule (D-06)."],
    };
  }

  const sorted = [...matched].sort((a, b) => a.id.localeCompare(b.id));
  const verdict = sorted.reduce<Verdict>(
    (worst, rule) => (VERDICT_SEVERITY[rule.verdict] > VERDICT_SEVERITY[worst] ? rule.verdict : worst),
    "SAFE",
  );

  return {
    verdict,
    ruleIds: sorted.map((rule) => rule.id),
    rationales: sorted.map((rule) => rule.rationale),
  };
}

/** D-02: true when `facts` is exactly one of the D02_FLOOR_FACTS canonical fact sets --
 * `applySafeFormPairing`'s guard against ever lowering a floor operation. Every D02_FLOOR_FACTS
 * entry carries `hasWhereClause: false` (either as its own explicit no-WHERE fact, for
 * Delete/Update, or as the EMPTY_FACTS default, for every other floor kind, which never
 * overrides it) -- so a single statementKind+hasWhereClause comparison covers all seven floor
 * operations without a per-kind switch. */
function isFloorOperation(facts: StatementFacts): boolean {
  return D02_FLOOR_FACTS.some(
    (floor) => floor.statementKind === facts.statementKind && floor.hasWhereClause === facts.hasWhereClause,
  );
}

/** Appends `pairingRule`'s id/rationale to `finding`, sets verdict SAFE and `pairedWith`. If the
 * finding had no matching rule at all (D-06's unmatched case -- e.g. an AddUniqueConstraint
 * whose usingIndexName is set, which no ordinary rule matches), the stale "no rule matched"
 * ruleIds/rationales entry is replaced rather than appended to, since the pairing rule now IS
 * the reason for the verdict. ruleIds/rationales stay parallel and sorted ascending by id,
 * exactly like classifyFacts's own ordinary output, regardless of how many rules originally
 * matched or which pairing fired. */
function withPairingRuleApplied(finding: Finding, pairedWithStatementIndex: number, pairingRule: Rule): Finding {
  const hadMatchedRules = finding.ruleIds.length > 0;
  const ruleIds = hadMatchedRules ? [...finding.ruleIds, pairingRule.id] : [pairingRule.id];
  const rationales = hadMatchedRules ? [...finding.rationales, pairingRule.rationale] : [pairingRule.rationale];
  const zipped = ruleIds
    .map((id, index): [string, string] => [id, rationales[index]])
    .sort((a, b) => a[0].localeCompare(b[0]));

  return {
    ...finding,
    verdict: "SAFE",
    pairedWith: pairedWithStatementIndex,
    ruleIds: zipped.map(([id]) => id),
    rationales: zipped.map(([, rationale]) => rationale),
  };
}

/**
 * D-09: resolves same-file safe-form pairing over the complete, already-per-statement-
 * classified findings list. `findings` must already be in ascending statementIndex order (see
 * analyze.ts's sort, which runs before this). Implements exactly the three named pairings, each
 * matching on facts by exact name/value equality -- never a fuzzy or case-insensitive match, so
 * a constraint name one character different is genuinely a different constraint, not the same
 * one loosely recognised.
 *
 * Guarded structurally against ever lowering a D-02 floor operation (`isFloorOperation`):
 * checked independently per finding before that finding is rewritten, so a floor-operation
 * finding is always left completely untouched (verdict, pairedWith, ruleIds all unchanged) even
 * if the OTHER half of a would-be pair is a floor operation -- a pairing pass that could lower a
 * floor verdict would be a second route around D-02 sitting inside the classifier itself.
 *
 * `rules` supplies the three pairing rules' own id/rationale (rules.json, D-03) so this function
 * never duplicates that text as a second hardcoded copy -- the same "same function/data, never a
 * second copy" discipline `loadRules`/`assertFloorNotWeakened` already establish in this module.
 */
export function applySafeFormPairing(findings: Finding[], rules: RulesFile["rules"]): Finding[] {
  const result = findings.map((finding): Finding => ({ ...finding }));
  const ruleById = new Map(rules.map((rule): [string, Rule] => [rule.id, rule]));

  const pairFindings = (earlierIndex: number, laterIndex: number, pairingRuleId: string): void => {
    const pairingRule = ruleById.get(pairingRuleId);
    if (!pairingRule) {
      // The pairing rule documentation entry is missing from the loaded rules file -- leave
      // both findings untouched rather than fabricate a rationale rules.json does not carry
      // (D-03: rationale is required, structured data, never invented at classification time).
      return;
    }
    const earlier = result[earlierIndex];
    const later = result[laterIndex];
    if (!isFloorOperation(earlier.facts)) {
      result[earlierIndex] = withPairingRuleApplied(earlier, later.statementIndex, pairingRule);
    }
    if (!isFloorOperation(later.facts)) {
      result[laterIndex] = withPairingRuleApplied(later, earlier.statementIndex, pairingRule);
    }
  };

  // Pairing 1: a constraint added NOT VALID (notValid true, has a constraintName), paired with a
  // LATER ValidateConstraint naming the exact same constraint on the exact same table.
  for (let i = 0; i < result.length; i++) {
    const candidate = result[i];
    if (!candidate.facts.notValid || candidate.facts.constraintName === null) {
      continue;
    }
    for (let j = i + 1; j < result.length; j++) {
      const later = result[j];
      if (
        later.facts.statementKind === "ValidateConstraint" &&
        later.facts.constraintName === candidate.facts.constraintName &&
        later.facts.table === candidate.facts.table
      ) {
        pairFindings(i, j, "pair-not-valid-validated");
        break;
      }
    }
  }

  // Pairing 2: an index built CONCURRENTLY with a name, paired with a LATER AddUniqueConstraint
  // whose usingIndexName equals it.
  for (let i = 0; i < result.length; i++) {
    const candidate = result[i];
    if (
      candidate.facts.statementKind !== "CreateIndex" ||
      !candidate.facts.concurrently ||
      candidate.facts.indexName === null
    ) {
      continue;
    }
    for (let j = i + 1; j < result.length; j++) {
      const later = result[j];
      if (
        later.facts.statementKind === "AddUniqueConstraint" &&
        later.facts.usingIndexName === candidate.facts.indexName
      ) {
        pairFindings(i, j, "pair-concurrent-index-unique");
        break;
      }
    }
  }

  // Pairing 3: a not-null check constraint ALREADY validated by pairing 1 above (checkProvesNotNull
  // true and paired -- i.e. its own ValidateConstraint partner was found in this same pass),
  // paired with a LATER SetNotNull on the exact same table and column.
  for (let i = 0; i < result.length; i++) {
    const candidate = result[i];
    if (
      candidate.facts.statementKind !== "AddCheckConstraint" ||
      !candidate.facts.checkProvesNotNull ||
      candidate.pairedWith === null
    ) {
      continue;
    }
    for (let j = i + 1; j < result.length; j++) {
      const later = result[j];
      if (
        later.facts.statementKind === "SetNotNull" &&
        later.facts.table === candidate.facts.table &&
        later.facts.column === candidate.facts.column
      ) {
        // Only the SetNotNull side is lowered here -- the check constraint (candidate) was
        // already resolved SAFE/paired by pairing 1 and must not be re-paired to this different
        // statement (that would overwrite its pairedWith with the wrong partner).
        if (!isFloorOperation(later.facts)) {
          const pairingRule = ruleById.get("pair-validated-check-set-not-null");
          if (pairingRule) {
            result[j] = withPairingRuleApplied(later, candidate.statementIndex, pairingRule);
          }
        }
        break;
      }
    }
  }

  return result;
}

/**
 * Validates a raw rules-file value through parseRulesFile and then two load-time self-checks
 * before returning it -- the analyzer refuses to start on a weakened rules file rather than
 * silently substituting a safer verdict for real classification traffic:
 *   - assertFloorNotWeakened (D-02/D-07): no named floor operation can resolve to anything
 *     other than BLOCKED.
 *   - assertUnmatchedDefaultsToReview (D-06, gap closure per 03-VERIFICATION.md extending
 *     03-REVIEW.md's CR-01 fix): no representative unmatched operation (an uncatalogued
 *     statement kind, or a genuinely uncovered combination of a catalogued one) can resolve to
 *     anything other than REVIEW_REQUIRED -- closing the "enumerate every legal value of a
 *     field instead of leaving match empty" variant of CR-01's blanket-SAFE exploit, which the
 *     trivial empty-match rejection in rules-schema.ts does not catch.
 * Both are passed this exact classifyFacts function, never a second copy of the matching logic.
 */
export function loadRules(raw: unknown): RulesFile {
  const rulesFile = parseRulesFile(raw);
  assertFloorNotWeakened(rulesFile, classifyFacts);
  assertUnmatchedDefaultsToReview(rulesFile, classifyFacts);
  return rulesFile;
}
