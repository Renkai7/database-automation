// D-11/D-12: analyzeSql, the importable pure entry point Phase 4's runner calls in-process
// immediately before executing a migration. Takes SQL text and a loaded rules object -- no
// filesystem, no Drizzle knowledge, no database connection -- so the runner can hand it the
// exact bytes it is about to execute rather than a path it would have to trust separately.
// loadDefaultRules is exported alongside it but kept clearly separate: it is the one function
// in this module that touches the filesystem, so analyzeSql itself stays pure.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { classifyFacts, loadRules } from "./classifier/classify";
import type { RulesFile } from "./classifier/rules-schema";
import { inspectStatement, parseTopLevel } from "./inspector/inspect";
import type { AnalysisResult, Finding } from "./types";
import { VERDICT_SEVERITY } from "./types";

/**
 * Parses `sql`, reduces every top-level statement to facts, classifies each one, and assembles
 * the complete AnalysisResult. D-10: the file verdict is the most severe finding verdict, and
 * `findings` is always the complete list -- classification never short-circuits on the first
 * BLOCKED finding. `rules` must already be a loaded (schema-validated, floor-checked) rules
 * object -- see loadRules/loadDefaultRules.
 */
export async function analyzeSql(sql: string, rules: RulesFile): Promise<AnalysisResult> {
  const statements = await parseTopLevel(sql);

  const findings: Finding[] = statements.map((stmt, statementIndex) => {
    const facts = inspectStatement(stmt);
    const outcome = classifyFacts(facts, rules.rules);
    return {
      statementIndex,
      nestedPath: [],
      verdict: outcome.verdict,
      ruleIds: outcome.ruleIds,
      rationales: outcome.rationales,
      facts,
      pairedWith: null,
    };
  });

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
