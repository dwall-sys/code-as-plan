---
name: cap:continue
description: Load a saved context snapshot into the current session -- restores decisions, conversation context, and file change history without compression losses.
argument-hint: "[name]"
allowed-tools:
  - Bash
  - Read
  - Glob
  - AskUserQuestion
---

<!-- @cap-context CAP context restore system -- loads a snapshot saved by /cap:save and injects it into the current conversation as structured context. -->
<!-- @cap-decision Snapshots are READ into the conversation, not executed -- Claude uses them as context, not as commands. -->

<objective>
Load a previously saved context snapshot (from `/cap:save`) into this fresh session so you can continue working with full context and zero compression losses.

**Arguments:**
- `[name]` -- snapshot name to load. If omitted, lists available snapshots for selection.
</objective>

<context>
$ARGUMENTS
</context>

<process>

## Step 1: List or select snapshot

**If no name argument provided:**

```bash
ls -t .cap/snapshots/*.md 2>/dev/null
```

If multiple snapshots exist, list them with dates and let the user pick:

```bash
for f in .cap/snapshots/*.md; do
  name=$(basename "$f" .md)
  date=$(head -5 "$f" | grep "date:" | sed 's/date: //')
  summary=$(grep "^# Context Snapshot:" "$f" | sed 's/# Context Snapshot: //')
  echo "$name | $date | $summary"
done
```

Ask the user which snapshot to load.

**If name argument provided:**
Check `.cap/snapshots/<name>.md` exists.

## Step 2: Read the snapshot

Read the full snapshot file:

```
@.cap/snapshots/<name>.md
```

## Step 3: Restore context

After reading the snapshot, present a brief summary to the user:

```
=== Context Restored from: <name> ===

**Date:** <date from snapshot>
**Branch:** <branch from snapshot>
**Topic:** <What We Were Working On, 1-2 lines>
**Decisions:** <count> key decisions loaded
**Files touched:** <count> files
**Open items:** <list any open questions/next steps>

Ready to continue. What would you like to do next?
```

**IMPORTANT behavioral rules:**
- After loading the snapshot, treat ALL information in it as established context -- don't re-verify decisions that were already made
- If the snapshot mentions files that were changed, read those files to get their CURRENT state (the snapshot has the history, the files have the present)
- If the snapshot lists open questions or next steps, proactively suggest picking up from there
- Do NOT re-explain or summarize the entire snapshot back to the user -- they lived through it, they just need you to have the context

## Step 4: Optionally chain with /cap:start

If the snapshot references an active feature from the Feature Map, automatically set that as the active feature in SESSION.json (same as /cap:start would do).

</process>
