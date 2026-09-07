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

export interface SchemaDumpPair {
  sourceSql: string;
  restoredSql: string;
}

// RESEARCH.md Pitfall 4 (live-verified): two consecutive `pg_dump --schema-only` dumps of the
// identical, unchanged database differ ONLY on these two lines -- PostgreSQL 17's per-invocation
// dump-integrity guard token pair, regenerated every single run. Stripping them is the confirmed,
// minimal fix; this pattern removes nothing else that begins a line with a backslash because no
// other `psql` meta-command appears in a schema-only dump.
const SCHEMA_DUMP_GUARD_DIRECTIVE_PATTERN = /^\\(un)?restrict\b.*$/gm;
// Comment-only lines carry dump metadata (timestamps, tool versions) rather than schema
// semantics -- pg_dump always emits these as their own lines, never appended to a SQL statement.
const COMMENT_ONLY_LINE_PATTERN = /^--.*$/gm;
const BLANK_LINE_RUN_PATTERN = /\n{2,}/g;

/**
 * Tier 3 (schema equality) support: canonicalises a `pg_dump --schema-only` dump so two dumps of
 * the identical, unchanged database compare equal despite PG17's per-invocation guard tokens.
 * Never removes an actual SQL statement -- the dropped-foreign-key regression test in
 * tests/drill-assertions.test.ts proves this directly. Pure and free of file/process I/O so it
 * is unit-testable on plain string fixtures.
 */
export function canonicalizeSchemaDump(sql: string): string {
  return sql
    .replace(/\r\n/g, "\n")
    .replace(SCHEMA_DUMP_GUARD_DIRECTIVE_PATTERN, "")
    .replace(COMMENT_ONLY_LINE_PATTERN, "")
    .replace(BLANK_LINE_RUN_PATTERN, "\n")
    .trim();
}

const MAX_SCHEMA_DIFF_EXCERPT_LINES = 5;

// Set-based (order-independent) line diff, deliberately simple rather than a full sequence-diff
// algorithm: the acceptance criterion is "the first few lines present on one side and absent on
// the other, capped so the message stays readable" -- not a minimal edit script.
function buildSchemaDiffExcerpt(sourceCanonical: string, restoredCanonical: string): string {
  const sourceLines = sourceCanonical.split("\n");
  const restoredLines = restoredCanonical.split("\n");
  const sourceLineSet = new Set(sourceLines);
  const restoredLineSet = new Set(restoredLines);

  const onlyInSource = sourceLines
    .filter((line) => !restoredLineSet.has(line))
    .slice(0, MAX_SCHEMA_DIFF_EXCERPT_LINES);
  const onlyInRestored = restoredLines
    .filter((line) => !sourceLineSet.has(line))
    .slice(0, MAX_SCHEMA_DIFF_EXCERPT_LINES);

  const sections: string[] = [];
  if (onlyInSource.length > 0) {
    sections.push(`Present in source only:\n${onlyInSource.join("\n")}`);
  }
  if (onlyInRestored.length > 0) {
    sections.push(`Present in restored only:\n${onlyInRestored.join("\n")}`);
  }
  return sections.join("\n\n");
}

/**
 * Tier 3 (schema equality): compares a canonicalised `pg_dump --schema-only` of the source
 * database against the same dump of the restored database. This is the tier that notices what
 * a row-count check and an orphan-row check both miss: after `DROP TABLE recipes CASCADE`, the
 * rows come back on restore and no row is orphaned, but the foreign keys on
 * `ingredients`/`steps` do not come back -- only a schema comparison sees the missing constraint
 * (D-13). Rejects the vacuous case explicitly: an empty canonicalised side never resolves as
 * equal to anything, including another empty side, because that is exactly how this tier could
 * silently stop testing anything.
 */
export function assertSchemaEquality(pair: SchemaDumpPair): void {
  const sourceCanonical = canonicalizeSchemaDump(pair.sourceSql);
  const restoredCanonical = canonicalizeSchemaDump(pair.restoredSql);

  if (sourceCanonical.length === 0) {
    throw new Error(
      "Schema equality check failed: the canonicalised SOURCE schema dump is empty -- refusing " +
        "to treat an empty comparison as a pass.",
    );
  }
  if (restoredCanonical.length === 0) {
    throw new Error(
      "Schema equality check failed: the canonicalised RESTORED schema dump is empty -- " +
        "refusing to treat an empty comparison as a pass.",
    );
  }

  if (sourceCanonical !== restoredCanonical) {
    const excerpt = buildSchemaDiffExcerpt(sourceCanonical, restoredCanonical);
    throw new Error(
      `Schema equality check failed: the source and restored schemas differ.\n${excerpt}`,
    );
  }
}
