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

/**
 * Parses journal text into a Journal, throwing a message naming `side` ("base" or "head") on a
 * parse failure -- an unparseable base journal must never be treated as an empty entry list,
 * because that would make every existing entry vacuously unchanged and turn the check into a
 * no-op.
 */
function parseJournal(text: string, side: "base" | "head"): Journal {
  try {
    return JSON.parse(text) as Journal;
  } catch (error) {
    throw new Error(
      `CI-05: the ${side} journal at "${JOURNAL_PATH}" could not be parsed as JSON ` +
        `(${safeErrorMessage(error)}). An unparseable journal is never treated as "no entries".`,
    );
  }
}

// D-10 (05-CONTEXT.md), CI-05, Task 2: journal entry-level append-only. meta/_journal.json
// legitimately changes on every new migration, so it is append-only at the ENTRY level, not the
// file level -- an existing entry's idx/tag/when must never change, and no entry may disappear
// or be renumbered (renumbering closes the "renumber so a modified migration re-runs as new"
// dodge, since the original idx slot then reads as a disappeared entry). Does not compare array
// position -- reordering is not tampering, idx is the identity -- and does not reject new
// entries with a higher idx -- appending is the normal case every new migration performs.
export function assertJournalEntriesAppendOnly(baseJournalText: string, headJournalText: string): void {
  const baseJournal = parseJournal(baseJournalText, "base");
  const headJournal = parseJournal(headJournalText, "head");

  const headByIdx = new Map<number, JournalEntry>();
  for (const entry of headJournal.entries) {
    const prior = headByIdx.get(entry.idx);
    if (prior !== undefined) {
      throw new Error(
        `CI-05: the head journal at "${JOURNAL_PATH}" has idx ${entry.idx} shared by both ` +
          `"${prior.tag}" and "${entry.tag}" -- ordering must be total, and a duplicated idx is ` +
          "how a renumbered entry re-runs as new.",
      );
    }
    headByIdx.set(entry.idx, entry);
  }

  for (const baseEntry of baseJournal.entries) {
    const headEntry = headByIdx.get(baseEntry.idx);
    if (headEntry === undefined) {
      throw new Error(
        `CI-05: journal entry idx ${baseEntry.idx} ("${baseEntry.tag}") is present in the base ` +
          `journal at "${JOURNAL_PATH}" but absent from the head journal -- journal entries are ` +
          "append-only, with no exemption for reverts or renumbering.",
      );
    }
    if (headEntry.tag !== baseEntry.tag) {
      throw new Error(
        `CI-05: journal entry idx ${baseEntry.idx} changed its "tag" from "${baseEntry.tag}" to ` +
          `"${headEntry.tag}" -- journal entries are append-only at the entry level.`,
      );
    }
    if (headEntry.when !== baseEntry.when) {
      throw new Error(
        `CI-05: journal entry idx ${baseEntry.idx} ("${baseEntry.tag}") changed its "when" from ` +
          `${baseEntry.when} to ${headEntry.when} -- journal entries are append-only at the ` +
          "entry level.",
      );
    }
  }
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

const MISSING_PATH_AT_COMMIT = /does not exist|exists on disk, but not in/i;
const EMPTY_JOURNAL_TEXT = JSON.stringify({ version: "7", dialect: "postgresql", entries: [] });

/**
 * Reads the journal at `sha` from git object storage (`git show <sha>:<path>`), never from the
 * working tree, so the check is not influenced by anything the job did to the checkout. A `git
 * show` failure is read as "no prior journal" only when `allowMissing` is set AND git's own
 * error identifies a missing path; any other failure throws.
 */
async function readJournalAtCommit(sha: string, allowMissing: boolean): Promise<string> {
  const result = await execa("git", ["show", `${sha}:${JOURNAL_PATH}`], { reject: false });
  if ((result.exitCode ?? 1) === 0) {
    return result.stdout;
  }
  if (allowMissing && MISSING_PATH_AT_COMMIT.test(result.stderr)) {
    console.log(`[check-append-only] No prior journal at "${JOURNAL_PATH}" at commit "${sha}".`);
    return EMPTY_JOURNAL_TEXT;
  }
  throw new Error(
    `[check-append-only] Could not read the journal at "${JOURNAL_PATH}" at commit "${sha}" ` +
      `(git show exited ${result.exitCode}): ${result.stderr}`,
  );
}

/**
 * Runs both append-only checks (file-level and journal entry-level) against the pull request's
 * base and head SHAs, read from the environment. Exported for direct unit testing of the
 * env-var/SHA-resolution gate without spawning git or requiring a real clone.
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

  const baseJournalText = await readJournalAtCommit(baseSha, true);
  const headJournalText = await readJournalAtCommit(headSha, false);
  assertJournalEntriesAppendOnly(baseJournalText, headJournalText);
}

if (import.meta.main) {
  runCheckAppendOnly()
    .then(() => {
      process.exitCode = 0;
      console.log("[check-append-only] Migrations are append-only, at both the file and journal-entry level.");
    })
    .catch((error: unknown) => {
      console.error(safeErrorMessage(error));
      process.exitCode = 1;
    });
}
