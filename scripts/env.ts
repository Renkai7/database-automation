// Shared environment-validation and environment-assertion module.
//
// Every entry point that opens a database connection — the Next.js app, drizzle.config.ts,
// the seed script, and every future CLI script (db:query, db:reset) — imports this module
// and performs its own independent validation at its own start. No process inherits another
// process's validation result: an interrupted run or two concurrent runs each get an
// independently validated connection or none at all (ENV-03).
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

function findWorkspaceRoot(startDir: string): string {
  let dir = startDir;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        "Could not locate the workspace root: no pnpm-workspace.yaml found in any parent directory of " +
          startDir,
      );
    }
    dir = parent;
  }
}

const workspaceRoot = findWorkspaceRoot(process.cwd());
dotenv.config({ path: join(workspaceRoot, ".env") });

// D-20: Coolify injects a bare DATABASE_URL into linked services by default — this is the
// platform's normal behaviour, not a hypothetical edge case, so its mere presence must hard-fail
// before anything else runs. A warning-and-continue path was explicitly rejected: the project's
// non-negotiables prefer architectural enforcement over remembered caution. This check runs
// before the zod parse below so it is always the message a developer sees first, and it fires
// even when RECIPE_DEV_DATABASE_URL is also correctly set — presence of the bare variable alone
// is disqualifying.
if (process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is set but must never be used directly in this project. " +
      "Use RECIPE_DEV_DATABASE_URL (or the staging/prod equivalent) instead.",
  );
}

const EnvSchema = z.object({
  RECIPE_DEV_DATABASE_URL: z.string().url(),
});

export const env = EnvSchema.parse(process.env);

export function getDevDatabaseUrl(): string {
  return env.RECIPE_DEV_DATABASE_URL;
}

export const EXPECTED_DEV_DATABASE_NAME = "recipe_dev";

/** The minimal shape assertDevelopmentDatabase needs from a database client. */
export interface QueryableClient {
  query(text: string): Promise<{ rows: Array<{ name: string }> }>;
}

// D-21: the environment marker is the connection's own current_database() rather than a row
// stored in a table. A stored row travels inside a pg_dump payload and would survive a restore
// into a differently-named database, silently asserting the wrong environment there — exactly
// the failure this check exists to prevent. A property of the connection target cannot be
// carried across by a restore the way a data row can.
export async function assertDevelopmentDatabase(
  client: QueryableClient,
  expectedName: string = EXPECTED_DEV_DATABASE_NAME,
): Promise<void> {
  const { rows } = await client.query("SELECT current_database() AS name");
  const actualName = rows[0]?.name;
  if (actualName !== expectedName) {
    throw new Error(
      `Refusing to proceed: connected to database "${actualName}", expected "${expectedName}".`,
    );
  }
}
