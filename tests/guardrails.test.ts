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
import { posix as posixPath } from "node:path";
import { describe, expect, it } from "vitest";
import { loadRules, RulesFileError } from "../packages/automation/src/index";

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

// KNOWN_PACKAGE_BOUNDARY_ESCAPES is an inventory of known debt, not an exemption list -- unlike
// the two allowlists above, no file listed here is excused from anything. It is compared by
// exact equality in both directions (see the guardrail test near D-28 below), so it fails on a
// growth (a new key, or a longer array for an existing key) AND on an un-recorded shrink (a key
// silently dropped without editing this constant). Entries may only be REMOVED: removing one is
// the intended end state as Phase 7's package extraction (PLAT-01) closes these sites one at a
// time. Adding an entry is a deliberate architectural decision requiring a docs/decisions.md
// record (see D25), never routine maintenance -- the same bar 03-REVIEW's own finding (WR-04
// lineage) held this file to elsewhere. The four entries below are attributed to
// .planning/v1-MILESTONE-AUDIT.md's single recorded integration defect and to 03-REVIEW-WR-03.
const KNOWN_PACKAGE_BOUNDARY_ESCAPES: Readonly<Record<string, readonly string[]>> = {
  "packages/automation/src/cli.ts": ["../../../scripts/log"],
  "packages/automation/src/inspector/inspect.ts": ["../../../../scripts/log"],
  "packages/automation/src/inspector/inspect-plpgsql.ts": ["../../../../scripts/log"],
  "packages/automation/src/runner/run-migrations.ts": ["../../../../scripts/log"],
};

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
      // 03-07-PLAN.md Task 3: packages/ did not exist when this enumeration was written, so it
      // was never in scope -- an oversight, not a deliberate exclusion like .planning/ and
      // docs/ below. Phase 7's planned extraction of packages/automation into its own published
      // package makes an uncovered package directory more of a problem over time, not less: the
      // connection-string, direct-sync, and direct-environment-read checks below should cover
      // this source the same way they cover scripts/ and tests/.
      if (file.startsWith("packages/")) return true;
      // Deliberately excluded: .planning/ and docs/ are prose ABOUT these constraints and
      // would otherwise match every assertion below that they describe.
      return false;
    });
}

// The single source of truth for "inside the extractable package" used by both the detector
// below and the frozen debt inventory further down -- defined once so the two cannot drift
// apart. No trailing slash: containment is tested against `${AUTOMATION_PACKAGE_ROOT}/` below,
// never against a bare prefix, so a sibling directory that merely starts with the same
// characters (e.g. a hypothetical "packages/automation-legacy") cannot be mistaken for a child.
const AUTOMATION_PACKAGE_ROOT = "packages/automation";

// Captures the quoted specifier following any of the four import positions used in this
// codebase: an import/export from-clause ("from ..."), a bare side-effect import
// ("import ..."), a dynamic import call ("import(...)"), and a require call ("require(...)").
// Group 1 is the opening quote character, group 2 is the specifier itself, matched with a
// negative-lookahead run so a specifier containing the other quote character (rare, but not
// impossible) does not truncate the match early.
const IMPORT_SPECIFIER_PATTERN = /\b(?:from|import|require)\b\s*\(?\s*(['"])((?:(?!\1).)*)\1/g;

/**
 * Reports every relative import specifier in `source` (a file whose repo-root-relative path is
 * `filePath`) that resolves outside `packages/automation/` -- the invariant this enforces is "a
 * module in this package resolves only to modules in this package," and it is deliberately
 * general: reaching into the repo-root `scripts/` directory is the instance that exists today,
 * not the rule, so an escape into `apps/` or `drizzle/` instead is caught the same way.
 *
 * `filePath` must be a repo-root-relative, forward-slash path exactly as `git ls-files` emits.
 * Development happens on Windows, so the resolution below uses `node:path`'s POSIX API
 * explicitly rather than the platform-default API, which would otherwise compare
 * backslash-separated and slash-separated paths incorrectly.
 *
 * Returned in source order, duplicates preserved -- this reports occurrences, not a set, so two
 * escaping imports in one file are visible as two entries rather than collapsed to one.
 */
function escapingRelativeImports(filePath: string, source: string): string[] {
  // Drop any line whose trimmed form begins with a line-comment marker, a block-comment
  // opener, or a bare JSDoc/block continuation star -- extends the comment-stripping idiom
  // already used elsewhere in this file (D-06, D-20/D-21) to also cover block-comment shapes,
  // so a header comment describing this very constraint (as this file's own comments do)
  // cannot trip the check that enforces it. Only the line's LEADING characters are tested, so
  // a trailing comment on a real import line does not hide that import (T-QUICK-03).
  const codeOnly = source
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !(trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*"));
    })
    .join("\n");

  const dir = posixPath.dirname(filePath);
  const escapes: string[] = [];

  for (const match of codeOnly.matchAll(IMPORT_SPECIFIER_PATTERN)) {
    const specifier = match[2];
    // Bare package specifiers (e.g. "libpg-query", "node:fs") are not relative imports and
    // cannot escape a filesystem boundary they never crossed in the first place.
    if (!specifier.startsWith(".")) continue;

    const resolved = posixPath.normalize(posixPath.join(dir, specifier));
    const isInsidePackageRoot =
      resolved === AUTOMATION_PACKAGE_ROOT || resolved.startsWith(`${AUTOMATION_PACKAGE_ROOT}/`);
    if (!isInsidePackageRoot) {
      escapes.push(specifier);
    }
  }

  return escapes;
}

// 05-07-PLAN.md Task 2: a synthetic-but-schema-valid rules file that correctly protects every
// D-02/D-07/D-17 floor operation -- the "known good" baseline both weakened-rules-file tests
// below start from, so each test deviates from a genuinely floor-safe starting point by exactly
// one change, isolating which self-check (assertFloorNotWeakened vs assertUnmatchedDefaultsToReview)
// each test actually proves. Held only in memory; never read from or written to disk. The
// `disarms-timeout-guc`-shaped rule below matches on `disarmsTimeout` alone (never statementKind),
// which is what makes it cover all four D17_FLOOR_FACTS entries (SetGuc, AlterSystem,
// AlterDatabaseSet, AlterRoleSet) with one rule, exactly as the real rules.json does.
function floorSafeSyntheticRules(): Array<Record<string, unknown>> {
  return [
    { id: "drop-table", category: "irreversible-data-loss", match: { statementKind: "DropTable" }, verdict: "BLOCKED", rationale: "synthetic" },
    { id: "drop-schema", category: "irreversible-data-loss", match: { statementKind: "DropSchema" }, verdict: "BLOCKED", rationale: "synthetic" },
    { id: "drop-database", category: "irreversible-data-loss", match: { statementKind: "DropDatabase" }, verdict: "BLOCKED", rationale: "synthetic" },
    { id: "truncate", category: "irreversible-data-loss", match: { statementKind: "Truncate" }, verdict: "BLOCKED", rationale: "synthetic" },
    { id: "drop-column", category: "irreversible-data-loss", match: { statementKind: "DropColumn" }, verdict: "BLOCKED", rationale: "synthetic" },
    { id: "delete-without-where", category: "irreversible-data-loss", match: { statementKind: "Delete", hasWhereClause: false }, verdict: "BLOCKED", rationale: "synthetic" },
    { id: "update-without-where", category: "irreversible-data-loss", match: { statementKind: "Update", hasWhereClause: false }, verdict: "BLOCKED", rationale: "synthetic" },
    { id: "unresolvable-dynamic-sql", category: "analyzer-integrity", match: { statementKind: "ExecuteDynamic", dynamicSqlUnresolved: true }, verdict: "BLOCKED", rationale: "synthetic" },
    { id: "disarms-timeout-guc", category: "analyzer-integrity", match: { disarmsTimeout: true }, verdict: "BLOCKED", rationale: "synthetic" },
  ];
}

/** Calls `fn`, returning the thrown value (or `null` if it did not throw) rather than letting a
 * caller wrap every assertion below in its own try/catch. */
function captureThrown(fn: () => unknown): unknown {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
}

describe("structural guardrails", () => {
  it("sourceSurfaceFiles() actually enumerates packages/ (and the other claimed roots), so the D-11/Pitfall 3 checks below cannot pass vacuously (03-07-PLAN.md Task 3)", async () => {
    // 03-VALIDATION.md's last row: a `--reporter verbose` run only prints test NAMES, never the
    // enumerated file list, so nothing previously pinned that `packages/` (or `scripts/`,
    // `tests/`, `apps/recipe-app/`) genuinely yields files -- a renamed directory, a gitignore
    // change, or a reverted line would make every source-surface check below pass vacuously
    // while looking identical under --reporter verbose. This assertion makes the claim a real
    // check instead of something a human is asked to eyeball.
    const files = await sourceSurfaceFiles();

    const packagesFiles = files.filter((file) => file.startsWith("packages/"));
    expect(
      packagesFiles.length,
      "D-11/Pitfall 3 (03-07-PLAN.md Task 3): sourceSurfaceFiles() must actually enumerate at " +
        "least one file under \"packages/\" -- if it ever enumerates zero, every " +
        "connection-string/direct-sync/direct-environment-read check that claims to cover " +
        "packages/ would pass having examined nothing.",
    ).toBeGreaterThan(0);

    for (const root of ["scripts/", "tests/", "apps/recipe-app/", ".github/"]) {
      const rootFiles = files.filter((file) => file.startsWith(root));
      expect(
        rootFiles.length,
        `sourceSurfaceFiles() must actually enumerate at least one file under "${root}" -- an ` +
          "enumeration that silently yields nothing for a claimed root makes every check that " +
          "relies on it pass vacuously.",
      ).toBeGreaterThan(0);
    }
  });

  it("escapingRelativeImports() detects package-boundary escapes on synthetic input only -- never a real source file (WR-04)", () => {
    // Synthetic in-memory strings throughout. A prior review finding (WR-04) rejected a test
    // that mutated shipped data on disk to prove a detector non-vacuous; this test proves the
    // same property against strings that are never written, read, or touched on the real
    // filesystem.

    // Escaping import in a nested file resolves and is reported.
    expect(
      escapingRelativeImports(
        "packages/automation/src/x.ts",
        'import { safeErrorMessage } from "../../../scripts/log";',
      ),
      "a relative import three levels up from packages/automation/src/x.ts escapes the package " +
        "and must be reported, verbatim, as a one-element array",
    ).toEqual(["../../../scripts/log"]);

    // Deeper nesting is handled by real path math, not by counting dot-dot segments: the same
    // logical import written with one more level up, from a file one directory deeper.
    expect(
      escapingRelativeImports(
        "packages/automation/src/inspector/y.ts",
        'import { safeErrorMessage } from "../../../../scripts/log";',
      ),
      "the same logical escape, one directory deeper and one dot-dot segment longer, must " +
        "still resolve outside the package root and be reported",
    ).toEqual(["../../../../scripts/log"]);

    // In-package relative imports are NOT reported.
    expect(
      escapingRelativeImports(
        "packages/automation/src/inspector/z.ts",
        [
          'import { a } from "./sibling";',
          'import { b } from "../classifier/thing";',
        ].join("\n"),
      ),
      "imports that resolve inside packages/automation/ must never be reported, regardless of " +
        "how many dot-dot segments they use",
    ).toEqual([]);

    // Bare package specifiers are NOT reported.
    expect(
      escapingRelativeImports(
        "packages/automation/src/x.ts",
        ['import { parse } from "libpg-query";', 'import { readFile } from "node:fs";'].join(
          "\n",
        ),
      ),
      "bare package specifiers are not relative imports and cannot escape a filesystem " +
        "boundary they never crossed",
    ).toEqual([]);

    // Comment-only lines are NOT reported, across all three comment shapes this file's own
    // header comments use.
    expect(
      escapingRelativeImports(
        "packages/automation/src/x.ts",
        [
          '// import { safeErrorMessage } from "../../../scripts/log";',
          '/* import { safeErrorMessage } from "../../../scripts/log"; */',
          ' * import { safeErrorMessage } from "../../../scripts/log";',
        ].join("\n"),
      ),
      "a matching import inside a line-comment, a block-comment opener, or a bare JSDoc " +
        "continuation star must not be reported -- a header comment describing this very " +
        "constraint must not trip the check that enforces it",
    ).toEqual([]);

    // Two escaping imports in one source yield a two-element array -- occurrences, not a set.
    expect(
      escapingRelativeImports(
        "packages/automation/src/x.ts",
        [
          'import { safeErrorMessage } from "../../../scripts/log";',
          'import { other } from "../../../scripts/other";',
        ].join("\n"),
      ),
      "two distinct escaping imports in one file must both be reported, as two entries, not " +
        "collapsed to one",
    ).toEqual(["../../../scripts/log", "../../../scripts/other"]);
  });

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

  it("no command script reads process.argv, stdin, or an interactive prompt library (D-06)", () => {
    // 02-03-PLAN.md Task 3: makes "no command in this phase can be pointed at another database"
    // permanent rather than plan-time -- a command that accepts an argument is the command that
    // later accepts a target. Needles are built at runtime, matching this file's own convention
    // (CONNECTION_STRING_SCHEME_PREFIX above), so this assertion's own source never contains the
    // literal expressions it searches for. Widened beyond Phase 2 (04-05-PLAN.md Task 2) to cover
    // `scripts/db-migrate-recover.ts` too -- the same no-target rule applies to every command
    // script in this repository, not just the ones Phase 2 happened to introduce first.
    const commandScripts = [
      "scripts/backup.ts",
      "scripts/restore.ts",
      "scripts/restore-cluster.ts",
      "scripts/drill.ts",
      "scripts/db-migrate-recover.ts",
    ];
    const argvNeedle = ["process", ".argv"].join("");
    const stdinNeedle = ["process", ".stdin"].join("");
    const promptLibraries = ["readline", "prompts", "inquirer"];

    for (const file of commandScripts) {
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

  it("scripts/db-migrate-recover.ts never touches _journal.json, never issues DROP INDEX, and never forces process.exit (D-20/D-21)", () => {
    // Needles built at runtime, matching this file's own convention, so this test's own source
    // never contains the literal expressions it searches for. Comment-only lines removed first,
    // same as the test above, so this file's own module-comment prose describing exactly these
    // three constraints (D-20/D-21's "never edits _journal.json", "never drops an index", "never
    // forces a synchronous process exit") cannot trip the check that proves the code holds them.
    const journalNeedle = ["_journal", ".json"].join("");
    const dropIndexNeedle = ["DROP", " INDEX"].join(" ");
    const exitNeedle = ["process", ".exit("].join("");
    const content = readFileSync("scripts/db-migrate-recover.ts", "utf-8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");

    expect(
      content,
      `D-20/D-21: scripts/db-migrate-recover.ts must not reference "${journalNeedle}" -- the ` +
        "recovery command never edits, rewrites, or deletes the migration journal",
    ).not.toContain(journalNeedle);

    expect(
      content,
      `D-20/D-21: scripts/db-migrate-recover.ts must not reference "${dropIndexNeedle}" -- the ` +
        "recovery command never repairs the schema on its own initiative",
    ).not.toContain(dropIndexNeedle);

    expect(
      content,
      `D-20/D-21: scripts/db-migrate-recover.ts must not reference "${exitNeedle}" -- never a ` +
        "forced synchronous process exit after a libpg-query WASM parse (Windows libuv crash " +
        "avoidance, packages/automation/src/cli.ts's own header comment)",
    ).not.toContain(exitNeedle);
  });

  it("no file in the source surface references drizzle-kit's own migrate sub-command (D-02, Phase 4)", async () => {
    // Concatenated at runtime, matching the drizzle-kit-push check above's own idiom, so this
    // test file's own source never contains the forbidden two-token string. Unconditional: no
    // per-file allowlist, matching the user's explicit decision on Task 2's checkpoint -- a gate
    // with a second door is not a gate, and an exemption list is the mechanism by which a real
    // invocation later hides behind "it is only a comment".
    const forbidden = ["drizzle-kit", "migrate"].join(" ");
    const files = await sourceSurfaceFiles();
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      expect(
        content,
        `D-02: "${file}" must not reference "${forbidden}" -- db:migrate is now the gated ` +
          "runner, and drizzle-kit's own migrate sub-command must be structurally unreachable " +
          "from every file in this repository, with no exemption",
      ).not.toContain(forbidden);
    }
  });

  it("packages/automation never imports the pg driver (D-28)", async () => {
    // Concatenated at runtime, same self-match-avoidance idiom as every other needle in this
    // file, so this assertion's own source never contains the literal it searches for.
    const fromPgNeedle = ['from "pg', '"'].join("");
    const requirePgNeedle = ["require(", '"pg"', ")"].join("");
    const files = (await sourceSurfaceFiles()).filter((file) => file.startsWith("packages/automation/src/"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      expect(
        content,
        `D-28: "${file}" must not import "pg" -- the runner core receives an already-` +
          "constructed client from its caller; adding the driver here would grant the " +
          "extractable safety package the one capability this project spends most of its " +
          "effort constraining",
      ).not.toContain(fromPgNeedle);
      expect(content, `D-28: "${file}" must not require("pg")`).not.toContain(requirePgNeedle);
    }
  });

  it("packages/automation's package boundary is held by a ratcheted debt inventory, not developer discipline (D-25)", async () => {
    // Mirrors the D-28 test immediately above: filter first, assert the filtered list is
    // non-empty BEFORE examining anything, so a renamed directory or a gitignore change cannot
    // make this check silently examine nothing (T-QUICK-02). Restricted to TypeScript files
    // deliberately -- the package also ships a SQL statement corpus and a JSON default-rules
    // file, and the invariant here is about TypeScript module resolution, not about those.
    const files = (await sourceSurfaceFiles()).filter(
      (file) => file.startsWith(`${AUTOMATION_PACKAGE_ROOT}/`) && file.endsWith(".ts"),
    );
    expect(
      files.length,
      "escapingRelativeImports() must actually examine at least one packages/automation/*.ts " +
        "file, or this guardrail passes having checked nothing",
    ).toBeGreaterThan(0);

    const liveEscapes: Record<string, string[]> = {};
    for (const file of files) {
      const escapes = escapingRelativeImports(file, readFileSync(file, "utf-8"));
      if (escapes.length > 0) {
        liveEscapes[file] = escapes;
      }
    }

    expect(
      liveEscapes,
      "T-QUICK-01/T-QUICK-02 (D-25): the live set of packages/automation package-boundary " +
        "escapes no longer matches KNOWN_PACKAGE_BOUNDARY_ESCAPES exactly. If this run found " +
        "MORE than the inventory records (a new key, or a longer array for an existing key), " +
        "the package boundary just widened -- remove the new relative import rather than " +
        "recording it here; no file in this inventory is exempt from that rule, including " +
        "files already listed. If this run found FEWER (a key present in the inventory but " +
        "absent from the live scan), debt was paid -- delete that entry from " +
        "KNOWN_PACKAGE_BOUNDARY_ESCAPES rather than leaving a stale record. CLAUDE.md: " +
        "\"prefer architectural enforcement over remembered caution.\"",
    ).toEqual(KNOWN_PACKAGE_BOUNDARY_ESCAPES);
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

  it("no file in the application's own source (or its Next.js startup-hook files) triggers a migration at boot (D-15, CI-06)", async () => {
    // 05-07-PLAN.md Task 1: nothing in apps/recipe-app/src, next.config.ts, or an
    // instrumentation*.ts startup hook may reference the migration entry point, the runner's
    // exported symbols, or the schema-sync sub-command -- migrations reach the database only
    // through the pipeline-invoked runner (scripts/db-migrate.ts), never through the
    // application's own startup path (docs/decisions.md D8). Enumerated by prefix, not a
    // hand-typed file list, so a file added later is covered by default rather than exempt by
    // default.
    const { stdout } = await execa("git", ["ls-files"]);
    const allFiles = stdout.split("\n").filter(Boolean);
    const applicationBootFiles = allFiles.filter(
      (file) =>
        file.startsWith("apps/recipe-app/src/") ||
        file === "apps/recipe-app/next.config.ts" ||
        file.startsWith("apps/recipe-app/instrumentation"),
    );

    expect(
      applicationBootFiles.length,
      "D-15/CI-06: the enumerated application-source file list must actually contain files -- " +
        "a renamed directory or a gitignore change would otherwise make this check pass having " +
        "examined nothing.",
    ).toBeGreaterThan(0);

    // Built at runtime, not as literals, so this test file's own source never contains the
    // forbidden expressions it searches for -- matching this file's established idiom.
    const migrateScriptNeedle = ["db", ":migrate"].join("");
    const runMigrationsNeedle = ["run", "Migrations"].join("");
    const ensureDrizzleLedgerNeedle = ["ensure", "DrizzleLedger"].join("");
    const enumerateMigrationFilesNeedle = ["enumerate", "MigrationFiles"].join("");
    const schemaSyncNeedle = ["drizzle-kit", "push"].join(" ");
    const needles = [
      migrateScriptNeedle,
      runMigrationsNeedle,
      ensureDrizzleLedgerNeedle,
      enumerateMigrationFilesNeedle,
      schemaSyncNeedle,
    ];

    for (const file of applicationBootFiles) {
      // Comment-only lines stripped first, matching this file's established idiom, so a comment
      // describing this very constraint cannot trip the check that enforces it.
      const content = readFileSync(file, "utf-8")
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");

      for (const needle of needles) {
        expect(
          content,
          `D-15/CI-06: "${file}" must not reference "${needle}" -- migrations reach the ` +
            "database only through the pipeline-invoked runner (scripts/db-migrate.ts), never " +
            "through the application's own startup path.",
        ).not.toContain(needle);
      }
    }
  });

  it("loadRules refuses a synthetic rules file that weakens a floor operation below BLOCKED (D-11, first half)", () => {
    // 05-07-PLAN.md Task 2: drives the real loadRules (imported from packages/automation, never
    // re-implemented here) against an in-memory synthetic rules file, never against the real
    // committed rules file and never written to disk. Proves the property by behaviour: a grep
    // for assertFloorNotWeakened would still pass even if the call were deleted from the load
    // path -- this proves it is actually invoked and actually refuses to load.
    const weakenedRulesFile = {
      version: 1,
      rules: floorSafeSyntheticRules().map((rule) =>
        rule.id === "drop-table" ? { ...rule, verdict: "SAFE" } : rule,
      ),
    };

    const error = captureThrown(() => loadRules(weakenedRulesFile));
    expect(error, "loadRules must throw for a rules file weakening a floor operation").toBeInstanceOf(
      RulesFileError,
    );
    expect(
      (error as Error).message,
      "the thrown message must name the offending floor operation",
    ).toContain("DropTable");
  });

  it("loadRules refuses a synthetic rules file whose unmatched-statement default is weaker than REVIEW REQUIRED (D-11, first half)", () => {
    // Same in-memory-only discipline as the test above, proving the opposite end of D-06's
    // default: a rule broad enough to grant blanket SAFE to every uncatalogued statement (here,
    // matching on statementKind "Unrecognized" alone -- the shape CLUSTER/REINDEX/ALTER SYSTEM
    // and any other uncatalogued DDL all resolve to) defeats "SAFE must be earned" without ever
    // touching a D-02/D-07/D-17 floor rule. The floor-safe baseline is included unmodified so
    // this test isolates assertUnmatchedDefaultsToReview specifically, rather than incidentally
    // failing on the floor check first.
    const unmatchedWeakenedRulesFile = {
      version: 1,
      rules: [
        ...floorSafeSyntheticRules(),
        {
          id: "blanket-safe-unrecognized",
          category: "usually-safe",
          match: { statementKind: "Unrecognized" },
          verdict: "SAFE",
          rationale: "synthetic exploit rule",
        },
      ],
    };

    const error = captureThrown(() => loadRules(unmatchedWeakenedRulesFile));
    expect(
      error,
      "loadRules must throw for a rules file weakening the unmatched-statement default",
    ).toBeInstanceOf(RulesFileError);
    expect(
      (error as Error).message,
      "the thrown message must name the unmatched statement kind",
    ).toContain("Unrecognized");
  });

  it("the ruleset's required-check contexts and pr-gate.yml's job names are exactly the same set, with no duplicate job name (D-11, second half)", () => {
    // The property this test actually proves, recorded honestly: deleting or renaming a job
    // means its named required check never reports, and a required check that never reports
    // blocks the merge rather than passing it -- confirmed against GitHub's own troubleshooting
    // documentation (05-RESEARCH.md) and observed live in plan 05-08. This test cannot prove
    // GitHub's own behaviour; it proves the names agree, which is the half this repository owns.
    const rulesetPayload = JSON.parse(
      readFileSync(".github/rulesets/main-protection.json", "utf-8"),
    ) as {
      rules: Array<{ type: string; parameters?: { required_status_checks?: Array<{ context: string }> } }>;
    };
    const requiredStatusChecksRule = rulesetPayload.rules.find(
      (rule) => rule.type === "required_status_checks",
    );
    expect(
      requiredStatusChecksRule?.parameters?.required_status_checks,
      "the ruleset payload must define a required_status_checks rule with a context list",
    ).toBeDefined();
    const contexts = requiredStatusChecksRule!.parameters!.required_status_checks!.map(
      (entry) => entry.context,
    );

    expect(
      contexts.length,
      "the extracted context list must not be empty -- a broken extraction must not pass by " +
        "comparing two empty sets",
    ).toBeGreaterThan(0);

    // Comment lines stripped first, matching this file's established idiom. Job-level `name:`
    // sits at exactly 4-space indentation with no leading `-` (workflow-level `name:` is
    // 0-indent; step-level `name:` is nested under a `- ` list item at 6-space indentation) --
    // verified against the real file's exact whitespace before writing this pattern.
    const workflowCodeOnly = readFileSync(".github/workflows/pr-gate.yml", "utf-8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");
    const jobNamePattern = /^ {4}name:[ \t]*(\S.*)$/gm;
    const jobNames = [...workflowCodeOnly.matchAll(jobNamePattern)].map((match) => match[1].trim());

    expect(
      jobNames.length,
      "the extracted job-name list must not be empty -- a broken extraction must not pass by " +
        "comparing two empty sets",
    ).toBeGreaterThan(0);

    expect(
      new Set(jobNames).size,
      "no two jobs in pr-gate.yml may share a name: value -- two contexts that are equal collide",
    ).toBe(jobNames.length);

    expect(
      [...contexts].sort(),
      "T-05-44/D-11: every required-check context must match exactly one job name, and every " +
        "job name must be a required-check context, in both directions -- a context adjacent to " +
        "no job is orphaned, and a job with no required context is unprotected",
    ).toEqual([...jobNames].sort());
  });
});
