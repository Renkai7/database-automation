# Phase 5: CI Pipeline Gate - Research

**Researched:** 2026-09-09
**Amended:** 2026-09-09 — `## Open Questions` given explicit dispositions during planning; see that
section (now `## Open Questions (RESOLVED)`) for which plan and task owns each. "RESOLVED" there
means the status is recorded and owned, **not** that the answer is known: questions 1 and 2 are
settled by live observation once the repository exists, and question 3 (`generate`'s exit code,
assumption A4) stays **UNKNOWN on purpose** — plan `05-04` deliberately does not depend on it.
**Domain:** GitHub repository rulesets, GitHub Actions CI gating, pull-request-surfaced safety verdicts, migration-file tamper detection
**Confidence:** MEDIUM-HIGH (GitHub ruleset/Actions mechanics are HIGH where an official doc page loaded cleanly; MEDIUM where only a community source or a partial doc excerpt was available — each claim below is tagged individually. Two claims are session-verified live against this repository's own code and are the highest-confidence findings in this document.)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** This phase creates the GitHub remote and pushes. Criterion 1 cannot be proven against a repository that does not exist.
- **D-02:** The repository is public. Rulesets are documented free on public repos; private repos have historically required a paid tier. Going public also resolves the Phase 7 environment-protection-bypass blocker. The owner's actual GitHub plan tier remains UNKNOWN and is not assumed anywhere — going public is what makes it not matter. Reversibility: one-way in effect (publishing, not the visibility toggle, is the irreversible act).
- **D-03:** A full commit-history audit (all 234 commits, not just HEAD) for credentials/hostnames/IPs/Coolify-Hetzner detail is a blocking task before the first push. Squashing history was rejected (destroys the GSD audit trail; specific commit SHAs are cited in existing docs).
- **D-04:** The ruleset blocks direct pushes to `main`, requires a pull request, requires status checks to pass, and has an **empty bypass list**. Every `.planning/` doc commit now needs a branch + PR too. Path-filtered exemptions for doc-only changes were declined (a required check that reports success without running is a second door).
- **D-05:** A CI check asserts the ruleset's own configuration (queries the GitHub API; fails if the bypass list is non-empty, a required check was removed, or direct-push blocking was disabled). Honest limit: this check runs inside the thing it audits — it raises the cost of tampering and makes it visible, it does not make it impossible.
- **D-06:** BLOCKED fails the required check. REVIEW REQUIRED **passes** it, surfaced completely on the PR. No override path is built this phase. A label-based unblock was explicitly rejected.
- **D-07:** The check classifies the **whole committed migration history** on every run; the PR surface separates "introduced by this PR" from "pre-existing, already applied." The check's authority is total; only the human-facing presentation is scoped for legibility.
- **D-08:** The CI verdict is **displayed, not recorded**. The PR comment and the Actions run are the record (GitHub retains both). No workflow artifact upload, no commit-back into the repo (would require CI push rights to `main`, against D-04).
- **D-09:** Two checks for CI-05: (1) **Append-only** — diff the PR against its merge-base with `main`; fail if any existing file under `apps/recipe-app/drizzle/` is modified or deleted (only additions permitted). (2) **Schema drift** — apply the full migration history to an empty database, run `drizzle-kit generate`, fail if it produces a new migration file. A committed sha256 lockfile was rejected as ceremony (lives in the same PR the author controls).
- **D-10:** `.sql` files are strictly append-only; `meta/_journal.json` is append-only **at the entry level** — CI parses both journal versions and fails if any existing entry's `idx`, `tag`, or `when` changed, or if an entry disappeared. This deliberately refuses Phase 4's own D-32 revert workflow if attempted through a PR (recorded as a real behavior change, not a bug).
- **D-11:** The same-PR desync attack (editing `rules.yaml`/workflow files alongside the dangerous migration) is closed structurally, not by a new mechanism: `floor.ts`'s self-checks refuse a weakened rules file at load time; required-check *names* live in the ruleset (not the workflow file), so deleting/renaming a job makes the required check never report — which blocks, not passes.
- **D-12:** `ubuntu-latest` only. Windows runners cannot run Linux containers, so `postgres:17`/Testcontainers cannot work there. A Windows-only regression (`taskkill /T /F` path in `tests/smoke.test.ts`) will surface locally, not in CI — recorded honestly.
- **D-13:** Required on every PR: the analyzer, `pnpm test`, and `pnpm test:history` (both axes). `pnpm test:drill` moves to a **scheduled** workflow, not a per-PR check.
- **D-14:** CI-06 is satisfied by a **dedicated migrate job** running the real `pnpm db:migrate` against a `postgres:17` service container, structurally separate from any job that builds/boots the app. Load-bearing: the service container must be reachable at `127.0.0.1:5432/recipe_dev` so `assertLocalDevelopmentTarget`'s pin is satisfied with **no loosening**.
- **D-15:** Add a guardrail asserting the application's own code never triggers a migration at boot (closes a real, found gap — CI-06's second clause).
- **D-16:** A **sticky comment**, rewritten in place on every run, carrying the complete findings grouped "introduced by this PR" vs "pre-existing." Needs `pull-requests: write`. Known limit: a fork PR gets a read-only token and the comment fails — not a case that exists on a solo repo today, recorded rather than solved.
- **D-17:** The renderer is a **pure function** in `packages/automation` (`AnalysisResult[] → markdown`, no fetch/filesystem/octokit inside the package); the GitHub plumbing lives in a thin script.
- **D-18:** The owner performs the criterion-1 merge attempt **personally**, and a `docs/` record is written from what actually happened. No automated merge-refusal test (would need a repo-write token in CI). D-05's continuous assertion and D-18's one-time performed proof are a deliberate pairing, not redundant.

### Claude's Discretion

- Workflow file layout: one workflow or several; job names/granularity; how required-check names are chosen (they become ruleset config under D-04, so they must be stable).
- Caching strategy for pnpm/Docker layers; whether a `concurrency`/cancel-in-progress policy is set.
- Exact mechanics of D-09's append-only diff: merge-base derivation, `fetch-depth`, script-under-`scripts/` vs inline step.
- The journal entry-comparison implementation for D-10, and where its tests live.
- The sticky comment's markdown structure, hidden marker for find-and-update, zero-findings rendering.
- The scheduled drill workflow's cadence and its no-PR-to-comment-on failure behavior.
- How the D-14 migrate job provisions `recipe_dev` on the service container without touching `scripts/env.ts`.
- Filename/location of D-18's record, following the `docs/` `00-`/`10-`/`20-`/`30-` numbering convention.
- Whether the D-03 history audit is scripted or manual, and what tooling it uses.
- Whether the recipe app gains a build or lint check in CI (currently has none).

### Deferred Ideas (OUT OF SCOPE)

- An approval/override path for REVIEW REQUIRED with override-frequency counting (AUD-04) — Phase 7.
- The real audit log (AUD-01…AUD-04) — Phase 7. D-08's "GitHub is the record" is a deliberate stopgap, must not be described as an audit trail.
- Environment protection rules / the production self-approval gate — Phase 7.
- Fork pull requests — D-16's sticky comment cannot post under a fork's read-only token; revisit only if a contributor appears.
- A Windows CI job for the fast suite — declined by D-12.
- Check-run annotations on exact offending SQL lines — considered, not taken; revisit if the comment proves hard to read.
- A committed sha256 lockfile for migrations — declined by D-09 as ceremony over the git rule.
- A reusable `workflow_call` workflow for other applications (PLAT-01) — explicitly not this phase.
- `eugene trace` in CI (ADV-01) and live-drift detection (ADV-02) — need a real remote database, unchanged from prior phases.
- A build/lint check for the recipe app — left to discretion, not required by CI-01.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CI-01 | Every pull request runs the analyzer, both migration test axes, and the application tests | Job shape section below maps each requirement to a concrete job; `pnpm db:analyze:migrations`, `pnpm test`, `pnpm test:history` are the exact existing commands (`package.json`, verified read this session) — CI-01 wires them, does not rewrite them |
| CI-02 | A BLOCKED classification fails the build | `EXIT_CODES.BLOCKED = 20` (verified `packages/automation/src/types.ts:215-221`) — the analyze job's exit code IS the pass/fail signal, no re-derivation needed in the workflow |
| CI-03 | Gate enforced by a GitHub repository ruleset with an empty bypass list | Ruleset JSON shape, `gh api` creation pattern, and the bypass_actors visibility gotcha documented below |
| CI-04 | Safety classification and reasoning surfaced on the PR itself | `gh pr comment --edit-last --create-if-none` (CITED, cli.github.com) is a zero-new-dependency sticky-comment mechanism fitting D-17's thin-script constraint exactly |
| CI-05 | Hand-edited migration files, and edits to already-applied migrations, detected mechanically | D-09/D-10 code sketches below; the `_journal.json` no-hash grounding fact re-confirmed by direct read this session |
| CI-06 | Migrations run as their own pipeline step, never at application startup | D-14's isolated `migrate` job pattern + D-15's `tests/guardrails.test.ts` extension; `postgres:17` GitHub Actions service-container pattern documented below |

</phase_requirements>

## Summary

This phase is almost entirely GitHub configuration and CI wiring around code Phases 1-4 already built and proved. `db:analyze:migrations --json`, `pnpm test`, and `pnpm test:history` are real, working commands today (verified: `package.json:19-25`) — nothing about *what* they check is new. What is genuinely new: (1) the repository leaving the local machine for the first time (no remote exists — verified live, `git remote -v` returned nothing), (2) a GitHub repository ruleset configured and self-verified as a checked-in, API-driven artifact rather than a click-path, (3) two small tamper-detection checks (D-09/D-10) that did not exist before, because Phase 4's `meta/_journal.json` genuinely carries no content hash (verified live, `apps/recipe-app/drizzle/meta/_journal.json:1-41` — only `idx`/`version`/`when`/`tag`/`breakpoints`), and (4) a pure markdown renderer plus a thin GitHub-plumbing script for the sticky PR comment.

The single most important verified fact from external research: **a required status check that never reports a result blocks the merge — it does not silently pass** (CITED, GitHub Docs troubleshooting page: a workflow skipped by path filtering leaves its check "Pending," and Pending blocks merging). This is exactly what D-11 depends on to close the delete-the-job attack, and it is now confirmed rather than assumed.

The second most important finding is a genuine gotcha nobody stated in `05-CONTEXT.md`: **`GET /repos/{owner}/{repo}/rulesets/{ruleset_id}` only returns the `bypass_actors` field if the calling token has *write* access to the ruleset** (CITED, GitHub REST API docs, "to prevent leaking sensitive information"). D-05's self-check exists specifically to verify the bypass list is empty — if its `GITHUB_TOKEN` lacks sufficient `permissions:` scope, the API will silently omit `bypass_actors` from the response rather than erroring, and a naive check (`bypass_actors ?? []`) would misread "field omitted because I lack permission" as "bypass list is genuinely empty," which is the exact false-negative shape this whole phase exists to prevent. This must be designed around explicitly (fail closed if the field is absent, not present-and-empty) and needs a live check against the real API once the ruleset exists, because that repository does not exist yet.

The third finding is a live, session-verified fact that changes the shape of D-09's schema-drift check: `drizzle-kit generate` **does not need a live database connection** to detect drift — run live this session against this repo's unchanged `schema.ts` with the full committed migration history present, it printed `No schema changes, nothing to migrate 😴` and created no file (confirmed via `git status --porcelain` before and after, both empty). It reads `apps/recipe-app/src/db/schema.ts` and the local `meta/*_snapshot.json` files, not a live database. However — also verified live this session — `apps/recipe-app/drizzle.config.ts` still calls `assertLocalDevelopmentTarget(getDevDatabaseUrl())` at **module load time**, before `generate` ever runs, so the drift-check job still needs `RECIPE_DEV_DATABASE_URL` set to a value satisfying the pin (loopback host, port `5432`, database `recipe_dev`) even though it opens no socket. This means the drift-check job does not strictly need a running `postgres:17` service container, but it does need the env var, which is easy to get wrong in a CI job that skips the `services:` block because "this job doesn't touch the database."

**Primary recommendation:** No new npm dependency for the entire phase. Use the `gh` CLI (preinstalled on GitHub-hosted `ubuntu-latest` runners) for both the ruleset self-check (`gh api repos/{owner}/{repo}/rulesets/...`) and the sticky PR comment (`gh pr comment --edit-last --create-if-none`) — this keeps D-17's "no octokit inside the package" boundary trivially true and avoids adding a third-party marketplace Action (a supply-chain surface this project has otherwise been careful to avoid) purely to post a comment GitHub's own CLI already does natively.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| PR-time safety classification (analyzer) | CI / Backend (pure Node process) | — | No DB, no network — a pure function of committed SQL text, run identically to a local invocation |
| Migration test axes (empty-DB, existing-DB) | CI / Backend + ephemeral DB (Testcontainers) | — | Already built in Phase 4; this phase only wires the existing `pnpm test:history` invocation into a required job |
| Isolated migration execution (CI-06) | CI / Backend + ephemeral DB (service container) | — | Must be a distinct pipeline job, never inside an app-boot process — D-14/D-15 |
| Tamper detection (CI-05) | CI / Backend (git + JSON diff, no DB) | — | Pure file/git operations against the checked-out repo; no database needed for either sub-check |
| Ruleset enforcement (CI-03) | GitHub platform (repository configuration) | CI (self-check job) | The wall itself is GitHub's own merge-button logic, not application code; the CI job only *audits* that config |
| PR-surfaced verdict (CI-04) | CI (thin script) + GitHub platform (PR comment) | Backend (pure renderer in `packages/automation`) | Renderer is pure/testable backend logic; posting is unavoidably an API call, kept in a thin adapter per D-17 |
| Application boot / smoke test | Backend (Next.js app process) | — | Consumes an already-migrated database; must never itself invoke migration tooling (D-15) |

## Standard Stack

### Core (no new npm dependency)

| Tool | Version/Source | Purpose | Why Standard |
|------|-----------------|---------|---------------|
| `gh` CLI | Preinstalled on GitHub-hosted `ubuntu-latest` runners [CITED: GitHub-hosted runner images ship `gh`; this is standard, widely-relied-on runner-image behavior — no dedicated fetch performed this session, flagged for a cheap live confirmation (`gh --version`) as the first step of the first workflow run rather than trusted blind] | Both the ruleset self-check (`gh api`) and the sticky PR comment (`gh pr comment`) | Zero new dependency; authenticates automatically via `GITHUB_TOKEN`/`GH_TOKEN` inside Actions; avoids adding a third-party comment-posting Action |
| `actions/checkout@v4` | GitHub-owned, official | Checks out the PR content for every job | First-party, no external supply-chain risk beyond GitHub itself |
| `pnpm/action-setup@v4` | Official pnpm project Action | Installs pnpm matching `packageManager: "pnpm@10.25.0"` (verified `package.json:5`) before `pnpm install` | Standard, documented pnpm-in-CI pattern |
| `actions/setup-node@v4` | GitHub-owned, official | Installs Node matching the pinned `24.19.0` line (STACK.md, `.claude/CLAUDE.md`) with pnpm cache wiring | First-party |
| `postgres:17` (Docker Hub official image) | Pinned major version (D9/D-12) | `services:` container for jobs that need a live database (`test`, `migrate`) | Matches `docker-compose.yml`'s own pin exactly (verified `docker-compose.yml:13`); Debian-based, not alpine, per D-12/`01-CONTEXT.md` D-12 |

### Alternatives Considered

| Instead of | Could use | Tradeoff |
|------------|-----------|----------|
| `gh pr comment --edit-last --create-if-none` | `marocchino/sticky-pull-request-comment` or `peter-evans/create-or-update-comment` (marketplace Actions) [CITED via WebSearch — both are real, widely-used Actions] | Marketplace Actions add a third-party supply-chain dependency (must be pinned by SHA to be safe) for something `gh` already does natively with zero extra trust surface. Only reach for one of these if `gh pr comment --edit-last`'s "only edits YOUR OWN last comment" semantics prove insufficient (e.g. if multiple bots post comments and ordering matters) — not expected here on a solo repo. |
| Bare GitHub REST API calls via `gh api` | `actions/github-script` (official, runs inline JS with an authenticated Octokit) | `github-script` is a reasonable alternative for the ruleset self-check's JSON parsing, and is first-party (lower risk than a random marketplace Action). `gh api --jq` can do the same parsing without a JS runtime detour; prefer `gh api` for consistency with the sticky-comment mechanism and to avoid a second GitHub-interaction idiom in the same phase. |
| `drizzle-kit generate` as the schema-drift oracle (D-09) | A hand-rolled AST/schema comparator | Rejected implicitly by D-09 itself — reusing drizzle's own "does the committed migration history reconstruct the schema?" check is exactly the tool built for this, and reinventing it duplicates logic that already ships with the pinned `drizzle-kit@0.31.10` (D11). |

**Installation:** None. No `package.json` change is required for this phase's CI wiring itself (the renderer lives inside the already-installed `packages/automation`; everything else is `.github/workflows/*.yml` plus `gh` CLI calls already available on the runner image).

## Package Legitimacy Audit

**No new external packages are introduced by this phase.** The renderer (D-17) is new *code* inside the already-published-internally `packages/automation`, not a new dependency; the PR-comment and ruleset-self-check mechanisms use the `gh` CLI, which ships with the GitHub-hosted runner image rather than being installed via `npm`/`pnpm`. `actions/checkout`, `pnpm/action-setup`, and `actions/setup-node` are first-party GitHub/pnpm-maintained Actions referenced by tag in workflow YAML, not npm packages — they fall outside this gate's `npm view`/`pip index`/`cargo search` scope, but the standard security practice of pinning third-party Actions to a full commit SHA (not just a version tag) is worth a `checkpoint:human-verify` note if the plan chooses a non-first-party Action for any step.

**Packages removed due to `[SLOP]` verdict:** none.
**Packages flagged as suspicious `[SUS]`:** none.

## Architecture Patterns

### System Architecture Diagram

```
PR opened/updated (branch pushed to the new GitHub remote, D-01)
        │
        ▼
GitHub evaluates the repository ruleset (D-04)
  - direct push to main: REJECTED outright (no PR path exists for it)
  - PR merge attempt: BLOCKED until every required check reports "success"
        │
        ├──────────────► Job: analyze  (no DB)
        │                   checkout PR head SHA explicitly
        │                   pnpm db:analyze:migrations --json  →  AnalysisResult[]
        │                   pure renderer (packages/automation) → markdown, split by
        │                     "introduced by this PR" vs "pre-existing" (D-07)
        │                   gh pr comment --edit-last --create-if-none (D-16)
        │                   exit code = EXIT_CODES[worstVerdict]  → BLOCKED fails job (CI-02)
        │
        ├──────────────► Job: tamper-checks  (no DB)
        │                   git diff <base_sha>..<head_sha> -- apps/recipe-app/drizzle/
        │                     → any non-Added path outside meta/_journal.json = FAIL (D-09)
        │                   parse both journal versions, compare existing entries'
        │                     idx/tag/when, fail on any change or disappearance (D-10)
        │                   drizzle-kit generate against full history → any new file = FAIL
        │                     (needs RECIPE_DEV_DATABASE_URL set to the pin, no live DB needed —
        │                      session-verified this research pass)
        │
        ├──────────────► Job: test  (postgres:17 service container, 127.0.0.1:5432/recipe_dev)
        │                   pnpm db:migrate  (applies full history — this run ALSO satisfies
        │                     "migrations invoked by the pipeline," independent of the
        │                     dedicated migrate job below)
        │                   pnpm db:seed
        │                   pnpm test  (fast suite: unit + guardrails + smoke test, which
        │                     boots the real Next.js app against the seeded schema)
        │
        ├──────────────► Job: test-history  (Docker available on the runner; no services: block —
        │                   Testcontainers starts its OWN ephemeral postgres:17 containers)
        │                   pnpm test:history  (both RUN-05/RUN-06 axes, unmodified from Phase 4)
        │
        ├──────────────► Job: migrate  (postgres:17 service container, 127.0.0.1:5432/recipe_dev)
        │                   pnpm db:migrate  — nothing else in this job (D-14: structurally
        │                     separate from any job that builds/boots the app; this is the
        │                     job a reader of the workflow file identifies as "migrations
        │                     run as their own isolated pipeline step," CI-06)
        │
        └──────────────► Job: ruleset-config-check  (D-05, no DB)
                            gh api repos/{owner}/{repo}/rulesets
                            gh api repos/{owner}/{repo}/rulesets/{id} for each ruleset on main
                            assert bypass_actors is present AND === []  (fail CLOSED if the
                              field is absent — see Pitfall below on the write-access gotcha)
                            assert enforcement === "active"
                            assert the pull_request / required_status_checks rule types are
                              present with the expected required-check name list

        All of the above are REQUIRED status checks (D-04) named by stable job `name:` values
        configured into the ruleset's required_status_checks.context list — a job renamed or
        deleted from the workflow file means its named check never reports, which BLOCKS
        merge rather than passing it (verified via GitHub's own troubleshooting docs).

Scheduled, NOT a required check (D-13):
  .github/workflows/restore-drill.yml  — on: schedule, runs pnpm test:drill
```

### Recommended Project Structure

```
.github/
├── workflows/
│   ├── pr-gate.yml           # every job above except the drill; triggers on: pull_request
│   └── restore-drill.yml     # on: schedule; pnpm test:drill, no PR to comment on (D-13 discretion)
└── (rulesets are NOT files — they are API-managed repository config, see below)

scripts/
├── ci/
│   ├── post-pr-comment.ts       # thin adapter (D-17): calls the pure renderer, shells out to `gh pr comment`
│   ├── check-append-only.ts     # D-09 sub-check 1: git diff against base SHA
│   ├── check-journal-entries.ts # D-10: parses both journal versions, compares existing entries
│   └── check-ruleset-config.ts  # D-05: gh api calls + assertions, fails closed on absent bypass_actors

packages/automation/src/
└── render/
    └── pr-comment.ts   # D-17: pure `(AnalysisResult[]) => string` — no fetch, no fs, no octokit
                         # exported from the barrel (src/index.ts) alongside everything else

docs/
└── XX-ci-gate-merge-attempt.md   # D-18's record — filename TBD, following 00-/10-/20-/30- convention
```

**Rulesets are not a checked-in YAML file** — they are repository configuration reachable only via the GitHub UI or the REST API (`POST /repos/{owner}/{repo}/rulesets`). D-05's request to make the ruleset "a checked-in, verifiable artifact rather than a click-path someone remembers" is best satisfied by (a) a script (e.g. `scripts/ci/apply-ruleset.ts` or a plain `.json` payload file committed to the repo) that `gh api`-POSTs the exact desired ruleset body idempotently, run once by the owner as part of D-01's repository setup, and (b) the D-05 job that continuously re-reads and asserts the live config matches. The committed JSON/script is the source of truth a human can diff in review; the live ruleset is what GitHub actually enforces; the D-05 job is what proves the two have not drifted apart.

### Pattern 1: `gh api` for ruleset creation (CI-03)

**What:** A one-time (or idempotent, re-runnable) `gh api` call that creates the branch ruleset with an empty `bypass_actors` array.
**When to use:** Once, during D-01's repository setup, after the D-03 history audit and the initial push.
**Example** (payload shape [CITED: GitHub REST API docs, "Create a repository ruleset"] — field names and endpoint confirmed against the docs; the specific rule-type list and required-check context names below are this project's own choice, not copied from any example):

```bash
# Source: https://docs.github.com/en/rest/repos/rules (endpoint + field shape, CITED)
gh api \
  --method POST \
  -H "Accept: application/vnd.github+json" \
  repos/{owner}/{repo}/rulesets \
  --input - <<'JSON'
{
  "name": "main-protection",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": {
    "ref_name": { "include": ["refs/heads/main"], "exclude": [] }
  },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": { "required_approving_review_count": 0 } },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "analyze" },
          { "context": "tamper-checks" },
          { "context": "test" },
          { "context": "test-history" },
          { "context": "migrate" },
          { "context": "ruleset-config-check" }
        ]
      }
    }
  ]
}
JSON
```

`bypass_actors: []` is what D-04's "the bypass list is empty" means in the API's own vocabulary — not omitting the field (GitHub may apply a different default in that case; the field must be explicitly present and empty). `context` values in `required_status_checks` must exactly match each workflow job's reported check name (see Pitfall below on job `name:` vs job id).

### Pattern 2: The sticky PR comment (CI-04, D-16, D-17)

**What:** A pure renderer producing markdown, invoked by a thin script that finds-and-edits the workflow's own prior comment via `gh pr comment`'s native flags.
**When to use:** Every run of the `analyze` job, after `pnpm db:analyze:migrations --json` produces its output.
**Example** ([CITED: cli.github.com/manual/gh_pr_comment] for the flag semantics; script shape is this project's own):

```bash
# Source: https://cli.github.com/manual/gh_pr_comment — CITED, --edit-last/--create-if-none confirmed
gh pr comment "$PR_NUMBER" \
  --body-file rendered-verdict.md \
  --edit-last \
  --create-if-none
```

`--edit-last` finds the most recent comment made **by the authenticated actor** (the workflow's `GITHUB_TOKEN`-backed `github-actions[bot]` identity) on the PR and replaces its body — this is D-16's "sticky comment, rewritten in place" with zero custom find-and-update logic needed, and zero risk of touching a human's own comment (`gh` will only ever edit its own prior comment). `--create-if-none` handles the first run on a PR, where no prior comment exists. Requires `permissions: pull-requests: write` in the job (D-16's own noted requirement); `gh` reads `GH_TOKEN`/`GITHUB_TOKEN` from the environment automatically inside Actions.

### Pattern 3: Explicit PR-head checkout, never the default merge ref

**What:** Pin `actions/checkout`'s `ref:` to the PR's actual head commit rather than trusting the `pull_request` event's default checkout target.
**When to use:** Every job in `pr-gate.yml` — the analyze, tamper-checks, and any other job reading migration content.
**Why:** For the `pull_request` event, GitHub Actions by default checks out a synthetic merge commit (`refs/pull/<N>/merge`), not the PR branch's own head commit [general GitHub Actions behavior; not independently re-confirmed via a fresh fetch this session — treat as MEDIUM confidence, verify once the repo/workflow exist by comparing `${{ github.sha }}` against `${{ github.event.pull_request.head.sha }}` in a real run]. This repo's own architecture principle — "never trust a value computed one step upstream, re-derive at the point that matters" (D12, D-05's own reasoning) — argues for pinning explicitly:

```yaml
# Illustrative, not copied from an official example
- uses: actions/checkout@v4
  with:
    ref: ${{ github.event.pull_request.head.sha }}
    fetch-depth: 0   # required for git merge-base / diff-against-base to work at all — see Pitfall below
```

### Anti-Patterns to Avoid

- **Treating `bypass_actors` absence in an API response as "the bypass list is empty."** The field is omitted (not returned as `[]`) when the calling token lacks write access to the ruleset (CITED, GitHub REST API docs). A self-check that does `(response.bypass_actors ?? []).length === 0` will silently pass even when it has no real visibility into the bypass list — the exact false-negative shape D-05 exists to prevent. Fail closed: if the field is absent from the response, that is itself a check failure ("cannot verify — insufficient token permission"), never a pass.
- **Committing a workflow that skips a job via `if:` conditions on a required check.** A conditionally-skipped job still reports a (green) "skipped" status in some GitHub Actions configurations, or leaves the check permanently Pending in others depending on trigger shape — either way this is exactly the "path-filtered skip-with-success" shape D-04 already explicitly declined for `.planning/` doc commits. Do not reintroduce it via a differently-named `if:` condition on a required job.
- **Relying on `drizzle-kit generate`'s exit code alone for the D-09 schema-drift check.** It exits 0 whether or not it created a file (verified live this session: exit succeeded with the message printed to stdout, not a distinguishing exit code observed in this quick check). The check must inspect **whether a new file appeared** (e.g. `git status --porcelain apps/recipe-app/drizzle/` after running `generate`), not the process's exit code.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Finding and replacing the workflow's own prior PR comment | A custom "list comments, find one with my hidden marker, PATCH it" script against the REST API | `gh pr comment --edit-last --create-if-none` | `gh` already scopes "last comment" to the authenticated actor; hand-rolling this correctly (pagination, actor filtering, marker-comment parsing) is exactly the kind of deceptively-fiddly API-pagination problem this project's own `Don't Hand-Roll` philosophy (used elsewhere for backup/restore tooling, squawk, Testcontainers) argues against reinventing |
| Detecting whether the committed migration history still reconstructs `schema.ts` | A hand-rolled AST diff between `schema.ts` and the applied database's `information_schema` | `drizzle-kit generate`'s own "no schema changes" detection (D-09) | `drizzle-kit` already owns this exact comparison as its core purpose; reusing it means the drift check can never disagree with what `drizzle-kit generate` would tell a developer locally |
| Verifying a GitHub ruleset's live configuration | A bespoke assertion library against ad-hoc `gh api` output shapes | Plain `gh api ... --jq` assertions inside a small script, following this repo's existing "verify, don't trust" pattern (`assertTimeoutsInEffect`, `assertMigrationHistoryApplied`) | Consistent with the codebase's own established idiom rather than introducing a new one |

**Key insight:** Every mechanism this phase needs — status checks, PR comments, ruleset config, branch protection — already has a first-party, well-documented API or CLI surface. The temptation in a "glue code" phase like this one is to reach for a marketplace Action for convenience; the stronger match for this project's own stated non-negotiables (minimal attack surface, architectural enforcement) is the `gh` CLI directly, which is already trusted infrastructure on every GitHub-hosted runner.

## Common Pitfalls

### Pitfall 1: `bypass_actors` is silently omitted, not returned empty, without sufficient token permission

**What goes wrong:** D-05's self-check reads `GET /repos/{owner}/{repo}/rulesets/{id}`, sees no `bypass_actors` key, and (if written carelessly) treats that the same as an empty array — reporting "bypass list is empty, check passes" when it actually has no visibility into the bypass list at all.
**Why it happens:** GitHub's own docs state the field "is only returned if the user making the API request has write access to the ruleset" [CITED: docs.github.com/en/rest/repos/rules, "Get a repository ruleset"] — "write access to the ruleset" tracks repository-admin-level access, which for a `GITHUB_TOKEN` means the job's `permissions:` block needs `administration: write` (the highest privilege level `GITHUB_TOKEN` can be granted; `administration: read` may not be sufficient — this specific boundary is UNKNOWN and must be confirmed live against the real ruleset once it exists, since the repository does not exist yet this research pass).
**How to avoid:** Grant the D-05 job's `permissions: administration: write` explicitly, and write the assertion to fail (not pass) when `bypass_actors` is absent from the response, distinguishing "confirmed empty" from "could not confirm."
**Warning signs:** The D-05 job passes on its very first run without ever having been given elevated `permissions:` — that is the signature of the false-negative described above, not evidence the check works.

### Pitfall 2: A required check name that does not exactly match the workflow's reported check name blocks every PR forever

**What goes wrong:** The ruleset's `required_status_checks[].context` is configured with a string that does not exactly match what GitHub Actions reports for a job, and every future PR is permanently blocked (Pending, never Success) with no obvious error message pointing at the mismatch.
**Why it happens:** The context/check name a `required_status_checks` entry matches against is the job's own reported check-run name — for GitHub Actions this is the job's `name:` field if set, or its job id (the YAML key) if not [MEDIUM confidence — corroborated by several GitHub community discussions (`orgs/community/discussions/26822`, `60792`) rather than a single official doc page that loaded fully this session; treat as a claim to confirm on the very first real workflow run rather than as settled]. A matrix job additionally suffixes the name with its matrix values, making the plain job name insufficient as a required-check context for any matrixed job.
**How to avoid:** Pin an explicit `name:` on every job intended to be a required check; do not use a matrix strategy for any job named in the ruleset (none of D-13's required jobs need one); create the ruleset only *after* the workflow file exists and has run at least once, so the exact reported names can be copied verbatim rather than guessed.
**Warning signs:** A PR sits with all named checks showing green but the merge button still refuses — check for a required-check context string in the ruleset with no matching job name at all (GitHub will show it as perpetually "Expected" rather than "Pending" or "Failing" in this case).

### Pitfall 3: `actions/checkout`'s default shallow clone breaks D-09's merge-base diff

**What goes wrong:** `git merge-base origin/main HEAD` (or any `git diff <base>...<head>` invocation) fails or returns a wrong/empty result because the checked-out repository only has one commit of history.
**Why it happens:** `actions/checkout@v4`'s default `fetch-depth` is `1` — "only a single commit is fetched by default" [CITED: github.com/actions/checkout README]. The `pull_request` event's default checkout target is a synthetic merge ref, further complicating a naive `git diff` if the job doesn't also explicitly pin `ref:` (see Architecture Pattern 3 above).
**How to avoid:** Set `fetch-depth: 0` (fetch all history) on any job performing the D-09 append-only diff or the D-10 journal-entry comparison; use `${{ github.event.pull_request.base.sha }}` and `${{ github.event.pull_request.head.sha }}` from the event payload as the two commits to diff, rather than deriving `merge-base` from branch names that may not resolve correctly in a detached-HEAD checkout.
**Warning signs:** The append-only check passes on every PR, including ones that genuinely modify an existing migration file — a silently-empty diff (because git couldn't see the base commit at all) looks identical to a genuinely-empty diff.

### Pitfall 4: `drizzle-kit generate`'s exit code does not distinguish "clean" from "drift found"

**What goes wrong:** Trusting `drizzle-kit generate`'s process exit code as the drift signal in the D-09 schema-drift check.
**Why it happens:** Verified live this session — running `drizzle-kit generate` against this repo's own unchanged `schema.ts` printed `No schema changes, nothing to migrate 😴` to stdout and the command completed without an observably distinguishing non-zero exit in that no-drift case; whether it exits non-zero when it *does* generate a new file was not independently tested this session (doing so would have required creating and then discarding a real schema change) and is recorded as **UNKNOWN, not assumed** — the safer, verified-working detection mechanism is the git working-tree diff, not the exit code.
**How to avoid:** After running `generate`, check `git status --porcelain apps/recipe-app/drizzle/` (or equivalent) for any new/modified file — a non-empty result is the drift signal, independent of what exit code `drizzle-kit` happens to return.
**Warning signs:** The check "passes" on a PR where a migration genuinely doesn't match `schema.ts` — worth a synthetic falsification test (deliberately hand-edit a migration, confirm the check fails) as part of this phase's own test suite for the check itself, mirroring how Phase 3/4 proved every other guard.

### Pitfall 5: The drift-check job needs `RECIPE_DEV_DATABASE_URL` even though it opens no database connection

**What goes wrong:** A CI job author reasons "this job only runs `drizzle-kit generate`, which needs no live database, so it doesn't need the `postgres:17` service container or the env var" — and the job fails immediately on `apps/recipe-app/drizzle.config.ts`'s module-load-time `assertLocalDevelopmentTarget(getDevDatabaseUrl())` call (verified live, `apps/recipe-app/drizzle.config.ts:15-16`), which throws before `drizzle-kit` itself ever runs, regardless of whether a connection is actually attempted.
**Why it happens:** `getDevDatabaseUrl()` reads `RECIPE_DEV_DATABASE_URL` and validates its shape (loopback host, port `5432`, database `recipe_dev`) synchronously at config-load time (D-16, `01-CONTEXT.md`) — this is deliberate (a safety pin, not an oversight) but it means *every* job that transitively imports `drizzle.config.ts` needs the env var set to a pin-satisfying value, even a job with no running database at all.
**How to avoid:** Set `RECIPE_DEV_DATABASE_URL=postgres://recipe_app:<any-value>@127.0.0.1:5432/recipe_dev` (or equivalent) in the drift-check job's environment even without a `services:` block — the value only needs to parse correctly and satisfy the pin's host/port/database-name checks; it never needs to actually connect for this specific job's purpose.
**Warning signs:** The drift-check job fails immediately with `RECIPE_DEV_DATABASE_URL is missing or malformed`, mentioning nothing about schema drift at all — a misleading failure mode for anyone who has not read `scripts/env.ts`'s own comments.

### Pitfall 6: `pull_request_target` looks tempting for the comment-posting step and is the wrong trigger here

**What goes wrong:** Using `pull_request_target` (which grants a write-capable `GITHUB_TOKEN` and base-repo secrets even for fork PRs) to sidestep the fork-PR read-only-token limitation D-16 already accepted as a known gap.
**Why it happens:** `pull_request_target` runs "in the context of the default branch of the base repository" and can carry write-permission tokens even when triggered by a fork's PR [CITED: docs.github.com/en/actions/using-workflows/events-that-trigger-workflows]. It is a common but dangerous pattern when combined with checking out or otherwise processing PR-supplied content, because the elevated token is then exposed to attacker-controlled input [CITED: docs.github.com/en/actions/security-guides/security-hardening-for-github-actions, which explicitly recommends avoiding `pull_request_target` "if it's not necessary" and never checking out untrusted code under it].
**How to avoid:** Use the plain `pull_request` event for every job in this phase. For same-repository PRs (the only case that exists today — this is a solo repo, D-16), `pull_request`'s `GITHUB_TOKEN` already has write permissions per the repo's default Actions settings; only fork PRs get a read-only token, and that gap is already an accepted, documented limitation (D-16), not a problem to solve by reaching for the more dangerous trigger.
**Warning signs:** Any workflow file in this phase using `on: pull_request_target` — should not exist; if it does, re-derive the actual reason and prefer `pull_request` unless a fork-PR use case is deliberately being taken on (out of scope this phase per the Deferred Ideas list).

## Code Examples

### D-09/D-10: append-only + journal-entry comparison sketch

```typescript
// Illustrative sketch, not copied from an existing file — the planner's task is to place this
// logic (scripts/ci/check-append-only.ts or similar, per Claude's Discretion above).
import { execa } from "execa";

const MIGRATIONS_DIR = "apps/recipe-app/drizzle/";
const JOURNAL_PATH = "apps/recipe-app/drizzle/meta/_journal.json";

async function checkAppendOnly(baseSha: string, headSha: string): Promise<void> {
  // fetch-depth: 0 is required for these two SHAs to be resolvable at all — see Pitfall 3.
  const { stdout } = await execa("git", ["diff", "--name-status", baseSha, headSha, "--", MIGRATIONS_DIR]);
  for (const line of stdout.split("\n").filter(Boolean)) {
    const [status, path] = line.split("\t");
    if (path === JOURNAL_PATH) continue; // journal gets its own entry-level check below
    if (status !== "A") {
      throw new Error(`CI-05: "${path}" is not a new file (git status "${status}") -- migrations are append-only.`);
    }
  }
}

interface JournalEntry { idx: number; version: string; when: number; tag: string; breakpoints: boolean }

function checkJournalAppendOnly(baseJournal: { entries: JournalEntry[] }, headJournal: { entries: JournalEntry[] }): void {
  const baseByIdx = new Map(baseJournal.entries.map((e) => [e.idx, e]));
  for (const [idx, baseEntry] of baseByIdx) {
    const headEntry = headJournal.entries.find((e) => e.idx === idx);
    if (!headEntry) {
      throw new Error(`CI-05: journal entry idx ${idx} ("${baseEntry.tag}") disappeared.`);
    }
    if (headEntry.tag !== baseEntry.tag || headEntry.when !== baseEntry.when) {
      throw new Error(`CI-05: journal entry idx ${idx} was modified (tag/when changed) -- journal entries are append-only.`);
    }
  }
}
```

### Postgres service container for the `test`/`migrate` jobs

```yaml
# Source: pattern from docs.github.com/en/actions/how-tos/use-cases-and-examples/using-containerized-services/creating-postgresql-service-containers
# (CITED — health-check options and localhost connection confirmed from official docs; the
# image tag, user/db names, and health-check command below are this project's own, matching
# docker-compose.yml's existing pin exactly, verified read this session)
jobs:
  migrate:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_USER: recipe_app
          POSTGRES_PASSWORD: ci_only_throwaway_password
          POSTGRES_DB: recipe_dev
        ports:
          - 127.0.0.1:5432:5432
        options: >-
          --health-cmd "pg_isready -U recipe_app -d recipe_dev"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha }}
      # ... pnpm/node setup ...
      - run: pnpm db:migrate
        env:
          RECIPE_DEV_DATABASE_URL: postgres://recipe_app:ci_only_throwaway_password@127.0.0.1:5432/recipe_dev
          RECIPE_DEV_DB_PASSWORD: ci_only_throwaway_password
```

Binding the service container to `127.0.0.1:5432` (not the bare `5432:5432` shorthand many examples show) mirrors this repo's own `docker-compose.yml` loopback-only convention (verified `docker-compose.yml:22`, and the guardrail at `tests/guardrails.test.ts:266-276` that already enforces this pattern in the dev compose file) — worth carrying the same discipline into CI even though a GitHub-hosted runner's network is already isolated per-job.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 5.0.0 (verified `package.json:37`) |
| Config files | `vitest.config.ts` (fast suite, DB-free except `smoke.test.ts`/`db-query.test.ts`/`db-reset.test.ts` which need a live dev-shaped database), `vitest.history.config.ts` (Testcontainers-backed, `tests/history/**`), `vitest.drill.config.ts` (Testcontainers-backed, `tests/drill/**`) — all three verified read this session |
| Quick run command | `pnpm test` |
| Full suite command | `pnpm test && pnpm test:history` (drill is scheduled, not per-PR, per D-13) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CI-01 | analyzer + both history axes + app tests all run per PR | integration (workflow-level) | N/A — proven by inspecting the workflow file + a real PR run, not a unit test | ❌ Wave 0 — no test file; this is a workflow-structure fact |
| CI-02 | BLOCKED fails the build | integration | `pnpm db:analyze:migrations --json; echo $?` against a fixture containing a known-BLOCKED migration | ✅ `EXIT_CODES.BLOCKED` already covered by existing analyzer test suite (Phase 3) |
| CI-03 | ruleset config (empty bypass list, required checks, no direct push) | live API check (D-05) + one performed human act (D-18) | `gh api repos/{owner}/{repo}/rulesets/{id}` assertions | ❌ Wave 0 — new script + its own unit tests for the assertion logic (can be fixture-driven against a sample API response) |
| CI-04 | verdict + reasoning on the PR itself | unit (renderer) + integration (comment posts) | Renderer: pure-function fixture tests in `packages/automation`. Posting: a real PR run is the only genuine proof (mirrors D-18's reasoning — no test can assert "the comment appeared on GitHub" from inside the system without a live token) | ❌ Wave 0 — renderer needs fixture tests; posting needs a real workflow run to observe |
| CI-05 | hand-edit / already-applied-edit detection | unit | New unit tests for `checkAppendOnly`/journal-entry-comparison logic, driven by synthetic before/after fixtures (not real git operations, matching this repo's own WR-04 precedent of never mutating real shipped data to prove a detector) | ❌ Wave 0 |
| CI-06 | isolated migrate job + no boot-time migration | integration (workflow inspection) + unit (guardrail) | `tests/guardrails.test.ts` extension (D-15) for the boot-time half; workflow-file inspection for the isolated-job half | ❌ Wave 0 for the D-15 guardrail addition; the isolated-job half is a structural fact about the YAML, not a test |

### Sampling Rate

- **Per task commit:** `pnpm test` (fast suite only — the tamper-check and renderer unit tests belong here once written)
- **Per wave merge:** `pnpm test && pnpm test:history`
- **Phase gate:** Full suite green, plus a real pull request opened against the new remote exercising every required check at least once, plus D-18's personally-performed merge-refusal attempt, before `/gsd-verify-work`.

### Wave 0 Gaps

- [ ] Unit tests for the D-09 append-only git-diff logic (synthetic fixtures, not real git mutation)
- [ ] Unit tests for the D-10 journal-entry comparison logic (synthetic before/after journal JSON pairs)
- [ ] Unit tests for the pure renderer (`AnalysisResult[] → markdown`), including the D-07 "introduced by this PR" vs "pre-existing" grouping and the D-16 zero-findings rendering case
- [ ] `tests/guardrails.test.ts` extension proving the application source never triggers a migration at boot (D-15)
- [ ] Fixture-driven unit tests for the D-05 ruleset self-check's assertion logic (sample API response JSON in, pass/fail out) — separate from the live API call itself, which can only be proven against the real repository once it exists

## Security Domain

### Applicable ASVS Categories (Level 1, per `.planning/config.json`)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Partial | `GITHUB_TOKEN` is the only credential this phase introduces to CI (per D-16/`05-CONTEXT.md`'s explicit "no credentials in CI beyond the default GITHUB_TOKEN" boundary); no application-level authentication is in scope |
| V3 Session Management | No | Not applicable — no user sessions are created by this phase |
| V4 Access Control | Yes | The entire phase *is* an access-control mechanism (the ruleset). `permissions:` blocks in each workflow job must be scoped to the minimum needed per job (e.g. only the D-05 job gets `administration:` permission; only the comment-posting step gets `pull-requests: write`) — least-privilege token scoping, GitHub Actions' own recommended default-deny pattern |
| V5 Input Validation | Yes | The renderer (D-17) converts analyzer output into markdown posted to a public PR comment; the analyzer's own `rationales`/`ruleIds` strings originate from the (trusted, code-floor-protected) rules file, not from arbitrary PR-supplied content, so injection risk is low but the renderer should still not interpolate raw migration SQL text unescaped into markdown without fencing it (a migration file containing markdown-breaking characters, e.g. backticks or `</script>`-shaped content inside a comment, should not corrupt the sticky comment's structure) |
| V6 Cryptography | No | Not applicable this phase — no new credential storage, hashing, or crypto operation is introduced (the sha256 ledger hash is Phase 4's existing `migrationHash`, unchanged) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Confused-deputy via `pull_request_target` + untrusted checkout | Elevation of Privilege | Use `pull_request`, never `pull_request_target`, for every job that processes PR-branch content (Pitfall 6 above) |
| Required check silently never runs (deleted/renamed job) mistaken for "passed" | Tampering / Repudiation | Confirmed this session: a required check that never reports blocks merge rather than passing it — this is a real property of GitHub's own merge-button logic, not something this project's code must separately guarantee (D-11) |
| `bypass_actors` field silently omitted due to insufficient token scope, misread as "empty" | Tampering / false sense of security | Fail closed on absence, not presence-of-empty-array (Pitfall 1) |
| Over-privileged `GITHUB_TOKEN` at the workflow level (default `permissions: write-all` inherited by every job) | Elevation of Privilege | Set `permissions:` at the top of the workflow file to the minimum (e.g. `contents: read`) and grant elevated scopes (`pull-requests: write`, `administration: write`) only on the specific jobs that need them, per-job `permissions:` overrides |
| Same-PR desync (editing rules/workflow files alongside the dangerous migration) | Tampering | Already closed structurally per D-11 — `floor.ts`'s self-checks + the required-check-names-live-in-the-ruleset-not-the-workflow property; this phase's job is to add a test proving both properties still hold, not to build a new mechanism |
| Credential/hostname leakage on first public push | Information Disclosure | D-03's blocking full-history audit (all 234 commits) before the push — irreversible once public, per D-02's reversibility note |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `git remote` (GitHub repository) | D-01, all of CI-01…CI-06 | ✗ (verified live — `git remote -v` returned nothing this session) | — | This phase's own first task creates it; no fallback needed, it is the deliverable |
| `.github/` directory / any workflow file | CI-01…CI-06 | ✗ (verified live — directory does not exist) | — | Created by this phase |
| `gh` CLI (locally, for the owner to run D-01/D-18/the ruleset-creation script) | D-01, D-18, ruleset creation | UNKNOWN on this Windows dev machine — not probed this session | — | If absent, `winget install GitHub.cli` or the GitHub Desktop-bundled `gh` are standard installs; not a blocker, just an unconfirmed local fact worth a `checkpoint:human-verify` at plan time |
| `gh` CLI (on GitHub-hosted `ubuntu-latest` runners) | Every CI job using `gh api`/`gh pr comment` | Preinstalled per GitHub-hosted runner images [general knowledge, not independently re-confirmed via a fresh doc fetch this session — MEDIUM confidence, cheap to self-confirm with a `gh --version` step in the first real workflow run] | — | If ever absent, `actions/setup-gh` or manual binary install is a documented fallback |
| Docker (on GitHub-hosted `ubuntu-latest` runners, for `postgres:17` service containers and Testcontainers) | `test`, `migrate`, `test-history` jobs | Present by default on GitHub-hosted Linux runners [standard, well-documented GitHub Actions runner capability — HIGH confidence, this is why D-12 pins `ubuntu-latest`] | — | None needed |

**Missing dependencies with no fallback:** the GitHub remote itself — this phase's first task, not a blocker to plan around.

**Missing dependencies with fallback:** local `gh` CLI availability on the Windows dev machine — cheap to verify at plan/execute time, not researched further here.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `gh` CLI is preinstalled on GitHub-hosted `ubuntu-latest` runners | Standard Stack, Environment Availability | Low — trivially self-confirmed with a `gh --version` step in the first real workflow run; if absent, a one-line install step is a known fallback |
| A2 | The `pull_request` event's default checkout target is a synthetic merge ref (`refs/pull/<N>/merge`), not the PR branch's own head commit | Architecture Pattern 3 | Low-medium — if wrong, the explicit `ref:` pin recommended anyway is simply redundant rather than load-bearing; the recommendation to pin explicitly stands either way |
| A3 | The required-status-check "context" GitHub Actions reports equals a job's `name:` field (or job id if unset), and matrix jobs suffix it with matrix values | Pitfall 2 | Medium — this is the exact string that must appear in the ruleset's `required_status_checks[].context`; if the actual matching rule differs even slightly, every PR could be permanently blocked with a confusing failure mode. Must be confirmed by creating the workflow first, observing its real reported check names, and only then creating the ruleset (sequencing recommendation already given above specifically to de-risk this assumption) |
| A4 | `drizzle-kit generate`'s exit code does not distinguish "no drift" from "drift found" (only the git working-tree diff does) | Pitfall 4 | Medium — only the no-drift case (exit succeeded, no file created) was actually observed live this session; the drift-found case was not independently tested. If `drizzle-kit generate` does in fact exit non-zero on drift, the recommended git-diff-based check is still correct and strictly safer (works regardless of exit-code behavior), so this assumption being wrong does not invalidate the recommendation, only means an additional signal (exit code) could optionally be layered on top |
| A5 | Third-party marketplace Actions (e.g. sticky-comment Actions) are real, actively maintained projects as characterized by WebSearch results, rather than independently verified via the Package Legitimacy Gate (which targets npm/PyPI/crates registries, not the GitHub Actions marketplace) | Standard Stack — Alternatives Considered | Low — these are explicitly NOT recommended for this phase (the `gh` CLI is), so this assumption is informational context for the "why not" column, not a load-bearing recommendation |

## Open Questions (RESOLVED)

**All three questions below were given an explicit disposition during phase planning
(2026-09-09).** Each carries an inline RESOLVED marker naming the plan and task that owns it, so a
reader can tell a deferred-with-a-plan question from a forgotten one.

Read "RESOLVED" here as **the status is recorded and owned**, not as "the answer is now known."
Two of the three are settled by a live observation that cannot be made until the repository
exists; they are dispositioned with their failure path pre-committed rather than left to be
improvised on the day. The third stays **UNKNOWN on purpose** — nothing in this phase depends on
its answer, and CLAUDE.md's first working-style rule is that an unverified thing stays marked
UNKNOWN rather than being upgraded to a fact to make a section look closed. Do not read any line
below as a claim that a live check has already been performed.

1. **Does `administration: read` suffice to see `bypass_actors` in the ruleset API response, or is `administration: write` required?**
   - What we know: GitHub's docs state "write access to the ruleset" is required for the field to appear.
   - What's unclear: whether a `GITHUB_TOKEN` `permissions:` block set to `administration: write` (the only two levels GitHub Actions exposes for this permission are `read`/`write`/none) actually satisfies "write access to the ruleset" as the docs mean it, versus requiring true repository-admin identity that a bot token can never have regardless of the `permissions:` block.
   - Recommendation: grant `administration: write` on the D-05 job and confirm with a real `gh api` call against the real ruleset once it exists (unavoidable — the repository/ruleset do not exist during this research pass); if `bypass_actors` still does not appear, the fallback is to fail the check loudly and treat this as a phase-blocking finding requiring a design change (e.g., a PAT with genuine admin rights stored as a repo secret — which then reopens a "credential beyond GITHUB_TOKEN" question the CONTEXT.md's own constraints explicitly want to avoid).
   - **RESOLVED — owned by `05-05` Task 2 and `05-08` Task 1. The answer itself remains UNKNOWN until observed live; what is settled is that the project no longer needs it in advance to be safe.** `05-05` Task 2 builds `assertBypassListEmpty` so an *absent* `bypass_actors` field throws with a message distinct from the non-empty case — absence and emptiness are never conflated, so the unreadable outcome fails closed instead of passing (threat `T-05-26`). `05-08` Task 1 then calls the real API against the real ruleset with the token carrying `administration: write` and records verbatim whether the field appeared. Three outcomes are pre-committed: present-and-empty (passes), present-and-non-empty (fails, correctly), absent (fails loudly and becomes a phase-blocking finding requiring the design change this question's own recommendation names). Nothing here asserts which outcome will occur.

2. **Does GitHub Actions' `pull_request` event on a same-repository (non-fork) PR reliably grant a write-capable `GITHUB_TOKEN` by default, or does this depend on a repository setting that must itself be checked/set?**
   - What we know: fork PRs get a read-only token; D-16 already documents this limitation.
   - What's unclear: whether the *default* Actions permissions setting for a brand-new public repository (created fresh in D-01) is "read and write" or "read only" — this is a per-repository setting under Settings → Actions → General, and GitHub has changed the default for newly created repositories over time.
   - Recommendation: explicitly verify (and if needed set) the repository's default workflow permissions during D-01's repository setup, rather than assuming the sticky-comment step will work on the first real PR.
   - **RESOLVED — owned by `05-02` Task 3; the recommendation was taken as written.** That task reads `gh api repos/{owner}/{repo}/actions/permissions/workflow` during repository setup, sets it explicitly if the read-back is not `write`, asserts the read-back value in its acceptance criteria, records the observed value in `docs/40-public-release-audit.md`, and carries the read-only-default failure mode as threat `T-05-09`. `05-03` re-checks that recorded value as its stated trigger if the comment step ever fails. The general question — what GitHub's default is for a brand-new repository today — is deliberately **not** answered: the plan reads the actual value on the actual repository, which is what makes the general answer unnecessary rather than known.

3. **Exact behavior of `drizzle-kit generate`'s exit code when it does produce a new migration file** (A4 above) — settle by a disposable local test (deliberately introduce a schema change, run `generate`, observe the exit code) before finalizing whether the D-09 schema-drift check should also gate on exit code as a secondary signal.
   - **RESOLVED as a disposition only — the underlying fact stays UNKNOWN, deliberately, and must not be recorded as anything else.** Owned by `05-04` Task 3, which **declines** the secondary signal this question was asked in service of. The drift check keys entirely on `git status --porcelain` before and after generation: a file appearing is the signal, and that signal is correct whichever exit code generation returns. The disposable local test recommended above was therefore not run, and no exit-code behaviour is claimed anywhere in this document. Assumption **A4 stays UNKNOWN** in the Assumptions Log; `05-04`'s `<flagged_assumptions>` block carries it forward explicitly; `05-04` Task 3 additionally logs the observed exit code as an observation while stating in the log that it is recorded rather than relied on; and `05-08` Task 3 closes the phase recording it as a live unknown rather than a closed one. If a future phase ever wants the exit code as a signal, this question reopens with its recommendation intact.

## Sources

### Primary (HIGH confidence — session-verified against this repository's own code, or an official doc page that loaded in full)

- `git remote -v`, `ls .github` (live commands, this session) — confirmed no GitHub remote and no `.github/` directory exist yet.
- `apps/recipe-app/drizzle/meta/_journal.json:1-41` (Read, this session) — confirmed the journal carries only `idx`/`version`/`when`/`tag`/`breakpoints`, no content hash.
- `packages/automation/src/types.ts:215-221`, `packages/automation/src/runner/exit-codes.ts:14-22` (Read, this session) — `EXIT_CODES`/`RUNNER_EXIT_CODES` contracts.
- `packages/automation/src/cli.ts`, `scripts/db-migrate.ts`, `scripts/history-suite.ts`, `vitest.history.config.ts`, `vitest.drill.config.ts`, `vitest.config.ts`, `packages/automation/src/index.ts`, `packages/automation/src/runner/ledger.ts`, `packages/automation/src/adapter/drizzle-migrations.ts`, `docker-compose.yml`, `tests/guardrails.test.ts`, `tests/smoke.test.ts`, `tests/history/support.ts`, `apps/recipe-app/drizzle.config.ts`, `scripts/env.ts`, `scripts/env.test.ts`, `package.json` (Read, this session) — the existing command surface, guardrail idioms, and env-pin mechanics this phase's CI must invoke unmodified.
- Live command: `pnpm --filter recipe-app exec drizzle-kit generate` against the unchanged, unmodified schema (this session) — confirmed "No schema changes, nothing to migrate 😴" and no file created (`git status --porcelain` empty before and after) — see Summary and Pitfall 4/5.
- [github.com/actions/checkout README](https://github.com/actions/checkout) — `fetch-depth` default (1) and pull-request checkout behavior. CITED.
- [cli.github.com/manual/gh_pr_comment](https://cli.github.com/manual/gh_pr_comment) — `--edit-last`/`--create-if-none` flag semantics. CITED.
- [docs.github.com — Get a repository ruleset](https://docs.github.com/en/rest/repos/rules?apiVersion=2022-11-28#get-a-repository-ruleset) — `bypass_actors` only returned with write access to the ruleset. CITED.
- [docs.github.com — Get rules for a branch](https://docs.github.com/en/rest/repos/rules?apiVersion=2022-11-28#get-rules-for-a-branch) — confirms this endpoint does NOT include `bypass_actors`, ruling it out for D-05's purpose. CITED.
- [docs.github.com — Available rules for rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets) — required-status-checks/deletion/force-push/pull-request rule semantics. CITED.
- [docs.github.com — Security hardening for GitHub Actions](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions) — `pull_request_target` risk, recommendation to avoid it and never check out untrusted code under it. CITED.
- [docs.github.com — Events that trigger workflows](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows) — `pull_request` vs `pull_request_target` token/secret exposure. CITED.
- [docs.github.com — Workflow commands: job summaries](https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions) — job summary location (Actions run page) and 1 MiB size limit; used to confirm a job summary alone would NOT satisfy criterion 2's "directly on the PR" wording (D-16's own reasoning). CITED.
- [docs.github.com — Creating PostgreSQL service containers](https://docs.github.com/en/actions/how-tos/use-cases-and-examples/using-containerized-services/creating-postgresql-service-containers) — service-container YAML shape, health-check options, localhost connection. CITED.

### Secondary (MEDIUM confidence — WebSearch cross-checked, or an official doc page that returned only a partial/summarized excerpt)

- WebSearch, "GitHub repository rulesets available free public repositories" — rulesets available on GitHub Free for public repositories, require Pro/Team/Enterprise for private repositories. Corroborates `docs/decisions.md` D2's original research and `05-CONTEXT.md` D-02's premise; not independently re-confirmed via a single fully-loaded official page this session (the `about-rulesets`/`managing-rulesets` doc-page fetches returned incomplete excerpts). Recommend a direct confirmation read of the GitHub-hosted repo's actual ruleset-creation UI/API response once the repository exists (D-01), since this is load-bearing for D-02/CI-03.
- WebSearch + community discussions (`github.com/orgs/community/discussions/26822`, `60792`) — required-status-check "context" matches a GitHub Actions job's `name:` (or job id if unset), and matrix jobs are additionally suffixed. Not confirmed via a single official doc page this session (Pitfall 2, Assumption A3).
- WebSearch, "gh pr comment edit sticky comment" — corroborates `marocchino/sticky-pull-request-comment` and similar Actions exist and are commonly used as an alternative to the `gh` CLI approach recommended here; used only for the Alternatives Considered row, not a load-bearing recommendation.
- [orm.drizzle.team/docs/kit-overview](https://orm.drizzle.team/docs/kit-overview) and [orm.drizzle.team/docs/drizzle-kit-check](https://orm.drizzle.team/docs/drizzle-kit-check) — fetched but returned only partial excerpts; did not settle whether `drizzle-kit generate`'s exit code distinguishes drift from no-drift (Open Question 3) or exactly what `drizzle-kit check` inspects beyond "consistency of your generated SQL migrations history." The live session test (Primary sources above) is the stronger evidence actually used in this document's recommendations.

### Tertiary (LOW confidence — not independently verified this session, flagged for confirmation)

- "`gh` CLI is preinstalled on GitHub-hosted `ubuntu-latest` runners" — general, widely-known GitHub Actions runner-image fact, not re-confirmed via a fresh fetch of the `actions/runner-images` repository's software manifest this session. Cheap to self-confirm with a `gh --version` step in the first real workflow run (Assumption A1).
- The `pull_request` event's default checkout ref being the synthetic merge commit rather than the PR head — general GitHub Actions knowledge, not re-confirmed via a fresh official-doc fetch this session (Assumption A2). The recommendation to pin `ref:` explicitly is safe regardless of whether this specific claim is exactly right.

## Metadata

**Confidence breakdown:**
- Standard stack (no new npm dependency; `gh` CLI + first-party Actions + `postgres:17`): HIGH — every piece is either already pinned elsewhere in this repository (verified reads) or confirmed via an official doc page that loaded cleanly.
- Architecture (job shape, ruleset JSON shape, sticky-comment mechanism): MEDIUM-HIGH — the ruleset JSON field names and the `gh pr comment` flags are CITED from official sources; the specific job/workflow layout is this project's own design applying those primitives, not itself a citable fact.
- Pitfalls: MEDIUM-HIGH — two pitfalls (bypass_actors visibility, required-check-never-runs-blocks-merge) are grounded in official docs; two (drizzle-kit generate exit code, checkout default ref) rest partly on live session verification and partly on general knowledge flagged LOW/UNKNOWN where not independently re-confirmed.
- Security domain: MEDIUM — ASVS mapping is straightforward given the phase's narrow scope (no new credential, no new user-facing auth surface); the `pull_request_target` guidance is CITED from GitHub's own security-hardening docs.

**Research date:** 2026-09-09
**Valid until:** 30 days for the GitHub-platform mechanics (ruleset/Actions APIs change slowly but do change); 7 days for anything tagged UNKNOWN/Open Question above, since those require a live check against a repository that does not exist yet and should be re-verified the moment it does.
