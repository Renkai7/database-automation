// D-06/Pitfall 3 (04-RESEARCH.md): the runner's OWN process-exit-code contract -- distinct from
// `packages/automation`'s `EXIT_CODES` (`../types.ts`), which is the ANALYZER's verdict
// contract (`REVIEW_REQUIRED = 10`). Reusing that enum here would violate D-06 by construction:
// D-06 requires the runner to exit 0 when it applied everything it was allowed to apply,
// INCLUDING a migration that classified REVIEW_REQUIRED, and `EXIT_CODES` answers "what verdict
// happened", not "did the run succeed at doing what it was allowed to do". Never import
// `EXIT_CODES` from `../types` for this purpose.
//
// `1` is deliberately not a member of this set, so an uncaught crash (Node's own generic exit
// code) can never be misread as a named outcome here.
//
// `REFUSED_MIXED_FILE` and `REFUSED_STALE_MARKER` are not reachable until plans 04-04/04-05 --
// they are defined now because this set is the contract Phase 5 reads.
export const RUNNER_EXIT_CODES = Object.freeze({
  APPLIED: 0,
  REFUSED_BLOCKED: 21,
  REFUSED_PARSE_FAILURE: 31,
  REFUSED_MIXED_FILE: 41,
  REFUSED_STALE_MARKER: 51,
  EXECUTION_FAILED: 61,
  REFUSED_TIMEOUTS_NOT_IN_EFFECT: 71,
});

export type RunnerExitCode = (typeof RUNNER_EXIT_CODES)[keyof typeof RUNNER_EXIT_CODES];
