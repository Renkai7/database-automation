---
phase: quick-260908-kdl
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - .planning/REQUIREMENTS.md
autonomous: true
requirements: [APP-01]

estimate:
  tokens: 13000
  raw_tokens: 26000
  tasks: 2
  confidence: high

must_haves:
  truths:
    - "`.planning/REQUIREMENTS.md` shows APP-01 as a ticked v1 requirement, agreeing with the three independent sources that already record it satisfied (01-VERIFICATION.md, 01-02-SUMMARY.md, 01-05-SUMMARY.md)."
    - "The document's closing note states, dated 2026-09-08 and citing the Phase 1 verification report by name, that APP-01 was ticked on re-verification evidence."
    - "No requirement belonging to an unstarted phase (RUN / CI / CONN / PROD / AUD / APP-02 / APP-03) is shown as ticked."
    - "The traceability table rows and the Coverage summary are unchanged from their pre-edit state."
    - "No file outside `.planning/REQUIREMENTS.md` is modified by this task."
  artifacts:
    - ".planning/REQUIREMENTS.md (modified in place — not created, not rewritten wholesale)"
  key_links:
    - "APP-01 checkbox <-> APP-01 traceability row: after this task both read as complete; before it they contradicted each other."
    - "Closing note <-> 01-VERIFICATION.md: the note's claim is traceable to a named on-disk report rather than resting on its own assertion."
---

<objective>
Close the one requirement-level bookkeeping discrepancy the `/gsd-audit-milestone` pass found in
delivered scope, and replace the document note that has since gone stale. Both sites are in
`.planning/REQUIREMENTS.md`; nothing else is touched.

Purpose: this file is the project's record of what has actually been delivered. Phase 4 planning
reads it. A box that says "not done" for work that three artifacts say is done is exactly the kind
of undocumented drift this project exists to prevent — and a footer note describing a wait that
has since ended is a stale assumption presented as current fact.

Output: `.planning/REQUIREMENTS.md`, with APP-01 ticked and a re-dated closing note.

**This plan records APP-01; it does not implement or verify it.** The implementation and the
verification both already happened, in Phase 1. The only thing missing was the checkbox.

**Plan-time observation (mutable-scope authority).** Both edit sites were re-read live at planning
time, not taken from the audit's quoted line numbers:

- Line 85 currently reads: `- [ ] **APP-01**: A minimal recipe schema exists and the application boots against it`
- Line 125 (the traceability row, **not** an edit site) already reads: `| APP-01 | Phase 1 | Complete — verified 2026-09-07 (UAT 5/5, security threats_open: 0) |`
- Lines 144-149 are the italic `*Last updated: 2026-09-07 after 01-08 gap-closure work — ...*` block, ending `...coverage preserved).*`
- Baseline counts, measured live: 20 ticked requirement boxes, 32 unticked. After this plan: 21 and 31.

The line numbers above are a navigation aid. The tasks below match on content, so they stay correct
if the file shifts before execution.
</objective>

<execution_context>
@~/.claude/gsd-core/workflows/execute-plan.md
@~/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/REQUIREMENTS.md
@.planning/v1-MILESTONE-AUDIT.md
@CLAUDE.md
</context>

<pre_contribution_dispositions>
Each injected checkpoint was evaluated against this task's actual scope — a single markdown
documentation file — and took its own stated skip branch. Nothing was fabricated to fill a slot.

| Contribution | Detection result | Disposition |
|---|---|---|
| API Coverage Decision Checkpoint | `detected: false` — the scope is one planning-directory markdown file. No external API, SDK, or service is called, imported, or configured. | Skipped per the contribution's own `detected: false` branch. No `COVERAGE.md` is written; a matrix row for a capability that does not exist would be a fabrication. |
| Assumption-Delta Architecture Checkpoint | `detected: false` — no singular→plural, required→optional, or derived→chosen transition. Flipping a status box from unticked to ticked changes a record of fact, not an identity model. | Skipped. No `<assumption_delta_decision>` block. |
| Schema Push Detection Gate | No schema-relevant files in `files_modified` (no `drizzle/schema.ts`, `src/db/schema.ts`, or `drizzle/*.ts`). | Skipped silently. No `[BLOCKING]` push task. |
| Security `<threat_model>` | Unconditional while `workflow.security_enforcement` is true (it is, at `security_asvs_level: 1`). | Included below, with reasoning for each STRIDE category rather than a blanket "N/A". |
</pre_contribution_dispositions>

<tracer_note>
Tracer-first decomposition does not apply here and is not being skipped out of convenience. A
tracer is the thinnest path through *every layer a phase touches*; this task touches exactly one
artifact with no layers beneath it. Task 1 is nonetheless the smaller, independently-verifiable
half and runs first, so an early failure costs one line rather than a rewritten document.
</tracer_note>

<tasks>

<task type="auto">
  <name>Task 1: Tick the APP-01 checkbox</name>
  <files>.planning/REQUIREMENTS.md</files>
  <precondition>The unticked APP-01 requirement line is present: `grep -cE '^- \[ \] \*\*APP-01\*\*' .planning/REQUIREMENTS.md` returns exactly `1`. If it returns `0`, halt and report — either the edit already landed or the file changed shape since planning; do not guess which.</precondition>
  <read_first>
    `.planning/REQUIREMENTS.md` — read the whole file once. It is ~150 lines; one read is enough for
    both tasks. Note in particular the `### Recipe App Fixture (APP)` section and the `## Traceability`
    table, so you can tell the checkbox line apart from the table row that mentions the same ID.
  </read_first>
  <action>
Change the leading list marker on the APP-01 requirement line under `### Recipe App Fixture (APP)`
from unticked to ticked. The requirement's descriptive text after the ID must stay byte-identical —
this edit changes one character inside the brackets and nothing else.

Do not touch any other checkbox. Every remaining unticked requirement (the RUN, CI, CONN, PROD and
AUD groups, plus APP-02 and APP-03) is genuinely unsatisfied because its phase has not started;
ticking one would be a false claim of delivered scope, which is the precise failure this task exists
to correct rather than to spread.

Do not touch the `## Traceability` table. Its APP-01 row already records the completion status and
its prose is correct as written; rewriting it would add a second, competing statement of the same
fact. Same for the `**Coverage:**` bullets — leave them exactly as they are, and do not restate
their counts anywhere.

Preserve the file's existing line endings (the working copy is CRLF; git reports LF in the index).
Use a scoped edit, not a whole-file rewrite.
  </action>
  <verify>
    <automated>F=.planning/REQUIREMENTS.md; B="$(grep -v '^#' "$F")"; [ "$(printf '%s\n' "$B" | grep -cE '^- \[x\] \*\*APP-01\*\*')" = "1" ] && [ "$(printf '%s\n' "$B" | grep -cE '^- \[ \] \*\*APP-01\*\*')" = "0" ] && [ "$(printf '%s\n' "$B" | grep -cE '^- \[x\] \*\*(RUN|CI|CONN|PROD|AUD)-')" = "0" ] && [ "$(printf '%s\n' "$B" | grep -cE '^- \[x\] \*\*APP-0[23]\*\*')" = "0" ] && [ "$(printf '%s\n' "$B" | grep -cE '^- \[x\] \*\*')" = "21" ] && [ "$(printf '%s\n' "$B" | grep -cE '^- \[ \] \*\*')" = "31" ] && echo GATE1-PASS</automated>
  </verify>
  <done>
`GATE1-PASS` prints. APP-01 reads as ticked; the ticked-box total moved 20 -> 21 and the unticked
total 32 -> 31, which is only possible if exactly one box changed and it was this one. Zero ticked
boxes exist in the RUN, CI, CONN, PROD, AUD, APP-02 or APP-03 sets.

This gate was run live against the pre-edit file during planning and failed there (`APP01x=0`), so
it is known to detect the edit's absence rather than passing vacuously.
  </done>
  <reversibility rating="reversible">A one-character change to a git-tracked markdown file; `git checkout` restores it.</reversibility>
</task>

<task type="auto">
  <name>Task 2: Re-date the closing note to what is now true</name>
  <files>.planning/REQUIREMENTS.md</files>
  <precondition>The current closing note is present and still describes the superseded state: `grep -c 'Last updated: 2026-09-07 after 01-08 gap-closure work' .planning/REQUIREMENTS.md` returns exactly `1`.</precondition>
  <action>
Replace the italic `*Last updated: ...*` block at the end of the file — it opens with
`*Last updated: 2026-09-07 after 01-08 gap-closure work` and closes with `coverage preserved).*` —
with a new note. Leave the `---` rule and the `*Requirements defined: 2026-09-06*` line above it
untouched.

The replacement is stale for two independent reasons, both of which the new note must stop
asserting: it describes the two Phase 1 traceability rows as carrying a status that names work still
pending, and both rows have since been rewritten to record completed verification; and it explains
that no box was ticked *because* that verification had not yet happened — it has now happened and
passed.

The new note must state, in prose, all of the following and nothing beyond them:

1. `Last updated: 2026-09-08` as the opening, in the same italic single-block style as the note it
   replaces.
2. That APP-01's checkbox was ticked on this date, and that the evidence is the Phase 1
   re-verification pass. Name the report file `01-VERIFICATION.md` exactly once — one citation, so
   the claim is traceable to an artifact on disk rather than to the note itself.
3. That ticking the box makes it agree with a completion status the traceability row already
   carried; it is not a new claim of delivered work. Both the summaries `01-02-SUMMARY.md` and
   `01-05-SUMMARY.md` list APP-01 as completed, so you may cite them as corroboration — but the
   verification report is the evidence of record.
4. That no other checkbox was ticked and no traceability status prose was altered.
5. The prior history, condensed and still accurate: a 2026-09-07 update after the 01-08 gap-closure
   work made the two Phase 1 traceability rows agree with each other, and a 2026-09-06 update
   followed the roadmap revision that split Phase 1 into Phase 1 + Phase 2 and renumbered downstream
   phases. Keep the literal phrase `renumbered 3-7` in that clause — a gate asserts the history line
   survived the rewrite.

Constraints on what the note must NOT do, per this repo's CLAUDE.md non-negotiable that unverified
things are marked UNKNOWN and assumptions are never recorded as facts:

- Do not describe any verification event dated 2026-09-08. Nothing was verified today; a checkbox
  was reconciled with a verification that happened on 2026-09-07.
- Do not make any claim about phases 4 through 7, their status, or their readiness.
- Do not restate the Coverage counts. Those bullets are unchanged and stating them twice invites
  the two copies to drift apart.
- Do not reintroduce the superseded parenthetical status string the old note quoted.

Preserve CRLF line endings. Use a scoped edit; do not rewrite the file.
  </action>
  <verify>
    <automated>F=.planning/REQUIREMENTS.md; B="$(grep -v '^#' "$F")"; RAW="$(git diff -U0 -- "$F")" || { echo GIT-DIFF-FAILED; exit 1; }; SCOPE="$(git diff --name-only -- docs apps packages scripts tests)" || { echo GIT-SCOPE-FAILED; exit 1; }; D="$(printf '%s\n' "$RAW" | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)')"; [ -n "$RAW" ] && [ -z "$SCOPE" ] && [ "$(printf '%s\n' "$B" | grep -c 'awaiting re-verification')" = "0" ] && [ "$(printf '%s\n' "$B" | grep -c 'Last updated: 2026-09-08')" = "1" ] && [ "$(printf '%s\n' "$B" | grep -c '01-VERIFICATION.md')" = "1" ] && [ "$(printf '%s\n' "$B" | grep -c 'Requirements defined: 2026-09-06')" = "1" ] && [ "$(printf '%s\n' "$B" | grep -c 'renumbered 3-7')" = "1" ] && [ "$(printf '%s\n' "$B" | grep -c 'v1 requirements: 52 total')" = "1" ] && [ "$(printf '%s\n' "$D" | grep -c '| Phase ')" = "0" ] && [ "$(printf '%s\n' "$D" | grep -c '52 total')" = "0" ] && [ "$(printf '%s\n' "$D" | grep -cE '^\+- \[x\] ')" = "1" ] && echo GATE2-PASS</automated>
  </verify>
  <done>
`GATE2-PASS` prints. Read together, its clauses assert: the superseded status string is gone; the
note is dated today and cites the verification report exactly once; the defined-date line, the
roadmap-history clause and the Coverage summary all survived; the working diff is non-empty (so the
diff-based clauses cannot pass by having nothing to inspect); the diff added or removed **zero**
traceability-table rows and **zero** lines mentioning the coverage total; the diff ticked exactly
one checkbox across both tasks combined; and no file under `docs/`, `apps/`, `packages/`,
`scripts/` or `tests/` was modified.

Both `git` invocations run outside the grep pipelines and fail loud (`GIT-DIFF-FAILED` /
`GIT-SCOPE-FAILED`, exit 1) rather than being swallowed by a later pipeline stage — otherwise a
broken `git` would yield empty output and the scope clauses would report clean while inspecting
nothing.

Every clause was exercised against the pre-edit file during planning: `stale=1` and
`lastupd0908=0` both fail this gate, and the `docs apps packages scripts tests` diff was confirmed
empty at baseline, so a non-empty result there is attributable to this task.

A human reader should confirm the one thing no grep can: that the note reads as an honest account
rather than a tidier fiction.
  </done>
  <reversibility rating="reversible">A prose block in a git-tracked markdown file; `git checkout` restores it.</reversibility>
</task>

</tasks>

<threat_model>
## Trust Boundaries

This task creates no new trust boundary. It edits one markdown file inside `.planning/`, which is
already committed to the repository, is read only by humans and by GSD tooling, and is never parsed
by a runtime, served over a network, or interpolated into SQL. There is no untrusted input: the
content is authored by the executing agent from artifacts already in the repository.

| Boundary | Description |
|----------|-------------|
| agent -> repository working tree | The only boundary crossed. The agent writes a tracked file that later informs planning decisions. The asset at risk is the **integrity of the delivery record**, not a runtime or a credential. |
| (none) network / process / database | No boundary crossed. No connection is opened, no process spawned beyond `git` and `grep`, no database touched. |

## STRIDE Threat Register

Evaluated at ASVS L1 with `security_block_on: high`. Each category is reasoned against the actual
scope; categories that genuinely do not apply say why rather than being listed as generic risks.

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-kdl-01 | Tampering | `.planning/REQUIREMENTS.md` delivery record | medium | mitigate | The realistic failure is over-ticking: a box for unstarted work flipped as collateral, which would tell Phase 4 planning that safety scope exists when it does not. Mitigated structurally, not by care — Task 1's gate asserts the ticked total is exactly 21 and the unticked total exactly 31, so any second flipped box fails the gate arithmetically; Task 2's diff gate independently asserts the working diff contains exactly one newly-ticked line across both tasks. |
| T-kdl-02 | Tampering | Traceability table / Coverage summary | medium | mitigate | A rewrite of the status prose could silently upgrade a phase's recorded outcome. Mitigated by a diff-scoped gate asserting zero added-or-removed lines containing `\| Phase ` and zero containing the coverage total — the table is proven untouched rather than assumed untouched. |
| T-kdl-03 | Repudiation | The closing note | low | mitigate | An undated or uncited status change cannot later be traced to its evidence, which is how the note being replaced went stale in the first place. Mitigated by requiring the date and exactly one citation of `01-VERIFICATION.md` in the note, gate-asserted, plus the task's own atomic commit. |
| T-kdl-04 | Information Disclosure | Committed file content | low | accept | This repo's CLAUDE.md forbids logging or committing credentials. No credential, connection string, or secret is read or written by either task — the source artifacts are a requirements list, a verification report and an audit, none of which carry secrets. Accepted on that basis; no new control is warranted for a task that handles no sensitive value. |
| T-kdl-05 | Spoofing | — | low | accept | No authentication, identity, session or principal is involved. A static markdown file has no identity to spoof. Recorded as considered-and-inapplicable rather than omitted. |
| T-kdl-06 | Denial of Service | — | low | accept | No service, endpoint, listener or resource pool is touched. The largest resource consumed is a ~150-line file read. |
| T-kdl-07 | Elevation of Privilege | — | low | accept | No privilege boundary, role, grant, or execution path exists in scope. The file is inert data; nothing executes it. |
| T-kdl-08 | Tampering (supply chain) | package installs | low | accept | **No package-manager install occurs in this plan** — no `pnpm add`, `npm install`, `pip` or `cargo` task exists. The Package Legitimacy Gate therefore has nothing to gate; no `[ASSUMED]`/`[SUS]` checkpoint is inserted, because inserting one for a package set that is empty would be theatre. If a future revision adds an install task, this row must be reopened and RESEARCH.md's legitimacy audit consulted first. |

**Threats at or above `security_block_on: high`: 0.** The two `medium` integrity threats are both
mitigated by automated gates rather than by instruction, consistent with this project's
"architectural enforcement over remembered caution" non-negotiable — the gates fail the task if the
collateral edit happens, whether or not the executor remembered the prohibition.
</threat_model>

<verification>
Run after both tasks, from the repository root:

1. Re-run both task gates. Both must print their PASS token.
2. `git diff --stat -- .planning/REQUIREMENTS.md` -> one file changed; insertion/deletion counts small and confined to the checkbox line plus the closing-note block.
3. `git diff -- .planning/REQUIREMENTS.md` -> read the hunks. Confirm by eye that the only changes are (a) one bracket character on the APP-01 line and (b) the replaced closing note.
4. `git diff --name-only -- docs apps packages scripts tests` -> empty output, and the command itself must exit 0 (an errored `git` printing nothing is not a pass).
5. Read the new closing note as a human would. Every claim it makes should be one you could confirm by opening a named file in this repository.
</verification>

<success_criteria>
- APP-01 is the 21st ticked v1 requirement; RUN, CI, CONN, PROD, AUD, APP-02 and APP-03 remain unticked, all 31 of them.
- The closing note is dated 2026-09-08, attributes the tick to the Phase 1 re-verification pass, cites `01-VERIFICATION.md`, and makes no claim about any phase after 3.
- The traceability table and the Coverage summary are provably unchanged (diff-asserted, not asserted in prose).
- `.planning/REQUIREMENTS.md` is the only file this task modified.
- Both automated gates print their PASS token.
</success_criteria>

<output>
Create `.planning/quick/260908-kdl-tick-app-01-and-refresh-the-requirements/260908-kdl-SUMMARY.md` when done.

Record in it: the exact before/after of both edit sites, the two gate outputs, and — if the executor
found the plan-time line numbers had shifted — what the file actually looked like at execution time.
</output>
