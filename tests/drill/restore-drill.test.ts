// BKP-02/BKP-03/BKP-04/BKP-07 (02-CONTEXT.md): the automated, end-to-end proof that `pnpm
// db:drill` genuinely *reports* pass or fail through the committed
// docs/restore-drill-status.json record -- not merely that it runs and exits zero. Deliberately
// slow and Docker-dependent -- lives under tests/drill/ so vitest.config.ts's own `exclude` keeps
// it out of the default `pnpm test` suite by construction (D-16), never by someone remembering
// to skip it. This file sits under tests/, so it is inside tests/guardrails.test.ts's scanned
// source surface and is deliberately not on either of that suite's fixture allowlists -- see its
// own read_first note.
//
// Follows tests/db-reset.test.ts's real-child-process shape: `{ reject: false }` with a manual
// exit-code assertion, a runtime-assembled output-leak check, and the same 180000ms timeout
// (container pulls/starts are not instant).
import { execa } from "execa";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { getDevDatabaseUrl } from "../../scripts/env";
import { DEFAULT_DRILL_STATUS_PATH, readDrillStatus } from "../../scripts/drill-status";

// Built at runtime, not as literals -- same self-match-avoidance idiom as
// tests/target-pin.test.ts/tests/guardrails.test.ts. The globals dump this drill handles
// genuinely carries both of these strings, so neither may ever appear in the drill's own output.
const CONNECTION_STRING_SCHEME_PREFIX = ["postgres", "://"].join("");
const ROLE_PASSWORD_VERIFIER_PREFIX = ["SCRAM", "-SHA-256"].join("");

async function seededRowCounts(): Promise<{ recipes: number; ingredients: number; steps: number }> {
  const client = new Client({ connectionString: getDevDatabaseUrl() });
  await client.connect();
  try {
    const { rows } = await client.query(
      "SELECT (SELECT count(*) FROM recipes) AS recipes, " +
        "(SELECT count(*) FROM ingredients) AS ingredients, " +
        "(SELECT count(*) FROM steps) AS steps",
    );
    const row = rows[0] as { recipes: string; ingredients: string; steps: string };
    return {
      recipes: Number(row.recipes),
      ingredients: Number(row.ingredients),
      steps: Number(row.steps),
    };
  } finally {
    await client.end();
  }
}

describe("pnpm db:drill — reports pass/fail through the committed status record (BKP-02/03/04/07)", () => {
  it(
    "runs end-to-end, records PASS with all four tiers, leaks nothing, and touches only its own half of the status record",
    async () => {
      const before = await readDrillStatus(DEFAULT_DRILL_STATUS_PATH);
      const rowCountsBefore = await seededRowCounts();

      const run = await execa("pnpm", ["run", "db:drill"], { reject: false });
      expect(run.exitCode).toBe(0);

      const output = `${run.stdout}\n${run.stderr}`;
      expect(output).not.toContain(CONNECTION_STRING_SCHEME_PREFIX);
      expect(output).not.toContain(ROLE_PASSWORD_VERIFIER_PREFIX);

      const after = await readDrillStatus(DEFAULT_DRILL_STATUS_PATH);

      expect(after.automated.outcome).toBe("PASS");
      expect(after.automated.lastRunAt).not.toBeNull();
      const lastRunMs = Date.parse(after.automated.lastRunAt as string);
      expect(Number.isNaN(lastRunMs)).toBe(false);
      expect(Date.now() - lastRunMs).toBeLessThan(5 * 60 * 1000);

      expect(after.automated.tiers).toEqual({
        artifactIntegrity: true,
        rowCounts: true,
        schemaEquality: true,
        contentAndReferentialIntegrity: true,
      });

      for (const [step, ms] of Object.entries(after.automated.durationMs)) {
        expect(ms, `durationMs.${step} must be greater than zero`).toBeGreaterThan(0);
      }

      // The drill touched only its own half (D-18, docs/decisions.md D7) -- the human fact must
      // be deeply equal to what it was before this run, byte for byte.
      expect(after.human).toEqual(before.human);

      // The drill reads the development database and must never write to it -- the seeded
      // row counts must be exactly what they were before this run.
      const rowCountsAfter = await seededRowCounts();
      expect(rowCountsAfter).toEqual(rowCountsBefore);
    },
    180000,
  );
});
