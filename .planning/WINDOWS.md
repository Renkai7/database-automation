---
schema_version: 1
open_count: 3
waived_count: 0
fixed_count: 0
total_count: 3
last_updated: 2026-09-07T22:35:27.932Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 01 | deviation | scripts/env.test.ts |  | Task 2 (tdd=true) had no genuine RED phase: all 7 tests passed on first run against Task 1's env.ts, which already satisfied every hardening behaviour (bare-var-before-zod ordering, credential-free messages). No implementation change was needed or made. | open |  | 2026-09-07T00:43:46.523Z |  |
| 2 | 02 | deviation | .env.example |  | Sandbox permission settings deny Read/Write/Bash access to .env and .env.example; the RECIPE_BACKUP_DESTINATION documentation block and the real .env value could not be written by the executor. Verified end-to-end with the var passed inline instead; user must add it to .env.example and their real .env manually. | open |  | 2026-09-07T21:07:19.259Z |  |
| 3 | 02 | deviation | scripts/restore-cluster.ts | 241 | Comment says the globals verdict is 'Printed again as the final line of output', but console.log("[db:restore:cluster] Complete.") runs after it, so the verdict is actually the second-to-last line. Owner (during the 02-05 human drill) looked at the last line first and did not find the verdict, costing a round trip. Not in plan 02-05's files_modified so left unfixed here; recorded per docs/20-restore-runbook.md. | open |  | 2026-09-07T22:35:27.932Z |  |

````json
[
  {
    "id": 1,
    "kind": "deviation",
    "phase": "01",
    "file": "scripts/env.test.ts",
    "line": null,
    "description": "Task 2 (tdd=true) had no genuine RED phase: all 7 tests passed on first run against Task 1's env.ts, which already satisfied every hardening behaviour (bare-var-before-zod ordering, credential-free messages). No implementation change was needed or made.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-07T00:43:46.523Z",
    "resolved_at": null
  },
  {
    "id": 2,
    "kind": "deviation",
    "phase": "02",
    "file": ".env.example",
    "line": null,
    "description": "Sandbox permission settings deny Read/Write/Bash access to .env and .env.example; the RECIPE_BACKUP_DESTINATION documentation block and the real .env value could not be written by the executor. Verified end-to-end with the var passed inline instead; user must add it to .env.example and their real .env manually.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-07T21:07:19.259Z",
    "resolved_at": null
  },
  {
    "id": 3,
    "kind": "deviation",
    "phase": "02",
    "file": "scripts/restore-cluster.ts",
    "line": 241,
    "description": "Comment says the globals verdict is 'Printed again as the final line of output', but console.log(\"[db:restore:cluster] Complete.\") runs after it, so the verdict is actually the second-to-last line. Owner (during the 02-05 human drill) looked at the last line first and did not find the verdict, costing a round trip. Not in plan 02-05's files_modified so left unfixed here; recorded per docs/20-restore-runbook.md.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-07T22:35:27.932Z",
    "resolved_at": null
  }
]
````
