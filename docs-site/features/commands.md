# Slash Commands

CAP Pro adds 27 slash commands to your AI runtime. They fall into three groups: **per-feature workflow** (the 5 main steps), **project-wide tooling** (status, snapshots, memory), and **migration / maintenance**.

> Most of the time you don't need to type these — CAP Pro auto-recognises the workflow moment and invokes the right command. The commands exist as power-user explicit triggers.

## Per-feature workflow

| Command | Agent | Purpose |
|---|---|---|
| `/cap:brainstorm` | `cap-brainstormer` | Discover features, draft Feature Map entries with ACs |
| `/cap:prototype` | `cap-prototyper` | Build code from a `planned` feature, embed `@cap-*` tags |
| `/cap:iterate` | `cap-prototyper` (iterate mode) | Refine prototype, close `@cap-todo` tags |
| `/cap:test` | `cap-validator` (TEST) | RED-GREEN tests against ACs |
| `/cap:review` | `cap-validator` (REVIEW) | Two-stage review: AC + code quality |
| `/cap:debug` | `cap-debugger` | Scientific-method debugger with persistent state |
| `/cap:design` | `cap-designer` | UI/UX review against the 9-family aesthetic system |
| `/cap:annotate` | `cap-prototyper` (annotate mode) | Retroactively tag existing code |

## Project-wide

| Command | Backend | Purpose |
|---|---|---|
| `/cap:status` | `cap-curator` (STATUS) | Feature dashboard, drift indicators |
| `/cap:start` | `cap-historian` (CONTINUE) | Resume the last session, mtime-diff for changes |
| `/cap:save` | `cap-historian` (SAVE) | Snapshot the current session for later |
| `/cap:continue` | `cap-historian` (CONTINUE) | Resume a specific snapshot |
| `/cap:checkpoint` | `cap-historian` | Mid-session marker without full save |
| `/cap:scan` | tag-scanner | Re-extract `@cap-*` tags, refresh Feature Map |
| `/cap:trace` | tag-scanner + git | Walk a feature: Feature Map → tags → tests → commits |
| `/cap:memory` | memory pipeline | Manage `.cap/memory/` (decisions, pitfalls, patterns, hotspots) |
| `/cap:learn` | memory pipeline | Extract a learning from the current session |
| `/cap:reconcile` | tag-scanner + Feature Map | Find and resolve mismatches between code and Feature Map |
| `/cap:completeness` | `cap-validator` (AUDIT) | Compute the F-048 completeness score |
| `/cap:test-audit` | analyser | Test-quality analysis: assertion density, mutation testing, anti-patterns |
| `/cap:deps` | analyser | Dependency graph + freshness check |
| `/cap:ui` | `cap-designer` | UI-specific review |

## Initialisation

| Command | Purpose |
|---|---|
| `/cap:init` | Initialise project — create `.cap/`, `FEATURE-MAP.md`, run brownfield analysis |

## Migration

| Command | Backend | Purpose |
|---|---|---|
| `/cap:migrate` | `cap-migrator` (GSD) | Migrate legacy `gsd-*` files |
| `/cap:migrate-tags` | `cap-migrator` (TAGS) | Convert old tag formats |
| `/cap:migrate-feature-map` | `cap-migrator` (FEATURE-MAP) | Monolithic → sharded |
| `/cap:migrate-memory` | `cap-migrator` (MEMORY) | V5 → V6 memory layout |

## Per-runtime command syntax

The slash-prefix syntax depends on the runtime:

| Runtime | Syntax |
|---|---|
| Claude Code, Gemini, OpenCode | `/cap:prototype` |
| Codex | `$cap-prototype` |
| GitHub Copilot, Antigravity | `/cap-prototype` |
| Cursor | `cap-prototype` (mention the skill name) |
| Windsurf | `/cap-prototype` |

CAP Pro's installer handles the runtime-specific renaming for you.

## Retired commands

If you used `code-as-plan@7.x`, these commands are gone in CAP Pro 1.0:

| Retired | Replacement |
|---|---|
| `/cap:cluster` | `/cap:status` (calls `cap-curator MODE: CLUSTERS`) |
| `/cap:report` | `/cap:status` (calls `cap-curator MODE: REPORT`) |
| `/cap:refresh-docs` | `/cap:memory status` + native Context7 |
| `/cap:switch-app` | `/cap:start --app=<name>` |
| `/cap:quick`, `/cap:finalize` | Auto Frontend Sprint mode |
| `/cap:doctor`, `/cap:update`, `/cap:upgrade` | Re-run `npx cap-pro@latest` |
| `/cap:new-project` | `/cap:init` |

The CAP Pro installer auto-cleans these from previous installs. See [Migrating from `code-as-plan@7.x`](/guide/migrating).
