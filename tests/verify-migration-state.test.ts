// Proves scripts/verify-migration-state.ts's assertMigrationHistoryApplied in both directions
// (CR-02, T-01-26/T-01-27): green against the live, genuinely migrated development database,
// and red against a journal deliberately reporting one more entry than was actually applied --
// the proof that the guard has teeth rather than merely existing. Uses the live seeded
// database as a read-only fixture and writes/removes its own temporary journal file; the real
// committed journal is only ever read, never modified.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_JOURNAL_PATH,
  assertMigrationHistoryApplied,
} from "../scripts/verify-migration-state";

describe("scripts/verify-migration-state.ts — assertMigrationHistoryApplied", () => {
  it("resolves against the live, genuinely migrated development database", async () => {
    await expect(assertMigrationHistoryApplied()).resolves.toBeUndefined();
  });

  it("rejects when the journal reports one more entry than was actually applied, naming both counts", async () => {
    const realJournal = JSON.parse(readFileSync(DEFAULT_JOURNAL_PATH, "utf-8")) as {
      entries: unknown[];
    };
    const expectedCount = realJournal.entries.length;
    const mismatchedCount = expectedCount + 1;
    const mismatchedJournal = {
      version: "7",
      dialect: "postgresql",
      entries: new Array(mismatchedCount).fill({}),
    };

    const tempDir = mkdtempSync(join(tmpdir(), "verify-migration-state-"));
    const tempJournalPath = join(tempDir, "_journal.json");
    writeFileSync(tempJournalPath, JSON.stringify(mismatchedJournal));

    try {
      let message = "";
      await assertMigrationHistoryApplied(tempJournalPath).catch((error: unknown) => {
        message = error instanceof Error ? error.message : String(error);
      });

      expect(message).not.toBe("");
      expect(message).toContain(String(expectedCount));
      expect(message).toContain(String(mismatchedCount));
      expect(message.toLowerCase()).not.toContain(["postgres", "://"].join(""));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
