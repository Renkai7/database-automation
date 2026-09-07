// D-06 (02-CONTEXT.md): this module's only target parameter is ContainerRestoreTarget, a
// two-method structural interface that a started `@testcontainers/postgresql` container
// satisfies without this module importing the testcontainers package at all -- and, critically,
// there is no parameter, field, or option anywhere in this file capable of carrying a
// connection string or a URL. This task creates only the internal restore function; the
// human-invoked `db:restore` CLI (dev-target-only, reusing scripts/env.ts's guard exactly as
// scripts/db-reset.ts does) lands in a later plan.
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
