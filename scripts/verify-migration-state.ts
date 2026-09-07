// CR-02: the independently testable post-migrate state assertion the rebuild tool runs on
// itself, so a `drizzle-kit migrate` that exits zero without applying SQL (an observed Windows
// failure mode) cannot produce a false-positive "Complete." A separate module rather than a
// block inline in scripts/db-reset.ts, deliberately: that script calls its own entry function
// at module load, so importing it from a test would run a real teardown. A standalone module
// is callable on its own, and therefore provable in the failing direction as well as the
// passing one -- see tests/verify-migration-state.test.ts.
//
// Scope is deliberately narrow: this checks exactly what a silently no-opped migrate would
// break -- the applied-migration count and the presence of the recipe-core tables -- and
// nothing more. Seed row counts belong to the seed's own contract and to
// tests/db-reset.test.ts's independent assertRebuiltState; hardcoding them here would couple
// this tool to fixture data.
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { assertDevelopmentDatabase, getDevDatabaseUrl } from "./env";

/** Repository-relative path to the committed Drizzle migration journal. */
export const DEFAULT_JOURNAL_PATH = "apps/recipe-app/drizzle/meta/_journal.json";

const EXPECTED_RECIPE_CORE_TABLES = ["ingredients", "recipes", "steps"] as const;

/**
 * Re-queries the live database independently of `drizzle-kit migrate`'s own exit code and
 * fails loudly when the state it finds does not match what the committed journal expects.
 * Row counts and table names are not credentials and are safe to name in a thrown message;
 * the connection string is not, so it is never interpolated into one.
 */
export async function assertMigrationHistoryApplied(
  journalPath: string = DEFAULT_JOURNAL_PATH,
): Promise<void> {
  const journal = JSON.parse(readFileSync(journalPath, "utf-8")) as { entries: unknown[] };
  const expectedCount = journal.entries.length;

  const client = new Client({ connectionString: getDevDatabaseUrl() });
  try {
    await client.connect();
    // D-21: assert the environment marker before drawing any conclusion from the rows read.
    await assertDevelopmentDatabase(client);

    const migrationsResult = await client.query(
      "SELECT count(*) AS count FROM drizzle.__drizzle_migrations",
    );
    const appliedCount = Number((migrationsResult.rows[0] as { count: string }).count);
    if (appliedCount !== expectedCount) {
      throw new Error(
        `Migration history mismatch: expected ${expectedCount} applied migration(s) (per ` +
          `${journalPath}), found ${appliedCount} in drizzle.__drizzle_migrations. The migrate ` +
          "step likely exited without applying SQL.",
      );
    }

    const tablesResult = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    const tableNames = new Set(
      tablesResult.rows.map((row) => (row as { table_name: string }).table_name),
    );
    for (const table of EXPECTED_RECIPE_CORE_TABLES) {
      if (!tableNames.has(table)) {
        throw new Error(
          `Migration history mismatch: expected recipe-core table "${table}" was not found ` +
            "after migrate. The migrate step likely exited without applying SQL.",
        );
      }
    }
  } finally {
    await client.end();
  }
}
