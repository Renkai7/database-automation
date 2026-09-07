import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getDevDatabaseUrl } from "../../../../scripts/env";
import * as schema from "./schema";

// The connection string is obtained only through the shared, validated env module — the
// bare-DATABASE_URL hard failure and the RECIPE_DEV_DATABASE_URL presence check both run
// (as an import-time side effect of scripts/env.ts) before this pool is constructed.
export const db = drizzle(new Pool({ connectionString: getDevDatabaseUrl() }), { schema });
