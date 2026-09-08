// 03-RESEARCH.md Assumptions Log A1/A4, resolved by observation rather than citation (this test
// IS the resolution named by "Open Questions (RESOLVED)" item 1). Calls the installed
// libpg-query package directly -- not through inspect.ts -- so this test's job is narrowly to
// pin what the real, installed package does, independent of how this repo's own inspector
// wraps it.
import { parse, parsePlPgSQL } from "libpg-query";
import { describe, expect, it } from "vitest";
import * as libpgQuery from "libpg-query";

describe("libpg-query contract (A1: parse failure shape, A4: PL/pgSQL export)", () => {
  it("parse() on well-formed SQL resolves with a numeric version and a stmts array", async () => {
    const result = await parse("DROP TABLE ingredients;");
    expect(typeof result.version).toBe("number");
    expect(Array.isArray(result.stmts)).toBe(true);
    expect(result.stmts).toHaveLength(1);
  });

  it("parse() on structurally invalid SQL rejects (observed: SqlError, not a resolved error field)", async () => {
    // A1, resolved: the returned promise REJECTS for malformed SQL -- it does not resolve with
    // an error payload. The rejection is an instance of Error (specifically libpg-query's own
    // SqlError) carrying a `sqlDetails.cursorPosition` field, observed directly against the
    // installed package.
    await expect(parse("ALTER TABLE ;")).rejects.toBeInstanceOf(Error);

    try {
      await parse("ALTER TABLE ;");
      expect.unreachable("expected parse() to reject on structurally invalid SQL");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message.length).toBeGreaterThan(0);
      const sqlDetails = (error as { sqlDetails?: { cursorPosition?: number } }).sqlDetails;
      expect(sqlDetails).toBeDefined();
      expect(typeof sqlDetails?.cursorPosition).toBe("number");
    }
  });

  it(
    "the installed package exports the full PL/pgSQL parsing API " +
      "(A4, resolved: shipped on the pg18 build line only -- pg13-pg17 are parse-only)",
    () => {
      // A4, resolved by observation across TWO package lines during phase 03:
      //
      //   libpg-query@17.7.4 (dist-tag `pg17`, and also npm `latest`) exported ONLY:
      //   SqlError, formatSqlError, hasSqlDetails, loadModule, parse, parseSync.
      //   There was no PL/pgSQL export under any name. The string "plpgsql" appears in that
      //   package solely as an npm KEYWORD in its package.json -- never as an API -- which is
      //   the most likely origin of 03-RESEARCH.md Pattern 4's assumption that `parsePlPgSQL`
      //   was available at the pinned version.
      //
      //   libpg-query@18.1.4 (dist-tag `pg18`) ships the full API. Per the package's own
      //   README: "Starting with PostgreSQL 18, this package ships the full API: parse,
      //   parsePlPgSQL, scan, fingerprint, normalize and their sync variants. Versions 13-17
      //   are parse-only."
      //
      // This project moved to the pg18 line so plan 03-04's D-05 recursion into DO blocks and
      // function bodies can parse real PL/pgSQL. If a future dependency change drops back to a
      // pg13-pg17 build, this test fails loudly rather than letting that recursion silently
      // degrade to guesswork.
      const exportedNames = Object.keys(libpgQuery).sort();
      expect(exportedNames).toContain("parse");
      expect(exportedNames).toContain("parseSync");
      expect(exportedNames).toContain("parsePlPgSQL");
      expect(exportedNames).toContain("parsePlPgSQLSync");

      const asRecord = libpgQuery as unknown as Record<string, unknown>;
      expect(typeof asRecord.parsePlPgSQL).toBe("function");
      expect(typeof asRecord.parsePlPgSQLSync).toBe("function");
    },
  );

  it(
    "parsePlPgSQL() yields embedded statements as RAW QUERY TEXT, not a nested SQL AST " +
      "(03-RESEARCH.md Pitfall 2 -- the exact shape plan 03-04 must recurse through)",
    async () => {
      // This is the substantive half of A4, and the reason Pitfall 2 matters: the PL/pgSQL tree
      // is NOT a complete AST. An embedded statement arrives as an unparsed string at
      // PLpgSQL_stmt_execsql.sqlstmt.PLpgSQL_expr.query. Anything walking this tree looking for
      // a DropStmt node will find nothing and wrongly conclude the body is SAFE. The text must
      // be fed back through parse() to be classified. Pinned here so 03-04 builds against the
      // observed shape rather than an assumed one.
      // The package .d.ts declares parsePlPgSQL as returning ParseResult, which has no
      // plpgsql_funcs field -- the published typing understates the real runtime shape. Describe
      // the observed shape locally rather than assert against a type that does not match it.
      type PlPgSqlExecSql = {
        PLpgSQL_stmt_execsql: { sqlstmt: { PLpgSQL_expr: { query: string } } };
      };
      type PlPgSqlResult = {
        plpgsql_funcs: Array<{
          PLpgSQL_function: {
            action: { PLpgSQL_stmt_block: { body: Array<Record<string, unknown>> } };
          };
        }>;
      };

      const result = (await parsePlPgSQL(
        "CREATE OR REPLACE FUNCTION f() RETURNS void AS $$ BEGIN DROP TABLE ingredients; END; $$ LANGUAGE plpgsql;",
      )) as unknown as PlPgSqlResult;

      expect(Array.isArray(result.plpgsql_funcs)).toBe(true);
      expect(result.plpgsql_funcs).toHaveLength(1);

      const body = result.plpgsql_funcs[0].PLpgSQL_function.action.PLpgSQL_stmt_block.body;
      expect(Array.isArray(body)).toBe(true);

      const execSql = body.find((node) => "PLpgSQL_stmt_execsql" in node) as
        | PlPgSqlExecSql
        | undefined;
      expect(execSql).toBeDefined();

      const embedded = execSql!.PLpgSQL_stmt_execsql.sqlstmt.PLpgSQL_expr.query;
      // Raw text -- a string, not an object with a stmts array.
      expect(typeof embedded).toBe("string");
      expect(embedded).toBe("DROP TABLE ingredients");

      // And it only becomes classifiable after a second, ordinary parse.
      const reparsed = await parse(embedded + ";");
      expect(reparsed.stmts).toBeDefined();
      expect(reparsed.stmts).toHaveLength(1);
      expect(reparsed.stmts![0].stmt).toHaveProperty("DropStmt");
    },
  );
});
