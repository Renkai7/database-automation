// D-02: the code floor. A rules file cannot lower the BLOCKED verdict for the named
// irreversible-data-loss operations -- DROP TABLE, DROP SCHEMA, DROP DATABASE, TRUNCATE,
// DROP COLUMN, and DELETE/UPDATE without a row-scoping WHERE. A separate module rather than
// inline in classify.ts, deliberately: this is the one piece of the classifier that is a
// guard, not a transform -- the re-derive-never-trust pattern scripts/verify-migration-state.ts
// already establishes in this repo, applied to a rules file instead of a live database. It
// re-runs the loaded rules through the SAME classifyFacts function real classification uses
// (passed in, never imported and re-implemented) and throws loudly if any floor operation
// resolves to anything other than BLOCKED -- including "no rule matched", which D-06 would
// otherwise resolve to REVIEW REQUIRED. Never a silent fallback to a hardcoded floor verdict.
//
// This module also houses the equivalent self-check for D-06's default (further down:
// D06_UNMATCHED_CANARY_FACTS / assertUnmatchedDefaultsToReview, added closing a gap
// 03-VERIFICATION.md found in 03-REVIEW.md's CR-01 fix) -- the same re-derive-through-the-real-
// classifier pattern, protecting the opposite end of the verdict range: that an operation the
// catalogue has no opinion on can never be pushed to anything other than REVIEW_REQUIRED,
// exactly as non-weakenable as the BLOCKED floor above.
//
// No side effects at import time: D02_FLOOR_FACTS and D06_UNMATCHED_CANARY_FACTS are plain
// constants, and assertFloorNotWeakened/assertUnmatchedDefaultsToReview only run when called.
import { EMPTY_FACTS, RulesFileError, type StatementFacts } from "../types";
import type { RulesFile } from "./rules-schema";

/** D-02's floor operations, each expressed as a complete StatementFacts built from
 * EMPTY_FACTS -- the canonical minimal fact set the self-check below runs through the loaded
 * rules table. */
export const D02_FLOOR_FACTS: StatementFacts[] = [
  { ...EMPTY_FACTS, statementKind: "DropTable" },
  { ...EMPTY_FACTS, statementKind: "DropSchema" },
  { ...EMPTY_FACTS, statementKind: "DropDatabase" },
  { ...EMPTY_FACTS, statementKind: "Truncate" },
  { ...EMPTY_FACTS, statementKind: "DropColumn" },
  { ...EMPTY_FACTS, statementKind: "Delete", hasWhereClause: false },
  { ...EMPTY_FACTS, statementKind: "Update", hasWhereClause: false },
];

/** D-07's floor operation (plan 03-04): the single canonical fact set for an unresolvable
 * dynamic EXECUTE. Kept as its own named export, never merged into D02_FLOOR_FACTS, precisely
 * because they answer to two different decisions -- D-02 fixes the irreversible-data-loss set
 * the developer named explicitly; D-07 is the analyzer-integrity addition its own decision
 * requires (an EXECUTE nobody, not the analyzer and not a reviewer, can read). Merging them
 * would lose which decision each entry answers to, which matters when Phase 7 audits why a
 * verdict could not be overridden. */
export const D07_FLOOR_FACTS: StatementFacts[] = [
  { ...EMPTY_FACTS, statementKind: "ExecuteDynamic", dynamicSqlUnresolved: true },
];

/** The shape classify.ts's classifyFacts satisfies -- declared here so floor.ts has no import
 * dependency on classify.ts (classify.ts imports floor.ts, not the reverse). */
export type ClassifyFactsFn = (
  facts: StatementFacts,
  rules: RulesFile["rules"],
) => { verdict: string; ruleIds: string[]; rationales: string[] };

/**
 * Runs every D02_FLOOR_FACTS and D07_FLOOR_FACTS entry through `classifyFacts` (the exact
 * function real classification uses) against the loaded rules. Throws RulesFileError naming the
 * offending fact set and the verdict it produced if any result is not BLOCKED -- this covers the
 * "no rule matched" case too, since D-06 would otherwise resolve an unmatched floor operation to
 * REVIEW REQUIRED, which is exactly the silent weakening D-02/D-07 exist to prevent. Both floor
 * sets run through the identical check: an unresolvable dynamic EXECUTE is exactly as
 * non-weakenable as DROP TABLE, just for a different reason (D-07: nobody can read what it would
 * execute, rather than D-02: the operation is named and irreversible).
 */
export function assertFloorNotWeakened(rulesFile: RulesFile, classifyFacts: ClassifyFactsFn): void {
  for (const facts of [...D02_FLOOR_FACTS, ...D07_FLOOR_FACTS]) {
    const outcome = classifyFacts(facts, rulesFile.rules);
    if (outcome.verdict !== "BLOCKED") {
      throw new RulesFileError(
        `Rules file validation failed: floor operation "${facts.statementKind}" resolved to ` +
          `"${outcome.verdict}", not BLOCKED. The rules file cannot weaken the code floor (D-02/D-07).`,
      );
    }
  }
}

// Gap closure (03-VERIFICATION.md, extending 03-REVIEW.md's CR-01 fix): CR-01's
// `FactMatchSchema.refine` in rules-schema.ts rejects only the trivial zero-key `match: {}`
// case. The SAME blanket-SAFE effect is reachable by ENUMERATING every legal value of a field
// (most naturally `statementKind`) instead of leaving `match` empty -- `ruleMatches`'s array
// branch (`matchValue.includes(factValue)`) matches unconditionally on that field once every
// legal value is listed, exactly like an empty match object would, just spelled out longhand.
// Verified live (03-VERIFICATION.md): a rule enumerating all 28 StatementKind values with
// verdict SAFE passed both parseRulesFile and assertFloorNotWeakened, then
// classifyFacts({statementKind:"Unrecognized"}, rules) returned SAFE -- disabling D-06's
// "SAFE must be earned" default for CLUSTER, REINDEX, ALTER SYSTEM, and any other
// uncatalogued PostgreSQL DDL, without ever touching a D-02/D-07 floor rule.
//
// D-06's default (an unmatched operation resolves REVIEW_REQUIRED) is exactly as non-weakenable
// a property as D-02/D-07's floor, just protecting the opposite end of the verdict range --
// so this is the same self-check pattern (re-derive through the REAL classifyFacts, never a
// duplicate copy of the matching logic) applied to a different property.
//
// D06_UNMATCHED_CANARY_FACTS is deliberately EMPTY_FACTS-based (every field at its neutral
// default) with only one field varied away from that default per canary. This is not an
// arbitrary sample: a rule matches an EMPTY_FACTS-shaped canary only if none of the rule's
// match entries excludes that canary's (neutral-default) value for the field(s) the rule
// names. So ANY rule broad enough to achieve "blanket SAFE for every uncatalogued statement"
// -- whether it enumerates every statementKind, or every value of some other small-domain
// field (sourceContext, defaultVolatility, a boolean) instead -- necessarily matches at least
// one of these canaries too; there is no narrower rule that reaches the exploit's actual goal
// while dodging every canary here. This is the same reasoning CR-01's empty-match rejection
// already relies on, generalised from "zero conditions" to "conditions that don't exclude the
// neutral default."
//
// `nestingLimitExceeded: true` is deliberately NOT one of the varied fields: paired with
// statementKind "Unrecognized" it is a genuinely catalogued case (rules.json's own
// `nesting-depth-exceeded` rule, BLOCKED, D-05's recursion-limit floor) -- including it here
// would make this self-check reject the shipped rules file itself, a false positive.
//
// The `AddUniqueConstraint` canary is a second, independently-documented unmatched case (see
// classify.ts's `withPairingRuleApplied` comment: "an AddUniqueConstraint whose usingIndexName
// is set, which no ordinary rule matches") -- included for defense in depth beyond the
// "statementKind never catalogued" shape the CLUSTER/REINDEX/ALTER SYSTEM case represents.
export const D06_UNMATCHED_CANARY_FACTS: StatementFacts[] = [
  // The canonical D-06 case: CLUSTER, REINDEX, ALTER SYSTEM, and any other PostgreSQL DDL the
  // inspector has no branch for all resolve to exactly this fact set (statementKind
  // "Unrecognized", every other field at its neutral default) -- see inspect.ts.
  { ...EMPTY_FACTS, statementKind: "Unrecognized" },
  { ...EMPTY_FACTS, statementKind: "Unrecognized", concurrently: true },
  { ...EMPTY_FACTS, statementKind: "Unrecognized", notValid: true },
  { ...EMPTY_FACTS, statementKind: "Unrecognized", checkProvesNotNull: true },
  { ...EMPTY_FACTS, statementKind: "Unrecognized", hasWhereClause: true },
  { ...EMPTY_FACTS, statementKind: "Unrecognized", dynamicSqlUnresolved: true },
  { ...EMPTY_FACTS, statementKind: "Unrecognized", bodyInspected: true },
  { ...EMPTY_FACTS, statementKind: "Unrecognized", sourceContext: "do-block" },
  { ...EMPTY_FACTS, statementKind: "Unrecognized", sourceContext: "function-body" },
  { ...EMPTY_FACTS, statementKind: "Unrecognized", defaultVolatility: "literal" },
  { ...EMPTY_FACTS, statementKind: "Unrecognized", defaultVolatility: "immutable" },
  { ...EMPTY_FACTS, statementKind: "Unrecognized", defaultVolatility: "stable" },
  { ...EMPTY_FACTS, statementKind: "Unrecognized", defaultVolatility: "volatile" },
  { ...EMPTY_FACTS, statementKind: "Unrecognized", defaultVolatility: "unknown-function" },
  // A genuinely catalogued statementKind (AddUniqueConstraint) with no rule matching this
  // specific combination -- proves the check catches more than just "never-heard-of kind".
  { ...EMPTY_FACTS, statementKind: "AddUniqueConstraint", usingIndexName: "some_other_index_name" },
];

/**
 * Runs every D06_UNMATCHED_CANARY_FACTS entry through `classifyFacts` (the exact function real
 * classification uses) against the loaded rules. Throws RulesFileError naming the offending
 * canary and the verdict/rule-ids it produced if any result is not REVIEW_REQUIRED -- this is
 * D-06's "SAFE must be earned" default, protected the same non-weakenable way D-02/D-07's floor
 * is: by re-deriving through the real classifier rather than trusting the schema alone.
 */
export function assertUnmatchedDefaultsToReview(rulesFile: RulesFile, classifyFacts: ClassifyFactsFn): void {
  for (const facts of D06_UNMATCHED_CANARY_FACTS) {
    const outcome = classifyFacts(facts, rulesFile.rules);
    if (outcome.verdict !== "REVIEW_REQUIRED") {
      throw new RulesFileError(
        `Rules file validation failed: an operation the catalogue has no explicit rule for ` +
          `(statementKind "${facts.statementKind}") resolved to "${outcome.verdict}" ` +
          `(matching rule(s): ${outcome.ruleIds.join(", ") || "none"}), not REVIEW_REQUIRED. ` +
          `A rule that grants a non-REVIEW_REQUIRED verdict to an uncatalogued operation ` +
          `defeats D-06's "SAFE must be earned" default -- often by enumerating every legal ` +
          `value of some field instead of leaving match empty (the trivial empty-match case is ` +
          `already rejected by rules-schema.ts's FactMatchSchema).`,
      );
    }
  }
}
