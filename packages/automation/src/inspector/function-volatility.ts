// ANLZ-04/03-CONTEXT.md D-04: the static curated PostgreSQL function-volatility table used in
// place of the pg_proc lookup the pure classifier cannot make (D-11 -- the classifier has no
// database connection, so volatility cannot be looked up at runtime; it must ship in code).
//
// SOURCE, quoted directly from postgresql.org/docs/current/sql-altertable.html (fetched during
// 03-RESEARCH.md's Pattern 2 / Pitfall 1):
//   "When a column is added with ADD COLUMN and a non-volatile DEFAULT is specified, the
//   default value is evaluated at the time of the statement and the result stored in the
//   table's metadata... In neither case is a rewrite of the table required."
//   "Adding a column with a volatile DEFAULT (e.g., clock_timestamp())... will cause the
//   entire table and its indexes to be rewritten."
//
// The correction this table exists to encode: PostgreSQL's fast add-column path is keyed on
// NON-VOLATILE (STABLE or IMMUTABLE both qualify), not on "is a literal" / "has no function
// call". now() and current_timestamp are catalogued STABLE by PostgreSQL -- evaluated once at
// ALTER TABLE time and stored in the table's metadata exactly like a constant -- so they belong
// in KNOWN_STABLE_FUNCTIONS, never grouped with genuinely volatile functions like
// clock_timestamp(). This project's own earlier research (.planning/research/PITFALLS.md A3 and
// FEATURES.md section 1) grouped now() with volatile functions; that grouping is WRONG per the
// citation above and must not be restored.
//
// WHAT THIS TABLE DOES NOT KNOW (state this plainly, per CLAUDE.md's "mark unverified things
// UNKNOWN"): it is a curated starting point, not a verified-complete catalogue of PostgreSQL's
// built-in functions. Any function name absent from all three sets below -- including any
// user-defined function -- resolves to "unknown-function", which D-06 already fails safe to
// REVIEW REQUIRED rather than SAFE. That failure direction -- a false REVIEW, never a false
// SAFE -- is exactly what makes an incomplete table acceptable; never widen the unknown case to
// a default of SAFE for convenience.
//
// No imports beyond the type it returns, no side effects at module load.
import type { DefaultVolatility } from "../types";

/** Forces a full table rewrite on ADD COLUMN even on modern PostgreSQL -- the value differs per
 * row and cannot be stored as a single metadata entry (FEATURES.md section 1). */
export const KNOWN_VOLATILE_FUNCTIONS: ReadonlySet<string> = new Set([
  "clock_timestamp",
  "statement_timestamp",
  "transaction_timestamp",
  "random",
  "random_normal",
  "gen_random_uuid",
  "uuid_generate_v4",
  "nextval",
  "txid_current",
  "pg_backend_pid",
]);

/** Evaluated once at ALTER TABLE time and stored in table metadata exactly like a literal --
 * qualifies for PostgreSQL's fast add-column path (the Pitfall 1 correction this module exists
 * to encode). */
export const KNOWN_STABLE_FUNCTIONS: ReadonlySet<string> = new Set([
  "now",
  "current_timestamp",
  "current_date",
  "current_time",
  "localtimestamp",
]);

/** A small set of genuinely immutable built-ins worth naming explicitly -- also qualifies for
 * the fast path. Not exhaustive; see the module header's "what this table does not know". */
export const KNOWN_IMMUTABLE_FUNCTIONS: ReadonlySet<string> = new Set(["md5", "length"]);

/** Unwraps a `TypeCast` node to whatever it casts, recursively, so `DEFAULT '2020-01-01'::date`
 * (a cast of a literal) and a cast of a function call are both classified by what is actually
 * being cast rather than by the cast wrapper itself. */
function unwrapTypeCast(node: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!node) {
    return node;
  }
  const typeCast = node.TypeCast as { arg?: Record<string, unknown> } | undefined;
  if (typeCast) {
    return unwrapTypeCast(typeCast.arg);
  }
  return node;
}

/**
 * Reduces a default expression's raw AST node (a `CONSTR_DEFAULT` constraint's `raw_expr`) to
 * PostgreSQL's actual three-way volatility categorisation. `undefined` (no default at all)
 * yields "none". A constant node (`A_Const`), or a cast of one, yields "literal" -- PostgreSQL
 * stores it in table metadata exactly like a non-volatile function result, so the
 * `DefaultVolatility` vocabulary gives it its own value rather than folding it into
 * "immutable" (a literal is not the result of evaluating any function). A `FuncCall` node whose
 * name (its last, unqualified name part) is in one of the three curated sets above yields that
 * category. Any other shape -- a function name absent from all three sets, an arithmetic
 * expression, a subquery, an operator expression -- yields "unknown-function" rather than a
 * guess; D-06 already sends that to REVIEW REQUIRED via the ordinary no-match path.
 */
export function classifyDefaultVolatility(
  defaultExpressionNode: Record<string, unknown> | undefined,
): DefaultVolatility {
  const unwrapped = unwrapTypeCast(defaultExpressionNode);
  if (!unwrapped) {
    return "none";
  }
  if ("A_Const" in unwrapped) {
    return "literal";
  }

  const funcCall = unwrapped.FuncCall as { funcname?: Array<{ String?: { sval?: string } }> } | undefined;
  if (funcCall) {
    const nameParts = (funcCall.funcname ?? [])
      .map((part) => part.String?.sval)
      .filter((name): name is string => Boolean(name));
    const functionName = nameParts.at(-1);
    if (functionName && KNOWN_VOLATILE_FUNCTIONS.has(functionName)) {
      return "volatile";
    }
    if (functionName && KNOWN_STABLE_FUNCTIONS.has(functionName)) {
      return "stable";
    }
    if (functionName && KNOWN_IMMUTABLE_FUNCTIONS.has(functionName)) {
      return "immutable";
    }
    return "unknown-function";
  }

  return "unknown-function";
}
