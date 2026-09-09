---
phase: "06"
slug: "private-staging-connectivity"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-09-09"
---

# Phase 06 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

**Provenance.** Nothing here is invented. Every row is transcribed from an artifact that already
exists: `06-RESEARCH.md`'s "Validation Architecture" section, the `<verify>` blocks of the eight
committed plans (`06-01-PLAN.md` … `06-08-PLAN.md`), and this repository's `package.json` scripts
and `vitest.*.config.ts` files. Where the source material has a real gap, this document says
UNKNOWN rather than filling it with a plausible number — `CLAUDE.md`'s "mark unverified things
UNKNOWN" non-negotiable applies to this file too. The plans' verify commands were probe-checked at
planning time (path probe + failing-direction probe, 0 findings across 56 commands), so this map
transcribes them rather than re-deriving them.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `vitest` `^5.0.0` [VERIFIED: `package.json` devDependencies] |
| **Config file** | `vitest.config.ts` (fast default suite), `vitest.history.config.ts` (Docker/Testcontainers migration-history suite), `vitest.drill.config.ts` (Docker restore-drill suite) — all three exist today |
| **Quick run command** | `pnpm test` (= `vitest run`; excludes `tests/history/**` and `tests/drill/**` structurally) |
| **Full suite command** | `pnpm test && pnpm test:history && pnpm test:drill` |
| **Estimated runtime** | `pnpm test`: **~58 s** — measured 2026-09-09 on the dev machine (52 files, 561 tests, vitest-reported duration 57.43 s). `pnpm test:history` and `pnpm test:drill`: **UNKNOWN** — Docker-dependent, not measured this session; `docs/restore-drill-status.json` records per-stage millisecond timings but no suite wall-clock, and `docs/migration-history-status.json` records outcome only. |

Supporting non-vitest checks used by plan verify blocks: `pnpm exec tsc --noEmit` (type gate),
`pnpm exec tsx <script>` (argument-free entry-point behaviour, including deliberate
failing-direction runs), and `grep` assertions against committed records and workflow YAML.

---

## Sampling Rate

Transcribed from `06-RESEARCH.md` § Validation Architecture → Sampling Rate.

- **After every task commit:** `pnpm test` — the fast suite, ~58 s.
- **After every plan wave:** `pnpm test && pnpm test:history` — the marker-refusal and
  role-privilege Testcontainers proofs live in `tests/history/` (D-08, CONN-05).
- **Before `/gsd-verify-work`:** full suite green, **plus** all four performed records committed
  with verbatim output — `docs/50-staging-connectivity-recon.md` (D-03),
  `docs/51-staging-port-proof.md` (D-04), `docs/52-staging-push-refusal.md` (D-08),
  `docs/55-staging-end-to-end-record.md` (criterion 4).
- **Max feedback latency:** **~58 s** (measured, above) for the per-task loop. The per-wave loop's
  latency is UNKNOWN because `pnpm test:history` has not been timed.

---

## Per-Task Verification Map

Every `type="auto"` task below ends its verify block with `pnpm test` as a regression sweep; the
column shows the *discriminating* command for that task, not the whole block. `<fails_when>`
predicates are in the plans and are not duplicated here.

**File Exists key:** ✅ = the file exists in the repository today. ⊕ = the file does not exist yet
and is authored **inside the same task** that verifies against it (TDD-first, `tdd="true"` where
marked) — so there is no dangling `MISSING` reference and no separate Wave 0 plan is required.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | CONN-01 | T-06-02, T-06-03 | Staging identity is the server's own `current_database()`, never a substring of the URL; errors render only through `safeErrorMessage` | tracer / integration (live tunnel) | `pnpm exec tsx scripts/staging-connect-check.ts` | ⊕ `scripts/staging-connect-check.ts` · ✅ `tests/guardrails.test.ts` | ⬜ pending |
| 06-01-02 | 01 | 1 | CONN-01, CONN-02 | T-06-01, T-06-05 | Restricted key grants exactly one forward and no shell; Coolify public toggle observed OFF | manual (blocking-human) | MANUAL — see Manual-Only Verifications | n/a | ⬜ pending |
| 06-01-03 | 01 | 1 | CONN-01, CONN-02 | T-06-04 | No host address enters the public repository; D4 cites performed evidence, not community reports | doc-grep + regression | `grep -c "50-staging-connectivity-recon" docs/decisions.md docs/00-current-state.md` | ⊕ `docs/50-staging-connectivity-recon.md` | ⬜ pending |
| 06-02-01 | 02 | 2 | CONN-05 | T-06-09, T-06-10 | Passwords reach SQL only via bound `set_config`/`current_setting`; every dynamic statement uses `format` `%I`/`%L` | type gate + guardrail | `pnpm exec tsc --noEmit` · `pnpm exec vitest run tests/guardrails.test.ts` | ⊕ `scripts/sql/bootstrap-roles.sql`, `scripts/bootstrap-roles.ts` · ✅ `tests/guardrails.test.ts` | ⬜ pending |
| 06-02-02 | 02 | 2 | CONN-05 | T-06-07, T-06-08, T-06-11 | `recipe_app` denied DDL, `recipe_migrator` NOSUPERUSER and single-database, `recipe_readonly` SELECT-only — proven by execution against real PostgreSQL 17, including the pre-existing-table grant path (Pitfall 4) | integration (Testcontainers, `tdd="true"`) | `pnpm exec vitest run --config vitest.history.config.ts tests/history/roles-privilege-boundary.test.ts` | ⊕ `tests/history/roles-privilege-boundary.test.ts` | ⬜ pending |
| 06-02-03 | 02 | 2 | CONN-05 | T-06-13 | The Coolify-issued owner credential is used exactly once, then deleted; the app runs as `recipe_app` | manual (blocking-human) | MANUAL — see Manual-Only Verifications | n/a | ⬜ pending |
| 06-02-04 | 02 | 2 | CONN-05 | T-06-12 | The marker is a database-level `COMMENT` a session cannot forge; the analyzer exclusion is recorded with its reason, not left implicit | doc-grep + regression | `grep -c "StatementKind" docs/decisions.md` | ⊕ `docs/53-staging-role-bootstrap.md` | ⬜ pending |
| 06-03-01 | 03 | 2 | CONN-01, CONN-02 | T-06-15, T-06-17 | The restricted key refuses an interactive login and a second forward; the host-side vantage sees past a closed firewall | manual (blocking-human) | MANUAL — see Manual-Only Verifications | n/a | ⬜ pending |
| 06-03-02 | 03 | 2 | CONN-01, CONN-02 | T-06-14, T-06-16 | An unperformed vantage reads UNKNOWN, never PASS; no numeric public address is committed; the record is re-runnable | doc-grep | `grep -c "Overall verdict" docs/51-staging-port-proof.md` · `grep -c "UNKNOWN" docs/51-staging-port-proof.md` | ⊕ `docs/51-staging-port-proof.md` | ⬜ pending |
| 06-04-01 | 04 | 3 | CONN-03 | T-06-19, T-06-20, T-06-22 | Marker seeding is ordered strictly after the `current_database()` check; absent or unreadable marker is a refusal; the dev path self-heals after `db:reset` | unit (`tdd="true"`) | `pnpm exec vitest run scripts/env.test.ts` | ✅ `scripts/env.test.ts` | ⬜ pending |
| 06-04-02 | 04 | 3 | CONN-03 | T-06-18 | A tunnelled staging database carrying the `staging` marker is refused by the development guard — proven against a real container, not a mock | integration (Testcontainers, `tdd="true"`) | `pnpm exec vitest run --config vitest.history.config.ts tests/history/staging-marker-refusal.test.ts` | ⊕ `tests/history/staging-marker-refusal.test.ts` | ⬜ pending |
| 06-04-03 | 04 | 3 | CONN-03 | T-06-21 | The marker cannot be quietly unwired; no module outside `scripts/env.ts` reads a staging variable directly | guardrail + doc-grep | `pnpm exec vitest run tests/guardrails.test.ts` · `grep -c "shobj_description\|environment marker" docs/decisions.md` | ✅ `tests/guardrails.test.ts` | ⬜ pending |
| 06-05-01 | 05 | 4 | CONN-04 | T-06-23 | The staging pin asserts three server-reported facts and no literal host or port, so routing alone cannot satisfy it | unit (`tdd="true"`) | `pnpm exec vitest run scripts/env.test.ts` | ✅ `scripts/env.test.ts` | ⬜ pending |
| 06-05-02 | 05 | 4 | CONN-04 | T-06-24, T-06-25, T-06-28 | With the variable unset the entry point refuses loudly and names it — no fallback destination; classification is re-derived at execution time | failing-direction + guardrail | `pnpm exec tsx scripts/db-migrate-staging.ts` (must exit non-zero naming `RECIPE_STAGING_MIGRATOR_DATABASE_URL`) | ⊕ `scripts/db-migrate-staging.ts` | ⬜ pending |
| 06-05-03 | 05 | 4 | CONN-04 | T-06-26 | A tunnel that never came up is not a migration that succeeded — bounded poll, non-zero exit, no fixed sleep and no warn-and-continue | failing-direction + guardrail | `pnpm exec tsx scripts/ci/wait-for-staging-port.ts` (must exit non-zero within 45 s with nothing listening) | ⊕ `scripts/ci/wait-for-staging-port.ts` | ⬜ pending |
| 06-06-01 | 06 | 4 | CONN-03 | T-06-29, T-06-30, T-06-31 | Four real schema-sync attempts: three refuse and name the refusing layer, the fourth succeeds against the local container | manual (blocking-human) | MANUAL — see Manual-Only Verifications | n/a | ⬜ pending |
| 06-06-02 | 06 | 4 | CONN-03 | T-06-32, T-06-33 | The record states what it does *not* prove; no credential or numeric public address is committed; the local dev environment was restored | doc-grep + regression | `grep -c "What this does not prove" docs/52-staging-push-refusal.md` | ⊕ `docs/52-staging-push-refusal.md` | ⬜ pending |
| 06-07-01 | 07 | 5 | CONN-04 | T-06-34, T-06-36 | The `main`-only deployment branch policy is read back, not merely submitted; no staging secret exists at repository level; the CI key is a separately revocable line | manual (blocking-human) | MANUAL — see Manual-Only Verifications | n/a | ⬜ pending |
| 06-07-02 | 07 | 5 | CONN-04 | T-06-35, T-06-37, T-06-38, T-06-39, T-06-42 | Job declares `environment: staging`; `ExitOnForwardFailure=yes` so a widened forward fails closed; `cancel-in-progress: false` queues rather than cancelling mid-migration; teardown runs `if: always()` | workflow-grep (comment-filtered) + guardrail | `grep -v '^[[:space:]]*#' .github/workflows/staging-migrate.yml \| grep -c 'environment: staging'` (plus the same shape for `ExitOnForwardFailure=yes`, `cancel-in-progress: false`, `if: always()`) | ⊕ `.github/workflows/staging-migrate.yml` | ⬜ pending |
| 06-07-03 | 07 | 5 | CONN-04 | T-06-40, T-06-41 | Honest limits are written down: tracking-issue notification is not an audit log, and an admin can change the branch policy undetected | doc-grep + regression | `grep -c "Honest limits" docs/54-staging-pipeline.md` | ⊕ `docs/54-staging-pipeline.md` | ⬜ pending |
| 06-08-01 | 08 | 6 | CONN-04 | — | The additive change passes the same runner and classifier locally before it is allowed to travel the pipeline; the history suite's expected-columns pin is updated with it | integration + history suite | `pnpm exec tsx scripts/db-migrate.ts` · `pnpm exec tsx packages/automation/src/cli.ts --migrations` · `pnpm test:history` | ✅ `tests/history/support.ts` | ⬜ pending |
| 06-08-02 | 08 | 6 | CONN-01…CONN-05 | T-06-43, T-06-44, T-06-46 | Deployment id and start time identical before and after — "no redeploy" observed, not inferred; a credential in a log is reported as a defect, not redacted quietly | manual (blocking-human) | MANUAL — see Manual-Only Verifications | n/a | ⬜ pending |
| 06-08-03 | 08 | 6 | CONN-01…CONN-05 | T-06-45 | A CONN requirement is ticked only where a named artifact or recorded observation backs it; every untick carries a stated gap | doc-grep + regression | `grep -c "CONN-0" .planning/REQUIREMENTS.md` · `grep -c "What did not go as expected" docs/55-staging-end-to-end-record.md` | ⊕ `docs/55-staging-end-to-end-record.md` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Sampling continuity:** 23 tasks, 6 of them blocking-human. In execution order no two manual tasks
are adjacent — the longest run without an automated verify is 1 — so the "no 3 consecutive tasks
without automated verify" rule holds by construction.

---

## Wave 0 Requirements

No separate Wave 0 plan is required, and no plan carries a `MISSING — Wave 0 must create …`
placeholder. `vitest ^5.0.0` and `@testcontainers/postgresql` are already installed, and all three
vitest configs already exist, so there is **no framework install**. Each new test file is authored
inside the TDD task that verifies against it, in the same commit sequence:

- [ ] `tests/history/roles-privilege-boundary.test.ts` — CONN-05; authored by **06-02 Task 2**
      (`tdd="true"`), run under `vitest.history.config.ts`.
- [ ] `tests/history/staging-marker-refusal.test.ts` — CONN-03; authored by **06-04 Task 2**
      (`tdd="true"`), run under `vitest.history.config.ts`.
- [ ] `scripts/ci/wait-for-staging-port.ts` — CONN-04; authored by **06-05 Task 3**, verified by its
      own failing-direction run (no tunnel ⇒ non-zero within 45 s).
- [ ] `scripts/staging-connect-check.ts`, `scripts/bootstrap-roles.ts`, `scripts/sql/bootstrap-roles.sql`,
      `scripts/db-migrate-staging.ts` — production entry points authored by 06-01/06-02/06-05 and
      pinned by the existing `tests/guardrails.test.ts` source-surface suite.
- [ ] Performed-record documents, none of which exist yet: `docs/50-staging-connectivity-recon.md`,
      `docs/51-staging-port-proof.md`, `docs/52-staging-push-refusal.md`,
      `docs/53-staging-role-bootstrap.md`, `docs/54-staging-pipeline.md`,
      `docs/55-staging-end-to-end-record.md`.

---

## Manual-Only Verifications

Six blocking-human checkpoints. Each is manual for the same structural reason: the evidence lives
on the Hetzner host, in the Coolify UI, in GitHub Environment administration, or in a real merge —
none of which the executor can reach, and three of which (`D-04`, `D-08`, criterion 4) the phase
requires to be *performed* rather than asserted. Full instructions are in the plans; the commands
below are the load-bearing ones.

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| **06-01 / Task 2** — hands-on recon of this Coolify instance (13 observations) | CONN-01, CONN-02 | Coolify UI state, Hetzner console state and root-level host output; the executor has no access to any of the three | With the resource created: paste verbatim (1) server inventory, (2) `coolify version`, (3) `ss -tlnp` on the host, (4) Hetzner Cloud Firewall inbound rules (`hcloud firewall describe <name>` or console text), (5) port-22 status and source ranges, (6) any database with a public port + the `recipe_staging` toggle state, (7) resource-vs-compose-service and which `recipe_staging` is, (8) `docker network inspect <coolify network>` **twice, with a redeploy between**, (9) the literal `permitopen` destination and the `authorized_keys` line with key material as `<owner-key>`, (10) volume survival across redeploy, (11) Coolify backup config, (12) where secrets live, (13) the app's URL and root-path HTTP status. Any item not established is written **UNKNOWN with its reason** — never omitted. Resume signal: `recon captured`. |
| **06-02 / Task 3** — run the role bootstrap against real staging and repoint the application | CONN-05 | The Coolify-issued owner credential must never reach the executor (D-12), and the app's environment lives in the Coolify UI | Set the three role passwords + `RECIPE_STAGING_BOOTSTRAP_DATABASE_URL` in the gitignored `.env`; `ssh -N staging-db`; run `pnpm db:bootstrap:staging` and paste its full output including the `pg_roles` table; repoint `RECIPE_STAGING_READONLY_DATABASE_URL` to `recipe_readonly` and paste `pnpm staging:check`; change the deployed app's `DATABASE_URL` to `recipe_app` in Coolify, restart, report root-path HTTP status; delete the bootstrap URL, migrator password and app password locally and confirm in writing; report whether `COMMENT ON DATABASE` succeeded inside the transaction. Pass = `staging:check` exits 0 reporting `current_database=recipe_staging`, all three roles show `rolsuper` false, deletions confirmed. Resume signal: `bootstrap performed`. |
| **06-03 / Task 1** — three-vantage port proof + two key-scope attempts | CONN-01, CONN-02 | "No port is open" is a negative claim the system cannot observe about itself; needs an off-host vantage, a host shell, and the Coolify UI | **Do not open the port "temporarily to check."** V1 (tunnel closed, from the dev machine): `Test-NetConnection -ComputerName <hetzner-public-address> -Port 5432`, paste including `TcpTestSucceeded`. V2 (on the host): `ss -tlnp`, complete and unfiltered. V3: the "Publicly Accessible" toggle state and exact UI label for `recipe_staging` **and every other database on the instance**. Then: `ssh staging-db` without `-N` (interactive login attempt) and `ssh -N -L 15433:127.0.0.1:22 staging-db` followed by a connection attempt (disallowed second forward). Five dated outputs, each with its exact command/UI path, host address redacted to `<host>`. A vantage not performed is stated as UNKNOWN. Resume signal: `port proof captured`. |
| **06-06 / Task 1** — four real schema-sync attempts | CONN-03 | D-08 is explicit that a test asserting an assertion is not criterion 3's claim; the readonly credential exists only in the owner's gitignored `.env` | With `ssh -N staging-db` open, run drizzle-kit's direct schema-sync sub-command four times and paste each command, verbatim output and `$LASTEXITCODE`: (1) via the repo config with `RECIPE_STAGING_READONLY_DATABASE_URL` set; (2) with `RECIPE_DEV_DATABASE_URL` on loopback:5432/`recipe_dev` but forwarded to staging (local container stopped) — the deliberate collision; restore afterwards and confirm `pnpm db:up` + `pnpm db:query`; (3) with a direct `--url`-style flag using the `recipe_readonly` credential, bypassing the config; (4) against the real local container, which must succeed. Name which layer refused each of 1–3. Pass = 1–3 non-zero, 4 succeeds, `pnpm test` green afterwards. Any attempt that does **not** refuse is recorded as a finding. Resume signal: `push attempts captured`. |
| **06-07 / Task 1** — create the `staging` GitHub Environment, its `main`-only policy, secrets and CI key | CONN-04 | Environment administration needs repository-admin rights; `docs/decisions.md` D30 confirmed live that `GITHUB_TOKEN` cannot be granted them and D31 rejected a CI-held credential workaround | Generate a CI-only ed25519 keypair (no passphrase), add it as a **second** `authorized_keys` line `restrict,permitopen="<destination>",command="/bin/false"`; `ssh-keyscan` once for `STAGING_SSH_KNOWN_HOSTS`; `gh api -X PUT repos/{owner}/{repo}/environments/staging` with `protected_branches` false / `custom_branch_policies` true; add `main` via the deployment-branch-policies sub-endpoint **confirming its exact path with a live `gh api` call** (closes `06-RESEARCH.md` A2 — paste command and response); read back with `gh api repos/{owner}/{repo}/environments/staging`; confirm no protection rules and no reviewers; `gh secret set --env staging` for all six secrets then paste `gh secret list --env staging`; paste `gh secret list` showing none at repository level; confirm `RECIPE_STAGING_MIGRATOR_DATABASE_URL` is absent from the local `.env`. Resume signal: `staging environment created`. |
| **06-08 / Task 2** — merge twice; observe staging migrating itself while the app keeps serving | CONN-01…CONN-05 | The executor cannot merge past the Phase 5 ruleset and cannot see Coolify deployment history | **Merge 1 (pipeline only, excluding Task 1's schema commit):** paste the `staging-migrate` run URL, the full `[db:migrate:staging]` output and run-report JSON, per-step success (tunnel / wait / migrate / teardown) and the wait duration; confirm no Coolify terminal and no local command. **Between:** record the app's deployment/container id, start time and root-path HTTP status. **Merge 2 (schema commit only):** paste the second run URL and run report, then the app's deployment id and start time again — they must be unchanged — plus root-path status, plus an exercised page/endpoint reading the new column (any permission-denied message pasted verbatim, not worked around). **Finally:** `pnpm staging:check` and one readonly `SELECT` against the new column. A first-run failure is part of the record, not something to retry until green. Resume signal: `end to end observed`. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or are blocking-human checkpoints listed above — 17 auto
      tasks carry `<automated>` + `<fails_when>`; 6 manual tasks carry `<verification>` +
      `<resume-signal>`.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (longest manual run: 1).
- [x] Wave 0 covers all MISSING references — no plan emits a `MISSING — Wave 0` placeholder; each
      new test file is authored inside the TDD task that verifies against it (see above).
- [x] No watch-mode flags — every vitest invocation is `vitest run`; the remaining commands are
      `tsc --noEmit`, one-shot `tsx` runs, and `grep`.
- [x] Feedback latency < 60 s for the per-task loop (58 s measured 2026-09-09). Per-wave loop
      latency UNKNOWN — `pnpm test:history` not timed.
- [ ] `nyquist_compliant: true` set in frontmatter — **deliberately not set here.** Frontmatter
      `status` and `nyquist_compliant` are set by `/gsd-validate-phase` §6 *after* execution, not by
      planning.

**Approval:** pending — awaiting phase execution and `/gsd-validate-phase`.
