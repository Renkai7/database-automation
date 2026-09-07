// Covers scripts/env.ts's three failure states: a bare DATABASE_URL present (D-20), a
// missing RECIPE_DEV_DATABASE_URL (ENV-03), and a current_database() marker mismatch
// (D-21). Each case imports the module fresh via vi.resetModules() + a dynamic import,
// because the module's checks run at import time by design — this is the fail-fast shape
// D-20 requires, and it is also why every process independently re-validates rather than
// inheriting another process's result.
//
// dotenv is mocked so the real workspace-root .env file (which does have
// RECIPE_DEV_DATABASE_URL set, for the app's own local development) never leaks into a test
// case that is specifically exercising the "variable absent" path.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryableClient } from "./env";

vi.mock("dotenv", () => ({
  default: { config: vi.fn() },
}));

const CONTROLLED_KEYS = ["DATABASE_URL", "RECIPE_DEV_DATABASE_URL"] as const;
let savedEnv: Partial<Record<(typeof CONTROLLED_KEYS)[number], string>>;

beforeEach(() => {
  savedEnv = {};
  for (const key of CONTROLLED_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  vi.resetModules();
});

afterEach(() => {
  for (const key of CONTROLLED_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
});

describe("scripts/env.ts — bare DATABASE_URL rejection (D-20)", () => {
  it("throws when a bare DATABASE_URL is present, and the message names RECIPE_DEV_DATABASE_URL", async () => {
    process.env.DATABASE_URL = "postgres://leaked:leakedpassword@host:5432/somedb";

    await expect(import("./env")).rejects.toThrow(/RECIPE_DEV_DATABASE_URL/);
  });

  it("throws even when RECIPE_DEV_DATABASE_URL is also correctly set", async () => {
    process.env.DATABASE_URL = "postgres://leaked:leakedpassword@host:5432/somedb";
    process.env.RECIPE_DEV_DATABASE_URL = "postgres://dev:devpass@localhost:5432/recipe_dev";

    await expect(import("./env")).rejects.toThrow(/RECIPE_DEV_DATABASE_URL/);
  });

  it("never includes postgres://, a password, or the connection string value in the thrown message", async () => {
    const secretUrl = "postgres://leaked:leakedpassword@host:5432/somedb";
    process.env.DATABASE_URL = secretUrl;
    process.env.RECIPE_DEV_DATABASE_URL = "postgres://dev:devpass@localhost:5432/recipe_dev";

    let message = "";
    try {
      await import("./env");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).not.toBe("");
    expect(message).not.toContain("postgres://");
    expect(message).not.toContain("leakedpassword");
    expect(message).not.toContain(secretUrl);
  });
});

describe("scripts/env.ts — missing RECIPE_DEV_DATABASE_URL", () => {
  it("throws a zod validation error naming RECIPE_DEV_DATABASE_URL when it is not set at all", async () => {
    await expect(import("./env")).rejects.toThrow(/RECIPE_DEV_DATABASE_URL/);
  });
});

describe("scripts/env.ts — assertDevelopmentDatabase (D-21)", () => {
  function stubClient(name: string): QueryableClient {
    return {
      query: vi.fn().mockResolvedValue({ rows: [{ name }] }),
    };
  }

  it("resolves without throwing when the client reports the expected database name", async () => {
    process.env.RECIPE_DEV_DATABASE_URL = "postgres://dev:devpass@localhost:5432/recipe_dev";
    const { assertDevelopmentDatabase } = await import("./env");

    await expect(assertDevelopmentDatabase(stubClient("recipe_dev"))).resolves.toBeUndefined();
  });

  it("throws when the client reports a different database name, and the message names both", async () => {
    process.env.RECIPE_DEV_DATABASE_URL = "postgres://dev:devpass@localhost:5432/recipe_dev";
    const { assertDevelopmentDatabase, EXPECTED_DEV_DATABASE_NAME } = await import("./env");

    await expect(assertDevelopmentDatabase(stubClient("recipe_prod"))).rejects.toThrow(
      /recipe_prod/,
    );
    // Re-run to inspect the message directly for both names, since two separate matchers
    // against the same throw would require catching it once.
    try {
      await assertDevelopmentDatabase(stubClient("recipe_prod"));
      throw new Error("expected assertDevelopmentDatabase to throw");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("recipe_prod");
      expect(message).toContain(EXPECTED_DEV_DATABASE_NAME);
    }
  });

  it("never includes postgres://, a password, or a connection string in the mismatch message", async () => {
    process.env.RECIPE_DEV_DATABASE_URL = "postgres://dev:devpass@localhost:5432/recipe_dev";
    const { assertDevelopmentDatabase } = await import("./env");

    let message = "";
    try {
      await assertDevelopmentDatabase(stubClient("recipe_prod"));
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).not.toBe("");
    expect(message).not.toContain("postgres://");
    expect(message).not.toContain("devpass");
  });
});
