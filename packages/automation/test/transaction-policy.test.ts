// 04-04-PLAN.md Task 1: every row in transaction-policy.ts's own behavior list, built directly
// from EMPTY_FACTS -- decideTransactionPolicy reads only `facts.transactionHostile`, never a
// keyword list of its own.
import { describe, expect, it } from "vitest";
import {
  decideTransactionPolicy,
  MixedTransactionFileError,
} from "../src/runner/transaction-policy";
import { EMPTY_FACTS, type Finding, type StatementFacts } from "../src/types";

function findingWith(
  statementIndex: number,
  factsOverrides: Partial<StatementFacts>,
  nestedPath: number[] = [],
): Finding {
  return {
    statementIndex,
    nestedPath,
    verdict: "SAFE",
    ruleIds: [],
    rationales: [],
    facts: { ...EMPTY_FACTS, ...factsOverrides },
    pairedWith: null,
  };
}

describe("decideTransactionPolicy (D-09/D-11)", () => {
  it("wraps when no finding is transactionHostile", () => {
    const findings = [
      findingWith(0, { statementKind: "CreateTable" }),
      findingWith(1, { statementKind: "AddColumn" }),
    ];
    expect(decideTransactionPolicy(findings)).toEqual({ wrap: true });
  });

  it("wraps on an empty findings array -- nothing to run, still one atomic unit", () => {
    expect(decideTransactionPolicy([])).toEqual({ wrap: true });
  });

  it("unwraps a single transaction-hostile finding with no other findings, naming its statementIndex", () => {
    const findings = [
      findingWith(0, { statementKind: "CreateIndex", concurrently: true, transactionHostile: true }),
    ];
    expect(decideTransactionPolicy(findings)).toEqual({ wrap: false, hostileStatementIndex: 0 });
  });

  it("throws MixedTransactionFileError naming the hostile statement's index when a hostile finding is joined by any other finding", () => {
    const findings = [
      findingWith(0, { statementKind: "CreateIndex", concurrently: true, transactionHostile: true }),
      findingWith(1, { statementKind: "AddColumn" }),
    ];
    expect(() => decideTransactionPolicy(findings)).toThrowError(MixedTransactionFileError);
    try {
      decideTransactionPolicy(findings);
      expect.fail("expected decideTransactionPolicy to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(MixedTransactionFileError);
      expect((error as Error).name).toBe("MixedTransactionFileError");
      expect((error as Error).message).toContain("0");
    }
  });

  it("throws MixedTransactionFileError when two transactionHostile findings share a file -- still a mixed file, a file is one unit", () => {
    const findings = [
      findingWith(0, { statementKind: "CreateIndex", concurrently: true, transactionHostile: true }),
      findingWith(1, { statementKind: "DropIndex", concurrently: true, transactionHostile: true }),
    ];
    expect(() => decideTransactionPolicy(findings)).toThrowError(MixedTransactionFileError);
  });

  it("counts a nested finding (non-empty nestedPath) carrying transactionHostile:true exactly like a top-level one", () => {
    // A DO-block container's own finding (nestedPath []), plus a nested finding from inside its
    // body (D-05 recursion) that happens to be transactionHostile -- two findings total, one
    // hostile, so this must refuse exactly like any other mixed file.
    const findings = [
      findingWith(0, { statementKind: "DoBlock", bodyInspected: true }),
      findingWith(0, { statementKind: "CreateIndex", concurrently: true, transactionHostile: true }, [0, 0]),
    ];
    expect(() => decideTransactionPolicy(findings)).toThrowError(MixedTransactionFileError);
  });

  it("wraps when the only finding is a nested one with transactionHostile:false -- nesting alone changes nothing", () => {
    const findings = [findingWith(0, { statementKind: "DoBlock", bodyInspected: true })];
    expect(decideTransactionPolicy(findings)).toEqual({ wrap: true });
  });
});
