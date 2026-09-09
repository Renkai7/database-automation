// D-16/D-17 (05-CONTEXT.md), CI-04: fixture-driven proof of `renderPrComment` -- in-memory
// AnalyzedFile[] values only, no filesystem, no network. Proves the marker's position, D-06's
// "never a summary" rule (every rule id and every rationale verbatim), D-07's introduced/
// pre-existing grouping, and the worst-verdict heading.
import { describe, expect, it } from "vitest";
import { EMPTY_FACTS, type Finding } from "../types";
import {
  renderAnalyzerFailureComment,
  renderPrComment,
  PR_COMMENT_MARKER,
  type AnalyzedFile,
} from "./pr-comment";

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    statementIndex: 0,
    nestedPath: [],
    verdict: "SAFE",
    ruleIds: [],
    rationales: [],
    facts: EMPTY_FACTS,
    pairedWith: null,
    ...overrides,
  };
}

function analyzedFile(overrides: Partial<AnalyzedFile> = {}): AnalyzedFile {
  return {
    path: "apps/recipe-app/drizzle/0000_example.sql",
    verdict: "SAFE",
    findings: [finding()],
    statementCount: 1,
    rulesVersion: 1,
    ...overrides,
  };
}

describe("renderPrComment", () => {
  it("puts the marker on the first line", () => {
    const output = renderPrComment([analyzedFile()], { introducedPaths: new Set() });
    expect(output.split("\n")[0]).toBe(PR_COMMENT_MARKER);
  });

  it("includes every rule id and every rationale verbatim for a BLOCKED file, never a summary", () => {
    const blocked = analyzedFile({
      path: "apps/recipe-app/drizzle/0005_blocked.sql",
      verdict: "BLOCKED",
      findings: [
        finding({
          verdict: "BLOCKED",
          ruleIds: ["ban-drop-table", "ban-drop-schema"],
          rationales: [
            "DROP TABLE destroys data with no rollback path.",
            "A second, distinct rationale sentence for this same finding.",
          ],
        }),
      ],
    });
    const output = renderPrComment([blocked], { introducedPaths: new Set([blocked.path]) });
    expect(output).toContain("ban-drop-table");
    expect(output).toContain("ban-drop-schema");
    expect(output).toContain("DROP TABLE destroys data with no rollback path.");
    expect(output).toContain("A second, distinct rationale sentence for this same finding.");
  });

  it("renders a file in introducedPaths under the introduced heading and one absent under pre-existing", () => {
    const introduced = analyzedFile({ path: "apps/recipe-app/drizzle/0005_new.sql" });
    const preExisting = analyzedFile({ path: "apps/recipe-app/drizzle/0001_busy_thunderbolt.sql" });
    const output = renderPrComment([introduced, preExisting], {
      introducedPaths: new Set([introduced.path]),
    });

    const introducedIndex = output.indexOf("### Introduced by this pull request");
    const preExistingIndex = output.indexOf("### Pre-existing (already applied)");
    const introducedSection = output.slice(introducedIndex, preExistingIndex);
    const preExistingSection = output.slice(preExistingIndex);

    expect(introducedSection).toContain(introduced.path);
    expect(introducedSection).not.toContain(preExisting.path);
    expect(preExistingSection).toContain(preExisting.path);
    expect(preExistingSection).not.toContain(introduced.path);
  });

  it("names the worst verdict across all files in the heading, even when files disagree", () => {
    const safe = analyzedFile({ path: "apps/recipe-app/drizzle/0000.sql", verdict: "SAFE" });
    const review = analyzedFile({ path: "apps/recipe-app/drizzle/0001.sql", verdict: "REVIEW_REQUIRED" });
    const blocked = analyzedFile({ path: "apps/recipe-app/drizzle/0002.sql", verdict: "BLOCKED" });

    expect(
      renderPrComment([safe, review], { introducedPaths: new Set() }),
    ).toContain("## Migration Safety Verdict: REVIEW_REQUIRED");
    expect(
      renderPrComment([safe, review, blocked], { introducedPaths: new Set() }),
    ).toContain("## Migration Safety Verdict: BLOCKED");
    expect(
      renderPrComment([safe], { introducedPaths: new Set() }),
    ).toContain("## Migration Safety Verdict: SAFE");
  });

  it("states the check's authority covers the whole history while the grouping is presentation only", () => {
    const output = renderPrComment([analyzedFile()], { introducedPaths: new Set() });
    expect(output).toContain("whole committed migration history");
    expect(output).toContain("presentation only");
    expect(output).toContain("not an audit record");
  });

  it("renders an explicit statement, not an empty section, when every file is SAFE with zero findings", () => {
    const allSafeNoFindings = [
      analyzedFile({ path: "apps/recipe-app/drizzle/0000.sql", verdict: "SAFE", findings: [] }),
      analyzedFile({ path: "apps/recipe-app/drizzle/0001.sql", verdict: "SAFE", findings: [] }),
    ];
    const output = renderPrComment(allSafeNoFindings, { introducedPaths: new Set() });
    expect(output.length).toBeGreaterThan(0);
    expect(output).toContain("No findings were produced -- every classified statement is SAFE.");
  });

  it("escapes hostile content in a rationale, a rule id, and a path without breaking the comment's structure", () => {
    const hostile = analyzedFile({
      path: "apps/recipe-app/drizzle/0005_<script>|hostile`.sql",
      verdict: "BLOCKED",
      findings: [
        finding({
          verdict: "BLOCKED",
          ruleIds: ["ban-`drop`-table|pipe"],
          rationales: [
            "A rationale with a backtick `, a pipe |, an angle bracket <tag>, and a ```triple-fence``` sequence.",
          ],
        }),
      ],
    });
    const output = renderPrComment([hostile], { introducedPaths: new Set([hostile.path]) });

    expect(output.split("\n")[0]).toBe(PR_COMMENT_MARKER);
    const introducedCount = output.split("### Introduced by this pull request").length - 1;
    const preExistingCount = output.split("### Pre-existing (already applied)").length - 1;
    expect(introducedCount).toBe(1);
    expect(preExistingCount).toBe(1);
    // The raw triple-fence sequence must never survive unescaped -- each backtick is escaped
    // individually, so the literal "```",  never appears in the output.
    expect(output).not.toContain("```triple-fence```");
    expect(output).not.toContain("<script>");
    expect(output).not.toContain("<tag>");
  });
});

describe("renderAnalyzerFailureComment", () => {
  it("never contains the word BLOCKED", () => {
    const output = renderAnalyzerFailureComment(
      "The rules file is invalid and the analyzer refused to start.",
      "RulesFileError: unexpected field \"foo\"",
    );
    expect(output).not.toContain("BLOCKED");
  });

  it("puts the marker on the first line and states this is not a verdict", () => {
    const output = renderAnalyzerFailureComment("Parse failure.", "Unexpected token at line 3.");
    expect(output.split("\n")[0]).toBe(PR_COMMENT_MARKER);
    expect(output).toContain("could not produce a verdict");
  });

  it("escapes hostile content in the reason and detail strings", () => {
    const output = renderAnalyzerFailureComment(
      "Reason with a `backtick` and a | pipe.",
      "Detail with <angle> brackets and a ```fence```.",
    );
    expect(output.split("\n")[0]).toBe(PR_COMMENT_MARKER);
    expect(output).not.toContain("<angle>");
    expect(output).not.toContain("```fence```");
  });
});
