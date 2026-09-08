// D-06/D-10: the empty-input and adjacent-statement contract. Proves the outcome for
// zero-statement input is defined, non-SAFE, non-error data (not a special case in code), and
// that adjacent statements -- separated only by a semicolon, or by Drizzle's
// `--> statement-breakpoint` marker -- stay separate operations against the real parser.
import { describe, expect, it } from "vitest";
import { analyzeSql, loadDefaultRules } from "../src/analyze";

describe("empty-input contract (D-06)", () => {
  it.each([
    ["empty string", ""],
    ["whitespace-only", "   \n\t  \n"],
    ["comment-only", "-- just a comment\n"],
  ])("analyzeSql(%s) yields statementCount 0, REVIEW_REQUIRED, one empty-input finding", async (_label, sql) => {
    const rules = loadDefaultRules();

    const result = await analyzeSql(sql, rules);

    expect(result.statementCount).toBe(0);
    expect(result.verdict).toBe("REVIEW_REQUIRED");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].ruleIds).toEqual(["empty-input"]);
  });

  it.each([
    ["empty string", ""],
    ["whitespace-only", "   \n\t  \n"],
    ["comment-only", "-- just a comment\n"],
  ])("analyzeSql(%s) never raises AnalyzerParseError", async (_label, sql) => {
    const rules = loadDefaultRules();
    await expect(analyzeSql(sql, rules)).resolves.toBeDefined();
  });
});

describe("adjacent-statement contract (D-10)", () => {
  it("semicolon-adjacent statements with no intervening whitespace produce two findings", async () => {
    const rules = loadDefaultRules();

    const result = await analyzeSql("DROP TABLE a;DROP TABLE b;", rules);

    expect(result.statementCount).toBe(2);
    expect(result.findings).toHaveLength(2);
    expect(result.findings.map((f) => f.statementIndex)).toEqual([0, 1]);
    expect(result.findings[0].ruleIds).toEqual(["drop-table"]);
    expect(result.findings[1].ruleIds).toEqual(["drop-table"]);
  });

  it("statements separated by Drizzle's statement-breakpoint marker produce two findings", async () => {
    const rules = loadDefaultRules();

    const result = await analyzeSql("DROP TABLE a;\n--> statement-breakpoint\nDROP TABLE b;", rules);

    expect(result.statementCount).toBe(2);
    expect(result.findings).toHaveLength(2);
    expect(result.findings.map((f) => f.statementIndex)).toEqual([0, 1]);
  });

  it("a single-statement input produces exactly one finding and a file verdict equal to it", async () => {
    const rules = loadDefaultRules();

    const result = await analyzeSql("DROP TABLE ingredients;", rules);

    expect(result.findings).toHaveLength(1);
    expect(result.verdict).toBe(result.findings[0].verdict);
  });
});
