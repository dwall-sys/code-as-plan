# Phase 5: ARC as Default - Context

**Gathered:** 2026-03-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Make ARC annotations always-on for new gsd-code-first installations while preserving existing projects that have explicitly set arc.enabled: false. This is a config behavior change, not a new feature.

</domain>

<decisions>
## Implementation Decisions

### Config Default Behavior
- **D-01:** The hardcoded default in `buildNewProjectConfig()` already sets `arc.enabled: true` (config.cjs line 141). No change needed to the config schema default.
- **D-02:** The three-level merge (hardcoded <- userDefaults <- choices) already preserves explicit `arc.enabled: false` from existing configs. ARC-02 is satisfied by existing merge behavior.

### Agent Fallback Values
- **D-03:** Change `|| echo "false"` to `|| echo "true"` in gsd-arc-executor.md (line 53) and gsd-arc-planner.md (line 62). Currently, if config-get fails (e.g., no config.json exists yet), agents fall back to `false` -- contradicting the "always-on" intent.

### iterate.md Routing
- **D-04:** Keep the config-get check in iterate.md step 4 to preserve opt-out capability for projects with `arc.enabled: false`. But verify the fallback logic is consistent: if config-get returns nothing, default should be `true` (use gsd-arc-executor).

### Runtime Logging
- **D-05:** Add a visible log line in iterate.md step 4 showing which executor was selected and why. Example: "ARC mode: enabled -- using gsd-arc-executor" or "ARC mode: disabled (config) -- using gsd-executor".

### Claude's Discretion
- Test approach for verifying the upgrade path (existing false configs preserved)
- Whether to add a log line to gsd-arc-executor/planner startup as well

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Config System
- `get-shit-done/bin/lib/config.cjs` -- buildNewProjectConfig() at line 75, arc config block at lines 140-144, three-level merge at lines 150-183

### ARC Wrapper Agents
- `agents/gsd-arc-executor.md` -- Line 53: config-get arc.enabled with || echo "false" fallback
- `agents/gsd-arc-planner.md` -- Line 62: config-get arc.enabled with || echo "false" fallback

### Iterate Command
- `commands/gsd/iterate.md` -- Lines 86-92: Step 4 ARC routing logic

### ARC Standard
- `get-shit-done/references/arc-standard.md` -- The ARC annotation standard spec (frozen at v1.0)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `buildNewProjectConfig()` already returns `arc.enabled: true` -- no code change needed for default
- `cmdConfigGet()` function handles dotted key paths (`arc.enabled`) correctly
- Existing test suite: 106 agent-frontmatter tests + 21 arc-scanner tests

### Established Patterns
- Config-get with `|| echo "false"` fallback is the standard pattern in all wrapper agents
- Three-level deep merge in config ensures user/project overrides always win
- All agent modifications in v1.0 followed the "wrapper, not patch" pattern

### Integration Points
- `iterate.md` step 4 is the primary routing point (arc-executor vs executor)
- `gsd-arc-executor.md` and `gsd-arc-planner.md` both check arc.enabled at startup
- No other commands currently check arc.enabled

</code_context>

<specifics>
## Specific Ideas

No specific requirements -- the implementation is straightforward config/fallback changes.

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 05-arc-as-default*
*Context gathered: 2026-03-29*
