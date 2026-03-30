---
name: switch-app
description: Switch the active app in a monorepo session -- updates SESSION.json so all subsequent GSD commands scope to the selected app
allowed_tools:
  - Bash
  - Read
  - Write
  - AskUserQuestion
---

# /gsd:switch-app

Switch the active monorepo app for this session.

**Flags:**
- `--default` — also set the selected app as the default for future sessions (auto-selects on startup)

## What This Does

1. Reads the current monorepo session from `.planning/SESSION.json`
2. Lists all available apps detected in the workspace
3. Presents an app selector (including a "Global" option for root-level work)
4. Updates `SESSION.json` with the user's choice
5. Confirms the switch so the user knows all commands are now scoped

## Steps

### Step 1: Verify Monorepo Session

Read `.planning/SESSION.json` to confirm a monorepo session exists.

If the file does not exist or `workspace_type` is `single`:
- "No monorepo session found. Run `/gsd:monorepo-init` first to set up monorepo mode."
- STOP here.

### Step 2: Load Available Apps

Read the `available_apps` array from `SESSION.json`. Also note the `current_app` value to show which app is currently active.

If `available_apps` is empty:
- "No apps found in the session. Run `/gsd:monorepo-init` to re-detect the workspace."
- STOP here.

### Step 3: Present App Selector

Use `AskUserQuestion` to present the app selector:

```
Which app do you want to work on?

  1. apps/dashboard (current)
  2. apps/api
  3. apps/landing
  4. [Global] -- root-level cross-app work

Enter the number or app path:
```

Mark the currently active app with "(current)". Always include the Global option as the last entry.

### Step 4: Update Session

Based on the user's selection:

- If they chose a numbered app: set `current_app` to that app's path
- If they chose "Global" or the global number: set `current_app` to `null`
- If they typed an app path directly: validate it exists in `available_apps`, then set it

Write the updated `SESSION.json`:

```json
{
  "current_app": "apps/dashboard",
  "workspace_type": "nx",
  "available_apps": ["apps/dashboard", "apps/api", "apps/landing"],
  "updated_at": 1711756800000
}
```

### Step 4b: Set Default (if --default flag)

If `--default` is present in the arguments:

```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" session-set-default {selected_app_path}
```

Log: "Default app set to **{app-path}**. This app will auto-select on future session starts."

### Step 5: Confirm Switch

Report the result:

- If an app was selected: "Switched to **[app-path]**. All GSD commands now scope to this app."
- If Global was selected: "Switched to **Global** scope. GSD commands will operate at the monorepo root level for cross-app concerns."

Show what this means practically:
```
Active scope: apps/dashboard

Commands will now operate on:
  Source: apps/dashboard/
  Planning: apps/dashboard/.planning/
  Inventory: apps/dashboard/.planning/prototype/CODE-INVENTORY.md

To switch again: /gsd:switch-app
To work globally: /gsd:switch-app and select Global
```

## Important Notes

- This command only changes the session state -- it does not modify any code or planning files
- The `--app` flag on any command always overrides the session selection for that single invocation
- If the workspace has changed since `monorepo-init` was run (apps added/removed), run `/gsd:monorepo-init` again to refresh the available apps list
- SESSION.json is a local file and should be added to `.gitignore` -- it is session-specific, not shared across developers
