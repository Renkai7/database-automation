import { defineConfig } from "drizzle-kit";
import { getDevDatabaseUrl } from "../../scripts/env";

// dbCredentials.url is always obtained through the shared, validated env module — never
// through a raw process.env read here — so the bare-DATABASE_URL hard failure and the
// RECIPE_DEV_DATABASE_URL presence check (ENV-03) apply identically to Drizzle Kit.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: getDevDatabaseUrl(),
  },
});
