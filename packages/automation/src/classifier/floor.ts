// D-02/D-17 (04-CONTEXT.md): the code floor. Its stated definition is "irreversible data loss
// or self-disarming" -- a rules file can never lower the BLOCKED verdict for the named
// irreversible-data-loss operations (DROP TABLE, DROP SCHEMA, DROP DATABASE, TRUNCATE,
// DROP COLUMN, DELETE/UPDATE without a row-scoping WHERE) NOR for a statement that disarms its
// own safety rail (any form that sets, resets or defaults `lock_timeout`/`statement_timeout`).
// A migration turning off its own timeout is architecturally identical to a rules file
// downgrading DROP TABLE: both are an attempt to remove the constraint rather than to satisfy
// it, which is why D-17 widens this floor's definition rather than adding an unexplained
// member -- a future candidate is judged against the principle, not against a list. A separate
// module rather than inline in classify.ts, deliberately: this is the one piece of the
// classifier that is a guard, not a transform -- the re-derive-never-trust pattern
// scripts/verify-migration-state.ts already establishes in this repo, applied to a rules file
// instead of a live database. It re-runs the loaded rules through the SAME classifyFacts
// function real classification uses (passed in, never imported and re-implemented) and throws
// loudly if any floor operation resolves to anything other than BLOCKED -- including "no rule
// matched", which D-06 would otherwise resolve to REVIEW REQUIRED. Never a silent fallback to a
// hardcoded floor verdict.
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

/** D-17's floor operations (04-CONTEXT.md, Task 2's checkpoint decision: "cover-all-scopes"):
 * a migration that sets, resets or defaults `lock_timeout`/`statement_timeout` at ANY scope --
 * session (`SET`/`SET LOCAL`/`RESET`/`RESET ALL`, folded into the `SetGuc` entry below via the
 * shared `disarmsTimeout` fact), cluster-wide (`ALTER SYSTEM SET`), database-wide
 * (`ALTER DATABASE ... SET`) or role-wide (`ALTER ROLE ... SET`). The database- and role-scoped
 * forms are floored, not left as a gap, precisely because they are the MORE dangerous ones: they
 * persist beyond the migration's own session, so Phase 7's production runner inherits the
 * protection rather than the gap. Kept as its own named export, never merged into
 * D02_FLOOR_FACTS or D07_FLOOR_FACTS, for the same reason floor.ts already keeps those two
 * distinct: each set answers to a different decision, which matters when Phase 7 audits why a
 * verdict could not be overridden. */
export const D17_FLOOR_FACTS: StatementFacts[] = [
  { ...EMPTY_FACTS, statementKind: "SetGuc", disarmsTimeout: true },
  { ...EMPTY_FACTS, statementKind: "AlterSystem", transactionHostile: true, disarmsTimeout: true },
  { ...EMPTY_FACTS, statementKind: "AlterDatabaseSet", disarmsTimeout: true },
  { ...EMPTY_FACTS, statementKind: "AlterRoleSet", disarmsTimeout: true },
];

/** The shape classify.ts's classifyFacts satisfies -- declared here so floor.ts has no import
 * dependency on classify.ts (classify.ts imports floor.ts, not the reverse). */
export type ClassifyFactsFn = (
  facts: StatementFacts,
  rules: RulesFile["rules"],
) => { verdict: string; ruleIds: string[]; rationales: string[] };

/** The three floor decision groups `assertFloorNotWeakened` iterates, each labelled with the
 * decision it answers to so a violation's error message names which one, not just which
 * statementKind. */
const FLOOR_GROUPS: Array<{ decision: string; facts: StatementFacts[] }> = [
  { decision: "D-02", facts: D02_FLOOR_FACTS },
  { decision: "D-07", facts: D07_FLOOR_FACTS },
  { decision: "D-17", facts: D17_FLOOR_FACTS },
];

/**
 * Runs every D02_FLOOR_FACTS, D07_FLOOR_FACTS and D17_FLOOR_FACTS entry through `classifyFacts`
 * (the exact function real classification uses) against the loaded rules. Throws RulesFileError
 * naming the offending fact set, the decision it belongs to, and the verdict it produced if any
 * result is not BLOCKED -- this covers the "no rule matched" case too, since D-06 would
 * otherwise resolve an unmatched floor operation to REVIEW REQUIRED, which is exactly the
 * silent weakening D-02/D-07/D-17 exist to prevent. All three floor sets run through the
 * identical check: a migration disarming its own timeout is exactly as non-weakenable as
 * DROP TABLE, just for a different reason (D-17: it is an attempt to remove the constraint
 * itself, rather than D-02: the operation is named and irreversible).
 */
export function assertFloorNotWeakened(rulesFile: RulesFile, classifyFacts: ClassifyFactsFn): void {
  for (const group of FLOOR_GROUPS) {
    for (const facts of group.facts) {
      const outcome = classifyFacts(facts, rulesFile.rules);
      if (outcome.verdict !== "BLOCKED") {
        throw new RulesFileError(
          `Rules file validation failed: floor operation "${facts.statementKind}" (${group.decision}) ` +
            `resolved to "${outcome.verdict}", not BLOCKED. The rules file cannot weaken the code floor ` +
            `(${group.decision}).`,
        );
      }
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
// `disarmsTimeout: true` is EXCLUDED from this canary set for the identical reason
// (04-02-PLAN.md task 3 deviation, see 04-02-SUMMARY.md): D-17's own `disarms-timeout-guc` rule
// (rules.json) matches on `disarmsTimeout: true` alone, by design, precisely so it catches every
// disarming statement kind and any future one that sets the fact -- so paired with statementKind
// "Unrecognized" it is, like `nestingLimitExceeded`, a genuinely catalogued case (BLOCKED, the
// D17_FLOOR_FACTS floor above), not an unmatched one. Including it here would make this
// self-check reject the shipped rules file itself: `assertUnmatchedDefaultsToReview` requires
// exactly REVIEW_REQUIRED, and a canary correctly caught by a real floor rule resolves BLOCKED
// instead -- a stronger, not a weaker, verdict, so the rejection would be a false positive, not
// a real gap. `transactionHostile: true` carries no equivalent broad rule (no rule in this
// catalogue matches on it alone), so it stays a genuine canary below.
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
  { ...EMPTY_FACTS, statementKind: "Unrecognized", transactionHostile: true },
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
