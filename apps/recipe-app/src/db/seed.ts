import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { assertDevelopmentDatabase, getDevDatabaseUrl } from "../../../../scripts/env";
import { ingredients, recipes, steps } from "./schema";

// D-23: a deterministic, committed seed derived from the imported design's own recipe
// content (apps/recipe-app/design/Recipe Page.dc.html). Fixed values, fixed row counts.
// The subtitle deliberately replaces the design's own meal-planner-referencing string
// (UI-SPEC Open Question 3); base_servings resolves UI-SPEC Open Question 4 and is the
// number the servings scaler's multiplier divides by, so that math derives from real data.
//
// Inserts go through the same Drizzle table objects schema.ts exports (not raw SQL), so a
// column rename in schema.ts breaks this file at type-check time rather than at runtime.
export async function seed(): Promise<void> {
  const client = new Client({ connectionString: getDevDatabaseUrl() });
  await client.connect();
  try {
    await assertDevelopmentDatabase(client);
    const db = drizzle(client, { schema: { recipes, ingredients, steps } });

    // Deleting the recipe row cascades to ingredients and steps (onDelete: "cascade" on
    // both child tables' recipe_id foreign key), so this seed is idempotent and can re-run
    // against an already-seeded database, converging to the same row counts every time.
    await db.delete(recipes);

    const [recipe] = await db
      .insert(recipes)
      .values({
        slug: "chicken-rice-bowl",
        title: "Chicken & Rice Bowl",
        subtitle: "Weeknight dinner · ready in 20 minutes",
        baseServings: 2,
        timeLabel: "20 min",
        effort: "Easy",
        baseKcal: 620,
      })
      .returning();

    // Recipe Page.dc.html's `ING` array, transcribed verbatim (01-PATTERNS.md). Quantities
    // are the raw authored values per base_servings of 2 — the screen scales them at read
    // time via `round(i[1] * mult)`, so pre-scaling here would make the stored numbers
    // meaningless. Spring onions' empty unit is a real value (the design has none), not a
    // stand-in for null.
    await db.insert(ingredients).values([
      { recipeId: recipe.id, name: "Chicken breast", quantity: "200", unit: "g", position: 0 },
      { recipeId: recipe.id, name: "Basmati rice", quantity: "90", unit: "g", position: 1 },
      { recipeId: recipe.id, name: "Broccoli", quantity: "150", unit: "g", position: 2 },
      { recipeId: recipe.id, name: "Spring onions", quantity: "2", unit: "", position: 3 },
      { recipeId: recipe.id, name: "Garlic", quantity: "2", unit: "cloves", position: 4 },
      { recipeId: recipe.id, name: "Ginger", quantity: "10", unit: "g", position: 5 },
      { recipeId: recipe.id, name: "Soy sauce", quantity: "20", unit: "ml", position: 6 },
      { recipeId: recipe.id, name: "Sesame oil", quantity: "10", unit: "ml", position: 7 },
    ]);

    // Recipe Page.dc.html's `STEPS` array, transcribed verbatim. A step with no timer omits
    // `timerLabel`; Drizzle omits the column from the INSERT entirely rather than sending an
    // explicit NULL, so the column's own default (`''`, 04-06/D-31) applies. The empty string
    // is now the "no timer" value, preserving the same absent/present distinction as the
    // source's `hasTimer: !!st[1]` conditional — the same reasoning `ingredients.unit`'s own
    // comment gives for its empty-string sentinel.
    await db.insert(steps).values([
      {
        recipeId: recipe.id,
        position: 0,
        body: "Rinse the rice until the water runs clear, then set it on with a lid down.",
        timerLabel: "12 min",
      },
      {
        recipeId: recipe.id,
        position: 1,
        body: "Butterfly the chicken so it cooks evenly, and salt it while the pan comes up to heat.",
      },
      {
        recipeId: recipe.id,
        position: 2,
        body: "Sear hard on both sides until the crust is deep gold, then rest it off the heat.",
        timerLabel: "8 min",
      },
      {
        recipeId: recipe.id,
        position: 3,
        body: "Steam the broccoli over the rice for the last few minutes so it stays bright.",
        timerLabel: "4 min",
      },
      {
        recipeId: recipe.id,
        position: 4,
        body: "Slice the chicken, build the bowl, and dress it with the soy, sesame, garlic and ginger.",
      },
    ]);
  } finally {
    await client.end();
  }
}

// Runnable directly via `pnpm db:seed` (tsx apps/recipe-app/src/db/seed.ts) and importable
// programmatically as `seed()` elsewhere.
//
// WR-03 FIX (04-REVIEW.md): never force a synchronous process exit (matching
// `scripts/db-migrate.ts`'s own established pattern) -- doing so immediately after a
// `libpg-query` WASM `parse()` call reproduced a genuine Windows libuv crash in this repo.
// `seed.ts` does not itself call `libpg-query`, but setting `process.exitCode` once and letting
// the event loop drain naturally is the load-bearing pattern every other command entry point in
// this repo follows, so this is not the one that copies from a synchronous `process.exit()`.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seed()
    .then(() => {
      console.log("Seed complete.");
      process.exitCode = 0;
    })
    .catch((error: unknown) => {
      console.error("Seed failed:", error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
