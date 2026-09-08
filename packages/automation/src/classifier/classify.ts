// ANLZ-02/D-02: facts + rules.json -> verdict. A separate module rather than inline logic in
// analyze.ts, deliberately: the pure-function-with-injected-dependency shape
// scripts/drill-assertions.ts already establishes in this repo -- a plain function taking data
// in and returning data out, no hidden state, so floor.ts's load-time self-check can call the
// exact same matching logic real classification uses rather than a duplicate copy (the
// re-derive-never-trust discipline scripts/verify-migration-state.ts establishes).
//
// No imports beyond types and the rules schema, no side effects.
import { assertFloorNotWeakened } from "./floor";
import { parseRulesFile, type RulesFile } from "./rules-schema";
import { VERDICT_SEVERITY, type StatementFacts, type Verdict } from "../types";

export interface ClassificationOutcome {
  verdict: Verdict;
  ruleIds: string[];
  rationales: string[];
}

/** A single rule's `match` value matches a single fact value: a scalar matches by strict
 * equality, an array matches by membership (D-01: equality/set-membership only). */
function factMatches(matchValue: string | boolean | Array<string | boolean>, factValue: unknown): boolean {
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

/**
 * Validates a raw rules-file value through parseRulesFile and then D-02's load-time self-check
 * (assertFloorNotWeakened) before returning it -- the analyzer refuses to start on a weakened
 * rules file rather than silently substituting the floor for real classification traffic.
 * assertFloorNotWeakened is passed this exact classifyFacts function, never a second copy of
 * the matching logic.
 */
export function loadRules(raw: unknown): RulesFile {
  const rulesFile = parseRulesFile(raw);
  assertFloorNotWeakened(rulesFile, classifyFacts);
  return rulesFile;
}
