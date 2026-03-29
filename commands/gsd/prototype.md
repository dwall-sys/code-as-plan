---
name: gsd:prototype
description: PRD-driven prototype pipeline — ingests PRD, extracts acceptance criteria, confirms with user, then spawns gsd-prototyper to build annotated code scaffold with @gsd-todo(ref:AC-N) tags. Supports --prd for explicit PRD path, --interactive for step-by-step mode, and --non-interactive for CI pipelines.
argument-hint: "[path] [--phases N] [--prd <path>] [--interactive] [--non-interactive]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Task
  - Glob
  - Grep
  - AskUserQuestion
---

<objective>
Spawns the `gsd-prototyper` agent to build working prototype code with `@gsd-tags` embedded following the ARC annotation standard. Before spawning the agent, this command ingests a PRD (Product Requirements Document), extracts acceptance criteria semantically, presents them to the user for confirmation, and enriches the gsd-prototyper Task() prompt with the confirmed AC list so each acceptance criterion becomes a `@gsd-todo(ref:AC-N)` tag in the prototype code.

On completion, automatically runs `extract-tags` to produce `.planning/prototype/CODE-INVENTORY.md`.

**Arguments:**
- `path` — target directory for prototype output (defaults to project root if omitted)
- `--phases N` — scope the prototype to specific phase numbers from ROADMAP.md (e.g., `--phases 2` or `--phases 2,3`); only requirements belonging to those phases will be prototyped
- `--prd <path>` — explicit path to a PRD file; takes priority over auto-detection
- `--interactive` — pause after each iteration in the autonomous loop to show progress and ask whether to continue
- `--non-interactive` — skip the AC confirmation gate and auto-approve (for CI/headless pipelines)

**PRD resolution priority chain:**
1. `--prd <path>` flag — use the specified file
2. Auto-detect `.planning/PRD.md` — use if present
3. Paste prompt — ask user to paste PRD content via AskUserQuestion

**Key guarantee:** Each acceptance criterion from the PRD becomes exactly one `@gsd-todo(ref:AC-N)` tag in the prototype code, enabling the extract-tags completeness check.
</objective>

<context>
$ARGUMENTS

@.planning/PROJECT.md
@.planning/REQUIREMENTS.md
@.planning/ROADMAP.md
</context>

<process>

## Step 0: Parse flags

Check `$ARGUMENTS` for the following flags:

- **`--prd <path>`** — if present, note the path value that follows `--prd` as `prd_path`
- **`--interactive`** — if present, set `interactive_mode = true`
- **`--non-interactive`** — if present, set `non_interactive_mode = true`
- **`--phases N`** — if present, note the value for passing to gsd-prototyper

Log the parsed flags so the user can confirm the invocation was understood.

## Step 1: Resolve PRD content

Resolve `prd_content` using the following priority chain. All three paths produce the same `prd_content` variable for downstream processing. Log which resolution path was used.

**Priority 1 — `--prd <path>` flag is present:**

Read the file at `<path>` using the Read tool.

If the file does not exist, STOP and report:
> "prototype failed at step 1: PRD file not found at `<path>`. Check the path and try again."

Log: "PRD source: --prd flag (`<path>`)"

**Priority 2 — `--prd` is NOT present, check for `.planning/PRD.md`:**

Run:
```bash
test -f .planning/PRD.md && echo "exists" || echo "missing"
```

If the result is `"exists"`: Read `.planning/PRD.md` using the Read tool.

Log: "PRD source: auto-detected .planning/PRD.md"

**Priority 3 — neither `--prd` nor `.planning/PRD.md` is present:**

Use AskUserQuestion:
> "No PRD file found at `.planning/PRD.md`. You can:
> - Paste your full PRD content below, OR
> - Type `skip` to run without a PRD (backward-compatible behavior — prototype uses PROJECT.md and REQUIREMENTS.md only)
>
> Paste PRD content or type 'skip':"

If the user types `skip`: proceed directly to Step 4 without PRD context (no AC extraction, no confirmation gate, standard prototype spawn behavior).

If the user pastes content: use that as `prd_content`. If the content is longer than 5000 characters, confirm: "Received N characters of PRD content. Proceeding to acceptance criteria extraction."

Log: "PRD source: pasted content"

## Step 2: Extract acceptance criteria

**Skip this step if the user typed `skip` in Step 1.**

Using the PRD content obtained in Step 1, extract all acceptance criteria semantically. Apply the following extraction prompt to `prd_content`:

---

Extract all acceptance criteria, requirements, and success conditions from the following PRD.
Output format — one per line:
AC-1: [description in imperative form]
AC-2: [description in imperative form]
...

Rules:
- Include ACs from prose paragraphs, bullet lists, tables, and user stories
- Normalize user stories to acceptance criteria form ("User can..." → "Users can...")
- If the PRD has explicit numbered/labeled ACs, preserve their intent but renumber sequentially
- If no explicit ACs exist, infer them from goals and scope sections
- Output ONLY the numbered list — no headers, no commentary

PRD content:
[prd_content]

---

Store the resulting numbered list as `ac_list`. Count the total: `ac_count = N`.

## Step 3: Confirmation gate

**Skip this step if the user typed `skip` in Step 1.**

Check if `--non-interactive` is present in `$ARGUMENTS`.

**If `--non-interactive` IS present:**

Log: "Auto-approving N acceptance criteria (--non-interactive mode)." and proceed to Step 4.

**If `--non-interactive` is NOT present:**

Display the numbered AC list to the user clearly:

```
Found N acceptance criteria from PRD:

AC-1: [description]
AC-2: [description]
...
```

Then use AskUserQuestion:
> "Found N acceptance criteria from PRD. Review the list above. Proceed with prototype generation? [yes / provide corrections]"

- If the user says `yes`, `y`, or `approve`: proceed to Step 4.
- If the user provides corrections or changes: incorporate the corrections into `ac_list`, re-display the updated list, and repeat the confirmation question (loop back to the start of this step with the updated list). Continue until the user approves.

**IMPORTANT:** There is NO code path that reaches Step 4 without explicit approval or `--non-interactive`. The confirmation gate is mandatory.

## Step 4: Spawn gsd-prototyper (first pass)

Spawn the `gsd-prototyper` agent via the Task tool.

**If PRD was provided (user did NOT type `skip`):**

Pass the following enriched context in the Task() prompt:

```
$ARGUMENTS

**Acceptance criteria to implement as @gsd-todo tags:**
[paste ac_list here — the full numbered list from Step 2/3]

For each acceptance criterion listed above, create exactly one @gsd-todo tag with `ref:AC-N` metadata in the prototype code where N is the criterion number. The tag must appear on a dedicated comment line (not trailing).

Example:
// @gsd-todo(ref:AC-1) User can run /gsd:prototype with PRD auto-detection at .planning/PRD.md
// @gsd-todo(ref:AC-3, priority:high) User is prompted to paste PRD content if no file is found

The @gsd-todo(ref:AC-N) tags are the primary completeness tracking mechanism. Every AC in the list above must have exactly one corresponding tag in the prototype code.

The agent will also:
- Read `get-shit-done/references/arc-standard.md` for the ARC tag standard
- Read `PROJECT.md`, `REQUIREMENTS.md`, and `ROADMAP.md` for project context and requirement IDs
- If `--phases N` is present in the arguments, filter to only requirements for those phases
- Plan and create prototype files with `@gsd-tags` embedded in comments
- Write `.planning/prototype/PROTOTYPE-LOG.md` capturing files created, decisions made, and open todos
```

**If PRD was skipped (user typed `skip`):**

Pass only `$ARGUMENTS` as context (standard prototype spawn behavior):

```
$ARGUMENTS

The agent will:
- Read `get-shit-done/references/arc-standard.md` for the ARC tag standard
- Read `PROJECT.md`, `REQUIREMENTS.md`, and `ROADMAP.md` for project context and requirement IDs
- If `--phases N` is present in the arguments, filter to only requirements for those phases
- Plan and create prototype files with `@gsd-tags` embedded in comments
- Write `.planning/prototype/PROTOTYPE-LOG.md` capturing files created, decisions made, and open todos
```

Wait for gsd-prototyper to complete and note its summary output (files created, total tags embedded, breakdown by tag type).

## Step 5: Run extract-tags

Auto-run extract-tags to produce CODE-INVENTORY.md from the annotated prototype:

```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" extract-tags --format md --output .planning/prototype/CODE-INVENTORY.md
```

This scans all prototype files for `@gsd-tags` and writes `.planning/prototype/CODE-INVENTORY.md` grouped by tag type and file, with summary statistics and a phase reference index.

**If PRD was provided (user did NOT type `skip`):**

Count AC-linked todos:
```bash
grep -c "ref:AC-" .planning/prototype/CODE-INVENTORY.md 2>/dev/null || echo "0"
```

Log: "AC todos remaining: N" (where N is the grep count).

If N is 0 and `ac_count > 0`, warn: "Warning: no AC-linked @gsd-todo tags found in CODE-INVENTORY.md. The prototype may not have implemented the accepted AC list. Check that gsd-prototyper received the AC list and used `ref:AC-N` metadata in @gsd-todo tags."

**If PRD was skipped:**

Log: "No PRD-linked todos to track."

**Show the user the results:**
- Files created (from gsd-prototyper summary)
- Total @gsd-tags embedded (from gsd-prototyper summary)
- AC todos remaining (if PRD was provided): N of ac_count
- Path to PROTOTYPE-LOG.md: `.planning/prototype/PROTOTYPE-LOG.md`
- Path to CODE-INVENTORY.md: `.planning/prototype/CODE-INVENTORY.md`

<!-- Steps 6-7 (autonomous iteration loop and final report) will be added by Plan 02 -->

</process>
