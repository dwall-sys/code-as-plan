---
name: cap:memory
description: "Manage project memory — bootstrap, run pipeline, pin/unpin annotations, view status."
argument-hint: "[init|status|pin|unpin] [--dry-run]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
---

<!-- @cap-feature(feature:F-030) Memory command — bootstrap, manual trigger, pin/unpin/status management -->
<!-- @cap-decision /cap:memory init processes ALL sessions for the current project — one-time bootstrap to build initial memory. -->
<!-- @cap-decision /cap:memory with no args runs incremental only (sessions since last run). -->

<objective>
Manage project memory — bootstrap from existing sessions, run incremental pipeline, or manage annotations.

**Subcommands:**
- `init` — **Bootstrap**: process ALL sessions for this project, build initial memory (run once per project)
- `(no args)` — run incremental pipeline (only sessions since last run)
- `status` — show memory summary (annotation counts, stale, pinned, last run)
- `pin <file> <content-prefix>` — mark a @cap-pitfall as pinned:true
- `unpin <file> <content-prefix>` — remove pinned:true from annotation
- `--dry-run` — show what would change without writing
</objective>

<process>

## Subcommand: init (Bootstrap)

One-time full processing of all sessions for this project. Run this when setting up memory for an existing project.

```bash
node "$HOME/.claude/hooks/cap-memory.js" init
```

This will:
1. Find all session JSONL files for the current project directory
2. Parse every session — extract decisions, pitfalls, patterns, file edit history
3. Write @cap-history, @cap-pitfall, @cap-pattern annotations into source files
4. Generate .cap/memory/ directory (decisions.md, hotspots.md, patterns.md, pitfalls.md)
5. Save timestamp to .cap/memory/.last-run (future hook runs are incremental from here)

Display the output to the user. Then show:

```
Bootstrap complete.

Memory directory: .cap/memory/
  - decisions.md
  - hotspots.md
  - patterns.md
  - pitfalls.md

From now on, the Stop hook will run incrementally after each session.
Run /cap:memory status to see what was accumulated.
```

## Default (no args): Run incremental pipeline

```bash
node "$HOME/.claude/hooks/cap-memory.js"
```

Only processes sessions newer than .cap/memory/.last-run timestamp.
If .last-run doesn't exist, processes all sessions (same as init).

## Subcommand: status

```bash
node -e "
const fs = require('node:fs');
const path = require('node:path');
const memDir = path.join(process.cwd(), '.cap', 'memory');
const lastRunPath = path.join(memDir, '.last-run');
const lastRun = fs.existsSync(lastRunPath) ? fs.readFileSync(lastRunPath, 'utf8').trim() : 'never';
const categories = ['decisions.md', 'hotspots.md', 'patterns.md', 'pitfalls.md'];
const stats = { lastRun };
for (const f of categories) {
  const fp = path.join(memDir, f);
  if (fs.existsSync(fp)) {
    const content = fs.readFileSync(fp, 'utf8');
    const entries = (content.match(/^###/gm) || []).length;
    const pinned = (content.match(/\[pinned\]/g) || []).length;
    const tableRows = (content.match(/^\| \d/gm) || []).length;
    stats[f] = { entries: entries + tableRows, pinned };
  } else {
    stats[f] = { entries: 0, pinned: 0 };
  }
}
console.log(JSON.stringify(stats, null, 2));
"
```

Display as summary table:
```
Project Memory Status
  Last run: {timestamp or "never — run /cap:memory init to bootstrap"}
  decisions.md:  {N} entries ({P} pinned)
  hotspots.md:   {N} entries
  patterns.md:   {N} entries
  pitfalls.md:   {N} entries ({P} pinned)
```

## Subcommand: pin / unpin

Read the target file, find the annotation matching the content prefix, add or remove `pinned:true` from its metadata.

</process>
