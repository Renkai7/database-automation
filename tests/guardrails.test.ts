// A cheap, Docker-free suite whose only job is to fail when one of Phase 1's structural
// constraints regresses (CLAUDE.md: "prefer architectural enforcement over remembered
// caution"). Every assertion is a pure file read against files enumerated via `git ls-files`
// — this suite must run with no Docker daemon and no database reachable.
//
// Scoping note on assertions 4 and 7 (WR-01: narrowed, not silently dropped). Both scan the
// whole "source surface" for a pattern that a handful of this project's OWN test fixtures
// legitimately also contain -- a fixture connection-string literal, or a direct read of the
// development connection variable as test setup for scripts/env.ts itself. Taken with no
// exception those two checks would flag exactly the fixtures they were never meant to catch.
// The fix is two narrow, explicitly enumerated allowlists (FIXTURE_FILES_WITH_CONNECTION_STRINGS
// and FIXTURE_FILES_READING_DEV_CONNECTION_VARIABLE below) rather than the blanket "any file
// matching *.test.ts" exemption this suite used to carry -- a newly added test file is now
// covered by these two checks by default, not exempt by default. Adding an entry to either
// list is a deliberate, reviewable decision, not routine maintenance.
import { execa } from "execa";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ALLOWED_ROOT_FILES = ["package.json", "docker-compose.yml", ".env.example"];

// WR-01: the only files that genuinely need to be exempt from the connection-string-prefix
// check (assertion 4 below) -- each constructs a fixture connection string, or asserts one is
// absent from output, for a reason unrelated to the leaked-credential/bypass anti-pattern that
// check exists to catch. Derived by reading each file, not assumed.
const FIXTURE_FILES_WITH_CONNECTION_STRINGS = [
  "scripts/env.test.ts",
  "tests/db-query.test.ts",
  "tests/db-reset.test.ts",
];

// WR-01: the only files that genuinely need to be exempt from the direct-env-read check
// (assertion 7 below) -- scripts/env.test.ts sets the development connection variable directly
// as test setup for scripts/env.ts's own behavior, which is testing the shared module, not
// bypassing it. This is a separate, narrower list from the one above: the two checks exempt
// different files for different reasons, and collapsing them into one shared list would
// silently re-widen whichever check has the smaller genuine need.
const FIXTURE_FILES_READING_DEV_CONNECTION_VARIABLE = ["scripts/env.test.ts"];

// Built at runtime, not as a literal, so this check's own needle never appears in this file's
// source as a literal substring -- matching the init-script and direct-sync tokens below. This
// is what keeps this file passing against its own assertion once the blanket *.test.ts
// exemption is gone (this file is deliberately not a member of either allowlist above).
const CONNECTION_STRING_SCHEME_PREFIX = ["postgres", "://"].join("");

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

  it("only .env.example and the enumerated fixture files carry a PostgreSQL connection-string scheme prefix (D-19, WR-01)", async () => {
    // WR-01: excludes only the explicitly enumerated fixture allowlist, not every *.test.ts
    // file -- a new test file is covered by this check by default.
    const files = (await sourceSurfaceFiles()).filter(
      (file) => !FIXTURE_FILES_WITH_CONNECTION_STRINGS.includes(file),
    );
    const offenders = files.filter((file) => {
      if (file === ".env.example") return false;
      return readFileSync(file, "utf-8").includes(CONNECTION_STRING_SCHEME_PREFIX);
    });
    expect(
      offenders,
      `D-19/WR-01: no committed file other than .env.example or an enumerated fixture may ` +
        `contain a ${CONNECTION_STRING_SCHEME_PREFIX} connection-string prefix`,
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

  it("no file outside scripts/env.ts and the enumerated fixture reads the dev connection variable directly (ENV-03, WR-01)", async () => {
    // WR-01: excludes only the explicitly enumerated fixture allowlist above, not every
    // *.test.ts file -- a new test file is covered by this check by default. The needle is
    // built at runtime (matching the direct read expression the shared env module's own
    // consumers must never write) rather than as a literal, so this file's own source does not
    // contain the exact expression it searches for.
    const target = ["process.env.", "RECIPE_DEV_DATABASE_URL"].join("");
    const files = (await sourceSurfaceFiles()).filter(
      (file) =>
        file !== "scripts/env.ts" &&
        !FIXTURE_FILES_READING_DEV_CONNECTION_VARIABLE.includes(file),
    );
    const offenders = files.filter((file) => readFileSync(file, "utf-8").includes(target));
    expect(
      offenders,
      "ENV-03/WR-01: every file that opens a database connection must import scripts/env.ts's shared accessors rather than reading the connection variable directly",
    ).toEqual([]);
  });

  it("scripts/env.ts still pins the development target in source, host/port/name (D-16)", () => {
    const content = readFileSync("scripts/env.ts", "utf-8");
    for (const symbol of [
      "DEV_DATABASE_HOST_ALLOWLIST",
      "EXPECTED_DEV_DATABASE_PORT",
      "EXPECTED_DEV_DATABASE_NAME",
      "assertLocalDevelopmentTarget",
    ]) {
      expect(
        content,
        `D-16 (01-VERIFICATION.md gap: failed truth #6): scripts/env.ts must still define or ` +
          `reference "${symbol}" -- this is part of the source-level development target pin; ` +
          "removing it silently reopens the gap a .env edit could redirect any tool in this " +
          "workspace at another database.",
      ).toContain(symbol);
    }

    // Non-greedy up to "] as const" rather than a bracket-depth-blind `[^\]]*` -- the allowlist
    // itself contains a bracketed IPv6 literal ("[::1]"), whose own closing bracket would
    // otherwise truncate the match before the array's real closing bracket.
    const allowlistMatch = content.match(/DEV_DATABASE_HOST_ALLOWLIST\s*=\s*(\[[\s\S]*?\])\s*as const/);
    expect(
      allowlistMatch,
      "D-16: could not locate the DEV_DATABASE_HOST_ALLOWLIST array literal in scripts/env.ts",
    ).not.toBeNull();
    const hosts = [...allowlistMatch![1].matchAll(/"([^"]+)"/g)].map((match) => match[1]).sort();
    expect(
      hosts,
      "D-16: the pinned host allowlist must contain exactly the four loopback spellings " +
        "(dotted-quad, named, and both IPv6 loopback spellings) and no other host",
    ).toEqual(["127.0.0.1", "::1", "[::1]", "localhost"].sort());
  });

  it("no Phase 2 command script reads process.argv, stdin, or an interactive prompt library (D-06)", () => {
    // 02-03-PLAN.md Task 3: makes "no command in this phase can be pointed at another database"
    // permanent rather than plan-time -- a command that accepts an argument is the command that
    // later accepts a target. Needles are built at runtime, matching this file's own convention
    // (CONNECTION_STRING_SCHEME_PREFIX above), so this assertion's own source never contains the
    // literal expressions it searches for.
    const phase2CommandScripts = [
      "scripts/backup.ts",
      "scripts/restore.ts",
      "scripts/restore-cluster.ts",
      "scripts/drill.ts",
    ];
    const argvNeedle = ["process", ".argv"].join("");
    const stdinNeedle = ["process", ".stdin"].join("");
    const promptLibraries = ["readline", "prompts", "inquirer"];

    for (const file of phase2CommandScripts) {
      // Comment-only lines removed before scanning, so a doc comment describing this very
      // constraint (as this file's own comments do) cannot trip the check it is documenting.
      const content = readFileSync(file, "utf-8")
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");

      expect(
        content,
        `D-06: "${file}" must not reference "${argvNeedle}" -- a command that accepts an ` +
          "argument is the command that later accepts a target",
      ).not.toContain(argvNeedle);

      expect(
        content,
        `D-06: "${file}" must not reference "${stdinNeedle}" -- a command that accepts an ` +
          "argument is the command that later accepts a target",
      ).not.toContain(stdinNeedle);

      for (const lib of promptLibraries) {
        expect(
          content,
          `D-06: "${file}" must not reference "${lib}" -- a command that accepts an argument ` +
            "is the command that later accepts a target",
        ).not.toContain(lib);
      }
    }
  });

  it("apps/recipe-app/drizzle.config.ts calls the shared target assertion (D-16, closes the PARTIAL key link)", () => {
    const content = readFileSync("apps/recipe-app/drizzle.config.ts", "utf-8");
    expect(
      content,
      "D-16 (01-VERIFICATION.md key link, recorded PARTIAL): apps/recipe-app/drizzle.config.ts " +
        "must call assertLocalDevelopmentTarget -- otherwise the migrate/generate path, the " +
        "single most destructive command in the pipeline, inherits no guard from the shared " +
        "env module at all.",
    ).toContain("assertLocalDevelopmentTarget");
  });
});
