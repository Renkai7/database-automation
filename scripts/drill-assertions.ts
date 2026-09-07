// D-13 tiers 1-2 (02-CONTEXT.md): scripts/drill.ts's re-query-never-trust-exit-code assertions
// against a restored database, following the same "re-query the real state, don't trust an
// exit code" shape scripts/verify-migration-state.ts established for `drizzle-kit migrate`.
// A standalone module with no module-load side effects, importable from a test without opening
// a database connection.
import { join } from "node:path";
import { sha256File, type BackupManifest } from "./backup-manifest";

interface QueryableClient {
  query(text: string): Promise<{ rows: unknown[] }>;
}

/**
 * Tier 1 (artifact integrity): recomputes the SHA-256 of both dump files on disk and requires
 * both to equal the manifest's recorded digests. Catches a corrupted or truncated dump that a
 * bare restore exit code would never reveal.
 */
export async function assertArtifactIntegrity(
  manifest: BackupManifest,
  destination: string,
): Promise<void> {
  const dataDumpPath = join(destination, manifest.dataDump.file);
  const actualDataSha256 = await sha256File(dataDumpPath);
  if (actualDataSha256 !== manifest.dataDump.sha256) {
    throw new Error(
      `Artifact integrity check failed for data dump "${manifest.dataDump.file}": recorded ` +
        `sha256 ${manifest.dataDump.sha256}, recomputed ${actualDataSha256}.`,
    );
  }

  const globalsDumpPath = join(destination, manifest.globalsDump.file);
  const actualGlobalsSha256 = await sha256File(globalsDumpPath);
  if (actualGlobalsSha256 !== manifest.globalsDump.sha256) {
    throw new Error(
      `Artifact integrity check failed for globals dump "${manifest.globalsDump.file}": ` +
        `recorded sha256 ${manifest.globalsDump.sha256}, recomputed ${actualGlobalsSha256}.`,
    );
  }
}

/**
 * Tier 2 (row counts): enumerates the restored database's tables the same schema-agnostic way
 * scripts/backup.ts did, requires the table *set* to equal the manifest's row-count key set
 * exactly (a table missing from the restore fails rather than being silently skipped), and
 * requires each count to match. Table names and row counts are not credentials and are safe to
 * name in a thrown message.
 */
export async function assertRowCounts(
  client: QueryableClient,
  manifest: BackupManifest,
): Promise<void> {
  const tablesResult = await client.query(
    "SELECT table_schema, table_name FROM information_schema.tables " +
      "WHERE table_schema NOT IN ('pg_catalog', 'information_schema') " +
      "ORDER BY table_schema, table_name",
  );
  const rows = tablesResult.rows as Array<{ table_schema: string; table_name: string }>;
  const restoredTableNames = new Set(rows.map((row) => `${row.table_schema}.${row.table_name}`));
  const expectedTableNames = new Set(Object.keys(manifest.rowCounts));

  const missing = [...expectedTableNames].filter((name) => !restoredTableNames.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Row count assertion failed: table(s) recorded in the manifest but missing from the ` +
        `restored database: ${missing.join(", ")}.`,
    );
  }

  const unexpected = [...restoredTableNames].filter((name) => !expectedTableNames.has(name));
  if (unexpected.length > 0) {
    throw new Error(
      `Row count assertion failed: table(s) present in the restored database but not recorded ` +
        `in the manifest: ${unexpected.join(", ")}.`,
    );
  }

  for (const row of rows) {
    const qualifiedName = `${row.table_schema}.${row.table_name}`;
    const countResult = await client.query(
      `SELECT count(*) AS count FROM "${row.table_schema}"."${row.table_name}"`,
    );
    const actualCount = Number((countResult.rows[0] as { count: string }).count);
    const expectedCount = manifest.rowCounts[qualifiedName];
    if (actualCount !== expectedCount) {
      throw new Error(
        `Row count assertion failed for table "${qualifiedName}": expected ${expectedCount}, ` +
          `found ${actualCount}.`,
      );
    }
  }
}
