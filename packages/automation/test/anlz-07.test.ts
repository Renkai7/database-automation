// ANLZ-07 / ROADMAP.md "Phase 3: Safety Analyzer" success criterion 1: "a genuinely destructive
// migration is BLOCKED, a genuinely safe one is SAFE." Kept as its own small file, deliberately
// separate from corpus.test.ts's per-fixture manifest diff, so this one claim is easy to find and
// hard to dilute among the corpus's other forty-plus assertions. Reuses the corpus's own
// already-derived catalogue fixtures (test/corpus/blocked/drop-table.sql,
// test/corpus/safe/add-column-nullable-no-default.sql) rather than inlining new SQL, so this
// test can never quietly drift from what the shared corpus itself asserts about those two files.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadDefaultRules } from "../src/adapter/default-rules";
import { analyzeSql } from "../src/analyze";

const DROP_TABLE_FIXTURE = "packages/automation/test/corpus/blocked/drop-table.sql";
const ADDITIVE_NULLABLE_COLUMN_FIXTURE = "packages/automation/test/corpus/safe/add-column-nullable-no-default.sql";

describe("phase success criterion 1: a real DROP TABLE is BLOCKED, and a genuinely safe migration is SAFE", () => {
  it("a real drop-table fixture returns BLOCKED", async () => {
    const rules = loadDefaultRules();
    const sql = readFileSync(DROP_TABLE_FIXTURE, "utf-8");

    const result = await analyzeSql(sql, rules);

    expect(result.verdict).toBe("BLOCKED");
  });

  it("an additive nullable-column migration returns SAFE, and the SAFE finding names the rule id that earned it", async () => {
    const rules = loadDefaultRules();
    const sql = readFileSync(ADDITIVE_NULLABLE_COLUMN_FIXTURE, "utf-8");

    const result = await analyzeSql(sql, rules);

    expect(result.verdict).toBe("SAFE");
    // D-06: SAFE must be earned by a matching rule, never defaulted to. A pass with no rule
    // behind it would be the analyzer having no opinion, not an opinion of SAFE.
    const safeFinding = result.findings.find((finding) => finding.verdict === "SAFE");
    expect(safeFinding).toBeDefined();
    expect(safeFinding!.ruleIds.length).toBeGreaterThan(0);
    expect(safeFinding!.ruleIds).toContain("add-column-nullable-no-default");
  });
});
