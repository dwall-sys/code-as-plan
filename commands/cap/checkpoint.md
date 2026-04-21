---
name: cap:checkpoint
description: Advisory checkpoint detection — nudges /compact at natural breakpoints, saves a labeled snapshot before the context fills up.
argument-hint: ""
allowed-tools:
  - Bash
  - Read
  - Write
---

<!-- @cap-feature(feature:F-057) Checkpoint Command for Strategic Compact -->
<!-- @cap-todo(ac:F-057/AC-1) /cap:checkpoint ist aufrufbar — this file registers the slash command. -->
<!-- @cap-todo(ac:F-057/AC-2) Command prueft SESSION.json (step-Transitions, AC-Status-Updates) und FEATURE-MAP-Diff seit letzter Checkpoint-Zeit auf logische Breakpoints. Delegated to cap-checkpoint.analyze(). -->
<!-- @cap-todo(ac:F-057/AC-3) Bei erkanntem Breakpoint gibt Command Empfehlung aus: "Jetzt /compact, weil {konkreter Grund}". -->
<!-- @cap-todo(ac:F-057/AC-4) Command ruft /cap:save checkpoint-{feature_id} implizit auf, bevor die Empfehlung ausgegeben wird. -->
<!-- @cap-decision Deviated from F-057/AC-4: /cap:save takes a positional [name] arg, not --label; using "checkpoint-{feature_id}" as the name. -->
<!-- @cap-decision /cap:save is chained at the orchestrator level (Claude runs /cap:save as the next command), not spawned as a subprocess from inside this command. This keeps the advisory boundary clean and preserves the "pure logic in .cjs, orchestration in .md" separation. -->
<!-- @cap-todo(ac:F-057/AC-5) Kein Breakpoint erkannt -> Message "Kein natürlicher Kontextbruch erkannt.", keine weitere Action. -->
<!-- @cap-todo(ac:F-057/AC-6) Command ist rein advisory — KEIN Auto-/compact, KEIN --force-Flag. Der User entscheidet. -->

<objective>
Detect natural breakpoints in the CAP workflow and nudge the user toward `/compact` before auto-compact degrades context quality. When a breakpoint is detected, the command also chains a `/cap:save checkpoint-{feature_id}` so the session state is snapshotted before the user-initiated compact.

**This command is purely advisory.** It never runs `/compact` itself. It never takes a `--force` flag. The user decides whether to compact.
</objective>

<process>

## Step 1: Analyze the current session + feature map

Run the checkpoint analyzer. It reads SESSION.json and FEATURE-MAP.md and returns a plan object (pure logic, no disk mutation):

```bash
node -e "
const path = require('node:path');
const capSession = require('./cap/bin/lib/cap-session.cjs');
const capFeatureMap = require('./cap/bin/lib/cap-feature-map.cjs');
const capCheckpoint = require('./cap/bin/lib/cap-checkpoint.cjs');

const root = process.cwd();
const session = capSession.loadSession(root);
const featureMap = capFeatureMap.readFeatureMap(root);
const result = capCheckpoint.analyze(session, featureMap);
console.log(JSON.stringify(result, null, 2));
"
```

The output is a JSON object of shape:

```
{
  \"breakpoint\": { \"kind\": \"...\", \"featureId\": \"F-057\", \"reason\": \"...\" } | null,
  \"plan\": {
    \"shouldSave\": true | false,
    \"saveLabel\": \"checkpoint-F-057\" | null,
    \"message\": \"Jetzt /compact, weil ...\" | \"Kein natürlicher Kontextbruch erkannt.\"
  },
  \"currentSnapshot\": { \"featureStates\": {...}, \"acStatuses\": {...} }
}
```

## Step 2: Branch on breakpoint

**If `plan.breakpoint` is null (no breakpoint):**

Print to the user:

```
Kein natürlicher Kontextbruch erkannt.
```

Then stop. Do NOT proceed to save or recommend. (AC-5)

**If `plan.breakpoint` is non-null (breakpoint detected):**

Continue to Step 3.

## Step 3: Chain /cap:save with the derived label

Instruct Claude to invoke the `/cap:save` slash command with the `saveLabel` from the plan as its positional argument. Example:

> Run `/cap:save checkpoint-F-057`

Wait for `/cap:save` to complete. (AC-4)

## Step 4: Persist the checkpoint snapshot

After `/cap:save` completes, run the side-effect function that writes `lastCheckpointAt` and `lastCheckpointSnapshot` to SESSION.json:

```bash
node -e "
const capSession = require('./cap/bin/lib/cap-session.cjs');
const capFeatureMap = require('./cap/bin/lib/cap-feature-map.cjs');
const capCheckpoint = require('./cap/bin/lib/cap-checkpoint.cjs');

const root = process.cwd();
const session = capSession.loadSession(root);
const featureMap = capFeatureMap.readFeatureMap(root);
const result = capCheckpoint.analyze(session, featureMap);
if (result.breakpoint) {
  capCheckpoint.applyCheckpoint(root, result.currentSnapshot);
  console.log('Checkpoint-State persistiert.');
}
"
```

## Step 5: Print the recommendation

Print the recommendation message from `plan.message` verbatim:

```
Jetzt /compact, weil {konkreter Grund}.
```

## Step 6: Advisory boundary

**Do not invoke `/compact` automatically. The user decides.**

This command never runs `/compact` on its own and never takes a `--force` flag. Its only effects are:
1. Writing a snapshot via the `/cap:save` chain.
2. Updating `lastCheckpointAt` + `lastCheckpointSnapshot` in SESSION.json.
3. Printing a recommendation to the user.

If the user wants to compact, they run `/compact` themselves afterward.

</process>
