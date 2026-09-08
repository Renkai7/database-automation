// D-02/D-08/RUN-02: proves every refusal branch of runMigrations executes NOTHING against the
// injected client -- not merely that an error was thrown -- by asserting on a fake RunnerClient's
// recorded call list. Uses the real, installed default rules catalogue (loadDefaultRules) so a
// `DROP TABLE` genuinely classifies BLOCKED through the same floor Phase 3 shipped, rather than a
// hand-rolled rules fixture that could drift from what the runner actually sees in production.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDefaultRules } from "../src/adapter/default-rules";
import { enumerateMigrationFiles, type MigrationFile } from "../src/adapter/drizzle-migrations";
import type { RulesFile } from "../src/classifier/rules-schema";
import type { RunnerClient } from "../src/runner/client";
import { RUNNER_EXIT_CODES } from "../src/runner/exit-codes";
import { MigrationRefusedError, runMigrations, type RunMigrationsOptions } from "../src/runner/run-migrations";

const rules: RulesFile = loadDefaultRules();
const fixedNow = () => new Date("2026-01-01T00:00:00.000Z");

/** Records every query text it was asked to run -- never simulates a real Postgres server. Only
 * `readLastAppliedMillis`'s SELECT is given a canned answer (the ledger's current state); every
 * other query resolves with an empty row set, which is all applyMigration/recordRunEntry need
 * from a client they never read the return value of besides that one SELECT. */
class RecordingFakeClient implements RunnerClient {
  readonly calls: string[] = [];
  constructor(private readonly lastAppliedMillis: number | null = null) {}

  async query<R = Record<string, unknown>>(text: string): Promise<{ rows: R[] }> {
    this.calls.push(text);
    if (text.startsWith("SELECT created_at FROM drizzle.__drizzle_migrations")) {
      const rows =
        this.lastAppliedMillis === null ? [] : [{ created_at: this.lastAppliedMillis }];
      return { rows: rows as unknown as R[] };
    }
    return { rows: [] as unknown as R[] };
  }
}

function migrationFile(fields: { tag: string; idx: number; when: number; sql: string }): MigrationFile {
  return { path: `fixture/${fields.tag}.sql`, ...fields };
}

/** Awaits `promise`, asserting it rejects with a genuine `MigrationRefusedError` (never merely a
 * structurally-similar object) carrying exactly `code`. */
async function expectRefused(promise: Promise<unknown>, code: number): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught, "expected runMigrations to reject").toBeInstanceOf(MigrationRefusedError);
  expect((caught as MigrationRefusedError).code).toBe(code);
}

describe("runMigrations refusal branches (D-02/D-08/RUN-02)", () => {
  it("refuses a BLOCKED migration -- REFUSED_BLOCKED, no BEGIN, no statement text, no drizzle ledger insert", async () => {
    const client = new RecordingFakeClient();
    const file = migrationFile({
      tag: "0000_drop_ingredients",
      idx: 0,
      when: 1,
      sql: "DROP TABLE ingredients;",
    });

    await expectRefused(
      runMigrations(client, { migrations: [file], rules }),
      RUNNER_EXIT_CODES.REFUSED_BLOCKED,
    );

    expect(client.calls).not.toContain("BEGIN");
    expect(client.calls.some((call) => call.includes("DROP TABLE ingredients"))).toBe(false);
    expect(client.calls.some((call) => call.includes("INSERT INTO drizzle.__drizzle_migrations"))).toBe(
      false,
    );
    // A "refused" run-report row IS expected -- that is D-02's own record of the refusal, distinct
    // from the drizzle ledger it must never touch.
    expect(client.calls.some((call) => call.includes("INSERT INTO runner.migration_runs"))).toBe(true);
  });

  it("never classifies or executes a later migration once an earlier one is refused as BLOCKED", async () => {
    const client = new RecordingFakeClient();
    const blocked = migrationFile({ tag: "0000_blocked", idx: 0, when: 1, sql: "DROP TABLE ingredients;" });
    const later = migrationFile({
      tag: "0001_later",
      idx: 1,
      when: 2,
      sql: "CREATE TABLE later_table (id int);",
    });

    await expectRefused(
      runMigrations(client, { migrations: [blocked, later], rules }),
      RUNNER_EXIT_CODES.REFUSED_BLOCKED,
    );

    expect(client.calls.some((call) => call.includes("later_table"))).toBe(false);
    expect(client.calls.filter((call) => call.includes("INSERT INTO runner.migration_runs"))).toHaveLength(
      1,
    );
  });

  it("refuses unparseable SQL with REFUSED_PARSE_FAILURE, executing nothing at all -- not even an earlier, valid migration in the same run", async () => {
    const client = new RecordingFakeClient();
    const valid = migrationFile({
      tag: "0000_valid",
      idx: 0,
      when: 1,
      sql: "CREATE TABLE valid_table (id int);",
    });
    const unparseable = migrationFile({
      tag: "0001_unparseable",
      idx: 1,
      when: 2,
      sql: "CREATE TABLE (((;",
    });

    await expectRefused(
      runMigrations(client, { migrations: [valid, unparseable], rules }),
      RUNNER_EXIT_CODES.REFUSED_PARSE_FAILURE,
    );

    // Phase A (classify-all) runs before Phase B (execute-any) precisely so a parse failure
    // anywhere in the pending set aborts before a single statement runs. The ONE legitimate call
    // is the up-front ledger read (the D-08-preceding "what is already applied?" skip-check) --
    // proven here by asserting no BEGIN, no statement text, and no INSERT reached the client.
    expect(client.calls).toEqual([
      "SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC NULLS LAST LIMIT 1",
    ]);
  });

  it("runMigrations's own options carry no key whose value could reach the refusal branch", async () => {
    const client = new RecordingFakeClient();
    const blocked = migrationFile({ tag: "0000_blocked", idx: 0, when: 1, sql: "DROP TABLE ingredients;" });

    const options: RunMigrationsOptions = { migrations: [blocked], rules, now: fixedNow };
    expect(Object.keys(options).sort()).toEqual(["migrations", "now", "rules"]);

    const optionsWithExtraKey = { ...options, unknownOverrideFlag: true } as RunMigrationsOptions;
    await expectRefused(runMigrations(client, optionsWithExtraKey), RUNNER_EXIT_CODES.REFUSED_BLOCKED);
  });

  it("a comment-only migration file applies zero statements, is never reported SAFE, and still writes its ledger row and run-report row", async () => {
    const client = new RecordingFakeClient();
    const file = migrationFile({
      tag: "0000_comment_only",
      idx: 0,
      when: 1,
      sql: "-- nothing executable in this file\n",
    });

    const report = await runMigrations(client, { migrations: [file], rules, now: fixedNow });

    expect(report.worstVerdict).not.toBe("SAFE");
    expect(report.entries).toHaveLength(1);
    expect(report.entries[0].state).toBe("applied");
    expect(report.entries[0].statementCount).toBe(0);
    expect(client.calls.some((call) => call.includes("INSERT INTO drizzle.__drizzle_migrations"))).toBe(
      true,
    );
    expect(client.calls.some((call) => call.includes("INSERT INTO runner.migration_runs"))).toBe(true);
  });

  it("two adjacent statements separated by a standalone comment produce exactly two client.query() calls whose texts contain neither the comment nor a trailing semicolon", async () => {
    const client = new RecordingFakeClient();
    const sql = [
      "CREATE TABLE t1 (id int);",
      "-- a standalone comment between the two statements",
      "CREATE TABLE t2 (id int);",
    ].join("\n");
    const file = migrationFile({ tag: "0000_two_tables", idx: 0, when: 1, sql });

    await runMigrations(client, { migrations: [file], rules, now: fixedNow });

    const statementCalls = client.calls.filter(
      (call) => call.includes("CREATE TABLE t1") || call.includes("CREATE TABLE t2"),
    );
    expect(statementCalls).toHaveLength(2);
    for (const call of statementCalls) {
      expect(call).not.toContain(";");
      expect(call).not.toContain("--");
      expect(call).not.toContain("a standalone comment");
    }
  });

  it("a journal with two entries sharing an idx makes enumerateMigrationFiles throw, naming the duplicated idx, before any classification happens", () => {
    const dir = mkdtempSync(join(tmpdir(), "run-migrations-duplicate-idx-"));
    try {
      const metaDir = join(dir, "meta");
      mkdirSync(metaDir);
      const journalPath = join(metaDir, "_journal.json");
      writeFileSync(
        journalPath,
        JSON.stringify({
          version: "7",
          dialect: "postgresql",
          entries: [
            { idx: 0, version: "7", when: 1, tag: "0000_first", breakpoints: true },
            { idx: 0, version: "7", when: 2, tag: "0000_duplicate", breakpoints: true },
          ],
        }),
      );
      writeFileSync(join(dir, "0000_first.sql"), "CREATE TABLE a (id int);");
      writeFileSync(join(dir, "0000_duplicate.sql"), "CREATE TABLE b (id int);");

      expect(() => enumerateMigrationFiles(dir, journalPath)).toThrowError(/idx 0/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// 04-04-PLAN.md Task 1: the wrap-or-refuse decision (D-09/D-11) is proven at the runMigrations
// level too -- not just decideTransactionPolicy in isolation -- by asserting on the recorded call
// sequence, so "no BEGIN was issued" is proven rather than inferred.
describe("runMigrations transaction policy (D-09/D-11/RUN-03/RUN-04)", () => {
  it("issues no BEGIN and no COMMIT for a single-statement CREATE INDEX CONCURRENTLY migration, and issues the ledger insert as its own separate call", async () => {
    const client = new RecordingFakeClient();
    const file = migrationFile({
      tag: "0000_concurrent_index",
      idx: 0,
      when: 1,
      sql: "CREATE INDEX CONCURRENTLY idx_t_c ON t (c);",
    });

    await runMigrations(client, { migrations: [file], rules, now: fixedNow });

    expect(client.calls).not.toContain("BEGIN");
    expect(client.calls).not.toContain("COMMIT");
    expect(client.calls).toContain("CREATE INDEX CONCURRENTLY idx_t_c ON t (c)");
    const ledgerCall = client.calls.find((call) =>
      call.includes("INSERT INTO drizzle.__drizzle_migrations"),
    );
    expect(ledgerCall).toBeDefined();
    expect(ledgerCall).not.toBe("CREATE INDEX CONCURRENTLY idx_t_c ON t (c)");
  });

  it("refuses a file mixing CREATE INDEX CONCURRENTLY with an ALTER TABLE with REFUSED_MIXED_FILE, executing no statement from that file at all", async () => {
    const client = new RecordingFakeClient();
    const file = migrationFile({
      tag: "0000_mixed",
      idx: 0,
      when: 1,
      sql: "CREATE INDEX CONCURRENTLY idx_t_c ON t (c); ALTER TABLE t ADD COLUMN foo text;",
    });

    await expectRefused(
      runMigrations(client, { migrations: [file], rules, now: fixedNow }),
      RUNNER_EXIT_CODES.REFUSED_MIXED_FILE,
    );

    // Checked as an EXACT executed statement, not a substring -- the refused run-report row's
    // own findings legitimately carry rule rationale prose that mentions "CREATE INDEX
    // CONCURRENTLY" (rules.json's create-index-concurrently rule text), which a plain substring
    // check would false-positive against.
    expect(client.calls).not.toContain("CREATE INDEX CONCURRENTLY idx_t_c ON t (c)");
    expect(client.calls).not.toContain("ALTER TABLE t ADD COLUMN foo text");
    expect(
      client.calls.some((call) => call.includes("INSERT INTO drizzle.__drizzle_migrations")),
    ).toBe(false);
    expect(client.calls.some((call) => call.includes("INSERT INTO runner.migration_runs"))).toBe(
      true,
    );
  });

  it("still issues exactly one BEGIN, one client.query per split statement, the ledger insert, and one COMMIT, in order, for an ordinary multi-statement migration", async () => {
    const client = new RecordingFakeClient();
    const sql = ["CREATE TABLE t1 (id int);", "CREATE TABLE t2 (id int);"].join("\n");
    const file = migrationFile({ tag: "0000_ordinary", idx: 0, when: 1, sql });

    await runMigrations(client, { migrations: [file], rules, now: fixedNow });

    const relevantCalls = client.calls.filter(
      (call) =>
        call === "BEGIN" ||
        call === "COMMIT" ||
        call.includes("CREATE TABLE t1") ||
        call.includes("CREATE TABLE t2") ||
        call.includes("INSERT INTO drizzle.__drizzle_migrations"),
    );
    expect(relevantCalls).toHaveLength(5);
    expect(relevantCalls[0]).toBe("BEGIN");
    expect(relevantCalls[1]).toContain("CREATE TABLE t1");
    expect(relevantCalls[2]).toContain("CREATE TABLE t2");
    expect(relevantCalls[3]).toContain("INSERT INTO drizzle.__drizzle_migrations");
    expect(relevantCalls[4]).toBe("COMMIT");
  });

  it("never sends the fake client a single call whose text contains more than one statement (Pitfall 1)", async () => {
    const client = new RecordingFakeClient();
    const sql = ["CREATE TABLE p1 (id int);", "CREATE TABLE p2 (id int);"].join("\n");
    const file = migrationFile({ tag: "0000_no_multi_statement", idx: 0, when: 1, sql });

    await runMigrations(client, { migrations: [file], rules, now: fixedNow });

    for (const call of client.calls) {
      // Pitfall 1: sending the whole file as one client.query() call would silently reintroduce
      // PostgreSQL's own implicit multi-statement transaction wrapping. No single recorded call
      // may name more than one CREATE TABLE.
      const createTableOccurrences = (call.match(/CREATE TABLE/g) ?? []).length;
      expect(createTableOccurrences).toBeLessThanOrEqual(1);
    }
  });
});
