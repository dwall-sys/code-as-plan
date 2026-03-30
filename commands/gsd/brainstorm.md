---
name: gsd:brainstorm
description: Interactive brainstorm conversation that produces structured PRD(s) with acceptance criteria, feature grouping, and dependency analysis. Spawns gsd-brainstormer agent for conversational discovery, then writes PRD files and BRAINSTORM-LEDGER.md after user confirmation.
argument-hint: "[--resume] [--multi]"
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

<!-- @gsd-context(phase:10) Command orchestrator for /gsd:brainstorm -- manages the conversation lifecycle, PRD file writing, and ledger persistence. The agent (gsd-brainstormer) handles the creative conversation; this command handles file I/O and approval gates. -->
<!-- @gsd-ref(ref:BRAIN-01) Entry point for conversational PRD generation -->
<!-- @gsd-pattern PRD ingestion and file writing stays in command layer, not agent layer -- proven pattern from prototype.md -->
<!-- @gsd-decision Brainstorm command owns file writes because the agent should remain stateless and reusable across PRD formats. Agent returns structured data; command persists it. -->

<objective>
Spawns the `gsd-brainstormer` agent to have a structured conversation with the user about what needs to be built. The agent asks targeted questions one at a time, clusters features into logical groups, surfaces dependencies, and drafts PRD content. This command then presents the PRD summary for user confirmation and writes the final PRD file(s) and BRAINSTORM-LEDGER.md.

<!-- @gsd-todo(ref:AC-1) User runs /gsd:brainstorm and agent asks targeted questions one at a time to understand what needs to be built -->

**Arguments:**
- `--resume` -- resume a previous brainstorm session using BRAINSTORM-LEDGER.md context
- `--multi` -- hint that the project likely has multiple independent feature areas (agent will proactively ask about separation)

**Key guarantee:** No files are written until the user explicitly approves the PRD summary. The approval gate is mandatory and cannot be bypassed.

<!-- @gsd-constraint(priority:high) No PRD files or ledger entries are written without explicit user approval -- the confirmation gate is mandatory and has no bypass flag -->
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

- **`--resume`** -- if present, set `resume_mode = true`
- **`--multi`** -- if present, set `multi_mode = true`

Log the parsed flags so the user can confirm the invocation was understood.

## Step 1: Check for existing session context

<!-- @gsd-ref(ref:BRAIN-07) Ledger enables cross-session continuity -->

**If `--resume` is present:**

Check if `.planning/BRAINSTORM-LEDGER.md` exists:

```bash
test -f .planning/BRAINSTORM-LEDGER.md && echo "exists" || echo "missing"
```

If it exists, read `.planning/BRAINSTORM-LEDGER.md` using the Read tool. Extract:
- Previous decisions made
- Features already identified
- Scope exclusions
- Deferred items
- Any open questions from the last session

Log: "Resuming brainstorm session. Found N previous decisions, M features identified."

If it does not exist and `--resume` was specified:
Log: "No previous brainstorm session found at .planning/BRAINSTORM-LEDGER.md. Starting fresh."
Set `resume_mode = false`.

**If `--resume` is NOT present:**

Check if `.planning/BRAINSTORM-LEDGER.md` exists anyway. If it does, note it but do not load it -- the user chose to start fresh.

Log: "Starting new brainstorm session."

## Step 2: Spawn gsd-brainstormer for conversational discovery

<!-- @gsd-decision Spawn the agent with AskUserQuestion tool access so it can have a back-and-forth conversation directly with the user. The command layer does not mediate the conversation -- it only handles pre/post processing. -->

Spawn `gsd-brainstormer` via the Task tool with the following context:

```
$ARGUMENTS

**Session context:**
Resume mode: {resume_mode}
Multi-feature hint: {multi_mode}

{If resume_mode and ledger content exists:}
**Previous session context from BRAINSTORM-LEDGER.md:**
{ledger_content}

**Instructions:**
1. Have a conversational exchange with the user to understand what needs to be built
2. Ask targeted questions ONE AT A TIME -- do not present a list of questions
3. After sufficient understanding, cluster features into logical groups
4. Surface dependencies between feature groups
5. Draft a PRD summary with numbered acceptance criteria
6. Return the PRD content in the exact format specified in your agent instructions

Do NOT write any files -- return the PRD content and feature analysis as structured output. The command layer handles all file writes.
```

Wait for `gsd-brainstormer` to complete. The agent returns structured delimited text. Parse the output as follows:

**Output parsing logic:**

1. Extract the full output between `=== BRAINSTORM OUTPUT ===` and `=== END BRAINSTORM OUTPUT ===`
2. Parse `MULTI_PRD:` line -- read the value (`true` or `false`) and store as `multi_prd`
3. **If `multi_prd = false`:** Extract the single PRD content between `=== PRD CONTENT ===` and `=== END PRD CONTENT ===`. Store as `prd_content`.
4. **If `multi_prd = true`:** Extract each PRD file block between `=== PRD FILE: {slug} ===` and `=== END PRD FILE ===`. For each block, store the slug from the delimiter line and the full markdown content. Collect all into `prd_files` (an ordered list of `{ slug, content }` entries).
5. Extract feature groups between `=== FEATURE GROUPS ===` and `=== END FEATURE GROUPS ===`. Store as `feature_groups`.
6. Extract decisions between `=== DECISIONS ===` and `=== END DECISIONS ===`. Store as `decisions` (list of bullet items).
7. Extract exclusions between `=== EXCLUSIONS ===` and `=== END EXCLUSIONS ===`. Store as `exclusions` (list of bullet items with reasons).
8. Extract deferred items between `=== DEFERRED ===` and `=== END DEFERRED ===`. Store as `deferred` (list of bullet items with reasons).
9. **If a `=== COUNTS ===` block exists** (between `=== COUNTS ===` and `=== END COUNTS ===`): parse the key=value lines (`FEATURES_IDENTIFIED=N`, `FEATURE_GROUPS=N`, `DEPENDENCIES=N`, `AC_TOTAL=N`, `PRD_FILES=N`, `EXCLUSIONS=N`, `DEFERRED=N`) and store each as a named variable for use in Step 6's final report. If the counts block is missing, derive counts by counting items in the parsed lists above.

All parsed variables (`multi_prd`, `prd_content` or `prd_files`, `feature_groups`, `decisions`, `exclusions`, `deferred`, and count values) are now available for Steps 3-6.

<!-- @gsd-todo(ref:AC-2) Agent clusters features into logical groups and surfaces dependencies between them -->

## Step 3: Present PRD summary for confirmation

<!-- @gsd-ref(ref:BRAIN-06) Approval gate before file writes -->
<!-- @gsd-todo(ref:AC-3) Agent presents a PRD summary with numbered ACs for user confirmation before writing any files -->

**Display the PRD summary to the user:**

If single PRD (`multi_prd = false`):
```
Brainstorm complete. Here is the proposed PRD:

---
{prd_content preview -- title, overview, and full AC list}
---

Acceptance criteria: {ac_count} total
Feature groups: {group_count}
Dependencies identified: {dep_count}
```

If multiple PRDs (`multi_prd = true`):
```
Brainstorm complete. Proposing {N} separate PRD files:

PRD-{slug-1}.md: {title-1} ({ac_count_1} ACs)
PRD-{slug-2}.md: {title-2} ({ac_count_2} ACs)
...

Total acceptance criteria: {total_ac_count}
Cross-PRD dependencies: {list any}
```

Then use AskUserQuestion:
> "Review the PRD summary above. Proceed with writing the file(s)? [yes / provide corrections / restart]"

- If `yes`, `y`, or `approve`: proceed to Step 4.
- If the user provides corrections: spawn a **follow-up** `gsd-brainstormer` Task() call. The follow-up prompt must include the ORIGINAL Task() context (session flags, resume content) PLUS the user's correction text appended at the end under a `**Corrections from user:**` header. This is NOT a fresh conversation -- the agent receives the full prior context so it can revise without re-asking discovery questions. Parse the revised output using the same delimiter extraction logic from Step 2. Re-display the updated PRD summary and re-confirm (loop back to the AskUserQuestion above).
- If `restart`: clear all parsed variables (`prd_content`, `prd_files`, `feature_groups`, `decisions`, `exclusions`, `deferred`, count values) and go back to Step 2 with a completely fresh Task() call. The agent starts a new conversation from scratch.

**IMPORTANT:** There is NO code path that reaches Step 4 without explicit user approval.

## Step 4: Write PRD file(s)

<!-- @gsd-todo(ref:AC-4) After confirmation, agent writes .planning/PRD.md (or PRD-[slug].md) in the format /gsd:prototype expects -->
<!-- @gsd-ref(ref:BRAIN-03) PRD output must be consumable by /gsd:prototype without modification -->

**If single PRD:**

Write `.planning/PRD.md` using the Write tool with the confirmed `prd_content`.

The PRD MUST include these sections in this order (compatible with /gsd:prototype AC extraction):
1. `# {Project/Feature Title}` -- H1 header
2. `## Overview` -- what is being built and why
3. `## Acceptance Criteria` -- numbered list in imperative form (AC-1, AC-2, ...)
4. `## Out of Scope` -- explicitly excluded items
5. `## Technical Notes` -- any implementation hints or constraints

Log: "Wrote .planning/PRD.md ({ac_count} acceptance criteria)"

<!-- @gsd-todo(ref:AC-5) Agent can produce multiple scoped PRD files when features are independent -->

**If multiple PRDs:**

For each PRD in `prd_files`:

**Slug generation rule (collision-resistant):**

The slug for each PRD file is generated from the feature group title as follows:
1. Convert the title to lowercase
2. Replace all spaces, underscores, and special characters (anything not `a-z`, `0-9`, or `-`) with hyphens
3. Collapse consecutive hyphens into a single hyphen
4. Trim leading and trailing hyphens
5. Truncate to 40 characters (do not truncate mid-word if possible -- truncate at the last hyphen before the 40-character boundary)
6. Append a hyphen and a 4-character hex hash derived from the FULL original title (before truncation). Compute the hash using: `echo -n "{original title}" | md5 | cut -c1-4` via Bash. This ensures that even if two titles truncate to the same 40-character prefix, the slugs will differ.

Example: title "User Authentication & Session Management" produces slug `user-authentication-session-management-a3f1`

If the agent already returned a slug in the `=== PRD FILE: {slug} ===` delimiter, verify it follows these rules. If it does not, regenerate the slug using the rule above.

Write `.planning/PRD-{slug}.md` using the Write tool with the confirmed content for that PRD.

Log: "Wrote .planning/PRD-{slug}.md ({ac_count} acceptance criteria)"

<!-- @gsd-risk Multi-PRD slug generation may produce naming collisions if feature titles are similar -- slugify function should be deterministic and collision-resistant -->

## Step 5: Write BRAINSTORM-LEDGER.md

<!-- @gsd-todo(ref:AC-6) Conversation decisions are persisted to .planning/BRAINSTORM-LEDGER.md for cross-session continuity -->
<!-- @gsd-ref(ref:BRAIN-07) Ledger persistence for cross-session continuity -->

**Read-then-append pattern:**

First, obtain the current timestamp:

```bash
SESSION_TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
```

Then check if the ledger file already exists:

```bash
test -f .planning/BRAINSTORM-LEDGER.md && echo "exists" || echo "missing"
```

**If the file exists:** Read `.planning/BRAINSTORM-LEDGER.md` using the Read tool. Store its full content as `existing_ledger_content`. Then write the file using the Write tool with the content: `{existing_ledger_content}` followed by a blank line and the new session block below. This preserves all previous sessions.

**If the file does not exist:** Write the file using the Write tool with the `# Brainstorm Ledger` header followed by the new session block below.

In both cases, the Write tool call contains the COMPLETE file content (previous sessions + new session). This is a single atomic write, not an append operation -- the Write tool always overwrites, so the full content must be provided.

<!-- @gsd-decision Ledger uses append-friendly markdown structure with timestamped session blocks so multiple brainstorm sessions accumulate context rather than overwrite -->

Structure (new session block to append):

```markdown
# Brainstorm Ledger

## Session: {SESSION_TIMESTAMP}

### Decisions Made
- {decision 1}
- {decision 2}
...

### Features Identified
| Feature | Group | Dependencies |
|---------|-------|-------------|
| {feature} | {group} | {deps or "none"} |

### Scope Exclusions
- {exclusion 1}: {reason}
...

### Deferred Items
- {item}: {reason for deferral}
...

### PRD Files Written
- {path}: {title} ({ac_count} ACs)
...
```

Log: "Updated .planning/BRAINSTORM-LEDGER.md"

## Step 6: Final report

Display completion summary:

```
brainstorm complete.

PRD files written:
  - {path} ({ac_count} ACs)
  ...

Ledger updated: .planning/BRAINSTORM-LEDGER.md
  Decisions recorded: {N}
  Features identified: {N}
  Scope exclusions: {N}

Next steps:
  - Run /gsd:prototype to generate code scaffold from the PRD
  - Run /gsd:prototype --prd .planning/PRD-{slug}.md to prototype a specific feature
  - Run /gsd:brainstorm --resume to continue refining in a future session
```

<!-- @gsd-risk If the user runs /gsd:prototype immediately after brainstorm, the PRD auto-detection in prototype.md will find PRD.md but not PRD-[slug].md files -- user must use --prd flag for multi-PRD projects -->

</process>
