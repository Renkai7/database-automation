// 03-RESEARCH.md Assumptions Log A1/A4, resolved by observation rather than citation (this test
// IS the resolution named by "Open Questions (RESOLVED)" item 1). Calls the installed
// libpg-query package directly -- not through inspect.ts -- so this test's job is narrowly to
// pin what the real, installed package does, independent of how this repo's own inspector
// wraps it.
import { parse } from "libpg-query";
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
    // SqlError) carrying a `sqlDetails.cursorPosition` field, observed directly this session
    // against the installed libpg-query@17.7.4 package.
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
    "the installed package exports no PL/pgSQL parsing function under any documented name " +
      "(A4, resolved: divergence from 03-RESEARCH.md Pattern 4 -- see plan summary)",
    () => {
      // 03-RESEARCH.md Pattern 4 named `parsePlPgSQL` as the expected export (sourced from
      // web-search corroboration, not hands-on verification). The installed libpg-query@17.7.4
      // package's actual exports, enumerated directly here, are: SqlError, formatSqlError,
      // hasSqlDetails, loadModule, parse, parseSync -- plus whatever @pgsql/types re-exports as
      // types (no runtime function among them). There is no parsePlPgSQL, no parsePlPgSqlAst,
      // and no other PL/pgSQL-specific parsing export under this package name/version.
      const exportedNames = Object.keys(libpgQuery).sort();
      expect(exportedNames).toContain("parse");
      expect(exportedNames).toContain("parseSync");
      expect(exportedNames).not.toContain("parsePlPgSQL");
      expect(exportedNames).not.toContain("parsePlPgSqlAst");

      const exportedFunctionNames = exportedNames.filter(
        (name) => typeof (libpgQuery as Record<string, unknown>)[name] === "function",
      );
      const plpgsqlExports = exportedFunctionNames.filter((name) => /plpgsql/i.test(name));
      expect(plpgsqlExports).toEqual([]);
    },
  );
});
