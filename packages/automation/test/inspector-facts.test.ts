// 03-02-PLAN.md Task 1: the full fact vocabulary the inspector can observe about a statement.
// Table-driven: one row per behaviour, each a short real SQL string parsed through the real
// PostgreSQL grammar (libpg-query) and asserted against the exact expected fact subset -- never
// against a hand-built AST (D10, D-01).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  classifyDefaultVolatility,
  KNOWN_STABLE_FUNCTIONS,
  KNOWN_VOLATILE_FUNCTIONS,
} from "../src/inspector/function-volatility";
import { inspectStatement, parseTopLevel } from "../src/inspector/inspect";
import type { StatementFacts, StatementKind } from "../src/types";

/** Parses a single top-level statement and reduces it to facts -- the shape every row below
 * exercises. */
async function factsFor(sql: string): Promise<StatementFacts> {
  const [stmt] = await parseTopLevel(sql);
  return inspectStatement(stmt);
}

interface Row {
  name: string;
  sql: string;
  expected: Partial<StatementFacts>;
}

const rows: Row[] = [
  // --- AddColumn / defaultVolatility (ANLZ-04's central distinction) ---
  {
    name: "ADD COLUMN with no default yields defaultVolatility none",
    sql: "ALTER TABLE t ADD COLUMN c text",
    expected: { statementKind: "AddColumn", table: "t", column: "c", defaultVolatility: "none" },
  },
  {
    name: "ADD COLUMN DEFAULT now() yields defaultVolatility stable",
    sql: "ALTER TABLE t ADD COLUMN c timestamptz DEFAULT now()",
    expected: { statementKind: "AddColumn", table: "t", column: "c", defaultVolatility: "stable" },
  },
  {
    name: "ADD COLUMN DEFAULT clock_timestamp() yields defaultVolatility volatile",
    sql: "ALTER TABLE t ADD COLUMN c timestamptz DEFAULT clock_timestamp()",
    expected: { statementKind: "AddColumn", table: "t", column: "c", defaultVolatility: "volatile" },
  },
  {
    name: "ADD COLUMN DEFAULT gen_random_uuid() yields defaultVolatility volatile",
    sql: "ALTER TABLE t ADD COLUMN c uuid DEFAULT gen_random_uuid()",
    expected: { statementKind: "AddColumn", table: "t", column: "c", defaultVolatility: "volatile" },
  },
  {
    name: "ADD COLUMN DEFAULT 'x' (string literal) yields defaultVolatility literal",
    sql: "ALTER TABLE t ADD COLUMN c text DEFAULT 'x'",
    expected: { statementKind: "AddColumn", table: "t", column: "c", defaultVolatility: "literal" },
  },
  {
    name: "ADD COLUMN DEFAULT 5 (numeric literal) yields defaultVolatility literal",
    sql: "ALTER TABLE t ADD COLUMN c integer DEFAULT 5",
    expected: { statementKind: "AddColumn", table: "t", column: "c", defaultVolatility: "literal" },
  },
  {
    name: "ADD COLUMN DEFAULT naming an unrecognised function yields defaultVolatility unknown-function",
    sql: "ALTER TABLE t ADD COLUMN c text DEFAULT my_custom_fn()",
    expected: {
      statementKind: "AddColumn",
      table: "t",
      column: "c",
      defaultVolatility: "unknown-function",
    },
  },

  // --- CreateIndex / concurrently ---
  {
    name: "CREATE INDEX CONCURRENTLY yields CreateIndex with concurrently true and indexName",
    sql: "CREATE INDEX CONCURRENTLY idx ON t (c)",
    expected: { statementKind: "CreateIndex", table: "t", indexName: "idx", concurrently: true },
  },
  {
    name: "CREATE INDEX without CONCURRENTLY yields concurrently false",
    sql: "CREATE INDEX idx ON t (c)",
    expected: { statementKind: "CreateIndex", table: "t", indexName: "idx", concurrently: false },
  },

  // --- DropIndex / concurrently ---
  {
    name: "DROP INDEX CONCURRENTLY yields DropIndex with concurrently true",
    sql: "DROP INDEX CONCURRENTLY idx",
    expected: { statementKind: "DropIndex", indexName: "idx", concurrently: true },
  },
  {
    name: "DROP INDEX without CONCURRENTLY yields concurrently false",
    sql: "DROP INDEX idx",
    expected: { statementKind: "DropIndex", indexName: "idx", concurrently: false },
  },

  // --- AddForeignKey / notValid ---
  {
    name: "an added foreign key declared unvalidated yields AddForeignKey notValid true with constraint name",
    sql: "ALTER TABLE t ADD CONSTRAINT fk FOREIGN KEY (c) REFERENCES other(id) NOT VALID",
    expected: { statementKind: "AddForeignKey", table: "t", constraintName: "fk", notValid: true },
  },
  {
    name: "a plainly added foreign key yields AddForeignKey notValid false",
    sql: "ALTER TABLE t ADD CONSTRAINT fk FOREIGN KEY (c) REFERENCES other(id)",
    expected: { statementKind: "AddForeignKey", table: "t", constraintName: "fk", notValid: false },
  },

  // --- AddCheckConstraint / checkProvesNotNull ---
  {
    name: "a single-column IS NOT NULL check constraint yields checkProvesNotNull true and the column",
    sql: "ALTER TABLE t ADD CONSTRAINT chk CHECK (c IS NOT NULL)",
    expected: {
      statementKind: "AddCheckConstraint",
      table: "t",
      constraintName: "chk",
      checkProvesNotNull: true,
      column: "c",
    },
  },
  {
    name: "a check constraint of any other form yields checkProvesNotNull false",
    sql: "ALTER TABLE t ADD CONSTRAINT chk CHECK (c > 0)",
    expected: {
      statementKind: "AddCheckConstraint",
      table: "t",
      constraintName: "chk",
      checkProvesNotNull: false,
      column: null,
    },
  },
  {
    name: "NOT VALID on a check constraint sets notValid true",
    sql: "ALTER TABLE t ADD CONSTRAINT chk CHECK (c IS NOT NULL) NOT VALID",
    expected: {
      statementKind: "AddCheckConstraint",
      table: "t",
      constraintName: "chk",
      notValid: true,
      checkProvesNotNull: true,
      column: "c",
    },
  },

  // --- AddUniqueConstraint / usingIndexName ---
  {
    name: "an added unique constraint attached to an existing index yields usingIndexName set to it",
    sql: "ALTER TABLE t ADD CONSTRAINT t_c_uniq UNIQUE USING INDEX idx",
    expected: {
      statementKind: "AddUniqueConstraint",
      table: "t",
      constraintName: "t_c_uniq",
      usingIndexName: "idx",
    },
  },
  {
    name: "a plainly added unique constraint yields usingIndexName null",
    sql: "ALTER TABLE t ADD CONSTRAINT t_c_uniq UNIQUE (c)",
    expected: {
      statementKind: "AddUniqueConstraint",
      table: "t",
      constraintName: "t_c_uniq",
      usingIndexName: null,
    },
  },

  // --- Delete/Update / hasWhereClause ---
  {
    name: "a DELETE with no WHERE clause yields hasWhereClause false",
    sql: "DELETE FROM t",
    expected: { statementKind: "Delete", table: "t", hasWhereClause: false },
  },
  {
    name: "a DELETE with a WHERE clause yields hasWhereClause true",
    sql: "DELETE FROM t WHERE id = 1",
    expected: { statementKind: "Delete", table: "t", hasWhereClause: true },
  },
  {
    name: "an UPDATE with no WHERE clause yields hasWhereClause false",
    sql: "UPDATE t SET c = 1",
    expected: { statementKind: "Update", table: "t", hasWhereClause: false },
  },
  {
    name: "an UPDATE with a WHERE clause yields hasWhereClause true",
    sql: "UPDATE t SET c = 1 WHERE id = 1",
    expected: { statementKind: "Update", table: "t", hasWhereClause: true },
  },

  // --- The rest of the D-04 catalogue's statement kinds, each reachable via real SQL ---
  { name: "DROP TABLE yields DropTable", sql: "DROP TABLE t", expected: { statementKind: "DropTable", table: "t" } },
  {
    name: "DROP SCHEMA yields DropSchema",
    sql: "DROP SCHEMA s",
    expected: { statementKind: "DropSchema", schema: "s" },
  },
  {
    name: "DROP DATABASE yields DropDatabase (its own AST node, DropdbStmt, not DropStmt)",
    sql: "DROP DATABASE d",
    expected: { statementKind: "DropDatabase" },
  },
  { name: "TRUNCATE yields Truncate", sql: "TRUNCATE t", expected: { statementKind: "Truncate", table: "t" } },
  {
    name: "an alter-table statement that removes a column yields DropColumn, not a generic alter kind",
    sql: "ALTER TABLE t DROP COLUMN c",
    expected: { statementKind: "DropColumn", table: "t", column: "c" },
  },
  {
    name: "SET NOT NULL yields SetNotNull",
    sql: "ALTER TABLE t ALTER COLUMN c SET NOT NULL",
    expected: { statementKind: "SetNotNull", table: "t", column: "c" },
  },
  {
    name: "DROP NOT NULL yields DropNotNull",
    sql: "ALTER TABLE t ALTER COLUMN c DROP NOT NULL",
    expected: { statementKind: "DropNotNull", table: "t", column: "c" },
  },
  {
    name: "ALTER COLUMN TYPE yields AlterColumnType",
    sql: "ALTER TABLE t ALTER COLUMN c TYPE integer",
    expected: { statementKind: "AlterColumnType", table: "t", column: "c" },
  },
  {
    name: "DROP CONSTRAINT yields DropConstraint",
    sql: "ALTER TABLE t DROP CONSTRAINT chk",
    expected: { statementKind: "DropConstraint", table: "t", constraintName: "chk" },
  },
  {
    name: "VALIDATE CONSTRAINT yields ValidateConstraint",
    sql: "ALTER TABLE t VALIDATE CONSTRAINT chk",
    expected: { statementKind: "ValidateConstraint", table: "t", constraintName: "chk" },
  },
  {
    name: "RENAME COLUMN yields RenameColumn",
    sql: "ALTER TABLE t RENAME COLUMN c TO d",
    expected: { statementKind: "RenameColumn", table: "t", column: "c" },
  },
  {
    name: "RENAME TO (table) yields RenameTable",
    sql: "ALTER TABLE t RENAME TO t2",
    expected: { statementKind: "RenameTable", table: "t" },
  },
  { name: "CREATE TABLE yields CreateTable", sql: "CREATE TABLE t (id int)", expected: { statementKind: "CreateTable", table: "t" } },
  {
    name: "COMMENT ON yields CommentOn",
    sql: "COMMENT ON TABLE t IS 'hi'",
    expected: { statementKind: "CommentOn", table: "t" },
  },

  // --- Identifier quoting: information, not noise (03-02-PLAN.md task 1) ---
  {
    name: "an unquoted table name folds to lower case",
    sql: "DROP TABLE Foo",
    expected: { statementKind: "DropTable", table: "foo" },
  },
  {
    name: "the same name double-quoted preserves its exact case",
    sql: 'DROP TABLE "Foo"',
    expected: { statementKind: "DropTable", table: "Foo" },
  },
  {
    name: "a schema-qualified name splits into schema and table",
    sql: "DROP TABLE myschema.foo",
    expected: { statementKind: "DropTable", schema: "myschema", table: "foo" },
  },

  // --- Unrecognized: a statement kind the inspector does not (yet) name ---
  {
    name: "a statement kind the inspector does not recognise yields Unrecognized with neutral defaults",
    sql: "SELECT 1",
    expected: {
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
    },
  },
];

describe("inspector facts (03-02-PLAN.md task 1, ANLZ-02/ANLZ-04)", () => {
  it.each(rows.map((row): [string, Row] => [row.name, row]))("%s", async (_name, row) => {
    const facts = await factsFor(row.sql);
    expect(facts).toMatchObject(row.expected);
  });

  it("classifyDefaultVolatility distinguishes now() (stable) from clock_timestamp() (volatile) in the same case", async () => {
    const nowFacts = await factsFor("ALTER TABLE t ADD COLUMN c timestamptz DEFAULT now()");
    const clockFacts = await factsFor("ALTER TABLE t ADD COLUMN c timestamptz DEFAULT clock_timestamp()");
    expect(nowFacts.defaultVolatility).toBe("stable");
    expect(clockFacts.defaultVolatility).toBe("volatile");
    expect(nowFacts.defaultVolatility).not.toBe(clockFacts.defaultVolatility);
  });

  it("KNOWN_STABLE_FUNCTIONS contains now, and KNOWN_VOLATILE_FUNCTIONS does not", () => {
    expect(KNOWN_STABLE_FUNCTIONS.has("now")).toBe(true);
    expect(KNOWN_VOLATILE_FUNCTIONS.has("now")).toBe(false);
  });

  it("classifyDefaultVolatility(undefined) (no default at all) yields none", () => {
    expect(classifyDefaultVolatility(undefined)).toBe("none");
  });

  it("the header comment of function-volatility.ts cites postgresql.org and states the curated/unknown-function contract", () => {
    const sourcePath = fileURLToPath(new URL("../src/inspector/function-volatility.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");
    expect(source).toContain("postgresql.org");
    expect(source).toContain("curated starting point");
    expect(source).toContain("unknown-function");
  });

  it("the unquoted and double-quoted spellings of one table name still match the same statementKind, never a different rule surface", async () => {
    const unquoted = await factsFor("DROP TABLE Foo");
    const quoted = await factsFor('DROP TABLE "Foo"');
    expect(unquoted.statementKind).toBe(quoted.statementKind);
    expect(unquoted.table).not.toBe(quoted.table);
  });

  // 03-CONTEXT.md D-05: DoBlock, CreateFunction and ExecuteDynamic are plan 03-04's job, not
  // this plan's. AlterTypeDropValue stays in StatementKind/rules.json as documentation of
  // FEATURES.md's BLOCKED catalogue entry, but PostgreSQL's own grammar rejects
  // `ALTER TYPE ... DROP VALUE` unconditionally at parse time ("dropping an enum value is not
  // implemented", gram.y) -- confirmed live against the installed libpg-query@17.7.4 parser this
  // session -- so no real SQL text can ever produce it. Asserting it here against a hand-built
  // AST would violate this plan's own "asserted against real parser output, never a hand-built
  // AST" instruction; excluding it is the honest choice, not a shortcut.
  const NOT_EXERCISED_THIS_PLAN: StatementKind[] = [
    "EmptyInput",
    "DoBlock",
    "CreateFunction",
    "ExecuteDynamic",
    "AlterTypeDropValue",
  ];

  const ALL_STATEMENT_KINDS: StatementKind[] = [
    "EmptyInput",
    "DropTable",
    "DropSchema",
    "DropDatabase",
    "Truncate",
    "DropColumn",
    "Delete",
    "Update",
    "CreateTable",
    "AddColumn",
    "SetNotNull",
    "DropNotNull",
    "AlterColumnType",
    "AddUniqueConstraint",
    "AddCheckConstraint",
    "AddForeignKey",
    "DropConstraint",
    "ValidateConstraint",
    "CreateIndex",
    "DropIndex",
    "RenameColumn",
    "RenameTable",
    "AlterTypeDropValue",
    "CommentOn",
    "DoBlock",
    "CreateFunction",
    "ExecuteDynamic",
    "Unrecognized",
  ];

  it("every StatementKind except EmptyInput/DoBlock/CreateFunction/ExecuteDynamic/AlterTypeDropValue is produced by at least one row above", async () => {
    const produced = new Set<StatementKind>();
    for (const row of rows) {
      const facts = await factsFor(row.sql);
      produced.add(facts.statementKind);
    }

    const requiredKinds = ALL_STATEMENT_KINDS.filter(
      (kind) => !NOT_EXERCISED_THIS_PLAN.includes(kind),
    );
    for (const kind of requiredKinds) {
      expect(produced.has(kind), `expected at least one row to produce statementKind ${kind}`).toBe(true);
    }
  });

  it("ALTER TYPE ... DROP VALUE is rejected by the real parser, confirming AlterTypeDropValue is unreachable via real SQL text", async () => {
    await expect(parseTopLevel("ALTER TYPE mood DROP VALUE 'sad'")).rejects.toThrow(
      /dropping an enum value is not implemented/i,
    );
  });
});
