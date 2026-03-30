---
name: monorepo-init
description: Initialize monorepo mode -- detect workspace, create per-app planning directories, generate package manifests
allowed_tools:
  - Bash
  - Read
  - Write
  - Glob
  - Grep
---

# /gsd:monorepo-init

Initialize GSD monorepo mode for this workspace.

## What This Does

1. Detects the workspace type (NX, Turbo, pnpm, or npm workspaces)
2. Lists all apps and shared packages found in the workspace
3. Creates per-app `.planning/` directories with stub PRD.md and FEATURES.md
4. Generates API manifests for all shared packages in `.planning/manifests/`
5. Reports the workspace structure so the user can confirm before proceeding

## Steps

### Step 1: Detect Workspace

Run the workspace detector to identify the monorepo type and enumerate apps/packages:

```bash
node get-shit-done/bin/gsd-tools.cjs detect-workspace
```

If no workspace is detected, inform the user:
- "No monorepo workspace detected. This project does not appear to be an NX, Turbo, pnpm, or npm workspace."
- "To use monorepo mode, ensure one of these files exists: nx.json, turbo.json, pnpm-workspace.yaml, or package.json with a workspaces field."
- STOP here.

### Step 2: Present Discovery Results

Show the user what was detected:

```
Workspace detected: [NX/Turbo/pnpm/npm]
Root: [absolute path]

Apps ([count]):
  - [app-name] at [relative-path]
  - ...

Shared Packages ([count]):
  - [package-name] at [relative-path]
  - ...
```

Ask the user to confirm before proceeding. If they want to exclude any apps or packages, note their preferences.

### Step 3: Create Per-App Planning Directories

For each detected app, create an app-scoped `.planning/` directory using the CLI subcommand:

```bash
node get-shit-done/bin/gsd-tools.cjs monorepo-init-app [app-path] --name [app-name]
```

This creates:
```
[app-path]/.planning/
[app-path]/.planning/PRD.md                       (stub with app name)
[app-path]/.planning/FEATURES.md                   (stub, populated by extract-plan --app)
[app-path]/.planning/prototype/                    (directory for extract-plan output)
[app-path]/.planning/prototype/CODE-INVENTORY.md   (stub, populated by extract-plan --app)
```

Run the command once for each app discovered in Step 1. Do NOT create planning directories for shared packages -- packages get manifests instead.

### Step 4: Generate Package Manifests

For each shared package, generate an API manifest:

```bash
node get-shit-done/bin/gsd-tools.cjs generate-manifests
```

Manifests are written to `.planning/manifests/[package-name].md` and contain:
- Package name, version, description
- Exported symbols (functions, classes, types, constants)
- Internal workspace dependencies

### Step 5: Verify Global Planning Structure

Ensure root `.planning/` has the standard structure for cross-app concerns:

- `.planning/PROJECT.md` -- global project context (should already exist)
- `.planning/ROADMAP.md` -- global roadmap (should already exist)
- `.planning/manifests/` -- package manifests (just created)

If PROJECT.md or ROADMAP.md do not exist, warn the user but do not create them (they should run `/gsd:init` first for global planning).

### Step 6: Report Summary

```
Monorepo mode initialized.

Workspace: [type]
Apps with .planning/: [count]
Package manifests generated: [count]
Manifest directory: .planning/manifests/

To scope commands to a specific app:
  /gsd:prototype --app [app-path]
  /gsd:extract-plan --app [app-path]
  /gsd:iterate --app [app-path]

Global planning docs remain at root .planning/ for cross-app decisions.
```

## Important Notes

- This command is idempotent -- running it again will update manifests but not overwrite existing PRD.md or FEATURES.md files
- The `--app` flag on other commands (prototype, iterate, extract-plan, add-tests, review-code) uses the workspace detection to validate the app path
- Package manifests are regenerated each time; they are derived artifacts like FEATURES.md
- Root `.planning/` continues to hold PROJECT.md, ROADMAP.md, and cross-app architecture decisions
