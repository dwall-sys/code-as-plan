# Phase 5: ARC as Default - Research

**Researched:** 2026-03-29
**Domain:** Configuration defaults, agent fallback logic, command routing
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** The hardcoded default in `buildNewProjectConfig()` already sets `arc.enabled: true` (config.cjs line 141). No change needed to the config schema default.
- **D-02:** The three-level merge (hardcoded <- userDefaults <- choices) already preserves explicit `arc.enabled: false` from existing configs. ARC-02 is satisfied by existing merge behavior.
- **D-03:** Change `|| echo "false"` to `|| echo "true"` in gsd-arc-executor.md (line 53) and gsd-arc-planner.md (line 62). Currently, if config-get fails (e.g., no config.json exists yet), agents fall back to `false` -- contradicting the "always-on" intent.
- **D-04:** Keep the config-get check in iterate.md step 4 to preserve opt-out capability for projects with `arc.enabled: false`. But verify the fallback logic is consistent: if config-get returns nothing, default should be `true` (use gsd-arc-executor).
- **D-05:** Add a visible log line in iterate.md step 4 showing which executor was selected and why. Example: "ARC mode: enabled -- using gsd-arc-executor" or "ARC mode: disabled (config) -- using gsd-executor".

### Claude's Discretion

- Test approach for verifying the upgrade path (existing false configs preserved)
- Whether to add a log line to gsd-arc-executor/planner startup as well

### Deferred Ideas (OUT OF SCOPE)

None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ARC-01 | arc.enabled defaults to true for all new gsd-code-first installations | D-01 confirms the hardcoded default already exists at config.cjs:141. No config schema change needed. The gap is agent fallback strings (D-03) and iterate routing fallback (D-04). |
| ARC-02 | Existing projects with explicit arc.enabled: false preserve their setting | D-02 confirms three-level merge already handles this. Verified by reading config.cjs lines 149-185 -- `arc: { ...hardcoded.arc, ...(userDefaults.arc || {}), ...(choices.arc || {}) }` means explicit `false` in an existing config.json always wins. |
</phase_requirements>

## Summary

Phase 5 is a targeted configuration consistency fix, not a feature addition. The hardcoded default for `arc.enabled` is already `true` in `buildNewProjectConfig()` (config.cjs line 141), which means ARC-01 is partially satisfied by existing code. The gap is that three agent/command files use `|| echo "false"` as their fallback when `config-get arc.enabled` fails -- meaning fresh installs without a config.json yet would accidentally disable ARC. Fixing these three fallback strings from `"false"` to `"true"` is the entire implementation scope.

ARC-02 is already satisfied by the three-level deep merge in `buildNewProjectConfig()`. When a project's existing `config.json` contains `arc: { enabled: false }`, the merge guarantees that value propagates through -- no code change is required for preservation behavior. The only confirmation needed is a test that proves the `|| echo "false"` change in gsd-arc-executor.md does NOT affect projects that have `arc.enabled: false` explicitly in config.json (those use the config-get path, not the fallback).

The runtime logging requirement (D-05) is a pure addition to iterate.md step 4 -- a `echo` or display line showing which executor was chosen and why.

**Primary recommendation:** Make three one-line text edits (two in agent .md files, one in iterate.md) and add a log line to iterate.md step 4. No JavaScript, no tests required for the core changes -- but one new test for the config.test.cjs suite is advisable for the arc.enabled default.

## Standard Stack

This phase involves no new libraries. All work is within the existing stack.

### Core (unchanged)
| File | Current Content | Change Required |
|------|----------------|-----------------|
| `agents/gsd-arc-executor.md` | Line 53: `|| echo "false"` | Change fallback to `|| echo "true"` |
| `agents/gsd-arc-planner.md` | Line 62: `|| echo "false"` | Change fallback to `|| echo "true"` |
| `commands/gsd/iterate.md` | Lines 86-92: routing check, no log line | Add log line; change fallback to `true` |

### Supporting (existing test infrastructure)
| File | Purpose | Relation to Phase |
|------|---------|------------------|
| `tests/config.test.cjs` | node:test unit tests for config.cjs | Add arc.enabled default test here |
| `get-shit-done/bin/lib/config.cjs` | Config CRUD, buildNewProjectConfig | READ ONLY -- D-01 confirmed no change needed |

**Installation:** No new packages. Zero additional dependencies.

## Architecture Patterns

### How the Fallback Chain Works

When an agent runs on a project with no `config.json` yet (e.g., immediately after `git clone` before running `/gsd:new-project`), the `config-get arc.enabled` command exits with a non-zero code and prints to stderr. The bash `2>/dev/null || echo "false"` pattern catches this and substitutes the hardcoded fallback string. Currently that string is `"false"`, which is wrong -- it contradicts the intent that ARC is always-on.

```bash
# Current (wrong for fresh installs):
ARC_ENABLED=$(node "..." config-get arc.enabled 2>/dev/null || echo "false")

# Fixed (correct for fresh installs):
ARC_ENABLED=$(node "..." config-get arc.enabled 2>/dev/null || echo "true")
```

The config-get command fails (exits non-zero) in exactly two scenarios:
1. No `.planning/config.json` exists at all (fresh clone, no init yet)
2. The `arc.enabled` key is missing from an existing config.json (pre-ARC project)

Both scenarios should default to ARC-on per ARC-01.

### How the Three-Level Merge Preserves Explicit False (ARC-02)

For an existing project that has run `/gsd:new-project` and explicitly set `arc.enabled: false`, the config.json on disk contains `{ "arc": { "enabled": false } }`. When `config-get arc.enabled` runs, it reads that file directly and returns `"false"` -- the fallback string is never reached. Therefore changing the fallback from `"false"` to `"true"` does NOT affect opt-out projects.

```
config-get arc.enabled flow:
  .planning/config.json exists AND has arc.enabled → returns the stored value
  .planning/config.json missing OR arc.enabled absent → exits non-zero → fallback string used
```

### iterate.md Step 4 Pattern (Current and Target)

Current step 4 routing (lines 86-92 of iterate.md):
```bash
node "..." config-get arc.enabled
# then: if true → spawn gsd-arc-executor, if false or not set → spawn gsd-executor
```

The phrase "not set" in the current step 4 comment is the gap. After D-04 fix, "not set" (config-get failure) should route to gsd-arc-executor, not gsd-executor.

Target step 4 routing (post-phase):
```bash
ARC_ENABLED=$(node "..." config-get arc.enabled 2>/dev/null || echo "true")
# Log: "ARC mode: [enabled|disabled (config)] -- using [gsd-arc-executor|gsd-executor]"
# if true → spawn gsd-arc-executor
# if false → spawn gsd-executor
```

### Anti-Patterns to Avoid

- **Touching config.cjs for this phase:** D-01 explicitly confirms `buildNewProjectConfig()` already has `arc.enabled: true`. Do not modify config.cjs.
- **Adding a config migration script:** ARC-02 is handled by the merge pattern. No migration needed for existing configs.
- **Changing the config-get behavior:** The fix is in the caller (agent/command fallback), not in the `cmdConfigGet` function itself.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Config key existence check | Custom file-read logic in agents | Existing `config-get` + bash fallback pattern | Already the established pattern in all wrapper agents |
| ARC state logging | A separate logging function | Inline `echo` in iterate.md step 4 | Commands use plain bash display, not a logging library |

## Runtime State Inventory

> This phase changes fallback strings in Markdown agent files -- not a rename/refactor of stored data. Runtime state inventory is not applicable.

None -- verified. This phase edits three `.md` text files. There are no database records, stored user_ids, OS-registered names, secrets, or build artifacts that embed "false" as a hardcoded value to migrate. The only "state" is the fallback string in the agent shell snippets, which affects new executions only (not persisted data).

## Common Pitfalls

### Pitfall 1: Changing the Wrong File Layer

**What goes wrong:** Editing `get-shit-done/bin/lib/config.cjs` to change the default, assuming that is where the gap is.

**Why it happens:** config.cjs line 141 (`arc: { enabled: true }`) looks like the source of truth, so it seems natural to look there.

**How to avoid:** D-01 explicitly states the hardcoded default is already correct. The gap is exclusively in the agent-side bash fallback strings, not in the config module.

**Warning signs:** If you find yourself editing `buildNewProjectConfig()`, stop and re-read D-01.

### Pitfall 2: Breaking Opt-Out Behavior While Fixing Fallback

**What goes wrong:** The fallback change `|| echo "true"` is incorrectly applied to the config-get read path (e.g., changing the value that `cmdConfigGet` returns for `false`), rather than just the shell fallback on non-zero exit.

**Why it happens:** The fix looks similar to "changing the default" which could be misread as affecting all reads.

**How to avoid:** The bash fallback `|| echo "true"` only runs when `config-get` exits non-zero (file missing or key missing). When config.json exists with `arc.enabled: false`, `config-get` exits zero and returns `"false"` -- the fallback never triggers. ARC-02 is therefore safe.

**Warning signs:** A test asserting that a project with `arc.enabled: false` in config.json routes to `gsd-executor` should still pass after this change.

### Pitfall 3: Forgetting iterate.md Uses a Different Pattern from the Agents

**What goes wrong:** Only updating gsd-arc-executor.md and gsd-arc-planner.md, missing that iterate.md step 4 has its own `config-get arc.enabled` check with no explicit fallback documented.

**Why it happens:** iterate.md step 4 uses prose ("if the result is true... if the result is false or not set") rather than an inline bash variable assignment, so it's not as visually obvious as the `|| echo "false"` pattern.

**How to avoid:** Treat iterate.md step 4 as a third change site, not just the two agent files. The phrase "or not set" must be reconciled to default to `gsd-arc-executor`.

**Warning signs:** If iterate.md still says "if false or not set: spawn gsd-executor" after this phase, that is a bug.

### Pitfall 4: No Test Coverage for arc.enabled Default

**What goes wrong:** The `arc.enabled` default has no test in `tests/config.test.cjs` (confirmed: 0 occurrences of `arc.enabled` in that file). If the default is accidentally regressed in a future config refactor, there is no automated safety net.

**Why it happens:** The ARC feature was added after the initial test suite was written.

**How to avoid:** Add at minimum one test: `buildNewProjectConfig({})` returns `config.arc.enabled === true`. This is consistent with the existing pattern of testing config defaults (lines 348-375 of config.test.cjs test all other defaults).

**Warning signs:** Running `node --test tests/config.test.cjs` passes but no test asserts `arc.enabled` is `true` in a fresh config.

## Code Examples

### Pattern: config-get fallback in agent bash (verified from codebase)

From `agents/gsd-arc-executor.md` line 53 (current, incorrect for fresh installs):
```bash
ARC_ENABLED=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" config-get arc.enabled 2>/dev/null || echo "false")
```

From `agents/gsd-arc-planner.md` line 62 (current, incorrect for fresh installs):
```bash
ARC_ENABLED=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" config-get arc.enabled 2>/dev/null || echo "false")
PHASE_MODE=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" config-get default_phase_mode 2>/dev/null || echo "plan-first")
```

Target (both files after phase):
```bash
ARC_ENABLED=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" config-get arc.enabled 2>/dev/null || echo "true")
```

### Pattern: iterate.md step 4 routing with log line (target state)

Current prose (iterate.md lines 86-92):
```
Check if ARC mode is enabled via bash:
  node "..." config-get arc.enabled
- If the result is `true`: spawn `gsd-arc-executor`
- If the result is `false` or not set: spawn `gsd-executor`
```

Target prose (after D-04 + D-05):
```bash
ARC_ENABLED=$(node "..." config-get arc.enabled 2>/dev/null || echo "true")
```
Then log:
```
ARC mode: enabled -- using gsd-arc-executor
  -or-
ARC mode: disabled (config) -- using gsd-executor
```
Then route based on `ARC_ENABLED`.

### Pattern: node:test assertion for config default (consistent with config.test.cjs style)

From config.test.cjs lines 348-375 (pattern to follow):
```javascript
test('buildNewProjectConfig with no choices returns expected defaults', () => {
  const config = buildNewProjectConfig({});
  // ... existing assertions ...
  assert.strictEqual(config.arc.enabled, true, 'arc.enabled should default to true');
  assert.strictEqual(config.arc.tag_prefix, '@gsd-', 'arc.tag_prefix should default to @gsd-');
});
```

## State of the Art

| Aspect | Current State | Target State After Phase |
|--------|---------------|--------------------------|
| gsd-arc-executor.md fallback | `|| echo "false"` (wrong for fresh installs) | `|| echo "true"` |
| gsd-arc-planner.md fallback | `|| echo "false"` (wrong for fresh installs) | `|| echo "true"` |
| iterate.md step 4 fallback | Prose says "false or not set → gsd-executor" | Fallback routes to gsd-arc-executor |
| iterate.md routing visibility | Silent (no log line) | Logs executor selection with reason |
| arc.enabled test coverage | 0 tests assert the default | 1+ tests confirm `true` default |

## Open Questions

1. **Log line format in iterate.md**
   - What we know: D-05 gives two example strings
   - What's unclear: Whether to use `echo` (bash) or a prose display instruction in the Markdown command
   - Recommendation: Iterate.md is a Markdown command prose file (not a bash script). The log instruction should be written as a prose directive: "Log to the user: 'ARC mode: [enabled|disabled (config)] -- using [gsd-arc-executor|gsd-executor]'" matching the convention in step 1 and step 6 of iterate.md.

2. **Log line in gsd-arc-executor.md and gsd-arc-planner.md startup**
   - What we know: D-05 is specifically about iterate.md step 4. Claude's Discretion includes "whether to add a log line to gsd-arc-executor/planner startup as well."
   - What's unclear: Whether the startup check_arc_config step in those agents should also emit a visible line.
   - Recommendation: Skip adding log lines to the agent startup blocks. The agents are spawned from iterate.md, which already logs the selection. Duplicating the log inside the agent adds noise without value. Keep agents quiet on startup.

## Environment Availability

Step 2.6: SKIPPED (no external dependencies identified -- this phase edits three Markdown files and adds one JavaScript test assertion).

## Sources

### Primary (HIGH confidence)
- Direct read of `get-shit-done/bin/lib/config.cjs` -- confirmed arc.enabled: true at line 141, three-level merge at lines 149-185
- Direct read of `agents/gsd-arc-executor.md` -- confirmed `|| echo "false"` fallback at line 53
- Direct read of `agents/gsd-arc-planner.md` -- confirmed `|| echo "false"` fallback at line 62
- Direct read of `commands/gsd/iterate.md` -- confirmed step 4 prose at lines 86-92
- Direct read of `tests/config.test.cjs` -- confirmed 0 existing `arc.enabled` test assertions
- Shell verification: `config-get workflow.nyquist_validation` returned `false` -- Validation Architecture section omitted per instructions

### Secondary (MEDIUM confidence)
- `.planning/config.json` of this project: `arc` key absent from existing config -- confirms the "pre-ARC project" scenario is real and exercises the fallback path

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all files read directly, exact line numbers confirmed
- Architecture: HIGH -- bash fallback pattern is well-understood, no ambiguity
- Pitfalls: HIGH -- derived from direct code inspection, not inference

**Research date:** 2026-03-29
**Valid until:** 2026-06-29 (stable configuration pattern, no external dependencies to drift)
