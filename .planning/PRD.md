# Monorepo Mode for GSD Code-First

## Overview

GSD Code-First currently treats a monorepo as a single project, producing oversized CODE-INVENTORY.md files (5000+ lines) and mixing context across all apps. This wastes tokens, dilutes agent focus, and creates redundant scanning.

Monorepo Mode adds app-scoping, package manifests, workspace discovery, migration from existing setups, and session-level app selection so agents work with focused, relevant context. Designed for NX workspaces with apps/ and packages/ structure.

## Acceptance Criteria

### Workspace Discovery & Setup
- AC-1: GSD auto-detects NX/Turbo/pnpm workspaces and lists available apps and packages on project initialization
- AC-2: User can scope any GSD command to a specific app via --app flag (e.g., /gsd:prototype --app apps/dashboard)
- AC-3: Each scoped app gets its own .planning/ directory with independent CODE-INVENTORY.md, PRD.md, and FEATURES.md
- AC-4: extract-tags scans only the scoped app directory (not the full monorepo) when --app is active

### Package Manifests
- AC-5: Shared packages get auto-generated API manifests (exports, types, one-line descriptions) stored in root .planning/manifests/
- AC-6: Package manifests are included as lightweight context when working on any app that depends on that package

### Context Hierarchy
- AC-7: Root .planning/ holds global decisions, architecture docs, and cross-app concerns; app .planning/ holds app-specific work
- AC-8: Agent receives local app context as primary and global context as reference -- no full monorepo scan needed

### Migration
- AC-9: /gsd:monorepo-init --migrate detects existing .planning/ directories in apps and presents an audit of what exists where
- AC-10: User can choose per app to keep, archive, or replace existing .planning/ during migration
- AC-11: Root .planning/ contents are analyzed and user is guided to split global concerns from app-specific items
- AC-12: After migration, scoped CODE-INVENTORY.md is regenerated per app (replacing the monolithic version)

### Session App Selector
- AC-13: When a monorepo is detected at session start, user is presented with an app selector ("Which app do you want to work on?")
- AC-14: After selection, all GSD commands automatically scope to the chosen app without requiring --app flag
- AC-15: User can switch apps mid-session via an explicit command (e.g., /gsd:switch-app)
- AC-16: "Global" option in the selector allows working at root level for cross-app concerns

## Out of Scope

- Monorepo build orchestration (NX handles this)
- Cross-app dependency graph visualization (NX handles this)
- Simultaneous multi-app sessions (work on one app at a time)
- Automatic detection of which app changed (user selects explicitly)

## Technical Notes

- Workspace detection reads nx.json, turbo.json, and pnpm-workspace.yaml
- Package manifests follow the same pattern as @gsd-api tags but at package level
- --app flag propagates through the full pipeline: brainstorm, prototype, iterate, extract-plan, add-tests, review-code
- App-scoped .planning/ directories use the same structure as root .planning/
- Session scoping stored in .planning/SESSION.json (current_app field) -- read by all commands
- Migration archives old .planning/ to .planning/legacy-{timestamp}/ before restructuring
