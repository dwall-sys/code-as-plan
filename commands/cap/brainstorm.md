---
name: cap:brainstorm
description: Interactive feature discovery conversation that produces Feature Map entries with acceptance criteria, feature grouping, and dependency analysis. Spawns cap-brainstormer agent.
argument-hint: "[--resume] [--multi]"
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

<!-- @cap-context CAP v2.0 brainstorm command -- orchestrates conversational feature discovery. Spawns cap-brainstormer agent, receives structured Feature Map entries, writes to FEATURE-MAP.md after user approval. -->
<!-- @cap-decision Writes directly to FEATURE-MAP.md (not PRD files). Feature Map is the single source of truth in CAP. PRDs are an intermediate artifact that CAP eliminates. -->
<!-- @cap-decision Command layer owns all file I/O -- agent is stateless. Proven pattern from GSD brainstorm.md. -->
<!-- @cap-constraint No Feature Map entries are written without explicit user approval -- confirmation gate is mandatory -->

<objective>
Spawns the `cap-brainstormer` agent to have a structured conversation about what needs to be built. The agent returns structured Feature Map entries. This command presents the entries for user confirmation, then writes to FEATURE-MAP.md.

<!-- @cap-todo(ref:AC-36) /cap:brainstorm shall invoke the cap-brainstormer agent for conversational feature discovery. -->

**Arguments:**
- `--resume` -- resume a previous brainstorm session using .cap/SESSION.json context
- `--multi` -- hint that the project has multiple independent feature areas

**Key guarantee:** No Feature Map entries are written until the user explicitly approves.
</objective>

<context>
$ARGUMENTS

@FEATURE-MAP.md
@.cap/SESSION.json
</context>

<process>

## Step 0: Parse flags

Check `$ARGUMENTS` for:
- `--resume` -- if present, set `resume_mode = true`
- `--multi` -- if present, set `multi_mode = true`

Log: "cap:brainstorm | resume: {resume_mode} | multi: {multi_mode}"

## Step 1: Load existing Feature Map and session state

Read FEATURE-MAP.md:

```bash
node -e "
const fm = require('./cap/bin/lib/cap-feature-map.cjs');
const featureMap = fm.readFeatureMap(process.cwd());
console.log(JSON.stringify({
  featureCount: featureMap.features.length,
  existingIds: featureMap.features.map(f => f.id),
  existingTitles: featureMap.features.map(f => f.title)
}));
"
```

Store as `existing_features`.

If `resume_mode`:

```bash
node -e "
const session = require('./cap/bin/lib/cap-session.cjs');
const s = session.loadSession(process.cwd());
console.log(JSON.stringify(s));
"
```

Store as `session_context`.

## Step 1b: Check for prior brainstorm threads

Check if the user's topic has been explored before. This gives the brainstormer context about prior discussions.

```bash
node -e "
const tracker = require('./cap/bin/lib/cap-thread-tracker.cjs');
const threads = tracker.listThreads(process.cwd());
console.log(JSON.stringify({ threadCount: threads.length, threads: threads.slice(0, 10) }));
"
```

Store as `prior_threads`.

If `resume_mode` and `session_context.activeThread`:

```bash
node -e "
const tracker = require('./cap/bin/lib/cap-thread-tracker.cjs');
const thread = tracker.loadThread(process.cwd(), '{session_context.activeThread}');
console.log(JSON.stringify(thread));
"
```

Store as `resume_thread`. This is the thread from the previous brainstorm session to continue.

If `prior_threads.threadCount > 0` and NOT `resume_mode`:
- Display prior threads briefly:
  ```
  Found {threadCount} prior brainstorm thread(s):
  {For each thread:}
    - {thread.name} ({thread.timestamp}) — features: {thread.featureIds.join(', ') || 'none'}
  {End for}
  ```
- The brainstormer agent will receive this context and can reference prior threads during conversation.

## Step 1c: Passively check thread affinity before brainstorm

<!-- @cap-todo(ac:F-040/AC-5) /cap:brainstorm passively checks thread affinity at session start and presents relevant prior threads (notify band and above) before beginning discovery questions -->

If prior threads exist, check realtime affinity to surface relevant ones:

```bash
node -e "
const realtimeAffinity = require('./cap/bin/lib/cap-realtime-affinity.cjs');
const clusterDisplay = require('./cap/bin/lib/cap-cluster-display.cjs');
const tracker = require('./cap/bin/lib/cap-thread-tracker.cjs');
const session = require('./cap/bin/lib/cap-session.cjs');

try {
  const threads = tracker.listThreads(process.cwd());
  if (threads.length > 0) {
    const s = session.loadSession(process.cwd());
    // Use the most recent thread as reference point for affinity detection
    const latestThread = threads[0];
    const fullThread = tracker.loadThread(process.cwd(), latestThread.id);
    if (fullThread) {
      const notifications = realtimeAffinity.onSessionStart(process.cwd(), fullThread);
      const output = clusterDisplay.formatRealtimeNotifications(notifications);
      if (output) console.log(output);
      else console.log('');
    } else {
      console.log('');
    }
  } else {
    console.log('');
  }
} catch (e) {
  console.log('');
}
"
```

If output is non-empty, display it before spawning the brainstormer:

```
{thread_affinity_output}
```

This gives the user awareness of related prior discussions before beginning a new brainstorm.

## Step 2: Spawn cap-brainstormer agent

<!-- @cap-todo(ref:AC-37) cap-brainstormer shall produce structured PRD output with numbered acceptance criteria. -->
<!-- @cap-todo(ref:AC-39) cap-brainstormer shall assign feature IDs in sequential format (F-001, F-002, ...). -->

Spawn `cap-brainstormer` via the Task tool with the following context:

```
$ARGUMENTS

**Session context:**
Resume mode: {resume_mode}
Multi-feature hint: {multi_mode}
Existing features: {existing_features.featureCount} features already in FEATURE-MAP.md
Existing IDs: {existing_features.existingIds}
Next available ID: F-{padded next number}

{If resume_mode and resume_thread:}
**Resuming prior thread:**
Thread ID: {resume_thread.id}
Thread name: {resume_thread.name}
Problem statement: {resume_thread.problemStatement}
Solution shape: {resume_thread.solutionShape}
Boundary decisions: {resume_thread.boundaryDecisions}
Prior feature IDs: {resume_thread.featureIds}
{End if}

{If prior_threads.threadCount > 0 and NOT resume_mode:}
**Prior brainstorm threads (for reference):**
{For each thread in prior_threads.threads:}
- {thread.name} ({thread.timestamp}) — keywords: {thread.keywords.slice(0,8).join(', ')} — features: {thread.featureIds.join(', ') || 'none'}
{End for}
NOTE: If the user's topic overlaps with a prior thread, reference it. Ask if they want to continue that line of thinking or explore something new.
{End if}

{If resume_mode and session_context and NOT resume_thread:}
**Previous session context (no thread found):**
Active feature: {session_context.activeFeature}
Last step: {session_context.step}
Last command: {session_context.lastCommand}
{End if}

**Instructions:**
1. Have a conversational exchange with the user to understand what needs to be built
2. Ask targeted questions ONE AT A TIME -- do not present a list of questions
3. After sufficient understanding, cluster features into logical groups
4. Surface dependencies between feature groups
5. For each feature, draft numbered acceptance criteria in imperative form
6. Assign feature IDs starting from {next available ID}
7. Return the feature entries in the exact structured format below

**Return format (delimited):**

=== BRAINSTORM OUTPUT ===
FEATURE_COUNT: N

=== FEATURE: F-NNN ===
TITLE: {verb+object title}
GROUP: {logical group name}
DEPENDS_ON: {comma-separated F-IDs or "none"}
AC-1: {imperative description}
AC-2: {imperative description}
...
=== END FEATURE ===

{Repeat for each feature}

=== DECISIONS ===
- {decision 1}
- {decision 2}
=== END DECISIONS ===

=== END BRAINSTORM OUTPUT ===

Do NOT write any files -- return structured output only.
```

Wait for `cap-brainstormer` to complete.

**Parse the agent output:**

1. Extract between `=== BRAINSTORM OUTPUT ===` and `=== END BRAINSTORM OUTPUT ===`
2. Parse `FEATURE_COUNT:` line
3. For each `=== FEATURE: F-NNN ===` block, extract: TITLE, GROUP, DEPENDS_ON, and all AC-N lines
4. Extract decisions from `=== DECISIONS ===` block
5. Build Feature objects:

```javascript
{
  id: "F-NNN",
  title: "extracted title",
  state: "planned",
  acs: [{ id: "AC-1", description: "...", status: "pending" }, ...],
  files: [],
  dependencies: ["F-NNN", ...],
  metadata: { group: "group name" }
}
```

## Step 3: Present features for user approval

<!-- @cap-todo(ref:AC-38) cap-brainstormer shall write discovered features directly to FEATURE-MAP.md with state planned. -->
<!-- @cap-todo(ref:AC-40) cap-brainstormer output shall be directly consumable by /cap:prototype without manual translation. -->

Display the parsed features:

```
Brainstorm complete. {feature_count} features discovered:

{For each feature:}
  {feature.id}: {feature.title} [{feature.state}]
    Group: {group}
    Dependencies: {deps or "none"}
    Acceptance criteria:
      AC-1: {description}
      AC-2: {description}
      ...
{End for}

Decisions made:
{For each decision:}
  - {decision}
{End for}
```

Use AskUserQuestion:
> "Review the {feature_count} features above. Approve writing to FEATURE-MAP.md? [yes / provide corrections / restart]"

- If `yes`, `y`, or `approve`: proceed to Step 4
- If corrections: Re-spawn `cap-brainstormer` with original context + `**Corrections from user:** {user text}`. Re-parse and re-display. Loop back to approval gate.
- If `restart`: Clear all parsed data. Go back to Step 2 with fresh Task() call.

**IMPORTANT:** No code path reaches Step 4 without explicit user approval.

## Step 4: Write approved features to FEATURE-MAP.md

```bash
node -e "
const fm = require('./cap/bin/lib/cap-feature-map.cjs');
const featureMap = fm.readFeatureMap(process.cwd());
const newFeatures = {JSON.stringify(parsed_features)};
const updated = fm.addFeatures(featureMap, newFeatures);
fm.writeFeatureMap(process.cwd(), updated);
console.log('Written ' + newFeatures.length + ' features to FEATURE-MAP.md');
"
```

## Step 5: Persist brainstorm thread

Save this brainstorm session as a conversation thread. This enables future sessions to reference prior discussions.

Build the thread from the brainstorm results:
- `problemStatement`: The user's initial problem or topic (from the conversation)
- `solutionShape`: The high-level approach that emerged
- `boundaryDecisions`: Key scope decisions from the `=== DECISIONS ===` block
- `featureIds`: The IDs of features written to the Feature Map

```bash
node -e "
const tracker = require('./cap/bin/lib/cap-thread-tracker.cjs');
const resumeThreadId = '{resume_thread?.id || null}';
const parentThread = resumeThreadId !== 'null' ? tracker.loadThread(process.cwd(), resumeThreadId) : null;

const threadParams = {
  problemStatement: '{problem_statement from conversation}',
  solutionShape: '{solution_shape from conversation}',
  boundaryDecisions: {JSON.stringify(decisions_from_brainstorm)},
  featureIds: {JSON.stringify(feature_ids_written)},
};

let thread;
if (parentThread) {
  // Branching from resumed thread
  thread = tracker.branchThread(parentThread, {
    ...threadParams,
    divergencePoint: 'Continued from prior session'
  });
} else {
  thread = tracker.createThread(threadParams);
}

tracker.persistThread(process.cwd(), thread);
console.log(JSON.stringify({ threadId: thread.id, threadName: thread.name }));
"
```

Store as `persisted_thread`.

## Step 5b: Update session state

```bash
node -e "
const session = require('./cap/bin/lib/cap-session.cjs');
session.updateSession(process.cwd(), {
  lastCommand: '/cap:brainstorm',
  lastCommandTimestamp: new Date().toISOString(),
  step: 'brainstorm-complete',
  activeThread: '{persisted_thread.threadId}'
});
"
```

## Step 6: Final report

```
cap:brainstorm complete.

Features written to FEATURE-MAP.md: {feature_count}
  {For each feature: feature.id: feature.title}

Decisions recorded: {decision_count}
Thread saved: {persisted_thread.threadName} ({persisted_thread.threadId})

Next steps:
  - Run /cap:start to select a feature to work on
  - Run /cap:prototype --features {first_feature_id} to build initial code
  - Run /cap:brainstorm --resume to continue this thread later
```

</process>
