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
 * resolved path, and the file's own SQL text. */
export interface MigrationFile {
  tag: string;
  idx: number;
  path: string;
  sql: string;
}

/**
 * Enumerates every migration the committed journal names, in ascending idx order, reading each
 * file's text. `migrationsDir`/`journalPath` default to the recipe app's real paths but accept
 * overrides so a test can drive both mismatch directions against a temporary directory instead
 * of mutating the real migrations directory.
 *
 * A journal entry with no matching file, or a `.sql` file with no matching journal entry, is a
 * hard error naming the offending tag or filename -- never a silent skip.
 */
export function enumerateMigrationFiles(
  migrationsDir: string = DEFAULT_MIGRATIONS_DIR,
  journalPath: string = DEFAULT_JOURNAL_PATH,
): MigrationFile[] {
  const journal = JSON.parse(readFileSync(journalPath, "utf-8")) as Journal;
  const entries = [...journal.entries].sort((a, b) => a.idx - b.idx);

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
    return { tag: entry.tag, idx: entry.idx, path, sql };
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
