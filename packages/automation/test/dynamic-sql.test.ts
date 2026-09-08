// 03-04-PLAN.md Task 2: D-07's unresolvable dynamic SQL is BLOCKED, and the rules file cannot
// weaken it either -- the same non-weakenable-floor discipline D-02 already established
// (floor.ts), extended to a second, analyzer-integrity-category fact set (D07_FLOOR_FACTS).
// Exercised end to end through analyzeSql/loadRules, the same style plpgsql.test.ts and
// pairing.test.ts already established.
import { describe, expect, it } from "vitest";
import { loadDefaultRules } from "../src/adapter/default-rules";
import { analyzeSql } from "../src/analyze";
import { classifyFacts, loadRules } from "../src/classifier/classify";
import { D02_FLOOR_FACTS, D07_FLOOR_FACTS } from "../src/classifier/floor";
import { RulesFileError } from "../src/types";

describe("unresolvable dynamic SQL (03-04-PLAN.md task 2, D-07)", () => {
  it("a DO block executing a variable is BLOCKED, with a finding naming unresolvable-dynamic-sql", async () => {
    const rules = loadDefaultRules();
    const sql = "DO $$ DECLARE v text; BEGIN v := 'drop table x'; EXECUTE v; END; $$;";

    const result = await analyzeSql(sql, rules);

    expect(result.verdict).toBe("BLOCKED");
    const dynamicFinding = result.findings.find((f) => f.ruleIds.includes("unresolvable-dynamic-sql"));
    expect(dynamicFinding).toBeDefined();
    expect(dynamicFinding!.verdict).toBe("BLOCKED");
    expect(dynamicFinding!.facts.dynamicSqlUnresolved).toBe(true);
    expect(dynamicFinding!.facts.statementKind).toBe("ExecuteDynamic");
  });

  it("the BLOCKED finding's rationale states that neither the analyzer nor a reviewer can read what the statement would execute", async () => {
    const rules = loadDefaultRules();
    const sql = "DO $$ DECLARE v text; BEGIN v := 'drop table x'; EXECUTE v; END; $$;";

    const result = await analyzeSql(sql, rules);

    const dynamicFinding = result.findings.find((f) => f.ruleIds.includes("unresolvable-dynamic-sql"));
    const rationale = dynamicFinding!.rationales.join(" ").toLowerCase();
    expect(rationale).toContain("analyzer");
    expect(rationale).toContain("reviewer");
  });

  it("a body containing both a safe statement and a dynamic execute produces both findings and a file verdict of BLOCKED -- the dynamic execute is never silently skipped", async () => {
    const rules = loadDefaultRules();
    const sql =
      "DO $$ DECLARE v text; BEGIN CREATE TABLE new_log (id int); v := 'drop table x'; EXECUTE v; END; $$;";

    const result = await analyzeSql(sql, rules);

    expect(result.verdict).toBe("BLOCKED");
    expect(result.findings.some((f) => f.ruleIds.includes("create-table"))).toBe(true);
    expect(result.findings.some((f) => f.ruleIds.includes("unresolvable-dynamic-sql"))).toBe(true);
  });

  it("floor.ts exports D02_FLOOR_FACTS and D07_FLOOR_FACTS as separate constants, and both resolve BLOCKED through the real classifier against the shipped rules", () => {
    const rules = loadDefaultRules();
    expect(D02_FLOOR_FACTS.length).toBeGreaterThan(0);
    expect(D07_FLOOR_FACTS.length).toBeGreaterThan(0);
    expect(D02_FLOOR_FACTS).not.toBe(D07_FLOOR_FACTS);

    for (const facts of [...D02_FLOOR_FACTS, ...D07_FLOOR_FACTS]) {
      const outcome = classifyFacts(facts, rules.rules);
      expect(outcome.verdict, `expected ${facts.statementKind} to be BLOCKED`).toBe("BLOCKED");
    }
  });

  it("editing unresolvable-dynamic-sql's verdict to anything weaker than BLOCKED makes loadRules throw RulesFileError naming the offending fact set", () => {
    const raw = JSON.parse(
      JSON.stringify({
        version: 1,
        rules: [
          {
            id: "unresolvable-dynamic-sql",
            category: "analyzer-integrity",
            match: { statementKind: "ExecuteDynamic", dynamicSqlUnresolved: true },
            verdict: "REVIEW_REQUIRED",
            rationale: "Weakened for this test -- must be rejected by the D-07 floor self-check.",
          },
          // The D-02 floor rules must also be present and BLOCKED for loadRules to get past the
          // D-02 check and reach the D-07 check this test is really about.
          {
            id: "drop-table",
            category: "irreversible-data-loss",
            match: { statementKind: "DropTable" },
            verdict: "BLOCKED",
            rationale: "DROP TABLE permanently destroys the table and every row it holds.",
          },
          {
            id: "drop-schema",
            category: "irreversible-data-loss",
            match: { statementKind: "DropSchema" },
            verdict: "BLOCKED",
            rationale: "DROP SCHEMA permanently destroys every object inside the schema.",
          },
          {
            id: "drop-database",
            category: "irreversible-data-loss",
            match: { statementKind: "DropDatabase" },
            verdict: "BLOCKED",
            rationale: "DROP DATABASE permanently destroys the entire database.",
          },
          {
            id: "truncate",
            category: "irreversible-data-loss",
            match: { statementKind: "Truncate" },
            verdict: "BLOCKED",
            rationale: "TRUNCATE removes every row from a table in a single unrecoverable step.",
          },
          {
            id: "drop-column",
            category: "irreversible-data-loss",
            match: { statementKind: "DropColumn" },
            verdict: "BLOCKED",
            rationale: "DROP COLUMN permanently destroys every value stored in that column.",
          },
          {
            id: "delete-without-where",
            category: "irreversible-data-loss",
            match: { statementKind: "Delete", hasWhereClause: false },
            verdict: "BLOCKED",
            rationale: "A DELETE with no WHERE clause removes every row in the table.",
          },
          {
            id: "update-without-where",
            category: "irreversible-data-loss",
            match: { statementKind: "Update", hasWhereClause: false },
            verdict: "BLOCKED",
            rationale: "An UPDATE with no WHERE clause overwrites every row in the table.",
          },
        ],
      }),
    );

    expect(() => loadRules(raw)).toThrow(RulesFileError);
    try {
      loadRules(raw);
      expect.unreachable("expected loadRules to throw");
    } catch (error) {
      expect((error as Error).message).toContain("ExecuteDynamic");
    }
  });

  it("no constant-folding or expression-evaluation logic resolves a dynamic execute's argument -- a bare string-literal argument is still BLOCKED, exactly like a variable", async () => {
    const rules = loadDefaultRules();
    const sql = "DO $$ BEGIN EXECUTE 'DROP TABLE ingredients'; END; $$;";

    const result = await analyzeSql(sql, rules);

    expect(result.verdict).toBe("BLOCKED");
    expect(result.findings.some((f) => f.ruleIds.includes("unresolvable-dynamic-sql"))).toBe(true);
  });
});
