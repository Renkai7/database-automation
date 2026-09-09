# CI Gate Merge Attempt (D-18)

**Status:** Performed by the repository owner, signed in with their own admin account, on
2026-09-09, against the live `main-protection` ruleset (`docs/decisions.md` D26) with an
empty bypass list. This record is written from what actually happened — the owner's own
verbatim report and the checks' own logs — not composed in advance. It follows
`docs/20-restore-runbook.md`'s precedent (`02-CONTEXT.md` D-10): a record written from a
performed act.

## Scope — what this proves and what it does not

This proves criterion 1 **for the owner's admin account, through GitHub's web UI, on
2026-09-09, against ruleset `main-protection` on `Renkai7/database-automation` with an empty
bypass list.** It does not generalize into "nobody can ever merge a destructive migration" —
it is a claim about what GitHub refused to do for one specific human account, observed once,
under one specific, read-back-and-confirmed configuration.

**The gate's real boundary, stated honestly** (`docs/decisions.md` D12, D-05, D31): an empty
`bypass_actors` list stops merges past the gate. It does **not** stop a repository admin
editing or deleting the ruleset itself. Someone with admin access to this repository could
change `bypass_actors`, remove a required check, or delete the ruleset entirely — none of
that requires walking through the merge control this record observes. `docs/decisions.md`
D-05 states this plainly: "the check runs inside the thing it audits ... it raises the cost
of tampering and makes it visible; it does not make it impossible." This record is proof the
merge control itself holds; it is not proof the configuration behind it cannot be changed by
someone with the access to change it.

**A second, narrower limit, specific to this phase** (`docs/decisions.md` D31): since D26
applied the ruleset, the empty bypass list is continuously verified only by the *advisory*
`ruleset-bypass-audit` job — which fails loudly and visibly on every pull request but does
**not** block a merge — plus this one-time performed observation. The *required* gate,
`ruleset-config-check`, no longer asserts `bypass_actors` is empty at all; it asserts only
what a `contents: read` `GITHUB_TOKEN` can genuinely observe (enforcement active, required
rule types and required-check contexts present). That is the owner's deliberate, recorded
trade (D31), made because no workflow token could observe `bypass_actors` under any
grantable `permissions:` scope (D30), and adding a credential to close that gap was
explicitly rejected in the same entry.

## Observation 1 — the BLOCKED pull request the owner could not merge (criterion 1)

Pull request #4, `demo/blocked-drop-ingredients`,
<https://github.com/Renkai7/database-automation/pull/4> — a real, `drizzle-kit`-generated
`DROP TABLE` migration reproducing Phase 4's own reverted `D-32` change (`docs/decisions.md`).

### The safety verdict, visible on the pull request itself

The sticky comment posted by the `analyze` job (verbatim, marked by its own
`<!-- database-automation:safety-verdict -->` comment):

> ## Migration Safety Verdict: BLOCKED
>
> BLOCKED fails this check. This pull request cannot merge until the classification changes.
>
> ### Introduced by this pull request
>
> #### apps/recipe-app/drizzle/0005_zippy_madelyne_pryor.sql -- BLOCKED
> - Statement 0: **BLOCKED** -- rules: drop-table -- DROP TABLE permanently destroys the
>   table and every row it holds; there is no automated way to recover the data afterward.
>
> ### Pre-existing (already applied)
>
> [five earlier migrations, each classified SAFE or REVIEW_REQUIRED with its own rule id and
> rationale — omitted here for length; the full text is on the pull request's own comment
> thread]
>
> This check's authority covers the whole committed migration history; the grouping above is
> presentation only. This comment is a display of the current verdict, not an audit record
> (D-08).

Every rule id and rationale is visible directly on the pull request page itself, not only
inside the Actions run — satisfying criterion 2 the same observation exercises incidentally.

### The check results, at the moment of the merge attempt

`gh pr checks 4` reported (all eight contexts; six of them required per the
`main-protection` ruleset, D26):

| Check | Required | Result |
|---|---|---|
| analyze | yes | FAIL |
| migrate | yes | FAIL |
| test | yes | FAIL |
| test-history | yes | FAIL |
| tamper-checks | yes | pass |
| ruleset-config-check | yes | pass |
| ruleset-bypass-audit | no (advisory, D31) | FAIL |
| GitGuardian Security Checks | no (third-party, not in ruleset) | pass |

`analyze`, `migrate`, `test`, and `test-history` failed together — the BLOCKED verdict in
`analyze` cascades: `migrate` refuses to apply a BLOCKED migration (RUN-02, unchanged from
Phase 4), and `test`/`test-history` fail because the schema left mid-cascade no longer
matches expectations. This is the expected shape: the whole point of Observation 1 is that a
BLOCKED migration is refused everywhere it touches, not narrowly inside the analyzer alone.
`ruleset-bypass-audit` fails independently and continuously on every pull request per D31 —
its failure here is unrelated to the BLOCKED migration and is expected on every pull request
opened against this repository today (see `docs/decisions.md` D31's own residual-limit note).

### What the owner reported, verbatim

The owner, signed in with their own admin account, attempted to merge the pull request
through GitHub's web interface and reported the following, word for word (the misspelling
"Meging" is the owner's own typo — transcribed exactly as reported, not corrected):

```
Meging is blocked due to failing merge requirements. Here are the requirements failed:
failing checks
PR Gate / analyze (pull_request)
PR Gate / analyze (pull_request)Failing after 22s
Required
PR Gate / migrate (pull_request)
PR Gate / migrate (pull_request)Failing after 48s
Required
PR Gate / ruleset-bypass-audit (pull_request)
PR Gate / ruleset-bypass-audit (pull_request)Failing after 15s
PR Gate / test (pull_request)
PR Gate / test (pull_request)Failing after 26s
Required
PR Gate / test-history (pull_request)
PR Gate / test-history (pull_request)Failing after 43s
Required
```

Two things this report independently corroborates, worth recording because they are
first-hand UI evidence — what the owner's own browser showed — rather than an API read-back:

1. **`analyze`, `migrate`, `test`, and `test-history` each carry the label "Required" in
   GitHub's own merge-control UI; `ruleset-bypass-audit` appears in the same failing list
   without that label.** This is GitHub confirming, in the interface the owner actually saw,
   that the D31 split landed as designed — the bypass audit is visible and loud but not
   merge-blocking.
2. **`tamper-checks` and `ruleset-config-check` are absent from the failing list because
   they passed.** The block the owner saw is isolated to the analyzer's verdict (and its
   downstream cascade), not to a tamper artifact or a ruleset-configuration problem.

**Asked explicitly whether GitHub offered their admin account any way to merge anyway** — a
"Merge without waiting for requirements to be met (bypass rules)" button, an admin-override
toggle, or any similar affordance — **the owner answered: no override was offered at all.**
The merge button was simply blocked; no bypass control appeared anywhere on the page.

### The property this also observes (D-11)

While this pull request's `analyze` check sat in a failing (non-success) state, the merge
control stayed unavailable rather than available-with-a-warning. This is the property
`docs/decisions.md` D-11 rests on, observed here for the **failing** case specifically.

**Stated honestly, what this does and does not cover:** this observes only the failing-check
case. The stronger claim — that a required check which *never reports* (rather than reports
failure) also blocks the merge — is documented by GitHub itself but was **deliberately not
provoked** here, because provoking it means shipping a ruleset context that matches no job,
which `05-RESEARCH.md` Pitfall 2 names as the state that leaves every future pull request
permanently blocked. That case is recorded here as UNKNOWN-by-design, not as an oversight.

### Closed unmerged

Pull request #4 was closed without merging as the final step of this task, after every
observation above was recorded.

## Observation 2 — an edit to an already-applied migration (criterion 3, first clause)

Pull request #5, `demo/tamper-edit-applied-migration`,
<https://github.com/Renkai7/database-automation/pull/5> (closed unmerged) — a one-character
edit (removing the trailing newline and appending a blank line) to
`apps/recipe-app/drizzle/0000_bumpy_khan.sql`, a migration already committed and applied on
`main`.

`tamper-checks` failed. The exact message `assertMigrationFilesAppendOnly` produced, read
verbatim from the job's own log (`Assert migrations are append-only (files and journal
entries) -- D-09/D-10` step):

```
CI-05: "apps/recipe-app/drizzle/0000_bumpy_khan.sql" has git status "M", not "A" -- migrations under apps/recipe-app/drizzle/ are append-only, with no exemption for reverts.
```

Closed unmerged.

## Observation 3 — a hand-edited divergence from schema.ts (criterion 3, second clause)

Pull request #6, `demo/tamper-schema-drift`,
<https://github.com/Renkai7/database-automation/pull/6> (closed unmerged).

**Deviation from the plan's literal action text, recorded so it is not mistaken for an
oversight.** The plan describes "editing a committed migration so the history no longer
reconstructs `schema.ts`." Editing an existing, already-committed `.sql` file in place would
have tripped the append-only check (`assertMigrationFilesAppendOnly`, Observation 2's
mechanism) first — and GitHub Actions skips a job's later steps once an earlier step fails,
so `check-schema-drift.ts` would never have run, and its own failure message — the specific
thing this observation exists to capture — would never have been produced. Instead, a new
migration (`0005_lumpy_starjammers.sql`, `ALTER TABLE "recipes" DROP COLUMN "notes";`) was
generated against a temporarily-edited `schema.ts` that no longer declared the `notes`
column, then committed alongside the real, unmodified `schema.ts` (which still declares
`notes: text("notes")`). The migration file and its journal entry are pure additions —
passing the file-level append-only check cleanly — which isolates the schema-drift half of
`tamper-checks` as the one that fails, the exact property Observation 3 needs to demonstrate.

`tamper-checks` failed on the schema-drift step. Read verbatim from the job's own log (`Assert
schema.ts and the committed migration history agree (no drift) -- D-09` step):

```
[check-schema-drift] db:generate exited 0 -- recorded as an observation only, never relied on as the drift signal (assumption A4 stays UNKNOWN).
[check-schema-drift] schema.ts and the committed migration history no longer agree -- generation produced: apps/recipe-app/drizzle/meta/_journal.json, apps/recipe-app/drizzle/0006_married_jimmy_woo.sql, apps/recipe-app/drizzle/meta/0006_snapshot.json
```

The file generation produced when it detected drift: `apps/recipe-app/drizzle/0006_married_jimmy_woo.sql`
(plus the accompanying `meta/_journal.json` and `meta/0006_snapshot.json` regeneration).
Note that `db:generate`'s own exit code was **0** even though drift was found — confirming
`05-RESEARCH.md` Pitfall 4's finding that the generator's exit code does not distinguish
"clean" from "drift found," and confirming why assumption A4 (whether generation exits
non-zero when it does produce a migration) stays deliberately UNKNOWN rather than relied
upon: the check's real signal is the appearance of files in `git status --porcelain`, never
the child process's exit code.

Closed unmerged.

## What this record is not

**This is not an audit trail.** The pull-request comment and the GitHub Actions run are a
display that GitHub happens to retain — a UI surface, not a durable, append-only record built
for this project's own purposes. The real audit log is Phase 7's deliverable
(`docs/decisions.md` D-08: "the CI verdict is displayed, not recorded";
`.planning/REQUIREMENTS.md` AUD-01…AUD-04). Nothing in this document, and nothing in
GitHub's retention of the checks and comments it references, should be read as satisfying
the audit requirements — it is evidence gathered for this phase's own verification, held on
GitHub's default retention schedule, with no guarantee it persists past that schedule.

## Still open, not settled by this record

- Whether a required check that never reports (as opposed to one that reports failure)
  blocks a merge is documented by GitHub but was not separately provoked in this phase — see
  Observation 1's closing note.
- The owner's GitHub plan tier remains UNKNOWN (`docs/decisions.md` D-02) — this repository's
  public visibility is what makes the tier not matter for this gate, not a fact this record
  established.
- Production's PostgreSQL major version remains UNKNOWN (`docs/decisions.md` D16) — untouched
  by anything observed here.

---
*Record: `docs/40-ci-gate-merge-attempt.md`*
*Written from a performed act, 2026-09-09 — following `docs/20-restore-runbook.md` and
`02-CONTEXT.md` D-10's precedent.*
