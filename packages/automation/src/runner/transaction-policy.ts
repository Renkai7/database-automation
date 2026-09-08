// D-09/D-11 (04-CONTEXT.md): the wrap-or-refuse decision, derived exclusively from the same
// parse that produced the verdict -- the analyzer's own `transactionHostile` fact (D-10,
// packages/automation/src/types.ts). Deliberately no directive, comment, filename convention,
// environment variable, config key, or CLI flag can reach this decision (D-09's own principle,
// inherited from 03-CONTEXT.md D-13: this system's whole purpose includes proving comments are
// inert, so load-bearing data must never live in one). Refusing a mixed file (D-11) is what
// makes "unwrapped" always mean "a single statement whose failure is its own" -- a half-applied
// migration file becomes impossible by construction, rather than a case the recovery story has
// to handle.
//
// Mirrors classifier/floor.ts's own pure-function-of-facts, throw-loudly-never-silently-degrade
// idiom: no I/O, no imports beyond ../types, no side effects at import time. The runner must
// never keep a second keyword list, statement-kind list, or regular expression of its own for
// deciding what can run in a transaction -- that would be a second place in this codebase
// reasoning about SQL semantics, drifting from the analyzer's vocabulary (the exact split
// 03-CONTEXT.md D-11's pure-core seam exists to prevent).
import type { Finding } from "../types";

/** `{ wrap: true }` for the ordinary, atomic-by-default case; `{ wrap: false,
 * hostileStatementIndex }` only for a file that is exactly one transaction-hostile statement --
 * `hostileStatementIndex` is that statement's `Finding.statementIndex`, never a re-derived
 * position. */
export type TransactionPolicy = { wrap: true } | { wrap: false; hostileStatementIndex: number };

/** Thrown when a file mixes a transaction-hostile statement with any other statement -- including
 * a second transaction-hostile statement, since a file is one unit whose application is a single
 * claim, never split into wrapped and unwrapped segments (D-11). */
export class MixedTransactionFileError extends Error {
  constructor(hostileStatementIndex: number) {
    super(
      `Migration mixes a transaction-hostile statement (statement index ${hostileStatementIndex}) ` +
        "with other statements in the same file. PostgreSQL forbids running this statement " +
        "inside a transaction block, and a migration file is one atomic unit -- move the " +
        "transaction-hostile statement into its own migration file.",
    );
    this.name = "MixedTransactionFileError";
  }
}

/**
 * Decides whether a migration file's statements run wrapped in a single transaction. Reads ONLY
 * the `transactionHostile` fact off each finding's `facts` -- never a keyword list, a
 * statement-kind list, or a regular expression of its own. Counts hostile findings across the
 * WHOLE findings array, including nested findings a DO-block/function-body recursion produced
 * (their `nestedPath` is non-empty, but the same `facts.transactionHostile` field counts them
 * exactly like a top-level finding -- a hostile statement inside a DO block does not become
 * invisible).
 *
 * - Zero hostile findings anywhere (including an empty findings array -- nothing to run, still
 *   one atomic unit) -> wrap (the default).
 * - Exactly one finding total, and it is hostile -> unwrap, naming its own `statementIndex`.
 * - Any other combination (one hostile finding plus any other finding, or two-or-more hostile
 *   findings in the same file) -> throws `MixedTransactionFileError` naming the first hostile
 *   finding's `statementIndex`.
 */
export function decideTransactionPolicy(findings: Finding[]): TransactionPolicy {
  const hostileFindings = findings.filter((finding) => finding.facts.transactionHostile);

  if (hostileFindings.length === 0) {
    return { wrap: true };
  }

  if (findings.length === 1) {
    return { wrap: false, hostileStatementIndex: findings[0].statementIndex };
  }

  throw new MixedTransactionFileError(hostileFindings[0].statementIndex);
}
