// D-11: proves both directions of enumerateMigrationFiles's journal/file mismatch guard against
// a temporary directory built in the test (never against the real apps/recipe-app/drizzle), and
// that the pure core (src/inspector/, src/classifier/, src/analyze.ts) never imports a
// filesystem module. The searched-for import specifier is built at runtime from two joined
// fragments -- tests/guardrails.test.ts's own self-match-avoidance idiom -- so this file's own
// source never contains the literal it looks for.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_JOURNAL_PATH,
  DEFAULT_MIGRATIONS_DIR,
  enumerateMigrationFiles,
} from "../src/adapter/drizzle-migrations";

// Built from two joined fragments, matching tests/guardrails.test.ts's convention, so this
// file's own source never contains the literal specifier the purity assertion below searches
// for.
const FS_MODULE_NEEDLE = ["node", ":fs"].join("");

function writeJournal(metaDir: string, tags: string[]): string {
  const journalPath = join(metaDir, "_journal.json");
  writeFileSync(
    journalPath,
    JSON.stringify({
      version: "7",
      dialect: "postgresql",
      entries: tags.map((tag, idx) => ({ idx, version: "7", when: idx, tag, breakpoints: true })),
    }),
  );
  return journalPath;
}

describe("enumerateMigrationFiles (D-11)", () => {
  it("exports DEFAULT_MIGRATIONS_DIR and DEFAULT_JOURNAL_PATH as overridable constants", () => {
    expect(DEFAULT_MIGRATIONS_DIR).toBe("apps/recipe-app/drizzle");
    expect(DEFAULT_JOURNAL_PATH).toBe("apps/recipe-app/drizzle/meta/_journal.json");
    expect(typeof enumerateMigrationFiles).toBe("function");
  });

  it("with no arguments returns exactly five entries for this repository, in journal order through 0004_redundant_apocalypse", () => {
    const files = enumerateMigrationFiles();
    expect(files).toHaveLength(5);
    const expectedTags = [
      "0000_bumpy_khan",
      "0001_busy_thunderbolt",
      "0002_oval_maelstrom",
      "0003_backfill_steps_timer_label",
      "0004_redundant_apocalypse",
    ];
    for (const [index, tag] of expectedTags.entries()) {
      expect(files[index].tag).toBe(tag);
      expect(files[index].idx).toBe(index);
    }
    for (const file of files) {
      expect(file.sql.length).toBeGreaterThan(0);
    }
  });

  it("throws naming the tag and the path it looked for when a journal entry has no matching SQL file", () => {
    const dir = mkdtempSync(join(tmpdir(), "adapter-missing-file-"));
    try {
      const metaDir = join(dir, "meta");
      mkdirSync(metaDir);
      const journalPath = writeJournal(metaDir, ["0000_only_in_journal"]);

      expect(() => enumerateMigrationFiles(dir, journalPath)).toThrowError(/0000_only_in_journal/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws naming the file when a SQL file present in the migrations directory has no journal entry", () => {
    const dir = mkdtempSync(join(tmpdir(), "adapter-extra-file-"));
    try {
      const metaDir = join(dir, "meta");
      mkdirSync(metaDir);
      const journalPath = writeJournal(metaDir, []);
      writeFileSync(join(dir, "0000_no_journal_entry.sql"), "SELECT 1;");

      expect(() => enumerateMigrationFiles(dir, journalPath)).toThrowError(/0000_no_journal_entry\.sql/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("no module under src/inspector/, src/classifier/, or src/analyze.ts imports a filesystem module (D-11)", () => {
    const files: string[] = [
      "packages/automation/src/analyze.ts",
      ...readdirSync("packages/automation/src/inspector")
        .filter((name) => name.endsWith(".ts"))
        .map((name) => `packages/automation/src/inspector/${name}`),
      ...readdirSync("packages/automation/src/classifier")
        .filter((name) => name.endsWith(".ts"))
        .map((name) => `packages/automation/src/classifier/${name}`),
    ];

    expect(files.length).toBeGreaterThan(2);

    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      expect(content, `${file} must not import a filesystem module (D-11 pure core)`).not.toContain(
        FS_MODULE_NEEDLE,
      );
    }
  });
});
