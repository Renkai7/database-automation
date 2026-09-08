// D-21: report-and-clear recovery for the one residual partial-failure state D-11's mixed-file
// refusal leaves possible -- a failed CREATE INDEX CONCURRENTLY (or its UNIQUE/REINDEX cousins)
// that left an unresolved marker in `runner.migration_runs` (D-18/D-20). This command reports
// the exact database state and clears the marker. It never repairs anything itself and it never
// touches the committed migration journal file -- three things stated explicitly, not left
// implicit:
//
//   1. It never edits, rewrites, or deletes the committed Drizzle migration journal (the
//      metadata file `drizzle-kit generate` maintains under `apps/recipe-app/drizzle/meta/`).
//   2. It never drops an index, drops a table, or otherwise repairs the schema on its own
//      initiative -- D-20/D-21 declined to put destructive capability inside the component
//      whose whole job is refusing destructive operations. Any INVALID index this command
//      prints still exists in the database afterward; removing it is the operator's decision.
//   3. It accepts no target, no argument, no connection string, and no interactive input --
//      like every other command in this repository (01-CONTEXT.md D-16, 02-CONTEXT.md D-06).
//      The target always comes from `getDevDatabaseUrl()`/`RECIPE_DEV_DATABASE_URL`, never from
//      a command-line argument or standard input.
//
// `reportAndResolveMarkers(client)` is exported so a test can call it against a harness-built
// client with no CLI involved (mirroring D-23's harness-constructs-the-connection seam); the CLI
// entry point below is guarded by `import.meta.main` so importing this module never itself runs
// a recovery. Never a forced synchronous process termination (Pitfall 2,
// `packages/automation/src/cli.ts`'s own header comment) -- doing so immediately after a
// `libpg-query` WASM parse reproduced a genuine Windows libuv crash in this repo, and this
// command's own `assertDevelopmentDatabase`/table-bootstrap path runs through the same process.
// `run(): Promise<number>` returns the intended code, applied via the exit-code property once,
// at the very end.
import { Client } from "pg";
import {
  ensureRunnerTable,
  readInvalidIndexes,
  readUnresolvedMarkers,
  resolveMarker,
  RUNNER_CONNECTION_OPTIONS,
  type RunnerClient,
} from "../packages/automation/src/index";
import { assertDevelopmentDatabase, assertLocalDevelopmentTarget, getDevDatabaseUrl } from "./env";
import { safeErrorMessage } from "./log";

/**
 * D-21's report-and-clear body. Reads every unresolved marker, prints one block per marker
 * (never a summary), reads every INVALID index and prints those too, states unmissably that
 * nothing above has been repaired, then resolves every marker it read -- so `pnpm db:migrate`
 * can proceed. Takes an already-connected client; connecting and asserting the pinned
 * development target is the CLI entry point's own job (D-23), not this function's.
 */
export async function reportAndResolveMarkers(client: RunnerClient): Promise<number> {
  const markers = await readUnresolvedMarkers(client);

  if (markers.length === 0) {
    console.log("[db:migrate:recover] No unresolved migration marker was found.");
    return 0;
  }

  for (const marker of markers) {
    console.log(
      `[db:migrate:recover] ${marker.migrationTag} (journal idx ${marker.migrationIdx}): ` +
        `statement ${marker.statementIndex ?? "?"} of ${marker.statementCount}, ` +
        `wrapped=${marker.wrapped}, verdict=${marker.verdict}, state=${marker.state}` +
        (marker.errorMessage === null ? "" : `, error: ${marker.errorMessage}`) +
        `, started at ${marker.startedAt}.`,
    );
  }

  const invalidIndexes = await readInvalidIndexes(client);
  if (invalidIndexes.length === 0) {
    console.log("[db:migrate:recover] No INVALID index was found.");
  } else {
    for (const invalidIndex of invalidIndexes) {
      console.log(
        `[db:migrate:recover] INVALID index: ${invalidIndex.schema}.${invalidIndex.table}.` +
          `${invalidIndex.indexName}.`,
      );
    }
  }

  console.log(
    "[db:migrate:recover] This command has repaired nothing. Any INVALID index listed above " +
      "still exists in the database -- dropping it (or otherwise repairing the schema) is the " +
      "operator's own decision, never this command's.",
  );

  for (const marker of markers) {
    await resolveMarker(client, marker.id);
  }

  console.log(
    `[db:migrate:recover] ${markers.length} marker(s) resolved. "pnpm db:migrate" will now ` +
      "proceed.",
  );

  return 0;
}

/** Connects to the pinned development target, asserts it, and hands an already-connected client
 * to `reportAndResolveMarkers` -- the CLI's own half of D-23's split. Never forces a synchronous
 * process exit (see the header comment). */
async function run(): Promise<number> {
  const url = getDevDatabaseUrl();
  assertLocalDevelopmentTarget(url);

  const client = new Client({ connectionString: url, options: RUNNER_CONNECTION_OPTIONS });
  try {
    await client.connect();
    await assertDevelopmentDatabase(client);
    await ensureRunnerTable(client);
    return await reportAndResolveMarkers(client);
  } finally {
    await client.end();
  }
}

if (import.meta.main) {
  run()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(safeErrorMessage(error));
      process.exitCode = 1;
    });
}
