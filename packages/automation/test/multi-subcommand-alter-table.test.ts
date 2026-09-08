// CR-02 (03-REVIEW.md): a multi-subcommand ALTER TABLE statement (PostgreSQL's own grammar
// allows `ALTER TABLE t sub1, sub2, ...`) must have EVERY subcommand inspected and classified,
// never only the first. Before this fix, `inspectAlterTableStmt` read only `cmds[0]`, so a
// later, genuinely destructive subcommand in the same statement was silently never classified
// at all -- the exact reproduction below returned file verdict SAFE with exactly one finding
// (the harmless ADD COLUMN) before the fix, and the DROP COLUMN subcommand never appeared
// anywhere in the result: no finding, no rule id, no mention. Regression test for that exact
// reproduction, plus coverage that worst-verdict-wins across all subcommands and that every
// subcommand's own finding correctly names its own facts.
import { describe, expect, it } from "vitest";
import { loadDefaultRules } from "../src/adapter/default-rules";
import { analyzeSql } from "../src/analyze";
import { inspectStatement, parseTopLevel } from "../src/inspector/inspect";

describe("multi-subcommand ALTER TABLE (CR-02): every subcommand is inspected, never only the first", () => {
  it("ADD COLUMN + DROP COLUMN in one statement is BLOCKED -- the DROP COLUMN subcommand is never silently skipped", async () => {
    const rules = loadDefaultRules();
    const sql = "ALTER TABLE orders ADD COLUMN notes text, DROP COLUMN secret_data;";

    const result = await analyzeSql(sql, rules);

    expect(result.verdict).toBe("BLOCKED");
    const allRuleIds = result.findings.flatMap((f) => f.ruleIds);
    expect(allRuleIds).toContain("drop-column");
    expect(allRuleIds).toContain("add-column-nullable-no-default");

    const dropFinding = result.findings.find((f) => f.ruleIds.includes("drop-column"));
    expect(dropFinding).toBeDefined();
    expect(dropFinding!.verdict).toBe("BLOCKED");
    expect(dropFinding!.facts.statementKind).toBe("DropColumn");
    expect(dropFinding!.facts.column).toBe("secret_data");

    const addFinding = result.findings.find((f) => f.ruleIds.includes("add-column-nullable-no-default"));
    expect(addFinding).toBeDefined();
    expect(addFinding!.facts.statementKind).toBe("AddColumn");
    expect(addFinding!.facts.column).toBe("notes");
  });

  it("both subcommands' findings carry the same statementIndex but distinct nestedPath values, so a consumer can tell them apart", async () => {
    const rules = loadDefaultRules();
    const sql = "ALTER TABLE orders ADD COLUMN notes text, DROP COLUMN secret_data;";

    const result = await analyzeSql(sql, rules);

    expect(result.findings).toHaveLength(2);
    expect(result.findings.every((f) => f.statementIndex === 0)).toBe(true);
    const nestedPaths = result.findings.map((f) => JSON.stringify(f.nestedPath));
    expect(new Set(nestedPaths).size).toBe(2);
  });

  it("three subcommands (two safe, one review-required) all produce their own finding, and the file verdict is the worst of the three", async () => {
    const rules = loadDefaultRules();
    const sql = "ALTER TABLE t ADD COLUMN a text, ADD COLUMN b text, ALTER COLUMN c SET NOT NULL;";

    const result = await analyzeSql(sql, rules);

    expect(result.findings).toHaveLength(3);
    expect(result.verdict).toBe("REVIEW_REQUIRED");
    const kinds = result.findings.map((f) => f.facts.statementKind).sort();
    expect(kinds).toEqual(["AddColumn", "AddColumn", "SetNotNull"]);
  });

  it("a single-subcommand ALTER TABLE still produces exactly one finding with an empty nestedPath -- the common case is unaffected by the fix", async () => {
    const rules = loadDefaultRules();
    const result = await analyzeSql("ALTER TABLE t DROP COLUMN c;", rules);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].nestedPath).toEqual([]);
    expect(result.findings[0].verdict).toBe("BLOCKED");
  });

  it("inspectStatement returns one StatementFacts per AlterTableCmd subcommand, in cmds order", async () => {
    const [stmt] = await parseTopLevel("ALTER TABLE orders ADD COLUMN notes text, DROP COLUMN secret_data;");

    const factsList = inspectStatement(stmt);

    expect(factsList).toHaveLength(2);
    expect(factsList[0].statementKind).toBe("AddColumn");
    expect(factsList[0].column).toBe("notes");
    expect(factsList[1].statementKind).toBe("DropColumn");
    expect(factsList[1].column).toBe("secret_data");
  });

  it("a hidden DROP TABLE inside a DO block body that also has a multi-subcommand ALTER TABLE nested inside it still surfaces every subcommand (D-05 recursion composes with the CR-02 fix)", async () => {
    const rules = loadDefaultRules();
    const sql =
      "DO $$ BEGIN ALTER TABLE t ADD COLUMN a text, DROP COLUMN b; END; $$;";

    const result = await analyzeSql(sql, rules);

    expect(result.verdict).toBe("BLOCKED");
    const allRuleIds = result.findings.flatMap((f) => f.ruleIds);
    expect(allRuleIds).toContain("drop-column");
    expect(allRuleIds).toContain("add-column-nullable-no-default");
  });
});
