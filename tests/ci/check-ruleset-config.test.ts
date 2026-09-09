// D-05 (05-CONTEXT.md), CI-03, Task 3: fixture-driven proof of scripts/ci/check-ruleset-config.ts's
// decision logic. Synthetic in-memory API-response objects only -- no network, no `gh`
// invocation, matching this repository's own WR-04 precedent of never mutating real shipped data
// to prove a detector. The thin adapter's own `gh api` calls are proven once, live, against the
// real ruleset in plan `05-08`; this file proves the decision logic only.
//
// One well-formed fixture passes every assertion; every failing case below is derived from it by
// a single mutation, so a failing test names exactly which property was violated, and a future
// change that makes the passing fixture invalid breaks every test at once rather than silently
// narrowing coverage.
import { describe, expect, it } from "vitest";
import {
  assertBypassListEmpty,
  assertEnforcementActive,
  assertRequiredRules,
  rulesetsMatchingMain,
  type RulesetDetail,
  type RulesetSummary,
} from "../../scripts/ci/check-ruleset-config";

const EXPECTED_CONTEXTS = [
  "analyze",
  "tamper-checks",
  "test",
  "test-history",
  "migrate",
  "ruleset-config-check",
] as const;

function passingRuleset(): RulesetDetail {
  return {
    id: 1,
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
          required_status_checks: EXPECTED_CONTEXTS.map((context) => ({ context })),
        },
      },
    ],
  };
}

describe("assertBypassListEmpty", () => {
  it("passes on a genuinely empty bypass_actors array", () => {
    expect(() => assertBypassListEmpty(passingRuleset())).not.toThrow();
  });

  it("throws when bypass_actors is absent -- the Pitfall 1 false negative, the single most important assertion in this file", () => {
    const fixture = passingRuleset();
    delete (fixture as Record<string, unknown>).bypass_actors;

    expect(() => assertBypassListEmpty(fixture)).toThrow();
  });

  it("throws when bypass_actors carries an entry, and names the entry count", () => {
    const fixture = passingRuleset();
    fixture.bypass_actors = [{ actor_id: 5, actor_type: "RepositoryRole" }];

    expect(() => assertBypassListEmpty(fixture)).toThrow(/1/);
  });

  it("throws when bypass_actors is null -- null is not empty", () => {
    const fixture = passingRuleset();
    fixture.bypass_actors = null;

    expect(() => assertBypassListEmpty(fixture)).toThrow();
  });

  it("throws when bypass_actors is not an array", () => {
    const fixture = passingRuleset();
    (fixture as Record<string, unknown>).bypass_actors = "not-an-array";

    expect(() => assertBypassListEmpty(fixture)).toThrow();
  });

  it("produces different messages for the absent-key case and the non-empty-list case", () => {
    const absent = passingRuleset();
    delete (absent as Record<string, unknown>).bypass_actors;

    const nonEmpty = passingRuleset();
    nonEmpty.bypass_actors = [{ actor_id: 5, actor_type: "RepositoryRole" }];

    let absentMessage = "";
    let nonEmptyMessage = "";
    try {
      assertBypassListEmpty(absent);
    } catch (error) {
      absentMessage = error instanceof Error ? error.message : String(error);
    }
    try {
      assertBypassListEmpty(nonEmpty);
    } catch (error) {
      nonEmptyMessage = error instanceof Error ? error.message : String(error);
    }

    expect(absentMessage).not.toBe("");
    expect(nonEmptyMessage).not.toBe("");
    expect(absentMessage).not.toBe(nonEmptyMessage);
  });
});

describe("assertEnforcementActive", () => {
  it("passes when enforcement is active", () => {
    expect(() => assertEnforcementActive(passingRuleset())).not.toThrow();
  });

  it("throws when enforcement is evaluate (GitHub's dry-run mode)", () => {
    const fixture = passingRuleset();
    fixture.enforcement = "evaluate";

    expect(() => assertEnforcementActive(fixture)).toThrow(/evaluate/);
  });
});

describe("assertRequiredRules", () => {
  it("passes when every required rule type and every expected context is present", () => {
    expect(() => assertRequiredRules(passingRuleset(), EXPECTED_CONTEXTS)).not.toThrow();
  });

  it("throws when the pull_request rule type is absent", () => {
    const fixture = passingRuleset();
    fixture.rules = (fixture.rules as Array<{ type: string }>).filter(
      (rule) => rule.type !== "pull_request",
    );

    expect(() => assertRequiredRules(fixture, EXPECTED_CONTEXTS)).toThrow(/pull_request/);
  });

  it("passes when the live contexts are the six expected values in reverse order", () => {
    const fixture = passingRuleset();
    const reversedContexts = [...EXPECTED_CONTEXTS].reverse().map((context) => ({ context }));
    (fixture.rules as Array<{ type: string; parameters?: Record<string, unknown> }>).find(
      (rule) => rule.type === "required_status_checks",
    )!.parameters = {
      strict_required_status_checks_policy: true,
      required_status_checks: reversedContexts,
    };

    expect(() => assertRequiredRules(fixture, EXPECTED_CONTEXTS)).not.toThrow();
  });

  it("throws when exactly one context is missing, and the message names it", () => {
    const fixture = passingRuleset();
    const missingOne = EXPECTED_CONTEXTS.filter((context) => context !== "migrate").map(
      (context) => ({ context }),
    );
    (fixture.rules as Array<{ type: string; parameters?: Record<string, unknown> }>).find(
      (rule) => rule.type === "required_status_checks",
    )!.parameters = { strict_required_status_checks_policy: true, required_status_checks: missingOne };

    expect(() => assertRequiredRules(fixture, EXPECTED_CONTEXTS)).toThrow(/migrate/);
  });
});

describe("rulesetsMatchingMain", () => {
  function ruleset(id: number, name: string, include: string[]): RulesetSummary {
    return { id, name, conditions: { ref_name: { include, exclude: [] } } };
  }

  it("returns exactly one entry when one of two rulesets targets refs/heads/main", () => {
    const rulesets = [
      ruleset(1, "main-protection", ["refs/heads/main"]),
      ruleset(2, "release-protection", ["refs/heads/release/*"]),
    ];

    expect(rulesetsMatchingMain(rulesets)).toHaveLength(1);
    expect(rulesetsMatchingMain(rulesets)[0].name).toBe("main-protection");
  });

  it("returns two entries when a second ruleset also targets main", () => {
    const rulesets = [
      ruleset(1, "main-protection", ["refs/heads/main"]),
      ruleset(2, "shadow-ruleset", ["refs/heads/main"]),
    ];

    expect(rulesetsMatchingMain(rulesets)).toHaveLength(2);
  });

  it("recognises GitHub's ~ALL and ~DEFAULT_BRANCH wildcard forms as covering main", () => {
    expect(rulesetsMatchingMain([ruleset(1, "all-branches", ["~ALL"])])).toHaveLength(1);
    expect(rulesetsMatchingMain([ruleset(1, "default-branch", ["~DEFAULT_BRANCH"])])).toHaveLength(
      1,
    );
  });

  it("omits a ruleset that does not target main at all", () => {
    expect(rulesetsMatchingMain([ruleset(1, "release-only", ["refs/heads/release/*"])])).toHaveLength(
      0,
    );
  });

  it("LIVE FINDING (05-08): a bare list-endpoint summary with no `conditions` key never matches -- runCheckRulesetConfig must fetch each ruleset's detail before filtering, never filter on the list response alone", () => {
    // Confirmed live against the real GitHub API: GET /repos/{owner}/{repo}/rulesets (the list
    // endpoint) omits `conditions` entirely from every entry -- only the per-ruleset GET returns
    // it. A caller that runs rulesetsMatchingMain directly against list-endpoint summaries (as
    // this repository's own runCheckRulesetConfig did before this fix) always gets zero matches,
    // even when a correctly configured ruleset targeting main is live -- reporting "the gate is
    // absent" for a gate that is actually present and correct.
    const listEndpointShape = [{ id: 1, name: "main-protection" }] as RulesetSummary[];

    expect(rulesetsMatchingMain(listEndpointShape)).toHaveLength(0);
  });
});

describe("a second ruleset targeting main with a non-empty bypass list fails verification", () => {
  it("running the assertions over both rulesets surfaces the second one's failure", () => {
    const good = passingRuleset();
    const bad = passingRuleset();
    bad.id = 2;
    bad.name = "shadow-ruleset";
    bad.bypass_actors = [{ actor_id: 99, actor_type: "Team" }];

    const summaries: RulesetSummary[] = [
      { id: 1, name: "main-protection", conditions: { ref_name: { include: ["refs/heads/main"] } } },
      { id: 2, name: "shadow-ruleset", conditions: { ref_name: { include: ["refs/heads/main"] } } },
    ];
    const matching = rulesetsMatchingMain(summaries);
    expect(matching).toHaveLength(2);

    const details: Record<number, RulesetDetail> = { 1: good, 2: bad };
    const failures: string[] = [];
    for (const summary of matching) {
      try {
        const detail = details[summary.id];
        assertBypassListEmpty(detail);
        assertEnforcementActive(detail);
        assertRequiredRules(detail, EXPECTED_CONTEXTS);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }

    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/bypass_actors/);
  });
});
