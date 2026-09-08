// D-02/D-08/D-11/D-12: proves the whole tracer path end to end -- a real DROP TABLE travels
// parse -> facts -> rules -> floor -> verdict -> CLI exit code, and a rules file that tries to
// weaken the D-02 floor makes the analyzer refuse to run. Follows tests/restore-cli.test.ts's
// established shape for spawning an entry point (via `pnpm run <script>`) and asserting on its
// exit code and output.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { describe, expect, it } from "vitest";
import { analyzeSql, loadDefaultRules } from "../src/analyze";
import { loadRules } from "../src/classifier/classify";
import { RulesFileError } from "../src/types";

const FIXTURE_PATH = fileURLToPath(new URL("./fixtures/tracer-drop-table.sql", import.meta.url));
const RULES_PATH = fileURLToPath(new URL("../src/rules/rules.json", import.meta.url));

describe("tracer: one real DROP TABLE end to end (D-02, D-08, D-11, D-12)", () => {
  it("analyzeSql classifies the fixture BLOCKED with exactly one finding carrying rule id drop-table", async () => {
    const sql = readFileSync(FIXTURE_PATH, "utf-8");
    const rules = loadDefaultRules();

    const result = await analyzeSql(sql, rules);

    expect(result.verdict).toBe("BLOCKED");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].verdict).toBe("BLOCKED");
    expect(result.findings[0].ruleIds).toEqual(["drop-table"]);
  });

  it("refuses to load a rules file whose drop-table rule is weakened to SAFE (D-02 floor)", () => {
    const rawRules = JSON.parse(readFileSync(RULES_PATH, "utf-8"));
    const weakened = {
      ...rawRules,
      rules: rawRules.rules.map((rule: { id: string; verdict: string }) =>
        rule.id === "drop-table" ? { ...rule, verdict: "SAFE" } : rule,
      ),
    };

    expect(() => loadRules(weakened)).toThrow(RulesFileError);
    expect(() => loadRules(weakened)).toThrow(/floor/i);
  });

  it(
    "the CLI exits 20 and prints BLOCKED for the fixture",
    async () => {
      const result = await execa("pnpm", ["run", "db:analyze", FIXTURE_PATH], { reject: false });

      expect(result.exitCode).toBe(20);
      expect(result.stdout).toContain("BLOCKED");
    },
    30000,
  );
});
