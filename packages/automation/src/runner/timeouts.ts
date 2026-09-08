// D-13/D-14/D-15: the runner's own pinned `lock_timeout`/`statement_timeout` constants, the
// connect-time libpq startup-options string built from them, and the post-connect verification
// that both actually took effect. Pinned source constants, not environment-variable-tunable --
// changing either is a reviewed source diff, exactly the pinning style
// `scripts/env.ts`'s `EXPECTED_DEV_DATABASE_PORT` already uses (D-13, `01-CONTEXT.md` D-16).
// Environment variables with pinned defaults were rejected: they make the timeout a value the
// operator maintains rather than a property of the runner, and "set it to 0 in CI" becomes a
// one-line diff nobody reviews.
//
// D-15: this repository already holds one recorded case of a migrate tool -- drizzle-kit's own
// migrate sub-command, on Windows -- exiting zero without doing its job
// (`scripts/verify-migration-state.ts` exists because of it) -- "set it and trust it" is not
// good enough here, so the runner re-queries `pg_settings` (never `SHOW`, which returns the
// human-formatted `"3s"` rather than a comparable integer -- verified live in
// `04-RESEARCH.md` Pattern 2) before executing anything.
//
// Deliberately NOT set this phase: `idle_in_transaction_session_timeout`. Nothing in this
// runner ever leaves a transaction idle -- `BEGIN` and `COMMIT` are issued in the same
// synchronous loop in `run-migrations.ts` -- so a third pinned number would be a value with
// nothing behind it, the same reasoning D-16 used to decline a concurrent-index timeout
// exemption.
import type { RunnerClient } from "./client";

/** D-13: ~3s. Fails fast enough that a slow-locking migration is refused quickly rather than
 * hanging indefinitely. */
export const LOCK_TIMEOUT_MS = 3000;

/** D-13: ~30s. Generous for real DDL but bounded -- no exemption for any statement kind,
 * including `CREATE INDEX CONCURRENTLY` (D-16). */
export const STATEMENT_TIMEOUT_MS = 30000;

/** D-14: the libpq startup-options string applied via `pg`'s `options` connection parameter at
 * connect time -- never a `SET`/`SET LOCAL` issued after connect, so there is no window in
 * which the session exists without them and no ordering bug that could skip them. Built by
 * interpolating the two constants above, never as a hand-typed duplicate literal. */
export const RUNNER_CONNECTION_OPTIONS = `-c lock_timeout=${LOCK_TIMEOUT_MS} -c statement_timeout=${STATEMENT_TIMEOUT_MS}`;

interface PgSettingRow {
  name: string;
  setting: string;
}

/**
 * Verifies both timeout GUCs are actually in effect on `client`'s connection, throwing when
 * either is absent from `pg_settings` or its `setting` does not equal the pinned constant's
 * string form. Queries `pg_settings` directly -- never `SHOW`, which returns the
 * human-formatted `"3s"`/`"30s"` rather than the raw millisecond integer `pg_settings.setting`
 * stores (verified live against the real dev container in `04-RESEARCH.md`).
 */
export async function assertTimeoutsInEffect(client: RunnerClient): Promise<void> {
  const { rows } = await client.query<PgSettingRow>(
    "SELECT name, setting FROM pg_settings WHERE name IN ('lock_timeout','statement_timeout')",
  );
  const settings = new Map(rows.map((row) => [row.name, row.setting]));

  const expected: Array<[string, number]> = [
    ["lock_timeout", LOCK_TIMEOUT_MS],
    ["statement_timeout", STATEMENT_TIMEOUT_MS],
  ];

  for (const [name, expectedMs] of expected) {
    const actual = settings.get(name);
    if (actual !== String(expectedMs)) {
      throw new Error(
        `Refusing to proceed: "${name}" is not pinned as expected (pg_settings reports ` +
          `${actual === undefined ? "no row" : `"${actual}"`}, expected "${expectedMs}"). The ` +
          "connection did not apply the runner's connect-time timeout options.",
      );
    }
  }
}
