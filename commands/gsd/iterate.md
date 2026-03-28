---
name: gsd:iterate
description: Run the full code-first iteration loop - extract tags, generate plan, approve, execute (Code-First fork)
argument-hint: "[--non-interactive] [--verify] [--annotate]"
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
Orchestrates the complete code-first development loop. It extracts `@gsd-tags` from annotated code, spawns `gsd-code-planner` to generate a plan from `CODE-INVENTORY.md`, pauses for human approval of the plan, then spawns the appropriate executor to implement it.

This is the flagship command of the gsd-code-first fork — the core value proposition that turns annotated code into executed plans in a single command.

**Arguments:**
- `--non-interactive` — skip the approval gate and auto-approve the generated plan (for CI/headless pipelines)
- `--verify` — run `/gsd:verify-work` after the executor completes
- `--annotate` — refresh `@gsd-tags` by re-running extract-tags after the executor completes

**Error handling:** If any step fails, iterate stops immediately and reports the failure. No subsequent steps are executed after a failure.
</objective>

<context>
$ARGUMENTS

@.planning/PROJECT.md
@.planning/REQUIREMENTS.md
@.planning/ROADMAP.md
</context>

<process>

## Step 1 — Show current mode and run extract-tags

Read the current phase mode configuration via bash:
```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" config-get default_phase_mode
```
Display to the user: "Current mode: {mode}"

Then run extract-tags to scan the codebase and produce an up-to-date CODE-INVENTORY.md:
```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" extract-tags --format md --output .planning/prototype/CODE-INVENTORY.md
```

If this command exits with a non-zero exit code, **STOP** and report:
> "iterate failed at step 1: extract-tags error. Check that @gsd-tags exist in your codebase and the project is initialized."

## Step 2 — Spawn gsd-code-planner

Spawn the `gsd-code-planner` agent via the Task tool, passing `$ARGUMENTS` as context.

The agent will:
- Read `.planning/prototype/CODE-INVENTORY.md` (produced by step 1) as its primary planning input
- Read `@gsd-todo` tags as the task backlog (each todo becomes one task)
- Read `@gsd-context`, `@gsd-decision`, `@gsd-constraint`, and `@gsd-risk` tags for plan context
- Produce a Markdown PLAN.md in `.planning/prototype/` following the GSD plan format

Wait for `gsd-code-planner` to complete. If the agent fails or does not produce a plan file, **STOP** and report:
> "iterate failed at step 2: code-planner error. The gsd-code-planner agent did not complete successfully."

## Step 3 — Approval gate

Check if `--non-interactive` is present in `$ARGUMENTS`.

**If `--non-interactive` IS present:**
Log: "Auto-approving plan (--non-interactive mode)." and proceed to step 4.

**If `--non-interactive` is NOT present:**
Read the generated plan from `.planning/prototype/` and present its full contents to the user. Then ask:

> "Review the plan above. Approve execution? [yes/no]"

Wait for the user's response. If the user responds with anything other than clear approval (`yes`, `y`, `approve`), **STOP** and report:
> "iterate stopped: plan not approved. The plan has been saved to .planning/prototype/ -- you can edit it and re-run /gsd:iterate, or approve it manually."

**IMPORTANT:** There is no code path that reaches step 4 without explicit approval or `--non-interactive`. The approval gate is mandatory.

## Step 4 — Spawn executor

Check if ARC mode is enabled via bash:
```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" config-get arc.enabled
```

- If the result is `true`: spawn `gsd-arc-executor` via the Task tool, passing the plan path from `.planning/prototype/` as context.
- If the result is `false` or not set: spawn `gsd-executor` via the Task tool, passing the plan path from `.planning/prototype/` as context.

Wait for the executor to complete. If the executor fails, **STOP** and report:
> "iterate failed at step 4: executor error. Check the plan output and executor logs for details."

## Step 5 — Post-execution flags

Check `$ARGUMENTS` for optional post-execution flags:

**If `--verify` is present:**
Run `/gsd:verify-work` to validate the executed changes meet success criteria.

**If `--annotate` is present:**
Re-run extract-tags to refresh CODE-INVENTORY.md with any new or updated annotations added during execution:
```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" extract-tags --format md --output .planning/prototype/CODE-INVENTORY.md
```

## Step 6 — Show summary

Display a completion summary to the user:

```
iterate complete.

Steps completed: [list of steps 1-5 that ran]
Plan path: .planning/prototype/[plan-filename]
Executor: [gsd-arc-executor | gsd-executor]
Verification: [ran | skipped]
Re-annotation: [ran | skipped]
```

</process>
