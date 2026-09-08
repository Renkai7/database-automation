// D-11: the only module in the analyzer permitted filesystem and Drizzle knowledge -- it
// enumerates the recipe app's real Drizzle migration files against the committed journal. A
// separate module rather than filesystem access inside analyze.ts or the classifier,
// deliberately: the pure core (analyzeSql) stays a function of SQL text plus rules only, so
// Phase 4's runner can hand it the exact bytes it is about to execute rather than a path it
// would have to trust (03-CONTEXT.md D-11). Scope is deliberately narrow: this reads the
// journal, resolves each entry to its .sql file, and nothing more -- matching
// scripts/verify-migration-state.ts's own narrow-scope precedent (its own header comment states
// the same discipline).
//
// Both mismatch directions are hard errors, not skips, following this repo's hard-fail-never-warn
// precedent (01-CONTEXT.md D-20, 02-CONTEXT.md D-19): a migration the analyzer silently did not
// examine must never be indistinguishable from one it approved.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Repository-relative path to the recipe app's committed Drizzle migrations directory. */
export const DEFAULT_MIGRATIONS_DIR = "apps/recipe-app/drizzle";

/** Repository-relative path to the recipe app's committed Drizzle migration journal. */
export const DEFAULT_JOURNAL_PATH = "apps/recipe-app/drizzle/meta/_journal.json";

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

/** One migration file resolved against its journal entry: the tag, its journal index, the
 * journal entry's own `when` timestamp (Phase 4: drizzle's own "is this migration new?"
 * comparison target, and the value the runner's ledger `created_at` column must carry -- D-04),
 * the resolved path, and the file's own SQL text. */
export interface MigrationFile {
  tag: string;
  idx: number;
  when: number;
  path: string;
  sql: string;
}

/**
 * Enumerates every migration the committed journal names, in ascending idx order, reading each
 * file's text. `migrationsDir`/`journalPath` default to the recipe app's real paths but accept
 * overrides so a test can drive both mismatch directions against a temporary directory instead
 * of mutating the real migrations directory.
 *
 * A journal entry with no matching file, a `.sql` file with no matching journal entry, two
 * journal entries sharing the same `idx`, or two journal entries sharing the same `when`, is a
 * hard error naming the offending tag, filename, duplicated `idx`, or duplicated `when` -- never
 * a silent skip. Ordering must be total, not merely sorted: a journal with a duplicated `idx` has
 * no single unambiguous application order, so nothing is applied.
 *
 * WR-02 FIX (04-REVIEW.md): `runMigrations`'s own pending-migration filter
 * (`packages/automation/src/runner/run-migrations.ts`) compares each file's `when` against the
 * ledger's last-applied timestamp with a strict inequality -- if two journal entries ever shared
 * a `when` value (most plausibly via a hand-edited or copy-pasted `--custom` journal entry), the
 * second one to share that timestamp would never again compare `< lastAppliedMillis` once the
 * first applies, so it would be silently skipped on every future run. That is the same category
 * of ordering ambiguity the duplicate-`idx` guard above already refuses to tolerate, so it gets
 * the identical hard-fail treatment: applying nothing rather than silently omitting a migration.
 */
export function enumerateMigrationFiles(
  migrationsDir: string = DEFAULT_MIGRATIONS_DIR,
  journalPath: string = DEFAULT_JOURNAL_PATH,
): MigrationFile[] {
  const journal = JSON.parse(readFileSync(journalPath, "utf-8")) as Journal;
  const entries = [...journal.entries].sort((a, b) => a.idx - b.idx);

  const seenIdx = new Map<number, string>();
  const seenWhen = new Map<number, string>();
  for (const entry of entries) {
    const priorTagByIdx = seenIdx.get(entry.idx);
    if (priorTagByIdx !== undefined) {
      throw new Error(
        `Migration journal integrity error: idx ${entry.idx} is shared by both "${priorTagByIdx}" ` +
          `and "${entry.tag}" in "${journalPath}". Ordering must be total -- applying nothing ` +
          "until the journal names each migration a single, unambiguous position.",
      );
    }
    seenIdx.set(entry.idx, entry.tag);

    const priorTagByWhen = seenWhen.get(entry.when);
    if (priorTagByWhen !== undefined) {
      throw new Error(
        `Migration journal integrity error: when ${entry.when} is shared by both "${priorTagByWhen}" ` +
          `and "${entry.tag}" in "${journalPath}". Ordering must be total -- applying nothing ` +
          "until the journal names each migration a single, unambiguous position.",
      );
    }
    seenWhen.set(entry.when, entry.tag);
  }

  const files: MigrationFile[] = entries.map((entry) => {
    const path = join(migrationsDir, `${entry.tag}.sql`);
    let sql: string;
    try {
      sql = readFileSync(path, "utf-8");
    } catch {
      throw new Error(
        `Migration journal mismatch: journal entry "${entry.tag}" (idx ${entry.idx}) in ` +
          `"${journalPath}" names no file on disk at "${path}". A migration the analyzer did ` +
          "not examine must never look like a migration it approved.",
      );
    }
    return { tag: entry.tag, idx: entry.idx, when: entry.when, path, sql };
  });

  const journalTags = new Set(entries.map((entry) => entry.tag));
  const sqlFilesOnDisk = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql"));
  for (const fileName of sqlFilesOnDisk) {
    const tag = fileName.slice(0, -".sql".length);
    if (!journalTags.has(tag)) {
      throw new Error(
        `Migration journal mismatch: "${join(migrationsDir, fileName)}" exists on disk but has ` +
          `no entry in "${journalPath}". A migration the analyzer did not examine must never ` +
          "look like a migration it approved.",
      );
    }
  }

  return files;
}
