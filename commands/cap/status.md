---
name: cap:status
description: Show project status derived from Feature Map -- feature completion, test coverage, open risks, and next actions.
argument-hint: "[--features NAME] [--verbose] [--drift] [--completeness]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
---

<!-- @cap-context CAP v2.0 status command -- reads FEATURE-MAP.md and .cap/SESSION.json to present a compact project status dashboard. No agent spawning, no file writes. -->
<!-- @cap-decision Status is read-only -- it presents information but never modifies Feature Map or session state. Safe to run at any time. -->
<!-- @cap-decision Status derives from Feature Map, session state, AND live tag scan -- gives a complete picture without requiring a separate /cap:scan first. -->
<!-- @cap-feature(feature:F-042) /cap:status --drift surfaces feature/AC status mismatches via detectDrift. -->

<objective>
Presents a compact project status dashboard derived from FEATURE-MAP.md, SESSION.json, and a live tag count:
- Current session state (active feature, step, duration)
- Feature completion by state (planned, prototyped, tested, shipped)
- Tag coverage statistics (files with tags vs total source files)

**Arguments:**
- `--features NAME` -- show status for specific features only
- `--verbose` -- include per-AC breakdown
- `--drift` -- show only the status drift report (features whose state is shipped/tested but with pending ACs)
- `--completeness` -- (F-048 opt-in) show the 4-point Completeness Score per AC for every feature. Requires `.cap/config.json → completenessScore.enabled=true`.
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
- `--verbose` -- if present, set `verbose = true`
- `--drift` -- if present, jump straight to the drift fast-path below and skip the regular dashboard

## Step 0a: Completeness fast-path (when --completeness is present, F-048)

<!-- @cap-todo(ac:F-048/AC-2) /cap:status --completeness shall show per-feature N/4 scores. -->

```bash
node -e "
const comp = require('./cap/bin/lib/cap-completeness.cjs');
const cfg = comp.loadCompletenessConfig(process.cwd());
if (!cfg.enabled) {
  console.error('F-048 (completeness score) is opt-in and not enabled for this project.');
  console.error('To enable: add { \"completenessScore\": { \"enabled\": true } } to .cap/config.json');
  process.exit(2);
}
const ctx = comp.buildContext(process.cwd());
const scores = comp.scoreAllFeatures(ctx);
console.log(comp.formatFeatureBreakdown(scores));
"
```

Display the rendered output verbatim, then **stop processing**. Do not run Steps 1-5.

## Step 0b: Drift fast-path (when --drift is present)

<!-- @cap-todo(ac:F-042/AC-6) /cap:status --drift surfaces mismatched feature/AC states for the entire Feature Map. Exit code 0 if no drift, 1 if drift exists (CI-friendly). -->

```bash
node -e "
const fm = require('./cap/bin/lib/cap-feature-map.cjs');
const report = fm.detectDrift(process.cwd());
console.log(fm.formatDriftReport(report));
process.exit(report.hasDrift ? 1 : 0);
"
```

Display the rendered output verbatim, then **stop processing**. Do not run Steps 1-5.

The exit code is meaningful for CI: `0` when the Feature Map is consistent, `1` when drift exists.

## Step 1: Read session state

<!-- @cap-todo(ref:AC-31) /cap:status shall display the current session state from SESSION.json (active feature, current step, session duration). -->

```bash
node -e "
const session = require('./cap/bin/lib/cap-session.cjs');
const s = session.loadSession(process.cwd());
const duration = s.startedAt ? Math.round((Date.now() - new Date(s.startedAt).getTime()) / 60000) : null;
console.log(JSON.stringify({
  activeFeature: s.activeFeature,
  step: s.step,
  startedAt: s.startedAt,
  durationMinutes: duration,
  lastCommand: s.lastCommand,
  lastCommandTimestamp: s.lastCommandTimestamp,
  activeDebugSession: s.activeDebugSession
}));
"
```

Store as `session_state`.

## Step 2: Read Feature Map status

<!-- @cap-todo(ref:AC-32) /cap:status shall display a summary of FEATURE-MAP.md (count of features per state: planned, prototyped, tested, shipped). -->

```bash
node -e "
const fm = require('./cap/bin/lib/cap-feature-map.cjs');
const featureMap = fm.readFeatureMap(process.cwd());
const status = fm.getStatus(featureMap);
const byState = { planned: 0, prototyped: 0, tested: 0, shipped: 0 };
for (const f of featureMap.features) {
  byState[f.state] = (byState[f.state] || 0) + 1;
}
console.log(JSON.stringify({
  ...status,
  byState,
  features: featureMap.features.map(f => ({
    id: f.id,
    title: f.title,
    state: f.state,
    acCount: f.acs.length,
    acsImplemented: f.acs.filter(a => a.status === 'implemented').length,
    acsTested: f.acs.filter(a => a.status === 'tested').length,
    acsReviewed: f.acs.filter(a => a.status === 'reviewed').length,
    fileCount: f.files.length,
    dependencies: f.dependencies
  })),
  lastScan: featureMap.lastScan
}));
"
```

Store as `fm_status`. If `feature_filter` is set, filter `fm_status.features` to matching IDs.

## Step 3: Compute tag coverage

<!-- @cap-todo(ref:AC-33) /cap:status shall display tag coverage statistics (files with tags vs. total source files). -->

```bash
node -e "
const scanner = require('./cap/bin/lib/cap-tag-scanner.cjs');
const fs = require('node:fs');
const path = require('node:path');
const tags = scanner.scanDirectory(process.cwd());
const filesWithTags = new Set(tags.map(t => t.file));
let totalFiles = 0;
function walk(dir, exclude) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory() && !exclude.includes(e.name)) walk(path.join(dir, e.name), exclude);
    else if (e.isFile() && scanner.SUPPORTED_EXTENSIONS.includes(path.extname(e.name))) totalFiles++;
  }
}
walk(process.cwd(), scanner.DEFAULT_EXCLUDE);
const byType = {};
for (const t of tags) { byType[t.type] = (byType[t.type] || 0) + 1; }
console.log(JSON.stringify({ filesWithTags: filesWithTags.size, totalFiles, totalTags: tags.length, byType }));
"
```

Store as `tag_stats`.

## Step 3b: Load Neural Memory status

<!-- @cap-todo(ac:F-040/AC-3) Extend /cap:status with Neural Memory section: active cluster count, dormant nodes, highest-affinity pair, last clustering timestamp -->

```bash
node -e "
const clusterDisplay = require('./cap/bin/lib/cap-cluster-display.cjs');
try {
  const output = clusterDisplay.loadAndFormatStatus(process.cwd());
  console.log(output);
} catch (e) {
  console.log('Neural Memory: (not available)');
}
"
```

Store as `neural_memory_status`.

## Step 4: Present formatted dashboard

Display:

```
=== CAP Status ===

Session:
  Active feature: {session_state.activeFeature or "none"}
  Current step:   {session_state.step or "none"}
  Session duration: {session_state.durationMinutes} minutes {or "no active session"}
  Last command:   {session_state.lastCommand} ({session_state.lastCommandTimestamp})

Features ({fm_status.totalFeatures} total):
  planned:    {byState.planned}
  prototyped: {byState.prototyped}
  tested:     {byState.tested}
  shipped:    {byState.shipped}

Acceptance Criteria:
  Total:       {fm_status.totalACs}
  Implemented: {fm_status.implementedACs}
  Tested:      {fm_status.testedACs}
  Reviewed:    {fm_status.reviewedACs}

Tag Coverage:
  Source files with @cap-* tags: {tag_stats.filesWithTags} of {tag_stats.totalFiles} ({percentage}%)
  Total tags: {tag_stats.totalTags}
    @cap-feature:  {byType.feature or 0}
    @cap-todo:     {byType.todo or 0}
    @cap-risk:     {byType.risk or 0}
    @cap-decision: {byType.decision or 0}

Last scan: {fm_status.lastScan or "never"}

{neural_memory_status}
```

**If `verbose` is true:**

For each feature in scope, display:

```
  {feature.id}: {feature.title} [{feature.state}]
    ACs: {feature.acCount} total, {feature.acsImplemented} implemented, {feature.acsTested} tested
    Files: {feature.fileCount}
    Dependencies: {feature.dependencies.join(', ') or 'none'}
```

## Step 5: Suggest next action

Based on current state, suggest the most useful next command:

- If no features exist: "Run /cap:brainstorm to discover features."
- If all features are `planned`: "Run /cap:prototype to build initial scaffolds."
- If active feature is `prototyped`: "Run /cap:test to write tests for {activeFeature}."
- If active feature is `tested`: "Run /cap:review to verify {activeFeature}."
- If tag coverage < 50%: "Run /cap:scan or /cap:annotate to improve tag coverage."
- Otherwise: "Run /cap:iterate to continue development."

```
Suggested next: {action}
```

</process>
