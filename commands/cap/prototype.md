---
name: cap:prototype
description: Build code for a FEATURE-MAP.md entry, with @cap-feature/@cap-todo annotations inline (Code-First — code IS the plan). TRIGGER when the user asks to implement, build, scaffold, or start coding a feature that has a FEATURE-MAP.md entry in state `planned`, says "build F-XXX / implement this feature / let's start coding X", or after `/cap:brainstorm` when ACs are written and ready to build. Use --architecture for structure-only scaffold, --annotate for retroactive tagging. DO NOT trigger for one-line edits, refactors, or features already in state `prototyped` (use cap:iterate).
argument-hint: "[path] [--features NAME] [--architecture] [--annotate] [--interactive] [--non-interactive] [--no-branch] [--research] [--skip-docs]"
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
- `--no-branch` -- stay on current branch (skip auto feature-branch creation)
- `--research` -- explicitly enable F-024 pitfall research (opt-in as of F-044). Default is research SKIPPED — Opus 4.7 already knows most major libraries, so up-front Context7 fetches are redundant in the common case. Use `--research` when prototyping against an unfamiliar SDK or a known-pitfall service (Supabase RLS, Stripe webhooks, OAuth callbacks, etc.).
- `--skip-docs` -- bypass the F-059 research-first gate entirely (for scaffolding-only features with no external library surface). Default is to run the gate.
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
- `--research` -- if present, set `research_mode = true`. Otherwise `research_mode = false` (opt-in as of F-044).
- `--no-branch` -- if present, set `skip_branch = true`
- `--skip-docs` -- if present, set `skip_docs = true` (bypass the F-059 research-first gate).
- `path` -- target directory (defaults to `.`)

If neither `--architecture` nor `--annotate`: set `mode = "PROTOTYPE"`

Log: "cap:prototype | mode: {mode} | features: {feature_filter or 'all'} | interactive: {interactive_mode}"

## Step 1: Read Feature Map and load active feature

```bash
node -e "
const fm = require('./cap/bin/lib/cap-feature-map.cjs');
const session = require('./cap/bin/lib/cap-session.cjs');
// @cap-todo(ac:F-081/AC-4 iter:2) Migrated to {safe: true} opt-in to preserve CLI on duplicate-ID FEATURE-MAP.
// @cap-decision(F-081/iter2) Warn on parseError; continue with partial map for read-only display.
const featureMap = fm.readFeatureMap(process.cwd(), undefined, { safe: true });
if (featureMap && featureMap.parseError) {
  console.warn('cap: prototype — duplicate feature ID detected, target list uses partial map: ' + String(featureMap.parseError.message).trim());
}
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

## Step 1b: Create feature branch (unless --no-branch or --annotate)

**Skip if `skip_branch` is true, `mode == "ANNOTATE"`, or already on a feature branch.**

When prototyping a new feature on `main`, automatically create a feature branch to keep main clean.

```bash
CURRENT_BRANCH=$(git branch --show-current 2>/dev/null)
```

If `CURRENT_BRANCH` is `main` or `master` AND `mode` is `PROTOTYPE` or `ARCHITECTURE`:

1. Derive branch name from the first target feature:
   - Take feature ID + title slug: `feature/F-031-conversation-thread-tracking`
   - Slugify: lowercase, replace spaces/special chars with hyphens, max 60 chars

```bash
git checkout -b "feature/{feature_id}-{slug}" 2>/dev/null
```

2. Log: `Created branch: feature/{feature_id}-{slug}`

If `CURRENT_BRANCH` is already a `feature/` branch: stay on it, log: `Already on feature branch: {CURRENT_BRANCH}`

If git is not available or not a git repo: skip silently.

## Step 1c: Research-First Gate (F-059)

<!-- @cap-todo(ac:F-059/AC-1) Scope AC descriptions to target_features and parse library mentions against package.json. -->
<!-- @cap-todo(ac:F-059/AC-2) Check .cap/stack-docs/{library}.md mtime vs 30-day threshold. -->
<!-- @cap-todo(ac:F-059/AC-4) --skip-docs bypasses the gate entirely for scaffolding-only features. -->
<!-- @cap-todo(ac:F-059/AC-5) Gate never hard-blocks — default flow is warning + user prompt. -->

**Skip this step** if any of:
- `skip_docs` is true (`--skip-docs` flag)
- `non_interactive` is true (CI flow cannot prompt)
- `mode == "ANNOTATE"` (retrofitting tags, not building against libs)

Otherwise, run the gate against the AC descriptions of `target_features`:

```bash
node -e "
const gate = require('./cap/bin/lib/cap-research-gate.cjs');
const target = JSON.parse(process.env.CAP_TARGET_FEATURES || '[]');
const acs = target.flatMap(f => (f.acs || []).map(a => a.description || ''));
const result = gate.runGate({ projectRoot: process.cwd(), acDescriptions: acs });
const warning = gate.formatWarning(result);
console.log(JSON.stringify({ result, warning }));
"
```

where `CAP_TARGET_FEATURES` is the JSON-encoded `target_features` array from Step 1.

Parse the JSON output. If `warning` is a non-empty string:

1. Print `warning` verbatim to the user.
2. Ask the user: "Proceed anyway? [y/N]"
3. On `y` / `yes`: continue to Step 2.
4. On anything else (including empty input / `N` / Ctrl+C): STOP with message "Aborted by research-first gate. Run `npx ctx7@latest docs <lib> ...` to refresh, or retry with `--skip-docs`." Do not spawn the prototyper.

Regardless of whether the gate fired or was skipped, log the outcome:

```bash
node -e "
const gate = require('./cap/bin/lib/cap-research-gate.cjs');
const r = JSON.parse(process.env.CAP_GATE_RESULT || '{}');
gate.logGateCheck(process.cwd(), {
  skipped: process.env.CAP_GATE_SKIPPED === '1',
  libsChecked: (r.libraries || []).length,
  missing: (r.missing || []).length,
  stale: (r.stale || []).length,
});
"
```

<!-- @cap-todo(ac:F-059/AC-3) Warning includes ctx7 refresh recommendation + y/N prompt — emitted by formatWarning. -->
<!-- @cap-todo(ac:F-059/AC-6) logGateCheck appends a JSONL event with libsChecked + missing counts to .cap/session-log.jsonl. -->

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

## Step 2b: Pitfall Research (only when --research is set)

<!-- @cap-feature(feature:F-024) Pre-Work Pitfall Research -->
<!-- @cap-feature(feature:F-044) Audit and Right-Size Agent Behaviors for Opus 4.7 -->
<!-- @cap-todo(ac:F-024/AC-1) Detect technologies/services from package.json, ACs, code context -->
<!-- @cap-todo(ac:F-024/AC-2) Research known pitfalls via Context7 and web search -->
<!-- @cap-todo(ac:F-044/AC-2) Pitfall research is now opt-in via --research instead of always-on -->
<!-- @cap-decision(F-044/AC-2) Flipped from always-on (--skip-research opt-out) to opt-in (--research). -->
<!--   Opus 4.7 already knows most major libraries; up-front Context7 fetches were redundant in the common case. -->
<!--   The `research_mode` flag from Step 0 gates this entire step. -->

**Skip this step if `research_mode` is false (default) or `mode == "ANNOTATE"`.**

**Only run this block when `research_mode` is true (set by --research flag).**

**Detect technologies involved:**

```bash
node -e "
const fs = require('node:fs');
const path = require('node:path');
const cwd = process.cwd();
const techs = new Set();

// From package.json dependencies
const pkgPath = path.join(cwd, 'package.json');
if (fs.existsSync(pkgPath)) {
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const dep of Object.keys(allDeps)) {
      // Major frameworks and services that have known pitfalls
      const known = ['supabase','firebase','prisma','drizzle','next','nuxt','react','vue','svelte','express','fastify','stripe','auth0','clerk','passport','redis','postgres','mongodb','docker','kubernetes','vercel','netlify','aws-sdk','@aws-sdk','googleapis','twilio','sendgrid','socket.io','trpc','graphql','apollo'];
      if (known.some(k => dep.includes(k))) techs.add(dep);
    }
  } catch(_) {}
}

// From AC descriptions
const targetACs = ${JSON.stringify([])}; // placeholder — filled by command layer
console.log(JSON.stringify([...techs]));
"
```

Also scan the AC descriptions for technology keywords:

Extract technology names from the target features' ACs by matching common service/framework names (Supabase, Firebase, Stripe, OAuth, SSO, Redis, Docker, etc.).

Store combined list as `detected_techs`.

**If detected_techs is not empty:**

<!-- @cap-todo(ac:F-024/AC-3) Present pitfall briefing to user -->
<!-- @cap-todo(ac:F-024/AC-4) Prioritize critical pitfalls at top -->

For each detected technology, run Context7 docs fetch if not cached:

```bash
npx ctx7@latest docs {library_id} "common pitfalls problems gotchas migration issues" 2>/dev/null | head -200
```

Also search for known issues:

```bash
npx ctx7@latest library {tech_name} "known issues pitfalls" 2>/dev/null | head -50
```

**Compile the Pitfall Briefing** from research results. Categorize findings:

```
🔍 Pitfall Research: {comma-separated tech names}

⚠️ CRITICAL (likely to cause hours of debugging):
  {N}. {pitfall description + workaround}

📋 COMMON MISTAKES:
  {N}. {pitfall description + workaround}

💡 GOOD TO KNOW:
  {N}. {tip or best practice}
```

Display the briefing to the user.

<!-- @cap-todo(ac:F-024/AC-6) Persist briefing in .cap/pitfalls/ -->

**Save the briefing:**

Write `.cap/pitfalls/{feature_id}.md` using the Write tool with the pitfall briefing content.

```bash
mkdir -p .cap/pitfalls
```

<!-- @cap-todo(ac:F-024/AC-5) Agent receives briefing as context -->

Store as `pitfall_briefing` — this will be passed to the cap-prototyper agent in Step 3.

**If detected_techs is empty:**

Log: "No known-pitfall technologies detected. Skipping research."

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

{If pitfall_briefing:}
**⚠️ PITFALL BRIEFING — Read before writing code:**
{pitfall_briefing}
You MUST account for these known pitfalls in your implementation.
If an AC conflicts with a pitfall workaround, document the deviation with @cap-decision.
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
// @cap-todo(ac:F-081/AC-4 iter:2) Migrated to {safe: true} opt-in to preserve CLI on duplicate-ID FEATURE-MAP.
// @cap-decision(F-081/iter2) Warn on parseError; continue with partial map for read-only display.
const featureMap = fm.readFeatureMap(process.cwd(), undefined, { safe: true });
if (featureMap && featureMap.parseError) {
  console.warn('cap: prototype AC-table — duplicate feature ID detected, table uses partial map: ' + String(featureMap.parseError.message).trim());
}
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
