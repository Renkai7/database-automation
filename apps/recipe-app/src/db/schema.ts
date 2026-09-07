import { relations } from "drizzle-orm";
import { integer, numeric, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

// D-09: this task creates the recipes table only — ingredients and steps are added by
// plan 01-03, which exercises the generate -> inspect -> migrate loop a second time.
// D-10/D-11: no `notes` column and no tags table here; both are reserved churn material
// for Phase 4.
export const recipes = pgTable("recipes", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  subtitle: text("subtitle").notNull(),
  baseServings: integer("base_servings").notNull(),
  timeLabel: text("time_label").notNull(),
  effort: text("effort").notNull(),
  baseKcal: integer("base_kcal").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// D-09 (plan 01-03): the two remaining recipe-core tables. Quantities are stored as
// authored per the recipe's base_servings and scaled at read time (never pre-scaled here) —
// see Recipe Page.dc.html's `mult = servings / base_servings` and per-ingredient `round(...)`
// at render time. `unit` defaults to the empty string rather than null because the design's
// spring-onions row genuinely has no unit (a real value, not a missing one).
export const ingredients = pgTable(
  "ingredients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    quantity: numeric("quantity", { precision: 10, scale: 2 }).notNull(),
    unit: text("unit").notNull().default(""),
    position: integer("position").notNull(),
  },
  (table) => [unique().on(table.recipeId, table.position)],
);

// `position` is D-09's required ordering column. `timerLabel` is nullable because the
// source design already renders the timer chip conditionally per step (`hasTimer: !!st[1]`) —
// a step with no timer stores SQL null, not an empty string, to preserve that distinction.
export const steps = pgTable(
  "steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    body: text("body").notNull(),
    timerLabel: text("timer_label"),
  },
  (table) => [unique().on(table.recipeId, table.position)],
);

export const recipesRelations = relations(recipes, ({ many }) => ({
  ingredients: many(ingredients),
  steps: many(steps),
}));

export const ingredientsRelations = relations(ingredients, ({ one }) => ({
  recipe: one(recipes, { fields: [ingredients.recipeId], references: [recipes.id] }),
}));

export const stepsRelations = relations(steps, ({ one }) => ({
  recipe: one(recipes, { fields: [steps.recipeId], references: [recipes.id] }),
}));
