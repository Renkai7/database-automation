// D-09 (05-CONTEXT.md), CI-05, Task 3 -- schema drift: after applying the committed migration
// history, does the migration-generation script still produce nothing new? "Nothing new" means
// schema.ts and the committed migration history agree; a new file means a hand-edit changed what
// the SQL does without a corresponding schema.ts change (or vice versa).
//
// RESEARCH.md Pitfall 4 (session-verified): the generation script's exit code does not
// distinguish "clean" from "drift found" -- the signal this check trusts is the appearance of a
// file in `git status --porcelain`, never the child process's exit code, which is only ever
// logged as an observation (assumption A4 stays UNKNOWN on purpose, 05-CONTEXT.md).
//
// RESEARCH.md Pitfall 5: apps/recipe-app/drizzle.config.ts calls
// assertLocalDevelopmentTarget(getDevDatabaseUrl()) at module load time, before generation ever
// runs -- so this job needs RECIPE_DEV_DATABASE_URL set to a pin-satisfying value even though it
// opens no socket. Never loosen that pin to make CI work (D-14) -- shape the environment to
// satisfy it instead.
//
// Invokes the `db:generate` package script (`pnpm db:generate`) by name, never the underlying
// migration-generation binary directly, so this file stays clear of the sub-command bans
// tests/guardrails.test.ts enforces across the whole source surface.
//
// Never terminates the process directly -- sets process.exitCode once run() settles, matching
// every other scripts/*.ts entry point in this repo (packages/automation/src/cli.ts's own
// header documents the reproduced Windows libuv crash this convention exists to avoid). Reads no
// process.argv -- every command in this repository refuses arguments (01-CONTEXT.md D-16,
// 02-CONTEXT.md D-06).
import { execa } from "execa";
import { safeErrorMessage } from "../log";

const MIGRATIONS_DIR = "apps/recipe-app/drizzle/";

export interface DriftSignal {
  drifted: boolean;
  paths: string[];
}

/** Parses one repository-relative path per `git status --porcelain` line: two status
 * characters, one space separator, then the path (a rename line's "old -> new" text is kept
 * whole -- this check only needs "something changed here", never rename semantics). */
function pathsFromPorcelain(porcelainOutput: string): string[] {
  const paths: string[] = [];
  for (const rawLine of porcelainOutput.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.trim().length === 0) continue;
    paths.push(line.slice(3));
  }
  return paths;
}

/**
 * Throws when `porcelainOutput` is non-empty -- the migrations directory was already modified
 * before generation ran, so any subsequent result would be uninterpretable. This is the check's
 * concurrency guarantee: a dirty tree can never be misread as "no drift", and generated output
 * can never be mistaken for a pre-existing edit.
 */
export function assertWorkingTreeClean(porcelainOutput: string): void {
  const paths = pathsFromPorcelain(porcelainOutput);
  if (paths.length > 0) {
    throw new Error(
      `CI-05: "${MIGRATIONS_DIR}" was already modified before generation ran (${paths.join(", ")}) ` +
        "-- a dirty tree can never be misread as no drift, and generated output can never be " +
        "mistaken for a pre-existing edit.",
    );
  }
}

/**
 * Parses `git status --porcelain` output taken AFTER generation ran. Compares emptiness of
 * output only -- never the generator's randomly generated migration names or timestamps, which
 * is what makes this deterministic (D-09).
 */
export function driftSignalFromPorcelain(porcelainOutput: string): DriftSignal {
  const paths = pathsFromPorcelain(porcelainOutput);
  return { drifted: paths.length > 0, paths };
}

async function runCheckSchemaDrift(): Promise<void> {
  const before = await execa("git", ["status", "--porcelain", "--", MIGRATIONS_DIR]);
  assertWorkingTreeClean(before.stdout);

  const generateResult = await execa("pnpm", ["db:generate"], { reject: false, stdio: "inherit" });
  console.log(
    `[check-schema-drift] db:generate exited ${generateResult.exitCode ?? "unknown"} -- recorded ` +
      "as an observation only, never relied on as the drift signal (assumption A4 stays UNKNOWN).",
  );

  const after = await execa("git", ["status", "--porcelain", "--", MIGRATIONS_DIR]);
  const signal = driftSignalFromPorcelain(after.stdout);
  if (signal.drifted) {
    console.error(
      "[check-schema-drift] schema.ts and the committed migration history no longer agree -- " +
        `generation produced: ${signal.paths.join(", ")}`,
    );
    process.exitCode = 1;
    return;
  }
  process.exitCode = 0;
  console.log("[check-schema-drift] No drift -- schema.ts and the committed migration history agree.");
}

if (import.meta.main) {
  runCheckSchemaDrift().catch((error: unknown) => {
    console.error(safeErrorMessage(error));
    process.exitCode = 1;
  });
}
