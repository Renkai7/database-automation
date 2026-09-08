// WR-01 (04-REVIEW.md): a multi-object DROP statement (PostgreSQL's own grammar allows
// `DROP TABLE a, b;`, `DROP SCHEMA a, b;`, `DROP INDEX a, b;`) must have EVERY named object
// inspected and classified, never only the first -- the same bug shape CR-02 already fixed for
// multi-subcommand ALTER TABLE. Before this fix, `inspectDropStmt` read only `objects[0]`, so
// every object after the first was silently discarded before it ever reached StatementFacts or
// classification. Regression test for that exact reproduction, plus coverage that every object's
// own finding correctly names its own facts and that a single-object DROP is unaffected.
import { describe, expect, it } from "vitest";
import { loadDefaultRules } from "../src/adapter/default-rules";
import { analyzeSql } from "../src/analyze";
import { inspectStatement, parseTopLevel } from "../src/inspector/inspect";

describe("multi-object DROP (WR-01): every named object is inspected, never only the first", () => {
  it("DROP TABLE a, b is BLOCKED with one finding per table -- the second table is never silently skipped", async () => {
    const rules = loadDefaultRules();
    const sql = "DROP TABLE a, b;";

    const result = await analyzeSql(sql, rules);

    expect(result.verdict).toBe("BLOCKED");
    expect(result.findings).toHaveLength(2);
    const tables = result.findings.map((f) => f.facts.table).sort();
    expect(tables).toEqual(["a", "b"]);
    expect(result.findings.every((f) => f.facts.statementKind === "DropTable")).toBe(true);
    expect(result.findings.every((f) => f.ruleIds.includes("drop-table"))).toBe(true);
  });

  it("both objects' findings carry the same statementIndex but distinct nestedPath values, so a consumer can tell them apart", async () => {
    const rules = loadDefaultRules();
    const result = await analyzeSql("DROP TABLE a, b;", rules);

    expect(result.findings).toHaveLength(2);
    expect(result.findings.every((f) => f.statementIndex === 0)).toBe(true);
    const nestedPaths = result.findings.map((f) => JSON.stringify(f.nestedPath));
    expect(new Set(nestedPaths).size).toBe(2);
  });

  it("DROP SCHEMA a, b produces one DropSchema finding per schema", async () => {
    const rules = loadDefaultRules();
    const result = await analyzeSql("DROP SCHEMA a, b;", rules);

    expect(result.verdict).toBe("BLOCKED");
    expect(result.findings).toHaveLength(2);
    const schemas = result.findings.map((f) => f.facts.schema).sort();
    expect(schemas).toEqual(["a", "b"]);
    expect(result.findings.every((f) => f.facts.statementKind === "DropSchema")).toBe(true);
  });

  it("a single-object DROP TABLE still produces exactly one finding with an empty nestedPath -- the common case is unaffected by the fix", async () => {
    const rules = loadDefaultRules();
    const result = await analyzeSql("DROP TABLE a;", rules);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].nestedPath).toEqual([]);
    expect(result.findings[0].verdict).toBe("BLOCKED");
  });

  it("inspectStatement returns one StatementFacts per DROP object, in objects order", async () => {
    const [stmt] = await parseTopLevel("DROP TABLE a, b;");

    const factsList = inspectStatement(stmt);

    expect(factsList).toHaveLength(2);
    expect(factsList[0].statementKind).toBe("DropTable");
    expect(factsList[0].table).toBe("a");
    expect(factsList[1].statementKind).toBe("DropTable");
    expect(factsList[1].table).toBe("b");
  });
});
