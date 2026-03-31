# Brainstorm Ledger

## Session: 2026-03-30T12:09:36Z

### Decisions Made
- Monorepo Mode as v1.3 milestone — separate from existing single-project workflow
- Two-level .planning/ structure: root (global) + per-app (local)
- Package manifests as lightweight API summaries, not full code scans
- Hybrid context strategy: local app context primary, global context as reference, shared packages as manifests
- NX as primary target (user migrating from Turbo), but detect all workspace types
- App-scoping via --app flag propagated through all commands
- extract-tags scoped to app directory only when --app active

### Features Identified

| Feature | Group | Dependencies |
|---------|-------|-------------|
| Workspace auto-detection | Discovery | none |
| --app flag for command scoping | App-Scoping | Discovery |
| Per-app .planning/ directory | App-Scoping | Discovery |
| Scoped extract-tags | App-Scoping | Discovery |
| Package manifest generation | Package-Manifeste | Discovery |
| Manifest injection into agent context | Kontext-Hierarchie | Package-Manifeste, App-Scoping |
| Root vs app .planning/ separation | Kontext-Hierarchie | App-Scoping |
| Primary/reference context weighting | Kontext-Hierarchie | App-Scoping, Package-Manifeste |

### Scope Exclusions
- Monorepo build orchestration: NX handles this, not GSD's responsibility
- Cross-app dependency graph visualization: NX handles this
- Simultaneous multi-app sessions: too complex for v1.3, single-app focus per session

### Deferred Items
- None identified

### PRD Files Written
- .planning/PRD.md: Monorepo Mode for GSD Code-First (8 ACs)

## Session: 2026-03-30T12:30:00Z

### Decisions Made
- Migration support via --migrate flag on /gsd:monorepo-init (not separate command)
- Migration audits existing .planning/ per app, offers keep/archive/replace per app
- Root .planning/ split guided interactively — global vs app-specific
- Old .planning/ archived to .planning/legacy-{timestamp}/ (never deleted)
- Session app selector at monorepo detection — user picks app once, stays scoped
- Session state stored in .planning/SESSION.json (current_app field)
- /gsd:switch-app for mid-session app switching
- "Global" option in selector for root-level cross-app work

### Features Identified

| Feature | Group | Dependencies |
|---------|-------|-------------|
| --migrate flag on monorepo-init | Migration | Discovery |
| Per-app keep/archive/replace choice | Migration | Discovery |
| Root .planning/ split guidance | Migration | App-Scoping |
| Scoped CODE-INVENTORY regeneration | Migration | App-Scoping |
| App selector at session start | Session-Scoping | Discovery |
| Auto-scoping after selection | Session-Scoping | App-Scoping |
| /gsd:switch-app command | Session-Scoping | Session-Scoping |
| Global option in selector | Session-Scoping | Kontext-Hierarchie |

### Scope Exclusions
- Automatic detection of which app changed: user selects explicitly

### Deferred Items
- None identified

### PRD Files Written
- .planning/PRD.md: Monorepo Mode for GSD Code-First (updated to 16 ACs)

## Session: 2026-03-31T10:50:44Z

### Decisions Made
- Rebrand from GSD to CAP (Code as Plan) — new identity, npm package, command prefix /cap:, agent prefix cap-
- Big-bang release for v2.0 — clean break from GSD upstream, no backward compatibility
- Single FEATURE-MAP.md file as single source of truth (replaces ROADMAP.md, REQUIREMENTS.md, CODE-INVENTORY.md)
- Feature Map scales to 80–120 features in single file; directory splitting deferred
- Feature = smallest deployable capability ("A user can [verb] [object]")
- Feature state lifecycle: planned → prototyped → tested → shipped
- SESSION.json is ephemeral (gitignored), connects to Feature Map only via feature IDs (loose coupling)
- Tag system A+: @cap-feature + @cap-todo as primary mandatory tags
- @cap-todo supports structured subtypes: risk:, decision: (scannable conventions)
- @cap-risk and @cap-decision optional standalone tags, not enforced
- Killed tags: @gsd-status, @gsd-depends, @gsd-context
- Orphan tags flagged with fuzzy-match hint, developer decides
- 5 agents: cap-brainstormer, cap-prototyper (4 modes), cap-tester, cap-reviewer, cap-debugger
- cap-prototyper modes: prototype, iterate, architecture, annotate
- Kill list: gsd-discuss, gsd-planner, gsd-milestone-*, gsd-executor, gsd-annotator
- Tester stays as dedicated agent (separation of concerns: building vs breaking)
- Debugger stays as dedicated agent (hypothesis→test→verify is orthogonal to building)
- Annotator absorbed into cap-prototyper as 4th mode (annotate)
- Minimal init: FEATURE-MAP.md + .cap/SESSION.json + .cap/.gitignore — no wizard
- Context7 integration mandatory at init — fetch stack docs for every detected dependency
- Stack docs cached in .cap/stack-docs/, refreshed every 7 days or via /cap:refresh-docs
- Agents receive stack-docs as context; lazy-load new libraries on demand
- map-codebase absorbed into /cap:init brownfield flow — no separate /cap:map command
- Brownfield init: one-time analysis → suggest /cap:annotate for retroactive tagging
- 7 codebase documents replaced by: stack-docs, convention-reader, test-detector, @cap-todo subtypes
- All design decisions aligned with Dave Farley's "Modern Software Engineering" principles

### Features Identified

| Feature | Group | Dependencies |
|---------|-------|-------------|
| /cap:init (greenfield + brownfield) | Foundation | none |
| FEATURE-MAP.md schema and template | Foundation | none |
| .cap/SESSION.json state management | Foundation | none |
| Tag system (@cap-feature, @cap-todo) | Foundation | none |
| Tag scanner engine | Scanner | Foundation |
| /cap:scan command | Scanner | Foundation |
| Feature Map auto-enrichment | Scanner | Foundation |
| cap-brainstormer agent | Core Agents | Foundation |
| cap-prototyper agent (4 modes) | Core Agents | Foundation |
| cap-tester agent | Core Agents | Foundation |
| cap-reviewer agent | Core Agents | Foundation |
| cap-debugger agent | Core Agents | Foundation |
| /cap:brainstorm command | Commands | Core Agents |
| /cap:prototype command | Commands | Core Agents |
| /cap:iterate command | Commands | Core Agents |
| /cap:test command | Commands | Core Agents |
| /cap:review command | Commands | Core Agents |
| /cap:debug command | Commands | Core Agents |
| /cap:status command | Commands | Foundation |
| /cap:start command | Commands | Foundation |
| /cap:annotate command | Commands | Core Agents |
| /cap:refresh-docs command | Commands | Foundation |
| GSD command removal | GSD Removal | none |
| GSD agent removal | GSD Removal | none |
| GSD artifact deprecation | GSD Removal | none |
| CAP branding (package.json, install.js) | GSD Removal | none |
| Monorepo cross-package support | Integration | Scanner, Core Agents |
| End-to-end workflow lifecycle | Integration | All groups |

### Scope Exclusions
- GUI/web dashboard: CAP is CLI-native
- External PM tools (Jira, Linear, Asana): developer workflow tool, not PM bridge
- Multi-user collaboration: single-developer workflows
- AST-based parsing: regex sufficient for @cap-prefixed tags
- Directory-based Feature Map: single file scales to 120 features
- GSD backward compatibility: big-bang release
- AI orchestration frameworks: Claude Code native spawning sufficient
- /cap:map command: codebase analysis absorbed into init + annotate + refresh-docs

### Deferred Items
- Directory-based Feature Map for projects with >120 features
- Feature Map visual dependency graph rendering
- /cap:migrate command for converting GSD projects to CAP
- Plugin/extension system for custom agents
- Feature archival workflow (shipped → archived)
- Cross-repo feature references for multi-repo setups
- Telemetry/usage analytics
- /cap:export for generating reports from Feature Map

### PRD Files Written
- .planning/PRD.md: CAP v2.0 — Code as Plan (102 ACs)
