---
name: gsd:prototype
description: Build a working code prototype with embedded @gsd-tags using gsd-prototyper, then auto-run extract-plan
argument-hint: "[path] [--phases N]"
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
Spawns the `gsd-prototyper` agent to build working prototype code with `@gsd-tags` embedded following the ARC annotation standard. On completion, automatically runs `extract-plan` to produce `.planning/prototype/CODE-INVENTORY.md`.

**Arguments:**
- `path` — target directory for prototype output (defaults to project root if omitted)
- `--phases N` — scope the prototype to specific phase numbers from ROADMAP.md (e.g., `--phases 2` or `--phases 2,3`); only requirements belonging to those phases will be prototyped

The prototyper reads `PROJECT.md`, `REQUIREMENTS.md`, and `ROADMAP.md` before building so all generated code reflects actual project goals, requirement IDs, and phase structure.
</objective>

<context>
$ARGUMENTS

@.planning/PROJECT.md
@.planning/REQUIREMENTS.md
@.planning/ROADMAP.md
</context>

<process>

1. **Spawn gsd-prototyper agent** via the Task tool, passing `$ARGUMENTS` as context. The agent will:
   - Read `get-shit-done/references/arc-standard.md` for the ARC tag standard
   - Read `PROJECT.md`, `REQUIREMENTS.md`, and `ROADMAP.md` for project context and requirement IDs
   - If `--phases N` is present in `$ARGUMENTS`, filter to only requirements for those phases
   - Plan and create prototype files with `@gsd-tags` embedded in comments
   - Write `.planning/prototype/PROTOTYPE-LOG.md` capturing files created, decisions made, and open todos

2. **Wait for gsd-prototyper to complete** and note its summary output (files created, total tags embedded, breakdown by tag type).

3. **Auto-run extract-plan** to produce CODE-INVENTORY.md from the annotated prototype:
   ```bash
   node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" extract-tags --format md --output .planning/prototype/CODE-INVENTORY.md
   ```
   This scans all prototype files for `@gsd-tags` and writes `.planning/prototype/CODE-INVENTORY.md` grouped by tag type and file, with summary statistics and a phase reference index.

4. **Show the user the results:**
   - Files created (from gsd-prototyper summary)
   - Total @gsd-tags embedded (from gsd-prototyper summary)
   - Path to PROTOTYPE-LOG.md: `.planning/prototype/PROTOTYPE-LOG.md`
   - Path to CODE-INVENTORY.md: `.planning/prototype/CODE-INVENTORY.md`

</process>
