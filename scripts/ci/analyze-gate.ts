// D-16/D-17 (05-CONTEXT.md): the thin adapter that owns the `analyze` job end to end. One
// process runs the analyzer, computes the D-07 introduced/pre-existing split, renders the pure
// markdown comment (packages/automation/src/render/pr-comment.ts), posts it via the GitHub CLI,
// and derives the job's own exit code from the analyzer's exit code (D-06) -- all in the same
// process, so a verdict and the report of that verdict can never disagree.
//
// Reads PR_NUMBER/PR_BASE_SHA/PR_HEAD_SHA from the environment, never process.argv -- every
// command in this repository refuses arguments (01-CONTEXT.md D-16, 02-CONTEXT.md D-06). Never
// calls process.exit() -- sets process.exitCode once run() settles, matching every other
// scripts/*.ts entry point in this repo (packages/automation/src/cli.ts's own header documents
// the reproduced Windows libuv crash this convention exists to avoid).
//
// Task 3: the non-verdict outcomes. When the analyzer exits PARSE_FAILURE (30) or RULES_INVALID
// (40) there is no AnalysisResult[] to parse -- commentBodyForAnalyzerRun below routes those two
// codes (and any exit code this module cannot otherwise recognise as a verdict) to
// renderAnalyzerFailureComment instead of attempting JSON.parse on non-JSON output.
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import {
  DEFAULT_MIGRATIONS_DIR,
  EXIT_CODES,
  renderAnalyzerFailureComment,
  renderPrComment,
  type AnalyzedFile,
} from "../../packages/automation/src/index";
import { safeErrorMessage } from "../log";

export interface JobExitResult {
  exitCode: number;
  reason: string;
}

/** D-06's exit-code mapping, derived from EXIT_CODES rather than re-typed numbers. SAFE and
 * REVIEW_REQUIRED pass the job (04-CONTEXT.md D-05 carried into CI unchanged); BLOCKED, a parse
 * failure and an invalid rules file all fail it, each with its own distinct reason so "the
 * analyzer is broken" is never collapsed into "this migration is destructive"
 * (03-CONTEXT.md D-08, 04-CONTEXT.md D-08). Any other value also fails, closed by default. */
export function jobExitCodeForAnalyzerExit(code: number): JobExitResult {
  switch (code) {
    case EXIT_CODES.SAFE:
      return { exitCode: 0, reason: "Every migration in the committed history classified SAFE." };
    case EXIT_CODES.REVIEW_REQUIRED:
      return {
        exitCode: 0,
        reason:
          "At least one migration classified REVIEW REQUIRED. This passes the check with the " +
          "complete findings shown on the pull request (D-06).",
      };
    case EXIT_CODES.BLOCKED:
      return {
        exitCode: 1,
        reason:
          "At least one migration in the committed history classified BLOCKED. This migration " +
          "is destructive and the check fails.",
      };
    case EXIT_CODES.PARSE_FAILURE:
      return {
        exitCode: 1,
        reason:
          "The analyzer could not parse this SQL. This is not a verdict about any migration -- " +
          "it means the analyzer itself could not run to completion.",
      };
    case EXIT_CODES.RULES_INVALID:
      return {
        exitCode: 1,
        reason:
          "The rules file is invalid and the analyzer refused to start. This is not a verdict " +
          "about any migration.",
      };
    default:
      return {
        exitCode: 1,
        reason: `The analyzer exited with an unrecognised code (${code}). Treated as a failure, closed by default.`,
      };
  }
}

/** Parses `git diff --name-only <base> <head> -- apps/recipe-app/drizzle/` output (one
 * repository-relative path per line, forward-slash on every platform this workflow runs on --
 * ubuntu-latest only, D-12) into the set D-07's introduced/pre-existing grouping needs. */
export function introducedMigrationPaths(nameStatusOutput: string): Set<string> {
  const paths = new Set<string>();
  for (const rawLine of nameStatusOutput.split("\n")) {
    const path = rawLine.trim();
    if (path.length > 0) {
      paths.add(path);
    }
  }
  return paths;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[analyze-gate] Missing required environment variable "${name}".`);
  }
  return value;
}

export interface AnalyzeGateOutcome {
  commentBody: string;
  jobExitCode: number;
  reason: string;
}

/** WR-02 (05-REVIEW.md): the single function whose output determines BOTH the posted PR comment
 * and the job's own exit code, so the two can never independently disagree about whether the
 * check actually passed. Previously the job's exit code was derived purely from
 * `analyzerExitCode` via `jobExitCodeForAnalyzerExit`, while the comment body was computed
 * separately and could fall back to the failure-comment renderer (whose text says "the check
 * still fails") on a verdict exit code (SAFE/REVIEW_REQUIRED) whose JSON output could not be
 * parsed or rendered -- producing a *passing*, required `analyze` check next to a PR comment that
 * directly contradicted it. Now: a verdict exit code whose stdout cannot be parsed and rendered
 * fails the job (`jobExitCode: 1`), using the SAME reason string that lands in the comment. This
 * stays distinct from both a genuinely passing verdict and a genuine BLOCKED verdict -- "the
 * analyzer's own JSON contract is broken" is never collapsed into "this migration is destructive"
 * (03-CONTEXT.md D-08, 04-CONTEXT.md D-08); PARSE_FAILURE (exit 30) and RULES_INVALID (exit 40)
 * keep their own distinct reasons via `jobExitCodeForAnalyzerExit`, untouched by this function. */
export function resolveAnalyzeGateOutcome(
  analyzerExitCode: number,
  stdout: string,
  stderr: string,
  introducedPaths: ReadonlySet<string>,
): AnalyzeGateOutcome {
  const { exitCode: jobExitCode, reason } = jobExitCodeForAnalyzerExit(analyzerExitCode);
  const isVerdictExit =
    analyzerExitCode === EXIT_CODES.SAFE ||
    analyzerExitCode === EXIT_CODES.REVIEW_REQUIRED ||
    analyzerExitCode === EXIT_CODES.BLOCKED;

  if (isVerdictExit) {
    try {
      const files = JSON.parse(stdout) as AnalyzedFile[];
      return { commentBody: renderPrComment(files, { introducedPaths }), jobExitCode, reason };
    } catch (error) {
      const renderFailureReason =
        "The analyzer reported a verdict exit code but its JSON output could not be parsed.";
      return {
        commentBody: renderAnalyzerFailureComment(renderFailureReason, safeErrorMessage(error)),
        // WR-02: a render/parse failure on what would otherwise be a passing (SAFE/
        // REVIEW_REQUIRED) or BLOCKED exit must fail the job -- a check that could not actually
        // report its verdict is not a check that passed (01-CONTEXT.md D-20, 02-CONTEXT.md
        // D-19/D-20). This is deliberately `1`, not `jobExitCode`, so a SAFE/REVIEW_REQUIRED
        // analyzer exit paired with corrupted stdout can never pass silently.
        jobExitCode: 1,
        reason: renderFailureReason,
      };
    }
  }

  const detail = stderr.trim().length > 0 ? stderr.trim() : "(no further detail captured on stderr)";
  return { commentBody: renderAnalyzerFailureComment(reason, detail), jobExitCode, reason };
}

/** Task 3: selects which renderer produces the comment body for a given analyzer run. A verdict
 * exit code (SAFE/REVIEW_REQUIRED/BLOCKED) has a real AnalysisResult[] on stdout and renders via
 * renderPrComment; every other exit code (PARSE_FAILURE, RULES_INVALID, or anything this module
 * does not recognise) has no AnalysisResult[] at all and renders via
 * renderAnalyzerFailureComment instead -- attempting JSON.parse on non-JSON output would throw
 * before the comment could ever be posted, and D-20 requires posting SOMETHING that explains
 * why the check failed. A verdict-exit JSON parse failure (the analyzer's own contract broken)
 * also falls back to the failure comment rather than propagating an uncaught exception. Retained
 * as a thin wrapper around `resolveAnalyzeGateOutcome` (the single source of truth WR-02 added)
 * for the existing direct unit tests of the comment-body branching in isolation, and exported for
 * the same reason. */
export function commentBodyForAnalyzerRun(
  analyzerExitCode: number,
  stdout: string,
  stderr: string,
  introducedPaths: ReadonlySet<string>,
): string {
  return resolveAnalyzeGateOutcome(analyzerExitCode, stdout, stderr, introducedPaths).commentBody;
}

/** Runs the whole `analyze` job and returns the intended process exit code. Posts the comment
 * BEFORE returning a failing exit code -- a BLOCKED run is exactly the run whose reasoning must
 * reach the pull request. If the `gh` call itself fails, that failure alone fails the job
 * regardless of the analyzer's own verdict: a check that could not report is not a check that
 * passed (01-CONTEXT.md D-20). */
async function runAnalyzeGate(): Promise<number> {
  const prNumber = requireEnv("PR_NUMBER");
  const baseSha = requireEnv("PR_BASE_SHA");
  const headSha = requireEnv("PR_HEAD_SHA");

  const diffResult = await execa("git", [
    "diff",
    "--name-only",
    baseSha,
    headSha,
    "--",
    `${DEFAULT_MIGRATIONS_DIR}/`,
  ]);
  const introducedPaths = introducedMigrationPaths(diffResult.stdout);

  // `pnpm exec tsx ...` invokes the binary directly -- unlike `pnpm db:analyze:migrations`
  // (`pnpm run <script>`), which prints a "> package@version scriptname" banner to stdout ahead
  // of the actual output on every platform this was checked against (confirmed live: both this
  // repo's own Windows dev machine and the real ubuntu-latest runner from this task's own PR
  // #1). That banner corrupts JSON.parse below -- `pnpm exec` never prints it, matching
  // scripts/history-suite.ts's own established `execa("pnpm", ["exec", ...])` convention.
  const analyzeResult = await execa(
    "pnpm",
    ["exec", "tsx", "packages/automation/src/cli.ts", "--migrations", "--json"],
    { reject: false },
  );
  const analyzerExitCode = analyzeResult.exitCode ?? 1;
  // WR-02 (05-REVIEW.md): commentBody and jobExitCode both come from this one call now, so they
  // can never independently disagree about whether the check passed.
  const { commentBody, jobExitCode, reason } = resolveAnalyzeGateOutcome(
    analyzerExitCode,
    analyzeResult.stdout,
    analyzeResult.stderr,
    introducedPaths,
  );

  const commentFile = join(tmpdir(), `analyze-gate-comment-${process.pid}.md`);
  await writeFile(commentFile, commentBody, "utf-8");

  const commentResult = await execa(
    "gh",
    ["pr", "comment", prNumber, "--body-file", commentFile, "--edit-last", "--create-if-none"],
    { reject: false },
  );

  if ((commentResult.exitCode ?? 1) !== 0) {
    console.error(
      `[analyze-gate] Could not post the pull-request comment (gh exited ${commentResult.exitCode}): ` +
        `${commentResult.stderr || commentResult.stdout || "(no output captured)"}`,
    );
    // 01-CONTEXT.md D-20: a check that could not report is not a check that passed.
    return 1;
  }

  console.log(`[analyze-gate] ${reason}`);
  return jobExitCode;
}

if (import.meta.main) {
  runAnalyzeGate()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(safeErrorMessage(error));
      process.exitCode = 1;
    });
}
