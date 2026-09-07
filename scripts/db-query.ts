// ENV-05: the direct-query path Claude Code uses through the Bash tool. Hardcoded to the
// local development database (D-15/D-16/D-17) — the SQL text is the only thing a caller can
// influence. There is deliberately no url, env, or database flag of any kind, and no
// environment variable this file itself consults for a target: the connection string comes from the
// shared, validated env module (./env) and nowhere else, and that module's own bare-
// DATABASE_URL hard failure (D-20) runs at import time, before any of this file's own code
// executes — so a leaked DATABASE_URL aborts before any connection is opened.
import { Client } from "pg";
import { assertDevelopmentDatabase, getDevDatabaseUrl } from "./env";
import { safeErrorMessage } from "./log";

function usageAndExit(): never {
  console.error("Usage: db-query <SQL>");
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0].startsWith("-")) {
    // D-16: exactly one positional argument (the SQL text) is accepted; a hyphen-prefixed
    // argument is rejected before a client is even constructed, so no flag surface can ever
    // be silently introduced.
    usageAndExit();
  }
  const sql = args[0];

  const client = new Client({ connectionString: getDevDatabaseUrl() });
  try {
    await client.connect();
    // D-21/T-01-17: assert the environment before running anything the caller asked for.
    await assertDevelopmentDatabase(client);
    const result = await client.query(sql);
    console.table(result.rows);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  // T-01-18: see scripts/log.ts for the never-print-the-raw-error-object rationale.
  console.error(safeErrorMessage(error));
  process.exit(1);
});
