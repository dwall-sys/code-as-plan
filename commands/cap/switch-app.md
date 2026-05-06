---
name: cap:switch-app
description: "Switch active app in a monorepo -- lists available workspace packages, shows tag counts, updates SESSION.json."
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
---

<!-- @cap-feature(feature:monorepo-scoping) Per-app monorepo scoping -- switch active app context for all CAP commands. -->

<objective>
Switch the active app in a monorepo project. Lists available workspace packages with their tag counts, lets the user select one, updates SESSION.json, and shows the selected app's FEATURE-MAP.md status.

If the project is not a monorepo, inform the user and exit.
</objective>

<context>
$ARGUMENTS

@.cap/SESSION.json
</context>

<process>

## Step 1: Detect monorepo

```bash
node -e "
const session = require('./cap/bin/lib/cap-session.cjs');
const result = session.listApps(process.cwd());
console.log(JSON.stringify(result));
"
```

Store as `mono_info`.

**If not a monorepo:**
Log: "This project is not a monorepo. /cap:switch-app is only available for monorepo projects."
Exit.

## Step 2: Get current session state

```bash
node -e "
const session = require('./cap/bin/lib/cap-session.cjs');
const s = session.loadSession(process.cwd());
console.log(JSON.stringify({ activeApp: s.activeApp }));
"
```

Store as `current_session`.

## Step 3: Scan each app for tag counts

For each app in `mono_info.apps`:

```bash
node -e "
const scanner = require('./cap/bin/lib/cap-tag-scanner.cjs');
const fm = require('./cap/bin/lib/cap-feature-map.cjs');
const fs = require('node:fs');
const path = require('node:path');
const projectRoot = process.cwd();
const apps = JSON.parse(process.argv[1]);
const results = [];

for (const app of apps) {
  const appDir = path.join(projectRoot, app);
  if (!fs.existsSync(appDir)) continue;
  const tags = scanner.scanDirectory(appDir, { projectRoot });
  // @cap-todo(ac:F-081/AC-4 iter:2) Migrated to {safe: true} opt-in to preserve CLI on duplicate-ID FEATURE-MAP.
  // @cap-decision(F-081/iter2) Warn on parseError; continue with partial map for read-only display.
  const featureMap = fm.readFeatureMap(projectRoot, app, { safe: true });
  if (featureMap && featureMap.parseError) {
    console.warn('cap: switch-app probe — duplicate feature ID in app "' + app + '": ' + String(featureMap.parseError.message).trim());
  }
  const status = fm.getStatus(featureMap);
  results.push({
    path: app,
    tagCount: tags.length,
    featureCount: status.totalFeatures,
    hasFeatureMap: fs.existsSync(path.join(appDir, 'FEATURE-MAP.md'))
  });
}

console.log(JSON.stringify(results, null, 2));
" '<APPS_JSON>'
```

Store as `app_stats`.

## Step 4: Present app list and ask user to select

Display:

```
=== Monorepo App Selector ===

{If current_session.activeApp:}
Currently active: {current_session.activeApp}
{End if}

Available apps:
{For each app in app_stats:}
  {index}. {app.path} -- {app.tagCount} tags, {app.featureCount} features {app.hasFeatureMap ? "" : "(no FEATURE-MAP.md)"}
{End for}

  0. (root) -- Work at monorepo root level
```

Use AskUserQuestion:
> "Select an app by number or path (e.g., 'apps/flow'), or '0' for root-level work:"

## Step 5: Update SESSION.json

Process user response:
- If `0` or `root` or `none`: set activeApp to null
- If a number: map to the corresponding app path
- If a path string: validate it exists in the app list

```bash
node -e "
const session = require('./cap/bin/lib/cap-session.cjs');
const selected = process.argv[1] === 'null' ? null : process.argv[1];
session.setActiveApp(process.cwd(), selected);
session.updateSession(process.cwd(), {
  lastCommand: '/cap:switch-app',
  lastCommandTimestamp: new Date().toISOString()
});
console.log('Active app set to: ' + (selected || '(root)'));
" '<SELECTED_APP_PATH_OR_NULL>'
```

## Step 6: Show selected app status

If an app was selected (not root):

```bash
node -e "
const fm = require('./cap/bin/lib/cap-feature-map.cjs');
const appPath = process.argv[1];
// @cap-todo(ac:F-081/AC-4 iter:2) Migrated to {safe: true} opt-in to preserve CLI on duplicate-ID FEATURE-MAP.
// @cap-decision(F-081/iter2) Warn on parseError; continue with partial map for read-only display.
const featureMap = fm.readFeatureMap(process.cwd(), appPath, { safe: true });
if (featureMap && featureMap.parseError) {
  console.warn('cap: switch-app status — duplicate feature ID detected: ' + String(featureMap.parseError.message).trim());
}
const status = fm.getStatus(featureMap);
console.log(JSON.stringify({
  features: featureMap.features.map(f => ({ id: f.id, title: f.title, state: f.state })),
  ...status
}));
" '<SELECTED_APP_PATH>'
```

Display:

```
Switched to: {selected_app}

Feature Map status:
  Features: {totalFeatures} ({completedFeatures} shipped)
  ACs: {totalACs} total, {implementedACs} implemented

{If features exist:}
Features in {selected_app}:
{For each feature:}
  {feature.id}: {feature.title} [{feature.state}]
{End for}
{Else:}
No features yet. Run /cap:brainstorm or /cap:init to create FEATURE-MAP.md for this app.
{End if}
```

</process>
