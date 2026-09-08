// D-13 (03-CONTEXT.md)/03-05-PLAN.md task 1: the harness that runs every corpus fixture through
// the real analyzer and diffs the outcome against the committed manifest -- the corpus's own
// "test" in the sense that a fixture with no assertion attached is worse than no fixture, since
// it looks like coverage. This file owns four separate concerns, each its own describe block:
//   1. Per-fixture: every manifest row's file, run through the real analyzeSql, matches its
//      expectedVerdict and its expectedRuleIds exactly (missing AND extra are both failures).
//   2. Structural integrity: no .sql file is unlisted, no manifest row names a missing file.
//   3. Rule coverage: every id in the shipped rules.json is exercised by some manifest row,
//      except a small, explicitly justified exception list (tests/guardrails.test.ts's own
//      allowlist discipline).
//   4. Concurrency: analysing the whole corpus with Promise.all produces results identical to
//      analysing it sequentially -- pinning the "no mutable module-level state" property Phase 4
//      and Phase 5 both depend on (calling this library more than once per process).
//   5. D-13's own precondition: no corpus .sql file may carry its expected verdict in a SQL
//      comment -- this suite's whole purpose includes proving comments are inert, so a comment
//      carrying data the tests depend on would be exactly the wrong precedent.
//
// Manifest `file` entries are repository-root-relative paths, read directly via readFileSync --
// this only resolves correctly when the process cwd is the repository root, which is true for
// every <verify> command this plan's own PLAN.md specifies (`pnpm test`,
// `pnpm exec vitest run packages/automation/test/corpus.test.ts`, both run from repo root) and
// matches this repo's own established convention (src/adapter/drizzle-migrations.ts's
// DEFAULT_MIGRATIONS_DIR is the same kind of bare cwd-relative constant).
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDefaultRules } from "../src/adapter/default-rules";
import { analyzeSql } from "../src/analyze";
import { loadCorpusManifest } from "./corpus-manifest-schema";

const CORPUS_DIR = "packages/automation/test/corpus";
const MANIFEST_PATH = "packages/automation/test/corpus/manifest.json";

/** A small, explicitly enumerated exception list for rule ids that legitimately cannot appear
 * as an expected outcome anywhere in this corpus. Each entry requires a comment justifying why
 * -- adding an entry here is a deliberate, reviewable decision, exactly as
 * tests/guardrails.test.ts's own two allowlists (FIXTURE_FILES_WITH_CONNECTION_STRINGS /
 * FIXTURE_FILES_READING_DEV_CONNECTION_VARIABLE) are, never routine maintenance. */
const RULE_COVERAGE_EXCEPTIONS: string[] = [
  // PostgreSQL's own grammar rejects `ALTER TYPE ... DROP VALUE` unconditionally at parse
  // time -- confirmed live against the installed libpg-query package (03-02-SUMMARY.md's
  // key-decisions, re-confirmed live against the pg18 line this plan inherited): parse()
  // throws "dropping an enum value is not implemented" for every input tried, before any
  // AlterEnumStmt AST node is ever constructed. No SQL text can ever reach this rule, so no
  // corpus fixture -- which must be genuinely parseable SQL -- can exercise it. Kept in
  // rules.json purely as documentation of FEATURES.md section 1's BLOCKED entry.
  "alter-type-drop-value",
];

const manifest = loadCorpusManifest(MANIFEST_PATH);
const rules = loadDefaultRules();

/** Recursively lists every `.sql` file under `dir`, returned as forward-slash, repo-root-
 * relative paths matching the manifest's own `file` field format regardless of host OS path
 * separator (Windows' `readdirSync` with `recursive: true` returns backslash-joined entries). */
function findAllSqlFiles(dir: string): string[] {
  const entries = readdirSync(dir, { recursive: true }) as string[];
  return entries
    .filter((entry) => entry.endsWith(".sql"))
    .map((entry) => join(dir, entry).split(sep).join("/"))
    .sort();
}

describe("corpus fixtures match their manifest row exactly (D-13)", () => {
  it.each(manifest.entries)("$file", async (entry) => {
    const sql = readFileSync(entry.file, "utf-8");
    const result = await analyzeSql(sql, rules);
    const actualRuleIds = [...new Set(result.findings.flatMap((finding) => finding.ruleIds))].sort();
    const expectedRuleIds = [...entry.expectedRuleIds].sort();

    expect(
      result.verdict,
      `${entry.file}: expected verdict ${entry.expectedVerdict}, got ${result.verdict}`,
    ).toBe(entry.expectedVerdict);

    const missing = expectedRuleIds.filter((id) => !actualRuleIds.includes(id));
    const extra = actualRuleIds.filter((id) => !expectedRuleIds.includes(id));
    expect(
      { missing, extra },
      `${entry.file}: rule id mismatch -- expected ${JSON.stringify(expectedRuleIds)}, got ${JSON.stringify(actualRuleIds)}`,
    ).toEqual({ missing: [], extra: [] });
  });
});

describe("structural integrity: the manifest and the corpus directory must name exactly the same files", () => {
  it("every .sql file under the corpus directory has a manifest row", () => {
    const manifestFiles = new Set(manifest.entries.map((entry) => entry.file));
    const onDisk = findAllSqlFiles(CORPUS_DIR);
    const unlisted = onDisk.filter((file) => !manifestFiles.has(file));
    expect(unlisted, `.sql files with no manifest row: ${unlisted.join(", ")}`).toEqual([]);
  });

  it("every manifest row names a file that exists on disk", () => {
    const missing = manifest.entries.filter((entry) => !existsSync(entry.file)).map((entry) => entry.file);
    expect(missing, `manifest rows naming files that do not exist: ${missing.join(", ")}`).toEqual([]);
  });
});

describe("rule coverage: every shipped catalogue rule id is exercised by at least one fixture", () => {
  it("every RULE_COVERAGE_EXCEPTIONS entry is a real rule id in the shipped catalogue", () => {
    const realRuleIds = new Set(rules.rules.map((rule) => rule.id));
    const staleExceptions = RULE_COVERAGE_EXCEPTIONS.filter((id) => !realRuleIds.has(id));
    expect(staleExceptions, `Exception list entries that are not real rule ids: ${staleExceptions.join(", ")}`).toEqual(
      [],
    );
  });

  it("every rule id in rules.json appears in at least one manifest row's expectedRuleIds, except the justified exceptions", () => {
    const coveredRuleIds = new Set(manifest.entries.flatMap((entry) => entry.expectedRuleIds));
    const uncovered = rules.rules
      .map((rule) => rule.id)
      .filter((id) => !coveredRuleIds.has(id) && !RULE_COVERAGE_EXCEPTIONS.includes(id));
    expect(uncovered, `Rule ids with no corpus fixture and no justified exception: ${uncovered.join(", ")}`).toEqual(
      [],
    );
  });
});

describe("concurrency: the corpus holds no property that a concurrent run could observe differently", () => {
  it("running every corpus fixture concurrently produces results identical to running them one at a time", async () => {
    const sqlTexts = manifest.entries.map((entry) => readFileSync(entry.file, "utf-8"));

    const concurrent = await Promise.all(sqlTexts.map((sql) => analyzeSql(sql, rules)));
    const sequential: Awaited<ReturnType<typeof analyzeSql>>[] = [];
    for (const sql of sqlTexts) {
      sequential.push(await analyzeSql(sql, rules));
    }

    expect(concurrent).toEqual(sequential);
  });
});

describe("D-13: no corpus fixture may encode its expected verdict inside a SQL comment", () => {
  const FORBIDDEN_WORDS = ["SAFE", "REVIEW_REQUIRED", "BLOCKED"];

  it("no .sql file under the corpus directory contains a verdict word inside a line comment", () => {
    const offenders: string[] = [];
    for (const file of findAllSqlFiles(CORPUS_DIR)) {
      const text = readFileSync(file, "utf-8");
      const commentLines = text.split("\n").filter((line) => line.trim().startsWith("--"));
      for (const line of commentLines) {
        if (FORBIDDEN_WORDS.some((word) => line.toUpperCase().includes(word))) {
          offenders.push(file);
          break;
        }
      }
    }
    expect(offenders, `Corpus files with a verdict word in a comment: ${offenders.join(", ")}`).toEqual([]);
  });
});

describe("loadCorpusManifest validates through zod (D-13)", () => {
  it("throws a message naming the offending row on a schema violation", () => {
    const tmpPath = "packages/automation/test/corpus/.tmp-invalid-manifest.json";
    writeFileSync(
      tmpPath,
      JSON.stringify({
        entries: [
          { file: "x.sql", group: "catalogue", expectedVerdict: "SAFE", expectedRuleIds: [], why: "" },
        ],
      }),
    );
    try {
      expect(() => loadCorpusManifest(tmpPath)).toThrow(/entry|why|0/i);
    } finally {
      unlinkSync(tmpPath);
    }
  });
});
