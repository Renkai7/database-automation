// D-03: statement boundaries come from the SAME `libpg-query` parse that produced the verdict --
// never drizzle's own `--> statement-breakpoint` marker, never a semicolon-splitting rule. This
// module calls `libpg-query`'s `parse()` a second time on the EXACT SAME buffer `analyzeSql`
// classified (D-01: the classified bytes are the split bytes -- both come from parsing the same
// text). A second, cheap WASM parse is deliberate rather than changing `analyzeSql`/
// `parseTopLevel`'s existing contract (04-RESEARCH.md Open Question 1): it keeps every existing
// call site untouched and costs one extra parse per migration file, negligible at migration-file
// volumes.
//
// Mirrors `packages/automation/src/inspector/inspect.ts`'s own purity discipline: imports stay
// limited to `libpg-query` and `../types`, no filesystem, no side effects.
import { parse } from "libpg-query";
import { AnalyzerParseError } from "../types";

/** One top-level statement's recovered text plus its byte offset/length in the original file. */
export interface SplitStatement {
  text: string;
  location: number;
  length: number;
}

interface ParsedStmtEntry {
  stmt_location?: number;
  stmt_len?: number;
}

/**
 * Splits `sql` into its top-level statements using `libpg-query`'s own `stmt_location`/
 * `stmt_len` fields -- verified live (04-RESEARCH.md Pattern 1) to correctly exclude a comment
 * sitting between two statements, and the trailing statement delimiter, from every statement's
 * own recovered text. The FIRST statement carries no `stmt_location` key at all (absent, not
 * `0`) -- `entry.stmt_location ?? 0` recovers it correctly regardless.
 *
 * A file with zero executable statements (empty, whitespace-only, or comment-only) resolves
 * with an empty array, never a parse failure -- `libpg-query` itself resolves comment-only text
 * with an empty `stmts` array (verified live this session per 04-RESEARCH.md).
 *
 * A genuine parse failure is converted to `AnalyzerParseError`, the same error type
 * `inspector/inspect.ts`'s `parseTopLevel` throws for the same failure mode on the same buffer --
 * built inline here (not by importing `scripts/log.ts`'s `safeErrorMessage`) to keep this
 * module's import list limited to `libpg-query` and `../types`, matching `inspect.ts`'s own
 * purity discipline.
 */
export async function splitStatements(sql: string): Promise<SplitStatement[]> {
  let result: { stmts?: ParsedStmtEntry[] };
  try {
    result = (await parse(sql)) as unknown as typeof result;
  } catch (error) {
    const cursorPosition = (error as { sqlDetails?: { cursorPosition?: number } }).sqlDetails
      ?.cursorPosition;
    const message = error instanceof Error ? error.message : String(error);
    throw new AnalyzerParseError(
      cursorPosition === undefined ? message : `${message} (at character ${cursorPosition})`,
    );
  }

  return (result.stmts ?? []).map((entry) => {
    const location = entry.stmt_location ?? 0;
    const length = entry.stmt_len ?? sql.length - location;
    return { text: sql.slice(location, location + length), location, length };
  });
}
