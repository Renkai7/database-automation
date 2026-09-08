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

export type RunEntryState = "applied" | "refused" | "failed" | "in_flight";

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
