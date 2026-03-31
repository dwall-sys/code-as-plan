---
name: cap:iterate
description: Code-first iteration loop -- runs scan, identifies Feature Map gaps, spawns cap-prototyper in ITERATE mode, re-scans, repeats until ACs are satisfied or user stops.
argument-hint: "[--features NAME] [--max N] [--auto]"
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

<!-- @gsd-context CAP v2.0 iterate command -- the flagship code-first loop. Scan -> identify gaps -> generate code -> re-scan -> repeat. Human approval gate between each iteration unless --auto is specified. -->
<!-- @gsd-decision Iteration loop is scan-driven: /cap:scan output determines what to build next. No upfront planning step. -->
<!-- @gsd-decision Human approval gate between iterations by default. --auto flag enables autonomous loop with --max N safety limit. -->
<!-- @gsd-constraint --auto mode requires --max N to prevent runaway loops. Default max is 5 if --auto specified without --max. -->

<objective>
<!-- @gsd-todo(ref:AC-49) /cap:iterate shall invoke cap-prototyper in iterate mode. -->

The core code-first iteration loop:
1. Run /cap:scan to assess current Feature Map status
2. Identify incomplete ACs and unimplemented features
3. Spawn cap-prototyper in ITERATE mode to address gaps
4. Re-scan to verify progress
5. Present results to user, ask to continue or stop

**Arguments:**
- `--features NAME` -- scope iteration to specific Feature Map entries
- `--max N` -- maximum number of iterations (default 5 with --auto)
- `--auto` -- autonomous mode, no approval gate between iterations
</objective>

<context>
$ARGUMENTS

@FEATURE-MAP.md
@.cap/SESSION.json
</context>

<process>

## Step 0: Parse flags

<!-- @gsd-todo(ref:AC-50) /cap:iterate shall support a --auto flag for multi-iteration autonomous loops. -->

Check `$ARGUMENTS` for:
- `--features NAME` -- if present, store as `feature_filter`
- `--max N` -- if present, store as `max_iterations` (default: 5)
- `--auto` -- if present, set `auto_mode = true`

If `auto_mode` is true and `max_iterations` is not set: `max_iterations = 5`

Log: "cap:iterate | mode: {auto or manual} | max: {max_iterations} | features: {feature_filter or 'all'}"

## Step 1: Load active feature from session

<!-- @gsd-todo(ref:AC-51) /cap:iterate shall read the current feature from SESSION.json and refine the associated prototype. -->

```bash
node -e "
const session = require('./get-shit-done/bin/lib/cap-session.cjs');
const fm = require('./get-shit-done/bin/lib/cap-feature-map.cjs');
const s = session.loadSession(process.cwd());
const featureMap = fm.readFeatureMap(process.cwd());
console.log(JSON.stringify({
  activeFeature: s.activeFeature,
  features: featureMap.features.map(f => ({
    id: f.id, title: f.title, state: f.state,
    acs: f.acs, files: f.files, dependencies: f.dependencies
  }))
}));
"
```

**Scope features:**
- If `feature_filter` is set: filter to matching IDs
- Else if active feature is set: use only that feature
- Else: use all features not in `shipped` state

Store as `target_features`.

Initialize: `ITERATION = 0`

## Step 2: Run scan and identify gaps (loop start)

```bash
node -e "
const scanner = require('./get-shit-done/bin/lib/cap-tag-scanner.cjs');
const fm = require('./get-shit-done/bin/lib/cap-feature-map.cjs');
const tags = scanner.scanDirectory(process.cwd());
const featureMap = fm.readFeatureMap(process.cwd());

// Identify ACs that are still pending
const gaps = [];
const targetIds = new Set({JSON.stringify(target_feature_ids)});
for (const f of featureMap.features) {
  if (!targetIds.has(f.id)) continue;
  for (const ac of f.acs) {
    if (ac.status === 'pending') {
      gaps.push({ featureId: f.id, featureTitle: f.title, acId: ac.id, acDesc: ac.description });
    }
  }
}

// Count @cap-todo tags
const todoTags = tags.filter(t => t.type === 'todo');

console.log(JSON.stringify({
  totalTags: tags.length,
  todoCount: todoTags.length,
  gapCount: gaps.length,
  gaps: gaps
}));
"
```

Store as `scan_result`.

**If `scan_result.gapCount == 0`:**
Log: "All acceptance criteria resolved after {ITERATION} iteration(s)."
Proceed to Step 6.

**If `ITERATION == max_iterations`:**
Log: "Iteration cap ({max_iterations}) reached. {scan_result.gapCount} ACs remain unresolved."
Proceed to Step 6.

## Step 3: Spawn cap-prototyper in ITERATE mode

Increment `ITERATION`.

Log: "--- Iteration {ITERATION}/{max_iterations} --- ({scan_result.gapCount} ACs remaining)"

Spawn `cap-prototyper` via Task tool:

```
$ARGUMENTS

**MODE: ITERATE**

**Iteration {ITERATION} of {max_iterations}**

**Gaps to address (unresolved ACs):**
{For each gap:}
  {gap.featureId}/{gap.acId}: {gap.acDesc}
{End for}

**Target features:**
{For each target_feature:}
Feature: {feature.id} - {feature.title} [{feature.state}]
Files: {feature.files.join(', ') or 'none yet'}
{For each AC:}
  {ac.id}: {ac.description} [{ac.status}]
{End for}
{End for}

**Instructions:**
1. Read the existing code files listed under each feature
2. Address the unresolved ACs by implementing or refining code
3. Add @cap-feature(feature:{ID}) tags to new code
4. Add @cap-todo(ac:{FEATURE-ID}/AC-N) tags where ACs are implemented
5. Update existing @cap-todo tags that are now resolved
6. Do NOT break existing passing tests

**ALWAYS use the Write tool to create files** -- never use heredoc commands.
```

Wait for cap-prototyper to complete.

## Step 4: Re-scan after iteration

```bash
node -e "
const scanner = require('./get-shit-done/bin/lib/cap-tag-scanner.cjs');
const fm = require('./get-shit-done/bin/lib/cap-feature-map.cjs');
const tags = scanner.scanDirectory(process.cwd());
fm.enrichFromTags(process.cwd(), tags);
const featureMap = fm.readFeatureMap(process.cwd());
const targetIds = new Set({JSON.stringify(target_feature_ids)});
let remaining = 0;
for (const f of featureMap.features) {
  if (!targetIds.has(f.id)) continue;
  remaining += f.acs.filter(a => a.status === 'pending').length;
}
console.log(JSON.stringify({ totalTags: tags.length, acsRemaining: remaining }));
"
```

Log: "Iteration {ITERATION} complete. ACs remaining: {acsRemaining}"

## Step 5: Approval gate or auto-continue

**If `auto_mode`:** Loop back to Step 2.

**If NOT `auto_mode`:**

Use AskUserQuestion:
> "Iteration {ITERATION} complete. {acsRemaining} ACs remaining. Continue to next iteration? [yes / stop / redirect: instructions]"

- If `yes`: Loop back to Step 2
- If `stop`: Proceed to Step 6
- If `redirect: <instructions>`: Store instructions as additional context for next iteration, loop back to Step 2

## Step 6: Final report

```bash
node -e "
const session = require('./get-shit-done/bin/lib/cap-session.cjs');
session.updateSession(process.cwd(), {
  lastCommand: '/cap:iterate',
  lastCommandTimestamp: new Date().toISOString(),
  step: 'iterate-complete'
});
"
```

```
cap:iterate complete.

Mode: {auto or manual}
Iterations used: {ITERATION} of {max_iterations}
ACs remaining: {acsRemaining}

{If acsRemaining > 0:}
Run /cap:iterate to continue, or /cap:iterate --auto for autonomous mode.
{Else:}
All ACs resolved. Run /cap:test to write tests, or /cap:review to verify.
{End if}
```

</process>
