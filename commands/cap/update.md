---
name: cap:update
description: "Update CAP to the latest version -- checks npm, shows changelog, performs clean install with cache clearing."
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
---

<objective>
Check for CAP updates via npm, display the changelog for versions between installed and latest, obtain user confirmation, and execute a clean installation with cache clearing.

This command orchestrates the update workflow defined in `cap/workflows/update.md`.
</objective>

<context>
$ARGUMENTS

execution_context: commands/cap/update.md
</context>

<process>

## Step 1: Load and execute the update workflow

Read and follow the full workflow defined in:

```
cap/workflows/update.md
```

That workflow handles:
1. Detecting installed version and install scope (local/global)
2. Checking npm for the latest `code-as-plan` version
3. Comparing versions and showing changelog
4. Obtaining user confirmation before updating
5. Running `npx code-as-plan@latest` with correct flags
6. Clearing `cap-update-check.json` cache files
7. Checking for local patches that need reapplication

Follow every step in that workflow exactly as written.

</process>

<output>
The workflow produces its own formatted output at each step. Do not add extra framing -- let the workflow messages speak for themselves.
</output>
