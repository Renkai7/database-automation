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
      // table in every schema other than the two catalog schemas is enumerated and counted,
      // matching the precedent already established in scripts/verify-migration-state.ts and
      // tests/db-reset.test.ts.
      const rowCounts: Record<string, number> = {};
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
      }

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
