// D-24 (04-CONTEXT.md): the committed, machine-readable record of the migration-history suite's
// (`pnpm test:history`) most recent result. Modelled on scripts/drill-status.ts but deliberately
// simpler: one fact, not two, and NO staleness rule.
//
// Why no staleness rule, stated explicitly rather than left implicit: unlike a restore drill
// (which proves something about THIS machine's current backup artifacts and can genuinely go
// stale), the history tests are deterministic and run entirely from committed migrations -- the
// full journal plus the newest-minus-full comparison (RUN-05/RUN-06) and the tamper-then-refuse
// proof (criterion 1) will produce the identical result on every run against the identical
// committed history. Nothing about them decays with the passage of time, so an age threshold here
// would be a nag rather than evidence going stale -- and a red suite for a reason that is not real
// is exactly what teaches people to ignore red (the same reasoning `01-CONTEXT.md` D-20 and
// `02-CONTEXT.md` D-19/D-20 apply to hard-failing rather than warning).
//
// Separate fact, kept separate: per `02-CONTEXT.md` D-18, this is its OWN record, independent of
// `docs/restore-drill-status.json`. A green run of one must never silently upgrade the other --
// `assertHistoryStatusPassed` below reads only this file and nothing about the drill's record.
//
// Standalone module with no module-load side effects -- same property scripts/drill-status.ts,
// scripts/verify-migration-state.ts, and scripts/backup-manifest.ts deliberately have -- so a
// test can import HistoryStatusSchema/readHistoryStatus/recordHistorySuiteResult/
// assertHistoryStatusPassed without opening a database connection or triggering scripts/env.ts's
// own import-time environment validation.
//
// No field here can hold a connection string, a role name's password, or a password hash -- the
// same type-level expression of the no-credentials rule scripts/drill-status.ts's DrillStatusSchema
// and scripts/backup-manifest.ts's ManifestSchema both carry.
import { access, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";

/** Repository-relative path to the committed history-suite status record. */
export const DEFAULT_HISTORY_STATUS_PATH = "docs/migration-history-status.json";

/** `suiteConfig` names the vitest config the result came from, so a record can never be mistaken
 * for a different suite's result -- there is exactly one legal value today, but the field is
 * still validated (not hardcoded into the schema as a literal) so a future config rename is a
 * visible, reviewable diff rather than a silent mismatch. */
export const HistoryStatusSchema = z.object({
  lastRunAt: z.string().nullable(),
  outcome: z.enum(["PASS", "FAIL"]).nullable(),
  suiteConfig: z.string().min(1),
});

export type HistoryStatus = z.infer<typeof HistoryStatusSchema>;

/** The honest starting state, before the history suite has ever genuinely run. */
export const INITIAL_HISTORY_STATUS: HistoryStatus = {
  lastRunAt: null,
  outcome: null,
  suiteConfig: "vitest.history.config.ts",
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
 * Reads and validates a history status record. `.safeParse()`s through the schema on EVERY read,
 * not just on write, so a hand-edited or truncated record fails loudly here rather than being
 * silently trusted by assertHistoryStatusPassed below.
 */
export async function readHistoryStatus(
  path: string = DEFAULT_HISTORY_STATUS_PATH,
): Promise<HistoryStatus> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    throw new Error(`Could not read history status record at "${path}" -- the file is missing.`);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new Error(`History status record at "${path}" is not valid JSON.`);
  }

  const result = HistoryStatusSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new Error(
      `History status record at "${path}" failed schema validation: ${result.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return result.data;
}

/**
 * Records the history suite's result. Tolerates a missing file ONLY (the very first
 * `pnpm test:history` run, before this record has ever been committed) by starting from
 * INITIAL_HISTORY_STATUS. A file that exists but fails schema validation is never silently
 * replaced -- that would defeat the entire point of readHistoryStatus's own strict parse.
 *
 * A suite that never genuinely ran must never call this function -- see
 * scripts/history-suite.ts's own boundary (mirrors scripts/drill.ts's "the drill never ran"
 * case): a thing that could not run is not a thing that passed, or failed.
 */
export async function recordHistorySuiteResult(
  outcome: "PASS" | "FAIL",
  path: string = DEFAULT_HISTORY_STATUS_PATH,
): Promise<void> {
  const existing = (await fileExists(path)) ? await readHistoryStatus(path) : INITIAL_HISTORY_STATUS;

  const updated: HistoryStatus = {
    lastRunAt: new Date().toISOString(),
    outcome,
    suiteConfig: existing.suiteConfig,
  };

  const validated = HistoryStatusSchema.parse(updated);
  await writeFile(path, `${JSON.stringify(validated, null, 2)}\n`, "utf-8");
}

/**
 * D-24: the cheap check `pnpm test` runs on every invocation. Throws a distinctly worded error
 * for each of: file missing, invalid JSON, schema-validation failure, `lastRunAt` null, and
 * `outcome` not `"PASS"`. Deliberately NO staleness/age check -- see this module's header comment
 * for why an age threshold would be dishonest here.
 */
export async function assertHistoryStatusPassed(
  path: string = DEFAULT_HISTORY_STATUS_PATH,
): Promise<void> {
  const status = await readHistoryStatus(path);

  if (!status.lastRunAt) {
    throw new Error(
      `History status record at "${path}" has never recorded a run (lastRunAt is null) -- an ` +
        "empty record is a hard failure, not a first-run grace case.",
    );
  }

  if (status.outcome !== "PASS") {
    throw new Error(
      `History status record at "${path}" reports outcome "${status.outcome}", not "PASS".`,
    );
  }
}
