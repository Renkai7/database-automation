// D-09 (05-CONTEXT.md), CI-05, Task 1: file-level append-only check. Synthetic in-memory diff
// strings only -- no real git invocation, no temporary repository, no mutation of a shipped
// migration, matching this repo's own WR-04/tamper-then-refuse.test.ts precedent.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertJournalEntriesAppendOnly,
  assertMigrationFilesAppendOnly,
  parseNameStatus,
  runCheckAppendOnly,
} from "../../scripts/ci/check-append-only";

function journalText(entries: Array<{ idx: number; tag: string; when: number }>): string {
  return JSON.stringify({
    version: "7",
    dialect: "postgresql",
    entries: entries.map((e) => ({ ...e, version: "7", breakpoints: true })),
  });
}

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

describe("assertJournalEntriesAppendOnly", () => {
  const base = journalText([
    { idx: 0, tag: "0000_bumpy_khan", when: 1788741236355 },
    { idx: 1, tag: "0001_busy_thunderbolt", when: 1788742285126 },
    { idx: 2, tag: "0002_oval_maelstrom", when: 1788906778821 },
    { idx: 3, tag: "0003_backfill_steps_timer_label", when: 1788907090609 },
    { idx: 4, tag: "0004_redundant_apocalypse", when: 1788907107307 },
  ]);

  it("passes when the head journal is identical plus a new idx 5", () => {
    const head = journalText([
      { idx: 0, tag: "0000_bumpy_khan", when: 1788741236355 },
      { idx: 1, tag: "0001_busy_thunderbolt", when: 1788742285126 },
      { idx: 2, tag: "0002_oval_maelstrom", when: 1788906778821 },
      { idx: 3, tag: "0003_backfill_steps_timer_label", when: 1788907090609 },
      { idx: 4, tag: "0004_redundant_apocalypse", when: 1788907107307 },
      { idx: 5, tag: "0005_new_migration", when: 1788907200000 },
    ]);
    expect(() => assertJournalEntriesAppendOnly(base, head)).not.toThrow();
  });

  it("throws when idx 2's tag changed, naming idx 2", () => {
    const head = journalText([
      { idx: 0, tag: "0000_bumpy_khan", when: 1788741236355 },
      { idx: 1, tag: "0001_busy_thunderbolt", when: 1788742285126 },
      { idx: 2, tag: "0002_renamed", when: 1788906778821 },
      { idx: 3, tag: "0003_backfill_steps_timer_label", when: 1788907090609 },
      { idx: 4, tag: "0004_redundant_apocalypse", when: 1788907107307 },
    ]);
    expect(() => assertJournalEntriesAppendOnly(base, head)).toThrow(/idx 2/);
  });

  it("throws when idx 2's when changed, naming idx 2", () => {
    const head = journalText([
      { idx: 0, tag: "0000_bumpy_khan", when: 1788741236355 },
      { idx: 1, tag: "0001_busy_thunderbolt", when: 1788742285126 },
      { idx: 2, tag: "0002_oval_maelstrom", when: 1788906778822 },
      { idx: 3, tag: "0003_backfill_steps_timer_label", when: 1788907090609 },
      { idx: 4, tag: "0004_redundant_apocalypse", when: 1788907107307 },
    ]);
    expect(() => assertJournalEntriesAppendOnly(base, head)).toThrow(/idx 2/);
  });

  it("throws when idx 3 is absent, naming idx 3 and its base tag", () => {
    const head = journalText([
      { idx: 0, tag: "0000_bumpy_khan", when: 1788741236355 },
      { idx: 1, tag: "0001_busy_thunderbolt", when: 1788742285126 },
      { idx: 2, tag: "0002_oval_maelstrom", when: 1788906778821 },
      { idx: 4, tag: "0004_redundant_apocalypse", when: 1788907107307 },
    ]);
    expect(() => assertJournalEntriesAppendOnly(base, head)).toThrow(
      /idx 3.*0003_backfill_steps_timer_label|0003_backfill_steps_timer_label.*idx 3/,
    );
  });

  it("passes when entries are reordered but every idx/tag/when is unchanged", () => {
    const head = journalText([
      { idx: 4, tag: "0004_redundant_apocalypse", when: 1788907107307 },
      { idx: 0, tag: "0000_bumpy_khan", when: 1788741236355 },
      { idx: 3, tag: "0003_backfill_steps_timer_label", when: 1788907090609 },
      { idx: 1, tag: "0001_busy_thunderbolt", when: 1788742285126 },
      { idx: 2, tag: "0002_oval_maelstrom", when: 1788906778821 },
    ]);
    expect(() => assertJournalEntriesAppendOnly(base, head)).not.toThrow();
  });

  it("throws when an existing entry's idx is renumbered (closing the re-run-as-new dodge)", () => {
    // idx 2 is renumbered to 10; the original idx 2 slot disappears entirely.
    const head = journalText([
      { idx: 0, tag: "0000_bumpy_khan", when: 1788741236355 },
      { idx: 1, tag: "0001_busy_thunderbolt", when: 1788742285126 },
      { idx: 10, tag: "0002_oval_maelstrom", when: 1788906778821 },
      { idx: 3, tag: "0003_backfill_steps_timer_label", when: 1788907090609 },
      { idx: 4, tag: "0004_redundant_apocalypse", when: 1788907107307 },
    ]);
    expect(() => assertJournalEntriesAppendOnly(base, head)).toThrow();
  });

  it("throws when the base journal text is not valid JSON, naming the base side", () => {
    expect(() => assertJournalEntriesAppendOnly("{not json", journalText([]))).toThrow(/base/i);
  });

  it("throws when the head journal has a duplicated idx", () => {
    const head = journalText([
      { idx: 0, tag: "0000_bumpy_khan", when: 1788741236355 },
      { idx: 1, tag: "0001_busy_thunderbolt", when: 1788742285126 },
      { idx: 2, tag: "0002_oval_maelstrom", when: 1788906778821 },
      { idx: 2, tag: "0002_duplicate", when: 1788906778822 },
      { idx: 3, tag: "0003_backfill_steps_timer_label", when: 1788907090609 },
      { idx: 4, tag: "0004_redundant_apocalypse", when: 1788907107307 },
    ]);
    expect(() => assertJournalEntriesAppendOnly(base, head)).toThrow();
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
