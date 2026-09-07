// This test destroys and rebuilds the shared local development database via a real
// `pnpm db:reset` child process, twice, and asserts the live database state after each run.
// Relies on vitest.config.ts's fileParallelism:false to keep this file from racing the
// smoke/query suites within a single vitest run — that policy orders files within one run
// only; the actual cross-process guarantee is plan 01-05 depending on this plan and running
// in a later wave (see 01-04-PLAN.md's own note on why no other plan may share this wave).
import { readFileSync } from "node:fs";
import { execa } from "execa";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { assertDevelopmentDatabase, getDevDatabaseUrl } from "../scripts/env";

const JOURNAL_PATH = "apps/recipe-app/drizzle/meta/_journal.json";

async function assertRebuiltState(): Promise<void> {
  const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf-8")) as { entries: unknown[] };
  const journalCount = journal.entries.length;

  const client = new Client({ connectionString: getDevDatabaseUrl() });
  await client.connect();
  try {
    await assertDevelopmentDatabase(client);

    const migrationsResult = await client.query(
      "SELECT count(*) AS count FROM drizzle.__drizzle_migrations",
    );
    expect(Number(migrationsResult.rows[0].count)).toBe(journalCount);

    const tablesResult = await client.query(
      "SELECT table_schema, table_name FROM information_schema.tables " +
        "WHERE table_schema NOT IN ('pg_catalog', 'information_schema') " +
        "ORDER BY table_schema, table_name",
    );
    const tables = tablesResult.rows.map(
      (row: { table_schema: string; table_name: string }) => `${row.table_schema}.${row.table_name}`,
    );
    expect(tables).toEqual([
      "drizzle.__drizzle_migrations",
      "public.ingredients",
      "public.recipes",
      "public.steps",
    ]);

    const countsResult = await client.query(
      "SELECT (SELECT count(*) FROM recipes) AS recipes, " +
        "(SELECT count(*) FROM ingredients) AS ingredients, " +
        "(SELECT count(*) FROM steps) AS steps",
    );
    const counts = countsResult.rows[0] as { recipes: string; ingredients: string; steps: string };
    expect(Number(counts.recipes)).toBe(1);
    expect(Number(counts.ingredients)).toBe(8);
    expect(Number(counts.steps)).toBe(5);
  } finally {
    await client.end();
  }
}

describe("pnpm db:reset", () => {
  it(
    "destroys, rebuilds, migrates and reseeds non-interactively, and converges on a second run (D-22/D-24)",
    async () => {
      const firstRun = await execa("pnpm", ["run", "db:reset"], { reject: false });
      expect(firstRun.exitCode).toBe(0);
      const firstOutput = `${firstRun.stdout}\n${firstRun.stderr}`;
      expect(firstOutput).not.toContain("postgres://");

      await assertRebuiltState();

      const secondRun = await execa("pnpm", ["run", "db:reset"], { reject: false });
      expect(secondRun.exitCode).toBe(0);
      const secondOutput = `${secondRun.stdout}\n${secondRun.stderr}`;
      expect(secondOutput).not.toContain("postgres://");

      await assertRebuiltState();
    },
    180000,
  );
});
