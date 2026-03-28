---
name: gsd:annotate
description: Retroactively annotate existing code with @gsd-tags using gsd-annotator, then auto-run extract-plan
argument-hint: "[path] [--glob PATTERN]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Task
  - Glob
  - Grep
---

<objective>
Spawns the `gsd-annotator` agent to read existing source code and add `@gsd-tags` following the ARC annotation standard. On completion, automatically runs `extract-plan` to produce `.planning/prototype/CODE-INVENTORY.md`.

**Arguments:**
- `path` — directory to annotate (defaults to project root if omitted)
- `--glob PATTERN` — override the default file glob pattern (e.g., `--glob "src/**/*.ts"`)

The annotator reads `PROJECT.md` and `REQUIREMENTS.md` before annotating so tags reflect actual project goals and requirement IDs. It follows the ARC standard from `get-shit-done/references/arc-standard.md` for all tag type and comment anchor rules.
</objective>

<context>
$ARGUMENTS

@.planning/PROJECT.md
@.planning/REQUIREMENTS.md
</context>

<process>

1. **Spawn gsd-annotator agent** via the Task tool, passing `$ARGUMENTS` as context. The agent will:
   - Read `get-shit-done/references/arc-standard.md` for the ARC tag standard
   - Read `PROJECT.md` and `REQUIREMENTS.md` for project context and requirement IDs
   - Identify files matching the path/glob in `$ARGUMENTS` (or use defaults)
   - Add `@gsd-tags` as comment lines immediately before relevant code blocks
   - Report files annotated, total tags added, and tag type breakdown

2. **Wait for gsd-annotator to complete** and note its summary output (files annotated, total tags added, breakdown by tag type).

3. **Auto-run extract-plan** to produce an updated `CODE-INVENTORY.md`:
   ```bash
   node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" extract-tags --format md --output .planning/prototype/CODE-INVENTORY.md
   ```
   This scans the now-annotated codebase for all `@gsd-tags` and writes `.planning/prototype/CODE-INVENTORY.md` grouped by tag type and file, with summary statistics and a phase reference index.

4. **Show the user the results:**
   - Files annotated (from gsd-annotator summary)
   - Total @gsd-tags added (from gsd-annotator summary)
   - Path to updated CODE-INVENTORY.md: `.planning/prototype/CODE-INVENTORY.md`

</process>
