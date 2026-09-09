// D-09 (05-CONTEXT.md), CI-05, Task 1 -- file-level append-only: a pull request that modifies or
// deletes any existing file under apps/recipe-app/drizzle/ must fail this check -- only
// additions are permitted. This module parses `git diff --name-status` output and applies that
// rule with no exemption, including for reverts (D-10's recorded consequence: Phase 4's own
// D-32 revert-both-file-and-journal-entry workflow would be refused if attempted through a pull
// request -- the intended outcome, not a bug).
//
// This task parses path/status pairs, not journal JSON, so it imports nothing from
// packages/automation/src/adapter/drizzle-migrations.ts -- it only mirrors that module's
// hard-fail-never-warn message style (name the exact field, the exact value observed, and why it
// cannot be trusted). Task 2 extends this same file with the journal entry-level check
// (D-10), which is where the journal shape actually becomes shared.
//
// The entry point resolves both SHAs with `git cat-file -e <sha>^{commit}` before ever
// diffing -- a diff that could not be computed (an unresolvable base commit, most plausibly from
// actions/checkout's default fetch-depth: 1, RESEARCH.md Pitfall 3) must fail this check, never
// silently pass it as an empty diff. Both PR_BASE_SHA/PR_HEAD_SHA are read from the environment,
// never process.argv -- every command in this repository refuses arguments (01-CONTEXT.md D-16,
// 02-CONTEXT.md D-06).
//
// Never terminates the process directly -- sets process.exitCode once run() settles, matching
// every other scripts/*.ts entry point in this repo (packages/automation/src/cli.ts's own
// header documents the reproduced Windows libuv crash this convention exists to avoid).
import { execa } from "execa";
import type { Journal, JournalEntry } from "../../packages/automation/src/index";
import { safeErrorMessage } from "../log";

const MIGRATIONS_DIR_PREFIX = "apps/recipe-app/drizzle/";
const JOURNAL_PATH = "apps/recipe-app/drizzle/meta/_journal.json";

export interface NameStatusEntry {
  status: string;
  path: string;
}

/**
 * Parses `git diff --name-status` output into path/status pairs. Tab-separated; tolerates
 * rename/copy statuses that carry two path columns (`R100\told\tnew`, `C100\told\tnew`) by
 * taking the destination path and keeping the raw status letter with its similarity score
 * intact -- `R100` is not silently normalised into `A`.
 */
export function parseNameStatus(output: string): NameStatusEntry[] {
  const entries: NameStatusEntry[] = [];
  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const columns = line.split("\t");
    const status = columns[0];
    const path = columns[columns.length - 1];
    entries.push({ status, path });
  }
  return entries;
}

/**
 * Throws when any entry whose path is under apps/recipe-app/drizzle/ (excluding
 * meta/_journal.json, which Task 2's entry-level check owns) has a status other than `A`. No
 * allowlist, no exemption, no named escape for reverts.
 */
export function assertMigrationFilesAppendOnly(entries: readonly NameStatusEntry[]): void {
  for (const entry of entries) {
    if (!entry.path.startsWith(MIGRATIONS_DIR_PREFIX)) continue;
    if (entry.path === JOURNAL_PATH) continue;
    if (entry.status !== "A") {
      throw new Error(
        `CI-05: "${entry.path}" has git status "${entry.status}", not "A" -- migrations under ` +
          `${MIGRATIONS_DIR_PREFIX} are append-only, with no exemption for reverts.`,
      );
    }
  }
}

// D-10 (05-CONTEXT.md), CI-05, Task 2: journal entry-level append-only.
// STUB: RED-phase placeholder (never throws). GREEN phase implements the real comparison.
export function assertJournalEntriesAppendOnly(_baseJournalText: string, _headJournalText: string): void {
  const _unused: [Journal | undefined, JournalEntry | undefined] = [undefined, undefined];
  void _unused;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `[check-append-only] Missing required environment variable "${name}". The workflow needs ` +
        "fetch-depth: 0 so both PR_BASE_SHA and PR_HEAD_SHA are resolvable.",
    );
  }
  return value;
}

async function assertShaResolvable(sha: string, label: string): Promise<void> {
  const result = await execa("git", ["cat-file", "-e", `${sha}^{commit}`], { reject: false });
  if ((result.exitCode ?? 1) !== 0) {
    throw new Error(
      `[check-append-only] ${label} "${sha}" is not resolvable in this clone. A diff that could ` +
        "not be computed must fail this check, never pass it silently -- the workflow needs " +
        "fetch-depth: 0.",
    );
  }
}

/**
 * Runs the file-level append-only check against the pull request's base and head SHAs, read
 * from the environment. Exported for direct unit testing of the env-var/SHA-resolution gate
 * without spawning git or requiring a real clone.
 */
export async function runCheckAppendOnly(): Promise<void> {
  const baseSha = requireEnv("PR_BASE_SHA");
  const headSha = requireEnv("PR_HEAD_SHA");

  await assertShaResolvable(baseSha, "PR_BASE_SHA");
  await assertShaResolvable(headSha, "PR_HEAD_SHA");

  const diffResult = await execa("git", [
    "diff",
    "--name-status",
    baseSha,
    headSha,
    "--",
    MIGRATIONS_DIR_PREFIX,
  ]);
  assertMigrationFilesAppendOnly(parseNameStatus(diffResult.stdout));
}

if (import.meta.main) {
  runCheckAppendOnly()
    .then(() => {
      process.exitCode = 0;
      console.log("[check-append-only] Migration files are append-only.");
    })
    .catch((error: unknown) => {
      console.error(safeErrorMessage(error));
      process.exitCode = 1;
    });
}
