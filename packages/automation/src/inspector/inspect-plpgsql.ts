// ANLZ-05/D-05: recurses into the places `libpg-query`'s ordinary `parse()` cannot see on its
// own -- the dollar-quoted or standard-SQL-body of a `DO` block or a `CREATE [OR REPLACE]
// FUNCTION`. A separate module rather than inline code in inspect.ts, deliberately: this
// traversal owns real PL/pgSQL grammar (a different parser entry point, `parsePlPgSQL`, not
// `parse`) and its own adversarial shapes (03-RESEARCH.md Pattern 4, PITFALLS.md section C1) --
// keeping it apart from the top-level statement dispatcher makes the recursion boundary a module
// boundary, not a branch buried inside inspectStatement.
//
// THE LOAD-BEARING SHAPE, pinned by test/libpg-query-contract.test.ts (03-01) and confirmed
// again live this session: `parsePlPgSQL`'s returned tree is NOT a complete, re-parseable AST.
// An embedded ordinary SQL statement arrives as RAW QUERY TEXT at
// `PLpgSQL_stmt_execsql.sqlstmt.PLpgSQL_expr.query` -- a plain string, not a typed `DropStmt`/
// `InsertStmt`/etc. node. Walking this tree looking for a typed SQL node would find nothing and
// wrongly conclude the body is SAFE -- 03-RESEARCH.md Pitfall 2's exact failure mode. So this
// module's PL/pgSQL traversal (extractEmbeddedSql) collects TEXT, and the recursive step is
// always to feed that text back through inspect.ts's own `parseTopLevel` -- never to interpret
// the procedural tree as if it already carried a parsed SQL statement.
//
// A `PLpgSQL_stmt_dynexecute` (an `EXECUTE` whose argument is a PL/pgSQL expression, not a SQL
// statement) is the other statement kind this traversal must recognise, and it is NOT a
// recursion site: there is no SQL text to re-parse, because the argument could be a variable, a
// concatenation, or any other expression. D-07 requires this to be BLOCKED regardless of what
// the argument expression actually looks like -- see the module-level comment above
// extractEmbeddedSql for why no attempt is made to distinguish "looks like a literal" from
// "is a variable": any such attempt is itself the constant-folding/expression-evaluation logic
// 03-CONTEXT.md D-07 explicitly defers.
//
// GAP CLOSURE (post-03-04, orchestrator spot-check against the real CLI): plan 03-04 shipped
// recursion for a body whose declared `LANGUAGE` was `plpgsql` only -- a `LANGUAGE sql` body (or
// any other language) still earned its container statement an unconditional SAFE via
// do-block-container/create-function-container, even though the body itself was never read.
// planContainerBody below now decides, ONCE, at the single place the recursion decision is made,
// whether a container's body genuinely gets inspected, and how:
//   - `LANGUAGE plpgsql` (or unspecified, which defaults to plpgsql for a DO block, matching
//     real PostgreSQL semantics): re-parsed via `parsePlPgSQL` exactly as before (`kind:
//     "plpgsql"`).
//   - `LANGUAGE sql`, text form (`AS $$...$$` or `AS '...'`, dollar-quoted or single-quoted,
//     case-insensitive on the language name): this is genuine, ordinary SQL text -- re-parsed
//     through the SAME `parseTopLevel`/`inspectStatement` path every top-level statement uses
//     (`kind: "sql-text"`), never through `parsePlPgSQL` and never pattern-matched.
//   - `LANGUAGE sql`, the `BEGIN ATOMIC ... END` standard-SQL-body form: probed directly against
//     the installed libpg-query@18.1.4 this session (a disposable script, then deleted) --
//     this body is NOT text at all. It arrives already parsed on
//     `CreateFunctionStmt.sql_body.List.items[0].List.items`, an array of the exact same
//     `ParsedStatement`-shaped nodes `parseTopLevel` itself returns. `kind: "sql-atomic"` skips
//     the reparse step entirely and classifies those nodes directly.
//   - Any other declared language (`plperl`, `plpython3u`, `c`, or any language a future
//     PostgreSQL version adds) has no parser this analyzer can call at all: `inspected: false`.
//     This is an else-branch over "not plpgsql, not sql" -- generic by construction, never a
//     per-language allowlist a new language could silently fall through.
// The container's own StatementFacts records `bodyInspected` truthfully from this decision
// (inspect.ts never sets it -- that module answers "what statement is this," never "was its body
// read"). rules.json's do-block-container/create-function-container SAFE rules now require
// `bodyInspected: true`; a `false` value lands on the new container-body-not-inspected rule
// (REVIEW_REQUIRED, never SAFE and never BLOCKED -- a body the analyzer could not read is a
// human-review case, not a certain hazard).
import { parsePlPgSQL } from "libpg-query";
import { safeErrorMessage } from "../../../../scripts/log";
import { AnalyzerParseError, EMPTY_FACTS, type SourceContext, type StatementFacts } from "../types";
import { inspectStatement, parseTopLevel, type ParsedStatement } from "./inspect";

/** No legitimate migration this project has ever seen nests procedural bodies anywhere near this
 * deep -- the limit exists purely so a pathological or adversarial input cannot exhaust the
 * call stack. Exceeding it is BLOCKED (rules.json's nesting-depth-exceeded, analyzer-integrity
 * category), never a silent truncation: a body the analyzer could not fully read cannot be
 * called safe (D-06's "SAFE must be earned" applies here too). */
export const MAX_NESTING_DEPTH = 8;

/** One embedded statement `extractEmbeddedSql`'s traversal found: either raw SQL text that must
 * be fed back through `parseTopLevel` (`kind: "sql"`), or an `EXECUTE` whose argument is never
 * resolved to text at all (`kind: "dynamic"` -- D-07). There is deliberately no third variant
 * for "a literal-looking EXECUTE argument": distinguishing that from a variable would require
 * evaluating the PL/pgSQL expression, which 03-CONTEXT.md D-07 defers entirely, not partially. */
export type EmbeddedStatement = { kind: "sql"; query: string } | { kind: "dynamic" };

/** Deep, generic walk of the `parsePlPgSQL` tree, recursing into every field of every object and
 * every array entry rather than naming each PL/pgSQL statement kind that can carry a nested
 * body (`PLpgSQL_stmt_if`'s then/else/elsif branches, `PLpgSQL_stmt_loop`/`_while`/`_fori`'s
 * body, `PLpgSQL_stmt_block`'s own body and exception handlers, and so on). A per-kind allowlist
 * would silently stop finding statements the day a migration uses a control construct this list
 * does not yet name -- PITFALLS.md section C1's adversarial standard, applied one level down
 * into PL/pgSQL: never miss a hidden statement because of an incomplete list of "the shapes we
 * thought to check." The two statement kinds that actually carry executable content
 * (`PLpgSQL_stmt_execsql`, `PLpgSQL_stmt_dynexecute`) are leaves for this walk -- there is
 * nothing further to explore inside either one, so recursion stops there without descending into
 * their own internal fields (a `dynexecute`'s own `query` field is a PL/pgSQL expression, not a
 * nested statement, and is never read here -- see the module header on D-07). */
function walk(node: unknown, entries: EmbeddedStatement[]): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      walk(item, entries);
    }
    return;
  }
  if (node === null || typeof node !== "object") {
    return;
  }
  const record = node as Record<string, unknown>;

  if ("PLpgSQL_stmt_execsql" in record) {
    const execsql = record.PLpgSQL_stmt_execsql as
      | { sqlstmt?: { PLpgSQL_expr?: { query?: string } } }
      | undefined;
    const query = execsql?.sqlstmt?.PLpgSQL_expr?.query;
    if (typeof query === "string") {
      entries.push({ kind: "sql", query });
    }
    return;
  }
  if ("PLpgSQL_stmt_dynexecute" in record) {
    entries.push({ kind: "dynamic" });
    return;
  }

  for (const value of Object.values(record)) {
    walk(value, entries);
  }
}

/**
 * Walks the tree `parsePlPgSQL` returns and yields every embedded statement it carries, in
 * traversal order. This is the load-bearing half of D-05: it obtains SQL by reading raw query
 * TEXT off the procedural tree (never by treating the tree as if it already contained typed SQL
 * AST nodes -- 03-RESEARCH.md Pitfall 2), so the caller can feed that text back through
 * `parseTopLevel` for real classification.
 */
export function extractEmbeddedSql(plpgsqlTree: unknown): EmbeddedStatement[] {
  const entries: EmbeddedStatement[] = [];
  walk(plpgsqlTree, entries);
  return entries;
}

type DefElemArg = { defname?: string; arg?: unknown };

function findDefElem(args: Array<{ DefElem?: DefElemArg }> | undefined, name: string): DefElemArg | undefined {
  return args?.map((entry) => entry.DefElem).find((defElem) => defElem?.defname === name);
}

/** A container statement's body, before any language decision has been applied: the raw
 * dollar-quoted or single-quoted text off a `DoStmt`'s or `CreateFunctionStmt`'s `as` option,
 * plus the declared (or defaulted) language name. */
type TextBody = { language: string; text: string };

/** Extracts a `DoStmt`'s body text and declared language -- observed directly this session: the
 * body is a bare `String` node on the `as` arg. A `DO` block has no `sql_body`/`BEGIN ATOMIC`
 * form in real PostgreSQL grammar; text is the only shape a `DoStmt` body ever takes. */
function extractDoStmtBody(doStmt: { args?: Array<{ DefElem?: DefElemArg }> }): TextBody | null {
  const asArg = findDefElem(doStmt.args, "as");
  const text = (asArg?.arg as { String?: { sval?: string } } | undefined)?.String?.sval;
  if (typeof text !== "string") {
    return null;
  }
  const languageArg = findDefElem(doStmt.args, "language");
  const language = (languageArg?.arg as { String?: { sval?: string } } | undefined)?.String?.sval ?? "plpgsql";
  return { language, text };
}

/** Extracts a `CreateFunctionStmt`'s dollar-quoted or single-quoted body text and declared
 * language, when it uses the `AS '...'`/`AS $$...$$` form -- observed directly this session: the
 * body `String` node sits one level deeper than a `DoStmt`'s, wrapped in a `List`
 * (`options[].DefElem["as"].arg.List.items[0].String`). Returns `null` when the function used the
 * `BEGIN ATOMIC` form instead (no `as` option at all -- see extractCreateFunctionAtomicBody), or
 * carries no recognisable body (defensive; not expected for real parser output). */
function extractCreateFunctionTextBody(createFn: { options?: Array<{ DefElem?: DefElemArg }> }): TextBody | null {
  const asArg = findDefElem(createFn.options, "as");
  const items = (asArg?.arg as { List?: { items?: Array<{ String?: { sval?: string } }> } } | undefined)?.List
    ?.items;
  const text = items?.[0]?.String?.sval;
  if (typeof text !== "string") {
    return null;
  }
  const languageArg = findDefElem(createFn.options, "language");
  const language = (languageArg?.arg as { String?: { sval?: string } } | undefined)?.String?.sval ?? "plpgsql";
  return { language, text };
}

/** Extracts a `CreateFunctionStmt`'s `BEGIN ATOMIC ... END` standard-SQL-body statements --
 * probed directly against the installed libpg-query@18.1.4 this session (disposable script, then
 * deleted), NOT assumed: this body is never text. It arrives on `sql_body` as
 * `{ List: { items: [ { List: { items: [ <ParsedStatement>, ... ] } } ] } }` -- the SAME
 * `ParsedStatement`-shaped node objects (keyed by node-type name, e.g. `DropStmt`) that
 * `parseTopLevel` itself returns, ready to hand straight to `inspectStatement` with no reparse.
 * Returns `null` when `sql_body` is absent (the function used the `AS` text form instead) or is
 * not in the observed shape (defensive). */
function extractCreateFunctionAtomicBody(createFn: { sql_body?: unknown }): ParsedStatement[] | null {
  const sqlBody = createFn.sql_body as
    | { List?: { items?: Array<{ List?: { items?: ParsedStatement[] } }> } }
    | undefined;
  const stmts = sqlBody?.List?.items?.[0]?.List?.items;
  return Array.isArray(stmts) ? stmts : null;
}

/** The recursion decision for one container statement's body, computed exactly once (D-05/gap
 * closure). `inspected: false` means the container's OWN fact set gets `bodyInspected: false`
 * and nothing further is parsed or classified -- see the module header's language-dispatch
 * summary for the full decision table. */
export type ContainerBodyPlan =
  | { inspected: false }
  | { inspected: true; kind: "plpgsql"; sql: string; sourceContext: SourceContext }
  | { inspected: true; kind: "sql-text"; text: string; sourceContext: SourceContext }
  | { inspected: true; kind: "sql-atomic"; stmts: ParsedStatement[]; sourceContext: SourceContext };

/** Dispatches a text body by its declared language: `plpgsql` reconstructs a minimal full
 * statement for `parsePlPgSQL` (the same reconstruct-not-slice approach 03-04 verified is
 * byte-identical to the original statement's own parse output); `sql` re-parses the raw body
 * text directly through the ordinary top-level SQL path; any other language is not inspected. */
function planFromTextBody(
  textBody: TextBody,
  sourceContext: SourceContext,
  reconstructPlPgSql: (body: string) => string,
): ContainerBodyPlan {
  const language = textBody.language.toLowerCase();
  if (language === "plpgsql") {
    return { inspected: true, kind: "plpgsql", sql: reconstructPlPgSql(textBody.text), sourceContext };
  }
  if (language === "sql") {
    return { inspected: true, kind: "sql-text", text: textBody.text, sourceContext };
  }
  // Generic else-branch, not a per-language allowlist (plperl, plpython3u, c, or any future
  // language all land here identically) -- see the module header's GAP CLOSURE note.
  return { inspected: false };
}

/**
 * Given a top-level (or re-parsed, nested) statement, decides whether and how its body gets
 * inspected -- the single place this decision is made (gap closure: every earlier caller that
 * needs to know "does this container's body get recursed into, and with what" goes through this
 * function, never re-derives the language check itself). Returns `{ inspected: false }` for a
 * statement that is not a `DoStmt`/`CreateFunctionStmt` at all, one whose body this AST shape did
 * not carry (defensive), or one whose declared language has no parser this analyzer can call.
 */
export function planContainerBody(stmt: ParsedStatement): ContainerBodyPlan {
  if ("DoStmt" in stmt) {
    const textBody = extractDoStmtBody(stmt.DoStmt as { args?: Array<{ DefElem?: DefElemArg }> });
    if (!textBody) {
      return { inspected: false };
    }
    return planFromTextBody(textBody, "do-block", (body) => `DO $$${body}$$ LANGUAGE plpgsql;`);
  }
  if ("CreateFunctionStmt" in stmt) {
    const createFn = stmt.CreateFunctionStmt as {
      sql_body?: unknown;
      options?: Array<{ DefElem?: DefElemArg }>;
    };
    const atomicStmts = extractCreateFunctionAtomicBody(createFn);
    if (atomicStmts) {
      return { inspected: true, kind: "sql-atomic", stmts: atomicStmts, sourceContext: "function-body" };
    }
    const textBody = extractCreateFunctionTextBody(createFn);
    if (!textBody) {
      return { inspected: false };
    }
    return planFromTextBody(
      textBody,
      "function-body",
      (body) => `CREATE FUNCTION anon() RETURNS void AS $$${body}$$ LANGUAGE plpgsql;`,
    );
  }
  return { inspected: false };
}

/** One fact set found by recursing into a container's body, paired with its position within the
 * body being walked (relative to THIS call -- the caller prepends its own enclosing index).
 * analyze.ts turns each of these into a Finding. */
export interface NestedFact {
  facts: StatementFacts;
  path: number[];
}

/** Classifies one already-parsed statement found inside a container body (whichever kind of body
 * it came from), pushing its own finding and -- when that statement is itself a nested
 * DoBlock/CreateFunction container -- recursing via inspectContainerBody exactly like the
 * top-level dispatch does (analyze.ts's inspectAndClassifyStatement), so a container nested
 * inside a `LANGUAGE sql` body gets the identical bodyInspected/recursion treatment a
 * top-level or PL/pgSQL-nested one gets. */
async function inspectParsedStatement(
  stmt: ParsedStatement,
  sourceContext: SourceContext,
  depth: number,
  index: number,
): Promise<NestedFact[]> {
  const facts = inspectStatement(stmt);
  const isContainer = facts.statementKind === "DoBlock" || facts.statementKind === "CreateFunction";
  if (!isContainer) {
    return [{ facts: { ...facts, sourceContext, nestingDepth: depth + 1 }, path: [index] }];
  }

  const bodyPlan = planContainerBody(stmt);
  const containerFacts: StatementFacts = {
    ...facts,
    sourceContext,
    nestingDepth: depth + 1,
    bodyInspected: bodyPlan.inspected,
  };
  const results: NestedFact[] = [{ facts: containerFacts, path: [index] }];
  if (bodyPlan.inspected) {
    const nested = await inspectContainerBody(bodyPlan, depth + 1);
    for (const nestedFact of nested) {
      results.push({ facts: nestedFact.facts, path: [index, ...nestedFact.path] });
    }
  }
  return results;
}

/**
 * The generalised D-05 recursion entry point: given a body-inspection plan `planContainerBody`
 * already decided is `inspected: true`, parses (or, for `sql-atomic`, simply reads) that body's
 * statements, classifies each one, and recurses again for any nested container found inside --
 * capped at `MAX_NESTING_DEPTH` (D-05: "exceeding the cap is BLOCKED", enforced identically
 * regardless of which kind of body is being walked).
 *
 * `depth` is the depth of the body THIS call is about to inspect -- 0 for a top-level container's
 * own body, one more for each further level of container nesting found inside. When `depth` has
 * already reached `MAX_NESTING_DEPTH`, this function does not even attempt to parse or read
 * `plan`'s statements: it stops immediately and emits a single synthetic fact set naming the
 * limit, so a pathological input cannot exhaust the stack and the outcome is produced by a rule
 * (nesting-depth-exceeded) rather than a special case elsewhere in the classifier.
 */
export async function inspectContainerBody(
  plan: Extract<ContainerBodyPlan, { inspected: true }>,
  depth: number,
): Promise<NestedFact[]> {
  if (depth >= MAX_NESTING_DEPTH) {
    return [
      {
        facts: {
          ...EMPTY_FACTS,
          statementKind: "Unrecognized",
          sourceContext: plan.sourceContext,
          nestingDepth: depth,
          nestingLimitExceeded: true,
        },
        path: [],
      },
    ];
  }

  if (plan.kind === "plpgsql") {
    let tree: unknown;
    try {
      tree = await parsePlPgSQL(plan.sql);
    } catch (error) {
      // D-08: a body that does not even parse as PL/pgSQL is a parse failure like any other --
      // the analyzer's premise (real grammar, not a guess) did not hold, so it has no standing
      // to classify anything inside. Never a silent SAFE.
      throw new AnalyzerParseError(safeErrorMessage(error));
    }

    const entries = extractEmbeddedSql(tree);
    const results: NestedFact[] = [];

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];

      if (entry.kind === "dynamic") {
        // D-07: never resolved, never recursed into -- the argument could be anything,
        // including a drop, and the classifier decides via rules.json's
        // unresolvable-dynamic-sql, not via code here.
        results.push({
          facts: {
            ...EMPTY_FACTS,
            statementKind: "ExecuteDynamic",
            sourceContext: plan.sourceContext,
            nestingDepth: depth + 1,
            dynamicSqlUnresolved: true,
          },
          path: [i],
        });
        continue;
      }

      // The load-bearing recursive step (03-RESEARCH.md Pitfall 2): entry.query is raw text,
      // fed back through the SAME real-parser entry point every top-level statement uses.
      const [stmt] = await parseTopLevel(`${entry.query};`);
      if (!stmt) {
        continue;
      }
      results.push(...(await inspectParsedStatement(stmt, plan.sourceContext, depth, i)));
    }

    return results;
  }

  // "sql-text": genuine SQL text (LANGUAGE sql's AS form) -- re-parsed through the ordinary
  // top-level path, never through parsePlPgSQL and never pattern-matched. May yield more than
  // one statement (a semicolon-separated body).
  //
  // "sql-atomic": already-parsed statements straight off CreateFunctionStmt.sql_body -- no
  // reparse at all, just the same per-statement classification/recursion every other kind gets.
  const stmts = plan.kind === "sql-text" ? await parseTopLevel(plan.text) : plan.stmts;
  const results: NestedFact[] = [];
  for (let i = 0; i < stmts.length; i++) {
    results.push(...(await inspectParsedStatement(stmts[i], plan.sourceContext, depth, i)));
  }
  return results;
}

/** Backward-compatible entry point for a PL/pgSQL body specifically (kept because it is this
 * module's own previously-exported public contract, still exercised directly by
 * test/plpgsql.test.ts): `fullStatementSql` is the complete `DO`/`CREATE FUNCTION` statement text
 * `parsePlPgSQL` expects, exactly as inspectContainerBody's `plpgsql` kind consumes it. */
export async function inspectPlPgSqlBody(
  fullStatementSql: string,
  sourceContext: SourceContext,
  depth: number,
): Promise<NestedFact[]> {
  return inspectContainerBody({ inspected: true, kind: "plpgsql", sql: fullStatementSql, sourceContext }, depth);
}
