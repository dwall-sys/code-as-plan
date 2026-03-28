---
phase: 01-annotation-foundation
plan: 04
subsystem: config
tags: [config, arc, phase_modes, gsd-code-first, node.js]

requires: []
provides:
  - "config.cjs extended with arc namespace (enabled, tag_prefix, comment_anchors)"
  - "config.cjs extended with phase_modes namespace (empty object default)"
  - "config.cjs extended with default_phase_mode key (plan-first default)"
  - "buildNewProjectConfig() exported for programmatic access"
affects: [02-gsd-tools-scanner, 03-commands, gsd-code-planner, set-mode]

tech-stack:
  added: []
  patterns:
    - "Additive config extension: new namespaces added to VALID_CONFIG_KEYS, hardcoded defaults, and deep-merge return"

key-files:
  created: []
  modified:
    - get-shit-done/bin/lib/config.cjs

key-decisions:
  - "Exported buildNewProjectConfig() to enable programmatic verification and direct require-based usage by Phase 2 agents"
  - "arc.comment_anchors is an array of strings matching the ARC annotation standard supported prefixes"
  - "default_phase_mode defaults to 'plan-first' to preserve backward compatibility with existing GSD workflows"
  - "phase_modes defaults to empty object — specific phase overrides are set via config-set"

patterns-established:
  - "Config extension pattern: (1) VALID_CONFIG_KEYS, (2) hardcoded defaults, (3) deep-merge return — all three must be updated together"

requirements-completed:
  - MODE-02

duration: 3min
completed: 2026-03-28
---

# Phase 01 Plan 04: Config Schema Extension Summary

**arc and phase_modes config namespaces added to config.cjs with three-level deep-merge, enabling MODE-02 config validation for Phase 2 agents**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-03-28T19:23:39Z
- **Completed:** 2026-03-28T19:25:35Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Added `arc.enabled`, `arc.tag_prefix`, `arc.comment_anchors`, `phase_modes.default`, and `default_phase_mode` to VALID_CONFIG_KEYS
- Added `arc`, `phase_modes`, and `default_phase_mode` hardcoded defaults in `buildNewProjectConfig()`
- Added deep-merge entries for all three new namespaces in the return statement
- Exported `buildNewProjectConfig` for direct programmatic use
- All 50 existing config tests pass with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend config.cjs with arc and phase_modes schema** - `3dd1c34` (feat)

**Plan metadata:** _(docs commit hash — recorded after state update)_

## Files Created/Modified
- `get-shit-done/bin/lib/config.cjs` - Extended with arc namespace, phase_modes namespace, default_phase_mode, and buildNewProjectConfig export

## Decisions Made
- Exported `buildNewProjectConfig()` — the function existed but was unexported. The plan's verification script requires it to be accessible via direct require. This is a strictly additive change (Rule 2 — missing critical functionality for verification).
- Used `'plan-first'` as `default_phase_mode` per the RESEARCH.md resolution of Open Question 2, preserving backward compatibility with existing GSD plan-first workflows.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Exported buildNewProjectConfig()**
- **Found during:** Task 1 verification
- **Issue:** `buildNewProjectConfig` function existed in config.cjs but was not in `module.exports`. The plan's verification script (`const config = require('./get-shit-done/bin/lib/config.cjs'); config.buildNewProjectConfig({})`) requires the function to be exported.
- **Fix:** Added `buildNewProjectConfig` to the `module.exports` object
- **Files modified:** `get-shit-done/bin/lib/config.cjs`
- **Verification:** Verification script exited 0, all 50 existing config tests still pass
- **Committed in:** `3dd1c34` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Export is required for the plan's own verification to succeed. No scope creep.

## Issues Encountered
None beyond the missing export noted above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Config schema now supports `arc.*` and `phase_modes.*` namespaces
- Phase 2 agents can call `config-get arc.enabled`, `config-get arc.tag_prefix`, and `config-get default_phase_mode` without errors
- `config-set phase_modes.default <mode>` is now a valid operation
- No blockers for subsequent plans

## Self-Check: PASSED

All created/modified files exist and all commits are present in git history.

---
*Phase: 01-annotation-foundation*
*Completed: 2026-03-28*
