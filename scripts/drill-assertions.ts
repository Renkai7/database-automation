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

/**
 * Tier 4a (content hashes): recomputes each table's md5 content hash against the restored
 * database with the identical query scripts/backup.ts used to record it, and requires the key
 * set and every value to match. This is the data-value half of D-13 tier 4 -- it catches a
 * value that changed even when the row count did not. A mismatch names the table.
 */
export async function assertContentHashes(
  client: QueryableClient,
  manifest: BackupManifest,
): Promise<void> {
  const expectedTableNames = Object.keys(manifest.contentHashes);
  if (expectedTableNames.length === 0) {
    throw new Error(
      "Content hash assertion failed: the manifest recorded zero content hashes -- refusing to " +
        "treat a comparison with nothing on either side as a pass.",
    );
  }

  for (const qualifiedName of expectedTableNames) {
    const dotIndex = qualifiedName.indexOf(".");
    const tableSchema = qualifiedName.slice(0, dotIndex);
    const tableName = qualifiedName.slice(dotIndex + 1);
    const { rows } = await client.query(
      "SELECT md5(coalesce(string_agg(row_text, chr(30) ORDER BY row_text), '')) AS hash " +
        `FROM (SELECT t::text AS row_text FROM "${tableSchema}"."${tableName}" t) sub`,
    );
    const actualHash = (rows[0] as { hash: string }).hash;
    const expectedHash = manifest.contentHashes[qualifiedName];
    if (actualHash !== expectedHash) {
      throw new Error(
        `Content hash assertion failed for table "${qualifiedName}": expected ${expectedHash}, ` +
          `found ${actualHash}.`,
      );
    }
  }
}

// Field order here is the contract, not the row objects' own key order (which pg's driver and
// zod's own parser are each free to produce independently) -- normalizing both sides to an
// array in this fixed order before comparing removes any dependency on either one's incidental
// key ordering.
const RECIPE_SPOT_CHECK_FIELDS = ["slug", "baseServings", "baseKcal"] as const;
const INGREDIENT_SPOT_CHECK_FIELDS = ["name", "quantity", "unit", "position"] as const;
const STEP_SPOT_CHECK_FIELDS = ["position", "timerLabel"] as const;

function normalizeProjectionRow(
  row: Record<string, unknown>,
  fields: readonly string[],
): unknown[] {
  return fields.map((field) => row[field]);
}

function assertDeepEqualProjection(
  tableName: string,
  fields: readonly string[],
  expectedRows: Array<Record<string, unknown>>,
  actualRows: Array<Record<string, unknown>>,
): void {
  if (expectedRows.length !== actualRows.length) {
    throw new Error(
      `Spot check assertion failed for table "${tableName}": expected ${expectedRows.length} ` +
        `recorded row(s), found ${actualRows.length} in the restored database.`,
    );
  }
  for (let index = 0; index < expectedRows.length; index++) {
    const expected = JSON.stringify(normalizeProjectionRow(expectedRows[index], fields));
    const actual = JSON.stringify(normalizeProjectionRow(actualRows[index], fields));
    if (expected !== actual) {
      throw new Error(
        `Spot check assertion failed for table "${tableName}" at row ${index}: expected ` +
          `${expected}, found ${actual}.`,
      );
    }
  }
}

/**
 * Tier 4b (spot-checked values): re-runs the three named, non-credential column projections
 * from the recipe-core tables and requires deep equality with the manifest's recorded values.
 * The steps projection is the one that proves the NULL-versus-empty-string distinction survived
 * a restore. Rejects the vacuous case: an empty recorded projection for a table the manifest
 * says holds rows (per its rowCounts) is a failure, never a pass.
 */
export async function assertSpotCheckedValues(
  client: QueryableClient,
  manifest: BackupManifest,
): Promise<void> {
  const { spotChecks, rowCounts } = manifest;

  if ((rowCounts["public.recipes"] ?? 0) > 0 && spotChecks.recipes.length === 0) {
    throw new Error(
      "Spot check assertion failed: the manifest recorded zero recipe spot checks despite " +
        "rowCounts reporting recipe rows -- refusing to treat an empty recorded projection as a " +
        "pass.",
    );
  }
  if ((rowCounts["public.ingredients"] ?? 0) > 0 && spotChecks.ingredients.length === 0) {
    throw new Error(
      "Spot check assertion failed: the manifest recorded zero ingredient spot checks despite " +
        "rowCounts reporting ingredient rows -- refusing to treat an empty recorded projection " +
        "as a pass.",
    );
  }
  if ((rowCounts["public.steps"] ?? 0) > 0 && spotChecks.steps.length === 0) {
    throw new Error(
      "Spot check assertion failed: the manifest recorded zero step spot checks despite " +
        "rowCounts reporting step rows -- refusing to treat an empty recorded projection as a " +
        "pass.",
    );
  }

  const recipesResult = await client.query(
    'SELECT slug, base_servings AS "baseServings", base_kcal AS "baseKcal" FROM recipes ' +
      "ORDER BY slug",
  );
  assertDeepEqualProjection(
    "recipes",
    RECIPE_SPOT_CHECK_FIELDS,
    spotChecks.recipes as unknown as Array<Record<string, unknown>>,
    recipesResult.rows as Array<Record<string, unknown>>,
  );

  const ingredientsResult = await client.query(
    "SELECT name, quantity, unit, position FROM ingredients ORDER BY position",
  );
  assertDeepEqualProjection(
    "ingredients",
    INGREDIENT_SPOT_CHECK_FIELDS,
    spotChecks.ingredients as unknown as Array<Record<string, unknown>>,
    ingredientsResult.rows as Array<Record<string, unknown>>,
  );

  const stepsResult = await client.query(
    'SELECT position, timer_label AS "timerLabel" FROM steps ORDER BY position',
  );
  assertDeepEqualProjection(
    "steps",
    STEP_SPOT_CHECK_FIELDS,
    spotChecks.steps as unknown as Array<Record<string, unknown>>,
    stepsResult.rows as Array<Record<string, unknown>>,
  );
}

interface ForeignKeyConstraintRow {
  constraint_name: string;
  referencing_schema: string;
  referencing_table: string;
  referencing_column: string;
  referenced_schema: string;
  referenced_table: string;
  referenced_column: string;
}

/**
 * Tier 4c (referential integrity): enumerates every foreign-key constraint in the restored
 * database from the information schema -- never a hardcoded constraint list -- and for each,
 * counts rows whose referencing column is non-null but matches no parent row. This is the
 * data-level half of the `DROP TABLE ... CASCADE` lesson; tier 3's schema comparison is the
 * constraint-level half, and neither substitutes for the other. Also requires at least one
 * foreign-key constraint to exist: zero found means either the schema is wrong or the
 * enumeration is, and both must be loud rather than silently passing on zero comparisons.
 */
export async function assertNoOrphanRows(client: QueryableClient): Promise<void> {
  const { rows } = await client.query(
    "SELECT tc.constraint_name, tc.table_schema AS referencing_schema, " +
      "tc.table_name AS referencing_table, kcu.column_name AS referencing_column, " +
      "ccu.table_schema AS referenced_schema, ccu.table_name AS referenced_table, " +
      "ccu.column_name AS referenced_column " +
      "FROM information_schema.table_constraints tc " +
      "JOIN information_schema.key_column_usage kcu " +
      "  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema " +
      "JOIN information_schema.constraint_column_usage ccu " +
      "  ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema " +
      "WHERE tc.constraint_type = 'FOREIGN KEY' " +
      "ORDER BY tc.constraint_name",
  );
  const constraints = rows as ForeignKeyConstraintRow[];

  if (constraints.length === 0) {
    throw new Error(
      "Orphan-row assertion failed: no foreign-key constraints were found in the restored " +
        "database -- either the schema is wrong or the enumeration is, and both must be loud " +
        "rather than silently passing on a comparison with nothing on either side.",
    );
  }

  for (const fk of constraints) {
    const { rows: orphanRows } = await client.query(
      `SELECT count(*) AS count FROM "${fk.referencing_schema}"."${fk.referencing_table}" r ` +
        `WHERE r."${fk.referencing_column}" IS NOT NULL AND NOT EXISTS ` +
        `(SELECT 1 FROM "${fk.referenced_schema}"."${fk.referenced_table}" p ` +
        `WHERE p."${fk.referenced_column}" = r."${fk.referencing_column}")`,
    );
    const orphanCount = Number((orphanRows[0] as { count: string }).count);
    if (orphanCount > 0) {
      throw new Error(
        `Orphan-row assertion failed for constraint "${fk.constraint_name}": ${orphanCount} ` +
          `row(s) in "${fk.referencing_schema}"."${fk.referencing_table}" reference a missing ` +
          `row in "${fk.referenced_schema}"."${fk.referenced_table}".`,
      );
    }
  }
}

/**
 * Tier 4d (sequence state): re-projects `pg_sequences` and requires deep equality with the
 * manifest's recorded set, including the set of sequence names -- never a hardcoded sequence
 * name, so this stays correct if a future phase adds an application-owned serial/identity
 * column. Rejects the vacuous case: a manifest recording zero sequences never resolves as a
 * pass.
 */
export async function assertSequenceState(
  client: QueryableClient,
  manifest: BackupManifest,
): Promise<void> {
  if (manifest.sequences.length === 0) {
    throw new Error(
      "Sequence state assertion failed: the manifest recorded zero sequences -- refusing to " +
        "treat a comparison with nothing on either side as a pass.",
    );
  }

  const { rows } = await client.query(
    'SELECT schemaname AS "schemaName", sequencename AS "sequenceName", ' +
      'last_value AS "lastValue" FROM pg_sequences ORDER BY schemaname, sequencename',
  );
  const actual = (
    rows as Array<{ schemaName: string; sequenceName: string; lastValue: string | null }>
  ).map((row) => ({
    schemaName: row.schemaName,
    sequenceName: row.sequenceName,
    lastValue: row.lastValue === null ? null : Number(row.lastValue),
  }));

  const expectedSerialized = JSON.stringify(manifest.sequences);
  const actualSerialized = JSON.stringify(actual);
  if (expectedSerialized !== actualSerialized) {
    throw new Error(
      `Sequence state assertion failed: expected ${expectedSerialized}, found ` +
        `${actualSerialized}.`,
    );
  }
}
