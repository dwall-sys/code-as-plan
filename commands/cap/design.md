---
name: cap:design
description: Design system bootstrap. Runs a 3-question aesthetic wizard (--new) or extends an existing DESIGN.md with new tokens/components (--extend). Spawns cap-designer agent. Deterministic, idempotent.
argument-hint: "[--new | --extend]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Task
  - AskUserQuestion
---

<!-- @cap-context CAP F-062 /cap:design command -- orchestrates DESIGN.md creation and extension. Spawns cap-designer agent for the conversational wizard, then calls cap-design.cjs to produce the deterministic DESIGN.md. -->
<!-- @cap-decision Command layer owns ALL file I/O. Agent returns wizard answers only. Mirrors the /cap:brainstorm pattern. -->
<!-- @cap-decision Mapping from answers to family is deterministic (cap-design.cjs FAMILY_MAP) so AC-7 idempotence holds regardless of LLM nondeterminism. -->
<!-- @cap-constraint No DESIGN.md writes without explicit user approval on --new. --extend requires confirmation before merge. -->

<!-- @cap-feature(feature:F-062) cap:design Core — DESIGN.md + Aesthetic Picker -->

<objective>
<!-- @cap-todo(ac:F-062/AC-1) /cap:design --new spawns cap-designer for greenfield design setup -->

Spawns `cap-designer` to run the 3-question aesthetic wizard (`--new`) or collect extension payloads (`--extend`). This command writes the resulting `DESIGN.md` at the project root using `cap/bin/lib/cap-design.cjs`.

**Flags:**
- `--new` — fresh DESIGN.md via wizard (refuses to overwrite an existing DESIGN.md without explicit confirm).
- `--extend` — append tokens/components to an existing DESIGN.md (does not overwrite existing entries).

**Key guarantees:**
- Idempotent: same wizard answers produce a byte-identical DESIGN.md (AC-7).
- Append-only on `--extend`: existing entries are never overwritten (AC-5).
- Anti-Slop constraints surfaced in every generated DESIGN.md (AC-6).

</objective>

<context>
$ARGUMENTS

@DESIGN.md
@FEATURE-MAP.md
</context>

<process>

## Step 0: Parse flags

Check `$ARGUMENTS` for:
- `--new` -- set `mode = "new"`
- `--extend` -- set `mode = "extend"`

If neither flag is present, default to `--new` but prompt for confirmation if DESIGN.md already exists (see Step 1).

Log: `cap:design | mode: {mode}`

## Step 1: Check existing DESIGN.md

<!-- @cap-todo(ac:F-062/AC-4) DESIGN.md lives at project root next to FEATURE-MAP.md, versioned via git -->

```bash
node -e "
const d = require('./cap/bin/lib/cap-design.cjs');
const content = d.readDesignMd(process.cwd());
console.log(JSON.stringify({ exists: content !== null, length: content ? content.length : 0 }));
"
```

Store as `design_state`.

Behavior by mode:

- `mode === "new"` AND `design_state.exists === true`:
  Use AskUserQuestion: `"DESIGN.md already exists ({design_state.length} bytes). Overwrite with fresh wizard output? [yes / cancel / switch to --extend]"`
  - `yes` — continue (the idempotence guarantee means rerunning with same answers is a no-op anyway).
  - `switch to --extend` — set `mode = "extend"` and continue.
  - otherwise — abort with message `"cap:design cancelled. No changes made."`.

- `mode === "extend"` AND `design_state.exists === false`:
  Abort: `"No DESIGN.md found to extend. Run /cap:design --new first."`

## Step 2: Spawn cap-designer agent

<!-- @cap-todo(ac:F-062/AC-2) cap-designer runs the 3-question wizard and maps to one of 9 families -->

Spawn `cap-designer` via the Task tool with the following context:

```
$ARGUMENTS

**Mode:** {mode}
**Existing DESIGN.md:** {design_state.exists ? "yes (will be extended / overwritten per mode)" : "no"}

**Instructions:**
- If mode is `new`, run the 3-question wizard (read-heavy vs scan-heavy; user type; courage factor). Ask ONE question at a time via AskUserQuestion.
- If mode is `extend`, ask what to add (color-token or component or both) and collect the structured additions.
- Do NOT write any files. Return the structured output block exactly as specified in your agent prompt.
- Respect the Anti-Slop constraint block from your prompt.

**Return format (delimited, one of):**

For --new:
=== DESIGN OUTPUT ===
MODE: new
READ_HEAVY: {read-heavy|scan-heavy}
USER_TYPE: {consumer|professional|developer}
COURAGE_FACTOR: {safe|balanced|bold}
=== END DESIGN OUTPUT ===

For --extend:
=== DESIGN OUTPUT ===
MODE: extend
COLORS: {JSON object or {}}
COMPONENTS: {JSON object or {}}
=== END DESIGN OUTPUT ===
```

Wait for the agent to complete. Parse the output between `=== DESIGN OUTPUT ===` and `=== END DESIGN OUTPUT ===`.

## Step 3a: For --new, resolve family and preview DESIGN.md

<!-- @cap-todo(ac:F-062/AC-3) DESIGN.md contains Aesthetic Family, Tokens, Components (Button + Card), Anti-Patterns -->
<!-- @cap-todo(ac:F-062/AC-7) Deterministic: same answers -> byte-identical output -->

```bash
node -e "
const d = require('./cap/bin/lib/cap-design.cjs');
const family = d.mapAnswersToFamily('{READ_HEAVY}', '{USER_TYPE}', '{COURAGE_FACTOR}');
const md = d.buildDesignMd({ family });
process.stdout.write(JSON.stringify({ familyKey: family.key, familyName: family.name, content: md }));
"
```

Store as `preview`.

Display:

```
Resolved aesthetic family: {preview.familyName} ({preview.familyKey})

--- DESIGN.md preview ---
{preview.content}
--- end preview ---
```

Use AskUserQuestion:
> "Write this DESIGN.md to project root? [yes / restart wizard / cancel]"

- `yes` — proceed to Step 4.
- `restart wizard` — loop back to Step 2.
- `cancel` — abort: `"cap:design cancelled. No file written."`

## Step 3b: For --extend, preview merge and confirm

<!-- @cap-todo(ac:F-062/AC-5) --extend appends without overwriting existing entries -->

```bash
node -e "
const d = require('./cap/bin/lib/cap-design.cjs');
const existing = d.readDesignMd(process.cwd());
const additions = { colors: {COLORS}, components: {COMPONENTS} };
const merged = d.extendDesignMd(existing, additions);
process.stdout.write(JSON.stringify({ changed: merged !== existing, content: merged }));
"
```

Store as `merge`.

If `merge.changed === false`:
Abort: `"Nothing new to add. Existing entries were kept unchanged."`

Display the diff summary (new lines only):

```
Additions:
{list of new color tokens added}
{list of new components added}
```

Use AskUserQuestion:
> "Merge these additions into DESIGN.md? [yes / cancel]"

- `yes` — proceed to Step 4.
- `cancel` — abort.

## Step 4: Write DESIGN.md

```bash
node -e "
const d = require('./cap/bin/lib/cap-design.cjs');
d.writeDesignMd(process.cwd(), {JSON.stringify(content_to_write)});
console.log('DESIGN.md written at project root.');
"
```

## Step 5: Update session state

```bash
node -e "
const session = require('./cap/bin/lib/cap-session.cjs');
session.updateSession(process.cwd(), {
  lastCommand: '/cap:design',
  lastCommandTimestamp: new Date().toISOString(),
  step: 'design-{mode}-complete'
});
"
```

## Step 6: Final report

```
cap:design complete.

Mode: {mode}
DESIGN.md: {new file / extended with N additions}
Aesthetic family: {family.name} ({family.key})   (only if mode === new)

Next steps:
  - Commit DESIGN.md alongside FEATURE-MAP.md
  - Run /cap:design --extend later to add more tokens/components
  - F-063 (pending) will add DT-NNN / DC-NNN IDs and feature traceability
```

</process>
