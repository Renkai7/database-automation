import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { assertDevelopmentDatabase, getDevDatabaseUrl } from "../../../../scripts/env";

// D-23: a deterministic, committed seed derived from the imported design's own recipe
// content (apps/recipe-app/design/Recipe Page.dc.html). Fixed values, fixed row count.
// The subtitle deliberately replaces the design's own meal-planner-referencing string
// (UI-SPEC Open Question 3); base_servings resolves UI-SPEC Open Question 4 and is the
// number the servings scaler's multiplier divides by, so that math derives from real data.
// Ingredient and step rows are added by plan 01-03; this row's structure accommodates them
// without needing to be rewritten.
export async function seed(): Promise<void> {
  const client = new Client({ connectionString: getDevDatabaseUrl() });
  await client.connect();
  try {
    await assertDevelopmentDatabase(client);
    await client.query("DELETE FROM recipes");
    await client.query(
      `INSERT INTO recipes (slug, title, subtitle, base_servings, time_label, effort, base_kcal)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        "chicken-rice-bowl",
        "Chicken & Rice Bowl",
        "Weeknight dinner · ready in 20 minutes",
        2,
        "20 min",
        "Easy",
        620,
      ],
    );
  } finally {
    await client.end();
  }
}

// Runnable directly via `pnpm db:seed` (tsx apps/recipe-app/src/db/seed.ts) and importable
// programmatically as `seed()` elsewhere.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seed()
    .then(() => {
      console.log("Seed complete.");
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error("Seed failed:", error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
