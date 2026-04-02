---
name: cap:debug
description: Systematic debugging with persistent state across context resets. Spawns cap-debugger agent using scientific method. Deploy-aware workflow minimizes deploy cycles.
argument-hint: "[issue description]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Task
  - AskUserQuestion
---

<!-- @cap-context CAP v2.0 debug command -- orchestrates scientific debugging. Gathers symptoms, spawns cap-debugger agent, handles checkpoints and continuations. Debug state persists in .cap/debug/. -->
<!-- @cap-decision Debug state in .cap/debug/ (not .planning/debug/) -- CAP centralizes all runtime state under .cap/ -->
<!-- @cap-pattern Orchestrator gathers symptoms and spawns agent. Fresh context per investigation to avoid context exhaustion. -->
<!-- @cap-feature(feature:F-022) Deploy-Aware Debug Workflow -->

<objective>
<!-- @cap-todo(ref:AC-63) /cap:debug shall invoke the cap-debugger agent using a scientific method approach. -->

Debug issues using scientific method with subagent isolation and deploy-aware workflow.

**Orchestrator role:** Gather symptoms, spawn cap-debugger agent, manage deploy-verify cycles, handle checkpoints.

**Deploy-aware:** For issues requiring deployment to verify (staging/production bugs, cross-service issues), the workflow enforces:
1. Hypothesis with expected outcome BEFORE code changes
2. Local verification gate BEFORE deploy
3. Deploy logbook tracking every deploy cycle
4. User provides actual results after each deploy
5. Agent reads logbook to avoid repeating failed approaches

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

<!-- @cap-todo(ref:AC-64) cap-debugger shall maintain persistent debug state across the debug session. -->

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

Also check for deploy logbook:

```bash
node -e "
const fs = require('node:fs');
const path = require('node:path');
const logFile = path.join(process.cwd(), '.cap', 'debug', 'DEPLOY-LOG-{debug_context.activeDebugSession}.md');
if (fs.existsSync(logFile)) {
  console.log(fs.readFileSync(logFile, 'utf8'));
} else {
  console.log('NO_DEPLOY_LOG');
}
"
```

If active session found, display:

```
Active debug session found: SESSION-{id}
Status: {status}
{If deploy log exists:} Deploy log: {N} deploys recorded
```

Use AskUserQuestion:
> "Resume existing debug session SESSION-{id}, or start a new investigation? [resume / new]"

- If `resume`: load existing session + deploy log, proceed to Step 3 with session context
- If `new`: generate new session ID, proceed to Step 2

If no active session: proceed to Step 2.

## Step 2: Gather symptoms and classify issue type

If `$ARGUMENTS` contains an issue description, use it as initial symptoms.

If `$ARGUMENTS` is empty, use AskUserQuestion:
> "Describe the issue you are investigating. Include: what you expected, what actually happened, any error messages, and when this started."

Store as `symptoms`.

<!-- @cap-todo(ac:F-022/AC-7) Determine if this is a deploy-dependent issue -->
Use AskUserQuestion:
> "Does this issue require deploying to test (staging/production), or can it be fully reproduced locally?"
> Options: "Deploy required (staging/prod)" / "Local reproduction possible" / "Not sure yet"

Store as `issue_type`. If "Deploy required" or "Not sure": enable deploy-aware workflow.

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

## Issue Type
{issue_type — "deploy-required" or "local"}

## Symptoms
{symptoms}

## Context
- Active feature: {debug_context.activeFeature or 'none'}
- Timestamp: {ISO timestamp}

## Hypotheses
<!-- Cap-debugger will populate this section -->

## Tests Performed
<!-- Cap-debugger will populate this section -->

## Debug Logs Inserted
<!-- @cap-todo(ac:F-022/AC-6) Track debug logs for cleanup -->
<!-- Cap-debugger tracks all console.log/debug statements added to code here -->

## Findings
<!-- Cap-debugger will populate this section -->

## Resolution
<!-- Populated when root cause is found and fix is applied -->
```

<!-- @cap-todo(ac:F-022/AC-3) Create deploy logbook for deploy-dependent issues -->
If deploy-aware workflow is enabled, also write `.cap/debug/DEPLOY-LOG-{session_id}.md`:

```markdown
# Deploy Log: {session_id}

> Every deploy is documented here. The debugger reads this before each cycle
> to avoid repeating failed approaches.

## Disproven Hypotheses
<!-- Hypotheses that were tested via deploy and shown to be wrong -->

## Deploy Cycles

<!-- Each deploy cycle is recorded below -->
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

## Step 2c: Pitfall Research for Debug Context

<!-- @cap-feature(feature:F-024) Pre-Work Pitfall Research -->
<!-- @cap-todo(ac:F-024/AC-8) /cap:debug triggers pitfall research for technologies involved in the bug -->
<!-- @cap-todo(ac:F-024/AC-1) Detect technologies from symptoms, package.json, and code context -->
<!-- @cap-todo(ac:F-024/AC-2) Research known pitfalls via Context7 -->

**Detect technologies from symptoms and project:**

Scan the `symptoms` text for technology keywords (Supabase, Firebase, OAuth, SSO, Redis, Docker, etc.).
Also check `package.json` for relevant dependencies.

```bash
node -e "
const fs = require('node:fs');
const path = require('node:path');
const cwd = process.cwd();
const techs = new Set();
const symptoms = process.argv[1] || '';

// Technology keywords to detect in symptoms
const keywords = ['supabase','firebase','prisma','drizzle','next','nuxt','react','vue','svelte','express','fastify','stripe','auth0','clerk','passport','redis','postgres','mongodb','docker','kubernetes','vercel','netlify','aws','oauth','sso','jwt','cookie','session','cors','webhook','websocket','graphql','trpc'];
const sympLower = symptoms.toLowerCase();
for (const kw of keywords) {
  if (sympLower.includes(kw)) techs.add(kw);
}

// From package.json
const pkgPath = path.join(cwd, 'package.json');
if (fs.existsSync(pkgPath)) {
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const dep of Object.keys(allDeps)) {
      const known = ['supabase','firebase','prisma','drizzle','next','nuxt','stripe','auth0','clerk','passport','redis','socket.io','trpc','graphql','apollo'];
      if (known.some(k => dep.includes(k))) techs.add(dep);
    }
  } catch(_) {}
}
console.log(JSON.stringify([...techs]));
" '{symptoms}'
```

Store as `detected_techs`.

**If detected_techs is not empty:**

<!-- @cap-todo(ac:F-024/AC-3) Present pitfall briefing -->
<!-- @cap-todo(ac:F-024/AC-4) Critical pitfalls at top -->

For each detected technology, fetch known pitfalls via Context7:

```bash
npx ctx7@latest docs {library_id} "common pitfalls problems debugging issues" 2>/dev/null | head -200
```

Also check for cached pitfalls from previous sessions:

```bash
ls .cap/pitfalls/*.md 2>/dev/null | head -5
```

**Compile and display the Pitfall Briefing:**

```
🔍 Pitfall Research for Debug: {tech names}

⚠️ KNOWN ISSUES (check these first — they cause the most debugging time):
  {N}. {pitfall + typical symptom + fix}

📋 COMMON CAUSES for "{symptom keywords}":
  {N}. {cause + how to verify}
```

<!-- @cap-todo(ac:F-024/AC-6) Persist briefing -->

Save briefing to `.cap/pitfalls/debug-{session_id}.md`.

<!-- @cap-todo(ac:F-024/AC-5) Agent receives briefing as context -->

Store as `pitfall_briefing` — passed to the cap-debugger agent in Step 3.

**If detected_techs is empty:**

Log: "No known-pitfall technologies detected in symptoms. Skipping research."

## Step 3: Spawn cap-debugger agent

<!-- @cap-todo(ref:AC-65) cap-debugger shall follow a hypothesis -> test -> verify loop, documenting each step. -->
<!-- @cap-todo(ref:AC-66) cap-debugger shall not modify production code without explicit developer approval. -->

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
**ISSUE TYPE: {issue_type}**

**Symptoms:**
{symptoms}

{If resuming:}
**Previous session state:**
{existing session file content}

**Previous deploy log:**
{existing deploy log content}
{End if}

**Active feature:** {feature.title or 'none'}

<files_to_read>
{For each file in feature.files: - file}
- .cap/debug/SESSION-{session_id}.md
{If deploy-aware:} - .cap/debug/DEPLOY-LOG-{session_id}.md {End if}
</files_to_read>

{If pitfall_briefing:}
**⚠️ PITFALL BRIEFING — Check these known issues FIRST before forming hypotheses:**
{pitfall_briefing}
Start your investigation by checking whether any of these known pitfalls match the symptoms.
If a known pitfall matches, prioritize it as H1 in your hypothesis list.
{End if}

**Instructions:**
1. Read all files listed above
{If pitfall_briefing:}
2. Check known pitfalls from the briefing against the symptoms FIRST
3. Form ranked hypotheses (pitfall matches first, then original hypotheses)
{Else:}
2. Analyze symptoms and form ranked hypotheses
{End if}
3. Test each hypothesis through code reading and execution
4. Document each step in the debug session file
{If deploy-aware:}
5. DEPLOY-AWARE MODE: Follow the deploy-aware protocol:
   a. Define hypothesis with expected outcome BEFORE changing code
   b. Identify local verification steps (unit test, grep, curl, log check)
   c. Only return DEPLOY_READY when local verification passes
   d. Read DEPLOY-LOG to avoid repeating disproven hypotheses
   e. Batch multiple fixes per deploy when possible
   f. Track all debug logs you insert for later cleanup
{End if}
6. DO NOT modify production code -- only observe and test
7. When root cause is found, propose a fix and wait for approval

**Return format:**
=== DEBUG RESULT ===
STATUS: ROOT_CAUSE_FOUND | DEPLOY_READY | CHECKPOINT_REACHED | DEBUG_COMPLETE
SESSION_ID: {session_id}
{If ROOT_CAUSE_FOUND:}
ROOT_CAUSE: {description}
PROPOSED_FIX: {description}
FILES_TO_MODIFY: [list]
{End if}
{If DEPLOY_READY:}
HYPOTHESIS: {what we think is wrong}
EXPECTED_RESULT: {what should happen after deploy if hypothesis is correct}
LOCAL_VERIFICATION: {what was checked locally and passed}
CHANGES_MADE: [list of file:change pairs]
DEBUG_LOGS_ADDED: [list of file:line pairs for temporary debug logging]
DEPLOY_BATCH: {number of fixes batched in this deploy}
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

<!-- @cap-todo(ac:F-022/AC-1) Hypothesis with expected outcome before code changes -->
<!-- @cap-todo(ac:F-022/AC-2) Verify-before-deploy gate -->
<!-- @cap-todo(ac:F-022/AC-4) Batch hypotheses into single deploy -->
**If STATUS == DEPLOY_READY:**

Display:
```
Ready to deploy. {DEPLOY_BATCH} fix(es) batched.

Hypothesis: {hypothesis}
Expected result: {expected_result}
Local verification: {local_verification} ✓

Changes:
{For each change: - file: change}

{If debug logs added:}
Debug logs added (will be cleaned up):
{For each log: - file:line}
{End if}
```

Use AskUserQuestion:
> "Deploy now? Review the changes above, then deploy and report the result. [deploy / abort / modify]"

- If `deploy`: Proceed to Step 4a (Deploy-Verify Cycle)
- If `abort`: Revert changes, update session file
- If `modify`: Re-spawn agent with modifications

## Step 4a: Deploy-Verify Cycle

<!-- @cap-todo(ac:F-022/AC-3) Log every deploy in the deploy logbook -->
<!-- @cap-todo(ac:F-022/AC-7) User provides actual result after deploy -->

Increment deploy counter.

```
Deploy #{deploy_number} in progress.

Waiting for your deploy to complete...
```

Use AskUserQuestion:
> "Deploy #{deploy_number} complete. What happened? [pass: it works / fail: describe what went wrong]"

Store user response as `deploy_result`.

**Update deploy logbook** (`.cap/debug/DEPLOY-LOG-{session_id}.md`):

Append to the logbook using Edit tool:

```markdown
### Deploy #{deploy_number} — {timestamp}

**Hypothesis:** {hypothesis}
**Expected:** {expected_result}
**Actual:** {deploy_result}
**Verdict:** {PASS or FAIL}
**Changes:** {list of changes}
```

<!-- @cap-todo(ac:F-022/AC-5) After failed deploy, read logbook and don't repeat disproven hypotheses -->
**If deploy_result is PASS:**
- Update session status to `resolved`
- Proceed to Step 5 (cleanup)

**If deploy_result is FAIL:**
- Add the hypothesis to the **Disproven Hypotheses** section of deploy logbook
- Display:

```
Deploy #{deploy_number} failed.
Recorded in deploy log. {total_deploys} deploy(s) so far, {disproven_count} hypothesis(es) disproven.

Re-spawning debugger with updated context...
```

- Re-spawn cap-debugger (Step 3) with:
  - The updated deploy log (so it reads what was already tried)
  - The user's failure description
  - Explicit instruction: "The following hypotheses have been DISPROVEN — do NOT re-pursue them: {list}"

Loop back to Step 3.

**If STATUS == CHECKPOINT_REACHED:**

Display checkpoint reason and next steps.

Use AskUserQuestion:
> "{checkpoint_reason}. Provide the requested information, or type 'stop' to pause the session."

- If user provides info: Re-spawn cap-debugger with the new information added to context.
- If `stop`: Update session file, end session. User can resume later with `/cap:debug`.

**If STATUS == DEBUG_COMPLETE:**

Log: "Debug session {session_id} complete."
Proceed to Step 5.

## Step 5: Cleanup and report

<!-- @cap-todo(ac:F-022/AC-6) Clean up debug logs inserted during session -->

If the session had debug logs inserted, spawn cap-debugger with `**MODE: CLEANUP_DEBUG_LOGS**`:

```
Remove all temporary debug logs tracked in the session file under "## Debug Logs Inserted".
Read the session file, find each file:line entry, and remove the debug statement.
Verify the code still works after removal.
```

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
{If deploy-aware:}
Deploy log: .cap/debug/DEPLOY-LOG-{session_id}.md
Total deploys: {deploy_count}
Hypotheses tested: {hypothesis_count}
Hypotheses disproven: {disproven_count}
{End if}

{If fix applied:}
Fix applied and verified. Run /cap:test to confirm no regressions.
{End if}
{If debug logs cleaned:}
Temporary debug logs removed.
{End if}
```

</process>
