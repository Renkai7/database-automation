import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";

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
