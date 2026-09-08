// Criterion 2 / RUN-03 / RUN-04 (04-CONTEXT.md D-13..D-17): every migration runs under verified
// `lock_timeout`/`statement_timeout`; a migration blocked on a lock another session holds fails
// within roughly `lock_timeout` instead of hanging; and a `CREATE INDEX CONCURRENTLY` migration
// still succeeds because statements are never force-wrapped into one transaction.
//
// Every runner client in this file is constructed with `options: RUNNER_CONNECTION_OPTIONS` --
// this is the point of the test (D-14). All three cases stage against a single container that
// already has the committed migration history applied (`runMigrations` + `enumerateMigrationFiles`
// in `beforeAll`), so `recipes` exists and every lock/index in the cases below is real, on a real
// table -- never a hand-built fixture schema.
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  LOCK_TIMEOUT_MS,
  MigrationRefusedError,
  RUNNER_CONNECTION_OPTIONS,
  RUNNER_EXIT_CODES,
  STATEMENT_TIMEOUT_MS,
  assertTimeoutsInEffect,
  ensureDrizzleLedger,
  ensureRunnerTable,
  enumerateMigrationFiles,
  loadDefaultRules,
  runMigrations,
  type MigrationFile,
} from "../../packages/automation/src/index";
import { startEmptyPostgres17 } from "./support";

/** Discrete connection fields (never `getConnectionUri()`, per `support.ts`'s own precedent),
 * with the runner's own pinned connect-time timeout options applied -- every runner client in
 * this file is built through this function. */
function runnerClientWithTimeouts(container: StartedPostgreSqlContainer): Client {
  return new Client({
    host: container.getHost(),
    port: container.getPort(),
    user: container.getUsername(),
    password: container.getPassword(),
    database: container.getDatabase(),
    options: RUNNER_CONNECTION_OPTIONS,
  });
}

/** A client with NO connect-time options at all -- Case A's negative control, proving
 * `assertTimeoutsInEffect` is capable of failing rather than vacuously passing. */
function clientWithoutTimeouts(container: StartedPostgreSqlContainer): Client {
  return new Client({
    host: container.getHost(),
    port: container.getPort(),
    user: container.getUsername(),
    password: container.getPassword(),
    database: container.getDatabase(),
  });
}

const rules = loadDefaultRules();

describe("tests/history/timeouts-and-concurrently.test.ts — criterion 2 / RUN-03 / RUN-04", () => {
  let container: StartedPostgreSqlContainer;
  let client: Client;

  beforeAll(async () => {
    container = await startEmptyPostgres17();
    client = runnerClientWithTimeouts(container);
    await client.connect();
    await ensureDrizzleLedger(client);
    await ensureRunnerTable(client);
    const migrations = enumerateMigrationFiles();
    await runMigrations(client, { migrations, rules });
  }, 180000);

  afterAll(async () => {
    await client.end();
    await container.stop();
  });

  it(
    "Case A: lock_timeout/statement_timeout are actually in effect as raw millisecond integers, and the assertion is proven capable of failing",
    async () => {
      await expect(assertTimeoutsInEffect(client)).resolves.toBeUndefined();

      const { rows } = await client.query<{ name: string; setting: string }>(
        "SELECT name, setting FROM pg_settings WHERE name IN ('lock_timeout','statement_timeout')",
      );
      const settings = new Map(rows.map((row) => [row.name, row.setting]));
      expect(settings.get("lock_timeout")).toBe(String(LOCK_TIMEOUT_MS));
      expect(settings.get("statement_timeout")).toBe(String(STATEMENT_TIMEOUT_MS));

      const noOptionsClient = clientWithoutTimeouts(container);
      await noOptionsClient.connect();
      try {
        await expect(assertTimeoutsInEffect(noOptionsClient)).rejects.toThrow();
      } finally {
        await noOptionsClient.end();
      }
    },
    180000,
  );

  it(
    "Case B: a competing lock times out rather than hanging (RUN-03)",
    async () => {
      const blocker = clientWithoutTimeouts(container);
      await blocker.connect();
      try {
        await blocker.query("BEGIN");
        await blocker.query("LOCK TABLE recipes IN ACCESS EXCLUSIVE MODE");

        const journal = enumerateMigrationFiles();
        const newestWhen = Math.max(...journal.map((file) => file.when));
        const lockProbe: MigrationFile = {
          tag: "9999_lock_probe",
          idx: journal.length,
          when: newestWhen + 1,
          path: "in-memory://9999_lock_probe.sql",
          sql: "ALTER TABLE recipes ADD COLUMN lock_probe text;",
        };

        const before = Date.now();
        let caught: unknown;
        try {
          await runMigrations(client, { migrations: [...journal, lockProbe], rules });
        } catch (error) {
          caught = error;
        }
        const elapsed = Date.now() - before;

        expect(caught).toBeInstanceOf(MigrationRefusedError);
        expect((caught as MigrationRefusedError).code).toBe(RUNNER_EXIT_CODES.EXECUTION_FAILED);
        // A bounded window, not an exact value: comfortably above the 3000ms floor, but well
        // under 30000ms -- that gap is what distinguishes a lock timeout from a statement
        // timeout, and both from a genuine hang.
        expect(elapsed).toBeGreaterThan(LOCK_TIMEOUT_MS);
        expect(elapsed).toBeLessThan(STATEMENT_TIMEOUT_MS);
        expect((caught as Error).message.toLowerCase()).toContain("lock timeout");

        const { rows: runRows } = await client.query<{
          state: string;
          error_message: string | null;
          statement_index: number | null;
        }>(
          "SELECT state, error_message, statement_index FROM runner.migration_runs " +
            "WHERE migration_tag = '9999_lock_probe' ORDER BY id DESC LIMIT 1",
        );
        expect(runRows).toHaveLength(1);
        expect(runRows[0].state).toBe("failed");
        expect(runRows[0].error_message).not.toBeNull();
        expect(runRows[0].statement_index).toBe(0);

        const { rows: ledgerRows } = await client.query<{ count: string }>(
          "SELECT count(*) AS count FROM drizzle.__drizzle_migrations WHERE created_at = $1",
          [lockProbe.when],
        );
        expect(Number(ledgerRows[0].count)).toBe(0);

        const { rows: columnRows } = await client.query<{ column_name: string }>(
          "SELECT column_name FROM information_schema.columns " +
            "WHERE table_schema = 'public' AND table_name = 'recipes' AND column_name = 'lock_probe'",
        );
        expect(columnRows).toHaveLength(0);
      } finally {
        await blocker.query("ROLLBACK");
        await blocker.end();
      }
    },
    180000,
  );

  it(
    "Case C: CREATE INDEX CONCURRENTLY still succeeds (RUN-04), with a mixed-file negative control",
    async () => {
      const journal = enumerateMigrationFiles();
      const newestWhen = Math.max(...journal.map((file) => file.when));
      const concurrentIndexMigration: MigrationFile = {
        tag: "9999_concurrent_index",
        idx: journal.length,
        when: newestWhen + 1,
        path: "in-memory://9999_concurrent_index.sql",
        sql: "CREATE INDEX CONCURRENTLY idx_recipes_title ON recipes (title);",
      };

      await runMigrations(client, { migrations: [...journal, concurrentIndexMigration], rules });

      const { rows: indexRows } = await client.query<{ indexname: string }>(
        "SELECT indexname FROM pg_indexes WHERE indexname = 'idx_recipes_title'",
      );
      expect(indexRows).toHaveLength(1);

      const { rows: validRows } = await client.query<{ indisvalid: boolean }>(
        "SELECT indisvalid FROM pg_index WHERE indexrelid = 'idx_recipes_title'::regclass",
      );
      expect(validRows[0].indisvalid).toBe(true);

      const { rows: ledgerRows } = await client.query<{ count: string }>(
        "SELECT count(*) AS count FROM drizzle.__drizzle_migrations WHERE created_at = $1",
        [concurrentIndexMigration.when],
      );
      expect(Number(ledgerRows[0].count)).toBe(1);

      const { rows: runRows } = await client.query<{ wrapped: boolean; state: string }>(
        "SELECT wrapped, state FROM runner.migration_runs " +
          "WHERE migration_tag = '9999_concurrent_index' ORDER BY id DESC LIMIT 1",
      );
      expect(runRows).toHaveLength(1);
      expect(runRows[0].wrapped).toBe(false);
      expect(runRows[0].state).toBe("applied");

      // Negative control: a hand-constructed migration mixing CREATE INDEX CONCURRENTLY with an
      // ordinary ALTER TABLE is refused, and neither the index nor the column exists afterward --
      // this is what makes Case C's positive result mean something.
      const mixedMigration: MigrationFile = {
        tag: "9999_mixed_concurrent",
        idx: journal.length + 1,
        when: newestWhen + 2,
        path: "in-memory://9999_mixed_concurrent.sql",
        sql:
          "CREATE INDEX CONCURRENTLY idx_recipes_effort ON recipes (effort);\n" +
          "ALTER TABLE recipes ADD COLUMN mixed_probe text;",
      };

      let mixedCaught: unknown;
      try {
        await runMigrations(client, {
          migrations: [...journal, concurrentIndexMigration, mixedMigration],
          rules,
        });
      } catch (error) {
        mixedCaught = error;
      }
      expect(mixedCaught).toBeInstanceOf(MigrationRefusedError);
      expect((mixedCaught as MigrationRefusedError).code).toBe(
        RUNNER_EXIT_CODES.REFUSED_MIXED_FILE,
      );

      const { rows: mixedIndexRows } = await client.query<{ indexname: string }>(
        "SELECT indexname FROM pg_indexes WHERE indexname = 'idx_recipes_effort'",
      );
      expect(mixedIndexRows).toHaveLength(0);

      const { rows: mixedColumnRows } = await client.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns " +
          "WHERE table_schema = 'public' AND table_name = 'recipes' AND column_name = 'mixed_probe'",
      );
      expect(mixedColumnRows).toHaveLength(0);
    },
    180000,
  );
});
