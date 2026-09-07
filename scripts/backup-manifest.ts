// D-05 (02-CONTEXT.md): the record `db:backup` writes at backup time, and the source of truth
// the drill's tier 1-2 assertions compare against instead of hardcoded seed constants. A
// standalone module with no module-load side effects -- same property
// scripts/verify-migration-state.ts deliberately has -- so a test can import
// writeManifest/readManifest/ManifestSchema without opening a database connection or
// triggering scripts/env.ts's own import-time environment validation.
//
// The schema below has no field capable of holding a connection string, a role name's
// password, or a password hash. That is D-05's "the manifest must contain no credentials"
// clause expressed as a type, not a habit -- a future field added here without reading this
// comment first would need to actively work around the schema's shape to leak one.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

// RESEARCH.md Pitfall 3 (live-verified): Windows NTFS silently reinterprets a colon in a
// filename as an Alternate Data Stream separator rather than throwing -- a raw
// `Date.toISOString()` used directly in a filename does not error, it writes the real content
// into a hidden stream and leaves a zero-byte file with the visible name. This helper is the
// regression guard: strip every colon and hyphen (date separators) from the ISO string and
// drop the millisecond fraction, leaving a fixed-width `YYYYMMDDTHHMMSSZ` form that is both
// filename-safe and lexicographically sortable in chronological order (load-bearing for
// readLatestManifest below).
export function compactTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

// SHA-256 of a dump file's bytes, streamed rather than loaded whole into memory -- the data
// dump is a binary `pg_dump -Fc` archive that can grow arbitrarily large. Used both when the
// manifest is written (backup.ts) and when tier 1 (scripts/drill-assertions.ts) recomputes the
// digest of the restored artifacts to compare against what is recorded here.
export function sha256File(path: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk as Buffer));
    stream.on("end", () => resolvePromise(hash.digest("hex")));
    stream.on("error", reject);
  });
}

const DumpFileSchema = z.object({
  file: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, "must be a 64-character lowercase hex SHA-256 digest"),
});

// Tier 4 (02-02-PLAN.md Task 2): one md5 hex digest per table, keyed the same qualified-name
// way as rowCounts above. Fixed field order (schema field order = the SQL SELECT column order
// scripts/backup.ts and scripts/drill-assertions.ts both use) matters for the array-typed spot
// check schemas below -- see their read_first note before reordering any field.
const ContentHashSchema = z
  .string()
  .regex(/^[0-9a-f]{32}$/, "must be a 32-character lowercase hex MD5 digest");

const RecipeSpotCheckSchema = z.object({
  slug: z.string().min(1),
  baseServings: z.number().int(),
  baseKcal: z.number().int(),
});

const IngredientSpotCheckSchema = z.object({
  name: z.string().min(1),
  // Postgres numeric(10,2) round-trips through `pg` as a string, never a JS number -- storing
  // it as anything else would risk float precision loss on a value this manifest treats as an
  // exact spot-checked quantity.
  quantity: z.string().min(1),
  unit: z.string(),
  position: z.number().int(),
});

// timerLabel is nullable, not optional-with-default: this is the field that proves the
// NULL-versus-empty-string distinction survived a restore (02-CONTEXT.md D-13's tier 4).
// Coercing a recorded SQL NULL to "" here would silently defeat that regression's whole point.
const StepSpotCheckSchema = z.object({
  position: z.number().int(),
  timerLabel: z.string().nullable(),
});

const SpotChecksSchema = z.object({
  recipes: z.array(RecipeSpotCheckSchema),
  ingredients: z.array(IngredientSpotCheckSchema),
  steps: z.array(StepSpotCheckSchema),
});

// pg_sequences.last_value is bigint and can be SQL NULL for a sequence that has never been
// advanced -- represented here as `number | null`, matching how scripts/backup.ts and
// scripts/drill-assertions.ts both convert it (Number(...) when non-null, null when null).
const SequenceStateSchema = z.object({
  schemaName: z.string().min(1),
  sequenceName: z.string().min(1),
  lastValue: z.number().int().nullable(),
});

// D-05's field list. No field below can hold a connection string, a role password, or a
// password hash -- contentHashes/spotChecks/sequences (tier 3/4 fields, added 02-02) are all
// non-credential aggregates or named non-credential column projections, never a whole row and
// never a dump file's raw contents.
export const ManifestSchema = z.object({
  takenAt: z.string().min(1),
  postgresVersion: z.string().min(1),
  gitCommit: z.string().min(1),
  appliedMigrationCount: z.number().int().nonnegative(),
  dataDump: DumpFileSchema,
  globalsDump: DumpFileSchema,
  rowCounts: z.record(z.string(), z.number().int().nonnegative()),
  contentHashes: z.record(z.string(), ContentHashSchema),
  spotChecks: SpotChecksSchema,
  sequences: z.array(SequenceStateSchema),
});

export type BackupManifest = z.infer<typeof ManifestSchema>;

// A single, validated assembly point for backup.ts -- every manifest this project writes is
// constructed here rather than as an ad hoc object literal, so a missing or malformed field is
// caught before the file ever reaches disk.
export function buildManifest(input: BackupManifest): BackupManifest {
  return ManifestSchema.parse(input);
}

/** Validates, then writes, a manifest as pretty-printed JSON to an exact file path. */
export async function writeManifest(path: string, manifest: BackupManifest): Promise<void> {
  const validated = ManifestSchema.parse(manifest);
  await writeFile(path, `${JSON.stringify(validated, null, 2)}\n`, "utf-8");
}

/**
 * Reads and validates a manifest file. `.parse()`s through the schema on every read, not just
 * on write, so a hand-edited or truncated manifest fails loudly here rather than being
 * silently trusted by whatever reads it next (drizzle-assertions, a future status view).
 */
export async function readManifest(path: string): Promise<BackupManifest> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    throw new Error(`Could not read manifest file at "${path}".`);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new Error(`Manifest file at "${path}" is not valid JSON.`);
  }

  const result = ManifestSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new Error(
      `Manifest file at "${path}" failed schema validation: ${result.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return result.data;
}

/**
 * Returns the newest manifest at a backup destination, picked by lexicographic filename
 * order -- correct because compactTimestamp's fixed-width, zero-padded form sorts
 * chronologically. Throws (rather than returning undefined) when none exists, matching this
 * project's "fail loudly, never silently under-report" convention.
 */
export async function readLatestManifest(destination: string): Promise<BackupManifest> {
  const entries = await readdir(destination);
  const manifestFiles = entries.filter((entry) => entry.endsWith("-manifest.json")).sort();
  const latest = manifestFiles.at(-1);
  if (!latest) {
    throw new Error(`No manifest file found at backup destination "${destination}".`);
  }
  return readManifest(join(destination, latest));
}
