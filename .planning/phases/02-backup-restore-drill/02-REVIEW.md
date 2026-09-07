---
phase: 02-backup-restore-drill
reviewed: 2026-09-07T00:00:00Z
depth: standard
files_reviewed: 15
files_reviewed_list:
  - scripts/backup.ts
  - scripts/backup-manifest.ts
  - scripts/restore.ts
  - scripts/restore-cluster.ts
  - scripts/drill.ts
  - scripts/drill-assertions.ts
  - scripts/drill-status.ts
  - scripts/env.ts
  - tests/backup-manifest.test.ts
  - tests/drill-assertions.test.ts
  - tests/drill-status.test.ts
  - tests/guardrails.test.ts
  - tests/restore-cli.test.ts
  - tests/drill/restore-drill.test.ts
  - docs/restore-drill-status.json
findings:
  critical: 1
  warning: 8
  info: 3
  total: 12
status: issues_found
---

# Phase 2: Code Review Report

**Reviewed:** 2026-09-07
**Depth:** standard
**Files Reviewed:** 15
**Status:** issues_found

## Summary

This phase builds a real, live-verified backup/restore/drill pipeline with unusually strong
discipline around the project's stated safety properties: no CLI in this phase reads
`process.argv`/`stdin`, the globals dump is treated as an opaque blob everywhere I checked, and
`scripts/drill-assertions.ts`'s four tiers all reject their own vacuous (empty-vs-empty) case
correctly. The manifest and drill-status schemas both encode "no credential field" and "no
code path can set the human fact" as types rather than comments, and both claims are backed by
tests that actually exercise the failing direction.

That said, tracing the actual control flow in `scripts/drill.ts` surfaces one genuine violation
of the phase's own core promise (BKP-08: a failed drill is recorded as FAIL, never silently
dropped) — a `finally` block that can itself throw and skip the status write entirely, covered
below as CR-01. The remaining findings are real but lower-severity: a dead cleanup path in
`scripts/backup.ts`, an inconsistently-applied `import.meta.main` guard, unvalidated SQL
identifiers sourced from an on-disk manifest, a vacuous test assertion in a safety-critical
test file, and a few code-quality/DRY issues. None of the Warning-tier findings currently have
a live exploit path given today's call sites, but several are exactly the kind of "the current
caller happens to be safe" gap the review brief asked me to surface regardless.

## Critical Issues

### CR-01: A failed drill can go unrecorded if the disposable container fails to stop, silently leaving a stale (possibly PASS) status record in place

**File:** `scripts/drill.ts:199-269`
**Issue:** `runDrill()`'s core sequence is:

```ts
let drillError: unknown;
try {
  await runStep("restore globals and data dumps into the disposable container", ...);
  await runStep("assert restored content against the manifest", ...);
} catch (error) {
  drillError = error;                                   // caught, NOT rethrown
  console.error(...);
} finally {
  await runStep("stop the disposable container", () => container.stop());   // line 258
}

if (drillError) {                                        // line 261
  await recordAutomatedDrillResult({ outcome: "FAIL", ... });
  throw drillError;
}
```

The `catch` block fully handles the assertion/restore failure (it does not rethrow), so control
flow proceeds normally into `finally`. Per JS semantics, if the `finally` block itself throws —
here, if `container.stop()` rejects — that new exception replaces the outcome of the entire
`try/catch/finally` statement and propagates out of `runDrill()` immediately. The code after
the `try` statement (the `if (drillError) { recordAutomatedDrillResult(FAIL) }` block, and the
passing-path `recordAutomatedDrillResult(PASS)` below it) **never executes** in that case.
`main().catch()` at the bottom of the file then only logs the `container.stop()` error and
calls `process.exit(1)` — the process does exit non-zero, but `docs/restore-drill-status.json`
is left completely untouched.

This means: if an assertion genuinely fails (a real backup/restore defect) **and** the
Testcontainers `container.stop()` call also fails (plausible under the same conditions that
would cause a Docker daemon hiccup or resource exhaustion to also break the assertion run),
the committed status record is never updated to `FAIL`. Whatever it said before — very possibly
a `PASS` from the last successful run, since `db:drill` is run frequently — stays in place, is
still "fresh" by `assertDrillStatusFresh`'s 30-day window, and `pnpm test`'s staleness gate
(the mechanism BKP-08 depends on) reports green despite today's drill having genuinely failed.
This is precisely the "drill that could not fully report is read as a pass by every downstream
consumer" failure mode the phase's own threat register (T-02-17) and `must_haves` ("a drill
that ran and failed an assertion records a FAIL outcome... never silently dropped") exist to
close, and here it is not closed for this one code path.

**Fix:** Record the outcome before attempting to stop the container, or wrap the container-stop
step so its own failure cannot suppress a pending `drillError`:

```ts
let drillError: unknown;
try {
  await runStep("restore globals and data dumps...", ...);
  await runStep("assert restored content...", ...);
} catch (error) {
  drillError = error;
  console.error(...);
}

// Stop the container in its own try/catch so a stop failure can never suppress
// an already-captured drillError, or the write of it.
try {
  await runStep("stop the disposable container", () => container.stop());
} catch (stopError) {
  console.error(`[db:drill] Failed to stop the disposable container: ${safeErrorMessage(stopError)}`);
  // do not let a stop failure replace a real assertion failure
}

if (drillError) {
  await recordAutomatedDrillResult({ outcome: "FAIL", tiers: tierResults, durationMs });
  throw drillError;
}

await recordAutomatedDrillResult({ outcome: "PASS", tiers: tierResults, durationMs });
```

## Warnings

### WR-01: `scripts/backup.ts`'s outer `finally { client.end() }` is dead code on every failure path

**File:** `scripts/backup.ts:36-47, 244-246`
**Issue:** `runBackup()` holds a single `pg` `Client` open across multiple `runStep` calls and
closes it in an outer `finally`:

```ts
const client = new Client({ connectionString: targetUrl });
try {
  await runStep("assert development database", ...);
  await runStep("assert recipe-core tables present", ...);
  ...
} finally {
  await client.end();          // line 245
}
```

But `runStep` in this file (unlike `drill.ts`'s variant) calls `process.exit(1)` **directly**
inside its own `catch` block on any failure:

```ts
async function runStep<T>(name, action) {
  try { result = await action(); }
  catch (error) {
    console.error(...);
    process.exit(1);           // terminates the process immediately
  }
  ...
}
```

`process.exit()` terminates the Node process before any pending caller `finally` block can run
— it does not unwind the call stack. So if any step inside `runBackup()` throws, the outer
`finally { await client.end(); }` never executes; the connection is torn down by the OS when
the process dies, not gracefully. This contradicts 02-01-SUMMARY.md's own claim that this
`runStep` variant "has no cleanup to run" — it does (the finally block exists specifically to
run it), the cleanup is just unreachable. Not a data-safety bug (the OS closes the socket
regardless), but it is dead code that misrepresents the actual cleanup guarantee and should
either be removed (if genuinely unneeded) or made reachable (e.g. by having `runStep` here also
log-and-rethrow like `drill.ts`'s variant, letting the top-level `main().catch()` do the
`process.exit(1)`).
**Fix:** Either delete the misleading `finally` block and comment, or change this file's
`runStep` to log-and-rethrow (matching `drill.ts`'s pattern) so the outer `finally` is
reachable.

### WR-02: `scripts/restore-cluster.ts` has no `import.meta.main` guard around its entry point

**File:** `scripts/restore-cluster.ts:247-250`
**Issue:** `scripts/backup.ts`, `scripts/restore.ts`, and `scripts/drill.ts` all guard their
`main().catch(...)` call with `if (import.meta.main) { ... }` specifically because each is
imported by a sibling script and the guard is what prevents import from also triggering a live
run (documented explicitly in 02-03-SUMMARY.md as "this workspace's general rule for any
script/library-in-one-file module"). `scripts/restore-cluster.ts` ends with an unguarded call:

```ts
main().catch((error: unknown) => {
  console.error(safeErrorMessage(error));
  process.exit(1);
});
```

Nothing currently imports `scripts/restore-cluster.ts` (it exports no symbols), so there is no
active exploit today. But it is inconsistent with the pattern this same phase established
elsewhere for exactly this reason, and it is a latent hazard: if a later phase (e.g. Phase 7's
status view, which is explicitly named as a future consumer of this phase's modules) ever needs
to import a constant or helper from this file, merely importing it would trigger a live
`db:restore:cluster` run against the pinned development container.
**Fix:** Wrap the entry point the same way the other three CLI scripts do:
`if (import.meta.main) { main().catch(...); }`.

### WR-03: Shared restore functions don't enforce the pinned target internally — safety depends entirely on call-site discipline

**File:** `scripts/restore.ts:38-51, 63-118, 129-191`
**Issue:** `restoreIntoContainer(target, dumps, options)` and
`restoreIntoDevContainer(dumps, options)` both accept a `username`/`database` pair via
`options` and use them directly in the `psql`/`pg_restore` command lines with no internal
check against `EXPECTED_DEV_DATABASE_ROLE`/`EXPECTED_DEV_DATABASE_NAME`. Today both call sites
(`scripts/drill.ts`, `scripts/restore.ts`'s own `main()`, and `scripts/restore-cluster.ts`)
always pass the pinned constants, so there is no current exploit. But per D-06's own stated
threat model ("a target-taking restore tool is the tool that later gets pointed at staging"),
these are exactly the kind of function whose signature *could* carry a target a future caller
supplies differently — the enforcement is a call-site convention, not something the function
itself guarantees. `restoreIntoDevContainer` in particular always runs against the hardcoded
compose service `db` (so the *host* is structurally pinned), but the in-container
`database`/`username` it restores into is not asserted against the pinned constants inside the
function.
**Fix:** Have `restoreIntoDevContainer` (at minimum — it is the one that touches the real
pinned development container) assert `options.username === EXPECTED_DEV_DATABASE_ROLE` and
`options.database === EXPECTED_DEV_DATABASE_NAME` internally and throw if not, so the pin is
architectural rather than convention-dependent.

### WR-04: Manifest-derived table/schema names are interpolated into SQL identifiers with no format validation

**File:** `scripts/drill-assertions.ts:206-213` (`assertContentHashes`), `scripts/restore.ts:221-230` (`verifyRestoredRowCounts`), `scripts/backup-manifest.ts:107-110` (`ManifestSchema.rowCounts`/`contentHashes`)
**Issue:** `ManifestSchema` records `rowCounts`/`contentHashes` as `z.record(z.string(), ...)` —
any string is accepted as a table-name key, with no restriction to safe identifier characters.
Both `assertContentHashes` and `verifyRestoredRowCounts` split that key on `.` and interpolate
the two halves directly into double-quoted SQL identifiers:

```ts
`FROM "${tableSchema}"."${tableName}" t`                 // drill-assertions.ts:212
`SELECT count(*) AS count FROM "${schema}"."${table}"`   // restore.ts:230
```

The two *dump files*' SHA-256 are verified against the manifest before a restore proceeds, but
the manifest JSON itself is never integrity-checked (no signature, no hash-of-the-manifest) —
only schema-validated by zod, which accepts arbitrary key strings. If the manifest file at the
backup destination were ever tampered with (e.g. the destination directory's permissions were
loosened, or it were accidentally placed under a synced folder), a crafted key such as
`public.recipes"; DROP TABLE users; --` would be interpolated unescaped into a live query
during `db:drill`'s tier-4 assertions or `db:restore`'s row-count verification. The current
threat model (T-02-07) accepts filesystem exposure risk at ASVS L1 for this single-developer
Windows machine, so this is bounded rather than actively exploitable today, but it is a real
gap in the "manifest is validated on every read" claim — schema validation catches shape
problems, not content-based injection.
**Fix:** Restrict manifest keys to a safe identifier pattern in `ManifestSchema`
(e.g. `z.record(z.string().regex(/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/), ...)`), or use
`pg-format`/parameterized identifier quoting rather than trusting the key's literal characters.

### WR-05: In-container cleanup failures are fully swallowed with no logging

**File:** `scripts/restore.ts:184-190`, `scripts/restore-cluster.ts:192-200`
**Issue:** Both the data-dump cleanup (`restoreIntoDevContainer`'s `finally`) and the
globals-dump cleanup (`restore-cluster.ts`'s `finally`) run:

```ts
await execa("docker", ["compose", "exec", "-T", "db", "rm", "-f", PATH], { reject: false });
```

`{ reject: false }` means `execa` will not throw even if `rm` exits non-zero, and the result is
never inspected — not the exit code, not stderr. The review brief specifically calls out that
temp copies of the globals dump (a real SCRAM-SHA-256 verifier) must be "removed
unconditionally, including on the error path." The code does *attempt* removal
unconditionally, which is good, but it does not *verify* removal succeeded, and a failed
cleanup (permission issue, container in a bad state, disk full) would be completely silent —
no error, no warning, nothing in the drill/restore output — leaving the credential-bearing file
inside the (admittedly local, disposable) container with nobody aware of it.
**Fix:** Inspect the cleanup command's exit code and log a warning (not necessarily a hard
failure, since the restore itself may have already succeeded) when removal did not succeed:
`if (cleanupResult.exitCode !== 0) { console.error(...) }`.

### WR-06: Weak substring assertion in a safety-critical refusal test

**File:** `tests/restore-cli.test.ts:37-45` (specifically line 44)
**Issue:** `assertSeededStateIntact()` is the "load-bearing" check (per this file's own
comments) that proves a redirected `RECIPE_DEV_DATABASE_URL` never let `db:backup`/`db:restore`/
`db:restore:cluster` touch the real local database before refusing:

```ts
async function assertSeededStateIntact(): Promise<void> {
  const survivalCheck = await execa("pnpm", ["db:query", "SELECT count(*) AS ingredient_count FROM ingredients;"], { reject: false });
  expect(survivalCheck.exitCode).toBe(0);
  expect(survivalCheck.stdout).toContain("8");   // line 44
}
```

`.toContain("8")` is a substring match against the entire command's stdout, not a parsed
comparison of the actual count. It would pass just as happily if the real count had been
corrupted to `18`, `80`, `withdrew 8 rows`, or any other output that happens to contain the
character "8" anywhere (including in a table-formatting border or a timestamp in verbose
output). This is exactly the "test that passes vacuously" pattern the review brief asks to
flag — used three times, once per command under test, in the file whose entire purpose is
proving these commands cannot touch the real database.
**Fix:** Parse the actual count out of stdout (or have `db:query` support a raw/JSON output
mode) and assert `Number(parsedCount) === 8`, or at minimum anchor the match more precisely
(e.g. a regex requiring the value to be the sole digit sequence on its own line).

### WR-07: Duplicated manifest-resolution helper across two files

**File:** `scripts/restore.ts:199-210`, `scripts/restore-cluster.ts:50-59`
**Issue:** `resolveLatestManifestWithFilename` is defined nearly identically (same readdir,
filter-by-suffix, sort, `.at(-1)`, throw-if-missing, `readManifest` call) in both
`scripts/restore.ts` (private, unexported) and `scripts/restore-cluster.ts` (private,
unexported) rather than being defined once and imported by both. The 02-03-SUMMARY.md
rationalizes this as avoiding a signature change to `backup-manifest.ts`'s
`readLatestManifest` (which is outside that plan's `files_modified`), but nothing prevented
exporting the new helper from `restore.ts` and importing it into `restore-cluster.ts` the same
way `restoreIntoDevContainer`/`verifyRestoredRowCounts` already are. A future change to the
manifest-filename resolution logic (e.g. a different sort order) now has two call sites to
remember to update in lockstep.
**Fix:** Export `resolveLatestManifestWithFilename` from `scripts/restore.ts` and import it in
`scripts/restore-cluster.ts`, exactly as already done for `restoreIntoDevContainer`/
`verifyRestoredRowCounts`.

### WR-08: No collision protection against two backups taken within the same second

**File:** `scripts/backup.ts:58-66, 100-120`
**Issue:** All three backup artifacts are named from a single `compactTimestamp(new Date())`
call with one-second granularity (`YYYYMMDDTHHMMSSZ`). `execa`'s `{ stdout: { file: path } }`
option opens the destination file for writing (truncating any existing content) with no
existence check beforehand. Two `pnpm db:backup` invocations within the same wall-clock second
— plausible in automated contexts (e.g. a script or test harness that calls `db:backup` twice
in quick succession, or a human re-running the command immediately after a failure) — would
silently overwrite the earlier run's `.dump`/`-globals.sql`/`-manifest.json` files with no
warning that a previous backup was just destroyed. Backups are meant to accumulate as an
append-only history per this phase's own retention note ("nothing prunes them automatically");
a silent same-second overwrite is a small but real violation of that intent.
**Fix:** Check for an existing file at the target path before writing and either fail loudly or
append a disambiguating suffix, or use a monotonic/higher-resolution component in
`compactTimestamp`.

## Info

### IN-01: The credential-leak guardrail scan excludes the entire `docs/` directory, including a code-generated JSON file

**File:** `tests/guardrails.test.ts:46-62`
**Issue:** `sourceSurfaceFiles()` deliberately excludes `docs/` and `.planning/` as "prose about
constraints." That rationale is accurate for the markdown files, but `docs/restore-drill-status.json`
is not prose — it is committed, machine-generated output written by
`scripts/drill-status.ts`'s `recordAutomatedDrillResult`. This review manually confirmed the
current file contains no credential-shaped string, and the schema itself is structurally
credential-free, so there is no current leak. But the automated guardrail suite that scans for
exactly this class of regression does not cover this file at all, so a future code change that
somehow wrote a credential-shaped value into it would not be caught by
`tests/guardrails.test.ts`'s "only .env.example and enumerated fixtures may contain a
connection-string prefix" assertion.
**Fix:** Either carve out a narrow exception that still scans `docs/restore-drill-status.json`
(and any future generated `docs/*.json`) for the connection-string/SCRAM-verifier needles, or
rely solely on `scripts/drill-status.ts`'s own unit tests to hold that line (as they currently
do, less exhaustively — see WR-04's sibling schema note).

### IN-02: Vacuous-check guard in `assertSpotCheckedValues` keys off hardcoded schema-qualified names

**File:** `scripts/drill-assertions.ts:277, 284, 291`
**Issue:** The vacuous-pass guard reads `rowCounts["public.recipes"]`, `rowCounts["public.ingredients"]`,
and `rowCounts["public.steps"]` literally. If the recipe-core tables were ever moved to a
non-`public` schema, these lookups would silently return `undefined ?? 0 = 0`, and the vacuous
guard (which exists specifically to catch "the manifest recorded zero spot-checks despite
rowCounts reporting rows") would stop firing — even though the underlying SELECT queries
(`FROM recipes`, unqualified) would still work correctly via `search_path`. Low likelihood given
the current single-schema application, but worth noting since this guard's entire job is to
catch exactly this kind of silent-no-op scenario.
**Fix:** Derive the three keys from the same constant used to build the qualified name
elsewhere, or from `RECIPE_CORE_TABLES` composed with a schema constant, rather than as string
literals in three places.

### IN-03: Test fixture removes four required fields but is framed as testing one

**File:** `tests/backup-manifest.test.ts:83-110`
**Issue:** The test "rejects a manifest file missing a required field" builds `withoutDataDump`
by omitting `dataDump` — but the object literal also omits `contentHashes`, `spotChecks`, and
`sequences` (all required fields added in plan 02-02), so the test actually proves rejection
against a manifest missing four fields, not the single field its name and action-comment imply.
The assertion itself (message is non-empty, names the path, contains neither credential needle)
still holds and the test is not wrong, just less precise proof than it appears to be.
**Fix:** Build the fixture from `buildRealisticManifest()` and delete exactly one field via
destructuring/omission, so the test provably isolates the single-missing-field case it claims
to cover.

---

_Reviewed: 2026-09-07_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
