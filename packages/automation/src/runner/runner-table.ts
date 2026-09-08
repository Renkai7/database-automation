// D-19: the runner-owned sidecar table -- everything `drizzle.__drizzle_migrations` has no room
// for (verdict, findings, timings, wrap/unwrap, and -- from plan 04-05 onward -- in-flight and
// failure state). Lives in its own `runner` schema, outside `public`, for the same reason
// `drizzle.__drizzle_migrations` lives outside `public`.
//
// Bootstrapped by the runner itself with `CREATE ... IF NOT EXISTS` at first connect, deliberately
// NOT a committed Drizzle migration: (a) the runner needs the table to exist in order to record
// the run that creates it, (b) `drizzle-kit generate` diffs `schema.ts` and this is runner
// infrastructure, not application schema, and (c) RUN-05's "expected schema" assertions must stay
// a statement about the application's schema.
//
// This task (04-01) produces "applied", "refused" and "failed" entries; "in_flight" is wired in
// plan 04-05 and "resolved" is added there too.
//
// No `pg` import (D-28): every function here takes an injected `RunnerClient`.
import { z } from "zod";
import type { RunnerClient } from "./client";

export const RUNNER_SCHEMA_NAME = "runner";
export const RUNNER_RUNS_TABLE = "runner.migration_runs";

export type RunEntryState = "applied" | "refused" | "failed" | "in_flight" | "resolved";

/** One row to record in `runner.migration_runs`. */
export interface RunEntry {
  runId: string;
  migrationTag: string;
  migrationIdx: number;
  sqlSha256: string;
  verdict: string;
  findings: unknown;
  wrapped: boolean;
  state: RunEntryState;
  statementIndex: number | null;
  statementCount: number;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  rulesVersion: number;
}

/** Validated on every read (never trust the write path), mirroring
 * `scripts/drill-status.ts`'s own discipline. */
const RunRowSchema = z.object({
  id: z.union([z.string(), z.number()]),
  run_id: z.string(),
  migration_tag: z.string(),
  migration_idx: z.number(),
  sql_sha256: z.string(),
  verdict: z.string(),
  findings: z.unknown(),
  wrapped: z.boolean(),
  state: z.enum(["applied", "refused", "failed", "in_flight"]),
  statement_index: z.number().nullable(),
  statement_count: z.number(),
  error_message: z.string().nullable(),
  started_at: z.union([z.string(), z.date()]),
  finished_at: z.union([z.string(), z.date()]).nullable(),
  duration_ms: z.number().nullable(),
  rules_version: z.number(),
});

/** Fields `writeInFlightMarker` inserts at the moment execution of the single unwrapped
 * statement is about to begin -- `verdict`/`findings`/`rulesVersion` come straight from the
 * `AnalysisResult` that already classified this file; `statementIndex`/`statementCount` come
 * from the split that already ran. There is exactly one statement in this branch
 * (`decideTransactionPolicy`'s own contract), so `statementIndex` is always `0`. */
export interface InFlightMarkerEntry {
  runId: string;
  migrationTag: string;
  migrationIdx: number;
  sqlSha256: string;
  verdict: string;
  findings: unknown;
  statementIndex: number;
  statementCount: number;
  rulesVersion: number;
  startedAt: string;
}

/** The subset of a `runner.migration_runs` row `db:migrate:recover` and `readUnresolvedMarkers`
 * need -- validated on every read, never trusted from the write path. */
export interface UnresolvedMarker {
  id: number;
  runId: string;
  migrationTag: string;
  migrationIdx: number;
  verdict: string;
  statementIndex: number | null;
  statementCount: number;
  wrapped: boolean;
  state: "in_flight" | "failed";
  errorMessage: string | null;
  startedAt: string;
}

const UnresolvedMarkerRowSchema = z.object({
  id: z.union([z.string(), z.number()]),
  run_id: z.string(),
  migration_tag: z.string(),
  migration_idx: z.number(),
  verdict: z.string(),
  statement_index: z.number().nullable(),
  statement_count: z.number(),
  wrapped: z.boolean(),
  state: z.enum(["in_flight", "failed"]),
  error_message: z.string().nullable(),
  started_at: z.union([z.string(), z.date()]),
});

/** One PostgreSQL index `pg_index` reports as `indisvalid = false` -- the one and only residual
 * partial state D-11's mixed-file refusal leaves possible: a failed `CREATE INDEX CONCURRENTLY`
 * (or its `UNIQUE`/`REINDEX` cousins). */
export interface InvalidIndex {
  schema: string;
  table: string;
  indexName: string;
}

const InvalidIndexRowSchema = z.object({
  schema: z.string(),
  table: z.string(),
  index_name: z.string(),
});

/** D-20/RUN-08: thrown when `readUnresolvedMarkers` finds anything -- carries the complete list
 * of offending markers so the caller (`run-migrations.ts`) can build a message naming every one
 * of them, never just the first. */
export class UnresolvedMarkerError extends Error {
  readonly markers: UnresolvedMarker[];
  constructor(markers: UnresolvedMarker[]) {
    super(
      markers
        .map(
          (marker) =>
            `${marker.migrationTag} (journal idx ${marker.migrationIdx}): statement ` +
            `${marker.statementIndex ?? "?"} of ${marker.statementCount} is unresolved ` +
            `(state=${marker.state}). Run "pnpm db:migrate:recover" before applying any ` +
            "further migrations.",
        )
        .join(" "),
    );
    this.name = "UnresolvedMarkerError";
    this.markers = markers;
  }
}

/** Creates the runner's own schema/table if it does not already exist. */
export async function ensureRunnerTable(client: RunnerClient): Promise<void> {
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${RUNNER_SCHEMA_NAME}`);
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${RUNNER_RUNS_TABLE} (` +
      "id bigserial primary key, " +
      "run_id uuid not null, " +
      "migration_tag text not null, " +
      "migration_idx integer not null, " +
      "sql_sha256 text not null, " +
      "verdict text not null, " +
      "findings jsonb not null, " +
      "wrapped boolean not null, " +
      "state text not null, " +
      "statement_index integer, " +
      "statement_count integer not null, " +
      "error_message text, " +
      "started_at timestamptz not null default now(), " +
      "finished_at timestamptz, " +
      "duration_ms integer, " +
      "rules_version integer not null" +
      ")",
  );
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlNullableString(value: string | null): string {
  return value === null ? "NULL" : sqlString(value);
}

function sqlNullableNumber(value: number | null): string {
  return value === null ? "NULL" : String(value);
}

function sqlBoolean(value: boolean): string {
  return value ? "TRUE" : "FALSE";
}

/** Inserts one run-report row through safely-quoted values -- `RunnerClient` exposes no
 * bind-parameter mechanism (D-28's minimal client shape), so this is the runner's own
 * equivalent of parameterisation: every value is escaped/quoted here, never raw string
 * concatenation of a value this module did not itself construct or validate. */
export async function recordRunEntry(client: RunnerClient, entry: RunEntry): Promise<void> {
  const columns = [
    "run_id",
    "migration_tag",
    "migration_idx",
    "sql_sha256",
    "verdict",
    "findings",
    "wrapped",
    "state",
    "statement_index",
    "statement_count",
    "error_message",
    "started_at",
    "finished_at",
    "duration_ms",
    "rules_version",
  ];
  const values = [
    sqlString(entry.runId),
    sqlString(entry.migrationTag),
    String(Math.trunc(entry.migrationIdx)),
    sqlString(entry.sqlSha256),
    sqlString(entry.verdict),
    `${sqlString(JSON.stringify(entry.findings))}::jsonb`,
    sqlBoolean(entry.wrapped),
    sqlString(entry.state),
    sqlNullableNumber(entry.statementIndex),
    String(Math.trunc(entry.statementCount)),
    sqlNullableString(entry.errorMessage),
    sqlString(entry.startedAt),
    entry.finishedAt === null ? "NULL" : sqlString(entry.finishedAt),
    sqlNullableNumber(entry.durationMs),
    String(Math.trunc(entry.rulesVersion)),
  ];
  await client.query(
    `INSERT INTO ${RUNNER_RUNS_TABLE} (${columns.join(", ")}) VALUES (${values.join(", ")})`,
  );
}

/** Reads back every row for one run, validating each through `RunRowSchema` -- never trusting
 * the write path (mirrors `scripts/drill-status.ts`'s validate-on-every-read discipline). */
export async function readRunEntries(
  client: RunnerClient,
  runId: string,
): Promise<Array<z.infer<typeof RunRowSchema>>> {
  const { rows } = await client.query<Record<string, unknown>>(
    `SELECT * FROM ${RUNNER_RUNS_TABLE} WHERE run_id = ${sqlString(runId)} ORDER BY id ASC`,
  );
  return rows.map((row) => RunRowSchema.parse(row));
}

// D-18: the in-flight marker lifecycle. `writeInFlightMarker` is issued BEFORE an unwrapped
// statement executes; the SAME row is later transitioned in place -- to `applied` on success
// (`markMarkerApplied`, run-migrations.ts's own concern) or to `failed` on error
// (`markMarkerFailed`) -- rather than a second row ever being inserted for the same migration.
// This keeps the one-row-per-migration shape `recordRunEntry` already establishes for every
// other branch (BLOCKED, mixed file, wrapped success/failure) intact for the unwrapped branch
// too, which `tests/history/empty-db-full-history.test.ts` (04-03) already asserts on: every row
// sharing a run's `run_id` has `state = 'applied'` after a normal, fully-successful run.

/** Inserts one in-flight marker row (state `in_flight`, `wrapped: false`) BEFORE the unwrapped
 * statement it describes executes, returning the row's `id` so the caller can transition the
 * SAME row later. Never resolved by this function -- see `markMarkerApplied`/`markMarkerFailed`
 * (the ordinary run-migrations.ts outcomes) and `resolveMarker` (the recovery command's own
 * outcome, for a marker a PRIOR run left behind). */
export async function writeInFlightMarker(
  client: RunnerClient,
  entry: InFlightMarkerEntry,
): Promise<number> {
  const columns = [
    "run_id",
    "migration_tag",
    "migration_idx",
    "sql_sha256",
    "verdict",
    "findings",
    "wrapped",
    "state",
    "statement_index",
    "statement_count",
    "error_message",
    "started_at",
    "finished_at",
    "duration_ms",
    "rules_version",
  ];
  const values = [
    sqlString(entry.runId),
    sqlString(entry.migrationTag),
    String(Math.trunc(entry.migrationIdx)),
    sqlString(entry.sqlSha256),
    sqlString(entry.verdict),
    `${sqlString(JSON.stringify(entry.findings))}::jsonb`,
    sqlBoolean(false),
    sqlString("in_flight"),
    String(Math.trunc(entry.statementIndex)),
    String(Math.trunc(entry.statementCount)),
    "NULL",
    sqlString(entry.startedAt),
    "NULL",
    "NULL",
    String(Math.trunc(entry.rulesVersion)),
  ];
  const { rows } = await client.query<{ id: string | number }>(
    `INSERT INTO ${RUNNER_RUNS_TABLE} (${columns.join(", ")}) VALUES (${values.join(", ")}) RETURNING id`,
  );
  return Number(rows[0].id);
}

/** run-migrations.ts's own success outcome for the unwrapped branch: transitions the SAME marker
 * row from `in_flight` to `applied` in place -- never a second row, so a successful unwrapped
 * migration ends up with exactly one row, exactly like every other successful branch. */
export async function markMarkerApplied(
  client: RunnerClient,
  id: number,
  finishedAt: string,
  durationMs: number,
): Promise<void> {
  await client.query(
    `UPDATE ${RUNNER_RUNS_TABLE} SET state = ${sqlString("applied")}, finished_at = ` +
      `${sqlString(finishedAt)}, duration_ms = ${Math.trunc(durationMs)} WHERE id = ${Math.trunc(id)}`,
  );
}

/** run-migrations.ts's own failure outcome for the unwrapped branch: transitions the SAME marker
 * row from `in_flight` to `failed` in place -- left deliberately unresolved (D-20). The next
 * run's `readUnresolvedMarkers` finds this exact row, naming the same migration and statement
 * that failed, never a second, separately-inserted "failed" row. */
export async function markMarkerFailed(
  client: RunnerClient,
  id: number,
  errorMessage: string,
  finishedAt: string,
): Promise<void> {
  await client.query(
    `UPDATE ${RUNNER_RUNS_TABLE} SET state = ${sqlString("failed")}, error_message = ` +
      `${sqlString(errorMessage)}, finished_at = ${sqlString(finishedAt)} WHERE id = ${Math.trunc(id)}`,
  );
}

/** D-21: `db:migrate:recover`'s own outcome for a marker a PRIOR run left behind (`in_flight`
 * from a crash, or `failed` from an unwrapped statement that genuinely failed) -- updates the
 * row's `state` to `resolved` and sets `finished_at`. Never `DELETE`s: this table is the
 * substrate Phase 7's audit log is built on, and an audit trail that erases its own hard cases
 * is not an audit trail. */
export async function resolveMarker(client: RunnerClient, id: number): Promise<void> {
  await client.query(
    `UPDATE ${RUNNER_RUNS_TABLE} SET state = ${sqlString("resolved")}, finished_at = now() ` +
      `WHERE id = ${Math.trunc(id)}`,
  );
}

/** D-20: every row a run must refuse to proceed past -- `state = 'in_flight'` (a process killed
 * mid-flight, which no caught-error handler could have recorded) or `state = 'failed' AND
 * wrapped = false` (an unwrapped statement that genuinely failed and was never resolved). A
 * WRAPPED failure is deliberately excluded: its statements and its ledger row rolled back
 * together in the same transaction (D-12), so nothing is left behind in the database for a stale
 * marker to describe -- there is nothing to recover from. Validates every returned row through
 * `UnresolvedMarkerRowSchema` before handing it out, never trusting the write path. */
export async function readUnresolvedMarkers(client: RunnerClient): Promise<UnresolvedMarker[]> {
  const { rows } = await client.query<Record<string, unknown>>(
    "SELECT id, run_id, migration_tag, migration_idx, verdict, statement_index, " +
      "statement_count, wrapped, state, error_message, started_at " +
      `FROM ${RUNNER_RUNS_TABLE} WHERE state = 'in_flight' OR (state = 'failed' AND wrapped = ` +
      "false) ORDER BY id ASC",
  );
  return rows.map((row) => {
    const parsed = UnresolvedMarkerRowSchema.parse(row);
    return {
      id: Number(parsed.id),
      runId: parsed.run_id,
      migrationTag: parsed.migration_tag,
      migrationIdx: parsed.migration_idx,
      verdict: parsed.verdict,
      statementIndex: parsed.statement_index,
      statementCount: parsed.statement_count,
      wrapped: parsed.wrapped,
      state: parsed.state,
      errorMessage: parsed.error_message,
      startedAt:
        parsed.started_at instanceof Date ? parsed.started_at.toISOString() : parsed.started_at,
    };
  });
}

/** D-19: the one and only residual partial state D-11's mixed-file refusal leaves possible --
 * every index `pg_index` reports as `indisvalid = false`, joined to `pg_class`/`pg_namespace`
 * for readable schema/table/index names. `db:migrate:recover` prints this so the operator learns
 * about it without having to know to look. */
export async function readInvalidIndexes(client: RunnerClient): Promise<InvalidIndex[]> {
  const { rows } = await client.query<Record<string, unknown>>(
    "SELECT n.nspname AS schema, t.relname AS table, i.relname AS index_name " +
      "FROM pg_index idx " +
      "JOIN pg_class i ON i.oid = idx.indexrelid " +
      "JOIN pg_class t ON t.oid = idx.indrelid " +
      "JOIN pg_namespace n ON n.oid = i.relnamespace " +
      "WHERE idx.indisvalid = false " +
      "ORDER BY n.nspname, t.relname, i.relname",
  );
  return rows.map((row) => {
    const parsed = InvalidIndexRowSchema.parse(row);
    return { schema: parsed.schema, table: parsed.table, indexName: parsed.index_name };
  });
}
