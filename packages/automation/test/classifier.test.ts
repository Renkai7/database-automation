// 03-02-PLAN.md Task 3: severity resolution, ordering-independence, and completeness.
import { describe, expect, it } from "vitest";
import { classifyFacts } from "../src/classifier/classify";
import { loadDefaultRules, analyzeSql } from "../src/analyze";
import type { Rule } from "../src/classifier/rules-schema";
import { EMPTY_FACTS, type StatementFacts } from "../src/types";

describe("classifyFacts severity resolution (03-02-PLAN.md task 3, D-10)", () => {
  it("a fact set matched by two rules of different severity produces the more severe verdict and both rule ids, sorted ascending", () => {
    const facts: StatementFacts = { ...EMPTY_FACTS, statementKind: "AddColumn", defaultVolatility: "volatile" };
    const rules: Rule[] = [
      {
        id: "z-safe-rule",
        category: "usually-safe",
        match: { statementKind: "AddColumn" },
        verdict: "SAFE",
        rationale: "A generic add-column rule with no volatility awareness, matching by statement kind alone.",
      },
      {
        id: "a-review-rule",
        category: "lock-hazard",
        match: { defaultVolatility: "volatile" },
        verdict: "REVIEW_REQUIRED",
        rationale: "A volatile default forces a full table rewrite under ACCESS EXCLUSIVE, unlike a non-volatile one.",
      },
    ];

    const outcome = classifyFacts(facts, rules);

    expect(outcome.verdict).toBe("REVIEW_REQUIRED");
    expect(outcome.ruleIds).toEqual(["a-review-rule", "z-safe-rule"]);
  });

  it("shuffling the rules array changes no verdict and no ruleIds set for a fixed set of inputs", () => {
    const rulesFile = loadDefaultRules();
    const shuffled = { ...rulesFile, rules: [...rulesFile.rules].reverse() };

    const fixedInputs: StatementFacts[] = [
      { ...EMPTY_FACTS, statementKind: "DropTable", table: "t" },
      { ...EMPTY_FACTS, statementKind: "AddColumn", defaultVolatility: "volatile" },
      { ...EMPTY_FACTS, statementKind: "AddColumn", defaultVolatility: "stable" },
      { ...EMPTY_FACTS, statementKind: "CreateIndex", concurrently: true },
      { ...EMPTY_FACTS, statementKind: "CreateIndex", concurrently: false },
      { ...EMPTY_FACTS, statementKind: "Unrecognized" },
    ];

    for (const facts of fixedInputs) {
      const original = classifyFacts(facts, rulesFile.rules);
      const reversed = classifyFacts(facts, shuffled.rules);
      expect(reversed.verdict).toBe(original.verdict);
      expect(reversed.ruleIds).toEqual(original.ruleIds);
    }
  });
});

describe("file-level verdict and completeness (03-02-PLAN.md task 3, D-10)", () => {
  it("a file with a BLOCKED and a REVIEW_REQUIRED statement returns file verdict BLOCKED and two findings, in statement order", async () => {
    const rules = loadDefaultRules();
    const result = await analyzeSql("DROP TABLE t;\nALTER TABLE t2 ALTER COLUMN c SET NOT NULL;", rules);

    expect(result.verdict).toBe("BLOCKED");
    expect(result.findings).toHaveLength(2);
    expect(result.findings.map((f) => f.statementIndex)).toEqual([0, 1]);
    expect(result.findings[0].verdict).toBe("BLOCKED");
    expect(result.findings[1].verdict).toBe("REVIEW_REQUIRED");
  });
});

describe("plan-level verification: the Pitfall 1 correction holds end to end through rules.json", () => {
  it("a now() default is SAFE and a clock_timestamp() default is REVIEW_REQUIRED, asserted in one test", async () => {
    const rules = loadDefaultRules();

    const nowResult = await analyzeSql("ALTER TABLE t ADD COLUMN c timestamptz DEFAULT now();", rules);
    const clockResult = await analyzeSql("ALTER TABLE t ADD COLUMN c timestamptz DEFAULT clock_timestamp();", rules);

    expect(nowResult.verdict).toBe("SAFE");
    expect(nowResult.findings[0].ruleIds).toContain("add-column-nonvolatile-default");
    expect(clockResult.verdict).toBe("REVIEW_REQUIRED");
    expect(clockResult.findings[0].ruleIds).toContain("add-column-volatile-default");
  });
});
