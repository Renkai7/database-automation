// D-18/D-19/D-20 (plan 04-05): the in-flight marker lifecycle -- `writeInFlightMarker`,
// `resolveMarker`, `markMarkerApplied`, `markMarkerFailed`, `readUnresolvedMarkers`,
// `readInvalidIndexes` -- proven against a recording fake `RunnerClient`, never a real database
// (this file runs in the default `pnpm test` suite, which is Docker-free). Query TEXT is
// asserted directly (the SQL this module builds), and row-shape validation is proven in both
// directions by feeding the fake client canned rows.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RunnerClient } from "../src/runner/client";
import {
  markMarkerApplied,
  markMarkerFailed,
  readInvalidIndexes,
  readUnresolvedMarkers,
  resolveMarker,
  RUNNER_RUNS_TABLE,
  UnresolvedMarkerError,
  writeInFlightMarker,
  type UnresolvedMarker,
} from "../src/runner/runner-table";

/** Records every query text it was asked to run and returns canned rows for the next call --
 * `next` is consumed in FIFO order, one entry per `query()` call; once exhausted, further calls
 * get an empty row set. `RETURNING id` is handled specially (mirroring a real `bigserial`
 * primary key) so `writeInFlightMarker` has something to read back. */
class FakeClient implements RunnerClient {
  readonly calls: string[] = [];
  private readonly next: Array<Record<string, unknown>[]> = [];
  private nextId = 1;

  enqueue(rows: Record<string, unknown>[]): void {
    this.next.push(rows);
  }

  async query<R = Record<string, unknown>>(text: string): Promise<{ rows: R[] }> {
    this.calls.push(text);
    if (text.includes("RETURNING id")) {
      const row = { id: this.nextId };
      this.nextId += 1;
      return { rows: [row] as unknown as R[] };
    }
    const queued = this.next.shift();
    return { rows: (queued ?? []) as unknown as R[] };
  }
}

const fixedMarkerRow = {
  id: 7,
  run_id: "11111111-1111-1111-1111-111111111111",
  migration_tag: "9999_probe",
  migration_idx: 3,
  verdict: "SAFE",
  statement_index: 0,
  statement_count: 1,
  wrapped: false,
  state: "in_flight" as const,
  error_message: null,
  started_at: "2026-01-01T00:00:00.000Z",
};

describe("runner-table.ts source (structural, D-19)", () => {
  it("contains no DELETE statement anywhere", () => {
    // Built at runtime, not as a literal, so this needle never collides with the prose comments
    // this file's own module documentation carries describing exactly this property (e.g.
    // "never DELETEs") -- those are English words about the constraint, not a SQL statement, and
    // must not trip the check that proves the constraint holds.
    const needle = ["DELETE", " FROM"].join("");
    const source = readFileSync(join(__dirname, "../src/runner/runner-table.ts"), "utf-8");
    expect(
      source,
      "D-19: this table is the substrate Phase 7's audit log is built on -- an audit trail " +
        "that erases its own hard cases is not an audit trail",
    ).not.toContain(needle);
  });
});

describe("writeInFlightMarker", () => {
  it("inserts a row with state in_flight, wrapped FALSE, and returns the row's id", async () => {
    const client = new FakeClient();

    const id = await writeInFlightMarker(client, {
      runId: "11111111-1111-1111-1111-111111111111",
      migrationTag: "9999_probe",
      migrationIdx: 3,
      sqlSha256: "deadbeef",
      verdict: "SAFE",
      findings: [],
      statementIndex: 0,
      statementCount: 1,
      rulesVersion: 1,
      startedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(id).toBe(1);
    expect(client.calls).toHaveLength(1);
    const insertText = client.calls[0];
    expect(insertText).toContain(`INSERT INTO ${RUNNER_RUNS_TABLE}`);
    expect(insertText).toContain("'in_flight'");
    expect(insertText).toContain("FALSE");
    expect(insertText).toContain("RETURNING id");
    expect(insertText).not.toContain("BEGIN");
  });
});

describe("markMarkerApplied / markMarkerFailed", () => {
  it("markMarkerApplied issues an UPDATE setting state to applied, never a second INSERT", async () => {
    const client = new FakeClient();
    await markMarkerApplied(client, 7, "2026-01-01T00:00:05.000Z", 5000);

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toContain(`UPDATE ${RUNNER_RUNS_TABLE}`);
    expect(client.calls[0]).toContain("'applied'");
    expect(client.calls[0]).toContain("WHERE id = 7");
    expect(client.calls[0]).not.toContain("INSERT");
  });

  it("markMarkerFailed issues an UPDATE setting state to failed and carries the error message, never a second INSERT", async () => {
    const client = new FakeClient();
    await markMarkerFailed(client, 7, "duplicate key value violates unique constraint", "2026-01-01T00:00:05.000Z");

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toContain(`UPDATE ${RUNNER_RUNS_TABLE}`);
    expect(client.calls[0]).toContain("'failed'");
    expect(client.calls[0]).toContain("duplicate key value violates unique constraint");
    expect(client.calls[0]).toContain("WHERE id = 7");
    expect(client.calls[0]).not.toContain("INSERT");
  });
});

describe("resolveMarker", () => {
  it("issues an UPDATE setting state to resolved and finished_at, never a DELETE", async () => {
    const client = new FakeClient();
    await resolveMarker(client, 7);

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toContain(`UPDATE ${RUNNER_RUNS_TABLE}`);
    expect(client.calls[0]).toContain("'resolved'");
    expect(client.calls[0]).toContain("finished_at");
    expect(client.calls[0]).toContain("WHERE id = 7");
    expect(client.calls[0]).not.toContain("DELETE");
  });
});

describe("readUnresolvedMarkers", () => {
  it("builds a query selecting state = 'in_flight' OR (state = 'failed' AND wrapped = false), ordered by id", async () => {
    const client = new FakeClient();
    client.enqueue([]);
    await readUnresolvedMarkers(client);

    expect(client.calls).toHaveLength(1);
    const queryText = client.calls[0];
    expect(queryText).toContain("state = 'in_flight'");
    expect(queryText).toContain("state = 'failed' AND wrapped = false");
    expect(queryText).toContain("ORDER BY id ASC");
  });

  it("maps a returned in_flight row into an UnresolvedMarker with camelCase fields", async () => {
    const client = new FakeClient();
    client.enqueue([fixedMarkerRow]);

    const markers = await readUnresolvedMarkers(client);

    expect(markers).toHaveLength(1);
    const marker = markers[0];
    expect(marker.id).toBe(7);
    expect(marker.migrationTag).toBe("9999_probe");
    expect(marker.migrationIdx).toBe(3);
    expect(marker.verdict).toBe("SAFE");
    expect(marker.statementIndex).toBe(0);
    expect(marker.statementCount).toBe(1);
    expect(marker.wrapped).toBe(false);
    expect(marker.state).toBe("in_flight");
    expect(marker.errorMessage).toBeNull();
    expect(marker.startedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("maps a returned failed row (wrapped false) the same way, carrying its error message", async () => {
    const client = new FakeClient();
    client.enqueue([{ ...fixedMarkerRow, state: "failed", error_message: "lock timeout" }]);

    const markers = await readUnresolvedMarkers(client);

    expect(markers).toHaveLength(1);
    expect(markers[0].state).toBe("failed");
    expect(markers[0].errorMessage).toBe("lock timeout");
  });

  it("throws on a row whose state is neither in_flight nor failed -- never trusts the write path (D-19 validate-on-read discipline)", async () => {
    const client = new FakeClient();
    client.enqueue([{ ...fixedMarkerRow, state: "applied" }]);

    await expect(readUnresolvedMarkers(client)).rejects.toThrow();
  });
});

describe("readInvalidIndexes", () => {
  it("builds a query joining pg_index/pg_class/pg_namespace, filtered on indisvalid = false", async () => {
    const client = new FakeClient();
    client.enqueue([]);
    await readInvalidIndexes(client);

    expect(client.calls).toHaveLength(1);
    const queryText = client.calls[0];
    expect(queryText).toContain("pg_index");
    expect(queryText).toContain("pg_class");
    expect(queryText).toContain("pg_namespace");
    expect(queryText).toContain("indisvalid = false");
  });

  it("maps a returned row into an InvalidIndex with schema/table/indexName", async () => {
    const client = new FakeClient();
    client.enqueue([{ schema: "public", table: "steps", index_name: "idx_steps_recipe_unique" }]);

    const indexes = await readInvalidIndexes(client);

    expect(indexes).toEqual([
      { schema: "public", table: "steps", indexName: "idx_steps_recipe_unique" },
    ]);
  });

  it("resolves to an empty array when nothing is INVALID", async () => {
    const client = new FakeClient();
    client.enqueue([]);
    await expect(readInvalidIndexes(client)).resolves.toEqual([]);
  });
});

describe("UnresolvedMarkerError", () => {
  it("names every marker's migration tag, journal idx, statement index of statement count, and the recovery instruction", () => {
    const markers: UnresolvedMarker[] = [
      {
        id: 7,
        runId: "11111111-1111-1111-1111-111111111111",
        migrationTag: "9999_probe",
        migrationIdx: 3,
        verdict: "SAFE",
        statementIndex: 0,
        statementCount: 1,
        wrapped: false,
        state: "failed",
        errorMessage: "duplicate key value",
        startedAt: "2026-01-01T00:00:00.000Z",
      },
    ];

    const error = new UnresolvedMarkerError(markers);

    expect(error.name).toBe("UnresolvedMarkerError");
    expect(error.markers).toBe(markers);
    expect(error.message).toContain("9999_probe");
    expect(error.message).toContain("idx 3");
    expect(error.message).toContain("statement 0 of 1");
    expect(error.message).toContain("pnpm db:migrate:recover");
  });
});
