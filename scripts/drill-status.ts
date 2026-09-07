// D-17/D-18/D-19/D-20 (02-CONTEXT.md), docs/decisions.md D7: the committed, machine-readable
// record of the restore drill's result -- two independent facts (automated, human), each with
// its own date and outcome. Standalone module with no module-load side effects -- same property
// scripts/verify-migration-state.ts and scripts/backup-manifest.ts deliberately have -- so a
// test can import DrillStatusSchema/readDrillStatus/recordAutomatedDrillResult/
// assertDrillStatusFresh without opening a database connection or triggering
// scripts/env.ts's own import-time environment validation.
//
// No field in either the `automated` or `human` object can hold a connection string, a role
// name's password, or a password hash -- the same type-level expression of the no-credentials
// rule scripts/backup-manifest.ts's ManifestSchema carries.
import { access, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";

/** Repository-relative path to the committed drill status record. */
export const DEFAULT_DRILL_STATUS_PATH = "docs/restore-drill-status.json";

// D-19 (02-CONTEXT.md) / docs/decisions.md D7: thirty days is a recorded decision, not an
// incidental constant -- it can be revisited later with a stated reason, but must not silently
// drift. Age is treated as evidence going stale, not as a nag: see assertDrillStatusFresh below.
export const MAX_DRILL_AGE_DAYS = 30;

const DrillTierResultsSchema = z.object({
  artifactIntegrity: z.boolean(),
  rowCounts: z.boolean(),
  schemaEquality: z.boolean(),
  contentAndReferentialIntegrity: z.boolean(),
});

const DrillDurationMsSchema = z.object({
  backup: z.number().nonnegative(),
  containerStart: z.number().nonnegative(),
  globalsRestore: z.number().nonnegative(),
  dataRestore: z.number().nonnegative(),
  assert: z.number().nonnegative(),
});

export const DrillStatusSchema = z.object({
  automated: z.object({
    lastRunAt: z.string().nullable(),
    outcome: z.enum(["PASS", "FAIL"]).nullable(),
    tiers: DrillTierResultsSchema,
    durationMs: DrillDurationMsSchema,
  }),
  human: z.object({
    lastPerformedAt: z.string().nullable(),
    // D-18/docs/decisions.md D7: the explicit UNKNOWN value is what lets the human fact start,
    // and stay, honest -- no PASS/FAIL value here may ever be set by this module's own writer.
    outcome: z.enum(["PASS", "FAIL", "UNKNOWN"]),
    timings: z.record(z.string(), z.number()).nullable(),
    runbookRef: z.string().min(1),
  }),
});

export type DrillStatus = z.infer<typeof DrillStatusSchema>;

/** The starting state of the human fact, per D-18/D7: no code path may set it to anything else. */
const INITIAL_HUMAN_STATUS: DrillStatus["human"] = {
  lastPerformedAt: null,
  outcome: "UNKNOWN",
  timings: null,
  runbookRef: "docs/20-restore-runbook.md",
};

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads and validates a drill status record. `.parse()`s through the schema on every read, not
 * just on write, so a hand-edited or truncated record fails loudly here rather than being
 * silently trusted by assertDrillStatusFresh below.
 */
export async function readDrillStatus(
  path: string = DEFAULT_DRILL_STATUS_PATH,
): Promise<DrillStatus> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    throw new Error(`Could not read drill status record at "${path}" -- the file is missing.`);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new Error(`Drill status record at "${path}" is not valid JSON.`);
  }

  const result = DrillStatusSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new Error(
      `Drill status record at "${path}" failed schema validation: ${result.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return result.data;
}

export interface AutomatedDrillOutcome {
  outcome: "PASS" | "FAIL";
  tiers: z.infer<typeof DrillTierResultsSchema>;
  durationMs: z.infer<typeof DrillDurationMsSchema>;
}

/**
 * Records the automated half of the drill's result, carrying the `human` object through
 * completely unchanged (D-18, docs/decisions.md D7). No parameter here can name or influence the
 * human fact -- this function's own signature is the only way the human fact could ever be
 * touched by code, and it accepts nothing capable of doing so.
 *
 * Tolerates a missing file ONLY (the very first `pnpm db:drill` run, before this record has ever
 * been committed) by defaulting the human half to its honest starting state. A file that exists
 * but fails schema validation is never silently replaced -- that would defeat the entire point of
 * readDrillStatus's own strict parse.
 */
export async function recordAutomatedDrillResult(
  result: AutomatedDrillOutcome,
  path: string = DEFAULT_DRILL_STATUS_PATH,
): Promise<void> {
  const existingHuman = (await fileExists(path))
    ? (await readDrillStatus(path)).human
    : INITIAL_HUMAN_STATUS;

  const updated: DrillStatus = {
    automated: {
      lastRunAt: new Date().toISOString(),
      outcome: result.outcome,
      tiers: result.tiers,
      durationMs: result.durationMs,
    },
    human: existingHuman,
  };

  const validated = DrillStatusSchema.parse(updated);
  await writeFile(path, `${JSON.stringify(validated, null, 2)}\n`, "utf-8");
}

/**
 * D-19: the cheap check `pnpm test` runs on every invocation. Throws when the record is missing,
 * fails schema validation, has never recorded an automated run, did not pass, or is older than
 * MAX_DRILL_AGE_DAYS -- five distinct conditions, each named in its own message. `now` is
 * injectable so the age branch is testable without waiting thirty days.
 */
export async function assertDrillStatusFresh(
  path: string = DEFAULT_DRILL_STATUS_PATH,
  now: Date = new Date(),
): Promise<void> {
  const status = await readDrillStatus(path);

  if (!status.automated.lastRunAt) {
    throw new Error(
      `Drill status record at "${path}" has never recorded an automated run ` +
        "(automated.lastRunAt is null) -- an empty record is a hard failure, not a first-run " +
        "grace case.",
    );
  }

  if (status.automated.outcome !== "PASS") {
    throw new Error(
      `Drill status record at "${path}" reports automated outcome "${status.automated.outcome}", ` +
        'not "PASS".',
    );
  }

  const lastRunMs = Date.parse(status.automated.lastRunAt);
  if (Number.isNaN(lastRunMs)) {
    throw new Error(
      `Drill status record at "${path}" has an unparseable automated.lastRunAt value ` +
        `("${status.automated.lastRunAt}").`,
    );
  }

  const ageDays = (now.getTime() - lastRunMs) / (24 * 60 * 60 * 1000);
  if (ageDays > MAX_DRILL_AGE_DAYS) {
    throw new Error(
      `Drill status record at "${path}" is stale: the last automated run was ` +
        `${status.automated.lastRunAt} (${ageDays.toFixed(1)} days ago), older than the ` +
        `${MAX_DRILL_AGE_DAYS}-day freshness threshold.`,
    );
  }
}
