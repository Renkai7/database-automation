// D-04 (05-CONTEXT.md), CI-03, CR-01 (05-REVIEW.md): fixture-driven proof of
// scripts/ci/apply-ruleset.ts's `loadRulesetPayload` validation. Synthetic in-memory JSON text
// only -- no filesystem read, no `gh` invocation, matching this repository's own
// tests/ci/check-ruleset-config.test.ts precedent (the thin adapter's own network calls are
// proven live in CI, never mocked here; this file proves the decision logic only).
//
// One well-formed payload passes every assertion; every failing case below is derived from it by
// a single mutation, so a failing test names exactly which property was violated.
import { describe, expect, it } from "vitest";
import { chooseApplyMethod, loadRulesetPayload } from "../../scripts/ci/apply-ruleset";

function passingPayload(): Record<string, unknown> {
  return {
    name: "main-protection",
    target: "branch",
    enforcement: "active",
    bypass_actors: [],
    conditions: { ref_name: { include: ["refs/heads/main"], exclude: [] } },
    rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      { type: "pull_request", parameters: { required_approving_review_count: 0 } },
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: true,
          required_status_checks: [{ context: "analyze" }, { context: "test" }],
        },
      },
    ],
  };
}

describe("loadRulesetPayload", () => {
  it("passes and returns the parsed payload for a well-formed, empty-bypass-list payload", () => {
    const result = loadRulesetPayload(JSON.stringify(passingPayload()));
    expect(result.bypass_actors).toEqual([]);
    expect(result.name).toBe("main-protection");
  });

  it("throws when bypass_actors is absent entirely", () => {
    const fixture = passingPayload();
    delete fixture.bypass_actors;

    expect(() => loadRulesetPayload(JSON.stringify(fixture))).toThrow(/no "bypass_actors" field/);
  });

  // CR-01 (05-REVIEW.md): the regression this test exists to pin. Before the fix,
  // loadRulesetPayload only checked `"bypass_actors" in parsed` -- presence, never emptiness --
  // so a payload carrying a real bypass actor passed validation and would have been sent verbatim
  // to the live, public repository via `gh api ... --method PUT`, silently widening D-04's central
  // safety property. This must throw.
  it("CR-01: throws when bypass_actors is present but carries a real entry", () => {
    const fixture = passingPayload();
    fixture.bypass_actors = [{ actor_id: 5, actor_type: "RepositoryRole" }];

    expect(() => loadRulesetPayload(JSON.stringify(fixture))).toThrow(
      /not an empty array/,
    );
  });

  it("CR-01: throws when bypass_actors is null -- null is not confirmed empty", () => {
    const fixture = passingPayload();
    fixture.bypass_actors = null;

    expect(() => loadRulesetPayload(JSON.stringify(fixture))).toThrow(/not an empty array/);
  });

  it("CR-01: throws when bypass_actors is not an array at all", () => {
    const fixture = passingPayload();
    fixture.bypass_actors = "not-an-array";

    expect(() => loadRulesetPayload(JSON.stringify(fixture))).toThrow(/not an empty array/);
  });

  it("throws when enforcement is not active", () => {
    const fixture = passingPayload();
    fixture.enforcement = "evaluate";

    expect(() => loadRulesetPayload(JSON.stringify(fixture))).toThrow(/not "active"/);
  });

  it("throws when the required_status_checks context list is empty", () => {
    const fixture = passingPayload();
    (fixture.rules as Array<{ type: string; parameters?: Record<string, unknown> }>).find(
      (rule) => rule.type === "required_status_checks",
    )!.parameters = { strict_required_status_checks_policy: true, required_status_checks: [] };

    expect(() => loadRulesetPayload(JSON.stringify(fixture))).toThrow(
      /required_status_checks context list is empty/,
    );
  });

  it("throws when name is missing", () => {
    const fixture = passingPayload();
    delete fixture.name;

    expect(() => loadRulesetPayload(JSON.stringify(fixture))).toThrow(/missing "name" or "rules"/);
  });
});

describe("chooseApplyMethod", () => {
  it("returns a create instruction when no existing ruleset matches the name", () => {
    expect(chooseApplyMethod([{ id: 1, name: "other" }], "main-protection")).toEqual({
      method: "create",
    });
  });

  it("returns an update instruction with the matching ruleset's id", () => {
    expect(
      chooseApplyMethod([{ id: 42, name: "main-protection" }], "main-protection"),
    ).toEqual({ method: "update", id: 42 });
  });
});
