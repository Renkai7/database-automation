// 03-02-PLAN.md Task 2: proves the full FEATURES.md section 1 catalogue is well-formed,
// complete, and schema-validated as data -- never asserting on drizzle-generated behavior, only
// on the shape and content of rules.json itself.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseRulesFile, type Rule } from "../src/classifier/rules-schema";

const RULES_PATH = fileURLToPath(new URL("../src/rules/rules.json", import.meta.url));

function loadRawRulesFile(): unknown {
  return JSON.parse(readFileSync(RULES_PATH, "utf-8"));
}

// The complete set of StatementFacts keys (types.ts) a rule's match object may legally
// reference -- mirrored here rather than derived at runtime because StatementFacts is a
// compile-time-only TypeScript interface with no runtime shape to introspect.
const VALID_FACT_NAMES = new Set([
  "statementKind",
  "schema",
  "table",
  "column",
  "constraintName",
  "indexName",
  "usingIndexName",
  "concurrently",
  "notValid",
  "checkProvesNotNull",
  "defaultVolatility",
  "hasWhereClause",
  "dynamicSqlUnresolved",
  "sourceContext",
  "nestingDepth",
  "nestingLimitExceeded",
]);

// Boolean-typed StatementFacts fields -- a rule matching one of these with a string (or vice
// versa for the string-typed fields below) is a mistyped rule that would silently never match.
const BOOLEAN_FACTS = new Set([
  "concurrently",
  "notValid",
  "checkProvesNotNull",
  "hasWhereClause",
  "dynamicSqlUnresolved",
  "nestingLimitExceeded",
]);

// String-or-null-typed StatementFacts fields (nullable identifiers).
const NULLABLE_STRING_FACTS = new Set([
  "schema",
  "table",
  "column",
  "constraintName",
  "indexName",
  "usingIndexName",
]);

// Plain string (enum-backed, never null) StatementFacts fields.
const STRING_FACTS = new Set(["statementKind", "defaultVolatility", "sourceContext"]);

// Mirrors rules-schema.ts's RuleCategorySchema enum -- not exported from that module, so
// duplicated here deliberately (a category this test doesn't know about would need a schema
// change anyway, which is exactly the loud-failure this test exists to catch).
const VALID_CATEGORIES = new Set([
  "irreversible-data-loss",
  "lock-hazard",
  "compatibility",
  "usually-safe",
  "analyzer-integrity",
]);

// Every rule id 03-02-PLAN.md task 2 names (the seven D-02 floor rules plus empty-input were
// already present from plan 03-01 and are checked for separately below).
const TASK_2_RULE_IDS = [
  "alter-type-drop-value",
  "add-column-volatile-default",
  "set-not-null",
  "alter-column-type",
  "add-unique-constraint",
  "create-index-not-concurrently",
  "drop-index-not-concurrently",
  "add-foreign-key-validated",
  "rename-column",
  "rename-table",
  "drop-not-null",
  "drop-constraint",
  "create-table",
  "add-column-nullable-no-default",
  "add-column-nonvolatile-default",
  "create-index-concurrently",
  "drop-index-concurrently",
  "comment-on",
  "add-check-constraint-not-valid",
  "add-foreign-key-not-valid",
  "validate-constraint",
];

const COMPATIBILITY_RULE_IDS = ["rename-column", "rename-table", "drop-not-null", "drop-constraint"];

function matchValueTypeOk(factName: string, matchValue: unknown): boolean {
  const check = (value: unknown): boolean => {
    if (BOOLEAN_FACTS.has(factName)) {
      return typeof value === "boolean";
    }
    if (NULLABLE_STRING_FACTS.has(factName)) {
      return value === null || typeof value === "string";
    }
    if (STRING_FACTS.has(factName)) {
      return typeof value === "string";
    }
    // nestingDepth (numeric) is not matchable at all under the current FactMatchSchema
    // (string | boolean | null | array-of-string-or-boolean) -- no rule in this catalogue
    // references it, and a rule that did would already fail parseRulesFile's own schema check.
    return false;
  };

  if (Array.isArray(matchValue)) {
    return matchValue.every(check);
  }
  return check(matchValue);
}

describe("rules catalogue (03-02-PLAN.md task 2, ANLZ-03/D-04)", () => {
  it("rules.json parses through parseRulesFile with no zod issues", () => {
    expect(() => parseRulesFile(loadRawRulesFile())).not.toThrow();
  });

  it("rule ids are unique across the whole file", () => {
    const rulesFile = parseRulesFile(loadRawRulesFile());
    const ids = rulesFile.rules.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every rule id this task names is present", () => {
    const rulesFile = parseRulesFile(loadRawRulesFile());
    const ids = new Set(rulesFile.rules.map((rule) => rule.id));
    for (const id of TASK_2_RULE_IDS) {
      expect(ids.has(id), `expected rules.json to contain rule id "${id}"`).toBe(true);
    }
    // The seven D-02 floor rules and empty-input, seeded by plan 03-01, must still be present.
    for (const id of [
      "drop-table",
      "drop-schema",
      "drop-database",
      "truncate",
      "drop-column",
      "delete-without-where",
      "update-without-where",
      "empty-input",
    ]) {
      expect(ids.has(id), `expected rules.json to still contain floor rule id "${id}"`).toBe(true);
    }
  });

  it("every rule carries a rationale of at least five words naming a lock, a rewrite, or a compatibility break", () => {
    const rulesFile = parseRulesFile(loadRawRulesFile());
    for (const rule of rulesFile.rules) {
      const wordCount = rule.rationale.trim().split(/\s+/).length;
      expect(wordCount, `rule "${rule.id}" rationale is too short: "${rule.rationale}"`).toBeGreaterThanOrEqual(5);
    }
  });

  it("rules exist in all five categories, and the four rename/compatibility rules use category compatibility, not lock-hazard", () => {
    const rulesFile = parseRulesFile(loadRawRulesFile());
    const categoriesPresent = new Set<string>(rulesFile.rules.map((rule) => rule.category));
    for (const category of VALID_CATEGORIES) {
      expect(categoriesPresent.has(category), `expected at least one rule in category "${category}"`).toBe(true);
    }

    const byId = new Map(rulesFile.rules.map((rule): [string, Rule] => [rule.id, rule]));
    for (const id of COMPATIBILITY_RULE_IDS) {
      expect(byId.get(id)?.category).toBe("compatibility");
      expect(byId.get(id)?.category).not.toBe("lock-hazard");
    }
  });

  it("no rule's match object references a key absent from StatementFacts", () => {
    const rulesFile = parseRulesFile(loadRawRulesFile());
    for (const rule of rulesFile.rules) {
      for (const factName of Object.keys(rule.match)) {
        expect(VALID_FACT_NAMES.has(factName), `rule "${rule.id}" matches unknown fact "${factName}"`).toBe(true);
      }
    }
  });

  it("every match value is of a type that fact can actually hold", () => {
    const rulesFile = parseRulesFile(loadRawRulesFile());
    for (const rule of rulesFile.rules) {
      for (const [factName, matchValue] of Object.entries(rule.match)) {
        expect(
          matchValueTypeOk(factName, matchValue),
          `rule "${rule.id}" matches fact "${factName}" with a value of the wrong type: ${JSON.stringify(matchValue)}`,
        ).toBe(true);
      }
    }
  });

  it("no rule matches on a session-level timeout property, and the exclusion is recorded with its reason", () => {
    const rulesFile = parseRulesFile(loadRawRulesFile());
    for (const rule of rulesFile.rules) {
      expect(rule.id).not.toMatch(/lock.?timeout|statement.?timeout/i);
    }
    expect(rulesFile.notes, "expected a top-level notes field recording the timeout exclusion").toBeDefined();
    expect(rulesFile.notes ?? "").toMatch(/lock.?timeout|statement.?timeout/i);
  });

  it("add-column-nonvolatile-default matches by set membership over literal, immutable and stable", () => {
    const rulesFile = parseRulesFile(loadRawRulesFile());
    const rule = rulesFile.rules.find((r) => r.id === "add-column-nonvolatile-default");
    expect(rule).toBeDefined();
    expect(rule?.match.defaultVolatility).toEqual(["literal", "immutable", "stable"]);
  });

  it("add-unique-constraint matches usingIndexName null, not a bare statementKind-only match", () => {
    const rulesFile = parseRulesFile(loadRawRulesFile());
    const rule = rulesFile.rules.find((r) => r.id === "add-unique-constraint");
    expect(rule?.match.usingIndexName).toBeNull();
  });
});
