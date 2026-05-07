---
name: cap:save
description: Save current session context to a snapshot file for cross-session continuity without compression losses.
argument-hint: "[name] [--unassigned] [--platform=<topic>]"
allowed-tools:
  - Bash
  - Read
  - Write
  - Glob
  - Grep
---

<!-- @cap-context CAP context checkpoint system -- extracts key context from the current session JSONL and saves it as a readable markdown snapshot in .cap/snapshots/. -->
<!-- @cap-decision Snapshots are markdown, not raw JSONL -- they should be human-readable AND machine-parseable so /cap:continue can inject them efficiently. -->
<!-- @cap-feature(feature:F-079) Snapshot-Linkage to Features and Platform — frontmatter `feature:` / `platform:` fields wire snapshots to F-076 per-feature / F-078 platform memory layers. -->
<!-- @cap-decision(F-079/AC-1) cap:save defaults to linking the snapshot to the SESSION.json activeFeature; --unassigned and --platform=<topic> are escape hatches. -->
<!-- @cap-decision(F-079/AC-3) Soft-warn (stderr, exit 0) on missing linkage so the snapshot is always written; failing the save would lose the user's primary intent (capture context). -->

<objective>
Save the current session's key context (conversation, decisions, code changes) to `.cap/snapshots/<name>.md` so it can be loaded in a fresh session via `/cap:continue`.

This solves the context window compression problem: instead of losing detail as the context fills up, save important context, start fresh, and reload it losslessly.

**Arguments:**
- `[name]` -- optional snapshot name (default: auto-generated from timestamp)
- `--unassigned` -- save the snapshot WITHOUT linking it to any feature or platform topic (soft-warn on stderr).
- `--platform=<topic>` -- link the snapshot to the platform topic `<topic>` (e.g. `--platform=observability`). Mutually exclusive with `--unassigned`.

**Default linkage (no flags):** read `activeFeature` from `.cap/SESSION.json` and embed it in the snapshot's frontmatter as `feature: F-NNN`. If no `activeFeature` is set, soft-warn on stderr and write the snapshot without linkage (same outcome as `--unassigned`).
</objective>

<context>
$ARGUMENTS
</context>

<process>

## Step 1: Ensure snapshots directory exists

```bash
mkdir -p .cap/snapshots
```

## Step 2: Determine current session ID

```bash
# Find the most recently modified JSONL file for this project
PROJECT_DIR="$HOME/.claude/projects/$(pwd | sed 's|/|-|g')"
ls -t "$PROJECT_DIR"/*.jsonl 2>/dev/null | head -1
```

## Step 3: Extract context from current session

Use the session-extract script to pull all key data:

```bash
SESSION_FILE=$(ls -t "$PROJECT_DIR"/*.jsonl 2>/dev/null | head -1)
```

Now read the session and build the snapshot. Extract three things:

### 3a: Conversation summary (user messages + assistant text responses, skip tool noise)

```bash
node -e "
const fs = require('fs');
const lines = fs.readFileSync('$SESSION_FILE', 'utf8').trim().split('\n');
const msgs = [];
for (const line of lines) {
  try {
    const obj = JSON.parse(line);
    if (obj.isSidechain) continue;
    if (obj.type === 'user') {
      const c = obj.message?.content;
      const text = typeof c === 'string' ? c : (Array.isArray(c) ? c.filter(b => b.type === 'text').map(b => b.text).join('') : '');
      const clean = text.replace(/<system-reminder>[\\s\\S]*?<\\/system-reminder>/g, '').replace(/<[^>]+>/g, '').trim();
      if (clean) msgs.push({ role: 'user', text: clean.substring(0, 500) });
    } else if (obj.type === 'assistant') {
      const c = obj.message?.content;
      if (Array.isArray(c)) {
        const text = c.filter(b => b.type === 'text').map(b => b.text).join('');
        const clean = text.replace(/<system-reminder>[\\s\\S]*?<\\/system-reminder>/g, '').trim();
        if (clean) msgs.push({ role: 'assistant', text: clean.substring(0, 1000) });
      }
    }
  } catch {}
}
console.log(JSON.stringify(msgs));
"
```

### 3b: Code changes (files written/edited)

```bash
node -e "
const fs = require('fs');
const lines = fs.readFileSync('$SESSION_FILE', 'utf8').trim().split('\n');
const changes = [];
for (const line of lines) {
  try {
    const obj = JSON.parse(line);
    if (obj.type !== 'assistant' || obj.isSidechain) continue;
    const content = obj.message?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (c.type === 'tool_use' && ['Write','Edit','MultiEdit'].includes(c.name)) {
        changes.push({ tool: c.name, file: c.input?.file_path || c.input?.filePath || 'unknown' });
      }
    }
  } catch {}
}
// Deduplicate by file
const seen = new Set();
const unique = changes.filter(c => { const k = c.file; if (seen.has(k)) return false; seen.add(k); return true; });
console.log(JSON.stringify(unique));
"
```

## Step 4: Resolve snapshot linkage (F-079)

**Parse $ARGUMENTS for flags before writing:**

- `--unassigned` -- snapshot saved without feature/platform linkage. Soft-warn on stderr.
- `--platform=<topic>` -- link to platform topic. Topic must match kebab-case (`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`).
- **Mutually exclusive:** if BOTH `--unassigned` AND `--platform=` appear, fail HARD with stderr message and exit 1. The snapshot is NOT written.
- **Default (no flags):** read `activeFeature` from SESSION.json and embed it as `feature: F-NNN`.
- **Soft-warn (stderr, exit 0):** when `--unassigned` is explicit OR when no `activeFeature` is set; the snapshot is still saved.

Resolve via the linkage helper:

```bash
node -e "
const path = require('path');
const linkage = require(path.join(process.cwd(), 'cap/bin/lib/cap-snapshot-linkage.cjs'));
const args = process.argv.slice(1);
const opts = { unassigned: args.includes('--unassigned') };
for (const a of args) {
  const m = a.match(/^--platform=(.+)$/);
  if (m) opts.platform = m[1];
}
try {
  const r = linkage.resolveLinkageOptions(process.cwd(), opts);
  if (r.warning) process.stderr.write('warn: ' + r.warning + '\n');
  process.stdout.write(JSON.stringify(r));
} catch (e) {
  process.stderr.write('error: ' + e.message + '\n');
  process.exit(1);
}
" -- $ARGUMENTS
```

The returned `frontmatterPatch` (`{ feature: 'F-NNN' }` OR `{ platform: 'topic' }` OR `{}`) MUST be merged into the snapshot frontmatter in Step 5.

## Step 5: Build the snapshot markdown

Read the extracted data from Steps 3a and 3b, then write a structured snapshot file.

**Determine the snapshot name:**
- If user provided a name argument (positional, NOT a flag): use that
- Otherwise: use format `YYYY-MM-DD-HHMM`

**Write to** `.cap/snapshots/<name>.md` with this structure (merge the `frontmatterPatch` from Step 4 into the frontmatter — emit at most ONE of `feature:` / `platform:`):

```markdown
---
session: <session-id>
date: <ISO timestamp>
branch: <git branch>
source: cap:save
feature: <F-NNN>           # OR
platform: <topic>          # OR neither (unassigned)
---

# Context Snapshot: <name>

## What We Were Working On
<Summarize the main topic/goal from the conversation in 2-3 sentences>

## Key Decisions
<List the important decisions made during the session as bullet points>

## Conversation
<For each turn, show User message (truncated) and Assistant response (truncated)>
<Skip pure tool-use turns, focus on dialogue with substance>

## Files Changed
<List all files that were written or edited>

## Open Questions / Next Steps
<Any unresolved items or planned next actions>
```

**IMPORTANT:** Write the summary sections (What We Were Working On, Key Decisions, Open Questions) by actually reading and understanding the conversation -- don't just dump raw text. These sections are the high-value context that makes /cap:continue effective.

## Step 6: Confirm to user

Tell the user:
- Where the snapshot was saved
- How many conversation turns and file changes were captured
- The linkage outcome from Step 4 (linked to feature `F-NNN`, linked to platform `<topic>`, or unassigned)
- How to continue: "Start a new session and run `/cap:continue <name>`"

**Note:** The snapshot is referenced from the per-feature/platform memory file's `linked_snapshots` block on the next memory-pipeline run (F-079/AC-4). The hook at `hooks/cap-memory.js` calls `processSnapshots()` after each session, so the linkage wires up automatically — no manual step needed.

</process>
