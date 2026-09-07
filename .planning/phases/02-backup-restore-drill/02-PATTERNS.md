# Phase 2: Backup & Restore Drill - Pattern Map

**Mapped:** 2026-09-07
**Files analyzed:** 12 (7 new source modules, 3 new test files, 1 doc, 1 modified config)
**Analogs found:** 12 / 12 (all files have a strong same-repo analog; this phase extends an
established convention set rather than introducing a new one)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `scripts/backup.ts` | utility (CLI entry, multi-step orchestrator) | file-I/O (dump to disk) + request-response (queries) | `scripts/db-reset.ts` | exact (same `runStep`, same `main().catch()` shape, same env-guard reuse) |
| `scripts/backup-manifest.ts` | utility (shared read/write/validate module) | file-I/O + transform | `scripts/verify-migration-state.ts` | exact (standalone module, zod-adjacent validation, no module-load side effects) |
| `scripts/restore.ts` | utility (CLI entry + exported internal function) | file-I/O (restore from disk) + event-driven (drill calls internal fn) | `scripts/db-reset.ts` (CLI shape) + `scripts/verify-migration-state.ts` (exported pure function split from CLI) | role-match (no restore precedent exists; composite of the two closest patterns) |
| `scripts/drill-status.ts` | utility (shared read/write/validate module) | file-I/O + transform | `scripts/verify-migration-state.ts` | exact (same "validate a committed file's shape before trusting it" role) |
| `scripts/drill.ts` | utility (CLI entry, Testcontainers lifecycle orchestrator) | event-driven (container lifecycle) + request-response (assertions) | `scripts/db-reset.ts` | role-match (multi-step `runStep` orchestration; data flow differs — container lifecycle vs. compose lifecycle) |
| `tests/backup-manifest.test.ts` | test | transform / round-trip | `tests/verify-migration-state.test.ts` | exact (pure-function round-trip + negative-case test of a validated file shape) |
| `tests/drill-status.test.ts` | test | transform / round-trip | `tests/verify-migration-state.test.ts` | exact (same shape: positive case + deliberately-broken negative case, asserts on thrown message content) |
| `tests/restore-drill.test.ts` | test | integration / event-driven | `tests/db-reset.test.ts` | exact (real child-process or real-container integration test, asserts on live re-queried state, not exit code alone; long timeout) |
| `package.json` (modify) | config | — | `package.json` (existing `db:*` script block) | exact (add `db:backup`, `db:restore`, `db:drill` scripts following existing naming/`tsx` invocation convention) |
| `docker-compose.yml` | config | — | n/a — **not modified** (D-12 keeps the drill on `postgres:17` via Testcontainers; no compose change needed) | n/a |
| `docs/20-restore-runbook.md` | doc | — | `docs/00-current-state.md` / `docs/decisions.md` (numbering + UNKNOWN convention) | role-match (doc, not code — see Shared Patterns) |
| `.env` / `scripts/env.ts` (extend, per Open Question #2) | config / utility | — | `scripts/env.ts` itself (`RECIPE_DEV_DATABASE_URL` pattern) | exact (add `RECIPE_BACKUP_DESTINATION` following the identical hard-fail-on-missing pattern) |

## Pattern Assignments

### `scripts/backup.ts` (utility, file-I/O + request-response)

**Analog:** `scripts/db-reset.ts` (full file above)

**Imports pattern** (db-reset.ts lines 7-11):
```typescript
import { execa } from "execa";
import { Client } from "pg";
import { assertDevelopmentDatabase, getDevDatabaseUrl } from "./env";
import { safeErrorMessage } from "./log";
import { assertMigrationHistoryApplied } from "./verify-migration-state";
```
`backup.ts` follows the same shape: `execa` for the `docker compose exec -T db pg_dump/pg_dumpall`
calls, `pg`'s `Client` for the row-count/migration-count queries that feed the manifest, `./env`
for `assertLocalDevelopmentTarget`/`getDevDatabaseUrl` (D-06), `./log` for `safeErrorMessage`, and
a new `./backup-manifest` import for the manifest writer/schema.

**`runStep` pattern to reuse verbatim** (db-reset.ts lines 33-44):
```typescript
async function runStep(name: string, action: () => Promise<void>): Promise<void> {
  console.log(`[db:reset] ${name}...`);
  try {
    await action();
  } catch (error) {
    console.error(`[db:reset] FAILED at step "${name}": ${safeErrorMessage(error)}`);
    process.exit(1);
  }
  console.log(`[db:reset] ${name} done.`);
}
```
Copy this shape with the `[db:backup]` prefix. Steps: `pg_dump -Fc` → `pg_dumpall --globals-only`
→ compute checksums/row-counts/migration-count/git-commit → write manifest. Each step fails
loudly and does not continue (matches D-19/D-20's "never a silent partial" line).

**`execa` stdout-to-file pattern** (from RESEARCH.md Pattern 1, live-verified):
```typescript
await execa(
  "docker",
  ["compose", "exec", "-T", "db", "pg_dump", "-U", "recipe_app", "-d", "recipe_dev", "-Fc"],
  { stdout: { file: dataDumpPath } },
);
```
Use this exact call shape (not a shell pipe — see RESEARCH.md's anti-pattern on piping `pg_dump`
into `pg_restore`, which does not apply here directly but confirms `-Fc` must always land on a
real seekable file).

**Environment guard pattern** (`db-reset.ts` lines 68-78, `env.ts` `assertLocalDevelopmentTarget`):
```typescript
await runStep("assert development database", async () => {
  const client = new Client({ connectionString: getDevDatabaseUrl() });
  try {
    await client.connect();
    await assertDevelopmentDatabase(client);
  } finally {
    await client.end();
  }
});
```
`db:backup` must call `getDevDatabaseUrl()` (which internally re-asserts
`assertLocalDevelopmentTarget`) before any dump command runs — this is the D-06 guard, reused
unchanged, not reimplemented.

**Error-handling / entry-point pattern** (db-reset.ts lines 103-107):
```typescript
main().catch((error: unknown) => {
  console.error(safeErrorMessage(error));
  process.exit(1);
});
```
Copy verbatim as `backup.ts`'s own top-level catch.

**Filename sanitization — new, not in any existing file, but load-bearing (RESEARCH.md Pitfall 3):**
Do not use `new Date().toISOString()` directly in any filename. Use a compact format with no
colons, e.g. `20260907T193650Z`, for the dump/globals/manifest filenames alike.

---

### `scripts/backup-manifest.ts` (utility, file-I/O + transform)

**Analog:** `scripts/verify-migration-state.ts` (full file above)

**Standalone-module-with-no-side-effects pattern** (verify-migration-state.ts lines 1-19):
```typescript
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { assertDevelopmentDatabase, getDevDatabaseUrl } from "./env";

export const DEFAULT_JOURNAL_PATH = "apps/recipe-app/drizzle/meta/_journal.json";
```
`backup-manifest.ts` should be import-safe the same way: no module-load side effects, so a test
can import its `writeManifest`/`readManifest`/`ManifestSchema` without triggering a real
database connection — mirrors the doc comment at the top of `verify-migration-state.ts`
("A separate module rather than a block inline... so importing it from a test would run a real
teardown" — same reasoning applies here in reverse for a destructive backup run).

**Generic, schema-agnostic row-count query** (RESEARCH.md Pattern 3, directly reusing the query
shape already proven in `verify-migration-state.ts` lines 53-58):
```typescript
const tablesResult = await client.query(
  "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
);
for (const { table_name } of tablesResult.rows) {
  const { rows } = await client.query(`SELECT count(*) AS count FROM "${table_name}"`);
}
```
Do not hardcode `recipes`/`ingredients`/`steps` — this is the same discretion `verify-migration-
state.ts` exercises by enumerating `information_schema.tables` rather than a fixed list (D-05's
"keeps working when the seed changes").

**Migration-count reuse** (verify-migration-state.ts lines 41-44):
```typescript
const migrationsResult = await client.query(
  "SELECT count(*) AS count FROM drizzle.__drizzle_migrations",
);
const appliedCount = Number((migrationsResult.rows[0] as { count: string }).count);
```
The manifest's `appliedMigrationCount` field is exactly this query, reused unchanged.

**Zod validation pattern** (`env.ts` lines 132-141, `EnvSchema`):
```typescript
const EnvSchema = z.object({
  RECIPE_DEV_DATABASE_URL: z.url().refine((value) => {
    assertLocalDevelopmentTarget(value);
    return true;
  }),
});
```
`backup-manifest.ts` should define a `ManifestSchema = z.object({...})` in the same style and
`.parse()` it both on write (defensive) and on every read (per RESEARCH.md's V5/Tampering
guidance — "a malformed rule file fails loudly" applies identically to a malformed manifest).

---

### `scripts/restore.ts` (utility, file-I/O + event-driven)

**No direct analog exists** (no restore precedent in this codebase) — composite of two patterns:

**CLI-entry shape from `db-reset.ts`** (lines 46-107, `main()` + `runStep` + top-level `.catch`)
for the human-invoked `db:restore` path — reuse `runStep` and the final `main().catch(...)`
block verbatim.

**Exported-pure-function-split-from-CLI shape from `verify-migration-state.ts`** (the whole
file's structure: `assertMigrationHistoryApplied` is exported and independently callable,
never triggered by import alone) — `restore.ts` must export a `restoreInto(connection,
dumpPaths)` function with the identical property: importable and callable by `drill.ts` without
running the CLI's dev-target guard, because D-06 requires the drill's restore path to accept
**only** a connection object the Testcontainers harness built, never a string. Concretely:

```typescript
// db:restore CLI path — dev-target-only, reuses D-06's guard exactly as db-reset.ts does:
async function main(): Promise<void> {
  const url = getDevDatabaseUrl(); // re-asserts assertLocalDevelopmentTarget internally
  // ... runStep("assert development database", ...) using assertDevelopmentDatabase ...
  await restoreInto({ connectionString: url }, { dataDumpPath, globalsDumpPath });
}

// Exported internal function — the ONLY thing drill.ts may import from this module.
// Takes a connection object, never a string a human/agent can type (D-06).
export async function restoreInto(
  connection: { connectionString: string },
  dumpPaths: { dataDumpPath: string; globalsDumpPath?: string },
): Promise<void> {
  // pg_restore --clean --if-exists --no-owner --jobs N ...
}
```

**`pg_restore` flag pairing — non-negotiable, from RESEARCH.md Pitfall 5:**
```
pg_restore --clean --if-exists --no-owner --jobs 2 -U recipe_app -d recipe_dev <dataDumpPath>
```
`--clean` must always be paired with `--if-exists` (never `--clean` alone) — an unpaired
`--clean` returns exit 1 for objects simply absent from the target, indistinguishable from a
real failure.

**Exit-code-plus-stderr inspection, never exit code alone** (RESEARCH.md Pattern 2, live-
verified):
```typescript
const restoreResult = await container.exec([
  "pg_restore", "--clean", "--if-exists", "--no-owner", "--jobs", "2",
  "-U", "drilluser", "-d", "recipe_dev", "/tmp/data.dump",
]);
if (restoreResult.exitCode !== 0) {
  throw new Error(`Data restore failed (exit ${restoreResult.exitCode}): ${restoreResult.stderr}`);
}
```
This is the same "re-query, never trust an exit code" discipline `verify-migration-state.ts`
was built around (see its own header comment on the observed Windows `drizzle-kit migrate`
false-positive) — applied here to `pg_restore`'s exit code instead of `drizzle-kit migrate`'s.

---

### `scripts/drill-status.ts` (utility, file-I/O + transform)

**Analog:** `scripts/verify-migration-state.ts` — identical role: a small module that defines a
committed file's expected shape, validates it, and is imported by both a production script and a
test. Same zod-validation approach as `backup-manifest.ts` above. Two independent facts (D-18)
means two nested schemas:
```typescript
const StatusSchema = z.object({
  automated: z.object({
    lastRunAt: z.string().nullable(),
    outcome: z.enum(["PASS", "FAIL"]).nullable(),
    tiers: z.object({
      artifactIntegrity: z.boolean(),
      rowCounts: z.boolean(),
      schemaEquality: z.boolean(),
      contentAndReferentialIntegrity: z.boolean(),
    }),
    durationMs: z.record(z.string(), z.number()),
  }),
  human: z.object({
    lastPerformedAt: z.string().nullable(),
    outcome: z.enum(["PASS", "FAIL", "UNKNOWN"]),
    timings: z.record(z.string(), z.number()).nullable(),
    runbookRef: z.string(),
  }),
});
```
Per D-18/D7: no code path may ever set `human.outcome` to anything but `"UNKNOWN"` — only a
human editing the committed file by hand (after performing the runbook) changes that fact.
`drill.ts` only ever writes the `automated` half.

---

### `scripts/drill.ts` (utility, event-driven container lifecycle)

**Analog:** `scripts/db-reset.ts` for the `runStep`/orchestration shape; RESEARCH.md's live-
verified Pattern 2 for the actual Testcontainers calls (no in-repo analog for container
lifecycle exists yet — this is genuinely new machinery, but the surrounding orchestration
convention is not).

**Full live-verified round trip to copy from** (RESEARCH.md Code Examples section, reproduced
here because it is the load-bearing sequence and the exact fix for Pitfall #2):
```typescript
import { PostgreSqlContainer } from "@testcontainers/postgresql";

// CRITICAL: bootstrap identity must NOT collide with any role name in the globals dump
// (recipe_app) — see Pitfall #2. Only the database name may match; the username must not.
const container = await new PostgreSqlContainer("postgres:17")
  .withDatabase("recipe_dev")
  .withUsername("drilluser")
  .withPassword(randomThrowawayPassword())
  .start();

await container.copyFilesToContainer([
  { source: dataDumpPath, target: "/tmp/data.dump" },
  { source: globalsDumpPath, target: "/tmp/globals.sql" },
]);

const globalsResult = await container.exec([
  "psql", "-v", "ON_ERROR_STOP=1", "-U", "drilluser", "-d", "postgres", "-f", "/tmp/globals.sql",
]);
if (globalsResult.exitCode !== 0) {
  throw new Error(`Globals restore failed (exit ${globalsResult.exitCode}): ${globalsResult.stderr}`);
}

// ... pg_restore call (see restore.ts's restoreInto pattern above) ...
// ... tier 1-4 assertions over container.getConnectionUri() ...

await container.stop();
```

**D-20 hard-fail-when-Docker-unavailable, no status write on failure to start:**
```typescript
try {
  container = await new PostgreSqlContainer("postgres:17").withDatabase("recipe_dev")
    .withUsername("drilluser").withPassword(randomThrowawayPassword()).start();
} catch (error) {
  console.error(`[db:drill] FAILED to start disposable container: ${safeErrorMessage(error)}`);
  process.exit(1); // writes NOTHING to drill-status.ts's file — D-20
}
```
This mirrors `db-reset.ts`'s `runStep` fail-fast-and-exit-nonzero shape, but with the additional
D-20 constraint that the status file must not be touched at all on this failure path (contrast
with `runStep`, which always logs but never itself writes a persisted record).

**Tier 3 schema-comparison canonicalization** (RESEARCH.md Pattern 3 / Pitfall 4, must be copied
verbatim — this is a live-verified, non-obvious necessity):
```typescript
function canonicalizeSchemaDump(sql: string): string {
  return sql.replace(/^\\(un)?restrict .+$/gm, "");
}
```

**Tier 4 sequence-state query** (RESEARCH.md Pattern 3, generic — do not hardcode a sequence
name):
```sql
SELECT schemaname, sequencename, last_value FROM pg_sequences;
```

---

### `tests/backup-manifest.test.ts` (test, transform/round-trip)

**Analog:** `tests/verify-migration-state.test.ts` (full file above)

**Positive + deliberately-broken-negative-case shape to copy:**
```typescript
describe("scripts/backup-manifest.ts — writeManifest/readManifest", () => {
  it("round-trips a manifest written from real backup data", async () => { /* ... */ });

  it("rejects a hand-corrupted manifest file, naming what's wrong", async () => {
    // write a malformed JSON file, assert readManifest(...) throws with a specific message
  });

  it("never contains a credential-shaped string", async () => {
    const manifest = /* ... */;
    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toContain("postgres://");
    expect(serialized).not.toContain("SCRAM-SHA-256");
  });
});
```
The `not.toContain("postgres://")` assertion is copied directly from `tests/db-reset.test.ts`
line 65/72 (`expect(firstOutput).not.toContain("postgres://")`) — same never-leak-a-connection-
string discipline, applied to the manifest's serialized JSON instead of a process's stdout.

---

### `tests/drill-status.test.ts` (test, transform/round-trip)

**Analog:** `tests/verify-migration-state.test.ts` — same two-case shape (positive: reads a real
committed status file; negative: a deliberately stale/missing/FAIL-outcome fixture must throw).
D-19's three hard-fail conditions map directly onto three `it(...)` blocks, each following the
existing pattern of writing a temp fixture file under `mkdtempSync(tmpdir())` and cleaning it up
in a `finally` (verify-migration-state.test.ts lines 33-49):
```typescript
const tempDir = mkdtempSync(join(tmpdir(), "drill-status-"));
const tempStatusPath = join(tempDir, "status.json");
writeFileSync(tempStatusPath, JSON.stringify({ /* 40-day-old lastRunAt */ }));
try {
  let message = "";
  await assertDrillStatusFresh(tempStatusPath).catch((error: unknown) => {
    message = error instanceof Error ? error.message : String(error);
  });
  expect(message).not.toBe("");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
```

---

### `tests/restore-drill.test.ts` (test, integration/event-driven)

**Analog:** `tests/db-reset.test.ts` (full file above)

**Real-process, re-query-not-trust-exit-code, long-timeout integration shape to copy:**
```typescript
describe("pnpm db:drill", () => {
  it(
    "backs up, restores into a fresh disposable container, and asserts content (BKP-02/03/04/07)",
    async () => {
      const run = await execa("pnpm", ["run", "db:drill"], { reject: false });
      expect(run.exitCode).toBe(0);
      const output = `${run.stdout}\n${run.stderr}`;
      expect(output).not.toContain("postgres://");
      expect(output).not.toContain("SCRAM-SHA-256");

      // re-query the committed status file rather than trusting the exit code alone —
      // same discipline as assertRebuiltState() in tests/db-reset.test.ts
    },
    180000, // matches db-reset.test.ts's 180000ms — container pulls/starts are not instant
  );
});
```
The 180-second timeout constant, the `{reject: false}` + manual `exitCode` assertion, and the
`not.toContain("postgres://")` output check are all copied directly from `tests/db-
reset.test.ts` lines 62-77.

---

## Shared Patterns

### Never trust an exit code — re-query the real state
**Source:** `scripts/verify-migration-state.ts` (whole file, see header comment lines 1-13)
**Apply to:** `restore.ts` (pg_restore exit code), `drill.ts` (every `container.exec()` call),
both new test files.
```typescript
if (restoreResult.exitCode !== 0) {
  throw new Error(`... failed (exit ${restoreResult.exitCode}): ${restoreResult.stderr}`);
}
```

### `runStep` — name the failing step, do not continue
**Source:** `scripts/db-reset.ts` lines 33-44
**Apply to:** `backup.ts`, `restore.ts`'s CLI path, `drill.ts`. Copy verbatim, changing only the
log prefix (`[db:backup]`, `[db:restore]`, `[db:drill]`).

### Never log or leak a credential
**Source:** `scripts/log.ts` (whole file) + `tests/db-reset.test.ts` line 65/72
**Apply to:** every new script's catch path (`safeErrorMessage`) and every new test's output
assertion (`not.toContain("postgres://")`, extended in this phase to also assert
`not.toContain("SCRAM-SHA-256")` per RESEARCH.md Pitfall 1 — the globals dump's own contents).
```typescript
export function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

### D-06 target-pinning — reuse, never reimplement
**Source:** `scripts/env.ts` lines 84-172 (`assertLocalDevelopmentTarget`, `getDevDatabaseUrl`,
`assertDevelopmentDatabase`)
**Apply to:** `backup.ts` and `restore.ts`'s CLI entry points only. `drill.ts` and `restore.ts`'s
exported `restoreInto` function must NOT call these — they operate on a Testcontainers-
constructed connection object instead, by design (D-06's asymmetry rule).

### Zod-validate every committed file before trusting it
**Source:** `scripts/env.ts` lines 132-161 (`EnvSchema`, parse-or-throw-a-fixed-message pattern)
**Apply to:** `backup-manifest.ts` and `drill-status.ts` alike — both the manifest and the
status file are machine-generated JSON that later code (including Phase 7) will trust; validate
on every read, not just on write.

### Filename sanitization (new convention this phase must establish)
**Source:** RESEARCH.md Pitfall 3 (live-verified, no existing in-repo precedent)
**Apply to:** every timestamp-derived filename in `backup.ts` (data dump, globals dump,
manifest) and `drill-status.ts`'s own status file if timestamped. Never use a raw
`Date.toISOString()`; strip colons or use a compact `YYYYMMDDTHHMMSSZ` format.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `scripts/drill.ts`'s Testcontainers lifecycle block | utility | event-driven | No prior container-lifecycle code exists in this repo (Phase 1 only ever used `docker compose`, never a programmatic container API) — built from RESEARCH.md's live-verified `@testcontainers/postgresql` API surface instead of an in-repo analog. |
| `scripts/restore.ts` (whole file) | utility | file-I/O | No restore precedent exists yet — genuinely new, composited from two existing analogs' conventions as detailed above rather than copied from a single source. |
| `docs/20-restore-runbook.md` | doc | — | First procedural runbook in `docs/`; existing `docs/00-current-state.md`/`docs/decisions.md` establish the numbering and UNKNOWN-marking conventions but are not procedural runbooks themselves. Follow D-10's own structure spec (clean procedure + "what actually happened" section) rather than an in-repo doc template. |

## Metadata

**Analog search scope:** `scripts/`, `tests/`, `apps/recipe-app/src/db/`, root `package.json`,
`docker-compose.yml`, `vitest.config.ts`
**Files scanned:** 18 git-tracked files (via `git ls-files`), 8 read in full
**Pattern extraction date:** 2026-09-07
