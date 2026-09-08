---
phase: "03"
slug: "safety-analyzer"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-09-08"
populated: "2026-09-08"
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

**Populated from the seven committed plans (03-01 … 03-07) on 2026-09-08.** This file is no
longer a template: the Test Infrastructure, Sampling Rate, Per-Task Verification Map, Wave 0
Requirements and Manual-Only tables below describe this phase's real validation contract, read
directly off the plans' `<verify>` blocks.

**Why the frontmatter flags stay as they are.** `status`, `nyquist_compliant` and
`wave_0_complete` are owned by `/gsd-validate-phase`, which runs *after* execution. Per the
audit-milestone contract, while `status: draft` the `nyquist_compliant` flag "is not
authoritative" — so flipping it here would assert nothing and would risk reading as though
unexecuted work had been validated. Every `Status` cell below is therefore `⬜ pending`: the
commands are real and resolved, but none has been run yet because no plan has executed.

**Plan-time Nyquist assertion (distinct from the frontmatter flag).** Across the phase's 19
implementation tasks plus 1 blocking checkpoint, the plans carry **43 `<automated>` verify
commands**, each with a binding `<fails_when>` clause. Every implementation task carries at
least two. There is therefore no run of even two consecutive tasks without automated
verification, let alone three. What remains unproven until execution is whether those commands
*pass* — which is exactly what `/gsd-validate-phase` will record.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `vitest` 5.x — already installed at the workspace root (`devDependencies.vitest ^5.0.0`) |
| **Config file** | `vitest.config.ts` — exists, but its `include` array does **not** yet match `packages/**`; 03-01 Task 1 adds a `packages/**/*.test.ts` glob (see Wave 0) |
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
| 03-01-01 | 01 | 1 | ANLZ-01, ANLZ-02, ANLZ-03 | T-03-01 / T-03-02 / T-03-04 | Classification comes only from the real AST; the D-02 floor cannot be weakened by a rules edit; an unmatched operation lands on REVIEW_REQUIRED | unit | `pnpm exec vitest run packages/automation/test/tracer.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-01 | 01 | 1 | ANLZ-01, ANLZ-02, ANLZ-03 | T-03-01 / T-03-02 | Same, checked against the whole existing suite | suite | `pnpm test` | ✅ | ⬜ pending |
| 03-01-01 | 01 | 1 | ANLZ-02 | T-03-06 | A real `DROP TABLE` reaches exit 20 through the real CLI — the verdict is a process-level fact, not just an in-test assertion | e2e | `pnpm db:analyze packages/automation/test/fixtures/tracer-drop-table.sql; test $? -eq 20 && echo TRACER_BLOCKED_EXIT_OK` | ❌ W0 | ⬜ pending |
| 03-01-02 | 01 | 1 | ANLZ-01 | T-03-03 / T-03-05 | A parse failure is a hard error with no classification emitted; error text goes through `safeErrorMessage`, never a serialised error object | unit | `pnpm exec vitest run packages/automation/test/libpg-query-contract.test.ts packages/automation/test/parse-failure.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-02 | 01 | 1 | ANLZ-01 | T-03-03 | Same, against the whole suite | suite | `pnpm test` | ✅ | ⬜ pending |
| 03-01-03 | 01 | 1 | ANLZ-02 | T-03-04 | An empty or comment-only migration is REVIEW_REQUIRED, never SAFE; two adjacent statements never merge into one finding | unit | `pnpm exec vitest run packages/automation/test/analyze-edges.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-03 | 01 | 1 | ANLZ-02 | T-03-04 | Same, against the whole suite | suite | `pnpm test` | ✅ | ⬜ pending |
| 03-02-01 | 02 | 2 | ANLZ-04 | T-03-04 | An unrecognised default function resolves to `unknown-function`, matches no rule, and falls to REVIEW_REQUIRED — a false REVIEW, never a false SAFE | unit | `pnpm exec vitest run packages/automation/test/inspector-facts.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 2 | ANLZ-04 | T-03-04 | Same, against the whole suite | suite | `pnpm test` | ✅ | ⬜ pending |
| 03-02-02 | 02 | 2 | ANLZ-02, ANLZ-03 | T-03-09 | A rule whose match key is absent from `StatementFacts` — a mistyped fact name that would silently never match — cannot ship | unit | `pnpm exec vitest run packages/automation/test/rules-catalogue.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-02 | 02 | 2 | ANLZ-02, ANLZ-03 | T-03-09 | Same, against the whole suite | suite | `pnpm test` | ✅ | ⬜ pending |
| 03-02-03 | 02 | 2 | ANLZ-02, ANLZ-04 | T-03-07 / T-03-08 / T-03-10 | Most-severe-wins, so an appended permissive rule cannot mask a stricter one; pairing never lowers a floor finding; finding order is deterministic | unit | `pnpm exec vitest run packages/automation/test/classifier.test.ts packages/automation/test/pairing.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-03 | 02 | 2 | ANLZ-02, ANLZ-04 | T-03-07 / T-03-08 | Same, against the whole suite | suite | `pnpm test` | ✅ | ⬜ pending |
| 03-03-01 | 03 | 2 | ANLZ-01 | T-03-12 / T-03-13 | A journal entry with no file, or a file with no journal entry, is a hard error — a migration silently not examined must never look like one that passed; the pure-core seam is a checked property | unit | `pnpm exec vitest run packages/automation/test/adapter.test.ts` | ❌ W0 | ⬜ pending |
| 03-03-01 | 03 | 2 | ANLZ-01 | T-03-13 | Same, against the whole suite | suite | `pnpm test` | ✅ | ⬜ pending |
| 03-03-02 | 03 | 2 | ANLZ-02 | T-03-11 / T-03-14 | Five non-adjacent exit codes, none equal to 1, each asserted against its own fixture, so an uncaught exception can never be read as a verdict | unit | `pnpm exec vitest run packages/automation/test/cli.test.ts` | ❌ W0 | ⬜ pending |
| 03-03-02 | 03 | 2 | ANLZ-02 | T-03-11 | Same, against the whole suite | suite | `pnpm test` | ✅ | ⬜ pending |
| 03-03-02 | 03 | 2 | ANLZ-02 | T-03-11 / T-03-14 | The machine-readable JSON path produces the same BLOCKED verdict and the same exit 20 as the human report | e2e | `pnpm db:analyze --json packages/automation/test/fixtures/tracer-drop-table.sql; test $? -eq 20 && echo CLI_JSON_BLOCKED_EXIT_OK` | ❌ W0 | ⬜ pending |
| 03-04-01 | 04 | 3 | ANLZ-01, ANLZ-05 | T-03-16 / T-03-18 / T-03-19 | Nested SQL is re-parsed through the same path and reaches the same floor; exceeding `MAX_NESTING_DEPTH` yields BLOCKED rather than a truncated analysis | unit | `pnpm exec vitest run packages/automation/test/plpgsql.test.ts` | ❌ W0 | ⬜ pending |
| 03-04-01 | 04 | 3 | ANLZ-01, ANLZ-05 | T-03-16 | Same, against the whole suite | suite | `pnpm test` | ✅ | ⬜ pending |
| 03-04-02 | 04 | 3 | ANLZ-05 | T-03-17 | Unresolvable dynamic SQL is BLOCKED and the verdict is enforced through `D07_FLOOR_FACTS`, so no rules edit can lower it | unit | `pnpm exec vitest run packages/automation/test/dynamic-sql.test.ts` | ❌ W0 | ⬜ pending |
| 03-04-02 | 04 | 3 | ANLZ-05 | T-03-17 | Same, against the whole suite | suite | `pnpm test` | ✅ | ⬜ pending |
| 03-05-01 | 05 | 4 | ANLZ-02, ANLZ-07 | T-03-20 / T-03-22 | A fixture with no manifest row, a row with no file, or a catalogue rule with no fixture each fail the suite; a concurrent run matches the sequential run, pinning no-mutable-module-state | unit | `pnpm exec vitest run packages/automation/test/corpus.test.ts` | ❌ W0 | ⬜ pending |
| 03-05-01 | 05 | 4 | ANLZ-02, ANLZ-07 | T-03-20 | Same, against the whole suite | suite | `pnpm test` | ✅ | ⬜ pending |
| 03-05-02 | 05 | 4 | ANLZ-02, ANLZ-04 | T-03-20 / T-03-21 | Every BLOCKED and REVIEW_REQUIRED catalogue form has a real `.sql` file whose expected outcome lives in the manifest, never in an SQL comment | unit | `pnpm exec vitest run packages/automation/test/corpus.test.ts` | ❌ W0 | ⬜ pending |
| 03-05-02 | 05 | 4 | ANLZ-02, ANLZ-04 | T-03-21 | Same, against the whole suite | suite | `pnpm test` | ✅ | ⬜ pending |
| 03-05-03 | 05 | 4 | ANLZ-04, ANLZ-07 | T-03-04 / T-03-21 | The SAFE set is positively earned by a matching rule, and the near-miss control proves the exact-name-equality requirement is real | unit | `pnpm exec vitest run packages/automation/test/corpus.test.ts` | ❌ W0 | ⬜ pending |
| 03-05-03 | 05 | 4 | ANLZ-04, ANLZ-07 | T-03-04 | Same, against the whole suite | suite | `pnpm test` | ✅ | ⬜ pending |
| 03-06-01 | 06 | 5 | ANLZ-05 | T-03-23 / T-03-24 | Five evasion shapes are still caught after comments, dollar quoting, control flow, a function body and keyword-colliding quoted identifiers; a pair with only one half fails the suite | unit | `pnpm exec vitest run packages/automation/test/corpus.test.ts` | ❌ W0 | ⬜ pending |
| 03-06-01 | 06 | 5 | ANLZ-05 | T-03-23 | Same, against the whole suite | suite | `pnpm test` | ✅ | ⬜ pending |
| 03-06-02 | 06 | 5 | ANLZ-05, ANLZ-07 | T-03-26 | The app-shaped fixtures mirror the reserved churn without spending it | unit | `pnpm exec vitest run packages/automation/test/corpus.test.ts` | ❌ W0 | ⬜ pending |
| 03-06-02 | 06 | 5 | ANLZ-07 | T-03-26 | The real schema file and the real migrations directory are provably untouched — `01-CONTEXT.md` D-11's reserved churn is not spent by this phase | guard | `git status --porcelain apps/recipe-app/src/db/schema.ts apps/recipe-app/drizzle` | ✅ | ⬜ pending |
| 03-06-03 | 06 | 5 | ANLZ-07 | T-03-25 | A real `DROP TABLE` is BLOCKED and a genuinely safe migration passes, by test; a divergence from the stated expected verdict must be investigated, not absorbed into the manifest | unit | `pnpm exec vitest run packages/automation/test/anlz-07.test.ts packages/automation/test/corpus.test.ts` | ❌ W0 | ⬜ pending |
| 03-06-03 | 06 | 5 | ANLZ-07 | T-03-25 | Same, against the whole suite | suite | `pnpm test` | ✅ | ⬜ pending |
| 03-06-03 | 06 | 5 | ANLZ-07 | T-03-12 | Both real repository migrations are actually analysed and reported on, at exit 10 | e2e | `pnpm db:analyze:migrations` | ❌ W0 | ⬜ pending |
| 03-07-01 | 07 | 6 | ANLZ-06 | T-03-SC | The Windows binary the comparison needs is the one that actually got installed, after the blocking legitimacy checkpoint approved it | guard | `pnpm --filter automation exec squawk --version` | ❌ W0 | ⬜ pending |
| 03-07-01 | 07 | 6 | ANLZ-06 | T-03-27 | The comparison covers the whole corpus — only unparseable stdout or a signal-terminated process counts as failure, so a non-zero squawk exit cannot silently truncate coverage | e2e | `pnpm analyze:squawk-comparison` | ❌ W0 | ⬜ pending |
| 03-07-01 | 07 | 6 | ANLZ-06 | T-03-27 | Adding squawk breaks nothing in the existing suite | suite | `pnpm test` | ✅ | ⬜ pending |
| 03-07-02 | 07 | 6 | ANLZ-06 | T-03-28 | Any gap squawk found is closed in the same commit — the corpus and catalogue tests still hold after the rules are amended | unit | `pnpm exec vitest run packages/automation/test/corpus.test.ts packages/automation/test/rules-catalogue.test.ts` | ❌ W0 | ⬜ pending |
| 03-07-02 | 07 | 6 | ANLZ-06 | T-03-28 | Same, against the whole suite | suite | `pnpm test` | ✅ | ⬜ pending |
| 03-07-03 | 07 | 6 | ANLZ-06 | T-03-29 | The connection-string, direct-sync and direct-environment-read guardrails now cover `packages/` — Pitfall 3's blind spot is closed | unit | `pnpm exec vitest run tests/guardrails.test.ts` | ✅ | ⬜ pending |
| 03-07-03 | 07 | 6 | ANLZ-06 | T-03-29 | Same, against the whole suite | suite | `pnpm test` | ✅ | ⬜ pending |
| 03-07-03 | 07 | 6 | ANLZ-06 | T-03-29 | The new paths are confirmed *in scope* by a verbose run rather than assumed to be — a guardrail that silently enumerates nothing passes vacuously | guard | `pnpm exec vitest run tests/guardrails.test.ts --reporter verbose` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Not in the map:** 03-07's leading `checkpoint:human-verify` (`gate="blocking-human"`,
threat `T-03-SC`) gates the `squawk-cli` install on a human reading its npm listing. It is
deliberately not auto-approvable and carries no automated command by design — a package
legitimacy gate that a script could satisfy would not be a gate.

---

## Wave 0 Requirements

This phase has no separate Wave 0 plan; **03-01 Task 1 (the tracer) is the wave-0-equivalent**
and must land before any other verify command in the map can resolve. Until it does,
`wave_0_complete: false` is accurate.

- [ ] `vitest.config.ts` — add a `packages/**/*.test.ts` glob to `include`. The current array is
      `["scripts/**/*.test.ts", "tests/**/*.test.ts", "apps/**/*.test.ts"]`; **without this
      change every new test in this phase silently does not run under `pnpm test`.** `exclude`,
      `testTimeout`, `hookTimeout`, `pool` and `fileParallelism` stay byte-identical.
- [ ] `packages/automation/package.json` + `tsconfig.json` — the workspace package does not
      exist yet (`packages/` is not present in the repo at all).
- [ ] Root `package.json` scripts — `db:analyze` (03-01), then `db:analyze:migrations` (03-03)
      and `analyze:squawk-comparison` (03-07), following the existing `db:*` convention.
- [ ] `packages/automation/test/corpus/manifest.json` + the corpus `.sql` tree and the harness
      that diffs each row against the analyzer (03-05 Task 1). No existing fixture harness
      covers "run this file's SQL through the classifier and assert against a manifest row" —
      this is phase work, not infrastructure to reuse.
- [ ] `packages/automation/test/fixtures/tracer-drop-table.sql` — the fixture both `db:analyze`
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

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies — 43 commands across 19 tasks,
      every task carrying at least two, every command with a binding `<fails_when>`
- [x] Sampling continuity: no 3 consecutive tasks without automated verify — no *two*
      consecutive tasks lack one
- [x] Wave 0 covers all MISSING references — every `❌ W0` file above is created by a task in
      this phase, led by 03-01 Task 1's `vitest.config.ts` include-glob change
- [x] No watch-mode flags — every vitest invocation is `vitest run`
- [x] Feedback latency < 1 task — no task defers verification to a later task
- [ ] `nyquist_compliant: true` set in frontmatter — **deliberately deferred to
      `/gsd-validate-phase`.** The five boxes above are plan-time properties and are checked;
      this box is an execution-time property (the commands ran and were green) and cannot
      honestly be ticked before Wave 1 executes.

**Approval:** pending — plan-time contract populated 2026-09-08; execution-time sign-off is
`/gsd-validate-phase`'s to give.
