// D-28: the runner core's entire database capability. `packages/automation` must never import
// `pg` (or any other database driver) -- the caller constructs a real client and injects it
// here. This mirrors scripts/env.ts's `QueryableClient` shape: a minimal interface, not a
// re-export of a driver's own type, so both the local entry point
// (scripts/db-migrate.ts, wrapping a real pg.Client) and the future Testcontainers history
// harness can satisfy it with whatever client they already constructed.
//
// No imports, no side effects: this module must be importable with zero I/O, matching the
// pure-core discipline `packages/automation/src/classifier/floor.ts` and
// `packages/automation/src/inspector/inspect.ts` already establish.
//
// D-28: this is the WHOLE database capability the runner core is allowed. It carries no
// bind-parameter mechanism deliberately -- every module under `runner/` that needs to write a
// value builds a safely-quoted SQL literal itself (see runner-table.ts/ledger.ts) rather than
// depending on a client capability this minimal interface does not expose.
export interface RunnerClient {
  query<R = Record<string, unknown>>(text: string): Promise<{ rows: R[] }>;
}
