// ANLZ-01/D-11: reduces raw SQL text to a real PostgreSQL AST (via libpg-query, never regex --
// D10) and then reduces each parsed statement to the flat StatementFacts vocabulary D-01
// requires. A separate module rather than inline code in analyze.ts, deliberately: the same
// property scripts/verify-migration-state.ts and scripts/backup-manifest.ts already establish
// in this repo -- no module-load side effects, no filesystem, no database, no process.env --
// so a test can import parseTopLevel/inspectStatement directly and exercise both the passing
// and the failing direction without standing up anything.
//
// Scope: every StatementKind the FEATURES.md section 1 catalogue needs except DoBlock,
// CreateFunction and ExecuteDynamic, which plan 03-04 owns (D-05's PL/pgSQL recursion). A
// statement kind the inspector does not recognise -- or an AlterTableStmt subcommand/constraint
// type outside this catalogue -- resolves to "Unrecognized", which D-06 already sends to
// REVIEW REQUIRED via the ordinary no-match path. That is not a gap; it is D-06 working.
//
// KNOWN LIMITATION, recorded rather than silently assumed away (CLAUDE.md: "mark unverified
// things UNKNOWN"): an ALTER TABLE statement with more than one subcommand (e.g.
// `ALTER TABLE t ADD COLUMN a int, ADD COLUMN b int`) only has its FIRST subcommand inspected.
// Every migration this project has generated so far (both real Drizzle migrations and this
// plan's fixtures) carries exactly one subcommand per ALTER TABLE statement, matching Drizzle's
// own one-operation-per-statement generation style -- UNKNOWN whether a future migration could
// combine subcommands; not exercised by this plan.
//
// DISCOVERED THIS SESSION, load-bearing for AlterTypeDropValue: `ALTER TYPE ... DROP VALUE ...`
// is grammatically valid PostgreSQL syntax whose own grammar action unconditionally raises
// "dropping an enum value is not implemented" (gram.y) -- confirmed live against the installed
// libpg-query@17.7.4 parser this session: parse() REJECTS this statement before any
// AlterEnumStmt AST node is ever constructed, for every input tried, including the FEATURES.md
// section 1 example. AlterTypeDropValue therefore can never reach inspectStatement from real SQL
// text -- see inspectAlterEnumStmt's comment and the plan summary's deviation note.
import { parse } from "libpg-query";
import { safeErrorMessage } from "../../../../scripts/log";
import { AnalyzerParseError, EMPTY_FACTS, type StatementFacts } from "../types";
import { classifyDefaultVolatility } from "./function-volatility";

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

/** Extracts the last (unqualified) name and, if a schema-qualifier is present, the schema name,
 * from either a `List` of `String` items (the shape `DropStmt.objects[n]`/`CommentStmt.object`
 * use for a possibly schema-qualified relation/index name) or a single bare `String` node (the
 * shape `DropStmt.objects[n]` uses for a schema name itself, which has no further qualifier of
 * its own -- observed directly this session for `DROP SCHEMA`). */
function readQualifiedName(node: unknown): { schema: string | null; name: string | null } {
  const bare = (node as { String?: { sval?: string } } | undefined)?.String;
  if (bare) {
    return { schema: null, name: bare.sval ?? null };
  }
  const items = (node as { List?: { items?: Array<{ String?: { sval?: string } }> } } | undefined)?.List
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

/** Extracts schema/table from a `RangeVar` node -- the shape `AlterTableStmt.relation`,
 * `DeleteStmt.relation`, `UpdateStmt.relation`, `IndexStmt.relation`, `CreateStmt.relation`, and
 * each entry of `TruncateStmt.relations` all use directly (never wrapped in a `List`). */
function readRangeVar(node: unknown): { schema: string | null; table: string | null } {
  const rangeVar = node as { schemaname?: string; relname?: string } | undefined;
  return { schema: rangeVar?.schemaname ?? null, table: rangeVar?.relname ?? null };
}

/** A `CONSTR_CHECK` constraint's `raw_expr` proves not-null only when it is a single-column
 * `IS NOT NULL` null test -- derived from the AST node shape, never from the expression's text
 * (03-02-PLAN.md task 1). Any other shape (a multi-column expression, a different operator, a
 * different check entirely) yields `proves: false`. */
function checkExpressionProvesNotNull(rawExpr: unknown): { proves: boolean; column: string | null } {
  const nullTest = (rawExpr as { NullTest?: { arg?: unknown; nulltesttype?: string } } | undefined)
    ?.NullTest;
  if (!nullTest || nullTest.nulltesttype !== "IS_NOT_NULL") {
    return { proves: false, column: null };
  }
  const fields = (
    nullTest.arg as { ColumnRef?: { fields?: Array<{ String?: { sval?: string } }> } } | undefined
  )?.ColumnRef?.fields;
  if (!fields || fields.length !== 1) {
    return { proves: false, column: null };
  }
  const column = fields[0].String?.sval ?? null;
  return column ? { proves: true, column } : { proves: false, column: null };
}

/** `AT_AddColumn`: the column's own default expression (if any) is reduced to a
 * `defaultVolatility` fact via `classifyDefaultVolatility` -- the fact this task exists to add
 * (ANLZ-04). */
function inspectAddColumn(
  schema: string | null,
  table: string | null,
  cmd: { def?: unknown },
): StatementFacts {
  const columnDef = (
    cmd.def as
      | { ColumnDef?: { colname?: string; constraints?: Array<{ Constraint?: Record<string, unknown> }> } }
      | undefined
  )?.ColumnDef;
  const column = columnDef?.colname ?? null;
  const defaultConstraint = columnDef?.constraints
    ?.map((entry) => entry.Constraint)
    .find((constraint) => constraint?.contype === "CONSTR_DEFAULT");
  const defaultVolatility = classifyDefaultVolatility(
    defaultConstraint?.raw_expr as Record<string, unknown> | undefined,
  );
  return { ...EMPTY_FACTS, statementKind: "AddColumn", schema, table, column, defaultVolatility };
}

/** `AT_AddConstraint`: splits by the constraint's own `contype` into AddUniqueConstraint,
 * AddCheckConstraint and AddForeignKey (03-02-PLAN.md task 1). A constraint type this catalogue
 * does not name (e.g. `CONSTR_PRIMARY`, `CONSTR_EXCLUSION`) stays Unrecognized. */
function inspectAddConstraint(
  schema: string | null,
  table: string | null,
  cmd: { def?: unknown },
): StatementFacts {
  const constraint = (cmd.def as { Constraint?: Record<string, unknown> } | undefined)?.Constraint;
  if (!constraint) {
    return { ...EMPTY_FACTS, statementKind: "Unrecognized" };
  }
  const constraintName = (constraint.conname as string | undefined) ?? null;
  const notValid = Boolean(constraint.skip_validation);

  switch (constraint.contype) {
    case "CONSTR_UNIQUE":
      return {
        ...EMPTY_FACTS,
        statementKind: "AddUniqueConstraint",
        schema,
        table,
        constraintName,
        usingIndexName: (constraint.indexname as string | undefined) ?? null,
      };
    case "CONSTR_CHECK": {
      const { proves, column } = checkExpressionProvesNotNull(constraint.raw_expr);
      return {
        ...EMPTY_FACTS,
        statementKind: "AddCheckConstraint",
        schema,
        table,
        constraintName,
        notValid,
        checkProvesNotNull: proves,
        column,
      };
    }
    case "CONSTR_FOREIGN":
      return {
        ...EMPTY_FACTS,
        statementKind: "AddForeignKey",
        schema,
        table,
        constraintName,
        notValid,
      };
    default:
      return { ...EMPTY_FACTS, statementKind: "Unrecognized" };
  }
}

/** Discriminates one `AlterTableStmt` by its (first, see module header) subcommand's own
 * `subtype` -- an alter table that is really a column drop, a constraint add, etc. must reach
 * its own distinct StatementKind rather than one generic "alter table" bucket, so the floor and
 * the catalogue can each match the operation that actually occurred. */
function inspectAlterTableStmt(alterTableStmt: Record<string, unknown>): StatementFacts {
  const { schema, table } = readRangeVar(alterTableStmt.relation);
  const cmds = alterTableStmt.cmds as Array<{ AlterTableCmd?: Record<string, unknown> }> | undefined;
  const cmd = cmds?.[0]?.AlterTableCmd as { subtype?: string; name?: string; def?: unknown } | undefined;
  if (!cmd) {
    return { ...EMPTY_FACTS, statementKind: "Unrecognized" };
  }

  switch (cmd.subtype) {
    case "AT_AddColumn":
      return inspectAddColumn(schema, table, cmd);
    case "AT_SetNotNull":
      return { ...EMPTY_FACTS, statementKind: "SetNotNull", schema, table, column: cmd.name ?? null };
    case "AT_DropNotNull":
      return { ...EMPTY_FACTS, statementKind: "DropNotNull", schema, table, column: cmd.name ?? null };
    case "AT_AlterColumnType":
      return { ...EMPTY_FACTS, statementKind: "AlterColumnType", schema, table, column: cmd.name ?? null };
    case "AT_DropColumn":
      return { ...EMPTY_FACTS, statementKind: "DropColumn", schema, table, column: cmd.name ?? null };
    case "AT_AddConstraint":
      return inspectAddConstraint(schema, table, cmd);
    case "AT_DropConstraint":
      return {
        ...EMPTY_FACTS,
        statementKind: "DropConstraint",
        schema,
        table,
        constraintName: cmd.name ?? null,
      };
    case "AT_ValidateConstraint":
      return {
        ...EMPTY_FACTS,
        statementKind: "ValidateConstraint",
        schema,
        table,
        constraintName: cmd.name ?? null,
      };
    default:
      return { ...EMPTY_FACTS, statementKind: "Unrecognized" };
  }
}

/** Splits `DropStmt` by its own `removeType` into DropTable, DropSchema and DropIndex.
 * `DROP DATABASE` is NOT a `DropStmt` at all -- it parses to a distinct `DropdbStmt` node
 * (observed directly this session), handled separately below. */
function inspectDropStmt(dropStmt: Record<string, unknown>): StatementFacts {
  const target = (dropStmt.objects as unknown[] | undefined)?.[0];
  const { schema, name } = readQualifiedName(target);
  const concurrently = Boolean(dropStmt.concurrent);

  switch (dropStmt.removeType) {
    case "OBJECT_TABLE":
      return { ...EMPTY_FACTS, statementKind: "DropTable", schema, table: name };
    case "OBJECT_SCHEMA":
      // A schema name has no further qualifier of its own -- readQualifiedName's bare-String
      // branch returns it as `name` with `schema: null`; the schema being dropped IS that name.
      return { ...EMPTY_FACTS, statementKind: "DropSchema", schema: name };
    case "OBJECT_INDEX":
      return { ...EMPTY_FACTS, statementKind: "DropIndex", schema, indexName: name, concurrently };
    default:
      return { ...EMPTY_FACTS, statementKind: "Unrecognized" };
  }
}

/** `DROP DATABASE` -- its own AST node type (`DropdbStmt`), never a `DropStmt`. */
function inspectDropdbStmt(dropdbStmt: Record<string, unknown>): StatementFacts {
  return {
    ...EMPTY_FACTS,
    statementKind: "DropDatabase",
    // StatementFacts has no dedicated database-name field, and no rule in this catalogue ever
    // matches DropDatabase by name -- `table` is reused here purely as "the name of the object
    // being dropped" holder, documented rather than left unexplained.
    table: (dropdbStmt.dbname as string | undefined) ?? null,
  };
}

function inspectTruncateStmt(truncateStmt: Record<string, unknown>): StatementFacts {
  // Unlike a singular `relation` field (AlterTableStmt/DeleteStmt/UpdateStmt/IndexStmt/
  // CreateStmt, all read via readRangeVar directly), `relations` is an ARRAY field -- and every
  // array field in this AST wraps each element in its own node-type tag, so each entry here is
  // `{ RangeVar: {...} }`, not a bare RangeVar (observed directly this session; only the first
  // table is inspected for a multi-table TRUNCATE, matching this task's single-statement-fact
  // model).
  const relations = truncateStmt.relations as Array<{ RangeVar?: unknown }> | undefined;
  const { schema, table } = readRangeVar(relations?.[0]?.RangeVar);
  return { ...EMPTY_FACTS, statementKind: "Truncate", schema, table };
}

function inspectDeleteStmt(deleteStmt: Record<string, unknown>): StatementFacts {
  const { schema, table } = readRangeVar(deleteStmt.relation);
  return { ...EMPTY_FACTS, statementKind: "Delete", schema, table, hasWhereClause: "whereClause" in deleteStmt };
}

function inspectUpdateStmt(updateStmt: Record<string, unknown>): StatementFacts {
  const { schema, table } = readRangeVar(updateStmt.relation);
  return { ...EMPTY_FACTS, statementKind: "Update", schema, table, hasWhereClause: "whereClause" in updateStmt };
}

function inspectIndexStmt(indexStmt: Record<string, unknown>): StatementFacts {
  const { schema, table } = readRangeVar(indexStmt.relation);
  return {
    ...EMPTY_FACTS,
    statementKind: "CreateIndex",
    schema,
    table,
    indexName: (indexStmt.idxname as string | undefined) ?? null,
    concurrently: Boolean(indexStmt.concurrent),
  };
}

function inspectCreateStmt(createStmt: Record<string, unknown>): StatementFacts {
  const { schema, table } = readRangeVar(createStmt.relation);
  return { ...EMPTY_FACTS, statementKind: "CreateTable", schema, table };
}

function inspectRenameStmt(renameStmt: Record<string, unknown>): StatementFacts {
  const { schema, table } = readRangeVar(renameStmt.relation);
  switch (renameStmt.renameType) {
    case "OBJECT_COLUMN":
      return {
        ...EMPTY_FACTS,
        statementKind: "RenameColumn",
        schema,
        table,
        column: (renameStmt.subname as string | undefined) ?? null,
      };
    case "OBJECT_TABLE":
      return { ...EMPTY_FACTS, statementKind: "RenameTable", schema, table };
    default:
      return { ...EMPTY_FACTS, statementKind: "Unrecognized" };
  }
}

function inspectCommentStmt(commentStmt: Record<string, unknown>): StatementFacts {
  const { schema, name } = readQualifiedName(commentStmt.object);
  return { ...EMPTY_FACTS, statementKind: "CommentOn", schema, table: name };
}

/** See the module header's "DISCOVERED THIS SESSION" note: an `AlterEnumStmt` node that reaches
 * this function is always an `ADD VALUE` or `RENAME VALUE` -- PostgreSQL's own grammar rejects
 * `DROP VALUE` unconditionally at parse time, before any such node is ever constructed. Neither
 * ADD VALUE nor RENAME VALUE has a rule in this catalogue, so both are Unrecognized (REVIEW
 * REQUIRED via D-06) -- never a silent SAFE for an enum change this catalogue has no opinion
 * on. */
function inspectAlterEnumStmt(_alterEnumStmt: Record<string, unknown>): StatementFacts {
  return { ...EMPTY_FACTS, statementKind: "Unrecognized" };
}

/**
 * Reduces one parsed statement AST to StatementFacts (D-01). Built by dispatching on the
 * top-level node-type key and delegating to a per-statement-type function that spreads
 * EMPTY_FACTS and overrides only what that node actually carries, so every field the classifier
 * might match on is always present. Every StatementKind the FEATURES.md section 1 catalogue
 * needs is covered here except DoBlock, CreateFunction and ExecuteDynamic (plan 03-04's D-05
 * recursion). A statement kind, an AlterTableCmd subtype, or a constraint type this function
 * does not recognise resolves to statementKind "Unrecognized", which D-06 already sends to
 * REVIEW REQUIRED via the ordinary no-match path -- that is not a gap, it is D-06 working.
 */
export function inspectStatement(stmt: ParsedStatement): StatementFacts {
  if ("DropStmt" in stmt) {
    return inspectDropStmt(stmt.DropStmt as Record<string, unknown>);
  }
  if ("DropdbStmt" in stmt) {
    return inspectDropdbStmt(stmt.DropdbStmt as Record<string, unknown>);
  }
  if ("TruncateStmt" in stmt) {
    return inspectTruncateStmt(stmt.TruncateStmt as Record<string, unknown>);
  }
  if ("DeleteStmt" in stmt) {
    return inspectDeleteStmt(stmt.DeleteStmt as Record<string, unknown>);
  }
  if ("UpdateStmt" in stmt) {
    return inspectUpdateStmt(stmt.UpdateStmt as Record<string, unknown>);
  }
  if ("AlterTableStmt" in stmt) {
    return inspectAlterTableStmt(stmt.AlterTableStmt as Record<string, unknown>);
  }
  if ("IndexStmt" in stmt) {
    return inspectIndexStmt(stmt.IndexStmt as Record<string, unknown>);
  }
  if ("CreateStmt" in stmt) {
    return inspectCreateStmt(stmt.CreateStmt as Record<string, unknown>);
  }
  if ("RenameStmt" in stmt) {
    return inspectRenameStmt(stmt.RenameStmt as Record<string, unknown>);
  }
  if ("CommentStmt" in stmt) {
    return inspectCommentStmt(stmt.CommentStmt as Record<string, unknown>);
  }
  if ("AlterEnumStmt" in stmt) {
    return inspectAlterEnumStmt(stmt.AlterEnumStmt as Record<string, unknown>);
  }

  return { ...EMPTY_FACTS, statementKind: "Unrecognized" };
}
