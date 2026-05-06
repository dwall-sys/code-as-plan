# Feature Map

> Synthetic V6.1 monorepo fixture for F-082 aggregation tests.
> Three sub-apps (apps/web, apps/api, packages/shared) referenced via the Rescoped Table.

## Features

### F-001: Root-level orchestration [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Root coordinator wiring across sub-apps |

**Files:**
- `scripts/orchestrate.js`

## Rescoped Feature Maps

| App | Path | Features |
|-----|------|----------|
| web | `apps/web/` | ~30 |
| api | `apps/api/` | ~30 |
| shared | `packages/shared/` | ~30 |

## Legend

| State | Meaning |
|-------|---------|
| planned | Feature identified, not yet implemented |
| prototyped | Initial implementation exists |
| tested | Tests written and passing |
| shipped | Deployed / merged to main |

---
*Last updated: 2026-05-06T15:00:00.000Z*
