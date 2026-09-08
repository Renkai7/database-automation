// D-11/D-12: analyzeSql, the importable pure entry point Phase 4's runner calls in-process
// immediately before executing a migration. Takes SQL text and a loaded rules object -- no
// filesystem, no Drizzle knowledge, no database connection -- so the runner can hand it the
// exact bytes it is about to execute rather than a path it would have to trust separately. This
// module deliberately imports nothing filesystem-touching, not even transitively: a test in
// test/adapter.test.ts asserts this file never imports a filesystem module. Loading the bundled
// default rules catalogue from disk lives in ./adapter/default-rules.ts instead (see that
// module's header comment for why it moved there rather than staying alongside analyzeSql).
import { applySafeFormPairing, classifyFacts } from "./classifier/classify";
import type { ClassificationOutcome } from "./classifier/classify";
import type { RulesFile } from "./classifier/rules-schema";
import { inspectStatement, parseTopLevel, type ParsedStatement } from "./inspector/inspect";
import { inspectContainerBody, planContainerBody } from "./inspector/inspect-plpgsql";
import type { AnalysisResult, Finding, StatementFacts } from "./types";
import { EMPTY_FACTS, VERDICT_SEVERITY } from "./types";

/** Builds a Finding from a nestedPath + facts + outcome triple -- shared by the top-level path,
 * D-05's recursive path, and the synthetic empty-input finding below, so all three never drift
 * apart in shape. `nestedPath` is `[]` for every top-level (non-recursed) finding, and
 * `[statementIndex, ...positions-within-body]` for a finding D-05's recursion produced -- "the
 * enclosing statement index followed by its position within the body," per this plan's own
 * wording. */
function buildFinding(
  statementIndex: number,
  nestedPath: number[],
  facts: StatementFacts,
  outcome: ClassificationOutcome,
): Finding {
  return {
    statementIndex,
    nestedPath,
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
  return buildFinding(0, [], facts, classifyFacts(facts, rules.rules));
}

/** D-05/gap closure: inspects and classifies one top-level statement, and -- when it is a DO
 * block or function creation -- decides via planContainerBody, ONCE, whether and how its body
 * gets recursed into, turning every fact set the recursion finds into its own Finding. The
 * container statement always gets its own finding (facts from inspectStatement plus the
 * truthfully-set `bodyInspected`, nestedPath []) regardless of whether recursion happens at all.
 * A container whose body could not be inspected (planContainerBody returned `inspected: false`
 * -- any declared language other than plpgsql or sql) carries `bodyInspected: false` on its own
 * finding and has no nested findings alongside it; rules.json's container-body-not-inspected
 * rule, not an unconditional SAFE, is what classifies it (gap closure: the previous
 * unconditional-SAFE behavior this replaces is exactly the false-SAFE defect this fix closes). */
async function inspectAndClassifyStatement(
  stmt: ParsedStatement,
  statementIndex: number,
  rules: RulesFile,
): Promise<Finding[]> {
  const facts = inspectStatement(stmt);
  const isContainer = facts.statementKind === "DoBlock" || facts.statementKind === "CreateFunction";
  if (!isContainer) {
    return [buildFinding(statementIndex, [], facts, classifyFacts(facts, rules.rules))];
  }

  const bodyPlan = planContainerBody(stmt);
  const containerFacts: StatementFacts = { ...facts, bodyInspected: bodyPlan.inspected };
  const containerFinding = buildFinding(statementIndex, [], containerFacts, classifyFacts(containerFacts, rules.rules));
  if (!bodyPlan.inspected) {
    return [containerFinding];
  }

  const nested = await inspectContainerBody(bodyPlan, 0);
  const nestedFindings = nested.map((entry) =>
    buildFinding(statementIndex, [statementIndex, ...entry.path], entry.facts, classifyFacts(entry.facts, rules.rules)),
  );
  return [containerFinding, ...nestedFindings];
}

/** D-10: deterministic finding order -- ascending statement index, then ascending nested path
 * compared element by element -- so output is byte-stable across runs and a diff of two reports
 * is meaningful. A container's own finding always has nestedPath [] and therefore always sorts
 * before any nested finding D-05's recursion produced for the same statementIndex, since a
 * shorter path sorts before a longer one that shares the same (empty) prefix. */
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
 * object -- see classify.ts's loadRules or adapter/default-rules.ts's loadDefaultRules.
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
      : (
          await Promise.all(
            statements.map((stmt, statementIndex) => inspectAndClassifyStatement(stmt, statementIndex, rules)),
          )
        ).flat();

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
