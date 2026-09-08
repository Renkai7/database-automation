// ANLZ-06 gap fill (Nyquist audit, phase 03): the committed docs/30-squawk-comparison.md report
// can silently drift from the corpus manifest it was generated from -- nothing previously
// asserted that every manifest row appears in the committed report, that every disagreement was
// actually explained (rather than left as the generator's own "_TBD_" placeholder), or that the
// report's own stated row count matches what it actually contains. This suite is a pure file
// read against the committed report and the committed manifest; it never re-runs the generator
// and never re-writes docs/30-squawk-comparison.md, because doing so would destroy the
// hand-written disagreement analysis the report carries (the generator always emits "_TBD_" for
// both disagreement fields).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCorpusManifest } from "./corpus-manifest-schema";

const REPO_ROOT = join(__dirname, "..", "..", "..");
const REPORT_PATH = join(REPO_ROOT, "docs", "30-squawk-comparison.md");
const MANIFEST_PATH = join(REPO_ROOT, "packages", "automation", "test", "corpus", "manifest.json");

function loadReport(): string {
  return readFileSync(REPORT_PATH, "utf-8");
}

describe("docs/30-squawk-comparison.md stays in sync with the corpus manifest (ANLZ-06)", () => {
  it("contains a comparison-table row for every corpus manifest entry", () => {
    const manifest = loadCorpusManifest(MANIFEST_PATH);
    const report = loadReport();

    const missing = manifest.entries
      .map((entry) => entry.file)
      .filter((file) => !report.includes(`\`${file}\``));

    expect(
      missing,
      "Every corpus manifest entry's file path must appear in the committed " +
        "docs/30-squawk-comparison.md report -- a fixture added after the report was last " +
        "regenerated is a report that has silently gone stale, not a passing check.",
    ).toEqual([]);
  });

  it("carries no surviving _TBD_ placeholder in any disagreement's verdict or reason", () => {
    const report = loadReport();

    expect(
      report,
      "The committed report must not contain the generator's own \"_TBD_\" placeholder text -- " +
        "every disagreement's \"Verdict on the disagreement\" and \"Reason\" fields must be " +
        "hand-filled before the report is committed. A regenerated-but-not-re-annotated report " +
        "must fail loudly here rather than pass as though it had been explained.",
    ).not.toContain("_TBD_");
  });

  it("states a row count and a 'Corpus files compared' figure that match what the table actually contains", () => {
    const report = loadReport();

    // Count actual data rows in the "## Comparison table" section: lines that start with "| `"
    // (a file-path cell), which excludes the header and separator rows.
    const tableSectionMatch = report.match(/## Comparison table[\s\S]*?(?=\n## )/);
    expect(
      tableSectionMatch,
      "Could not locate the '## Comparison table' section in docs/30-squawk-comparison.md.",
    ).not.toBeNull();
    const tableSection = tableSectionMatch![0];
    const actualRowCount = tableSection
      .split("\n")
      .filter((line) => line.startsWith("| `")).length;

    const statedFilesCompared = report.match(/\*\*Corpus files compared:\*\*\s*(\d+)/);
    expect(
      statedFilesCompared,
      "Could not locate the 'Corpus files compared' figure in the report's Run metadata section.",
    ).not.toBeNull();
    expect(
      Number(statedFilesCompared![1]),
      "The report's stated 'Corpus files compared' figure must match the number of rows the " +
        "comparison table actually contains, not be trusted prose left over from an earlier run.",
    ).toBe(actualRowCount);

    const statedTableHeading = report.match(/## Comparison table \((\d+) rows\)/);
    expect(
      statedTableHeading,
      "Could not locate the '## Comparison table (N rows)' heading in the report.",
    ).not.toBeNull();
    expect(
      Number(statedTableHeading![1]),
      "The '## Comparison table (N rows)' heading must match the number of rows the table " +
        "actually contains.",
    ).toBe(actualRowCount);
  });
});
