// D-09 (05-CONTEXT.md), CI-05, Task 1: file-level append-only check. Synthetic in-memory diff
// strings only -- no real git invocation, no temporary repository, no mutation of a shipped
// migration, matching this repo's own WR-04/tamper-then-refuse.test.ts precedent.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertMigrationFilesAppendOnly,
  parseNameStatus,
  runCheckAppendOnly,
} from "../../scripts/ci/check-append-only";

describe("parseNameStatus", () => {
  it("parses a simple added-file line into one entry with status A", () => {
    const result = parseNameStatus("A\tapps/recipe-app/drizzle/0005_new.sql");
    expect(result).toEqual([{ status: "A", path: "apps/recipe-app/drizzle/0005_new.sql" }]);
  });

  it("parses a rename line (two path columns) into an entry whose status is not A", () => {
    const result = parseNameStatus(
      "R100\tapps/recipe-app/drizzle/0002_old.sql\tapps/recipe-app/drizzle/0002_new.sql",
    );
    expect(result).toHaveLength(1);
    expect(result[0].status).not.toBe("A");
    expect(result[0].status).toBe("R100");
    expect(result[0].path).toBe("apps/recipe-app/drizzle/0002_new.sql");
  });

  it("ignores blank lines", () => {
    const result = parseNameStatus("\nA\tapps/recipe-app/drizzle/0005_new.sql\n\n");
    expect(result).toEqual([{ status: "A", path: "apps/recipe-app/drizzle/0005_new.sql" }]);
  });
});

describe("assertMigrationFilesAppendOnly", () => {
  it("does not throw when every entry under the migrations dir has status A", () => {
    expect(() =>
      assertMigrationFilesAppendOnly([
        { status: "A", path: "apps/recipe-app/drizzle/0005_new.sql" },
        { status: "A", path: "apps/recipe-app/drizzle/meta/0005_snapshot.json" },
      ]),
    ).not.toThrow();
  });

  it("throws when an existing migration file is modified, naming the path", () => {
    expect(() =>
      assertMigrationFilesAppendOnly([
        { status: "M", path: "apps/recipe-app/drizzle/0002_oval_maelstrom.sql" },
      ]),
    ).toThrow(/0002_oval_maelstrom\.sql/);
  });

  it("throws when an existing migration file is deleted", () => {
    expect(() =>
      assertMigrationFilesAppendOnly([
        { status: "D", path: "apps/recipe-app/drizzle/0003_backfill_steps_timer_label.sql" },
      ]),
    ).toThrow(/0003_backfill_steps_timer_label\.sql/);
  });

  it("ignores meta/_journal.json -- Task 2's entry-level check owns it", () => {
    expect(() =>
      assertMigrationFilesAppendOnly([
        { status: "M", path: "apps/recipe-app/drizzle/meta/_journal.json" },
      ]),
    ).not.toThrow();
  });

  it("throws on a modified meta/*_snapshot.json file -- a snapshot is history, not a journal", () => {
    expect(() =>
      assertMigrationFilesAppendOnly([
        { status: "M", path: "apps/recipe-app/drizzle/meta/0004_snapshot.json" },
      ]),
    ).toThrow(/0004_snapshot\.json/);
  });

  it("ignores paths outside the migrations directory entirely", () => {
    expect(() =>
      assertMigrationFilesAppendOnly([{ status: "M", path: "apps/recipe-app/src/db/schema.ts" }]),
    ).not.toThrow();
  });
});

describe("runCheckAppendOnly -- env-var gate", () => {
  const originalBase = process.env.PR_BASE_SHA;
  const originalHead = process.env.PR_HEAD_SHA;

  beforeEach(() => {
    delete process.env.PR_BASE_SHA;
    delete process.env.PR_HEAD_SHA;
  });

  afterEach(() => {
    if (originalBase !== undefined) process.env.PR_BASE_SHA = originalBase;
    if (originalHead !== undefined) process.env.PR_HEAD_SHA = originalHead;
  });

  it("throws naming fetch-depth when PR_BASE_SHA is unset", async () => {
    await expect(runCheckAppendOnly()).rejects.toThrow(/fetch-depth/);
  });
});
