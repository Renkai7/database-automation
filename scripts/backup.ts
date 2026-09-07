// BKP-01/BKP-02 (02-CONTEXT.md D-01/D-02/D-05/D-06): `db:backup` -- dev-target-only. Reads no
// command-line arguments and no environment variable directly; the target comes from
// getDevDatabaseUrl() (which re-asserts assertLocalDevelopmentTarget internally) and the
// destination from getBackupDestination() (which re-asserts assertBackupDestination
// internally). D-06's asymmetry rule: there is no parameter anywhere in this file capable of
// redirecting either one.
//
// runBackup() is exported so scripts/drill.ts can call it in-process (D-15's hermetic
// sequence) without ever going through a child process or a CLI argument. Because this module
// is import-safe by *drill.ts*, the CLI entry point below is guarded so importing this file
// never itself runs a backup -- only executing it directly (`tsx scripts/backup.ts`, i.e.
// `pnpm db:backup`) does.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { execa } from "execa";
import { Client } from "pg";
import {
  buildManifest,
  compactTimestamp,
  sha256File,
  writeManifest,
  type BackupManifest,
} from "./backup-manifest";
import { assertDevelopmentDatabase, getBackupDestination, getDevDatabaseUrl } from "./env";
import { safeErrorMessage } from "./log";

// Same table list scripts/verify-migration-state.ts checks after a migrate -- duplicated here
// deliberately rather than imported, since that module's own list is a private implementation
// detail of a different tool with a different failure message.
const RECIPE_CORE_TABLES = ["ingredients", "recipes", "steps"] as const;

// Copied from scripts/db-reset.ts's `runStep`, generalised to return a value: several steps in
// this file (metadata collection in particular) need to hand their result forward. `process.exit`
// is typed `never`, so TypeScript can see that `result` is always assigned by the time this
// function returns normally.
async function runStep<T>(name: string, action: () => Promise<T>): Promise<T> {
  console.log(`[db:backup] ${name}...`);
  let result: T;
  try {
    result = await action();
  } catch (error) {
    console.error(`[db:backup] FAILED at step "${name}": ${safeErrorMessage(error)}`);
    process.exit(1);
  }
  console.log(`[db:backup] ${name} done.`);
  return result;
}

/**
 * Backs up the pinned local development database: a `pg_dump -Fc` data dump, a
 * `pg_dumpall --globals-only` roles dump, and a JSON manifest recording checksums, row counts,
 * the applied-migration count, and the git commit -- everything scripts/drill-assertions.ts
 * needs to compare a restored database against without hardcoding fixture data.
 */
export async function runBackup(): Promise<BackupManifest> {
  const targetUrl = getDevDatabaseUrl();
  const destination = getBackupDestination();
  const stamp = compactTimestamp(new Date());

  const dataDumpFile = `recipe_dev-${stamp}.dump`;
  const globalsDumpFile = `recipe_dev-${stamp}-globals.sql`;
  const manifestFile = `recipe_dev-${stamp}-manifest.json`;
  const dataDumpPath = join(destination, dataDumpFile);
  const globalsDumpPath = join(destination, globalsDumpFile);
  const manifestPath = join(destination, manifestFile);

  const client = new Client({ connectionString: targetUrl });
  try {
    await runStep("assert development database", async () => {
      await client.connect();
      await assertDevelopmentDatabase(client);
    });

    // T-02-08 (threat register) / BKP-04: a backup taken from an unmigrated database would
    // otherwise populate every tier-3/4 manifest field below with empty comparisons that every
    // restore-assertion tier would then pass vacuously. Fail loudly here, before a single dump
    // byte is written, rather than let that surface later as a silently-green drill.
    await runStep("assert recipe-core tables present", async () => {
      const tablesResult = await client.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
      );
      const tableNames = new Set(
        (tablesResult.rows as Array<{ table_name: string }>).map((row) => row.table_name),
      );
      for (const table of RECIPE_CORE_TABLES) {
        if (!tableNames.has(table)) {
          throw new Error(
            `Cannot back up: recipe-core table "${table}" is missing from the source database. ` +
              "A backup taken from an unmigrated database would produce a manifest of empty " +
              "comparisons that every restore-assertion tier would pass vacuously.",
          );
        }
      }
    });

    await runStep("create backup destination directory", async () => {
      await mkdir(destination, { recursive: true });
    });

    await runStep("pg_dump -Fc data dump", async () => {
      // Never a shell pipe, and never piping a custom-format dump into a restore --
      // pg_restore requires a seekable file (RESEARCH.md anti-patterns).
      await execa(
        "docker",
        ["compose", "exec", "-T", "db", "pg_dump", "-U", "recipe_app", "-d", "recipe_dev", "-Fc"],
        { stdout: { file: dataDumpPath } },
      );
    });

    // T-02-01 (threat register) / RESEARCH.md Pitfall 1: this dump's contents include a real
    // SCRAM-SHA-256 password verifier. It is only ever copied and hashed as an opaque blob
    // below -- never read into memory for inspection, never logged, never quoted in an error
    // message.
    await runStep("pg_dumpall --globals-only roles dump", async () => {
      await execa(
        "docker",
        ["compose", "exec", "-T", "db", "pg_dumpall", "-U", "recipe_app", "--globals-only"],
        { stdout: { file: globalsDumpPath } },
      );
    });

    return await runStep("collect manifest metadata and write manifest", async () => {
      const versionResult = await client.query("SHOW server_version");
      const postgresVersion = String(
        (versionResult.rows[0] as { server_version: string }).server_version,
      );

      const gitCommitResult = await execa("git", ["rev-parse", "HEAD"]);
      const gitCommit = gitCommitResult.stdout.trim();

      const migrationsResult = await client.query(
        "SELECT count(*) AS count FROM drizzle.__drizzle_migrations",
      );
      const appliedMigrationCount = Number((migrationsResult.rows[0] as { count: string }).count);

      // Never a hardcoded table list (D-05: "keeps working when the seed changes") -- every
      // table in every schema other than the two catalog schemas is enumerated, counted, AND
      // (tier 4) content-hashed, matching the precedent already established in
      // scripts/verify-migration-state.ts and tests/db-reset.test.ts. The content hash
      // aggregates every row's own text rendering in a stable (lexicographic) order and hashes
      // the aggregate with md5 -- an empty table hashes to md5('')'s fixed value rather than
      // SQL NULL, so an empty table still produces a comparable value. This exact query text is
      // duplicated verbatim in scripts/drill-assertions.ts's assertContentHashes -- keep them in
      // sync; a divergence here would make every restored database fail tier 4 for a reason
      // that has nothing to do with what actually changed.
      const rowCounts: Record<string, number> = {};
      const contentHashes: Record<string, string> = {};
      const tablesResult = await client.query(
        "SELECT table_schema, table_name FROM information_schema.tables " +
          "WHERE table_schema NOT IN ('pg_catalog', 'information_schema') " +
          "ORDER BY table_schema, table_name",
      );
      for (const row of tablesResult.rows as Array<{ table_schema: string; table_name: string }>) {
        const qualifiedName = `${row.table_schema}.${row.table_name}`;
        const countResult = await client.query(
          `SELECT count(*) AS count FROM "${row.table_schema}"."${row.table_name}"`,
        );
        rowCounts[qualifiedName] = Number((countResult.rows[0] as { count: string }).count);

        const hashResult = await client.query(
          "SELECT md5(coalesce(string_agg(row_text, chr(30) ORDER BY row_text), '')) AS hash " +
            `FROM (SELECT t::text AS row_text FROM "${row.table_schema}"."${row.table_name}" t) sub`,
        );
        contentHashes[qualifiedName] = (hashResult.rows[0] as { hash: string }).hash;
      }

      // Tier 4 spot checks: explicitly named, non-credential column projections from the three
      // recipe-core tables -- never a whole-row SELECT, so no future column can be swept into
      // the manifest by accident. The steps projection is the one that proves the
      // NULL-versus-empty-string distinction survived a restore: timerLabel is read exactly as
      // `pg` returns it (SQL NULL -> JS null), never coalesced to an empty string.
      const recipesResult = await client.query(
        'SELECT slug, base_servings AS "baseServings", base_kcal AS "baseKcal" FROM recipes ' +
          "ORDER BY slug",
      );
      const ingredientsResult = await client.query(
        "SELECT name, quantity, unit, position FROM ingredients ORDER BY position",
      );
      const stepsResult = await client.query(
        'SELECT position, timer_label AS "timerLabel" FROM steps ORDER BY position',
      );

      // Tier 4 sequence state: generic against pg_sequences, never a hardcoded sequence name --
      // this schema's only sequence today belongs to Drizzle's own bookkeeping table, but the
      // check stays correct if a future phase adds an application-owned serial/identity column.
      const sequencesResult = await client.query(
        'SELECT schemaname AS "schemaName", sequencename AS "sequenceName", ' +
          'last_value AS "lastValue" FROM pg_sequences ORDER BY schemaname, sequencename',
      );

      const dataDumpSha256 = await sha256File(dataDumpPath);
      const globalsDumpSha256 = await sha256File(globalsDumpPath);

      const manifest = buildManifest({
        takenAt: new Date().toISOString(),
        postgresVersion,
        gitCommit,
        appliedMigrationCount,
        dataDump: { file: dataDumpFile, sha256: dataDumpSha256 },
        globalsDump: { file: globalsDumpFile, sha256: globalsDumpSha256 },
        rowCounts,
        contentHashes,
        spotChecks: {
          recipes: (
            recipesResult.rows as Array<{ slug: string; baseServings: number; baseKcal: number }>
          ).map((row) => ({
            slug: row.slug,
            baseServings: row.baseServings,
            baseKcal: row.baseKcal,
          })),
          ingredients: (
            ingredientsResult.rows as Array<{
              name: string;
              quantity: string;
              unit: string;
              position: number;
            }>
          ).map((row) => ({
            name: row.name,
            quantity: row.quantity,
            unit: row.unit,
            position: row.position,
          })),
          steps: (stepsResult.rows as Array<{ position: number; timerLabel: string | null }>).map(
            (row) => ({ position: row.position, timerLabel: row.timerLabel }),
          ),
        },
        sequences: (
          sequencesResult.rows as Array<{
            schemaName: string;
            sequenceName: string;
            lastValue: string | null;
          }>
        ).map((row) => ({
          schemaName: row.schemaName,
          sequenceName: row.sequenceName,
          lastValue: row.lastValue === null ? null : Number(row.lastValue),
        })),
      });

      await writeManifest(manifestPath, manifest);
      return manifest;
    });
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const manifest = await runBackup();
  console.log(
    `[db:backup] Wrote ${manifest.dataDump.file}, ${manifest.globalsDump.file}, and the manifest.`,
  );
  console.log("[db:backup] Complete.");
}

// Guarded entry point: importing this module (as scripts/drill.ts does, to call runBackup() in
// process) must never itself trigger a backup run -- only direct execution
// (`tsx scripts/backup.ts`, i.e. `pnpm db:backup`) does. `import.meta.main` (Node 24, live-
// verified under tsx this session) is true only for the module Node/tsx was invoked on
// directly, false for every module reached only via `import`.
if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(safeErrorMessage(error));
    process.exit(1);
  });
}
