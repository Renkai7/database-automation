# Phase 5 — External API Coverage Matrix

**Produced:** 2026-09-09
**Trigger:** `api-coverage.cjs --json` returned `{"detected": true}` on the phase scope
(signal: `05-CONTEXT.md` D-05 — "It queries the GitHub API").

## Honest judgement: is this an external API integration?

**Yes.** This phase does integrate an external API. It calls the GitHub REST API (through the
`gh` CLI, which is a thin authenticated client over that API) to create a repository, create and
read a repository ruleset, read Actions permissions, and create/edit a pull-request comment.
The fact that the calls travel through `gh` rather than `octokit` changes the *client*, not the
fact that a third-party service's capability surface is being consumed. Recording it as
"just CLI usage" would be the silent hole this gate exists to prevent.

**Scope note.** The matrix below covers the GitHub capability surface that is *reachable and
relevant to this phase's requirements* (CI-01 … CI-06) — repository lifecycle, branch/ruleset
protection, Actions, and pull-request surfaces. GitHub's total REST surface (Projects, Packages,
Codespaces, Copilot, Billing, Gists, Discussions, …) is not enumerated line by line: none of it is
reachable from this phase's requirements, and enumerating it would produce noise, not decisions.
Every capability that *could* plausibly serve one of this phase's success criteria is listed and
decided.

## Coverage matrix

| # | Capability | REST / CLI surface | Decision | Reason |
|---|---|---|---|---|
| 1 | Create a repository | `POST /user/repos` (`gh repo create`) | INTEGRATE | D-01: the phase's own first deliverable. |
| 2 | Set repository visibility | `PATCH /repos/{o}/{r}` (`--public`) | INTEGRATE | D-02: public visibility is what removes the plan-tier risk from CI-03. |
| 3 | Read repository metadata | `GET /repos/{o}/{r}` (`gh repo view --json`) | INTEGRATE | Verifies visibility and default branch after creation — verify, don't trust. |
| 4 | Create a repository ruleset | `POST /repos/{o}/{r}/rulesets` | INTEGRATE | D-04/CI-03: this is the wall. |
| 5 | Read a repository ruleset (incl. `bypass_actors`) | `GET /repos/{o}/{r}/rulesets/{id}` | INTEGRATE | D-05: the self-check. The only endpoint that returns `bypass_actors` at all. |
| 6 | List repository rulesets | `GET /repos/{o}/{r}/rulesets` | INTEGRATE | The self-check must see *every* ruleset matching `main`, not only its own. |
| 7 | Update a repository ruleset | `PUT /repos/{o}/{r}/rulesets/{id}` | INTEGRATE | Makes `apply-ruleset.ts` idempotent (create-or-update) rather than one-shot. |
| 8 | Delete a repository ruleset | `DELETE /repos/{o}/{r}/rulesets/{id}` | OPT-OUT | Nothing in this phase removes the gate; a scripted delete path is a second door. |
| 9 | Read Actions default workflow permissions | `GET /repos/{o}/{r}/actions/permissions/workflow` | INTEGRATE | RESEARCH Open Question 2 — the sticky comment needs a write-capable token. |
| 10 | Set Actions default workflow permissions | `PUT /repos/{o}/{r}/actions/permissions/workflow` | INTEGRATE | Same; set only if the observed default is read-only. |
| 11 | Create a pull request | `POST /repos/{o}/{r}/pulls` (`gh pr create`) | INTEGRATE | The tracer PR and D-18's BLOCKED PR are both real pull requests. |
| 12 | Read pull-request checks | `GET .../commits/{sha}/check-runs` (`gh pr checks`) | INTEGRATE | Criterion 1/2 are claims about what the checks report. |
| 13 | Create / edit a pull-request comment | `POST/PATCH .../issues/{n}/comments` (`gh pr comment --edit-last --create-if-none`) | INTEGRATE | D-16/CI-04: the sticky verdict comment. |
| 14 | Merge a pull request | `PUT /repos/{o}/{r}/pulls/{n}/merge` (`gh pr merge`) | OPT-OUT | D-18: the merge *attempt* is performed by the owner in the web UI, not by automation; and no automation in this repository holds merge rights (D-04). |
| 15 | Close a pull request | `PATCH .../pulls/{n}` (`gh pr close`) | INTEGRATE | D-18 ends with the BLOCKED pull request closed unmerged. |
| 16 | Classic branch protection | `PUT /repos/{o}/{r}/branches/{b}/protection` | OPT-OUT | `.planning/research/ARCHITECTURE.md`: classic protection is admin-bypassable by default — the exact property this phase exists to defeat. Rulesets replace it. |
| 17 | Environment protection rules | `PUT /repos/{o}/{r}/environments/{name}` | OPT-OUT | Deferred to Phase 7 by `05-CONTEXT.md` (`<deferred>`); this phase configures a *branch* ruleset, not an *environment* one. |
| 18 | Actions secrets / variables | `PUT /repos/{o}/{r}/actions/secrets/{name}` | OPT-OUT | `05-CONTEXT.md` `<domain>`: no credentials in CI beyond the default `GITHUB_TOKEN`. Adding one before Phase 6's connectivity decision inverts the project's sequencing constraint. |
| 19 | Workflow artifact upload | `actions/upload-artifact` | OPT-OUT | D-08 rejected it explicitly: an expiring artifact would be mistaken for an audit trail. |
| 20 | Job summaries | `$GITHUB_STEP_SUMMARY` | OPT-OUT | D-16: a job summary lives in the Actions UI and does not satisfy criterion 2's "directly on the PR". |
| 21 | Check-run annotations on offending lines | `POST /repos/{o}/{r}/check-runs` | OPT-OUT | `05-CONTEXT.md` `<deferred>`: considered alongside D-16 and not taken; revisit if the comment proves hard to read. |
| 22 | Issue creation | `POST /repos/{o}/{r}/issues` (`gh issue create`) | INTEGRATE | The scheduled restore drill (D-13) has no pull request to report to; a failure must surface somewhere the owner sees. |
| 23 | Repository secret scanning / push protection | `PATCH /repos/{o}/{r}` security-and-analysis | OPT-OUT | D-03's own audit is this phase's mechanism, performed before the push rather than relying on the platform catching it after. Revisit as a belt-and-braces addition in a later phase. |
| 24 | Fork pull-request handling (`pull_request_target`) | workflow trigger | OPT-OUT | RESEARCH Pitfall 6 names it an anti-pattern here; D-16 records the fork gap as accepted, not solved. |
| 25 | GraphQL API | `gh api graphql` | OPT-OUT | Every capability above has a REST equivalent already in use; a second API idiom in one phase is surface without benefit. |

## Undecided holes

None. Every row carries either INTEGRATE or OPT-OUT with a stated reason.
