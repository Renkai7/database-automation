// D-09 (05-CONTEXT.md), CI-05, Task 3: schema drift. Synthetic `git status --porcelain` strings
// only -- no real generation invoked, no temporary schema change created. The real end-to-end
// falsification (hand-edit a migration, confirm the check fails) happens once, observably,
// against a real pull request in plan 05-08 (per this task's own <action> instructions).
import { describe, expect, it } from "vitest";
import { assertWorkingTreeClean, driftSignalFromPorcelain } from "../../scripts/ci/check-schema-drift";

describe("driftSignalFromPorcelain", () => {
  it("reports no drift for empty output", () => {
    expect(driftSignalFromPorcelain("")).toEqual({ drifted: false, paths: [] });
  });

  it("reports drift and names the path for an untracked new migration", () => {
    const result = driftSignalFromPorcelain("?? apps/recipe-app/drizzle/0005_x.sql\n");
    expect(result.drifted).toBe(true);
    expect(result.paths).toContain("apps/recipe-app/drizzle/0005_x.sql");
  });

  it("reports drift for a modified snapshot file", () => {
    const result = driftSignalFromPorcelain(" M apps/recipe-app/drizzle/meta/0004_snapshot.json\n");
    expect(result.drifted).toBe(true);
  });
});

describe("assertWorkingTreeClean", () => {
  it("does not throw for empty output", () => {
    expect(() => assertWorkingTreeClean("")).not.toThrow();
  });

  it("throws for a non-empty porcelain result, stating the tree was already dirty", () => {
    expect(() =>
      assertWorkingTreeClean(" M apps/recipe-app/drizzle/0002_oval_maelstrom.sql\n"),
    ).toThrow(/already modified|already dirty|before generation/i);
  });
});
