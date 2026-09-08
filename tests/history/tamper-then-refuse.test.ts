// Criterion 1 / RUN-01 (04-CONTEXT.md D-23, docs/decisions.md D12): a migration whose committed
// bytes classify SAFE, altered afterward to contain a `DROP TABLE`, is refused at execution
// against a real database -- nothing from it applies, the ledger gains no row for it, and the
// run report records the refusal with the matching rule id.
//
// The tamper happens in an `mkdtemp` copy -- the committed `apps/recipe-app/drizzle/` directory
// and its journal are never mutated. `enumerateMigrationFiles(migrationsDir, journalPath)`'s
// defaulted-override signature is the mechanism: a migrations directory is not a database
// target (D-23), so this drives the real analyzer/runner core against a temp directory without
// touching D-06's "no command accepts a target" rule.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MIGRATIONS_DIR,
  MigrationRefusedError,
  RUNNER_EXIT_CODES,
  analyzeSql,
  ensureDrizzleLedger,
  ensureRunnerTable,
  enumerateMigrationFiles,
  loadDefaultRules,
  runMigrations,
} from "../../packages/automation/src/index";
import { readSchemaShape, runnerClientFor, startEmptyPostgres17 } from "./support";

const OLDEST_MIGRATION_TAG = "0000_bumpy_khan";

interface TamperedFixture {
  tempDir: string;
  tempJournalPath: string;
  untamperedOldestSql: string;
}

/** Copies the committed migrations directory (both .sql files and meta/_journal.json) into a
 * fresh mkdtemp directory, then appends `DROP TABLE ingredients;` to the temp copy of the OLDEST
 * migration (the one the corpus manifest records as SAFE) -- leaving `meta/_journal.json`
 * untouched. This is exactly the shape of a migration altered after generation and after
 * upstream approval. */
function buildTamperedFixture(): TamperedFixture {
  const tempDir = mkdtempSync(join(tmpdir(), "history-tamper-"));
  cpSync(DEFAULT_MIGRATIONS_DIR, tempDir, { recursive: true });
  const tempJournalPath = join(tempDir, "meta", "_journal.json");
  const oldestPath = join(tempDir, `${OLDEST_MIGRATION_TAG}.sql`);

  const untamperedOldestSql = readFileSync(oldestPath, "utf-8");
  writeFileSync(oldestPath, `${untamperedOldestSql}\nDROP TABLE ingredients;\n`, "utf-8");

  return { tempDir, tempJournalPath, untamperedOldestSql };
}

/** Runs the tampered fixture against a fresh, empty postgres:17 container and asserts every
 * facet of the refusal: the thrown error, the ledger, the table list, and the run report. */
async function assertTamperedFixtureRefuses(fixture: TamperedFixture): Promise<void> {
  const rules = loadDefaultRules();

  // The "classified SAFE upstream" half of criterion 1, made explicit rather than assumed.
  const untamperedResult = await analyzeSql(fixture.untamperedOldestSql, rules);
  expect(untamperedResult.verdict).toBe("SAFE");

  const container = await startEmptyPostgres17();
  const client = runnerClientFor(container);
  await client.connect();
  try {
    await ensureDrizzleLedger(client);
    await ensureRunnerTable(client);

    const migrations = enumerateMigrationFiles(fixture.tempDir, fixture.tempJournalPath);

    let thrown: unknown;
    try {
      await runMigrations(client, { migrations, rules });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(MigrationRefusedError);
    const refusedError = thrown as MigrationRefusedError;
    expect(refusedError.code).toBe(RUNNER_EXIT_CODES.REFUSED_BLOCKED);
    // Needle assembled at runtime from the container's own throwaway credential -- never a
    // literal in this file.
    expect(refusedError.message).not.toContain(container.getPassword());

    const { rows: ledgerRows } = await client.query<{ count: string }>(
      "SELECT count(*) AS count FROM drizzle.__drizzle_migrations",
    );
    expect(Number(ledgerRows[0].count)).toBe(0);

    const shape = await readSchemaShape(client);
    expect(shape.tables).not.toContain("public.ingredients");
    expect(shape.tables).not.toContain("public.recipes");
    expect(shape.tables).not.toContain("public.steps");

    const { rows: runRows } = await client.query<{
      state: string;
      verdict: string;
      findings: Array<{ ruleIds: string[] }>;
    }>("SELECT state, verdict, findings FROM runner.migration_runs");
    expect(runRows).toHaveLength(1);
    expect(runRows[0].state).toBe("refused");
    expect(runRows[0].verdict).toBe("BLOCKED");
    const allRuleIds = runRows[0].findings.flatMap((finding) => finding.ruleIds);
    expect(allRuleIds).toContain("drop-table");
  } finally {
    await client.end();
    await container.stop();
  }
}

describe("tests/history/tamper-then-refuse.test.ts — criterion 1 / RUN-01", () => {
  const tempDirsToClean: string[] = [];

  afterEach(() => {
    while (tempDirsToClean.length > 0) {
      const dir = tempDirsToClean.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it(
    "refuses a migration classified SAFE upstream but tampered to contain DROP TABLE, applying nothing",
    async () => {
      const fixture = buildTamperedFixture();
      tempDirsToClean.push(fixture.tempDir);
      await assertTamperedFixtureRefuses(fixture);
    },
    180000,
  );

  it(
    "refuses the same tampered directory identically on a second run -- the refusal is not a one-shot state",
    async () => {
      const fixture = buildTamperedFixture();
      tempDirsToClean.push(fixture.tempDir);
      await assertTamperedFixtureRefuses(fixture);
    },
    180000,
  );
});
