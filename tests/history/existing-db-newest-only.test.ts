// RUN-06 (04-CONTEXT.md D-22/D-25): applying only the newest migration to a database already
// carrying every earlier migration produces the same schema as the full-history run, and
// applies exactly one migration.
//
// D-25: both halves derive from `enumerateMigrationFiles()`'s real, committed journal --
// `list.slice(0, -1)` stages the "existing already-migrated database", then the full list is
// applied a second time. This test always exercises whatever the actual newest migration is,
// with no fixture to keep in sync.
import { describe, expect, it } from "vitest";
import {
  ensureDrizzleLedger,
  ensureRunnerTable,
  enumerateMigrationFiles,
  loadDefaultRules,
  runMigrations,
} from "../../packages/automation/src/index";
import {
  EXPECTED_FULL_HISTORY_COLUMNS,
  readSchemaShape,
  runnerClientFor,
  startEmptyPostgres17,
} from "./support";

const allMigrations = enumerateMigrationFiles();
const hasAtLeastTwoMigrations = allMigrations.length >= 2;

if (!hasAtLeastTwoMigrations) {
  // Loud, not silent: printed at collection time (so it shows up even in a filtered/CI run) and
  // the skipped test itself still appears in vitest's own output as SKIP, not simply absent.
  console.warn(
    "[tests/history/existing-db-newest-only.test.ts] Skipping RUN-06: the committed journal has " +
      `only ${allMigrations.length} entr${allMigrations.length === 1 ? "y" : "ies"} -- this test ` +
      "needs at least two so staging 'history minus the newest' is a real, non-empty step.",
  );
}

describe("tests/history/existing-db-newest-only.test.ts — RUN-06", () => {
  it.skipIf(!hasAtLeastTwoMigrations)(
    "applies only the newest migration to a database already carrying every earlier migration",
    async () => {
      const container = await startEmptyPostgres17();
      const client = runnerClientFor(container);
      await client.connect();
      try {
        await ensureDrizzleLedger(client);
        await ensureRunnerTable(client);

        const migrations = enumerateMigrationFiles();
        const staged = migrations.slice(0, -1);
        const rules = loadDefaultRules();

        // Stage the "existing already-migrated database" -- every migration except the newest.
        await runMigrations(client, { migrations: staged, rules });

        const { rows: stagedLedgerRows } = await client.query<{ count: string }>(
          "SELECT count(*) AS count FROM drizzle.__drizzle_migrations",
        );
        expect(Number(stagedLedgerRows[0].count)).toBe(staged.length);

        const shapeAfterStaged = await readSchemaShape(client);

        // Apply the full list a second time -- everything already-applied must be recognised as
        // such, and only the newest migration should actually run.
        const report = await runMigrations(client, { migrations, rules });

        const appliedEntries = report.entries.filter((entry) => entry.state === "applied");
        const skippedEntries = report.entries.filter((entry) => entry.state === "skipped");
        expect(appliedEntries).toHaveLength(1);
        expect(appliedEntries[0].tag).toBe(migrations[migrations.length - 1].tag);
        expect(skippedEntries).toHaveLength(staged.length);

        const { rows: finalLedgerRows } = await client.query<{ count: string }>(
          "SELECT count(*) AS count FROM drizzle.__drizzle_migrations",
        );
        expect(Number(finalLedgerRows[0].count)).toBe(migrations.length);
        expect(Number(finalLedgerRows[0].count)).toBe(Number(stagedLedgerRows[0].count) + 1);

        const shapeAfterFull = await readSchemaShape(client);

        // The staged database was genuinely missing something the newest migration adds -- not
        // assumed, asserted against the actual before/after table lists.
        const tablesAddedByNewest = shapeAfterFull.tables.filter(
          (table) => !shapeAfterStaged.tables.includes(table),
        );
        expect(tablesAddedByNewest.length).toBeGreaterThan(0);

        expect(shapeAfterFull.columns.recipes).toEqual(EXPECTED_FULL_HISTORY_COLUMNS.recipes);
        expect(shapeAfterFull.columns.ingredients).toEqual(EXPECTED_FULL_HISTORY_COLUMNS.ingredients);
        expect(shapeAfterFull.columns.steps).toEqual(EXPECTED_FULL_HISTORY_COLUMNS.steps);
      } finally {
        await client.end();
        await container.stop();
      }
    },
    180000,
  );
});
