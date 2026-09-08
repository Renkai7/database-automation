// RUN-05 (04-CONTEXT.md D-22/D-23): applying the full committed migration history to a
// genuinely empty PostgreSQL 17 instance produces the recipe-core schema -- asserted table by
// table and column by column, automatically, with no human reading a dump.
//
// Drives the real `runMigrations` core directly against a Testcontainers-derived client -- never
// `pnpm db:migrate` (which is pinned to the real development target by design, D-22/D-23) and
// never the pinned development database. `ensureDrizzleLedger`/`ensureRunnerTable` are called
// explicitly because there is no `scripts/db-migrate.ts` in this path to call them.
import { describe, expect, it } from "vitest";
import {
  ensureDrizzleLedger,
  ensureRunnerTable,
  enumerateMigrationFiles,
  loadDefaultRules,
  runMigrations,
} from "../../packages/automation/src/index";
import { EXPECTED_FULL_HISTORY_COLUMNS, readSchemaShape, startEmptyPostgres17, runnerClientFor } from "./support";

describe("tests/history/empty-db-full-history.test.ts — RUN-05", () => {
  it(
    "applies the full committed migration history to a genuinely empty database and produces the recipe-core schema",
    async () => {
      const container = await startEmptyPostgres17();
      const client = runnerClientFor(container);
      await client.connect();
      try {
        // The emptiness is proven, not assumed.
        const beforeShape = await readSchemaShape(client);
        expect(beforeShape.tables.filter((table) => table.startsWith("public."))).toEqual([]);

        await ensureDrizzleLedger(client);
        await ensureRunnerTable(client);

        const migrations = enumerateMigrationFiles();
        const rules = loadDefaultRules();
        const report = await runMigrations(client, { migrations, rules });

        expect(report.entries.filter((entry) => entry.state === "applied")).toHaveLength(
          migrations.length,
        );

        const { rows: ledgerRows } = await client.query<{ count: string }>(
          "SELECT count(*) AS count FROM drizzle.__drizzle_migrations",
        );
        expect(Number(ledgerRows[0].count)).toBe(migrations.length);

        const afterShape = await readSchemaShape(client);
        expect(afterShape.tables).toContain("drizzle.__drizzle_migrations");
        expect(afterShape.tables).toContain("runner.migration_runs");
        expect(afterShape.tables).toContain("public.recipes");
        expect(afterShape.tables).toContain("public.ingredients");
        expect(afterShape.tables).toContain("public.steps");

        expect(afterShape.columns.recipes).toEqual(EXPECTED_FULL_HISTORY_COLUMNS.recipes);
        expect(afterShape.columns.ingredients).toEqual(EXPECTED_FULL_HISTORY_COLUMNS.ingredients);
        expect(afterShape.columns.steps).toEqual(EXPECTED_FULL_HISTORY_COLUMNS.steps);

        const { rows: runRows } = await client.query<{
          state: string;
          findings: Array<Record<string, unknown>>;
        }>("SELECT state, findings FROM runner.migration_runs WHERE run_id = $1", [report.runId]);
        expect(runRows.length).toBeGreaterThan(0);
        for (const row of runRows) {
          expect(row.state).toBe("applied");
          expect(Array.isArray(row.findings)).toBe(true);
          expect((row.findings as unknown[]).length).toBeGreaterThan(0);
        }
      } finally {
        await client.end();
        await container.stop();
      }
    },
    180000,
  );
});
