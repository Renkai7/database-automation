// D-21 (04-05-PLAN.md Task 2): proves `pnpm db:migrate:recover` in both directions -- green
// against the real, marker-free pinned development database (no credential leaked, no journal
// mutation), and the fake-client case that proves what it prints and what it never does (never
// a DELETE, never a DROP) when unresolved markers and an INVALID index genuinely exist.
import { execa } from "execa";
import { parse as parseConnectionString } from "pg-connection-string";
import { describe, expect, it, vi } from "vitest";
import type { RunnerClient } from "../packages/automation/src/index";
import { getDevDatabaseUrl } from "../scripts/env";
import { reportAndResolveMarkers } from "../scripts/db-migrate-recover";

const CONNECTION_STRING_SCHEME_PREFIX = ["postgres", "://"].join("");

/** Records every query it was asked to run and answers `readUnresolvedMarkers`/
 * `readInvalidIndexes` with canned rows -- never a real Postgres server. */
class FakeClient implements RunnerClient {
  readonly calls: string[] = [];
  constructor(
    private readonly unresolvedRows: Record<string, unknown>[],
    private readonly invalidIndexRows: Record<string, unknown>[],
  ) {}

  async query<R = Record<string, unknown>>(text: string): Promise<{ rows: R[] }> {
    this.calls.push(text);
    if (text.includes("FROM runner.migration_runs WHERE state = 'in_flight'")) {
      return { rows: this.unresolvedRows as unknown as R[] };
    }
    if (text.includes("pg_index")) {
      return { rows: this.invalidIndexRows as unknown as R[] };
    }
    return { rows: [] as unknown as R[] };
  }
}

describe("scripts/db-migrate-recover.ts", () => {
  it(
    "pnpm run db:migrate:recover exits 0 and reports no unresolved marker against the real, marker-free development database, leaking no credential and mutating no journal",
    async () => {
      const result = await execa("pnpm", ["run", "db:migrate:recover"], { reject: false });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("No unresolved migration marker was found");

      const combinedOutput = `${result.stdout}\n${result.stderr}`;
      expect(combinedOutput).not.toContain(CONNECTION_STRING_SCHEME_PREFIX);
      const parsed = parseConnectionString(getDevDatabaseUrl());
      if (parsed.password) {
        expect(combinedOutput).not.toContain(parsed.password);
      }

      const gitStatus = await execa("git", [
        "status",
        "--porcelain",
        "apps/recipe-app/drizzle/meta/_journal.json",
      ]);
      expect(gitStatus.stdout.trim()).toBe("");
    },
    30000,
  );

  it("reportAndResolveMarkers prints both migration tags, their statement indexes, and the INVALID index, states nothing was repaired, resolves both markers, and issues no DELETE or DROP", async () => {
    const markerA = {
      id: 1,
      run_id: "11111111-1111-1111-1111-111111111111",
      migration_tag: "9999_marker_a",
      migration_idx: 10,
      verdict: "SAFE",
      statement_index: 0,
      statement_count: 1,
      wrapped: false,
      state: "failed",
      error_message: "duplicate key value violates unique constraint",
      started_at: "2026-01-01T00:00:00.000Z",
    };
    const markerB = {
      id: 2,
      run_id: "22222222-2222-2222-2222-222222222222",
      migration_tag: "9999_marker_b",
      migration_idx: 11,
      verdict: "SAFE",
      statement_index: 0,
      statement_count: 1,
      wrapped: false,
      state: "in_flight",
      error_message: null,
      started_at: "2026-01-01T00:01:00.000Z",
    };
    const invalidIndex = { schema: "public", table: "steps", index_name: "idx_steps_recipe_unique" };
    const client = new FakeClient([markerA, markerB], [invalidIndex]);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    let code: number;
    let output: string;
    try {
      code = await reportAndResolveMarkers(client);
      // Captured BEFORE mockRestore() -- mockRestore() also clears .mock.calls (it does
      // everything mockClear() does, per vitest's own semantics), so reading it afterward would
      // silently see an empty array.
      output = logSpy.mock.calls.map((args) => args.join(" ")).join("\n");
    } finally {
      logSpy.mockRestore();
    }

    expect(code).toBe(0);
    expect(output).toContain("9999_marker_a");
    expect(output).toContain("9999_marker_b");
    expect(output).toContain("statement 0 of 1");
    expect(output).toContain("idx_steps_recipe_unique");
    expect(output.toLowerCase()).toContain("repaired nothing");

    const resolveCalls = client.calls.filter(
      (call) => call.includes("UPDATE") && call.includes("'resolved'"),
    );
    expect(resolveCalls).toHaveLength(2);
    expect(resolveCalls.some((call) => call.includes("WHERE id = 1"))).toBe(true);
    expect(resolveCalls.some((call) => call.includes("WHERE id = 2"))).toBe(true);

    for (const call of client.calls) {
      expect(call).not.toContain("DELETE FROM");
      expect(call).not.toContain("DROP INDEX");
      expect(call).not.toContain("DROP TABLE");
    }
  });

  it("reportAndResolveMarkers reports no INVALID index found when there is none, without erroring", async () => {
    const marker = {
      id: 3,
      run_id: "33333333-3333-3333-3333-333333333333",
      migration_tag: "9999_marker_c",
      migration_idx: 12,
      verdict: "SAFE",
      statement_index: 0,
      statement_count: 1,
      wrapped: false,
      state: "in_flight",
      error_message: null,
      started_at: "2026-01-01T00:02:00.000Z",
    };
    const client = new FakeClient([marker], []);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    let code: number;
    let output: string;
    try {
      code = await reportAndResolveMarkers(client);
      output = logSpy.mock.calls.map((args) => args.join(" ")).join("\n");
    } finally {
      logSpy.mockRestore();
    }

    expect(code).toBe(0);
    expect(output).toContain("No INVALID index was found");
  });
});
