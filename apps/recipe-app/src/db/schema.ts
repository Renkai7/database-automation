import { relations } from "drizzle-orm";
import { integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

// D-09: this task creates the recipes table only — ingredients and steps are added by
// plan 01-03, which exercises the generate -> inspect -> migrate loop a second time.
// D-10/D-11 (Phase 4, 04-06/D-30): `notes` is now spent -- a nullable, no-default column
// generated and applied through the real runner, landing SAFE as predicted. The `tags`
// table alternative remains reserved and unspent. The expand-and-contract row
// (01-CONTEXT.md D-11's fourth row) stays reserved for Phase 7.
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
  notes: text("notes"),
});

// `position` is D-09's required ordering column. `timerLabel` was nullable through Phase 1-3,
// with a step with no timer storing SQL null to preserve the source design's conditional timer
// chip (`hasTimer: !!st[1]`). Phase 4 (04-06/D-31) spent that reserved churn row: the
// absent/present distinction is now carried by an empty string rather than SQL NULL, following
// `ingredients.unit`'s own precedent above -- it survives because `StepsList.tsx`'s
// `step.timerLabel && ...` conditional treats `''` as falsy exactly as it treated `null`. The
// `NOT NULL` was enforced by a real, generated migration preceded by a backfill
// (`0003_backfill_steps_timer_label.sql`), never applied naively against the seed's real
// pre-existing NULL rows.
export const steps = pgTable(
  "steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    body: text("body").notNull(),
    timerLabel: text("timer_label").notNull().default(""),
  },
  (table) => [unique().on(table.recipeId, table.position)],
);

export const recipesRelations = relations(recipes, ({ many }) => ({
  steps: many(steps),
}));

export const stepsRelations = relations(steps, ({ one }) => ({
  recipe: one(recipes, { fields: [steps.recipeId], references: [recipes.id] }),
}));
