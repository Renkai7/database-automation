// T-01-18 / IN-01: the single, tested definition of "print only the error's own message,
// never the error object" — the mechanism that keeps a connection string out of this
// project's logs (CLAUDE.md: "never log or commit credentials"). Some database error shapes
// carry connection details on fields other than `message` (a raw connection string, a
// password field, etc.), so a genuine Error's `message` is the only thing ever read from it,
// and any other value is coerced via `String()` rather than serialised — this function never
// JSON-stringifies or otherwise walks an unknown value's own fields, which is what would leak
// them.
//
// This module imports nothing and has no side effects: it must be safely importable —
// including from a test — without triggering scripts/env.ts's own import-time environment
// validation.
export function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
