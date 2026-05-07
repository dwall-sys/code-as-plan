# Changelog

All notable changes to CAP (Code as Plan) will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [6.0.0] - 2026-05-07

Major release: V5 Self-Learning Stack + V6 Memory Foundation + V6.1 Format-Tolerance + V6.2 Onboarding-Orchestrator. Closes the gap between code and project knowledge — every decision, pitfall, and pattern lives in a structured memory layer that agents consume automatically.

### Added — V5: Self-Learning Stack

- **Token Telemetry (F-061)** — per-session token counts, agent-spawn-times, tool-call-rates, error-rates. Observability foundation for the learning loop.
- **Learning Signal Collection (F-070)** — subprocess-hook-state via persistent ledger in `.cap/learning/signals.jsonl`. E2E spawnSync-Tests for hook-state-leak detection.
- **Pattern Extraction (F-071)** — heuristic-layer + LLM-layer (via Skill-Briefing-Pattern, no SDK). Extracts recurring patterns from session signals.
- **Two-Layer Fitness Score (F-072)** — statistical (success-rate over N runs) + semantic (LLM-judge). 3-layer determinism probes via @cap-risk pattern.
- **Pattern Review (F-073)** — manual `cap:learn` gate for patterns above confidence threshold. Promote / reject / defer; promoted patterns persisted to `.cap/learning/applied-state.json`.
- **Pattern Unlearn (F-074)** — auto-retract on 3 consecutive fitness drops. Defense-in-depth at git-modules, atomic-write for runtime-config, sandbox-discipline pinned.
- **Trust-Mode Configuration (F-075)** — config slot for trust-level governance.

### Added — V6: Memory Foundation

- **Per-Feature Memory Format (F-076)** — `.cap/memory/F-NNN.md` files with frontmatter + Auto/Manual-block split. Auto-block is reproducible (pipeline can re-generate); Manual-block is user-authored and never overwritten. Round-trip byte-identical.
- **V6 Memory Migration Tool (F-077)** — hybrid classifier with atomic writes + dry-run UX. Title-prefix-heuristic with occurrence-threshold (D7) for legacy → V6 migration.
- **Platform-Bucket for Cross-Cutting Decisions (F-078)** — `.cap/memory/platform/<topic>.md` for decisions that don't belong to a single feature. Explicit-only promotion via `@cap-decision platform:<topic>` (no auto-promotion). Extends-resolver with cycle-detection (full chain in error message). Subsystem-checklists at `platform/checklists/<subsystem>.md`.

### Added — V6 Konsumenten

- **Snapshot-Linkage to Features and Platform (F-079)** — `cap:save` reads `activeFeature` from SESSION.json by default; flags `--unassigned` and `--platform=<topic>` for explicit targeting. Memory pipeline references snapshots in Auto-block under `linked_snapshots` section, idempotent re-run. Orphan snapshots aggregated under `platform/snapshots-unassigned.md`.
- **Bridge to Claude-native Memory (F-080)** — read-only consumer of `~/.claude/projects/<slug>/memory/MEMORY.md`. Cache at `.cap/memory/.claude-native-index.json` with mtime-invalidation. `/cap:start` and `/cap:status` surface up to 5 prioritized bullets per active feature (3-tier priority: activeFeature direct → related_features → globals). Hard read-only contract pinned by stat/sha probe in tests.

### Added — V6.1: Format-Tolerance + Monorepo

- **Multi-Format Parser (F-081)** — long-form feature IDs (`F-HUB-AUTH`, `F-PAYMENT-CHECKOUT`), bullet-style ACs (`- [ ] AC-1: Description`), per-block format-detection, `.cap/config.json:featureMapStyle` override, safe-mode opt-in (`{safe: true}`) for non-throwing duplicate handling.
- **Monorepo Aggregation (F-082)** — hard contract `### Rescoped Feature Maps` header lists sub-app paths; opt-in directory walk via `featureMaps.discover: "auto"|"table-only"`. Cross-sub-app resilience: parseError in one sub-app no longer blocks healthy others. Header-separator tolerance: colon, em-dash, en-dash, hyphen-with-whitespace.
- **Monorepo Module Extraction (F-083)** — refactor: `cap-feature-map.cjs` 2336 → 1495 LOC; new `cap-feature-map-monorepo.cjs` (882 LOC) holds aggregation concerns. Lazy-require cycle-resolution with identity-preservation. Zero behavior change.

### Added — V6.2: Onboarding-Orchestrator

- **`/cap:upgrade` Command (F-084)** — single command for first-run onboarding in existing repos OR after CAP major-update. 7-stage idempotent pipeline: doctor → init-or-skip → annotate → migrate-tags → memory-bootstrap → migrate-snapshots → refresh-docs. Dry-run-first UX with per-stage delta-probes (read-only, <2s combined). User-confirm gate per stage; `--non-interactive` for CI; `--skip-stages=…`; `--dry-run-only`; `--force-rerun`.
- **`.cap/version` Marker** — atomic-written marker tracks installed CAP version + completed-stages + last-run timestamp. Re-run after CAP update detects only missing migrations.
- **`.cap/upgrade.log`** — JSONL audit-trail, one line per stage attempt with timestamp + success/failure + reason.
- **SessionStart Version-Check Hook** — non-blocking advisory at session start when version mismatch detected. Max 1× per session via `.cap/.session-advisories.json` mtime throttle. Suppressible via `.cap/config.json:upgrade.notify=false`.

### Added — Quality &amp; Infrastructure

- **F-082 post-ship hardening** — 4 micro-fixes (cross-sub-app blast radius, partial-write-logging, ANSI-defense in console.warn, addFeature asymmetry doc).
- **CI Path 2 — 552 spawnSync→in-process migrations** across 14 test files (commands, state, config, init, phase, verify-health, workstream, workspace, agent-skills, profile-output, quick-research, agent-install-validation, claude-md, plus long-tail). 2-30× speedup per file on plain `npm test` runs.
- **Security regex word-boundaries** — 12 of 18 prompt-injection patterns tightened with `\b` boundaries to eliminate substring false-positives (e.g. `contract**act** as` no longer fires the `act\s+as` pattern).
- **Empirical CI #42 documentation** — Path 1 (drop `--experimental-test-isolation=none`) tested 4× and rejected (native pre/post Path 2 + c8 + Node 22/23/24/25 sweep). Root cause is Node's worker-coverage-aggregator, not subprocess fixtures. Documented in `scripts/run-tests.cjs` for future investigators.

### Added — Stage-2 Class Lessons (12 patterns, applied upfront on F-080+)

Proto-pollution defense · ANSI-injection defense at every user-controlled interpolation site · path-traversal (slug-regex, NUL-bytes, traversal) · silent-skip is REAL silent (capture stdout+stderr) · cache TOCTOU benign + documented · atomic writes via tmpfile+rename · round-trip byte-identity · surface-limit hard-cap (not best-effort) · priority tie-break determinism · missing/empty/malformed input graceful handling · realistic fixtures (mkdtempSync, no synthetic-only blindspots) · read-only contracts pinned in tests.

### Changed

- **Memory architecture** — from flat per-thread graph (V4) to structured wissensgraph with per-feature/platform/checklists/snapshots/claude-native bridge.
- **`cap-feature-map.cjs` split** — monorepo concerns moved to dedicated module; `cap-feature-map-internals.cjs` holds shared constants.
- **`scripts/run-tests.cjs`** — `@cap-decision(CI/issue-42)` block documents 4× Path 1 rejection with measurements.

### Fixed

- **F-082 em-dash header-separator regression** — synthetic fixtures had only colon-separator; real-world GoetzeInvest uses em-dash. Iter-2 fix widens `featureHeaderRE` to accept colon, em-dash, en-dash, hyphen-with-whitespace.
- **`prompt-injection-scan` false-positive** on `cap-snapshot-linkage.cjs:692` (substring `contract**act** as` matched `act\s+as`).
- **CI timeout** raised 10 → 20 minutes (bridge fix while real CI #42 investigation ran).

### Migration Path

For users on v4.x or v5.x: run `/cap:upgrade` once. The orchestrator detects your state, plans only the missing migrations, and atomically applies them. No manual command sequencing needed.

For first-time users in existing brownfield projects: same — `/cap:upgrade` works as onboarding entry-point.

### Documentation

- **`docs/CAP-STATUS-UND-MIGRATION.html`** — comprehensive single-file HTML status snapshot covering architecture, all V5/V6/V6.1/V6.2 features, workflows, best practices, anti-patterns, and step-by-step migration guide for existing projects.

## [4.0.0] - 2026-04-06

### Added
- **Neural Memory Clustering** — CAP's memory system now automatically detects thematic clusters across conversation threads, enabling intelligent cross-session recall
- **Multi-Signal Affinity Engine (F-036)** — composite affinity scoring with 8 signal types (feature overlap, shared files, keyword similarity, temporal proximity, concept drift, dependency chain, author overlap, edit pattern), configurable weights, and persistence
- **Semantic Analysis Pipeline (F-037)** — seed taxonomy with 40+ software engineering concepts, TF-IDF keyword extraction, concept drift detection between thread snapshots, and semantic similarity scoring
- **Neural Cluster Detection (F-038)** — automatic clustering of related threads using affinity thresholds, auto-generated cluster labels from shared concepts, dormant node detection, and graph integration
- **Realtime Affinity Detection (F-039)** — 4 realtime signals evaluated during active sessions, gradient UX bands (urgent/notify/silent/discard), session-scoped caching, and sub-200ms evaluation
- **Cluster Commands and Status Integration (F-040)** — `/cap:cluster` command for cluster overview and detail views, Neural Memory section in `/cap:status`, passive affinity checks in `/cap:start` and `/cap:brainstorm`
- **`/cap:cluster` command** — display detected clusters with labels, member threads, affinity scores, shared concepts, and drift status
- **Neural Memory in `/cap:status`** — active cluster count, dormant nodes, highest-affinity thread pair, last clustering timestamp
- **Passive thread surfacing** — `/cap:start` and `/cap:brainstorm` now automatically surface related prior threads before session work begins

### Changed
- Memory system upgraded from flat graph to intelligent clustering — threads are no longer isolated nodes but form semantic neighborhoods
- Project Memory System is now a complete cognitive layer: extract (v2.x) → connect (v3.x) → **cluster and recall (v4.0)**

## [3.2.0] - 2026-04-04

### Added
- **Thread system wired into brainstorm pipeline** — `/cap:brainstorm` now checks prior threads, persists new threads after approval, and supports `--resume` to continue a previous thread
- **Memory graph active** — `cap-memory.js` hook builds/updates `.cap/memory/graph.json` after each session (incremental updates, full rebuild on init)
- **Brainstorm session migration** — `/cap:init` scans past sessions for brainstorm activity and migrates them to conversation threads
- **Memory bridge** — `initCapDirectory()` creates `.claude/rules/cap-memory.md` so Claude auto-reads `.cap/memory/` for project decisions and pitfalls
- **`activeThread` in SESSION.json** — tracks current brainstorm thread for `--resume`
- **`cap/bin/cap-tools.cjs`** — CLI entrypoint restored (was accidentally deleted during GSD→CAP migration), renamed from `gsd-tools.cjs`

### Fixed
- **Session timestamp extraction** — `getSessionFiles()` now scans first 4KB instead of only line 1, adapting to new Claude Code JSONL header format (`permission-mode`, `file-history-snapshot`)
- **GSD hook cleanup** — installer `detectAndCleanupGSD()` now removes `gsd-*.js` hook files (not just agents and legacy dirs)
- **Codex SessionStart hook** — updated from `gsd-update-check.js` to `cap-check-update.js`
- **Complete GSD→CAP test migration** — all `gsd-*` agent/command references updated to `cap-*` across 95 files, fixing 58 CI test failures
- **Windows test compatibility** — `HOME=''` and path assertion fixes for Windows CI
- **Security scan** — removed credential-like URL examples from plan-phase docs

### Changed
- Brainstormer agent now references prior threads during conversation and includes divergence awareness (Step 2b)
- `/cap:init` Step 7f builds memory graph from existing Feature Map + memory data
- `/cap:init` Step 7g migrates past brainstorm sessions to threads (one-time, idempotent)

## [3.0.0] - 2026-04-03

### Added
- **Project Memory System** — persistent, code-first project memory shared across developers and sessions
- **Conversation Thread Tracking (F-031)** — brainstorm sessions persisted as named threads with branching, keyword-based revisit detection, and git-tracked thread index
- **Thread Reconnection and Synthesis (F-032)** — 4 reconnection strategies (merge, supersede, branch, resume), AC conflict detection, resolution logging
- **Feature Impact Analysis (F-033)** — proactive overlap detection during brainstorming, full dependency chain traversal, circular dependency warning, advisory-only resolution proposals
- **Connected Memory Graph (F-034)** — typed nodes (feature, thread, decision, pitfall, pattern, hotspot) with labeled edges (depends_on, supersedes, conflicts_with, branched_from, informed_by, relates_to), temporal queries, BFS traversal
- **Interactive HTML documentation** — single-file dark-themed docs page with sidebar nav, command search, language tabs, architecture diagrams

### Changed
- Memory system now follows Code-First principle: decisions from `@cap-decision` tags, pitfalls from `@cap-todo risk:`, hotspots from session edit frequency
- Dropped heuristic-based text extraction from sessions (was 97% noise)
- Flat memory files (decisions.md, hotspots.md, pitfalls.md, patterns.md) are now generated views from the memory graph
- Installer banner updated: purple CAP logo, v3 feature highlight
- README updated with comprehensive Memory System section

### Fixed
- Annotation writer no longer writes to `.md`, `.json`, `.html`, `.css`, `.lock`, `.svg` files
- Memory engine noise patterns expanded (12 new filters for progress reports, AC tables, ASCII art, file paths)
- False-positive pitfalls from engine comments eliminated
- GoetzeInvest monorepo cleaned (28 files, 128 lines of injected annotations removed)

## [2.6.0] - 2026-04-03

### Added
- **Code-first memory** — `accumulateFromCode()` reads `@cap-decision` and `@cap-todo risk:` tags as primary memory source
- **Multi-developer merge** — anchor-ID deduplication for shared `.cap/memory/` across team

### Changed
- Session extraction provides only hotspots (edit frequency) — decisions/pitfalls come from code tags only
- All heuristic text extraction from sessions removed

## [2.5.1] - 2026-04-03

### Fixed
- **Annotation blocklist** — `.md`, `.json`, `.html`, `.lock` etc. can never receive `//` annotations
- Tightened decision patterns: require verb+noun ("I decided", "the fix is") not just keywords
- Tightened pitfall patterns: require context ("don't do X", "watch out for") not just "bug"
- 12 new noise filters (progress reports, @cap-tags, ASCII art, AC tables, file paths)
- Max sentence length reduced 500→300 to filter conversational noise
- Cleaned 6 polluted source files in CAP repo, 28 files in GoetzeInvest

## [2.5.0] - 2026-04-03

### Added
- **Memory heuristics tuning** — improved noise filtering for decision/pitfall detection
- **Monorepo-aware session discovery** — `getAllSessionFiles()` scans sub-project sessions
- **Hotspot detection** — files ranked by cross-session edit frequency
- **Incremental memory mode** — `init` for full bootstrap, default for incremental (since `.last-run`)

## [2.4.0] - 2026-04-03

### Added
- **Automatic project memory (F-027, F-028, F-029, F-030)** — post-session hook accumulates decisions, pitfalls, patterns, hotspots
- **Session Extract CLI (F-025)** — `cap extract list|stats|conversation|code|summary` subcommands
- **Cross-Session Aggregation (F-026)** — `cap extract decisions --all|hotspots|timeline|cost` subcommands

## [2.3.0] - 2026-04-03

### Added
- **Context snapshot commands** — `/cap:save` and `/cap:continue` for cross-session continuity
- **Enhanced statusline** — shows active feature, context usage, monorepo app
- **Pre-Work Pitfall Research (F-024)** — Context7-based pitfall briefing before prototype and debug
- **Emoji AC Status Display (F-023)** — emoji indicators in terminal output after prototype/test
- **Deploy-Aware Debug Workflow (F-022)** — hypothesis-first debugging with deploy logbook

## [2.2.0] - 2026-04-02

### Added
- **Resilient Module Loading (F-020)** — error recovery with self-repair and retry
- **Module Integrity Verification (F-019)** — doctor checks all CJS modules exist and load
- **Installer Hardening (F-021)** — stale file cleanup, post-install verification, --force flag

### Changed
- Complete GSD→CAP migration: all tags, hooks, config, strings renamed
- Hook files renamed from `gsd-*.js` to `cap-*.js`
- Config tag_prefix fixed from `@gsd-` to `@cap-`

## [2.1.0] - 2026-04-01

### Added
- **`/cap:doctor`** — health check for all required and optional dependencies
- **Statusline update notification** — shows when newer CAP version is available

### Fixed
- Statusline reads `cap-update-check.json` instead of `gsd-update-check.json`

## [2.0.0] - 2026-04-01

### Added
- **CAP — Code as Plan** — complete rebrand from GSD Code-First
- **5-step workflow** — brainstorm → prototype → iterate → test → review
- **Tag System** — 2 mandatory (`@cap-feature`, `@cap-todo`) + 2 optional (`@cap-risk`, `@cap-decision`)
- **FEATURE-MAP.md** — single source of truth (replaces roadmap + requirements + milestones)
- **5 agents** — brainstormer, prototyper, tester, reviewer, debugger
- **Tag Scanner (F-001)** — language-agnostic regex extraction
- **Feature Map Management (F-002)** — read/write/enrich FEATURE-MAP.md
- **Session State (F-003)** — `.cap/SESSION.json` for workflow state
- **Context7 Integration (F-004)** — library docs in `.cap/stack-docs/`
- **Doctor (F-005)** — dependency health check
- **Test Audit (F-007)** — assertion density, mutation testing, trust score
- **Multi-Runtime Installer (F-008)** — Claude Code, OpenCode, Gemini, Codex, Copilot, Cursor, Windsurf, Antigravity
- **Hooks System (F-009)** — prompt guard, statusline, update checker, context monitor, workflow guard
- **Monorepo Support (F-012)** — NX, Turbo, pnpm workspace auto-detection
- **GSD→CAP Migration (F-006)** — `/cap:migrate` with tag conversion and `--rescope` for per-app Feature Maps

---

*For GSD Code-First v1.x changelog, see the [v1.x branch](https://github.com/dwall-sys/code-as-plan/tree/gsd-v1).*
