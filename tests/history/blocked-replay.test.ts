// Criterion 5 / D-32's committed BLOCKED replay (04-CONTEXT.md, docs/decisions.md D12): the real,
// drizzle-kit-generated migration that plan 04-07's Task 1 produced by removing `ingredients`
// (and its relations) from `apps/recipe-app/src/db/schema.ts` for real, watched be refused live
// by the runner against the pinned development database, then reverted -- leaving no trace in
// the committed migrations directory or journal (a BLOCKED migration left in committed history
// would be replayed by every `pnpm db:reset` and asserted on by RUN-05). This test is what makes
// that refusal permanent: it replays the exact committed corpus fixture bytes
// (`packages/automation/test/corpus/app-shaped/generated-drop-ingredients-table.sql`) against a
// fresh, disposable postgres:17 container, so the refusal never has to be taken on trust again.
//
// The mechanism mirrors `tests/history/tamper-then-refuse.test.ts` (04-03) directly: a fresh
// `mkdtemp` copy of the committed `apps/recipe-app/drizzle/` directory (the committed directory
// itself is never touched), with the fixture's bytes added as a new `.sql` file and a matching
// `meta/_journal.json` entry appended after the newest committed entry --
// `enumerateMigrationFiles(migrationsDir, journalPath)`'s defaulted-override signature (D-23)
// drives the real runner against this temp directory without touching D-06's "no command accepts
// a target" rule.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_JOURNAL_PATH,
  DEFAULT_MIGRATIONS_DIR,
  MigrationRefusedError,
  RUNNER_EXIT_CODES,
  ensureDrizzleLedger,
  ensureRunnerTable,
  enumerateMigrationFiles,
  loadDefaultRules,
  runMigrations,
} from "../../packages/automation/src/index";
import { readSchemaShape, runnerClientFor, startEmptyPostgres17 } from "./support";

/** Repository-root-relative -- read directly rather than duplicated inline, so this test always
 * replays the exact bytes the corpus manifest itself pins (single source of truth). */
const GENERATED_BLOCKED_FIXTURE_PATH =
  "packages/automation/test/corpus/app-shaped/generated-drop-ingredients-table.sql";
const NEW_MIGRATION_TAG = "9999_generated_drop_ingredients_replay";

interface ReplayFixture {
  tempDir: string;
  tempJournalPath: string;
}

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

/** Copies the committed migrations directory (both `.sql` files and `meta/_journal.json`) into a
 * fresh mkdtemp directory, then adds the committed corpus fixture's exact bytes as a new `.sql`
 * file there with a journal entry whose `idx`/`when` follow the newest committed entry -- exactly
 * the shape of the real migration Task 1 generated, watched refused, and reverted. */
function buildReplayFixture(): ReplayFixture {
  const tempDir = mkdtempSync(join(tmpdir(), "history-blocked-replay-"));
  cpSync(DEFAULT_MIGRATIONS_DIR, tempDir, { recursive: true });
  const tempJournalPath = join(tempDir, "meta", "_journal.json");

  const journal = JSON.parse(readFileSync(tempJournalPath, "utf-8")) as Journal;
  const newestEntry = journal.entries.reduce((a, b) => (a.idx > b.idx ? a : b));
  journal.entries.push({
    idx: newestEntry.idx + 1,
    version: newestEntry.version,
    when: newestEntry.when + 1,
    tag: NEW_MIGRATION_TAG,
    breakpoints: true,
  });
  writeFileSync(tempJournalPath, JSON.stringify(journal, null, 2), "utf-8");

  const generatedSql = readFileSync(GENERATED_BLOCKED_FIXTURE_PATH, "utf-8");
  writeFileSync(join(tempDir, `${NEW_MIGRATION_TAG}.sql`), generatedSql, "utf-8");

  return { tempDir, tempJournalPath };
}

/** Runs the fixture against a fresh, empty `postgres:17` container and asserts every facet of the
 * refusal: the thrown error, the ingredients table's continued existence, the ledger's entry
 * count, and the run report -- then runs the exact same temp directory a second time against the
 * same container, proving the refusal is not a one-shot state. */
async function assertReplayRefusesTwice(fixture: ReplayFixture): Promise<void> {
  const rules = loadDefaultRules();
  const container = await startEmptyPostgres17();
  const client = runnerClientFor(container);
  await client.connect();
  try {
    await ensureDrizzleLedger(client);
    await ensureRunnerTable(client);

    const migrations = enumerateMigrationFiles(fixture.tempDir, fixture.tempJournalPath);
    const committedMigrations = enumerateMigrationFiles(DEFAULT_MIGRATIONS_DIR, DEFAULT_JOURNAL_PATH);

    for (let attempt = 1; attempt <= 2; attempt += 1) {
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

      // Every earlier migration applied (the drop is the newest entry) -- proven directly, not
      // inferred, since the ingredients table must still exist for this refusal to mean anything.
      const shape = await readSchemaShape(client);
      expect(shape.tables).toContain("public.ingredients");

      const { rows: ledgerRows } = await client.query<{ count: string }>(
        "SELECT count(*) AS count FROM drizzle.__drizzle_migrations",
      );
      expect(Number(ledgerRows[0].count)).toBe(committedMigrations.length);

      const { rows: runRows } = await client.query<{
        state: string;
        verdict: string;
        findings: Array<{ ruleIds: string[] }>;
      }>(
        "SELECT state, verdict, findings FROM runner.migration_runs " +
          "WHERE migration_tag = $1 ORDER BY id DESC LIMIT 1",
        [NEW_MIGRATION_TAG],
      );
      expect(runRows).toHaveLength(1);
      expect(runRows[0].state).toBe("refused");
      expect(runRows[0].verdict).toBe("BLOCKED");
      const allRuleIds = runRows[0].findings.flatMap((finding) => finding.ruleIds);
      expect(allRuleIds).toContain("drop-table");
    }
  } finally {
    await client.end();
    await container.stop();
  }
}

describe("tests/history/blocked-replay.test.ts — criterion 5 / D-32's committed BLOCKED replay", () => {
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
    "refuses the real drizzle-kit-generated DROP TABLE ingredients migration, applying nothing " +
      "from it, and refuses identically when replayed a second time against the same container",
    async () => {
      const fixture = buildReplayFixture();
      tempDirsToClean.push(fixture.tempDir);
      await assertReplayRefusesTwice(fixture);
    },
    180000,
  );
});
