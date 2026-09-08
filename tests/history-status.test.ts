// D-24 (04-CONTEXT.md): proves scripts/history-status.ts's assertHistoryStatusPassed in the
// failing direction -- missing record, malformed JSON, schema-invalid content, null lastRunAt,
// and FAIL outcome -- plus recordHistorySuiteResult round-tripping through readHistoryStatus.
// Cheap by design: no Docker, no container, no database -- only file reads and hand-written
// fixtures under a mkdtempSync directory, following tests/drill-status.test.ts's own shape. This
// is what lets this check join the default `pnpm test` glob without slowing it down.
//
// Task 3 (below): the cheap D-24 default-suite check against the REAL committed record, once
// `pnpm test:history` has genuinely produced a PASS. `02-CONTEXT.md` D-18: the two facts stay
// separate -- this check reads only its own path constant, never anything belonging to the
// drill's own status file.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_DRILL_STATUS_PATH } from "../scripts/drill-status";
import {
  DEFAULT_HISTORY_STATUS_PATH,
  HistoryStatusSchema,
  INITIAL_HISTORY_STATUS,
  assertHistoryStatusPassed,
  readHistoryStatus,
  recordHistorySuiteResult,
} from "../scripts/history-status";

// Built at runtime, not as a literal -- same self-match-avoidance idiom
// tests/target-pin.test.ts/tests/guardrails.test.ts/tests/drill-status.test.ts already use.
const CONNECTION_STRING_SCHEME_PREFIX = ["postgres", "://"].join("");

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

describe("scripts/history-status.ts — assertHistoryStatusPassed failing directions (D-24)", () => {
  it("throws naming the path when the record is missing", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "history-status-"));
    const missingPath = join(tempDir, "does-not-exist.json");
    try {
      const message = await expectThrowMessage(() => assertHistoryStatusPassed(missingPath));
      expect(message).toContain(missingPath);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("throws naming the path when the record is not valid JSON", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "history-status-"));
    const tempPath = join(tempDir, "status.json");
    try {
      writeFileSync(tempPath, "{ not json");
      const message = await expectThrowMessage(() => assertHistoryStatusPassed(tempPath));
      expect(message).toContain(tempPath);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("throws naming the path when the record is valid JSON but fails schema validation", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "history-status-"));
    const tempPath = join(tempDir, "status.json");
    try {
      writeFileSync(tempPath, JSON.stringify({ outcome: "MAYBE" }));
      const message = await expectThrowMessage(() => assertHistoryStatusPassed(tempPath));
      expect(message).toContain(tempPath);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("throws when lastRunAt is null -- no first-run grace case", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "history-status-"));
    const tempPath = join(tempDir, "status.json");
    try {
      writeFileSync(
        tempPath,
        JSON.stringify({ lastRunAt: null, outcome: null, suiteConfig: "vitest.history.config.ts" }),
      );
      const message = await expectThrowMessage(() => assertHistoryStatusPassed(tempPath));
      expect(message).toContain("never recorded a run");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("throws naming the outcome when the recorded outcome is FAIL", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "history-status-"));
    const tempPath = join(tempDir, "status.json");
    try {
      writeFileSync(
        tempPath,
        JSON.stringify({
          lastRunAt: new Date().toISOString(),
          outcome: "FAIL",
          suiteConfig: "vitest.history.config.ts",
        }),
      );
      const message = await expectThrowMessage(() => assertHistoryStatusPassed(tempPath));
      expect(message).toContain("FAIL");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("recordHistorySuiteResult round-trips through readHistoryStatus", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "history-status-"));
    const tempPath = join(tempDir, "status.json");
    try {
      writeFileSync(tempPath, `${JSON.stringify(INITIAL_HISTORY_STATUS, null, 2)}\n`);
      await recordHistorySuiteResult("PASS", tempPath);
      const updated = await readHistoryStatus(tempPath);
      expect(updated.outcome).toBe("PASS");
      expect(updated.lastRunAt).not.toBeNull();
      expect(HistoryStatusSchema.safeParse(updated).success).toBe(true);
      expect(updated.suiteConfig).toBe("vitest.history.config.ts");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("recordHistorySuiteResult tolerates a missing file on the very first run", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "history-status-"));
    const tempPath = join(tempDir, "does-not-exist-yet.json");
    try {
      await recordHistorySuiteResult("FAIL", tempPath);
      const updated = await readHistoryStatus(tempPath);
      expect(updated.outcome).toBe("FAIL");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

// Exercised so DEFAULT_HISTORY_STATUS_PATH is not an unused import if a future edit trims the
// direct-path tests above -- also doubles as a cheap smoke check that the constant matches the
// real committed file's location.
describe("DEFAULT_HISTORY_STATUS_PATH", () => {
  it("points at the committed docs/migration-history-status.json path", () => {
    expect(DEFAULT_HISTORY_STATUS_PATH).toBe("docs/migration-history-status.json");
  });
});

// D-24: the cheap check `pnpm test` runs on every invocation, against the REAL committed
// docs/migration-history-status.json -- this is what makes a missing/malformed/never-run/FAIL
// record hard-fail the default suite, not merely the temp-file cases above.
describe("assertHistoryStatusPassed() — the committed default-suite check (D-24)", () => {
  it("passes against the real committed docs/migration-history-status.json record", async () => {
    await expect(assertHistoryStatusPassed()).resolves.toBeUndefined();
  });

  it("reads only the history record -- its path is distinct from the restore drill's own status path, so a green run of one can never silently upgrade the other (02-CONTEXT.md D-18)", () => {
    expect(DEFAULT_HISTORY_STATUS_PATH).not.toBe(DEFAULT_DRILL_STATUS_PATH);
  });
});
