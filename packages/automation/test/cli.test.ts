// D-10/D-12: end-to-end proof of the CLI's five distinct outcome codes, its complete human
// report, its --json machine contract and its --migrations flag. Follows
// tests/restore-cli.test.ts's established shape: spawn the entry point through execa with
// `{ reject: false }` and assert on exitCode and output, never import cli.ts's own main()
// directly (it calls process.exit()).
//
// The RULES_INVALID (40) case has no CLI-level override for which rules file loads (D-02's own
// must_haves prohibition: no parameter may route around the bundled, floor-checked rules file) --
// so proving it end-to-end through the real spawned binary means temporarily swapping the
// bundled rules.json's own content, exactly like tracer.test.ts's loadRules unit test weakens it
// in memory, but here written to disk and restored in a `finally` block so a failed assertion
// can never leave the real rules file corrupted.
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { execa } from "execa";
import { afterEach, describe, expect, it } from "vitest";

const RULES_PATH = fileURLToPath(new URL("../src/rules/rules.json", import.meta.url));

const SAFE_SQL = "CREATE TABLE cli_test_safe (id int);\n";
const REVIEW_REQUIRED_SQL = "ALTER TABLE cli_test_review RENAME COLUMN old_name TO new_name;\n";
const BLOCKED_SQL = "DROP TABLE cli_test_blocked;\n";
const UNPARSEABLE_SQL = "ALTER TABLE ;\n";

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

function makeTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), "gsd-analyzer-cli-"));
  return tempDir;
}

function writeFixture(dir: string, name: string, sql: string): string {
  const path = join(dir, name);
  writeFileSync(path, sql, "utf-8");
  return path;
}

/** `pnpm run <script>` prints its own "> package@ script ..." banner ahead of, and (on a
 * non-zero exit) an "ELIFECYCLE" footer after, the script's real stdout on this machine --
 * bracket-depth-scan from the first "[" to its matching "]" rather than assuming stdout is JSON
 * in its entirety or that the JSON is the last thing printed. */
function parseJsonArrayFromStdout(stdout: string): unknown {
  const start = stdout.indexOf("[");
  expect(start, `expected a JSON array in stdout, got: ${stdout}`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = start; i < stdout.length; i++) {
    if (stdout[i] === "[") depth++;
    else if (stdout[i] === "]") {
      depth--;
      if (depth === 0) {
        return JSON.parse(stdout.slice(start, i + 1));
      }
    }
  }
  throw new Error(`expected a matching "]" for the JSON array in stdout, got: ${stdout}`);
}

describe("CLI outcome exit codes (D-10, D-12)", () => {
  it("a SAFE input exits 0", async () => {
    const dir = makeTempDir();
    const path = writeFixture(dir, "safe.sql", SAFE_SQL);

    const result = await execa("pnpm", ["run", "db:analyze", path], { reject: false });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("SAFE");
  });

  it("a REVIEW_REQUIRED input exits 10", async () => {
    const dir = makeTempDir();
    const path = writeFixture(dir, "review.sql", REVIEW_REQUIRED_SQL);

    const result = await execa("pnpm", ["run", "db:analyze", path], { reject: false });

    expect(result.exitCode).toBe(10);
    expect(result.stdout).toContain("REVIEW_REQUIRED");
  });

  it("a BLOCKED input exits 20", async () => {
    const dir = makeTempDir();
    const path = writeFixture(dir, "blocked.sql", BLOCKED_SQL);

    const result = await execa("pnpm", ["run", "db:analyze", path], { reject: false });

    expect(result.exitCode).toBe(20);
    expect(result.stdout).toContain("BLOCKED");
  });

  it("an unparseable input exits 30 and prints no verdict word", async () => {
    const dir = makeTempDir();
    const path = writeFixture(dir, "unparseable.sql", UNPARSEABLE_SQL);

    const result = await execa("pnpm", ["run", "db:analyze", path], { reject: false });

    expect(result.exitCode).toBe(30);
    expect(result.stdout).not.toContain("SAFE");
    expect(result.stdout).not.toContain("REVIEW_REQUIRED");
    expect(result.stdout).not.toContain("BLOCKED");
  });

  it("a rules file that weakens the D-02 drop-table floor exits 40 and prints the validation complaint", async () => {
    const dir = makeTempDir();
    const path = writeFixture(dir, "blocked.sql", BLOCKED_SQL);

    const originalRules = readFileSync(RULES_PATH, "utf-8");
    try {
      const parsed = JSON.parse(originalRules) as { rules: Array<{ id: string; verdict: string }> };
      const weakened = {
        ...parsed,
        rules: parsed.rules.map((rule) => (rule.id === "drop-table" ? { ...rule, verdict: "SAFE" } : rule)),
      };
      writeFileSync(RULES_PATH, JSON.stringify(weakened, null, 2), "utf-8");

      const result = await execa("pnpm", ["run", "db:analyze", path], { reject: false });

      expect(result.exitCode).toBe(40);
      expect(`${result.stdout}\n${result.stderr}`.toLowerCase()).toContain("floor");
    } finally {
      writeFileSync(RULES_PATH, originalRules, "utf-8");
    }
  });

  it(
    "three input files whose verdicts are SAFE, BLOCKED and REVIEW_REQUIRED exit 20 and print a section for all three",
    async () => {
      const dir = makeTempDir();
      const safePath = writeFixture(dir, "1-safe.sql", SAFE_SQL);
      const blockedPath = writeFixture(dir, "2-blocked.sql", BLOCKED_SQL);
      const reviewPath = writeFixture(dir, "3-review.sql", REVIEW_REQUIRED_SQL);

      const result = await execa("pnpm", ["run", "db:analyze", safePath, blockedPath, reviewPath], {
        reject: false,
      });

      expect(result.exitCode).toBe(20);
      // Basenames, not full paths: `pnpm run` on Windows re-shells the command through cmd.exe,
      // which can double backslashes in a path argument by the time it reaches the child
      // process -- a shell-quoting artifact of the invocation chain, not something this test's
      // basename-level assertion needs to care about.
      expect(result.stdout).toContain(basename(safePath));
      expect(result.stdout).toContain(basename(blockedPath));
      expect(result.stdout).toContain(basename(reviewPath));
    },
    30000,
  );

  it("the human report for a BLOCKED file names the statement index, the verdict, the rule id and the rationale", async () => {
    const dir = makeTempDir();
    const path = writeFixture(dir, "blocked.sql", BLOCKED_SQL);

    const result = await execa("pnpm", ["run", "db:analyze", path], { reject: false });

    expect(result.stdout).toMatch(/statement 0: BLOCKED \[drop-table\]/);
    expect(result.stdout).toContain("permanently destroys the table");
  });

  it("--json emits a parseable array whose entries carry a path, a verdict and findings with rule ids and rationale", async () => {
    const dir = makeTempDir();
    const safePath = writeFixture(dir, "1-safe.sql", SAFE_SQL);
    const blockedPath = writeFixture(dir, "2-blocked.sql", BLOCKED_SQL);

    const result = await execa("pnpm", ["run", "db:analyze", "--json", safePath, blockedPath], {
      reject: false,
    });

    expect(result.exitCode).toBe(20);
    const parsed = parseJsonArrayFromStdout(result.stdout) as Array<{
      path: string;
      verdict: string;
      findings: Array<{ ruleIds: string[]; rationales: string[] }>;
    }>;
    expect(parsed).toHaveLength(2);
    expect(basename(parsed[0].path)).toBe(basename(safePath));
    expect(parsed[0].verdict).toBe("SAFE");
    expect(basename(parsed[1].path)).toBe(basename(blockedPath));
    expect(parsed[1].verdict).toBe("BLOCKED");
    expect(parsed[1].findings[0].ruleIds).toContain("drop-table");
    expect(parsed[1].findings[0].rationales[0].length).toBeGreaterThan(0);
  });

  it(
    "--migrations analyses every file the adapter enumerates instead of paths given on the command line",
    async () => {
      const result = await execa("pnpm", ["run", "db:analyze:migrations"], { reject: false });

      expect([0, 10, 20]).toContain(result.exitCode);
      expect(result.stdout).toContain("0000_bumpy_khan.sql");
      expect(result.stdout).toContain("0001_busy_thunderbolt.sql");
    },
    30000,
  );
});
