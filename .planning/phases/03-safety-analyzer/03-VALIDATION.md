---
phase: "03"
slug: "safety-analyzer"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: validated
nyquist_compliant: false
wave_0_complete: true
created: "2026-09-08"
populated: "2026-09-08"
validated: "2026-09-08"
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

**Populated from the seven committed plans (03-01 … 03-07) on 2026-09-08.** This file is no
longer a template: the Test Infrastructure, Sampling Rate, Per-Task Verification Map, Wave 0
Requirements and Manual-Only tables below describe this phase's real validation contract, read
directly off the plans' `<verify>` blocks.

**Execution-time sign-off recorded 2026-09-08 by `/gsd-validate-phase`.** Every one of the 43
`<automated>` commands below was re-run against the executed repository and is green; every
`❌ W0` file the plan-time draft was waiting on now exists, so `wave_0_complete` is `true`. The
frontmatter therefore moves `draft → validated`.

**`nyquist_compliant` stays `false`, deliberately.** Not because a mapped command failed — none
did — but because the audit found one requirement whose stated behavior no command was checking
at all (GAP-1 below: the ANLZ-06 comparison report had silently drifted out of sync with the
corpus, and nothing detected it). The gap-fill test that now checks it is **red against the
committed report**, which is the correct state: the finding is real and the fix is a human
re-annotation, not a test edit. `nyquist_compliant` flips to `true` once that report is
refreshed and the two new disagreements are explained.

**Plan-time Nyquist assertion (still true, now also executed).** Across the phase's 19
implementation tasks plus 1 blocking checkpoint, the plans carry **43 `<automated>` verify
commands**, each with a binding `<fails_when>` clause. Every implementation task carries at
least two, so there is no run of even two consecutive tasks without automated verification. All
43 have now been run and are green.

**Tests added beyond the plan.** Execution added four test files the plan-time map does not
list — `dollar-quote-collision.test.ts`, `embedded-reparse-guard.test.ts`,
`language-sql-bodies.test.ts` and `multi-subcommand-alter-table.test.ts` — from mid-phase
deviations and the security re-audit. They run in the default `pnpm test` suite. They are
additional coverage, not gaps, and are not re-listed row by row below.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `vitest` 5.x — already installed at the workspace root (`devDependencies.vitest ^5.0.0`) |
| **Config file** | `vitest.config.ts` — 03-01 Task 1 added the `packages/**/*.test.ts` glob; `include` now reads `["scripts/**/*.test.ts", "tests/**/*.test.ts", "apps/**/*.test.ts", "packages/**/*.test.ts"]` (verified 2026-09-08) |
| **Quick run command** | `pnpm exec vitest run <the task's own test file(s)>` |
| **Full suite command** | `pnpm test` (`vitest run`) |
| **Estimated runtime** | Sub-minute for a single file. Full-suite runtime is inherited from the existing suite; this phase adds no Docker-dependent tests (D-11), so there is no slow tier and `vitest.drill.config.ts` is untouched. |

Notes:

- **No Docker, no database.** D-11 makes the classifier core a pure function of SQL text plus
  rules, so every test this phase adds belongs in the default `pnpm test` suite. Phase 2's
  `test:drill` split is not replicated here.
- **New root scripts** introduced by the plans and used as verify commands: `db:analyze`
  (03-01), `db:analyze:migrations` (03-03), `analyze:squawk-comparison` (03-07).
- **No watch-mode flags** appear in any verify command; every vitest invocation is `vitest run`.

---

## Sampling Rate

- **After every task commit:** run that task's own `pnpm exec vitest run <file>` command, then
  `pnpm test`. Every task in every plan pairs a narrow command with the full suite, so a task
  cannot pass its own test while breaking the existing suite.
- **After every plan wave:** `pnpm test`.
- **Before `/gsd-verify-work`:** `pnpm test` green, **plus** the D-15 comparison report
  committed with every disagreement annotated — that one is a human read, not a command (see
  Manual-Only).
- **Max feedback latency:** one task. No task in this phase defers its verification to a later
  task.

---

## Per-Task Verification Map

One row per `<automated>` command, 43 rows, matching the 43 commands the plans carry.

**Legend —** *File Exists:* `✅` the file exists in the repo today; `❌ W0` the file is created
by this phase (see Wave 0 Requirements). *Test Type:* `unit` in-process vitest, `e2e` spawns the
real CLI, `suite` the whole default suite, `guard` a repository-state assertion.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | ANLZ-01, ANLZ-02, ANLZ-03 | T-03-01 / T-03-02 / T-03-04 | Classification comes only from the real AST; the D-02 floor cannot be weakened by a rules edit; an unmatched operation lands on REVIEW_REQUIRED | unit | `pnpm exec vitest run packages/automation/test/tracer.test.ts` | ✅ | ✅ green |
| 03-01-01 | 01 | 1 | ANLZ-01, ANLZ-02, ANLZ-03 | T-03-01 / T-03-02 | Same, checked against the whole existing suite | suite | `pnpm test` | ✅ | ✅ green |
| 03-01-01 | 01 | 1 | ANLZ-02 | T-03-06 | A real `DROP TABLE` reaches exit 20 through the real CLI — the verdict is a process-level fact, not just an in-test assertion | e2e | `pnpm db:analyze packages/automation/test/fixtures/tracer-drop-table.sql; test $? -eq 20 && echo TRACER_BLOCKED_EXIT_OK` | ✅ | ✅ green |
| 03-01-02 | 01 | 1 | ANLZ-01 | T-03-03 / T-03-05 | A parse failure is a hard error with no classification emitted; error text goes through `safeErrorMessage`, never a serialised error object | unit | `pnpm exec vitest run packages/automation/test/libpg-query-contract.test.ts packages/automation/test/parse-failure.test.ts` | ✅ | ✅ green |
| 03-01-02 | 01 | 1 | ANLZ-01 | T-03-03 | Same, against the whole suite | suite | `pnpm test` | ✅ | ✅ green |
| 03-01-03 | 01 | 1 | ANLZ-02 | T-03-04 | An empty or comment-only migration is REVIEW_REQUIRED, never SAFE; two adjacent statements never merge into one finding | unit | `pnpm exec vitest run packages/automation/test/analyze-edges.test.ts` | ✅ | ✅ green |
| 03-01-03 | 01 | 1 | ANLZ-02 | T-03-04 | Same, against the whole suite | suite | `pnpm test` | ✅ | ✅ green |
| 03-02-01 | 02 | 2 | ANLZ-04 | T-03-04 | An unrecognised default function resolves to `unknown-function`, matches no rule, and falls to REVIEW_REQUIRED — a false REVIEW, never a false SAFE | unit | `pnpm exec vitest run packages/automation/test/inspector-facts.test.ts` | ✅ | ✅ green |
| 03-02-01 | 02 | 2 | ANLZ-04 | T-03-04 | Same, against the whole suite | suite | `pnpm test` | ✅ | ✅ green |
| 03-02-02 | 02 | 2 | ANLZ-02, ANLZ-03 | T-03-09 | A rule whose match key is absent from `StatementFacts` — a mistyped fact name that would silently never match — cannot ship | unit | `pnpm exec vitest run packages/automation/test/rules-catalogue.test.ts` | ✅ | ✅ green |
| 03-02-02 | 02 | 2 | ANLZ-02, ANLZ-03 | T-03-09 | Same, against the whole suite | suite | `pnpm test` | ✅ | ✅ green |
| 03-02-03 | 02 | 2 | ANLZ-02, ANLZ-04 | T-03-07 / T-03-08 / T-03-10 | Most-severe-wins, so an appended permissive rule cannot mask a stricter one; pairing never lowers a floor finding; finding order is deterministic | unit | `pnpm exec vitest run packages/automation/test/classifier.test.ts packages/automation/test/pairing.test.ts` | ✅ | ✅ green |
| 03-02-03 | 02 | 2 | ANLZ-02, ANLZ-04 | T-03-07 / T-03-08 | Same, against the whole suite | suite | `pnpm test` | ✅ | ✅ green |
| 03-03-01 | 03 | 2 | ANLZ-01 | T-03-12 / T-03-13 | A journal entry with no file, or a file with no journal entry, is a hard error — a migration silently not examined must never look like one that passed; the pure-core seam is a checked property | unit | `pnpm exec vitest run packages/automation/test/adapter.test.ts` | ✅ | ✅ green |
| 03-03-01 | 03 | 2 | ANLZ-01 | T-03-13 | Same, against the whole suite | suite | `pnpm test` | ✅ | ✅ green |
| 03-03-02 | 03 | 2 | ANLZ-02 | T-03-11 / T-03-14 | Five non-adjacent exit codes, none equal to 1, each asserted against its own fixture, so an uncaught exception can never be read as a verdict | unit | `pnpm exec vitest run packages/automation/test/cli.test.ts` | ✅ | ✅ green |
| 03-03-02 | 03 | 2 | ANLZ-02 | T-03-11 | Same, against the whole suite | suite | `pnpm test` | ✅ | ✅ green |
| 03-03-02 | 03 | 2 | ANLZ-02 | T-03-11 / T-03-14 | The machine-readable JSON path produces the same BLOCKED verdict and the same exit 20 as the human report | e2e | `pnpm db:analyze --json packages/automation/test/fixtures/tracer-drop-table.sql; test $? -eq 20 && echo CLI_JSON_BLOCKED_EXIT_OK` | ✅ | ✅ green |
| 03-04-01 | 04 | 3 | ANLZ-01, ANLZ-05 | T-03-16 / T-03-18 / T-03-19 | Nested SQL is re-parsed through the same path and reaches the same floor; exceeding `MAX_NESTING_DEPTH` yields BLOCKED rather than a truncated analysis | unit | `pnpm exec vitest run packages/automation/test/plpgsql.test.ts` | ✅ | ✅ green |
| 03-04-01 | 04 | 3 | ANLZ-01, ANLZ-05 | T-03-16 | Same, against the whole suite | suite | `pnpm test` | ✅ | ✅ green |
| 03-04-02 | 04 | 3 | ANLZ-05 | T-03-17 | Unresolvable dynamic SQL is BLOCKED and the verdict is enforced through `D07_FLOOR_FACTS`, so no rules edit can lower it | unit | `pnpm exec vitest run packages/automation/test/dynamic-sql.test.ts` | ✅ | ✅ green |
| 03-04-02 | 04 | 3 | ANLZ-05 | T-03-17 | Same, against the whole suite | suite | `pnpm test` | ✅ | ✅ green |
| 03-05-01 | 05 | 4 | ANLZ-02, ANLZ-07 | T-03-20 / T-03-22 | A fixture with no manifest row, a row with no file, or a catalogue rule with no fixture each fail the suite; a concurrent run matches the sequential run, pinning no-mutable-module-state | unit | `pnpm exec vitest run packages/automation/test/corpus.test.ts` | ✅ | ✅ green |
| 03-05-01 | 05 | 4 | ANLZ-02, ANLZ-07 | T-03-20 | Same, against the whole suite | suite | `pnpm test` | ✅ | ✅ green |
| 03-05-02 | 05 | 4 | ANLZ-02, ANLZ-04 | T-03-20 / T-03-21 | Every BLOCKED and REVIEW_REQUIRED catalogue form has a real `.sql` file whose expected outcome lives in the manifest, never in an SQL comment | unit | `pnpm exec vitest run packages/automation/test/corpus.test.ts` | ✅ | ✅ green |
| 03-05-02 | 05 | 4 | ANLZ-02, ANLZ-04 | T-03-21 | Same, against the whole suite | suite | `pnpm test` | ✅ | ✅ green |
| 03-05-03 | 05 | 4 | ANLZ-04, ANLZ-07 | T-03-04 / T-03-21 | The SAFE set is positively earned by a matching rule, and the near-miss control proves the exact-name-equality requirement is real | unit | `pnpm exec vitest run packages/automation/test/corpus.test.ts` | ✅ | ✅ green |
| 03-05-03 | 05 | 4 | ANLZ-04, ANLZ-07 | T-03-04 | Same, against the whole suite | suite | `pnpm test` | ✅ | ✅ green |
| 03-06-01 | 06 | 5 | ANLZ-05 | T-03-23 / T-03-24 | Five evasion shapes are still caught after comments, dollar quoting, control flow, a function body and keyword-colliding quoted identifiers; a pair with only one half fails the suite | unit | `pnpm exec vitest run packages/automation/test/corpus.test.ts` | ✅ | ✅ green |
| 03-06-01 | 06 | 5 | ANLZ-05 | T-03-23 | Same, against the whole suite | suite | `pnpm test` | ✅ | ✅ green |
| 03-06-02 | 06 | 5 | ANLZ-05, ANLZ-07 | T-03-26 | The app-shaped fixtures mirror the reserved churn without spending it | unit | `pnpm exec vitest run packages/automation/test/corpus.test.ts` | ✅ | ✅ green |
| 03-06-02 | 06 | 5 | ANLZ-07 | T-03-26 | The real schema file and the real migrations directory are provably untouched — `01-CONTEXT.md` D-11's reserved churn is not spent by this phase | guard | `git status --porcelain apps/recipe-app/src/db/schema.ts apps/recipe-app/drizzle` | ✅ | ✅ green |
| 03-06-03 | 06 | 5 | ANLZ-07 | T-03-25 | A real `DROP TABLE` is BLOCKED and a genuinely safe migration passes, by test; a divergence from the stated expected verdict must be investigated, not absorbed into the manifest | unit | `pnpm exec vitest run packages/automation/test/anlz-07.test.ts packages/automation/test/corpus.test.ts` | ✅ | ✅ green |
| 03-06-03 | 06 | 5 | ANLZ-07 | T-03-25 | Same, against the whole suite | suite | `pnpm test` | ✅ | ✅ green |
| 03-06-03 | 06 | 5 | ANLZ-07 | T-03-12 | Both real repository migrations are actually analysed and reported on, at exit 10 | e2e | `pnpm db:analyze:migrations` | ✅ | ✅ green |
| 03-07-01 | 07 | 6 | ANLZ-06 | T-03-SC | The Windows binary the comparison needs is the one that actually got installed, after the blocking legitimacy checkpoint approved it | guard | `pnpm --filter automation exec squawk --version` | ✅ | ✅ green |
| 03-07-01 | 07 | 6 | ANLZ-06 | T-03-27 | The comparison covers the whole corpus — only unparseable stdout or a signal-terminated process counts as failure, so a non-zero squawk exit cannot silently truncate coverage | e2e | `pnpm analyze:squawk-comparison` | ✅ | ✅ green |
| 03-07-01 | 07 | 6 | ANLZ-06 | T-03-27 | Adding squawk breaks nothing in the existing suite | suite | `pnpm test` | ✅ | ✅ green |
| 03-07-02 | 07 | 6 | ANLZ-06 | T-03-28 | Any gap squawk found is closed in the same commit — the corpus and catalogue tests still hold after the rules are amended | unit | `pnpm exec vitest run packages/automation/test/corpus.test.ts packages/automation/test/rules-catalogue.test.ts` | ✅ | ✅ green |
| 03-07-02 | 07 | 6 | ANLZ-06 | T-03-28 | Same, against the whole suite | suite | `pnpm test` | ✅ | ✅ green |
| 03-07-03 | 07 | 6 | ANLZ-06 | T-03-29 | The connection-string, direct-sync and direct-environment-read guardrails now cover `packages/` — Pitfall 3's blind spot is closed | unit | `pnpm exec vitest run tests/guardrails.test.ts` | ✅ | ✅ green |
| 03-07-03 | 07 | 6 | ANLZ-06 | T-03-29 | Same, against the whole suite | suite | `pnpm test` | ✅ | ✅ green |
| 03-07-03 | 07 | 6 | ANLZ-06 | T-03-29 | The new paths are confirmed *in scope* by a verbose run rather than assumed to be — a guardrail that silently enumerates nothing passes vacuously | guard | `pnpm exec vitest run tests/guardrails.test.ts --reporter verbose` | ✅ | ✅ green |

### Gap-fill rows added by this audit (2026-09-08)

Two rows the plan-time map did not have. Both cover ANLZ-06 behavior that was asserted in prose
but checked by nothing.

| Gap | Requirement | Secure Behavior | Test Type | Automated Command | Status |
|-----|-------------|-----------------|-----------|-------------------|--------|
| GAP-1 | ANLZ-06 | The committed comparison report cannot silently drift from the corpus: every manifest entry appears as a table row, no generator `_TBD_` placeholder survives into a committed report, and the report's own stated row count matches the rows it actually holds | unit | `pnpm exec vitest run packages/automation/test/squawk-comparison-report.test.ts` | ❌ red — **finding, not a defect in the test** (see Manual-Only) |
| GAP-2 | ANLZ-06 | `sourceSurfaceFiles()` provably enumerates `packages/` (and `scripts/`, `tests/`, `apps/recipe-app/`), so the three source-surface checks cannot pass having examined nothing | guard | `pnpm exec vitest run tests/guardrails.test.ts` | ✅ green (11/11) |

**Why GAP-2 existed.** The plan's own guard command for 03-07-03 was
`vitest run tests/guardrails.test.ts --reporter verbose`, justified as confirming the new paths
are in scope "rather than assumed to be". But `--reporter verbose` prints only test *names* — it
never shows the enumerated file list, so its output would look identical if `packages/`
enumerated zero files and all three checks passed vacuously. `packages/` is genuinely in scope
today (`git ls-files packages/` → 86 files, and `tests/guardrails.test.ts:64` admits it), but
nothing pinned that. The new assertion does.

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Not in the map:** 03-07's leading `checkpoint:human-verify` (`gate="blocking-human"`,
threat `T-03-SC`) gates the `squawk-cli` install on a human reading its npm listing. It is
deliberately not auto-approvable and carries no automated command by design — a package
legitimacy gate that a script could satisfy would not be a gate.

---

## Wave 0 Requirements

This phase has no separate Wave 0 plan; **03-01 Task 1 (the tracer) is the wave-0-equivalent**
and had to land before any other verify command in the map could resolve.

**All items below landed — verified against the repository on 2026-09-08, so
`wave_0_complete: true`.** The `include` array now reads
`["scripts/**/*.test.ts", "tests/**/*.test.ts", "apps/**/*.test.ts", "packages/**/*.test.ts"]`;
`packages/automation/` exists with 86 tracked files; all three new root scripts are present; the
corpus manifest holds 51 entries against 49 committed `.sql` fixtures plus the two real
migrations; and the tracer fixture exists.

- [x] `vitest.config.ts` — add a `packages/**/*.test.ts` glob to `include`. The current array is
      `["scripts/**/*.test.ts", "tests/**/*.test.ts", "apps/**/*.test.ts"]`; **without this
      change every new test in this phase silently does not run under `pnpm test`.** `exclude`,
      `testTimeout`, `hookTimeout`, `pool` and `fileParallelism` stay byte-identical.
- [x] `packages/automation/package.json` + `tsconfig.json` — the workspace package does not
      exist yet (`packages/` is not present in the repo at all).
- [x] Root `package.json` scripts — `db:analyze` (03-01), then `db:analyze:migrations` (03-03)
      and `analyze:squawk-comparison` (03-07), following the existing `db:*` convention.
- [x] `packages/automation/test/corpus/manifest.json` + the corpus `.sql` tree and the harness
      that diffs each row against the analyzer (03-05 Task 1). No existing fixture harness
      covers "run this file's SQL through the classifier and assert against a manifest row" —
      this is phase work, not infrastructure to reuse.
- [x] `packages/automation/test/fixtures/tracer-drop-table.sql` — the fixture both `db:analyze`
      e2e commands point at.

Already present and reused as-is: `vitest` 5.x, `zod` 4.5.4, `execa` 10, `tsx`,
`tests/guardrails.test.ts`, and the two real migrations
`apps/recipe-app/drizzle/0000_bumpy_khan.sql` and `0001_busy_thunderbolt.sql`.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Every disagreement in the squawk comparison report is explained with a real reason, deliberate exclusions read as exclusions rather than omissions, and anything unestablished reads UNKNOWN | ANLZ-06 (phase success criterion 5) | The criterion asks for a human-read explanation. A command can assert the report exists and has a row per corpus entry; it cannot assert that the prose in each row is a genuine reason rather than a plausible-sounding one. | 03-07 Task 2 `<human-check>`: read `docs/30-squawk-comparison.md` end to end and confirm each disagreement carries one of the three explanations with a real reason, that any gap squawk found was closed in the same commit, and that anything unestablished says UNKNOWN. |
| `squawk-cli`'s npm listing resolves to the canonical `sbdchd/squawk` project, at the expected download scale and version, with the `win32-x64` binary present | ANLZ-06 | Package-legitimacy gate. The research flagged `squawk-cli` `[SUS]` on the recency signal; the gate's rule is mechanical — a human confirms before any suspicious package installs, and the checkpoint is never auto-approvable. | 03-07 leading `checkpoint:human-verify`: open the npm page, check repository link, weekly downloads, version ≥ 2.64.0 from the same publisher, description, and the Windows x64 optional dependency. Reply "approved", or describe what did not match. |
| **OPEN — GAP-1.** `docs/30-squawk-comparison.md` must be regenerated and the two new disagreements hand-annotated | ANLZ-06 | The two new rows need a *judgement* — which of `analyzer-correct` / `squawk-correct` / `different-by-design` applies, and why. A test can prove the rows are present and unexplained; it cannot write the explanation, and a generated-sounding reason would defeat the purpose of the check. | See the procedure below. `pnpm exec vitest run packages/automation/test/squawk-comparison-report.test.ts` goes green when this is done. |

### GAP-1 — the open finding, and how to close it

**What is wrong.** The committed report was hand-annotated at commit `ed47eb1` when the corpus
yielded 49 rows. Commit `c7e807b` ("test(03): add corpus fixtures for the multi-subcommand ALTER
TABLE case (CR-02)") then added two fixtures — `blocked/multi-subcommand-alter-table.sql` and
`safe/multi-subcommand-alter-table-all-safe.sql` — without refreshing the report. The corpus
manifest now holds 51 entries; the committed report describes 49. The second new fixture is a
**new disagreement carrying no explanation at all**.

**Why nothing caught it.** No test referenced the report — `grep -rn "30-squawk-comparison"`
across all `.ts`/`.json` found only the generator's own `REPORT_PATH` constant.
`pnpm analyze:squawk-comparison` exits 0 whether the committed report is current or stale, so
the "report exists and the command succeeds" signal was never evidence that the report *matched
the corpus*. The manual-only human-read sign-off above was therefore reading a document that
could silently go out of date with nothing to say so.

**The trap in the obvious fix.** The generator writes `_TBD_` into every disagreement's *Verdict*
and *Reason* fields; the committed report's prose is hand-written on top. So re-running
`pnpm analyze:squawk-comparison` **destroys all 21 existing explanations**. Regenerate-and-commit
without re-annotating would leave a report that looks refreshed and explains nothing — which is
exactly what assertion (b) of the new test now blocks.

**Procedure.**

1. Save the current `docs/30-squawk-comparison.md` (its 21 hand-written reasons are the thing to
   preserve).
2. Run `pnpm analyze:squawk-comparison` — this rewrites the file at 51 rows / 22 disagreements
   with every reason reset to `_TBD_`.
3. Restore the 21 explanations that still apply, verbatim, onto their matching rows.
4. Write the reason for the one genuinely new disagreement
   (`safe/multi-subcommand-alter-table-all-safe.sql`), labelled `analyzer-correct`,
   `squawk-correct` or `different-by-design`, and re-check the `blocked/` counterpart's row.
5. Restore the hand-written *Executive summary* and *different-by-design bucket* sections the
   generator does not emit, updating their counts.
6. `pnpm exec vitest run packages/automation/test/squawk-comparison-report.test.ts` → green.
7. Set `nyquist_compliant: true` in this file's frontmatter.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies — 43 commands across 19 tasks,
      every task carrying at least two, every command with a binding `<fails_when>`
- [x] Sampling continuity: no 3 consecutive tasks without automated verify — no *two*
      consecutive tasks lack one
- [x] Wave 0 covers all MISSING references — every `❌ W0` file above was created by a task in
      this phase, led by 03-01 Task 1's `vitest.config.ts` include-glob change, and all now exist
- [x] No watch-mode flags — every vitest invocation is `vitest run`
- [x] Feedback latency < 1 task — no task defers verification to a later task
- [x] All 43 mapped commands re-run against the executed repository and green (2026-09-08)
- [ ] `nyquist_compliant: true` set in frontmatter — **blocked on GAP-1 only.** Every mapped
      command is green and every plan-time property above holds. What is not yet true is that
      *every* ANLZ-06 behavior has an automated check passing: the report-sync test is red
      against a stale committed report. Ticking this box now would assert coverage the repository
      does not have. Close GAP-1 per the procedure above, then tick it.

**Approval:** PARTIAL — plan-time contract populated 2026-09-08; execution-time sign-off given
2026-09-08 with one open finding (GAP-1). 43/43 mapped commands green, 1 gap closed (GAP-2),
1 gap open and correctly red (GAP-1).

---

## Validation Audit 2026-09-08

| Metric | Count |
|--------|-------|
| Mapped commands re-run | 43 |
| Mapped commands green | 43 |
| Gaps found | 2 |
| Resolved | 1 (GAP-2 — guardrail non-vacuity assertion) |
| Escalated | 1 (GAP-1 — comparison-report drift; test written and red, fix is a human re-annotation) |

**Full suite after the audit:** `pnpm test` → 305 tests, 304 passed, 1 failed. The single
failure is GAP-1's report-sync test naming the two drifted fixtures. That red is the finding, not
a defect in the test — it must not be weakened or skipped to make the suite green.

**Files added/changed by this audit (tests only; no implementation file was touched):**

- `packages/automation/test/squawk-comparison-report.test.ts` (new — GAP-1)
- `tests/guardrails.test.ts` (one `it()` added — GAP-2)
