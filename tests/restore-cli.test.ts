// D-06/BKP-05 (02-CONTEXT.md): extends tests/target-pin.test.ts's end-to-end proof to this
// phase's commands. `pnpm db:restore`, `pnpm db:restore:cluster`, and `pnpm db:backup` must all
// refuse a redirected RECIPE_DEV_DATABASE_URL before doing any work -- the guard runs at
// scripts/env.ts's module-load time, before any of these scripts' own main() ever executes, so
// this proves the guard fires before any destructive step, not merely that the command
// eventually errors.
//
// The load-bearing assertion, matching tests/target-pin.test.ts's own precedent, is the
// survival check at the end of each case: after a redirected attempt is refused, the real local
// development database must still hold its seeded row count. That is what distinguishes a guard
// that fires before any write from one that fires after it.
import { execa } from "execa";
import { describe, expect, it } from "vitest";

// Built at runtime, not as a literal -- the same self-match-avoidance idiom
// tests/target-pin.test.ts and tests/guardrails.test.ts already use. This also keeps this file
// off tests/guardrails.test.ts's fixture allowlists: it never constructs a fixture connection
// string as a literal substring, and it never reads the development connection variable
// directly off the process environment -- it only sets it in a child process's own environment,
// the same shape tests/target-pin.test.ts already uses.
const SCHEME_PREFIX = ["postgres", "://"].join("");
const REDIRECTED_HOST = "not-a-loopback-host.example.com";
const LEAKED_PASSWORD = "leaked-restore-cli-password";
const REDIRECTED_URL = `${SCHEME_PREFIX}dev:${LEAKED_PASSWORD}@${REDIRECTED_HOST}:5432/recipe_dev`;

function assertNoLeak(output: string): void {
  expect(output).not.toContain(SCHEME_PREFIX);
  expect(output).not.toContain(LEAKED_PASSWORD);
}

/**
 * The load-bearing survival check: queries the real local development database's seeded
 * ingredient count through the existing db:query CLI, the same tool
 * tests/target-pin.test.ts's own survival check already uses. A real row count, not merely a
 * successful process exit, is what proves the refused command never touched the database.
 */
async function assertSeededStateIntact(): Promise<void> {
  const survivalCheck = await execa(
    "pnpm",
    ["db:query", "SELECT count(*) AS ingredient_count FROM ingredients;"],
    { reject: false },
  );
  expect(survivalCheck.exitCode).toBe(0);
  expect(survivalCheck.stdout).toContain("8");
}

describe("restore commands refuse a redirected target end-to-end (D-06, BKP-05)", () => {
  it(
    "refuses pnpm db:backup when RECIPE_DEV_DATABASE_URL is redirected, and the local database is unchanged",
    async () => {
      const result = await execa("pnpm", ["run", "db:backup"], {
        reject: false,
        env: { RECIPE_DEV_DATABASE_URL: REDIRECTED_URL },
      });

      expect(result.exitCode).not.toBe(0);
      assertNoLeak(`${result.stdout}\n${result.stderr}`);
      await assertSeededStateIntact();
    },
    180000,
  );

  it(
    "refuses pnpm db:restore when RECIPE_DEV_DATABASE_URL is redirected, and the local database is unchanged",
    async () => {
      const result = await execa("pnpm", ["run", "db:restore"], {
        reject: false,
        env: { RECIPE_DEV_DATABASE_URL: REDIRECTED_URL },
      });

      expect(result.exitCode).not.toBe(0);
      assertNoLeak(`${result.stdout}\n${result.stderr}`);
      await assertSeededStateIntact();
    },
    180000,
  );

  it(
    "refuses pnpm db:restore:cluster when RECIPE_DEV_DATABASE_URL is redirected, and the local database is unchanged",
    async () => {
      const result = await execa("pnpm", ["run", "db:restore:cluster"], {
        reject: false,
        env: { RECIPE_DEV_DATABASE_URL: REDIRECTED_URL },
      });

      expect(result.exitCode).not.toBe(0);
      assertNoLeak(`${result.stdout}\n${result.stderr}`);
      await assertSeededStateIntact();
    },
    180000,
  );
});
