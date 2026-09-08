import { defineConfig } from "drizzle-kit";
import { assertLocalDevelopmentTarget, getDevDatabaseUrl } from "../../scripts/env";

// This config drives drizzle-kit's own generate and check commands (Phase 4: the migrate path
// is now the gated runner behind db:migrate, not a drizzle-kit sub-command -- see
// scripts/db-migrate.ts and docs/decisions.md D-02). generate is still the single most
// consequential command this config touches, since it is what produces the SQL every later
// stage classifies and executes. The assertion is called here explicitly, not only inherited
// from the shared
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
