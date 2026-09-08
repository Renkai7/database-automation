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
// No side effects at import time: D02_FLOOR_FACTS is a plain constant, and
// assertFloorNotWeakened only runs when called.
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

/** The shape classify.ts's classifyFacts satisfies -- declared here so floor.ts has no import
 * dependency on classify.ts (classify.ts imports floor.ts, not the reverse). */
export type ClassifyFactsFn = (
  facts: StatementFacts,
  rules: RulesFile["rules"],
) => { verdict: string; ruleIds: string[]; rationales: string[] };

/**
 * Runs every D02_FLOOR_FACTS entry through `classifyFacts` (the exact function real
 * classification uses) against the loaded rules. Throws RulesFileError naming the offending
 * fact set and the verdict it produced if any result is not BLOCKED -- this covers the
 * "no rule matched" case too, since D-06 would otherwise resolve an unmatched floor operation
 * to REVIEW REQUIRED, which is exactly the silent weakening D-02 exists to prevent.
 */
export function assertFloorNotWeakened(rulesFile: RulesFile, classifyFacts: ClassifyFactsFn): void {
  for (const facts of D02_FLOOR_FACTS) {
    const outcome = classifyFacts(facts, rulesFile.rules);
    if (outcome.verdict !== "BLOCKED") {
      throw new RulesFileError(
        `Rules file validation failed: floor operation "${facts.statementKind}" resolved to ` +
          `"${outcome.verdict}", not BLOCKED. The rules file cannot weaken the code floor (D-02).`,
      );
    }
  }
}
