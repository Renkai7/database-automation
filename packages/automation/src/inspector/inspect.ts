// ANLZ-01/D-11: reduces raw SQL text to a real PostgreSQL AST (via libpg-query, never regex --
// D10) and then reduces each parsed statement to the flat StatementFacts vocabulary D-01
// requires. A separate module rather than inline code in analyze.ts, deliberately: the same
// property scripts/verify-migration-state.ts and scripts/backup-manifest.ts already establish
// in this repo -- no module-load side effects, no filesystem, no database, no process.env --
// so a test can import parseTopLevel/inspectStatement directly and exercise both the passing
// and the failing direction without standing up anything.
//
// Scope is deliberately narrow for this plan: only the DropStmt -> DropTable case is observed
// in full. Every other statement kind returns statementKind "Unrecognized" for now -- later
// plans in this phase (02-07) teach the inspector to recognise more of D-04's catalogue. That is
// itself the D-01 contract working as intended: teaching the analyzer to observe something new
// is an inspector change (a code diff and a test), never a rules-file change.
import { parse } from "libpg-query";
import { safeErrorMessage } from "../../../../scripts/log";
import { AnalyzerParseError, EMPTY_FACTS, type StatementFacts } from "../types";

/** One top-level parsed statement, in the shape libpg-query's `parse()` returns per entry of
 * its `stmts` array -- an opaque AST node keyed by node-type name (e.g. `DropStmt`). */
export type ParsedStatement = Record<string, unknown>;

/**
 * Parses SQL text into an array of top-level statement ASTs using the real PostgreSQL grammar.
 * D-08: any failure to parse -- including libpg-query's own "Query cannot be empty" rejection
 * for a zero-length or whitespace-only string, observed directly against the installed package
 * this session -- is converted to AnalyzerParseError built from safeErrorMessage, never a bare
 * re-throw of libpg-query's own SqlError object (which carries a `sqlDetails` field this
 * function deliberately does not walk). libpg-query preserves a cursor position on that object
 * when one is available; fold it into the message so D-08's "report the failure" contract is
 * actionable, without serialising the whole error.
 *
 * Callers that need to treat "nothing here" (empty/whitespace/comment-only input) as zero
 * statements rather than a parse failure must not pass empty/whitespace text to this function --
 * see analyze.ts's empty-input branch, which checks before calling this at all. Comment-only
 * text is safe to pass here: libpg-query resolves it with an empty `stmts` array, not a
 * rejection (observed directly this session).
 */
export async function parseTopLevel(sql: string): Promise<ParsedStatement[]> {
  let result: { version: number; stmts: Array<{ stmt: ParsedStatement }> };
  try {
    result = await parse(sql);
  } catch (error) {
    const cursorPosition = (error as { sqlDetails?: { cursorPosition?: number } }).sqlDetails
      ?.cursorPosition;
    const message =
      cursorPosition === undefined
        ? safeErrorMessage(error)
        : `${safeErrorMessage(error)} (at character ${cursorPosition})`;
    throw new AnalyzerParseError(message);
  }
  return result.stmts.map((entry) => entry.stmt);
}

/** Extracts the last (unqualified) name and, if a schema-qualifier is present, the schema name
 * from a libpg-query `List` node of `String` items -- the shape `DropStmt.objects[n]` and
 * similar relation-name fields use for both `table` and `schema.table` forms. */
function readQualifiedName(node: unknown): { schema: string | null; name: string | null } {
  const items = (node as { List?: { items?: Array<{ String?: { sval?: string } }> } })?.List
    ?.items;
  if (!items || items.length === 0) {
    return { schema: null, name: null };
  }
  const names = items.map((item) => item.String?.sval ?? null).filter((n): n is string => n !== null);
  if (names.length === 0) {
    return { schema: null, name: null };
  }
  if (names.length === 1) {
    return { schema: null, name: names[0] };
  }
  return { schema: names[names.length - 2], name: names[names.length - 1] };
}

/**
 * Reduces one parsed statement AST to StatementFacts (D-01). Built by spreading EMPTY_FACTS and
 * overriding only what this statement kind's node actually carries, so every field the
 * classifier might match on is always present. For this plan, only DropStmt with
 * removeType "OBJECT_TABLE" (a real `DROP TABLE`) is recognised; every other node type resolves
 * to statementKind "Unrecognized", which D-06 already sends to REVIEW REQUIRED via the ordinary
 * no-match path.
 */
export function inspectStatement(stmt: ParsedStatement): StatementFacts {
  const dropStmt = stmt.DropStmt as
    | { objects?: unknown[]; removeType?: string }
    | undefined;
  if (dropStmt && dropStmt.removeType === "OBJECT_TABLE") {
    const target = dropStmt.objects?.[0];
    const { schema, name } = readQualifiedName(target);
    return {
      ...EMPTY_FACTS,
      statementKind: "DropTable",
      schema,
      table: name,
    };
  }

  return { ...EMPTY_FACTS, statementKind: "Unrecognized" };
}
