---
phase: 02-backup-restore-drill
audited: 2026-09-07
auditor: gsd-security-auditor
status: SECURED
asvs_level: 1
block_on: high
threats_total: 26
threats_closed: 23
threats_accepted: 3
threats_open: 0
register_authored_at_plan_time: true
mode: verify-declared-mitigations
---

# Phase 02 — Security Audit

**SECURED.** All 26 STRIDE threats registered across the five plans are closed: 23
mitigations verified present in the implementation, 3 accepted risks confirmed with their
rationale still holding. No threat at or above the `high` block threshold is open.

Registers were authored at plan time, so this pass verified that each declared mitigation
actually exists in the code — SUMMARY claims were not accepted as evidence. L2-depth
structural tracing was applied to the credential-disclosure, target-redirection,
false-success and human-fact-spoofing threats despite the ASVS L1 setting.

## Threat Verification

| ID | Category | Sev | Disp | Status | Evidence |
|---|---|---|---|---|---|
| T-02-01 | Info Disclosure | high | mitigate | CLOSED | `scripts/env.ts:223-247` rejects in-repo/relative destinations before any dump byte is written; `backup.ts:114-120` writes the globals dump by stdout redirection only; no `readFile` in `scripts/**` ever touches a globals path — only streamed `sha256File` and container copy |
| T-02-02 | Elevation of Privilege | high | mitigate | CLOSED | `restore.ts:28-31` `ContainerRestoreTarget` exposes 2 methods, no connection-string field; `drill.ts:223-229` builds the assertion client from discrete container accessors, never a URI; `tests/guardrails.test.ts:198-242` |
| T-02-03 | Repudiation | high | mitigate | CLOSED | `restore.ts:79-117` — `ON_ERROR_STOP=1`, no already-exists tolerance, both `exitCode` **and** `stderr` inspected before success |
| T-02-04 | Tampering | medium | mitigate | CLOSED | `backup-manifest.ts:118-156` zod `.parse()` on read and write; sha256 recorded and recompared. Residual WR-04 noted below |
| T-02-05 | Spoofing | medium | mitigate | CLOSED | `drill.ts:44,186-188` — `DRILL_BOOTSTRAP_USERNAME = "drilluser"` collides with no role in the globals dump |
| T-02-06 | Tampering | medium | mitigate | CLOSED | `backup-manifest.ts:26-28` `compactTimestamp`; `tests/backup-manifest.test.ts:144-157` asserts Windows-reserved characters absent |
| T-02-07 | Info Disclosure | low | accept | ACCEPTED | Single-user Windows dev machine; destination holds a dev-cluster verifier only. Rationale recorded in `02-01-PLAN.md` |
| T-02-08 | Repudiation | high | mitigate | CLOSED | `drill-assertions.ts:166-178, 198-204, 276-297, 366-372, 403-408` — every tier rejects its vacuous case explicitly |
| T-02-09 | Tampering | medium | mitigate | CLOSED | `ManifestSchema.parse()` extended over `contentHashes`/`spotChecks`/`sequences` |
| T-02-10 | Info Disclosure | medium | mitigate | CLOSED | `backup.ts:172-181` — named non-credential column projections only, never `SELECT *` |
| T-02-11 | Repudiation | medium | mitigate | CLOSED | `drill-assertions.ts:103-123` canonicalisation limited to `\restrict`/`\unrestrict`, comments, blank runs; `tests/drill-assertions.test.ts:137-153` proves a removed FK line still diffs |
| T-02-12 | Elevation of Privilege | high | mitigate | CLOSED (caveat) | Declared mitigation verified: no CLI args, mode chosen by file, `tests/guardrails.test.ts:198-242` covers all 4 commands, `tests/restore-cli.test.ts:47-92` proves refusal-before-write. **Caveat WR-03 below** |
| T-02-13 | Info Disclosure | high | mitigate | CLOSED (caveat) | `restore.ts:184-190`, `restore-cluster.ts:192-200` — `finally` removes the in-container copy on success and failure alike. **Caveat WR-05 below** |
| T-02-14 | Tampering | high | mitigate | CLOSED | `restore.ts:263-273`, `restore-cluster.ts:108-127` — both checksums verified against the manifest before any cluster write |
| T-02-15 | Repudiation | medium | mitigate | CLOSED | `restore-cluster.ts:147-212` — explicit `EXERCISED`/`NOT EXERCISED` verdict plus post-restore role re-query; exit code alone not trusted |
| T-02-16 | Denial of Service | low | accept | ACCEPTED | Intended effect of a restore on a disposable local dev DB, rebuildable via `pnpm db:reset`. Rationale in `02-03-PLAN.md` |
| T-02-17 | Repudiation | high | mitigate | CLOSED | **CR-01 fix confirmed** at `e1ce940` — `drill.ts:257-291`, container stop now in its own try/catch, decoupled from the status write; a stop failure can no longer suppress a FAIL record |
| T-02-18 | Spoofing | high | mitigate | CLOSED | `drill-status.ts:124-144` — `recordAutomatedDrillResult` has no parameter able to name or influence `human`; carries `existingHuman` through unchanged. Only one write path exists |
| T-02-19 | Tampering | medium | mitigate | CLOSED | `drill-status.ts:79-105,152-189` — zod parse on every read |
| T-02-20 | Info Disclosure | high | mitigate | CLOSED | Every `console.error` failure path in `backup.ts`/`restore.ts`/`restore-cluster.ts`/`drill.ts` routes through `safeErrorMessage`; `tests/drill/restore-drill.test.ts:55-57` asserts combined output carries neither a connection-string prefix nor a SCRAM-verifier prefix, live |
| T-02-21 | Denial of Service | low | accept | ACCEPTED | A red suite when the project goes quiet is the honest signal; warning-in-place-of-failure explicitly rejected (D-19). Gate confirmed wired and green: 81/81 |
| T-02-22 | Spoofing | high | mitigate | CLOSED | Same single-writer mechanism as T-02-18, plus the `gate="blocking-human"` checkpoint. `docs/restore-drill-status.json` `human` object confirmed hand-set, with no machine-timestamp shape |
| T-02-23 | Repudiation | high | mitigate | CLOSED | `docs/20-restore-runbook.md` carries a populated "What actually happened" section including the CASCADE finding and the verbatim `NOT EXERCISED` line — content consistent with a performed run, not a pre-written skeleton |
| T-02-24 | Info Disclosure | medium | mitigate | CLOSED | Runbook names the destination as `RECIPE_BACKUP_DESTINATION`, never a literal path; no credential-shaped string present |
| T-02-25 | Tampering | high | mitigate | CLOSED | `docs/decisions.md:94-106` D7 discharged and dated; `docs/00-current-state.md:131` R1 now "DRILLED AND TIMED" while honestly carrying forward the globals-not-exercised sub-risk rather than overclaiming |
| T-02-26 | Repudiation | medium | mitigate | CLOSED | Fixture-scale / production-RTO-UNKNOWN qualification sits above the procedure, not in a footnote |
| T-02-SC | Tampering | high | mitigate | CLOSED | `package.json:23` `@testcontainers/postgresql: "12.1.0"` exact pin (5 duplicate register entries collapse to this one control) |

## Unregistered Flags

None. No `## Threat Flags` section exists in any of the five SUMMARY files, so there is
nothing to reconcile. `.planning/WINDOWS.md`'s 3 open entries are pre-existing disclosed
deviations, not new attack surface.

## Residual Non-Blocking Findings

Carried from `02-REVIEW.md` and independently re-verified against source. None blocks the
phase; none leaves a declared threat open.

- **WR-03 / T-02-12** — `restoreIntoDevContainer` (`restore.ts:144-191`) accepts
  `options.username`/`options.database` with no internal assertion against
  `EXPECTED_DEV_DATABASE_ROLE`/`EXPECTED_DEV_DATABASE_NAME`. Both current call sites
  hardcode the pinned constants, so there is no live exploit, but the pin rests on
  call-site convention rather than the function's own contract. **This is in direct
  tension with the project's non-negotiable that a safeguard depending on someone
  choosing to behave is not a safeguard.** T-02-12's declared mitigation text does not
  itself promise the deeper structural property, so the threat is not marked OPEN — but
  this should be a prioritised follow-up, not silently accepted.
- **WR-04 / T-02-04** — manifest `rowCounts`/`contentHashes` keys are unvalidated strings
  interpolated into SQL identifiers (`drill-assertions.ts:206-213`, `restore.ts:221-230`).
  Bounded today by T-02-07's accepted filesystem-exposure risk; unbounded if that
  acceptance is ever revisited.
- **WR-05 / T-02-13** — in-container `rm -f` uses `{ reject: false }` and never inspects
  the result, so a failed removal is silent. The *attempt* is unconditional as declared;
  *verified* removal is not.
- **WR-06** — `tests/restore-cli.test.ts:44` uses `.toContain("8")` as a load-bearing
  survival check; weaker than a parsed-value comparison in a safety-critical test.
- **IN-01/02/03** — `docs/restore-drill-status.json` sits outside the guardrail
  credential-scan surface; `assertSpotCheckedValues`'s vacuous guard hardcodes
  `"public.recipes"`; a manifest fixture removes 4 fields while claiming to isolate 1.

## Method

Read-only static analysis plus `git show --stat e1ce940` and `pnpm test` (81/81). No
database command was run — `db:drill`, `db:restore`, `db:restore:cluster` and `db:backup`
all mutate the owner's development database.
