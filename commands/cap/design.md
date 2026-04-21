---
name: cap:design
description: Design system bootstrap. Runs a 3-question aesthetic wizard (--new), extends DESIGN.md (--extend), or scopes design usage to a feature (--scope F-NNN). Spawns cap-designer agent. Deterministic, idempotent.
argument-hint: "[--new | --extend | --scope F-NNN]"
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
<!-- @cap-feature(feature:F-063) cap:design --scope — Feature-scoped design usage dialog -->

<objective>
<!-- @cap-todo(ac:F-062/AC-1) /cap:design --new spawns cap-designer for greenfield design setup -->
<!-- @cap-todo(ac:F-063/AC-4) /cap:design --scope F-NNN spawns cap-designer in scope-mode: agent asks which tokens/components F-NNN uses, updates uses-design in FEATURE-MAP.md, and creates missing DT/DC entries in DESIGN.md. -->

Spawns `cap-designer` in one of three modes:
- `--new` — run the 3-question aesthetic wizard, write DESIGN.md.
- `--extend` — append tokens/components to existing DESIGN.md (no overwrite).
- `--scope F-NNN` — feature-scoped dialog: record which DT/DC IDs the feature uses in FEATURE-MAP.md.

**Flags:**
- `--new` — fresh DESIGN.md via wizard (refuses to overwrite an existing DESIGN.md without explicit confirm).
- `--extend` — append tokens/components to an existing DESIGN.md (does not overwrite existing entries).
- `--scope F-NNN` — opens a focused dialog, writes `**Uses design:**` line to FEATURE-MAP.md, creates any missing DT/DC entries in DESIGN.md.

**Key guarantees:**
- Idempotent: same wizard answers produce a byte-identical DESIGN.md (AC-7).
- Append-only on `--extend`: existing entries are never overwritten (AC-5).
- Anti-Slop constraints surfaced in every generated DESIGN.md (AC-6).
- Stable-ID guarantee (F-063/D4): once a DT-NNN / DC-NNN is assigned, it is never renumbered.

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
- `--scope F-NNN` -- set `mode = "scope"` and capture `scope_feature_id` (must match `F-\d{3}`)

If none of the flags is present, default to `--new` but prompt for confirmation if DESIGN.md already exists (see Step 1).

Log: `cap:design | mode: {mode}`{ " | feature: " + scope_feature_id if mode === 'scope' }

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

- `mode === "scope"` AND `design_state.exists === false`:
  Abort: `"No DESIGN.md found. Run /cap:design --new first, then /cap:design --scope F-NNN."`

## Step 1b: Scope-mode fast-path (F-063)

<!-- @cap-todo(ac:F-063/AC-4) --scope F-NNN opens a focused dialog: which tokens/components does F-NNN use? -->

If `mode === "scope"`, run the scope flow and skip Steps 2-4.

### 1b.1 Validate the feature ID

```bash
node -e "
const fm = require('./cap/bin/lib/cap-feature-map.cjs');
const fid = process.argv[1];
if (!/^F-\\d{3}$/.test(fid)) {
  console.error('Invalid feature ID. Expected format F-NNN.');
  process.exit(2);
}
const map = fm.readFeatureMap(process.cwd());
const f = map.features.find(x => x.id === fid);
if (!f) {
  console.error('Feature ' + fid + ' not found in FEATURE-MAP.md.');
  process.exit(3);
}
console.log(JSON.stringify({ id: f.id, title: f.title, state: f.state, usesDesign: f.usesDesign || [] }));
" '<FEATURE_ID>'
```

Store as `scope_feature`.

### 1b.2 Parse existing DESIGN.md IDs

```bash
node -e "
const d = require('./cap/bin/lib/cap-design.cjs');
const md = d.readDesignMd(process.cwd());
const ids = d.parseDesignIds(md || '');
console.log(JSON.stringify({
  tokens: Object.values(ids.byToken).map(t => ({ id: t.id, key: t.key })),
  components: Object.values(ids.byComponent).map(c => ({ id: c.id, name: c.name })),
}));
"
```

Store as `design_catalog`.

### 1b.3 Spawn cap-designer in scope mode

Spawn `cap-designer` via Task with:

```
**Mode:** scope
**Feature:** {scope_feature.id} — {scope_feature.title}
**Currently declared uses-design:** {scope_feature.usesDesign.join(', ') or '(none)'}
**Available tokens:** {design_catalog.tokens map as "DT-001 primary", ...}
**Available components:** {design_catalog.components map as "DC-001 Button", ...}

**Instructions (scope mode):**
- Ask which tokens the feature uses. Offer the existing DT list as options plus "add new".
- Ask which components the feature uses. Offer the existing DC list plus "add new".
- For each "add new", collect name + (for tokens: hex value; for components: variants + states).
- Do NOT write files. Return structured output.

**Return format:**

=== SCOPE OUTPUT ===
FEATURE_ID: F-NNN
USES_DESIGN: DT-001, DC-001, ...
NEW_TOKENS: {JSON object of name -> hex, or {}}
NEW_COMPONENTS: {JSON object of name -> {variants, states}, or {}}
=== END SCOPE OUTPUT ===
```

Parse the returned block. Store `uses_design`, `new_tokens`, `new_components`.

### 1b.4 Append new DT/DC entries to DESIGN.md (if any)

If `new_tokens` or `new_components` is non-empty, extend DESIGN.md with IDs enabled:

```bash
node -e "
const d = require('./cap/bin/lib/cap-design.cjs');
const existing = d.readDesignMd(process.cwd());
const adds = { colors: {NEW_TOKENS}, components: {NEW_COMPONENTS} };
const merged = d.extendDesignMd(existing, adds, { withIds: true });
if (merged !== existing) {
  d.writeDesignMd(process.cwd(), merged);
  console.log('DESIGN.md extended with new tokens/components (IDs assigned).');
} else {
  console.log('No new tokens/components to add.');
}
"
```

Then re-parse DESIGN.md to capture the IDs of the freshly added entries and append them to `uses_design`.

### 1b.5 Write `**Uses design:**` line to FEATURE-MAP.md

```bash
node -e "
const fm = require('./cap/bin/lib/cap-feature-map.cjs');
const ids = JSON.parse(process.argv[2]);
const ok = fm.setFeatureUsesDesign(process.cwd(), process.argv[1], ids);
console.log(ok ? 'FEATURE-MAP.md updated.' : 'Feature not found — no write.');
" '<FEATURE_ID>' '<USES_DESIGN_JSON_ARRAY>'
```

### 1b.6 Final report

```
cap:design --scope complete.

Feature:         {scope_feature.id} — {scope_feature.title}
Uses design:     {uses_design.join(', ') or '(none)'}
New DT entries:  {list}
New DC entries:  {list}

Next steps:
  - Add @cap-design-token(id:DT-NNN) / @cap-design-component(id:DC-NNN) tags in the feature's source files
  - Run /cap:scan to auto-populate uses-design from tags
  - Run /cap:deps --design DT-NNN to see impact
```

Stop here. Do not run Steps 2-4.

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
