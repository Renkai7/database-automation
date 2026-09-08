# Phase 4: Migration Runner & History Tests - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-08
**Phase:** 4-Migration Runner & History Tests
**Areas discussed:** Execution engine, REVIEW REQUIRED locally, Transaction policy, Timeout policy, Partial-failure recovery, History test harness, APP-02 schema changes, Runner's home & seams

All eight offered gray areas were selected for discussion.

---

## Execution engine

**Q: Who actually executes the migration SQL?**

| Option | Description | Selected |
|--------|-------------|----------|
| Own runner on `pg` | Read the file once into memory, classify that buffer, execute that same buffer, write the ledger row itself. RUN-01's "exact bytes" becomes literal. | ✓ |
| Wrap drizzle-orm `migrate()` | Least new code, but drizzle re-reads the files itself and wraps each file in a transaction, breaking RUN-04. | |
| Hybrid — drizzle reads, we execute | Bookkeeping fidelity for free; depends on drizzle internals that are not a stable public API. | |

**Q: Is `drizzle-kit migrate` left reachable as a second path?**

| Option | Description | Selected |
|--------|-------------|----------|
| Structurally unreachable | Nothing in the repo invokes it; a test asserts no script or code path reaches it. Same reasoning as 01 D-14's rejection of init scripts. | ✓ |
| Left available but renamed | `db:migrate:raw` as a documented escape hatch — an override path under another name. | |
| Left as-is, undocumented | No effort spent; the gate is only on the blessed path. | |

**Q: Where do statement boundaries come from?**

| Option | Description | Selected |
|--------|-------------|----------|
| libpg-query AST boundaries | The unit classified and the unit executed are the same object by construction; works on SQL with no drizzle markers. | ✓ |
| Drizzle's `--> statement-breakpoint` | Simple, matches drizzle — but two independent splitting rules that could drift. | |
| Whole file, no splitting | Implicitly one server-side transaction; breaks RUN-04 and destroys per-statement failure reporting. | |

**Q: What records "this migration is applied"?**

| Option | Description | Selected |
|--------|-------------|----------|
| Drizzle-compatible `__drizzle_migrations` | Same table, same hash scheme; drizzle-kit and `assertMigrationHistoryApplied` keep working. | ✓ |
| Own ledger table, drizzle table abandoned | Richer columns for Phase 7; breaks drizzle-kit's state view and the existing check. | |
| Both — drizzle table plus a runner sidecar | Interop plus audit substrate; two writes to keep consistent. | |

**Notes:** Flagged at the time that a strictly drizzle-compatible ledger has nowhere to record the
verdict or a failure state — which resurfaced under Partial-failure recovery and was resolved there
(CONTEXT.md D-19: a scoped sidecar table, arrived at for a concrete reason rather than chosen up
front).

---

## REVIEW REQUIRED locally

Context given at the time: `0001_busy_thunderbolt.sql` is committed, already applied, and classifies
REVIEW_REQUIRED — so this is live on day one, not hypothetical.

**Q: What does the local runner do on REVIEW_REQUIRED?**

| Option | Description | Selected |
|--------|-------------|----------|
| Proceed, report loudly | Print complete findings, then execute. Dev DB is disposable; the gate that blocks is Phase 5's CI. | ✓ |
| Refuse locally too | Maximally strict, but breaks `db:reset` immediately and pulls override pressure into Phase 4. | |
| Prompt for confirmation | Already rejected once for `db:reset` (01 D-24); would block the automated history tests. | |

**Q: How does a caller learn a REVIEW_REQUIRED was passed through?**

| Option | Description | Selected |
|--------|-------------|----------|
| Exit 0 + machine-readable run report | CI gates on the report, not the exit code; `db:reset` stays green. | ✓ |
| Distinct exit code | Callers branch without parsing; but non-zero-but-fine is a confusing contract. | |
| Stdout report only | Simplest; pushes Phase 5 into parsing text or re-running the analyzer. | |

**Q: Do we do anything about `0001`?**

| Option | Description | Selected |
|--------|-------------|----------|
| Leave it — it's a live specimen | Correct, committed, hash load-bearing; every `db:reset` exercises the real REVIEW path for free. | ✓ |
| Rewrite to the safe `NOT VALID` form | Changes the file hash; desynchronises every existing dev database. | |
| Leave it, suppress the report for applied history | Quieter resets; but the runner would say different things about the same SQL depending on DB state. | |

**Q: A parse failure reaching the runner?**

| Option | Description | Selected |
|--------|-------------|----------|
| Refuse everything, exit non-zero | "No verdict" can never mean "proceed". | ✓ |
| Skip that file, apply the rest | Applies migrations out of journal order — corrupts the property RUN-05/06 prove. | |
| Treat it as BLOCKED | Rejected by 03 D-08's own reasoning: conflates "analyzer broken" with "migration destructive". | |

---

## Transaction policy

**Q: Default transaction behaviour per file?**

| Option | Description | Selected |
|--------|-------------|----------|
| Wrap by default, auto-unwrap when hostile | Derived from the same parse that produced the verdict; no directive, no flag. | ✓ |
| Never wrap — always autocommit | One uniform rule; makes half-applied migrations the normal case. | |
| Split the file — wrap what can be wrapped | Preserves atomicity for most of the file; the file stops being one unit. | |

**Q: Where does "cannot run in a transaction" come from?**

| Option | Description | Selected |
|--------|-------------|----------|
| A new `transactionHostile` inspector fact | Code diff plus a test, per 03 D-01. Covers CONCURRENTLY forms, VACUUM, CREATE DATABASE, ALTER SYSTEM. Phase 5/7 inherit it. | ✓ |
| Derive from the existing `concurrently` fact | No analyzer change; silently misses several cases. | |
| A statement-kind list in the runner | Keeps the change inside Phase 4; a second place reasoning about SQL semantics. | |

**Q: Allow a file mixing hostile and ordinary statements?**

| Option | Description | Selected |
|--------|-------------|----------|
| Refuse — hostile statements go in their own file | Makes "unwrapped" always mean one statement, so a half-applied file is impossible by construction. | ✓ |
| Allow, run unwrapped, report clearly | No migration shape forbidden; half-applied files become an ordinary outcome. | |
| Allow only when the hostile statement is last | A third execution shape, with an invisible commit boundary. | |

**Q: When is the ledger row written for a wrapped file?**

| Option | Description | Selected |
|--------|-------------|----------|
| Inside the same transaction | Applied and recorded can never disagree. | ✓ |
| After the transaction commits | A crash in the gap leaves a migration applied and unrecorded. | |
| Before executing, cleared on failure | The ledger asserts something untrue for the duration of every migration. | |

**Notes:** Consequence surfaced immediately — with mixed files refused, the only residual partial
state in the whole system is a failed `CREATE INDEX CONCURRENTLY` leaving an `INVALID` index.

---

## Timeout policy

**Q: What values, and where do they live?**

| Option | Description | Selected |
|--------|-------------|----------|
| Pinned source constants, ~3s lock / 30s statement | Same pinning style as `EXPECTED_DEV_DATABASE_PORT`; changing them is a reviewed diff. | ✓ |
| Pinned but tighter (1s / 10s) | Closer to Strong Migrations' guidance; invites a loosening decision in Phase 7. | |
| Env vars with pinned defaults | Flexible; makes the timeout an operator-maintained value, and "set it to 0 in CI" a one-line diff. | |

**Q: How are they applied?**

| Option | Description | Selected |
|--------|-------------|----------|
| `options=-c ...` on the connection | No window in which the session exists without them; no ordering bug can skip them. | ✓ |
| `SET` as the first statement after connect | Easy to read in a log; a step a refactor could reorder or skip. | |
| `SET LOCAL` inside each transaction | Cleanest scoping; does nothing for unwrapped files, which are the CONCURRENTLY case. | |

**Q: Exemption for concurrent index builds?**

| Option | Description | Selected |
|--------|-------------|----------|
| No exemption — one pair of values | Honest and uniform; revisit in Phase 7 with real data volumes. | ✓ |
| Exempt hostile statements from `statement_timeout` | Derived from the parse; introduces an unbounded code path. | |
| A separate, longer timeout for hostile statements | Bounded in both cases; the longer number has no evidence behind it yet. | |

**Q: Migration SQL containing `SET statement_timeout = 0`?**

| Option | Description | Selected |
|--------|-------------|----------|
| Analyzer rule — BLOCKED | A migration disarming its own safety rail; same shape as a rules file downgrading `DROP TABLE`. | ✓ |
| Analyzer rule — REVIEW REQUIRED | Less absolute; makes "the gate can be turned off by the thing it gates" merely reviewable. | |
| Don't handle it in Phase 4 | Tighter phase; leaves a one-line bypass in the system built to be bypass-proof. | |

**Follow-up round (user chose "More questions"):**

**Q: Does the timeout-disarm rule join 03 D-02's code floor?**

| Option | Description | Selected |
|--------|-------------|----------|
| Joins the code floor | A rules file assigning it anything weaker fails validation; the analyzer refuses to run. | ✓ |
| Ordinary rules-file rule | Keeps the floor small; the rule protecting the timeouts becomes downgradable. | |
| Floor, but as a second named category | Keeps the two reasons legible; more structure to build and document. | |

**Q: Does the floor's stated definition change?**

| Option | Description | Selected |
|--------|-------------|----------|
| Widen to "irreversible data loss or self-disarming" | The floor stays a stated principle rather than a list with an unexplained member. | ✓ |
| Leave the definition, treat this as a named exception | Less churn in prior decisions; the floor stops explaining itself. | |

**Q: Verify the timeouts actually took effect?**

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — `SHOW` and assert before executing | Same "verify, don't assume" move `assertMigrationHistoryApplied` already makes. | ✓ |
| No — setting them is enough | Less code; ignores that this repo already has a recorded case of a tool succeeding without doing its job. | |

**Q: Catch a `SET` inside a DO block or function body?**

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — comes free with D-05 recursion | Plus an adversarial fixture pair, so coverage is structural. | ✓ |
| Top-level only | Smaller test surface; a hidden disarm is easier to smuggle than a hidden `DROP TABLE`. | |

---

## Partial-failure recovery

Framing given at the time: the transaction decisions already shrank this to one case — an unwrapped
single statement, chiefly a failed `CREATE INDEX CONCURRENTLY`.

**Q: How is the applied-but-unrecorded window handled?**

| Option | Description | Selected |
|--------|-------------|----------|
| Write an in-flight marker before executing | Turns an invisible window into a loud, named state. | ✓ |
| Require unwrapped SQL to be idempotent | A rule authors must remember; drizzle-kit does not generate that form. | |
| Accept the window | "Usually fails loudly" is not a guarantee. | |

**Q: Where does that state live?**

| Option | Description | Selected |
|--------|-------------|----------|
| A runner-owned table in the same database | Travels with the database it describes; also Phase 7's audit substrate. | ✓ |
| A file on disk next to the run report | Readable without a connection; describes a database it is not attached to. | |
| Both — table is truth, file mirrors it | Visibility for CI; a mirror that drifts is worse than no mirror. | |

**Q: What does the next run do when it finds a stale marker?**

| Option | Description | Selected |
|--------|-------------|----------|
| Refuse everything, report precisely | Continuing past an unknown state is how a partial failure becomes a silent one. | ✓ |
| Report and attempt automatic repair | Recovers unattended; puts destructive capability inside the safety tool. | |
| Report and continue past it | Keeps forward progress; applies later migrations onto an unknown state. | |

**Q: What does recovery look like?**

| Option | Description | Selected |
|--------|-------------|----------|
| A `db:migrate:recover` report-and-clear command | Reports state, clears the marker; never edits the journal, never repairs the schema. | ✓ |
| `db:reset` is the recovery path | Satisfies RUN-08's letter locally; leaves Phase 7 starting from zero. | |
| Recover command that also repairs | Fastest; same objection as automatic repair. | |

**Notes:** Recorded explicitly in CONTEXT.md that this reintroduces a sidecar table after the
Execution-engine round chose against one — scoped to what drizzle's schema cannot hold, and arrived
at for a concrete reason.

---

## History test harness

Framing given at the time: 02 D-14 ruled app-boot-against-Testcontainers out of scope because the
app's connection is pinned to `127.0.0.1:5432/recipe_dev`, and RUN-07 now requires that boot.

**Q: Which database do RUN-05/06 run against?**

| Option | Description | Selected |
|--------|-------------|----------|
| Testcontainers for history, real dev container for boot | Two harnesses, neither lying about what it proves. | ✓ |
| Everything against the real pinned dev container | One connection story; destroys the working dev DB every run and serialises the tests. | |
| Testcontainers throughout, loosen the app pin | Single harness; loosens the guard that makes the workspace structurally local. | |

**Q: Where do the tests live?**

| Option | Description | Selected |
|--------|-------------|----------|
| Own `test:history` suite + cheap default-suite check | The shape 02 D-16/D-19 chose for the drill, for the same reason. | ✓ |
| Join the existing `db:drill` slow suite | No third config; `db:drill` becomes a grab-bag and muddies its status record. | |
| Straight into the default `pnpm test` suite | Always runs; puts a multi-minute Docker dependency in the constant loop. | |

**Q: How is RUN-06's "existing already-migrated database" staged?**

| Option | Description | Selected |
|--------|-------------|----------|
| Apply history minus the newest, then the newest | Derived from the real journal; always tests the actual newest migration. | ✓ |
| Restore a backup taken at the prior state | Closest to production; couples a migration test to the backup pipeline. | |
| A purpose-built fixture migration pair | Stable and readable; stops testing the migration about to reach production. | |

**Q: How does the criterion-1 tamper test drive the runner?**

| Option | Description | Selected |
|--------|-------------|----------|
| Runner takes a migrations-dir argument, defaulted | Mirrors `enumerateMigrationFiles`; a directory is not a database target. | ✓ |
| Test the internal function with an injected buffer | No new parameter; proves the inner function refuses, not the real command. | |
| Mutate the real migrations directory | Exercises the genuine path; a crashed test leaves a BLOCKED migration committed. | |

**Follow-up round:**

**Q: Does the runner follow 02 D-06's seam for Testcontainers?**

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — pinned command, harness-only internal function | Pattern reused, not a new exception carved. | ✓ |
| Runner takes a connection-string parameter for tests | Simplest wiring; converts a structurally-local tool into a remotely-pointable one. | |

**Q: Does the cheap default check follow 02 D-19's staleness rule?**

| Option | Description | Selected |
|--------|-------------|----------|
| Hard-fail on missing or FAIL, no age rule | These tests are deterministic — nothing about them decays with time. | ✓ |
| Match the drill exactly — fail past 30 days | Consistent; red for a reason that is not real teaches people to ignore red. | |
| Fold into the existing drill status record | Fewer artifacts; 02 D-18 deliberately kept separate facts separate. | |

**Q: RUN-07's app boot — reuse verbatim or extend?**

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse verbatim after `db:reset` | 01 D-08 built it for exactly this; Phase 5 gets the same asset again. | ✓ |
| Extend it to assert the APP-02 changes | Proves the migration reached the app layer; stops being the stable reusable asset. | |

---

## APP-02 schema changes

Live detail surfaced at the time: `seed.ts` deliberately leaves some steps with a NULL
`timer_label`, so a bare `SET NOT NULL` would fail at execution, not merely classify.

**Q: Which reserved SAFE change?**

| Option | Description | Selected |
|--------|-------------|----------|
| Nullable `notes` column on `recipes` | The fixture 03 D-16 committed predicting SAFE; leaves `tags` unspent. | ✓ |
| A `tags` table | More schema for later phases; its foreign key would classify REVIEW REQUIRED without care. | |

**Q: Which reserved REVIEW REQUIRED change?**

| Option | Description | Selected |
|--------|-------------|----------|
| `SET NOT NULL` on `timer_label`, backfilled first | Matches the committed fixture; the backfill's row-scoped `WHERE` also demonstrates the floor from the passing side. | ✓ |
| `NOT NULL` column with a volatile default | Always succeeds; leaves the existing fixture's prediction unexercised. | |
| `SET NOT NULL` with no backfill — let it fail | Realistic; conflates a classification demo with an execution failure. | |

**Q: How does the BLOCKED change exist as proof?**

| Option | Description | Selected |
|--------|-------------|----------|
| Generated for real, refused, then reverted — with a committed replay | A real generated change really refused, and permanently re-provable. | ✓ |
| Live permanently outside the journal | Always available; a hand-placed file rather than a real generated change. | |
| Reuse the existing app-shaped corpus fixture | Zero new material; skips what 03 D-16 wrote the mirror to enable. | |

**Q: A documented human episode alongside the tests?**

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — a short `docs/` record of all three runs | Follows 02 D-10's precedent; criterion 5 is a claim about what happened. | ✓ |
| Automated tests only | Cannot go stale; nobody ever sees what the runner's output looks like to a human. | |

---

## Runner's home & seams

**Q: Where does the runner's core live?**

| Option | Description | Selected |
|--------|-------------|----------|
| Core in `packages/automation`, thin local entry in `scripts/` | Mirrors 03 D-11's seam; Phase 7 adds an entry point rather than rewriting. | ✓ |
| Entirely in `scripts/` | Simplest now; Phase 7 would promote a script written assuming a pinned local target. | |
| Entirely in `packages/automation`, including the pin | One home; the extractable artifact carries a pin it must eventually shed. | |

**Q: May `packages/automation` import `pg`?**

| Option | Description | Selected |
|--------|-------------|----------|
| No — the caller injects a client | "This package cannot connect by itself" stays structural rather than conventional. | ✓ |
| Yes — add `pg` as a dependency | Self-contained for Phase 7's publish; grants the safety package the capability the project most constrains. | |

**Q: What changes for `db:reset`?**

| Option | Description | Selected |
|--------|-------------|----------|
| Calls the safe runner; keep the independent re-check | A brand-new migrate tool is exactly when an assertion that does not trust it earns its keep. | ✓ |
| Calls the safe runner; drop the re-check | Removes a now-redundant step, and the only assertion that does not trust the tool's own account. | |
| Calls the runner's internal function directly | Faster; `db:reset` would stop exercising the real command. | |

**Q: Where does the machine-readable run report go?**

| Option | Description | Selected |
|--------|-------------|----------|
| The runner-owned table, plus stdout JSON on request | Lives with the database it describes; Phase 7 inherits the substrate. | ✓ |
| An uncommitted file at a known path | Readable without a connection; describes a database that may since have been reset. | |
| A committed status file, like the drill's | Consistent with 02 D-17; dirties the tree on every migration run. | |

---

## Claude's Discretion

The user made every offered call explicitly; nothing was answered with "you decide". The discretion
items recorded in CONTEXT.md are areas that surfaced during discussion but were deliberately left
open for research and planning:

- The runner-owned table's name, columns and bootstrap mechanism.
- Precise timeout numbers within the ~3s/~30s intent, and whether `idle_in_transaction_session_timeout` joins them.
- The run report's JSON shape.
- Module layout inside `packages/automation` and the injected client interface's exact shape.
- Whether the backfill and `SET NOT NULL` are one migration or two, and what the backfill writes.
- How the slow-lock test manufactures a competing lock, and how the deliberate mid-migration failure is induced.
- What the history tests assert about the resulting schema, and whether the seed runs in throwaway containers.
- Filenames and locations for the APP-02 record and the history-test status file.
- Whether `ALTER DATABASE ... SET` / `ALTER ROLE ... SET` are additional disarm vectors or a noted gap.
- The exact mechanism of the "no code path reaches `drizzle-kit migrate`" test.

## Deferred Ideas

- A longer, separate `statement_timeout` for concurrent index builds — Phase 7, when data volumes make the number empirical.
- Automatic repair of an `INVALID` index — revisit only if the manual path proves painful.
- `ALTER DATABASE ... SET` / `ALTER ROLE ... SET` as timeout-disarm vectors — fold in or record as a known gap.
- `idle_in_transaction_session_timeout` — same mechanism, not discussed.
- The `tags` table — unspent SAFE churn material for a later phase.
- Expand-and-contract (APP-03) — Phase 7, per 01 D-11's fourth row.
- Rules-file fingerprint in every verdict — Phase 7; the runner-owned table is now its obvious home.
- An approval/override path for REVIEW REQUIRED with override logging and per-rule frequency counting — Phases 5 and 7.
- `eugene trace` lock verification (ADV-01, v2) and schema-drift snapshots (ADV-02, Phase 7).
- Extending the smoke test to assert APP-02 columns — declined; a new test if a later phase wants it.

No scope creep was raised during the discussion; every area stayed inside the RUN-01…RUN-08 / APP-02 boundary.
