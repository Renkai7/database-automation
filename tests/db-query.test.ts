// Exercises scripts/db-query.ts as a real child process (via `tsx`, the same way the root
// `db:query` script invokes it), so the argument handling and scripts/env.ts's import-time
// checks are both genuinely exercised rather than mocked. Uses the live, seeded development
// database — `ingredients` has exactly 8 rows (D-23's deterministic seed) — as a read-only
// fixture, and a scratch recipe row for the modify case so the seed's own counts are never
// disturbed by this file.
import { execa } from "execa";
import { describe, expect, it } from "vitest";

const LEAKED_URL = "postgres://leaked:leakedpassword@host:5432/somedb";

async function runDbQuery(args: string[], envOverride: Record<string, string> = {}) {
  return execa("pnpm", ["exec", "tsx", "scripts/db-query.ts", ...args], {
    reject: false,
    env: envOverride,
  });
}

describe("scripts/db-query.ts", () => {
  it("prints rows and exits zero for a single SQL argument", async () => {
    const result = await runDbQuery(["SELECT count(*) AS ingredient_count FROM ingredients;"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("8");
  });

  it("succeeds for a statement that modifies data, leaving seeded row counts unchanged (D-17)", async () => {
    const insertResult = await runDbQuery([
      "INSERT INTO recipes (slug, title, subtitle, base_servings, time_label, effort, base_kcal) VALUES ('scratch-row', 'Scratch', 'Scratch', 1, '1 min', 'Easy', 1);",
    ]);
    expect(insertResult.exitCode).toBe(0);

    const deleteResult = await runDbQuery(["DELETE FROM recipes WHERE slug = 'scratch-row';"]);
    expect(deleteResult.exitCode).toBe(0);

    const countResult = await runDbQuery(["SELECT count(*) AS recipe_count FROM recipes;"]);
    expect(countResult.exitCode).toBe(0);
    expect(countResult.stdout).toContain("1");
  });

  it("exits non-zero with a usage message when given zero arguments", async () => {
    const result = await runDbQuery([]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toLowerCase()).toContain("usage");
  });

  it("exits non-zero when the single argument begins with a hyphen (D-16: no flag surface)", async () => {
    const result = await runDbQuery(["--url=postgres://evil/db"]);
    expect(result.exitCode).not.toBe(0);
  });

  it("exits non-zero when given more than one positional argument", async () => {
    const result = await runDbQuery(["SELECT 1;", "SELECT 2;"]);
    expect(result.exitCode).not.toBe(0);
  });

  it("exits non-zero before opening any connection when a bare DATABASE_URL is set (D-20)", async () => {
    const result = await runDbQuery(["SELECT 1;"], { DATABASE_URL: LEAKED_URL });
    expect(result.exitCode).not.toBe(0);
  });

  it("never prints a connection-string scheme prefix or a password on any path (T-01-18)", async () => {
    const results = await Promise.all([
      runDbQuery(["SELECT 1;"]),
      runDbQuery([]),
      runDbQuery(["--bad"]),
      runDbQuery(["SELECT 1;"], { DATABASE_URL: LEAKED_URL }),
    ]);
    for (const result of results) {
      const combined = `${result.stdout}\n${result.stderr}`;
      expect(combined).not.toContain("postgres://");
      expect(combined).not.toContain("leakedpassword");
    }
  });
});
