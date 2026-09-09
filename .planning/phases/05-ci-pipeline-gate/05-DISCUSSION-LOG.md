# Phase 5: CI Pipeline Gate - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-09
**Phase:** 5-CI Pipeline Gate
**Areas discussed:** Repo/remote/ruleset reality, What CI does with REVIEW REQUIRED, Tamper detection (CI-05), CI job shape & PR surface

---

## Repo, remote & ruleset reality

### Where does the GitHub repository come from?

| Option | Description | Selected |
|--------|-------------|----------|
| Push to GitHub in this phase | Creating the remote and pushing is Phase 5's first task; criterion 1 requires actually opening a PR | ✓ |
| Repo already exists, remote not wired | Treat pushing as a config step | |
| Build workflows now, wire GitHub later | Defers the remote, ruleset and PR demonstration | |

**User's choice:** Push to GitHub in this phase
**Notes:** Scouting found `git remote -v` empty — 234 commits, one branch (`main`), no `.github/` directory. CI-03 had no repository to attach a ruleset to.

### Public or private?

| Option | Description | Selected |
|--------|-------------|----------|
| Public repo | Rulesets free on public repos; removes plan-tier risk; also resolves the Phase 7 environment-bypass blocker | ✓ |
| Private repo, verify the tier first | Verify hands-on whether an empty-bypass ruleset is enforceable on this account | |
| Private, upgrade the plan if needed | Pay for Team rather than weaken the gate | |

**User's choice:** Public repo
**Notes:** Framed explicitly as a capability question, not a preference. The owner's actual GitHub plan tier remains UNKNOWN and is not assumed anywhere — going public is what makes it not matter.

### Handling 234 commits becoming world-readable

| Option | Description | Selected |
|--------|-------------|----------|
| Audit history before the first push | Blocking scan of full history for credentials, hostnames, IPs, operational detail | ✓ |
| Audit HEAD only | Faster; assumes nothing sensitive ever entered a later-removed commit | |
| Fresh repo, squash the history | Zero leak risk; destroys the GSD audit trail and dangles cited commit SHAs | |

**User's choice:** Audit history before the first push
**Notes:** Publishing is one-way; a repository can be made private again but anything published may already be cloned or indexed.

### What does the ruleset cover?

| Option | Description | Selected |
|--------|-------------|----------|
| Block direct push + require PR + required checks, empty bypass | The only shape satisfying criterion 1; every `.planning/` commit now needs a PR | ✓ |
| Same, but doc-only paths skip the heavy checks | Faster loop; a required check reporting success without running risks becoming the bypass | |
| Gate PRs only; keep direct push to main | Leaves the exact hole the phase exists to close | |

**User's choice:** Block direct push to main + require PR + required checks, empty bypass
**Notes:** The path-filter option was declined, so the `.planning/` documentation workflow changes for every subsequent GSD phase in this repository. Recorded in CONTEXT.md D-04 rather than left to be discovered as friction.

### Ruleset drift — the owner can edit their own ruleset

| Option | Description | Selected |
|--------|-------------|----------|
| A CI check asserts the ruleset config | Queries the API and fails if the bypass list is non-empty or a required check was removed | ✓ |
| Record it honestly, build nothing | Consistent with D12's bypassability spectrum; cheapest | |
| Check it, and snapshot the config into the repo | Strongest evidence trail; most moving parts and a refresh discipline | |

**User's choice:** A CI check asserts the ruleset config
**Notes:** The check's honest limit was stated when the option was offered and is carried into CONTEXT.md D-05 — it runs inside the thing it audits, so it raises the cost of tampering and makes it visible without making it impossible.

---

## What CI does with REVIEW REQUIRED

### What should the required check do with a REVIEW REQUIRED verdict?

| Option | Description | Selected |
|--------|-------------|----------|
| Passes the check, surfaced loudly on the PR | Mirrors 04-CONTEXT D-05: BLOCKED is the wall; a second wall weakens the first | ✓ |
| Fails the check; a label unblocks it | Forces a deliberate act, but is an override path built in this exact phase | |
| Fails outright, no unblock path | Would make the correct backfill-then-SET-NOT-NULL shape permanently unmergeable | |

**User's choice:** Passes the check, surfaced loudly on the PR
**Notes:** Closes the question 03-CONTEXT and 04-CONTEXT both explicitly deferred to Phase 5. No override path is built, so AUD-04's per-rule override-frequency counting stays Phase 7 — nothing to count.

### Which SQL does the PR check classify?

| Option | Description | Selected |
|--------|-------------|----------|
| Whole history authoritative; PR surface separates new from pre-existing | Total authority, legible output | ✓ |
| Only migrations this PR adds or modifies | Cleanest signal; trusts an ungated history | |
| Whole history, flat, no diff-scoping | Simplest; `0001` becomes wallpaper on every PR | |

**User's choice:** Asked for a recommendation, then confirmed the first option.
**Notes:** Recommendation given with four grounds: (1) the runner already classifies everything, so a narrower check would recreate the classify-upstream/execute-downstream split D12 closes; (2) 04-CONTEXT D-07 already rejected the same shape in its own domain; (3) all 234 commits predate the gate; (4) the analyzer is a pure in-process function over four small files, so cost is nil. The alarm-fatigue objection was answered as a presentation problem, solved in the comment's grouping rather than by shrinking the check's authority.

### Is the CI verdict recorded durably?

| Option | Description | Selected |
|--------|-------------|----------|
| Displayed only — GitHub is the record | Nothing built; consistent with 04-CONTEXT D-19's placement of durable state | ✓ |
| Also write a run artifact | Cheap, but expires on GitHub retention and would be mistaken for an audit trail | |
| Commit verdicts into the repo | Durable, but needs CI push rights to main — against the ruleset just decided | |

**User's choice:** Displayed only — GitHub is the record
**Notes:** Phase 7 builds the real audit log. D-08 must not be described as one.

---

## Tamper detection (CI-05)

**Grounding fact established during discussion:** `apps/recipe-app/drizzle/meta/_journal.json` carries no content hash — only `idx`, `version`, `when`, `tag`, `breakpoints`. The sha256 lives only in `drizzle.__drizzle_migrations`, which this phase has no shared database to read.

### How should CI catch each of criterion 3's two offences?

| Option | Description | Selected |
|--------|-------------|----------|
| Two checks: git append-only + schema-drift | Merge-base diff for already-applied edits; full-history-then-generate-produces-nothing for hand-edits | ✓ |
| Append-only + a committed hash lockfile | Lockfile lives in the same PR the author controls, so its strength still comes from the git rule | |
| Append-only only | Leaves criterion 3's first clause only partially satisfied | |

**User's choice:** Two checks: git append-only + schema-drift
**Notes:** The drift check compares emptiness of output, never drizzle's random migration names, and correctly ignores `0003_backfill_steps_timer_label.sql` (a legitimate hand-authored Phase 4 backfill that yields no schema diff).

### How strict is the append-only rule for the journal?

| Option | Description | Selected |
|--------|-------------|----------|
| SQL strictly append-only; journal append-only at entry level | Closes the renumber-the-journal dodge without blocking normal work | ✓ |
| SQL append-only; journal unrestricted | Leaves deleting an entry as a way to re-run a modified file | |
| Both strict, with an explicit escape for reverts | Handles the D-32 workflow, but is an override path | |

**User's choice:** SQL files strictly append-only; journal append-only at the entry level
**Notes:** Consequence recorded in CONTEXT.md D-10 — Phase 4's D-32 revert (deleting a generated migration and its journal entry) would be refused if attempted through a PR.

### The same-PR desync attack named in SUMMARY.md

| Option | Description | Selected |
|--------|-------------|----------|
| Already covered structurally — verify and record it | `floor.ts` self-checks plus required-check names living in the ruleset, not the workflow | ✓ |
| That, plus flag safety-relevant paths on the PR | Extra visibility for a solo author-reviewer | |
| Add a hard rule against the combination | Would block legitimate work; the shape REQUIREMENTS.md already rejects for ALTER | |

**User's choice:** Already covered structurally — verify and record it
**Notes:** The load-bearing property is that a required check which never reports blocks the merge rather than passing it.

---

## CI job shape & PR surface

### Which runners?

| Option | Description | Selected |
|--------|-------------|----------|
| ubuntu-latest only | Docker and Testcontainers work natively; free minutes on a public repo | ✓ |
| ubuntu-latest, plus a Windows job for the fast suite | Catches Windows-only regressions in CI at roughly double the fast-suite time | |
| windows-latest as primary | Not viable — Windows runners cannot run Linux containers, so neither CI-01 axis could run | |

**User's choice:** ubuntu-latest only
**Notes:** Stated honestly in CONTEXT.md D-12 — a Windows-only regression will surface on the dev machine, not in CI. The constraint is capability, not cost.

### Which suites are required?

| Option | Description | Selected |
|--------|-------------|----------|
| Required: analyzer + test + test:history. Drill on a schedule | Exactly what CI-01 names; relieves the 30-day staleness gate from remembered action | ✓ |
| All four required on every PR | Strongest per-PR evidence; slowest suite on every doc-only PR | |
| Required set only; drill stays local | Nothing new to build; leaves the confirmed operational risk dependent on memory | |

**User's choice:** Required: analyzer + test + test:history. Drill runs on a schedule, not per-PR.
**Notes:** Follows 02-CONTEXT D-16's reasoning about slow Docker suites in the fast path.

### What does CI-06's isolated migration step target?

| Option | Description | Selected |
|--------|-------------|----------|
| A dedicated migrate job against a CI Postgres service | Runs the real `pnpm db:migrate` entry point; Phase 6/7 add an environment to an existing shape | ✓ |
| The history suite is the migration step | Least to build; a step named `test:history` does not read as one | |
| Structural evidence only | Closes a real gap but satisfies only criterion 4's second clause | |

**User's choice:** A dedicated migrate job against a CI Postgres service
**Notes:** A service container reachable as `127.0.0.1:5432/recipe_dev` satisfies `assertLocalDevelopmentTarget` honestly with no loosening. The startup-migration guardrail from the third option was folded in separately as CONTEXT.md D-15, since scouting confirmed `tests/guardrails.test.ts` covers init-script mounts but not the app's own boot path.

### How does the classification reach the PR?

| Option | Description | Selected |
|--------|-------------|----------|
| A sticky PR comment, rewritten in place | Unambiguously satisfies "directly on the PR"; needs `pull-requests: write` | ✓ |
| A Check Run with summary and inline annotations | Best line-level reading; lives in the Checks tab rather than the conversation | |
| Both | Strongest reading of criterion 2; two renderings that must not disagree | |

**User's choice:** A sticky PR comment, rewritten in place each run
**Notes:** Fork PRs receive a read-only token and would fail to post — recorded as a known limit, not solved, since it is not a case that exists on a solo repository.

### How is criterion 1 demonstrated?

| Option | Description | Selected |
|--------|-------------|----------|
| Owner performs it; a docs/ record written from the actual attempt | Follows 02-CONTEXT D-10's performed-restore precedent | ✓ |
| That, plus an automated ruleset assertion | The pairing of a performed act and a continuous check | |
| Fully automated merge-refusal test | Needs a repo-write token in CI — a credential-holding automation inside a credential-minimising repo | |

**User's choice:** Owner performs it; a docs/ record is written from the actual attempt
**Notes:** The ruleset assertion check was already decided independently in the repo/ruleset area, so both stand — D-18 proves the property was true once by observation, D-05 keeps proving it.

### Where does the PR-comment renderer live?

| Option | Description | Selected |
|--------|-------------|----------|
| Pure renderer in packages/automation, GitHub plumbing in a script | Mirrors the pure-core/thin-adapter seam; unit-testable with no network | ✓ |
| Entirely in a script, outside the package | Nothing new enters the extractable artifact; next app rewrites the rendering | |
| Consume the existing --json output as-is | Least code; formatting logic ends up untested inside YAML | |

**User's choice:** Pure renderer in packages/automation, GitHub plumbing in a script
**Notes:** Preserves 04-CONTEXT D-27/D-28's extraction seam and 03-CONTEXT D-11's filesystem-free core.

---

## Claude's Discretion

- Workflow file layout, job names and granularity, and the choice of required-check names (they become ruleset configuration, so they must be stable).
- pnpm and Docker layer caching; whether a `concurrency` / cancel-in-progress policy is set.
- The append-only diff mechanics: merge-base derivation, `fetch-depth`, script vs inline step.
- The journal entry-comparison implementation and where its tests live.
- The sticky comment's markdown structure, its hidden find-and-update marker, and the zero-findings rendering.
- The scheduled drill workflow's cadence and its failure behaviour (it has no PR to comment on).
- How the migrate job provisions `recipe_dev` on the service container so the pin is satisfied without touching `scripts/env.ts`.
- The filename and location of the criterion-1 record, following the `docs/` numbering convention.
- Whether the history audit is scripted or manual, and what tooling it uses.
- Whether the recipe app gains a build or lint check in CI (it currently has none).

## Deferred Ideas

- Approval/override path for REVIEW REQUIRED with per-rule override-frequency counting (AUD-04) — Phase 7.
- The real audit log (AUD-01 … AUD-04) — Phase 7.
- Environment protection rules and the production self-approval gate — Phase 7. Public visibility now makes disabling their bypass possible, converting a recorded blocker into a resolved input.
- Fork pull requests — the sticky comment cannot post under a read-only token.
- A Windows CI job for the fast suite — declined for this phase.
- Check-run annotations on the exact lines of offending SQL — considered alongside the sticky comment and not taken.
- A committed sha256 lockfile for migrations — declined as ceremony over the git rule.
- A reusable `workflow_call` workflow for other applications — explicitly not this phase (PROJECT.md forbids building the reusable controller before one application proves the pipeline).
- `eugene trace` lock verification (ADV-01) and live schema-drift detection (ADV-02) — both need a real remote database.
- A build or lint check for the recipe app — left to discretion; not required by CI-01.
