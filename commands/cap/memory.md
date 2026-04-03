---
name: cap:memory
description: "Manage project memory — run accumulation pipeline, pin/unpin annotations, view status."
argument-hint: "[pin|unpin|status] [--dry-run]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
---

<!-- @cap-feature(feature:F-030) Memory command — manual trigger for memory pipeline + pin/unpin/status management -->
<!-- @cap-decision /cap:memory with no args runs the full pipeline (same as the post-session hook but manual). -->

<objective>
Manually trigger the project memory pipeline, or manage annotations (pin/unpin/status).

**Subcommands:**
- `(no args)` — run full memory accumulation pipeline (F-027→F-028→F-029)
- `status` — show memory summary (annotation counts, stale, pinned, last run)
- `pin <file> <content-prefix>` — mark a @cap-pitfall as pinned:true
- `unpin <file> <content-prefix>` — remove pinned:true from annotation
- `--dry-run` — show what would change without writing
</objective>

<process>

## Default: Run full pipeline

1. Find project sessions via `cap-session-extract.getProjectDir()`
2. Get session files, limit to last 10 for performance
3. Run `cap-memory-engine.accumulateFromFiles()` → get memory entries
4. Run `cap-annotation-writer.writeAnnotations()` → write to source files
5. Run `cap-annotation-writer.removeStaleAnnotations()` → clean up stale
6. Run `cap-memory-dir.writeMemoryDirectory()` → generate .cap/memory/
7. Report results

## Subcommand: status

```bash
node -e "
const fs = require('node:fs');
const path = require('node:path');
const memDir = path.join(process.cwd(), '.cap', 'memory');
const categories = ['decisions.md', 'hotspots.md', 'patterns.md', 'pitfalls.md'];
const stats = {};
for (const f of categories) {
  const fp = path.join(memDir, f);
  if (fs.existsSync(fp)) {
    const content = fs.readFileSync(fp, 'utf8');
    const entries = (content.match(/^###/gm) || []).length + (content.match(/^\|.*\|$/gm) || []).length;
    const pinned = (content.match(/\[pinned\]/g) || []).length;
    stats[f] = { entries, pinned };
  } else {
    stats[f] = { entries: 0, pinned: 0 };
  }
}
console.log(JSON.stringify(stats, null, 2));
"
```

Display as summary table.

## Subcommand: pin / unpin

Read the target file, find the annotation matching the content prefix, add or remove `pinned:true` from its metadata.

</process>
