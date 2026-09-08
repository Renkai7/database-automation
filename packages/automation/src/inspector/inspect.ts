// ANLZ-01/D-11: reduces raw SQL text to a real PostgreSQL AST (via libpg-query, never regex --
// D10) and then reduces each parsed statement to the flat StatementFacts vocabulary D-01
// requires. A separate module rather than inline code in analyze.ts, deliberately: the same
// property scripts/verify-migration-state.ts and scripts/backup-manifest.ts already establish
// in this repo -- no module-load side effects, no filesystem, no database, no process.env --
// so a test can import parseTopLevel/inspectStatement directly and exercise both the passing
// and the failing direction without standing up anything.
//
// Scope: every StatementKind the FEATURES.md section 1 catalogue needs, including DoBlock and
// CreateFunction (plan 03-04's D-05 PL/pgSQL recursion owns what happens INSIDE those bodies --
// see src/inspector/inspect-plpgsql.ts -- but inspectStatement itself recognises the container
// node whether it is encountered at the top level or, recursively, nested inside another body).
// ExecuteDynamic is never produced here: a dynamic EXECUTE only exists inside a PL/pgSQL body,
// which this module never parses (parseTopLevel handles ordinary top-level SQL only) --
// inspect-plpgsql.ts's own traversal is where that fact set is synthesised. A statement kind the
// inspector does not recognise -- or an AlterTableStmt subcommand/constraint type outside this
// catalogue -- resolves to "Unrecognized", which D-06 already sends to REVIEW REQUIRED via the
// ordinary no-match path. That is not a gap; it is D-06 working.
//
// CR-02 FIX (03-REVIEW.md): an ALTER TABLE statement with more than one subcommand (PostgreSQL's
// own grammar allows `ALTER TABLE t sub1, sub2, ...`) previously had only its FIRST subcommand
// inspected -- every later subcommand was silently discarded before it ever reached
// StatementFacts, classifyFacts, or the D-02 floor, which is exactly the "a statement is
// silently skipped rather than classified" failure shape this analyzer exists to prevent (this
// system's own threat model is "an AI agent writes SQL by hand," not only "SQL drizzle-kit
// generated," so a hand-written multi-subcommand ALTER TABLE is not a theoretical input).
// inspectAlterTableStmt now returns one StatementFacts PER subcommand (inspectStatement's
// return type is StatementFacts[] for exactly this reason -- every other statement kind still
// returns a single-element array), and every caller (analyze.ts's inspectAndClassifyStatement,
// inspect-plpgsql.ts's inspectParsedStatement) turns each one into its own Finding, so D-10's
// "complete findings list, worst verdict wins" applies across subcommands too.
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
  // libpg-query 18.x (pg18 line) ships real @pgsql/types typings where `stmts` and each
  // entry's `stmt` are optional; the 17.x line returned `any`. Only `stmts` is consumed here,
  // so describe just that, and cast through unknown rather than widen ParsedStatement.
  let result: { version?: number; stmts?: Array<{ stmt?: ParsedStatement }> };
  try {
    result = (await parse(sql)) as unknown as typeof result;
  } catch (error) {
    const cursorPosition = (error as { sqlDetails?: { cursorPosition?: number } }).sqlDetails
      ?.cursorPosition;
    const message =
      cursorPosition === undefined
        ? safeErrorMessage(error)
        : `${safeErrorMessage(error)} (at character ${cursorPosition})`;
    throw new AnalyzerParseError(message);
  }
  // A missing `stmts` degrades to zero statements, which analyze.ts classifies REVIEW_REQUIRED
  // via its empty-input branch -- never SAFE, so the default is fail-safe.
  //
  // An entry that is PRESENT but carries no `stmt` is a different matter: silently dropping it
  // would remove a real statement from classification, which is the one direction this analyzer
  // must never fail in. Treat it as a parse failure instead (D-08) so it can never pass as SAFE.
  return (result.stmts ?? []).map((entry, index) => {
    if (entry.stmt === undefined) {
      throw new AnalyzerParseError(
        `statement at index ${index} parsed to an empty node; refusing to classify it`,
      );
    }
    return entry.stmt;
  });
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

/** Discriminates one `AlterTableCmd` subcommand by its own `subtype` -- an alter table that is
 * really a column drop, a constraint add, etc. must reach its own distinct StatementKind rather
 * than one generic "alter table" bucket, so the floor and the catalogue can each match the
 * operation that actually occurred. `cmd` is `undefined` only defensively (a cmds entry with no
 * AlterTableCmd wrapper is not observed in real parser output). */
function inspectOneAlterTableCmd(
  schema: string | null,
  table: string | null,
  cmd: { subtype?: string; name?: string; def?: unknown } | undefined,
): StatementFacts {
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

/** CR-02 fix: an `AlterTableStmt` carries an ARRAY of subcommands (PostgreSQL's own grammar
 * allows `ALTER TABLE t sub1, sub2, ...`), and every one of them is a real, independently
 * dangerous (or safe) operation -- inspecting only `cmds[0]` silently discarded every later
 * subcommand before it ever reached classification. Returns one StatementFacts per subcommand,
 * in `cmds` order, so the caller (inspectStatement) can turn each into its own Finding rather
 * than reporting only a fraction of what the statement does. A statement with no cmds at all
 * (defensive; not observed in real parser output) yields a single Unrecognized fact set rather
 * than an empty array, so every AlterTableStmt still produces at least one finding. */
function inspectAlterTableStmt(alterTableStmt: Record<string, unknown>): StatementFacts[] {
  const { schema, table } = readRangeVar(alterTableStmt.relation);
  const cmds = alterTableStmt.cmds as Array<{ AlterTableCmd?: Record<string, unknown> }> | undefined;
  if (!cmds || cmds.length === 0) {
    return [{ ...EMPTY_FACTS, statementKind: "Unrecognized" }];
  }

  return cmds.map((cmdWrapper) =>
    inspectOneAlterTableCmd(
      schema,
      table,
      cmdWrapper.AlterTableCmd as { subtype?: string; name?: string; def?: unknown } | undefined,
    ),
  );
}

/** Splits `DropStmt` by its own `removeType` into DropTable, DropSchema and DropIndex.
 * `DROP DATABASE` is NOT a `DropStmt` at all -- it parses to a distinct `DropdbStmt` node
 * (observed directly this session), handled separately below.
 *
 * WR-01 FIX (04-REVIEW.md): PostgreSQL's own grammar allows a single `DROP` statement to name
 * MORE than one object (`DROP TABLE a, b;`, `DROP SCHEMA a, b;`, `DROP INDEX a, b;`) -- the exact
 * multi-object bug shape CR-02 already fixed for `AlterTableStmt.cmds`. Reading only
 * `dropStmt.objects[0]` silently discarded every object after the first before it ever became its
 * own `StatementFacts`/`Finding`. Returns one `StatementFacts` PER object, in `objects` order,
 * mirroring `inspectAlterTableStmt`'s fan-out -- a `DropStmt` with no objects at all (defensive;
 * not observed in real parser output) yields a single Unrecognized fact set rather than an empty
 * array, so every DropStmt still produces at least one finding. */
function inspectDropStmt(dropStmt: Record<string, unknown>): StatementFacts[] {
  const objects = (dropStmt.objects as unknown[] | undefined) ?? [];
  const concurrently = Boolean(dropStmt.concurrent);

  if (objects.length === 0) {
    return [{ ...EMPTY_FACTS, statementKind: "Unrecognized" }];
  }

  return objects.map((target) => {
    const { schema, name } = readQualifiedName(target);

    switch (dropStmt.removeType) {
      case "OBJECT_TABLE":
        return { ...EMPTY_FACTS, statementKind: "DropTable", schema, table: name };
      case "OBJECT_SCHEMA":
        // A schema name has no further qualifier of its own -- readQualifiedName's bare-String
        // branch returns it as `name` with `schema: null`; the schema being dropped IS that name.
        return { ...EMPTY_FACTS, statementKind: "DropSchema", schema: name };
      case "OBJECT_INDEX":
        // D-10: DROP INDEX CONCURRENTLY is transaction-hostile the same way CREATE INDEX
        // CONCURRENTLY is -- derived from the same `concurrent` flag read above, never a second
        // independent check.
        return {
          ...EMPTY_FACTS,
          statementKind: "DropIndex",
          schema,
          indexName: name,
          concurrently,
          transactionHostile: concurrently,
        };
      default:
        return { ...EMPTY_FACTS, statementKind: "Unrecognized" };
    }
  });
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
  const concurrently = Boolean(indexStmt.concurrent);
  return {
    ...EMPTY_FACTS,
    statementKind: "CreateIndex",
    schema,
    table,
    indexName: (indexStmt.idxname as string | undefined) ?? null,
    concurrently,
    // D-10: CREATE INDEX CONCURRENTLY is the one CreateIndex form PostgreSQL forbids inside a
    // transaction block -- derived from the same `concurrent` flag already read above, never a
    // second independent check.
    transactionHostile: concurrently,
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

/** D-10: `VACUUM`/`VACUUM ANALYZE` -- always transaction-hostile (PostgreSQL rejects it inside a
 * transaction block unconditionally). `rels[0].VacuumRelation.relation.relname` is read into
 * `table` when a specific table was named (a bare `VACUUM;` with no table has no `rels` key at
 * all -- read this session). */
function inspectVacuumStmt(vacuumStmt: Record<string, unknown>): StatementFacts {
  const rels = vacuumStmt.rels as Array<{ VacuumRelation?: { relation?: unknown } }> | undefined;
  const { table } = readRangeVar(rels?.[0]?.VacuumRelation?.relation);
  return { ...EMPTY_FACTS, statementKind: "Vacuum", table, transactionHostile: true };
}

/** D-17's shared GUC-disarm test, used by `VariableSetStmt` directly and by the `setstmt` node
 * nested inside `AlterSystemStmt`/`AlterDatabaseSetStmt`/`AlterRoleSetStmt` (all four wrap the
 * identical shape, verified live this session). `kind: "VAR_RESET_ALL"` disarms unconditionally,
 * with NO name check at all (Pitfall 4, 04-RESEARCH.md) -- that node carries no `name` field, and
 * resetting everything resets both timeouts. For every other kind (`VAR_SET_VALUE`,
 * `VAR_SET_DEFAULT`, `VAR_RESET`), disarming depends only on `name` being `lock_timeout` or
 * `statement_timeout` -- `is_local` (the `SET LOCAL` form) never changes the answer. */
function setstmtDisarmsTimeout(setstmt: { kind?: string; name?: string } | undefined): boolean {
  if (!setstmt) {
    return false;
  }
  if (setstmt.kind === "VAR_RESET_ALL") {
    return true;
  }
  return setstmt.name === "lock_timeout" || setstmt.name === "statement_timeout";
}

/** D-17: `ALTER SYSTEM SET`/`ALTER SYSTEM RESET` -- always transaction-hostile (PostgreSQL
 * rejects it inside a transaction block unconditionally); `disarmsTimeout` from its own
 * `setstmt` via the shared helper above. */
function inspectAlterSystemStmt(alterSystemStmt: Record<string, unknown>): StatementFacts {
  const setstmt = alterSystemStmt.setstmt as { kind?: string; name?: string } | undefined;
  return {
    ...EMPTY_FACTS,
    statementKind: "AlterSystem",
    transactionHostile: true,
    disarmsTimeout: setstmtDisarmsTimeout(setstmt),
  };
}

/** D-10: `CREATE DATABASE` -- always transaction-hostile. */
function inspectCreatedbStmt(_createdbStmt: Record<string, unknown>): StatementFacts {
  return { ...EMPTY_FACTS, statementKind: "CreateDatabase", transactionHostile: true };
}

/** D-10: `REINDEX` -- transaction-hostile only when `CONCURRENTLY` is present. The `params` key
 * is absent ENTIRELY for a plain `REINDEX` (verified live this session, not an empty array), so
 * this guards for undefined rather than checking array length. */
function inspectReindexStmt(reindexStmt: Record<string, unknown>): StatementFacts {
  const params = reindexStmt.params as Array<{ DefElem?: { defname?: string } }> | undefined;
  const concurrently = (params ?? []).some((entry) => entry.DefElem?.defname === "concurrently");
  return {
    ...EMPTY_FACTS,
    statementKind: "Reindex",
    concurrently,
    transactionHostile: concurrently,
  };
}

/** D-17: `SET`/`SET LOCAL`/`SET ... TO DEFAULT`/`RESET`/`RESET ALL` -- never transaction-hostile
 * on its own (a `VariableSetStmt` is not one of the six statement kinds D-10 names); its only
 * observable fact here is `disarmsTimeout`, via the shared helper above. */
function inspectVariableSetStmt(variableSetStmt: Record<string, unknown>): StatementFacts {
  const setstmt = variableSetStmt as { kind?: string; name?: string };
  return { ...EMPTY_FACTS, statementKind: "SetGuc", disarmsTimeout: setstmtDisarmsTimeout(setstmt) };
}

/** D-17: `ALTER DATABASE ... SET` -- wraps the identical `setstmt` shape `VariableSetStmt` uses
 * (verified live this session); this form persists beyond the migration's own session, which is
 * why it is covered by the same disarm rule rather than left as a gap (04-CONTEXT.md's deferred
 * discretion item, resolved via Task 2's checkpoint decision). */
function inspectAlterDatabaseSetStmt(alterDatabaseSetStmt: Record<string, unknown>): StatementFacts {
  const setstmt = alterDatabaseSetStmt.setstmt as { kind?: string; name?: string } | undefined;
  return { ...EMPTY_FACTS, statementKind: "AlterDatabaseSet", disarmsTimeout: setstmtDisarmsTimeout(setstmt) };
}

/** D-17: `ALTER ROLE ... SET` -- wraps the identical `setstmt` shape `VariableSetStmt` uses
 * (verified live this session); same reasoning as `AlterDatabaseSetStmt` above. */
function inspectAlterRoleSetStmt(alterRoleSetStmt: Record<string, unknown>): StatementFacts {
  const setstmt = alterRoleSetStmt.setstmt as { kind?: string; name?: string } | undefined;
  return { ...EMPTY_FACTS, statementKind: "AlterRoleSet", disarmsTimeout: setstmtDisarmsTimeout(setstmt) };
}

/**
 * Reduces one parsed statement AST to StatementFacts (D-01). Built by dispatching on the
 * top-level node-type key and delegating to a per-statement-type function that spreads
 * EMPTY_FACTS and overrides only what that node actually carries, so every field the classifier
 * might match on is always present. Every StatementKind the FEATURES.md section 1 catalogue
 * needs is covered here, including DoBlock and CreateFunction -- a DO block or function creation
 * always earns its OWN container fact set here, whether this function is called on a top-level
 * statement (analyze.ts) or, recursively, on a statement re-parsed out of another body's
 * embedded SQL text (inspect-plpgsql.ts). What is INSIDE that body is a separate concern D-05's
 * recursion owns, not this function's. A statement kind, an AlterTableCmd subtype, or a
 * constraint type this function does not recognise resolves to statementKind "Unrecognized",
 * which D-06 already sends to REVIEW REQUIRED via the ordinary no-match path -- that is not a
 * gap, it is D-06 working.
 *
 * CR-02/WR-01 fix: returns StatementFacts[], not a single StatementFacts. Most statement kinds
 * always produce exactly one entry -- AlterTableStmt produces one entry per subcommand (see
 * inspectAlterTableStmt) and DropStmt produces one entry per named object (see inspectDropStmt),
 * because PostgreSQL's own grammar allows both a single ALTER TABLE and a single DROP to carry
 * more than one independently dangerous (or safe) target, and every one of them must reach its
 * own Finding rather than only the first.
 */
export function inspectStatement(stmt: ParsedStatement): StatementFacts[] {
  if ("DropStmt" in stmt) {
    return inspectDropStmt(stmt.DropStmt as Record<string, unknown>);
  }
  if ("DropdbStmt" in stmt) {
    return [inspectDropdbStmt(stmt.DropdbStmt as Record<string, unknown>)];
  }
  if ("TruncateStmt" in stmt) {
    return [inspectTruncateStmt(stmt.TruncateStmt as Record<string, unknown>)];
  }
  if ("DeleteStmt" in stmt) {
    return [inspectDeleteStmt(stmt.DeleteStmt as Record<string, unknown>)];
  }
  if ("UpdateStmt" in stmt) {
    return [inspectUpdateStmt(stmt.UpdateStmt as Record<string, unknown>)];
  }
  if ("AlterTableStmt" in stmt) {
    return inspectAlterTableStmt(stmt.AlterTableStmt as Record<string, unknown>);
  }
  if ("IndexStmt" in stmt) {
    return [inspectIndexStmt(stmt.IndexStmt as Record<string, unknown>)];
  }
  if ("CreateStmt" in stmt) {
    return [inspectCreateStmt(stmt.CreateStmt as Record<string, unknown>)];
  }
  if ("RenameStmt" in stmt) {
    return [inspectRenameStmt(stmt.RenameStmt as Record<string, unknown>)];
  }
  if ("CommentStmt" in stmt) {
    return [inspectCommentStmt(stmt.CommentStmt as Record<string, unknown>)];
  }
  if ("AlterEnumStmt" in stmt) {
    return [inspectAlterEnumStmt(stmt.AlterEnumStmt as Record<string, unknown>)];
  }
  // D-10/D-17 (04-CONTEXT.md): seven statement kinds the inspector had never named before this
  // phase -- each resolved to "Unrecognized" (REVIEW_REQUIRED via D-06's default) until now.
  if ("VacuumStmt" in stmt) {
    return [inspectVacuumStmt(stmt.VacuumStmt as Record<string, unknown>)];
  }
  if ("AlterSystemStmt" in stmt) {
    return [inspectAlterSystemStmt(stmt.AlterSystemStmt as Record<string, unknown>)];
  }
  if ("CreatedbStmt" in stmt) {
    return [inspectCreatedbStmt(stmt.CreatedbStmt as Record<string, unknown>)];
  }
  if ("ReindexStmt" in stmt) {
    return [inspectReindexStmt(stmt.ReindexStmt as Record<string, unknown>)];
  }
  if ("VariableSetStmt" in stmt) {
    return [inspectVariableSetStmt(stmt.VariableSetStmt as Record<string, unknown>)];
  }
  if ("AlterDatabaseSetStmt" in stmt) {
    return [inspectAlterDatabaseSetStmt(stmt.AlterDatabaseSetStmt as Record<string, unknown>)];
  }
  if ("AlterRoleSetStmt" in stmt) {
    return [inspectAlterRoleSetStmt(stmt.AlterRoleSetStmt as Record<string, unknown>)];
  }
  // D-05 (plan 03-04): the container statement's own fact set. No schema/table/column -- a DO
  // block and a function creation are not scoped to a single relation the way every other
  // statement kind here is. Whether this container's body gets recursed into at all (and what
  // happens to the findings if it does) is analyze.ts's/inspect-plpgsql.ts's job, not this
  // function's -- inspectStatement only ever answers "what statement is this," never "what does
  // its body contain."
  if ("DoStmt" in stmt) {
    return [{ ...EMPTY_FACTS, statementKind: "DoBlock" }];
  }
  if ("CreateFunctionStmt" in stmt) {
    return [{ ...EMPTY_FACTS, statementKind: "CreateFunction" }];
  }

  return [{ ...EMPTY_FACTS, statementKind: "Unrecognized" }];
}
