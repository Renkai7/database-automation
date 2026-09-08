// D-08: a parse failure is a hard error, not a verdict. Proves the whole path: analyzeSql
// rejects with AnalyzerParseError and produces no AnalysisResult at all, and the CLI exits with
// EXIT_CODES.PARSE_FAILURE (30) and prints no verdict word.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { afterEach, describe, expect, it } from "vitest";
import { loadDefaultRules } from "../src/adapter/default-rules";
import { analyzeSql } from "../src/analyze";
import { AnalyzerParseError } from "../src/types";

const UNPARSEABLE_SQL = "ALTER TABLE ;";

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("parse failure is a hard error, never a verdict (D-08)", () => {
  it("analyzeSql on unparseable input rejects with AnalyzerParseError carrying only the parser's own complaint", async () => {
    const rules = loadDefaultRules();

    await expect(analyzeSql(UNPARSEABLE_SQL, rules)).rejects.toBeInstanceOf(AnalyzerParseError);

    try {
      await analyzeSql(UNPARSEABLE_SQL, rules);
      expect.unreachable("expected analyzeSql to reject on unparseable SQL");
    } catch (error) {
      expect(error).toBeInstanceOf(AnalyzerParseError);
      const message = (error as AnalyzerParseError).message;
      // The parser's own complaint (its message field) is present; no other field of the
      // original libpg-query SqlError (e.g. its full sqlDetails object) is serialised into it.
      expect(message).toContain("syntax error");
      expect(message).not.toContain("fileName");
      expect(message).not.toContain("functionName");
    }
  });

  it(
    "the CLI over an unparseable file exits 30 and prints no verdict word",
    async () => {
      tempDir = mkdtempSync(join(tmpdir(), "gsd-analyzer-parse-failure-"));
      const filePath = join(tempDir, "unparseable.sql");
      writeFileSync(filePath, UNPARSEABLE_SQL, "utf-8");

      const result = await execa("pnpm", ["run", "db:analyze", filePath], { reject: false });

      expect(result.exitCode).toBe(30);
      expect(result.stdout).not.toContain("SAFE");
      expect(result.stdout).not.toContain("REVIEW_REQUIRED");
      expect(result.stdout).not.toContain("BLOCKED");
    },
    30000,
  );
});
