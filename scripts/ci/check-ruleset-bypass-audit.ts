// D-05 (05-CONTEXT.md), docs/decisions.md D30/D31 -- the owner's split decision. This module is
// the other half of what `check-ruleset-config.ts` used to do alone: it asserts `bypass_actors` is
// present and empty on every ruleset targeting `refs/heads/main`, using the identical, unmodified
// `assertBypassListEmpty` function `check-ruleset-config.ts` still exports -- imported, never
// reimplemented, so the fail-closed behavior (never passes on an absent, `null`, or non-array
// field) cannot drift between the two call sites.
//
// WHY THIS IS ITS OWN, SEPARATE, NON-REQUIRED JOB (`ruleset-bypass-audit` in
// `.github/workflows/pr-gate.yml`), NOT PART OF THE REQUIRED `ruleset-config-check`:
// `docs/decisions.md` D30 confirmed live that a workflow's own `GITHUB_TOKEN` cannot observe
// `bypass_actors` AT ALL under this repository's current permission model -- not merely
// insufficient permission, no declarative path in a workflow's `permissions:` block to request it
// either. A REQUIRED status check that can never succeed under that model blocks every pull
// request permanently, including the ones this project's own gate exists to let through. The
// owner's decision (D31): keep `ruleset-config-check` required, narrowed to what `contents: read`
// can genuinely observe (enforcement active, every required rule type and context present); move
// this specific, permission-gated assertion here, to a job that runs on every pull request and
// fails LOUDLY AND VISIBLY, but is deliberately absent from
// `.github/rulesets/main-protection.json`'s `required_status_checks` list, so its failure is
// visible without being able to deadlock every future pull request the way the merged assertion
// did on PR #3.
//
// THE HONEST LIMIT, RECORDED PLAINLY: the empty-bypass-list property is no longer continuously
// verified as a hard merge gate. It is verified continuously only here, in an advisory job whose
// failure does not block a merge, and by the one-time performed observation already recorded in
// `docs/decisions.md` D26 (`bypass_actors` read back present and empty via the owner's own
// admin-scoped credential at the moment the ruleset was applied). This module must never be
// described, in a log message, a comment, or a decision record, as making the merge gate stronger
// than that.
//
// Reads no process.argv -- every command in this repository refuses arguments (01-CONTEXT.md
// D-16, 02-CONTEXT.md D-06). Never terminates the process directly -- sets process.exitCode once
// run() settles, matching every other scripts/*.ts entry point in this repo.
import {
  assertBypassListEmpty,
  fetchMatchingRulesetDetails,
  resolveRepository,
} from "./check-ruleset-config";
import { safeErrorMessage } from "../log";

/**
 * Runs `assertBypassListEmpty` against every ruleset targeting `refs/heads/main`. If no ruleset
 * targets `main` at all, that is itself a failure -- there is no bypass list to audit, which is
 * worse than an audit finding, not a pass (mirrors `check-ruleset-config.ts`'s own identical
 * refusal). Collects every ruleset's failure rather than stopping at the first, so a second
 * ruleset added alongside `main-protection` cannot hide a non-empty bypass list behind the first
 * one's success.
 */
export async function runCheckRulesetBypassAudit(): Promise<void> {
  const repository = await resolveRepository();
  const matching = await fetchMatchingRulesetDetails(repository);

  if (matching.length === 0) {
    throw new Error(
      `[ruleset-bypass-audit] No ruleset on ${repository} targets "refs/heads/main" -- there is no ` +
        "bypass list to audit. This is a failure, not a pass.",
    );
  }

  const failures: string[] = [];
  for (const { summary, detail } of matching) {
    try {
      assertBypassListEmpty(detail);
    } catch (error) {
      failures.push(`ruleset "${summary.name}" (id ${summary.id}): ${safeErrorMessage(error)}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `[ruleset-bypass-audit] ${failures.length} ruleset(s) failed the bypass-list audit. ` +
        "ADVISORY ONLY (docs/decisions.md D30/D31): this job is deliberately NOT a required " +
        "status check -- a workflow's own GITHUB_TOKEN cannot observe bypass_actors at all under " +
        "this repository's current permission model, so this failure does not block a merge. The " +
        "empty bypass list is verified continuously only here and by the one-time observation in " +
        `docs/decisions.md D26:\n${failures.join("\n")}`,
    );
  }
}

if (import.meta.main) {
  runCheckRulesetBypassAudit()
    .then(() => {
      process.exitCode = 0;
      console.log(
        "[ruleset-bypass-audit] bypass_actors confirmed present and empty on every ruleset " +
          "targeting main. ADVISORY ONLY -- this job is not a required status check " +
          "(docs/decisions.md D30/D31).",
      );
    })
    .catch((error: unknown) => {
      console.error(safeErrorMessage(error));
      process.exitCode = 1;
    });
}
