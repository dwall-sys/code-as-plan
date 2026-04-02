---
name: cap:prototype
description: Feature Map-driven prototype pipeline -- reads FEATURE-MAP.md, confirms ACs with user, spawns cap-prototyper to build annotated code scaffold. Supports --architecture and --annotate modes.
argument-hint: "[path] [--features NAME] [--architecture] [--annotate] [--interactive] [--non-interactive]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Task
  - Glob
  - Grep
  - AskUserQuestion
---

<!-- @cap-context CAP v2.0 prototype command -- reads Feature Map as primary input (not PRD). Spawns cap-prototyper in one of 4 modes. Auto-runs /cap:scan on completion. -->
<!-- @cap-decision Feature Map replaces PRD as prototype input. Feature Map ACs become @cap-todo(ac:FEATURE/AC-N) tags in generated code. -->
<!-- @cap-decision Auto-chains to /cap:scan on completion -- keeps Feature Map status in sync after code generation. -->
<!-- @cap-pattern --features flag scopes prototype to specific Feature Map entries (replaces --phases scoping from GSD) -->

<objective>
<!-- @cap-todo(ref:AC-41) /cap:prototype shall invoke the cap-prototyper agent which operates in four modes: prototype, iterate, architecture, and annotate. -->

Reads FEATURE-MAP.md, confirms acceptance criteria with the user, then spawns cap-prototyper in the appropriate mode to build annotated code. Each AC becomes a @cap-todo tag in the prototype.

On completion, automatically runs `/cap:scan` to update Feature Map status.

**Arguments:**
- `path` -- target directory for prototype output (defaults to project root)
- `--features NAME` -- scope prototype to specific Feature Map entries (comma-separated)
- `--architecture` -- skeleton-only mode (folders, interfaces, config, module boundaries)
- `--annotate` -- retroactively annotate existing code with @cap-feature tags
- `--interactive` -- pause after each iteration
- `--non-interactive` -- skip AC confirmation gate (for CI)
</objective>

<context>
$ARGUMENTS

@FEATURE-MAP.md
@.cap/SESSION.json
</context>

<process>

## Step 0: Parse flags

Check `$ARGUMENTS` for:
- `--features NAME` -- if present, store as `feature_filter` (comma-separated)
- `--architecture` -- if present, set `mode = "ARCHITECTURE"`
- `--annotate` -- if present, set `mode = "ANNOTATE"`
- `--interactive` -- if present, set `interactive_mode = true`
- `--non-interactive` -- if present, set `non_interactive = true`
- `path` -- target directory (defaults to `.`)

If neither `--architecture` nor `--annotate`: set `mode = "PROTOTYPE"`

Log: "cap:prototype | mode: {mode} | features: {feature_filter or 'all'} | interactive: {interactive_mode}"

## Step 1: Read Feature Map and load active feature

```bash
node -e "
const fm = require('./cap/bin/lib/cap-feature-map.cjs');
const session = require('./cap/bin/lib/cap-session.cjs');
const featureMap = fm.readFeatureMap(process.cwd());
const s = session.loadSession(process.cwd());
console.log(JSON.stringify({
  activeFeature: s.activeFeature,
  features: featureMap.features.map(f => ({
    id: f.id, title: f.title, state: f.state,
    acs: f.acs, files: f.files, dependencies: f.dependencies
  }))
}));
"
```

Store as `fm_data`.

**Scope features:**
- If `feature_filter` is set: filter to matching feature IDs
- Else if `fm_data.activeFeature` is set: use only that feature
- Else: use all features with state `planned` or `prototyped`

Store filtered list as `target_features`.

If `target_features` is empty: STOP and report:
> "No features in scope. Run /cap:brainstorm to discover features, or specify --features."

## Step 2: Present ACs for confirmation

**Skip if `non_interactive` or `mode == "ANNOTATE"`.**

<!-- @cap-todo(ref:AC-42) In prototype mode, the agent shall build a working prototype for a feature, annotating code with @cap-feature and @cap-todo tags as it builds. -->
<!-- @cap-todo(ref:AC-44) In architecture mode, the agent shall analyze and refactor system-level structure without changing feature behavior. -->
<!-- @cap-todo(ref:AC-45) In annotate mode, the agent shall retroactively annotate existing code with @cap-feature and @cap-todo tags. -->

Collect all ACs from target_features:

```
Features to prototype ({target_features.length}):

{For each feature:}
  {feature.id}: {feature.title} [{feature.state}]
  {For each AC:}
    {ac.id}: {ac.description} [{ac.status}]
  {End for}
{End for}

Total ACs: {total_ac_count}
```

Use AskUserQuestion:
> "Review the {total_ac_count} acceptance criteria above. Proceed with {mode} mode? [yes / provide corrections]"

- If `yes`: proceed to Step 3
- If corrections: incorporate and re-display

## Step 3: Derive project context and spawn cap-prototyper

<!-- @cap-todo(ref:AC-47) cap-prototyper shall derive project context (language, framework, conventions) from actual code on first invocation. -->
<!-- @cap-todo(ref:AC-48) cap-prototyper shall follow deviation rules via a shared reference document. -->

Detect project conventions:

```bash
node -e "
const fs = require('node:fs');
const path = require('node:path');
const cwd = process.cwd();
const conventions = {};

// Package.json conventions
if (fs.existsSync(path.join(cwd, 'package.json'))) {
  const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
  conventions.type = pkg.type || 'commonjs';
  conventions.scripts = Object.keys(pkg.scripts || {});
}

// Check for config files
conventions.hasEslint = fs.existsSync(path.join(cwd, '.eslintrc.json')) || fs.existsSync(path.join(cwd, '.eslintrc.js'));
conventions.hasPrettier = fs.existsSync(path.join(cwd, '.prettierrc'));
conventions.hasTsconfig = fs.existsSync(path.join(cwd, 'tsconfig.json'));

// Detect naming patterns from existing files
const entries = fs.readdirSync(path.join(cwd, 'cap/bin/lib')).filter(f => f.endsWith('.cjs'));
conventions.namingPattern = entries.length > 0 ? 'kebab-case.cjs' : 'unknown';

console.log(JSON.stringify(conventions));
"
```

Store as `conventions`.

Load .cap/stack-docs/ if available:

```bash
ls .cap/stack-docs/*.md 2>/dev/null | head -10 || echo "no stack docs"
```

Spawn `cap-prototyper` via Task tool:

**MODE: PROTOTYPE prompt:**
```
$ARGUMENTS

**MODE: {mode}**

**Target features:**
{For each target_feature:}
Feature: {feature.id} - {feature.title} [{feature.state}]
Dependencies: {feature.dependencies.join(', ') or 'none'}
{For each AC:}
  {ac.id}: {ac.description}
{End for}
{End for}

**Project conventions:**
{JSON.stringify(conventions)}

**Tag obligations:**
- Every significant function/class/module gets @cap-feature(feature:{ID}) linking to FEATURE-MAP.md
- Every AC gets @cap-todo(ac:{FEATURE-ID}/AC-N) placed where the implementation happens
- Risk areas get @cap-risk tags
- Design decisions get @cap-decision tags

**Deviation rules:**
If you need to deviate from the Feature Map specification (e.g., an AC is impractical, dependencies changed), document the deviation with:
// @cap-decision Deviated from {FEATURE-ID}/AC-N: {reason}
Do not silently skip ACs. Every AC must have either an implementation tag or a deviation tag.

{If mode == "ARCHITECTURE":}
Generate ONLY structural artifacts:
1. Folder structure with index/barrel files at module boundaries
2. Config files matching existing project conventions
3. Typed interfaces and type definitions for module boundaries
4. Entry point stubs
5. @cap-decision tags at every module boundary
ZERO feature implementation code.
{End if}

{If mode == "ANNOTATE":}
Do NOT create new files. Only EDIT existing files to add @cap-feature and @cap-todo tags.
Scan the target directory for source files, read each, and add appropriate tags.
{End if}

{If stack docs available:}
**Stack documentation available in .cap/stack-docs/:**
{list of available docs}
Read these before generating code that uses those libraries.
{End if}
```

Wait for cap-prototyper to complete.

## Step 4: Update Feature Map state

<!-- @cap-todo(ref:AC-46) cap-prototyper shall update the feature state in FEATURE-MAP.md from planned to prototyped upon completing a prototype. -->

If `mode == "PROTOTYPE"`:

```bash
node -e "
const fm = require('./cap/bin/lib/cap-feature-map.cjs');
const targetIds = {JSON.stringify(target_feature_ids)};
for (const id of targetIds) {
  const result = fm.updateFeatureState(process.cwd(), id, 'prototyped');
  console.log(id + ': ' + (result ? 'updated to prototyped' : 'state unchanged'));
}
"
```

## Step 5: Auto-run /cap:scan

<!-- @cap-todo(ref:AC-43) In iterate mode, the agent shall refine an existing prototype based on feedback, updating tags and Feature Map state. -->

```bash
node -e "
const scanner = require('./cap/bin/lib/cap-tag-scanner.cjs');
const fm = require('./cap/bin/lib/cap-feature-map.cjs');
const tags = scanner.scanDirectory(process.cwd());
const updated = fm.enrichFromTags(process.cwd(), tags);
const groups = scanner.groupByFeature(tags);
console.log(JSON.stringify({
  totalTags: tags.length,
  featuresEnriched: updated.features.filter(f => f.files.length > 0).length,
  featureGroups: Object.keys(groups).length
}));
"
```

## Step 6: Update session and report

```bash
node -e "
const session = require('./cap/bin/lib/cap-session.cjs');
session.updateSession(process.cwd(), {
  lastCommand: '/cap:prototype',
  lastCommandTimestamp: new Date().toISOString(),
  step: 'prototype-complete'
});
"
```

```
cap:prototype complete ({mode} mode).

Features processed: {target_features.length}
```

<!-- @cap-feature(feature:F-023) Emoji-Enhanced AC Status -->
<!-- @cap-todo(ac:F-023/AC-1) Display AC table with emoji status after prototype -->
<!-- @cap-todo(ac:F-023/AC-6) Emojis in terminal output only, not in stored files -->

**Display the AC status table with emojis (terminal output only):**

Load the current Feature Map and display each AC for the target features:

```bash
node -e "
const fm = require('./cap/bin/lib/cap-feature-map.cjs');
const featureMap = fm.readFeatureMap(process.cwd());
const targetIds = {JSON.stringify(target_feature_ids)};
for (const id of targetIds) {
  const f = featureMap.features.find(feat => feat.id === id);
  if (!f) continue;
  console.log('\n  ' + f.id + ': ' + f.title + ' [' + f.state + ']');
  for (const ac of f.acs) {
    const emoji = ac.status === 'tested' ? '✅' : ac.status === 'prototyped' ? '🔨' : ac.status === 'partial' ? '⚠️' : '📋';
    console.log('    ' + emoji + ' ' + ac.id + ': ' + ac.description);
  }
}
"
```

```
Tag scan results:
  Total @cap-* tags: {scan_result.totalTags}
  Features with file refs: {scan_result.featuresEnriched}

Next steps:
  - Run /cap:iterate to refine the prototype
  - Run /cap:test to write tests against the ACs
  - Run /cap:scan for detailed tag report
```

</process>
