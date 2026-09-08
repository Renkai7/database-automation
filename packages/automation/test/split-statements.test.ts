// D-03: proves splitStatements recovers the correct per-statement text from libpg-query's own
// stmt_location/stmt_len fields -- including the first statement, which carries no
// stmt_location key at all (absent, not 0), and a comment sitting between two statements, which
// must belong to neither neighbor.
import { describe, expect, it } from "vitest";
import { splitStatements } from "../src/runner/split-statements";

describe("splitStatements (D-03)", () => {
  it("splits a three-statement file with a comment between statements two and three into exactly three texts, no semicolons and no comment text", async () => {
    const sql = [
      "CREATE TABLE t (id int);",
      "ALTER TABLE t ADD COLUMN c text;",
      "-- a comment between statement two and three",
      "CREATE INDEX CONCURRENTLY idx_t_c ON t (c);",
    ].join("\n");

    const statements = await splitStatements(sql);

    expect(statements).toHaveLength(3);
    for (const statement of statements) {
      expect(statement.text).not.toContain(";");
      expect(statement.text).not.toContain("--");
      expect(statement.text).not.toContain("a comment between");
    }

    expect(statements[0].text.trim()).toBe("CREATE TABLE t (id int)");
    expect(statements[1].text.trim()).toBe("ALTER TABLE t ADD COLUMN c text");
    expect(statements[2].text.trim()).toBe("CREATE INDEX CONCURRENTLY idx_t_c ON t (c)");
  });

  it("recovers the first statement correctly despite its absent stmt_location", async () => {
    const sql = "SELECT 1;";
    const statements = await splitStatements(sql);

    expect(statements).toHaveLength(1);
    expect(statements[0].location).toBe(0);
    expect(statements[0].text.trim()).toBe("SELECT 1");
  });

  it("resolves comment-only text with zero split statements, not a parse failure", async () => {
    const statements = await splitStatements("-- just a comment, nothing executable\n");
    expect(statements).toEqual([]);
  });

  it("throws AnalyzerParseError (never resolves) for genuinely unparseable SQL", async () => {
    await expect(splitStatements("CREATE TABLE (((;")).rejects.toThrow();
  });
});
