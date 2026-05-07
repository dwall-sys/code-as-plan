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
// @cap-todo(ac:F-081/AC-4 iter:2) Migrated to {safe: true} opt-in to preserve CLI on duplicate-ID FEATURE-MAP.
// @cap-decision(F-081/iter2) Warn on parseError; continue with partial map for read-only display.
const featureMap = fm.readFeatureMap(process.cwd(), undefined, { safe: true });
if (featureMap && featureMap.parseError) {
  console.warn('cap: status — duplicate feature ID detected, summary uses partial map: ' + String(featureMap.parseError.message).trim());
}
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

## Step 3a: Load Token Telemetry status

<!-- @cap-feature(feature:F-061) Token Telemetry — surfaces per-session token usage + LLM budget remaining. -->
<!-- @cap-todo(ac:F-061/AC-3) /cap:status shall display current session token consumption and LLM budget remaining capacity. -->

```bash
node -e "
const telemetry = require('./cap/bin/lib/cap-telemetry.cjs');
const session = require('./cap/bin/lib/cap-session.cjs');
try {
  const s = session.loadSession(process.cwd());
  // Session-ID proxy: startedAt (stable for the current session window). Null when no session active.
  const sessionId = s.startedAt || null;
  console.log(telemetry.formatSessionStatusLine(process.cwd(), sessionId));
} catch (e) {
  console.log('Token Telemetry: (not available)');
}
"
```

Store as `token_telemetry_status` and render it verbatim under the dashboard's `Session:` block.

## Step 3aa: Load Claude-native bridge surface (F-080)

<!-- @cap-feature(feature:F-080) /cap:status surfaces Claude-native auto-memory entries relevant to the active feature. Runtime-only; bridge is a read-only consumer of ~/.claude/projects/<slug>/memory/. -->
<!-- @cap-todo(ac:F-080/AC-4) /cap:status displays "Claude-native erinnert: <bullets>" when bridge data is available. -->
<!-- @cap-todo(ac:F-080/AC-3) Silent skip when the Claude-native dir is missing or unreadable. -->

```bash
node -e "
const bridge = require('./cap/bin/lib/cap-memory-bridge.cjs');
const session = require('./cap/bin/lib/cap-session.cjs');
try {
  const s = session.loadSession(process.cwd());
  const active = (s && typeof s.activeFeature === 'string' && s.activeFeature.length > 0) ? s.activeFeature : null;
  const surface = bridge.surfaceForFeature(process.cwd(), active);
  const formatted = bridge.formatSurface(surface);
  if (formatted) console.log(formatted);
} catch (_e) {
  // Silent skip — F-080/AC-3.
}
"
```

Store as `claude_native_bridge_status` and render it (if non-empty) under the dashboard between `Session:` and `Features:` blocks. If empty, omit the section entirely.

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
  {token_telemetry_status}

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
    Design-Usage: {feature.usesDesign.join(', ') or '(none)'}   ← F-063: only rendered when usesDesign is non-empty
```

<!-- @cap-todo(ac:F-063/AC-5) Display the feature's `usesDesign` list inline. Renderer draws from cap-trace.formatDesignUsage
     which optionally labels DT/DC IDs with their token keys / component names via parseDesignIds(DESIGN.md). -->

```bash
node -e "
const fm = require('./cap/bin/lib/cap-feature-map.cjs');
const d = require('./cap/bin/lib/cap-design.cjs');
const trace = require('./cap/bin/lib/cap-trace.cjs');
// @cap-todo(ac:F-081/AC-4 iter:2) Migrated to {safe: true} opt-in to preserve CLI on duplicate-ID FEATURE-MAP.
// @cap-decision(F-081/iter2) Warn on parseError; continue with partial map for read-only display.
const map = fm.readFeatureMap(process.cwd(), undefined, { safe: true });
if (map && map.parseError) {
  console.warn('cap: status design-usage — duplicate feature ID detected, listing uses partial map: ' + String(map.parseError.message).trim());
}
const design = d.readDesignMd(process.cwd());
const designIdx = design ? d.parseDesignIds(design) : { byToken: {}, byComponent: {} };
for (const f of map.features) {
  const line = trace.formatDesignUsage(f, designIdx);
  if (line) console.log('  ' + line);
}
"
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
