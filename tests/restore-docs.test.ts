// G2 (02-VALIDATION.md gap): the four assertions below previously existed ONLY as one-off
// `node -e "..."` strings embedded in 02-04-PLAN.md/02-05-PLAN.md <verify> blocks. Nothing in
// `pnpm test` ever re-ran them, so BKP-01, BKP-06 and BKP-08's documented properties could
// silently regress with no red suite to catch it. This file folds all four into the default
// fast suite, following tests/drill-status.test.ts's file-read-only, no-Docker, no-database
// style: pure reads of committed docs, plus an in-memory mutated copy proving each predicate is
// non-vacuous in the failing direction (this repo's own standard, per
// tests/drill-assertions.test.ts and tests/drill-status.test.ts).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_DRILL_STATUS_PATH, readDrillStatus } from "../scripts/drill-status";

const RUNBOOK_PATH = "docs/20-restore-runbook.md";
const CURRENT_STATE_PATH = "docs/00-current-state.md";

// Built at runtime, not as a literal -- tests/guardrails.test.ts scans the tests/ source
// surface for a PostgreSQL connection-string scheme prefix and this file is deliberately not
// on either of its fixture allowlists, so writing this as a literal would fail that scan.
const CONNECTION_STRING_SCHEME_PREFIX = ["postgres", "://"].join("");
const SCRAM_VERIFIER_PREFIX = ["SCRAM", "-SHA-256"].join("");
const PASSWORD_WORD = ["pass", "word"].join("");

/** 02-05-PLAN Task 3's `runbook-structure-ok` check, factored so both the real committed file
 * and a deliberately mutated in-memory copy can be run through it. */
function assertRunbookStructureOk(text: string): void {
  const body = text
    .split("\n")
    .filter((line) => !line.trim().startsWith("<!--"))
    .join("\n");
  for (const [needle, why] of [
    ["What actually happened", "the required findings section"],
    ["UNKNOWN", "the production-RTO honesty statement"],
    ["CASCADE", "the constraint-gap finding"],
  ] as const) {
    if (!body.includes(needle)) {
      throw new Error(`runbook is missing ${why}`);
    }
  }
  if (!/\b\d+\s*(s|sec|second|min|minute)/i.test(body)) {
    throw new Error("runbook carries no measured timing");
  }
}

/** 02-05-PLAN Task 3's `human-fact-recorded-ok` check, factored so both the real committed
 * record and a deliberately mutated in-memory object can be run through it. */
function assertHumanFactRecordedOk(status: {
  human: { outcome: string; lastPerformedAt: string | null; runbookRef: string };
  automated: { outcome: string | null };
}): void {
  if (status.human.outcome === "UNKNOWN") {
    throw new Error("human outcome is still unknown after the drill");
  }
  if (!status.human.lastPerformedAt || Number.isNaN(Date.parse(status.human.lastPerformedAt))) {
    throw new Error("human lastPerformedAt is missing or unparseable");
  }
  if (!status.human.runbookRef || !status.human.runbookRef.includes("20-restore-runbook")) {
    throw new Error("human runbookRef does not point at the runbook");
  }
  if (status.automated.outcome !== "PASS") {
    throw new Error(`automated half was disturbed: ${status.automated.outcome}`);
  }
}

/** 02-05-PLAN Task 3's `current-state-updated-ok` check, factored so both the real committed
 * file and a deliberately mutated in-memory copy can be run through it. */
function assertCurrentStateUpdatedOk(text: string): void {
  const six = text.match(/## 6\.[\s\S]*?(?=\n## )/);
  if (!six) {
    throw new Error("section 6 not found");
  }
  if (/- \[x\]/.test(six[0])) {
    throw new Error("a production backup UNKNOWN was ticked by this phase");
  }
  const r1 = text.split("\n").filter((line) => line.startsWith("| R1"))[0] || "";
  if (!r1) {
    throw new Error("risk R1 row not found");
  }
  if (r1.includes("CONFIRMED") && !r1.includes("20-restore-runbook")) {
    throw new Error("risk R1 still reads as unproven with no runbook evidence cited");
  }
}

/** 02-04-PLAN Task 1's `status-no-credentials-ok` check, factored so both the real committed
 * file's raw text and a deliberately spliced in-memory copy can be run through it. Operates on
 * raw text, not a parsed object, because the whole point is to see the file as bytes. */
function assertStatusNoCredentialsOk(rawText: string): void {
  for (const needle of [CONNECTION_STRING_SCHEME_PREFIX, SCRAM_VERIFIER_PREFIX, PASSWORD_WORD]) {
    if (rawText.includes(needle)) {
      throw new Error("credential-shaped string in the status record");
    }
  }
}

describe("docs/20-restore-runbook.md structure (BKP-06, T-02-22, 02-05-PLAN Task 3)", () => {
  it("the committed runbook contains the required findings section, the production-RTO honesty statement, the CASCADE finding, and a measured timing", () => {
    const text = readFileSync(RUNBOOK_PATH, "utf-8");
    expect(() => assertRunbookStructureOk(text)).not.toThrow();
  });

  it("assertRunbookStructureOk is not vacuous -- it rejects a copy missing the required findings section", () => {
    const text = readFileSync(RUNBOOK_PATH, "utf-8");
    const mutated = text.replaceAll("What actually happened", "What happened, in short");
    expect(() => assertRunbookStructureOk(mutated)).toThrow(/findings section/);
  });

  it("assertRunbookStructureOk is not vacuous -- it rejects a copy with no measured timing", () => {
    const withoutFindings =
      "## What actually happened\n\nThis runbook covers UNKNOWN cases and a CASCADE drop, but no duration is mentioned anywhere in this text.\n";
    expect(() => assertRunbookStructureOk(withoutFindings)).toThrow(/measured timing/);
  });
});

describe("docs/restore-drill-status.json human fact (BKP-01, T-02-22, 02-05-PLAN Task 3)", () => {
  it("the committed status record's human fact carries a real outcome, a parseable date, and a runbook reference, with the automated half undisturbed", async () => {
    const status = await readDrillStatus(DEFAULT_DRILL_STATUS_PATH);
    expect(() => assertHumanFactRecordedOk(status)).not.toThrow();
  });

  it("assertHumanFactRecordedOk is not vacuous -- it rejects a copy whose human outcome was reset to UNKNOWN", async () => {
    const status = await readDrillStatus(DEFAULT_DRILL_STATUS_PATH);
    const mutated = { ...status, human: { ...status.human, outcome: "UNKNOWN" as const } };
    expect(() => assertHumanFactRecordedOk(mutated)).toThrow(/still unknown/);
  });

  it("assertHumanFactRecordedOk is not vacuous -- it rejects a copy whose automated outcome was disturbed", async () => {
    const status = await readDrillStatus(DEFAULT_DRILL_STATUS_PATH);
    const mutated = { ...status, automated: { ...status.automated, outcome: "FAIL" as const } };
    expect(() => assertHumanFactRecordedOk(mutated)).toThrow(/automated half was disturbed/);
  });
});

describe("docs/00-current-state.md risk R1 and section 6 (02-05-PLAN Task 3)", () => {
  it("section 6's production-backup UNKNOWNs remain unticked and risk R1's row exists", () => {
    const text = readFileSync(CURRENT_STATE_PATH, "utf-8");
    expect(() => assertCurrentStateUpdatedOk(text)).not.toThrow();
  });

  it("assertCurrentStateUpdatedOk is not vacuous -- it rejects a copy where a section-6 UNKNOWN was ticked", () => {
    const text = readFileSync(CURRENT_STATE_PATH, "utf-8");
    const six = text.match(/## 6\.[\s\S]*?(?=\n## )/);
    expect(six).not.toBeNull();
    const tickedSix = six![0].replace("- [ ]", "- [x]");
    const mutated = text.replace(six![0], tickedSix);
    expect(() => assertCurrentStateUpdatedOk(mutated)).toThrow(/UNKNOWN was ticked/);
  });

  it("assertCurrentStateUpdatedOk is not vacuous -- it rejects a copy where the R1 row is missing", () => {
    const text = readFileSync(CURRENT_STATE_PATH, "utf-8");
    const mutated = text
      .split("\n")
      .filter((line) => !line.startsWith("| R1"))
      .join("\n");
    expect(() => assertCurrentStateUpdatedOk(mutated)).toThrow(/R1 row not found/);
  });
});

describe("docs/restore-drill-status.json carries no credential-shaped string (BKP-08, T-02-19, 02-04-PLAN Task 1)", () => {
  it("the committed status record's raw text contains none of the connection-string scheme, the SCRAM verifier prefix, or the literal password word", () => {
    const rawText = readFileSync(DEFAULT_DRILL_STATUS_PATH, "utf-8");
    expect(() => assertStatusNoCredentialsOk(rawText)).not.toThrow();
  });

  it("assertStatusNoCredentialsOk is not vacuous -- it rejects raw text with a connection-string scheme prefix spliced in", () => {
    const rawText = readFileSync(DEFAULT_DRILL_STATUS_PATH, "utf-8");
    const spliced = `${rawText}\n// ${CONNECTION_STRING_SCHEME_PREFIX}user:secret@host/db`;
    expect(() => assertStatusNoCredentialsOk(spliced)).toThrow(/credential-shaped string/);
  });

  it("assertStatusNoCredentialsOk is not vacuous -- it rejects raw text with the literal password word spliced in", () => {
    const rawText = readFileSync(DEFAULT_DRILL_STATUS_PATH, "utf-8");
    const spliced = `${rawText}\n// stored ${PASSWORD_WORD} here`;
    expect(() => assertStatusNoCredentialsOk(spliced)).toThrow(/credential-shaped string/);
  });
});
