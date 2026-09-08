// D-15 (03-CONTEXT.md): the one-time squawk-cli comparison generator (03-07-PLAN.md Task 1).
// Not imported by anything under src/, and no test in the fast suite depends on it or on
// squawk-cli being installed -- this is a re-runnable dev script, not a standing pipeline
// stage. Run via `pnpm analyze:squawk-comparison` from the repo root.
//
// Sources its file list from loadCorpusManifest (the same manifest packages/automation's own
// test harness reads) so this analyzer and squawk see exactly the identical corpus -- nobody
// keeps a second file list in step by hand.
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { loadDefaultRules } from "../src/adapter/default-rules";
import { analyzeSql } from "../src/analyze";
import type { Verdict } from "../src/types";
import { loadCorpusManifest, type CorpusEntry } from "../test/corpus-manifest-schema";

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const AUTOMATION_DIR = join(SCRIPT_DIR, "..");
const REPO_ROOT = join(AUTOMATION_DIR, "..", "..");
const MANIFEST_PATH = join(AUTOMATION_DIR, "test", "corpus", "manifest.json");
// Fixed filename, no timestamp in the path -- RESEARCH.md Pitfall 5. The run's own timestamp
// is recorded inside the file's content instead (see buildReport below), which sidesteps the
// Windows colon-in-filename hazard scripts/backup-manifest.ts's compactTimestamp exists to fix,
// rather than reintroducing it here for a report that does not need a dated filename at all.
const REPORT_PATH = join(REPO_ROOT, "docs", "30-squawk-comparison.md");

// D9's project-wide PostgreSQL 17 pin. Without this flag squawk applies its own default target
// version, and a version-conditional rule difference would show up as a disagreement to explain
// away when it is really a misconfiguration (03-RESEARCH.md Pattern 5).
const SQUAWK_PG_VERSION = "17.0";

interface SquawkFinding {
  file: string;
  line: number;
  column: number;
  level: string;
  message: string;
  help: string | null;
  rule_name: string;
  column_end: number;
  line_end: number;
}

type SquawkOutcome =
  | { status: "ok"; findings: SquawkFinding[] }
  | { status: "unknown"; reason: string };

interface ComparisonRow {
  entry: CorpusEntry;
  analyzerVerdict: Verdict;
  analyzerRuleIds: string[];
  squawk: SquawkOutcome;
  agreement: "agree" | "disagree" | "UNKNOWN";
}

/**
 * Runs squawk against one absolute file path and returns its findings, or an honest "unknown"
 * outcome if squawk's output cannot be trusted. Pitfall 4: squawk's own process exit code is
 * non-zero whenever it finds ANY violation -- its normal "violations found" signal, not a
 * process failure -- so `reject: false` is used and stdout/exitCode/signal are read
 * independently rather than treating a non-zero exit as a thrown error. Only unparseable
 * stdout or a signal-terminated process is treated as a genuine failure, per that same
 * pitfall and this plan's integrity section: never fabricate or hand-simulate squawk output,
 * record UNKNOWN instead.
 */
async function runSquawkOnFile(absolutePath: string): Promise<SquawkOutcome> {
  const result = await execa(
    "squawk",
    ["--reporter", "json", "--pg-version", SQUAWK_PG_VERSION, absolutePath],
    {
      reject: false,
      preferLocal: true,
      localDir: AUTOMATION_DIR,
    },
  );

  if (result.signal) {
    return { status: "unknown", reason: `squawk was killed by signal ${result.signal}` };
  }
  if (result.exitCode === null || result.exitCode === undefined) {
    return { status: "unknown", reason: "squawk did not report an exit code" };
  }

  try {
    const parsed = JSON.parse(result.stdout) as SquawkFinding[];
    return { status: "ok", findings: parsed };
  } catch (error) {
    return {
      status: "unknown",
      reason: `squawk stdout was not valid JSON (exit ${result.exitCode}): ${safeErrorMessage(error)}`,
    };
  }
}

/** D-15's agreement definition, applied literally: squawk flagged something on a file this
 * analyzer did not call SAFE, or squawk flagged nothing on a file this analyzer called SAFE.
 * Anything else -- including squawk's own session-timeout rules firing on an otherwise-SAFE
 * file -- is a disagreement Task 2 examines and explains; this function does not pre-filter
 * any squawk rule out of that comparison. */
function computeAgreement(analyzerVerdict: Verdict, squawk: SquawkOutcome): "agree" | "disagree" | "UNKNOWN" {
  if (squawk.status === "unknown") return "UNKNOWN";
  const squawkFlaggedSomething = squawk.findings.length > 0;
  const analyzerSaysSafe = analyzerVerdict === "SAFE";
  const agree =
    (squawkFlaggedSomething && !analyzerSaysSafe) || (!squawkFlaggedSomething && analyzerSaysSafe);
  return agree ? "agree" : "disagree";
}

function formatRuleIds(ids: string[]): string {
  return ids.length > 0 ? ids.map((id) => `\`${id}\``).join(", ") : "(none)";
}

function formatSquawk(squawk: SquawkOutcome): string {
  if (squawk.status === "unknown") return `UNKNOWN (${squawk.reason})`;
  if (squawk.findings.length === 0) return "(no findings)";
  const uniqueRuleNames = [...new Set(squawk.findings.map((finding) => finding.rule_name))].sort();
  return uniqueRuleNames.map((name) => `\`${name}\``).join(", ");
}

function agreementCell(agreement: ComparisonRow["agreement"]): string {
  if (agreement === "agree") return "agree";
  if (agreement === "disagree") return "**disagree**";
  return "UNKNOWN";
}

function buildReport(rows: ComparisonRow[], squawkVersion: string, runDate: string): string {
  const disagreements = rows.filter((row) => row.agreement === "disagree");
  const unknowns = rows.filter((row) => row.agreement === "UNKNOWN");

  const lines: string[] = [];
  lines.push("# squawk-cli comparison report");
  lines.push("");
  lines.push(
    "D-15's one-time calibration: this analyzer and squawk-cli, an independent, " +
      "externally-maintained PostgreSQL migration linter, run over the identical corpus, " +
      "and every disagreement between them is examined and explained below.",
  );
  lines.push("");
  lines.push("## Run metadata");
  lines.push("");
  lines.push(`- **Run date:** ${runDate}`);
  lines.push(`- **squawk version:** ${squawkVersion}`);
  lines.push(`- **PostgreSQL version pin:** ${SQUAWK_PG_VERSION} (D9's project-wide pin)`);
  lines.push(`- **Corpus files compared:** ${rows.length}`);
  lines.push("");
  lines.push("## What \"agreement\" means here");
  lines.push("");
  lines.push(
    "The two tools do not speak the same language: squawk emits lint warnings (zero or more " +
      "per file, no overall file-level verdict) and this analyzer emits a single three-tier " +
      "file verdict (SAFE / REVIEW_REQUIRED / BLOCKED). This report defines agreement as: " +
      "**squawk flagged something on a file this analyzer did not call SAFE, or squawk " +
      "flagged nothing on a file this analyzer called SAFE.** Anything else -- including " +
      "squawk flagging a SAFE-verdict file, or squawk flagging nothing on a REVIEW_REQUIRED " +
      "or BLOCKED file -- is a disagreement, examined by hand below.",
  );
  lines.push("");
  lines.push("## What this comparison does and does not establish");
  lines.push("");
  lines.push(
    "It establishes that two independently-built tools looking at the same SQL agree where " +
      "they should and differ only where a reason can be given. It does **not** establish " +
      "that either tool is correct -- both could share a blind spot -- and it is a one-time " +
      "calibration rather than a standing check (D-15): it goes stale the moment either " +
      "tool's rule catalogue changes. Anything this run could not determine is recorded as " +
      "UNKNOWN below, never smoothed over and never silently dropped.",
  );
  lines.push("");
  lines.push(`## Comparison table (${rows.length} rows)`);
  lines.push("");
  lines.push("| File | Group | Analyzer verdict | Analyzer rule ids | squawk rules | Agreement |");
  lines.push("|---|---|---|---|---|---|");
  for (const row of rows) {
    lines.push(
      `| \`${row.entry.file}\` | ${row.entry.group} | ${row.analyzerVerdict} | ` +
        `${formatRuleIds(row.analyzerRuleIds)} | ${formatSquawk(row.squawk)} | ${agreementCell(row.agreement)} |`,
    );
  }
  lines.push("");

  lines.push(`## Disagreements (${disagreements.length})`);
  lines.push("");
  if (disagreements.length === 0) {
    lines.push("None -- every row's agreement column reads \"agree\".");
  } else {
    lines.push(
      "Every row below needs one of exactly three labels -- **analyzer-correct**, " +
        "**squawk-correct**, or **different-by-design** -- each with a stated reason. " +
        "Placeholders below are filled in by hand, not generated: this generator records " +
        "*what* disagrees, not *why*.",
    );
    lines.push("");
    for (const row of disagreements) {
      lines.push(`### \`${row.entry.file}\``);
      lines.push("");
      lines.push(`- **Analyzer verdict:** ${row.analyzerVerdict} (${formatRuleIds(row.analyzerRuleIds)})`);
      lines.push(`- **squawk:** ${formatSquawk(row.squawk)}`);
      lines.push(`- **Corpus expectation:** ${row.entry.why}`);
      lines.push("- **Verdict on the disagreement:** _TBD_");
      lines.push("- **Reason:** _TBD_");
      lines.push("");
    }
  }

  lines.push(`## Rows this run could not establish (${unknowns.length})`);
  lines.push("");
  if (unknowns.length === 0) {
    lines.push("None -- squawk produced a parseable result for every corpus file.");
  } else {
    for (const row of unknowns) {
      lines.push(`- \`${row.entry.file}\`: ${(row.squawk as { reason: string }).reason}`);
    }
  }
  lines.push("");

  return lines.join("\n");
}

async function main(): Promise<void> {
  const manifest = loadCorpusManifest(MANIFEST_PATH);
  const rules = loadDefaultRules();

  const versionResult = await execa("squawk", ["--version"], {
    reject: false,
    preferLocal: true,
    localDir: AUTOMATION_DIR,
  });
  const squawkVersion = versionResult.exitCode === 0 ? versionResult.stdout.trim() : "UNKNOWN";

  const rows: ComparisonRow[] = [];
  for (const entry of manifest.entries) {
    const absolutePath = join(REPO_ROOT, entry.file);
    const sql = readFileSync(absolutePath, "utf-8");

    const analysis = await analyzeSql(sql, rules);
    const analyzerRuleIds = [...new Set(analysis.findings.flatMap((finding) => finding.ruleIds))].sort();

    const squawk = await runSquawkOnFile(absolutePath);
    const agreement = computeAgreement(analysis.verdict, squawk);

    rows.push({ entry, analyzerVerdict: analysis.verdict, analyzerRuleIds, squawk, agreement });
  }

  const runDate = new Date().toISOString();
  const report = buildReport(rows, squawkVersion, runDate);
  await writeFile(REPORT_PATH, report, "utf-8");

  const disagreementCount = rows.filter((row) => row.agreement === "disagree").length;
  const unknownCount = rows.filter((row) => row.agreement === "UNKNOWN").length;
  console.log(
    `[squawk-comparison] Wrote ${relative(REPO_ROOT, REPORT_PATH)}: ${rows.length} rows, ` +
      `${disagreementCount} disagreement(s), ${unknownCount} unknown.`,
  );
}

main().catch((error: unknown) => {
  console.error(safeErrorMessage(error));
  process.exit(1);
});
