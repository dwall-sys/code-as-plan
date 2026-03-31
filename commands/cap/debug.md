---
name: cap:debug
description: Systematic debugging with persistent state across context resets. Spawns cap-debugger agent using scientific method.
argument-hint: "[issue description]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Task
  - AskUserQuestion
---

<!-- @gsd-context CAP v2.0 debug command -- orchestrates scientific debugging. Gathers symptoms, spawns cap-debugger agent, handles checkpoints and continuations. Debug state persists in .cap/debug/. -->
<!-- @gsd-decision Debug state in .cap/debug/ (not .planning/debug/) -- CAP centralizes all runtime state under .cap/ -->
<!-- @gsd-pattern Orchestrator gathers symptoms and spawns agent. Fresh context per investigation to avoid context exhaustion. -->

<objective>
<!-- @gsd-todo(ref:AC-63) /cap:debug shall invoke the cap-debugger agent using a scientific method approach. -->

Debug issues using scientific method with subagent isolation.

**Orchestrator role:** Gather symptoms, spawn cap-debugger agent, handle checkpoints, spawn continuations.

**Why subagent:** Investigation burns context fast. Fresh context per investigation. Main context stays lean for user interaction.
</objective>

<context>
User's issue: $ARGUMENTS

Check for active sessions:
```bash
ls .cap/debug/*.md 2>/dev/null | head -5
```
</context>

<process>

## Step 0: Load session and project context

<!-- @gsd-todo(ref:AC-64) cap-debugger shall maintain persistent debug state across the debug session. -->

```bash
node -e "
const session = require('./cap/bin/lib/cap-session.cjs');
const fs = require('node:fs');
const path = require('node:path');
const s = session.loadSession(process.cwd());
const debugDir = path.join(process.cwd(), '.cap', 'debug');
let activeSessions = [];
if (fs.existsSync(debugDir)) {
  activeSessions = fs.readdirSync(debugDir)
    .filter(f => f.startsWith('SESSION-') && f.endsWith('.md'))
    .map(f => {
      const content = fs.readFileSync(path.join(debugDir, f), 'utf8');
      const statusMatch = content.match(/^## Status: (.+)$/m);
      return { file: f, status: statusMatch ? statusMatch[1] : 'unknown' };
    });
}
console.log(JSON.stringify({
  activeFeature: s.activeFeature,
  activeDebugSession: s.activeDebugSession,
  existingSessions: activeSessions
}));
"
```

Store as `debug_context`.

## Step 1: Check for active or resumable debug sessions

If `debug_context.activeDebugSession` is set:

```bash
node -e "
const fs = require('node:fs');
const path = require('node:path');
const sessionFile = path.join(process.cwd(), '.cap', 'debug', 'SESSION-{debug_context.activeDebugSession}.md');
if (fs.existsSync(sessionFile)) {
  console.log(fs.readFileSync(sessionFile, 'utf8'));
} else {
  console.log('NOT_FOUND');
}
"
```

If active session found, display:

```
Active debug session found: SESSION-{id}
Status: {status}
```

Use AskUserQuestion:
> "Resume existing debug session SESSION-{id}, or start a new investigation? [resume / new]"

- If `resume`: load existing session content, proceed to Step 3 with session context
- If `new`: generate new session ID, proceed to Step 2

If no active session: proceed to Step 2.

## Step 2: Gather symptoms

If `$ARGUMENTS` contains an issue description, use it as initial symptoms.

If `$ARGUMENTS` is empty, use AskUserQuestion:
> "Describe the issue you are investigating. Include: what you expected, what actually happened, any error messages, and when this started."

Store as `symptoms`.

Generate a new debug session ID:

```bash
node -e "
const crypto = require('node:crypto');
const id = crypto.randomBytes(4).toString('hex');
console.log(id);
"
```

Store as `session_id`.

Create the debug session file:

Write `.cap/debug/SESSION-{session_id}.md` using the Write tool:

```markdown
# Debug Session: {session_id}

## Status: investigating

## Symptoms
{symptoms}

## Context
- Active feature: {debug_context.activeFeature or 'none'}
- Timestamp: {ISO timestamp}

## Hypotheses
<!-- Cap-debugger will populate this section -->

## Tests Performed
<!-- Cap-debugger will populate this section -->

## Findings
<!-- Cap-debugger will populate this section -->

## Resolution
<!-- Populated when root cause is found and fix is applied -->
```

Update session:

```bash
node -e "
const session = require('./cap/bin/lib/cap-session.cjs');
session.updateSession(process.cwd(), {
  activeDebugSession: '{session_id}',
  lastCommand: '/cap:debug',
  lastCommandTimestamp: new Date().toISOString(),
  step: 'debug-investigating'
});
"
```

## Step 3: Spawn cap-debugger agent

<!-- @gsd-todo(ref:AC-65) cap-debugger shall follow a hypothesis -> test -> verify loop, documenting each step. -->
<!-- @gsd-todo(ref:AC-66) cap-debugger shall not modify production code without explicit developer approval. -->

Identify relevant files from the active feature:

```bash
node -e "
const fm = require('./cap/bin/lib/cap-feature-map.cjs');
const session = require('./cap/bin/lib/cap-session.cjs');
const s = session.loadSession(process.cwd());
const featureMap = fm.readFeatureMap(process.cwd());
const feature = s.activeFeature ? featureMap.features.find(f => f.id === s.activeFeature) : null;
console.log(JSON.stringify({
  files: feature ? feature.files : [],
  title: feature ? feature.title : 'unknown'
}));
"
```

Spawn `cap-debugger` via Task tool:

```
**DEBUG SESSION: {session_id}**

**Symptoms:**
{symptoms}

{If resuming:}
**Previous session state:**
{existing session file content}
{End if}

**Active feature:** {feature.title or 'none'}

<files_to_read>
{For each file in feature.files: - file}
- .cap/debug/SESSION-{session_id}.md
</files_to_read>

**Instructions:**
1. Read all files listed above
2. Analyze symptoms and form ranked hypotheses
3. Test each hypothesis through code reading and execution
4. Document each step in the debug session file
5. DO NOT modify production code -- only observe and test
6. When root cause is found, propose a fix and wait for approval

**Return format:**
=== DEBUG RESULT ===
STATUS: ROOT_CAUSE_FOUND | CHECKPOINT_REACHED | DEBUG_COMPLETE
SESSION_ID: {session_id}
{If ROOT_CAUSE_FOUND:}
ROOT_CAUSE: {description}
PROPOSED_FIX: {description}
FILES_TO_MODIFY: [list]
{End if}
{If CHECKPOINT_REACHED:}
CHECKPOINT_REASON: {what user input is needed}
NEXT_STEPS: {what to investigate next}
{End if}
=== END DEBUG RESULT ===
```

Wait for cap-debugger to complete. Parse the result.

## Step 4: Handle agent result

**If STATUS == ROOT_CAUSE_FOUND:**

Display:
```
Root cause found:
{root_cause}

Proposed fix:
{proposed_fix}

Files to modify:
{files_to_modify}
```

Use AskUserQuestion:
> "Apply the proposed fix? [yes / no / modify: instructions]"

- If `yes`: Spawn cap-debugger again with `**MODE: APPLY_FIX**` and the proposed fix details. The agent applies the fix and runs verification.
- If `no`: Update session file status to `root_cause_found_pending`, end debug session.
- If `modify: <instructions>`: Spawn cap-debugger again with modified fix instructions.

**If STATUS == CHECKPOINT_REACHED:**

Display checkpoint reason and next steps.

Use AskUserQuestion:
> "{checkpoint_reason}. Provide the requested information, or type 'stop' to pause the session."

- If user provides info: Re-spawn cap-debugger with the new information added to context.
- If `stop`: Update session file, end session. User can resume later with `/cap:debug`.

**If STATUS == DEBUG_COMPLETE:**

Log: "Debug session {session_id} complete."

## Step 5: Update session and report

Update debug session file with resolution (via Write tool).

```bash
node -e "
const session = require('./cap/bin/lib/cap-session.cjs');
session.updateSession(process.cwd(), {
  activeDebugSession: null,
  lastCommand: '/cap:debug',
  lastCommandTimestamp: new Date().toISOString(),
  step: 'debug-complete'
});
"
```

```
cap:debug complete.

Session: {session_id}
Status: {final_status}
Debug log: .cap/debug/SESSION-{session_id}.md

{If fix applied:}
Fix applied and verified. Run /cap:test to confirm no regressions.
{End if}
```

</process>
