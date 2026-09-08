// Criterion 4 / RUN-08 (04-CONTEXT.md D-18..D-21): the whole partial-failure-and-recovery cycle,
// proven against a real database. Because 04-04's D-11 mixed-file refusal makes a half-applied
// FILE impossible by construction, the only residual partial state the runner can reach is a
// failed `CREATE UNIQUE INDEX CONCURRENTLY` leaving an INVALID index behind -- this is exactly
// that case, deliberately manufactured with real duplicate data rather than an artificial fault
// injection.
//
// Stage: a single container, the full committed history applied, then two `steps` rows sharing
// one `recipe_id` inserted directly -- this is what makes the next case's unique index genuinely
// fail for a real reason. Cases A-E then run in strict sequence against that ONE container
// (`fileParallelism: false` in vitest.history.config.ts), each depending on the state the
// previous case left behind, exactly as the plan specifies.
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  MigrationRefusedError,
  RUNNER_CONNECTION_OPTIONS,
  RUNNER_EXIT_CODES,
  ensureDrizzleLedger,
  ensureRunnerTable,
  enumerateMigrationFiles,
  loadDefaultRules,
  readUnresolvedMarkers,
  runMigrations,
  type MigrationFile,
} from "../../packages/automation/src/index";
import { reportAndResolveMarkers } from "../../scripts/db-migrate-recover";
import { startEmptyPostgres17 } from "./support";

const rules = loadDefaultRules();
const INVALID_INDEX_NAME = "idx_steps_recipe_unique";

/** Discrete connection fields (never `getConnectionUri()`, per `support.ts`'s own precedent),
 * with the runner's own pinned connect-time timeout options applied -- matching
 * `tests/history/timeouts-and-concurrently.test.ts`'s own `runnerClientWithTimeouts` (04-04). */
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

describe("tests/history/partial-failure-recovery.test.ts — criterion 4 / RUN-08", () => {
  let container: StartedPostgreSqlContainer;
  let client: Client;
  let journal: MigrationFile[];
  let newestWhen: number;
  let sharedRecipeId: string;

  // The migration that will genuinely fail -- built once, reused by Cases A, B, and D's report.
  let concurrentMigration: MigrationFile;

  beforeAll(async () => {
    container = await startEmptyPostgres17();
    client = runnerClientWithTimeouts(container);
    await client.connect();
    await ensureDrizzleLedger(client);
    await ensureRunnerTable(client);

    journal = enumerateMigrationFiles();
    await runMigrations(client, { migrations: journal, rules });
    newestWhen = Math.max(...journal.map((file) => file.when));

    // Two `steps` rows sharing one `recipe_id`, at DIFFERENT positions (steps already carries a
    // committed UNIQUE(recipe_id, position) constraint from 01-CONTEXT.md D-09 -- this insert
    // must not collide with it). Sharing `recipe_id` is what makes
    // `CREATE UNIQUE INDEX CONCURRENTLY ... ON steps (recipe_id)` fail for a real reason.
    const { rows: recipeRows } = await client.query<{ id: string }>(
      "INSERT INTO recipes (slug, title, subtitle, base_servings, time_label, effort, base_kcal) " +
        "VALUES ('partial-failure-fixture', 'Partial Failure Fixture', 'test fixture', 2, " +
        "'10 min', 'Easy', 100) RETURNING id",
    );
    sharedRecipeId = recipeRows[0].id;
    await client.query(
      "INSERT INTO steps (recipe_id, position, body) VALUES ($1, 0, 'Step one')",
      [sharedRecipeId],
    );
    await client.query(
      "INSERT INTO steps (recipe_id, position, body) VALUES ($1, 1, 'Step two')",
      [sharedRecipeId],
    );

    concurrentMigration = {
      tag: "9999_partial_failure_index",
      idx: journal.length,
      when: newestWhen + 1,
      path: "in-memory://9999_partial_failure_index.sql",
      sql: `CREATE UNIQUE INDEX CONCURRENTLY ${INVALID_INDEX_NAME} ON steps (recipe_id);`,
    };
  }, 180000);

  afterAll(async () => {
    await client.end();
    await container.stop();
  });

  it(
    "Case A: a genuine mid-migration failure leaves a failed, unresolved marker and an INVALID index -- no ledger row",
    async () => {
      let caught: unknown;
      try {
        await runMigrations(client, { migrations: [concurrentMigration], rules });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(MigrationRefusedError);
      expect((caught as MigrationRefusedError).code).toBe(RUNNER_EXIT_CODES.EXECUTION_FAILED);

      const { rows: ledgerRows } = await client.query<{ count: string }>(
        "SELECT count(*) AS count FROM drizzle.__drizzle_migrations WHERE created_at = $1",
        [concurrentMigration.when],
      );
      expect(Number(ledgerRows[0].count)).toBe(0);

      const { rows: runRows } = await client.query<{
        state: string;
        wrapped: boolean;
        statement_index: number | null;
        error_message: string | null;
      }>(
        "SELECT state, wrapped, statement_index, error_message FROM runner.migration_runs " +
          "WHERE migration_tag = $1 ORDER BY id DESC LIMIT 1",
        [concurrentMigration.tag],
      );
      expect(runRows).toHaveLength(1);
      expect(runRows[0].state).toBe("failed");
      expect(runRows[0].wrapped).toBe(false);
      expect(runRows[0].statement_index).not.toBeNull();
      expect(runRows[0].error_message).not.toBeNull();

      const { rows: indexRows } = await client.query<{ indisvalid: boolean }>(
        `SELECT indisvalid FROM pg_index WHERE indexrelid = '${INVALID_INDEX_NAME}'::regclass`,
      );
      expect(indexRows).toHaveLength(1);
      expect(indexRows[0].indisvalid).toBe(false);
    },
    180000,
  );

  it(
    "Case B: the next run refuses -- REFUSED_STALE_MARKER, naming the migration tag and statement index, applying nothing",
    async () => {
      const { rows: ledgerCountBefore } = await client.query<{ count: string }>(
        "SELECT count(*) AS count FROM drizzle.__drizzle_migrations",
      );

      let caught: unknown;
      try {
        await runMigrations(client, { migrations: journal, rules });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(MigrationRefusedError);
      expect((caught as MigrationRefusedError).code).toBe(RUNNER_EXIT_CODES.REFUSED_STALE_MARKER);
      expect((caught as Error).message).toContain(concurrentMigration.tag);
      expect((caught as Error).message).toMatch(/statement 0 of 1/);

      const { rows: ledgerCountAfter } = await client.query<{ count: string }>(
        "SELECT count(*) AS count FROM drizzle.__drizzle_migrations",
      );
      expect(Number(ledgerCountAfter[0].count)).toBe(Number(ledgerCountBefore[0].count));
    },
    180000,
  );

  it(
    "Case C: a hand-inserted crash marker also refuses, independently of Case A's cause",
    async () => {
      // Resolve Case A's own marker first (a direct, individual resolve -- distinct from Case
      // D's own recovery-command flow below) so this case's refusal is provably caused by the
      // freshly hand-inserted marker, not Case A's leftover one.
      const { rows: caseAMarkerRows } = await client.query<{ id: string }>(
        "SELECT id FROM runner.migration_runs WHERE migration_tag = $1 AND state = 'failed' " +
          "ORDER BY id DESC LIMIT 1",
        [concurrentMigration.tag],
      );
      expect(caseAMarkerRows).toHaveLength(1);
      await client.query("UPDATE runner.migration_runs SET state = 'resolved', finished_at = now() WHERE id = $1", [
        caseAMarkerRows[0].id,
      ]);

      const unresolvedAfterManualResolve = await readUnresolvedMarkers(client);
      expect(unresolvedAfterManualResolve).toHaveLength(0);

      // A row simulating a process killed mid-flight -- no caught-error handler could ever have
      // recorded this; it is state `in_flight` from the moment it is inserted, for the same
      // migration Case A already proved fails for real.
      await client.query(
        "INSERT INTO runner.migration_runs (run_id, migration_tag, migration_idx, sql_sha256, " +
          "verdict, findings, wrapped, state, statement_index, statement_count, error_message, " +
          "started_at, finished_at, duration_ms, rules_version) VALUES (gen_random_uuid(), $1, " +
          "$2, 'crashsimulated', 'SAFE', '[]'::jsonb, FALSE, 'in_flight', 0, 1, NULL, now(), " +
          "NULL, NULL, 1)",
        [concurrentMigration.tag, concurrentMigration.idx],
      );

      let caught: unknown;
      try {
        await runMigrations(client, { migrations: journal, rules });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(MigrationRefusedError);
      expect((caught as MigrationRefusedError).code).toBe(RUNNER_EXIT_CODES.REFUSED_STALE_MARKER);
      expect((caught as Error).message).toContain(concurrentMigration.tag);
    },
    180000,
  );

  it(
    "Case D: recovery reports and resolves, and repairs nothing -- the INVALID index survives",
    async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      let output: string;
      try {
        const code = await reportAndResolveMarkers(client);
        expect(code).toBe(0);
        output = logSpy.mock.calls.map((args) => args.join(" ")).join("\n");
      } finally {
        logSpy.mockRestore();
      }

      expect(output).toContain(concurrentMigration.tag);
      expect(output).toContain("statement 0 of 1");
      expect(output).toContain(INVALID_INDEX_NAME);
      expect(output.toLowerCase()).toContain("repaired nothing");

      const stillUnresolved = await readUnresolvedMarkers(client);
      expect(stillUnresolved).toHaveLength(0);

      const { rows: allRowsForMigration } = await client.query<{ state: string }>(
        "SELECT state FROM runner.migration_runs WHERE migration_tag = $1",
        [concurrentMigration.tag],
      );
      expect(allRowsForMigration.length).toBeGreaterThan(0);
      for (const row of allRowsForMigration) {
        expect(row.state).toBe("resolved");
      }

      const { rows: stillInvalidRows } = await client.query<{ indisvalid: boolean }>(
        `SELECT indisvalid FROM pg_index WHERE indexrelid = '${INVALID_INDEX_NAME}'::regclass`,
      );
      expect(stillInvalidRows).toHaveLength(1);
      expect(stillInvalidRows[0].indisvalid).toBe(false);
    },
    180000,
  );

  it(
    "Case E: after recovery, dropping the INVALID index (the operator's own action) and running again applies a fresh migration normally",
    async () => {
      // The operator's own action, performed by the test standing in for the operator -- never
      // by the runner itself (D-20/D-21). The only DROP INDEX in this whole file.
      await client.query(`DROP INDEX IF EXISTS ${INVALID_INDEX_NAME}`);

      const freshMigration: MigrationFile = {
        tag: "9999_partial_failure_followup",
        idx: journal.length + 1,
        when: newestWhen + 2,
        path: "in-memory://9999_partial_failure_followup.sql",
        sql: "ALTER TABLE recipes ADD COLUMN partial_failure_probe text;",
      };

      const report = await runMigrations(client, {
        migrations: [...journal, freshMigration],
        rules,
      });
      const followupEntry = report.entries.find((entry) => entry.tag === freshMigration.tag);
      expect(followupEntry?.state).toBe("applied");

      const { rows: columnRows } = await client.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' " +
          "AND table_name = 'recipes' AND column_name = 'partial_failure_probe'",
      );
      expect(columnRows).toHaveLength(1);
    },
    180000,
  );
});
