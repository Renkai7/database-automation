// WR-02 (03-REVIEW.md): the PL/pgSQL embedded-statement reparse step used to do
// `const [stmt] = await parseTopLevel(...); if (!stmt) { continue; }` -- silently keeping only
// the first statement (or silently skipping entirely on zero) with no check that exactly one
// statement was produced. Inconsistent with inspect.ts's own parseTopLevel, which treats an
// entry with no `stmt` as a hard parse failure specifically because "silently dropping it would
// remove a real statement from classification." The reviewer could not construct a real
// PL/pgSQL input that reaches more than one statement here (PL/pgSQL's own grammar separates
// statements at the procedural level before `entry.query` is populated), so this is tested at
// the unit level directly against the exported guard, which is agnostic to where its input text
// came from.
import { describe, expect, it } from "vitest";
import { reparseEmbeddedSql } from "../src/inspector/inspect-plpgsql";
import { AnalyzerParseError } from "../src/types";

describe("WR-02: reparsing one embedded statement's raw text fails loud unless it yields exactly one statement", () => {
  it("a query that reparses to exactly one statement returns that statement", async () => {
    const stmt = await reparseEmbeddedSql("DROP TABLE orders");
    expect(stmt).toHaveProperty("DropStmt");
  });

  it("a query that reparses to MORE than one statement throws AnalyzerParseError rather than silently returning only the first", async () => {
    await expect(reparseEmbeddedSql("DROP TABLE a; DROP TABLE b")).rejects.toThrow(AnalyzerParseError);
  });

  it("a query that reparses to ZERO statements throws AnalyzerParseError rather than being silently skipped", async () => {
    await expect(reparseEmbeddedSql("-- just a comment")).rejects.toThrow(AnalyzerParseError);
  });

  it("the multi-statement error message names how many statements were found", async () => {
    try {
      await reparseEmbeddedSql("DROP TABLE a; DROP TABLE b");
      expect.unreachable("expected reparseEmbeddedSql to throw");
    } catch (error) {
      expect((error as Error).message).toContain("2");
    }
  });
});
