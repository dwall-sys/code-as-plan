---
name: cap:start
description: Initialize a CAP session -- restore previous session state, detect project context, and get working immediately.
allowed-tools:
  - Bash
  - Read
  - Write
  - AskUserQuestion
---

<!-- @gsd-context CAP v2.0 start command -- session initialization at the start of a new conversation. Restores .cap/SESSION.json state, detects workspace type, and presents current Feature Map status. -->
<!-- @gsd-decision Start reads SESSION.json to restore context from previous conversation. This is critical for cross-conversation continuity since Claude Code conversations are stateless. -->
<!-- @gsd-decision Start auto-runs /cap:init if .cap/ directory does not exist -- first-time users get bootstrapped automatically. -->

<objective>
Initialize a CAP session at the start of a new conversation:
1. Check if .cap/ exists -- if not, auto-initialize
2. Auto-detect project info from package.json and directory structure
3. Load .cap/SESSION.json for previous session state
4. List features from FEATURE-MAP.md for user selection
5. Present current status and suggest next action

No arguments needed -- always runs the same flow.
</objective>

<context>
$ARGUMENTS

@.cap/SESSION.json
@FEATURE-MAP.md
</context>

<process>

## Step 1: Check for .cap/ directory and auto-initialize

<!-- @gsd-todo(ref:AC-34) /cap:start shall initialize a session by setting the active feature in SESSION.json and restoring context from the Feature Map. -->

```bash
test -d .cap && echo "initialized" || echo "not_initialized"
```

**If not initialized:**

Log: "First run detected. Initializing .cap/ directory..."

```bash
node -e "
const session = require('./get-shit-done/bin/lib/cap-session.cjs');
session.initCapDirectory(process.cwd());
console.log('initialized');
"
```

Check if FEATURE-MAP.md exists:

```bash
test -f FEATURE-MAP.md && echo "exists" || echo "missing"
```

If FEATURE-MAP.md does not exist, generate the template:

```bash
node -e "
const fm = require('./get-shit-done/bin/lib/cap-feature-map.cjs');
const fs = require('node:fs');
const path = require('node:path');
const template = fm.generateTemplate();
fs.writeFileSync(path.join(process.cwd(), 'FEATURE-MAP.md'), template, 'utf8');
console.log('FEATURE-MAP.md created');
"
```

Log: "Created .cap/ directory and FEATURE-MAP.md"

## Step 2: Auto-detect project context

<!-- @gsd-todo(ref:AC-35) /cap:start shall auto-scope to the project by deriving project information from actual code (package.json, directory structure) rather than asking questions. -->

Detect project info from the filesystem -- no questions asked:

```bash
node -e "
const fs = require('node:fs');
const path = require('node:path');
const cwd = process.cwd();
const info = { name: path.basename(cwd), language: 'unknown', framework: 'unknown', testFramework: 'unknown' };

// Read package.json if available
const pkgPath = path.join(cwd, 'package.json');
if (fs.existsSync(pkgPath)) {
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    info.name = pkg.name || info.name;
    info.language = 'javascript';
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (allDeps.typescript) info.language = 'typescript';
    if (allDeps.react) info.framework = 'react';
    if (allDeps.next) info.framework = 'next.js';
    if (allDeps.express) info.framework = 'express';
    if (allDeps.vitest) info.testFramework = 'vitest';
    else if (allDeps.jest) info.testFramework = 'jest';
    else if (pkg.scripts && pkg.scripts.test && pkg.scripts.test.includes('node --test')) info.testFramework = 'node:test';
  } catch (e) {}
}

// Check for Python
if (fs.existsSync(path.join(cwd, 'requirements.txt')) || fs.existsSync(path.join(cwd, 'pyproject.toml'))) {
  info.language = 'python';
  if (fs.existsSync(path.join(cwd, 'pyproject.toml'))) {
    const content = fs.readFileSync(path.join(cwd, 'pyproject.toml'), 'utf8');
    if (content.includes('django')) info.framework = 'django';
    if (content.includes('fastapi')) info.framework = 'fastapi';
    if (content.includes('pytest')) info.testFramework = 'pytest';
  }
}

// Check for Go
if (fs.existsSync(path.join(cwd, 'go.mod'))) {
  info.language = 'go';
  info.testFramework = 'go test';
}

// Check for Rust
if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) {
  info.language = 'rust';
  info.testFramework = 'cargo test';
}

console.log(JSON.stringify(info));
"
```

Store as `project_info`.

## Step 3: Load session state

```bash
node -e "
const session = require('./get-shit-done/bin/lib/cap-session.cjs');
const s = session.loadSession(process.cwd());
console.log(JSON.stringify(s));
"
```

Store as `session`.

## Step 4: Load Feature Map and present features

```bash
node -e "
const fm = require('./get-shit-done/bin/lib/cap-feature-map.cjs');
const featureMap = fm.readFeatureMap(process.cwd());
const status = fm.getStatus(featureMap);
console.log(JSON.stringify({
  features: featureMap.features.map(f => ({ id: f.id, title: f.title, state: f.state, acCount: f.acs.length })),
  ...status
}));
"
```

Store as `fm_data`.

## Step 5: Present session context and select active feature

Display session restoration:

```
=== CAP Session Start ===

Project: {project_info.name} ({project_info.language} / {project_info.framework})
Test framework: {project_info.testFramework}

{If session.activeFeature:}
Previous session:
  Active feature: {session.activeFeature}
  Last step:      {session.step}
  Last command:   {session.lastCommand}

{End if}

Features ({fm_data.totalFeatures} total):
  planned:    {count}
  prototyped: {count}
  tested:     {count}
  shipped:    {count}
```

**If features exist, list them and ask user to select:**

```
Available features:
{For each feature:}
  {feature.id}: {feature.title} [{feature.state}] ({feature.acCount} ACs)
```

If `session.activeFeature` is set, offer to continue:

Use AskUserQuestion:
> "Continue working on {session.activeFeature} ({title})? Or enter a feature ID to switch (e.g., F-001). Type 'none' to work without a focused feature."

If no active feature:

Use AskUserQuestion:
> "Select a feature to focus on (enter feature ID, e.g., F-001), or type 'none' to skip."

**Process user response:**
- If a valid feature ID: set as active feature
- If `none` or `skip`: proceed without active feature
- If continuing previous: keep existing active feature

```bash
node -e "
const session = require('./get-shit-done/bin/lib/cap-session.cjs');
session.startSession(process.cwd(), '{selected_feature_id}', 'start');
console.log('Session updated');
"
```

## Step 6: Suggest next action

Based on current state, suggest:

- If no features: "No features found. Run /cap:brainstorm to discover features."
- If active feature is `planned`: "Run /cap:prototype to build initial code for {feature}."
- If active feature is `prototyped`: "Run /cap:iterate to refine, or /cap:test to write tests."
- If active feature is `tested`: "Run /cap:review to verify {feature}."
- If active feature is `shipped`: "All done with {feature}. Select a different feature or run /cap:brainstorm."

```
Session started. Suggested next: {action}
```

</process>
