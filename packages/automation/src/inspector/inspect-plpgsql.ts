// ANLZ-05/D-05: recurses into the one place `libpg-query`'s ordinary `parse()` cannot see --
// the dollar-quoted procedural body of a `DO` block or a `CREATE [OR REPLACE] FUNCTION`. A
// separate module rather than inline code in inspect.ts, deliberately: this is real PL/pgSQL
// grammar, a different parser entry point (`parsePlPgSQL`, not `parse`), and its own adversarial
// shapes (03-RESEARCH.md Pattern 4, PITFALLS.md section C1) -- keeping it apart from the
// top-level statement dispatcher makes the recursion boundary a module boundary, not a branch
// buried inside inspectStatement.
//
// THE LOAD-BEARING SHAPE, pinned by test/libpg-query-contract.test.ts (03-01) and confirmed
// again live this session: `parsePlPgSQL`'s returned tree is NOT a complete, re-parseable AST.
// An embedded ordinary SQL statement arrives as RAW QUERY TEXT at
// `PLpgSQL_stmt_execsql.sqlstmt.PLpgSQL_expr.query` -- a plain string, not a typed `DropStmt`/
// `InsertStmt`/etc. node. Walking this tree looking for a typed SQL node would find nothing and
// wrongly conclude the body is SAFE -- 03-RESEARCH.md Pitfall 2's exact failure mode. So this
// module's traversal (extractEmbeddedSql) collects TEXT, and the recursive step is always to
// feed that text back through inspect.ts's own `parseTopLevel` -- never to interpret the
// procedural tree as if it already carried a parsed SQL statement.
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
// KNOWN LIMITATION, recorded rather than silently assumed away (CLAUDE.md: "mark unverified
// things UNKNOWN"): recursion only descends into a body whose own `LANGUAGE` is `plpgsql`
// (case-insensitive; DO blocks default to it when unspecified, matching real PostgreSQL
// semantics). A `CREATE FUNCTION ... LANGUAGE sql` body is genuine SQL text, not PL/pgSQL, and
// `parsePlPgSQL` cannot parse it -- this plan's own scope (D-05, ANLZ-05, the D-14 adversarial
// pairs) is PL/pgSQL recursion specifically. A `LANGUAGE sql` function's own container statement
// still earns SAFE by the create-function-container rule, so its body is not further inspected.
// UNKNOWN whether a future migration ever uses `LANGUAGE sql` with a hidden destructive
// statement; not exercised by this plan's fixtures.
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

/** Extracts the dollar-quoted body text and declared language of a top-level `DoStmt` or
 * `CreateFunctionStmt` node -- observed directly this session: a `DoStmt`'s body is a bare
 * `String` node on its `as` arg, while a `CreateFunctionStmt`'s body is the same `String` node
 * wrapped one level deeper in a `List` (`options[].DefElem["as"].arg.List.items[0].String`).
 * Returns `null` for a node this function does not recognise, or whose body text this AST
 * shape did not carry (defensive; not expected for real parser output). */
function extractProceduralBody(
  stmt: ParsedStatement,
): { kind: "do-block" | "function-body"; body: string; language: string } | null {
  if ("DoStmt" in stmt) {
    const doStmt = stmt.DoStmt as { args?: Array<{ DefElem?: DefElemArg }> };
    const asArg = findDefElem(doStmt.args, "as");
    const body = (asArg?.arg as { String?: { sval?: string } } | undefined)?.String?.sval;
    if (typeof body !== "string") {
      return null;
    }
    const languageArg = findDefElem(doStmt.args, "language");
    const language = (languageArg?.arg as { String?: { sval?: string } } | undefined)?.String?.sval ?? "plpgsql";
    return { kind: "do-block", body, language };
  }
  if ("CreateFunctionStmt" in stmt) {
    const createFn = stmt.CreateFunctionStmt as { options?: Array<{ DefElem?: DefElemArg }> };
    const asArg = findDefElem(createFn.options, "as");
    const items = (asArg?.arg as { List?: { items?: Array<{ String?: { sval?: string } }> } } | undefined)?.List
      ?.items;
    const body = items?.[0]?.String?.sval;
    if (typeof body !== "string") {
      return null;
    }
    const languageArg = findDefElem(createFn.options, "language");
    const language = (languageArg?.arg as { String?: { sval?: string } } | undefined)?.String?.sval ?? "plpgsql";
    return { kind: "function-body", body, language };
  }
  return null;
}

/**
 * Given a parsed top-level (or re-parsed, nested) statement, returns a reconstructed, minimal
 * full statement suitable for `parsePlPgSQL` -- observed directly this session that
 * `parsePlPgSQL`'s output for this reconstructed form is identical to parsing the original
 * statement text directly (see the plan's own SUMMARY for the exact probe), which sidesteps
 * needing to slice the caller's original source text by character offset. Returns `null` when
 * `stmt` is not a `DoStmt`/`CreateFunctionStmt`, or its declared language is not `plpgsql` (see
 * the module header's KNOWN LIMITATION) -- either way, the caller treats `null` as "nothing
 * further to recurse into," while the statement's own container fact (produced by
 * `inspectStatement`) still stands on its own.
 */
export function reconstructPlPgSqlStatement(
  stmt: ParsedStatement,
): { sql: string; sourceContext: SourceContext } | null {
  const extracted = extractProceduralBody(stmt);
  if (!extracted || extracted.language.toLowerCase() !== "plpgsql") {
    return null;
  }
  if (extracted.kind === "do-block") {
    return { sql: `DO $$${extracted.body}$$ LANGUAGE plpgsql;`, sourceContext: "do-block" };
  }
  return {
    sql: `CREATE FUNCTION anon() RETURNS void AS $$${extracted.body}$$ LANGUAGE plpgsql;`,
    sourceContext: "function-body",
  };
}

/** One fact set found by `inspectPlPgSqlBody`'s recursion, paired with its position within the
 * body being walked (relative to THIS call -- the caller prepends its own enclosing index, per
 * this plan's own wording: "the enclosing statement index followed by its position within the
 * body"). analyze.ts turns each of these into a Finding. */
export interface NestedFact {
  facts: StatementFacts;
  path: number[];
}

/**
 * Parses the FULL statement text of a `DO` block or function creation (not just its dollar-
 * quoted body), extracts every embedded statement (`extractEmbeddedSql`), classifies each one
 * by feeding real SQL text back through `parseTopLevel`/`inspectStatement`, tags every resulting
 * fact set with `sourceContext` and a `nestingDepth` one greater than `depth`, and recurses again
 * for any nested `DO`/function statement found inside (D-05: "how far recursion goes... capped
 * at depth 8, exceeding the cap is BLOCKED" -- this plan's own resolution of that discretion
 * point).
 *
 * `depth` is the depth of the body THIS call is about to parse -- 0 for a top-level DO/function
 * statement's own body, one more for each further level of DO/function nesting found inside.
 * When `depth` has already reached `MAX_NESTING_DEPTH`, this function does not even attempt to
 * parse `fullStatementSql`: it stops immediately and emits a single synthetic fact set naming
 * the limit, so a pathological input cannot exhaust the stack and the outcome is produced by a
 * rule (nesting-depth-exceeded) rather than a special case elsewhere in the classifier.
 */
export async function inspectPlPgSqlBody(
  fullStatementSql: string,
  sourceContext: SourceContext,
  depth: number,
): Promise<NestedFact[]> {
  if (depth >= MAX_NESTING_DEPTH) {
    return [
      {
        facts: {
          ...EMPTY_FACTS,
          statementKind: "Unrecognized",
          sourceContext,
          nestingDepth: depth,
          nestingLimitExceeded: true,
        },
        path: [],
      },
    ];
  }

  let tree: unknown;
  try {
    tree = await parsePlPgSQL(fullStatementSql);
  } catch (error) {
    // D-08: a body that does not even parse as PL/pgSQL is a parse failure like any other --
    // the analyzer's premise (real grammar, not a guess) did not hold, so it has no standing to
    // classify anything inside. Never a silent SAFE.
    throw new AnalyzerParseError(safeErrorMessage(error));
  }

  const entries = extractEmbeddedSql(tree);
  const results: NestedFact[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    if (entry.kind === "dynamic") {
      // D-07: never resolved, never recursed into -- the argument could be anything, including
      // a drop, and the classifier decides via rules.json's unresolvable-dynamic-sql (plan
      // task 2), not via code here.
      results.push({
        facts: {
          ...EMPTY_FACTS,
          statementKind: "ExecuteDynamic",
          sourceContext,
          nestingDepth: depth + 1,
          dynamicSqlUnresolved: true,
        },
        path: [i],
      });
      continue;
    }

    // The load-bearing recursive step (03-RESEARCH.md Pitfall 2): entry.query is raw text, fed
    // back through the SAME real-parser entry point every top-level statement uses.
    const [stmt] = await parseTopLevel(`${entry.query};`);
    if (!stmt) {
      continue;
    }

    const nestedContainer = reconstructPlPgSqlStatement(stmt);
    if (nestedContainer) {
      const containerFacts = inspectStatement(stmt);
      results.push({
        facts: { ...containerFacts, sourceContext, nestingDepth: depth + 1 },
        path: [i],
      });
      const nested = await inspectPlPgSqlBody(nestedContainer.sql, nestedContainer.sourceContext, depth + 1);
      for (const nestedFact of nested) {
        results.push({ facts: nestedFact.facts, path: [i, ...nestedFact.path] });
      }
      continue;
    }

    const facts = inspectStatement(stmt);
    results.push({ facts: { ...facts, sourceContext, nestingDepth: depth + 1 }, path: [i] });
  }

  return results;
}
