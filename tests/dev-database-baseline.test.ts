// GAP-1/GAP-3 (Nyquist validation, phase 01-local-environment): closes the gap where 52 existing
// tests never actually connected to the live database to confirm the version/extension baseline
// (D-13), nor asserted the D-09 schema scope. Follows tests/verify-migration-state.test.ts and
// tests/db-reset.test.ts's pattern: connect with getDevDatabaseUrl(), call
// assertDevelopmentDatabase() before drawing any conclusion, close the client in `finally`.
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { assertDevelopmentDatabase, getDevDatabaseUrl } from "../scripts/env";

describe("dev database baseline (ENV-01, D-13)", () => {
  it("the live server's major version is 17, read from the server itself, not the compose image string", async () => {
    const client = new Client({ connectionString: getDevDatabaseUrl() });
    await client.connect();
    try {
      await assertDevelopmentDatabase(client);

      const { rows } = await client.query("SHOW server_version_num");
      const versionNum = Number(rows[0].server_version_num);
      expect(
        Number.isFinite(versionNum) && versionNum > 0,
        "server_version_num must parse as a positive number",
      ).toBe(true);
      const major = Math.floor(versionNum / 10000);
      expect(
        major,
        "D-13/ENV-01: the running development server's major version must be PostgreSQL 17 -- " +
          "this reads the server's own reported version, not the docker-compose.yml image tag",
      ).toBe(17);
    } finally {
      await client.end();
    }
  });

  it("no non-default extension has been installed, so the declared empty extension baseline (D-13) still holds", async () => {
    const client = new Client({ connectionString: getDevDatabaseUrl() });
    await client.connect();
    try {
      await assertDevelopmentDatabase(client);

      const { rows } = await client.query(
        "SELECT extname FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY extname",
      );
      expect(
        rows.map((row: { extname: string }) => row.extname),
        "D-13: the development database must have zero non-default extensions -- an extension " +
          "must arrive only via a Drizzle migration, never silently",
      ).toEqual([]);
    } finally {
      await client.end();
    }
  });

  it("docker-compose.yml pins the postgres image to the same major the live server reports (D-13)", async () => {
    const client = new Client({ connectionString: getDevDatabaseUrl() });
    await client.connect();
    let liveMajor: number;
    try {
      await assertDevelopmentDatabase(client);
      const { rows } = await client.query("SHOW server_version_num");
      liveMajor = Math.floor(Number(rows[0].server_version_num) / 10000);
    } finally {
      await client.end();
    }

    const compose = readFileSync("docker-compose.yml", "utf-8");
    const imageMatch = compose.match(/image:\s*postgres:(\d+)/);
    expect(
      imageMatch,
      "docker-compose.yml must declare a `postgres:<major>` image tag so it can be compared " +
        "against the live server's reported major version",
    ).not.toBeNull();
    const declaredMajor = Number(imageMatch![1]);
    expect(
      declaredMajor,
      "D-13: docker-compose.yml's declared postgres image major version must match the live " +
        "server's reported major version -- these must never silently diverge",
    ).toBe(liveMajor);
  });
});

describe("dev database schema scope (ENV-02, D-09/D-10/D-11)", () => {
  it("public.recipes has exactly its nine original columns, no more and no fewer", async () => {
    const client = new Client({ connectionString: getDevDatabaseUrl() });
    await client.connect();
    try {
      await assertDevelopmentDatabase(client);

      const { rows } = await client.query(
        "SELECT column_name FROM information_schema.columns " +
          "WHERE table_schema = 'public' AND table_name = 'recipes'",
      );
      const actualColumns = rows.map((row: { column_name: string }) => row.column_name).sort();
      const expectedColumns = [
        "id",
        "slug",
        "title",
        "subtitle",
        "base_servings",
        "time_label",
        "effort",
        "base_kcal",
        "created_at",
      ].sort();

      expect(
        actualColumns,
        "D-09/D-10/D-11: public.recipes's column set has changed from the declared Phase 1 " +
          "baseline -- no reserved schema churn (a `notes` column, a `tags` table, meal-plan or " +
          "shopping surface) has been spent yet, and any addition, removal, or rename here must " +
          "be a deliberate, recorded decision, not a silent drift",
      ).toEqual(expectedColumns);
    } finally {
      await client.end();
    }
  });
});
