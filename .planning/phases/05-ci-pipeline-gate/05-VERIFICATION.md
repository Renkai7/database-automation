---
phase: 05-ci-pipeline-gate
verified: 2026-09-09T20:15:00Z
status: passed
score: 4/4 must-haves verified
covered_files: [".github/rulesets/main-protection.json", ".github/workflows/pr-gate.yml", ".github/workflows/restore-drill.yml", ".planning/REQUIREMENTS.md", ".planning/phases/05-ci-pipeline-gate/05-01-PLAN.md", ".planning/phases/05-ci-pipeline-gate/05-01-SUMMARY.md", ".planning/phases/05-ci-pipeline-gate/05-02-PLAN.md", ".planning/phases/05-ci-pipeline-gate/05-02-SUMMARY.md", ".planning/phases/05-ci-pipeline-gate/05-03-PLAN.md", ".planning/phases/05-ci-pipeline-gate/05-03-SUMMARY.md", ".planning/phases/05-ci-pipeline-gate/05-04-PLAN.md", ".planning/phases/05-ci-pipeline-gate/05-04-SUMMARY.md", ".planning/phases/05-ci-pipeline-gate/05-05-PLAN.md", ".planning/phases/05-ci-pipeline-gate/05-05-SUMMARY.md", ".planning/phases/05-ci-pipeline-gate/05-06-PLAN.md", ".planning/phases/05-ci-pipeline-gate/05-06-SUMMARY.md", ".planning/phases/05-ci-pipeline-gate/05-07-PLAN.md", ".planning/phases/05-ci-pipeline-gate/05-07-SUMMARY.md", ".planning/phases/05-ci-pipeline-gate/05-08-PLAN.md", ".planning/phases/05-ci-pipeline-gate/05-08-SUMMARY.md", ".planning/phases/05-ci-pipeline-gate/05-CONTEXT.md", ".planning/phases/05-ci-pipeline-gate/05-REVIEW.md", "docs/40-ci-gate-merge-attempt.md", "docs/decisions.md", "packages/automation/src/adapter/drizzle-migrations.ts", "packages/automation/src/render/pr-comment.ts", "scripts/ci/analyze-gate.ts", "scripts/ci/apply-ruleset.ts", "scripts/ci/audit-history.ts", "scripts/ci/check-append-only.ts", "scripts/ci/check-ruleset-bypass-audit.ts", "scripts/ci/check-ruleset-config.ts", "scripts/ci/check-schema-drift.ts", "tests/guardrails.test.ts"]
covered_digest: "v1:sha256:99570544f1ff684836493bf473849ac0dd36653cae93673aa8c00e9e2f9cfebd"
behavior_unverified: 0
overrides_applied: 0
---

# Phase 5: CI Pipeline Gate Verification Report

**Phase Goal:** A pull request containing a destructive migration cannot be merged — not because
CI fails quietly, but because the repository owner is structurally unable to click around it.
**Verified:** 2026-09-09
**Status:** passed
**Re-verification:** No — initial verification

## Method

This phase makes a falsifiable, outward-facing claim about a real, live GitHub repository, so
verification was done primarily against the live repository (`gh api`, `gh pr checks`, `gh pr
view`) rather than against planning documents. Every claim below was independently re-queried
live during this pass, not read back from `docs/40-ci-gate-merge-attempt.md` or `docs/decisions.md`
and trusted. Local evidence (`pnpm test`, targeted `vitest run`, direct file reads) supplements the
live checks. `05-REVIEW.md`'s six findings were checked against the current file contents, not
against the review document's own claims of what was fixed.

## Goal Achievement

### Observable Truths (ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A PR containing a BLOCKED migration fails the required check, and the repo owner — using their own admin/owner permissions — cannot merge it, because the ruleset's bypass list is empty | ✓ VERIFIED | Live `gh api repos/Renkai7/database-automation/rulesets/22668397` (queried fresh during this verification, not read back from docs) returns `enforcement: "active"`, `bypass_actors: []`, `current_user_can_bypass: "never"`. PR #4 (`demo/blocked-drop-ingredients`, a real `drizzle-kit`-generated `DROP TABLE` migration) still exists, closed unmerged; `gh pr checks 4` (re-run live) shows `analyze`, `migrate`, `test`, `test-history` all `fail`. `docs/40-ci-gate-merge-attempt.md` records the owner's verbatim GitHub UI report showing all four labeled "Required" and no bypass/override affordance offered. This is a one-time performed human act (D-18) — its scope is one account, one date, one ruleset config, as the record itself states — but it is independently corroborated here by live API state matching what the record claims, not merely narrated. |
| 2 | Every PR's required checks run the analyzer, both migration history test axes, and the app test suite; the PR shows the classification and reasoning directly on the PR | ✓ VERIFIED | Live ruleset's `required_status_checks` lists exactly `analyze, tamper-checks, test, test-history, migrate, ruleset-config-check` — matches `.github/workflows/pr-gate.yml` job names character-for-character (confirmed by direct comparison, not assumed) and matches `tests/guardrails.test.ts`'s D-11 job/context guardrail (run live: 1/1 passed). `gh pr view 4 --json comments` (re-fetched live) returns the full `Migration Safety Verdict: BLOCKED` sticky comment with per-statement rule ids and rationale, posted directly on the PR. `gh pr view 1` shows exactly one sticky safety-verdict comment (not duplicated across pushes), confirming the `verification: backstop` no-duplicate-comment truth from 05-03-PLAN.md with direct live evidence. |
| 3 | A hand-edited migration file, or an edit to an already-applied migration, is caught mechanically by a CI check | ✓ VERIFIED | PR #5 (`demo/tamper-edit-applied-migration`, one-character edit to an already-applied `.sql` file): `gh pr checks 5` (re-run live) shows `tamper-checks: fail`, all other required checks pass — isolating the failure to the append-only mechanism. PR #6 (`demo/tamper-schema-drift`, a migration generated against a temporarily-edited `schema.ts`): `gh pr checks 6` (re-run live) shows `tamper-checks: fail`. Both PRs closed unmerged (`gh pr list --state all` confirms). |
| 4 | Migrations run as their own isolated pipeline step, never triggered by application container startup | ✓ VERIFIED | `.github/workflows/pr-gate.yml`'s `migrate` job (lines 297+, read directly) has exactly four steps: checkout, pnpm setup, install, `pnpm db:migrate` — no build, boot, or test step. `tests/guardrails.test.ts`'s D-15 guardrail test ("no file in the application's own source... triggers a migration at boot") re-run live: passed. No job in the workflow declares `needs:` (grepped directly — zero matches), matching the plan's must-have that the six checks are order-independent. |

**Score:** 4/4 truths verified (0 present-but-behavior-unverified)

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|---|---|---|---|
| CI-01 | Every PR runs the analyzer, both history test axes, and app tests | ✓ SATISFIED | Truth 2 above; live ruleset required contexts. |
| CI-02 | A BLOCKED classification fails the build | ✓ SATISFIED | PR #4 `analyze: fail` on a real BLOCKED `DROP TABLE`, re-confirmed live. |
| CI-03 | Gate enforced by a ruleset with empty bypass list | ✓ SATISFIED | Truth 1 above; live `bypass_actors: []`, `current_user_can_bypass: "never"`. |
| CI-04 | Classification and reasoning surfaced on the PR itself | ✓ SATISFIED | Truth 2 above; verbatim sticky comment re-fetched live. |
| CI-05 | Hand-edited/re-edited migrations caught mechanically | ✓ SATISFIED | Truth 3 above; PRs #5, #6. |
| CI-06 | Migrations run as an isolated pipeline step, never at app boot | ✓ SATISFIED | Truth 4 above; `migrate` job shape + D-15 guardrail. |

No orphaned Phase 5 requirement IDs found — `.planning/REQUIREMENTS.md` maps exactly CI-01…CI-06
to Phase 5, and every plan (`05-01`…`05-08`) declares at least one of them in its own
`requirements:` frontmatter; all six are accounted for.

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| Live ruleset `required_status_checks` | `.github/workflows/pr-gate.yml` job names | exact string match | WIRED | Verified by direct comparison of the live API response against the workflow file's `name:` fields, and independently by `tests/guardrails.test.ts`'s D-11 test (re-run, passed). |
| `analyze` job | `packages/automation/src/render/pr-comment.ts` | `scripts/ci/analyze-gate.ts` → `gh pr comment` | WIRED | Real PR comments (PR #1, #4) contain the exact rendered output shape (per-statement verdicts, rule ids, rationale, "Introduced by this PR" / "Pre-existing" split). |
| `tamper-checks` job | `scripts/ci/check-append-only.ts`, `scripts/ci/check-schema-drift.ts` | job steps in `pr-gate.yml` | WIRED | Both scripts' real failure messages appear verbatim in `docs/40-ci-gate-merge-attempt.md` and were reproduced live against PR #5/#6 checks during this pass. |
| Ruleset `bypass_actors` | Merge control (GitHub UI) | GitHub's own ruleset engine | WIRED | Live API confirms `current_user_can_bypass: "never"` for the account that performed D-18's merge attempt; matches the owner's verbatim "no bypass offered" report. |
| `apps/recipe-app` source/startup files | migration entry point | (absence checked) | NOT PRESENT (intended) | `tests/guardrails.test.ts` D-15 test re-run: passed — no reference found. |

### Anti-Patterns Found (05-REVIEW.md cross-check against current code, not against the review's own claims)

| Finding | File | Severity | Status now | Evidence |
|---|---|---|---|---|
| CR-01 — `apply-ruleset.ts` never checked `bypass_actors` emptiness, only presence | `scripts/ci/apply-ruleset.ts` | Critical (was) | ✓ FIXED | `gh pr diff 10` shows the `Array.isArray(parsed.bypass_actors) \|\| parsed.bypass_actors.length !== 0` guard added; PR #10 merged (`d0c3c05` referenced in STATE.md history; verified via `gh pr list` showing PR #10 MERGED and its diff read directly). |
| WR-01 — `check-ruleset-config.ts`'s context-list check was vacuous on an empty list | `scripts/ci/check-ruleset-config.ts` | Warning (was) | ✓ FIXED | Diff shows `extractExpectedContexts` now throws on `contexts.length === 0`, exported and split out for unit testing. |
| WR-02 — `analyze-gate.ts` could post a "still fails" comment on a passing job | `scripts/ci/analyze-gate.ts` | Warning (was) | ✓ FIXED | Diff shows `resolveAnalyzeGateOutcome` now derives `commentBody` and `jobExitCode` from one function so they cannot disagree. |
| WR-03 — most `pr-gate.yml` jobs lack `timeout-minutes` | `.github/workflows/pr-gate.yml` | Warning | ⚠️ OPEN (owner-deferred) | Confirmed live: `analyze`, `tamper-checks`, `ruleset-config-check`, `ruleset-bypass-audit`, `migrate` still carry no `timeout-minutes`; only `test` (15) and `test-history` (20) do. Operational-cost risk (Actions minutes on a hang), not a safety/merge-gate weakness — a hung job still fails to report success and a required check that never succeeds still blocks merge. |
| IN-01 — `audit-history.ts` doesn't strip trailing `\r` on CRLF diff output | `scripts/ci/audit-history.ts` | Info | ⚠️ OPEN (owner-deferred) | Confirmed live: `NEW_FILE_PATH_PATTERN` unchanged, no `\r$` strip added. Cosmetic — this tool is advisory/human-reviewed, not a gate. |
| IN-02 — `enumerateMigrationFiles` builds a path from an unvalidated journal `tag` | `packages/automation/src/adapter/drizzle-migrations.ts` | Info | ⚠️ OPEN (owner-deferred) | Confirmed live: no `SAFE_TAG_PATTERN` guard present. Low severity per the review's own reasoning (no fork PRs today; fails hard rather than silently on a bad path). |

No `TBD`/`FIXME`/`XXX` debt markers found in any script or workflow file touched by this phase.

### Behavioral / Live Spot-Checks

| Check | Command | Result | Status |
|---|---|---|---|
| Full test suite | `pnpm test` | 52 files / 561 tests passed | ✓ PASS |
| D-11 ruleset↔job-name guardrail | `vitest run tests/guardrails.test.ts -t "the ruleset's required-check contexts..."` | 1 passed | ✓ PASS |
| All guardrails | `vitest run tests/guardrails.test.ts` | 21 passed | ✓ PASS |
| Live ruleset state | `gh api repos/Renkai7/database-automation/rulesets/22668397` | `enforcement: active`, `bypass_actors: []`, `current_user_can_bypass: never` | ✓ PASS |
| Live repo visibility | `gh repo view --json visibility` | `PUBLIC` | ✓ PASS |
| PR #4 checks (BLOCKED demo) | `gh pr checks 4` | analyze/migrate/test/test-history fail; tamper-checks/ruleset-config-check pass | ✓ PASS (matches record) |
| PR #5 checks (append-only tamper demo) | `gh pr checks 5` | tamper-checks fail, all else pass | ✓ PASS (matches record) |
| PR #6 checks (schema-drift tamper demo) | `gh pr checks 6` | tamper-checks fail (cascades to analyze/migrate/test/test-history, expected: the new migration DROP COLUMN also gets classified) | ✓ PASS |
| PR #10 checks (review-fix PR) | `gh pr checks 10` | all required checks pass | ✓ PASS |
| PR #4 sticky comment content | `gh pr view 4 --json comments` | verbatim BLOCKED verdict with rule ids/rationale | ✓ PASS |
| PR #1 comment count | `gh pr view 1 --json comments` | exactly one safety-verdict comment | ✓ PASS |

### Honest Residual Limits (assessed, not hidden — per this phase's own documentation standard)

These do not fail any roadmap success criterion, but are recorded here plainly because the
verification brief asked for an honest assessment rather than rediscovery:

1. **D31's trade (accepted, documented by the owner):** the empty-bypass-list property is enforced
   by GitHub's own ruleset engine independently of any CI check — this is what Truth 1 actually
   observed and what makes the gate real. But *continuous automated re-verification* that
   `bypass_actors` stays empty is no longer a required, merge-blocking check; it is now only the
   advisory `ruleset-bypass-audit` job (fails loudly, does not block a merge) plus the one-time D26
   observation. Confirmed live during this pass: `ruleset-bypass-audit` is a real job in
   `pr-gate.yml` and is *not* in the live ruleset's `required_status_checks` list. If someone with
   repository-admin access edited the live ruleset to add a bypass actor, no required check would
   catch it before a PR could merge — only the advisory job's red run would be visible, and only if
   read. This is `docs/decisions.md` D31's own stated limit, not a new finding, and it does not
   contradict the roadmap's success criterion 1 (which is about the bypass list being empty at the
   moment of the demonstrated merge attempt — independently confirmed still true, live, during this
   verification).
2. **"Never-reporting required check blocks a merge" remains UNKNOWN by design** — only the
   failing-check case was provoked (Observation 1); a never-reporting context was deliberately not
   provoked because doing so risks permanently blocking every future PR. Documented honestly in
   `docs/decisions.md` D33 as UNKNOWN, not silently assumed.
3. **WR-03/IN-01/IN-02** (table above) are real, still-open, owner-deferred findings from
   `05-REVIEW.md` — none of the three weakens the merge gate itself; they are operational-cost,
   cosmetic, and defense-in-depth items respectively, each with a recorded reason for deferral.

None of these three items is a gap against this phase's roadmap success criteria; they are
recorded for transparency, matching this project's own "mark unverified things UNKNOWN, don't
overclaim" standard.

### Human Verification Required

None. The one truth that is inherently about a specific human account's experience (Truth 1,
CI-03) was already performed by the repository owner and recorded with verbatim evidence
(`docs/40-ci-gate-merge-attempt.md`), and this verification pass independently re-confirmed the
live GitHub state underlying that record (fresh `gh api` calls, not a re-read of the document)
rather than accepting the narrative alone.

### Gaps Summary

No gaps. All 4 roadmap success criteria are verified true against the live repository, not merely
against planning documents. All 6 requirement IDs (CI-01…CI-06) are satisfied with cited live
evidence. The code review's one Critical and two of three Warnings were confirmed fixed in the
current code (PR #10, merged); the remaining three findings (WR-03, IN-01, IN-02) are confirmed
still open but are owner-deliberately-deferred, non-blocking to the phase's core safety claim, and
already documented with reasons — not silently missed.

---

_Verified: 2026-09-09_
_Verifier: Claude (gsd-verifier)_
