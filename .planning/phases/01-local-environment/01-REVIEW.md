---
phase: 01-local-environment
reviewed: 2026-09-06T00:00:00Z
depth: standard
files_reviewed: 34
files_reviewed_list:
  - .env.example
  - .gitignore
  - apps/recipe-app/drizzle.config.ts
  - apps/recipe-app/drizzle/0000_bumpy_khan.sql
  - apps/recipe-app/drizzle/0001_busy_thunderbolt.sql
  - apps/recipe-app/drizzle/meta/0000_snapshot.json
  - apps/recipe-app/drizzle/meta/0001_snapshot.json
  - apps/recipe-app/drizzle/meta/_journal.json
  - apps/recipe-app/next-env.d.ts
  - apps/recipe-app/next.config.ts
  - apps/recipe-app/package.json
  - apps/recipe-app/src/app/globals.css
  - apps/recipe-app/src/app/layout.tsx
  - apps/recipe-app/src/app/page.tsx
  - apps/recipe-app/src/app/recipes/[slug]/error.tsx
  - apps/recipe-app/src/app/recipes/[slug]/not-found.tsx
  - apps/recipe-app/src/app/recipes/[slug]/page.tsx
  - apps/recipe-app/src/components/IngredientsGrid.tsx
  - apps/recipe-app/src/components/RecipeScreen.tsx
  - apps/recipe-app/src/components/StepsList.tsx
  - apps/recipe-app/src/db/client.ts
  - apps/recipe-app/src/db/schema.ts
  - apps/recipe-app/src/db/seed.ts
  - apps/recipe-app/tsconfig.json
  - docker-compose.yml
  - package.json
  - pnpm-lock.yaml
  - pnpm-workspace.yaml
  - scripts/db-query.ts
  - scripts/db-reset.ts
  - scripts/env.test.ts
  - scripts/env.ts
  - tests/db-query.test.ts
  - tests/db-reset.test.ts
  - tests/guardrails.test.ts
  - tests/smoke.test.ts
  - tsconfig.base.json
  - vitest.config.ts
findings:
  critical: 2
  warning: 3
  info: 2
  total: 7
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-09-06
**Depth:** standard
**Files Reviewed:** 36 (of 38 listed; lockfile and generated JSON skimmed per scope instructions; `.env.example` content could not be inspected — see note under CR-01)
**Status:** issues_found

## Summary

Phase 1's local-environment scaffolding is well-documented and mostly does what its inline
comments and `01-CONTEXT.md` decisions claim, but there is one load-bearing gap between the
**documented architecture decision** and the **actual code**: D-16 states the local-only
binding for `db:query`/`db:reset` should be architectural — "no argument, flag, or
**environment override** that redirects it at another database... repointing it requires
editing source in a diff, not passing a parameter." What was actually built is the opposite of
that: the connection target is entirely driven by an environment variable
(`RECIPE_DEV_DATABASE_URL`, loaded from `.env`), validated only as *a well-formed URL* with no
host/port restriction. The only safety net is a post-connect check of `current_database()`,
which never inspects the host. This means the described "hardcoded to local, no environment
override" claim does not hold at the architecture level — a `.env` edit alone (not a source
diff) can point the tool at a non-local host, contradicting the project's explicit
non-negotiable ("No production database access from the local machine... prefer architectural
enforcement over remembered caution"). This is the review's headline finding (CR-01).

The second Critical finding is that `db-reset.ts`'s own production code path trusts
`drizzle-kit migrate`'s exit code with no independent verification of the resulting database
state — exactly the known Windows footgun called out in this review's brief (`drizzle-kit
migrate` can exit 0 without applying SQL). The *test suite* (`tests/db-reset.test.ts`) does
verify real state independently, which is good, but that verification does not exist in the
tool a developer or Claude Code actually runs day to day (`pnpm run db:reset`).

Positives worth naming explicitly since the brief asked for an honest verdict, not just
findings: the `[slug]/page.tsx` correctly awaits `params` (Next 16 requirement) and correctly
lets `notFound()` and a thrown DB error diverge into two different boundaries (`not-found.tsx`
vs `error.tsx`) — a missing row and a down database do not look the same to a user, which was
a specific risk called out in the brief and is handled correctly. `docker-compose.yml` binds
the database port to `127.0.0.1` only, never `0.0.0.0`. Error messages in `scripts/env.ts`,
`scripts/db-query.ts` and `scripts/db-reset.ts` are built from `error.message` only, never a
raw error object or the connection string, and this is directly covered by tests
(`scripts/env.test.ts`, `tests/db-query.test.ts`) that assert the literal secret value never
appears in output. The two committed migrations and `_journal.json` are internally consistent
(2 entries, matching tags, sequential `idx`).

## Critical Issues

### CR-01: The "hardcoded to local" connection binding is actually environment-variable-driven with no host restriction

**File:** `scripts/env.ts:48-56`, `scripts/db-query.ts:26`, `scripts/db-reset.ts:71`, `apps/recipe-app/drizzle.config.ts:11-13`, `apps/recipe-app/src/db/client.ts:9`, `apps/recipe-app/src/db/seed.ts:16`

**Issue:** Every entry point (`db-query`, `db-reset`, `drizzle.config.ts`, the Next.js app, the
seed script) obtains its connection string via `getDevDatabaseUrl()`, which returns
`env.RECIPE_DEV_DATABASE_URL`. That value is validated only as `z.string().url()`
(`scripts/env.ts:48-50`) — any well-formed Postgres URL passes, including one pointing at a
remote/staging/production host. The only runtime safety check,
`assertDevelopmentDatabase()` (`scripts/env.ts:70-81`), queries `current_database()` and
compares it to the string `"recipe_dev"` — it never inspects the host, port, or whether the
target is loopback. `.env` is read via `dotenv.config()` (`scripts/env.ts:32`) from a file that
is explicitly meant to be user-edited for local configuration.

This directly contradicts the project's own recorded decision, `01-CONTEXT.md` D-16: *"The
script is hardcoded to local. It reads the development connection variable and nothing else —
there is no argument, flag, or environment override that redirects it at another database.
Repointing it requires editing source in a diff, not passing a parameter."* The code as written
**is** exactly the environment-variable override the decision says does not exist: repointing
`db-query`/`db-reset`/the app/drizzle-kit at any reachable host requires only editing one line
of `.env`, no source diff at all. `scripts/db-query.ts`'s own header comment
(lines 1-7) restates the same "hardcoded to local" framing, which is not accurate to what the
code does — the comment says "no environment variable this file itself consults for a target,"
which is true only because the indirection lives one file away in `scripts/env.ts`; the
end-to-end target is still fully environment-driven.

Compounding this: `apps/recipe-app/drizzle.config.ts` — the config `drizzle-kit migrate` (used
by `db:migrate`, and therefore by `db-reset.ts` step 4) actually reads — never calls
`assertDevelopmentDatabase()` at all. So even the weak, host-blind, database-name-only safety
net does not apply to the single most destructive step in the whole pipeline (applying the
full migration history). `drizzle-kit` runs against whatever `RECIPE_DEV_DATABASE_URL`
resolves to, unconditionally.

Per this project's explicit non-negotiables ("No production database access from the local
machine," "prefer architectural enforcement over remembered caution"), a safeguard that
depends on `.env` being correctly populated by a human (or an agent with file-write access) is
not the architectural enforcement the decision log says was chosen. Today there is no
production database to reach, which limits the blast radius, but the mechanism being built in
this exact phase is supposed to be the thing that prevents that reach later — and as built, it
does not.

**Fix:** Enforce the host at the same layer that already owns environment validation, so it is
impossible to bypass by editing `.env` alone:
```typescript
// scripts/env.ts
const EnvSchema = z.object({
  RECIPE_DEV_DATABASE_URL: z.string().url().refine(
    (value) => {
      const { hostname } = new URL(value);
      return hostname === "localhost" || hostname === "127.0.0.1";
    },
    { message: "RECIPE_DEV_DATABASE_URL must point at localhost/127.0.0.1 — no remote host is a valid development database target." },
  ),
});
```
Also call `assertDevelopmentDatabase()` (or an equivalent host+name check) from a Drizzle Kit
lifecycle hook, or wrap `drizzle-kit migrate`/`generate` invocations in a pre-flight check in
`db-reset.ts` and any future migrate script, so the safety net actually covers the destructive
path and not just the two hand-written CLI scripts. If the team still wants D-16's literal
"no environment override, repointing requires a source diff" property, the URL (at least host
and port) needs to be a constant in source, with only the password sourced from environment —
not the whole connection string.

*(Reviewer note: `.env.example` was in scope per the task brief but this session's file-read
permissions denied access to it — both the dedicated Read tool and Grep returned "Permission
... denied" for that specific path, while every other file in scope was readable. I could not
independently confirm its placeholder content; `tests/guardrails.test.ts:94-99` does assert it
contains the literal string `"PLACEHOLDER"`, which is some mitigation, but that test does not
verify every variable `docker-compose.yml` requires — e.g. `RECIPE_DEV_DB_PASSWORD`
(`docker-compose.yml:16`) — is actually documented there.)*

### CR-02: `db-reset.ts` trusts `drizzle-kit migrate`'s exit code with no independent verification of applied state

**File:** `scripts/db-reset.ts:80-83`

**Issue:** Step 4 of the reset pipeline is:
```typescript
await runStep("drizzle-kit migrate", async () => {
  await execa("pnpm", ["run", "db:migrate"]);
});
```
`runStep` (lines 31-44) only distinguishes success/failure by whether the promise rejects
(i.e., by `execa`'s default behavior of throwing on non-zero exit). It performs no query
against the database afterward to confirm that the expected number of migrations were actually
recorded in `drizzle.__drizzle_migrations` or that the expected tables exist. This is precisely
the failure mode the review brief called out as known: `drizzle-kit migrate` has been observed
to exit 0 on Windows without applying any SQL. If that happens here, `db-reset.ts` prints
`"drizzle-kit migrate done."` and finally `"[db:reset] Complete."`, giving a false-positive
success signal for the one step whose entire job is to prove the migration history applies
cleanly to a truly empty database (the stated purpose of D-22's full-teardown design).

The independent verification that *does* exist — `assertRebuiltState()` in
`tests/db-reset.test.ts:15-56`, which checks `drizzle.__drizzle_migrations` row count against
the journal and checks table/row counts — lives only in the test suite, not in the tool itself.
A developer (or Claude Code) running `pnpm run db:reset` directly, outside of `pnpm test`, gets
none of that verification.

**Fix:** Fold the same state assertion the test performs into the script itself, e.g. add a
step after migrate that re-queries `drizzle.__drizzle_migrations` and compares its count to
`_journal.json`'s entry count, failing loudly (non-zero exit, no silent "done.") if they don't
match:
```typescript
await runStep("verify migration history applied", async () => {
  const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf-8")) as { entries: unknown[] };
  const client = new Client({ connectionString: getDevDatabaseUrl() });
  try {
    await client.connect();
    const { rows } = await client.query("SELECT count(*) AS count FROM drizzle.__drizzle_migrations");
    if (Number(rows[0].count) !== journal.entries.length) {
      throw new Error(
        `Expected ${journal.entries.length} applied migrations, found ${rows[0].count} — ` +
          `drizzle-kit migrate likely no-opped without applying SQL.`,
      );
    }
  } finally {
    await client.end();
  }
});
```

## Warnings

### WR-01: `tests/guardrails.test.ts` blanket-excludes every `*.test.ts` file from two constraints it exists to enforce

**File:** `tests/guardrails.test.ts:80-99, 120-136`

**Issue:** Both the connection-string-prefix check (D-19) and the direct-env-read check
(ENV-03) filter out any file matching `*.test.ts` (lines 84 and 128-130) with the stated
justification that `scripts/env.test.ts` (and, per the header comment, `db-query.test.ts`)
legitimately construct fake `postgres://` literals and set
`process.env.RECIPE_DEV_DATABASE_URL` directly to exercise `scripts/env.ts`'s own behavior.
That justification is true for those specific files, but the exclusion as implemented is a
wildcard over the whole `*.test.ts` class, not an allowlist of the two-or-three files that
actually need the exception. As written, a brand-new test file could hardcode a real
`postgres://user:realpassword@some-host/db` connection string, or read
`process.env.RECIPE_DEV_DATABASE_URL` directly and bypass `scripts/env.ts` entirely, and this
guardrail suite — whose entire purpose is to be the mechanical, no-human-judgment-required
enforcement of exactly these two constraints (per this project's "architectural enforcement
over remembered caution" principle) — would report green. This is a real, exploitable blind
spot in the guardrail itself, not merely a style nit: it inverts the guardrail's own guarantee
for one class of file.

**Fix:** Replace the blanket `*.test.ts` exclusion with an explicit, narrow allowlist of the
files that are known to need it:
```typescript
const KNOWN_FIXTURE_FILES = ["scripts/env.test.ts", "tests/db-query.test.ts"];
const files = (await sourceSurfaceFiles()).filter((file) => !KNOWN_FIXTURE_FILES.includes(file));
```
This keeps the exact same intended exemption while ensuring any *other* test file — including
ones added later — is still covered by the constraint.

### WR-02: `db-reset.ts` step 3's environment assertion does not cover step 4's migrate invocation (TOCTOU-shaped gap)

**File:** `scripts/db-reset.ts:68-83`

**Issue:** Step 3 opens its own short-lived `Client`, calls `assertDevelopmentDatabase()`, and
closes the connection. Step 4 then shells out to `pnpm run db:migrate` (a separate process,
using `drizzle.config.ts`, which as noted in CR-01 never calls `assertDevelopmentDatabase()` at
all). The two steps share no connection and no enforced ordering guarantee beyond "step 3 ran
first in this same script invocation." If `db-reset.ts`'s steps are ever reordered, if step 4
is ever invoked independently (e.g. a developer runs `pnpm run db:migrate` directly, which is
also exposed as its own top-level script in `package.json:10`), or if the two steps are moved
into different scripts, there is nothing enforcing that the environment check actually applies
to the migrate operation it's meant to gate. This is a narrower restatement of CR-01's
"drizzle-kit never asserts" point, called out separately because it is also a general
design-pattern concern independent of the host-check fix: the assertion should travel with the
operation it protects, not run once and be trusted by a sibling process.

**Fix:** See CR-01's fix — move the assertion (or an equivalent check) to run immediately
before/after the `drizzle-kit migrate` invocation itself, not only as an isolated earlier step.

### WR-03: `ingredients`/`steps` position uniqueness and `recipes.baseServings` have no positivity/non-zero constraint, and `RecipeScreen` divides by it unguarded

**File:** `apps/recipe-app/src/db/schema.ts:13`, `apps/recipe-app/src/components/RecipeScreen.tsx:44`

**Issue:** `recipes.baseServings` is `integer(...).notNull()` with no `CHECK (base_servings > 0)`
constraint at the schema or database level. `RecipeScreen.tsx:44` computes
`const multiplier = servings / recipe.baseServings;`, which becomes `Infinity`/`NaN` if a future
row is ever inserted with `baseServings` of `0` (or negative). Today's seed always sets `2`, so
this is latent rather than triggered, but it is exactly the kind of "an agent mistake can
destroy production data/quality" scenario the project's own threat model is built to defend
against for the database layer — the same discipline is worth applying to a value that flows
directly into division-based rendering math.

**Fix:** Add a database-level check constraint (`sql`check(base_servings > 0)`` `` via Drizzle's
`check()` helper) and/or a defensive clamp in `RecipeScreen.tsx`:
```typescript
const multiplier = recipe.baseServings > 0 ? servings / recipe.baseServings : 1;
```

## Info

### IN-01: `db-query.ts`/`db-reset.ts` duplicate the "print only `error.message`" pattern three times

**File:** `scripts/db-query.ts:38-44`, `scripts/db-reset.ts:36-41, 93-96`

**Issue:** The `error instanceof Error ? error.message : String(error)` pattern, plus the
security rationale comment explaining why only `.message` is ever printed, is repeated
verbatim across both scripts. This is a security-sensitive pattern (it's the mechanism that
keeps a connection string out of logs) — duplicating it means a future edit to one call site
can silently diverge from the others without a shared point of enforcement or test coverage.

**Fix:** Extract a single shared helper (e.g. in `scripts/env.ts` or a new `scripts/log.ts`)
such as `function safeErrorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }`, imported by both scripts, so the "never print the raw error object" guarantee has one place to test and maintain.

### IN-02: `db:migrate` and `db:generate` are independently runnable top-level scripts, bypassing `db-reset.ts`'s own step ordering entirely

**File:** `package.json:9-10`

**Issue:** `db:migrate` (`drizzle-kit migrate`) and `db:generate` are exposed as standalone
`pnpm` scripts, callable directly without going through `db-reset.ts` at all. This is likely
intentional (the normal generate → inspect → migrate loop described in the guardrail comments
needs `db:migrate` to be independently runnable), but it means the CR-01/WR-02 host-and-name
assertion gap applies to the most commonly-run command in the whole workflow, not just the
less-frequently-run `db:reset`. Flagging as Info rather than folding into CR-01 since the fix
is the same one already proposed there.

**Fix:** No separate fix needed beyond CR-01's — noted here so the fix is understood to cover
this call path too, not just `db-reset.ts`.

---

_Reviewed: 2026-09-06_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
