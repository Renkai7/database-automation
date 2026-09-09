// D-03 (05-CONTEXT.md), 05-01-PLAN.md Task 1: proves `classifyLine` and `scanHistoryText`
// (`scripts/ci/audit-history.ts`) against synthetic in-memory strings only -- WR-04's own
// precedent, `tests/guardrails.test.ts`'s header comment: "a detector is proven against
// synthetic strings, never by mutating real shipped data." Nothing here ever touches a real
// commit, a real file on disk, or this repository's own git history.
import { describe, expect, it } from "vitest";
import { classifyLine, scanHistoryText, type Finding, type FindingClass } from "../../scripts/ci/audit-history";

describe("classifyLine", () => {
  it("fires CREDENTIAL on a connection string carrying a non-placeholder userinfo password", () => {
    const scheme = ["postgres", "://"].join("");
    const line = `RECIPE_STAGING_DATABASE_URL=${scheme}recipe_app:Tr0ub4dor-real-secret-value@db.example-internal.net:5432/recipe_dev`;
    expect(classifyLine(line)).toBe("CREDENTIAL");
  });

  it("fires CREDENTIAL on an assignment to a credential-shaped key with a non-placeholder value", () => {
    expect(classifyLine("STAGING_DB_PASSWORD=Tr0ub4dor-real-secret-value-9000")).toBe("CREDENTIAL");
    expect(classifyLine('API_TOKEN: "sk-live-example-not-a-real-token-abc123"')).toBe("CREDENTIAL");
  });

  it("fires CREDENTIAL on a PEM private-key header", () => {
    const pemHeader = ["-----BEGIN ", "PRIVATE KEY-----"].join("");
    expect(classifyLine(pemHeader)).toBe("CREDENTIAL");
  });

  it("fires CREDENTIAL on a GitHub token prefix and an AWS access-key prefix", () => {
    const githubToken = [["gh", "p_"].join(""), "exampleExampleExampleExample123"].join("");
    expect(classifyLine(githubToken)).toBe("CREDENTIAL");

    const awsKey = [["AK", "IA"].join(""), "EXAMPLE1234567890"].join("");
    expect(classifyLine(awsKey)).toBe("CREDENTIAL");
  });

  it("fires NON_LOOPBACK_HOST on a connection string whose host is not in the pinned allowlist", () => {
    const scheme = ["postgres", "://"].join("");
    // No password component here -- an isolated positive for this class alone, not a
    // CREDENTIAL positive that also happens to carry a host.
    const line = `${scheme}recipe_app@db.internal.example.com:5432/recipe_dev`;
    expect(classifyLine(line)).toBe("NON_LOOPBACK_HOST");
  });

  it("fires NON_LOOPBACK_HOST on an SSH-style target whose host is not in the pinned allowlist", () => {
    expect(classifyLine("ssh -i deploy_key.pem deploy@staging.example-internal.net")).toBe(
      "NON_LOOPBACK_HOST",
    );
  });

  it("fires IP_LITERAL on a public-range dotted-quad IPv4 address", () => {
    // 203.0.113.0/24 is RFC 5737 TEST-NET-3 -- reserved for documentation, genuinely
    // non-loopback and non-private, and never a real routable address.
    expect(classifyLine("Connect to 203.0.113.55 for the staging box.")).toBe("IP_LITERAL");
  });

  it("fires OPERATIONAL_DETAIL on a Coolify/Hetzner mention paired with a filesystem path", () => {
    expect(
      classifyLine("coolify deployment writes persistent state to /var/lib/coolify/apps/recipe-app"),
    ).toBe("OPERATIONAL_DETAIL");
    expect(classifyLine("hetzner box config lives at /etc/hetzner/network.conf")).toBe(
      "OPERATIONAL_DETAIL",
    );
  });

  it("does NOT fire OPERATIONAL_DETAIL on a bare platform-name mention with no location detail", () => {
    expect(classifyLine("We chose Coolify and Hetzner for self-hosting.")).toBeNull();
  });

  it("fires UNKNOWN_HIGH_ENTROPY on a 32+ character base64/hex-alphabet token matching no other class", () => {
    expect(
      classifyLine("Random blob dump: 8f14e45fceea167a5a36dedd4bea2543f2d6c1a9f3b2e7d1c4a5b6c7d8e9f0a"),
    ).toBe("UNKNOWN_HIGH_ENTROPY");
  });

  it("does NOT fire on 127.0.0.1, localhost, ::1, or the pinned recipe_dev database name", () => {
    expect(classifyLine("Connect via 127.0.0.1 for local development.")).toBeNull();
    expect(classifyLine("The service listens on localhost by default.")).toBeNull();
    expect(classifyLine("IPv6 loopback is ::1 on this machine.")).toBeNull();
    expect(classifyLine("The pinned database name is recipe_dev.")).toBeNull();
  });

  it("does NOT fire IP_LITERAL on a four-part version-number-shaped string whose components exceed 0-255", () => {
    // A real four-dot-separated version scheme (browser build numbers) whose third component
    // (6723) is far outside a valid IPv4 octet range -- proves the octet-range check, not just
    // the "exactly four components" shape, is what defeats this false positive.
    expect(classifyLine("Chrome build 130.0.6723.116 reproduced the issue.")).toBeNull();
  });

  it("does NOT fire CREDENTIAL on .env.example's documented placeholder shape", () => {
    const scheme = ["postgres", "://"].join("");
    expect(
      classifyLine(`RECIPE_DEV_DATABASE_URL=${scheme}recipe_app:PLACEHOLDER@localhost:5432/recipe_dev`),
    ).toBeNull();
  });

  it("does NOT fire CREDENTIAL on docker-compose.yml's ${VAR} indirection shape for a password-named key", () => {
    expect(classifyLine("POSTGRES_PASSWORD: ${RECIPE_DEV_DB_PASSWORD}")).toBeNull();
  });
});

describe("scanHistoryText", () => {
  function fakeDiff(sha: string, path: string, addedLines: string[]): string {
    const marker = `${String.fromCharCode(0)}commit ${sha}`;
    return [
      marker,
      "Author: Test <test@example.com>",
      "",
      `diff --git a/${path} b/${path}`,
      "index 0000000..1111111 100644",
      `--- a/${path}`,
      `+++ b/${path}`,
      "@@ -0,0 +1 @@",
      ...addedLines.map((line) => `+${line}`),
      "",
    ].join("\n");
  }

  it("attributes a finding to the correct commit SHA, path, and class", () => {
    const scheme = ["postgres", "://"].join("");
    const sha = "abc1234def5678900000000000000000000abcd";
    const diffText = fakeDiff(sha, "config/staging.env", [
      `STAGING_URL=${scheme}recipe_app:Tr0ub4dor-real-secret@db.internal.example.com:5432/recipe_dev`,
    ]);

    const findings = scanHistoryText(diffText);
    expect(findings).toHaveLength(1);
    expect(findings[0].sha).toBe(sha);
    expect(findings[0].path).toBe("config/staging.env");
    expect(findings[0].class).toBe("CREDENTIAL");
    expect(typeof findings[0].lineNumberInDiff).toBe("number");
  });

  it("never reproduces the matched value inside the returned Finding object", () => {
    const scheme = ["postgres", "://"].join("");
    const secretValue = "Tr0ub4dor-quite-specific-secret-marker-999";
    const sha = "deadbeefcafebabe0000000000000000000dead";
    const diffText = fakeDiff(sha, "config/staging.env", [
      `STAGING_URL=${scheme}recipe_app:${secretValue}@db.internal.example.com:5432/recipe_dev`,
    ]);

    const findings = scanHistoryText(diffText);
    expect(findings.length).toBeGreaterThan(0);
    const finding = findings[0];

    // Shape check first: a Finding has exactly four fields (sha, path, lineNumberInDiff, class)
    // -- proving nothing else, including a raw line or matched-value field, was ever attached.
    expect(Object.keys(finding).sort()).toEqual(["class", "lineNumberInDiff", "path", "sha"]);

    const serialized = JSON.stringify(finding);
    expect(serialized).not.toContain(secretValue);
    expect(serialized).not.toContain("recipe_app");
    expect(serialized).not.toContain("db.internal.example.com");
    expect(serialized).not.toContain(scheme);
  });

  it("only scans added lines (a `+` prefix, never `+++`, never a removed `-` line)", () => {
    const sha = "0000000111122223333444455556666777788889999";
    const diffText = [
      `${String.fromCharCode(0)}commit ${sha.slice(0, 40)}`,
      "diff --git a/notes.txt b/notes.txt",
      "--- a/notes.txt",
      "+++ b/notes.txt",
      "@@ -1 +1 @@",
      "-Random blob dump: 8f14e45fceea167a5a36dedd4bea2543f2d6c1a9f3b2e7d1c4a5b6c7d8e9f0a",
      "",
    ].join("\n");

    expect(scanHistoryText(diffText)).toEqual([]);
  });

  it("attributes findings from multiple commits and files to their own correct location", () => {
    const shaOne = "1111111111111111111111111111111111abcd";
    const shaTwo = "2222222222222222222222222222222222abcd";
    const diffText = [
      fakeDiff(shaOne, "a.txt", [
        "Random blob dump: 8f14e45fceea167a5a36dedd4bea2543f2d6c1a9f3b2e7d1c4a5b6c7d8e9f0a",
      ]),
      fakeDiff(shaTwo, "b.txt", ["Connect to 203.0.113.55 for the staging box."]),
    ].join("\n");

    const findings = scanHistoryText(diffText);
    expect(findings).toHaveLength(2);

    const byPath = new Map(findings.map((finding: Finding) => [finding.path, finding]));
    expect(byPath.get("a.txt")?.sha).toBe(shaOne);
    expect(byPath.get("a.txt")?.class).toBe("UNKNOWN_HIGH_ENTROPY" satisfies FindingClass);
    expect(byPath.get("b.txt")?.sha).toBe(shaTwo);
    expect(byPath.get("b.txt")?.class).toBe("IP_LITERAL" satisfies FindingClass);
  });

  it("returns no findings for a diff that adds only clean content", () => {
    const sha = "3333333333333333333333333333333333abcd";
    const diffText = fakeDiff(sha, "README.md", [
      "This project uses PostgreSQL 17, pinned via docker-compose.yml.",
      "Connect via 127.0.0.1 for local development, per scripts/env.ts.",
    ]);

    expect(scanHistoryText(diffText)).toEqual([]);
  });
});
