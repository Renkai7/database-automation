// D-13 (03-CONTEXT.md): the corpus manifest schema -- the expected-outcome contract for every
// .sql fixture under packages/automation/test/corpus/. Kept separate from
// src/classifier/rules-schema.ts deliberately (03-RESEARCH.md's "Open Questions (RESOLVED)"
// item 3): one schema validates policy that ships with the library (rules.json), the other
// validates test expectations that never ship with it -- collapsing them would couple the
// extractable package to its own test fixtures. Mirrors this repo's established
// schema-plus-JSON-file style (scripts/backup-manifest.ts: small composed z.object schemas,
// .min(1), explicit human-readable messages).
//
// No expected verdict, rule id, or classification hint may ever live in a SQL comment anywhere
// in the corpus (D-13, enforced separately by corpus.test.ts) -- this manifest is the ONLY
// place a fixture's expected outcome is recorded, which is the entire point of a suite whose
// own purpose includes proving comments are inert.
import { readFileSync } from "node:fs";
import { z } from "zod";

/** D-13: the four kinds of fixture this shared corpus holds. `catalogue` is this plan's own
 * scope (03-05-PLAN.md) -- the generic, app-agnostic BLOCKED/REVIEW_REQUIRED/SAFE set.
 * `adversarial`, `app-shaped` and `real-migration` are reserved for plan 03-06, which extends
 * this same manifest rather than building a second one. */
const CorpusGroupSchema = z.enum(["catalogue", "adversarial", "app-shaped", "real-migration"]);

/** Plan 03-06's own two-half adversarial-pairing vocabulary, reserved here so this schema does
 * not need to change shape when that plan adds entries using it. */
const CorpusHalfSchema = z.enum(["hidden-executable", "inert-text-only"]);

const VerdictSchema = z.enum(["SAFE", "REVIEW_REQUIRED", "BLOCKED"]);

const CorpusEntrySchema = z.object({
  // Repository-root-relative, never corpus-directory-relative: plan 03-06 references the two
  // real Drizzle migrations (apps/recipe-app/drizzle/*.sql) in place rather than copying them
  // into the corpus directory and letting the copy drift from the real file.
  file: z.string().min(1),
  group: CorpusGroupSchema,
  expectedVerdict: VerdictSchema,
  // Allowed to be empty: the D-06 unmatched-statement case legitimately produces no rule ids at
  // all, and the corpus must be able to pin that outcome as precisely as any matched one.
  expectedRuleIds: z.array(z.string()),
  // Required, not optional: a fixture whose purpose cannot be stated in one sentence is not
  // pulling its weight in the corpus (mirrors rules-schema.ts's required `rationale`).
  why: z.string().min(1),
  pairId: z.string().optional(),
  half: CorpusHalfSchema.optional(),
});

export const CorpusManifestSchema = z.object({
  entries: z.array(CorpusEntrySchema),
});

export type CorpusEntry = z.infer<typeof CorpusEntrySchema>;
export type CorpusManifest = z.infer<typeof CorpusManifestSchema>;

/**
 * Reads and validates the corpus manifest at `path`. Throws an Error naming the offending row
 * (its array index and the failing field, via zod's own issue path) on any schema violation, or
 * on a read/JSON-parse failure -- loudly, never a partial accept, matching
 * scripts/backup-manifest.ts's readManifest precedent.
 */
export function loadCorpusManifest(path: string): CorpusManifest {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    throw new Error(`Could not read corpus manifest file at "${path}".`);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new Error(`Corpus manifest file at "${path}" is not valid JSON.`);
  }

  const result = CorpusManifestSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new Error(
      `Corpus manifest file at "${path}" failed schema validation: ${result.error.issues
        .map((issue) => `entry ${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return result.data;
}
