---
phase: "01"
slug: "local-environment"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (high)
threats_open: 0
asvs_level: 1
block_on: high
register_authored_at_plan_time: true
created: "2026-09-07"
---

# Phase 01 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

Register reconstructed from the `<threat_model>` blocks in all eight `01-0N-PLAN.md` files.
Every threat was authored at plan time — this is a verification pass, not a retroactive STRIDE
build. Verified by `gsd-security-auditor` at ASVS L1, with L2-depth boundary tracing applied to
the four load-bearing threats (T-01-03, T-01-20/01-06, T-01-22/01-06, T-01-18).

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| npm registry to developer workstation | Third-party package code executes at install time on the machine holding the dev database | Executable package code |
| host network interfaces to dev PostgreSQL container | Anything reaching the published port gets the dev role's full privileges (D-17: one role) | Full database access |
| working tree to git remote | Anything written to a tracked file leaves the machine permanently | Source, and potentially credentials |
| container init path to database schema | Any mechanism writing schema outside the migration path is an ungated route in | Schema DDL |
| process environment / `.env` to connection-target selection | Decides which database every tool in the workspace reaches | Connection string (carries a credential) |
| Drizzle Kit config to destructive migrate/generate | `drizzle-kit migrate` applies the whole committed history to whatever target the config yields | Schema DDL |
| developer or agent shell to local dev database | `db:query` executes caller-supplied SQL | Arbitrary SQL |
| script error output to terminal and any CI log | A rejection message is a new output path for a credential-bearing string | Error text |

---

## Threat Register

37 entries (35 distinct threats; `T-01-20`..`T-01-23` appear twice under different plans — see
Register Hygiene finding 1 — and `T-01-SC` is cited by 01-01 and re-cited by 01-06/01-08).

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-01-01 (01-01) | Tampering | `pnpm add` | high | mitigate | Lockfile tracked; blocking-human checkpoint exercised (`01-01-SUMMARY.md:120,131`) | closed |
| T-01-02 (01-01) | Information Disclosure | `.env`, `.env.example` | high | mitigate | `.gitignore:2-4`; `.env` untracked; `.env.example:13,16` placeholders only | closed |
| T-01-03 (01-01) | Elevation of Privilege | published PG port | medium | mitigate | `docker-compose.yml:22` loopback pin; `tests/guardrails.test.ts:65-75` | closed |
| T-01-04 (01-01) | Tampering | container init-script path | medium | mitigate | No `docker-entrypoint-initdb.d` mount; `guardrails.test.ts:77-87`; live `pg_extension` count 0 | closed |
| T-01-05 (01-01) | Repudiation | `docs/00-current-state.md` s7 | low | accept | Single-operator doc record; honesty handled as prohibition | closed |
| T-01-SC (01-01) | Tampering | npm/pnpm installs | high | mitigate | Package-legitimacy gate cleared; 01-06/01-08 install nothing new | closed |
| T-01-06 (01-02) | Tampering | `scripts/env.ts` | high | mitigate | `env.ts:42-47` bare-`DATABASE_URL` hard-fail; `env.test.ts:40-77` | closed |
| T-01-07 (01-02) | Spoofing | environment identity | high | mitigate | `env.ts:184-195` keys off `SELECT current_database()`, a connection property | closed |
| T-01-08 (01-02) | Tampering | `slug` route segment | medium | mitigate | `[slug]/page.tsx:19-20` Drizzle-parameterized; no string-built SQL | closed |
| T-01-09 (01-02) | Information Disclosure | thrown messages / Next output | high | mitigate | `error.tsx` fixed copy only; `smoke.test.ts:34-43` real build+start | closed |
| T-01-10 (01-02) | Denial of Service | unbounded query | low | accept | Scoped to Phase 4 RUN-03 | closed |
| T-01-11 (01-03) | Tampering | schema application path | high | mitigate | No `drizzle-kit push` anywhere; `guardrails.test.ts:89-102` | closed |
| T-01-12 (01-03) | Tampering | hand-edited migration SQL | medium | mitigate | `git log` shows one commit per migration file; no post-generation edit | closed |
| T-01-13 (01-03) | DoS / data loss | seed delete-then-insert | high | mitigate | `seed.ts:19` asserts dev DB before `db.delete(recipes)` at line 25 | closed |
| T-01-14 (01-03) | Spoofing | green build certifying schema | high | mitigate | Live `information_schema` read; journal entries present | closed |
| T-01-15 (01-04) | Elevation of Privilege | `scripts/db-query.ts` | high | mitigate | Arg shape enforced (`:18-19`); no `process.env` token; assert precedes SQL (`:31-32`) | closed |
| T-01-16 (01-04) | Tampering | raw SQL passthrough | medium | accept | No network-facing entry point into `db:query` | closed |
| T-01-17 (01-04) | DoS / data loss | `scripts/db-reset.ts` | high | mitigate | Takes no target arg; assert (`:68-78`) precedes migrate and seed | closed |
| T-01-18 (01-04) | Information Disclosure | script stdout / error paths | high | mitigate | `scripts/log.ts` `safeErrorMessage` reads `.message` only; `log.test.ts` proves no leak. Residual IN-02 below | closed |
| T-01-19 (01-04) | Repudiation | structural constraints | medium | mitigate | `tests/guardrails.test.ts` converts each constraint to a failing check | closed |
| T-01-20 (01-05) | Tampering | `slug` segment to query | medium | mitigate | Same route/evidence as T-01-08 | closed |
| T-01-21 (01-05) | Information Disclosure | `error.tsx` output | high | mitigate | `error.tsx:9-22` fixed copy + retry only; no `error.message`/`.stack` | closed |
| T-01-22 (01-05) | Tampering | seeded row text rendered | low | accept | No `dangerouslySetInnerHTML` under `src` (grep, zero matches); JSX auto-escapes | closed |
| T-01-23 (01-05) | Information Disclosure | design tree reachability | low | mitigate | `design/` only in a comment (`seed.ts:8`), never imported; excluded at `guardrails.test.ts:55` | closed |
| T-01-20 (01-06) | Elevation of Privilege | `scripts/env.ts` target pin | high | mitigate | `env.ts:84-130` validates via `pg-connection-string` `parse()`; rejects `hostaddr`/`service`; `getDevDatabaseUrl()` re-asserts per call (`:165-172`). CR-01 live-reproduced and refused | closed |
| T-01-21 (01-06) | Tampering | `drizzle.config.ts` | high | mitigate | `drizzle.config.ts:11-12` calls `assertLocalDevelopmentTarget` before `defineConfig` | closed |
| T-01-22 (01-06) | Information Disclosure | rejection path | high | mitigate | Every throw is a static string naming only the constraint (`:89-129`); asserted by `env.test.ts` + `target-pin.test.ts` | closed |
| T-01-23 (01-06) | Repudiation | guardrail coverage of new files | medium | mitigate | `guardrails.test.ts:26-38` two named allowlists replace the blanket `*.test.ts` exemption | closed |
| T-01-24 (01-06) | Spoofing | loopback name resolution | low | accept | Hosts file is inside the workstation trust boundary; literals not resolved | closed |
| T-01-25 (01-06) | Denial of Service | over-strict pin | low | accept | Named, co-located constants; corrective diff is two visible lines | closed |
| T-01-26 (01-07) | Tampering / data loss | migration-state verification | high | mitigate | `verify-migration-state.ts` re-queries journal + `information_schema`; wired at `db-reset.ts:91-93`, fails loudly | closed |
| T-01-27 (01-07) | Repudiation | state assertion credibility | medium | mitigate | `verify-migration-state.test.ts:17-50` drives it green AND red | closed |
| T-01-28 (01-07) | Information Disclosure | duplicated error formatting | medium | mitigate | Single tested `safeErrorMessage` in `scripts/log.ts`; no inline duplicates remain | closed |
| T-01-29 (01-07) | Elevation of Privilege | rebuild connection path | high | mitigate | Both `verify-migration-state.ts:35` and `db-reset.ts:71` go through `getDevDatabaseUrl()` | closed |
| T-01-30 (01-08) | DoS (rendering) | servings multiplier | low | mitigate | `RecipeScreen.tsx:47` divide-by-zero guard | closed |
| T-01-31 (01-08) | Tampering (DB tier) | `recipes.base_servings` | low | transfer | Deferred to Phase 4 with reason (`01-08-PLAN.md:227,267-274`); app-side guard T-01-30 compensates meanwhile | closed |
| T-01-32 (01-08) | Repudiation | `REQUIREMENTS.md` status | medium | mitigate | `REQUIREMENTS.md:124-125` both Phase 1 rows carry identical status | closed |

*Status: open / closed / open — below high threshold (non-blocking)*
*Only open threats at or above `high` count toward `threats_open`.*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-01 | T-01-05 (01-01) | Single-operator documentation record has no adversary; honesty handled as a prohibition, not a security control | Ren | 2026-09-07 |
| AR-02 | T-01-10 (01-02) | Unbounded query is scoped to Phase 4 RUN-03; no unbounded path ships in Phase 1 | Ren | 2026-09-07 |
| AR-03 | T-01-16 (01-04) | Raw SQL passthrough in `db:query` has no network-facing entry point; it is a local developer tool | Ren | 2026-09-07 |
| AR-04 | T-01-22 (01-05) | Seeded row text is rendered as auto-escaped JSX; no `dangerouslySetInnerHTML` exists in the source surface | Ren | 2026-09-07 |
| AR-05 | T-01-24 (01-06) | `localhost` resolution is governed by the machine's own hosts file, already inside the workstation trust boundary | Ren | 2026-09-07 |
| AR-06 | T-01-25 (01-06) | An over-strict target pin locking out the developer is the intended cost of D-16; corrective diff is two visible lines | Ren | 2026-09-07 |
| AR-07 | T-01-31 (01-08) | DB-tier `CHECK` on `base_servings` transferred to Phase 4 — it is a lock-taking `ALTER TABLE`, which is Phase 4's REVIEW REQUIRED exercise material | Ren | 2026-09-07 |

---

## Residual, Non-Blocking

**IN-02 — guardrail backstop regex is scheme-incomplete.** `tests/guardrails.test.ts:44` matches
`postgres://` but not `postgresql://`. This is the *backstop*, not the primary control: the
code-level mitigation for T-01-18 (`safeErrorMessage` in `scripts/log.ts`) is intact and
independently verified, and `tests/log.test.ts` proves it does not leak a carried connection
string. Already logged as Info in `01-REVIEW.md` and `01-VERIFICATION.md`. Non-blocking; worth
closing when the file is next touched.

---

## Register Hygiene

1. **ID collision (confirmed).** `T-01-20`..`T-01-23` are reused for entirely different threats
   in `01-05-PLAN.md` (route / `error.tsx` / seeded text / design tree) versus `01-06-PLAN.md`
   (env.ts validation / drizzle.config.ts / rejection path / guardrail coverage). Both sets are
   verified above and disambiguated by source plan. Future plans should allocate ids from a
   phase-wide sequence rather than restarting per plan.

2. **Review-report ID reuse (new finding).** `01-REVIEW.md` at commit `8118ae3` defines
   `WR-01`/`WR-02`/`WR-03`/`IN-01`/`IN-02` and one critical (`CR-01`) — but plans 01-06/01-07/01-08
   and `01-VERIFICATION.md`'s `gaps_closed` list cite `WR-01`, `WR-02`, `CR-02` and `IN-01` with
   *different descriptions* than the file now contains (for example `01-VERIFICATION.md` describes
   "WR-02 ... TOCTOU-shaped gap", which appears nowhere in the current file). An earlier review
   report was overwritten at the same filename under the same ID scheme, orphaning those
   descriptions from their citing sources. This did not affect the audit — every citing plan's
   code claims were verified directly against source, not trusted from either document — but it
   degrades the audit trail. Archive prior review reports under distinct filenames/IDs.

3. **No `## Threat Flags` section** exists in any of the 8 SUMMARY files, so there was nothing to
   reconcile through that mechanism. Each plan's "Deviations from Plan" section was read instead;
   all deviations are build/tooling fixes (zod hoisting, ESM/CJS `next.config.ts` conflict,
   Windows process-tree kill, `pg` hoisting, a comment-wording fix) introducing no new attack
   surface.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-09-07 | 37 | 37 | 0 | gsd-security-auditor (ASVS L1, L2 tracing on 4 load-bearing threats) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
