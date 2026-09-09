// D-04 (05-CONTEXT.md), CI-03, Task 1: the committed, diffable source of truth for the branch
// ruleset is `.github/rulesets/main-protection.json` -- a human can read and review that file in
// a pull request. This script's own job is choosing create vs. update and shelling out to
// `gh api`; it sends that file's contents verbatim (`--input <path>`, never a value reconstructed
// from a parsed-and-re-serialised object), so the exact reviewed JSON is what GitHub receives.
//
// `bypass_actors: []` in the committed payload is D-04's "the bypass list is empty" in the API's
// own vocabulary -- explicitly present and empty, never omitted (GitHub may apply a different
// default when the field is absent). `loadRulesetPayload` refuses to proceed if that field, or
// `enforcement: "active"`, or a non-empty required-status-checks context list, is missing --
// a payload that cannot be trusted must not be sent.
//
// Deliberately has NO delete path. Nothing in this repository scripts the removal of the gate
// (D-04's "one-way in intent" standing); `chooseApplyMethod` returns only a create instruction or
// an update instruction, and no exported function issues a removal request.
//
// Reads GITHUB_REPOSITORY (set automatically inside GitHub Actions) or falls back to
// `gh repo view` for a local run. Reads no process.argv -- every command in this repository
// refuses arguments (01-CONTEXT.md D-16, 02-CONTEXT.md D-06). Never terminates the process
// directly -- sets process.exitCode once run() settles, matching every other scripts/*.ts entry
// point in this repo (packages/automation/src/cli.ts's own header documents the reproduced
// Windows libuv WASM-teardown crash this convention exists to avoid).
import { readFile } from "node:fs/promises";
import { execa } from "execa";
import { safeErrorMessage } from "../log";

/** Repository-relative path to the committed ruleset payload -- the single source of truth this
 * script sends verbatim, and the same path `scripts/ci/check-ruleset-config.ts` reads its
 * expected required-check context list from, so the two can never independently drift. */
export const RULESET_PAYLOAD_PATH = ".github/rulesets/main-protection.json";

export interface RulesetRule {
  type: string;
  parameters?: Record<string, unknown>;
}

export interface RulesetPayload {
  name: string;
  target: string;
  enforcement: string;
  bypass_actors: unknown;
  conditions: { ref_name: { include: string[]; exclude: string[] } };
  rules: RulesetRule[];
}

/**
 * Parses and validates the committed ruleset payload. Throws -- never returns a partially valid
 * result -- when `bypass_actors` is absent (not merely non-empty: D-04 requires it explicitly
 * present and empty), when `enforcement` is not `"active"`, or when the
 * `required_status_checks` context list is empty. A payload that cannot be trusted must not be
 * sent to the API.
 */
export function loadRulesetPayload(text: string): RulesetPayload {
  const parsed = JSON.parse(text) as Partial<RulesetPayload>;

  if (!("bypass_actors" in parsed)) {
    throw new Error(
      '[apply-ruleset] The committed payload has no "bypass_actors" field. D-04 requires it to ' +
        "be explicitly present and empty -- an absent field is not the same as an empty list, " +
        "and GitHub may apply a different default when it is omitted.",
    );
  }
  if (parsed.enforcement !== "active") {
    throw new Error(
      `[apply-ruleset] The committed payload's "enforcement" is "${String(parsed.enforcement)}", ` +
        'not "active". A ruleset that is not actively enforced does not satisfy D-04.',
    );
  }

  const requiredStatusChecksRule = (parsed.rules ?? []).find(
    (rule) => rule.type === "required_status_checks",
  );
  const contexts =
    (requiredStatusChecksRule?.parameters?.required_status_checks as
      | Array<{ context: string }>
      | undefined) ?? [];
  if (contexts.length === 0) {
    throw new Error(
      "[apply-ruleset] The committed payload's required_status_checks context list is empty. A " +
        "ruleset with no required checks does not satisfy D-04.",
    );
  }

  if (!Array.isArray(parsed.rules) || parsed.name === undefined) {
    throw new Error(
      '[apply-ruleset] The committed payload is missing "name" or "rules" -- it cannot be sent.',
    );
  }

  return parsed as RulesetPayload;
}

export type ApplyInstruction = { method: "create" } | { method: "update"; id: number };

/**
 * Chooses create vs. update so re-running this script updates the existing ruleset rather than
 * creating a duplicate. Returns only these two shapes -- there is no third return shape, and (by
 * construction, since this is the only function that decides what `gh api --method` verb to use)
 * no path back to a removal request.
 */
export function chooseApplyMethod(
  existing: ReadonlyArray<{ id: number; name: string }>,
  name: string,
): ApplyInstruction {
  const match = existing.find((ruleset) => ruleset.name === name);
  return match === undefined ? { method: "create" } : { method: "update", id: match.id };
}

async function resolveRepository(): Promise<string> {
  if (process.env.GITHUB_REPOSITORY) {
    return process.env.GITHUB_REPOSITORY;
  }
  const result = await execa("gh", [
    "repo",
    "view",
    "--json",
    "nameWithOwner",
    "--jq",
    ".nameWithOwner",
  ]);
  return result.stdout.trim();
}

/**
 * Loads and validates the committed payload, lists the repository's existing rulesets, chooses
 * create or update, and sends the committed file's own bytes to `gh api`. Exported so a future
 * caller (e.g. plan `05-08`'s live application) can invoke this without re-spawning the whole
 * module via `import.meta.main`.
 */
export async function applyRuleset(): Promise<void> {
  const payloadText = await readFile(RULESET_PAYLOAD_PATH, "utf-8");
  const payload = loadRulesetPayload(payloadText);

  const repository = await resolveRepository();
  const listResult = await execa("gh", ["api", `repos/${repository}/rulesets`]);
  const existing = JSON.parse(listResult.stdout) as Array<{ id: number; name: string }>;
  const instruction = chooseApplyMethod(existing, payload.name);

  if (instruction.method === "create") {
    await execa("gh", [
      "api",
      "--method",
      "POST",
      "-H",
      "Accept: application/vnd.github+json",
      `repos/${repository}/rulesets`,
      "--input",
      RULESET_PAYLOAD_PATH,
    ]);
    console.log(`[apply-ruleset] Created ruleset "${payload.name}" on ${repository}.`);
    return;
  }

  await execa("gh", [
    "api",
    "--method",
    "PUT",
    "-H",
    "Accept: application/vnd.github+json",
    `repos/${repository}/rulesets/${instruction.id}`,
    "--input",
    RULESET_PAYLOAD_PATH,
  ]);
  console.log(
    `[apply-ruleset] Updated ruleset "${payload.name}" (id ${instruction.id}) on ${repository}.`,
  );
}

if (import.meta.main) {
  applyRuleset()
    .then(() => {
      process.exitCode = 0;
    })
    .catch((error: unknown) => {
      console.error(safeErrorMessage(error));
      process.exitCode = 1;
    });
}
