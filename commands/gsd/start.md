---
name: gsd:start
description: Initialize a GSD session — detect monorepo, restore last app context, or prompt for app selection
allowed-tools:
  - Bash
  - Read
  - Write
  - AskUserQuestion
---

# /gsd:start

Initialize a GSD session at the start of a new conversation. Detects workspace type, restores previous app context, and gets you working immediately.

## What This Does

1. Detects if this is a monorepo (NX, Turbo, pnpm workspaces)
2. If monorepo: checks for existing SESSION.json with default_app
3. If default_app exists: auto-scopes to that app — no questions asked
4. If no default but session exists: shows last active app, asks to continue or switch
5. If no session: runs workspace detection, presents app selector
6. If not a monorepo: skips all of this, confirms single-project mode

## Steps

### Step 1: Detect Workspace

```bash
WORKSPACE=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" detect-workspace 2>/dev/null || echo '{"type":"single"}')
```

Parse the JSON. If `type` is `single` or detection fails:

```
GSD session started (single project mode).
```

STOP here — no monorepo logic needed.

### Step 2: Check Existing Session

If monorepo detected, check for SESSION.json:

```bash
SESSION=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" session-get 2>/dev/null || echo "none")
```

**If SESSION.json exists with `default_app`:**

Auto-scope silently:

```
GSD session started.
Workspace: {type} ({N} apps)
Active app: {default_app} (default)

All commands scoped to {default_app}. Use /gsd:switch-app to change.
```

STOP here — user is ready to work.

**If SESSION.json exists with `current_app` but no `default_app`:**

```
GSD session started.
Workspace: {type} ({N} apps)
Last active app: {current_app}
```

Use AskUserQuestion:
- "Continue with {current_app}?"
  - "Yes — continue" — Keep current_app, proceed
  - "Switch app" — Go to Step 3
  - "Set as default" — Set current_app as default_app too, proceed

**If no SESSION.json:**

Proceed to Step 3.

### Step 3: App Selector (first time or switching)

```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" detect-workspace
```

List all apps. Use AskUserQuestion:

```
Monorepo detected ({type}). Which app do you want to work on?

Options:
- apps/dashboard
- apps/api
- apps/mobile
- ...
- [Global] — root-level cross-app work
```

After selection, ask:

```
Set {selected_app} as your default app? (auto-selects on future sessions)
```

- "Yes — set as default" — call `session-set-default` + `session-set`
- "Just this session" — call `session-set` only

### Step 4: Confirm

```
GSD session started.
Workspace: {type} ({N} apps)
Active app: {selected_app} {(default) if set as default}

All commands scoped to {selected_app}.
Use /gsd:switch-app to change. Use /gsd:switch-app --default to change the default.
```

## Auto-Start via CLAUDE.md

For automatic session detection, add this to your project's CLAUDE.md:

```markdown
## GSD Session

When starting a new conversation in this project, run `/gsd:start` to initialize
the session context. This detects the monorepo workspace and restores your last
active app.
```

This ensures every new Claude Code session automatically detects and scopes to the right app.
