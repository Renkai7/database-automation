// D-04: proves migrationHash is exactly drizzle's own hashing scheme -- sha256 hex digest of
// the WHOLE raw migration file text, never per-statement and never the split statements
// re-joined with different whitespace.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { migrationHash } from "../src/runner/ledger";

describe("migrationHash (D-04)", () => {
  it("matches a node:crypto sha256 digest computed independently over the same bytes", () => {
    const sql = "ALTER TABLE recipes ADD COLUMN notes text;\n";
    const expected = createHash("sha256").update(sql).digest("hex");
    expect(migrationHash(sql)).toBe(expected);
  });

  it("hashes the whole raw file text, not a per-statement or re-joined variant", () => {
    const sql = "CREATE TABLE a (id int);\nCREATE TABLE b (id int);\n";
    const expectedWhole = createHash("sha256").update(sql).digest("hex");
    expect(migrationHash(sql)).toBe(expectedWhole);

    // A different whitespace re-join of the same two statements must hash differently -- proves
    // this is hashing the literal file bytes, not a normalized/re-joined form of the split
    // statements.
    const rejoinedDifferently = "CREATE TABLE a (id int);CREATE TABLE b (id int);";
    expect(migrationHash(rejoinedDifferently)).not.toBe(expectedWhole);
  });
});
