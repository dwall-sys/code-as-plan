---
name: gsd:extract-plan
description: Scan codebase for @gsd-tags and produce .planning/prototype/CODE-INVENTORY.md
argument-hint: "[path] [--phase N] [--type TYPE]"
allowed-tools:
  - Read
  - Write
  - Bash
---

<objective>
Scan the project for @gsd-tags using gsd-tools.cjs extract-tags and write the results to .planning/prototype/CODE-INVENTORY.md. The output is grouped by tag type, file, and phase reference.

Optional arguments:
- path: Directory or file to scan (defaults to project root)
- --phase N: Filter tags by phase number
- --type TYPE: Filter tags by tag type (context, decision, todo, constraint, pattern, ref, risk, api)
</objective>

<context>
$ARGUMENTS
</context>

<process>
1. Run the following command to scan for @gsd-tags and write CODE-INVENTORY.md:
   node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" extract-tags --format md --output .planning/prototype/CODE-INVENTORY.md $ARGUMENTS

2. Read .planning/prototype/CODE-INVENTORY.md to get the tag count and type breakdown from the Summary Statistics table.

3. Show the user a summary including:
   - Total tags found
   - Count per tag type
   - Output path: .planning/prototype/CODE-INVENTORY.md
   - Timestamp of generation
</process>
