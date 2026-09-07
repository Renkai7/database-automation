// D-07 act 2 (02-CONTEXT.md): `pnpm db:restore:cluster` -- restores globals then data into a
// rebuilt development cluster. A separate file, not a mode flag on scripts/restore.ts: the D-06
// asymmetry rule applied to modes as well as targets (02-03-PLAN.md "A discretion call this
// plan makes"), so which restore runs is decided by which file is invoked, and there is no
// parameter for a future caller to widen. Reads no command-line arguments.
//
// This script does NOT tear the container down itself -- it assumes the owner has already run
// `docker compose down -v` followed by `docker compose up -d --wait` as part of act 2. Rebuilding
// the cluster that way does not produce a role-empty cluster: the postgres:17 entrypoint creates
// the pinned application role from POSTGRES_USER before anything else runs. A strict globals
// restore against that cluster would abort on a role collision -- the exact failure this phase's
// research reproduced live. Rather than tolerate the collision or fail outright, this script runs
// a pre-flight role check and prints an explicit, honest verdict on whether the globals restore
// was genuinely exercised (D-07/02-03-PLAN.md "A discretion call this plan makes, and why it
// matters for the runbook").
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { execa } from "execa";
import { Client } from "pg";
import { readManifest, sha256File } from "./backup-manifest";
import {
  EXPECTED_DEV_DATABASE_NAME,
  EXPECTED_DEV_DATABASE_ROLE,
  assertDevelopmentDatabase,
  getBackupDestination,
  getDevDatabaseUrl,
} from "./env";
import { safeErrorMessage } from "./log";
import { restoreIntoDevContainer, verifyRestoredRowCounts } from "./restore";

const CONTAINER_GLOBALS_DUMP_PATH = "/tmp/globals.sql";

async function runStep<T>(name: string, action: () => Promise<T>): Promise<T> {
  console.log(`[db:restore:cluster] ${name}...`);
  let result: T;
  try {
    result = await action();
  } catch (error) {
    console.error(`[db:restore:cluster] FAILED at step "${name}": ${safeErrorMessage(error)}`);
    process.exit(1);
  }
  console.log(`[db:restore:cluster] ${name} done.`);
  return result;
}

/**
 * Resolves the newest manifest at a backup destination the same way scripts/restore.ts's own
 * resolver does, returning both the parsed manifest and its filename.
 */
async function resolveLatestManifestWithFilename(destination: string) {
  const entries = await readdir(destination);
  const manifestFiles = entries.filter((entry) => entry.endsWith("-manifest.json")).sort();
  const manifestFile = manifestFiles.at(-1);
  if (!manifestFile) {
    throw new Error(`No manifest file found at backup destination "${destination}".`);
  }
  const manifest = await readManifest(join(destination, manifestFile));
  return { manifest, manifestFile };
}

/** Roles the cluster can log in as, excluding PostgreSQL's own internal pg_* roles. */
async function queryLoginRoles(client: Client): Promise<string[]> {
  const { rows } = await client.query(
    "SELECT rolname FROM pg_roles WHERE rolcanlogin = true AND rolname NOT LIKE 'pg\\_%'",
  );
  return (rows as Array<{ rolname: string }>).map((row) => row.rolname);
}

async function main(): Promise<void> {
  let verdict = "";

  // Step 1: do not tear anything down -- this script assumes act 2's rebuild already happened.
  await runStep("verify the development container is reachable", async () => {
    const result = await execa(
      "docker",
      [
        "compose",
        "exec",
        "-T",
        "db",
        "pg_isready",
        "-U",
        EXPECTED_DEV_DATABASE_ROLE,
        "-d",
        EXPECTED_DEV_DATABASE_NAME,
      ],
      { reject: false },
    );
    if (result.exitCode !== 0) {
      throw new Error(
        "The development container is not reachable. This script assumes act 2's rebuild " +
          "(docker compose down -v, then docker compose up -d --wait) has already happened -- " +
          "run that first, then re-run pnpm db:restore:cluster.",
      );
    }
  });

  const destination = getBackupDestination();

  // Step 2: resolve the newest manifest.
  const { manifest, manifestFile } = await runStep("resolve newest manifest", () =>
    resolveLatestManifestWithFilename(destination),
  );

  const dataDumpPath = join(destination, manifest.dataDump.file);
  const globalsDumpPath = join(destination, manifest.globalsDump.file);

  // Both dump checksums verified before the cluster is touched at all (T-02-14).
  await runStep("verify data dump checksum against the manifest", async () => {
    const actual = await sha256File(dataDumpPath);
    if (actual !== manifest.dataDump.sha256) {
      throw new Error(
        `Data dump checksum mismatch for "${manifest.dataDump.file}" -- refusing to restore ` +
          "from a possibly-corrupted artifact.",
      );
    }
  });

  await runStep("verify globals dump checksum against the manifest", async () => {
    const actual = await sha256File(globalsDumpPath);
    if (actual !== manifest.globalsDump.sha256) {
      throw new Error(
        `Globals dump checksum mismatch for "${manifest.globalsDump.file}" -- refusing to ` +
          "restore from a possibly-corrupted artifact.",
      );
    }
  });

  // Step 3: assert the development database before anything is touched.
  await runStep("assert development database", async () => {
    const client = new Client({ connectionString: getDevDatabaseUrl() });
    try {
      await client.connect();
      await assertDevelopmentDatabase(client);
    } finally {
      await client.end();
    }
  });

  // Step 4: pre-flight role check, branching on whether the cluster is genuinely role-empty.
  await runStep("pre-flight role check and globals restore", async () => {
    const client = new Client({ connectionString: getDevDatabaseUrl() });
    try {
      await client.connect();
      const rolesBefore = await queryLoginRoles(client);

      if (rolesBefore.includes(EXPECTED_DEV_DATABASE_ROLE)) {
        // T-02-15 (threat register): an explicit, printed verdict -- never a silent skip and
        // never a tolerated "already exists" error.
        verdict =
          `globals restore: NOT EXERCISED -- the container entrypoint already created role ` +
          `"${EXPECTED_DEV_DATABASE_ROLE}" from POSTGRES_USER, so this cluster is not ` +
          "role-empty. The globals path is exercised strictly by pnpm db:drill, whose " +
          "disposable container bootstraps under a non-colliding identity.";
        console.log(`[db:restore:cluster] ${verdict}`);
        return;
      }

      try {
        await execa("docker", [
          "compose",
          "cp",
          globalsDumpPath,
          `db:${CONTAINER_GLOBALS_DUMP_PATH}`,
        ]);

        // RESEARCH.md Pitfall 2 / T-02-15: no tolerance is added for an "already exists" error
        // on this branch -- the pre-flight check above already proved the role is genuinely
        // absent, so there is nothing here for the globals restore to legitimately collide with.
        const result = await execa(
          "docker",
          [
            "compose",
            "exec",
            "-T",
            "db",
            "psql",
            "-v",
            "ON_ERROR_STOP=1",
            "-U",
            EXPECTED_DEV_DATABASE_ROLE,
            "-d",
            "postgres",
            "-f",
            CONTAINER_GLOBALS_DUMP_PATH,
          ],
          { reject: false },
        );
        if (result.exitCode !== 0) {
          throw new Error(`Globals restore failed (exit ${result.exitCode}): ${result.stderr}`);
        }
      } finally {
        // T-02-13: removed unconditionally -- the globals dump carries a real role-password
        // verifier, and this is the one place in this phase where leaving it inside a
        // long-lived container would matter.
        await execa(
          "docker",
          ["compose", "exec", "-T", "db", "rm", "-f", CONTAINER_GLOBALS_DUMP_PATH],
          { reject: false },
        );
      }

      // Exiting zero is not proof; the role appearing is (BKP-04/T-02-15).
      const rolesAfter = await queryLoginRoles(client);
      if (!rolesAfter.includes(EXPECTED_DEV_DATABASE_ROLE)) {
        throw new Error(
          `Globals restore reported success but role "${EXPECTED_DEV_DATABASE_ROLE}" still ` +
            "does not exist -- exit code alone is not proof.",
        );
      }
      verdict = "globals restore: EXERCISED";
      console.log(`[db:restore:cluster] ${verdict}`);
    } finally {
      await client.end();
    }
  });

  // Step 5: restore the data dump exactly as scripts/restore.ts does.
  await runStep("restore data dump into the development container", () =>
    restoreIntoDevContainer(
      { dataDumpPath },
      { username: EXPECTED_DEV_DATABASE_ROLE, database: EXPECTED_DEV_DATABASE_NAME },
    ),
  );

  // Step 7: re-query and print the restored row counts.
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
    `[db:restore:cluster] Restored from manifest ${manifestFile} (data dump ` +
      `${manifest.dataDump.file}).`,
  );
  // Printed again as the final line of output, per D-07/D-15 -- this is what the owner reads at
  // the end of act 2.
  console.log(`[db:restore:cluster] ${verdict}`);
  console.log("[db:restore:cluster] Complete.");
}

main().catch((error: unknown) => {
  console.error(safeErrorMessage(error));
  process.exit(1);
});
