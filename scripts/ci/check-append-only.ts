// D-09 (05-CONTEXT.md), CI-05, Task 1 -- file-level append-only check.
// STUB: RED phase placeholder. GREEN phase (next commit) implements the real logic.
import { execa } from "execa";
import { safeErrorMessage } from "../log";

export interface NameStatusEntry {
  status: string;
  path: string;
}

export function parseNameStatus(_output: string): NameStatusEntry[] {
  return [];
}

export function assertMigrationFilesAppendOnly(_entries: readonly NameStatusEntry[]): void {
  // stub: never throws
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[check-append-only] Missing required environment variable "${name}".`);
  }
  return value;
}

export async function runCheckAppendOnly(): Promise<void> {
  requireEnv("PR_BASE_SHA");
  requireEnv("PR_HEAD_SHA");
}

if (import.meta.main) {
  runCheckAppendOnly()
    .then(() => {
      process.exitCode = 0;
    })
    .catch((error: unknown) => {
      console.error(safeErrorMessage(error));
      process.exitCode = 1;
    });
}

void execa;
