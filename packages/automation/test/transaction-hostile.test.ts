// 04-02-PLAN.md Task 1: the seven statement kinds the inspector had never named, and the two
// facts they carry -- `transactionHostile` (D-10) and `disarmsTimeout` (D-17). Table-driven, one
// row per <behavior> bullet, each a short real SQL string parsed through the real PostgreSQL
// grammar (libpg-query) and asserted against the exact expected fact subset -- never against a
// hand-built AST (D10, D-01), matching test/inspector-facts.test.ts's own established style.
import { describe, expect, it } from "vitest";
import { loadDefaultRules } from "../src/adapter/default-rules";
import { analyzeSql } from "../src/analyze";
import { inspectStatement, parseTopLevel } from "../src/inspector/inspect";
import type { StatementFacts } from "../src/types";

/** Parses a single top-level statement and reduces it to facts -- every row below is a
 * single-statement, single-subcommand fixture, so inspectStatement's StatementFacts[] always has
 * exactly one entry. */
async function factsFor(sql: string): Promise<StatementFacts> {
  const [stmt] = await parseTopLevel(sql);
  return inspectStatement(stmt)[0];
}

interface Row {
  name: string;
  sql: string;
  expected: Partial<StatementFacts>;
}

const rows: Row[] = [
  {
    name: "CREATE INDEX CONCURRENTLY yields transactionHostile true",
    sql: "CREATE INDEX CONCURRENTLY idx ON t(c)",
    expected: { statementKind: "CreateIndex", concurrently: true, transactionHostile: true },
  },
  {
    name: "CREATE INDEX without CONCURRENTLY yields transactionHostile false",
    sql: "CREATE INDEX idx ON t(c)",
    expected: { statementKind: "CreateIndex", concurrently: false, transactionHostile: false },
  },
  {
    name: "DROP INDEX CONCURRENTLY yields transactionHostile true",
    sql: "DROP INDEX CONCURRENTLY idx",
    expected: { statementKind: "DropIndex", concurrently: true, transactionHostile: true },
  },
  {
    name: "DROP INDEX without CONCURRENTLY yields transactionHostile false",
    sql: "DROP INDEX idx",
    expected: { statementKind: "DropIndex", concurrently: false, transactionHostile: false },
  },
  {
    name: "REINDEX INDEX CONCURRENTLY yields Reindex, concurrently true, transactionHostile true",
    sql: "REINDEX INDEX CONCURRENTLY idx_a",
    expected: { statementKind: "Reindex", concurrently: true, transactionHostile: true },
  },
  {
    name: "REINDEX INDEX (plain) yields Reindex, concurrently false, transactionHostile false -- the params key is absent entirely, not an empty array",
    sql: "REINDEX INDEX idx_a",
    expected: { statementKind: "Reindex", concurrently: false, transactionHostile: false },
  },
  {
    name: "VACUUM ANALYZE names the table and is transactionHostile",
    sql: "VACUUM ANALYZE recipes",
    expected: { statementKind: "Vacuum", table: "recipes", transactionHostile: true },
  },
  {
    name: "CREATE DATABASE is transactionHostile",
    sql: "CREATE DATABASE foo",
    expected: { statementKind: "CreateDatabase", transactionHostile: true },
  },
  {
    name: "ALTER SYSTEM SET statement_timeout = 0 is transactionHostile and disarms",
    sql: "ALTER SYSTEM SET statement_timeout = 0",
    expected: { statementKind: "AlterSystem", transactionHostile: true, disarmsTimeout: true },
  },
  {
    name: "ALTER SYSTEM SET work_mem is transactionHostile but does not disarm",
    sql: "ALTER SYSTEM SET work_mem = '64MB'",
    expected: { statementKind: "AlterSystem", transactionHostile: true, disarmsTimeout: false },
  },
  {
    name: "SET lock_timeout = '0' disarms and is not transactionHostile",
    sql: "SET lock_timeout = '0'",
    expected: { statementKind: "SetGuc", disarmsTimeout: true, transactionHostile: false },
  },
  {
    name: "SET LOCAL statement_timeout = 0 disarms",
    sql: "SET LOCAL statement_timeout = 0",
    expected: { statementKind: "SetGuc", disarmsTimeout: true },
  },
  {
    name: "SET lock_timeout TO DEFAULT disarms",
    sql: "SET lock_timeout TO DEFAULT",
    expected: { statementKind: "SetGuc", disarmsTimeout: true },
  },
  {
    name: "RESET lock_timeout disarms",
    sql: "RESET lock_timeout",
    expected: { statementKind: "SetGuc", disarmsTimeout: true },
  },
  {
    name: "RESET ALL disarms even though its AST node carries no name field at all (Pitfall 4)",
    sql: "RESET ALL",
    expected: { statementKind: "SetGuc", disarmsTimeout: true },
  },
  {
    name: "SET search_path = public does not disarm",
    sql: "SET search_path = public",
    expected: { statementKind: "SetGuc", disarmsTimeout: false },
  },
  {
    name: "ALTER DATABASE ... SET statement_timeout = 0 disarms",
    sql: "ALTER DATABASE recipe_dev SET statement_timeout = 0",
    expected: { statementKind: "AlterDatabaseSet", disarmsTimeout: true },
  },
  {
    name: "ALTER ROLE ... SET lock_timeout = 0 disarms",
    sql: "ALTER ROLE recipe_app SET lock_timeout = 0",
    expected: { statementKind: "AlterRoleSet", disarmsTimeout: true },
  },
  // --- Every existing statement kind keeps both new facts false ---
  {
    name: "DROP TABLE keeps both new facts false",
    sql: "DROP TABLE t",
    expected: { statementKind: "DropTable", transactionHostile: false, disarmsTimeout: false },
  },
  {
    name: "ALTER TABLE ADD COLUMN keeps both new facts false",
    sql: "ALTER TABLE t ADD COLUMN c text",
    expected: { statementKind: "AddColumn", transactionHostile: false, disarmsTimeout: false },
  },
];

describe("transaction-hostile / timeout-disarm facts (04-02-PLAN.md task 1, D-10/D-17)", () => {
  it.each(rows.map((row): [string, Row] => [row.name, row]))("%s", async (_name, row) => {
    const facts = await factsFor(row.sql);
    expect(facts).toMatchObject(row.expected);
  });

  it("a DO block genuinely executing SET lock_timeout = '0' before an ALTER TABLE yields a nested finding whose facts carry disarmsTimeout true at sourceContext do-block", async () => {
    const rules = loadDefaultRules();
    const sql = "DO $$ BEGIN SET lock_timeout = '0'; ALTER TABLE t ADD COLUMN c text; END $$;";

    const result = await analyzeSql(sql, rules);

    const disarmFinding = result.findings.find((f) => f.facts.disarmsTimeout);
    expect(disarmFinding).toBeDefined();
    expect(disarmFinding!.facts.statementKind).toBe("SetGuc");
    expect(disarmFinding!.facts.sourceContext).toBe("do-block");
  });
});
