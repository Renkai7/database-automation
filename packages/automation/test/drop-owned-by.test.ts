// Nyquist gap-fill (GAP-3, ANLZ-02/ANLZ-04): CHARACTERIZATION test, not a spec test.
//
// `DROP OWNED BY <role>` drops every object the role owns -- a real irreversible-data-loss
// shape -- but it has no dedicated rule in rules.json. It falls through to D-06's
// unmatched-statement default (statementKind resolves to "Unrecognized"; no rule matches;
// classify.ts's rationale text: "No rule matched this operation; SAFE must be earned by a
// matching rule (D-06).") and today resolves REVIEW_REQUIRED, not BLOCKED.
//
// Whether `DROP OWNED BY` belongs on the D-02 BLOCKED floor is an explicit OPEN OWNER DECISION,
// recorded in two phase artifacts -- .planning/phases/03-safety-analyzer/03-07-SUMMARY.md
// ("Open item for the owner, not decided here") and 03-VERIFICATION.md's "Known open items"
// list -- and this test deliberately does NOT resolve that question. It does not add a rule,
// does not touch rules.json, and does not put the statement on the D-02 floor. It only pins
// today's behavior so it cannot drift silently in EITHER direction:
//
//   - the safety-critical half: it must never become SAFE (that would be a real regression);
//   - the bookkeeping half: if this statement is later promoted to BLOCKED (the owner's likely
//     call per the open item above), THIS TEST WILL FAIL. That failure means "the decision was
//     made, update 03-07-SUMMARY.md's and 03-VERIFICATION.md's open-item notes and this test,"
//     not "something broke."
//
// Implementation files (packages/automation/src/**, including rules.json) are out of scope for
// this gap-fill and were not modified to produce this result.
import { describe, expect, it } from "vitest";
import { loadDefaultRules } from "../src/adapter/default-rules";
import { analyzeSql } from "../src/analyze";

describe("DROP OWNED BY <role> (GAP-3 characterization, open owner decision -- 03-07-SUMMARY.md)", () => {
  it("resolves REVIEW_REQUIRED via D-06's unmatched-statement default -- not SAFE, not (currently) BLOCKED", async () => {
    const rules = loadDefaultRules();
    const result = await analyzeSql("DROP OWNED BY app_user;", rules);

    expect(result.verdict, "must never silently become SAFE").not.toBe("SAFE");
    expect(
      result.verdict,
      "pins CURRENT behavior (REVIEW_REQUIRED via D-06 default); if this now reads BLOCKED, " +
        "the owner decision recorded in 03-07-SUMMARY.md's open item has been made -- update " +
        "that summary, 03-VERIFICATION.md's open-items list, and this test together, this is " +
        "not an implementation regression",
    ).toBe("REVIEW_REQUIRED");

    expect(result.findings).toHaveLength(1);
    const [finding] = result.findings;
    expect(finding.facts.statementKind, "must resolve through D-06's unmatched path, not a named rule").toBe(
      "Unrecognized",
    );
    expect(finding.ruleIds, "no rule in rules.json currently matches DROP OWNED BY").toEqual([]);
    expect(finding.rationales.join(" ")).toMatch(/No rule matched this operation/);
  });
});
