// Covers scripts/log.ts's safeErrorMessage — the single, tested definition of the
// "print only the error's own message, never the error object" guarantee (T-01-18, IN-01).
// The connection-string/password fixture below is built at runtime via string concatenation,
// not written as a literal, matching tests/guardrails.test.ts's own self-match-avoidance idiom
// (see that file's header comment) — this file is deliberately not a member of either of
// guardrails.test.ts's fixture allowlists and must not need to be added to one.
import { describe, expect, it } from "vitest";
import { safeErrorMessage } from "../scripts/log";

describe("scripts/log.ts — safeErrorMessage", () => {
  it("returns an Error's own message and nothing else", () => {
    expect(safeErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("returns a plain string argument unchanged", () => {
    expect(safeErrorMessage("plain string")).toBe("plain string");
  });

  it("never serialises a non-Error object's own fields, even when they carry connection details", () => {
    const schemePrefix = ["postgres", "://"].join("");
    const password = "leakedpassword";
    const carrier = {
      connectionString: `${schemePrefix}leaked:${password}@host:5432/somedb`,
    };

    const result = safeErrorMessage(carrier);

    expect(result).not.toContain(schemePrefix);
    expect(result).not.toContain(password);
  });

  it("returns a short non-empty string for undefined rather than throwing", () => {
    const result = safeErrorMessage(undefined);
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns a short non-empty string for null rather than throwing", () => {
    const result = safeErrorMessage(null);
    expect(result.length).toBeGreaterThan(0);
  });
});
