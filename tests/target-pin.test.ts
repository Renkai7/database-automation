// End-to-end proof for D-16: every entry point that can reach the development database --
// db-query, the migrate path (drizzle-kit via drizzle.config.ts), and the full db-reset
// pipeline -- refuses a redirected RECIPE_DEV_DATABASE_URL before doing any work, not merely
// at the unit level scripts/env.test.ts already covers.
//
// The load-bearing assertion here is the survival check at the end: after a redirected
// `db:reset` attempt is refused, the real local database must still hold the seeded state.
// That is what distinguishes a guard that fires before the destructive teardown (step 1 of
// db-reset.ts) from one that fires after it -- scripts/env.ts's validation runs at module
// import, before db-reset.ts's `main()` (and therefore its `docker compose down -v` step)
// ever executes.
import { execa } from "execa";
import { describe, expect, it } from "vitest";

// Built at runtime, not as a literal, so this file never contains a real connection-string
// scheme prefix -- the same self-match-avoidance idiom tests/guardrails.test.ts already uses
// for the init-script and direct-sync tokens. This also keeps this file off the guardrail
// suite's fixture allowlists: it does not construct a fixture for scripts/env.ts's own unit
// tests, it exercises the pinned target end-to-end, so it should stay covered by default.
const SCHEME_PREFIX = ["postgres", "://"].join("");
const REDIRECTED_HOST = "not-a-loopback-host.example.com";
const LEAKED_PASSWORD = "leaked-target-pin-password";
const REDIRECTED_URL = `${SCHEME_PREFIX}dev:${LEAKED_PASSWORD}@${REDIRECTED_HOST}:5432/recipe_dev`;

function assertNoLeak(output: string): void {
  expect(output).not.toContain(SCHEME_PREFIX);
  expect(output).not.toContain(LEAKED_PASSWORD);
}

describe("development target pin — end-to-end (D-16)", () => {
  it(
    "refuses db-query when RECIPE_DEV_DATABASE_URL is redirected at a non-loopback host",
    async () => {
      const result = await execa("pnpm", ["exec", "tsx", "scripts/db-query.ts", "SELECT 1;"], {
        reject: false,
        env: { RECIPE_DEV_DATABASE_URL: REDIRECTED_URL },
      });

      expect(result.exitCode).not.toBe(0);
      assertNoLeak(`${result.stdout}\n${result.stderr}`);
    },
    180000,
  );

  it(
    "refuses db:migrate (the gated runner) when RECIPE_DEV_DATABASE_URL is redirected at a non-loopback host",
    async () => {
      const result = await execa("pnpm", ["run", "db:migrate"], {
        reject: false,
        env: { RECIPE_DEV_DATABASE_URL: REDIRECTED_URL },
      });

      expect(result.exitCode).not.toBe(0);
      assertNoLeak(`${result.stdout}\n${result.stderr}`);
    },
    180000,
  );

  it(
    "refuses db-reset when RECIPE_DEV_DATABASE_URL is redirected, and never tears anything down",
    async () => {
      const result = await execa("pnpm", ["run", "db:reset"], {
        reject: false,
        env: { RECIPE_DEV_DATABASE_URL: REDIRECTED_URL },
      });

      expect(result.exitCode).not.toBe(0);
      assertNoLeak(`${result.stdout}\n${result.stderr}`);

      // Load-bearing: the container and its seeded data must have survived. If the rejection
      // fired after step 1's `docker compose down -v` instead of before it, this query would
      // fail outright or return a freshly-migrated-but-unseeded database.
      const survivalCheck = await execa(
        "pnpm",
        ["db:query", "SELECT count(*) AS ingredient_count FROM ingredients;"],
        { reject: false },
      );

      expect(survivalCheck.exitCode).toBe(0);
      expect(survivalCheck.stdout).toContain("8");
    },
    180000,
  );
});
