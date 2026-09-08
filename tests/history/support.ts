// Shared helpers for the migration-history suite (tests/history/**, D-24). Factored out into
// their own non-test module rather than exported from one *.test.ts file and imported by its
// siblings: vitest re-executes a *.test.ts file's top-level `describe()`/`it()` registrations
// whenever another included test file imports it, which would silently duplicate RUN-05's tests
// inside RUN-06's and criterion 1's runs. A plain module under tests/history/ sidesteps that
// without creating a new `scripts/` module for test-only helpers (04-03-PLAN.md's own
// prohibition) -- these helpers stay exactly where the plan puts them, just not registered as
// their own suite.
//
// D-22/D-23 (04-CONTEXT.md): every helper here builds its connection from a Testcontainers
// instance's own DISCRETE host/port/user/password/database fields -- never `getConnectionUri()`
// and never a connection string a human or an agent supplied -- mirroring `scripts/drill.ts`'s
// established harness-constructs-the-connection pattern exactly.
import { randomBytes } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { EXPECTED_DEV_DATABASE_NAME } from "../../scripts/env";

/** `01-CONTEXT.md` D-12/`02-CONTEXT.md` D-12: the Debian image, not alpine, everywhere in this
 * repository's Testcontainers usage. */
export const HISTORY_TEST_CONTAINER_IMAGE = "postgres:17";

/** Mirrors `scripts/backup.ts`'s own `RECIPE_CORE_TABLES` -- deliberately re-declared here
 * rather than imported, since that module's list is a private implementation detail of a
 * different tool with a different failure mode. */
export const RECIPE_CORE_TABLES = ["ingredients", "recipes", "steps"] as const;

function randomThrowawayPassword(): string {
  return randomBytes(24).toString("hex");
}

/**
 * Starts a genuinely empty `postgres:17` Testcontainers instance -- database name pinned to
 * `EXPECTED_DEV_DATABASE_NAME` (matching `scripts/drill.ts`'s own convention), with a throwaway
 * username and a `randomBytes`-derived throwaway password. Never the pinned development target.
 */
export async function startEmptyPostgres17(): Promise<StartedPostgreSqlContainer> {
  return new PostgreSqlContainer(HISTORY_TEST_CONTAINER_IMAGE)
    .withDatabase(EXPECTED_DEV_DATABASE_NAME)
    .withUsername("historytestuser")
    .withPassword(randomThrowawayPassword())
    .start();
}

/** Builds a `pg.Client` (`RunnerClient`-shaped) from a started container's discrete connection
 * fields -- `scripts/drill.ts:220-230`'s concrete precedent, never `container.getConnectionUri()`. */
export function runnerClientFor(container: StartedPostgreSqlContainer): Client {
  return new Client({
    host: container.getHost(),
    port: container.getPort(),
    user: container.getUsername(),
    password: container.getPassword(),
    database: container.getDatabase(),
  });
}

export interface SchemaShape {
  /** Sorted `${table_schema}.${table_name}` for every schema outside pg_catalog/information_schema. */
  tables: string[];
  /** Per recipe-core table, the ordinal_position-ordered `${column_name}:${data_type}:${is_nullable}` list. */
  columns: Record<string, string[]>;
}

/**
 * Reads the tier-3-in-spirit schema shape (`02-CONTEXT.md` D-13) directly from
 * `information_schema` -- no `pg_dump` involved. `client` must already be connected.
 */
export async function readSchemaShape(client: Client): Promise<SchemaShape> {
  const { rows: tableRows } = await client.query<{ table_schema: string; table_name: string }>(
    "SELECT table_schema, table_name FROM information_schema.tables " +
      "WHERE table_schema NOT IN ('pg_catalog', 'information_schema') " +
      "ORDER BY table_schema, table_name",
  );
  const tables = tableRows.map((row) => `${row.table_schema}.${row.table_name}`);

  const columns: Record<string, string[]> = {};
  for (const table of RECIPE_CORE_TABLES) {
    const { rows: columnRows } = await client.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(
      "SELECT column_name, data_type, is_nullable FROM information_schema.columns " +
        "WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position",
      [table],
    );
    columns[table] = columnRows.map(
      (row) => `${row.column_name}:${row.data_type}:${row.is_nullable}`,
    );
  }

  return { tables, columns };
}

/** Derived from `apps/recipe-app/src/db/schema.ts` and the two committed migration files
 * (`0000_bumpy_khan.sql`, `0001_busy_thunderbolt.sql`) -- the expected column shape once the
 * full committed history has applied. A plain expectation, not re-derived from schema.ts at
 * runtime, so RUN-05/RUN-06 prove what the ACTUAL committed SQL produces rather than merely
 * restating schema.ts's own intent back at itself. Shared between
 * `empty-db-full-history.test.ts` and `existing-db-newest-only.test.ts` so RUN-06's own
 * "matches the full-history shape" assertion never drifts from RUN-05's. */
export const EXPECTED_FULL_HISTORY_COLUMNS: Record<(typeof RECIPE_CORE_TABLES)[number], string[]> = {
  recipes: [
    "id:uuid:NO",
    "slug:text:NO",
    "title:text:NO",
    "subtitle:text:NO",
    "base_servings:integer:NO",
    "time_label:text:NO",
    "effort:text:NO",
    "base_kcal:integer:NO",
    "created_at:timestamp with time zone:NO",
  ],
  ingredients: [
    "id:uuid:NO",
    "recipe_id:uuid:NO",
    "name:text:NO",
    "quantity:numeric:NO",
    "unit:text:NO",
    "position:integer:NO",
  ],
  steps: [
    "id:uuid:NO",
    "recipe_id:uuid:NO",
    "position:integer:NO",
    "body:text:NO",
    "timer_label:text:YES",
  ],
};
