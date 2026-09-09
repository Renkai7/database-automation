// D-05 (05-CONTEXT.md), CI-03, Task 2: this module continuously re-verifies the live GitHub
// ruleset's configuration, following `scripts/verify-migration-state.ts`'s own precedent -- the
// runner does not trust that it applied its own migrations, it re-queries and refuses if the
// state does not read back as expected; this check applies the identical scepticism to the
// ruleset one layer up.
//
// ITS HONEST LIMIT, STATED HERE AND IN EVERY FAILURE MESSAGE THIS MODULE EMITS: this check runs
// INSIDE the thing it audits. Someone who can edit the ruleset can also delete this check. It
// raises the cost of tampering and makes it visible; it does NOT make tampering impossible. That
// is `docs/decisions.md` D12's bypassability spectrum, and this check sits on it like every other
// gate upstream of the migration runner.
//
// The single most important property this module has: GitHub's own docs state that
// `bypass_actors` is returned only when the calling token has write access to the ruleset ("to
// prevent leaking sensitive information") -- so an omitted field means "cannot confirm", never
// "confirmed empty". `assertBypassListEmpty` fails CLOSED on absence, on `null`, and on a
// non-array, distinguishing "confirmed empty" from "could not confirm" in the message text
// itself, because the warning sign 05-RESEARCH.md names is a check that passes on its very first
// run without ever having been given elevated permissions.
//
// Reads no process.argv -- every command in this repository refuses arguments (01-CONTEXT.md
// D-16, 02-CONTEXT.md D-06). Never terminates the process directly -- sets process.exitCode once
// run() settles, matching every other scripts/*.ts entry point in this repo.
import { readFileSync } from "node:fs";
import { execa } from "execa";
// D-05: reads the same RULESET_PAYLOAD_PATH constant apply-ruleset.ts uses to send
// `.github/rulesets/main-protection.json`, so the expected required-check context list is read
// from that one committed file rather than re-typed here -- the check and the payload can never
// independently drift.
import { RULESET_PAYLOAD_PATH } from "./apply-ruleset";
import { safeErrorMessage } from "../log";

const REQUIRED_RULE_TYPES = [
  "deletion",
  "non_fast_forward",
  "pull_request",
  "required_status_checks",
] as const;

const MAIN_REF = "refs/heads/main";
/** GitHub's own wildcard ref-name conditions that also cover the default branch. */
const MAIN_REF_WILDCARDS = new Set(["~ALL", "~DEFAULT_BRANCH"]);

export interface RulesetSummary {
  id: number;
  name: string;
  conditions?: { ref_name?: { include?: string[]; exclude?: string[] } };
}

export type RulesetDetail = Record<string, unknown>;

/**
 * Fails CLOSED on absence: if `bypass_actors` is not present as the response's own key, throws
 * naming exactly why (GitHub omits the field without sufficient token write access) and states
 * that this is distinct from the list being empty -- this is the exact false-negative shape
 * 05-RESEARCH.md's Pitfall 1 describes, and this assertion exists specifically to refuse it.
 * Also throws for `null` (not confirmed empty) and for a non-array (cannot confirm emptiness at
 * all). Only a genuinely empty array passes.
 */
export function assertBypassListEmpty(ruleset: RulesetDetail): void {
  if (!Object.prototype.hasOwnProperty.call(ruleset, "bypass_actors")) {
    throw new Error(
      '[check-ruleset-config] "bypass_actors" is ABSENT from the API response. GitHub omits this ' +
        "field entirely when the calling token lacks write access to the ruleset -- an absent " +
        'field is NOT the same as an empty list. This check cannot confirm the bypass list is ' +
        "empty when it has no visibility into the field at all; it is refusing to guess.",
    );
  }

  const bypassActors = ruleset.bypass_actors;

  if (bypassActors === null) {
    throw new Error(
      '[check-ruleset-config] "bypass_actors" is null, not an empty array. null is not confirmed empty.',
    );
  }

  if (!Array.isArray(bypassActors)) {
    throw new Error(
      `[check-ruleset-config] "bypass_actors" is not an array (got ${typeof bypassActors}). ` +
        "This check cannot confirm the bypass list is empty from a non-array value.",
    );
  }

  if (bypassActors.length !== 0) {
    throw new Error(
      `[check-ruleset-config] "bypass_actors" is NOT empty -- it carries ${bypassActors.length} ` +
        `bypass actor entr${bypassActors.length === 1 ? "y" : "ies"}. D-04 requires the bypass ` +
        "list to be empty.",
    );
  }
}

/** Throws unless `enforcement` is exactly `"active"` -- GitHub's `"evaluate"` (dry-run) mode
 * reports without gating, which is a gate that does not gate. */
export function assertEnforcementActive(ruleset: RulesetDetail): void {
  if (ruleset.enforcement !== "active") {
    throw new Error(
      `[check-ruleset-config] "enforcement" is "${String(ruleset.enforcement)}", not "active". A ` +
        "ruleset that only evaluates (or is disabled) does not enforce anything.",
    );
  }
}

/**
 * Throws when any of the four required rule types is absent from the live ruleset, or when any
 * string in `expectedContexts` is missing from the live `required_status_checks` context list.
 * Compared as SETS -- the live API returning contexts in a different order is never a failure,
 * and a genuinely missing context is one regardless of ordering.
 */
export function assertRequiredRules(
  ruleset: RulesetDetail,
  expectedContexts: readonly string[],
): void {
  const rules =
    (ruleset.rules as Array<{ type: string; parameters?: Record<string, unknown> }> | undefined) ??
    [];
  const presentTypes = new Set(rules.map((rule) => rule.type));

  for (const requiredType of REQUIRED_RULE_TYPES) {
    if (!presentTypes.has(requiredType)) {
      throw new Error(
        `[check-ruleset-config] Required rule type "${requiredType}" is missing from the live ` +
          "ruleset.",
      );
    }
  }

  const statusChecksRule = rules.find((rule) => rule.type === "required_status_checks");
  const liveContexts = new Set(
    (
      (statusChecksRule?.parameters?.required_status_checks as
        | Array<{ context: string }>
        | undefined) ?? []
    ).map((entry) => entry.context),
  );

  for (const expected of expectedContexts) {
    if (!liveContexts.has(expected)) {
      throw new Error(
        `[check-ruleset-config] Required status check "${expected}" is missing from the live ` +
          "ruleset's required_status_checks. A required check silently removed from the live " +
          "ruleset is exactly what this assertion exists to catch.",
      );
    }
  }
}

/**
 * Returns every ruleset whose `conditions.ref_name.include` covers `refs/heads/main` -- either
 * the literal ref, or one of GitHub's own wildcard forms (`~ALL`, `~DEFAULT_BRANCH`) -- not only
 * the one named `main-protection`. A second ruleset added alongside it, targeting the same
 * branch, must be examined too; a ruleset that does not target `main` is out of scope and simply
 * not returned, never silently merged into the result.
 */
export function rulesetsMatchingMain<T extends RulesetSummary>(rulesets: readonly T[]): T[] {
  return rulesets.filter((ruleset) => {
    const include = ruleset.conditions?.ref_name?.include ?? [];
    return include.some((entry) => entry === MAIN_REF || MAIN_REF_WILDCARDS.has(entry));
  });
}

function loadExpectedContexts(): string[] {
  const text = readFileSync(RULESET_PAYLOAD_PATH, "utf-8");
  const payload = JSON.parse(text) as {
    rules: Array<{ type: string; parameters?: Record<string, unknown> }>;
  };
  const rule = payload.rules.find((entry) => entry.type === "required_status_checks");
  const contexts =
    (rule?.parameters?.required_status_checks as Array<{ context: string }> | undefined) ?? [];
  return contexts.map((entry) => entry.context);
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

async function fetchRulesetSummaries(repository: string): Promise<RulesetSummary[]> {
  const result = await execa("gh", ["api", `repos/${repository}/rulesets`]);
  return JSON.parse(result.stdout) as RulesetSummary[];
}

// The list endpoint and the "get rules for a branch" endpoint both omit `bypass_actors` -- only
// the per-ruleset GET returns it (05-RESEARCH.md Pitfall 1), so every matching ruleset must be
// fetched individually before assertBypassListEmpty can say anything at all.
async function fetchRulesetDetail(repository: string, id: number): Promise<RulesetDetail> {
  const result = await execa("gh", ["api", `repos/${repository}/rulesets/${id}`]);
  return JSON.parse(result.stdout) as RulesetDetail;
}

/**
 * Runs every assertion against every ruleset that targets `main`. If NO ruleset matches `main` at
 * all, that is itself a failure -- the gate is absent, which is worse than misconfigured, not a
 * pass. Collects every ruleset's failure (rather than stopping at the first) so a second ruleset
 * added alongside `main-protection` cannot hide behind the first one's success.
 */
export async function runCheckRulesetConfig(): Promise<void> {
  const expectedContexts = loadExpectedContexts();
  const repository = await resolveRepository();
  const summaries = await fetchRulesetSummaries(repository);
  const matching = rulesetsMatchingMain(summaries);

  if (matching.length === 0) {
    throw new Error(
      `[check-ruleset-config] No ruleset on ${repository} targets "refs/heads/main". The gate is ` +
        "absent -- this is a failure, not a pass.",
    );
  }

  const failures: string[] = [];
  for (const summary of matching) {
    try {
      const detail = await fetchRulesetDetail(repository, summary.id);
      assertBypassListEmpty(detail);
      assertEnforcementActive(detail);
      assertRequiredRules(detail, expectedContexts);
    } catch (error) {
      failures.push(`ruleset "${summary.name}" (id ${summary.id}): ${safeErrorMessage(error)}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `[check-ruleset-config] ${failures.length} ruleset(s) failed verification (this check runs ` +
        "inside the thing it audits -- it raises the cost of tampering and makes it visible, it " +
        `does not make tampering impossible):\n${failures.join("\n")}`,
    );
  }
}

if (import.meta.main) {
  runCheckRulesetConfig()
    .then(() => {
      process.exitCode = 0;
      console.log(
        "[check-ruleset-config] Every ruleset targeting main has an empty bypass list, active " +
          "enforcement, and every required rule and status check. Note: this check runs inside " +
          "the thing it audits and cannot make tampering impossible, only visible.",
      );
    })
    .catch((error: unknown) => {
      console.error(safeErrorMessage(error));
      process.exitCode = 1;
    });
}
