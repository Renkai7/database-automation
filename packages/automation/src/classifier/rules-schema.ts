// ANLZ-03/D-03: zod schemas validating the rules file (JSON, required `rationale` per rule).
// A separate module rather than inline validation in classify.ts, deliberately: rules-schema.ts
// has zero knowledge of how a rule is matched or applied -- it only proves the shape of the
// data is trustworthy before classify.ts or floor.ts ever reads a field off it, matching this
// repo's established zod schema-plus-JSON-file style (scripts/backup-manifest.ts's
// DumpFileSchema/ManifestSchema: small, composed z.object schemas with .min(1) and explicit
// human-readable messages).
//
// No imports beyond zod, no side effects.
import { z } from "zod";
import { RulesFileError } from "../types";

/** D-01: a rule matches StatementFacts by equality or set membership only -- no expressions,
 * no computed conditions. A fact value is therefore a string, a boolean, `null` (equality
 * against an absent value, e.g. `usingIndexName: null` for "no index attached" -- 03-02-PLAN.md
 * task 2's add-unique-constraint rule), or an array of string/boolean (set membership), never a
 * function or a nested object. */
const FactMatchSchema = z.record(
  z.string(),
  z.union([z.string(), z.boolean(), z.null(), z.array(z.union([z.string(), z.boolean()]))]),
);

/** D-04: rename/compatibility rules are their own category, distinct from the lock-hazard
 * rules -- this is a load-bearing distinction for Phase 5's PR rendering, not decoration. */
const RuleCategorySchema = z.enum([
  "irreversible-data-loss",
  "lock-hazard",
  "compatibility",
  "usually-safe",
  "analyzer-integrity",
]);

const RuleSchema = z.object({
  // Stable, hand-assigned kebab-case identifier -- Phase 7's per-rule override-frequency count
  // (PROD-04) keys on this, so it must survive catalogue edits rather than being positional.
  id: z.string().min(1),
  category: RuleCategorySchema,
  match: FactMatchSchema,
  verdict: z.enum(["SAFE", "REVIEW_REQUIRED", "BLOCKED"]),
  // Required, not optional: CI-05 renders the reasoning on the pull request, so "why" has to be
  // structured data the pipeline can render, not a comment a human reads in the file (D-03).
  rationale: z.string().min(1),
});

export const RulesFileSchema = z.object({
  version: z.number().int(),
  rules: z.array(RuleSchema),
  // Optional, top-level, human-readable documentation of a deliberate catalogue exclusion (e.g.
  // 03-CONTEXT.md D-04's lock_timeout/statement_timeout exclusion) -- explicitly kept in the
  // schema (rather than stripped as an unknown key) so the reason survives a load/re-save round
  // trip and Phase 5 can eventually render it, not just this repo's own rules.json.
  notes: z.string().optional(),
});

export type Rule = z.infer<typeof RuleSchema>;
export type RulesFile = z.infer<typeof RulesFileSchema>;

/**
 * Validates a raw parsed-JSON value against RulesFileSchema. Throws RulesFileError carrying
 * zod's own issue list on failure -- loudly, never a partial accept (D-02's "fails schema
 * validation loudly" applies to malformed data just as much as to a weakened floor operation).
 */
export function parseRulesFile(raw: unknown): RulesFile {
  const result = RulesFileSchema.safeParse(raw);
  if (!result.success) {
    throw new RulesFileError(
      `Rules file failed schema validation: ${result.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return result.data;
}
