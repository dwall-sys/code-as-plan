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
