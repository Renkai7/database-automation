# Phase 5: CI Pipeline Gate - Context

**Gathered:** 2026-09-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 5 is where the gate becomes something the owner cannot walk around. Phase 4 built the
runner — the one architecturally non-bypassable enforcement point (`docs/decisions.md` D12) —
but it only runs when someone chooses to run it, against a database only they can reach.
This phase puts a required, non-bypassable check between a destructive migration and `main`,
and makes the safety verdict visible on the pull request itself rather than buried in a log.

It is also the phase in which this repository leaves the local machine for the first time.
`git remote -v` is currently empty: 234 commits, one branch, entirely local. There is no
`.github/` directory. CI-03 has no repository to attach a ruleset to, so creating that
repository is inside this phase, not a prerequisite assumed to have happened.

Requirements in scope: CI-01, CI-02, CI-03, CI-04, CI-05, CI-06.

**Explicitly not this phase:**

- **No remote database of any kind.** D2/D3 stand. Every database this phase touches is
  ephemeral and lives inside a CI job. Staging is Phase 6; production is Phase 7.
- **No approval or override mechanism.** Deferred here by `03-CONTEXT.md` and `04-CONTEXT.md`;
  resolved in D-06 below by building none. AUD-04's per-rule override-frequency counting stays
  Phase 7 — there is nothing to count.
- **No audit log.** AUD-01 … AUD-04 are Phase 7. GitHub's own retention is this phase's record
  (D-08).
- **No environment protection rules / production gating.** Phase 7. This phase configures a
  *branch* ruleset, not an *environment* one.
- **No credentials in CI beyond the default `GITHUB_TOKEN`.** No database secret exists to add
  yet, and adding one before Phase 6's connectivity decision would invert the sequencing
  constraint the project is built on.
- **No expand-and-contract work.** APP-03 is reserved for Phase 7 (`01-CONTEXT.md` D-11's
  fourth row).

</domain>

<decisions>
## Implementation Decisions

### Getting the repository onto GitHub

- **D-01:** **This phase creates the GitHub remote and pushes.** The gate cannot be proven
  against a repository that does not exist, and criterion 1 requires actually opening a pull
  request and being unable to merge it. Everything downstream needs the remote too — Phase 6's
  CI-to-staging connectivity and Phase 7's production secret store both assume it.
  Building the workflow files now and wiring GitHub later was rejected: it leaves criterion 1,
  the entire point of the phase, unproven.

- **D-02:** **The repository is public.** This is not a preference — it is what makes the gate
  affordable and provable. GitHub documents repository rulesets as free on public repositories,
  while private repositories have historically required a paid tier; going public removes the
  plan-tier risk from CI-03 entirely. It also resolves the Phase 7 blocker already recorded in
  `.planning/STATE.md`: disabling environment-protection bypass is documented as public-repo-only
  on Free/Pro/Team, so Phase 7's REVIEW REQUIRED gate stops being conditional.
  **The owner's actual GitHub plan tier remains UNKNOWN and is not assumed anywhere** — going
  public is what makes it not matter.
  — **Reversibility:** one-way in effect — a repository can be flipped back to private, but
  anything published in the meantime may already be cloned, cached or indexed. Treat the push as
  the irreversible act, not the visibility setting.

- **D-03:** **A full commit-history audit is a blocking task before the first push.** Not the
  working tree — all 234 commits. Scan for credentials, real hostnames, server IPs, and
  Coolify/Hetzner operational detail; decide per finding whether to redact-and-rewrite or accept
  it deliberately. Publishing is one-way, and this project's own CLAUDE.md forbids recording
  assumptions as facts — "nothing sensitive was ever committed and later removed" is exactly such
  an assumption, and nobody has verified it.
  Auditing only HEAD was rejected for that reason. Squashing to a single initial commit was
  rejected because it destroys the GSD audit trail: several phase records, REVIEW and VERIFICATION
  documents cite specific commit SHAs (`9f9ff0f`, `d41954f`, `f7ff627`, `cd33399` among others),
  which would all dangle.
  — **Reversibility:** one-way — this is the gate in front of the irreversible act in D-02.

### What the ruleset enforces

- **D-04:** **The ruleset blocks direct pushes to `main`, requires a pull request, requires the
  status checks to pass, and has an empty bypass list.** Anything less does not satisfy criterion
  1: a rule that only gates pull requests leaves `git push origin main` wide open, and this
  repository's entire history is direct pushes to main. The bypass list being empty is what makes
  the owner's own admin permissions insufficient — that specific sentence is the phase goal.
  **Recorded consequence, so it is not discovered as friction later:** every `.planning/`
  documentation commit now needs a branch and a pull request too. Path-filtered exemptions for
  doc-only changes were considered and declined — a required check that reports success without
  running is a second door, and `04-CONTEXT.md` D-02 already rejected that shape once under a
  different name.
  — **Reversibility:** one-way in intent — the same standing as the code floor. Any future change
  that adds a bypass actor, drops a required check, or re-enables direct push is a safety-relevant
  change, not configuration.

- **D-05:** **A CI check asserts the ruleset's own configuration.** It queries the GitHub API and
  fails if the bypass list is non-empty, a required check has been removed, or direct-push blocking
  has been disabled. This is `04-CONTEXT.md` D-15's move applied one layer up: the runner does not
  trust that it set its timeouts, it re-queries `pg_settings` and refuses if they do not read back
  as pinned — so the pipeline should not trust that the ruleset is still configured correctly
  either.
  **Its honest limit, which must be stated wherever it is described:** the check runs inside the
  thing it audits. Someone who can edit the ruleset can also delete the check. It raises the cost
  of tampering and makes it visible; it does not make it impossible. That is D12's bypassability
  spectrum, and this check sits on it like every other gate upstream of the runner.

### What the check does with each verdict

- **D-06:** **BLOCKED fails the required check. REVIEW REQUIRED passes it, surfaced completely on
  the pull request.** This is `04-CONTEXT.md` D-05 carried into CI unchanged, for the same reason:
  BLOCKED is the wall, and making REVIEW REQUIRED a second wall weakens the first. `PITFALLS.md`
  §C2's argument applies with full force here — friction on the reviewable tier is what
  manufactures pressure for an override path, and once an override exists it becomes the default
  road. The committed `0001_busy_thunderbolt.sql` classifies REVIEW REQUIRED permanently and
  correctly, so a failing-on-REVIEW gate would make routine correct work impossible within days.
  A label-based unblock was rejected explicitly: it is an override path, built in the exact phase
  the prior two phases said not to manufacture one in, and on a solo repository the owner would be
  labelling their own pull requests.
  **No override path is built in this phase.** AUD-04's per-rule override-frequency counting
  therefore stays Phase 7 — there is nothing yet to count.

- **D-07:** **The check classifies the whole committed migration history; the pull-request surface
  separates "introduced by this PR" from "pre-existing, already applied."** The authority is total —
  a BLOCKED verdict anywhere fails the build — while the human-facing output stays legible.
  Three reasons, each from a decision this project already made: (1) the runner already
  re-classifies every migration it applies, and RUN-05's empty-database full-history run happens in
  CI, so a narrower PR check would put two components in disagreement about scope — the
  classify-upstream/execute-downstream split D12 exists to close; (2) `04-CONTEXT.md` D-07 already
  rejected the same shape in its own domain, declining to suppress the report for already-applied
  migrations because it would make the analyzer "say different things about the same SQL depending
  on state"; (3) all 234 commits on `main` predate the gate, so diff-only scoping would trust a
  history that was never gated.
  The alarm-fatigue objection to whole-history scanning is real but is a **presentation** problem,
  answered in the comment's grouping rather than by shrinking the check's authority.

- **D-08:** **The CI verdict is displayed, not recorded.** The pull-request comment and the Actions
  run are the record, and GitHub retains both. Nothing durable is built. This follows
  `04-CONTEXT.md` D-19's split: durable per-run state belongs in the runner-owned
  `runner.migration_runs` table *in the database it describes*, and in this phase that database is
  an ephemeral CI container whose rows are meaningless the moment the job ends. Uploading the
  analyzer JSON as a workflow artifact was rejected as a convenience that would be mistaken for an
  audit trail while expiring on GitHub's default retention. Committing verdict files back into the
  repository was rejected because it would require CI to hold push rights to `main` — directly
  against D-04.

### Tamper detection (CI-05)

**Grounding fact established during discussion:** `apps/recipe-app/drizzle/meta/_journal.json`
carries **no content hash** — only `idx`, `version`, `when`, `tag`, `breakpoints`. The sha256
lives solely in the `drizzle.__drizzle_migrations` table, which this phase has no shared database
to read. The reference for "was this file changed?" must therefore come from git or from the
schema itself.

- **D-09:** **Two checks, one per clause of criterion 3.**
  1. **Append-only:** diff the pull request against its merge-base with `main` and fail if any
     existing file under `apps/recipe-app/drizzle/` is modified or deleted. Only additions are
     permitted. This catches "an edit to a migration a previous merge already applied" exactly,
     with git as an unarguable reference.
  2. **Schema drift:** apply the full migration history to an empty database, then run
     `drizzle-kit generate` and fail if it produces a new migration — meaning `schema.ts` and the
     committed history no longer agree. This catches a hand-edit that changed what the SQL does.
  Deterministic by construction: it compares *emptiness of output*, never drizzle's randomly
  generated migration names or timestamps. It also correctly ignores
  `0003_backfill_steps_timer_label.sql`, a legitimately hand-authored Phase 4 backfill (D-31) that
  `drizzle-kit generate` would never produce — an `UPDATE` yields no schema diff.
  A committed sha256 lockfile was rejected as partly ceremony: it lives in the same pull request
  the author controls, so updating both file and lockfile passes it; its real strength comes from
  the git rule that is already doing the work.

- **D-10:** **`.sql` files are strictly append-only; `meta/_journal.json` is append-only at the
  entry level.** The journal legitimately changes on every new migration, so a blanket
  no-modification rule would block all normal work. Instead CI parses both versions of the journal
  and fails if any existing entry's `idx`, `tag` or `when` changed, or if an entry disappeared.
  That closes the obvious dodge — renumber or delete a journal entry so a modified migration
  re-runs as new — without a carve-out that becomes a loophole.
  **Recorded consequence:** Phase 4's D-32 workflow, which generated a BLOCKED migration and then
  reverted both the file and its journal entry, would be refused if attempted through a pull
  request. That is arguably the correct outcome, but it is a real change to how a BLOCKED
  demonstration is performed, and it must not be discovered mid-phase.
  A named escape for reverts was rejected on D-06's own grounds — it is an override path.

- **D-11:** **The same-pull-request desync attack is already closed structurally; this phase
  verifies and records it rather than building a third mechanism.** `SUMMARY.md` names the attack
  specifically: "an agent editing rules.yaml or workflow files in the same PR as the dangerous
  migration."
  - **Rules:** Phase 3's `packages/automation/src/classifier/floor.ts` self-checks —
    `assertFloorNotWeakened` and `assertUnmatchedDefaultsToReview` — make the analyzer refuse to
    start on a weakened rules file, and they run in CI against the pull request's own code.
  - **Workflows:** the required-check *names* are configured in the ruleset, not in the workflow
    file. Deleting or renaming a job means the required check never reports, and a required check
    that never reports blocks the merge rather than passing it.
  Add a test proving both properties, and state them in the phase record. A hard rule failing any
  pull request that touches both a migration and a safety-relevant path was rejected: Phase 4
  legitimately added a `transactionHostile` fact and a floor rule alongside real migrations, and
  blanket-blocking a whole change class is the shape `REQUIREMENTS.md`'s Out of Scope table already
  rejects for `ALTER` statements.

### CI job shape

- **D-12:** **`ubuntu-latest` only.** GitHub's Windows runners can only run Windows containers, so
  `postgres:17` and `@testcontainers/postgresql` cannot work there at any price — a Windows-primary
  pipeline could not run either migration test axis, both named in CI-01. CI proves the code works
  on Linux; the development machine proves it works on Windows. **Recorded honestly:** a
  Windows-only regression (the `taskkill /T /F` path in `tests/smoke.test.ts`, path handling, `tsx`
  behaviour) will surface locally rather than in CI. Minutes are free on a public repository, so
  cost is not the reason for this choice — capability is.

- **D-13:** **Required on every pull request: the analyzer, `pnpm test`, and `pnpm test:history`
  (both axes). `pnpm test:drill` moves to a scheduled workflow, not a per-PR check.** The required
  set is exactly what CI-01 names. Putting the restore drill on a schedule means
  `02-CONTEXT.md` D-19's 30-day staleness gate stops depending on the owner remembering to run it
  locally — which is this project's own "architectural enforcement over remembered caution"
  applied to the one requirement the brief called its single confirmed operational risk.
  Making the drill a required per-PR check was rejected on `02-CONTEXT.md` D-16's reasoning: a slow
  Docker-dependent suite in the fast path is the one that eventually gets marked skipped.

- **D-14:** **CI-06 is satisfied by a dedicated migrate job that runs the real `pnpm db:migrate`
  entry point against a `postgres:17` service container**, structurally separate from any job that
  builds or boots the application — not by an internal function call, and not by relying on the
  history suite to imply it. Criterion 4 is a claim about what a reader sees when inspecting the
  workflow, and a step named `test:history` does not read as "migrations run as their own isolated
  pipeline step."
  **Load-bearing detail:** if the service container is reachable as `127.0.0.1:5432/recipe_dev`,
  `assertLocalDevelopmentTarget`'s pin (`01-CONTEXT.md` D-16) is satisfied honestly with **no
  loosening** — the runner's thin entry point runs unmodified. Do not weaken that guard to make
  CI work; shape the CI database to fit it.
  Phase 6 and Phase 7 then add an environment and a credential to an existing job shape rather than
  inventing one under production pressure.

- **D-15:** **Add the missing startup-migration guardrail.** `tests/guardrails.test.ts` covers
  `01-CONTEXT.md` D-14's container-init-script mount, but nothing asserts that the application's own
  code never triggers a migration at boot — which is CI-06's second clause and D8's direct subject.
  This is a cheap test and it closes a real gap found while scouting, not a hypothetical one.

### The pull-request surface (CI-04)

- **D-16:** **A sticky comment, rewritten in place on every run.** One comment the workflow creates
  and then edits, so the pull request always shows the current verdict rather than a stack of stale
  ones. It carries the **complete** findings — every rule id and every rationale, per
  `04-CONTEXT.md` D-05's "never a summary" — grouped per D-07 into "introduced by this PR" and
  "pre-existing (already applied)". This is the unambiguous reading of criterion 2's "directly on
  the PR — not only buried in a build log"; a job summary lives in the Actions UI and would not
  satisfy it as written.
  Needs `pull-requests: write`. **Known limit:** a pull request from a fork receives a read-only
  token and the comment would fail. On a solo repository, branches work and fork pull requests are
  not a case that exists yet — record it rather than solve it.

- **D-17:** **The renderer is a pure function in `packages/automation`; the GitHub plumbing lives
  in a thin script.** `AnalysisResult[] → markdown`, with no `fetch`, no filesystem access and no
  octokit inside the package — the same pure-core/thin-adapter seam `03-CONTEXT.md` D-11 and
  `04-CONTEXT.md` D-27/D-28 already enforce. The renderer is then unit-testable against fixtures
  with no network, and PLAT-01's future second consuming application inherits it. Building the
  markdown inside the workflow YAML was rejected: D-06's "complete findings, never a summary" rule
  would rest on untested string-building.

### Proving criterion 1

- **D-18:** **The owner performs the merge attempt personally, and a `docs/` record is written from
  what actually happened.** Open a real pull request carrying a BLOCKED migration — Phase 4's
  reverted `DROP` change is ready-made material — watch the required check fail, attempt to merge
  with the owner's own admin account, and record verbatim what GitHub actually said. Then close the
  pull request unmerged. This follows `02-CONTEXT.md` D-10's precedent exactly: the runbook was
  written from a performed restore, not from documentation prepared in advance. No test can assert
  criterion 1 from inside the system, because it is a claim about what GitHub refuses to do for a
  specific human account.
  A fully automated merge-refusal test (mirroring `04-07`'s `blocked-replay.test.ts`) was rejected:
  it would need a token with repository write access held in CI, and would create and delete real
  pull requests on every run — a credential-holding automation inside the repository whose purpose
  is minimising credential surface.
  **Note the pairing:** D-05's continuous ruleset assertion still stands. D-18 proves the property
  was true once, by observation; D-05 keeps proving it. That combination is this project's usual
  shape.

### Carried forward (binding, not re-decided here)

- **The CI gate is not the wall — the runner is** (`docs/decisions.md` D12). Every gate upstream of
  the runner sits on a bypassability spectrum and must be described honestly as such. This applies
  to D-04's ruleset and D-05's config check alike.
- **A parse failure (analyzer exit 30) and an invalid rules file (exit 40) fail the build, and are
  reported distinctly from BLOCKED** — `03-CONTEXT.md` D-08 and `04-CONTEXT.md` D-08 both require
  that "the analyzer is broken" never be collapsed into "the migration is destructive."
- **Hard-fail, never warn** (`01-CONTEXT.md` D-20, `02-CONTEXT.md` D-19/D-20). A check that could
  not run is not a check that passed — this is the reasoning behind refusing path-filtered
  skip-with-success in D-04.
- **The runner's exit-code contract is `RUNNER_EXIT_CODES`, not the analyzer's `EXIT_CODES`**
  (`packages/automation/src/runner/exit-codes.ts`) — its own comment names this phase as the reader.
  `1` is deliberately not a member of either set.
- **No command accepts a target** (`01-CONTEXT.md` D-16, `02-CONTEXT.md` D-06). CI does not get an
  exception; D-14 shapes the CI database to satisfy the pin instead.
- **PostgreSQL 17 everywhere** (D9); the container image is `postgres:17` Debian, not alpine
  (`01-CONTEXT.md` D-12, `02-CONTEXT.md` D-12).
- **Production's PostgreSQL major version is still UNKNOWN** (`docs/decisions.md` D16). It does not
  block this phase; it must not be quietly assumed either.
- **`01-CONTEXT.md` D-11's fourth churn row (expand-and-contract) is reserved for Phase 7.**

### Claude's Discretion

- Workflow file layout: one workflow or several, job names, job granularity, and how the required
  check names are chosen (they become ruleset configuration under D-04, so they need to be stable).
- Caching strategy for pnpm and Docker layers, and whether a `concurrency` / cancel-in-progress
  policy is set.
- The exact mechanics of D-09's append-only diff: merge-base derivation, `fetch-depth`, and whether
  it is a script under `scripts/` or an inline step.
- The journal entry-comparison implementation for D-10, and where its tests live.
- The sticky comment's markdown structure, its hidden marker for find-and-update, and how a
  zero-findings run renders.
- The scheduled drill workflow's cadence in D-13, and what it does on failure (it has no pull
  request to comment on).
- How the D-14 migrate job provisions `recipe_dev` on the service container so the pin is satisfied
  without touching `scripts/env.ts`.
- The filename and location of D-18's record, following the `docs/` `00-`/`10-`/`20-`/`30-`
  numbering convention.
- Whether the D-03 history audit is scripted or manual, and what tooling it uses.
- Whether the recipe app gains a build or lint check in CI (it currently has none).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase requirements and goal

- `.planning/ROADMAP.md` § "Phase 5: CI Pipeline Gate" — the goal and the four success criteria
  this phase is verified against. Criterion 1 (the owner cannot merge) and criterion 3 (both
  tamper clauses) are the sharp ones.
- `.planning/REQUIREMENTS.md` — CI-01 … CI-06 are this phase's requirements. The Out of Scope table
  lists anti-features that must not be reintroduced, notably migrations at application startup and
  blanket blocking of a change class.

### Binding prior decisions

- `docs/decisions.md` — **D12** (classification re-derived at execution time; the CI check is *not*
  the non-bypassable point, and its own text already discusses ruleset bypass lists and the
  environment-review limitation), **D8** (migrations never run at application startup — CI-06's
  subject), **D9** (PostgreSQL 17 pinned), **D10** (parse, never pattern-match), **D11** (drizzle
  pinned to the stable line), **D2**/**D3** (no production or remote access — why this phase's
  databases are all ephemeral), **D16** (the analyzer's classification contract; production's PG
  major is still UNKNOWN), **D17** (the widened code floor), **D21** (`drizzle-kit migrate` is
  structurally unreachable).
- `.planning/phases/04-migration-runner-history-tests/04-CONTEXT.md` — **required reading.**
  Directly binding: **D-05** (REVIEW REQUIRED proceeds with complete findings — the source of D-06),
  **D-06/D-19** (the machine-readable run report and the runner-owned table; "the contract Phase 5
  reads"), **D-07** (why already-applied migrations are not suppressed — the source of D-07 here),
  **D-02** (no second migrate path; the second-door argument behind D-04), **D-15** (verify, don't
  trust — the source of D-05), **D-22/D-23/D-24** (the Testcontainers harnesses, the
  harness-only-connection seam, and the fast/slow suite split), **D-27/D-28** (the extraction seam
  D-17 preserves), **D-30/D-31/D-32** (the three real schema changes; D-32's revert is what D-10
  affects).
- `.planning/phases/03-safety-analyzer/03-CONTEXT.md` — **required reading.** Directly binding:
  **D-02** (the code floor and its self-checks — D-11's first half), **D-08** (parse failure is a
  hard error, not a verdict), **D-10** (worst verdict wins; complete findings always),
  **D-11/D-12** (pure core, thin adapter, distinct exit codes — the shape D-17 follows).
- `.planning/phases/02-backup-restore-drill/02-CONTEXT.md` — **required reading.** Directly binding:
  **D-10** (the runbook written from a performed act — the precedent D-18 follows), **D-16** (slow
  Docker suites stay out of the fast path — the reasoning behind D-13), **D-19** (the 30-day
  staleness gate D-13 relieves), **D-06** (no command accepts a target).
- `.planning/phases/01-local-environment/01-CONTEXT.md` — Directly binding: **D-16**
  (`assertLocalDevelopmentTarget` and pin-in-source — D-14 must satisfy it, never loosen it),
  **D-14** (why a second ungated path to schema state is refused), **D-20** (hard-fail, never warn),
  **D-11** (the reserved churn table; the fourth row is Phase 7's), **D-12** (`postgres:17` Debian).
- `CLAUDE.md` and `.claude/CLAUDE.md` — non-negotiables. Especially: prefer architectural
  enforcement over remembered caution; **mark unverified things UNKNOWN** (D-02's plan-tier note and
  D-03's history-audit reasoning are both instances); never log or commit credentials — which D-02
  and D-03 turn from a repo-local rule into a public-internet one.

### Research

- `.planning/research/ARCHITECTURE.md` — **the most directly relevant research document for this
  phase.** Its bypassability ranking table (classic branch protection is admin-bypassable by
  default; repository rulesets with an empty bypass list are the mechanism to use; environment
  protection bypass-disabling is documented public-repo-only on Free/Pro/Team) is the direct source
  of D-02, D-04 and D-05. Also its enforcement-flow diagram (step 7) and the reusable-workflow note
  for the PLAT-01 future.
- `.planning/research/PITFALLS.md` **§C2** — how a gate becomes decorative through routine
  overriding. The direct reasoning behind D-06 and D-10's refusal of a revert escape. Also the
  CI-specific row on distinguishing "migration test failed" from "timed out on a lock."
- `.planning/research/SUMMARY.md` — its §"Phase 4: CI Wiring" maps to this phase under the old
  numbering, and line 59 names the same-pull-request desync attack D-11 addresses.
- `.planning/research/FEATURES.md` — §1 rule catalogue; the anti-feature table on startup
  migrations (D-15).
- `.planning/research/STACK.md` — `@testcontainers/postgresql` 12.1.0, `squawk-cli`'s Windows
  packaging, and the Windows-vs-Linux tooling constraints behind D-12.

### Existing code this phase builds on

- `packages/automation/src/cli.ts` — the analyzer CLI: `--json` and `--migrations` flags, and the
  `run(): Promise<number>` shape that never calls `process.exit()` (a deliberate Windows fix).
- `packages/automation/src/types.ts` — `EXIT_CODES` (0/10/20/30/40), `AnalysisResult`, `Finding`,
  `AnalyzerParseError`, `RulesFileError`.
- `packages/automation/src/runner/exit-codes.ts` — `RUNNER_EXIT_CODES`; its own comment names this
  phase as the reader of the contract.
- `packages/automation/src/classifier/floor.ts` — `assertFloorNotWeakened` and
  `assertUnmatchedDefaultsToReview`, the two load-time self-checks D-11 rests on.
- `packages/automation/src/index.ts` — the public barrel D-17's renderer is exported from.
- `scripts/db-migrate.ts` — the pinned runner entry point D-14 runs unmodified in CI.
- `scripts/env.ts` — `assertLocalDevelopmentTarget`, `EXPECTED_DEV_DATABASE_PORT` and the pinned
  constants D-14 must satisfy rather than loosen.
- `tests/guardrails.test.ts` — where D-11's proof and D-15's startup-migration assertion belong;
  it already holds the D-14 init-script and D-02 no-second-migrate-path guardrails.
- `tests/history/` — `empty-db-full-history.test.ts`, `existing-db-newest-only.test.ts`,
  `tamper-then-refuse.test.ts`, `blocked-replay.test.ts`, `support.ts`. Both CI-01 axes already
  exist; this phase runs them in CI rather than rewriting them.
- `scripts/history-suite.ts`, `vitest.history.config.ts`, `vitest.drill.config.ts` — the existing
  suite split D-13 maps onto CI jobs.
- `tests/smoke.test.ts` — the application boot test; note its `win32` `taskkill` branch, relevant
  to D-12.
- `apps/recipe-app/drizzle/` and `meta/_journal.json` — five migrations; the journal carries **no
  content hash**, which is the grounding fact for D-09.
- `packages/automation/src/runner/ledger.ts` — where the sha256 scheme actually lives, for contrast
  with the journal.
- `docs/30-migration-runner.md` — the D-33 record of what the runner actually prints for SAFE,
  REVIEW REQUIRED and BLOCKED; the model for D-18's record and useful source material for D-16's
  comment format.
- `docs/migration-history-status.json`, `docs/restore-drill-status.json` — the committed status-file
  pattern, and the drill's staleness input D-13 relieves.
- `package.json` (root) — the script surface CI invokes: `db:analyze`, `db:analyze:migrations`,
  `db:migrate`, `test`, `test:history`, `test:drill`.

</canonical_refs>

<code_context>
## Existing Code Insights

Phases 1–4 built everything this phase needs to *invoke*. Almost nothing in this phase is new
analysis logic; it is wiring, configuration, and two genuinely new checks (D-09's pair). The
largest new surface is not code at all — it is a GitHub repository that does not yet exist.

### Reusable Assets

- **The analyzer CLI** — `db:analyze --json` already emits complete machine-readable findings with
  five distinct exit codes. D-06's pass/fail mapping and D-16's comment both read it.
- **Both migration test axes** — `tests/history/empty-db-full-history.test.ts` and
  `existing-db-newest-only.test.ts` already exist and pass, driven by `pnpm test:history`. CI-01
  runs them; it does not write them.
- **The runner entry point** — `scripts/db-migrate.ts` runs unmodified in D-14's job, provided the
  CI database is shaped to satisfy its pin.
- **`floor.ts`'s two self-checks** — already make a weakened rules file refuse to load. D-11
  verifies rather than builds.
- **`tests/guardrails.test.ts`** — an established home for source-surface assertions, already
  holding the D-14 and D-02 guardrails; D-11 and D-15 extend the same file.
- **`docs/30-migration-runner.md`** — a worked example of a phase record written from real output,
  and a source of the verbatim runner text D-16's comment format can mirror.

### Established Patterns

- **Architectural enforcement over remembered caution.** D-04 (empty bypass list), D-09/D-10
  (append-only by diff, not by convention) and D-14 (satisfy the pin rather than loosen it) are
  this phase's instances.
- **Verify, don't trust the tool's own account of itself.** `assertMigrationHistoryApplied` and
  `assertTimeoutsInEffect` both exist for this reason; D-05 applies the same scepticism to the
  ruleset.
- **Perform it once by hand, then make it continuously verified.** `02-CONTEXT.md` D-10 plus the
  automated drill; here D-18 plus D-05.
- **Pure core, thin adapter.** `packages/automation` holds no `pg`, no filesystem in the core, and
  now no octokit either — D-17.
- **Hard-fail, never warn.** The reason D-04 declines skip-with-success path filtering.
- **Documentation is a deliverable.** D-18's record follows `02-CONTEXT.md` D-10 and
  `04-CONTEXT.md` D-33.

### Integration Points

- **New:** a GitHub repository and remote (D-01/D-02), created after the D-03 history audit.
- **New:** `.github/workflows/` — the repository's first workflow files. Nothing constrains their
  shape yet.
- **New:** a repository ruleset (D-04) and a check that asserts its configuration (D-05).
- **New:** the append-only and schema-drift checks (D-09/D-10), and the sticky-comment plumbing
  (D-16).
- **New in `packages/automation`:** a pure markdown renderer (D-17), exported from the barrel.
- **New in `docs/`:** the criterion-1 record (D-18).
- **Changed:** `tests/guardrails.test.ts` gains D-11's proof and D-15's startup-migration assertion.
- **Changed workflow, not code:** every `.planning/` commit now travels through a pull request
  (D-04). This affects how every subsequent GSD phase is executed in this repository.
- **Consumed by Phase 6:** the migrate job shape (D-14) gains a staging environment and a
  connection mechanism rather than being invented then.
- **Consumed by Phase 7:** the same job gains an environment protection rule; D-02's public
  visibility is what makes disabling its bypass possible; D-08's "GitHub is the record" is
  superseded by the real audit log.

</code_context>

<specifics>
## Specific Ideas

- **"The bypass list is empty" is the phase in one sentence.** Everything else is what makes that
  sentence provable and keeps it true.
- **The check that audits the ruleset runs inside the thing it audits.** Say so wherever it is
  described. It raises the cost of tampering and makes it visible; it does not make it impossible.
- **BLOCKED is the wall; making REVIEW REQUIRED a second wall weakens the first.** Carried verbatim
  from `04-CONTEXT.md` D-05, because the temptation is stronger in CI than it was locally.
- **`0001` is a live specimen, not noise.** It classifies REVIEW REQUIRED on every run, correctly.
  D-07's grouping is how it stays visible without becoming wallpaper.
- **The journal has no hash.** Every tamper-detection design that assumed one is wrong; git and
  `schema.ts` are the only available references.
- **Shape the CI database to fit the pin, never loosen the pin to fit CI.** A service container at
  `127.0.0.1:5432/recipe_dev` satisfies `assertLocalDevelopmentTarget` honestly.
- **A required check that never reports blocks the merge.** That property — not a rule about editing
  workflow files — is what closes the delete-the-job attack.
- **Publishing is the irreversible act, not the visibility toggle.** D-03 exists because 234 commits
  go public at once and can be cloned before anyone reconsiders.
- **No test can assert criterion 1 from inside the system.** It is a claim about what GitHub refuses
  to do for a specific human account, which is why D-18 is a performed act with a written record.

</specifics>

<deferred>
## Deferred Ideas

- **An approval/override path for REVIEW REQUIRED, with override logging and per-rule frequency
  counting (AUD-04)** — **Phase 7**, unchanged. D-06 resolves this phase's half by building none,
  so there is nothing yet to count.
- **The real audit log (AUD-01 … AUD-04)** — **Phase 7**. D-08's "GitHub is the record" is a
  deliberate stopgap, not an audit trail, and must not be described as one.
- **Environment protection rules and the production self-approval gate** — **Phase 7**. D-02's
  public visibility is what makes disabling their bypass possible; record that as a resolved
  input to Phase 7 rather than the open blocker `.planning/STATE.md` currently lists.
- **Fork pull requests** — D-16's sticky comment cannot post under a fork's read-only token.
  Not a case that exists on a solo repository; revisit if a contributor ever appears.
- **A Windows CI job for the fast suite** — declined by D-12 for this phase (Linux containers are
  unavailable on Windows runners, so only `pnpm test` could run there). Revisit if a Windows-only
  regression actually escapes to the dev machine.
- **Check-run annotations on the exact lines of offending SQL** — considered alongside D-16 and
  not taken. Genuinely the best place to read "this statement is why"; revisit if the comment
  proves hard to read against a large migration.
- **A committed sha256 lockfile for migrations** — declined by D-09 as ceremony over the git rule.
  Revisit only if a scenario appears where git history is not an available reference.
- **A reusable `workflow_call` workflow for other applications** — `ARCHITECTURE.md` recommends it
  for the PLAT-01 future. Explicitly **not** this phase: `PROJECT.md` says not to build the reusable
  controller before one application proves the pipeline.
- **CI running `eugene trace` for real lock evidence** (ADV-01, v2) and **schema drift detection
  against a live environment** (ADV-02) — unchanged; both need a real remote database.
- **A build or lint check for the recipe app** — it has none today. Left to Claude's discretion
  whether this phase adds one; it is not required by CI-01.

</deferred>

---

*Phase: 5-CI Pipeline Gate*
*Context gathered: 2026-09-09*
