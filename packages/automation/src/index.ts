// D-12: the public barrel. Phase 4's runner (and anything else consuming this package
// in-process) imports from here rather than reaching into individual src/ modules directly.
export { analyzeSql } from "./analyze";
export { DEFAULT_JOURNAL_PATH, DEFAULT_MIGRATIONS_DIR, enumerateMigrationFiles } from "./adapter/drizzle-migrations";
export type { Journal, JournalEntry, MigrationFile } from "./adapter/drizzle-migrations";
export { loadDefaultRules } from "./adapter/default-rules";
export { loadRules } from "./classifier/classify";
export * from "./types";

// D-16/D-17 (05-CONTEXT.md): the pure PR-comment renderer for the `analyze` job.
export { PR_COMMENT_MARKER, renderAnalyzerFailureComment, renderPrComment } from "./render/pr-comment";
export type { AnalyzedFile } from "./render/pr-comment";

// D-27: Phase 4's runner core -- the local entry point (scripts/db-migrate.ts) and any future
// harness (Testcontainers history tests) import exclusively from here, never by reaching into
// individual src/runner/ modules directly.
export type { RunnerClient } from "./runner/client";
export {
  assertTimeoutsInEffect,
  LOCK_TIMEOUT_MS,
  RUNNER_CONNECTION_OPTIONS,
  STATEMENT_TIMEOUT_MS,
} from "./runner/timeouts";
export { RUNNER_EXIT_CODES } from "./runner/exit-codes";
export type { RunnerExitCode } from "./runner/exit-codes";
export { splitStatements } from "./runner/split-statements";
export type { SplitStatement } from "./runner/split-statements";
export { decideTransactionPolicy, MixedTransactionFileError } from "./runner/transaction-policy";
export type { TransactionPolicy } from "./runner/transaction-policy";
export { ensureDrizzleLedger, migrationHash } from "./runner/ledger";
export {
  ensureRunnerTable,
  readInvalidIndexes,
  readUnresolvedMarkers,
  resolveMarker,
  UnresolvedMarkerError,
} from "./runner/runner-table";
export type { InvalidIndex, RunEntryState, UnresolvedMarker } from "./runner/runner-table";
export { MigrationRefusedError, runMigrations } from "./runner/run-migrations";
export type { RunMigrationsOptions, RunReport, RunReportEntry } from "./runner/run-migrations";
