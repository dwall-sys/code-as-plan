---
name: cap:report
description: Generate a human-readable project report for developers and non-technical colleagues. Writes to .cap/REPORT.md.
argument-hint: "[--app NAME]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
---

<!-- @cap-feature(feature:F-REPORT) Human-readable project report -- translates Feature Map, tags, git history, and test status into plain language. -->
<!-- @cap-decision Report uses plain language only -- no feature IDs, no tag syntax, no technical markdown. Written for non-technical colleagues. -->
<!-- @cap-decision Report writes to .cap/REPORT.md and also displays in terminal -- persistent artifact for sharing. -->

<objective>
Generate a clean, human-readable project overview report. This is NOT for agents -- it is for developers and their colleagues who do not understand FEATURE-MAP.md syntax.

No feature IDs (F-001), no tag syntax (@cap-todo), no technical jargon. Written so a non-technical colleague can understand the project state at a glance.

**Arguments:**
- `--app NAME` -- generate report for a specific app in a monorepo (overrides activeApp)
</objective>

<context>
$ARGUMENTS

@FEATURE-MAP.md
@.cap/SESSION.json
</context>

<process>

## Step 0: Determine scope

Check `$ARGUMENTS` for `--app NAME`. If provided, use that as the app scope. Otherwise, read activeApp from SESSION.json.

```bash
node -e "
const session = require('./cap/bin/lib/cap-session.cjs');
const s = session.loadSession(process.cwd());
console.log(JSON.stringify({ activeApp: s.activeApp }));
"
```

Store `activeApp` (may be null for single-repo projects).

## Step 1: Read Feature Map

```bash
node -e "
const fm = require('./cap/bin/lib/cap-feature-map.cjs');
const activeApp = process.argv[1] === 'null' ? null : process.argv[1];
// @cap-todo(ac:F-081/AC-4 iter:2) Migrated to {safe: true} opt-in to preserve CLI on duplicate-ID FEATURE-MAP.
// @cap-decision(F-081/iter2) Warn on parseError; continue with partial map for read-only display.
const featureMap = fm.readFeatureMap(process.cwd(), activeApp, { safe: true });
if (featureMap && featureMap.parseError) {
  console.warn('cap: report — duplicate feature ID detected, report uses partial map: ' + String(featureMap.parseError.message).trim());
}
const features = featureMap.features.map(f => ({
  id: f.id,
  title: f.title,
  state: f.state,
  acCount: f.acs.length,
  acsPending: f.acs.filter(a => a.status === 'pending').length,
  acsImplemented: f.acs.filter(a => a.status === 'implemented').length,
  acsTested: f.acs.filter(a => a.status === 'tested').length,
  acsReviewed: f.acs.filter(a => a.status === 'reviewed').length,
  firstAcDesc: f.acs.length > 0 ? f.acs[0].description : '',
  fileCount: f.files.length,
}));
console.log(JSON.stringify({ features, lastScan: featureMap.lastScan }));
" "${activeApp}"
```

Store as `fm_data`.

## Step 2: Get project name

```bash
node -e "
const fs = require('node:fs');
const path = require('node:path');
let name = path.basename(process.cwd());
try {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  if (pkg.name) name = pkg.name;
} catch (_e) {}
console.log(name);
"
```

Store as `project_name`.

## Step 3: Scan tags for risk and decision items

```bash
node -e "
const scanner = require('./cap/bin/lib/cap-tag-scanner.cjs');
const session = require('./cap/bin/lib/cap-session.cjs');
const activeApp = process.argv[1] === 'null' ? null : process.argv[1];
const projectRoot = process.cwd();
let tags;
if (activeApp) {
  const result = scanner.scanApp(projectRoot, activeApp);
  tags = result.tags;
} else {
  tags = scanner.scanDirectory(projectRoot);
}
const risks = tags.filter(t => t.type === 'risk' || (t.type === 'todo' && t.subtype === 'risk'));
const decisions = tags.filter(t => t.type === 'decision' || (t.type === 'todo' && t.subtype === 'decision'));
const todos = tags.filter(t => t.type === 'todo' && !t.subtype);
const totalTags = tags.length;
console.log(JSON.stringify({
  totalTags,
  todoCount: todos.length,
  risks: risks.map(r => r.description.replace(/^risk:\s*/i, '')),
  decisions: decisions.map(d => d.description.replace(/^decision:\s*/i, '')),
}));
" "${activeApp}"
```

Store as `tag_data`.

## Step 4: Get recent git activity (last 7 days)

```bash
git log --since="7 days ago" --pretty=format:"%ad: %s" --date=short 2>/dev/null | head -20
```

Store as `git_activity`.

## Step 5: Check test status

Look for test results. Try common patterns:

```bash
node -e "
const fs = require('node:fs');
const path = require('node:path');
// Check for .cap/TEST-AUDIT.md trust score
let trustScore = null;
try {
  const audit = fs.readFileSync('.cap/TEST-AUDIT.md', 'utf8');
  const scoreMatch = audit.match(/Trust Score[:\s]*(\d+)/i);
  if (scoreMatch) trustScore = parseInt(scoreMatch[1], 10);
} catch (_e) {}
// Check for coverage summary in common locations
let coverage = null;
for (const p of ['coverage/coverage-summary.json', 'coverage/lcov.info']) {
  try {
    if (p.endsWith('.json')) {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (data.total && data.total.lines) coverage = data.total.lines.pct;
    } else {
      const content = fs.readFileSync(p, 'utf8');
      const match = content.match(/LF:(\d+)/g);
      const matchH = content.match(/LH:(\d+)/g);
      if (match && matchH) {
        let totalLines = 0, hitLines = 0;
        match.forEach(m => totalLines += parseInt(m.split(':')[1]));
        matchH.forEach(m => hitLines += parseInt(m.split(':')[1]));
        if (totalLines > 0) coverage = Math.round(hitLines / totalLines * 100);
      }
    }
    if (coverage !== null) break;
  } catch (_e) {}
}
console.log(JSON.stringify({ trustScore, coverage }));
"
```

Store as `test_data`.

## Step 6: Build and write the report

Using all collected data, construct the report following these rules:

**State translation (Feature Map states to plain language):**
- `planned` -> "Not started"
- `prototyped` -> "In progress"
- `tested` -> "Testing complete"
- `shipped` -> "Done"

**Feature descriptions:** Use the feature title only. For in-progress features, derive what remains from pending AC count. For done features, use the first AC description as a one-line summary.

**Formatting rules:**
- NO feature IDs (F-001) anywhere in the report
- NO tag syntax (@cap-todo, @cap-feature)
- NO technical markdown (no tables, no code blocks)
- Clean indented text, readable by anyone
- Write to `.cap/REPORT.md`

Construct the report with this structure:

```
Project Report — {project_name}
Generated: {today's date, e.g. 2026-03-31}
{If activeApp is set: "App: {activeApp}"}

OVERVIEW
  {total} features planned, {shipped count} shipped, {in-progress count} in progress

WHAT'S DONE
  - {feature title} — {first AC description as one-liner, or "Completed"}
  - ...
  {If none: "  Nothing shipped yet."}

WHAT'S IN PROGRESS
  - {feature title} — {translated state}: {N remaining items to complete}
  - ...
  {If none: "  No active work."}

WHAT'S PLANNED (not started)
  - {feature title}
  - ...
  {If none: "  No features in the backlog."}

TEST STATUS
  {If coverage: "Coverage: {N}% lines"}
  {If trustScore: "Trust Score: {N}/100"}
  {If neither: "No test data available. Run /cap:test or /cap:test-audit to generate."}

RECENT ACTIVITY (last 7 days)
  - {date}: {commit summary}
  - ...
  {If none: "  No recent commits."}

OPEN RISKS
  - {risk description in plain language}
  - ...
  {If none: "  No open risks identified."}

OPEN DECISIONS
  - {decision description in plain language}
  - ...
  {If none: "  No pending decisions."}

{If .cap/MANUAL-TESTS.md exists:}
MANUAL TESTING
  Status: {N checked} of {M total} items verified
  Pending:
  - {unchecked item description}
  - ...
  Verified by: {name if present, or "Not yet signed off"}
{End if}
```

Write the complete report text to `.cap/REPORT.md`.

Also display the full report text directly in the terminal so the developer sees it immediately.

**Important:** Ensure the `.cap/` directory exists before writing:
```bash
mkdir -p .cap
```

## Step 7: Confirm completion

After writing, confirm:

```
Report written to .cap/REPORT.md
```

</process>
