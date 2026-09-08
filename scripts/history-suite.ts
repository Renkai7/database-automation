// D-24 (04-CONTEXT.md): `test:history`'s entry point. Wraps `vitest run --config
// vitest.history.config.ts` rather than invoking vitest directly (as `package.json`'s
// `test:history` script would if it were left as a literal vitest invocation) because D-24
// requires a committed, recorded result, and vitest alone has no way to write one -- the same
// relationship `pnpm db:drill` (scripts/drill.ts) has to its own assertions. Deviation from
// 04-VALIDATION.md's literal "Full suite command" recorded in 04-03-SUMMARY.md.
//
// D-20-style boundary (02-CONTEXT.md, mirrored here for the same reason): if vitest itself could
// not be spawned at all (not "the suite ran and failed" but "the suite never ran"), this module
// writes NOTHING to the status record -- a suite that never ran is not a suite that failed. Only
// once vitest has genuinely exited with a code does this module call
// recordHistorySuiteResult -- with "PASS" for exit 0, "FAIL" for anything else.
//
// Guarded with import.meta.main, exactly as scripts/drill.ts and scripts/backup.ts are: importing
// this module (e.g. from a test) must never itself run the suite. Never calls process.exit() --
// sets process.exitCode once run() settles, letting the event loop drain naturally (the reproduced
// Windows libuv WASM-teardown crash this repo has already hit once, packages/automation/src/cli.ts's
// own header documents it).
import { execa } from "execa";
import { recordHistorySuiteResult } from "./history-status";
import { safeErrorMessage } from "./log";

const HISTORY_VITEST_CONFIG = "vitest.history.config.ts";

/**
 * Runs the history suite via a real `vitest run --config vitest.history.config.ts` child process
 * and records its outcome. Returns the same exit code vitest itself reported. Takes no argument
 * and no target -- like every other command in this repo (`01-CONTEXT.md` D-16,
 * `02-CONTEXT.md` D-06).
 */
export async function runHistorySuite(): Promise<number> {
  let exitCode: number;
  try {
    const run = await execa("pnpm", ["exec", "vitest", "run", "--config", HISTORY_VITEST_CONFIG], {
      reject: false,
    });
    exitCode = run.exitCode ?? 1;
  } catch (error) {
    // The spawn itself threw -- vitest could not be started at all. A suite that never ran is
    // not a suite that failed: write nothing to the status record, matching scripts/drill.ts's
    // own "the drill never ran" boundary (D-20).
    console.error(`[test:history] Could not start vitest: ${safeErrorMessage(error)}`);
    throw error;
  }

  await recordHistorySuiteResult(exitCode === 0 ? "PASS" : "FAIL");
  return exitCode;
}

if (import.meta.main) {
  runHistorySuite()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(safeErrorMessage(error));
      process.exitCode = 1;
    });
}
