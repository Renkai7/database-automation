// D-11/D-12: analyzeSql, the importable pure entry point Phase 4's runner calls in-process
// immediately before executing a migration. Takes SQL text and a loaded rules object -- no
// filesystem, no Drizzle knowledge, no database connection -- so the runner can hand it the
// exact bytes it is about to execute rather than a path it would have to trust separately.
// loadDefaultRules is exported alongside it but kept clearly separate: it is the one function
// in this module that touches the filesystem, so analyzeSql itself stays pure.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { applySafeFormPairing, classifyFacts, loadRules } from "./classifier/classify";
import type { ClassificationOutcome } from "./classifier/classify";
import type { RulesFile } from "./classifier/rules-schema";
import { inspectStatement, parseTopLevel, type ParsedStatement } from "./inspector/inspect";
import type { AnalysisResult, Finding, StatementFacts } from "./types";
import { EMPTY_FACTS, VERDICT_SEVERITY } from "./types";

/** Builds a Finding from an outcome + facts pair -- shared between the ordinary per-statement
 * path and the synthetic empty-input finding below, so the two never drift apart in shape. */
function buildFinding(statementIndex: number, facts: StatementFacts, outcome: ClassificationOutcome): Finding {
  return {
    statementIndex,
    nestedPath: [],
    verdict: outcome.verdict,
    ruleIds: outcome.ruleIds,
    rationales: outcome.rationales,
    facts,
    pairedWith: null,
  };
}

/** The synthetic finding for zero-statement input (empty, whitespace-only, or comment-only) --
 * classified through the ordinary rule path against a single EmptyInput fact set. */
function emptyInputFinding(rules: RulesFile): Finding {
  const facts: StatementFacts = { ...EMPTY_FACTS, statementKind: "EmptyInput" };
  return buildFinding(0, facts, classifyFacts(facts, rules.rules));
}

/** D-10: deterministic finding order -- ascending statement index, then ascending nested path
 * compared element by element -- so output is byte-stable across runs and a diff of two reports
 * is meaningful. Nested findings (D-05's PL/pgSQL recursion, a later plan) are not produced by
 * this plan, but the comparator handles them correctly already: a shorter path sorts before a
 * longer one that shares the same prefix. */
function compareFindings(a: Finding, b: Finding): number {
  if (a.statementIndex !== b.statementIndex) {
    return a.statementIndex - b.statementIndex;
  }
  const length = Math.min(a.nestedPath.length, b.nestedPath.length);
  for (let i = 0; i < length; i++) {
    if (a.nestedPath[i] !== b.nestedPath[i]) {
      return a.nestedPath[i] - b.nestedPath[i];
    }
  }
  return a.nestedPath.length - b.nestedPath.length;
}

/**
 * Parses `sql`, reduces every top-level statement to facts, classifies each one, and assembles
 * the complete AnalysisResult. D-10: the file verdict is the most severe finding verdict, and
 * `findings` is always the complete list -- classification never short-circuits on the first
 * BLOCKED finding. `rules` must already be a loaded (schema-validated, floor-checked) rules
 * object -- see loadRules/loadDefaultRules.
 *
 * Empty/whitespace-only input is checked BEFORE calling the parser: libpg-query's own `parse()`
 * rejects a zero-length or whitespace-only string with "Query cannot be empty" (observed
 * directly against the installed package, task 2's contract test) rather than resolving with
 * zero statements -- calling it here would misreport "nothing to analyze" as a D-08 parse
 * failure, which it is not. Comment-only text is NOT special-cased: libpg-query resolves it
 * with an empty `stmts` array on its own, so it reaches the same zero-statement branch below
 * through the ordinary parse path.
 */
export async function analyzeSql(sql: string, rules: RulesFile): Promise<AnalysisResult> {
  const statements: ParsedStatement[] = sql.trim().length === 0 ? [] : await parseTopLevel(sql);

  // D-06: a migration file the analyzer found nothing executable in is not something it can
  // call SAFE. Synthesise one EmptyInput fact set and run it through the ordinary rule path
  // (rules.json's `empty-input` rule, category analyzer-integrity) so the REVIEW_REQUIRED
  // outcome is produced by data, not a special case in the classifier itself.
  const rawFindings: Finding[] =
    statements.length === 0
      ? [emptyInputFinding(rules)]
      : statements.map((stmt, statementIndex) => {
          const facts = inspectStatement(stmt);
          return buildFinding(statementIndex, facts, classifyFacts(facts, rules.rules));
        });

  // D-10: deterministic order first, so the D-09 pairing pass below sees statements in genuine
  // file order (its own "earlier"/"later" comparisons depend on it) -- then the same-file
  // safe-form pairing pass, which can only ever RAISE no verdict and only ever LOWER a naive
  // REVIEW_REQUIRED to SAFE for the three named safe forms (D-09), never a floor operation
  // (D-02, enforced inside applySafeFormPairing itself).
  const orderedFindings = [...rawFindings].sort(compareFindings);
  const findings = applySafeFormPairing(orderedFindings, rules.rules);

  const verdict = findings.reduce(
    (worst, finding) => (VERDICT_SEVERITY[finding.verdict] > VERDICT_SEVERITY[worst] ? finding.verdict : worst),
    "SAFE" as AnalysisResult["verdict"],
  );

  return {
    verdict,
    findings,
    statementCount: statements.length,
    rulesVersion: rules.version,
  };
}

/** Repository-relative path (from this module's own directory) to the bundled default rules
 * catalogue -- resolved via import.meta.url so it works regardless of the caller's cwd. */
const DEFAULT_RULES_PATH = fileURLToPath(new URL("./rules/rules.json", import.meta.url));

/** Reads and loads (parses, schema-validates, floor-checks) the bundled default rules
 * catalogue. The only filesystem access in this module -- deliberately separated from
 * analyzeSql so the pure function stays pure. */
export function loadDefaultRules(): RulesFile {
  const raw = JSON.parse(readFileSync(DEFAULT_RULES_PATH, "utf-8"));
  return loadRules(raw);
}
