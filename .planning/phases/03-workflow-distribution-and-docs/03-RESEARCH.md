# Phase 3: Workflow, Distribution, and Docs - Research

**Researched:** 2026-03-28
**Domain:** Claude Code slash commands, npm installer patterns, gsd-tools.cjs CLI routing, config.cjs schema
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** `iterate` command defined in `commands/gsd/iterate.md` -- orchestrates the full code-first loop: extract-tags -> gsd-code-planner -> approval gate -> executor
- **D-02:** Default behavior: interactive approval gate that pauses to show the generated plan and waits for user approval/rejection before execution
- **D-03:** `--non-interactive` flag auto-approves the plan for CI/headless pipelines (per ITER-03)
- **D-04:** `--verify` flag runs verification after executor completes (per ITER-02)
- **D-05:** `--annotate` flag runs gsd-annotator to refresh @gsd-tags after executor completes (per ITER-02)
- **D-06:** iterate chains steps sequentially: each step's output feeds the next. If any step fails, iterate stops and reports the failure.
- **D-07:** `set-mode` command defined in `commands/gsd/set-mode.md` -- writes to config.json `default_phase_mode` or `phase_modes[N]` (per MODE-01)
- **D-08:** Accepts `code-first`, `plan-first`, or `hybrid` as mode values
- **D-09:** Per-phase override: `set-mode code-first --phase 3` sets mode for a specific phase
- **D-10:** Active mode is visible at command startup -- gsd-tools.cjs shows current mode in status output
- **D-11:** `deep-plan` command defined in `commands/gsd/deep-plan.md` -- chains discuss-phase then plan-phase for phases needing upfront reasoning (per MODE-03)
- **D-12:** Passes through phase number and any flags to both commands
- **D-13:** `bin/install.js` updated to copy all new agent files: gsd-prototyper.md, gsd-code-planner.md, gsd-arc-executor.md, gsd-arc-planner.md
- **D-14:** `bin/install.js` updated to copy all new command files: prototype.md, iterate.md, set-mode.md, deep-plan.md
- **D-15:** Installer markers use `GSD_CF_` namespace prefix (e.g., `GSD_CF_PROTOTYPER`, `GSD_CF_CODE_PLANNER`) to avoid conflicts with upstream GSD installations (per DIST-03)
- **D-16:** `package.json` already has name `gsd-code-first` and bin entry `get-shit-done-cc` pointing to `bin/install.js` -- verify and update version if needed (per DIST-02)
- **D-17:** Help output updated to list all new commands: prototype, iterate, annotate, extract-plan, set-mode, deep-plan (per DOCS-01)
- **D-18:** Each command entry includes a one-line description
- **D-19:** README.md documents installation (`npx gsd-code-first@latest`), the code-first workflow, and quick-start examples (per DOCS-02)
- **D-20:** User guide (separate section in README or standalone file) explains ARC tags, prototype -> iterate workflow, mode switching, and when to use code-first vs plan-first vs hybrid (per DOCS-03)
- **D-21:** Documentation references arc-standard.md for detailed tag syntax rather than duplicating it

### Claude's Discretion

- Exact step-by-step orchestration within iterate command (how to chain agent spawns)
- set-mode command output formatting
- deep-plan flag passthrough implementation
- README.md structure and section ordering
- User guide depth and examples
- How help command discovers and lists available commands

### Deferred Ideas (OUT OF SCOPE)

None -- discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ITER-01 | iterate command runs the full loop: extract-tags → code-planner → user approval gate → executor | annotate.md + prototype.md command patterns provide the Task spawn + bash auto-chain template |
| ITER-02 | iterate command supports --verify and --annotate flags | parseNamedArgs() booleanFlags pattern for flag handling; conditional bash steps post-executor |
| ITER-03 | Approval gate pauses for human review before execution (headless-capable for CI) | AskUserQuestion tool for interactive gate; --non-interactive boolean flag via parseNamedArgs() skips it |
| MODE-01 | set-mode command configures per-phase workflow mode (code-first, plan-first, hybrid) | config.cjs cmdConfigSet + VALID_CONFIG_KEYS already includes default_phase_mode and phase_modes.default |
| MODE-03 | deep-plan command wraps discuss-phase + plan-phase for phases needing upfront reasoning | SlashCommand chaining pattern; flag passthrough via $ARGUMENTS |
| DIST-01 | bin/install.js copies all new agent files and command files during installation | Installer already copies all files from agents/ and commands/gsd/ wholesale -- no per-file registration needed |
| DIST-02 | package.json updated with name "gsd-code-first" and correct bin entry | Already correct: name=gsd-code-first, bin.get-shit-done-cc=bin/install.js, version=2.0.0-alpha.1 |
| DIST-03 | Installer markers use GSD_CF_ namespace prefix to avoid conflicts with upstream | Marker namespace is in agent file content (description field, comments) -- installer copies files as-is; no code change needed in install.js for file copy behavior |
| DOCS-01 | help command updated to list all new commands with descriptions | help.md references get-shit-done/workflows/help.md -- update that workflow file with new commands |
| DOCS-02 | README.md documents the code-first workflow and installation | Existing README.md is 846 lines for upstream GSD; fork needs a new section or replacement header |
| DOCS-03 | User guide explains ARC tags, prototype → iterate workflow, and mode switching | arc-standard.md exists at get-shit-done/references/arc-standard.md as the canonical tag reference |
</phase_requirements>

---

## Summary

Phase 3 wires together everything built in Phases 1 and 2 into a shippable product. The work divides into four implementation areas: (1) the `iterate` command (flagship workflow orchestrator), (2) two lightweight config/utility commands (`set-mode`, `deep-plan`), (3) installer verification (no new code needed -- the installer already copies wholesale), and (4) documentation (README.md overhaul + help.md update).

The highest-complexity task is the `iterate` command. It must chain five operations (extract-tags, gsd-code-planner spawn, approval gate, executor spawn, optional verify/annotate), handle failure at each step, and support both interactive and CI modes. The pattern established in `annotate.md` (Task spawn + bash auto-chain) is the direct template. The approval gate is the novel element -- it requires the `AskUserQuestion` tool or a bash `read` prompt.

Documentation work is straightforward but non-trivial: the README.md is currently upstream GSD's 846-line file. The fork needs a new installation section (`npx gsd-code-first@latest`), a code-first workflow section, and a user guide. The canonical approach is to prepend a fork-specific section and preserve the upstream GSD content below, or replace the header only. The `get-shit-done/workflows/help.md` file needs a new "Code-First Commands" section added.

**Primary recommendation:** Build `iterate.md` first (most complex, blocks demo value), then `set-mode.md` and `deep-plan.md` (trivial), then verify DIST-01/02/03 (installer needs no code changes), then documentation.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js built-ins | >=20.0.0 | File I/O, path ops, readline for approval gate | Zero external deps constraint |
| Native RegExp | ES2018 | Flag parsing in bash commands | Already the pattern in gsd-tools.cjs |
| `parseNamedArgs()` | Existing in gsd-tools.cjs | Boolean/value flag parsing for --non-interactive, --verify, --annotate | All 63 case branches use this helper |
| Task tool (Claude Code) | Current | Spawn gsd-code-planner, gsd-arc-executor, gsd-annotator as subagents | All agent spawns in the codebase use this |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `AskUserQuestion` tool | Claude Code built-in | Interactive approval gate in iterate | When --non-interactive is not set |
| `SlashCommand` tool | Claude Code built-in | Chain /gsd:discuss-phase → /gsd:plan-phase in deep-plan | deep-plan chaining pattern |
| `config-set` (gsd-tools.cjs) | Existing | Write mode values to config.json in set-mode | set-mode already has this infrastructure |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| AskUserQuestion for approval gate | Bash `read` prompt | AskUserQuestion is Claude-native and cleaner; bash read requires terminal stdin which may not be available in all CI contexts |
| SlashCommand for deep-plan chaining | Task tool to spawn a meta-agent | SlashCommand is lighter; Task is for agent spawns not command chains |

**Installation:** No new packages. Zero external deps constraint is maintained.

---

## Architecture Patterns

### Command File Structure (All New Commands Follow This)

```
commands/gsd/
├── iterate.md       # Task spawn (code-planner + executor) + approval gate + bash chain
├── set-mode.md      # Bash call to gsd-tools.cjs config-set + display current mode
└── deep-plan.md     # SlashCommand chain: discuss-phase → plan-phase
```

### Pattern 1: Agent Spawn + Auto-Chain (iterate follows annotate.md exactly)

**What:** Command spawns a subagent via Task tool, waits for completion, then runs a bash command to produce the next artifact.

**When to use:** Any command that orchestrates an agent and needs a follow-up step.

**Example from `commands/gsd/annotate.md`:**
```markdown
1. Spawn gsd-annotator agent via the Task tool, passing $ARGUMENTS as context.

2. Wait for gsd-annotator to complete.

3. Auto-run extract-plan:
   ```bash
   node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" extract-tags --format md --output .planning/prototype/CODE-INVENTORY.md
   ```
```

The `iterate` command extends this by chaining TWO Task spawns (code-planner → executor) with an approval gate between them.

### Pattern 2: Config-Set Command (set-mode follows this)

**What:** Command reads current config, validates input, writes to config.json via gsd-tools.cjs `config-set`, then displays result.

**Key detail:** `VALID_CONFIG_KEYS` in `config.cjs` already includes `default_phase_mode` and `phase_modes.default`. However, per-phase mode keys like `phase_modes.3` (for phase 3) are NOT in VALID_CONFIG_KEYS. The `isValidConfigKey()` function has a dynamic pattern for `agent_skills.<agent-type>` but not for `phase_modes.<N>`. This means set-mode with `--phase N` cannot use the existing `config-set` subcommand -- it must either:
  - Add `phase_modes.<N>` pattern to VALID_CONFIG_KEYS regex, OR
  - Call `setConfigValue()` directly (bypassing VALID_CONFIG_KEYS validation)

**Recommended approach:** Add a `phase_modes.<N>` dynamic pattern to `isValidConfigKey()` matching `/^phase_modes\.\d+$/` -- the same pattern used for `agent_skills.<agent-type>`. This is a 1-line additive change to config.cjs.

**Example from config.cjs:**
```javascript
// Existing dynamic pattern (line 41):
if (/^agent_skills\.[a-zA-Z0-9_-]+$/.test(keyPath)) return true;

// Add alongside it:
if (/^phase_modes\.\d+$/.test(keyPath)) return true;
```

### Pattern 3: Slash Command Chain (deep-plan follows this)

**What:** Command instructs the agent to invoke two slash commands in sequence, passing `$ARGUMENTS` through.

**When to use:** When the command is purely a composition of existing commands with no new logic.

**Example for deep-plan.md:**
```markdown
1. Run /gsd:discuss-phase with $ARGUMENTS
2. After discuss-phase completes, run /gsd:plan-phase with $ARGUMENTS
```

### Pattern 4: Installer File Copy (no changes needed for DIST-01)

**What:** The installer at `bin/install.js` copies ALL files from `agents/` and ALL files from `commands/gsd/` wholesale during installation (lines 4204-4256, 4180-4192). New agent and command files are picked up automatically by virtue of existing in those directories.

**Confirmed at lines 4220-4251:** The installer does `fs.readdirSync(agentsSrc, { withFileTypes: true })` and copies every `.md` file. No per-file registration is needed.

**When to use:** Just create the files in the correct directory. The installer handles the rest.

**Key implication for DIST-01:** No code change to `bin/install.js` is required for Phase 3's new files. The new files (`iterate.md`, `set-mode.md`, `deep-plan.md` in commands/gsd/, and any new agents) will be copied automatically.

### Pattern 5: GSD_CF_ Marker Namespace (DIST-03)

**What:** The `GSD_CF_` marker prefix distinguishes this fork's installed files from upstream GSD files. This is done by including the prefix in the agent's `description` frontmatter field and in prose references within the command/agent files, NOT in install.js code.

**Confirmed:** The installer at line 17-22 defines `GSD_CODEX_MARKER` and `GSD_COPILOT_INSTRUCTIONS_MARKER` for CLAUDE.md/settings.json markers, but these are for the outer config files, not the agent/command files themselves. The agent name (`gsd-code-planner`, `gsd-prototyper`) serves as the natural namespace. No code change to install.js is needed for D-15.

**What D-15 actually means in practice:** Ensure new commands and agents have names/descriptions that clearly identify them as gsd-code-first additions (e.g., description includes "Code-First fork" or "gsd-code-first"). This is a documentation/prose matter, not a code change.

### Pattern 6: Help Workflow File Update (DOCS-01)

**What:** `commands/gsd/help.md` references `@~/.claude/get-shit-done/workflows/help.md`. The actual command list lives in `get-shit-done/workflows/help.md` (606 lines). New commands are added as a new section in that file.

**Key detail:** The help workflow file has no auto-discovery mechanism -- it is a static markdown reference. Adding new commands requires manually editing `get-shit-done/workflows/help.md` to add a "Code-First Commands" section.

### Anti-Patterns to Avoid

- **Registering new files individually in install.js:** The installer reads the entire directory. Do not add per-file copy entries.
- **Duplicating ARC tag syntax in README:** D-21 explicitly says reference `arc-standard.md`, do not duplicate.
- **Auto-executing without approval gate:** D-02 and the CONTEXT.md specifics section say "The approval gate in iterate must be the ONLY place execution is authorized." Never call the executor before the approval step.
- **Using cmdConfigSet() for phase_modes.N without updating VALID_CONFIG_KEYS:** The key validation will reject unknown keys. Either add the dynamic pattern to `isValidConfigKey()` or implement set-mode as a dedicated gsd-tools.cjs subcommand that calls `setConfigValue()` directly.
- **Modifying `bin/install.js` for DIST-01:** Not needed. The wholesale directory copy already handles it.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Flag parsing in set-mode bash step | Custom regex in set-mode.md prose | `parseNamedArgs()` via gsd-tools.cjs subcommand | Already handles --phase N, --non-interactive, boolean/value split |
| Config file read/write | Direct fs operations in command .md file | `gsd-tools.cjs config-set` and `config-get` subcommands | Handles JSON parse, dot-notation, validation, error handling |
| Per-file copy registration in installer | Adding each new file explicitly to install.js | None needed -- directory copy is wholesale | Installer already does `readdirSync` on agents/ and commands/gsd/ |
| Mode display at startup | New startup hook in gsd-tools.cjs | Add `config-get default_phase_mode` call in command startup prose | `config-get` is already a subcommand |

**Key insight:** Every infrastructure need for this phase is already solved. The work is wiring existing tools together with new command orchestration prose, plus documentation.

---

## Common Pitfalls

### Pitfall 1: VALID_CONFIG_KEYS Rejection of phase_modes.N

**What goes wrong:** set-mode with `--phase 3` tries to write `phase_modes.3` via `config-set`. `cmdConfigSet()` calls `isValidConfigKey('phase_modes.3')` which returns `false` and exits with error: "Unknown config key".

**Why it happens:** `VALID_CONFIG_KEYS` has `phase_modes.default` as an exact match but no dynamic pattern for numeric phase IDs.

**How to avoid:** Add `/^phase_modes\.\d+$/.test(keyPath)` to `isValidConfigKey()` in `get-shit-done/bin/lib/config.cjs` -- one line, same style as the `agent_skills` pattern at line 41. This is a required code change for set-mode per-phase functionality.

**Warning signs:** Error message "Unknown config key: phase_modes.3" when running set-mode with --phase flag.

### Pitfall 2: iterate's Approval Gate in Non-Interactive Contexts

**What goes wrong:** Using `AskUserQuestion` in an environment where the user is not present (CI, headless pipeline) blocks indefinitely or errors.

**Why it happens:** `AskUserQuestion` requires a human response. Without the `--non-interactive` flag check, CI runs hang.

**How to avoid:** In iterate.md, check for `--non-interactive` flag BEFORE spawning gsd-code-planner. If the flag is set, skip the approval gate step entirely and proceed directly to executor. If not set, present the plan via `AskUserQuestion` and wait for explicit approve/reject response.

**Warning signs:** Iterate hangs in CI; no output after code-planner completes.

### Pitfall 3: Installer Won't Pick Up Files Not in agents/ or commands/gsd/

**What goes wrong:** If new command files are placed in a subdirectory or a new directory outside `commands/gsd/`, they will not be installed.

**Why it happens:** The installer reads `commands/gsd/` and `agents/` specifically -- no other paths.

**How to avoid:** All new commands go in `commands/gsd/`. All new agents go in `agents/`. Do not create subdirectories.

**Warning signs:** `npx gsd-code-first@latest` installs successfully but the command is not available in `~/.claude/commands/gsd/`.

### Pitfall 4: README Upstream Drift

**What goes wrong:** Replacing the entire README.md with a fork-specific version makes upstream merges from get-shit-done painful -- every README change from upstream becomes a conflict.

**Why it happens:** The README is the most-edited file in upstream GSD.

**How to avoid:** Prepend a fork-specific header section (from top to a clear `---` divider) and leave the upstream GSD content below it intact. The fork section covers: name, description, `npx gsd-code-first@latest` install, code-first quick-start, and a link to the user guide. The upstream section can remain or be trimmed. Keeping the boundary clear enables clean cherry-picks from upstream.

**Warning signs:** Git merge conflicts on every upstream sync; README sections duplicated.

### Pitfall 5: help.md Missing the New Section

**What goes wrong:** New commands are available after install but not visible in `/gsd:help`, leaving users unable to discover them.

**Why it happens:** `help.md` (the slash command) just echoes `get-shit-done/workflows/help.md`. That file is a static reference with no auto-discovery. Adding files to `commands/gsd/` does not update it automatically.

**How to avoid:** Explicitly edit `get-shit-done/workflows/help.md` to add a "Code-First Commands" section listing: prototype, iterate, annotate, extract-plan, set-mode, deep-plan -- each with one-line description.

---

## Code Examples

### iterate.md Process Section (skeleton)

```markdown
<process>

1. **Run extract-tags** to produce an up-to-date CODE-INVENTORY.md:
   ```bash
   node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" extract-tags --format md --output .planning/prototype/CODE-INVENTORY.md
   ```

2. **Spawn gsd-code-planner** via the Task tool to read CODE-INVENTORY.md and produce a PLAN.md.
   Wait for gsd-code-planner to complete. If it fails, stop and report the error.

3. **Approval gate** (skip if --non-interactive is in $ARGUMENTS):
   - Read the generated PLAN.md and present it to the user
   - Use AskUserQuestion: "Review the plan above. Approve execution? [yes/no]"
   - If user responds "no" or any rejection: stop, do not execute
   - If user responds "yes": proceed to step 4

4. **Spawn gsd-arc-executor** (or gsd-executor if arc.enabled is false) via the Task tool.
   Wait for executor to complete. If it fails, stop and report the error.

5. **Post-execution** (conditional on flags in $ARGUMENTS):
   - If --verify: run /gsd:verify-work
   - If --annotate: run extract-tags bash command (same as step 1)

6. **Show summary:** steps completed, plan path, any skipped steps.

</process>
```

### set-mode.md Process Section (skeleton)

```markdown
<process>

1. Parse $ARGUMENTS to extract: mode value (code-first|plan-first|hybrid) and optional --phase N.

2. Validate mode value. Valid values: code-first, plan-first, hybrid.

3. If --phase N is present:
   ```bash
   node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" config-set phase_modes.N MODE_VALUE
   ```
   (Requires phase_modes.N dynamic key support in isValidConfigKey -- see Pitfall 1.)

   If no --phase:
   ```bash
   node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" config-set default_phase_mode MODE_VALUE
   ```

4. Show confirmation: "Mode set to: MODE_VALUE" (and phase scope if applicable).
   Show current effective mode:
   ```bash
   node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" config-get default_phase_mode
   ```

</process>
```

### deep-plan.md Process Section (skeleton)

```markdown
<process>

1. Extract phase number and flags from $ARGUMENTS.

2. Run /gsd:discuss-phase with the phase number (and any passthrough flags).
   Wait for discuss-phase to complete. The output CONTEXT.md is the input for plan-phase.

3. Run /gsd:plan-phase with the same phase number (and any passthrough flags).
   Wait for plan-phase to complete.

4. Show summary: "Deep plan complete for phase N. CONTEXT.md and PLAN.md created."

</process>
```

### isValidConfigKey addition (config.cjs)

```javascript
// Source: get-shit-done/bin/lib/config.cjs, isValidConfigKey() function
// Add after line 41 (the agent_skills dynamic pattern):
if (/^phase_modes\.\d+$/.test(keyPath)) return true;
```

### gsd-tools.cjs set-mode case (alternative to config-set for per-phase modes)

If a dedicated `set-mode` subcommand is preferred over modifying isValidConfigKey:

```javascript
// Source: get-shit-done/bin/gsd-tools.cjs main() switch
case 'set-mode': {
  const allArgs = args.slice(1);
  const { phase } = parseNamedArgs(allArgs, ['phase']);
  const modeValue = allArgs.find(a => !a.startsWith('--'));
  const VALID_MODES = new Set(['code-first', 'plan-first', 'hybrid']);
  if (!modeValue || !VALID_MODES.has(modeValue)) {
    error(`Usage: set-mode <code-first|plan-first|hybrid> [--phase N]`);
  }
  const keyPath = phase ? `phase_modes.${phase}` : 'default_phase_mode';
  const { setConfigValue } = require('./lib/config.cjs');
  const result = setConfigValue(cwd, keyPath, modeValue);
  core.output(result, raw, `${keyPath}=${modeValue}`);
  break;
}
```

Note: This calls `setConfigValue()` directly, bypassing `isValidConfigKey()`. Both approaches (add pattern to isValidConfigKey OR add dedicated subcommand) are valid. The dedicated subcommand approach avoids modifying the validation logic.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual tag annotation | gsd-annotator agent (Phase 1) | Phase 1 complete | auto-annotation available |
| No code-based planning | gsd-code-planner agent (Phase 2) | Phase 2 complete | CODE-INVENTORY.md → PLAN.md works |
| No iterate loop | Phase 3 target | This phase | Flagship command not yet wired |
| Static help file | Static help file | Always | Must be manually updated |

**What is already in place from prior phases:**
- `agents/gsd-code-planner.md` -- Phase 2, ready to be spawned by iterate
- `agents/gsd-arc-executor.md` -- Phase 2, ready to be spawned by iterate
- `agents/gsd-annotator.md` -- Phase 1, ready to be spawned by iterate with --annotate
- `commands/gsd/prototype.md` -- Phase 2, direct template for iterate
- `commands/gsd/annotate.md` -- Phase 1, direct template for iterate
- `get-shit-done/bin/lib/config.cjs` -- `setConfigValue()` works, `isValidConfigKey()` needs 1-line patch
- `package.json` -- Already correct: `name=gsd-code-first`, `bin.get-shit-done-cc=bin/install.js`
- Installer wholesale directory copy -- No changes needed for DIST-01

---

## Open Questions

1. **set-mode D-10: "active mode visible at command startup"**
   - What we know: gsd-tools.cjs `init` commands produce JSON consumed by workflow files; they don't display a statusline by themselves
   - What's unclear: Which command's "startup" should show the mode? Every command? Just iterate? The phrasing suggests iterate should print current mode before running.
   - Recommendation: In iterate.md process step 0, add: run `config-get default_phase_mode` and display it. Do not modify gsd-tools.cjs init output for this -- that would affect every command.

2. **iterate approval gate: AskUserQuestion vs bash read**
   - What we know: `AskUserQuestion` is the Claude Code native tool for user input; `bash read` works in terminal
   - What's unclear: Whether AskUserQuestion is available in all contexts where iterate would run
   - Recommendation: Use `AskUserQuestion` as primary. Document that `--non-interactive` bypasses it for CI. This is sufficient for v1.

3. **D-15: What exactly needs GSD_CF_ markers?**
   - What we know: The installer copies all files from `agents/` and `commands/gsd/` wholesale. There are no per-file content markers for installed agent/command files. The "GSD_MARKER_" system (lines 17-22 in install.js) applies to CLAUDE.md and Codex config.toml, not to agent/command files.
   - What's unclear: Whether D-15 requires adding literal `GSD_CF_` string markers into file content, or whether it is satisfied by the file names and package name (`gsd-code-first`) providing implicit namespace separation.
   - Recommendation: Satisfy D-15 by ensuring: (1) new agent descriptions include "Code-First fork" in their frontmatter description, and (2) the CLAUDE.md/settings.json attribution uses the `gsd-code-first` package name. No literal `GSD_CF_PROTOTYPER` string markers in file content are needed -- the agent names (`gsd-code-planner`, `gsd-prototyper`) are already distinct from upstream GSD agents.

---

## Environment Availability

Step 2.6: SKIPPED (no external dependencies -- this phase is entirely code and documentation changes within the existing Node.js/Markdown stack)

---

## Validation Architecture

Step 2.4: SKIPPED -- `workflow.nyquist_validation` is explicitly `false` in `.planning/config.json`

---

## Project Constraints (from CLAUDE.md)

These directives from `CLAUDE.md` are binding on planning and implementation:

| Constraint | Implication for Phase 3 |
|------------|------------------------|
| Tech stack: JavaScript/Node.js, Markdown, JSON only | All new commands are .md files. Any gsd-tools.cjs additions are CJS. No new npm deps. |
| Zero runtime dependencies | iterate.md orchestrates via Claude Code tools (Task, AskUserQuestion, Bash) -- no npm packages needed |
| All original GSD commands must continue working unchanged | set-mode, iterate, deep-plan are NEW commands; they do not modify existing commands |
| Distribution via `npx gsd-code-first@latest` | package.json already correct; no change needed |
| Upstream mergeability: primarily additive changes | iterate.md, set-mode.md, deep-plan.md are new files; help.md update is additive; README.md strategy should prepend rather than replace |
| CJS tests use node:test, not vitest | If any tests are added for config.cjs isValidConfigKey change, use node:test pattern |
| `parseNamedArgs()` for flag parsing in gsd-tools.cjs | set-mode subcommand (if added to gsd-tools.cjs) must use parseNamedArgs() |
| Agent format: YAML frontmatter + objective + process sections | iterate.md, set-mode.md, deep-plan.md must follow this exact structure |
| Use GSD workflow entry points before editing | Implementation follows /gsd:execute-phase pattern |

---

## Sources

### Primary (HIGH confidence)
- Direct code audit: `bin/install.js` lines 4180-4256 -- wholesale directory copy confirmed
- Direct code audit: `get-shit-done/bin/lib/config.cjs` lines 14-42 -- VALID_CONFIG_KEYS set and isValidConfigKey() function
- Direct code audit: `get-shit-done/bin/gsd-tools.cjs` lines 167-195 -- parseNamedArgs() pattern
- Direct code audit: `commands/gsd/annotate.md` -- Task spawn + auto-chain pattern
- Direct code audit: `commands/gsd/prototype.md` -- Task spawn + $ARGUMENTS pattern
- Direct code audit: `get-shit-done/workflows/help.md` lines 1-606 -- static command reference; no auto-discovery
- Direct code audit: `.planning/config.json` -- nyquist_validation=false, package.json already correct

### Secondary (MEDIUM confidence)
- `package.json` audit: name=gsd-code-first, bin.get-shit-done-cc=bin/install.js, version=2.0.0-alpha.1 -- confirmed correct for DIST-02

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- everything is within existing codebase patterns; no new libraries
- Architecture: HIGH -- installer behavior verified by direct code read; command patterns verified from existing examples
- Pitfalls: HIGH -- isValidConfigKey gap is directly confirmed by reading the source; approval gate issue is structural

**Research date:** 2026-03-28
**Valid until:** 2026-05-28 (stable codebase, no external dependencies to expire)
