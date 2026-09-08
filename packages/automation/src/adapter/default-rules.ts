// D-11: the second filesystem-touching adapter -- loads the bundled default rules catalogue
// from disk. Split out of analyze.ts (Rule 1 fix, see 03-03-SUMMARY.md): analyze.ts's own
// exported analyzeSql is meant to be the pure core Phase 4's runner calls in-process with zero
// I/O, but a single module-level `import { readFileSync } from "node:fs"` makes the whole
// analyze.ts file fail the purity assertion 03-03-PLAN.md's task 1 requires (no module under
// src/inspector/, src/classifier/, or src/analyze.ts may import a filesystem module), even
// though analyzeSql itself never called it. Kept out of drizzle-migrations.ts too: that module's
// own scope is deliberately narrowed to Drizzle/journal knowledge, and loading the rules
// catalogue has none.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadRules } from "../classifier/classify";
import type { RulesFile } from "../classifier/rules-schema";

/** Repository-relative path (from this module's own directory) to the bundled default rules
 * catalogue -- resolved via import.meta.url so it works regardless of the caller's cwd. */
const DEFAULT_RULES_PATH = fileURLToPath(new URL("../rules/rules.json", import.meta.url));

/** Reads and loads (parses, schema-validates, floor-checks) the bundled default rules
 * catalogue. The only filesystem access in this module -- deliberately separated from
 * analyze.ts's analyzeSql so the pure function stays pure (D-11). */
export function loadDefaultRules(): RulesFile {
  const raw = JSON.parse(readFileSync(DEFAULT_RULES_PATH, "utf-8"));
  return loadRules(raw);
}
