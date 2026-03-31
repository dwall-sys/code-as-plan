---
name: cap:annotate
description: "Retroactively annotate existing code with @cap-feature and @cap-todo tags. Invokes cap-prototyper in ANNOTATE mode."
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Task
---

<!-- @gsd-context CAP v2.0 annotate command -- invokes cap-prototyper in annotate mode to add @cap-feature tags to existing unannotated code. Primary entry point after brownfield init. -->
<!-- @gsd-decision Annotate is a thin command wrapper over cap-prototyper ANNOTATE mode. This avoids a separate agent and keeps all code generation/modification in one agent with mode dispatch. -->
<!-- @gsd-decision Annotate targets a specific directory or defaults to project root src/. Scoped annotation prevents overwhelming the user with changes across the entire codebase at once. -->

<!-- @gsd-todo(ref:AC-89) /cap:annotate shall invoke cap-prototyper in annotate mode -->

<objective>
Add @cap-feature and @cap-todo tags to existing unannotated code by invoking cap-prototyper in ANNOTATE mode. This is the recommended next step after brownfield /cap:init.

**Arguments:**
- `[path]` -- directory or file to annotate (defaults to `src/` or project root)
- `--feature F-NNN` -- scope annotation to a specific Feature Map entry
- `--dry-run` -- preview annotations without writing files

**Requires:** FEATURE-MAP.md must exist (run /cap:init first).
</objective>

<context>
$ARGUMENTS

@FEATURE-MAP.md
</context>

<process>

## Step 1: Validate prerequisites

Check that CAP is initialized:

```bash
test -d .cap && echo "CAP_INITIALIZED" || echo "NOT_INITIALIZED"
test -f FEATURE-MAP.md && echo "FEATURE_MAP_EXISTS" || echo "NO_FEATURE_MAP"
```

If not initialized, abort with: "CAP is not initialized. Run /cap:init first."

## Step 2: Parse arguments

- Extract `path` from positional argument (default: `src/` if exists, else `.`)
- Extract `--feature` flag if present
- Extract `--dry-run` flag if present

## Step 3: Load context for annotate mode

Read FEATURE-MAP.md to understand available features and ACs.

Check for existing tags in target path:

```bash
node -e "
const scanner = require('./cap/bin/lib/cap-tag-scanner.cjs');
const tags = scanner.scanDirectory(process.cwd());
const groups = scanner.groupByFeature(tags);
console.log(JSON.stringify({
  totalTags: tags.length,
  features: Object.keys(groups),
  filesWithTags: new Set(tags.map(t => t.file)).size
}));
"
```

Load stack docs if available:

```bash
ls .cap/stack-docs/*.md 2>/dev/null | head -10 || echo "no stack docs"
```

## Step 4: Invoke cap-prototyper in ANNOTATE mode

Use the Task tool to spawn cap-prototyper with ANNOTATE mode:

```
Task("cap-prototyper", "
**MODE: ANNOTATE**

**Target path:** {resolved_path}
**Feature scope:** {feature_id or 'all'}
**Dry run:** {dry_run}

**FEATURE-MAP.md content:**
{feature_map_content}

**Existing tags found:**
{existing_tag_summary}

**Stack docs available:**
{stack_docs_list}

**Instructions:**
1. Scan {target_path} for source files without @cap-feature tags
2. Read each unannotated file and identify significant functions, classes, modules
3. Match code to Feature Map entries based on purpose and file paths
4. Use the Edit tool to add @cap-feature tags WITHOUT changing code logic
5. Add @cap-todo tags for any unfinished work discovered during annotation
6. {If dry_run: 'OUTPUT the proposed changes but do NOT write files'}
")
```

## Step 5: Run scan after annotation

After the prototyper completes, run a scan to update Feature Map:

```bash
node -e "
const scanner = require('./cap/bin/lib/cap-tag-scanner.cjs');
const fm = require('./cap/bin/lib/cap-feature-map.cjs');
const tags = scanner.scanDirectory(process.cwd());
const updated = fm.enrichFromTags(process.cwd(), tags);
console.log(JSON.stringify({
  totalTags: tags.length,
  featuresWithFiles: updated.features.filter(f => f.files.length > 0).length,
  totalFileRefs: updated.features.reduce((sum, f) => sum + f.files.length, 0)
}));
"
```

## Step 6: Report results

```
cap:annotate complete.

Files annotated: {N}
Tags added: {N}
  @cap-feature: {N}
  @cap-todo:    {N}
  @cap-risk:    {N}
  @cap-decision:{N}

Feature Map updated:
  Features with file refs: {N}
  Total file references:   {N}

Next steps:
  /cap:scan      -- verify tag coverage
  /cap:prototype -- build out features that need implementation
  /cap:status    -- view project dashboard
```

## Step 7: Update session

```bash
node -e "
const session = require('./cap/bin/lib/cap-session.cjs');
session.updateSession(process.cwd(), {
  lastCommand: '/cap:annotate',
  lastCommandTimestamp: new Date().toISOString(),
  step: 'annotated'
});
"
```

</process>
