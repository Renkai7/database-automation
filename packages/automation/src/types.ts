// ANLZ-01/02/03: the complete public contract packages/automation exposes. Every later plan in
// this phase (02-07) and Phase 4's runner build against these exact shapes, so this file is
// written in full now (03-CONTEXT.md D-01/D-11/D-12) even though this plan's tracer only
// exercises a slice of it. A separate module rather than inline types, deliberately: the fact
// vocabulary, verdict severity, and exit codes are the seam every consumer (CLI, classifier,
// Phase 5's CI, Phase 7's audit log) is written against -- renaming any of it later touches all
// of them (D-01's "costly" reversibility note).
//
// No imports, no side effects: this module must be importable with zero I/O.

/** The three-tier classification outcome. Never a fourth value -- D-08's parse failure is a
 * distinct thrown error (AnalyzerParseError), never a Verdict. */
export type Verdict = "SAFE" | "REVIEW_REQUIRED" | "BLOCKED";

/** D-10 "worst verdict wins" expressed as one comparison: higher severity always wins a
 * max() over VERDICT_SEVERITY, so the reduction never needs a bespoke ordering function. */
export const VERDICT_SEVERITY: Record<Verdict, number> = {
  SAFE: 0,
  REVIEW_REQUIRED: 1,
  BLOCKED: 2,
};

/**
 * D-01's facts vocabulary: every statement kind the inspector can currently recognise, plus
 * the two structural outcomes that are not really "kinds of SQL" but need a place in the same
 * union so the rest of the pipeline (classify, findings) never special-cases them: EmptyInput
 * (Task 3's zero-statement contract) and Unrecognized (anything the inspector cannot yet name).
 */
export type StatementKind =
  | "EmptyInput"
  | "DropTable"
  | "DropSchema"
  | "DropDatabase"
  | "Truncate"
  | "DropColumn"
  | "Delete"
  | "Update"
  | "CreateTable"
  | "AddColumn"
  | "SetNotNull"
  | "DropNotNull"
  | "AlterColumnType"
  | "AddUniqueConstraint"
  | "AddCheckConstraint"
  | "AddForeignKey"
  | "DropConstraint"
  | "ValidateConstraint"
  | "CreateIndex"
  | "DropIndex"
  | "RenameColumn"
  | "RenameTable"
  | "AlterTypeDropValue"
  | "CommentOn"
  | "DoBlock"
  | "CreateFunction"
  | "ExecuteDynamic"
  | "Vacuum"
  | "AlterSystem"
  | "CreateDatabase"
  | "Reindex"
  | "SetGuc"
  | "AlterDatabaseSet"
  | "AlterRoleSet"
  | "Unrecognized";

/**
 * PostgreSQL's own three-way function volatility, plus two analyzer-specific states: "none"
 * (the statement has no default expression at all) and "unknown-function" (a function name the
 * static curated table -- built in a later plan -- has no entry for). D-06 already resolves
 * "unknown-function" to REVIEW REQUIRED via the ordinary no-match path, so this is not a fourth
 * verdict, just an honest fact value (03-RESEARCH.md Pattern 2's now()/STABLE correction).
 */
export type DefaultVolatility = "none" | "literal" | "immutable" | "stable" | "volatile" | "unknown-function";

/** D-05's recursion context: where a statement was found, not what it does. Set by the
 * inspector's recursive step (a later plan), defaulted to "top-level" here. */
export type SourceContext = "top-level" | "do-block" | "function-body";

/**
 * The flat, rule-matchable reduction of one parsed statement (D-01: "a rule matches those
 * facts by equality and set membership only -- no expressions, no computed conditions"). Every
 * field is present on every StatementFacts value -- see EMPTY_FACTS -- so a rule can match on
 * any subset without the classifier needing to guard against an absent key.
 */
export interface StatementFacts {
  statementKind: StatementKind;
  schema: string | null;
  table: string | null;
  column: string | null;
  constraintName: string | null;
  indexName: string | null;
  usingIndexName: string | null;
  concurrently: boolean;
  notValid: boolean;
  checkProvesNotNull: boolean;
  defaultVolatility: DefaultVolatility;
  hasWhereClause: boolean;
  dynamicSqlUnresolved: boolean;
  sourceContext: SourceContext;
  nestingDepth: number;
  /** D-05/plan 03-04: true only for the single synthetic fact set inspectPlPgSqlBody emits when
   * MAX_NESTING_DEPTH would be exceeded (statementKind stays "Unrecognized" -- there is no real
   * statement to name, just the fact that recursion stopped). A rule matches on this the same
   * way it matches any other fact: by exact equality, never a computed depth comparison (D-01
   * still applies one level down into PL/pgSQL). */
  nestingLimitExceeded: boolean;
  /** Gap-closure fix (post-03-04): true only on a DoBlock/CreateFunction container's OWN fact
   * set, and only when its body was genuinely re-parsed and every statement inside it
   * classified on its own findings (LANGUAGE plpgsql via parsePlPgSQL, or LANGUAGE sql -- text
   * or the BEGIN ATOMIC standard-SQL-body form -- via parseTopLevel/inspectStatement). Set
   * truthfully at the single place the recursion decision is made
   * (inspect-plpgsql.ts's planContainerBody), never inferred elsewhere. Defaults to `false`
   * (EMPTY_FACTS) so a container this fact is never explicitly set `true` for fails closed:
   * do-block-container/create-function-container only match when it is `true`, and
   * container-body-not-inspected (REVIEW_REQUIRED, never SAFE) matches when it is `false` --
   * generic across ANY language the analyzer cannot currently read (plperl, c, python, or any
   * future language), not special-cased to one. */
  bodyInspected: boolean;
  /** D-10 (04-CONTEXT.md): true only when PostgreSQL itself refuses to run this statement inside
   * a transaction block -- CREATE/DROP INDEX CONCURRENTLY, REINDEX CONCURRENTLY, VACUUM, CREATE
   * DATABASE and ALTER SYSTEM. The Phase 4 runner reads this fact to decide whether a migration
   * file must run unwrapped (D-09/D-11); it must never keep its own second list of statement
   * kinds that cannot run in a transaction, which is exactly the analyzer-vocabulary-drift D-10
   * exists to prevent. Independent of `concurrently` -- VACUUM/CREATE DATABASE/ALTER SYSTEM carry
   * no `concurrently` flag at all, so this is never derived from that field. */
  transactionHostile: boolean;
  /** D-17 (04-CONTEXT.md): true only when the statement sets, resets or defaults
   * `lock_timeout` or `statement_timeout` at any scope -- session (`SET`/`SET LOCAL`/`RESET`),
   * cluster-wide (`ALTER SYSTEM SET`), database-wide (`ALTER DATABASE ... SET`) or role-wide
   * (`ALTER ROLE ... SET`). A migration that disarms its own safety rail is architecturally
   * identical to a rules file downgrading DROP TABLE -- this fact is what D17_FLOOR_FACTS
   * (floor.ts) makes un-editable by any rules file. `RESET ALL` sets this true unconditionally
   * even though its AST node carries no GUC name to match on (Pitfall 4, 04-RESEARCH.md). */
  disarmsTimeout: boolean;
}

/** Every field at its neutral default, so any consumer that needs a complete StatementFacts
 * (the inspector for a partially-observed statement, floor.ts's synthetic fact sets, Task 3's
 * empty-input branch) spreads this rather than hand-writing every field. */
export const EMPTY_FACTS: StatementFacts = {
  statementKind: "Unrecognized",
  schema: null,
  table: null,
  column: null,
  constraintName: null,
  indexName: null,
  usingIndexName: null,
  concurrently: false,
  notValid: false,
  checkProvesNotNull: false,
  defaultVolatility: "none",
  hasWhereClause: false,
  dynamicSqlUnresolved: false,
  sourceContext: "top-level",
  nestingDepth: 0,
  nestingLimitExceeded: false,
  bodyInspected: false,
  transactionHostile: false,
  disarmsTimeout: false,
};

/**
 * The complete classification outcome for one parsed statement. `ruleIds`/`rationales` stay
 * parallel arrays in the same (ascending) order so a consumer never has to zip them by index
 * incorrectly; `nestedPath` is empty at top level and gains one entry per level of D-05
 * recursion (a later plan). `pairedWith` supports D-09's same-file safe-form pairing (a later
 * plan) -- null until something implements it.
 */
export interface Finding {
  statementIndex: number;
  nestedPath: number[];
  verdict: Verdict;
  ruleIds: string[];
  rationales: string[];
  facts: StatementFacts;
  pairedWith: number | null;
}

/** D-10: always the complete findings list, never short-circuited on the first BLOCKED.
 * `verdict` is the worst finding verdict (or SAFE if findings is empty, which in practice
 * cannot happen once Task 3's empty-input rule ships -- there is always at least one finding). */
export interface AnalysisResult {
  verdict: Verdict;
  findings: Finding[];
  statementCount: number;
  rulesVersion: number;
}

/** D-08: a parse failure is a hard error, not a verdict. Thrown by the inspector, caught by the
 * CLI and mapped to EXIT_CODES.PARSE_FAILURE -- never converted into an AnalysisResult. */
export class AnalyzerParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyzerParseError";
  }
}

/** D-02: thrown when the rules file fails schema validation, or when a floor operation resolves
 * to anything other than BLOCKED (assertFloorNotWeakened). The analyzer refuses to start rather
 * than silently falling back to a hardcoded verdict. */
export class RulesFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RulesFileError";
  }
}

/**
 * Distinct, deliberately non-adjacent exit codes (D-12). The gaps are load-bearing: a crashed
 * analyzer exits with Node's generic 1 on an uncaught exception, and 1 is not a value any of
 * these five carry, so a crash can never be mistaken for a verdict by CI (Phase 5) or the audit
 * record (Phase 7). PARSE_FAILURE and RULES_INVALID are the two non-verdict outcomes D-08/D-02
 * require; neither is a Verdict value.
 */
export const EXIT_CODES = Object.freeze({
  SAFE: 0,
  REVIEW_REQUIRED: 10,
  BLOCKED: 20,
  PARSE_FAILURE: 30,
  RULES_INVALID: 40,
});
