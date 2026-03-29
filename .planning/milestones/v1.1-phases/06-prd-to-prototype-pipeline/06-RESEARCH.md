# Phase 6: PRD-to-Prototype Pipeline - Research

**Researched:** 2026-03-29
**Domain:** Claude Code command orchestration, PRD parsing, autonomous agent iteration loop
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** PRD input follows a priority chain: `--prd <path>` flag first, then auto-detect `.planning/PRD.md`, then prompt user to paste content into chat. All three paths produce the same internal PRD content for downstream processing.
- **D-02:** PRD ingestion happens in the command orchestrator (`commands/gsd/prototype.md`), NOT in the gsd-prototyper agent. The agent receives PRD-enriched context via the Task() prompt. This keeps gsd-prototyper reusable and format-agnostic.
- **D-03:** After parsing the PRD, the command shows a numbered list of extracted acceptance criteria to the user. User must confirm before any code generation begins. Mandatory — no code path skips confirmation (except `--non-interactive` for CI).
- **D-04:** The confirmation output format: numbered list of ACs with brief descriptions. User responds "yes" to proceed or provides corrections.
- **D-05:** After initial prototype generation, the command enters an autonomous loop: extract-plan → iterate (plan+execute) → check completeness → repeat. Hard cap of 5 iterations.
- **D-06:** The loop stops when: (a) all @gsd-todo tags from PRD ACs are resolved, (b) hard cap reached, or (c) an unresolvable ambiguity is encountered (triggers user question).
- **D-07:** At each iteration, the command checks CODE-INVENTORY.md for remaining @gsd-todo tags. When count reaches zero (or only non-AC todos remain), the prototype is considered complete.
- **D-08:** Each acceptance criterion from the PRD becomes exactly one @gsd-todo tag in the prototype code. The tag includes `ref:AC-N` metadata linking back to the criterion number.
- **D-09:** The gsd-prototyper receives the parsed AC list as structured input in its Task() prompt, alongside existing PROJECT.md/REQUIREMENTS.md context.
- **D-10:** When `--interactive` flag is present, the autonomous loop pauses after each iteration. Shows: files changed, @gsd-todo count remaining, what was accomplished. User can continue, adjust direction, or stop.
- **D-11:** Default behavior (no flag) is fully autonomous — only stops for unresolvable ambiguities or hard cap.

### Claude's Discretion

- Exact prompt structure for passing PRD context to gsd-prototyper
- How to handle malformed or minimal PRDs (graceful degradation)
- Whether extract-plan runs after every iteration or only at loop boundaries
- Loop termination heuristics beyond @gsd-todo count

### Deferred Ideas (OUT OF SCOPE)

- PRD template scaffolding (`/gsd:prototype --init-prd`) — deferred to v1.2+
- Remote PRD URLs (Notion, Confluence links) — out of scope per REQUIREMENTS.md
- Review-to-iterate chain (`--fix` flag) — deferred to v1.2+
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PRD-01 | User can run /gsd:prototype with a PRD file auto-detected at .planning/PRD.md | D-01 priority chain; `fs.readFileSync` in Bash step before Task() spawn |
| PRD-02 | User can specify a PRD path via --prd flag | `parseNamedArgs(args, ['prd'], [])` — valueFlag pattern confirmed in gsd-tools.cjs |
| PRD-03 | User is prompted to paste PRD content if no file is found | AskUserQuestion tool in command; existing pattern in iterate.md approval gate |
| PRD-04 | Each acceptance criterion from the PRD becomes a @gsd-todo tag in prototype code | D-08; `@gsd-todo(ref:AC-N)` syntax follows arc-standard.md; gsd-prototyper receives AC list in Task() prompt |
| PRD-05 | Prototype iterates autonomously until functional, with a hard iteration cap | D-05/D-06/D-07; loop in command orchestrator; `extract-tags` count check between iterations |
| PRD-06 | User can enable step-by-step mode with --interactive flag | `parseNamedArgs(args, [], ['interactive'])` — booleanFlag pattern; loop pause uses AskUserQuestion |
| PRD-07 | User sees a requirements-found confirmation before scaffold generation begins | D-03/D-04; mandatory confirmation gate before Task() spawn to gsd-prototyper |
</phase_requirements>

---

## Summary

Phase 6 overhauls `commands/gsd/prototype.md` to add three new capabilities before the existing gsd-prototyper agent spawn: (1) PRD ingestion via a priority chain, (2) AC extraction and confirmation gate, and (3) an autonomous iteration loop that runs extract-plan + iterate until the prototype is complete. The gsd-prototyper agent is unchanged — all new logic lives in the command orchestrator following the established pattern from ARCHITECTURE.md.

The core technical challenge is the autonomous loop: it must check @gsd-todo count after each iteration, pause for --interactive mode, and terminate on hard cap (5) or zero remaining AC-linked todos. This is a new pattern in the command layer — no existing command does multi-step autonomous loops. The `iterate.md` inner loop logic (extract-plan → code-planner → executor) can be embedded inline rather than calling the slash-command, which avoids nested command invocation complexity.

PRD extraction is intentionally semantic rather than structural. The command instructs the AI to find all requirements regardless of format (prose, bullets, tables, user stories) and normalize them to a numbered list. This handles the PRD brittleness pitfall documented in PITFALLS.md Pitfall 16.

**Primary recommendation:** Treat prototype.md as the orchestrator for all three new behaviors. Embed the iteration loop inline (not by calling /gsd:iterate) to maintain atomic control flow. Pass the AC list as structured text in the Task() prompt to gsd-prototyper — no new agent or schema needed.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js built-ins | >=20.0.0 | File reads (PRD file, CODE-INVENTORY.md), Bash steps | Zero-dep constraint; already entire runtime surface |
| Claude Code `Task` tool | Current | Spawn gsd-prototyper agent with enriched context | All agent spawning in this codebase uses Task(); no alternative |
| Claude Code `Bash` tool | Current | Run extract-tags, count @gsd-todo lines in CODE-INVENTORY.md | Bash is the only tool for CLI execution in command files |
| `gsd-tools.cjs extract-tags` | Current | Generate CODE-INVENTORY.md after each prototype iteration | Already used in iterate.md and prototype.md step 3 |
| `parseNamedArgs()` | gsd-tools.cjs | Parse `--prd <path>`, `--interactive`, `--non-interactive` flags | The project's standard flag-parsing function; no alternatives |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Claude Code `Read` tool | Current | Read PRD file content in command orchestrator | When --prd path provided or .planning/PRD.md auto-detected |
| Claude Code `AskUserQuestion` | Current | AC confirmation gate; --interactive pause points | All human confirmation gates in this codebase use this pattern |
| `arc-standard.md` | v1.0 | Tag syntax reference for @gsd-todo(ref:AC-N) format | gsd-prototyper reads this; command ensures AC tags conform |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline loop in prototype.md | Call /gsd:iterate in a loop | Calling slash-commands from slash-commands is not a supported pattern; inline is the established approach (iterate.md embeds all steps inline) |
| Semantic AC extraction in orchestrator | Structural regex parser for PRD | Semantic handles all PRD formats; regex requires template compliance (Pitfall 16 prevention) |
| AskUserQuestion for PRD paste | File-based stdin | AskUserQuestion is the established interaction pattern; no stdin mechanism exists in Claude Code commands |

**Installation:** No new packages required. Zero-dep constraint maintained.

---

## Architecture Patterns

### File Modified: `commands/gsd/prototype.md`

The entire implementation lives in one file — the command descriptor. No new files are needed for Phase 6. The gsd-prototyper agent (`agents/gsd-prototyper.md`) is unchanged.

### Recommended Structure for `prototype.md` (v1.1 process section)

```
<process>

Step 0: Parse flags
  - Parse --prd, --interactive, --non-interactive, --phases from $ARGUMENTS

Step 1: Resolve PRD content
  - If --prd <path>: read file
  - Else if .planning/PRD.md exists: read it (auto-detect)
  - Else: AskUserQuestion "No PRD found. Paste your PRD content:"
  - All three paths → prd_content variable

Step 2: Extract acceptance criteria
  - Instruct AI to extract all ACs from prd_content (semantic, not structural)
  - Normalize to: AC-1: description, AC-2: description, ...
  - Handles prose, bullets, tables, user stories

Step 3: Confirmation gate
  - Display numbered AC list to user
  - AskUserQuestion: "Found N acceptance criteria. Proceed? [yes/corrections]"
  - If corrections: loop back to Step 2 with user feedback
  - If --non-interactive: auto-approve, log "Auto-approving N ACs"

Step 4: Spawn gsd-prototyper (first pass)
  - Task() with: $ARGUMENTS + prd_context (AC list as structured text)
  - gsd-prototyper creates scaffold with @gsd-todo(ref:AC-N) tags
  - Wait for completion

Step 5: Run extract-tags
  - gsd-tools extract-tags → .planning/prototype/CODE-INVENTORY.md
  - Count AC-linked @gsd-todo tags (lines matching `ref:AC-`)

Step 6: Autonomous iteration loop (max 5 iterations)
  - Check: remaining AC todos = 0 → done
  - Run inner loop: extract-plan → gsd-code-planner → auto-approve → executor
  - Run extract-tags, recount AC todos
  - If --interactive: pause, show progress, AskUserQuestion to continue/stop/redirect
  - Increment counter; if counter == 5 → stop with summary
  - Repeat

Step 7: Final report
  - Files created/modified
  - ACs resolved vs total
  - Remaining @gsd-todos (if any)
  - Iteration count used
  - Paths to PROTOTYPE-LOG.md and CODE-INVENTORY.md

</process>
```

### Pattern 1: Flag Parsing in Command Orchestrators

**What:** Use `parseNamedArgs()` from gsd-tools.cjs by passing the flag names and letting the Bash step return the values. In command `.md` files, flags are parsed by referencing `$ARGUMENTS` directly — the command file itself doesn't call `parseNamedArgs()` directly; instead the orchestration logic checks for `--prd`, `--interactive` presence in `$ARGUMENTS`.

**When to use:** All new flags follow this pattern. For `--prd` (value flag), check `$ARGUMENTS` for `--prd` and read the next token as the path. For `--interactive` (boolean flag), check for presence of `--interactive` in `$ARGUMENTS`.

**Example — checking for --prd in command prose:**
```markdown
Check if `--prd` is present in `$ARGUMENTS`.

**If `--prd <path>` IS present:**
Read the file at `<path>` using the Read tool.

**If `--prd` is NOT present:**
Check if `.planning/PRD.md` exists using Bash:
```bash
test -f .planning/PRD.md && echo "exists" || echo "missing"
```
```

This matches exactly how `iterate.md` checks `--non-interactive` and `--verify`.

### Pattern 2: AC Extraction Prompt Structure

**What:** In Step 2, the command asks the AI to extract ACs semantically. The prompt structure that handles format variance:

```
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
```

This semantic extraction handles Pitfall 16 (PRD brittleness). The normalization to imperative form makes each AC directly mappable to a @gsd-todo.

### Pattern 3: AC-to-Tag Format

**What:** Each AC becomes a @gsd-todo with `ref:AC-N` metadata. This follows arc-standard.md conventions exactly.

**Example:**
```javascript
// @gsd-todo(ref:AC-1) User can run /gsd:prototype with a PRD file auto-detected at .planning/PRD.md
// @gsd-todo(ref:AC-3, priority:high) User is prompted to paste PRD content if no file is found
```

The `ref:AC-N` metadata key follows the existing `ref:` convention used in `@gsd-ref` and `@gsd-risk` tags throughout the ARC standard.

### Pattern 4: Iteration Loop Completeness Check

**What:** After each extract-tags run, count remaining AC-linked todos by grepping CODE-INVENTORY.md:

```bash
AC_REMAINING=$(grep -c "ref:AC-" .planning/prototype/CODE-INVENTORY.md 2>/dev/null || echo "0")
```

Zero AC_REMAINING = loop exit condition (D-07). Non-zero todos without `ref:AC-` are non-PRD todos and do not block completion.

### Pattern 5: Inner Loop Embedding (vs. calling /gsd:iterate)

**What:** The autonomous loop runs extract-plan → code-planner → executor inline within prototype.md. This is the same pattern used by iterate.md — all steps are inline, not delegated to other slash-commands.

**Why:** Claude Code slash-commands cannot reliably call other slash-commands in a loop. Embedding the inner loop steps directly gives the orchestrator full control over loop exit conditions and --interactive pause points.

**Inner loop steps per iteration:**
1. `gsd-tools extract-tags` → refresh CODE-INVENTORY.md
2. Spawn `gsd-code-planner` via Task() with CODE-INVENTORY.md as input
3. Auto-approve plan (prototype loop always uses --non-interactive inner loop behavior)
4. Spawn executor (gsd-arc-executor or gsd-executor based on arc.enabled, same check as iterate.md step 4)
5. Re-run extract-tags, count AC-linked todos

### Anti-Patterns to Avoid

- **Skipping the confirmation gate in non-CI contexts:** D-03 is mandatory. The `--non-interactive` flag is the only bypass, and it must log "Auto-approving N ACs" explicitly.
- **PRD parsing inside gsd-prototyper:** D-02 is locked. All PRD ingestion stays in the command. The agent receives a clean AC list in the Task() prompt.
- **Calling /gsd:iterate as a subprocess:** Slash-commands are not composable via subprocess calls. Embed the inner loop inline.
- **Using structural regex to parse PRD:** Pitfall 16 prevention. Semantic extraction handles all PRD formats.
- **Open-ended iteration without cap:** Pitfall 12 prevention. Hard cap at 5 (D-05).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Flag parsing | Custom arg parser in command prose | `parseNamedArgs()` via Bash | Already handles value flags and boolean flags; used by all other commands |
| @gsd-todo counting | Line-count regex from scratch | `grep -c "ref:AC-"` on CODE-INVENTORY.md | Single grep is sufficient; extract-tags already structures the output |
| Agent spawning | Direct file writes or API calls | `Task()` tool | The established agent-spawn mechanism; no alternative exists |
| Human input prompts | Custom readline/stdin flow | `AskUserQuestion` tool | The only interactive input mechanism in Claude Code commands |
| ARC tag validation | Custom validator | Follow arc-standard.md syntax exactly | Standard is versioned and stable; no validator needed |

**Key insight:** Every component needed for Phase 6 already exists in the codebase. The implementation is purely orchestration — wiring together existing primitives (parseNamedArgs, Task(), Bash, extract-tags, AskUserQuestion) in a new sequence within prototype.md.

---

## Common Pitfalls

### Pitfall 1: Loop Divergence (Pitfall 12 in PITFALLS.md)
**What goes wrong:** Autonomous loop produces contradictory implementations and never converges.
**Why it happens:** Agent lacks memory of prior attempts; vague ACs produce ambiguous "done" states.
**How to avoid:** Hard cap at 5 iterations (D-05). Define completion as zero AC-linked `@gsd-todo` tags (D-07) — a concrete, checkable exit condition, not a vague quality assessment. Track iteration count as a visible counter in PROTOTYPE-LOG.md.
**Warning signs:** Loop runs 3+ iterations without AC_REMAINING decreasing. Same requirement appears implemented and todo simultaneously in different files.

### Pitfall 2: PRD Parsing Brittleness (Pitfall 16 in PITFALLS.md)
**What goes wrong:** Structural parsing misses requirements in non-template PRDs; prototype silently implements 60% of requirements.
**Why it happens:** Fixed-section parsers fail when PRD uses different headings, prose format, or table format.
**How to avoid:** Use semantic extraction (Pattern 2 above). Show extracted AC list to user for confirmation (D-03/D-04) — this is the safety net for missed requirements. User can correct before any code is generated.
**Warning signs:** AC count from extraction is suspiciously low relative to PRD length. Prose paragraphs in PRD don't appear in AC list.

### Pitfall 3: Confirmation Gate Bypass
**What goes wrong:** Code generation starts before user confirms ACs; user discovers wrong requirements were implemented after full prototype generation.
**Why it happens:** Developer treats confirmation as optional UX, adds a fast-path that skips it.
**How to avoid:** D-03 is an absolute constraint. Only `--non-interactive` bypasses the gate, and that bypass logs explicitly. No silent skip.
**Warning signs:** Command documentation shows confirmation as optional. Code path reaches Task() spawn before AskUserQuestion completes.

### Pitfall 4: Calling /gsd:iterate as a Subprocess
**What goes wrong:** Prototype.md tries to invoke `/gsd:iterate` in a loop; the call mechanism doesn't support looping slash-commands; loop exits unexpectedly.
**Why it happens:** Reasonable attempt to reuse iterate.md's logic without duplication.
**How to avoid:** Embed the inner loop steps inline in prototype.md following iterate.md's own pattern. The iterate.md inner steps are short and self-contained — copy, don't call.
**Warning signs:** Process steps in prototype.md say "run /gsd:iterate" rather than listing individual steps.

### Pitfall 5: Missing `ref:AC-N` Tag on AC-Linked Todos
**What goes wrong:** gsd-prototyper generates @gsd-todo tags without `ref:AC-N` metadata; the completeness check (grep for "ref:AC-") never finds them; loop exits immediately with "complete" on first iteration even though ACs aren't implemented.
**Why it happens:** The prototyper wasn't explicitly instructed to include `ref:AC-N` in each AC-derived todo. The agent defaults to generic @gsd-todo syntax.
**How to avoid:** The Task() prompt to gsd-prototyper must explicitly specify: "For each acceptance criterion listed below, create exactly one @gsd-todo tag with `ref:AC-N` metadata where N is the criterion number." Include a concrete example.
**Warning signs:** CODE-INVENTORY.md has @gsd-todo entries with no `ref:` metadata after first prototype pass. AC_REMAINING = 0 immediately after first iteration.

### Pitfall 6: --interactive Mode Without Meaningful Progress Display
**What goes wrong:** --interactive pauses after each iteration but shows only "continue? yes/no" without context; user can't make an informed decision.
**Why it happens:** Pause point added without sufficient context display.
**How to avoid:** D-10 specifies the pause output: files changed, @gsd-todo count remaining, what was accomplished. Pull these from the most recent extract-tags output and executor summary.
**Warning signs:** Pause prompt shows no iteration progress statistics.

---

## Code Examples

Verified patterns from existing codebase:

### Flag Parsing Pattern (from iterate.md)
```markdown
Check if `--non-interactive` is present in `$ARGUMENTS`.

**If `--non-interactive` IS present:**
Log: "Auto-approving plan (--non-interactive mode)." and proceed to step 4.

**If `--non-interactive` is NOT present:**
[show approval gate]
```
Source: `commands/gsd/iterate.md` lines 69-82

### ARC Executor Selection Pattern (from iterate.md)
```bash
ARC_ENABLED=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" config-get arc.enabled 2>/dev/null || echo "true")
```
Source: `commands/gsd/iterate.md` lines 88-93

### extract-tags Command (from prototype.md and iterate.md)
```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" extract-tags --format md --output .planning/prototype/CODE-INVENTORY.md
```
Source: `commands/gsd/prototype.md` step 3, `commands/gsd/iterate.md` step 1

### @gsd-todo with ref metadata (arc-standard.md syntax)
```javascript
// @gsd-todo(ref:AC-1, priority:high) User can run /gsd:prototype with --prd flag
// @gsd-todo(ref:AC-3) User is prompted to paste PRD content if no file found
```
Source: `get-shit-done/references/arc-standard.md` tag syntax rules

### AC Remaining Count Check
```bash
AC_REMAINING=$(grep -c "ref:AC-" .planning/prototype/CODE-INVENTORY.md 2>/dev/null || echo "0")
echo "AC todos remaining: $AC_REMAINING"
```
This is a novel pattern derived from existing grep usage in the codebase. Confidence: HIGH (grep -c is standard; the `ref:AC-` prefix pattern follows from D-08 decision).

### Task() Prompt Enrichment Pattern (from ARCHITECTURE.md)
```markdown
Spawn the `gsd-prototyper` agent via the Task tool with the following context:

- Standard context: $ARGUMENTS, PROJECT.md, REQUIREMENTS.md, ROADMAP.md
- PRD context: [paste the full AC list here]

**Acceptance criteria to implement as @gsd-todo tags:**
AC-1: [description]
AC-2: [description]
...

For each AC above, create exactly one @gsd-todo tag with `ref:AC-N` metadata in the prototype code.
Example: `// @gsd-todo(ref:AC-1) [description]`
```
Source: Pattern derived from `ARCHITECTURE.md` PRD-to-Prototype Data Flow section + D-08/D-09 decisions

---

## State of the Art

| Old Behavior | v1.1 Behavior | When Changed | Impact |
|--------------|---------------|--------------|--------|
| /gsd:prototype spawns gsd-prototyper immediately | /gsd:prototype: resolve PRD → extract ACs → confirm → spawn → iterate loop | Phase 6 | Command is now a full pipeline, not a single agent spawn |
| No PRD awareness | Three-way PRD resolution (--prd, auto-detect, paste) | Phase 6 | prototype is now the project entry point for PRD-driven development |
| Prototype is one-shot | Autonomous loop iterates until ACs resolve (max 5) | Phase 6 | Prototype self-completes rather than requiring manual /gsd:iterate calls |
| No --interactive flag | --interactive pauses loop after each iteration | Phase 6 | Escape hatch for users wanting oversight without full manual control |

**Backward compatibility:** All existing behavior is preserved. `--phases N` still works. `$ARGUMENTS` still flows through to gsd-prototyper. The new steps only execute when PRD content is present (either from flag, auto-detect, or paste). A prototype.md invocation with no PRD and no .planning/PRD.md will fall through to AskUserQuestion for paste, preserving the spirit of the original interactive flow.

---

## Open Questions

1. **Should the inner loop auto-approve plans or use gsd-code-planner's approval gate?**
   - What we know: D-05 says "autonomous loop" with inner "extract-plan → iterate (plan+execute)"; D-11 says default is "fully autonomous."
   - What's unclear: Whether each inner plan requires approval (like iterate.md's step 3) or is auto-approved as part of autonomous mode.
   - Recommendation: Auto-approve inner plans unconditionally (like iterate.md with --non-interactive). The outer confirmation gate (D-03) already captured user intent. Inner plan approval would interrupt the autonomous flow. --interactive mode gives per-iteration oversight at the outer loop level, which is sufficient.

2. **How does the command handle PRD paste when the user provides a long document?**
   - What we know: AskUserQuestion is the paste mechanism; Claude Code supports multi-line responses.
   - What's unclear: There is no documented size limit for AskUserQuestion responses in Claude Code.
   - Recommendation: Treat as unlimited. If the pasted content is very long (>5000 chars), the command should confirm "Received N characters of PRD content" before proceeding so the user knows it was captured.

3. **Should `--non-interactive` bypass both the AC confirmation gate AND the loop pause points?**
   - What we know: D-03 says `--non-interactive` bypasses confirmation. D-10 says `--interactive` enables loop pauses. D-11 says default is autonomous (no loop pauses).
   - What's unclear: Is `--non-interactive` needed at all if the default is already autonomous? Or is it only for the AC confirmation gate?
   - Recommendation: `--non-interactive` specifically bypasses the AC confirmation gate. Without it, the gate always appears. The loop is always autonomous unless `--interactive` is present. These are two separate behavior axes: gate bypass (--non-interactive) and loop pause (--interactive).

---

## Environment Availability

Step 2.6: SKIPPED (no external dependencies identified — Phase 6 is purely command file modification using existing gsd-tools.cjs and Claude Code built-in tools)

---

## Sources

### Primary (HIGH confidence)
- `commands/gsd/prototype.md` — Current command structure; all new steps extend this file (directly read)
- `commands/gsd/iterate.md` — Inner loop pattern (extract → plan → approve → execute); flag-parsing patterns (directly read)
- `agents/gsd-prototyper.md` — Agent capabilities and constraints; confirmed unchanged per D-02 (directly read)
- `.planning/phases/06-prd-to-prototype-pipeline/06-CONTEXT.md` — All locked decisions (directly read)
- `.planning/research/ARCHITECTURE.md` — v1.1 component map, data flow, build order (directly read)
- `.planning/research/PITFALLS.md` — Loop divergence (Pitfall 12), PRD brittleness (Pitfall 16) (directly read)
- `get-shit-done/references/arc-standard.md` — Tag syntax, `ref:` metadata convention, @gsd-todo format (directly read)
- `get-shit-done/bin/gsd-tools.cjs` lines 160-195 — `parseNamedArgs()` implementation confirmed (directly read)
- `.planning/config.json` — `nyquist_validation: false` confirmed (directly read)

### Secondary (MEDIUM confidence)
- `.planning/REQUIREMENTS.md` — PRD-01 through PRD-07 requirement definitions (directly read)
- `.planning/STATE.md` — Phase context, accumulated decisions (directly read)
- `CLAUDE.md` — Zero-dep constraint, node:test testing requirement, JavaScript/Node.js stack constraint (directly read via system context)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all tools are confirmed present in the codebase; no new dependencies needed
- Architecture patterns: HIGH — all patterns derived directly from reading existing command files; no inference required
- Pitfalls: HIGH (loop/PRD pitfalls) — sourced directly from project PITFALLS.md which is based on production experience; MEDIUM (confirmation gate bypass) — derived from design decisions
- Implementation sequence: HIGH — determined by D-01 through D-11 locked decisions; no discretion remains on sequencing

**Research date:** 2026-03-29
**Valid until:** 2026-04-28 (30 days — stable domain, no fast-moving external libraries)
