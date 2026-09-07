// D-19 (02-CONTEXT.md): proves scripts/drill-status.ts's assertDrillStatusFresh in the failing
// direction -- missing record, FAIL outcome, stale age, null lastRunAt, and a malformed record --
// plus the live gate against the real committed docs/restore-drill-status.json, and D-18/
// docs/decisions.md D7's own executable proof that recordAutomatedDrillResult never touches the
// human fact. Cheap by design: no Docker, no container, no database -- only file reads and
// hand-written fixtures under a mkdtempSync directory, following
// tests/verify-migration-state.test.ts's positive-case/deliberately-broken-negative-case shape.
// This is what lets this check join the default `pnpm test` glob without slowing it down, so it
// cannot be quietly disabled the way a slow, Docker-dependent test eventually would be (D-16).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DRILL_STATUS_PATH,
  MAX_DRILL_AGE_DAYS,
  assertDrillStatusFresh,
  readDrillStatus,
  recordAutomatedDrillResult,
} from "../scripts/drill-status";

// Built at runtime, not as a literal -- same self-match-avoidance idiom
// tests/target-pin.test.ts/tests/guardrails.test.ts already use. This file never constructs a
// real connection string; the needle exists purely to prove none of assertDrillStatusFresh's
// thrown messages ever contain one.
const CONNECTION_STRING_SCHEME_PREFIX = ["postgres", "://"].join("");

function buildValidStatus(overrides: {
  lastRunAt?: string | null;
  outcome?: "PASS" | "FAIL" | null;
}) {
  return {
    automated: {
      lastRunAt: "lastRunAt" in overrides ? overrides.lastRunAt : new Date().toISOString(),
      outcome: "outcome" in overrides ? overrides.outcome : "PASS",
      tiers: {
        artifactIntegrity: true,
        rowCounts: true,
        schemaEquality: true,
        contentAndReferentialIntegrity: true,
      },
      durationMs: { backup: 1, containerStart: 1, globalsRestore: 1, dataRestore: 1, assert: 1 },
    },
    human: {
      lastPerformedAt: null,
      outcome: "UNKNOWN",
      timings: null,
      runbookRef: "docs/20-restore-runbook.md",
    },
  };
}

/** Runs `action`, asserts it rejects, and returns the thrown message -- never empty, never
 * carrying a connection-string scheme prefix. */
async function expectThrowMessage(action: () => Promise<unknown>): Promise<string> {
  let message = "";
  await action().catch((error: unknown) => {
    message = error instanceof Error ? error.message : String(error);
  });
  expect(message).not.toBe("");
  expect(message).not.toContain(CONNECTION_STRING_SCHEME_PREFIX);
  return message;
}

describe("scripts/drill-status.ts — assertDrillStatusFresh (D-19)", () => {
  it("resolves against the real committed docs/restore-drill-status.json", async () => {
    await expect(assertDrillStatusFresh(DEFAULT_DRILL_STATUS_PATH)).resolves.toBeUndefined();
  });

  it("throws naming the path when the record is missing", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "drill-status-"));
    const missingPath = join(tempDir, "does-not-exist.json");
    try {
      const message = await expectThrowMessage(() => assertDrillStatusFresh(missingPath));
      expect(message).toContain(missingPath);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("throws naming the outcome when the automated outcome is FAIL", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "drill-status-"));
    const tempPath = join(tempDir, "status.json");
    try {
      writeFileSync(tempPath, JSON.stringify(buildValidStatus({ outcome: "FAIL" })));
      const message = await expectThrowMessage(() => assertDrillStatusFresh(tempPath));
      expect(message).toContain("FAIL");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("throws naming both the recorded date and the threshold when the run is older than 30 days", async () => {
    const now = new Date("2026-09-07T12:00:00.000Z");
    const fortyDaysAgo = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const tempDir = mkdtempSync(join(tmpdir(), "drill-status-"));
    const tempPath = join(tempDir, "status.json");
    try {
      writeFileSync(tempPath, JSON.stringify(buildValidStatus({ lastRunAt: fortyDaysAgo })));
      const message = await expectThrowMessage(() => assertDrillStatusFresh(tempPath, now));
      expect(message).toContain(fortyDaysAgo);
      expect(message).toContain(String(MAX_DRILL_AGE_DAYS));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("resolves when the run is just inside the 30-day threshold (29 days) -- proves case 4 isn't vacuous", async () => {
    const now = new Date("2026-09-07T12:00:00.000Z");
    const twentyNineDaysAgo = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000).toISOString();
    const tempDir = mkdtempSync(join(tmpdir(), "drill-status-"));
    const tempPath = join(tempDir, "status.json");
    try {
      writeFileSync(tempPath, JSON.stringify(buildValidStatus({ lastRunAt: twentyNineDaysAgo })));
      await expect(assertDrillStatusFresh(tempPath, now)).resolves.toBeUndefined();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("throws when the automated last-run timestamp is null -- no first-run grace case", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "drill-status-"));
    const tempPath = join(tempDir, "status.json");
    try {
      writeFileSync(tempPath, JSON.stringify(buildValidStatus({ lastRunAt: null, outcome: null })));
      await expectThrowMessage(() => assertDrillStatusFresh(tempPath));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("throws naming the file when the record is valid JSON but fails schema validation", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "drill-status-"));
    const tempPath = join(tempDir, "status.json");
    try {
      writeFileSync(tempPath, JSON.stringify({ automated: { outcome: "MAYBE" } }));
      const message = await expectThrowMessage(() => assertDrillStatusFresh(tempPath));
      expect(message).toContain(tempPath);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("never writes the human fact -- recordAutomatedDrillResult leaves it byte-identical (D-18/docs/decisions.md D7)", async () => {
    const committed = await readDrillStatus(DEFAULT_DRILL_STATUS_PATH);
    const tempDir = mkdtempSync(join(tmpdir(), "drill-status-"));
    const tempPath = join(tempDir, "status.json");
    try {
      writeFileSync(tempPath, `${JSON.stringify(committed, null, 2)}\n`);
      await recordAutomatedDrillResult(
        {
          outcome: "PASS",
          tiers: {
            artifactIntegrity: true,
            rowCounts: true,
            schemaEquality: true,
            contentAndReferentialIntegrity: true,
          },
          durationMs: { backup: 1, containerStart: 1, globalsRestore: 1, dataRestore: 1, assert: 1 },
        },
        tempPath,
      );
      const updated = await readDrillStatus(tempPath);
      expect(updated.human).toEqual(committed.human);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
