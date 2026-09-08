// 04-02-PLAN.md Task 3: the widened floor (D-17, "irreversible data loss or self-disarming"),
// the rule that expresses it, and the three rules-file-tampering shapes that prove it cannot be
// weakened -- driven through loadRules against an in-test mutated copy of the shipped rules
// object, never by editing the shipped file (matching test/rules-catalogue.test.ts's own CR-01
// regression style).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadDefaultRules } from "../src/adapter/default-rules";
import { analyzeSql } from "../src/analyze";
import { classifyFacts, loadRules } from "../src/classifier/classify";
import { D17_FLOOR_FACTS } from "../src/classifier/floor";
import { parseRulesFile, type Rule } from "../src/classifier/rules-schema";
import { RulesFileError } from "../src/types";

const RULES_PATH = fileURLToPath(new URL("../src/rules/rules.json", import.meta.url));

function loadRawRulesFile(): { version: number; rules: Rule[]; notes?: string } {
  return JSON.parse(readFileSync(RULES_PATH, "utf-8"));
}

interface DisarmRow {
  name: string;
  sql: string;
}

const disarmRows: DisarmRow[] = [
  { name: "SET lock_timeout = '0'", sql: "SET lock_timeout = '0';" },
  { name: "SET LOCAL statement_timeout = 0", sql: "SET LOCAL statement_timeout = 0;" },
  { name: "SET lock_timeout TO DEFAULT", sql: "SET lock_timeout TO DEFAULT;" },
  { name: "RESET lock_timeout", sql: "RESET lock_timeout;" },
  { name: "RESET ALL", sql: "RESET ALL;" },
  { name: "ALTER SYSTEM SET statement_timeout = 0", sql: "ALTER SYSTEM SET statement_timeout = 0;" },
  {
    name: "ALTER DATABASE recipe_dev SET statement_timeout = 0",
    sql: "ALTER DATABASE recipe_dev SET statement_timeout = 0;",
  },
  { name: "ALTER ROLE recipe_app SET lock_timeout = 0", sql: "ALTER ROLE recipe_app SET lock_timeout = 0;" },
];

describe("timeout-disarm floor (04-02-PLAN.md task 3, D-17)", () => {
  it("loadDefaultRules() succeeds against the shipped rules file", () => {
    expect(() => loadDefaultRules()).not.toThrow();
  });

  it.each(disarmRows.map((row): [string, DisarmRow] => [row.name, row]))(
    "%s classifies BLOCKED with rule id disarms-timeout-guc",
    async (_name, row) => {
      const rules = loadDefaultRules();
      const result = await analyzeSql(row.sql, rules);
      expect(result.verdict).toBe("BLOCKED");
      const finding = result.findings.find((f) => f.ruleIds.includes("disarms-timeout-guc"));
      expect(finding, `expected a finding with ruleIds including disarms-timeout-guc for "${row.sql}"`).toBeDefined();
    },
  );

  it("SET search_path = public classifies REVIEW_REQUIRED (uncatalogued-but-named GUC set), never BLOCKED and never SAFE", async () => {
    const rules = loadDefaultRules();
    const result = await analyzeSql("SET search_path = public;", rules);
    expect(result.verdict).toBe("REVIEW_REQUIRED");
    expect(result.findings.some((f) => f.ruleIds.includes("disarms-timeout-guc"))).toBe(false);
  });

  it("CREATE INDEX CONCURRENTLY on its own classifies SAFE", async () => {
    const rules = loadDefaultRules();
    const result = await analyzeSql("CREATE INDEX CONCURRENTLY idx ON recipes(slug);", rules);
    expect(result.verdict).toBe("SAFE");
  });

  it("VACUUM ANALYZE, CREATE DATABASE and REINDEX each classify REVIEW_REQUIRED with a named rule id, not through the Unrecognized default", async () => {
    const rules = loadDefaultRules();

    const vacuumResult = await analyzeSql("VACUUM ANALYZE recipes;", rules);
    expect(vacuumResult.verdict).toBe("REVIEW_REQUIRED");
    expect(vacuumResult.findings.some((f) => f.ruleIds.includes("vacuum-in-migration"))).toBe(true);

    const createDbResult = await analyzeSql("CREATE DATABASE foo;", rules);
    expect(createDbResult.verdict).toBe("REVIEW_REQUIRED");
    expect(createDbResult.findings.some((f) => f.ruleIds.includes("create-database-in-migration"))).toBe(true);

    const reindexResult = await analyzeSql("REINDEX INDEX idx_a;", rules);
    expect(reindexResult.verdict).toBe("REVIEW_REQUIRED");
    expect(reindexResult.findings.some((f) => f.ruleIds.includes("reindex-in-migration"))).toBe(true);
  });

  it("D17_FLOOR_FACTS' four canonical fact sets all resolve BLOCKED through the real classifyFacts against the shipped rules", () => {
    const rules = loadDefaultRules();
    for (const facts of D17_FLOOR_FACTS) {
      const outcome = classifyFacts(facts, rules.rules);
      expect(outcome.verdict, `expected D17 floor fact set "${facts.statementKind}" to be BLOCKED`).toBe("BLOCKED");
    }
    const kinds = new Set(D17_FLOOR_FACTS.map((f) => f.statementKind));
    expect(kinds).toEqual(new Set(["SetGuc", "AlterSystem", "AlterDatabaseSet", "AlterRoleSet"]));
  });

  describe("three rules-file-tampering shapes, driven through loadRules against an in-memory mutated copy", () => {
    it("weakening disarms-timeout-guc's verdict to REVIEW_REQUIRED makes loadRules throw RulesFileError", () => {
      const raw = loadRawRulesFile();
      const weakened = {
        ...raw,
        rules: raw.rules.map((rule) =>
          rule.id === "disarms-timeout-guc" ? { ...rule, verdict: "REVIEW_REQUIRED" as const } : rule,
        ),
      };
      expect(() => loadRules(weakened)).toThrow(RulesFileError);
    });

    it("deleting the disarms-timeout-guc row entirely makes loadRules throw RulesFileError -- 'no rule matched' cannot silently become REVIEW_REQUIRED for a floor operation", () => {
      const raw = loadRawRulesFile();
      const deleted = {
        ...raw,
        rules: raw.rules.filter((rule) => rule.id !== "disarms-timeout-guc"),
      };
      expect(() => loadRules(deleted)).toThrow(RulesFileError);
    });

    it("adding a row that enumerates every value of disarmsTimeout with verdict SAFE makes loadRules throw through assertUnmatchedDefaultsToReview", () => {
      const raw = loadRawRulesFile();
      const exploited = {
        ...raw,
        rules: [
          ...raw.rules,
          {
            id: "enumerate-disarms-timeout",
            category: "usually-safe" as const,
            match: { disarmsTimeout: [true, false] },
            verdict: "SAFE" as const,
            rationale: "Enumerates every legal disarmsTimeout value -- the blanket-SAFE exploit reproduction.",
          },
        ],
      };
      expect(() => loadRules(exploited)).toThrow(RulesFileError);
    });

    it("the same enumeration exploit over transactionHostile is also rejected", () => {
      const raw = loadRawRulesFile();
      const exploited = {
        ...raw,
        rules: [
          ...raw.rules,
          {
            id: "enumerate-transaction-hostile",
            category: "usually-safe" as const,
            match: { transactionHostile: [true, false] },
            verdict: "SAFE" as const,
            rationale: "Enumerates every legal transactionHostile value -- the blanket-SAFE exploit reproduction.",
          },
        ],
      };
      expect(() => loadRules(exploited)).toThrow(RulesFileError);
    });
  });
});
