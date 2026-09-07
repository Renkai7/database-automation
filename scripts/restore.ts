// D-06 (02-CONTEXT.md): this module's only target parameter is ContainerRestoreTarget, a
// two-method structural interface that a started `@testcontainers/postgresql` container
// satisfies without this module importing the testcontainers package at all -- and, critically,
// there is no parameter, field, or option anywhere in this file capable of carrying a
// connection string or a URL. Plan 02-01 created only the internal restore function
// (restoreIntoContainer, above); 02-03-PLAN.md Task 1 adds the human-invoked `db:restore` CLI
// below -- dev-target-only, reusing scripts/env.ts's guard exactly as scripts/db-reset.ts does.
//
// This module is imported by scripts/drill.ts (for restoreIntoContainer) and by
// scripts/restore-cluster.ts (for restoreIntoDevContainer/verifyRestoredRowCounts) -- the
// `import.meta.main` guard around main() below (same pattern as scripts/backup.ts and
// scripts/drill.ts, see STATE.md's recorded decision) is load-bearing: without it, merely
// importing this file for either reused function would also trigger a live `db:restore` run.
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { execa } from "execa";
import { Client } from "pg";
import { readManifest, sha256File, type BackupManifest } from "./backup-manifest";
import {
  EXPECTED_DEV_DATABASE_NAME,
  EXPECTED_DEV_DATABASE_ROLE,
  assertDevelopmentDatabase,
  getBackupDestination,
  getDevDatabaseUrl,
} from "./env";
import { safeErrorMessage } from "./log";

export interface ContainerRestoreTarget {
  copyFilesToContainer(files: Array<{ source: string; target: string }>): Promise<void>;
  exec(command: string[]): Promise<{ exitCode: number | null; stdout: string; stderr: string }>;
}

export interface RestoreDumpPaths {
  dataDumpPath: string;
  globalsDumpPath: string;
}

export interface RestoreIntoContainerOptions {
  /** In-container user that runs psql/pg_restore -- e.g. the drill's non-colliding bootstrap user. */
  username: string;
  /** In-container database name the data dump is restored into. */
  database: string;
}

const CONTAINER_DATA_DUMP_PATH = "/tmp/data.dump";
const CONTAINER_GLOBALS_DUMP_PATH = "/tmp/globals.sql";

/**
 * Restores both dumps into a container the caller already started and remains responsible for
 * stopping. Runs the globals restore first (`ON_ERROR_STOP=1`, never tolerant of an "already
 * exists" error), then the data restore (`--clean --if-exists --no-owner --jobs 2`). Throws,
 * naming the failing step and its captured stderr, on any non-zero exit code -- never trusts an
 * exit code alone (BKP-04).
 */
export async function restoreIntoContainer(
  target: ContainerRestoreTarget,
  dumps: RestoreDumpPaths,
  options: RestoreIntoContainerOptions,
): Promise<void> {
  await target.copyFilesToContainer([
    { source: dumps.dataDumpPath, target: CONTAINER_DATA_DUMP_PATH },
    { source: dumps.globalsDumpPath, target: CONTAINER_GLOBALS_DUMP_PATH },
  ]);

  // T-02-03 (threat register) / RESEARCH.md Pitfall 2: no tolerance is added anywhere for an
  // "already exists" error on this pass. On a correctly bootstrapped drill container (a
  // bootstrap identity that collides with no role in the globals dump) there is nothing for it
  // to collide with -- tolerating that error here is exactly how a drill would report PASS
  // having never exercised the globals restore.
  const globalsResult = await target.exec([
    "psql",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    options.username,
    "-d",
    "postgres",
    "-f",
    CONTAINER_GLOBALS_DUMP_PATH,
  ]);
  if (globalsResult.exitCode !== 0) {
    throw new Error(
      `Globals restore failed (exit ${globalsResult.exitCode}): ${globalsResult.stderr}`,
    );
  }

  // RESEARCH.md Pitfall 5: --clean must always be paired with --if-exists -- unpaired, it
  // returns exit 1 for objects simply absent from the target, indistinguishable from a real
  // failure.
  const dataResult = await target.exec([
    "pg_restore",
    "--clean",
    "--if-exists",
    "--no-owner",
    "--jobs",
    "2",
    "-U",
    options.username,
    "-d",
    options.database,
    CONTAINER_DATA_DUMP_PATH,
  ]);
  if (dataResult.exitCode !== 0) {
    throw new Error(`Data restore failed (exit ${dataResult.exitCode}): ${dataResult.stderr}`);
  }
}

// ---------------------------------------------------------------------------------------------
// 02-03-PLAN.md Task 1: `pnpm db:restore` -- the in-place, whole-database data restore for act 1
// (drop a table, restore it). Deliberately whole-database, not selective: `DROP TABLE recipes
// CASCADE` also removes the foreign keys on `ingredients`/`steps`, and a single-table restore
// would return the rows without them -- the precise failure mode this phase exists to surface.
// ---------------------------------------------------------------------------------------------

const DEV_CONTAINER_DATA_DUMP_PATH = "/tmp/data.dump";

export interface DevContainerRestoreOptions {
  /** The pinned application role that runs pg_restore inside the development container. */
  username: string;
  /** The pinned development database name being restored into. */
  database: string;
}

/**
 * Copies the data dump into the pinned development container's temporary directory, runs
 * `pg_restore --clean --if-exists --no-owner --jobs 2`, and removes the temporary file in a
 * `finally` -- on both the success and the failure path (BKP-02's privacy prohibition: no dump
 * file may outlive a run inside a long-lived container). Does not resolve the manifest, verify
 * checksums, or assert the development database -- callers (main() below,
 * scripts/restore-cluster.ts) do that first.
 */
export async function restoreIntoDevContainer(
  dumps: Pick<RestoreDumpPaths, "dataDumpPath">,
  options: DevContainerRestoreOptions,
): Promise<void> {
  try {
    await execa("docker", [
      "compose",
      "cp",
      dumps.dataDumpPath,
      `db:${DEV_CONTAINER_DATA_DUMP_PATH}`,
    ]);

    // RESEARCH.md Pitfall 5: --clean must always be paired with --if-exists -- unpaired, it
    // returns exit 1 for objects simply absent from the target, indistinguishable from a real
    // failure. Exit code and stderr are both inspected below (BKP-04), never the exit code
    // alone.
    const result = await execa(
      "docker",
      [
        "compose",
        "exec",
        "-T",
        "db",
        "pg_restore",
        "--clean",
        "--if-exists",
        "--no-owner",
        "--jobs",
        "2",
        "-U",
        options.username,
        "-d",
        options.database,
        DEV_CONTAINER_DATA_DUMP_PATH,
      ],
      { reject: false },
    );
    if (result.exitCode !== 0) {
      throw new Error(`Data restore failed (exit ${result.exitCode}): ${result.stderr}`);
    }
  } finally {
    // T-02-13 (threat register): removed unconditionally, success or failure, so a dump never
    // outlives a run inside this long-lived container.
    await execa("docker", ["compose", "exec", "-T", "db", "rm", "-f", DEV_CONTAINER_DATA_DUMP_PATH], {
      reject: false,
    });
  }
}

/**
 * Resolves the newest manifest at a backup destination the same way
 * scripts/backup-manifest.ts's readLatestManifest does, but also returns the manifest's own
 * filename -- needed so `db:restore`/`db:restore:cluster` can name, in their own final summary
 * line, which manifest was restored from (not just which dump file).
 */
async function resolveLatestManifestWithFilename(
  destination: string,
): Promise<{ manifest: BackupManifest; manifestFile: string }> {
  const entries = await readdir(destination);
  const manifestFiles = entries.filter((entry) => entry.endsWith("-manifest.json")).sort();
  const manifestFile = manifestFiles.at(-1);
  if (!manifestFile) {
    throw new Error(`No manifest file found at backup destination "${destination}".`);
  }
  const manifest = await readManifest(join(destination, manifestFile));
  return { manifest, manifestFile };
}

/**
 * Re-queries the restored database rather than trusting `pg_restore`'s exit code alone (BKP-04):
 * every table recorded in the manifest's row counts must be present with the exact recorded
 * count. Shared by scripts/restore.ts's own main() and scripts/restore-cluster.ts.
 */
export async function verifyRestoredRowCounts(
  client: { query(text: string): Promise<{ rows: Array<Record<string, unknown>> }> },
  manifest: BackupManifest,
): Promise<void> {
  for (const [qualifiedName, expectedCount] of Object.entries(manifest.rowCounts)) {
    const dotIndex = qualifiedName.indexOf(".");
    if (dotIndex === -1) {
      throw new Error(
        `Manifest row count key "${qualifiedName}" is not a schema-qualified table name.`,
      );
    }
    const schema = qualifiedName.slice(0, dotIndex);
    const table = qualifiedName.slice(dotIndex + 1);
    const { rows } = await client.query(`SELECT count(*) AS count FROM "${schema}"."${table}"`);
    const actualCount = Number((rows[0] as { count: string }).count);
    if (actualCount !== expectedCount) {
      throw new Error(
        `Row count mismatch for "${qualifiedName}" after restore: expected ${expectedCount}, ` +
          `found ${actualCount}.`,
      );
    }
  }
}

async function runStep<T>(name: string, action: () => Promise<T>): Promise<T> {
  console.log(`[db:restore] ${name}...`);
  let result: T;
  try {
    result = await action();
  } catch (error) {
    console.error(`[db:restore] FAILED at step "${name}": ${safeErrorMessage(error)}`);
    process.exit(1);
  }
  console.log(`[db:restore] ${name} done.`);
  return result;
}

async function main(): Promise<void> {
  const destination = getBackupDestination();

  const { manifest, manifestFile } = await runStep("resolve newest manifest", () =>
    resolveLatestManifestWithFilename(destination),
  );

  const dataDumpPath = join(destination, manifest.dataDump.file);

  // T-02-14 (threat register): verified before anything is written -- a restore from a
  // corrupted artifact that then "succeeds" is worse than no restore.
  await runStep("verify data dump checksum against the manifest", async () => {
    const actualSha256 = await sha256File(dataDumpPath);
    if (actualSha256 !== manifest.dataDump.sha256) {
      throw new Error(
        `Data dump checksum mismatch for "${manifest.dataDump.file}" -- refusing to restore ` +
          "from a possibly-corrupted artifact.",
      );
    }
  });

  await runStep("assert development database", async () => {
    const client = new Client({ connectionString: getDevDatabaseUrl() });
    try {
      await client.connect();
      await assertDevelopmentDatabase(client);
    } finally {
      await client.end();
    }
  });

  await runStep("restore data dump into the development container", () =>
    restoreIntoDevContainer(
      { dataDumpPath },
      { username: EXPECTED_DEV_DATABASE_ROLE, database: EXPECTED_DEV_DATABASE_NAME },
    ),
  );

  await runStep("verify restored row counts against the manifest", async () => {
    const client = new Client({ connectionString: getDevDatabaseUrl() });
    try {
      await client.connect();
      await verifyRestoredRowCounts(client, manifest);
    } finally {
      await client.end();
    }
  });

  console.log(
    `[db:restore] Restored from manifest ${manifestFile} (data dump ${manifest.dataDump.file}).`,
  );
  console.log("[db:restore] Complete.");
}

// Guarded the same way as scripts/backup.ts/scripts/drill.ts: importing this module (as
// scripts/drill.ts and scripts/restore-cluster.ts both do) must never itself run a restore --
// only direct execution (`tsx scripts/restore.ts`, i.e. `pnpm db:restore`) does.
if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(safeErrorMessage(error));
    process.exit(1);
  });
}
