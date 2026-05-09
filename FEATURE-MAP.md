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
- `.claude/cap/bin/lib/cap-tag-scanner.cjs`

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
- `.claude/cap/bin/lib/cap-feature-map.cjs`

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
- `.claude/cap/bin/lib/cap-session.cjs`

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
- `.claude/cap/bin/lib/cap-stack-docs.cjs`

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
- `.claude/cap/bin/lib/cap-doctor.cjs`

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
- `.claude/cap/bin/lib/cap-migrate.cjs`

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
- `.claude/cap/bin/lib/cap-test-audit.cjs`

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
- `.claude/hooks/cap-check-update.js`
- `.claude/hooks/cap-context-monitor.js`
- `.claude/hooks/cap-prompt-guard.js`
- `.claude/hooks/cap-statusline.js`
- `.claude/hooks/cap-workflow-guard.js`

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
- `.claude/cap/bin/lib/commands.cjs`
- `.claude/cap/bin/lib/config.cjs`
- `.claude/cap/bin/lib/core.cjs`
- `.claude/cap/bin/lib/frontmatter.cjs`
- `.claude/cap/bin/lib/init.cjs`
- `.claude/cap/bin/lib/milestone.cjs`
- `.claude/cap/bin/lib/model-profiles.cjs`
- `.claude/cap/bin/lib/phase.cjs`
- `.claude/cap/bin/lib/roadmap.cjs`
- `.claude/cap/bin/lib/security.cjs`
- `.claude/cap/bin/lib/state.cjs`
- `.claude/cap/bin/lib/template.cjs`
- `.claude/cap/bin/lib/uat.cjs`
- `.claude/cap/bin/lib/verify.cjs`
- `.claude/cap/bin/lib/workstream.cjs`

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
- `.claude/cap/bin/lib/manifest-generator.cjs`
- `.claude/cap/bin/lib/monorepo-context.cjs`
- `.claude/cap/bin/lib/monorepo-migrator.cjs`
- `.claude/cap/bin/lib/session-manager.cjs`
- `.claude/cap/bin/lib/workspace-detector.cjs`

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
- `.claude/cap/bin/lib/convention-reader.cjs`
- `.claude/cap/bin/lib/skeleton-generator.cjs`
- `.claude/cap/bin/lib/test-detector.cjs`

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
- `.claude/cap/bin/lib/profile-output.cjs`
- `.claude/cap/bin/lib/profile-pipeline.cjs`

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
- `.claude/cap/bin/lib/arc-scanner.cjs`
- `.claude/cap/bin/lib/feature-aggregator.cjs`

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
| AC-1 | tested | Doctor shall verify that every required CJS module in cap/bin/lib/*.cjs exists at the expected install path |
| AC-2 | tested | Doctor shall attempt to require() each module and report any that fail to load (syntax errors, missing dependencies) |
| AC-3 | tested | Doctor shall report a clear PASS/FAIL summary per module with the specific error reason |
| AC-4 | tested | Module integrity check shall run automatically as part of /cap:doctor with no additional flags |
| AC-5 | tested | Module integrity check shall compare installed modules against a manifest of expected modules |
| AC-6 | tested | Integrity check shall test platform-specific path resolution (Linux vs macOS $HOME expansion, symlinks) |

**Files:**
- `cap/bin/lib/cap-doctor.cjs`
- `tests/cap-doctor-integrity.test.cjs`
- `.claude/cap/bin/lib/cap-doctor.cjs`

### F-020: Add Resilient Module Loading with Error Recovery [shipped]

**Depends on:** F-019

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | When a require() call for a CAP module fails, display a specific error naming the missing module and its expected path |
| AC-2 | tested | Error message shall suggest running `npx code-as-plan@latest --force` as repair command |
| AC-3 | tested | System shall never silently fall back to manual mode — a missing module must always produce a visible error |
| AC-4 | tested | System shall offer an automatic self-repair option that re-runs the installer when a missing module is detected |
| AC-5 | tested | If self-repair succeeds, retry the original operation without requiring the user to re-enter the command |
| AC-6 | tested | If self-repair fails, exit with a non-zero code and a clear message directing the user to reinstall manually |

**Files:**
- `cap/bin/lib/cap-loader.cjs`
- `tests/cap-loader.test.cjs`
- `.claude/cap/bin/lib/cap-loader.cjs`

### F-021: Harden Installer Upgrade Path [shipped]

**Depends on:** F-008

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Installer shall remove stale files from previous installs (including GSD-era filenames) before writing new files |
| AC-2 | tested | Installer shall run a post-install integrity check verifying all expected modules are present and loadable |
| AC-3 | tested | Installer shall support a --force flag that performs a clean reinstall (delete target directory, reinstall from scratch) |
| AC-4 | tested | Installer shall handle path changes between versions by mapping old install locations to new ones during upgrade |
| AC-5 | tested | Installer shall log a summary of files added, removed, and updated during the upgrade process |
| AC-6 | tested | If post-install verification fails, installer shall exit with a non-zero code and report which modules are missing |
| AC-7 | tested | Installer shall work cross-platform — resolve $HOME correctly on Linux and macOS, handle symlinks, no hardcoded paths |

**Files:**
- `bin/install.js`
- `tests/install-hardening.test.cjs`

### F-022: Deploy-Aware Debug Workflow [shipped]

**Depends on:** F-005

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Every debug cycle starts with a hypothesis defining expected outcome and local verification step before code is changed |
| AC-2 | tested | Verify-before-deploy gate must pass before any deploy — local test/check proving the fix makes sense |
| AC-3 | tested | Every deploy is logged in a deploy logbook (.cap/debug/DEPLOY-LOG-{session}.md): hypothesis, changes, expected result, actual result |
| AC-4 | tested | Debugger shall batch hypotheses — multiple fixes per deploy with individual log markers instead of one deploy per hypothesis |
| AC-5 | tested | After a failed deploy cycle the agent must read the logbook and shall not re-pursue already-disproven hypotheses |
| AC-6 | tested | Debug logs inserted into code are tracked in a separate logbook section and cleaned up at end of session |
| AC-7 | tested | User provides actual result after each deploy (pass/fail + description) — agent waits actively instead of proceeding autonomously |

### F-023: Emoji-Enhanced AC Status and Human Verification Checklist [shipped]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | After /cap:prototype, display AC table with emoji status indicators: ✅ tested, 🔨 prototyped, 📋 pending, ⚠️ partial |
| AC-2 | tested | After /cap:test, display AC table with emoji status indicators |
| AC-3 | tested | After /cap:test, auto-generate a Human Verification Checklist with emoji categories (🔍 Manual check, 🌐 Browser test, 🔐 Permissions, ⚡ Performance) |
| AC-4 | tested | Verification checklist items derived from ACs — each AC not fully automatable becomes a checklist item |
| AC-5 | tested | Checklist formatted as markdown checkboxes (- [ ]) so user can check off items directly |
| AC-6 | tested | Emoji formatting appears in terminal command output only — FEATURE-MAP.md and other stored files remain emoji-free |

### F-024: Pre-Work Pitfall Research [shipped]

**Depends on:** F-004

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Before /cap:prototype, detect which technologies/services are involved (from package.json, ACs, code context) |
| AC-2 | tested | For detected technologies, automatically research known pitfalls via Context7 docs and web search |
| AC-3 | tested | Present research as a Pitfall Briefing to the user — known problems, common mistakes, workarounds |
| AC-4 | tested | Briefing shall be prioritized: critical pitfalls (causing hours of debugging) at top, nice-to-know at bottom |
| AC-5 | tested | Prototyper/debugger agent receives the briefing as context so it avoids known pitfalls when writing code |
| AC-6 | tested | Pitfall briefing persisted in .cap/pitfalls/{feature-id}.md for later reference |
| AC-7 | tested | User can skip research with --skip-research flag when they already know the technology well |
| AC-8 | tested | /cap:debug shall also trigger pitfall research for the technologies involved in the bug, surfacing known issues before investigation begins |

### F-025: Implement Session Extract CLI [shipped]

**Depends on:** F-003

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Provide a `cap extract list` subcommand that displays all Claude sessions with date, file size, turn count, and a short preview of the first user message |
| AC-2 | tested | Provide a `cap extract stats <session#>` subcommand that outputs token counts (input/output), tool usage distribution by tool name, session duration, and total turn count as structured Markdown |
| AC-3 | tested | Provide a `cap extract <session#> conversation` subcommand that outputs user/assistant dialogue turns as Markdown, excluding tool calls and system messages |
| AC-4 | tested | Provide a `cap extract <session#> code` subcommand that extracts all file writes and edits grouped by file path with operation type |
| AC-5 | tested | Provide a `cap extract <session#> summary` subcommand that outputs a structured Markdown summary containing decisions, files changed, features touched, and key outcomes |
| AC-6 | tested | Implement core extraction logic in `cap/bin/lib/cap-session-extract.cjs` by migrating existing `.claude/hooks/session-extract.js` to CJS with zero external dependencies |
| AC-7 | tested | Register `extract` as a subcommand of `npx code-as-plan` with standard help text and error handling |
| AC-8 | tested | Support session references by both numeric index (most recent = 1) and date-based lookup |

**Files:**
- `cap/bin/lib/cap-session-extract.cjs`
- `bin/install.js`
- `.claude/cap/bin/lib/cap-session-extract.cjs`

### F-026: Implement Cross-Session Aggregation [shipped]

**Depends on:** F-025

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Provide a `cap extract decisions --all` subcommand that scans all sessions and outputs decisions with session date and context as structured Markdown |
| AC-2 | tested | Provide a `cap extract hotspots` subcommand that ranks files by edit frequency across all sessions |
| AC-3 | tested | Provide a `cap extract timeline` subcommand that outputs a chronological Markdown view of work across sessions |
| AC-4 | tested | Provide a `cap extract cost` subcommand that aggregates token usage across sessions with configurable per-token rates |
| AC-5 | tested | All cross-session subcommands shall support a `--since <date>` flag to filter sessions by date range |
| AC-6 | tested | Reuse single-session parsing logic from F-025 without duplicating extraction code |

**Files:**
- `cap/bin/lib/cap-session-extract.cjs`
- `.claude/cap/bin/lib/cap-session-extract.cjs`

### F-027: Build Memory Accumulation Engine [tested]

**Depends on:** F-025, F-026

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Read parsed session data from F-025 (parseSession, extractTextContent, extractToolUses) and F-026 (extractDecisionsAll, extractHotspots) as sole input source |
| AC-2 | tested | Detect four memory categories from session data: decisions, pitfalls, patterns, and hotspots |
| AC-3 | tested | Enforce cross-session noise threshold — file must be edited in at least 2 separate sessions before qualifying as @cap-history hotspot |
| AC-4 | tested | Only emit pitfall entries from debug sessions or from explicit @cap-decision tags containing failure/workaround context |
| AC-5 | tested | Only emit pattern entries when the same approach has been successfully applied in at least 2 sessions |
| AC-6 | tested | Implement relevance-based aging — annotations without associated file edits within N sessions (default 5) shall be marked stale and queued for removal |
| AC-7 | tested | Support pinned:true attribute on @cap-pitfall entries that exempts them from aging and expiry |
| AC-8 | tested | Output structured memory entry objects (category, file, content, metadata) consumable by F-028 and F-029 |

**Files:**
- `cap/bin/lib/cap-memory-engine.cjs`
- `.claude/cap/bin/lib/cap-memory-engine.cjs`

### F-028: Implement Code Annotation Writer [tested]

**Depends on:** F-027, F-001

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Insert @cap-history, @cap-pitfall, and @cap-pattern annotations into source files at file-top block alongside existing @cap-feature tags |
| AC-2 | tested | Detect correct comment syntax for target file based on extension (// for JS/TS/Go/Rust, # for Python/Ruby/Shell, -- for SQL/Lua) |
| AC-3 | tested | Update existing annotations in-place when metadata changes without creating duplicates |
| AC-4 | tested | Remove annotations marked as stale by the aging logic in F-027 |
| AC-5 | tested | Format annotations with parenthesized metadata matching existing tag conventions — e.g., @cap-history(sessions:3, edits:8, since:2026-03-15) |
| AC-6 | tested | Be parseable by existing tag scanner (F-001) without modifications to scanner regex |
| AC-7 | tested | Support dry-run mode that reports changes without writing to disk |

**Files:**
- `cap/bin/lib/cap-annotation-writer.cjs`
- `.claude/cap/bin/lib/cap-annotation-writer.cjs`

### F-029: Manage Cross-File Memory Directory [tested]

**Depends on:** F-027

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Write aggregated memory entries to .cap/memory/ as four markdown files: decisions.md, hotspots.md, patterns.md, pitfalls.md |
| AC-2 | tested | Auto-generate from accumulated session data — manual edits outside pinned entries are overwritten on regeneration |
| AC-3 | tested | Each entry shall include source session date, related files, and human-readable summary |
| AC-4 | tested | hotspots.md shall rank files by cross-session edit frequency with session count and date range |
| AC-5 | tested | Code annotations written by F-028 shall include cross-reference link to relevant memory file section |
| AC-6 | tested | Generate stable anchor IDs for each entry so cross-reference links remain valid across regenerations |
| AC-7 | tested | .cap/memory/ directory shall be git-committable (not gitignored) so project memory persists across clones |

**Files:**
- `cap/bin/lib/cap-memory-dir.cjs`
- `.claude/cap/bin/lib/cap-memory-dir.cjs`

### F-030: Wire Memory Automation Hook and Command [shipped]

**Depends on:** F-027, F-028, F-029, F-009

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | `hooks/cap-memory.js:run()` orchestrates the F-027 → F-028 → F-029 pipeline: reads session files since `.cap/memory/.last-run`, accumulates tags + session hotspots, writes annotations, updates memory directory, and refreshes the F-034 graph |
| AC-2 | tested | Registered via `bin/install.js` (`capHooks` array at :3582, Stop-hook injection at :4655–4656) and built by `scripts/build-hooks.js:22`. Multi-runtime installer picks it up unchanged |
| AC-3 | tested | `/cap:memory` (no args) invokes the hook as a manual trigger; `init` subcommand forces full-history bootstrap |
| AC-4 | tested | `/cap:memory pin <file> <prefix>` calls `cap-memory-pin.pin()` which finds the matching `@cap-pitfall` annotation by description prefix and inserts `pinned:true` into its metadata block. Ambiguous prefixes return a `candidates` list |
| AC-5 | tested | `/cap:memory unpin <file> <prefix>` removes `pinned:true`; collapses empty metadata to `@cap-pitfall` without parens |
| AC-6 | tested | `/cap:memory status` reads `.cap/memory/.last-run` + counts entries in decisions/hotspots/patterns/pitfalls; inline node-e invocation in `commands/cap/memory.md` |
| AC-7 | tested | Hook tracks wall-clock; prints `cap-memory: warning — hook took Nms` to stderr when incremental run exceeds 5000ms. Init mode excluded from the budget by design |
| AC-8 | tested | `CAP_SKIP_MEMORY=1` short-circuits at `hooks/cap-memory.js:21`. Verified by the hook test suite |

**Files:**
- `hooks/cap-memory.js`
- `cap/bin/lib/cap-memory-pin.cjs`
- `commands/cap/memory.md`
- `tests/cap-memory-pin.test.cjs`
- `.claude/hooks/cap-memory.js`
- `.claude/cap/bin/lib/cap-memory-pin.cjs`

### F-031: Implement Conversation Thread Tracking [shipped]

**Depends on:** F-003, F-027

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Persist each brainstorm session as a named thread in .cap/memory/threads/ with unique thread ID, timestamp, and parent thread reference (if branched) |
| AC-2 | tested | Capture full discovery context per thread: problem statement, solution shape, boundary decisions, and resulting Feature Map entries (by F-ID) |
| AC-3 | tested | Detect when a brainstorm session revisits a topic covered by an existing thread by comparing problem-space keywords and referenced feature IDs |
| AC-4 | tested | Support thread branching — when a brainstorm diverges from an earlier thread, reference parent thread ID and divergence point |
| AC-5 | tested | Store thread metadata in .cap/memory/thread-index.json mapping thread IDs to feature IDs, timestamps, and branch relationships |
| AC-6 | tested | Thread data shall be git-committable (not gitignored) so conversation history persists across clones and team members |
| AC-7 | tested | cap-brainstormer agent shall automatically check thread index at session start and surface relevant prior threads before beginning discovery |

**Files:**
- `cap/bin/lib/cap-thread-tracker.cjs`
- `.claude/cap/bin/lib/cap-thread-tracker.cjs`
- `cap/bin/lib/cap-thread-migrator.cjs`

### F-032: Build Thread Reconnection and Synthesis Engine [shipped]

**Depends on:** F-031

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Present side-by-side comparison of previous thread conclusions versus new session direction when returning thread detected |
| AC-2 | tested | Propose one of four reconnection strategies: merge (combine threads), supersede (new replaces old), branch (both coexist), or resume (continue where left off) |
| AC-3 | tested | User shall explicitly approve or reject each reconnection proposal before any Feature Map changes are made |
| AC-4 | tested | When merge approved, produce unified AC set combining non-conflicting criteria and flagging conflicts for manual resolution |
| AC-5 | tested | When supersede approved, mark old thread as archived and update Feature Map entries that referenced old thread ACs |
| AC-6 | tested | Detect AC-level conflicts between threads — contradictory acceptance criteria from different brainstorm sessions |
| AC-7 | tested | Log synthesis results in .cap/memory/threads/ with resolution record documenting what was merged, split, or discarded and why |

**Files:**
- `cap/bin/lib/cap-thread-synthesis.cjs`
- `.claude/cap/bin/lib/cap-thread-synthesis.cjs`

### F-033: Implement Feature Impact Analysis [shipped]

**Depends on:** F-031, F-002

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Detect overlap between proposed feature and existing Feature Map entries by comparing AC descriptions, dependency chains, and referenced file paths |
| AC-2 | tested | Run overlap detection automatically during /cap:brainstorm before new Feature Map entries are proposed to user |
| AC-3 | tested | Present structured impact report: overlapping ACs with similarity reasoning, affected dependency chains, implementation file conflicts |
| AC-4 | tested | Trace full dependency chains — if A depends on B depends on C, changing B ACs shall surface impact on both A and C |
| AC-5 | tested | Propose concrete resolutions: merge ACs into existing feature, split into separate features, adjust dependency ordering, or flag as intentional duplication |
| AC-6 | tested | All proposals shall be advisory only — no Feature Map modifications, dependency reordering, or AC adjustments without explicit user approval |
| AC-7 | tested | Persist impact analysis results in .cap/memory/impact/{feature-id}.md for audit trail and future reference |
| AC-8 | tested | Detect circular dependency risks when new features are proposed and warn before Feature Map entries are written |

**Files:**
- `cap/bin/lib/cap-impact-analysis.cjs`
- `.claude/cap/bin/lib/cap-impact-analysis.cjs`

### F-034: Upgrade Memory to Connected Graph Structure [tested]

**Depends on:** F-027, F-031, F-033

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Maintain memory graph in .cap/memory/graph.json connecting features, threads, decisions, pitfalls, and patterns as typed nodes with labeled edges |
| AC-2 | tested | Support edge types: depends_on, supersedes, conflicts_with, branched_from, informed_by, relates_to |
| AC-3 | tested | Graph queryable by node type and traversal depth — e.g. show all decisions that informed F-005 within 2 hops |
| AC-4 | tested | Existing flat memory files from F-029 (decisions.md, hotspots.md, patterns.md, pitfalls.md) remain as human-readable views generated from graph |
| AC-5 | tested | Support temporal queries — what changed between session X and session Y via timestamps on all nodes and edges |
| AC-6 | tested | When node marked stale by F-027 aging logic, preserve edges as inactive so historical context is not lost |
| AC-7 | tested | Graph incrementally updatable — adding new session shall not require full graph reconstruction |
| AC-8 | tested | Graph data git-committable and merge-friendly — sorted keys, one-entry-per-line JSON to minimize merge conflicts |

**Files:**
- `.claude/cap/bin/lib/cap-memory-graph.cjs`
- `cap/bin/lib/cap-memory-graph.cjs`

### F-035: Detect In-Session Topic Divergence During Brainstorm [tested]

**Depends on:** F-031, F-032

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | During an active brainstorm, compare each new user message against the current thread keywords and detect when topic similarity drops below a configurable threshold (default: 0.15 overlap ratio) |
| AC-2 | tested | When divergence detected, proactively ask the user: create a branch thread for the new topic, stay on the current topic, or replace the current thread direction |
| AC-3 | tested | If branch chosen, automatically call branchThread() with the divergence point set to the last message before the topic shift |
| AC-4 | tested | Track topic evolution within a session by maintaining a running keyword set that updates with each user message — detect gradual drift not just sudden jumps |
| AC-5 | tested | After branch creation, continue the brainstorm on the new branch thread while preserving the parent thread state as-is |
| AC-6 | tested | At brainstorm end, persist all threads (parent + branches) and update the thread index with branch relationships |
| AC-7 | tested | Divergence detection shall not interrupt the conversation flow — present as a brief inline suggestion, not a blocking modal |

**Files:**
- `.claude/cap/bin/lib/cap-divergence-detector.cjs`
- `cap/bin/lib/cap-divergence-detector.cjs`

### F-036: Implement Multi-Signal Affinity Engine [tested]

**Depends on:** F-034, F-031

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | The module cap-affinity-engine.cjs shall compute a composite affinity score (0.0-1.0) between any two thread nodes in the memory graph by combining up to 8 weighted signal scores |
| AC-2 | tested | The engine shall support 8 named signals: feature-id-overlap, shared-files, temporal-proximity, causal-chains (realtime); concept-overlap, problem-space-similarity, shared-decisions-deep, transitive-connections (post-session) |
| AC-3 | tested | Each signal shall return an independent score (0.0-1.0) and a human-readable reason string explaining what drove the score |
| AC-4 | tested | Signal weights shall be configurable via .cap/config.json under the key affinityWeights with sensible defaults summing to 1.0 |
| AC-5 | tested | The engine shall classify composite scores into four bands: urgent (>=0.90), notify (0.75-0.89), silent (0.40-0.74), discard (<0.40) — band thresholds configurable via .cap/config.json |
| AC-6 | tested | Scores in the discard band (<0.40) shall not be persisted to graph.json — all other bands shall be stored as weighted edges with type affinity |
| AC-7 | tested | The engine shall be a pure logic module with no direct I/O — affinity computation functions take graph data as input and return structured results |
| AC-8 | tested | The full 8-signal scoring for a single thread pair shall complete within 200ms on a project with up to 100 thread nodes |

**Files:**
- `cap/bin/lib/cap-affinity-engine.cjs`

### F-037: Build Semantic Analysis Pipeline [tested]

**Depends on:** F-036

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Stage 1 shall compute TF-IDF cosine similarity (weight 0.5) between thread description texts using term-frequency vectors built from thread keywords and AC descriptions |
| AC-2 | tested | Stage 1 shall compute character N-Gram overlap (weight 0.2) using trigrams to catch partial word matches and typo-resilient similarity |
| AC-3 | tested | Stage 1 shall compute Jaccard keyword similarity (weight 0.1) over extracted keyword sets from thread metadata |
| AC-4 | tested | Stage 2 shall maintain an embedded seed taxonomy of 20-30 universal software concepts (e.g., authentication, caching, persistence, validation, routing) as a static array in the module — no external config file |
| AC-5 | tested | Stage 2 shall build a co-occurrence matrix that auto-learns concept associations from observed thread data and overrides seed weights when sufficient data exists (>=5 co-occurrences) |
| AC-6 | tested | Stage 2 shall compute concept vector similarity (weight 0.2) by projecting threads into the concept space and measuring cosine distance |
| AC-7 | tested | Stage 3 shall propagate affinity scores through the memory graph using iterative relaxation (3-5 iterations, damping factor 0.7) to discover transitive connections |
| AC-8 | tested | The pipeline shall be implemented as cap-semantic-pipeline.cjs, a pure logic module with no I/O — all functions take text/graph data as input and return numeric scores |

**Files:**
- `cap/bin/lib/cap-semantic-pipeline.cjs`

### F-038: Implement Neural Cluster Detection [tested]

**Depends on:** F-036, F-037, F-034

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | The module cap-cluster-detect.cjs shall perform single-linkage clustering over thread nodes using affinity scores from F-036 as the distance metric, with a configurable linkage threshold (default: 0.40) |
| AC-2 | tested | Each detected cluster shall receive an auto-generated dynamic label composed of the top 2-3 weighted concepts from the cluster members — labels are ephemeral and recalculated on each run |
| AC-3 | tested | Divergence-based decay shall be computed post-session using three drift metrics: file-drift (changed files no longer overlap), keyword-drift (thread keywords diverged), and cluster-drift (member affinity scores dropped) |
| AC-4 | tested | Decay shall reduce affinity edge weights in graph.json but never delete nodes — dormant nodes (all edges below silent threshold) shall remain in the graph with a dormant:true flag |
| AC-5 | tested | Dormant nodes shall automatically reactivate when a new session produces an affinity score above the silent threshold (>=0.40) with the dormant node |
| AC-6 | tested | There shall be no time-based decay — only measured divergence (file-drift, keyword-drift, cluster-drift) reduces affinity scores |
| AC-7 | tested | Cluster membership shall be stored as a computed property on thread nodes in graph.json with cluster ID and membership timestamp |
| AC-8 | tested | Clustering shall complete within 500ms for a graph with up to 200 nodes and 1000 edges |

**Files:**
- `cap/bin/lib/cap-cluster-detect.cjs`

### F-039: Implement Realtime Affinity Detection [tested]

**Depends on:** F-036, F-031, F-034

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | During an active session, the 4 realtime signals (feature-id-overlap, shared-files, temporal-proximity, causal-chains) shall be evaluated against all existing threads whenever the active thread context changes |
| AC-2 | tested | Realtime evaluation of all 4 signals against the full thread index shall complete within 200ms to avoid perceptible session lag |
| AC-3 | tested | Threads scoring in the urgent band (>=0.90) shall be surfaced as a full context block containing thread name, strongest signal with reasoning, and a load-context offer |
| AC-4 | tested | Threads scoring in the notify band (0.75-0.89) shall be surfaced as a compact single-line notification with thread name and the single strongest signal |
| AC-5 | tested | Threads scoring in the silent band (0.40-0.74) shall not produce any visible output — they are only queryable via /cap:status or explicit command |
| AC-6 | tested | The realtime detector shall integrate with cap-brainstormer at session start and with cap-thread-tracker when thread context is updated mid-session |
| AC-7 | tested | Realtime affinity results shall be cached in SESSION.json under the key realtimeAffinity so they persist across agent hand-offs within the same session |

**Files:**
- `cap/bin/lib/cap-realtime-affinity.cjs`

### F-040: Integrate Cluster Commands and Status Extension [shipped]

**Depends on:** F-038, F-039

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | /cap:cluster command shall display all detected clusters with their auto-generated labels, member thread names, and intra-cluster affinity scores |
| AC-2 | tested | /cap:cluster {cluster-label} shall display detailed view of a single cluster: all member threads, their pairwise affinity scores, shared concepts, and drift status |
| AC-3 | tested | /cap:status shall be extended with a Neural Memory section showing: active cluster count, dormant node count, highest-affinity thread pair, and last clustering timestamp |
| AC-4 | tested | /cap:start shall passively check realtime affinity and surface urgent/notify threads relevant to the selected feature before session work begins |
| AC-5 | tested | /cap:brainstorm shall passively check thread affinity at session start and present relevant prior threads (notify band and above) before beginning discovery questions |
| AC-6 | tested | The /cap:cluster command markdown shall be added to commands/cap/ following existing command file conventions (YAML frontmatter, structured sections) |
| AC-7 | tested | All cluster display output shall use the existing CAP status formatting conventions (markdown tables, consistent headers) for visual consistency |

**Files:**
- `cap/bin/lib/cap-cluster-display.cjs`
- `.claude/cap/bin/lib/cap-cluster-display.cjs`
- `.claude/cap/bin/lib/cap-cluster-format.cjs`
- `.claude/cap/bin/lib/cap-cluster-io.cjs`
- `cap/bin/lib/cap-cluster-format.cjs`
- `cap/bin/lib/cap-cluster-io.cjs`

### F-041: Fix Feature Map Parser Roundtrip Symmetry [tested]

**Depends on:** F-002

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | serializeFeatureMap shall preserve all AC status values that parseFeatureMapContent accepted, including those parsed from checkbox format `- [x]` / `- [ ]` |
| AC-2 | tested | A roundtrip test (parse → serialize → parse) shall produce structurally equivalent FeatureMap objects with identical AC counts, IDs, descriptions, and statuses |
| AC-3 | tested | serializeFeatureMap shall write status values that match the canonical lifecycle (pending, prototyped, tested, shipped) without lowercasing transformation losses |
| AC-4 | tested | parseFeatureMapContent shall not silently drop AC entries when both checkbox and table formats coexist in the same feature block |
| AC-5 | tested | The fix shall include a regression test loading the actual repository FEATURE-MAP.md and asserting roundtrip stability for F-019 through F-040 |
| AC-6 | tested | serializeFeatureMap shall emit Status lines as a serialization option to support the legacy non-table input format without forcing all features to table format on first write |

**Files:**
- `.claude/cap/bin/lib/cap-feature-map.cjs`
- `cap/bin/lib/cap-feature-map.cjs`
- `tests/cap-feature-map.test.cjs`

### F-042: Propagate Feature State Transitions to Acceptance Criteria [tested]

**Depends on:** F-002, F-041

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | updateFeatureState shall update child AC statuses according to a defined propagation rule when a feature transitions to tested or shipped |
| AC-2 | tested | The propagation rule shall be documented as: state prototyped does not change AC status; state tested promotes ACs from pending/prototyped to tested; state shipped requires all ACs already at tested and rejects the transition otherwise |
| AC-3 | tested | A new function setAcStatus(projectRoot, featureId, acId, newState, appPath) shall provide explicit per-AC state mutation for finer-grained control |
| AC-4 | tested | Status drift detection shall flag features where feature state is shipped/tested but one or more ACs are still pending, returning a structured drift report |
| AC-5 | tested | Tests shall cover all valid state-transition × AC-status combinations as a truth table |
| AC-6 | tested | The CLI shall expose cap status --drift to surface mismatched feature/AC states for the entire Feature Map |

**Files:**
- `.claude/cap/bin/lib/cap-feature-map.cjs`
- `cap/bin/lib/cap-feature-map.cjs`
- `tests/cap-feature-map.test.cjs`

### F-043: Reconcile Status Drift in Existing Feature Map [tested]

**Depends on:** F-041, F-042

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | A one-shot reconciliation script shall scan FEATURE-MAP.md and propose AC status updates for features F-019 through F-026 and F-036 through F-040 |
| AC-2 | tested | The script shall output a dry-run diff first, requiring explicit confirmation before writing changes |
| AC-3 | tested | F-027, F-028, F-029, F-034 shall have their feature state reconciled from planned to the correct lifecycle state based on actual code presence, verified via tag scanner |
| AC-4 | tested | The reconciliation shall preserve historical accuracy by emitting a .cap/memory/reconciliation-2026-04.md audit log of every state change |
| AC-5 | tested | A regression test shall assert that running the parser on the reconciled file produces zero drift warnings |

**Files:**
- `.claude/cap/bin/lib/cap-reconcile.cjs`
- `cap/bin/lib/cap-reconcile.cjs`
- `tests/cap-reconcile-adversarial.test.cjs`
- `tests/cap-reconcile.test.cjs`

### F-044: Audit and Right-Size Agent Behaviors for Opus 4.7 [tested]

**Depends on:** F-024

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | An audit document shall enumerate every Context7 fetch and convention-detection step performed by cap-prototyper, cap-tester, cap-reviewer, cap-debugger, and cap-brainstormer with rationale for keeping or removing each |
| AC-2 | tested | Pitfall research (F-024) shall become opt-in via an explicit --research flag rather than always-on, removing redundant Context7 calls for libraries the model already knows well |
| AC-3 | tested | Convention detection shall be replaced with a single high-signal probe (read CLAUDE.md + package.json) instead of 6 to 7 file reads, with the agent inferring the rest |
| AC-4 | tested | A measurable benchmark shall compare token usage and output quality before and after right-sizing across 5 representative tasks (prototype, iterate, test, review, debug) |
| AC-5 | tested | The 4-mode architecture of cap-prototyper shall be evaluated against a single-agent-with-explicit-prompt approach; the audit shall recommend keep/collapse/refactor with evidence |
| AC-6 | tested | All changes shall preserve the public command surface — /cap:prototype, /cap:test, etc. continue to work without user-facing breakage |

**Files:**
- `.claude/cap/bin/lib/convention-reader.cjs`
- `cap/bin/lib/convention-reader.cjs`
- `tests/cap-f044-audit.test.cjs`

### F-045: Improve AC-to-Code Traceability for Multi-File Acceptance Criteria [tested]

**Depends on:** F-001, F-002

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | The tag syntax shall support a primary:true flag on @cap-feature to designate the canonical implementation file when an AC spans multiple files |
| AC-2 | tested | cap-tag-scanner shall aggregate file references per AC and emit a structured acFileMap field showing all files contributing to each AC |
| AC-3 | tested | When no primary:true tag exists for a multi-file AC, the scanner shall log a warning and pick the file with the highest tag density as a heuristic primary |
| AC-4 | tested | A new /cap:trace AC-N command shall print the call graph from the primary file across referenced files for a given acceptance criterion |
| AC-5 | tested | Documentation shall describe the multi-file tagging convention with two worked examples (one JS, one TS) |

**Files:**
- `.claude/cap/bin/lib/cap-tag-scanner.cjs`
- `.claude/cap/bin/lib/cap-trace.cjs`
- `cap/bin/lib/cap-tag-scanner.cjs`
- `cap/bin/lib/cap-trace.cjs`
- `tests/cap-trace.test.cjs`

### F-046: Strengthen Polylingual Comment-Token Detection in Tag Scanner [tested]

**Depends on:** F-001

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | cap-tag-scanner shall correctly parse @cap-* tags inside Python (#, triple-quote), Ruby (#, =begin/=end), Shell (#), Go (//, /* */), Rust (//, ///, /* */), HTML (<!-- -->), and CSS (/* */) comment styles |
| AC-2 | tested | A test fixture shall contain at least one polyglot file per supported language with embedded @cap-feature, @cap-todo, @cap-risk, @cap-decision tags |
| AC-3 | tested | The scanner shall emit a structured warning when it encounters a @cap-* token outside any recognized comment context (e.g., string literal) rather than parsing it as a tag |
| AC-4 | tested | A new --strict mode shall fail the scan if any tag is found outside a comment, supporting CI enforcement |
| AC-5 | tested | Existing tests shall pass unchanged — this feature adds coverage without modifying the JS/TS parsing path |

**Files:**
- `.claude/cap/bin/lib/cap-tag-scanner.cjs`
- `cap/bin/lib/cap-tag-scanner.cjs`
- `tests/cap-tag-scanner-polylingual.test.cjs`
- `tests/fixtures/polyglot/example.go`
- `tests/fixtures/polyglot/example.py`
- `tests/fixtures/polyglot/example.rb`
- `tests/fixtures/polyglot/example.rs`
- `tests/fixtures/polyglot/example.sh`
- `tests/fixtures/polyglot/example_string_literal.py`
- `tests/cap-tag-scanner-polylingual-adversarial.test.cjs`
- `tests/fixtures/polyglot/example_js_string_comment.js`

### F-047: Unified Feature Anchor Block (CAP v3 — Optional, Breaking) [shipped]

**Depends on:** F-001, F-045, F-046

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | `cap-anchor.parseAnchorLine()` + `scanAnchorsInContent()` recognise `/* @cap feature:F-001 acs:[AC-1,AC-3] role:primary */`. `expandAnchorToTags()` emits the same `CapTag[]` shape as the legacy scanner; wired into `scanner.scanFile()` behind `options.unifiedAnchors` |
| AC-2 | tested | Legacy and unified formats coexist: scanner's legacy regex matches `@cap-feature` (hyphen) while the anchor regex matches `@cap ` (space). Both paths run when unified is enabled; tag objects are shape-compatible so downstream consumers dedupe naturally. The `--legacy-tags=warn` surface is delegated to the command layer (can be layered onto any command that inspects `tag.raw`) |
| AC-3 | tested | `cap-migrate-tags.cjs` provides `planProjectMigration()` (dry-run) and `applyMigrations()` (write). `/cap:migrate-tags` orchestrator confirms before writing. Idempotent — a second run detects `already-has-anchor`. Per-file diff preview via `formatMigrationReport()` |
| AC-4 | tested | `emitAnchorBlock(anchor, style)` supports `'block'` (`/* … */`), `'line'` (`# …`), `'html'` (`<!-- … -->`). `commentStyleForFile()` auto-picks by extension. Tests cover Python, Ruby, Shell, HTML fixtures via the expanded-tags round-trip |
| AC-5 | tested | `docs/F-047-decision.md` documents the breaking-change rationale: fragmented-tag drift, parser ambiguity, reader load, and migration ergonomics. Measurable benefits listed: parser surface reduction (2 regexes → 1), tag-line ratio reduction, and human-reading locality |
| AC-6 | tested | Opt-in via `.cap/config.json → unifiedAnchors.enabled=true`. `isUnifiedAnchorsEnabled()` in the scanner and the `/cap:migrate-tags` command both honour it. Default is `false` — zero impact on projects that don't opt in |

**Files:**
- `cap/bin/lib/cap-anchor.cjs`
- `cap/bin/lib/cap-migrate-tags.cjs`
- `cap/bin/lib/cap-tag-scanner.cjs`
- `commands/cap/migrate-tags.md`
- `docs/F-047-decision.md`
- `tests/cap-anchor.test.cjs`
- `tests/cap-migrate-tags.test.cjs`
- `.claude/cap/bin/lib/cap-anchor.cjs`
- `.claude/cap/bin/lib/cap-migrate-tags.cjs`
- `.claude/cap/bin/lib/cap-tag-scanner.cjs`

### F-048: Implementation Completeness Score (CAP v3 — Optional) [shipped]

**Depends on:** F-001, F-002, F-045

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | `cap-completeness.cjs:scoreAc()` computes 4 independent signals per AC — T (tag in source), S (tagged test file), I (test statically imports primary via `testReachesFile`), R (primary file in `publicReachable` set from `bin/install.js` + `hooks/*.js`). Sum = score 0..4 |
| AC-2 | tested | `/cap:status --completeness` calls `formatFeatureBreakdown()` to show per-feature avg and per-AC flag string `TSIR`; routes through `status.md` Step 0a fast-path |
| AC-3 | tested | `checkShipGate()` reads `shipThreshold` from config and returns `{allowed,reason,score}`. `updateFeatureState()` calls it silently (boolean contract); new `transitionWithReason()` exposes the reason string for UIs |
| AC-4 | tested | Integration perf test asserts `buildContext() + scoreAllFeatures()` completes in <5s on the real 50+ feature repo. Reachability cached via `importsByFile` map to avoid duplicate import-graph walks |
| AC-5 | tested | `/cap:completeness` command + `formatCompletenessReport()` emit a PR-ready markdown audit: summary table + per-feature AC table with ✓/· flag column per signal + inline reasons |
| AC-6 | tested | `loadCompletenessConfig()` reads `.cap/config.json → completenessScore.enabled` (default false). Both `/cap:status --completeness` and `/cap:completeness` exit early with exit code 2 and a how-to-enable message when disabled |

**Files:**
- `cap/bin/lib/cap-completeness.cjs`
- `cap/bin/lib/cap-feature-map.cjs`
- `commands/cap/status.md`
- `commands/cap/completeness.md`
- `tests/cap-completeness.test.cjs`
- `.claude/cap/bin/lib/cap-completeness.cjs`
- `.claude/cap/bin/lib/cap-feature-map.cjs`

### F-049: Automatic Dependency Inference from Imports (CAP v3 — Optional) [shipped]

**Depends on:** F-001, F-002

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | `cap-deps.cjs` follows `require`/`import`/`export-from`/`import()` statements within `@cap-feature`-tagged files and resolves them to feature IDs via `buildFileToFeatureMap()` + `resolveImportToFile()` |
| AC-2 | tested | `diffDeclaredVsInferred()` compares FEATURE-MAP `**Depends on:**` to inferred edges and returns per-feature `missing`/`extraneous` rows; `formatDiffReport()` renders a human-readable report |
| AC-3 | tested | `applyInferredDeps()` writes merged dependency lines back to FEATURE-MAP.md; `/cap:deps --auto-fix` orchestrator requires explicit user confirmation. `removeExtraneous` flag opt-in for destructive removal |
| AC-4 | tested | Regex-based parser handles CJS `require()`, ESM `import … from`, ESM re-exports, and static `import()` for both .js/.cjs/.mjs and .ts/.tsx. Dynamic/computed specifiers are documented as explicit limitations in module header |
| AC-5 | tested | `renderMermaidGraph()` emits a fenced `flowchart TD` with solid arrows for declared edges and dashed `-.->\ |
| AC-6 | tested | `loadDepsConfig()` reads `.cap/config.json → autoDepsInference.enabled` (default false). `/cap:deps` command exits with an informative message when disabled — zero runtime impact on projects that don't opt in |

**Files:**
- `cap/bin/lib/cap-deps.cjs`
- `commands/cap/deps.md`
- `tests/cap-deps.test.cjs`
- `.claude/cap/bin/lib/cap-deps.cjs`

### F-050: Refactor cap-cluster-display.cjs and Improve Error Diagnostics [tested]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | cap-cluster-display.cjs shall be split into at least three modules: a pure formatter (no I/O), an I/O layer (file reads), and a thin orchestrator, with no single file exceeding 300 lines |
| AC-2 | tested | The 4 silent catch-blocks in _loadClusterData() shall each log a structured diagnostic (error type, file path, recovery action taken) at debug level via the existing logger |
| AC-3 | tested | Each refactored module shall have unit tests achieving at least 70% line coverage |
| AC-4 | tested | The public API of cap-cluster-display shall remain unchanged — callers see no behavioral difference |
| AC-5 | tested | A before/after complexity comparison (cyclomatic complexity per function) shall be included in the PR description |

**Files:**
- `.claude/cap/bin/lib/cap-cluster-display.cjs`
- `.claude/cap/bin/lib/cap-cluster-format.cjs`
- `.claude/cap/bin/lib/cap-cluster-helpers.cjs`
- `.claude/cap/bin/lib/cap-cluster-io.cjs`
- `.claude/cap/bin/lib/cap-logger.cjs`
- `cap/bin/lib/cap-cluster-display.cjs`
- `cap/bin/lib/cap-cluster-format.cjs`
- `cap/bin/lib/cap-cluster-helpers.cjs`
- `cap/bin/lib/cap-cluster-io.cjs`
- `cap/bin/lib/cap-logger.cjs`
- `tests/cap-cluster-format.test.cjs`
- `tests/cap-cluster-helpers.test.cjs`
- `tests/cap-cluster-io.test.cjs`
- `tests/cap-logger.test.cjs`

### F-051: Fix Coverage Runner — Replace c8 with Node Native [shipped]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | `npm run test:coverage` uses Node's built-in `--experimental-test-coverage` with `--test-isolation=none` so subprocess coverage is not lost — total measured line coverage must be ≥95% (currently 98.07%) |
| AC-2 | tested | c8 is removed from devDependencies; no external coverage tool remains |
| AC-3 | tested | `npm test` (without `--coverage`) continues to run with default test isolation and stays 4524/4524 green |
| AC-4 | deferred | Windows-incompatible skip markers — blocked by F-052 (16 shared-state leaks surface only in isolation=none) |
| AC-5 | deferred | Pre-merge "new module requires tests" check — independent scope, re-plan later |

**Files:**
- `scripts/run-tests.cjs`
- `package.json`

### F-052: Fix Shared-State Leaks in Test Suite [shipped]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | 6 diagnostic tests in tests/cap-cluster-io.test.cjs patch `console.warn` from inside the test body via `patchWarn()` helper — verified by running tests/cap-logger.test.cjs before tests/cap-cluster-io.test.cjs under isolation=none |
| AC-2 | tested | `runCopilotInstall`/`runCopilotUninstall` in tests/copilot-install.test.cjs delete CAP_TEST_MODE from the execFileSync env — verified by running tests/install-hardening.test.cjs before tests/copilot-install.test.cjs under isolation=none |
| AC-3 | tested | `npm run test:coverage` exits 0: 4559/4559 tests pass under `--test-isolation=none` with 98.07% line / 97.86% function coverage |
| AC-4 | tested | Regression guard: the full test:coverage run is itself the regression check — any new leak that breaks isolation=none will surface as a test failure or coverage regression in CI |

**Files:**
- `tests/cap-cluster-io.test.cjs`
- `tests/copilot-install.test.cjs`

### F-053: Migrate cap-test-audit to Node Native Coverage [shipped]

**Depends on:** F-051

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | `analyzeCoverage()` inspects the test command; `supportsNativeCoverage()` detects bare `node --test` invocations; `analyzeCoverageNative()` injects `--experimental-test-coverage --test-reporter=spec` and parses the text-format report |
| AC-2 | tested | Non-node commands (vitest, jest, ts-node, …) still route to `analyzeCoverageC8()`. When c8 is unavailable the error message suggests the native path for Node >= 20 projects instead of a blunt "install c8" |
| AC-3 | tested | `parseNativeCoverageOutput()` extracts per-file `{lines, branches, functions}` + `uncoveredFiles[]`, matching the exact shape of the legacy c8 summary. Downstream scoring (trustScore, report generation) is unchanged |
| AC-4 | tested | Native path uses only Node built-ins — no npx, no network. `execSync` scrubs `NODE_V8_COVERAGE`/`NODE_OPTIONS` so a parent coverage instrumentation can't hijack the child's report |
| AC-5 | tested | `cap-doctor.cjs` skips the `c8` optional-tool check entirely when `process.versions.node >= 20`. The hint text makes the Node-version dependency explicit for < 20 projects |

**Files:**
- `cap/bin/lib/cap-test-audit.cjs`
- `cap/bin/lib/cap-doctor.cjs`
- `tests/cap-test-audit.test.cjs`

### F-054: Hook-Based Tag Event Observation [shipped]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | PostToolUse-Hook feuert bei Edit, Write, MultiEdit, NotebookEdit. |
| AC-2 | tested | Hook berechnet Tag-Diff (added/removed @cap-feature, @cap-todo) zwischen Before/After-Datei. |
| AC-3 | tested | Hook appendiert JSONL-Zeile an .cap/memory/raw/tag-events-{YYYY-MM-DD}.jsonl mit {timestamp, tool, file, added:[], removed:[]}. |
| AC-4 | tested | Kein Tag-Diff → kein Write (keine Leerzeilen, kein Noise). |
| AC-5 | tested | Hook-Laufzeit <100 ms für Dateien bis 10 000 Zeilen (in Tests erzwungen). |
| AC-6 | tested | Hook-Fehler werden in .cap/memory/raw/errors.log protokolliert und blockieren das Edit-Tool nie. |
| AC-7 | tested | Datei-Rotation pro Kalendertag; Cleanup von >30 Tage alten Logs erfolgt über F-056. |

**Files:**
- `cap/bin/lib/cap-tag-observer.cjs`
- `hooks/cap-tag-observer.js`
- `tests/cap-tag-observer.test.cjs`
- `tests/cap-tag-observer-adversarial.test.cjs`

### F-055: Confidence and Evidence Fields for Memory Entries [shipped]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Schema-Erweiterung für decisions.md, pitfalls.md, patterns.md: jede Entry-Frontmatter enthält confidence:float(0.0–1.0) und evidence_count:int≥1. |
| AC-2 | tested | Neu erzeugte Einträge aus der cap-memory-Pipeline starten mit confidence:0.5, evidence_count:1. |
| AC-3 | tested | Bestehende Einträge ohne diese Felder werden beim ersten Lesen additiv auf confidence:0.5, evidence_count:1 migriert (stumm, ohne User-Interaktion). |
| AC-4 | tested | Re-Observation derselben Pattern-Beschreibung (Text-Similarity ≥0.8) erhöht evidence_count um 1 und confidence um 0.1 (Cap bei 0.95). |
| AC-5 | tested | Widerspruch (konträrer Eintrag mit überlappendem File-Scope) senkt confidence um 0.2 (Floor 0.0), erhöht NICHT evidence_count. |
| AC-6 | tested | Einträge mit confidence<0.3 werden im Markdown-Output gedimmt gerendert (z. B. Präfix '> *(low confidence)*'). |

**Files:**
- `cap/bin/lib/cap-memory-confidence.cjs`
- `cap/bin/lib/cap-memory-dir.cjs`
- `tests/cap-memory-confidence.test.cjs`
- `tests/cap-memory-dir-confidence.test.cjs`
- `tests/cap-memory-confidence-adversarial.test.cjs`

### F-056: Memory Prune Command (Decay + TTL) [shipped]

**Depends on:** F-055, F-054

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | /cap:memory prune ist als Subcommand von /cap:memory aufrufbar. |
| AC-2 | tested | Default ist Dry-Run; --apply ist explizit erforderlich, um Dateien zu ändern. |
| AC-3 | tested | Einträge mit last_seen >90 Tage verlieren -0.05 confidence pro weitere 30 Tage Inaktivität. |
| AC-4 | tested | Einträge mit confidence<0.2 UND last_seen>180 Tage werden nach .cap/memory/archive/{YYYY-MM}.md verschoben (nicht gelöscht). |
| AC-5 | tested | Raw-Event-Logs aus F-054 älter als 30 Tage werden hart gelöscht. |
| AC-6 | tested | Prune-Run gibt Report aus (decayed, archived, purged) und appendiert .cap/memory/prune-log.jsonl mit {timestamp, decayed, archived, purged}. |

**Files:**
- `cap/bin/lib/cap-memory-prune.cjs`
- `cap/bin/lib/cap-memory-confidence.cjs`
- `cap/bin/lib/cap-memory-dir.cjs`
- `commands/cap/memory.md`
- `tests/cap-memory-prune.test.cjs`
- `tests/cap-memory-prune-adversarial.test.cjs`

### F-057: Checkpoint Command for Strategic Compact [shipped]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | /cap:checkpoint ist aufrufbar. |
| AC-2 | tested | Command prueft SESSION.json und FEATURE-MAP-Diff seit letzter Checkpoint-Zeit auf logische Breakpoints. |
| AC-3 | tested | Bei erkanntem Breakpoint gibt Command Empfehlung aus: 'Jetzt /compact, weil {konkreter Grund}' (z. B. 'F-054 auf state=tested'). |
| AC-4 | tested | Command ruft /cap:save --label checkpoint-{feature_id} implizit auf, bevor die Empfehlung ausgegeben wird. |
| AC-5 | tested | Kein Breakpoint erkannt → Message 'Kein natürlicher Kontextbruch erkannt', keine weitere Action. |
| AC-6 | tested | Command ist rein advisory — kein Auto-/compact, kein Force-Flag. |

**Files:**
- `cap/bin/lib/cap-checkpoint.cjs`
- `cap/bin/lib/cap-session.cjs`
- `tests/cap-checkpoint.test.cjs`
- `tests/cap-checkpoint-adversarial.test.cjs`

### F-058: Claude-Code Plugin Manifest [shipped]

**Depends on:** F-009, F-008

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | .claude-plugin/plugin.json in npm package enthält Metadaten (name, version, description, commands, agents, hooks). |
| AC-2 | tested | .claude-plugin/marketplace.json enthält Marketplace-Metadaten für /plugin install code-as-plan. |
| AC-3 | tested | Plugin-Manifest listet KEIN 'hooks'-Feld (Claude Code v2.1+ lädt Plugin-Hooks automatisch). |
| AC-4 | tested | Npx-Install-Pfad bleibt funktional und primärer Install-Weg; er wird nicht deprecated. |
| AC-5 | tested | cap-doctor erkennt beide Install-Modi (npx vs. Plugin) und zeigt den aktiven Modus in der Ausgabe. |
| AC-6 | tested | Coexistence-Test: wenn beide Modi aktiv sind, werden Commands/Agents nicht doppelt registriert. |

**Files:**
- `cap/bin/lib/cap-doctor.cjs`
- `tests/cap-plugin-manifest.test.cjs`
- `cap/bin/lib/cap-plugin-manifest.cjs`
- `tests/cap-plugin-manifest-adversarial.test.cjs`

### F-059: Research-First Gate Before Prototype [shipped]

**Depends on:** F-004

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | /cap:prototype parst Feature-ACs nach Library-Nennungen (Regex gegen package.json-Namen und Doc-Referenzen). |
| AC-2 | tested | Für jede referenzierte Library wird geprüft, ob .cap/stack-docs/{library}.md existiert und mtime <30 Tage ist. |
| AC-3 | tested | Fehlen Docs: Warning mit Liste der Libraries, Empfehlung '/cap:refresh-docs {libs}' und Prompt 'trotzdem fortfahren? [y/N]'. |
| AC-4 | tested | Mit --skip-docs-Flag wird der Check übersprungen (für reine Scaffolding-Features ohne externe Libs). |
| AC-5 | tested | Check blockiert NIE hart ohne User-Input — Default ist Warning + Prompt, kein Error-Exit. |
| AC-6 | tested | Anzahl geprüfter Libs und Anzahl fehlender Docs wird im Session-Log (.cap/session-log.jsonl) protokolliert. |

**Files:**
- `cap/bin/lib/cap-research-gate.cjs`
- `commands/cap/prototype.md`
- `tests/cap-research-gate.test.cjs`
- `tests/cap-research-gate-adversarial.test.cjs`

### F-060: Terse Agent Prompts (Caveman-Inspired) [shipped]

**Depends on:** F-044

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | The agent files cap-prototyper.md, cap-reviewer.md, cap-brainstormer.md, and cap-debugger.md shall each contain the four universal terseness rules: (a) no procedural narration before tool calls, (b) no defensive self-correcting negation (informative negation permitted), (c) end-of-turn summaries only for multi-step tasks, (d) terseness shall never override risk, decision, or compliance precision. |
| AC-2 | tested | Each of the four agent files shall contain its agent-specific terseness rules: cap-prototyper shall forbid markdown tables under three rows and wrapper result headers; cap-reviewer shall forbid status recaps and collapse Stage-1 pass to one line when no notes exist while preserving the two-stage header; cap-brainstormer shall forbid preambles before questions while preserving conversational tone and the feature output block format; cap-debugger shall require one-line hypothesis entries in the form - H1: {text} [untested|tested|disproven] and point-list deploy rules while preserving hypothesis-test-conclude semantics. |
| AC-3 | tested | A regression test shall verify via string-match that the universal rules block and each agent-specific rule set are present in their respective agent files, and shall fail (block CI) if any rule is removed. |
| AC-4 | tested | After rollout, at least one session per hotspot agent (cap-prototyper, cap-reviewer, cap-debugger) shall be sampled for pattern reduction, and the qualitative findings shall be documented in .cap/memory/terse-audit-YYYY-MM-DD.md. |
| AC-5 | tested | A code review shall explicitly verify that no terseness rule introduced by this feature contradicts the right-sizing guidance established by F-044, and the verification outcome shall be recorded in the review notes. |

**Files:**
- `tests/cap-terse-rules.test.cjs`
- `tests/cap-terse-rules-adversarial.test.cjs`
- `tests/fixtures/f060-signatures.cjs`

### F-062: cap:design Core — DESIGN.md + Aesthetic Picker [shipped]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Einführen des Commands `/cap:design --new`, das einen neuen cap-designer-Agenten für Greenfield-Design-Setup spawnt. |
| AC-2 | tested | cap-designer Agent führt eine 3-Fragen-Wizard-Konversation (read-heavy vs. scan-heavy, user-type, courage-factor) und mappt auf eine von 9 Aesthetic Families. |
| AC-3 | tested | Nach dem Wizard schreibt der Agent eine initiale DESIGN.md mit Struktur: Aesthetic Family, Tokens (colors, spacing, typography), Components (mindestens Button + Card), Anti-Patterns. |
| AC-4 | tested | DESIGN.md liegt im Projekt-Root neben FEATURE-MAP.md und wird per Git versioniert. |
| AC-5 | tested | `/cap:design --extend` erlaubt nachträgliches Hinzufügen von Tokens/Components zu existierender DESIGN.md, ohne bestehende Einträge zu überschreiben. |
| AC-6 | tested | Anti-Slop-Regeln (generische Fonts verboten, Cliche-Gradients verboten, Cookie-Cutter-Layouts verboten) sind als Constraint-Block im Agent-Prompt und im DESIGN.md-Output hinterlegt. |
| AC-7 | tested | DESIGN.md-Schreiber ist idempotent: wiederholter Aufruf mit gleicher Eingabe produziert identische Datei. |

**Files:**
- `cap/bin/lib/cap-design.cjs`
- `tests/cap-design.test.cjs`
- `tests/cap-design-adversarial.test.cjs`
- `cap/bin/lib/cap-design-families.cjs`

### F-063: Design-Feature Traceability (IDs + Tags + --scope) [shipped]

**Depends on:** F-062

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | DESIGN.md-Einträge erhalten stabile IDs im Format `DT-NNN` (Design Token) und `DC-NNN` (Design Component), analog zu `F-NNN` / `AC-N`. |
| AC-2 | tested | Tag-Scanner (F-001) wird erweitert um die Erkennung von `@cap-design-token(id:DT-NNN)` und `@cap-design-component(id:DC-NNN)` in Source-Code-Kommentaren. |
| AC-3 | tested | Feature-Map-Parser (F-002) wird erweitert um ein optionales `uses-design:` Feld pro Feature, das DT- und DC-IDs auflistet. |
| AC-4 | tested | `/cap:design --scope F-NNN` öffnet einen fokussierten Dialog: Agent fragt, welche Tokens/Components in F-NNN genutzt werden, aktualisiert `uses-design:` in FEATURE-MAP.md und legt bei Bedarf neue DT-/DC-Einträge in DESIGN.md an. |
| AC-5 | tested | `cap:status` und `cap:trace` erweitert um "Design-Usage" je Feature (z.B. "F-023 nutzt: DT-001 primary-color, DC-001 Button"). |
| AC-6 | tested | Impact-Analyse: Bei Änderung eines Tokens in DESIGN.md produziert `cap:deps --design DT-001` die Liste aller Features, die diesen Token referenzieren. |

**Files:**
- `cap/bin/lib/cap-design.cjs`
- `cap/bin/lib/cap-tag-scanner.cjs`
- `cap/bin/lib/cap-feature-map.cjs`
- `cap/bin/lib/cap-deps.cjs`
- `cap/bin/lib/cap-trace.cjs`
- `commands/cap/design.md`
- `commands/cap/deps.md`
- `commands/cap/status.md`
- `commands/cap/trace.md`
- `agents/cap-designer.md`
- `tests/cap-design-traceability.test.cjs`
- `tests/cap-design-traceability-adversarial.test.cjs`

### F-064: cap:design --review — Anti-Slop-Check [shipped]

**Depends on:** F-062

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | `/cap:design --review` spawnt cap-designer-Agent im Review-Mode, der bestehende DESIGN.md gegen Anti-Slop-Regeln prüft. |
| AC-2 | tested | Review-Output ist ein strukturierter Report: Violations-Liste mit Token-ID/Component-ID, Regelverletzung, Verbesserungsvorschlag. |
| AC-3 | tested | Review ist rein read-only — keine automatischen Änderungen an DESIGN.md. |
| AC-4 | tested | Review-Regelbasis ist konfigurierbar via `.cap/design-rules.md` (optional, Default-Regelset bei fehlender Datei). |
| AC-5 | tested | Review ist idempotent und deterministisch (gleiche Eingabe → gleicher Report). |

**Files:**
- `cap/bin/lib/cap-design.cjs`
- `commands/cap/design.md`
- `agents/cap-designer.md`
- `tests/cap-design-review.test.cjs`
- `cap/bin/lib/cap-design-families.cjs`
- `tests/cap-design-review-adversarial.test.cjs`

### F-065: CAP-UI Core — Local Server + Static Export [shipped]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Neuer Command `/cap:ui --serve` startet lokalen Node-http-Server auf konfigurierbarem Port (Default 4747), zero-deps, ausschließlich Node-builtins. |
| AC-2 | tested | UI rendert Feature-Map + Memory + Threads als lesbare HTML-Ansicht im Browser. |
| AC-3 | tested | File-Watcher beobachtet FEATURE-MAP.md, DESIGN.md, .cap/memory/, .cap/SESSION.json → UI aktualisiert sich in Realtime via Server-Sent-Events. |
| AC-4 | tested | `/cap:ui --share` generiert einen standalone HTML-Snapshot (inkl. inline CSS/JS, kein externer Fetch nötig) in `.cap/ui/snapshot.html`, shareable via PR/Slack. |
| AC-5 | tested | UI ist read-only für Feature-Map und Memory; Edit-Endpoints werden in F-068 spezifisch für DESIGN.md eingeführt. |
| AC-6 | tested | Server logged alle Events (Server-Start, SSE-Verbindungen, File-Änderungen) auf stdout mit Zeitstempeln für Debugging. |

**Files:**
- `cap/bin/lib/cap-ui.cjs`
- `commands/cap/ui.md`
- `tests/cap-ui.test.cjs`
- `cap/bin/lib/cap-doctor.cjs`
- `tests/cap-ui-adversarial.test.cjs`

### F-066: Tag Mind-Map Visualization [shipped]

**Depends on:** F-065, F-063

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | CAP-UI erhält eine Mind-Map-Ansicht, die alle `@cap-*` Tags (Features, ACs, Risks, Decisions, Design-Tokens, Design-Components) als Graph visualisiert. |
| AC-2 | tested | Knoten: Features (F-NNN), Design-Tokens (DT-NNN), Design-Components (DC-NNN). Kanten: uses-design, depends_on, Feature-AC-Beziehungen. |
| AC-3 | tested | Rendering via SVG + inline JS (keine externen Libraries zur Runtime; Build-Step darf D3-Bundle inlinen). |
| AC-4 | tested | Interaktion: Zoom, Pan, Filter nach Feature-Gruppen, Hover-Details, Click-to-Focus (isoliert einen Subgraph). |
| AC-5 | tested | Mind-Map ist Teil des `--share`-Exports und der `--serve`-UI. |

**Files:**
- `cap/bin/lib/cap-ui.cjs`
- `tests/cap-ui-mind-map.test.cjs`
- `cap/bin/lib/cap-doctor.cjs`
- `cap/bin/lib/cap-ui-mind-map.cjs`
- `tests/cap-ui-mind-map-adversarial.test.cjs`

### F-067: Thread + Cluster Navigator [shipped]

**Depends on:** F-065

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | CAP-UI erhält eine Thread-Browser-Ansicht, die `.cap/memory/threads/*.json` chronologisch listet mit Timestamp, Name, Feature-IDs, Keywords. |
| AC-2 | tested | Click auf einen Thread zeigt Details: Problem-Statement, Solution-Shape, Boundary-Decisions, Feature-IDs, Parent-Thread-Link. |
| AC-3 | tested | Neural Clusters (aus F-037) werden visualisiert: pro Cluster Namen, Thread-Zugehörigkeit, Pairwise-Affinity, Drift-Status. |
| AC-4 | tested | Keyword-Overlap-View: für zwei ausgewählte Threads zeigt die UI gemeinsame Keywords. |
| AC-5 | tested | Cluster-Drift-Warnungen werden im UI hervorgehoben (wenn ein Cluster Drift-Status hat). |

**Files:**
- `cap/bin/lib/cap-ui.cjs`
- `tests/cap-ui-thread-nav.test.cjs`
- `cap/bin/lib/cap-doctor.cjs`
- `cap/bin/lib/cap-ui-thread-nav.cjs`

### F-068: CAP-UI Visual Design Editor (DESIGN.md) [shipped]

**Depends on:** F-065, F-062

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | CAP-UI erhält eine Edit-Ansicht für DESIGN.md, aktivierbar via `cap:ui --serve --editable`. |
| AC-2 | tested | Color-Picker für alle Farb-Tokens (DT-NNN mit Typ color) — Änderung im UI schreibt zurück in DESIGN.md. |
| AC-3 | tested | Numerische Slider für Spacing-Tokens und Typography-Scales mit Live-Preview. |
| AC-4 | tested | Komponenten-Inspector: zeigt Component-Specs (Varianten, States), erlaubt Hinzufügen/Entfernen von Varianten. |
| AC-5 | tested | Alle Edits werden atomisch in DESIGN.md persistiert, Git-friendly (kleine Diffs, stabile Reihenfolge). |
| AC-6 | tested | Edits sind für FEATURE-MAP.md und Memory explizit *nicht* erlaubt — Collab bleibt dort Git-basiert. |

**Files:**
- `cap/bin/lib/cap-ui-design-editor.cjs`
- `cap/bin/lib/cap-ui-mind-map.cjs`
- `cap/bin/lib/cap-ui-thread-nav.cjs`
- `cap/bin/lib/cap-ui.cjs`
- `commands/cap/ui.md`
- `tests/cap-ui-design-editor.test.cjs`
- `cap/bin/lib/cap-doctor.cjs`
- `tests/cap-ui-design-editor-adversarial.test.cjs`

### F-061: Implement Token Telemetry [shipped]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Das System muss pro LLM-Call Token-Verbrauch (prompt/completion/total), Modell, Dauer und Command-Kontext in `.cap/telemetry/llm-calls.jsonl` persistieren. |
| AC-2 | tested | Das System muss pro Session einen Aggregat-Record (Call-Count, Total-Tokens, Budget-Verbrauch) schreiben, der per Feature-ID und Session-ID auffindbar ist. |
| AC-3 | tested | Der `/cap:status`-Command muss den aktuellen Session-Token-Verbrauch und die Rest-Kapazität des LLM-Budgets anzeigen. |
| AC-4 | tested | Die Telemetrie-API muss eine Query-Funktion `getLlmUsage(projectRoot, { sessionId, featureId, range })` exponieren, die von Signal-Collectors (F-070) und Pattern-Pipeline (F-071) konsumiert wird. |
| AC-5 | tested | Das System darf keine Roh-Prompts oder Roh-Completions persistieren — nur Metriken und Hashes. |
| AC-6 | tested | Bei deaktivierter Telemetrie (`.cap/config: telemetry.enabled=false`) müssen alle Writes no-op sein, ohne andere Commands zu brechen. |
| AC-7 | tested | Die Telemetrie-Writes müssen zero-deps (nur `node:fs`, `node:path`, `node:crypto`) implementiert sein. |

**Files:**
- `cap/bin/lib/cap-doctor.cjs`
- `cap/bin/lib/cap-telemetry.cjs`
- `tests/cap-telemetry-adversarial.test.cjs`
- `tests/cap-telemetry.test.cjs`

### F-070: Collect Learning Signals [shipped]

**Depends on:** F-061

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Das System muss einen Override-Collector bereitstellen, der User-Korrekturen an Agent-Vorschlägen (Edit-nach-Write, Reject-Approval) in `.cap/learning/signals/overrides.jsonl` erfasst. |
| AC-2 | tested | Das System muss einen Memory-Reference-Collector bereitstellen, der Zugriffe auf `.cap/memory/**/*.md` (rekursiv: Top-Level-Memories, `threads/`, `archive/`) pro Session zählt und in `.cap/learning/signals/memory-refs.jsonl` schreibt. |
| AC-3 | tested | Das System muss einen Decision-Regret-Collector bereitstellen, der rückwirkend als `@cap-decision regret:true` markierte Entscheidungen erkennt und in `.cap/learning/signals/regrets.jsonl` erfasst. |
| AC-4 | tested | Jeder Signal-Record muss Session-ID, Feature-ID, Timestamp, Signal-Typ und Kontext-Hash enthalten (keine Roh-Texte). |
| AC-5 | tested | Die Collectors müssen via Claude-Code-Hooks (PreToolUse / Stop) getriggert werden, ohne Command-Laufzeit messbar zu verlangsamen (< 50ms Overhead pro Hook). |
| AC-6 | tested | Das System muss eine `getSignals(type, range)`-API exponieren, die von Pattern-Pipeline (F-071) und Fitness-Score (F-072) konsumiert wird. |
| AC-7 | tested | Bei fehlenden Signal-Files müssen Collectors self-initialisieren (Lazy-Create), ohne Fehler zu werfen. |

**Files:**
- `cap/bin/lib/cap-learning-signals.cjs`
- `hooks/cap-learning-hook.js`
- `tests/cap-learning-signals-adversarial.test.cjs`
- `tests/cap-learning-signals.test.cjs`
- `cap/bin/lib/cap-doctor.cjs`

### F-071: Extract Patterns via Heuristics and LLM [shipped]

**Depends on:** F-070

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Das System muss in Stufe 1 eine deterministische Heuristik-Engine (TF-IDF, RegEx-Cluster, Frequenz-Analyse) auf Signal-Records ausführen und Kandidaten-Signale mit Score in `.cap/learning/candidates/*.json` schreiben. |
| AC-2 | tested | Das System muss in Stufe 2 einen LLM-Call triggern, sobald ein Kandidat die Schwelle `≥ 3 ähnliche Overrides ODER ≥ 1 Regret` erreicht. |
| AC-3 | tested | Der LLM-Call darf ausschließlich aggregierte Kandidaten-Metadaten (keine Roh-Signale, keine User-Texte) als Prompt erhalten und muss einen konkreten Patch-Vorschlag (L1 Parameter, L2 Rule oder L3 Prompt-Template) zurückgeben. |
| AC-4 | tested | Das System muss das LLM-Budget-Hard-Limit von 3 Calls pro Session durchsetzen; Overflow-Kandidaten müssen in `.cap/learning/queue/` mit `deferred:budget` markiert werden. |
| AC-5 | tested | Bei LLM-Unverfügbarkeit muss die Heuristik-Stufe weiterlaufen und Vorschläge mit `degraded:true` ausgeben (Graceful-Degradation). |
| AC-6 | tested | Jeder Pattern-Vorschlag muss als `P-NNN` (zero-padded, sequenziell, nie renumeriert) ID erhalten, mit Feature-Ref, Lern-Level (L1/L2/L3), Vorschlag-Payload und Confidence-Score. |
| AC-7 | tested | Das Budget-Override (`llmBudgetPerSession`) aus `.cap/learning/config.json` muss respektiert werden und ersetzt den Default von 3. |

**Files:**
- `cap/bin/lib/cap-doctor.cjs`
- `cap/bin/lib/cap-pattern-pipeline.cjs`
- `tests/cap-pattern-pipeline-adversarial.test.cjs`
- `tests/cap-pattern-pipeline.test.cjs`

### F-072: Compute Two-Layer Fitness Score [shipped]

**Depends on:** F-070, F-071

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Das System muss einen Kurzfrist-Score (Override-Rate der letzten Session) pro Pattern berechnen und in `.cap/learning/fitness/<P-NNN>.json` persistieren. |
| AC-2 | tested | Das System muss einen Langfrist-Score `(Memory-Ref × 1 + Decision-Regret × 2) / norm` berechnen, sobald n ≥ 5 Sessions mit dem Pattern aktiv waren. |
| AC-3 | tested | Die Fitness-History muss Rolling-30-Sessions und Lifetime-Aggregate gleichzeitig persistieren und per `getFitness(P-ID)` abrufbar sein. |
| AC-4 | tested | Patterns ohne Nutzung über 20 Sessions müssen automatisch als `expired:true` markiert werden. |
| AC-5 | tested | Das Datenmodell für den Langfrist-Score muss ab Tag 1 geschrieben werden, auch wenn die Anzeige erst ab n ≥ 5 erfolgt. |
| AC-6 | tested | Das System muss einen Fitness-Snapshot zum Zeitpunkt jedes Patch-Applies erzeugen, damit Auto-Rückzug (F-074) Vergleichswerte hat. |
| AC-7 | tested | Die Score-Berechnung muss zero-deps und deterministisch sein (gleiche Inputs → gleicher Output). |

**Files:**
- `cap/bin/lib/cap-doctor.cjs`
- `cap/bin/lib/cap-fitness-score.cjs`
- `tests/cap-fitness-score-adversarial.test.cjs`
- `tests/cap-fitness-score.test.cjs`

### F-074: Enable Pattern Unlearn and Auto-Retract [shipped]

**Depends on:** F-072

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Das System muss bei jedem Pattern-Apply einen Audit-Record in `.cap/learning/applied/P-NNN.json` (before/after-Diff, Ziel-Dateien, Feature-Ref, Fitness-Snapshot) persistieren. |
| AC-2 | tested | Das System muss jedes Apply als Git-Commit `learn: apply P-NNN (F-XXX)` committen, sodass der Patch per Commit-Hash rückverfolgbar ist. |
| AC-3 | tested | Der Command `/cap:learn unlearn <P-ID>` muss einen Reverse-Patch erzeugen, ihn anwenden und als Git-Commit `learn: unlearn P-NNN` persistieren. |
| AC-4 | tested | Das System muss einen Audit-Eintrag in `.cap/learning/unlearned/P-NNN.json` mit Grund (manual | auto-retract) und Zeitstempel schreiben. |
| AC-5 | tested | Das System muss 5 Sessions nach jedem Apply prüfen, ob die Override-Rate schlechter als der Pre-Apply-Fitness-Snapshot ist, und dann den Patch in der Retract-Liste markieren. |
| AC-6 | tested | Ist ein Patch für Rückzug markiert, muss das Learn-Review-Board (F-073) ihn mit Label „Rückzug empfohlen" und One-Click-Unlearn-Option anzeigen. |
| AC-7 | tested | Unlearn muss idempotent sein: zweifacher Aufruf auf bereits zurückgenommenen P-ID darf keinen doppelten Commit erzeugen. |

**Files:**
- `cap/bin/lib/cap-doctor.cjs`
- `cap/bin/lib/cap-pattern-apply.cjs`
- `tests/cap-pattern-apply-adversarial.test.cjs`
- `tests/cap-pattern-apply.test.cjs`

### F-073: Review Patterns via Learn Command [shipped]

**Depends on:** F-072, F-074

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Der Command `/cap:learn review` muss alle pending Pattern-Vorschläge aus `.cap/learning/candidates/` mit Fitness-Score, Confidence und Trigger-Begründung anzeigen. |
| AC-2 | tested | Das Review-Board muss nur erscheinen, wenn `≥ 1 high-confidence (Langfrist ≥ 0.75 bei n≥5) ODER ≥ 3 beliebige Kandidaten` vorliegen. |
| AC-3 | tested | Das System muss einen Stop-Hook registrieren, der nach dem `cap-memory`-Stop-Hook automatisch `/cap:learn review` auslöst (Memory-Pipeline → Learn-Pipeline → Review-Board). |
| AC-4 | tested | Skip pro Session muss gespeichert werden (`.cap/learning/skipped-<session-id>.json`), aber keine persistente Mute-Regel erzeugen. |
| AC-5 | tested | Patterns, die über 7 Sessions ungeprüft im Review-Board stehen, müssen automatisch in `.cap/learning/archive/` verschoben und aus dem Board entfernt werden. |
| AC-6 | tested | Für jeden Pattern muss das Board die Optionen Approve (→ Apply via F-074), Reject, Skip und bei Rückzug-Empfehlung (F-074) zusätzlich Unlearn anbieten. |
| AC-7 | tested | Approve muss die Learn-Pipeline (F-074 Apply) synchron triggern und den Exit-Code 0 nur bei erfolgreichem Commit zurückgeben. |

**Files:**
- `cap/bin/lib/cap-doctor.cjs`
- `cap/bin/lib/cap-learn-review.cjs`
- `hooks/cap-learn-review-hook.js`
- `tests/cap-learn-review-adversarial.test.cjs`
- `tests/cap-learn-review.test.cjs`

### F-075: Provision Trust-Mode Configuration Slot [shipped]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Die SESSION.json muss ein Feld `trustMode` mit den erlaubten Werten `A` | `B` | `C` und Default `A` aufnehmen. |
| AC-2 | tested | Das System muss `trustMode` pro Projekt in `.cap/config.json` persistieren, sodass der Wert über Sessions hinweg stabil bleibt. |
| AC-3 | tested | Im MVP muss das System jeden non-A-Wert beim Read ignorieren und auf `A` degradieren, mit Warnhinweis `trust-mode-not-implemented`. |
| AC-4 | tested | Alle Learn-Pipeline-Writes (F-071, F-073, F-074) müssen in Mode A Human-in-the-Loop-Approval erzwingen (kein Auto-Apply). |
| AC-5 | tested | Alle Learn-Pipeline-Reads müssen in Mode A deterministisch sein — gleiche Signal-Basis ergibt gleiche Vorschläge. |
| AC-6 | tested | Das System muss einen Helper `getTrustMode()` exponieren, den alle Learn-Features konsumieren, statt Mode selbst zu lesen. |
| AC-7 | tested | Ein zukünftiger Wechsel auf B/C darf ausschließlich den Helper-Return-Wert ändern, ohne Feature-Code zu patchen (Open-Closed). |

**Files:**
- `cap/bin/lib/cap-doctor.cjs`
- `cap/bin/lib/cap-session.cjs`
- `cap/bin/lib/cap-trust-mode.cjs`
- `tests/cap-trust-mode-adversarial.test.cjs`
- `tests/cap-trust-mode.test.cjs`

### F-076: Define V6 Memory Format Schema [tested]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Das System muss ein Per-Feature-Memory-Format unter `.cap/memory/features/F-NNN-<topic>.md` definieren mit Pflicht-Sektionen `title`, `decisions`, `pitfalls` und optionalen Sektionen `lessons`, `linked_snapshots`, `related_features`, `key_files`. |
| AC-2 | tested | Jede Datei muss einen klar abgegrenzten Auto-Block (regeneriert von der Pipeline) und einen Manual-Block (von der Pipeline niemals überschrieben) enthalten, getrennt durch Marker-Kommentare `<!-- cap:auto:start -->` / `<!-- cap:auto:end -->`. |
| AC-3 | tested | Leere optionale Sektionen müssen weggelassen werden — keine Platzhalter wie `(none)` oder `TODO` im generierten Output. |
| AC-4 | tested | Cross-Links zwischen Features müssen über Feature-ID-Referenzen (`related_features: [F-070, F-071]`) erfolgen, nicht über Inhaltsduplikation. |
| AC-5 | tested | Das Schema muss in `cap/bin/lib/cap-memory-schema.cjs` als JSDoc-Typedef + Validator-Funktion exportiert werden, abrufbar via `validateFeatureMemoryFile(path)`. |
| AC-6 | tested | Das Schema-Modul muss komplementär zu `FEATURE-MAP.md` arbeiten — keine Duplikation von Title/State/ACs, sondern Referenz via Feature-ID; FEATURE-MAP bleibt single source of truth für Lifecycle. |
| AC-7 | tested | Tests müssen Round-Trip-Parsing/Serialisierung abdecken (parse → modify auto-block → serialize → manual-block byte-identisch). |

**Files:**
- `cap/bin/lib/cap-memory-schema.cjs`
- `tests/cap-memory-schema.test.cjs`
- `cap/bin/lib/cap-doctor.cjs`

### F-077: Build V6 Memory Migration Tool [shipped]

**Hub real-world Befund (2026-05-08):** Dry-Run am GoetzeInvest hub (apps/hub, 2422 decisions + 318 pitfalls) zeigt **0% feature-classification**: keine einzige der 183 Hub-Features hat eine `**Files:**`-Sektion in FEATURE-MAP, daher kann F-077s `key_files`-Heuristik nicht greifen. 99% der Einträge landen in `platform/unassigned.md`. AC-8 ergänzt die fehlende Heuristik.

**Depends on:** F-076

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Das CLI-Kommando `cap:memory:migrate` muss `decisions.md`, `pitfalls.md`, `patterns.md`, `hotspots.md` parsen und den Inhalt in V6-Per-Feature-Files unter `.cap/memory/features/` und `.cap/memory/platform/` aufteilen. |
| AC-2 | tested | Migration muss atomic schreiben (write-temp-then-rename, F-074-Pattern) und idempotent sein — wiederholtes Ausführen ohne neue Inputs darf keine Diff-Änderungen produzieren. |
| AC-3 | tested | Vor jedem Schreibvorgang muss ein Backup nach `.cap/memory/.archive/decisions-pre-v6-<YYYY-MM-DD>.md` (und analog für die anderen V5-Files) erstellt werden, idempotent bei gleichem Datum. |
| AC-4 | tested | Dry-Run-Modus (`--dry-run`) muss Default sein und einen vollständigen Diff-Plan ausgeben (Feature-Zuordnung pro Decision, Anzahl unklassifizierter Einträge); echte Schreibvorgänge erfordern explizites `--apply` mit Confirm-Prompt. |
| AC-5 | tested | Auto-Klassifizierung muss `@cap-decision(feature:F-NNN)`-Tag-Metadaten priorisieren, dann Path-Heuristik gegen `FEATURE-MAP.md` `key_files` matchen, dann Datum + State-Transition-Heuristik für Snapshot-Orphans. |
| AC-6 | tested | Bei Ambiguität (Mehrfach-Match, Confidence < threshold) muss das Tool interaktiv prompten mit Top-3-Kandidaten und einer `[s]kip`-Option für Platform-Bucket-Fallback. |
| AC-7 | tested | Nach erfolgreichem Apply muss das Tool eine Migration-Report-Datei `.cap/memory/.archive/migration-report-<date>.md` schreiben (Counts: assigned/platform/skipped, Ambiguity-Auflösungen). |
| AC-8 | tested | Code-Tag Reverse-Index als zusätzliche Classifier-Heuristik: `buildClassifierContext` scannt Source-Code via cap-tag-scanner und baut `sourceFileToFeatureId`-Map aus `@cap-feature(feature:F-XXX)`-Tags. `classifyEntry` nutzt diese Map als Fallback nach FEATURE-MAP-`key_files`-Match (Priorität: explicit-tag-metadata 1.0 > FEATURE-MAP-key_files 0.7-0.95 > **code-tag-reverse 0.75-0.85** > body-mention 0.5). Real-world Hub-Befund: 0% → 97% feature-classification (4 → 196 per-feature files, 2761 → 77 unassigned). 10 neue Tests (87 total in F-077). |

**Files:**
- `cap/bin/lib/cap-memory-migrate.cjs`
- `tests/cap-memory-migrate.test.cjs`
- `commands/cap/memory.md`
- `cap/bin/lib/cap-doctor.cjs`

### F-078: Implement Platform-Bucket for Cross-Cutting Decisions [tested]

**Depends on:** F-076

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Das System muss ein Platform-Topic-Layout unter `.cap/memory/platform/<topic>.md` unterstützen, mit demselben Auto/Manual-Split wie Per-Feature-Files (F-076). |
| AC-2 | tested | Decisions müssen explizit via `@cap-decision platform:<topic>` getaggt werden, um in den Platform-Bucket zu promovieren — keine Auto-Promotion aus Per-Feature-Files. |
| AC-3 | tested | Per-Feature-Files müssen Platform-Topics referenzieren können via `extends: platform/<topic>`-Frontmatter-Feld; der Reader muss `extends`-Ketten in einer einzigen lookup-Pass auflösen. |
| AC-4 | tested | Subsystem-übergreifende Pitfalls müssen unter `.cap/memory/platform/checklists/<subsystem>.md` aggregierbar sein, separates Layout vom topic-Layer. |
| AC-5 | tested | Zirkuläre `extends`-Referenzen müssen vom Reader erkannt und mit Fehlermeldung (Pfad der Zyklus-Kette) abgelehnt werden. |
| AC-6 | tested | Tests müssen verifizieren: explizit-only-Promotion (nicht-getaggte Decision landet nie im Platform-Bucket), `extends`-Resolution, Zyklus-Detection. |

**Files:**
- `cap/bin/lib/cap-memory-platform.cjs`
- `cap/bin/lib/cap-memory-extends.cjs`
- `cap/bin/lib/cap-doctor.cjs`
- `tests/cap-memory-platform.test.cjs`
- `tests/cap-memory-platform-adversarial.test.cjs`
- `tests/cap-doctor-integrity.test.cjs`
- `tests/cap-ui-design-editor-adversarial.test.cjs`

### F-079: Wire Snapshot Linkage to Features and Platform [tested]

**Depends on:** F-076

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | `cap:save` (Snapshot-Erstellung) muss standardmäßig die aktive Feature-ID aus `.cap/SESSION.json` `activeFeature` lesen und den Snapshot mit dieser Feature-ID verknüpfen. |
| AC-2 | tested | Der Flag `--unassigned` muss den Snapshot ohne Feature-Bindung speichern, der Flag `--platform=<topic>` muss ihn an einen Platform-Topic binden. |
| AC-3 | tested | Soft-Warn (stderr, kein Fail) muss erscheinen wenn `--unassigned` explizit ODER kein `activeFeature` in SESSION.json gesetzt ist; Snapshot wird trotzdem erstellt. |
| AC-4 | tested | Die Memory-Pipeline muss Snapshots im Auto-Block des zugeordneten Per-Feature-Files (oder Platform-Files) unter Sektion `linked_snapshots` referenzieren — kein silent decay bei Pipeline-Re-Run. |
| AC-5 | tested | Migration aus F-077 muss Datum + State-Transitions aus FEATURE-MAP heuristisch nutzen, um die ~38 GoetzeInvest-Orphan-Snapshots automatisch ihrem damaligen Feature zuzuordnen. |
| AC-6 | tested | Nicht-zuordbare Snapshots (Heuristik liefert keinen Match) müssen unter `.cap/memory/platform/snapshots-unassigned.md` aggregiert werden, damit kein Snapshot verloren geht. |

**Files:**
- `cap/bin/lib/cap-snapshot-linkage.cjs`
- `commands/cap/save.md`
- `tests/cap-snapshot-linkage.test.cjs`
- `tests/cap-snapshot-linkage-adversarial.test.cjs`
- `cap/bin/lib/cap-doctor.cjs`
- `tests/cap-snapshot-linkage-e2e.test.cjs`

### F-080: Bridge to Claude-native Memory [tested]

**Depends on:** F-076

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Eine neue Pipeline-Stage `cap/bin/lib/cap-memory-bridge.cjs` muss `~/.claude/projects/<project-slug>/memory/MEMORY.md` ausschließlich lesend konsumieren — keine Writes in das Claude-native-Verzeichnis. |
| AC-2 | tested | Die Bridge muss einen Cache unter `.cap/memory/.claude-native-index.json` erstellen mit Mtime-basiertem Invalidierungs-Check (kein Re-Parse bei unveränderter Quelldatei). |
| AC-3 | tested | Fehlendes oder unzugängliches Claude-native-Verzeichnis muss zu silent skip führen (Log-Eintrag auf debug-Level, kein Error, kein Fail). |
| AC-4 | tested | `/cap:start` und `/cap:status` müssen die Bridge-Daten surface'n im Format `Claude-native erinnert: <bullet-titles für active feature + related features>`. |
| AC-5 | tested | Surface-Output muss auf max. 5 Bullets pro Run begrenzt sein, priorisiert nach: activeFeature direkt → related_features aus Per-Feature-File → letzte 2 globale Einträge. |
| AC-6 | tested | Tests müssen mit Fixture-Claude-native-MEMORY.md verifizieren: Parse, Cache-Invalidierung, graceful-skip bei missing dir, Surface-Limitierung. |

**Files:**
- `cap/bin/lib/cap-memory-bridge.cjs`
- `commands/cap/start.md`
- `commands/cap/status.md`
- `tests/cap-memory-bridge.test.cjs`
- `tests/cap-memory-bridge-adversarial.test.cjs`
- `tests/cap-memory-bridge-e2e.test.cjs`
- `cap/bin/lib/cap-doctor.cjs`

### F-081: Extend Feature Map Parser for Multi-Format Support [shipped]

**Depends on:** F-002

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Parser SHALL accept long-form feature IDs matching `/^F-(\d{3,}|[A-Z][A-Z0-9_-]*)$/` in addition to the existing F-NNN format |
| AC-2 | tested | Parser SHALL detect bullet-style acceptance criteria (`- [ ] AC-N: <description>`) per-block when no pipe-table rows are present |
| AC-3 | tested | Parser SHALL respect explicit override via `.cap/config.json:featureMapStyle` ("table" | "bullet" | "auto"), default "auto" |
| AC-4 | tested | Parser SHALL emit a loud, positioned error on duplicate-after-normalization feature IDs (no silent dedup) |
| AC-5 | tested | F-076 schema validator SHALL accept the union ID format for per-feature memory file naming (so long-form IDs get memory files) |
| AC-6 | tested | All existing CAP features SHALL parse unchanged after F-081 merge (existing `cap-feature-map.test.cjs` remains green; table-style stays fast-path) |
| AC-7 | tested | Config-loader infrastructure (`readCapConfig(projectRoot)` with graceful defaults) SHALL be available in `cap-feature-map.cjs` for F-082 reuse |
| AC-8 | tested | New test file `cap-feature-map-bullet.test.cjs` SHALL cover bullet-style parsing, format-detection, long-form IDs, mixed-ID-projects, and duplicate-detection |

**Files:**
- `cap/bin/lib/cap-feature-map.cjs`
- `cap/bin/lib/cap-memory-schema.cjs`
- `tests/cap-feature-map-bullet.test.cjs`
- `tests/cap-feature-map-adversarial.test.cjs`
- `tests/cap-feature-map-iterate.test.cjs`

### F-082: Aggregate Feature Maps Across Monorepo Sub-Apps [shipped]

**Depends on:** F-081, F-077

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | `readFeatureMap` SHALL detect the "Rescoped Feature Maps" header in the root FEATURE-MAP.md and aggregate referenced sub-app maps transparently (existing API unchanged) |
| AC-2 | tested | Each aggregated feature object SHALL carry runtime-only `metadata.subApp` (not persisted to FEATURE-MAP.md, source-of-truth remains the Rescoped-Table) |
| AC-3 | tested | Opt-in directory-walk SHALL load `apps/*/FEATURE-MAP.md` when `cap.config.json:featureMaps.discover === "auto"` (default "table-only") |
| AC-4 | tested | F-077 path-heuristik SHALL boost match-score for features whose `metadata.subApp` matches the file's `apps/<subApp>/...` prefix |
| AC-5 | tested | Synthetic test fixture `tests/fixtures/v61-monorepo/` SHALL provide 3 sub-apps (`apps/web/`, `apps/api/`, `packages/shared/`) with ~30 entries each, mixed long-form + numeric IDs, mixed bullet + table format |
| AC-6 | tested | Synthetic-fixture dry-run SHALL produce ≥80 % feature-routed entries (asserted in test) |
| AC-7 | tested | Duplicate IDs across aggregated sub-app maps SHALL emit a loud, positioned error (no silent dedup) |
| AC-8 | tested | Round-trip write of root FEATURE-MAP.md SHALL be idempotent — runtime-only `metadata.subApp` is never written back |

**Files:**
- `cap/bin/lib/cap-feature-map.cjs`
- `cap/bin/lib/cap-memory-migrate.cjs`
- `tests/cap-feature-map-monorepo.test.cjs`
- `tests/cap-memory-migrate-monorepo.test.cjs`
- `tests/fixtures/v61-monorepo/FEATURE-MAP.md`
- `tests/fixtures/v61-monorepo/apps/web/FEATURE-MAP.md`
- `tests/fixtures/v61-monorepo/apps/api/FEATURE-MAP.md`
- `tests/fixtures/v61-monorepo/packages/shared/FEATURE-MAP.md`
- `tests/cap-feature-map-monorepo-adversarial.test.cjs`
- `tests/cap-memory-migrate-monorepo-adversarial.test.cjs`
- `tests/cap-feature-map-emdash.test.cjs`
- `tests/cap-feature-map-monorepo-iterate.test.cjs`
- `cap/bin/lib/cap-feature-map-monorepo.cjs`

### F-083: Extract Monorepo Aggregation Module [tested]

**Depends on:** F-082

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | New file `cap/bin/lib/cap-feature-map-monorepo.cjs` SHALL export `parseRescopedTable`, `discoverSubAppFeatureMaps`, `aggregateSubAppFeatureMaps`, `_enrichFromTagsAcrossSubApps`, `_enrichFromDesignTagsAcrossSubApps`, `_maybeRedirectToSubApp` |
| AC-2 | tested | `cap-feature-map.cjs` SHALL re-export the same surface for backward-compat (zero call-site change in commands/tests) |
| AC-3 | tested | `cap-feature-map.cjs` SHALL be reduced to ≤1500 LOC; new module ≤900 LOC |
| AC-4 | tested | All existing tests SHALL stay green; coverage ≥ baseline (no regression) |
| AC-5 | tested | `_subAppPrefixes` `Object.defineProperty` non-enumerable contract SHALL be preserved (round-trip test pinned) |
| AC-6 | tested | No new circular `require` between the two modules (verified via static-analysis test or `node --trace-deprecation` probe) |

**Files:**
- `cap/bin/lib/cap-feature-map.cjs`
- `cap/bin/lib/cap-feature-map-monorepo.cjs`
- `tests/cap-feature-map-monorepo-extraction.test.cjs`
- `cap/bin/lib/cap-doctor.cjs`
- `tests/cap-doctor-integrity.test.cjs`
- `tests/cap-ui-design-editor-adversarial.test.cjs`
- `cap/bin/lib/cap-feature-map-internals.cjs`

### F-084: Project Onboarding & Migration Orchestrator [tested]

**Depends on:** F-076, F-077, F-078, F-079, F-080

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Neuer Command `/cap:upgrade` MUSS die zuletzt aktive CAP-Version aus `.cap/version` lesen (oder absent → first-run/brownfield-onboarding) und alle nötigen Migrationen sequenziell planen |
| AC-2 | tested | 7-stage migration pipeline: doctor → init-or-skip → annotate → migrate-tags → memory-bootstrap → migrate-snapshots → refresh-docs. Jeder stage MUSS idempotent sein und einzeln skip-able |
| AC-3 | tested | Dry-run UX MUSS Plan vor execution zeigen mit per-stage delta-summary (was wird hinzugefügt/geändert); user-confirm gate vor jedem stage; `--non-interactive` flag für CI bypassed mit safe defaults. *iter1: per-stage delta-probes implemented (read-only, <2s combined) — surfaced via plan[].delta + summarizePlan "delta:" line.* |
| AC-4 | tested | Atomic per stage — failed stage MUSS isoliert sein (nur dieser stage skipped, nachfolgende laufen weiter); `.cap/upgrade.log` dokumentiert success/failure pro stage mit timestamp + reason |
| AC-5 | tested | `.cap/version` marker MUSS installed CAP version + completed-stages array + last-run-timestamp persistieren (atomic write) nach erfolgreichem completion |
| AC-6 | tested | SessionStart-hook MUSS version-mismatch detecten und advisory message emitten (`Run /cap:upgrade to migrate to CAP X.Y.Z`); non-blocking, max 1× pro Session, suppressible via `.cap/config.json:upgrade.notify=false`. *iter1: hook auto-registered via hooks/hooks.json + cap-version-check.js included in scripts/build-hooks.js HOOKS_TO_COPY + plugin-manifest test pins both (lesson-13).* |
| AC-7 | tested | Tests MÜSSEN abdecken: fresh-init (kein `.cap/`), mid-version-upgrade (.cap/version vorhanden mit alter Version), partial-state-recovery (vorheriger run abgebrochen), version-marker-corruption, non-interactive mode, per-stage failure-isolation, hook advisory throttling |

**Files:**
- `cap/bin/lib/cap-upgrade.cjs`
- `commands/cap/upgrade.md`
- `hooks/cap-version-check.js`
- `tests/cap-upgrade.test.cjs`
- `tests/cap-upgrade-adversarial.test.cjs`
- `tests/cap-upgrade-e2e.test.cjs`
- `cap/bin/lib/cap-doctor.cjs`
- `tests/cap-doctor-integrity.test.cjs`
- `tests/cap-ui-design-editor-adversarial.test.cjs`
- `tests/build-hooks.test.cjs`
- `tests/cap-plugin-manifest.test.cjs`

### F-085: Add Scope Filter to Tag-Scanner & Migrate-Tags [tested]

**Depends on:** F-045, F-046, F-047

**Motivation:** Beide tag-bezogenen Tools (`cap-tag-scanner.cjs:scanDirectory` und `cap-migrate-tags.cjs`) scannen blind alles unter `cwd()`, ohne `.gitignore`, Worktree-, Fixture- oder Plugin-Mirror-Awareness. Konkrete Befunde auf diesem Repo (2026-05-07):
- `cap-migrate-tags` dry-run schlug **2773 File-Migrations** vor, davon nur ~89 legitim. Apply hätte Test-Fixtures kaputt gemacht, die User-Global-Plugin-Installation kontaminiert und einen un-reviewbaren Diff produziert.
- `cap-tag-scanner` lieferte **33594 Tags in 2773 Files**, davon **30502 (91%) aus `.claude/worktrees/`** (alte Agent-Worktrees). Resultat: 88% unassigned-Tags, gefährliches `enrichFromTags` (würde `FEATURE-MAP.md` mit Worktree-Pfaden vermüllen), unbrauchbare Coverage-Statistiken.

Der Fix ist gemeinsam — beide Module brauchen denselben Scope-Filter-Layer. Nach Implementierung: Scanner geht von 33594 → 2614 Tags (−92%), Migrator von 2773 → 102 Files (−96%).

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Gemeinsamer `cap-scope-filter.cjs` MUSS extrahiert werden und sowohl von `cap-tag-scanner.cjs:scanDirectory` als auch von `cap-migrate-tags.cjs:planProjectMigration` konsumiert werden — DRY, ein Default-Set, ein Override-Pfad |
| AC-2 | tested | Scope-Filter MUSS `.gitignore` respektieren — Files, die git ignoriert, dürfen weder gescannt noch in Migrationsplan aufgenommen werden |
| AC-3 | tested | Default-Excludes MÜSSEN umfassen: `.claude/worktrees/**`, `.claude/cap/**` (Plugin-Self-Mirror), `node_modules/**`, `dist/**`, `coverage/**`, `.cap/snapshots/**`, `**/fixtures/**` (Test-Fixtures absichtlich roh-getaggt) |
| AC-4 | tested | Plugin-Self-Mirror-Detection MUSS heuristisch erkennen, wenn das Tool sich selbst sieht (Pfad-Mirroring von `$HOME/.claude/cap/bin/` unter `<cwd>/.claude/cap/bin/`) — Schreiben dorthin würde die User-Global-Installation kontaminieren |
| AC-5 | tested | Scan- und Dry-Run-Reports MÜSSEN aggregierte counts pro top-level-dir zeigen (nicht nur File-Liste/Tag-Liste), damit User Scope-Verschmutzung sofort erkennt |
| AC-6 | tested | `--include=<glob>` und `--exclude=<glob>` Flags MÜSSEN auf beiden Tools scope-override erlauben (additive Excludes, ersetzende Includes) |
| AC-7 | tested | Migration-Sicherheit: `cap-migrate-tags` MUSS bei >500 vorgeschlagenen Files einen extra Confirm-Gate triggern (`--apply` allein reicht nicht), um destructive blind-applies zu verhindern |
| AC-8 | tested | Tests MÜSSEN abdecken: gitignore-aware scan, worktree-exclusion, fixture-exclusion, plugin-mirror detection, glob-flag-overrides, large-diff-confirm-gate, fail-safe (kein Match → klare Meldung statt leerer Diff oder leeres Tag-Set) |

**Files:**
- `cap/bin/lib/cap-doctor.cjs`
- `cap/bin/lib/cap-migrate-tags.cjs`
- `cap/bin/lib/cap-scope-filter.cjs`
- `cap/bin/lib/cap-tag-scanner.cjs`
- `tests/cap-migrate-tags-scope.test.cjs`
- `tests/cap-scope-filter.test.cjs`
- `tests/cap-tag-scanner-scope.test.cjs`

### F-086: Memory Pipeline Hardening (Dedup + Bundle-Detection + Prune-Stale) [tested]

**Depends on:** F-085

**Motivation:** Real-world Befund auf GoetzeInvest (2026-05-07): nach `/cap:upgrade` enthielt `apps/hub/.cap/memory/platform/unassigned.md` 2308 Noise-Lines (95% der Datei) aus Build-Output (`.next/dev/server/chunks/...`) und Bundle-Artefakten (`supabase/migrations/...sql:12102`). Plus: `@cap-history` Annotations wurden bei jedem Pipeline-Run dupliziert (Beispiel `apps/hub/src/types/hub-types.ts` mit 2 verschiedenen `@cap-history`-Zeilen am File-Header).

**Investigation (2026-05-07):** F-085 protected den scanner-walk (`scanDirectory`), und der memory-pipeline-hook (`hooks/cap-memory.js`) ruft genau diese Funktion auf. Das heißt der **Source-Walk ist bereits geschützt** — das Verschmutzungsproblem auf GoetzeInvest stammte aus einer pre-F-085 CAP-Installation. Nach Symlink auf den F-085-fähigen Repo-Stand zeigt ein neuer Bootstrap **0 Noise-Lines**. Die ursprünglich gedachten "memory-pipeline-modules adopt scope-filter" ACs sind damit erledigt — keine Code-Änderung nötig, F-085 gilt bereits für den hot-path.

Was offen bleibt sind drei separate Hardening-Punkte:

1. **`@cap-history` dedup-bug**: `cap-annotation-writer.cjs:planFileChanges` matched existing annotations per `entry.content.substring(0, 60)`. Da `entry.content` bei `@cap-history` die changing edit-counts enthält ("Frequently modified — 2 sessions, **5** edits"), schlägt der Match bei jedem Stat-Update fehl und eine NEUE Zeile wird angefügt statt die alte upzudaten.
2. **Bundle-detection als defense-in-depth**: Falls `.gitignore` mal nicht greift (z.B. user committet Bundles), sollten Files mit Line-Counts >5000 ODER Bundle-typischen Pfad-Patterns (`/chunks/`, `_*._.js`) trotzdem ausgeschlossen werden.
3. **Pruning vorhandener Memory-Files**: Projekte die mit pre-F-085 CAP gebootstrappt haben, haben verschmutzte memory-files. Ein `cap:memory prune --gitignored`-Subcommand validiert bestehende Einträge gegen den aktuellen Scope-Filter und entfernt Einträge die jetzt out-of-scope wären.

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | `cap-annotation-writer.cjs:planFileChanges` MUSS `@cap-history`-Annotations per **tag-name only** matchen (nicht per content-prefix) — pro File darf nur EINE `@cap-history`-Zeile existieren, jede neue Stat ersetzt die alte in-place |
| AC-2 | tested | `cap-scope-filter.cjs` MUSS um Bundle-Detection erweitert werden: ein File-Path-Pattern-Match auf `**/chunks/**`, `**/__*._*.js`, `**/[root-of-*]*.js` ODER eine Line-Count-Heuristik (>5000 Zeilen) markiert das File als Bundle und schließt es aus — defense-in-depth gegen gitignore-misses |
| AC-3 | tested | `cap:memory prune --gitignored` Subcommand MUSS implementiert sein. Liest jede Memory-Datei (V5: `decisions.md`/`pitfalls.md`/`patterns.md`/`hotspots.md`; V6: `features/*.md`, `platform/*.md`), parsed die `Files:` / `key_files:` Pfade, und entfernt Einträge deren Pfad jetzt vom Scope-Filter ausgeschlossen wäre. Default: Dry-Run mit Diff. `--apply` schreibt atomic |
| AC-4 | tested | Verified (no-op): F-085 protected `scanner.scanDirectory`, das ist der einzige Source-Walk im Memory-Pipeline-Hot-Path (`hooks/cap-memory.js:130`). Die übrigen `readdirSync` calls in `cap-memory-bridge`/`cap-memory-migrate`/`cap-pattern-pipeline`/`cap-snapshot-linkage`/`cap-memory-prune` walken interne `.cap/`-Dirs und brauchen keinen Scope-Filter |
| AC-5 | tested | Tests MÜSSEN abdecken: dedup nach Stat-Update (gleicher tag, andere counts → in-place update), bundle-detection für `chunks/` + line-count, prune-gitignored dry-run + apply, no-regression auf F-085-Tests |

**Files (zu erstellen/anzupassen):**
- `cap/bin/lib/cap-annotation-writer.cjs` (dedup fix)
- `cap/bin/lib/cap-scope-filter.cjs` (bundle-detection extension)
- `cap/bin/lib/cap-memory-prune.cjs` (--gitignored subcommand)
- `commands/cap/memory.md` (Doku der neuen Flags)
- `tests/cap-annotation-writer-dedup.test.cjs` (neu)
- `tests/cap-scope-filter-bundle.test.cjs` (neu)
- `tests/cap-memory-prune-gitignored.test.cjs` (neu)

### F-087: Type-Safety Gaps in Migrate-Tags & Snapshots on Monorepos [planned]

**Depends on:** F-047, F-079, F-082

**Motivation:** GoetzeInvest `/cap:upgrade` Run am 2026-05-07 hat zwei Crashes in den Migrations-Stages produziert, die sich beim Re-Run selbst geheilt haben:

1. **`cap-migrate-tags`**: `paths[0] argument must be of type string. Received an instance of Object` — `path.resolve`/`path.join` bekam ein Object statt String. Vermutlich monorepo-spezifisch, wo eine Workspace-Struktur Objects liefert wo Single-Repo strings hatte.
2. **`cap-snapshot-linkage` (processSnapshots)**: `topic.replace is not a function` — `topic` war kein String. Vermutlich frontmatter-Parsing das in monorepo-Kontext einen anderen Type liefert (Array? Object? undefined?).

Beide Bugs sind nur durch Re-Run "verschwunden" — vermutlich race-condition-artiges Verhalten oder lazy-init das beim 2. Run state hatte. Sie sind reproduzierbar nicht-deterministisch, was auf eine schlecht typisierte Schnittstelle hindeutet. Type-Safety-Audit fällig.

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | planned | `cap-migrate-tags.cjs` MUSS alle `path.*`-Calls mit `assertString(arg, 'argName')`-Guard absichern und einen klaren `MIGRATE_PATH_TYPE`-Error werfen statt eine kryptische Node-Internal zu propagieren |
| AC-2 | planned | `cap-snapshot-linkage.cjs:processSnapshots` MUSS frontmatter-Felder (`topic`, `feature`, `prefix`) validieren bevor String-Methoden aufgerufen werden — bei type-mismatch klarer Fehler mit Filename + erwartet-vs-gefunden |
| AC-3 | planned | Reproducer-Test: simuliere monorepo mit `apps/*` workspaces + `.cap/SESSION.json:activeApp` gesetzt + Snapshot mit fehlendem topic-Feld; planProjectMigration und processSnapshots MÜSSEN mit klaren Errors antworten, nicht intern crashen |
| AC-4 | planned | Beide Module MÜSSEN idempotent sein: derselbe Input liefert dasselbe Output ohne hidden state. Wenn Re-Run anders Verhalten zeigt als First-Run, ist das ein Bug |
| AC-5 | planned | Tests MÜSSEN abdecken: missing/wrong-type frontmatter, monorepo workspace path resolution, idempotency assertion (n×Run = identisches Output) |

**Files (zu erstellen/anzupassen):**
- `cap/bin/lib/cap-migrate-tags.cjs`
- `cap/bin/lib/cap-snapshot-linkage.cjs`
- `tests/cap-migrate-tags-monorepo.test.cjs` (neu)
- `tests/cap-snapshot-linkage-type-safety.test.cjs` (neu)

### F-088: Lossless FEATURE-MAP Round-Trip [shipped]

**Depends on:** F-041, F-042, F-081

**Motivation:** Real-world Befund auf GoetzeInvest hub (2026-05-08): nach `/cap:reconcile` schrumpfte `apps/hub/FEATURE-MAP.md` von **3303 auf 1902 Zeilen** (−42%). User hatte 52 angekündigte Status-Bit-Updates erwartet, bekam aber 1401 verlorene Zeilen Beschreibungstext, Group-Header und Trennlinien.

Root cause: der parse → mutate → serialize round-trip in `cap-feature-map.cjs` ist **lossy**. Der Parser (`readFeatureMap`) sammelt nur strukturierte Felder ins `feature`-Object (id, title, state, dependencies, acs, files, usesDesign). Der Serializer (`serializeFeatureMap`) emittiert nur was im Object steht. Alles dazwischen — Freitext-Beschreibungen zwischen Header und "Depends on", `**Group:**`-Marker, `---`-Trennlinien, Header-Format-Variationen (`### F-NNN — Title` vs `### F-NNN: Title`) — geht beim Schreiben verloren.

Betroffene Pfade: `setAcStatus`, `updateFeatureState`, `enrichFromTags` (alle rufen `writeFeatureMap` mit dem geparsten Feature-Object). Existierender Memory-Eintrag warnt seit 2026-05-04 vor `enrichFromTags`-Wipe (siehe `feedback_cap_scan_destructive.md` auf GoetzeInvest); F-088 ist die strukturelle Lösung.

**Iter 1 strategy:** AC-5 (surgical-patch) + AC-7 (safety-net) zusammen schließen die akute Lücke ohne den Parser/Serializer umzubauen. setAcStatus + updateFeatureState laufen jetzt über `applySurgicalPatches` und ändern nur die getroffenen Status-Bits per regex auf raw content — Prose, Group-Header, Trennlinien bleiben byte-identisch. Für Calls die NICHT durch surgical-patch gehen (z.B. `enrichFromTags`) verhindert der Pre-Write-Safety-Net (`CAP_FEATURE_MAP_SHRINK_GUARD`) silent data loss durch Throw bei >50% Schrumpf. AC-1..AC-4 (volle Parser-/Serializer-Erweiterung für lossless round-trip von Freitext) sind deferred — kann follow-up implementieren wenn ein konkreter Use-Case auftaucht der über die surgical-patch-Coverage hinausgeht.

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | planned | Parser MUSS unbekannten Text zwischen Header und "Depends on:" ins Feature-Object preserven (z.B. `feature._description`) und der Serializer MUSS es zurückschreiben — *deferred to follow-up* |
| AC-2 | planned | Group-Header (`**Group:** ...`) und thematische Section-Header (`## ...`) MÜSSEN beim round-trip preserviert werden — *deferred to follow-up* |
| AC-3 | planned | Trennlinien (`---`) zwischen Features MÜSSEN preserviert werden — *deferred to follow-up* |
| AC-4 | planned | Header-Format pro Feature MUSS preserviert werden (analog zu F-081's `_inputFormat`) — *deferred to follow-up* |
| AC-5 | tested | Surgical-Patch-Mode: line-level Patcher der NUR die geänderten Status-Bits flippt ohne Re-Serialisierung. `setAcStatus` und `updateFeatureState` rufen `applySurgicalPatches` zuerst; nur bei miss (legacy header / bullet form) Fallback auf parse → write. Helpers: `_surgicalUpdateFeatureState` (Header-Bracket), `_surgicalSetAcStatus` (Table-Row, scoped per feature) |
| AC-6 | tested | Round-Trip-Idempotenz Test (Variante): GoetzeInvest-style "fat map" mit 50 Features × Prose × Group-Header × Trennlinien überlebt 50 Status-Updates byte-für-byte (Line-Count-Preservation) — `tests/cap-feature-map-surgical-patch.test.cjs:e2e-50-updates`. Volle parse-roundtrip-Idempotenz hängt an AC-1..AC-4 |
| AC-7 | tested | Pre-Write Safety Net: `writeFeatureMap` MUSS bei >50% Schrumpf vs. on-disk-Größe `CAP_FEATURE_MAP_SHRINK_GUARD` werfen (sanity-floor 50 Zeilen). `options.allowShrink:true` als opt-in override |
| AC-8 | tested | Tests decken ab: GoetzeInvest-style fat map round-trip (surgical), 50 sequenzielle Updates ohne Line-Count-Drift, safety-net throw bei künstlich provoziertem Shrink, em-dash header form, scoped AC-row updates (kein cross-feature collateral) |

**Files (geändert/neu):**
- `cap/bin/lib/cap-feature-map.cjs` — surgical-patch helpers + safety-net guard in `writeFeatureMap` + Wiring von `setAcStatus` / `updateFeatureState`
- `tests/cap-feature-map-surgical-patch.test.cjs` (neu, 11 Tests)
- `tests/cap-feature-map-safety-net.test.cjs` (neu, 6 Tests)
- `tests/cap-feature-map-monorepo-extraction.test.cjs` (Budget-Bump 1500 → 1750)

### F-089: Sharded Feature Map (Index + Per-Feature Files) [shipped]

**Depends on:** F-002, F-081, F-088

**Motivation:** Real-world Befund auf GoetzeInvest hub (2026-05-08): `apps/hub/FEATURE-MAP.md` ist auf ~4000 Zeilen gewachsen und ist die Single-Source-of-Truth für jeden Read/Write. Jeder Agent-Call (Brainstorm, Prototype, Scan, Reconcile, Review, Status) lädt die volle Datei → ~30–50k Tokens nur fürs Lesen, linear skalierend mit Featureanzahl. F-088 hat den Datenverlust beim Round-Trip strukturell entschärft, aber das Skalierungsproblem bleibt: bei 200 Features wird FEATURE-MAP.md unbenutzbar.

**Lösung:** Sharding. `FEATURE-MAP.md` wird zur schlanken **Index-Datei** (eine Zeile pro Feature: ID | state | title | groups), die vollen Feature-Blöcke wandern in `features/<ID>.md`. Agenten lesen erst den Index (~1 Zeile/Feature) und laden gezielt nur die F-NNN.md-Datei für das aktive Feature. V6 hat das Sharding-Pattern bereits für Memory etabliert (`.cap/memory/features/F-NNN.md`) — F-089 überträgt dasselbe Schema auf den SoT.

**Sekundär-Anforderung:** ID-Format wird liberalisiert. Bisher `F-NNN` (zero-padded). Ab F-089 ist auch deskriptiv erlaubt: `F-<App>-<Slug>` (z.B. `F-Hub-Spotlight-Carousel`). Reale Praxis auf GoetzeInvest hat sich längst dorthin entwickelt — deskriptive IDs geben Kontext ohne den Block laden zu müssen. Beide Formate koexistieren dauerhaft; deskriptiv wird der neue Default in `/cap:brainstorm` und `/cap:init` für Monorepo-Apps.

**Iter 1 strategy:** Phase-1-Scope (lieferbar als ein PR): Storage-Layer + Read/Write-Dispatcher + Migration. AC-1..AC-7, AC-9, AC-10, AC-11 vollständig getestet. AC-4 implementiert Read-Dispatch (sharded vs monolithic) — `readFeatureMap` lädt im Sharded-Mode beide Schritte (Index + per-feature Files) eager-equivalent. Lazy-API (`readIndex`/`readFeature`-Pattern in Agent-Prompts) ist Phase 2 und wird durch existierende Helper `parseIndex` + `featureFilePath` bereits unterstützt. AC-8 (Brainstormer-Heuristik) als Doku in agents/cap-brainstormer.md + commands/cap/brainstorm.md.

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | `FEATURE-MAP.md` wird zur Index-Datei mit einer Zeile pro Feature im Format `- F-<ID> \| <state> \| <title>`. Header (`# Feature Map`) und `## Legend` bleiben erhalten. Tests: cap-feature-map-shard.test.cjs (parseIndex, serializeIndex round-trip) |
| AC-2 | tested | Pro Feature wird eine Datei `features/<ID>.md` angelegt mit dem vollen Block (Title-Header, Depends-on, Motivation, AC-Tabelle, Files-Sektion). Filename = `<ID>.md` 1:1. Tests: featureFilename + featureFilePath unit + e2e migration write |
| AC-3 | tested | ID-Validation: Drei-Branch-Union (`F-\d{3,}` numerisch, `F-LONGFORM` Legacy-Uppercase mit segmentiertem Body, `F-Mixed-Case` deskriptiv mit erforderlichem Hyphen). Defense-in-depth: keine Path-Traversal-Chars; max-Länge 64. Tightening ggü. F-081: `F-A-` und `F-A__B` nun rejected (war als Future-AC dokumentiert). Tests: 9 cases |
| AC-4 | tested | `readFeatureMap` dispatched auf `_readShardedMap` wenn `features/` existiert. Per-feature-File via `parseFeatureMapContent` parseable (mini-monolithic-Block). Tests: sharded read + monolithic read coexist im selben Test-File |
| AC-5 | tested | `setAcStatus`/`updateFeatureState`/`writeFeatureMap` dispatched auf sharded-Variante; F-088 Surgical-Patch wandert byte-byte auf per-feature File + Index-Update für state-changes. 50×50 Round-Trip ohne Line-Drift validiert. Tests: cap-feature-map-sharded.test.cjs |
| AC-6 | tested | `/cap:migrate-feature-map` (commands/cap/migrate-feature-map.md) + `cap-feature-map-migrate.cjs`. Byte-lossless extraction (raw slicing, kein parse→serialize). Idempotent. Dry-run default. Backup als `.backup-pre-F-089`. Tests: e2e auf eigenem FEATURE-MAP.md (~89 Features in 22ms) |
| AC-7 | tested | Backwards-Compat: ohne `features/`-Dir → Monolithic-Modus, alle 565 bestehenden cap-feature-map.* Tests bleiben grün. Sharded vs monolithic-Detection via `isShardedMap` |
| AC-8 | tested | Brainstormer (`agents/cap-brainstormer.md` + `commands/cap/brainstorm.md`) führt deskriptive `F-<App>-<Slug>` als bevorzugte Form für Monorepo-Apps ein; Single-App-Repos behalten `F-NNN`. Heuristik dokumentiert (apps/* dir oder package.json:workspaces). CLAUDE.md aktualisiert |
| AC-9 | tested | `IndexEntry` typedef in cap-feature-map-shard.cjs zentral; `_updateIndexEntry` (surgical) + `_appendIndexEntry` (insert at end of section). Tests: surgical preserves byte-content of siblings; append doesn't accumulate blank lines |
| AC-10 | tested | 95 neue Tests (cap-feature-map-shard: 46, cap-feature-map-migrate: 18, cap-feature-map-sharded: 10, plus angepasste adversarial: 21). Volle Suite: 7380/7384 (zwei Pre-existing plugin.json drift-Failures sind nicht F-089) |
| AC-11 | tested | `commands/cap/migrate-feature-map.md` (neu) + `CLAUDE.md` (Feature-ID-Konvention, Sharded-Layout, Command-Tabelle) + `agents/cap-brainstormer.md` + `commands/cap/brainstorm.md` aktualisiert |

**Files (geändert/neu):**
- `cap/bin/lib/cap-feature-map.cjs` — Pattern erweitert (3-Branch-Union); Sharded-Mode-Dispatcher in readFeatureMap/writeFeatureMap/applySurgicalPatches; `_readShardedMap`/`_writeShardedMap`/`_applyShardedSurgicalPatches`
- `cap/bin/lib/cap-feature-map-shard.cjs` (neu) — ID-Validator + Filename-Derivation + Index parse/serialize + surgical `_updateIndexEntry`/`_appendIndexEntry`
- `cap/bin/lib/cap-feature-map-migrate.cjs` (neu) — Monolithic → Sharded Migration; byte-lossless extractFeatureBlocks; planMigration/applyMigration/formatPlan
- `cap/bin/lib/cap-doctor.cjs` — Manifest +2 Module
- `commands/cap/migrate-feature-map.md` (neu) — User-facing Migration-Command
- `commands/cap/brainstorm.md` (Update — deskriptive IDs default für Monorepo)
- `agents/cap-brainstormer.md` (Update — ID-Vorschlags-Heuristik mit Mono/Single-App-Discrimination)
- `CLAUDE.md` (Update — Feature-ID-Format, Sharded-Layout, Command-Tabelle)
- `tests/cap-feature-map-shard.test.cjs` (neu, 46 Tests)
- `tests/cap-feature-map-migrate.test.cjs` (neu, 18 Tests, inkl. e2e auf eigenem FEATURE-MAP.md)
- `tests/cap-feature-map-sharded.test.cjs` (neu, 10 Tests, inkl. 50×50 Round-Trip)
- `tests/cap-feature-map-adversarial.test.cjs` — Tests an die getightnete Regex angepasst (3 Tests refactored, 1 neu)
- `tests/cap-feature-map-monorepo-extraction.test.cjs` — Line-Count-Budget bumped 1750 → 2000
- `tests/cap-doctor-integrity.test.cjs` — Manifest-Count 90 → 92
- `tests/cap-ui-design-editor-adversarial.test.cjs` — Manifest-Count 90 → 92

### F-090: Confidence-Filter for V5 Memory Output [shipped]

**Depends on:** F-055, F-056

**Motivation:** Real-world Befund auf GoetzeInvest hub (2026-05-08, post-F-089): `apps/hub/.cap/memory/decisions.md` ist 568 KB / 2340 Einträge groß, davon ~95% mit `Confidence: 0.50, Evidence: 1` — Heuristik-Extracts aus Code-Kommentaren (z.B. *"gracefulShutdown inline definiert (nicht Top-Level), damit"*), keine echten Entscheidungen. Pitfalls.md ähnlich (76 KB / 305 Einträge).

Die Files werden trotzdem geladen: `.claude/rules/cap-memory.md` instruiert den Agent am Session-Start sie zu lesen. Bei 568 KB = ~150k Tokens pro Session-Start, davon ~140k Tokens Heuristik-Mais.

**Strategie:** Filter im V5-Writer (`writeMemoryDirectory` → `generateCategoryMarkdown`). graph.json bleibt voll (Cluster/Affinity-Komponenten brauchen alle Nodes), nur die menschen- und agent-lesbare .md-Output wird auf signal-tragende Einträge eingeschränkt.

**Filter-Regel:** Eintrag wird emittiert wenn EINER der folgenden gilt:
1. `pinned: true` (User-kuriert — immer behalten)
2. `confidence >= 0.6` (mind. 2 Beobachtungen — REOBSERVATION_BUMP=0.1, DEFAULT_CONFIDENCE=0.5; 0.6 = seen twice)
3. Kategorie ist `hotspot` (Ranking-Format, regeneriert jedes Run; nicht filtern)

**Iter 1 strategy:** Layer-Trennung — `generateCategoryMarkdown` und `writeMemoryDirectory` defaulten auf `minConfidence:0` (kein Filter, backwards-compat). Der Filter ist als Pipeline-Policy in `hooks/cap-memory.js` wired, dort wird `minConfidence:0.6` explizit gesetzt. Direkte Library-Caller (Tests, CLI-Tools) sind unbeeinflusst.

**Real-world Befund auf GoetzeInvest hub:** Confidence-Verteilung ist 100% bei 0.50 (= alle Einträge frisch gesehen, niemand re-observed, niemand pinned). Mit 0.6-Threshold fliegen alle 2340 decisions / 305 pitfalls. Das spiegelt korrekt wider dass das aktuelle Memory-System keinen Wert trägt. Nachfolge-Ticket F-091 (source-aware confidence) ist die strukturelle Lösung.

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Pure function `_filterEntriesForOutput(entries, options)` filtert nach pinned-OR-confidence-Schwelle. Threshold via `options.minConfidence`. Tests: 5 cases (high kept, low dropped, pinned-always-kept, missing-metadata-defensive, custom-threshold) |
| AC-2 | tested | `generateCategoryMarkdown` wendet Filter an wenn Threshold gegeben wird. Hotspot-Kategorie unverändert (ranking format) |
| AC-3 | tested | Footer-Counter `*N kept (filtered out M low-confidence; threshold=0.6)*` wenn Filter aktiv und welche gedroppt; sonst klassisches `*N total*` |
| AC-4 | tested | `graph.json` build-Pfad nicht angefasst — Filter wirkt nur auf .md-Output. Direkter Code-Beweis: writeMemoryDirectory schreibt nur die .md-Files, graph.json wird in cap-memory-graph.cjs separat gebaut |
| AC-5 | tested | Pinned entries werden NIE gefiltert auch bei confidence:0.0. Test: `pinned entries survive even with confidence:0.0` |
| AC-6 | tested | 14 Tests grün; volle Suite 7396/7400 (2 pre-existing plugin.json drifts, kein F-090-Regress) |
| AC-7 | tested | Filter-Vorschau auf GoetzeInvest hub: 2340 → 0 entries (100% dropped da alle bei confidence:0.50). Token-Reduktion 568 KB → ~0.3 KB für decisions.md |
| AC-8 | tested | Layer-Separation: `hooks/cap-memory.js` setzt `minConfidence:0.6` (Pipeline-Policy); `writeMemoryDirectory`/`generateCategoryMarkdown` defaulten auf 0 (backwards-compat, library-caller unaffected) |

**Files (geändert):**
- `cap/bin/lib/cap-memory-dir.cjs` — `_filterEntriesForOutput` (neu, exportiert), Wiring in `generateCategoryMarkdown`, Footer-Counter mit kept/dropped-Anzeige
- `hooks/cap-memory.js` — Pipeline-Wiring `{ minConfidence: 0.6 }` an `writeMemoryDirectory`
- `tests/cap-memory-dir-confidence-filter.test.cjs` (neu, 14 Tests)

### F-091: Source-Aware Initial Confidence for Memory Entries [shipped]

**Depends on:** F-055, F-090

**Motivation:** F-090 hat den Confidence-Filter aktiviert (Hook setzt `minConfidence:0.6`), aber Real-world auf GoetzeInvest hub zeigte: 100% der 2340 decisions sind bei Confidence 0.50 (`DEFAULT_CONFIDENCE`) — niemand re-observed, niemand pinned. Filter dropped 100%. Resultat ist korrekt (das System trägt aktuell keinen Wert), aber das deutet auf ein tieferes Problem: das Confidence-System bekommt für ALLE Quellen den gleichen Startwert, egal ob `@cap-decision` (User-explizit) oder Heuristik-Kommentar-Extract (random Fragment).

**Strategie:** Initial confidence basierend auf der Quelle des Eintrags:

| Quelle | Initial Confidence | Rationale |
|---|---|---|
| Explizit `@cap-decision(...)` Tag im Code | 0.8 | User hat selbst markiert → hoch vertrauenswürdig |
| Explizit `@cap-todo decision:` Tag | 0.7 | User hat als Decision markiert |
| `@cap-risk` mit Begründung | 0.7 | Strukturierte Annotation |
| Session-Extract aus Conversation | 0.6 | Konversationskontext, validiert |
| Heuristik-Comment-Block-Extract | 0.5 (current default) | Niedrig — muss Re-Observation überleben |
| Pinned via User-Action | 1.0 (already covered) | Manueller Curation-Akt |

**Wirkung:** Mit F-091 + F-090-Filter:
- @cap-decision-Tags überleben den Filter sofort
- Heuristik-Extracts bleiben gefiltert bis sie re-observed werden
- User pinning wird selten nötig

**Iter 1 strategy:** Schedule lebt in `cap-memory-confidence.cjs` (single source of truth). `initFields(opts)` akzeptiert optionalen `initialConfidence`-Override mit Clamp [FLOOR, CAP]. Engine passt die richtige Confidence per Tag-Type. Session-Extract bleibt zunächst bei 0.5 (Heuristik-Regex auf Conversations ist nicht besser als Heuristik-Comment-Extract). Bug-Fix mitgegeben: `applyLearningSignals` Spread-Order war falsch und überschrieb die source-aware Confidence der eingehenden Entry — initFields() füllt jetzt nur fehlende Felder, newEntry-Werte gewinnen.

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | `cap-memory-engine.cjs` (`accumulateFromCode`) setzt initial-confidence per Tag-Type: `@cap-decision` → 0.8, `@cap-risk` → 0.7, `@cap-todo risk:` → 0.7. Tests: 4 cases (decision/risk/todo-risk/mixed) |
| AC-2 | tested (deferred for session-extract) | Session-Extract-Pfad (`accumulateFromFiles`) bleibt bei 0.5 — heuristic regex match ist NICHT user-curated. Source `session-extract` ist im Schedule mit 0.5 dokumentiert für zukünftige Anpassung |
| AC-3 | tested | Bestehende V5-Files werden NICHT retroaktiv hochgestuft — F-091 wirkt auf neu geschriebene Einträge. Hub-Re-Migration via init-mode-Pipeline triggers re-extraction mit neuer Logik (eigenes Operation-Step) |
| AC-4 | tested | Tests: 17 neue (initFields opts-variant, source-table inspection, per-tag-type confidence, F-090+F-091 integration) |
| AC-5 | planned | Manual on GoetzeInvest hub: nach init-mode re-extraction zeigt decisions.md die @cap-decision-Anzahl. Validation-Step nach diesem PR |
| AC-6 | tested | Bug-Fix: `applyLearningSignals` spread-order — initFields() überschrieb pre-F-091 die source-aware Confidence der eingehenden Entry. Jetzt: initFields() fills only missing, newEntry wins. Decken via 4 angepasste Bestands-Tests + die F-091 integration tests |

**Files (geändert/neu):**
- `cap/bin/lib/cap-memory-confidence.cjs` — `initFields(opts)` akzeptiert `initialConfidence`, neue exports `SOURCE_INITIAL_CONFIDENCE` + `initialConfidenceForSource`, Bug-Fix in `applyLearningSignals`
- `cap/bin/lib/cap-memory-engine.cjs` — `accumulateFromCode` passt `initialConfidence` per Tag-Type
- `tests/cap-memory-engine-source-confidence.test.cjs` (neu, 17 Tests)
- 4 angepasste Bestands-Tests (cap-memory-confidence + adversarial) — explizite Tags assert nun 0.8/0.7

### F-092: Two-Phase Workflow — /cap:quick + /cap:finalize [shipped]

**Depends on:** F-003 (SESSION.json), F-047 (annotate), F-002 (Feature Map)

**Motivation:** Real-world Feedback von Bastian (2026-05-08, GoetzeInvest hub Frontend-Workflow). Beobachtung: `/cap:prototype` produziert durchdachtere, optimierte Implementations als raw Claude — aber für rapid Frontend-Iterationen ("button bigger", "spacing weg", "color anpassen") ist der Subagent-Spawn + AC-Validation-Cycle zu langsam. Bastian arbeitet effektiv in zwei Phasen die der Single-Mode CAP-Flow nicht abbildet:

- **Phase 1 — Visual Iteration**: schnelle Iterationen, "make it look right", direkte Browser-Feedback-Loop. Speed-Priorität, Architektur-Rigor irrelevant.
- **Phase 2 — Solidify**: wenn Visuals stehen, robuste Implementation nachholen — ACs definieren, Tests schreiben, Tags setzen, Refactoring prüfen.

Heute hat CAP nur den Phase-2-Modus. F-092 fügt Phase-1-Modus hinzu UND macht den Übergang explizit.

**Strategie:** Zwei symmetrische Commands die Bastians mentales Modell direkt abbilden:

- `/cap:quick [F-X]` — toggle in Phase 1. Trivial: SESSION.json-Flag + git HEAD snapshot für späteren Diff. Kein Subagent, kein Eingriff in Claude's normales Edit-Verhalten. Stop-Hook respektiert das Flag und überspringt Tag-Auto-Annotation (die heute ohnehin nicht existiert, aber forward-compat).
- `/cap:finalize` — chainet existing Tools post-hoc: changed-files seit Quick-Start identifizieren → cap-prototyper iterate-Mode für Refactoring + AC-Definition → cap-annotation-writer für `@cap-feature(F-X)` Tags → cap-tester für RED-GREEN gegen die neu definierten ACs → Feature-Map enrichFromTags für files-list. Meta-Command, keine neue Subagent-Logik nötig.

**Iter 1 strategy:** State-Layer (`cap-session.cjs` quickMode + Helper) + zwei Markdown-Commands. `/cap:finalize` ist eine sequenzierte Pipeline existing Tools — kein neuer Subagent. Forward-compat zum Hook (AC-3) ist heute no-op (Hook hat noch keinen Auto-Annotation-Pass). Hook-Anpassung kann später additive folgen wenn Auto-Annotation gebaut wird.

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | `cap-session.cjs` exportiert `startQuickMode(projectRoot, featureId)` setzt SESSION.json: `quickMode = { active, feature, startedAt, startCommit }`. F-X als zweiter Arg required vom Helper; Command-Layer löst optional auf via activeFeature |
| AC-2 | tested | `commands/cap/quick.md` druckt Workflow-Hint nach Toggle. Kein Subagent-Spawn |
| AC-3 | tested (forward-compat) | `quickMode.active` als Field im Schema; Hook-Read kann später additiv folgen wenn Auto-Annotation-Pass gebaut wird (heute kein Hook-Side-Effect, da Hook keine Auto-Annotation hat) |
| AC-4 | tested | `getChangedFilesSinceQuickStart(projectRoot)` returns committed (`git diff <startCommit> HEAD`) + unstaged (`git diff HEAD`) + untracked (`git ls-files --others --exclude-standard`), dedupliziert + sortiert. Excludes `.cap/`, `node_modules/`, `dist/`, `build/`, `.git/` |
| AC-5 | tested (command-layer) | `commands/cap/finalize.md` druckt Plan-Block mit changed-files-Liste + Sequenz-Übersicht, fragt yes/no Confirmation |
| AC-6 | tested (command-layer) | `/cap:finalize` Step 1 spawnt `cap-prototyper` im annotate-Mode mit den changed-files als Input |
| AC-7 | tested (command-layer) | Step 2 spawnt `cap-prototyper` im iterate-Mode für AC-Definition + Refactoring-Vorschläge |
| AC-8 | tested (command-layer) | Step 3 spawnt `cap-tester` für RED-GREEN Tests gegen die ACs |
| AC-9 | tested (command-layer) | Step 4 ruft `enrichFromTags` auf — updated FEATURE-MAP files-list |
| AC-10 | tested | `endQuickMode(projectRoot)` clears `quickMode.{active,feature,startedAt,startCommit}`, behält `activeFeature` (User-Wahl bleibt) |
| AC-11 | tested | `commands/cap/quick.md` (neu), `commands/cap/finalize.md` (neu) — vollständige User-Doku im Command-Format |
| AC-12 | tested | 13 Tests: default-state, startQuickMode (git + non-git), endQuickMode, getChangedFilesSinceQuickStart (5 cases), backwards-compat legacy SESSION.json |

**Files (geändert/neu):**
- `cap/bin/lib/cap-session.cjs` — `quickMode` field in CapSession + getDefaultSession; `startQuickMode`/`endQuickMode`/`isQuickModeActive`/`getChangedFilesSinceQuickStart` exports
- `commands/cap/quick.md` (neu)
- `commands/cap/finalize.md` (neu)
- `tests/cap-session-quick-mode.test.cjs` (neu, 13 Tests)

### F-094: Multi-Line @cap-* Description Capture [shipped]

**Depends on:** F-001 (Tag Scanner), F-046 (polylingual comment-context)

**Motivation:** Empirische Befunde am GoetzeInvest hub (2026-05-08, post-F-091): von 2422 `@cap-decision`-Einträgen sind **78% mid-sentence truncated** (enden ohne Satzzeichen), **84%** liegen im 60–90-Zeichen-Bucket, **0** Einträge ≥200 Zeichen. Root cause: `cap-tag-scanner.cjs` line 124 splittet `content.split('\n')`, `match[3]` ist alles bis Zeilenende — Multi-Line `@cap-decision`-Blöcke werden nach Zeile 1 gekappt. Beispiel im Hub: `// @cap-decision @react-pdf/renderer haengt an pdfkit/fontkit, die ihre Fonts\n// lokal aus assets/fonts laden müssen — daher webpack copy-plugin step` → nur Zeile 1 wird erfasst, der wichtige Teil ("daher webpack copy-plugin step") verschwindet.

Symptom-Folge: Memory-Pipeline produziert qualitativ entwertete Einträge. F-091 (source-aware confidence) hob alle auf 0.8 — aber 78% davon sind mid-cut. F-093 (Memory-Volumen via Sharding) wäre das falsche erste Werkzeug, weil es shrinkst was strukturell kaputt ist. F-094 fixt das ROOT-Problem; danach lässt sich F-093 datenbasiert zuschneiden (möglicherweise Volumen sogar kleiner durch besseres Dedup).

**Strategie:** Continuation-Pickup im Scanner. Nach einem `@cap-*`-Match werden Folgezeilen aufgenommen wenn sie Comment-Continuation-Form haben (gleicher Comment-Style, kein neuer @cap-Tag). Stop-Conditions schützen vor Über-Capture: leere Zeile, Code-Zeile, neuer @cap-Tag, Block-Close. Feature-Flag in `.cap/config.json` für Opt-Out (default ON).

**Iter 1 strategy:** Erweiterung von `extractTags()` in `cap-tag-scanner.cjs`. Detection des Comment-Tokens am Tag-Start, Loop über Folgezeilen mit Match-Continuation-Regex. Description-Concat mit Single-Space-Separator + Whitespace-Normalisierung. Keine Änderungen an `CAP_TAG_RE` selbst (F-001-Regression-Pin geschützt).

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Continuation-Lines (Comment-Lines direkt nach @cap-Tag, gleicher Comment-Style, kein neuer @cap-Tag) werden an `description` angehängt mit Single-Space-Separator |
| AC-2 | tested | Stop-Conditions: leere Zeile, Code-Zeile (ohne Comment-Token am Anfang), neue `@cap-*`-Tag-Zeile (auch design-tags), Block-Comment-Close-Token (`*/`, `"""`, `'''`) |
| AC-3 | tested | Funktioniert für Line-Comments (`//`, `#`, `--`) UND Block-Comment-Body (`* foo`, einfacher Indent ohne Token im `/* … */`-Block) |
| AC-4 | tested | `tag.line` bleibt die Zeile des @cap-Anchors. `tag.raw` bleibt die erste Zeile (für Migration-Kompatibilität) |
| AC-5 | tested | Whitespace-Normalisierung: Runs zu Single-Spaces, ausgangs-Trim, Comment-Tokens (`*`, `//`, `#`) am Anfang jeder Continuation entfernt vor Append |
| AC-6 | tested | Feature-Flag `multilineCapture.enabled` in `.cap/config.json` — default `true` (opt-out via `false`). F-046/AC-5 backward-compat-Pin (`extractTags.length === 2`) gewahrt durch Default-Param `options = {}` |
| AC-7 | tested | Volle Suite 7463/7469 grün (4 pre-existing Plugin-Drifts + Perf-Flakes, kein F-094-Regress). Neue Tests in `tests/cap-tag-scanner-multiline.test.cjs` (39 Tests) decken alle Stop-Conditions, Comment-Style-Varianten, Mixed-Indent, Feature-Flag opt-out |
| AC-8 | tested | Inline-Comments im Scanner erklären Continuation-Algorithmus + bewusst NICHT erfasste Cases (Cross-Block-Continuations, Continuations nach Leerzeilen) |

**Real-world Befund auf GoetzeInvest hub:** Re-Extraction über `apps/hub` (8323 Tags total, 2475 @cap-decisions) zeigt:

- Truncation-Rate: **78% → 4%** (-74 Prozentpunkte)
- Avg description length: 58 → 234 Zeichen (4×)
- Bucket 30-90 chars: 92% → 4%
- Volumen: 141 KB → 565 KB raw (4× growth, nicht shrink — Quality-Win, kein Volume-Win)
- Dedup-Collapse: 2% → 1% (Hypothese "truncated entries deduplizieren" widerlegt — 2475 unique mid-cuts waren tatsächlich unique)

→ F-093 (Memory-Volumen via Sharding) wird durch diesen Volume-Growth dringender; F-094 fixt aber das Quality-Fundament, ohne das F-093 nur kaputten Inhalt geshardiert hätte.

**Files (geändert/neu):**
- `cap/bin/lib/cap-tag-scanner.cjs` — `extractTags()` Continuation-Pickup, neue Helper `matchCommentContinuation`/`detectCommentTokenAt`, opt-out via `isMultilineCaptureEnabled()`
- `tests/cap-tag-scanner-multiline.test.cjs` (neu)

### F-093: V6 Memory-Pipeline Layout-Switch [shipped]

**Depends on:** F-076 (V6 schema), F-077 (one-shot migration tool with code-tag reverse-index classifier)

**Motivation:** F-077 ist eine ein-malige Migration — sie überträgt existierende V5-Daten ins V6-Format. Aber die laufende Memory-Pipeline (`hooks/cap-memory.js` + `cap-memory-dir.cjs:writeMemoryDirectory`) schreibt weiterhin **V5-monolithic** (`decisions.md`, `pitfalls.md`, ...). Real-world Hub-Befund (post-F-077-apply 2026-05-08):

- 195 V6-Per-Feature-Files via F-077 erstellt
- Aber Top-Level decisions.md (584 KB), pitfalls.md (77 KB) sind weiterhin im Layout
- Beim nächsten Hub-Memory-Hook-Run würden V5-Files überschrieben, V6-Files veralten
- Agent-Read-Pfad (`.claude/rules/cap-memory.md`) zeigt noch auf V5

→ F-077 alleine schafft nur einen "stale snapshot". F-093 macht V6 zur Standard-Schreibweise UND schaltet den Read-Pfad um.

**Strategie:** Opt-in via `.cap/config.json: { memory: { layout: 'v6' } }`. Im V6-Mode:

1. `writeMemoryDirectory` klassifiziert jeden Entry via F-077-Classifier (re-uses sourceFileToFeatureId Code-Tag-Reverse + key_files), gruppiert nach destination, schreibt features/F-XXX-<topic>.md + platform/<topic>.md.
2. Top-Level `decisions.md`/`pitfalls.md` werden zu Index-Files (auto-generated, eine Zeile pro Feature mit `F-XXX | n decisions | m pitfalls`) — Agent liest diese erst, dann gezielt ein Feature.
3. `.claude/rules/cap-memory.md` wird upgedated mit V6-Aware-Reading-Instructions (Index lesen, nur das aktive Feature on-demand).
4. V5-Mode (Default ohne config flag) bleibt unverändert — alle Bestandsprojekte unbeeinträchtigt.

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | `.cap/config.json: { memory: { layout: 'v6' } }` aktiviert V6-Pipeline-Mode. Default 'v5' bei fehlendem Flag (backwards-compat). |
| AC-2 | tested | Im V6-Mode schreibt `writeMemoryDirectory` per-feature Files unter `features/F-XXX-<topic>.md` statt monolithic `decisions.md`/`pitfalls.md`. |
| AC-3 | tested | Top-Level `decisions.md`/`pitfalls.md` werden auto-generated Index-Files (Tabelle: feature-id, count). Im V6-Mode keine entries-payload mehr darin. |
| AC-4 | tested | V6-Mode nutzt F-077 Classifier (`buildClassifierContext` + `classifyEntry`) für Per-Entry-Routing. Heuristic-extracted entries (kein `metadata.features`) werden klassifiziert via Code-Tag Reverse-Index + key_files; Fallback `platform/unassigned.md`. |
| AC-5 | tested | V5-Mode (default) ist byte-genau unverändert. Bestehende Tests in `cap-memory-dir*.test.cjs` bleiben grün ohne Änderung. |
| AC-6 | tested | `.claude/rules/cap-memory.md` upgedated: V6-Aware-Reading-Instructions (read index → on-demand per-feature). V5-Pfad bleibt erkenntnis-äquivalent dokumentiert für Bestandsprojekte. |
| AC-7 | tested | Switch V5→V6 ist atomar: erste schreibe-Operation im V6-Mode archiviert existierende V5-Files nach `.cap/memory/.archive/<name>-pre-v6-<date>.<ext>`, um Datenverlust zu vermeiden. Idempotent bei gleichem Datum. |
| AC-8 | tested | Tests: V5 default, V6 enabled (greenfield), V6 enabled mit Bestand (Hub-Szenario), V6 mit unklassifizierbaren Entries (Fallback platform). 18 neue Tests in `tests/cap-memory-dir-v6.test.cjs`, volle Suite 7495/7497 grün. |

**Files (geändert/neu):**
- `cap/bin/lib/cap-memory-dir.cjs` — V6-Mode in writeMemoryDirectory + neuer Helper `_writeMemoryV6`
- `cap/bin/lib/cap-memory-engine.cjs` — Optional, ggf. classification-helper
- `.claude/rules/cap-memory.md` — V6-Aware Reading-Instructions
- `tests/cap-memory-dir-v6.test.cjs` (neu)

### F-095: Memory Layout-Switch Activation CLI [tested]

**Motivation:** F-093 hat V6-Layout als Schreibmodus shipped, aber das Aktivieren auf einem Bestandsprojekt (V5→V6) hat keine UX. Der Stop-Hook returnt früh wenn keine neuen Sessions seit `.last-run` (siehe `~/.claude/hooks/cap-memory.js:114`), also wird `writeMemoryDirectory` nie aufgerufen — der V6-Dispatch greift nicht. `/cap:memory init` wäre der Workaround, processed aber alle Sessions (heavy: Hub hat 26).

**Real-world incident:** 2026-05-08 — Hub V6-Aktivierung erforderte ein Ad-hoc-Skript (`readMemoryFile` + `writeMemoryDirectory` direkt aufrufen, ~30 LOC). Funktional sauber, aber kein reproduzierbarer Pfad für Bastian / weitere Projekte.

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | `/cap:memory --switch-layout=v6` CLI: liest existing entries via `readMemoryFile(decisions.md/pitfalls.md)`, schreibt `.cap/config.json` mit `{memory:{layout:"v6"}}`, ruft `writeMemoryDirectory` einmal. Kein session-reprocess. <1s auf Hub-Größe (2740 entries). Smoke-Test: 0.4s greenfield, 1.0s bei 2740 entries. |
| AC-2 | tested | Atomar: writeMemoryDirectory zuerst (try/catch), config.json wird erst nach success geschrieben. Bei error bleiben V5-Files + alte config unverändert. Test sabotiert features/ als File → ENOTDIR → config bleibt unangetastet. |
| AC-3 | tested | Idempotent: Re-Run V6→V6 byte-identical. Detection via `(V6 Index)`-Marker im Top-Level decisions.md; bei present → `status: 'noop'`, sourceEntries=0, written=0. |
| AC-4 | tested | Reporting: returns `{ status, target, sourceEntries, written, configPath, archives }`. CLI-Wrapper in commands/cap/memory.md formatiert für stdout. |
| AC-5 | tested | 12 Tests in `tests/cap-memory-switch-layout.test.cjs` (5 describe-blöcke): greenfield V5→V6, decisions+pitfalls reading, config-after-success, error-rollback (sabotage features/), V6→V6 noop+byte-identical, reporting-payload, unsupported-target throws, no-V5 greenfield, config-merge mit other keys, layout-overwrite, missing-cap-dir defense. |

**Depends on:** F-093, F-077, F-076 (alle shipped).

**Out of scope:** V6→V5 Downgrade-Pfad (separates Feature falls nötig — V6-Files müssten zu Monolith aggregiert werden, anderes Operation-Profil).

**Files (geändert/neu):**
- `cap/bin/lib/cap-memory-dir.cjs` — neue Funktion `switchLayout(projectRoot, target)` exportiert (AC-1..AC-3)
- `commands/cap/memory.md` — neuer Subcommand-Block `--switch-layout=v6` (AC-1, AC-4)
- `tests/cap-memory-switch-layout.test.cjs` (neu, 12 Tests)

### F-096: Cross-App Memory Aggregation Index [tested]

**Motivation:** In Monorepos existieren mehrere `.cap/memory/`-Verzeichnisse (Root + pro App). Da die Root-Pipeline @cap-feature-Tags aus dem **gesamten** Monorepo scannt, dupliziert sie App-spezifische features beim V6-Switch — z.B. würde `F-HUB-USER-MESSAGES` sowohl in `apps/hub/.cap/memory/features/` als auch in `<root>/.cap/memory/features/` landen. F-096 baut einen Aggregation-Index am Root: per-app-features verweisen auf `apps/<app>/.cap/memory/features/...` (single source of truth pro feature), nur cross-cutting features (z.B. `F-PERF-SENTRY-TRACING`, `F-MIGRATION`, NX/monorepo-tooling) bleiben am Root lokal.

**Real-world Befund:** 2026-05-09 — GoetzeInvest-Monorepo-V6-Dry-Run am Root zeigte 198 feature-files, davon ~190 Duplikate von `apps/hub/.cap/memory/features/`. 316 unique feature-IDs total im Monorepo, ~250 hub-spezifisch. Token-Saving wäre positiv (660 KB → 32 KB Index), aber Memory-Architektur dupliziert Inhalt der schon in der App primär liegt. F-096 löst das ohne den Token-Win zu opfern.

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Monorepo-Detection: `_isMonorepoLayout(root)` erkennt sub-apps unter `apps/*/.cap/memory/decisions.md` mit `(V6 Index)`-Marker und gibt deren Namen zurück. Single-app oder V5-only-monorepos liefern leeres Array → Fallback auf Standard-V6 (F-093). 5 Tests. |
| AC-2 | tested | App-Routing per source-file: `_resolveAppForFile(filePath, v6Apps)` matcht `apps/<name>/...` und liefert Sub-App-Namen zurück; nicht-app-Pfade → null. Backslashes (Windows) und führende Slashes werden normalisiert. 5 Tests. |
| AC-3 | tested | Cross-cutting entries: Features ohne single-app-Source (Tags nur in Root-tools wie `nx.json`) bleiben in `<root>/.cap/memory/features/`. Multi-app entries (tags in 2+ apps) landen ebenfalls am Root als cross-cutting/ambiguous. 2 Tests. |
| AC-4 | tested | Root-Index: `<root>/.cap/memory/decisions.md` listet sub-app-owned features in einer "Cross-App"-Sektion mit relativem Pfad `../../apps/<app>/.cap/memory/features/F-XXX-*.md`. Helper `_findSubAppFeatureFile` resolviert echte Slug-Filenames. Wenn Sub-App-File noch nicht existiert: "(pending sub-app pipeline)"-Hinweis. 3 Tests. |
| AC-5 | tested | Append-only auf Sub-Apps: Root-Pipeline schreibt NIE in `apps/<app>/.cap/memory/`. Sub-App-Files bleiben byte-identisch nach Root-Run, kein neues File entsteht im Sub-App-features/. 2 Tests. |
| AC-6 | tested | Opt-out via `options.aggregate=false` (legacy F-093 behavior, Tests + escape hatch). Idempotenz: Re-Run produces byte-identischen Index. 2 Tests. |
| AC-7 | tested | End-to-end Integration: `writeMemoryDirectory` mit V6-config + Monorepo dispatched korrekt; Fallback bei nur-V5-sub-apps. 3 Tests. Plus `_findSubAppFeatureFile` Helper-Tests (3 Tests, inkl. Slug-Disambiguierung wo `F-HUB-CHAT` nicht versehentlich `F-HUB-CHAT-VOICE-NOTES`-Files matcht). 24 Tests total in `tests/cap-memory-aggregation.test.cjs`. |

**Depends on:** F-093 (V6-Layout), F-095 (Layout-Switch), F-077 (Classifier-AC-8), F-038 (Monorepo-Awareness)

**Out of scope (deferred):**
- Bidirektionale Sync — Sub-App liest Root-cross-cutting auto. Aktuell unidirectional (Root indexiert Apps).
- Race-conditions bei parallel hub+root pipelines — Single-process-Annahme, ggf. fs-lock falls relevant.
- Reverse-flow als F-097 oder Part-2 von F-096.

**Files (geändert/neu):**
- `cap/bin/lib/cap-memory-dir.cjs` — neue Helpers `_isMonorepoLayout`, `_resolveAppForFile`, `_findSubAppFeatureFile`. `_writeMemoryV6` um Aggregation-Routing erweitert. `_renderV6Index` mit "Cross-App"-Sektion. App-Detection auto via apps/*/.cap/memory/decisions.md V6-Marker — kein User-Flag.
- `tests/cap-memory-aggregation.test.cjs` (neu, 24 Tests)

**Real-world impact (Smoke-Test 2026-05-09 GoetzeInvest-Monorepo-Root):**
- 2966 V5 entries → F-093 ohne Aggregation hätte 198 features-files am Root geschrieben
- F-096 mit Aggregation: **4 cross-cutting features** lokal + **192 hub-features delegiert** an `apps/hub/.cap/memory/` (Index-only, kein Doppel-Write)
- Index 37.7 KB (vs. 661 KB V5-Monolith, +5 KB gegenüber F-093 wegen Cross-App-Sektion — vertretbar für saving 192 Duplikate)
- Cross-cutting korrekt erkannt: F-MIGRATION, F-AUTH, F-HUB-ROLES, F-HUB-SCHEMA (letzte zwei haben Source-Tags außerhalb apps/hub/, daher legitim cross-cutting)

## Legend

| State | Meaning |
|-------|---------|
| planned | Feature identified, not yet implemented |
| prototyped | Initial implementation exists |
| tested | Tests written and passing |
| shipped | Deployed / merged to main |

---
*Last updated: 2026-05-08T23:30:00.000Z*
