// Gap-closure fix (post-03-04, orchestrator spot-check): plan 03-04 shipped D-05 recursion for
// PL/pgSQL bodies only -- a container whose declared LANGUAGE was anything else (most notably
// `sql`) still earned an unconditional SAFE via do-block-container/create-function-container,
// even though its body was never re-parsed or classified. That is a false SAFE on real
// data-loss operations: `CREATE FUNCTION g() RETURNS void AS $$ DROP TABLE ingredients $$
// LANGUAGE sql;` classified SAFE against the real CLI before this fix.
//
// This file proves both halves of the fix:
//   1. Fail closed -- a container fact set now carries `bodyInspected`, set truthfully at the
//      single place the recursion decision is made. The container SAFE rules only fire when
//      bodyInspected is true; a container whose body could not be read (any language other than
//      plpgsql or sql) classifies REVIEW_REQUIRED via the new container-body-not-inspected rule
//      -- generically, not special-cased to any one language.
//   2. LANGUAGE sql bodies are genuinely inspected -- re-parsed through the same real-parser
//      path (parseTopLevel/inspectStatement) every top-level statement uses, never pattern-
//      matched. All four observed surface forms are covered: dollar-quoted text, single-quoted
//      text, case-varied language name, and the BEGIN ATOMIC standard-SQL-body form (which
//      arrives on CreateFunctionStmt.sql_body as already-parsed AST nodes, not text -- probed
//      directly against the installed libpg-query@18.1.4 this session, not assumed).
import { describe, expect, it } from "vitest";
import { loadDefaultRules } from "../src/adapter/default-rules";
import { analyzeSql } from "../src/analyze";
import { inspectContainerBody, planContainerBody } from "../src/inspector/inspect-plpgsql";
import { MAX_NESTING_DEPTH } from "../src/inspector/inspect-plpgsql";

describe("LANGUAGE sql function bodies are genuinely inspected, and uninspectable bodies fail closed (gap closure)", () => {
  const DROP_TABLE_CASES: Array<{ name: string; sql: string }> = [
    {
      name: "dollar-quoted body",
      sql: "CREATE FUNCTION g() RETURNS void AS $$ DROP TABLE ingredients $$ LANGUAGE sql;",
    },
    {
      name: "single-quoted body",
      sql: "CREATE FUNCTION i() RETURNS void AS 'DROP TABLE ingredients' LANGUAGE sql;",
    },
    {
      name: "case-varied language name (LANGUAGE SQL)",
      sql: "CREATE FUNCTION j() RETURNS void AS $$ DROP TABLE ingredients $$ LANGUAGE SQL;",
    },
    {
      name: "BEGIN ATOMIC standard-SQL-body form",
      sql: "CREATE FUNCTION h() RETURNS void LANGUAGE sql BEGIN ATOMIC DROP TABLE ingredients; END;",
    },
  ];

  for (const { name, sql } of DROP_TABLE_CASES) {
    it(`a LANGUAGE sql function whose body genuinely drops a table is BLOCKED (${name})`, async () => {
      const rules = loadDefaultRules();

      const result = await analyzeSql(sql, rules);

      expect(result.verdict).toBe("BLOCKED");
      const dropFinding = result.findings.find((f) => f.ruleIds.includes("drop-table"));
      expect(dropFinding).toBeDefined();
      expect(dropFinding!.verdict).toBe("BLOCKED");
      expect(dropFinding!.facts.sourceContext).toBe("function-body");
      expect(dropFinding!.facts.nestingDepth).toBeGreaterThan(0);
      expect(dropFinding!.nestedPath.length).toBeGreaterThanOrEqual(2);
    });
  }

  it("a LANGUAGE sql function whose body genuinely truncates a table is BLOCKED", async () => {
    const rules = loadDefaultRules();
    const sql = "CREATE FUNCTION k() RETURNS void AS $$ TRUNCATE ingredients $$ LANGUAGE sql;";

    const result = await analyzeSql(sql, rules);

    expect(result.verdict).toBe("BLOCKED");
    const truncateFinding = result.findings.find((f) => f.ruleIds.includes("truncate"));
    expect(truncateFinding).toBeDefined();
    expect(truncateFinding!.verdict).toBe("BLOCKED");
    expect(truncateFinding!.facts.sourceContext).toBe("function-body");
  });

  it("a LANGUAGE sql function whose body is genuinely harmless is SAFE -- proving the fix does not blanket-block SQL functions", async () => {
    // SELECT has no StatementKind in the shipped catalogue at all (same limitation
    // test/plpgsql.test.ts already documents for INSERT) -- a statement kind the catalogue
    // already classifies SAFE is used instead, to prove the identical point: a LANGUAGE sql
    // body whose contents are unambiguously safe earns the container its own SAFE verdict.
    const rules = loadDefaultRules();
    const sql = "CREATE FUNCTION harmless() RETURNS void AS $$ CREATE TABLE harmless_log (id int) $$ LANGUAGE sql;";

    const result = await analyzeSql(sql, rules);

    expect(result.verdict).toBe("SAFE");
    const containerFinding = result.findings.find((f) => f.ruleIds.includes("create-function-container"));
    expect(containerFinding).toBeDefined();
    expect(containerFinding!.verdict).toBe("SAFE");
    expect(containerFinding!.facts.bodyInspected).toBe(true);
    const nestedFinding = result.findings.find((f) => f.ruleIds.includes("create-table"));
    expect(nestedFinding).toBeDefined();
    expect(nestedFinding!.facts.sourceContext).toBe("function-body");
  });

  it("a LANGUAGE plperl function body classifies REVIEW_REQUIRED (not SAFE, not BLOCKED) -- the fail-closed default is generic, not special-cased to sql", async () => {
    const rules = loadDefaultRules();
    const sql = "CREATE FUNCTION n() RETURNS void AS $$ some perl code $$ LANGUAGE plperl;";

    const result = await analyzeSql(sql, rules);

    expect(result.verdict).toBe("REVIEW_REQUIRED");
    const containerFinding = result.findings.find((f) => f.ruleIds.includes("container-body-not-inspected"));
    expect(containerFinding).toBeDefined();
    expect(containerFinding!.verdict).toBe("REVIEW_REQUIRED");
    expect(containerFinding!.facts.bodyInspected).toBe(false);
    // No container-SAFE rule id, and no nested findings -- the body was never re-parsed.
    expect(result.findings.some((f) => f.ruleIds.includes("create-function-container"))).toBe(false);
    expect(result.findings.length).toBe(1);
  });

  it("a LANGUAGE c function body also classifies REVIEW_REQUIRED (not SAFE) -- generic across arbitrary uninspectable languages, not an sql/plperl-only allowlist", async () => {
    const rules = loadDefaultRules();
    const sql = "CREATE FUNCTION o() RETURNS void AS 'some_shared_object', 'o' LANGUAGE c;";

    const result = await analyzeSql(sql, rules);

    expect(result.verdict).not.toBe("SAFE");
    expect(result.verdict).not.toBe("BLOCKED");
    expect(result.verdict).toBe("REVIEW_REQUIRED");
  });

  it("regression: a DO block whose body genuinely drops a table (plpgsql) stays BLOCKED, and its own container finding still earns SAFE with bodyInspected true", async () => {
    const rules = loadDefaultRules();
    const sql = "DO $$ BEGIN DROP TABLE ingredients; END; $$;";

    const result = await analyzeSql(sql, rules);

    expect(result.verdict).toBe("BLOCKED");
    const dropFinding = result.findings.find((f) => f.ruleIds.includes("drop-table"));
    expect(dropFinding).toBeDefined();
    expect(dropFinding!.facts.sourceContext).toBe("do-block");
    const containerFinding = result.findings.find((f) => f.ruleIds.includes("do-block-container"));
    expect(containerFinding).toBeDefined();
    expect(containerFinding!.verdict).toBe("SAFE");
    expect(containerFinding!.facts.bodyInspected).toBe(true);
  });

  it("regression: a CREATE OR REPLACE FUNCTION LANGUAGE plpgsql whose body genuinely drops a table stays BLOCKED, and its own container finding still earns SAFE with bodyInspected true", async () => {
    const rules = loadDefaultRules();
    const sql =
      "CREATE OR REPLACE FUNCTION f() RETURNS void AS $$ BEGIN DROP TABLE ingredients; END; $$ LANGUAGE plpgsql;";

    const result = await analyzeSql(sql, rules);

    expect(result.verdict).toBe("BLOCKED");
    const dropFinding = result.findings.find((f) => f.ruleIds.includes("drop-table"));
    expect(dropFinding).toBeDefined();
    expect(dropFinding!.facts.sourceContext).toBe("function-body");

    const containerFinding = result.findings.find((f) => f.ruleIds.includes("create-function-container"));
    expect(containerFinding).toBeDefined();
    expect(containerFinding!.verdict).toBe("SAFE");
    expect(containerFinding!.facts.bodyInspected).toBe(true);
  });

  it("planContainerBody reports inspected:false for a language it cannot read, and inspected:true with kind sql-atomic for a BEGIN ATOMIC body (probed AST shape)", async () => {
    const { parseTopLevel } = await import("../src/inspector/inspect");
    const [atomicStmt] = await parseTopLevel(
      "CREATE FUNCTION h() RETURNS void LANGUAGE sql BEGIN ATOMIC DROP TABLE ingredients; END;",
    );
    const atomicPlan = planContainerBody(atomicStmt);
    expect(atomicPlan.inspected).toBe(true);
    if (atomicPlan.inspected) {
      expect(atomicPlan.kind).toBe("sql-atomic");
    }

    const [plperlStmt] = await parseTopLevel(
      "CREATE FUNCTION n() RETURNS void AS $$ some perl code $$ LANGUAGE plperl;",
    );
    const plperlPlan = planContainerBody(plperlStmt);
    expect(plperlPlan.inspected).toBe(false);
  });

  it("inspectContainerBody respects MAX_NESTING_DEPTH identically for a LANGUAGE sql (sql-text) body", async () => {
    const atLimit = await inspectContainerBody(
      { inspected: true, kind: "sql-text", text: "DROP TABLE ingredients", sourceContext: "function-body" },
      MAX_NESTING_DEPTH,
    );

    expect(atLimit).toHaveLength(1);
    expect(atLimit[0].facts.statementKind).toBe("Unrecognized");
    expect(atLimit[0].facts.nestingLimitExceeded).toBe(true);

    const belowLimit = await inspectContainerBody(
      { inspected: true, kind: "sql-text", text: "DROP TABLE ingredients", sourceContext: "function-body" },
      MAX_NESTING_DEPTH - 1,
    );
    expect(belowLimit.some((f) => f.facts.nestingLimitExceeded)).toBe(false);
    expect(belowLimit.some((f) => f.facts.statementKind === "DropTable")).toBe(true);
  });

  it("rules.json contains container-body-not-inspected, and the container SAFE rules require bodyInspected true", () => {
    const rules = loadDefaultRules();
    const ids = rules.rules.map((r) => r.id);
    expect(ids).toContain("container-body-not-inspected");

    const doBlockRule = rules.rules.find((r) => r.id === "do-block-container");
    expect(doBlockRule?.match.bodyInspected).toBe(true);
    const createFunctionRule = rules.rules.find((r) => r.id === "create-function-container");
    expect(createFunctionRule?.match.bodyInspected).toBe(true);

    const notInspectedRule = rules.rules.find((r) => r.id === "container-body-not-inspected");
    expect(notInspectedRule?.verdict).toBe("REVIEW_REQUIRED");
  });
});
