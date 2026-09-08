// D-27: the pinned thin entry point over the runner core in `packages/automation`. This is the
// ONLY module on the migrate path permitted to import `pg` or hold a real connection (D-28) --
// everything downstream of here (`runMigrations` and everything it calls) takes an
// already-constructed `RunnerClient`, never opening one itself.
//
// D-23: `--migrations-dir <path>` names a DIRECTORY, not a database target -- `01-CONTEXT.md`
// D-16 and `02-CONTEXT.md` D-06's "no command accepts a target" rule is untouched by this flag.
// It exists so a test can drive this real command against a temporary directory (criterion 1's
// tamper-then-refuse test, plan 04-03) without mutating the committed
// `apps/recipe-app/drizzle` directory. No other flag, argument, or environment variable is
// accepted -- this command still refuses a database target exactly as
// `db:backup`/`db:restore`/`db:reset` already do; the target always comes from
// `getDevDatabaseUrl()`/`RECIPE_DEV_DATABASE_URL`, never from `process.argv`.
//
// Never force a synchronous process exit (Pitfall 2, `packages/automation/src/cli.ts`'s own
// header comment): doing so immediately after `libpg-query` WASM parses reproduced a genuine
// Windows libuv crash in this repo. `run(): Promise<number>` returns the intended code, applied
// via `process.exitCode` once at the very end, letting the event loop drain naturally.
import { Client } from "pg";
import {
  assertTimeoutsInEffect,
  ensureDrizzleLedger,
  ensureRunnerTable,
  enumerateMigrationFiles,
  loadDefaultRules,
  MigrationRefusedError,
  RUNNER_CONNECTION_OPTIONS,
  RUNNER_EXIT_CODES,
  runMigrations,
} from "../packages/automation/src/index";
import { assertDevelopmentDatabase, assertLocalDevelopmentTarget, getDevDatabaseUrl } from "./env";
import { safeErrorMessage } from "./log";

const DEFAULT_MIGRATIONS_DIR = "apps/recipe-app/drizzle";
const ONLY_ACCEPTED_FLAG_MESSAGE = "The only accepted flag is --migrations-dir <path>.";

interface ParsedArgs {
  migrationsDir: string;
}

/** Parses `process.argv`, accepting exactly one optional flag, `--migrations-dir <path>`.
 * Rejects every other argument with a message naming the only accepted flag -- this command
 * takes no target of any kind (D-23). */
function parseArgs(argv: string[]): ParsedArgs {
  let migrationsDir = DEFAULT_MIGRATIONS_DIR;
  let index = 0;
  while (index < argv.length) {
    const arg = argv[index];
    if (arg === "--migrations-dir") {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error(`--migrations-dir requires a path argument. ${ONLY_ACCEPTED_FLAG_MESSAGE}`);
      }
      migrationsDir = value;
      index += 2;
      continue;
    }
    throw new Error(`Unrecognized argument "${arg}". ${ONLY_ACCEPTED_FLAG_MESSAGE}`);
  }
  return { migrationsDir };
}

/** Runs the whole migrate command and returns the intended process exit code -- never forces a
 * synchronous exit itself (see the header comment). */
async function run(): Promise<number> {
  let parsedArgs: ParsedArgs;
  try {
    parsedArgs = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(safeErrorMessage(error));
    return 1;
  }

  const journalPath = `${parsedArgs.migrationsDir}/meta/_journal.json`;

  // D-16/D-06: the pinned development target, asserted before any connection is opened --
  // exactly as db:backup/db:restore/db:reset already do.
  const url = getDevDatabaseUrl();
  assertLocalDevelopmentTarget(url);

  // D-14: the timeouts are applied as libpq connection options at connect time -- there is then
  // no window in which the session exists without them.
  const client = new Client({ connectionString: url, options: RUNNER_CONNECTION_OPTIONS });
  try {
    await client.connect();
    await assertDevelopmentDatabase(client);

    try {
      await assertTimeoutsInEffect(client);
    } catch (error) {
      console.error(safeErrorMessage(error));
      return RUNNER_EXIT_CODES.REFUSED_TIMEOUTS_NOT_IN_EFFECT;
    }

    await ensureDrizzleLedger(client);
    await ensureRunnerTable(client);

    const migrations = enumerateMigrationFiles(parsedArgs.migrationsDir, journalPath);
    const rules = loadDefaultRules();

    try {
      const report = await runMigrations(client, { migrations, rules });
      // D-06: the complete run report, printed whole -- never a summary. Phase 5's CI renders
      // exactly this JSON shape; Phase 7's audit log records it.
      console.log(JSON.stringify(report, null, 2));
      for (const entry of report.entries) {
        const verdictSuffix = entry.verdict === null ? "" : ` (${entry.verdict})`;
        console.log(`[db:migrate] ${entry.tag}: ${entry.state}${verdictSuffix}`);
      }
      return RUNNER_EXIT_CODES.APPLIED;
    } catch (error) {
      if (error instanceof MigrationRefusedError) {
        console.error(safeErrorMessage(error));
        return error.code;
      }
      throw error;
    }
  } finally {
    await client.end();
  }
}

run()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(safeErrorMessage(error));
    process.exitCode = 1;
  });
