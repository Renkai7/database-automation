---
phase: 05-ci-pipeline-gate
fixed_at: 2026-09-09T16:23:00Z
review_path: .planning/phases/05-ci-pipeline-gate/05-REVIEW.md
iteration: 1
findings_in_scope: 1
fixed: 1
skipped: 3
status: all_fixed
---

# Phase 05: Code Review Fix Report

**Fixed at:** 2026-09-09T16:23:00Z
**Source review:** .planning/phases/05-ci-pipeline-gate/05-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope (`fix_scope: critical_warning` — Critical + Warning only): 1
- Fixed: 1
- Skipped (out of scope by explicit user instruction — Info findings left documented, not fixed): 3

## Fixed Issues

### WR-01: Most `pr-gate.yml` jobs still lack the `timeout-minutes` guard (carried forward from prior WR-03)

**Files modified:** `.github/workflows/pr-gate.yml`
**Commit:** `68b4a22`
**Applied fix:** Added `timeout-minutes: 10` to the five jobs the review identified as missing
the guard — `analyze` (line 27), `tamper-checks` (line 77), `ruleset-config-check` (line 234),
`ruleset-bypass-audit` (line 274), and `migrate` (line 309) — matching the precedent already set
by `test` (`timeout-minutes: 15`) and `test-history` (`timeout-minutes: 20`) in the same file, and
`restore-drill.yml`'s `drill` job (`timeout-minutes: 30`). Each addition carries an inline comment
citing WR-01 and the specific hang risk for that job (WASM parser + `gh pr comment` for `analyze`;
`git log -p`-scale diffing + a `stdio: "inherit"` `pnpm db:generate` child process for
`tamper-checks`; a real Postgres service container for `migrate`), consistent with this project's
"architectural enforcement over remembered caution" convention — the timeout is now a structural
property of the job definition, not something an agent has to remember to add.

10 minutes was chosen as a conservative ceiling above the documented local baselines: the review's
own text notes `test`'s ~1-minute local baseline for the full 531-test suite (now 561 tests) with
a production build, and the other four jobs listed do materially less work (dependency install,
`gh --version`, a single diff/audit/migrate command) than `test` does — 10 minutes leaves generous
headroom without approaching GitHub's 360-minute default ceiling the finding was raised against.

No source/runtime code was touched — this is a GitHub Actions workflow YAML change only. Verified:
- **Tier 1:** re-read the full file after editing; all five `timeout-minutes: 10` lines present,
  surrounding job structure (permissions, services, env, steps) intact and unchanged.
- **Tier 2:** parsed the edited YAML with Python's `yaml.safe_load` (no local `js-yaml` module
  available) — parsed cleanly, no syntax errors introduced.
- **Functional:** `tests/guardrails.test.ts`'s job/context-name assertions (which parse
  `pr-gate.yml`'s job list and names, not `timeout-minutes`) still pass — 21/21 tests green.
- **Full suite:** see Test Suite Results below.

## Skipped Issues (out of scope — Info severity, excluded by `fix_scope: critical_warning`)

The task instructions explicitly directed leaving Info-severity findings (IN-01, IN-02, IN-03)
documented but unfixed in this run. Recorded here for completeness; not attempted.

### IN-01: `audit-history.ts`'s file-path regex still does not strip a trailing `\r`

**File:** `scripts/ci/audit-history.ts:262`
**Reason:** Out of scope — `fix_scope: critical_warning` excludes Info findings; user instructions
explicitly named IN-01 as intentionally left unfixed.
**Original issue:** `NEW_FILE_PATH_PATTERN` captures a trailing `\r` on CRLF-terminated `git log -p`
output, producing paths like `"...0000.sql\r"`. Cosmetic — this tool is advisory/human-reviewed
only, not a gate failure.

### IN-02: `enumerateMigrationFiles` builds a filesystem path from an unvalidated journal `tag` field

**File:** `packages/automation/src/adapter/drizzle-migrations.ts:104-117`
**Reason:** Out of scope — `fix_scope: critical_warning` excludes Info findings; user instructions
explicitly named IN-02 as intentionally left unfixed.
**Original issue:** `entry.tag` from `meta/_journal.json` is interpolated into a filesystem path
with no traversal/character-set validation. Low severity under this repository's current threat
model (no fork PRs, D33; anyone who could add such a journal entry already has repo write access).

### IN-03: `resolveRepository` is duplicated verbatim between `apply-ruleset.ts` and `check-ruleset-config.ts`

**File:** `scripts/ci/apply-ruleset.ts:121-134`, `scripts/ci/check-ruleset-config.ts:214-227`
**Reason:** Out of scope — `fix_scope: critical_warning` excludes Info findings; user instructions
explicitly named IN-03 as intentionally left unfixed.
**Original issue:** Both files independently define an identical `resolveRepository` helper.
Low risk today (simple, stable logic) but the same "two things that must never independently
disagree" pattern this phase otherwise treats seriously elsewhere.

## Test Suite Results

Ran the project's full test suite locally after applying the fix (dev database via
`docker compose`, matching this repository's own `test`/`test-history` CI jobs):

- `pnpm db:up` → Postgres container healthy.
- `pnpm db:migrate` → all 5 journal entries already applied (`skipped`), no drift.
- `pnpm db:seed` → seed completed cleanly.
- `pnpm test` (vitest, includes the real Next.js production build + boot smoke test):
  **52 test files passed, 561 tests passed**, 0 failed. Duration 57.39s.
- `pnpm test:history` (both migration-history axes — empty-database full history,
  existing-database newest-only): **6 test files passed, 14 tests passed**, 0 failed.
  Duration 21.59s.
- `tests/guardrails.test.ts` specifically (job/context-name parity with `pr-gate.yml`,
  re-run in isolation to directly confirm the edited workflow file still parses correctly
  for that test's purposes): **21/21 passed**.

No regressions. Reporting honestly per instructions: no failures were observed in any suite run.

---

_Fixed: 2026-09-09T16:23:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
