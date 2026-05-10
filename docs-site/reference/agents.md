# Agent Reference

Quick lookup for all 9 agents shipped with CAP Pro 1.0. Detailed descriptions are in the [agent feature page](/features/agents).

## Per-feature (5)

| Agent | Modes | Spawned by |
|---|---|---|
| `cap-brainstormer` | (single mode) | `/cap:brainstorm` |
| `cap-prototyper` | `prototype`, `iterate`, `architecture`, `annotate` | `/cap:prototype`, `/cap:iterate`, `/cap:annotate` |
| `cap-validator` | `MODE: TEST`, `MODE: REVIEW`, `MODE: AUDIT` | `/cap:test`, `/cap:review`, `/cap:completeness` |
| `cap-debugger` | (single mode) | `/cap:debug` |
| `cap-designer` | (single mode) | `/cap:design`, `/cap:ui` |

## Project-wide (4)

| Agent | Modes | Spawned by |
|---|---|---|
| `cap-historian` | `MODE: SAVE`, `MODE: CONTINUE`, `MODE: FORK` | `/cap:save`, `/cap:start`, `/cap:continue`, `/cap:checkpoint`, `/cap:fork` |
| `cap-curator` | `MODE: STATUS`, `MODE: REPORT`, `MODE: CLUSTERS`, `MODE: LEARN-BOARD`, `MODE: DRIFT` | `/cap:status`, `/cap:report` |
| `cap-architect` | `MODE: AUDIT`, `MODE: REFACTOR`, `MODE: BOUNDARIES` | (not user-invoked; auto-trigger on architecture questions) |
| `cap-migrator` | `MODE: GSD`, `MODE: TAGS`, `MODE: FEATURE-MAP`, `MODE: MEMORY` | `/cap:migrate*` family |

## Tools available per agent

| Agent | Read | Write/Edit | Bash | Grep/Glob | WebSearch/Fetch | Task |
|---|---|---|---|---|---|---|
| `cap-brainstormer` | ✅ | — | ✅ | ✅ | — | — |
| `cap-prototyper` | ✅ | ✅ | ✅ | ✅ | — | — |
| `cap-validator` | ✅ | ✅ | ✅ | ✅ | — | — |
| `cap-debugger` | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| `cap-designer` | ✅ | ✅ | — | ✅ | ✅ | — |
| `cap-historian` | ✅ | ✅ (snapshots only) | ✅ | ✅ | — | — |
| `cap-curator` | ✅ | ✅ (`.cap/REPORT.md` only) | ✅ | ✅ | — | — |
| `cap-architect` | ✅ | — *(read-only)* | ✅ | ✅ | — | — |
| `cap-migrator` | ✅ | ✅ (with backup) | ✅ | ✅ | — | — |

## Permission modes

| Agent | Permission mode | Notes |
|---|---|---|
| `cap-prototyper`, `cap-validator`, `cap-debugger`, `cap-brainstormer` | `workspace-write` | Can edit code in your workspace |
| `cap-historian`, `cap-curator` | `workspace-write` (limited paths) | Only `.cap/snapshots/` and `.cap/REPORT.md` |
| `cap-architect` | `default` | Read-only — proposes, never applies |
| `cap-migrator` | `workspace-write` | Always plan-diff-apply-verify with rollback |
| `cap-designer` | `workspace-write` | Edits component files for visual fixes |
