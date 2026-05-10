---
name: cap:checkpoint
description: Advisory checkpoint detection — nudges /compact at natural breakpoints, saves a labeled snapshot via cap-historian before the context fills up.
argument-hint: ""
allowed-tools:
  - Task
  - Bash
  - Read
  - Write
---

<!-- @cap-feature(feature:F-057) Checkpoint Command for Strategic Compact -->
<!-- @cap-todo(ac:F-057/AC-1) /cap:checkpoint ist aufrufbar — this file registers the slash command. -->
<!-- @cap-todo(ac:F-057/AC-2) Command prueft SESSION.json (step-Transitions, AC-Status-Updates) und FEATURE-MAP-Diff seit letzter Checkpoint-Zeit auf logische Breakpoints. Delegated to cap-checkpoint.analyzeAndApply(). -->
<!-- @cap-todo(ac:F-057/AC-3) Bei erkanntem Breakpoint gibt Command Empfehlung aus: "Jetzt /compact, weil {konkreter Grund}". -->
<!-- @cap-todo(ac:F-057/AC-4) Bei erkanntem Breakpoint wird vor der Empfehlung implizit ein Snapshot mit Label `checkpoint-{feature_id}` angelegt. -->
<!-- @cap-decision Breakpoint-Heuristik bleibt in cap-checkpoint.cjs (analyzeAndApply). Die Save-Aktion wurde von "/cap:save chained" auf "Task() → cap-historian MODE: SAVE" umgestellt — gleiches Outcome (Snapshot in .cap/snapshots/), zusätzlich JSONL-Index-Eintrag. -->
<!-- @cap-todo(ac:F-057/AC-6) /cap:checkpoint bleibt advisory: KEIN Auto-/compact, KEIN --force-Flag. User entscheidet. -->
<!-- @cap-todo(ac:F-057/AC-5) Kein Breakpoint erkannt -> Message "Kein natürlicher Kontextbruch erkannt.", keine weitere Action. -->

<objective>
Detect natural breakpoints in the CAP workflow and nudge the user toward `/compact` before auto-compact degrades context quality. When a breakpoint is detected, the command first writes a `checkpoint-{feature_id}` snapshot via the cap-historian agent.

**Purely advisory.** Never runs `/compact` itself. No `--force` flag. The user decides.
</objective>

<process>

## Step 1: Analyze and persist breakpoint state

`analyzeAndApply` reads SESSION.json and FEATURE-MAP.md, computes the plan, and — if a breakpoint was detected — persists `lastCheckpointAt` + `lastCheckpointSnapshot` in a single Node call (closes the TOCTOU window).

```bash
node -e "
const capCheckpoint = require('./cap/bin/lib/cap-checkpoint.cjs');
const result = capCheckpoint.analyzeAndApply(process.cwd());
console.log(JSON.stringify(result, null, 2));
"
```

Output shape:

```
{
  "breakpoint": { "kind": "...", "featureId": "F-057", "reason": "..." } | null,
  "plan": {
    "shouldSave": true | false,
    "saveLabel": "checkpoint-F-057" | null,
    "message": "Jetzt /compact, weil ..." | "Kein natürlicher Kontextbruch erkannt."
  },
  "currentSnapshot": { "featureStates": {...}, "acStatuses": {...} },
  "persisted": true | false
}
```

## Step 2: Branch on breakpoint

**If `plan.breakpoint` is null:**

Print verbatim and stop:

```
Kein natürlicher Kontextbruch erkannt.
```

(AC-5)

**If `plan.breakpoint` is non-null:** continue. Checkpoint state is already persisted (AC-4).

## Step 3: Save snapshot via cap-historian

Spawn `cap-historian` in SAVE mode with `plan.saveLabel` as the snapshot name:

```
**MODE: SAVE**

{plan.saveLabel}

Save the current session as a checkpoint snapshot. Use the active feature for
linkage (default behavior — no --unassigned, no --platform). Reuse
cap-snapshot-linkage.cjs and cap-session-extract.cjs.

Return `=== HISTORIAN SAVE RESULTS ===` verbatim.
```

Wait for cap-historian to complete.

## Step 4: Print recommendation

Print `plan.message` verbatim:

```
Jetzt /compact, weil {konkreter Grund}.
```

## Step 5: Advisory boundary

Do NOT invoke `/compact`. The only side effects of this command are:

1. The checkpoint snapshot written by cap-historian (Step 3).
2. `lastCheckpointAt` + `lastCheckpointSnapshot` updated in SESSION.json (Step 1).
3. The recommendation printed to the user (Step 4).

If the user wants to compact, they run `/compact` themselves.

</process>
