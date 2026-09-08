// D-12: a thin CLI over analyzeSql. This is the presentation layer over the library -- file
// reading and argument parsing live here, never in the core (src/analyze.ts stays a pure
// function of SQL text plus rules, D-11). Accepting a path argument is safe here in a way
// 02-CONTEXT.md D-06 refused for the restore commands, because this command is read-only and
// never touches a database.
import { readFileSync } from "node:fs";
import { safeErrorMessage } from "../../../scripts/log";
import { loadDefaultRules } from "./adapter/default-rules";
import { analyzeSql } from "./analyze";
import { AnalyzerParseError, EXIT_CODES, VERDICT_SEVERITY, type AnalysisResult, type Verdict } from "./types";

function usageAndExit(): never {
  console.error("Usage: db:analyze [--json] <migration.sql> [more.sql ...]");
  process.exit(1);
}

interface FileResult {
  path: string;
  result: AnalysisResult;
}

function printHumanReport({ path, result }: FileResult): void {
  console.log(`${path}: ${result.verdict}`);
  for (const finding of result.findings) {
    const ruleIds = finding.ruleIds.length > 0 ? finding.ruleIds.join(", ") : "(no rule matched)";
    const rationale = finding.rationales.length > 0 ? finding.rationales.join(" ") : "";
    console.log(
      `  statement ${finding.statementIndex}: ${finding.verdict} [${ruleIds}] ${rationale}`.trimEnd(),
    );
  }
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const jsonMode = rawArgs.includes("--json");
  const paths = rawArgs.filter((arg) => arg !== "--json");
  if (paths.length === 0) {
    usageAndExit();
  }

  const rules = loadDefaultRules();

  const fileResults: FileResult[] = [];
  let worstVerdict: Verdict = "SAFE";

  for (const path of paths) {
    let sql: string;
    try {
      sql = readFileSync(path, "utf-8");
    } catch (error) {
      console.error(`${path}: could not read file (${safeErrorMessage(error)})`);
      process.exit(EXIT_CODES.PARSE_FAILURE);
    }

    let result: AnalysisResult;
    try {
      result = await analyzeSql(sql, rules);
    } catch (error) {
      if (error instanceof AnalyzerParseError) {
        // D-08: a parse failure is a hard error, not a verdict -- print no verdict line for
        // this file, and exit distinctly from every three-tier verdict.
        console.error(`${path}: PARSE FAILURE: ${error.message}`);
        process.exit(EXIT_CODES.PARSE_FAILURE);
      }
      throw error;
    }

    fileResults.push({ path, result });
    if (VERDICT_SEVERITY[result.verdict] > VERDICT_SEVERITY[worstVerdict]) {
      worstVerdict = result.verdict;
    }
  }

  if (jsonMode) {
    console.log(JSON.stringify(fileResults.map((entry) => ({ path: entry.path, ...entry.result })), null, 2));
  } else {
    for (const fileResult of fileResults) {
      printHumanReport(fileResult);
    }
  }

  process.exit(EXIT_CODES[worstVerdict]);
}

main().catch((error: unknown) => {
  console.error(safeErrorMessage(error));
  process.exit(1);
});
