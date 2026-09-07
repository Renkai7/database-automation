// Proves every tier-3/tier-4 assertion in scripts/drill-assertions.ts in the failing direction
// as well as the passing one (02-02-PLAN.md Task 3) -- a guard that has never been observed
// failing is a guard nobody knows has teeth. Two fixture styles: plain string fixtures for the
// schema tier (case 1-4), and a hand-built fake client satisfying the module's structural
// QueryableClient interface for the query-driven tiers (case 5-9) -- no Docker, no database, so
// this file stays in the fast default suite.
//
// tests/guardrails.test.ts lines 26-38: this file sits inside the scanned source surface and is
// deliberately NOT on either fixture allowlist, so the connection-string needle below is
// assembled at runtime, not written as a literal.
import { describe, expect, it } from "vitest";
import {
  assertContentHashes,
  assertNoOrphanRows,
  assertSchemaEquality,
  assertSequenceState,
  assertSpotCheckedValues,
  canonicalizeSchemaDump,
  type SchemaDumpPair,
} from "../scripts/drill-assertions";
import type { BackupManifest } from "../scripts/backup-manifest";

const CONNECTION_STRING_SCHEME_PREFIX = ["postgres", "://"].join("");

function expectNoConnectionString(message: string): void {
  expect(message).not.toContain(CONNECTION_STRING_SCHEME_PREFIX);
}

// A minimal fake client satisfying the module's structural `{ query(text): Promise<{ rows }> }`
// interface -- each call consumes the next queued response in order, matching the exact
// sequence the function under test issues its queries in. Never a concrete driver class.
function queueClient(...responses: Array<Array<Record<string, unknown>>>): {
  query: (text: string) => Promise<{ rows: unknown[] }>;
} {
  let callIndex = 0;
  return {
    async query(_text: string) {
      const rows = responses[callIndex] ?? [];
      callIndex++;
      return { rows };
    },
  };
}

function buildFixtureManifest(overrides: Partial<BackupManifest> = {}): BackupManifest {
  return {
    takenAt: "2026-09-07T19:36:50.000Z",
    postgresVersion: "PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2) on x86_64-pc-linux-gnu",
    gitCommit: "c8663a5e5a9c2bd5300a69967e78f3637102dfa5",
    appliedMigrationCount: 2,
    dataDump: { file: "recipe_dev-20260907T193650Z.dump", sha256: "a".repeat(64) },
    globalsDump: { file: "recipe_dev-20260907T193650Z-globals.sql", sha256: "b".repeat(64) },
    rowCounts: { "public.recipes": 1, "public.ingredients": 1, "public.steps": 1 },
    contentHashes: { "public.recipes": "1".repeat(32) },
    spotChecks: {
      recipes: [{ slug: "chicken-rice-bowl", baseServings: 2, baseKcal: 620 }],
      ingredients: [{ name: "Chicken breast", quantity: "200.00", unit: "g", position: 0 }],
      steps: [{ position: 0, timerLabel: null }],
    },
    sequences: [
      { schemaName: "drizzle", sequenceName: "__drizzle_migrations_id_seq", lastValue: 2 },
    ],
    ...overrides,
  };
}

// RESEARCH.md Pattern 3 / Pitfall 4 realistic fixture content: the confirmed source of
// non-determinism (the \restrict/\unrestrict guard token pair, regenerated per invocation) and
// a comment-only metadata line, bracketing an otherwise identical schema body.
const SOURCE_SCHEMA_WITH_FK = `\\restrict token-aaa111
-- Dumped from database version 17.11 (Debian 17.11-1.pgdg13+2)
CREATE TABLE public.recipes (
    id uuid NOT NULL
);
CREATE TABLE public.ingredients (
    id uuid NOT NULL,
    recipe_id uuid NOT NULL
);
ALTER TABLE ONLY public.ingredients
    ADD CONSTRAINT ingredients_recipe_id_recipes_id_fk FOREIGN KEY (recipe_id) REFERENCES public.recipes(id) ON DELETE CASCADE;
\\unrestrict token-aaa111
`;

const RESTORED_SCHEMA_SAME_AFTER_CANONICALIZATION = `\\restrict token-bbb222
-- Dumped from database version 17.11 (Debian 17.11-1.pgdg13+2)
CREATE TABLE public.recipes (
    id uuid NOT NULL
);
CREATE TABLE public.ingredients (
    id uuid NOT NULL,
    recipe_id uuid NOT NULL
);
ALTER TABLE ONLY public.ingredients
    ADD CONSTRAINT ingredients_recipe_id_recipes_id_fk FOREIGN KEY (recipe_id) REFERENCES public.recipes(id) ON DELETE CASCADE;
\\unrestrict token-bbb222
`;

// This is the drill's whole reason to exist: DROP TABLE ... CASCADE returns every row but drops
// the foreign key. Rows come back, an orphan-row check still passes -- only a schema comparison
// notices the missing constraint. Restored fixture is the source fixture with the ALTER
// TABLE/ADD CONSTRAINT lines removed.
const RESTORED_SCHEMA_MISSING_FOREIGN_KEY = `\\restrict token-ccc333
-- Dumped from database version 17.11 (Debian 17.11-1.pgdg13+2)
CREATE TABLE public.recipes (
    id uuid NOT NULL
);
CREATE TABLE public.ingredients (
    id uuid NOT NULL,
    recipe_id uuid NOT NULL
);
\\unrestrict token-ccc333
`;

describe("scripts/drill-assertions.ts — canonicalizeSchemaDump", () => {
  it("case 1: two dumps differing only in guard directives and comment-only lines canonicalise to the same value", () => {
    const canonicalSource = canonicalizeSchemaDump(SOURCE_SCHEMA_WITH_FK);
    const canonicalRestored = canonicalizeSchemaDump(RESTORED_SCHEMA_SAME_AFTER_CANONICALIZATION);

    // Assert equality of the CANONICALISED forms, not of the raw inputs -- the raw inputs
    // deliberately differ (different guard tokens, different metadata comment).
    expect(SOURCE_SCHEMA_WITH_FK).not.toBe(RESTORED_SCHEMA_SAME_AFTER_CANONICALIZATION);
    expect(canonicalSource).toBe(canonicalRestored);
    expect(canonicalSource).not.toContain("restrict");
    expect(canonicalSource).not.toContain("Dumped from database version");
  });
});

describe("scripts/drill-assertions.ts — assertSchemaEquality", () => {
  it("case 2 (green): two schema dumps identical after canonicalisation resolve", () => {
    const pair: SchemaDumpPair = {
      sourceSql: SOURCE_SCHEMA_WITH_FK,
      restoredSql: RESTORED_SCHEMA_SAME_AFTER_CANONICALIZATION,
    };
    expect(() => assertSchemaEquality(pair)).not.toThrow();
  });

  it("case 3 (red — the regression test for the drill's whole reason to exist): a lost foreign key is caught, naming the constraint", () => {
    const pair: SchemaDumpPair = {
      sourceSql: SOURCE_SCHEMA_WITH_FK,
      restoredSql: RESTORED_SCHEMA_MISSING_FOREIGN_KEY,
    };
    let message = "";
    try {
      assertSchemaEquality(pair);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toBe("");
    expect(message).toContain("ingredients_recipe_id_recipes_id_fk");
    expect(message).toContain("FOREIGN KEY");
    expectNoConnectionString(message);
  });

  it("case 4 (red): an empty canonicalised side throws and names which side was empty", () => {
    let sourceEmptyMessage = "";
    try {
      assertSchemaEquality({ sourceSql: "", restoredSql: "CREATE TABLE foo (id int);" });
    } catch (error) {
      sourceEmptyMessage = error instanceof Error ? error.message : String(error);
    }
    expect(sourceEmptyMessage).not.toBe("");
    expect(sourceEmptyMessage).toContain("SOURCE");
    expectNoConnectionString(sourceEmptyMessage);

    let restoredEmptyMessage = "";
    try {
      // A dump containing only a guard-directive pair canonicalises to empty -- proves the
      // rejection fires on the canonicalised value, not merely on a literal empty string.
      assertSchemaEquality({
        sourceSql: "CREATE TABLE foo (id int);",
        restoredSql: "\\restrict tok\n\\unrestrict tok\n",
      });
    } catch (error) {
      restoredEmptyMessage = error instanceof Error ? error.message : String(error);
    }
    expect(restoredEmptyMessage).not.toBe("");
    expect(restoredEmptyMessage).toContain("RESTORED");
    expectNoConnectionString(restoredEmptyMessage);
  });
});

describe("scripts/drill-assertions.ts — assertContentHashes", () => {
  it("case 5 (red): a fake client returning a different hash for one table throws with that table named", async () => {
    const manifest = buildFixtureManifest({
      contentHashes: { "public.recipes": "1".repeat(32) },
    });
    const client = queueClient([{ hash: "9".repeat(32) }]);

    let message = "";
    await assertContentHashes(client, manifest).catch((error: unknown) => {
      message = error instanceof Error ? error.message : String(error);
    });

    expect(message).not.toBe("");
    expect(message).toContain("public.recipes");
    expectNoConnectionString(message);
  });

  it("(green) resolves when every recomputed hash matches the manifest", async () => {
    const manifest = buildFixtureManifest({
      contentHashes: { "public.recipes": "1".repeat(32) },
    });
    const client = queueClient([{ hash: "1".repeat(32) }]);
    await expect(assertContentHashes(client, manifest)).resolves.toBeUndefined();
  });
});

describe("scripts/drill-assertions.ts — assertSpotCheckedValues", () => {
  it("case 6 (red — the NULL-versus-empty-string regression in unit form): a fake client whose steps projection returns an empty string where the manifest recorded a null throws", async () => {
    const manifest = buildFixtureManifest({
      rowCounts: { "public.recipes": 1, "public.ingredients": 1, "public.steps": 1 },
      spotChecks: {
        recipes: [{ slug: "chicken-rice-bowl", baseServings: 2, baseKcal: 620 }],
        ingredients: [{ name: "Chicken breast", quantity: "200.00", unit: "g", position: 0 }],
        steps: [{ position: 0, timerLabel: null }],
      },
    });
    const client = queueClient(
      [{ slug: "chicken-rice-bowl", baseServings: 2, baseKcal: 620 }],
      [{ name: "Chicken breast", quantity: "200.00", unit: "g", position: 0 }],
      [{ position: 0, timerLabel: "" }],
    );

    let message = "";
    await assertSpotCheckedValues(client, manifest).catch((error: unknown) => {
      message = error instanceof Error ? error.message : String(error);
    });

    expect(message).not.toBe("");
    expect(message).toContain("steps");
    expectNoConnectionString(message);
  });

  it("(red) rejects the vacuous case: an empty recorded projection for a table the manifest says holds rows", async () => {
    const manifest = buildFixtureManifest({
      rowCounts: { "public.recipes": 1, "public.ingredients": 1, "public.steps": 1 },
      spotChecks: { recipes: [], ingredients: [], steps: [] },
    });
    const client = queueClient([]);

    let message = "";
    await assertSpotCheckedValues(client, manifest).catch((error: unknown) => {
      message = error instanceof Error ? error.message : String(error);
    });

    expect(message).not.toBe("");
    expectNoConnectionString(message);
  });
});

describe("scripts/drill-assertions.ts — assertNoOrphanRows", () => {
  it("case 7 (red): a fake client reporting a non-zero orphan count for one constraint throws, naming that constraint", async () => {
    const client = queueClient(
      [
        {
          constraint_name: "steps_recipe_id_recipes_id_fk",
          referencing_schema: "public",
          referencing_table: "steps",
          referencing_column: "recipe_id",
          referenced_schema: "public",
          referenced_table: "recipes",
          referenced_column: "id",
        },
      ],
      [{ count: "1" }],
    );

    let message = "";
    await assertNoOrphanRows(client).catch((error: unknown) => {
      message = error instanceof Error ? error.message : String(error);
    });

    expect(message).not.toBe("");
    expect(message).toContain("steps_recipe_id_recipes_id_fk");
    expectNoConnectionString(message);
  });

  it("case 8 (red): a fake client returning an empty constraint enumeration throws rather than resolving", async () => {
    const client = queueClient([]);

    let message = "";
    await assertNoOrphanRows(client).catch((error: unknown) => {
      message = error instanceof Error ? error.message : String(error);
    });

    expect(message).not.toBe("");
    expectNoConnectionString(message);
  });

  it("(green) resolves when every foreign key has zero orphan rows", async () => {
    const client = queueClient(
      [
        {
          constraint_name: "steps_recipe_id_recipes_id_fk",
          referencing_schema: "public",
          referencing_table: "steps",
          referencing_column: "recipe_id",
          referenced_schema: "public",
          referenced_table: "recipes",
          referenced_column: "id",
        },
      ],
      [{ count: "0" }],
    );
    await expect(assertNoOrphanRows(client)).resolves.toBeUndefined();
  });
});

describe("scripts/drill-assertions.ts — assertSequenceState", () => {
  it("case 9 (red): a fake client returning a different last value throws, naming the sequence", async () => {
    const manifest = buildFixtureManifest({
      sequences: [
        { schemaName: "drizzle", sequenceName: "__drizzle_migrations_id_seq", lastValue: 2 },
      ],
    });
    const client = queueClient([
      { schemaName: "drizzle", sequenceName: "__drizzle_migrations_id_seq", lastValue: "3" },
    ]);

    let message = "";
    await assertSequenceState(client, manifest).catch((error: unknown) => {
      message = error instanceof Error ? error.message : String(error);
    });

    expect(message).not.toBe("");
    expect(message).toContain("__drizzle_migrations_id_seq");
    expectNoConnectionString(message);
  });

  it("(red) rejects the vacuous case: a manifest recording zero sequences never resolves as a pass", async () => {
    const manifest = buildFixtureManifest({ sequences: [] });
    const client = queueClient([]);

    let message = "";
    await assertSequenceState(client, manifest).catch((error: unknown) => {
      message = error instanceof Error ? error.message : String(error);
    });

    expect(message).not.toBe("");
    expectNoConnectionString(message);
  });

  it("(green) resolves when the recomputed sequence set matches the manifest exactly", async () => {
    const manifest = buildFixtureManifest({
      sequences: [
        { schemaName: "drizzle", sequenceName: "__drizzle_migrations_id_seq", lastValue: 2 },
      ],
    });
    const client = queueClient([
      { schemaName: "drizzle", sequenceName: "__drizzle_migrations_id_seq", lastValue: "2" },
    ]);
    await expect(assertSequenceState(client, manifest)).resolves.toBeUndefined();
  });
});
