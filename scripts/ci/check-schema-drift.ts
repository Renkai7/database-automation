// D-09 (05-CONTEXT.md), CI-05, Task 3: schema drift.
// STUB: RED-phase placeholder (never throws, never signals drift). GREEN phase implements the
// real comparison.
import { execa } from "execa";
import { safeErrorMessage } from "../log";

export interface DriftSignal {
  drifted: boolean;
  paths: string[];
}

export function assertWorkingTreeClean(_porcelainOutput: string): void {
  // stub: never throws
}

export function driftSignalFromPorcelain(_porcelainOutput: string): DriftSignal {
  return { drifted: false, paths: [] };
}

async function runCheckSchemaDrift(): Promise<void> {
  process.exitCode = 0;
}

if (import.meta.main) {
  runCheckSchemaDrift().catch((error: unknown) => {
    console.error(safeErrorMessage(error));
    process.exitCode = 1;
  });
}

void execa;
