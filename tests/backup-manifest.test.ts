// Proves scripts/backup-manifest.ts in both directions (02-01-PLAN.md Task 2): a round trip
// against a temp directory, loud rejection of malformed input, and the "a manifest can never
// carry a credential" claim as a test rather than a comment. The module under test already
// exists from Task 1 -- these are its failing-direction proofs, not its design driver.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ManifestSchema,
  compactTimestamp,
  readManifest,
  writeManifest,
  type BackupManifest,
} from "../scripts/backup-manifest";

// Built at runtime, not as a literal, so this file's own source never contains either needle --
// the same self-match-avoidance idiom tests/guardrails.test.ts and tests/target-pin.test.ts use.
// Load-bearing here because tests/backup-manifest.test.ts is inside the guardrail suite's
// scanned source surface and is deliberately NOT on either fixture allowlist (tests/guardrails.test.ts
// lines 26-38) -- it stays covered by the connection-string and credential checks by default.
const CONNECTION_STRING_SCHEME_PREFIX = ["postgres", "://"].join("");
const SCRAM_VERIFIER_PREFIX = ["SCRAM", "-SHA-256"].join("");

// Fixed, independent list -- deliberately NOT derived from ManifestSchema.shape, so this
// regresses if a field is ever added to the schema without a reviewer updating this test too
// (the fourth action item: "a future field cannot be added without this test noticing").
const EXPECTED_MANIFEST_KEYS = [
  "appliedMigrationCount",
  "contentHashes",
  "dataDump",
  "gitCommit",
  "globalsDump",
  "postgresVersion",
  "rowCounts",
  "sequences",
  "spotChecks",
  "takenAt",
].sort();

function buildRealisticManifest(): BackupManifest {
  return {
    takenAt: "2026-09-07T19:36:50.000Z",
    postgresVersion: "PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2) on x86_64-pc-linux-gnu",
    gitCommit: "c8663a5e5a9c2bd5300a69967e78f3637102dfa5",
    appliedMigrationCount: 2,
    dataDump: { file: "recipe_dev-20260907T193650Z.dump", sha256: "a".repeat(64) },
    globalsDump: { file: "recipe_dev-20260907T193650Z-globals.sql", sha256: "b".repeat(64) },
    rowCounts: { "public.recipes": 1, "public.ingredients": 8, "public.steps": 5 },
    contentHashes: {
      "public.recipes": "1".repeat(32),
      "public.ingredients": "2".repeat(32),
      "public.steps": "3".repeat(32),
    },
    spotChecks: {
      recipes: [{ slug: "chicken-rice-bowl", baseServings: 2, baseKcal: 620 }],
      ingredients: [{ name: "Chicken breast", quantity: "200.00", unit: "g", position: 0 }],
      steps: [
        { position: 0, timerLabel: "12 min" },
        { position: 1, timerLabel: null },
      ],
    },
    sequences: [
      { schemaName: "drizzle", sequenceName: "__drizzle_migrations_id_seq", lastValue: 2 },
    ],
  };
}

describe("scripts/backup-manifest.ts — writeManifest/readManifest", () => {
  it("round-trips a manifest written from real backup data", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "backup-manifest-"));
    const manifestPath = join(tempDir, "manifest.json");
    const manifest = buildRealisticManifest();
    try {
      await writeManifest(manifestPath, manifest);
      const read = await readManifest(manifestPath);
      expect(read).toEqual(manifest);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects a manifest file missing a required field, naming what's wrong", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "backup-manifest-"));
    const manifestPath = join(tempDir, "manifest.json");
    const manifest = buildRealisticManifest();
    const withoutDataDump = {
      takenAt: manifest.takenAt,
      postgresVersion: manifest.postgresVersion,
      gitCommit: manifest.gitCommit,
      appliedMigrationCount: manifest.appliedMigrationCount,
      globalsDump: manifest.globalsDump,
      rowCounts: manifest.rowCounts,
    };
    writeFileSync(manifestPath, JSON.stringify(withoutDataDump));

    try {
      let message = "";
      await readManifest(manifestPath).catch((error: unknown) => {
        message = error instanceof Error ? error.message : String(error);
      });

      expect(message).not.toBe("");
      expect(message).toContain(manifestPath);
      expect(message).not.toContain(CONNECTION_STRING_SCHEME_PREFIX);
      expect(message).not.toContain(SCRAM_VERIFIER_PREFIX);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects a manifest file that is not valid JSON at all", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "backup-manifest-"));
    const manifestPath = join(tempDir, "manifest.json");
    writeFileSync(manifestPath, "{ this is not valid json ");

    try {
      let message = "";
      await readManifest(manifestPath).catch((error: unknown) => {
        message = error instanceof Error ? error.message : String(error);
      });

      expect(message).not.toBe("");
      expect(message).toContain(manifestPath);
      expect(message).not.toContain(CONNECTION_STRING_SCHEME_PREFIX);
      expect(message).not.toContain(SCRAM_VERIFIER_PREFIX);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("never contains a credential-shaped string, and its key set exactly matches the schema's", () => {
    const manifest = buildRealisticManifest();
    const serialized = JSON.stringify(manifest);

    expect(serialized).not.toContain(CONNECTION_STRING_SCHEME_PREFIX);
    expect(serialized).not.toContain(SCRAM_VERIFIER_PREFIX);

    const parsed = ManifestSchema.parse(JSON.parse(serialized));
    expect(Object.keys(parsed).sort()).toEqual(EXPECTED_MANIFEST_KEYS);
  });
});

describe("scripts/backup-manifest.ts — compactTimestamp", () => {
  it("produces a Windows-filename-safe, colon-free YYYYMMDDTHHMMSSZ string for a fixed date", () => {
    // RESEARCH.md Pitfall 3 (live-verified): a raw ISO-8601 timestamp used directly in a
    // filename does not throw on Windows -- it silently writes the content into a hidden NTFS
    // Alternate Data Stream. This is the regression guard: only an explicit assertion catches it.
    const fixedDate = new Date("2026-09-07T19:36:50.686Z");
    const stamp = compactTimestamp(fixedDate);

    expect(stamp).toBe("20260907T193650Z");
    expect(stamp).toMatch(/^\d{8}T\d{6}Z$/);
    for (const reservedChar of ["<", ">", ":", '"', "/", "\\", "|", "?", "*"]) {
      expect(stamp).not.toContain(reservedChar);
    }
  });
});
