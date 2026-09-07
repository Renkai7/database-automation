// BKP-03/BKP-04/BKP-07 (02-CONTEXT.md D-11/D-12/D-13/D-15): `db:drill` -- one hermetic sequence
// that backs up the live development database, starts a genuinely fresh, never-pre-seeded
// `postgres:17` container, restores both dumps into it, and asserts real restored content
// against the manifest just written. Takes no command-line arguments and no target of any
// kind; the disposable container's connection is one this file's own harness constructed, never
// a string a human or an agent typed (D-06).
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { runBackup } from "./backup";
import { assertArtifactIntegrity, assertRowCounts } from "./drill-assertions";
import { EXPECTED_DEV_DATABASE_NAME, getBackupDestination } from "./env";
import { safeErrorMessage } from "./log";
import { restoreIntoContainer } from "./restore";

// RESEARCH.md Pitfall 2 (live-verified): the drill's bootstrap identity must NOT be a role name
// present in the source cluster's globals dump (`recipe_app`). If it were, postgres:17's own
// entrypoint would create that role before the globals restore runs, and the globals restore's
// `CREATE ROLE recipe_app` would then collide and abort -- the exact failure mode that makes
// BKP-02 untestable. Only the *database* name may match the source; the username must not.
export const DRILL_CONTAINER_IMAGE = "postgres:17";
export const DRILL_BOOTSTRAP_USERNAME = "drilluser";

function randomThrowawayPassword(): string {
  return randomBytes(24).toString("hex");
}

// Distinct from scripts/backup.ts's runStep: that one calls process.exit(1) directly on
// failure, which is correct there because db-reset.ts-style scripts have no cleanup to run
// afterward. Here, a failure after the container has started still needs the outer
// try/finally's container.stop() to run -- and process.exit() terminates the process
// immediately, skipping any pending `finally` block. So this variant logs and re-throws instead,
// letting runDrill()'s own try/finally guarantee the container is always stopped, and leaves the
// final process.exit(1) to the top-level main().catch() below.
async function runStep<T>(name: string, action: () => Promise<T>): Promise<T> {
  console.log(`[db:drill] ${name}...`);
  try {
    const result = await action();
    console.log(`[db:drill] ${name} done.`);
    return result;
  } catch (error) {
    console.error(`[db:drill] FAILED at step "${name}": ${safeErrorMessage(error)}`);
    throw error;
  }
}

/**
 * The full hermetic drill: back up the live development database, start a fresh disposable
 * container, restore both dumps into it, and assert tier 1-2 content against the manifest just
 * written. The container is always stopped afterward, success or failure.
 */
export async function runDrill(): Promise<void> {
  const manifest = await runStep("back up the live development database", () => runBackup());
  const destination = getBackupDestination();

  let container: StartedPostgreSqlContainer | undefined;
  try {
    container = await runStep("start a fresh, never-pre-seeded postgres:17 container", () =>
      new PostgreSqlContainer(DRILL_CONTAINER_IMAGE)
        .withDatabase(EXPECTED_DEV_DATABASE_NAME)
        .withUsername(DRILL_BOOTSTRAP_USERNAME)
        .withPassword(randomThrowawayPassword())
        .start(),
    );

    await runStep("restore globals and data dumps into the disposable container", () =>
      restoreIntoContainer(
        container!,
        {
          dataDumpPath: join(destination, manifest.dataDump.file),
          globalsDumpPath: join(destination, manifest.globalsDump.file),
        },
        { username: DRILL_BOOTSTRAP_USERNAME, database: EXPECTED_DEV_DATABASE_NAME },
      ),
    );

    await runStep("assert restored artifact integrity and row counts", async () => {
      // Built from discrete host/port/user/password/database values the harness itself
      // obtained from the started container -- never getConnectionUri(), so nothing in this
      // path can ever be handed a connection string someone typed.
      const assertionClient = new Client({
        host: container!.getHost(),
        port: container!.getPort(),
        user: container!.getUsername(),
        password: container!.getPassword(),
        database: container!.getDatabase(),
      });
      await assertionClient.connect();
      try {
        await assertArtifactIntegrity(manifest, destination);
        await assertRowCounts(assertionClient, manifest);
      } finally {
        await assertionClient.end();
      }
    });
  } finally {
    if (container) {
      await runStep("stop the disposable container", () => container!.stop());
    }
  }
}

async function main(): Promise<void> {
  await runDrill();
  console.log("[db:drill] Complete.");
}

// Guarded the same way as scripts/backup.ts: importing this module must never itself run a
// drill, only direct execution (`tsx scripts/drill.ts`, i.e. `pnpm db:drill`) does.
if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(safeErrorMessage(error));
    process.exit(1);
  });
}
