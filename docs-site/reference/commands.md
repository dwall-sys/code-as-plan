# Command Reference

All 27 slash commands shipped with CAP Pro 1.0. Click a command name for details on its underlying agent.

## Initialisation

| Command | Purpose |
|---|---|
| `/cap:init` | Initialise project — create `.cap/`, `FEATURE-MAP.md`, run brownfield analysis |

## Per-feature workflow

| Command | Backend |
|---|---|
| `/cap:brainstorm` | [`cap-brainstormer`](/features/agents#cap-brainstormer) |
| `/cap:prototype` | [`cap-prototyper`](/features/agents#cap-prototyper) |
| `/cap:iterate` | [`cap-prototyper`](/features/agents#cap-prototyper) (iterate mode) |
| `/cap:test` | [`cap-validator`](/features/agents#cap-validator) (TEST) |
| `/cap:review` | [`cap-validator`](/features/agents#cap-validator) (REVIEW) |
| `/cap:debug` | [`cap-debugger`](/features/agents#cap-debugger) |
| `/cap:design` | [`cap-designer`](/features/agents#cap-designer) |
| `/cap:annotate` | [`cap-prototyper`](/features/agents#cap-prototyper) (annotate mode) |

## Project-wide

| Command | Backend |
|---|---|
| `/cap:status` | [`cap-curator`](/features/agents#cap-curator) (STATUS) |
| `/cap:start` | [`cap-historian`](/features/agents#cap-historian) (CONTINUE) |
| `/cap:save` | [`cap-historian`](/features/agents#cap-historian) (SAVE) |
| `/cap:continue` | [`cap-historian`](/features/agents#cap-historian) (CONTINUE, with snapshot ID) |
| `/cap:checkpoint` | [`cap-historian`](/features/agents#cap-historian) |
| `/cap:scan` | tag scanner |
| `/cap:trace` | tag scanner + git |
| `/cap:reconcile` | tag scanner + Feature Map |
| `/cap:memory` | memory pipeline (init, status, pin, show) |
| `/cap:learn` | memory pipeline |
| `/cap:completeness` | [`cap-validator`](/features/agents#cap-validator) (AUDIT) |
| `/cap:test-audit` | analyser |
| `/cap:deps` | analyser |
| `/cap:ui` | [`cap-designer`](/features/agents#cap-designer) |

## Migration

| Command | Backend |
|---|---|
| `/cap:migrate` | [`cap-migrator`](/features/agents#cap-migrator) (GSD) |
| `/cap:migrate-tags` | [`cap-migrator`](/features/agents#cap-migrator) (TAGS) |
| `/cap:migrate-feature-map` | [`cap-migrator`](/features/agents#cap-migrator) (FEATURE-MAP) |
| `/cap:migrate-memory` | [`cap-migrator`](/features/agents#cap-migrator) (MEMORY) |

## Per-runtime syntax

| Runtime | Syntax | Example |
|---|---|---|
| Claude Code | `/cap:<name>` | `/cap:prototype` |
| Gemini CLI | `/cap:<name>` | `/cap:prototype` |
| OpenCode | `/cap-<name>` | `/cap-prototype` |
| Codex | `$cap-<name>` | `$cap-prototype` |
| GitHub Copilot | `/cap-<name>` | `/cap-prototype` |
| Antigravity | `/cap-<name>` | `/cap-prototype` |
| Cursor | `cap-<name>` (mention skill) | `cap-prototype` |
| Windsurf | `/cap-<name>` | `/cap-prototype` |
