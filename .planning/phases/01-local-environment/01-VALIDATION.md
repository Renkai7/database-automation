---
phase: "01"
slug: "local-environment"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: validated
nyquist_compliant: false
wave_0_complete: true
created: "2026-09-06"
validated: "2026-09-08"
---

# Phase 01 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
>
> **Reconstructed retroactively on 2026-09-08.** This file was seeded as an unfilled template by
> plan-phase and was never populated during execution; the content below is derived from the eight
> plan SUMMARY `coverage:` blocks, `01-VERIFICATION.md`, and a live audit of the test suite. Every
> status recorded here was observed by running the command in the same column, not inferred from
> a SUMMARY's claim.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 5.0.0 (workspace root) |
| **Config file** | `vitest.config.ts` (pool `forks`, `fileParallelism: false`, 180s test/hook timeout) |
| **Quick run command** | `pnpm exec vitest run scripts/env.test.ts tests/guardrails.test.ts tests/log.test.ts tests/dev-database-baseline.test.ts` |
| **Full suite command** | `pnpm test` (= `vitest run`) |
| **Phase 01 subset** | `pnpm exec vitest run scripts/env.test.ts tests/db-query.test.ts tests/db-reset.test.ts tests/dev-database-baseline.test.ts tests/guardrails.test.ts tests/log.test.ts tests/smoke.test.ts tests/target-pin.test.ts tests/verify-migration-state.test.ts` |
| **Estimated runtime** | ~31 seconds (Phase 01 subset, 9 files / 56 tests); ~1s for the quick subset |
| **External dependencies** | Docker Desktop with the `db` service up and healthy is required by `db-reset`, `smoke`, `verify-migration-state`, `dev-database-baseline` and `target-pin`. `guardrails`, `log` and `env` are Docker-free by design and run anywhere, including CI. |

---

## Sampling Rate

- **After every task commit:** Run the quick command above (Docker-free + baseline, ~1s)
- **After every plan wave:** Run the Phase 01 subset command
- **Before `/gsd-verify-work`:** Full suite (`pnpm test`) must be green
- **Max feedback latency:** ~31 seconds for the full phase subset

---

## Per-Task Verification Map

Task IDs are the `coverage:` item IDs from each plan's SUMMARY frontmatter (`{plan}-D{n}`).

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01-D1 | 01 | 1 | — | — | N/A | manual | — (docs write-back; human_judgment) | ❌ | ⬜ manual-only |
| 01-01-D2 | 01 | 1 | ENV-01 | T-01-01 | Dev server pinned to PG17 with a declared-empty extension baseline (D-13) | integration | `pnpm exec vitest run tests/dev-database-baseline.test.ts` | ✅ | ✅ green |
| 01-01-D2b | 01 | 1 | ENV-01 | T-01-01 | Database port published on loopback only; no container init-script mount | unit | `pnpm exec vitest run tests/guardrails.test.ts` | ✅ | ✅ green |
| 01-01-D3 | 01 | 1 | ENV-03 | T-01-18 | `.env` gitignored; only `.env.example` committed | unit | `pnpm exec vitest run tests/guardrails.test.ts` (connection-string-prefix allowlist) | ✅ | ✅ green |
| 01-01-D4 | 01 | 1 | — | — | N/A | manual | — (workspace/script-surface shape) | ❌ | ⬜ manual-only |
| 01-01-D5 | 01 | 1 | — | — | N/A | unit | `pnpm test` (config loads at all) | ✅ | ✅ green |
| 01-02-D1 | 02 | 2 | ENV-02 | — | Migration reaches the journal and the live DB, never `push` | integration | `pnpm exec vitest run tests/db-reset.test.ts tests/verify-migration-state.test.ts` | ✅ | ✅ green |
| 01-02-D2 | 02 | 2 | APP-01 | — | Route serves DB-sourced content over real HTTP | e2e | `pnpm exec vitest run tests/smoke.test.ts` | ✅ | ✅ green |
| 01-02-D3 | 02 | 2 | APP-01 | — | Unknown slug → 404, not a server error | e2e | `pnpm exec vitest run tests/smoke.test.ts` | ✅ | ✅ green |
| 01-02-D4 | 02 | 2 | ENV-03 | T-01-20 | Bare `DATABASE_URL` hard-fails, no warn-and-continue | unit | `pnpm exec vitest run scripts/env.test.ts` | ✅ | ✅ green |
| 01-02-D5 | 02 | 2 | ENV-03 | T-01-21 | Every process asserts `current_database()` pre-statement | unit | `pnpm exec vitest run scripts/env.test.ts` | ✅ | ✅ green |
| 01-02-D6 | 02 | 2 | ENV-03 | T-01-18 | No failure path discloses a connection string or credential | unit | `pnpm exec vitest run scripts/env.test.ts tests/log.test.ts` | ✅ | ✅ green |
| 01-02-D7 | 02 | 2 | ENV-02 | — | `recipes` holds exactly its nine baseline columns (D-09/D-10/D-11 churn budget unspent) | integration | `pnpm exec vitest run tests/dev-database-baseline.test.ts` | ✅ | ✅ green |
| 01-02-D8 | 02 | 2 | APP-01 | — | Seed is deterministic and design-derived | e2e | `pnpm exec vitest run tests/smoke.test.ts` (content assertions) | ✅ | ✅ green |
| 01-03-D1 | 03 | 3 | ENV-02 | — | FKs with cascade delete; per-recipe position uniqueness | integration | `pnpm exec vitest run tests/db-reset.test.ts` (table set + convergence) | ✅ | ✅ green |
| 01-03-D2 | 03 | 3 | ENV-02 | — | A second edit travels the same loop; journal ↔ applied count agree | integration | `pnpm exec vitest run tests/db-reset.test.ts tests/verify-migration-state.test.ts` | ✅ | ✅ green |
| 01-03-D3 | 03 | 3 | ENV-02 | — | Fresh apply yields exactly 1/8/5 rows | integration | `pnpm exec vitest run tests/db-reset.test.ts` | ✅ | ✅ green |
| 01-03-D4 | 03 | 3 | APP-01 | — | Quantities stored raw, scaled at render time | e2e | `pnpm exec vitest run tests/smoke.test.ts` | ✅ | ✅ green |
| 01-03-D5 | 03 | 3 | ENV-02 | — | No reserved D-10/D-11 schema change spent | integration | `pnpm exec vitest run tests/dev-database-baseline.test.ts tests/db-reset.test.ts` | ✅ | ✅ green |
| 01-03-D6 | 03 | 3 | — | — | N/A | e2e | `pnpm test` | ✅ | ✅ green |
| 01-04-D1 | 04 | 4 | ENV-05 | T-01-15/16/17 | `db:query` has zero flag surface; refuses every redirect shape; leaks nothing | integration | `pnpm exec vitest run tests/db-query.test.ts` | ✅ | ✅ green |
| 01-04-D2 | 04 | 4 | ENV-04 | T-01-22/24 | `db:reset` rebuilds non-interactively and converges on re-run | integration | `pnpm exec vitest run tests/db-reset.test.ts` | ✅ | ✅ green |
| 01-04-D3 | 04 | 4 | ENV-03 | T-01-18 | Structural constraints enforced mechanically, Docker-free | unit | `pnpm exec vitest run tests/guardrails.test.ts` | ✅ | ✅ green |
| 01-05-D1 | 05 | 5 | APP-01 | — | Screen renders DB rows, not hardcoded arrays | e2e | `pnpm exec vitest run tests/smoke.test.ts` | ✅ | ✅ green |
| 01-05-D2 | 05 | 5 | APP-01 | — | Error boundary never surfaces `error.message`/connection details | e2e | `pnpm exec vitest run tests/smoke.test.ts` | ✅ | ✅ green |
| 01-05-D3 | 05 | 5 | APP-01 | — | Design divergences preserved (visual fidelity) | manual | — (human_judgment: true) | ❌ | ⬜ manual-only |
| 01-05-D4 | 05 | 5 | APP-01 | — | Breakpoints match developer intent | manual | — (human_judgment: true, no verification declared) | ❌ | ⬜ manual-only |
| 01-06-D1 | 06 | 6 | ENV-03 | T-01-16 | Redirected target rejected pre-connect in every process | unit + integration | `pnpm exec vitest run scripts/env.test.ts tests/target-pin.test.ts` | ✅ | ✅ green |
| 01-06-D2 | 06 | 6 | ENV-04 | T-01-16 | `db:reset` refuses a redirect *before* tearing anything down | integration | `pnpm exec vitest run tests/target-pin.test.ts` | ✅ | ✅ green |
| 01-06-D3 | 06 | 6 | ENV-03 | T-01-18 | No rejection path prints a scheme prefix, password, or rejected value | unit + integration | `pnpm exec vitest run scripts/env.test.ts tests/target-pin.test.ts` | ✅ | ✅ green |
| 01-06-D4 | 06 | 6 | ENV-02 | T-01-16 | `drizzle.config.ts` calls the assertion itself (no inherited check) | unit | `pnpm exec vitest run tests/guardrails.test.ts` | ✅ | ✅ green |
| 01-06-D5 | 06 | 6 | ENV-03 | T-01-18 | Named fixture allowlists, not a blanket `*.test.ts` exemption | unit | `pnpm exec vitest run tests/guardrails.test.ts` | ✅ | ✅ green |
| 01-07-D1 | 07 | 7 | ENV-05 | T-01-18 | Never-print-the-raw-error rule defined once and imported | unit + integration | `pnpm exec vitest run tests/log.test.ts tests/db-query.test.ts` | ✅ | ✅ green |
| 01-07-D2 | 07 | 7 | ENV-04 | — | Rebuild re-verifies migration state, not drizzle-kit's exit code | unit + integration | `pnpm exec vitest run tests/verify-migration-state.test.ts` | ✅ | ✅ green |
| 01-07-D3 | 07 | 7 | ENV-04 | — | The state assertion is proven to FAIL, not only to pass | unit | `pnpm exec vitest run tests/verify-migration-state.test.ts` | ✅ | ✅ green |
| 01-07-D4 | 07 | 7 | ENV-04 | T-01-24 | Verification step fails loudly; no skip flag; D-22 order intact | integration | `pnpm exec vitest run tests/db-reset.test.ts tests/guardrails.test.ts` | ✅ | ✅ green |
| 01-08-D1 | 08 | 8 | APP-01 | — | Non-positive `base_servings` renders finite output, not `Infinity`/`NaN` | manual | — (source-level only; see Manual-Only) | ❌ | ⬜ manual-only |
| 01-08-D2 | 08 | 8 | APP-01 | — | The page renders unchanged for seeded data after the guard | e2e | `pnpm exec vitest run tests/smoke.test.ts` | ✅ | ✅ green |
| 01-08-D3 | 08 | 8 | — | — | N/A | manual | — (planning-document hygiene) | ❌ | ⬜ manual-only |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Automated coverage: 30 of 36 coverage items. 6 manual-only.**

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. The one file this audit had to add:

- [x] `tests/dev-database-baseline.test.ts` — 4 tests closing GAP-1 (ENV-01) and GAP-3 (ENV-02)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Non-positive `base_servings` renders a finite ingredient quantity and calorie label rather than `Infinity`/`NaN` (01-08-D1, WR-03) | APP-01 | **Deferred to Phase 4, not skipped.** Reaching this behaviorally needs either a seed row this phase has no create path to insert (D-11 reserves that churn for Phase 4's REVIEW-REQUIRED analyzer material, tracked as `T-01-31`) or a React component-test harness this repository does not have and Phase 1 did not scope. The positive direction *is* covered by `tests/smoke.test.ts`. | Read `apps/recipe-app/src/components/RecipeScreen.tsx:47` and confirm the multiplier reads `recipe.baseServings > 0 ? servings / recipe.baseServings : 1`. When Phase 4 adds the `CHECK` constraint on `recipes.base_servings`, add the row-level negative case there. |
| Visual fidelity against the design source at phone/tablet/desktop (01-05-D3) | APP-01 | Pixel-level layout, spacing, hover states and desktop sidebar proportions cannot be asserted by grep or an HTTP-body match | Compare rendered `/recipes/chicken-rice-bowl` against `Recipe Page.dc.html` at each breakpoint. The divergence from the Modernist system (rounded corners, warmer palette) is intentional per D-06 and must be preserved, not "fixed". |
| Responsive breakpoints match developer intent (01-05-D4) | APP-01 | UI-SPEC Open Question 5 recorded phone <834px / tablet 834–1439px / desktop ≥1440px as a *proposed default awaiting confirmation*, not a locked decision — there is no correct value to assert against yet | Confirm the three breakpoints, or supply an override. |
| Dropped desktop app-shell nav is acceptable for this phase (01-05 key-decision) | APP-01 | A deliberate scope trade-off documented by the executor, not a defect — needs a human scope decision | Review the same back/save icon nav row at all three breakpoints against the desktop frame's app-shell top bar. D-07 excludes the sections that chrome points at. |
| A-07: the `recipe-header` partial/incomplete UI-SPEC row was never dispositioned | APP-01 | Explicitly flagged "planner must treat as an assumption" in `01-UI-SPEC.md`; no plan in this phase resolved or depended on it | Decide whether the header's incomplete state needs a follow-up fix or is acceptable as shipped. |
| Redeploy root-cause investigation verdict is honest (01-01-D1) | — | The entry's *shape* was checked mechanically; whether the verdict states a finding rather than a dressed-up guess is a judgment call no assertion can make | Read `docs/00-current-state.md` §7 and confirm the evidence tier matches the claim. |

*Note: the four UI/design items above are the same five human-verification items carried in
`01-VERIFICATION.md`'s `human_verification:` block. They are recorded here for completeness — this
audit did not resolve them and does not claim to.*

---

## Validation Audit 2026-09-08

| Metric | Count |
|--------|-------|
| Gaps found | 3 |
| Resolved | 2 |
| Escalated | 0 |
| Deferred to manual-only | 1 |

**Gaps found**

1. **GAP-1 (ENV-01) — RESOLVED.** No test asserted that the *running* server was PostgreSQL 17, nor
   that the declared empty extension baseline (D-13) still held. `tests/guardrails.test.ts` asserted
   only the *text* of `docker-compose.yml` (loopback port, no init-script mount) and never the image
   tag; nothing connected to the server to check its version. Changing `image: postgres:17` to
   another major, or an extension arriving via a migration, passed all 52 pre-audit tests silently.
   The phase record's evidence for this was ad-hoc one-off shell commands run during execution,
   never a committed test. ENV-01 was the only phase requirement with zero behavioral coverage.
2. **GAP-3 (ENV-02) — RESOLVED.** No test asserted the D-09/D-10/D-11 schema scope. `db-reset.test.ts`
   asserted the three-table list but never the column set, so adding a `notes` column to `recipes`
   would have passed everything.
3. **GAP-2 (APP-01) — DEFERRED to manual-only.** The servings-guard's negative direction is asserted
   at source level only. Closing it now would mean adding a React component-test harness
   (jsdom + testing-library) that Phase 1 did not scope, expanding the dependency surface for one
   assertion. Recorded in Manual-Only above with its existing Phase 4 route (`T-01-31`), consistent
   with how `01-08-SUMMARY.md` and `01-VERIFICATION.md` already treat it.

**Tests added:** `tests/dev-database-baseline.test.ts` (4 tests)

- live `server_version_num` → major 17, read from the server itself rather than the image string
- `pg_extension` minus `plpgsql` is exactly empty
- `docker-compose.yml`'s declared postgres major equals the live server's reported major, so the
  two cannot silently diverge
- `public.recipes`'s column set is exactly the nine baseline names, compared as a sorted set so a
  rename is caught as well as an addition

**Measured before/after:** Phase 01 subset went from 8 files / 52 tests to 9 files / 56 tests, all
passing, ~31s. Both runs were executed live during this audit, not inferred.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or a recorded manual-only reason
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 35s (measured: ~31s for the full phase subset)
- [ ] `nyquist_compliant: true` — **not set.** 30 of 36 coverage items are automated; 6 are
      manual-only. One of those (01-08-D1 / GAP-2) is a genuine automation gap deferred to Phase 4
      rather than an inherently-human check, so this phase is PARTIAL, not compliant.

**Approval:** approved 2026-09-08 (partial — automated coverage verified live; manual-only items
listed above remain outstanding)
