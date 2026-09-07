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

// D-16: these three constants ARE the development target. Host, port, and database name are
// no longer negotiable through `.env` — only the user and password components of
// RECIPE_DEV_DATABASE_URL come from the environment. Changing any of these three values is a
// safety-relevant source diff, not routine configuration: it widens (or narrows) exactly what
// this workspace's tooling is permitted to reach. See 01-VERIFICATION.md's failed truth #6 and
// 01-REVIEW.md CR-01 for why a hostname-only allowlist was rejected in favour of pinning all
// three target-identifying components.
export const DEV_DATABASE_HOST_ALLOWLIST = ["localhost", "127.0.0.1", "::1", "[::1]"] as const;
export const EXPECTED_DEV_DATABASE_PORT = "5432";
export const EXPECTED_DEV_DATABASE_NAME = "recipe_dev";

// D-16: synchronous, pre-connect assertion that a connection string targets the pinned
// development database and nothing else. Every rejection message names
// RECIPE_DEV_DATABASE_URL and the pinned (allowed) value for the failing component, and never
// interpolates anything taken from the supplied URL itself -- not the rejected host, port,
// database name, or the URL as a whole. An operator who mistypes a value learns which
// constraint failed and reads their own .env for what they actually set; the message never
// echoes it back.
export function assertLocalDevelopmentTarget(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      "RECIPE_DEV_DATABASE_URL could not be parsed as a URL. The development target must be a " +
        `loopback host, port ${EXPECTED_DEV_DATABASE_PORT}, and database "${EXPECTED_DEV_DATABASE_NAME}".`,
    );
  }

  if (!(DEV_DATABASE_HOST_ALLOWLIST as readonly string[]).includes(parsed.hostname)) {
    throw new Error(
      "RECIPE_DEV_DATABASE_URL host is not in the pinned development loopback allowlist. " +
        `Allowed hosts: ${DEV_DATABASE_HOST_ALLOWLIST.join(", ")}.`,
    );
  }

  if (parsed.port !== EXPECTED_DEV_DATABASE_PORT) {
    throw new Error(
      "RECIPE_DEV_DATABASE_URL port does not match the pinned development port. " +
        `Allowed port: ${EXPECTED_DEV_DATABASE_PORT}.`,
    );
  }

  const databaseName = parsed.pathname.replace(/^\//, "");
  if (databaseName !== EXPECTED_DEV_DATABASE_NAME) {
    throw new Error(
      "RECIPE_DEV_DATABASE_URL database name does not match the pinned development database " +
        `name. Allowed database: ${EXPECTED_DEV_DATABASE_NAME}.`,
    );
  }
}

const EnvSchema = z.object({
  // zod 4 marks `z.string().url()` deprecated in favour of the top-level `z.url()` -- this is
  // the non-deprecated form, chained with a refinement that delegates to
  // assertLocalDevelopmentTarget so an out-of-pin value fails validation before any client is
  // constructed.
  RECIPE_DEV_DATABASE_URL: z.url().refine((value) => {
    assertLocalDevelopmentTarget(value);
    return true;
  }),
});

// The module-level parse now fires validation against a real, credential-bearing value, so its
// failure path is wrapped rather than left to a raw zod error whose serialised shape is not
// something to assume about. When the caught error is one of the value-free Errors
// assertLocalDevelopmentTarget threw (never a ZodError -- it always throws a plain Error), it is
// forwarded unchanged. Otherwise (a genuine zod validation failure: missing variable, malformed
// URL) a fixed, value-free message is thrown instead, still naming RECIPE_DEV_DATABASE_URL so
// the three pre-existing missing/malformed-variable test cases keep passing.
let parsedEnv: z.infer<typeof EnvSchema>;
try {
  parsedEnv = EnvSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    throw new Error(
      "RECIPE_DEV_DATABASE_URL is missing or malformed. Set it to a well-formed local " +
        "development connection string in .env.",
    );
  }
  throw error;
}

export const env = parsedEnv;

export function getDevDatabaseUrl(): string {
  // Redundant with the schema-level refinement above by design: the import-time refinement
  // already makes a bad value unreachable through `env`, but this call means no consumer can
  // ever obtain an unasserted URL through this accessor even if a future change loosens the
  // schema. Do not delete this call as dead code.
  assertLocalDevelopmentTarget(env.RECIPE_DEV_DATABASE_URL);
  return env.RECIPE_DEV_DATABASE_URL;
}

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
