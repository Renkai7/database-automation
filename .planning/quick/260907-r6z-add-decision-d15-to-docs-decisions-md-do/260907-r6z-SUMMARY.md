---
phase: quick-260907-r6z
plan: 01
subsystem: docs
tags: [decision-log, packaging, safety-analyzer, honesty-non-negotiable]

requires: []
provides:
  - "D15 entry in docs/decisions.md recording the PROPOSED packaging/reuse strategy for the Phase 1-2 backup/restore-drill tooling"
affects: ["future packaging or extraction work on scripts/backup.ts, scripts/env.ts, scripts/drill-assertions.ts", "Phase 3 planning (preparatory config-consolidation recommendation)"]

actuals:
  tokens: 2100
  tasks: 2
  commits: 1

tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified: ["docs/decisions.md"]

key-decisions:
  - "D15 recorded as PROPOSED (not ACCEPTED) — packaging strategy, not yet agreed by the owner"
  - "Config-in-source (db-safety.config.ts, zod-validated) proposed instead of environment variables, to preserve D-16's reviewable-diff safeguard"
  - "Three-layer package shape proposed: npm package (mechanism) / scaffold-template (copied infra files) / Claude Code plugin-skill (agent-facing conventions)"
  - "Extraction deferred to end of Phase 5; one preparatory config-consolidation step recommended before Phase 3"

patterns-established: []

requirements-completed: [PLAT-01]

coverage:
  - id: D1
    description: "D15 entry appended to docs/decisions.md recording current tooling state, the env-var-vs-pinned-constant design tension, the config-in-source resolution, the three-layer package proposal, non-transferability of drill evidence, extraction timing, and two explicit UNKNOWNs"
    requirement: "PLAT-01"
    verification:
      - kind: other
        ref: "automated grep gate in 260907-r6z-PLAN.md Task 1 verify block (D15_OK)"
        status: pass
      - kind: other
        ref: "automated grep gate in 260907-r6z-PLAN.md Task 2 verify block (SCOPE_OK)"
        status: pass
    human_judgment: true
    rationale: "Task 2's <human-check> asks the owner to read D15 end-to-end and confirm it reads as an unagreed proposal whose portability description matches their own sense of the code — this is inherently a human judgment call, not something the automated grep gates can certify."

duration: 12min
completed: 2026-09-07
status: complete
---

# Quick Task 260907-r6z: Record D15 packaging-strategy proposal Summary

**Appended a PROPOSED decision (D15) to `docs/decisions.md` documenting the backup/restore-drill tooling's packaging tension — env-var configuration would defeat D-16's pinned-constant safeguard — plus a config-in-source resolution, a three-layer package shape, and two explicit UNKNOWNs. No source files touched.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-09-07T23:32:00Z
- **Completed:** 2026-09-07T23:44:53Z
- **Tasks:** 2 completed
- **Files modified:** 1 (`docs/decisions.md`)

## Accomplishments
- Appended one well-formed `## D15 —` entry to `docs/decisions.md`, preserving the file's `---` separator convention (15 entries, 15 rules, file still ends on prose)
- Recorded the design tension between packaging-via-env-vars and D-16's pinned-constant safeguard, with the honest coupling inventory (recipe table list, spot-check projection, `-U recipe_app -d recipe_dev`, pinned env.ts constants, project-scoped env var names)
- Proposed `db-safety.config.ts` (source-committed, zod-validated) as the resolution, and a three-layer package shape (npm package / scaffold-template / Claude Code plugin-skill)
- Recorded that restore-drill evidence never transfers between projects, tied explicitly to D7's re-arming consequence
- Recommended extraction timing (end of Phase 5) and one preparatory step (consolidate identity into a single config module before Phase 3) as recommendations only, not work performed
- Marked the npm distribution mechanism and the absence of a second consuming project as literal UNKNOWNs
- Confirmed via automated gates that no connection string or credential-shaped material entered the document, and that no file outside `docs/decisions.md` was modified

## Task Commits

Each task was committed atomically:

1. **Task 1: Append the D15 entry to docs/decisions.md** + **Task 2: Confirm honesty gates and scope containment** — `2699dc5` (docs)

_Note: Task 2 was a read-and-check task with no additional file changes, so it did not produce a separate commit; both tasks' work landed in the single D15 append commit._

## Files Created/Modified
- `docs/decisions.md` - Appended D15 (PROPOSED packaging strategy for backup/restore-drill tooling)

## Decisions Made
- D15 recorded as PROPOSED, not ACCEPTED — see key-decisions above for the substance.

## Deviations from Plan

**1. [Self-correction during Task 1 verification] Missing `**Consequence:**` heading**
- **Found during:** Task 1's automated verify gate (first run failed: `grep -q '^\*\*Consequence' /tmp/d15.txt` had zero matches)
- **Issue:** The initial D15 draft used a `**What does not transfer:**` heading for the non-transferability section instead of the file's established `**Consequence:**` convention that the plan's `<action>` and `<done>` criteria required.
- **Fix:** Renamed the heading to `**Consequence:**` (keeping "What does not transfer" as the lead-in phrase within the paragraph) so the section both satisfies the automated gate and matches D1-D14's established sub-heading convention.
- **Files modified:** `docs/decisions.md` (pre-commit, same edit session — not a separate commit)
- **Verification:** Re-ran Task 1's automated gate; `D15_OK` printed.
- **Committed in:** `2699dc5` (the fix was made before the commit, so it is not a separate commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - self-correction against the plan's own verify gate, caught before commit)
**Impact on plan:** No scope or content change beyond a heading correction; the entry's substance was unaffected.

## Issues Encountered
None beyond the deviation above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- D15 is recorded and available for reference before Phase 3 begins.
- The recommended preparatory step (consolidating `scripts/env.ts`/`scripts/backup.ts`/`scripts/drill-assertions.ts` identity into a single config module) is NOT done — it remains a recommendation only, per scope boundary. Phase 3 planning should decide whether to act on it before adding new hardcoding sites.
- No blockers.

## Self-Check: PASSED

- FOUND: `docs/decisions.md` (D15 entry present, verified by grep gates)
- FOUND: commit `2699dc5` in `git log --oneline --all`
- FOUND: `.planning/quick/260907-r6z-add-decision-d15-to-docs-decisions-md-do/260907-r6z-SUMMARY.md`

---
*Quick task: 260907-r6z*
*Completed: 2026-09-07*
