// Shared environment-validation and environment-assertion module.
//
// Every entry point that opens a database connection — the Next.js app, drizzle.config.ts,
// the seed script, and every future CLI script (db:query, db:reset) — imports this module
// and performs its own independent validation at its own start. No process inherits another
// process's validation result: an interrupted run or two concurrent runs each get an
// independently validated connection or none at all (ENV-03).
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import dotenv from "dotenv";
import { parse as parseConnectionString } from "pg-connection-string";
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

// 02-03-PLAN.md Task 1: the pinned application role, alongside the three constants above. Must
// equal docker-compose.yml's POSTGRES_USER -- this is the role scripts/restore.ts and
// scripts/restore-cluster.ts run `pg_restore`/`psql` as inside the pinned development
// container, and (02-03-PLAN.md Task 2) the role scripts/restore-cluster.ts's pre-flight check
// looks for to decide whether the globals restore is genuinely exercisable. Changing this value
// is a safety-relevant source diff, not routine configuration, exactly like the three constants
// above.
export const EXPECTED_DEV_DATABASE_ROLE = "recipe_app";

// D-16 / CR-01: synchronous, pre-connect assertion that a connection string targets the pinned
// development database and nothing else. This validates the EFFECTIVE target -- the host,
// port, and database that `pg` will actually open a socket to -- by parsing with
// `pg-connection-string`, the exact same parser `pg` itself uses internally
// (`pg/lib/connection-parameters.js` requires it directly). Earlier code validated the
// WHATWG `URL` parser's view of the string instead, which disagrees with `pg-connection-string`
// on `?host=`/`?port=` query parameters (PostgreSQL connection URIs let any connection
// parameter be supplied as a query parameter, and it overrides the authority-section value at
// connect time) -- a pinned-looking string could pass every check while `pg` connected
// somewhere else entirely (01-REVIEW.md CR-01). Using the driver's own parser as the single
// source of truth removes that divergence by construction rather than trying to keep two
// parsers in sync.
//
// `hostaddr` and `service` are rejected outright rather than validated: `hostaddr` names an
// address to connect to that bypasses hostname resolution, and `service` indirects through an
// external connection-service file resolved at connect time -- neither is something a
// string-level effective-target check can see through, so both must be refused rather than
// inspected.
//
// Every rejection message names RECIPE_DEV_DATABASE_URL and the pinned (allowed) value for the
// failing component, and never interpolates anything taken from the supplied URL itself -- not
// the rejected host, port, database name, hostaddr, service name, or the URL as a whole. An
// operator who mistypes a value learns which constraint failed and reads their own .env for
// what they actually set; the message never echoes it back.
export function assertLocalDevelopmentTarget(url: string): void {
  let parsed: ReturnType<typeof parseConnectionString>;
  try {
    parsed = parseConnectionString(url);
  } catch {
    throw new Error(
      "RECIPE_DEV_DATABASE_URL could not be parsed as a connection string. The development " +
        `target must be a loopback host, port ${EXPECTED_DEV_DATABASE_PORT}, and database ` +
        `"${EXPECTED_DEV_DATABASE_NAME}".`,
    );
  }

  if ("hostaddr" in parsed) {
    throw new Error(
      "RECIPE_DEV_DATABASE_URL must not set a `hostaddr` connection parameter -- it can direct " +
        "the driver to connect to an address this check cannot see or validate.",
    );
  }

  if ("service" in parsed) {
    throw new Error(
      "RECIPE_DEV_DATABASE_URL must not set a `service` connection parameter -- it resolves " +
        "through an external connection-service file this check cannot see or validate.",
    );
  }

  if (!(DEV_DATABASE_HOST_ALLOWLIST as readonly string[]).includes(parsed.host ?? "")) {
    throw new Error(
      "RECIPE_DEV_DATABASE_URL host is not in the pinned development loopback allowlist. " +
        `Allowed hosts: ${DEV_DATABASE_HOST_ALLOWLIST.join(", ")}.`,
    );
  }

  if (String(parsed.port ?? "") !== EXPECTED_DEV_DATABASE_PORT) {
    throw new Error(
      "RECIPE_DEV_DATABASE_URL port does not match the pinned development port. " +
        `Allowed port: ${EXPECTED_DEV_DATABASE_PORT}.`,
    );
  }

  if (parsed.database !== EXPECTED_DEV_DATABASE_NAME) {
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

// D-03/D-04 (02-CONTEXT.md): the backup destination is a second, independent configuration
// value, deliberately NOT added to EnvSchema above -- that schema is parsed at module load by
// the Next.js app, drizzle.config.ts, and the seed script, and a required entry there would
// hard-fail all three for anyone who never takes a backup. getBackupDestination reads it
// directly from process.env instead; scripts/env.ts is the one file the guardrail suite
// (tests/guardrails.test.ts) exempts from the "no direct process.env read" check, so this is
// the ONLY module in the workspace permitted to do so for this variable -- every other module
// (scripts/backup.ts included) must call getBackupDestination.
export const BACKUP_DESTINATION_ENV_VAR = "RECIPE_BACKUP_DESTINATION";

// T-02-01 (threat register): rejects, before a single dump byte is written, the three ways a
// backup destination could defeat D-03's "outside the repository" requirement. Every rejection
// message names the variable and the failing constraint but never echoes the supplied value --
// same discipline as assertLocalDevelopmentTarget above, and load-bearing here because the
// value being validated is a filesystem path an operator may have mistyped, not a credential,
// but the project's "never echo a supplied value back" convention applies uniformly regardless
// of what kind of string is being rejected.
export function assertBackupDestination(value: string): void {
  if (value.length === 0) {
    throw new Error(
      `${BACKUP_DESTINATION_ENV_VAR} is not set. Set it in .env to an absolute path outside ` +
        "this repository's working tree where backup artifacts should be written.",
    );
  }

  if (!isAbsolute(value)) {
    throw new Error(`${BACKUP_DESTINATION_ENV_VAR} must be an absolute path, not a relative one.`);
  }

  const resolved = resolve(value);
  const relativeToWorkspace = relative(workspaceRoot, resolved);
  const isInsideWorkspace =
    relativeToWorkspace === "" ||
    (!relativeToWorkspace.startsWith("..") && !isAbsolute(relativeToWorkspace));
  if (isInsideWorkspace) {
    throw new Error(
      `${BACKUP_DESTINATION_ENV_VAR} must resolve outside this repository's working tree -- ` +
        "the globals dump it holds carries a real role-password verifier (D-03), and a path " +
        "inside the repo is one `git add -A` away from being committed.",
    );
  }
}

/**
 * Reads and validates the configured backup destination. This is the ONLY permitted way for
 * any other module in this workspace to obtain the destination path -- see the exemption note
 * above `BACKUP_DESTINATION_ENV_VAR`.
 */
export function getBackupDestination(): string {
  const value = process.env[BACKUP_DESTINATION_ENV_VAR] ?? "";
  assertBackupDestination(value);
  return value;
}
