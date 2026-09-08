// D-27: the runner core's orchestrator -- classify-then-execute, migration by migration, in
// ascending journal `idx` order. Takes only `migrations`, `rules`, and an injectable `now` --
// deliberately no other parameter, flag, or environment read exists that could reach the
// refusal branch (RUN-02, D-02's "no override, ever";
// `packages/automation/test/run-migrations.test.ts`'s options-key-set assertion proves this).
//
// D-01: `analyzeSql` is called on the EXACT string already in memory (`file.sql`) -- never a
// second read of the migration's path. `splitStatements` (D-03) parses that same buffer a
// second time, so the executed statements and the classified statement are provably the same
// bytes.
//
// D-08: a parse failure means "no verdict", and "no verdict" can never mean "proceed" -- for
// THIS run's whole pending set, not merely the file that failed to parse. Every pending
// migration is classified BEFORE any of them is executed (phase A below), so a parse failure
// anywhere in the set aborts before a single statement runs, satisfying D-08's literal
// "applying nothing at all" -- not even an earlier, already-classified-valid migration in the
// same run. A BLOCKED verdict, discovered only once execution begins (phase B), stops the run
// but does not undo migrations already applied earlier in that same phase (D-02: "apply nothing
// further").
import { randomUUID } from "node:crypto";
import { safeErrorMessage } from "../../../../scripts/log";
import type { MigrationFile } from "../adapter/drizzle-migrations";
import { analyzeSql } from "../analyze";
import type { RulesFile } from "../classifier/rules-schema";
import { AnalyzerParseError, VERDICT_SEVERITY, type AnalysisResult, type Finding, type Verdict } from "../types";
import type { RunnerClient } from "./client";
import { RUNNER_EXIT_CODES } from "./exit-codes";
import { insertLedgerRow, migrationHash, readLastAppliedMillis } from "./ledger";
import { recordRunEntry, type RunEntryState } from "./runner-table";
import { splitStatements } from "./split-statements";
import { decideTransactionPolicy, MixedTransactionFileError } from "./transaction-policy";

export interface RunMigrationsOptions {
  migrations: MigrationFile[];
  rules: RulesFile;
  now?: () => Date;
}

export interface RunReportEntry {
  tag: string;
  idx: number;
  verdict: Verdict | null;
  state: "skipped" | RunEntryState;
  statementCount: number;
  wrapped: boolean | null;
  durationMs: number | null;
}

export interface RunReport {
  runId: string;
  entries: RunReportEntry[];
  worstVerdict: Verdict;
}

/** D-02/RUN-02: refused execution of one migration file (BLOCKED verdict, a parse failure, or a
 * mid-execution failure). The carried `code` is the runner's OWN exit-code contract
 * (`exit-codes.ts`), never `packages/automation`'s analyzer `EXIT_CODES` (Pitfall 3). */
export class MigrationRefusedError extends Error {
  readonly code: number;
  constructor(message: string, code: number) {
    super(message);
    this.name = "MigrationRefusedError";
    this.code = code;
  }
}

/** D-05/D-06: the complete findings list printed BEFORE executing a REVIEW_REQUIRED migration --
 * every rule id and every rationale, never a summary. */
function printReviewRequiredFindings(tag: string, findings: Finding[]): void {
  console.log(`[db:migrate] ${tag}: REVIEW_REQUIRED -- proceeding locally. Findings:`);
  for (const finding of findings) {
    const ruleIds = finding.ruleIds.length > 0 ? finding.ruleIds.join(", ") : "(no rule matched)";
    const rationale = finding.rationales.length > 0 ? finding.rationales.join(" ") : "";
    console.log(
      `  statement ${finding.statementIndex}: ${finding.verdict} [${ruleIds}] ${rationale}`.trimEnd(),
    );
  }
}

async function applyMigration(
  client: RunnerClient,
  runId: string,
  file: MigrationFile,
  result: AnalysisResult,
  now: () => Date,
): Promise<RunReportEntry> {
  const hash = migrationHash(file.sql);
  const startedAt = now();

  // D-09/D-11: the wrap-or-refuse decision, derived only from the analyzer's own facts
  // (transaction-policy.ts). A mixed file is refused here, BEFORE splitStatements/execution --
  // record a "refused" run entry with the complete findings and stop the run, exactly as the
  // BLOCKED branch above does. No statement from this file ever reaches the client.
  let wrap: boolean;
  try {
    const policy = decideTransactionPolicy(result.findings);
    wrap = policy.wrap;
  } catch (error) {
    if (!(error instanceof MixedTransactionFileError)) {
      throw error;
    }
    const finishedAt = now();
    await recordRunEntry(client, {
      runId,
      migrationTag: file.tag,
      migrationIdx: file.idx,
      sqlSha256: hash,
      verdict: result.verdict,
      findings: result.findings,
      wrapped: false,
      state: "refused",
      statementIndex: null,
      statementCount: 0,
      errorMessage: safeErrorMessage(error),
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      rulesVersion: result.rulesVersion,
    });
    throw new MigrationRefusedError(
      `${file.tag}: ${safeErrorMessage(error)}`,
      RUNNER_EXIT_CODES.REFUSED_MIXED_FILE,
    );
  }

  const statements = await splitStatements(file.sql);
  let currentStatementIndex: number | null = null;

  try {
    if (wrap) {
      await client.query("BEGIN");
    }
    for (let index = 0; index < statements.length; index += 1) {
      currentStatementIndex = index;
      // D-03/Pitfall 1: one client.query() call PER split statement -- never a whole-file query,
      // which would silently reintroduce PostgreSQL's own implicit multi-statement transaction
      // wrapping regardless of whether an explicit BEGIN was issued.
      await client.query(statements[index].text);
    }
    currentStatementIndex = null;
    // D-12: the ledger row is inserted inside the SAME transaction as the statements, so
    // "applied" and "recorded" can never disagree.
    await insertLedgerRow(client, hash, file.when);
    if (wrap) {
      await client.query("COMMIT");
    }
  } catch (error) {
    if (wrap) {
      await client.query("ROLLBACK");
    }
    const finishedAt = now();
    await recordRunEntry(client, {
      runId,
      migrationTag: file.tag,
      migrationIdx: file.idx,
      sqlSha256: hash,
      verdict: result.verdict,
      findings: result.findings,
      wrapped: wrap,
      state: "failed",
      statementIndex: currentStatementIndex,
      statementCount: statements.length,
      errorMessage: safeErrorMessage(error),
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      rulesVersion: result.rulesVersion,
    });
    throw new MigrationRefusedError(
      `${file.tag}: execution failed -- ${safeErrorMessage(error)}`,
      RUNNER_EXIT_CODES.EXECUTION_FAILED,
    );
  }

  const finishedAt = now();
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  await recordRunEntry(client, {
    runId,
    migrationTag: file.tag,
    migrationIdx: file.idx,
    sqlSha256: hash,
    verdict: result.verdict,
    findings: result.findings,
    wrapped: wrap,
    state: "applied",
    statementIndex: null,
    statementCount: statements.length,
    errorMessage: null,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs,
    rulesVersion: result.rulesVersion,
  });

  return {
    tag: file.tag,
    idx: file.idx,
    verdict: result.verdict,
    state: "applied",
    statementCount: statements.length,
    wrapped: wrap,
    durationMs,
  };
}

/**
 * Classifies then executes every pending migration in `options.migrations`, in ascending `idx`
 * order. There is deliberately no parameter, flag, or environment read capable of weakening a
 * verdict -- see `packages/automation/test/run-migrations.test.ts` for the structural proof.
 */
export async function runMigrations(
  client: RunnerClient,
  options: RunMigrationsOptions,
): Promise<RunReport> {
  const { migrations, rules, now = () => new Date() } = options;
  const runId = randomUUID();
  const ordered = [...migrations].sort((a, b) => a.idx - b.idx);

  // Drizzle's own "is this migration new?" comparison (04-RESEARCH.md Code Examples), read once
  // up front -- nothing writes to the ledger until phase B below, so a single read here reflects
  // the true starting state for every migration this run will consider.
  const lastAppliedMillis = await readLastAppliedMillis(client);
  const pending = ordered.filter(
    (file) => lastAppliedMillis === null || lastAppliedMillis < file.when,
  );
  const pendingTags = new Set(pending.map((file) => file.tag));
  const skippedEntries: RunReportEntry[] = ordered
    .filter((file) => !pendingTags.has(file.tag))
    .map((file) => ({
      tag: file.tag,
      idx: file.idx,
      verdict: null,
      state: "skipped",
      statementCount: 0,
      wrapped: null,
      durationMs: null,
    }));

  // Phase A: classify EVERY pending migration before executing ANY of them. D-08's "applying
  // nothing at all" on a parse failure means literally nothing in this run's pending set
  // touches the database -- not just the file that failed to parse.
  const classified: Array<{ file: MigrationFile; result: AnalysisResult }> = [];
  for (const file of pending) {
    let result: AnalysisResult;
    try {
      result = await analyzeSql(file.sql, rules);
    } catch (error) {
      if (error instanceof AnalyzerParseError) {
        throw new MigrationRefusedError(
          `${file.tag}: parse failure -- ${safeErrorMessage(error)}. No migration in this run applied.`,
          RUNNER_EXIT_CODES.REFUSED_PARSE_FAILURE,
        );
      }
      throw error;
    }
    classified.push({ file, result });
  }

  let worstVerdict: Verdict = "SAFE";
  const appliedEntries: RunReportEntry[] = [];

  // Phase B: execute in ascending idx order. A BLOCKED verdict stops the whole run (D-02) but
  // does not undo migrations already applied earlier in THIS loop.
  for (const { file, result } of classified) {
    if (VERDICT_SEVERITY[result.verdict] > VERDICT_SEVERITY[worstVerdict]) {
      worstVerdict = result.verdict;
    }

    if (result.verdict === "BLOCKED") {
      const hash = migrationHash(file.sql);
      const timestamp = now().toISOString();
      await recordRunEntry(client, {
        runId,
        migrationTag: file.tag,
        migrationIdx: file.idx,
        sqlSha256: hash,
        verdict: result.verdict,
        findings: result.findings,
        wrapped: false,
        state: "refused",
        statementIndex: null,
        statementCount: 0,
        errorMessage: "BLOCKED verdict -- refused with no override",
        startedAt: timestamp,
        finishedAt: timestamp,
        durationMs: 0,
        rulesVersion: result.rulesVersion,
      });
      throw new MigrationRefusedError(
        `${file.tag}: BLOCKED -- refused. No flag, environment variable, or configuration ` +
          "value can change this outcome.",
        RUNNER_EXIT_CODES.REFUSED_BLOCKED,
      );
    }

    if (result.verdict === "REVIEW_REQUIRED") {
      printReviewRequiredFindings(file.tag, result.findings);
    }

    appliedEntries.push(await applyMigration(client, runId, file, result, now));
  }

  const entries = [...skippedEntries, ...appliedEntries].sort((a, b) => a.idx - b.idx);

  return { runId, entries, worstVerdict };
}
