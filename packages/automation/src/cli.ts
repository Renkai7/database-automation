// D-12: a thin CLI over analyzeSql. This is the presentation layer over the library -- file
// reading and argument parsing live here, never in the core (src/analyze.ts stays a pure
// function of SQL text plus rules, D-11). Accepting a path argument is safe here in a way
// 02-CONTEXT.md D-06 refused for the restore commands, because this command opens no database
// connection at all and only reads text.
//
// Exit-code mapping uses EXIT_CODES (src/types.ts) exclusively: the worst verdict across all
// analysed inputs maps to its code, an AnalyzerParseError maps to PARSE_FAILURE, and a
// RulesFileError maps to RULES_INVALID and is raised before any file is analysed -- a rules
// file that cannot be trusted means no verdict can be. No other parameter, flag, or environment
// variable exists that could route around EXIT_CODES or the rules file this loads (must_haves
// prohibition: no surface may emit a verdict weaker than rules-plus-floor produce). Every other
// error propagates and Node exits 1 on its own, which is precisely why no outcome here uses
// that number.
//
// DISCOVERED THIS SESSION (Rule 1 deviation, see 03-03-SUMMARY.md): `run()` below returns its
// intended exit code rather than calling `process.exit()` anywhere, and the code is applied via
// `process.exitCode` at the very end, letting Node's event loop drain naturally instead of
// forcing termination. A synchronous `process.exit()` called immediately after two or more
// `libpg-query` WASM parse calls reproduced a genuine Windows libuv crash on this machine
// ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\\win\\async.c, line 94",
// exit code 3221226505) -- forcing the process closed while libuv was still tearing down a WASM
// module's own async handle. `process.exitCode` sidesteps the race entirely.
import { readFileSync } from "node:fs";
import { safeErrorMessage } from "../../../scripts/log";
import { loadDefaultRules } from "./adapter/default-rules";
import { enumerateMigrationFiles } from "./adapter/drizzle-migrations";
import { analyzeSql } from "./analyze";
import type { RulesFile } from "./classifier/rules-schema";
import {
  AnalyzerParseError,
  EXIT_CODES,
  RulesFileError,
  VERDICT_SEVERITY,
  type AnalysisResult,
  type Verdict,
} from "./types";

interface InputFile {
  path: string;
  sql: string;
}

interface FileResult {
  path: string;
  result: AnalysisResult;
}

/** D-10/CI-05: a verdict is never printed without its reasoning -- every finding line carries
 * the statement index, the verdict, the matched rule ids and the rationale text. */
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

/** Reads every path's text, or -- if `migrationsMode` -- sources inputs from
 * `enumerateMigrationFiles` instead. Returns `null` (having already printed the reason) when a
 * path cannot be read, so the caller can map that failure to EXIT_CODES.PARSE_FAILURE without
 * this function knowing about exit codes itself. */
function collectInputs(paths: string[], migrationsMode: boolean): InputFile[] | null {
  if (migrationsMode) {
    // enumerateMigrationFiles's own journal/file mismatch errors are adapter-level integrity
    // failures, not a D-08 parse failure or a D-02 rules-file failure -- they propagate to
    // run()'s own caller and exit 1, distinct from every EXIT_CODES value.
    return enumerateMigrationFiles().map((migration) => ({ path: migration.path, sql: migration.sql }));
  }

  const inputs: InputFile[] = [];
  for (const path of paths) {
    try {
      inputs.push({ path, sql: readFileSync(path, "utf-8") });
    } catch (error) {
      console.error(`${path}: could not read file (${safeErrorMessage(error)})`);
      return null;
    }
  }
  return inputs;
}

/** Runs the whole CLI and returns the intended process exit code -- never calls
 * `process.exit()` itself (see the header comment for why). */
async function run(): Promise<number> {
  const rawArgs = process.argv.slice(2);
  const jsonMode = rawArgs.includes("--json");
  const migrationsMode = rawArgs.includes("--migrations");
  const paths = rawArgs.filter((arg) => arg !== "--json" && arg !== "--migrations");
  if (!migrationsMode && paths.length === 0) {
    console.error("Usage: db:analyze [--json] [--migrations] <migration.sql> [more.sql ...]");
    return 1;
  }

  // D-02: a rules file that fails schema validation, or that weakens a D-02 floor operation,
  // is raised BEFORE any file is analysed -- a rules file that cannot be trusted means no
  // verdict can be, for any input.
  let rules: RulesFile;
  try {
    rules = loadDefaultRules();
  } catch (error) {
    if (error instanceof RulesFileError) {
      console.error(`Rules file invalid: ${error.message}`);
      return EXIT_CODES.RULES_INVALID;
    }
    throw error;
  }

  const inputs = collectInputs(paths, migrationsMode);
  if (inputs === null) {
    return EXIT_CODES.PARSE_FAILURE;
  }

  const fileResults: FileResult[] = [];
  let worstVerdict: Verdict = "SAFE";

  // D-10: never short-circuit -- every input file gets its own findings and its own report
  // section, even when an earlier one was BLOCKED, so fixing one problem does not just reveal
  // the next on the following run.
  for (const { path, sql } of inputs) {
    let result: AnalysisResult;
    try {
      result = await analyzeSql(sql, rules);
    } catch (error) {
      if (error instanceof AnalyzerParseError) {
        // D-08: a parse failure is a hard error, not a verdict -- print no verdict line for
        // this file, and exit distinctly from every three-tier verdict.
        console.error(`${path}: PARSE FAILURE: ${error.message}`);
        return EXIT_CODES.PARSE_FAILURE;
      }
      throw error;
    }

    fileResults.push({ path, result });
    if (VERDICT_SEVERITY[result.verdict] > VERDICT_SEVERITY[worstVerdict]) {
      worstVerdict = result.verdict;
    }
  }

  if (jsonMode) {
    // The complete machine contract Phase 5 renders and Phase 7 records: every AnalysisResult
    // serialised whole (including its complete findings list, rule ids and rationale text),
    // tagged with its source path -- never trimmed for brevity.
    console.log(JSON.stringify(fileResults.map((entry) => ({ path: entry.path, ...entry.result })), null, 2));
  } else {
    for (const fileResult of fileResults) {
      printHumanReport(fileResult);
    }
  }

  return EXIT_CODES[worstVerdict];
}

run()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(safeErrorMessage(error));
    process.exitCode = 1;
  });
