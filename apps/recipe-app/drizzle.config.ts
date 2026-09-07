import { defineConfig } from "drizzle-kit";
import { assertLocalDevelopmentTarget, getDevDatabaseUrl } from "../../scripts/env";

// This config drives drizzle-kit migrate/generate -- the single most destructive command in
// the pipeline. The assertion is called here explicitly, not only inherited from the shared
// module's own import-time validation, so that the guard travels with the destructive
// operation itself rather than depending on a sibling process's earlier check having already
// run (closes WR-02's TOCTOU-shaped gap; see D-16 and 01-VERIFICATION.md's failed truth #6).
// defineConfig is synchronous, which is exactly why this is a synchronous URL assertion rather
// than a database round-trip.
const url = getDevDatabaseUrl();
assertLocalDevelopmentTarget(url);

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url,
  },
});
