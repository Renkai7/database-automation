// 03-02-PLAN.md Task 3: D-09's same-file safe-form pairing pass. Exercised entirely through
// analyzeSql (the real parser -> facts -> classify -> pairing -> result path), never by
// importing applySafeFormPairing directly, matching this repo's established end-to-end test
// style (tracer.test.ts).
import { describe, expect, it } from "vitest";
import { analyzeSql, loadDefaultRules } from "../src/analyze";

describe("same-file safe-form pairing (03-02-PLAN.md task 3, D-09)", () => {
  it("an unvalidated foreign key add paired with a later VALIDATE CONSTRAINT of the exact same name sets pairedWith on both", async () => {
    const rules = loadDefaultRules();
    const sql =
      "ALTER TABLE t ADD CONSTRAINT fk FOREIGN KEY (c) REFERENCES other(id) NOT VALID;\n" +
      "ALTER TABLE t VALIDATE CONSTRAINT fk;";

    const result = await analyzeSql(sql, rules);

    expect(result.findings).toHaveLength(2);
    expect(result.findings[0].verdict).toBe("SAFE");
    expect(result.findings[1].verdict).toBe("SAFE");
    expect(result.findings[0].pairedWith).toBe(1);
    expect(result.findings[1].pairedWith).toBe(0);
    expect(result.findings[0].ruleIds).toContain("pair-not-valid-validated");
    expect(result.findings[1].ruleIds).toContain("pair-not-valid-validated");
  });

  it("a one-character-different constraint name does not pair -- pairedWith stays null and the pairing rule id is absent (naive per-statement verdicts stand)", async () => {
    const rules = loadDefaultRules();
    const sql =
      "ALTER TABLE t ADD CONSTRAINT fk FOREIGN KEY (c) REFERENCES other(id) NOT VALID;\n" +
      "ALTER TABLE t VALIDATE CONSTRAINT fkx;";

    const result = await analyzeSql(sql, rules);

    expect(result.findings[0].pairedWith).toBeNull();
    expect(result.findings[1].pairedWith).toBeNull();
    expect(result.findings[0].ruleIds).not.toContain("pair-not-valid-validated");
    expect(result.findings[1].ruleIds).not.toContain("pair-not-valid-validated");
    // Both halves are independently SAFE via task 2's own NOT VALID/VALIDATE CONSTRAINT rules
    // (FEATURES.md describes each step as intrinsically weak-locked on its own) -- this pairing
    // adds cross-reference bookkeeping and a more specific rule id, it does not change either
    // verdict. The near-miss therefore keeps the SAME (naive) verdicts, just unpaired.
    expect(result.findings[0].verdict).toBe("SAFE");
    expect(result.findings[1].verdict).toBe("SAFE");
  });

  it("a concurrently-built unique index paired with a later ADD CONSTRAINT ... UNIQUE USING INDEX naming it turns the naive REVIEW_REQUIRED into SAFE", async () => {
    const rules = loadDefaultRules();
    const sql = "CREATE UNIQUE INDEX CONCURRENTLY idx ON t (c);\nALTER TABLE t ADD CONSTRAINT t_c_uniq UNIQUE USING INDEX idx;";

    const naive = await analyzeSql("ALTER TABLE t ADD CONSTRAINT t_c_uniq UNIQUE USING INDEX idx;", rules);
    expect(naive.findings[0].verdict).toBe("REVIEW_REQUIRED");
    expect(naive.findings[0].ruleIds).toEqual([]);

    const result = await analyzeSql(sql, rules);

    expect(result.findings).toHaveLength(2);
    expect(result.findings[0].verdict).toBe("SAFE");
    expect(result.findings[1].verdict).toBe("SAFE");
    expect(result.findings[1].pairedWith).toBe(0);
    expect(result.findings[1].ruleIds).toContain("pair-concurrent-index-unique");
  });

  it("a validated not-null check constraint paired with a later SET NOT NULL on the same table/column turns the naive REVIEW_REQUIRED into SAFE", async () => {
    const rules = loadDefaultRules();
    const sql =
      "ALTER TABLE t ADD CONSTRAINT chk CHECK (c IS NOT NULL) NOT VALID;\n" +
      "ALTER TABLE t VALIDATE CONSTRAINT chk;\n" +
      "ALTER TABLE t ALTER COLUMN c SET NOT NULL;";

    const result = await analyzeSql(sql, rules);

    expect(result.findings).toHaveLength(3);
    expect(result.findings[2].verdict).toBe("SAFE");
    expect(result.findings[2].pairedWith).toBe(0);
    expect(result.findings[2].ruleIds).toContain("pair-validated-check-set-not-null");
  });

  it("SET NOT NULL with no validated check constraint in the file stays REVIEW_REQUIRED", async () => {
    const rules = loadDefaultRules();
    const result = await analyzeSql("ALTER TABLE t ALTER COLUMN c SET NOT NULL;", rules);

    expect(result.findings[0].verdict).toBe("REVIEW_REQUIRED");
    expect(result.findings[0].pairedWith).toBeNull();
  });

  it("a DROP TABLE statement is never lowered by any pairing, even alongside a would-be pairing partner in the same file", async () => {
    const rules = loadDefaultRules();
    const sql = "DROP TABLE t;\nALTER TABLE t VALIDATE CONSTRAINT chk;";

    const result = await analyzeSql(sql, rules);

    expect(result.findings[0].verdict).toBe("BLOCKED");
    expect(result.findings[0].pairedWith).toBeNull();
    expect(result.verdict).toBe("BLOCKED");
  });

  it("rules.json contains the three pairing rule ids with non-empty rationales", () => {
    const rules = loadDefaultRules();
    const byId = new Map(rules.rules.map((rule) => [rule.id, rule]));
    for (const id of ["pair-not-valid-validated", "pair-concurrent-index-unique", "pair-validated-check-set-not-null"]) {
      const rule = byId.get(id);
      expect(rule, `expected rules.json to contain pairing rule id "${id}"`).toBeDefined();
      expect(rule?.rationale.length ?? 0).toBeGreaterThan(0);
      expect(rule?.verdict).toBe("SAFE");
      expect(rule?.category).toBe("usually-safe");
    }
  });

  it("the three pairing rules' own match objects can never be satisfied by ordinary single-statement classification (they exist only for id/rationale lookup by the pairing pass)", async () => {
    const rules = loadDefaultRules();
    // Each of these SQL statements exercises the statementKind the pairing rule's sentinel
    // match object names, with a fact combination that statement kind can never actually
    // produce (see rules.json's rationale/comments) -- proving the sentinel is inert.
    const validateOnly = await analyzeSql("ALTER TABLE t VALIDATE CONSTRAINT chk;", rules);
    expect(validateOnly.findings[0].ruleIds).not.toContain("pair-not-valid-validated");

    const uniqueOnly = await analyzeSql("ALTER TABLE t ADD CONSTRAINT t_c_uniq UNIQUE (c);", rules);
    expect(uniqueOnly.findings[0].ruleIds).not.toContain("pair-concurrent-index-unique");

    const setNotNullOnly = await analyzeSql("ALTER TABLE t ALTER COLUMN c SET NOT NULL;", rules);
    expect(setNotNullOnly.findings[0].ruleIds).not.toContain("pair-validated-check-set-not-null");
  });
});
