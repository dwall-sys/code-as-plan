---
name: cap:continue
description: Load a saved context snapshot via the cap-historian agent — restores decisions and file-change history with diff-aware re-reads (only modified files are re-read).
argument-hint: "[name] [--snapshot=<path>]"
allowed-tools:
  - Task
  - Read
  - Bash
  - AskUserQuestion
---

<!-- @cap-context Thin orchestrator. Snapshot loading + mtime-diff lives in agents/cap-historian.md MODE: CONTINUE. -->
<!-- @cap-decision /cap:continue delegates to cap-historian. Token-sparing core (stat-first diff, only re-read drifted files) is owned by the agent, not duplicated here. -->

<objective>
Spawn `cap-historian` in CONTINUE mode to load a previously saved snapshot into this session. The agent computes an mtime-based diff between snapshot capture time and the working tree, and re-reads only the files that drifted.

**Arguments (backwards-compatible):**
- `[name]` — snapshot name to load. If omitted, the agent picks the most-recent snapshot whose `feature:` matches `SESSION.json.activeFeature` (falls back to absolute most-recent).
- `--snapshot=<path>` — explicit path to a snapshot `.md` file (overrides `[name]`).
</objective>

<context>
$ARGUMENTS
</context>

<process>

## Step 1: Optional snapshot listing

If `$ARGUMENTS` is empty AND no active feature is set, list available snapshots so the user can pick:

```bash
ls -t .cap/snapshots/*.md 2>/dev/null | head -10
```

Then ask the user which snapshot to load. Otherwise skip to Step 2.

## Step 2: Spawn cap-historian

Invoke `cap-historian` via Task tool:

```
**MODE: CONTINUE**

$ARGUMENTS

Resolve target snapshot (positional [name], --snapshot=<path>, or most-recent
matching SESSION.json.activeFeature). Parse frontmatter, run mtime-diff against
files_changed, Read ONLY drifted files. Append a `continue` event to
.cap/snapshots/index.jsonl.

Return the structured `=== HISTORIAN CONTINUE RESULTS ===` block AND the
`=== Context Restored from: <name> ===` user-facing summary.
```

Wait for the agent to complete.

## Step 3: Behavioral rules (post-restore)

After the snapshot is restored:

- Treat all snapshot information as **established context** — do not re-verify decisions.
- For files flagged as **modified**, the CURRENT file content is authoritative; the snapshot is history.
- If the snapshot lists open questions or next steps, proactively suggest picking up from there.
- Do NOT re-summarize the snapshot back to the user — they lived through it.

## Step 4: Optional /cap:start chain

If the snapshot's frontmatter carries a `feature: F-NNN` and `SESSION.json.activeFeature` differs, set the active feature to match (same as `/cap:start` would).

</process>
