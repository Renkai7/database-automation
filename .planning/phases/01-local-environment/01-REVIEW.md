---
phase: 01-local-environment
reviewed: 2026-09-07T16:13:49Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - apps/recipe-app/drizzle.config.ts
  - apps/recipe-app/src/components/RecipeScreen.tsx
  - scripts/db-query.ts
  - scripts/db-reset.ts
  - scripts/env.test.ts
  - scripts/env.ts
  - scripts/log.ts
  - scripts/verify-migration-state.ts
  - tests/guardrails.test.ts
  - tests/log.test.ts
  - tests/target-pin.test.ts
  - tests/verify-migration-state.test.ts
findings:
  critical: 1
  warning: 3
  info: 2
  total: 6
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-09-07T16:13:49Z
**Depth:** standard
**Files Reviewed:** 12
**Status:** issues_found

## Summary

This is an incremental review of the gap-closure work for the D-16 target-pin gap (plans
01-06..01-08). The bulk of `scripts/env.ts`, its tests, and the CLI scripts that consume it are
well-documented and internally consistent, and most of the specific hardening claims in the code
comments (bare `DATABASE_URL` rejection, never-echo-the-value error messages, `current_database()`
runtime check, no-stdin `db:reset`) hold up under inspection.

However, the review turned up a **live, verified bypass of the D-16 development-target pin
itself** — the exact thing this task was asked to stress-test. `assertLocalDevelopmentTarget`
validates the connection string using the WHATWG `URL` parser, but the actual database
connection is opened by `pg` (via `pg-connection-string`), which parses PostgreSQL connection
URIs under different, spec-compliant semantics: a `?host=`/`?port=` query parameter silently
overrides the authority-derived host/port. The validator inspects only `.hostname`/`.port`/
`.pathname` and never looks at the query string, so a connection string can pass every pin check
while actually connecting somewhere else entirely. This affects every entry point in scope:
`db-query.ts`, `db-reset.ts`, `verify-migration-state.ts` (all via `getDevDatabaseUrl()`), and
`drizzle.config.ts` (which also bundles `pg` inside `drizzle-kit`) — including "the single most
destructive command in the pipeline" per that file's own comment. This is verified against the
actual `pg-connection-string@2.14.0` and `pg@8.23.0` versions installed in this repo, not a
theoretical concern.

A handful of smaller robustness and test-quality issues are listed below as warnings/info.

## Critical Issues

### CR-01: D-16 development-target pin can be bypassed via a `?host=`/`?port=` query parameter

**File:** `scripts/env.ts:66-98` (`assertLocalDevelopmentTarget`), consumed by `scripts/db-query.ts:27`, `scripts/db-reset.ts:71`, `scripts/verify-migration-state.ts:35`, and `apps/recipe-app/drizzle.config.ts:11-12`

**Issue:** `assertLocalDevelopmentTarget` validates `parsed.hostname`, `parsed.port`, and
`parsed.pathname` from Node's WHATWG `URL` parser. It never inspects `parsed.search` /
`parsed.searchParams`. PostgreSQL connection URIs, however, allow any connection parameter
(including `host`, `hostaddr`, and `port`) to be supplied as a query parameter, and that value
*overrides* the authority-section host/port when the URI is actually parsed by `pg` for
connecting. `pg@8.23.0` delegates connection-string parsing to `pg-connection-string@2.14.0`
(`lib/connection-parameters.js:60`), whose `parse()` implementation does exactly this
(`pg-connection-string/index.js:40-64`):

```js
for (const entry of result.searchParams.entries()) {
  config[entry[0]] = entry[1]        // query params applied first
}
...
if (!config.host) {                  // only fall back to the authority host
  config.host = decodeURIComponent(hostname)   // if no query param set it
}
...
if (!config.port) {
  config.port = result.port
}
```

Reproduced end-to-end against the versions actually installed in this repo:

```
RECIPE_DEV_DATABASE_URL = "postgres://dev:pass@localhost:5432/recipe_dev?host=evil-host.example.com"

assertLocalDevelopmentTarget(url):
  parsed.hostname -> "localhost"        => passes the allowlist check
  parsed.port     -> "5432"             => passes the port check
  parsed.pathname -> "/recipe_dev"      => passes the database-name check
  => the function returns normally, no throw

pg-connection-string.parse(url):
  { host: 'evil-host.example.com', user: 'dev', password: 'pass', port: '5432', database: 'recipe_dev' }
  => pg actually opens a TCP connection to evil-host.example.com:5432
```

(`?port=` behaves the same way for the port; `?dbname=`/`?database=` do **not** work as a bypass
because `pg-connection-string` unconditionally re-derives `config.database` from the URL
pathname after the query-param loop — only `host`/`port`/`hostaddr`-style keys are affected.)

This defeats the entire purpose of D-16: a `.env` value that looks correctly pinned to
`localhost:5432/recipe_dev` at a glance (and that passes every existing unit and e2e test in
`scripts/env.test.ts` / `tests/target-pin.test.ts`, none of which exercise a query string) can
silently redirect **every** tool in this workspace — `db-query`'s arbitrary-SQL execution,
`db-reset`'s full migrate+seed pipeline, and `drizzle-kit migrate` itself (which also bundles
`pg` inside `drizzle-kit@0.31.10/api.js`) — at an attacker- or misconfiguration-controlled host.

This also defeats the stated defense-in-depth of `assertDevelopmentDatabase`'s
`current_database()` runtime check (`scripts/env.ts:152-163`): that check only verifies the
*name* reported by whatever server the client actually connected to. An attacker who controls
the redirected host trivially names their own database `recipe_dev` and the runtime check
passes too. Given this project's explicit non-negotiable ("no production database access from
the local machine... because the architecture prevents it, not because anyone remembered to be
careful"), a bypass this close to the exact vector the phase's non-negotiable is written against
is a blocker, not a hardening nice-to-have.

**Fix:** Do not trust the generic WHATWG `URL` parser to decide what `pg` will actually connect
to. Either:

1. Reject any connection string that carries a query component at all (the pinned dev target
   never legitimately needs one), e.g.:

```ts
export function assertLocalDevelopmentTarget(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch { /* ...unchanged... */ }

  if (parsed.search !== "") {
    throw new Error(
      "RECIPE_DEV_DATABASE_URL must not contain query parameters -- a `host`, `hostaddr`, or " +
        "`port` query parameter silently overrides the pinned target when the driver connects.",
    );
  }
  // ...existing hostname/port/database checks...
}
```

   or, more narrowly, explicitly reject the `host`, `hostaddr`, and `port` keys specifically.

2. Better still, validate using the same parser that will actually be used to connect
   (`pg-connection-string`'s own `parse()`) instead of `new URL()`, so the value being validated
   and the value being connected with can never diverge:

```ts
import parseConnectionString from "pg-connection-string";

export function assertLocalDevelopmentTarget(url: string): void {
  const parsed = parseConnectionString(url);
  if (!(DEV_DATABASE_HOST_ALLOWLIST as readonly string[]).includes(parsed.host ?? "")) { /* ... */ }
  if (String(parsed.port ?? "") !== EXPECTED_DEV_DATABASE_PORT) { /* ... */ }
  if (parsed.database !== EXPECTED_DEV_DATABASE_NAME) { /* ... */ }
}
```

Either fix should be accompanied by a regression test (see WR-03-equivalent gap below) that
specifically exercises a `?host=`/`?port=` query-parameter redirection, since neither
`scripts/env.test.ts` nor `tests/target-pin.test.ts` currently covers this vector.

## Warnings

### WR-01: No test coverage for the query-parameter bypass vector (CR-01)

**File:** `scripts/env.test.ts`, `tests/target-pin.test.ts`

**Issue:** Both test suites are otherwise thorough about D-16 (host allowlist, port, database
name, both IPv6 spellings, an end-to-end redirected-hostname case for `db-query`, `drizzle-kit
migrate`, and `db-reset`), but none of them constructs a URL with a query string. The exact
bypass in CR-01 would have gone undetected by the full existing test suite.

**Fix:** After fixing CR-01, add cases such as:

```ts
it("throws when a host query parameter attempts to override the pinned host", async () => {
  process.env.RECIPE_DEV_DATABASE_URL =
    "postgres://dev:devpass@localhost:5432/recipe_dev?host=evil-host.example.com";
  await expect(import("./env")).rejects.toThrow(/RECIPE_DEV_DATABASE_URL/);
});
```

and an equivalent end-to-end case in `tests/target-pin.test.ts` for `db-query`/`db:migrate`.

### WR-02: `DEV_DATABASE_HOST_ALLOWLIST` contains an unreachable entry

**File:** `scripts/env.ts:55`

**Issue:** `DEV_DATABASE_HOST_ALLOWLIST = ["localhost", "127.0.0.1", "::1", "[::1]"]`. Node's
WHATWG `URL.hostname` always serializes an IPv6 host **with** brackets — confirmed directly:
`new URL("postgres://dev:pass@[::1]:5432/recipe_dev").hostname === "[::1]"`, never `"::1"`. The
bare `"::1"` entry can never be matched by `parsed.hostname` and is dead weight; the accompanying
comment ("both IPv6 loopback spellings") and the guardrail test in
`tests/guardrails.test.ts:190-196` (which asserts the allowlist contains exactly these four
strings) both encode the same mistaken assumption, so this will keep being "verified" as correct
by the test suite even though one of the four entries is unreachable.

**Fix:** Drop `"::1"` from the allowlist (and from the guardrail test's expected array), or, if
the intent is genuinely to accept both spellings, normalize `parsed.hostname` before comparing
(e.g., strip surrounding brackets) rather than listing a form that `URL` never produces.

### WR-03: `db-reset.ts`'s `pg_isready` fallback hardcodes the database identity instead of reusing the shared constant

**File:** `scripts/db-reset.ts:20`

**Issue:** `waitForReadyFallback` hardcodes `"-U", "recipe_app", "-d", "recipe_dev"` as literals.
`scripts/env.ts` already exports `EXPECTED_DEV_DATABASE_NAME` as the single source of truth for
the pinned database name specifically so that "changing any of these three values is a
safety-relevant source diff" (per `env.ts`'s own comment) — but this literal doesn't reference
it, so a future rename of the pinned database would silently leave this fallback probe checking
the wrong database name without any compiler or test error pointing at this file.

**Fix:** Import and use `EXPECTED_DEV_DATABASE_NAME` (and a corresponding exported user constant,
if one exists) instead of the literal:

```ts
import { EXPECTED_DEV_DATABASE_NAME } from "./env";
// ...
["compose", "exec", "-T", "db", "pg_isready", "-U", "recipe_app", "-d", EXPECTED_DEV_DATABASE_NAME]
```

## Info

### IN-01: Weak substring assertion in the `db-reset` survival check

**File:** `tests/target-pin.test.ts:79-80`

**Issue:** `expect(survivalCheck.stdout).toContain("8")` is meant to confirm the seeded
`ingredients` table still has its expected row count after a refused `db:reset`, but a plain
substring check on `console.table`'s rendered output would also pass for an actual count of `18`,
`80`, `8000`, or any other number containing the digit `8`, and could even coincidentally match
box-drawing padding. This is the load-bearing assertion the test file's own header comment calls
out as distinguishing "guard fires before teardown" from "guard fires after teardown," so a false
pass here would hide exactly the regression the test exists to catch.

**Fix:** Assert on a tighter pattern, e.g. a row/column boundary
(`toMatch(/\bingredient_count\b[\s\S]*\b8\b/)`) or switch the query to `SELECT count(*)::int` and
parse the count out of stdout for an exact numeric comparison.

### IN-02: Leaked-credential guardrail only matches the `postgres://` scheme spelling, not `postgresql://`

**File:** `tests/guardrails.test.ts:44,104-125`

**Issue:** `CONNECTION_STRING_SCHEME_PREFIX` is built as `"postgres" + "://"`. PostgreSQL
connection URIs accept both `postgres://` and `postgresql://` as the scheme
(interchangeably, per PostgreSQL's own URI documentation). A credential accidentally committed
using the `postgresql://` spelling would not be caught by this guardrail, since
`"postgresql://...".includes("postgres://")` is `false` (the substring after `postgres` is `ql:`,
not `://`).

**Fix:** Check for both spellings, e.g. also build and check
`["postgresql", "://"].join("")`, or match with a scheme-agnostic regex such as
`/postgres(ql)?:\/\//`.

---

_Reviewed: 2026-09-07T16:13:49Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
