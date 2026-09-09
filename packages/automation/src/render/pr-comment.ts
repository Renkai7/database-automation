// D-16/D-17 (05-CONTEXT.md): the pure AnalysisResult[] -> markdown renderer for the `analyze`
// job's sticky pull-request comment. Never a fetch, never node:fs, never an import from outside
// packages/automation/src (D25) -- the GitHub plumbing lives entirely in the thin adapter,
// scripts/ci/analyze-gate.ts. This module is importable with zero I/O, the same discipline
// packages/automation/src/types.ts's own header states for itself.
//
// D-06 carries 04-CONTEXT.md D-05 into CI unchanged: BLOCKED fails the required check, REVIEW
// REQUIRED passes it and is shown in full -- never a summary, never a truncation ("and N more").
// D-07: the check's authority is the whole committed migration history; the two sections below
// ("introduced by this pull request" vs "pre-existing, already applied") are presentation only,
// computed from the caller-supplied `introducedPaths` set -- this module knows nothing about git
// or the GitHub API and never derives that split itself.
//
import { VERDICT_SEVERITY, type AnalysisResult, type Verdict } from "../types";

/** The first line of every rendered comment, so a human -- and any future tooling -- can
 * identify the workflow's own comment among a pull request's other comments. `gh pr comment
 * --edit-last` already scopes "last comment" to the authenticated actor, so this marker is not
 * load-bearing for find-and-update; it exists for human legibility. */
export const PR_COMMENT_MARKER = "<!-- database-automation:safety-verdict -->";

/** The exact shape `cli.ts --json` emits: one entry per analysed file, each carrying its own
 * complete AnalysisResult plus the source path. */
export type AnalyzedFile = { path: string } & AnalysisResult;

export interface RenderPrCommentOptions {
  /** D-07's grouping input: paths (matching `AnalyzedFile.path` exactly) introduced by this
   * pull request. Every other analysed path renders under "pre-existing, already applied." */
  introducedPaths: ReadonlySet<string>;
}

const VERDICT_MEANING: Record<Verdict, string> = {
  SAFE: "SAFE passes this check. Nothing below is classified as risky.",
  REVIEW_REQUIRED:
    "REVIEW REQUIRED passes this check (D-06) -- it is not a build failure, and every finding " +
    "is shown below in full for human review.",
  BLOCKED:
    "BLOCKED fails this check. This pull request cannot merge until the classification changes.",
};

function worstVerdict(files: ReadonlyArray<AnalyzedFile>): Verdict {
  let worst: Verdict = "SAFE";
  for (const file of files) {
    if (VERDICT_SEVERITY[file.verdict] > VERDICT_SEVERITY[worst]) {
      worst = file.verdict;
    }
  }
  return worst;
}

/** T-05-15: escapes a value that may contain hostile markdown structure -- author-controlled SQL
 * text, file paths, and rationale strings, rendered onto a public pull request. Backticks are
 * individually escaped, which also neutralises a triple-fence sequence one character at a time;
 * pipes are escaped defensively against a future table-shaped revision of this renderer; angle
 * brackets are entity-escaped so a rationale can never be read as HTML on the pull request it is
 * posted to. Every interpolated value in this module passes through this function -- the
 * rendered document's structure is determined by this renderer, never by its input. */
export function escapeForComment(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("`", "\\`")
    .replaceAll("|", "\\|")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderFile(file: AnalyzedFile): string {
  const lines: string[] = [`#### ${escapeForComment(file.path)} -- ${file.verdict}`];
  if (file.findings.length === 0) {
    lines.push("- No findings were produced for this file.");
    return lines.join("\n");
  }
  for (const finding of file.findings) {
    const ruleIds =
      finding.ruleIds.length > 0
        ? finding.ruleIds.map((id) => escapeForComment(id)).join(", ")
        : "(no rule matched)";
    const rationale =
      finding.rationales.length > 0
        ? finding.rationales.map((text) => escapeForComment(text)).join(" ")
        : "(no rationale provided)";
    lines.push(
      `- Statement ${finding.statementIndex}: **${finding.verdict}** -- rules: ${ruleIds} -- ${rationale}`,
    );
  }
  return lines.join("\n");
}

function renderSection(title: string, files: ReadonlyArray<AnalyzedFile>): string {
  const lines: string[] = [`### ${title}`, ""];
  if (files.length === 0) {
    lines.push("_None._");
    return lines.join("\n");
  }
  for (const file of files) {
    lines.push(renderFile(file));
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

/** D-16/D-17: renders the complete, pure markdown verdict for the `analyze` job's sticky
 * comment. Never truncates, never summarises -- every finding's statement index, verdict, full
 * rule-id list and full rationale text appears verbatim (D-06). */
export function renderPrComment(
  files: ReadonlyArray<AnalyzedFile>,
  options: RenderPrCommentOptions,
): string {
  const worst = worstVerdict(files);
  const introduced = files.filter((file) => options.introducedPaths.has(file.path));
  const preExisting = files.filter((file) => !options.introducedPaths.has(file.path));
  const totalFindings = files.reduce((sum, file) => sum + file.findings.length, 0);

  const lines: string[] = [
    PR_COMMENT_MARKER,
    "",
    `## Migration Safety Verdict: ${worst}`,
    "",
    VERDICT_MEANING[worst],
    "",
  ];

  if (totalFindings === 0) {
    lines.push("No findings were produced -- every classified statement is SAFE.", "");
  }

  lines.push(renderSection("Introduced by this pull request", introduced), "");
  lines.push(renderSection("Pre-existing (already applied)", preExisting), "");
  lines.push(
    "---",
    "",
    "This check's authority covers the whole committed migration history; the grouping above is " +
      "presentation only. This comment is a display of the current verdict, not an audit record " +
      "(D-08).",
  );

  return lines.join("\n");
}

/** D-08/T-05-14 (05-CONTEXT.md), Task 3: rendered when the analyzer itself could not produce a
 * verdict (exit 30 parse failure, exit 40 invalid rules file) -- there is no AnalysisResult[] to
 * render in either case. The heading deliberately never contains the word BLOCKED: a broken
 * analyzer is reported as a broken analyzer, never mislabelled as a destructive-migration verdict
 * (03-CONTEXT.md D-08, 04-CONTEXT.md D-08). `reason` and `detail` are escaped exactly like every
 * other interpolated value in this module -- `detail` in particular may echo raw analyzer stderr
 * output, which is hostile input by the same reasoning as a rationale string. */
export function renderAnalyzerFailureComment(reason: string, detail: string): string {
  return [
    PR_COMMENT_MARKER,
    "",
    "## Migration Safety Check: Could Not Run",
    "",
    "The analyzer could not produce a verdict for this pull request. This is not a classification " +
      "of any migration as safe, reviewable, or destructive -- the check still fails until the " +
      "underlying problem is fixed.",
    "",
    `**Reason:** ${escapeForComment(reason)}`,
    "",
    escapeForComment(detail),
    "",
    "---",
    "",
    "This check's authority covers the whole committed migration history; the grouping above is " +
      "presentation only. This comment is a display of the current verdict, not an audit record " +
      "(D-08).",
  ].join("\n");
}
