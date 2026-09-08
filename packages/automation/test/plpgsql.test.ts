// 03-04-PLAN.md Task 1: D-05's recursion into DO blocks and function bodies. Exercised primarily
// through analyzeSql (real parser -> real PL/pgSQL parser -> facts -> classify -> result), the
// same end-to-end style pairing.test.ts already established for D-09 -- never a hand-built AST
// or a hand-built PL/pgSQL tree (D10, D-01). The two adversarial halves that matter most --
// a genuinely hidden DROP TABLE vs. the same words appearing only as inert string data -- are
// written FIRST, per this task's own action text, because they are the acceptance test for
// 03-RESEARCH.md Pattern 4's API sketch, not the other way round.
//
// The MAX_NESTING_DEPTH boundary is the one behaviour this file tests by calling
// inspectPlPgSqlBody directly with a contrived depth argument, rather than hand-typing eight
// levels of literal nested procedural bodies into a SQL string: PostgreSQL's own grammar does
// not allow a literal `DO $$ ... $$` block nested textually inside another DO block's body
// (confirmed live this session -- "syntax error at or near BEGIN"), so a real fixture that
// nests past the limit would have to nest via CREATE FUNCTION statements instead, which is far
// more code for no additional coverage of the boundary condition itself. inspectPlPgSqlBody is
// an exported artifact this plan's own frontmatter names, so calling it directly here is calling
// the public contract, not reaching into a private implementation detail.
import { describe, expect, it } from "vitest";
import { loadDefaultRules } from "../src/adapter/default-rules";
import { analyzeSql } from "../src/analyze";
import { extractEmbeddedSql, inspectPlPgSqlBody, MAX_NESTING_DEPTH } from "../src/inspector/inspect-plpgsql";

describe("PL/pgSQL recursion (03-04-PLAN.md task 1, D-05)", () => {
  it("a DO block whose body genuinely drops a table is BLOCKED, with a nested finding whose sourceContext is do-block and whose ruleIds contain drop-table", async () => {
    const rules = loadDefaultRules();
    const sql = "DO $$ BEGIN DROP TABLE ingredients; END; $$;";

    const result = await analyzeSql(sql, rules);

    expect(result.verdict).toBe("BLOCKED");
    const dropFinding = result.findings.find((f) => f.ruleIds.includes("drop-table"));
    expect(dropFinding).toBeDefined();
    expect(dropFinding!.verdict).toBe("BLOCKED");
    expect(dropFinding!.facts.sourceContext).toBe("do-block");
  });

  it("a DO block whose body only inserts a string literal containing the words for dropping a table produces no drop-table finding, and the file verdict is not BLOCKED", async () => {
    const rules = loadDefaultRules();
    const sql =
      "DO $$ BEGIN INSERT INTO log(msg) VALUES ('DROP TABLE ingredients'); END; $$;";

    const result = await analyzeSql(sql, rules);

    expect(result.verdict).not.toBe("BLOCKED");
    expect(result.findings.some((f) => f.ruleIds.includes("drop-table"))).toBe(false);
  });

  it("a CREATE OR REPLACE FUNCTION whose body genuinely drops a table is BLOCKED, with a nested finding whose sourceContext is function-body", async () => {
    const rules = loadDefaultRules();
    const sql =
      "CREATE OR REPLACE FUNCTION f() RETURNS void AS $$ BEGIN DROP TABLE ingredients; END; $$ LANGUAGE plpgsql;";

    const result = await analyzeSql(sql, rules);

    expect(result.verdict).toBe("BLOCKED");
    const dropFinding = result.findings.find((f) => f.ruleIds.includes("drop-table"));
    expect(dropFinding).toBeDefined();
    expect(dropFinding!.facts.sourceContext).toBe("function-body");
  });

  it("a DO block whose body contains only statements the catalogue already classifies SAFE yields a SAFE file verdict", async () => {
    // Deviation note (see SUMMARY): the plan's own wording for this fixture was "an insert and
    // an update with a where clause." Neither is actually SAFE under the catalogue 03-02 already
    // shipped and tested: INSERT is not in the StatementKind vocabulary at all (D-04's catalogue
    // never included it), and an UPDATE with a WHERE clause has no SAFE rule -- deliberately, the
    // same way a WHERE-scoped DELETE has none either (only the unscoped/no-WHERE floor case is
    // named). Expanding that established, already-tested catalogue is out of this plan's scope
    // (Rule 4 territory, not decided here) -- this fixture proves the identical point (a body of
    // unambiguously-safe statements earns the container a SAFE verdict) using two statement kinds
    // the catalogue already classifies SAFE.
    const rules = loadDefaultRules();
    const sql = "DO $$ BEGIN CREATE TABLE new_log (id int); COMMENT ON TABLE new_log IS 'x'; END; $$;";

    const result = await analyzeSql(sql, rules);

    expect(result.verdict).toBe("SAFE");
  });

  it("the container statement itself earns its own SAFE finding (do-block-container) when the body is entirely safe", async () => {
    const rules = loadDefaultRules();
    const sql = "DO $$ BEGIN INSERT INTO log(msg) VALUES ('ok'); END; $$;";

    const result = await analyzeSql(sql, rules);

    const containerFinding = result.findings.find((f) => f.ruleIds.includes("do-block-container"));
    expect(containerFinding).toBeDefined();
    expect(containerFinding!.verdict).toBe("SAFE");
    expect(containerFinding!.nestedPath).toEqual([]);
  });

  it("the container statement itself earns its own SAFE finding (create-function-container) when the body is entirely safe", async () => {
    const rules = loadDefaultRules();
    const sql =
      "CREATE OR REPLACE FUNCTION f() RETURNS void AS $$ BEGIN INSERT INTO log(msg) VALUES ('ok'); END; $$ LANGUAGE plpgsql;";

    const result = await analyzeSql(sql, rules);

    const containerFinding = result.findings.find((f) => f.ruleIds.includes("create-function-container"));
    expect(containerFinding).toBeDefined();
    expect(containerFinding!.verdict).toBe("SAFE");
  });

  it("every nested finding carries a nestedPath of length at least two and a facts.nestingDepth greater than zero", async () => {
    const rules = loadDefaultRules();
    const sql = "DO $$ BEGIN DROP TABLE ingredients; END; $$;";

    const result = await analyzeSql(sql, rules);

    const nested = result.findings.filter((f) => f.nestedPath.length > 0);
    expect(nested.length).toBeGreaterThan(0);
    for (const finding of nested) {
      expect(finding.nestedPath.length).toBeGreaterThanOrEqual(2);
      expect(finding.facts.nestingDepth).toBeGreaterThan(0);
    }
  });

  it("a nested finding always sorts after its own container finding", async () => {
    const rules = loadDefaultRules();
    const sql = "DO $$ BEGIN DROP TABLE ingredients; END; $$;";

    const result = await analyzeSql(sql, rules);

    const containerIndex = result.findings.findIndex((f) => f.ruleIds.includes("do-block-container"));
    const nestedIndex = result.findings.findIndex((f) => f.ruleIds.includes("drop-table"));
    expect(containerIndex).toBeGreaterThanOrEqual(0);
    expect(nestedIndex).toBeGreaterThan(containerIndex);
  });

  it("MAX_NESTING_DEPTH is an exported constant and a body called at that depth yields a BLOCKED finding with rule id nesting-depth-exceeded, rather than being parsed and classified", async () => {
    expect(MAX_NESTING_DEPTH).toBe(8);

    const sql = "DO $$ BEGIN DROP TABLE ingredients; END; $$;";
    const atLimit = await inspectPlPgSqlBody(sql, "do-block", MAX_NESTING_DEPTH);

    expect(atLimit).toHaveLength(1);
    expect(atLimit[0].facts.statementKind).toBe("Unrecognized");
    expect(atLimit[0].facts.nestingLimitExceeded).toBe(true);

    const rules = loadDefaultRules();
    const { classifyFacts } = await import("../src/classifier/classify");
    const outcome = classifyFacts(atLimit[0].facts, rules.rules);
    expect(outcome.verdict).toBe("BLOCKED");
    expect(outcome.ruleIds).toContain("nesting-depth-exceeded");
  });

  it("a depth below the limit recurses normally and does not synthesize a nesting-depth-exceeded finding", async () => {
    const sql = "DO $$ BEGIN DROP TABLE ingredients; END; $$;";
    const belowLimit = await inspectPlPgSqlBody(sql, "do-block", MAX_NESTING_DEPTH - 1);

    expect(belowLimit.some((f) => f.facts.nestingLimitExceeded)).toBe(false);
    expect(belowLimit.some((f) => f.facts.statementKind === "DropTable")).toBe(true);
  });

  it("extractEmbeddedSql obtains statements as raw query TEXT off the procedural tree, not typed SQL AST nodes -- the exact shape the contract test pins (03-RESEARCH.md Pitfall 2)", async () => {
    const { parsePlPgSQL } = await import("libpg-query");
    const tree = await parsePlPgSQL("DO $$ BEGIN DROP TABLE ingredients; END; $$;");

    const entries = extractEmbeddedSql(tree);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ kind: "sql", query: "DROP TABLE ingredients" });
  });

  it("rules.json contains do-block-container, create-function-container and nesting-depth-exceeded", () => {
    const rules = loadDefaultRules();
    const ids = rules.rules.map((r) => r.id);
    expect(ids).toContain("do-block-container");
    expect(ids).toContain("create-function-container");
    expect(ids).toContain("nesting-depth-exceeded");
  });
});
