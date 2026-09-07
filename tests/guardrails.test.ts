// A cheap, Docker-free suite whose only job is to fail when one of Phase 1's structural
// constraints regresses (CLAUDE.md: "prefer architectural enforcement over remembered
// caution"). Every assertion is a pure file read against files enumerated via `git ls-files`
// — this suite must run with no Docker daemon and no database reachable.
//
// Scoping note on assertions 4 and 7 (documented, not silently narrowed): both are stated in
// the plan as scanning the whole "source surface" for a literal substring. Taken completely
// literally they would flag this project's OWN pre-existing, legitimate test fixtures --
// scripts/env.test.ts (and this plan's own db-query.test.ts) construct fake
// "postgres://user:pass@host/db"-shaped strings and set process.env.RECIPE_DEV_DATABASE_URL
// directly specifically to exercise scripts/env.ts's own rejection/assertion behavior. That is
// the opposite of the anti-pattern these two checks exist to catch (a real credential or a
// bypass of the shared module in PRODUCTION code). Both checks are therefore scoped to
// non-test files (anything not matching *.test.ts) in the source surface -- see the two
// `it()` blocks below for the exact reasoning inline.
import { execa } from "execa";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ALLOWED_ROOT_FILES = ["package.json", "docker-compose.yml", ".env.example"];

async function sourceSurfaceFiles(): Promise<string[]> {
  const { stdout } = await execa("git", ["ls-files"]);
  return stdout
    .split("\n")
    .filter(Boolean)
    .filter((file) => {
      if (ALLOWED_ROOT_FILES.includes(file)) return true;
      if (file.startsWith("scripts/")) return true;
      if (file.startsWith("tests/")) return true;
      if (file.startsWith("apps/recipe-app/") && !file.startsWith("apps/recipe-app/design/")) {
        return true;
      }
      // Deliberately excluded: .planning/ and docs/ are prose ABOUT these constraints and
      // would otherwise match every assertion below that they describe.
      return false;
    });
}

describe("structural guardrails", () => {
  it("docker-compose.yml publishes the database port on loopback only, never all-interfaces (D-18)", () => {
    const compose = readFileSync("docker-compose.yml", "utf-8");
    expect(
      compose,
      "D-18: the database port must be published with 127.0.0.1 as the host component",
    ).toMatch(/127\.0\.0\.1:\d+:\d+/);
    expect(
      compose,
      "D-18: docker-compose.yml must never bind the database port to all interfaces (0.0.0.0)",
    ).not.toContain("0.0.0.0");
  });

  it("docker-compose.yml contains no container init-script mount (D-14)", () => {
    const compose = readFileSync("docker-compose.yml", "utf-8");
    // Built at runtime, not as a literal, purely as a matching habit consistent with the
    // drizzle-kit-push check below -- this exact token also appears nowhere in this repo
    // today, literal or otherwise.
    const initScriptToken = ["docker-entrypoint-", "initdb.d"].join("");
    expect(
      compose,
      "D-14: schema state must arrive only via a Drizzle migration, never a container-startup init-script mount",
    ).not.toContain(initScriptToken);
  });

  it("no file in the source surface references drizzle-kit's direct-sync sub-command (D-11/Pitfall 3)", async () => {
    // Concatenated at runtime so this test file's own source never contains the forbidden
    // two-token string -- otherwise, since tests/ is itself part of the source surface, this
    // assertion would match its own describing text.
    const forbidden = ["drizzle-kit", "push"].join(" ");
    const files = await sourceSurfaceFiles();
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      expect(
        content,
        `D-11/Pitfall 3: "${file}" must not reference "${forbidden}" -- generate+migrate is the only committed loop, push has no SQL artifact and no journal entry`,
      ).not.toContain(forbidden);
    }
  });

  it("only .env.example carries a PostgreSQL connection-string scheme prefix among non-test source files (D-19)", async () => {
    // Excludes *.test.ts: fixture files that deliberately construct fake connection-string
    // literals to test scripts/env.ts's own bare-DATABASE_URL rejection are not the leaked-
    // credential anti-pattern this check exists to catch.
    const files = (await sourceSurfaceFiles()).filter((file) => !file.endsWith(".test.ts"));
    const offenders = files.filter((file) => {
      if (file === ".env.example") return false;
      return readFileSync(file, "utf-8").includes("postgres://");
    });
    expect(
      offenders,
      "D-19: no committed non-test source file other than .env.example may contain a postgres:// connection-string prefix",
    ).toEqual([]);

    const envExample = readFileSync(".env.example", "utf-8");
    expect(
      envExample,
      ".env.example's connection string must be a placeholder, never a working credential",
    ).toContain("PLACEHOLDER");
  });

  it("scripts/db-query.ts never reads process.env directly (D-16)", () => {
    const content = readFileSync("scripts/db-query.ts", "utf-8");
    expect(
      content,
      "D-16: db-query.ts's target must come only from the shared env module, never a direct process.env read",
    ).not.toContain("process.env");
  });

  it("scripts/db-reset.ts takes no interactive input (D-24)", () => {
    const content = readFileSync("scripts/db-reset.ts", "utf-8");
    for (const forbidden of ["readline", "prompts", "inquirer"]) {
      expect(
        content,
        `D-24: db-reset.ts must not import "${forbidden}" -- the environment assertion is the guard, not a prompt`,
      ).not.toContain(forbidden);
    }
    expect(content, "D-24: db-reset.ts must not read from stdin").not.toContain("process.stdin");
  });

  it("no non-test file outside scripts/env.ts reads the dev connection variable directly (ENV-03)", async () => {
    // Excludes *.test.ts for the same reason as the connection-string-prefix check above:
    // scripts/env.test.ts legitimately sets process.env.RECIPE_DEV_DATABASE_URL directly as
    // test setup for scripts/env.ts itself -- that is testing the shared module, not
    // bypassing it. Matches the literal `process.env.RECIPE_DEV_DATABASE_URL` read pattern
    // rather than a bare mention of the variable name, so a comment or .env.example's own
    // documented variable name (its whole purpose) does not false-positive.
    const target = ["process.env.", "RECIPE_DEV_DATABASE_URL"].join("");
    const files = (await sourceSurfaceFiles()).filter(
      (file) => file !== "scripts/env.ts" && !file.endsWith(".test.ts"),
    );
    const offenders = files.filter((file) => readFileSync(file, "utf-8").includes(target));
    expect(
      offenders,
      "ENV-03: every file that opens a database connection must import scripts/env.ts's shared accessors rather than reading the connection variable directly",
    ).toEqual([]);
  });
});
