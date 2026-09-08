// WR-01 (03-REVIEW.md): reconstructPlPgSql / planFromTextBody's lambdas used to rebuild a
// DO/CREATE FUNCTION statement with a FIXED `$$` delimiter, which collides when the body itself
// contains a nested dollar-quoted literal using the same (empty) tag -- turning valid PostgreSQL
// into a parse failure. The fix picks a delimiter tag guaranteed not to occur in the body.
//
// IN-02 (03-REVIEW.md): investigates whether the same collision could ALSO have a false-SAFE
// variant (a genuinely dangerous statement silently omitted from classification, rather than a
// hard parse failure). Verified directly against the installed libpg-query package this session
// (a disposable probe script, then discarded, per this project's "reason from real behaviour"
// discipline): parsePlPgSQL, fed the OLD fixed-`$$`-delimiter reconstruction of a body crafted so
// the truncated-and-reassembled text is still syntactically valid multi-statement SQL, returns a
// `plpgsql_funcs` array with ONE ENTRY PER embedded DO/FUNCTION construct found in the text --
// not just the first. extractEmbeddedSql's own walk is a deep, generic, unconditional traversal
// of the entire returned tree, so it finds the injected DROP TABLE in every entry, not only the
// first. A second variant (a bare, non-DO-wrapped trailing SQL statement) does not parse at all
// -- fails loud, not silently. No false-SAFE variant of the WR-01 collision was found: every
// input tried either throws AnalyzerParseError (fail loud, D-08) or is still fully classified
// (fail safe, via the generic tree walk) -- verdict: ABSENT for the OLD code, and by
// construction (no premature truncation can ever occur once the delimiter cannot collide)
// structurally impossible after this fix.
import { describe, expect, it } from "vitest";
import { loadDefaultRules } from "../src/adapter/default-rules";
import { analyzeSql } from "../src/analyze";

describe("WR-01: dollar-quote delimiter collision in PL/pgSQL body reconstruction", () => {
  it("a DO block whose outer tag is $outer$ and whose body embeds a $$-tagged string literal is classified, not a parse failure -- the exact 03-REVIEW.md reproduction", async () => {
    const rules = loadDefaultRules();
    const sql = `
      DO $outer$
      BEGIN
        PERFORM quote_literal($$safe$$);
        DROP TABLE orders;
      END;
      $outer$ LANGUAGE plpgsql;
    `;

    // Before the fix this threw AnalyzerParseError ("syntax error at or near \"safe$$\"");
    // the fix must let this real, valid PostgreSQL be classified like any other DO block.
    const result = await analyzeSql(sql, rules);

    expect(result.verdict).toBe("BLOCKED");
    const dropFinding = result.findings.find((f) => f.ruleIds.includes("drop-table"));
    expect(dropFinding).toBeDefined();
    expect(dropFinding!.verdict).toBe("BLOCKED");
  });

  it("a CREATE FUNCTION body with a custom outer tag embedding a $$-tagged literal is also classified, not a parse failure", async () => {
    const rules = loadDefaultRules();
    const sql = `
      CREATE FUNCTION f() RETURNS void AS $body$
      BEGIN
        PERFORM quote_literal($$safe$$);
        TRUNCATE ingredients;
      END;
      $body$ LANGUAGE plpgsql;
    `;

    const result = await analyzeSql(sql, rules);

    expect(result.verdict).toBe("BLOCKED");
    const truncateFinding = result.findings.find((f) => f.ruleIds.includes("truncate"));
    expect(truncateFinding).toBeDefined();
  });

  it("a body embedding a genuinely tricky sequence of adjacent dollar-quoted literals (multiple collisions with the naive $$ delimiter) still classifies correctly", async () => {
    const rules = loadDefaultRules();
    const sql = `
      DO $outer$
      BEGIN
        PERFORM quote_literal($$one$$) || quote_literal($$two$$);
        DROP TABLE orders;
      END;
      $outer$ LANGUAGE plpgsql;
    `;

    const result = await analyzeSql(sql, rules);

    expect(result.verdict).toBe("BLOCKED");
    expect(result.findings.some((f) => f.ruleIds.includes("drop-table"))).toBe(true);
  });

  it("a harmless body embedding a $$-tagged literal (no hidden hazard) is SAFE, not a parse failure -- the fix does not just make everything BLOCKED", async () => {
    const rules = loadDefaultRules();
    const sql = `
      DO $outer$
      BEGIN
        PERFORM quote_literal($$hello$$);
      END;
      $outer$ LANGUAGE plpgsql;
    `;

    const result = await analyzeSql(sql, rules);

    expect(result.verdict).toBe("SAFE");
    expect(result.findings.some((f) => f.ruleIds.includes("do-block-container"))).toBe(true);
  });
});
