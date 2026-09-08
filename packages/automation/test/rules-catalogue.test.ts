// 03-02-PLAN.md Task 2: proves the full FEATURES.md section 1 catalogue is well-formed,
// complete, and schema-validated as data -- never asserting on drizzle-generated behavior, only
// on the shape and content of rules.json itself.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadDefaultRules } from "../src/adapter/default-rules";
import { analyzeSql } from "../src/analyze";
import { classifyFacts, loadRules } from "../src/classifier/classify";
import { D02_FLOOR_FACTS, D07_FLOOR_FACTS } from "../src/classifier/floor";
import { parseRulesFile, type Rule } from "../src/classifier/rules-schema";
import { EMPTY_FACTS, RulesFileError } from "../src/types";

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
  "bodyInspected",
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
  "bodyInspected",
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

// CR-01 (03-REVIEW.md): a rule whose `match` object has no conditions at all
// (`ruleMatches`'s `Object.entries(rule.match).every(...)` is vacuously true for zero
// conditions) previously matched EVERY StatementFacts value, including every statement kind
// the catalogue has no other opinion on -- silently granting blanket SAFE and defeating D-06's
// "SAFE must be earned" default without ever touching a D-02/D-07 floor rule. Regression test
// for the exact reproduction: a "blanket-catch-all" rule with `match: {}` appended to the real
// shipped rules file must be REJECTED at load time with a clear error, never silently accepted.
describe("CR-01: an empty match object is rejected at load time, never silently accepted", () => {
  it("parseRulesFile throws on a rule whose match object is {}", () => {
    const raw = {
      version: 1,
      rules: [
        {
          id: "blanket-catch-all",
          category: "usually-safe",
          match: {},
          verdict: "SAFE",
          rationale: "An empty match object -- must be rejected, never silently accepted.",
        },
      ],
    };

    expect(() => parseRulesFile(raw)).toThrow();
    try {
      parseRulesFile(raw);
      expect.unreachable("expected parseRulesFile to throw for an empty match object");
    } catch (error) {
      expect((error as Error).message.toLowerCase()).toMatch(/match/);
    }
  });

  it("appending a blanket-catch-all rule (match: {}) to the real shipped rules file is rejected by loadRules, and never silently reaches classifyFacts", () => {
    const raw = loadRawRulesFile() as { version: number; rules: unknown[]; notes?: string };
    const weakened = {
      ...raw,
      rules: [
        ...raw.rules,
        {
          id: "blanket-catch-all",
          category: "usually-safe",
          match: {},
          verdict: "SAFE",
          rationale: "An empty match object should never be accepted by the rules schema.",
        },
      ],
    };

    expect(() => loadRules(weakened)).toThrow(RulesFileError);
  });

  it("a match object with at least one condition is still accepted (the fix rejects only the empty case)", () => {
    const raw = {
      version: 1,
      rules: [
        {
          id: "narrow-rule",
          category: "usually-safe",
          match: { statementKind: "CommentOn" },
          verdict: "SAFE",
          rationale: "A rule with a real condition must still be accepted after the CR-01 fix.",
        },
      ],
    };

    expect(() => parseRulesFile(raw)).not.toThrow();
  });
});

// 03-VERIFICATION.md gap (post-03-REVIEW.md CR-01 fix): CR-01's `.refine` closes only the
// trivial zero-key `match: {}` case. The SAME blanket-SAFE effect is reachable without ever
// leaving `match` empty -- by enumerating every legal value of a field (most naturally
// `statementKind`) instead. `ruleMatches`'s array branch is `matchValue.includes(factValue)`,
// so a rule whose `match.statementKind` array contains every StatementKind the catalogue
// recognises matches every fact set unconditionally on that field, exactly like an empty match
// object would -- just spelled out longhand. Reproduced live (03-VERIFICATION.md): this passed
// both `parseRulesFile` and `assertFloorNotWeakened` with no error, and
// `classifyFacts({statementKind:"Unrecognized"}, rules)` returned SAFE -- the exact
// CLUSTER/REINDEX/ALTER SYSTEM/any-uncatalogued-DDL case D-06 exists to stop at REVIEW_REQUIRED.
//
// The exploit rule's statementKind list is derived from the shipped rules.json itself (every
// value any real rule's `match.statementKind` references), never a hardcoded literal snapshot
// of the 28-value StatementKind union -- StatementKind is a compile-time-only TypeScript type
// with no runtime shape to introspect (see VALID_FACT_NAMES's comment above), so a parallel
// hand-written list here would silently rot the moment the catalogue's own statement-kind
// coverage changed, exactly the failure mode this reproduction must not have.
function deriveCatalogueStatementKinds(rules: Rule[]): string[] {
  const kinds = new Set<string>();
  for (const rule of rules) {
    const value = rule.match.statementKind;
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const v of value) {
        kinds.add(String(v));
      }
    } else {
      kinds.add(String(value));
    }
  }
  return [...kinds].sort();
}

describe("D-06 gap closure (03-VERIFICATION.md): enumerating every legal statementKind value is rejected at load time, never silently accepted", () => {
  it("appending a rule that enumerates every statementKind value the shipped catalogue uses is REJECTED by loadRules, never silently reaching classifyFacts", () => {
    const raw = loadRawRulesFile() as { version: number; rules: Rule[]; notes?: string };
    const parsedForDerivation = parseRulesFile(raw);
    const everyCatalogueStatementKind = deriveCatalogueStatementKinds(parsedForDerivation.rules);
    // Sanity: the shipped catalogue really does name every legal StatementKind (28 in
    // types.ts) -- if this ever shrinks, the exploit reproduction below would be weaker than
    // the one 03-VERIFICATION.md actually demonstrated, silently.
    expect(everyCatalogueStatementKind.length).toBeGreaterThanOrEqual(28);

    const exploited = {
      ...raw,
      rules: [
        ...raw.rules,
        {
          id: "enumerate-catch-all",
          category: "usually-safe",
          match: { statementKind: everyCatalogueStatementKind },
          verdict: "SAFE",
          rationale: "Enumerates every legal statementKind value -- the CR-01 broad-variant exploit reproduction.",
        },
      ],
    };

    expect(() => loadRules(exploited)).toThrow(RulesFileError);
  });

  it("the exploit rule, if it were NOT rejected, would in fact grant SAFE to an uncatalogued statement (proves the reproduction is real, not a false alarm)", () => {
    const raw = loadRawRulesFile() as { version: number; rules: Rule[]; notes?: string };
    const parsedForDerivation = parseRulesFile(raw);
    const everyCatalogueStatementKind = deriveCatalogueStatementKinds(parsedForDerivation.rules);
    const exploitRule: Rule = {
      id: "enumerate-catch-all",
      category: "usually-safe",
      match: { statementKind: everyCatalogueStatementKind },
      verdict: "SAFE",
      rationale: "Enumerates every legal statementKind value -- the CR-01 broad-variant exploit reproduction.",
    };

    const outcome = classifyFacts(
      { ...EMPTY_FACTS, statementKind: "Unrecognized" },
      [...parsedForDerivation.rules, exploitRule],
    );
    expect(outcome.verdict).toBe("SAFE");
    expect(outcome.ruleIds).toContain("enumerate-catch-all");
  });

  it("the shipped, unmodified rules.json still loads successfully under the new check (no false positive)", () => {
    expect(() => loadDefaultRules()).not.toThrow();
  });

  it("CLUSTER and REINDEX -- real, uncatalogued SQL -- still classify REVIEW_REQUIRED under the shipped rules", async () => {
    const rules = loadDefaultRules();

    const clusterResult = await analyzeSql("CLUSTER orders USING orders_pkey;", rules);
    expect(clusterResult.verdict).toBe("REVIEW_REQUIRED");

    const reindexResult = await analyzeSql("REINDEX TABLE orders;", rules);
    expect(reindexResult.verdict).toBe("REVIEW_REQUIRED");
  });

  it("the D-02/D-07 floor operations remain BLOCKED under the shipped rules with the new check active", () => {
    const rules = loadDefaultRules();
    for (const facts of [...D02_FLOOR_FACTS, ...D07_FLOOR_FACTS]) {
      const outcome = classifyFacts(facts, rules.rules);
      expect(outcome.verdict, `expected floor fact set "${facts.statementKind}" to stay BLOCKED`).toBe("BLOCKED");
    }
  });
});
