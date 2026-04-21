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

## Step 1: Analyze and persist in a single call

Run the checkpoint analyzer. `analyzeAndApply` reads SESSION.json and FEATURE-MAP.md, computes the plan, and — if a breakpoint was detected — persists the snapshot inside the same Node process. Collapsing the two legs into one call closes the TOCTOU window where the orchestrator's previous two-step version could observe a FEATURE-MAP mutation between analyze and persist.

```bash
node -e "
const capCheckpoint = require('./cap/bin/lib/cap-checkpoint.cjs');
const result = capCheckpoint.analyzeAndApply(process.cwd());
console.log(JSON.stringify(result, null, 2));
"
```

The output shape:

```
{
  \"breakpoint\": { \"kind\": \"...\", \"featureId\": \"F-057\", \"reason\": \"...\" } | null,
  \"plan\": {
    \"shouldSave\": true | false,
    \"saveLabel\": \"checkpoint-F-057\" | null,
    \"message\": \"Jetzt /compact, weil ...\" | \"Kein natürlicher Kontextbruch erkannt.\"
  },
  \"currentSnapshot\": { \"featureStates\": {...}, \"acStatuses\": {...} },
  \"persisted\": true | false
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

Continue to Step 3. The checkpoint state is already persisted at this point (AC-4) — `analyzeAndApply` wrote `lastCheckpointAt` and `lastCheckpointSnapshot` with an FS post-condition read-back verifying the write landed.

## Step 3: Chain /cap:save with the derived label

Instruct Claude to invoke the `/cap:save` slash command with the `saveLabel` from the plan as its positional argument. Example:

> Run `/cap:save checkpoint-F-057`

Wait for `/cap:save` to complete.

## Step 4: Print the recommendation

Print the recommendation message from `plan.message` verbatim:

```
Jetzt /compact, weil {konkreter Grund}.
```

## Step 5: Advisory boundary

**Do not invoke `/compact` automatically. The user decides.**

This command never runs `/compact` on its own and never takes a `--force` flag. Its only effects are:
1. Writing a snapshot via the `/cap:save` chain.
2. Updating `lastCheckpointAt` + `lastCheckpointSnapshot` in SESSION.json.
3. Printing a recommendation to the user.

If the user wants to compact, they run `/compact` themselves afterward.

</process>
