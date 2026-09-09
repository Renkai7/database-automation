// D-06 (05-CONTEXT.md), CI-02: table-drives jobExitCodeForAnalyzerExit over every EXIT_CODES
// value plus one unmapped value, and introducedMigrationPaths over synthetic `git diff
// --name-only` output. Nothing here spawns a real process or touches a real git repository --
// this repo's own WR-04/tamper-then-refuse precedent (synthetic fixtures, never real mutation).
import { describe, expect, it } from "vitest";
import { EXIT_CODES } from "../../packages/automation/src/index";
import { introducedMigrationPaths, jobExitCodeForAnalyzerExit } from "../../scripts/ci/analyze-gate";

describe("jobExitCodeForAnalyzerExit", () => {
  it("maps SAFE and REVIEW_REQUIRED to a passing job exit code", () => {
    expect(jobExitCodeForAnalyzerExit(EXIT_CODES.SAFE).exitCode).toBe(0);
    expect(jobExitCodeForAnalyzerExit(EXIT_CODES.REVIEW_REQUIRED).exitCode).toBe(0);
  });

  it("maps BLOCKED, PARSE_FAILURE, and RULES_INVALID to a failing job exit code", () => {
    expect(jobExitCodeForAnalyzerExit(EXIT_CODES.BLOCKED).exitCode).toBe(1);
    expect(jobExitCodeForAnalyzerExit(EXIT_CODES.PARSE_FAILURE).exitCode).toBe(1);
    expect(jobExitCodeForAnalyzerExit(EXIT_CODES.RULES_INVALID).exitCode).toBe(1);
  });

  it("maps an unrecognised exit code to a failing job exit code, closed by default", () => {
    expect(jobExitCodeForAnalyzerExit(999).exitCode).toBe(1);
  });

  it("gives PARSE_FAILURE a reason string distinct from BLOCKED's", () => {
    const parseFailureReason = jobExitCodeForAnalyzerExit(EXIT_CODES.PARSE_FAILURE).reason;
    const blockedReason = jobExitCodeForAnalyzerExit(EXIT_CODES.BLOCKED).reason;
    expect(parseFailureReason).not.toBe(blockedReason);
  });

  it("gives RULES_INVALID a reason string distinct from BLOCKED's", () => {
    const rulesInvalidReason = jobExitCodeForAnalyzerExit(EXIT_CODES.RULES_INVALID).reason;
    const blockedReason = jobExitCodeForAnalyzerExit(EXIT_CODES.BLOCKED).reason;
    expect(rulesInvalidReason).not.toBe(blockedReason);
  });

  it("gives PARSE_FAILURE a reason string distinct from RULES_INVALID's", () => {
    const parseFailureReason = jobExitCodeForAnalyzerExit(EXIT_CODES.PARSE_FAILURE).reason;
    const rulesInvalidReason = jobExitCodeForAnalyzerExit(EXIT_CODES.RULES_INVALID).reason;
    expect(parseFailureReason).not.toBe(rulesInvalidReason);
  });
});

describe("introducedMigrationPaths", () => {
  it("parses one path per line into a Set", () => {
    const diffOutput = "apps/recipe-app/drizzle/0005_new.sql\napps/recipe-app/drizzle/0006_new.sql\n";
    const result = introducedMigrationPaths(diffOutput);
    expect(result).toEqual(
      new Set(["apps/recipe-app/drizzle/0005_new.sql", "apps/recipe-app/drizzle/0006_new.sql"]),
    );
  });

  it("ignores blank lines", () => {
    const result = introducedMigrationPaths("\napps/recipe-app/drizzle/0005_new.sql\n\n");
    expect(result).toEqual(new Set(["apps/recipe-app/drizzle/0005_new.sql"]));
  });

  it("returns an empty set for empty output", () => {
    expect(introducedMigrationPaths("")).toEqual(new Set());
  });
});
