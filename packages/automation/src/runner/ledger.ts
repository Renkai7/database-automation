// D-04/D-12: the byte-compatible `drizzle.__drizzle_migrations` ledger writer. Replicates
// `drizzle-orm@0.45.2`'s own `migrator.js`/`pg-core/dialect.js` table shape and comparison
// exactly (read directly from the installed package, `04-RESEARCH.md` Code Examples) so
// `drizzle-kit generate`/`check` and `scripts/verify-migration-state.ts` (which counts rows in
// this table) keep working unchanged against rows this runner writes.
//
// No `pg` import (D-28): every function here takes an injected `RunnerClient` and never opens a
// connection itself.
import { createHash } from "node:crypto";
import type { RunnerClient } from "./client";

/** sha256 hex digest of the WHOLE raw migration file text -- never per-statement, never the
 * split statements re-joined. This is drizzle's own hashing scheme (`04-RESEARCH.md` Code
 * Examples), replicated exactly so D-04's byte-compatibility promise is never silently broken. */
export function migrationHash(rawFileText: string): string {
  return createHash("sha256").update(rawFileText).digest("hex");
}

/** Creates the drizzle-owned ledger schema/table if it does not already exist -- the exact
 * shape drizzle's own migrator bootstraps (D-04): no extra columns, no different types, no
 * different schema name. */
export async function ensureDrizzleLedger(client: RunnerClient): Promise<void> {
  await client.query("CREATE SCHEMA IF NOT EXISTS drizzle");
  await client.query(
    "CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations " +
      "(id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)",
  );
}

/** The most recently applied row's `created_at`, or `null` when the ledger holds no rows yet.
 * Replicates drizzle's own "is this migration new?" comparison target
 * (`lastDbMigration.created_at`, `04-RESEARCH.md` Code Examples). */
export async function readLastAppliedMillis(client: RunnerClient): Promise<number | null> {
  const { rows } = await client.query<{ created_at: string | number | null }>(
    "SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC NULLS LAST LIMIT 1",
  );
  const value = rows[0]?.created_at;
  return value === undefined || value === null ? null : Number(value);
}

/** Inserts one ledger row. `createdAtMillis` MUST be the journal entry's own `when` field --
 * never `Date.now()` and never execution wall-clock time (D-04). `hash` is a `sha256` hex
 * digest (safe to embed as a quoted literal), but this still escapes single quotes defensively
 * rather than trusting the caller. `RunnerClient` exposes no bind-parameter mechanism (D-28's
 * minimal client shape), so building a safely-quoted literal here is this module's equivalent
 * of parameterisation. */
export async function insertLedgerRow(
  client: RunnerClient,
  hash: string,
  createdAtMillis: number,
): Promise<void> {
  const escapedHash = hash.replace(/'/g, "''");
  await client.query(
    `INSERT INTO drizzle.__drizzle_migrations ("hash", "created_at") ` +
      `VALUES ('${escapedHash}', ${Math.trunc(createdAtMillis)})`,
  );
}
