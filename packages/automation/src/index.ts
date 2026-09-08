// D-12: the public barrel. Phase 4's runner (and anything else consuming this package
// in-process) imports from here rather than reaching into individual src/ modules directly.
export { analyzeSql } from "./analyze";
export { DEFAULT_JOURNAL_PATH, DEFAULT_MIGRATIONS_DIR, enumerateMigrationFiles } from "./adapter/drizzle-migrations";
export type { MigrationFile } from "./adapter/drizzle-migrations";
export { loadDefaultRules } from "./adapter/default-rules";
export { loadRules } from "./classifier/classify";
export * from "./types";
