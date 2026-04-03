# Feature Map

> Single source of truth for feature identity, state, acceptance criteria, and relationships.
> Auto-enriched by `@cap-feature` tags and dependency analysis.

## Features

### F-001: Tag Scanner [shipped]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Extract @cap-feature, @cap-todo, @cap-risk, @cap-decision tags from source files |
| AC-2 | tested | Language-agnostic regex-based extraction (JS, TS, Python, Ruby, Shell, Go, Rust, etc.) |
| AC-3 | tested | Parse parenthesized key:value metadata blocks |
| AC-4 | tested | Detect @cap-todo subtypes (risk:, decision:) |
| AC-5 | tested | Exclude node_modules, .git, dist, build, coverage directories by default |
| AC-6 | tested | Support monorepo scanning across workspace packages |

**Files:**
- `cap/bin/lib/cap-tag-scanner.cjs`

### F-002: Feature Map Management [shipped]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Read and parse FEATURE-MAP.md into structured Feature/AC objects |
| AC-2 | tested | Write structured data back to FEATURE-MAP.md markdown format |
| AC-3 | tested | Generate empty template with section headers |
| AC-4 | tested | Enforce feature state lifecycle: planned -> prototyped -> tested -> shipped |
| AC-5 | tested | Support acceptance criteria with status tracking |
| AC-6 | tested | Feature ID format: F-NNN (zero-padded) |

**Files:**
- `cap/bin/lib/cap-feature-map.cjs`
- `tests/cap-tag-scanner.test.cjs`

### F-003: Session State Management [shipped]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Manage .cap/SESSION.json for cross-conversation workflow state |
| AC-2 | tested | Track active feature ID, current workflow step, session timestamps |
| AC-3 | tested | SESSION.json is ephemeral (gitignored) |
| AC-4 | tested | Support active debug session tracking |
| AC-5 | tested | Extensible metadata key-value store |

**Files:**
- `cap/bin/lib/cap-session.cjs`

### F-004: Stack Docs / Context7 Integration [shipped]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Wrap npx ctx7@latest CLI for library documentation fetch |
| AC-2 | tested | Cache docs as markdown in .cap/stack-docs/{library-name}.md |
| AC-3 | tested | Detect project dependencies from package.json/requirements.txt/etc. |
| AC-4 | tested | Freshness window (7 days) for cached documentation |
| AC-5 | tested | Graceful failure handling for network errors and rate limits |

**Files:**
- `cap/bin/lib/cap-stack-docs.cjs`

### F-005: Doctor Health Check [shipped]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Check required tools: Node.js, npm, git |
| AC-2 | tested | Check optional tools: ctx7, c8, vitest, fast-check |
| AC-3 | tested | Project-specific checks when package.json exists |
| AC-4 | tested | Return structured DoctorReport with install hints for missing tools |
| AC-5 | tested | Distinguish required vs optional tool failures in health status |

**Files:**
- `cap/bin/lib/cap-doctor.cjs`

### F-006: GSD-to-CAP Migration [shipped]

**Depends on:** F-001

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Convert @gsd-* tags to @cap-* equivalents via regex replacement |
| AC-2 | tested | Map GSD tag types to CAP tag types (feature, todo, risk, decision) |
| AC-3 | tested | Remove GSD-only tags that have no CAP equivalent |
| AC-4 | tested | Dry-run mode as default safety net for destructive file writes |
| AC-5 | tested | Detect and report GSD planning artifacts (.planning/ directory) |

**Files:**
- `cap/bin/lib/cap-migrate.cjs`

### F-007: Test Audit [shipped]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Count assertions per test file using regex pattern matching |
| AC-2 | tested | Detect weak assertion anti-patterns |
| AC-3 | tested | Simple mutation engine: flip operators, negate conditions, remove returns |
| AC-4 | tested | Parse coverage reports from c8/istanbul JSON output |
| AC-5 | tested | Generate trust score from assertion density, coverage, and mutation survival |

**Files:**
- `cap/bin/lib/cap-test-audit.cjs`

### F-008: Multi-Runtime Installer [shipped]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Install CAP agents, commands, and hooks for Claude Code |
| AC-2 | tested | Support OpenCode, Gemini, Codex, Copilot, Cursor, and Windsurf runtimes |
| AC-3 | tested | Copy agent and command markdown to runtime-specific config directories |
| AC-4 | tested | Register hooks (statusline, prompt guard, context monitor, update checker, workflow guard) |
| AC-5 | tested | Rewrite relative paths to absolute install paths during copy |

**Files:**
- `bin/install.js`

### F-009: Hooks System [shipped]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Prompt injection guard: scan file writes for injection patterns |
| AC-3 | tested | Update checker: background npm version check with cached results |
| AC-4 | tested | Context monitor: warn when context window usage exceeds thresholds |
| AC-5 | tested | Workflow guard: detect file edits outside active workflow context |
| AC-6 | tested | Build script validates JS syntax before copying hooks to dist |

**Files:**
- `hooks/cap-prompt-guard.js`
- `hooks/cap-statusline.js`
- `hooks/cap-check-update.js`
- `hooks/cap-context-monitor.js`
- `hooks/cap-workflow-guard.js`
- `scripts/build-hooks.js`

### F-011: Legacy GSD Modules [shipped]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Core shared utilities (path helpers, config loading, git operations) |
| AC-2 | tested | Phase CRUD and lifecycle operations |
| AC-3 | tested | State progression engine (STATE.md) |
| AC-4 | tested | YAML frontmatter parsing and serialization |
| AC-5 | tested | Security: path traversal prevention, prompt injection detection |
| AC-6 | tested | Model profile mapping (quality/balanced/budget per agent) |

**Files:**
- `cap/bin/lib/core.cjs`
- `cap/bin/lib/commands.cjs`
- `cap/bin/lib/init.cjs`
- `cap/bin/lib/config.cjs`
- `cap/bin/lib/phase.cjs`
- `cap/bin/lib/state.cjs`
- `cap/bin/lib/roadmap.cjs`
- `cap/bin/lib/template.cjs`
- `cap/bin/lib/milestone.cjs`
- `cap/bin/lib/verify.cjs`
- `cap/bin/lib/uat.cjs`
- `cap/bin/lib/workstream.cjs`
- `cap/bin/lib/frontmatter.cjs`
- `cap/bin/lib/security.cjs`
- `cap/bin/lib/model-profiles.cjs`

### F-012: Monorepo Support [shipped]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Auto-detect NX, Turbo, and pnpm workspaces |
| AC-2 | tested | Per-app scoped planning directories |
| AC-3 | tested | Session manager persists current app selection across commands |
| AC-4 | tested | Manifest generator extracts public API surface from shared packages |
| AC-5 | tested | Migration support for flat-to-monorepo layout conversion |

**Files:**
- `cap/bin/lib/workspace-detector.cjs`
- `cap/bin/lib/monorepo-context.cjs`
- `cap/bin/lib/monorepo-migrator.cjs`
- `cap/bin/lib/session-manager.cjs`
- `cap/bin/lib/manifest-generator.cjs`

### F-013: Convention and Skeleton Generation [shipped]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Discover existing project conventions (module type, naming, test pattern) |
| AC-2 | tested | Generate skeleton file tree for architecture mode |
| AC-3 | tested | Auto-detect test framework (vitest, jest, mocha, ava, node:test) |

**Files:**
- `cap/bin/lib/convention-reader.cjs`
- `cap/bin/lib/skeleton-generator.cjs`
- `cap/bin/lib/test-detector.cjs`

### F-014: Developer Profiling [shipped]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Scan Claude Code session history for user message extraction |
| AC-2 | tested | Multi-project sampling with recency weighting |
| AC-3 | tested | Generate USER-PROFILE.md from behavioral analysis |
| AC-4 | tested | Render dev-preferences.md for CLAUDE.md |

**Files:**
- `cap/bin/lib/profile-pipeline.cjs`
- `cap/bin/lib/profile-output.cjs`

### F-015: Legacy ARC Scanner [shipped]

**Depends on:** F-011

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Extract @gsd-* annotation tags from source files (predecessor to F-001) |
| AC-2 | tested | Auto-generate FEATURES.md from PRD acceptance criteria and code tag status |
| AC-3 | tested | Dual-input design: PRD ACs authoritative, code tags refine completion |

**Files:**
- `cap/bin/lib/arc-scanner.cjs`
- `cap/bin/lib/feature-aggregator.cjs`

### F-016: Rename Hook Files to CAP Prefix [shipped]

**Depends on:** F-008, F-009

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Rename hooks/gsd-*.js to hooks/cap-*.js (5 source files) |
| AC-2 | tested | Rename hooks/dist/gsd-*.js to hooks/dist/cap-*.js (5 dist files) |
| AC-3 | tested | Update build-hooks.js to reference cap-* filenames |
| AC-4 | tested | Update install.js hook registration to use cap-* filenames |
| AC-5 | tested | Update all settings.json hook path references in installer output |
| AC-6 | tested | Existing installs must still work after update (backwards compat in installer) |

**Files:**
- `hooks/cap-prompt-guard.js`
- `hooks/cap-statusline.js`
- `hooks/cap-check-update.js`
- `hooks/cap-context-monitor.js`
- `hooks/cap-workflow-guard.js`
- `scripts/build-hooks.js`
- `bin/install.js`

### F-017: Migrate GSD Comment Tags to CAP [shipped]

**Depends on:** F-001

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Convert @gsd-todo to @cap-todo in all CJS source files |
| AC-2 | tested | Convert @gsd-decision to @cap-todo decision: in all CJS source files |
| AC-3 | tested | Convert @gsd-risk to @cap-todo risk: in all CJS source files |
| AC-4 | tested | Remove or convert @gsd-context, @gsd-constraint, @gsd-pattern, @gsd-ref tags |
| AC-5 | tested | Convert @gsd-api to plain comment (strip tag prefix) |
| AC-6 | tested | Zero @gsd-* tags remain in cap/bin/lib/, hooks/, scripts/ (excluding cap-migrate.cjs) |

**Files:**
- `cap/bin/lib/cap-tag-scanner.cjs`
- `cap/bin/lib/cap-feature-map.cjs`
- `cap/bin/lib/cap-session.cjs`

### F-018: Clean GSD Strings and Config [shipped]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Fix config.cjs tag_prefix from @gsd- to @cap- |
| AC-2 | tested | Update statusline header from GSD Edition to CAP Edition |
| AC-3 | tested | Update workflow guard messages to reference /cap: commands instead of /gsd: |
| AC-4 | tested | Rename GSD_TEST_MODE env var to CAP_TEST_MODE |
| AC-5 | tested | Update installer template vars GSD_VERSION, GSD_ARGS to CAP_VERSION, CAP_ARGS |
| AC-6 | tested | Update workstream.cjs to reference CAP commands instead of GSD |

**Files:**
- `cap/bin/lib/config.cjs`
- `hooks/cap-statusline.js`
- `hooks/cap-workflow-guard.js`
- `cap/bin/lib/workstream.cjs`
- `bin/install.js`

### F-019: Implement Module Integrity Verification [shipped]

**Depends on:** F-005

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Doctor shall verify that every required CJS module in cap/bin/lib/*.cjs exists at the expected install path |
| AC-2 | pending | Doctor shall attempt to require() each module and report any that fail to load (syntax errors, missing dependencies) |
| AC-3 | pending | Doctor shall report a clear PASS/FAIL summary per module with the specific error reason |
| AC-4 | pending | Module integrity check shall run automatically as part of /cap:doctor with no additional flags |
| AC-5 | pending | Module integrity check shall compare installed modules against a manifest of expected modules |
| AC-6 | pending | Integrity check shall test platform-specific path resolution (Linux vs macOS $HOME expansion, symlinks) |

**Files:**
- `cap/bin/lib/cap-doctor.cjs`
- `tests/cap-doctor-integrity.test.cjs`

### F-020: Add Resilient Module Loading with Error Recovery [shipped]

**Depends on:** F-019

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | When a require() call for a CAP module fails, display a specific error naming the missing module and its expected path |
| AC-2 | pending | Error message shall suggest running `npx code-as-plan@latest --force` as repair command |
| AC-3 | pending | System shall never silently fall back to manual mode — a missing module must always produce a visible error |
| AC-4 | pending | System shall offer an automatic self-repair option that re-runs the installer when a missing module is detected |
| AC-5 | pending | If self-repair succeeds, retry the original operation without requiring the user to re-enter the command |
| AC-6 | pending | If self-repair fails, exit with a non-zero code and a clear message directing the user to reinstall manually |

**Files:**
- `cap/bin/lib/cap-loader.cjs`
- `tests/cap-loader.test.cjs`

### F-021: Harden Installer Upgrade Path [shipped]

**Depends on:** F-008

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Installer shall remove stale files from previous installs (including GSD-era filenames) before writing new files |
| AC-2 | pending | Installer shall run a post-install integrity check verifying all expected modules are present and loadable |
| AC-3 | pending | Installer shall support a --force flag that performs a clean reinstall (delete target directory, reinstall from scratch) |
| AC-4 | pending | Installer shall handle path changes between versions by mapping old install locations to new ones during upgrade |
| AC-5 | pending | Installer shall log a summary of files added, removed, and updated during the upgrade process |
| AC-6 | pending | If post-install verification fails, installer shall exit with a non-zero code and report which modules are missing |
| AC-7 | pending | Installer shall work cross-platform — resolve $HOME correctly on Linux and macOS, handle symlinks, no hardcoded paths |

**Files:**
- `bin/install.js`
- `tests/install-hardening.test.cjs`

### F-022: Deploy-Aware Debug Workflow [shipped]

**Depends on:** F-005

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Every debug cycle starts with a hypothesis defining expected outcome and local verification step before code is changed |
| AC-2 | pending | Verify-before-deploy gate must pass before any deploy — local test/check proving the fix makes sense |
| AC-3 | pending | Every deploy is logged in a deploy logbook (.cap/debug/DEPLOY-LOG-{session}.md): hypothesis, changes, expected result, actual result |
| AC-4 | pending | Debugger shall batch hypotheses — multiple fixes per deploy with individual log markers instead of one deploy per hypothesis |
| AC-5 | pending | After a failed deploy cycle the agent must read the logbook and shall not re-pursue already-disproven hypotheses |
| AC-6 | pending | Debug logs inserted into code are tracked in a separate logbook section and cleaned up at end of session |
| AC-7 | pending | User provides actual result after each deploy (pass/fail + description) — agent waits actively instead of proceeding autonomously |

### F-023: Emoji-Enhanced AC Status and Human Verification Checklist [shipped]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | After /cap:prototype, display AC table with emoji status indicators: ✅ tested, 🔨 prototyped, 📋 pending, ⚠️ partial |
| AC-2 | pending | After /cap:test, display AC table with emoji status indicators |
| AC-3 | pending | After /cap:test, auto-generate a Human Verification Checklist with emoji categories (🔍 Manual check, 🌐 Browser test, 🔐 Permissions, ⚡ Performance) |
| AC-4 | pending | Verification checklist items derived from ACs — each AC not fully automatable becomes a checklist item |
| AC-5 | pending | Checklist formatted as markdown checkboxes (- [ ]) so user can check off items directly |
| AC-6 | pending | Emoji formatting appears in terminal command output only — FEATURE-MAP.md and other stored files remain emoji-free |

### F-024: Pre-Work Pitfall Research [shipped]

**Depends on:** F-004

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Before /cap:prototype, detect which technologies/services are involved (from package.json, ACs, code context) |
| AC-2 | pending | For detected technologies, automatically research known pitfalls via Context7 docs and web search |
| AC-3 | pending | Present research as a Pitfall Briefing to the user — known problems, common mistakes, workarounds |
| AC-4 | pending | Briefing shall be prioritized: critical pitfalls (causing hours of debugging) at top, nice-to-know at bottom |
| AC-5 | pending | Prototyper/debugger agent receives the briefing as context so it avoids known pitfalls when writing code |
| AC-6 | pending | Pitfall briefing persisted in .cap/pitfalls/{feature-id}.md for later reference |
| AC-7 | pending | User can skip research with --skip-research flag when they already know the technology well |
| AC-8 | pending | /cap:debug shall also trigger pitfall research for the technologies involved in the bug, surfacing known issues before investigation begins |

### F-025: Implement Session Extract CLI [shipped]

**Depends on:** F-003

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Provide a `cap extract list` subcommand that displays all Claude sessions with date, file size, turn count, and a short preview of the first user message |
| AC-2 | pending | Provide a `cap extract stats <session#>` subcommand that outputs token counts (input/output), tool usage distribution by tool name, session duration, and total turn count as structured Markdown |
| AC-3 | pending | Provide a `cap extract <session#> conversation` subcommand that outputs user/assistant dialogue turns as Markdown, excluding tool calls and system messages |
| AC-4 | pending | Provide a `cap extract <session#> code` subcommand that extracts all file writes and edits grouped by file path with operation type |
| AC-5 | pending | Provide a `cap extract <session#> summary` subcommand that outputs a structured Markdown summary containing decisions, files changed, features touched, and key outcomes |
| AC-6 | pending | Implement core extraction logic in `cap/bin/lib/cap-session-extract.cjs` by migrating existing `.claude/hooks/session-extract.js` to CJS with zero external dependencies |
| AC-7 | pending | Register `extract` as a subcommand of `npx code-as-plan` with standard help text and error handling |
| AC-8 | pending | Support session references by both numeric index (most recent = 1) and date-based lookup |

**Files:**
- `cap/bin/lib/cap-session-extract.cjs`

### F-026: Implement Cross-Session Aggregation [shipped]

**Depends on:** F-025

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Provide a `cap extract decisions --all` subcommand that scans all sessions and outputs decisions with session date and context as structured Markdown |
| AC-2 | pending | Provide a `cap extract hotspots` subcommand that ranks files by edit frequency across all sessions |
| AC-3 | pending | Provide a `cap extract timeline` subcommand that outputs a chronological Markdown view of work across sessions |
| AC-4 | pending | Provide a `cap extract cost` subcommand that aggregates token usage across sessions with configurable per-token rates |
| AC-5 | pending | All cross-session subcommands shall support a `--since <date>` flag to filter sessions by date range |
| AC-6 | pending | Reuse single-session parsing logic from F-025 without duplicating extraction code |

**Files:**
- `cap/bin/lib/cap-session-extract.cjs`

### F-027: Build Memory Accumulation Engine [planned]

**Depends on:** F-025, F-026

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Read parsed session data from F-025 (parseSession, extractTextContent, extractToolUses) and F-026 (extractDecisionsAll, extractHotspots) as sole input source |
| AC-2 | pending | Detect four memory categories from session data: decisions, pitfalls, patterns, and hotspots |
| AC-3 | pending | Enforce cross-session noise threshold — file must be edited in at least 2 separate sessions before qualifying as @cap-history hotspot |
| AC-4 | pending | Only emit pitfall entries from debug sessions or from explicit @cap-decision tags containing failure/workaround context |
| AC-5 | pending | Only emit pattern entries when the same approach has been successfully applied in at least 2 sessions |
| AC-6 | pending | Implement relevance-based aging — annotations without associated file edits within N sessions (default 5) shall be marked stale and queued for removal |
| AC-7 | pending | Support pinned:true attribute on @cap-pitfall entries that exempts them from aging and expiry |
| AC-8 | pending | Output structured memory entry objects (category, file, content, metadata) consumable by F-028 and F-029 |

**Files:**
- `cap/bin/lib/cap-memory-engine.cjs`

### F-028: Implement Code Annotation Writer [planned]

**Depends on:** F-027, F-001

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Insert @cap-history, @cap-pitfall, and @cap-pattern annotations into source files at file-top block alongside existing @cap-feature tags |
| AC-2 | pending | Detect correct comment syntax for target file based on extension (// for JS/TS/Go/Rust, # for Python/Ruby/Shell, -- for SQL/Lua) |
| AC-3 | pending | Update existing annotations in-place when metadata changes without creating duplicates |
| AC-4 | pending | Remove annotations marked as stale by the aging logic in F-027 |
| AC-5 | pending | Format annotations with parenthesized metadata matching existing tag conventions — e.g., @cap-history(sessions:3, edits:8, since:2026-03-15) |
| AC-6 | pending | Be parseable by existing tag scanner (F-001) without modifications to scanner regex |
| AC-7 | pending | Support dry-run mode that reports changes without writing to disk |

**Files:**
- `cap/bin/lib/cap-annotation-writer.cjs`

### F-029: Manage Cross-File Memory Directory [planned]

**Depends on:** F-027

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Write aggregated memory entries to .cap/memory/ as four markdown files: decisions.md, hotspots.md, patterns.md, pitfalls.md |
| AC-2 | pending | Auto-generate from accumulated session data — manual edits outside pinned entries are overwritten on regeneration |
| AC-3 | pending | Each entry shall include source session date, related files, and human-readable summary |
| AC-4 | pending | hotspots.md shall rank files by cross-session edit frequency with session count and date range |
| AC-5 | pending | Code annotations written by F-028 shall include cross-reference link to relevant memory file section |
| AC-6 | pending | Generate stable anchor IDs for each entry so cross-reference links remain valid across regenerations |
| AC-7 | pending | .cap/memory/ directory shall be git-committable (not gitignored) so project memory persists across clones |

**Files:**
- `cap/bin/lib/cap-memory-dir.cjs`

### F-030: Wire Memory Automation Hook and Command [planned]

**Depends on:** F-027, F-028, F-029, F-009

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Post-session hook (hooks/cap-memory.js) shall trigger the F-027→F-028→F-029 pipeline automatically after session end |
| AC-2 | pending | Hook shall register via existing hooks system (F-009) and be installed by multi-runtime installer (F-008) |
| AC-3 | pending | /cap:memory command shall provide manual trigger of full memory pipeline |
| AC-4 | pending | /cap:memory pin subcommand to mark @cap-pitfall annotation as pinned:true |
| AC-5 | pending | /cap:memory unpin subcommand to remove pinned:true from annotation |
| AC-6 | pending | /cap:memory status subcommand shall display summary: total annotations by category, stale count, pinned count, last-run timestamp |
| AC-7 | pending | Hook shall complete within 5 seconds for projects with up to 50 session files |
| AC-8 | pending | Hook shall be skippable via CAP_SKIP_MEMORY=1 environment variable for CI contexts |

**Files:**
- `hooks/cap-memory.js`
- `commands/cap/memory.md`

## Legend

| State | Meaning |
|-------|---------|
| planned | Feature identified, not yet implemented |
| prototyped | Initial implementation exists |
| tested | Tests written and passing |
| shipped | Deployed / merged to main |

---
*Last updated: 2026-04-02T14:14:11.936Z*
