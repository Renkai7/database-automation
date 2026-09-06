# Documentation Roadmap

Written in dependency order, not all at once — several documents cannot be written
honestly until the relevant phase has actually been performed.

| # | Document | Status |
|---|---|---|
| 00 | [Current state inventory](00-current-state.md) | Live |
| — | [Decision log](decisions.md) | Live |
| 10 | [Implementation roadmap](10-roadmap.md) | Live |
| 01 | System architecture | Phase 0 |
| 04 | Drizzle migration workflow | Phase 0 |
| 06 | Migration safety rules | Phase 2 |
| 08 | Backup and restore runbook | **Phase 1 — written from a real restore, not from docs** |
| 03 | Database environment model | Phase 5 |
| 05 | Production credential model | Phase 5 |
| 07 | CI/CD flow | Phase 4 |
| 02 | Threat / failure model | Phase 4 |
| 09 | Logging / audit model | Phase 6 |

## Reference

- [Original project brief](original-brief.md) — the source document.
  Note it is a *meta-document*: its opening and closing sections are advice about what
  brief to write; the brief proper runs from "# Database Deployment Automation" to
  "# First Task".
