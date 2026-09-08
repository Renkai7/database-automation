// The end-to-end proof for D-01/D-04/D-06/D-12/D-19: `pnpm db:migrate` is the runner, against
// the REAL pinned development database (`01-CONTEXT.md` D-17: it is disposable, so this proof
// does not need Testcontainers -- D-22 is why RUN-05/RUN-06's genuinely-empty-database proof
// uses Testcontainers instead, a later plan). Relies on vitest.config.ts's
// fileParallelism:false, the same discipline tests/db-reset.test.ts's own header documents.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execa } from "execa";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { assertDevelopmentDatabase, getDevDatabaseUrl } from "../scripts/env";

const JOURNAL_PATH = "apps/recipe-app/drizzle/meta/_journal.json";
const MIGRATIONS_DIR = "apps/recipe-app/drizzle";

// Built at runtime, not as a literal -- tests/drill/restore-drill.test.ts's own idiom for
// proving no connection string leaked into output, reused rather than reinvented here.
const SCHEME_PREFIX = ["postgres", "://"].join("");

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

function readJournal(): JournalEntry[] {
  const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf-8")) as { entries: JournalEntry[] };
  return [...journal.entries].sort((a, b) => a.idx - b.idx);
}

interface RunReportEntry {
  tag: string;
  idx: number;
  verdict: string | null;
  state: string;
}

interface RunReport {
  runId: string;
  entries: RunReportEntry[];
  worstVerdict: string;
}

/** `pnpm run db:migrate`'s stdout is pnpm's own banner, dotenv's own injected-env notice (which
 * itself contains a stray "{" inside its "tip" text -- not the real JSON), then `db:migrate`'s
 * pretty-printed JSON report on its own line-initial "{", then one human-readable
 * `[db:migrate] <tag>: <state>` line per entry. This locates the JSON by the bare "{" that
 * starts its own line (never matching the dotenv tip's embedded "{", which is never
 * line-initial) and ends it at the first human-readable line, which never appears inside the
 * JSON's own field values (tags never contain "[db:migrate] "). */
function parseRunReport(stdout: string): RunReport {
  const bareOpenBraceLine = "\n{\n";
  const markerIndex = stdout.indexOf(bareOpenBraceLine);
  const jsonStart =
    markerIndex >= 0 ? markerIndex + 1 : stdout.startsWith("{\n") ? 0 : -1;
  expect(jsonStart, `expected a JSON run report in stdout:\n${stdout}`).toBeGreaterThanOrEqual(0);
  const humanLineIndex = stdout.indexOf("\n[db:migrate] ", jsonStart);
  const jsonText = humanLineIndex === -1 ? stdout.slice(jsonStart) : stdout.slice(jsonStart, humanLineIndex);
  return JSON.parse(jsonText) as RunReport;
}

describe("pnpm db:migrate (D-01/D-04/D-06/D-12/D-19)", () => {
  it(
    "applies the full committed history as byte-compatible drizzle rows plus a complete runner-owned run report, and a second run applies nothing",
    async () => {
      const resetRun = await execa("pnpm", ["run", "db:reset"], { reject: false });
      expect(resetRun.exitCode).toBe(0);
      const resetOutput = `${resetRun.stdout}\n${resetRun.stderr}`;
      expect(resetOutput).not.toContain(SCHEME_PREFIX);

      const journal = readJournal();

      const client = new Client({ connectionString: getDevDatabaseUrl() });
      await client.connect();
      try {
        await assertDevelopmentDatabase(client);

        const ledgerResult = await client.query(
          "SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at ASC",
        );
        expect(ledgerResult.rows).toHaveLength(journal.length);

        for (let i = 0; i < journal.length; i += 1) {
          const entry = journal[i];
          const rawFileText = readFileSync(`${MIGRATIONS_DIR}/${entry.tag}.sql`, "utf-8");
          const expectedHash = createHash("sha256").update(rawFileText).digest("hex");
          const row = ledgerResult.rows[i] as { hash: string; created_at: string | number };
          expect(row.hash).toBe(expectedHash);
          expect(Number(row.created_at)).toBe(entry.when);
        }

        const runReportResult = await client.query(
          "SELECT migration_tag, verdict, findings, statement_count, state " +
            "FROM runner.migration_runs WHERE state = 'applied' ORDER BY id ASC",
        );
        expect(runReportResult.rows).toHaveLength(journal.length);
        for (const row of runReportResult.rows) {
          const typed = row as { findings: unknown; statement_count: number };
          expect(Array.isArray(typed.findings)).toBe(true);
          expect((typed.findings as unknown[]).length).toBeGreaterThan(0);
          expect(Number(typed.statement_count)).toBeGreaterThan(0);
        }
      } finally {
        await client.end();
      }

      const secondRun = await execa("pnpm", ["run", "db:migrate"], { reject: false });
      expect(secondRun.exitCode).toBe(0);
      const secondOutput = `${secondRun.stdout}\n${secondRun.stderr}`;
      expect(secondOutput).not.toContain(SCHEME_PREFIX);

      const secondReport = parseRunReport(secondRun.stdout);
      const secondAppliedEntries = secondReport.entries.filter((entry) => entry.state === "applied");
      expect(secondAppliedEntries).toHaveLength(0);

      const secondClient = new Client({ connectionString: getDevDatabaseUrl() });
      await secondClient.connect();
      try {
        const secondLedgerCount = await secondClient.query(
          "SELECT count(*) AS count FROM drizzle.__drizzle_migrations",
        );
        expect(Number((secondLedgerCount.rows[0] as { count: string }).count)).toBe(journal.length);
      } finally {
        await secondClient.end();
      }
    },
    180000,
  );
});
