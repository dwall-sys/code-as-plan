---
name: gsd:add-tests
description: Generate tests for a completed phase based on UAT criteria and implementation
argument-hint: "<phase> [additional instructions]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Task
  - AskUserQuestion
argument-instructions: |
  Parse the argument as a phase number (integer, decimal, or letter-suffix), plus optional free-text instructions.
  Example: /gsd:add-tests 12
  Example: /gsd:add-tests 12 focus on edge cases in the pricing module
---
<objective>
Generate unit and E2E tests for a completed phase, using its SUMMARY.md, CONTEXT.md, and VERIFICATION.md as specifications.

Analyzes implementation files, classifies them into TDD (unit), E2E (browser), or Skip categories, presents a test plan for user approval, then generates tests following RED-GREEN conventions.

When ARC mode is active and CODE-INVENTORY.md exists, routes to gsd-tester agent which uses @gsd-api tags as test specifications.

Output: Test files committed with message `test(phase-{N}): add unit and E2E tests from add-tests command`
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/add-tests.md
</execution_context>

<context>
Phase: $ARGUMENTS

@.planning/STATE.md
@.planning/ROADMAP.md
</context>

<process>
## ARC Mode Check

Determine routing:

```bash
ARC_ENABLED=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" config-get arc.enabled 2>/dev/null || echo "true")
```

Check if CODE-INVENTORY.md exists at `.planning/prototype/CODE-INVENTORY.md`.

### Route A: ARC Mode (ARC_ENABLED="true" AND CODE-INVENTORY.md exists)

Spawn gsd-tester agent with prototype context:
- Pass $ARGUMENTS as context (phase number and any additional instructions)
- The gsd-tester agent handles everything: framework detection, test writing, RED-GREEN, risk annotation

### Route B: Standard Mode (ARC_ENABLED="false" OR CODE-INVENTORY.md absent)

Execute the add-tests workflow from @~/.claude/get-shit-done/workflows/add-tests.md end-to-end.
Preserve all workflow gates (classification approval, test plan approval, RED-GREEN verification, gap reporting).
</process>
