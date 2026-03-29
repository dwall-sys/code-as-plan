---
phase: 06-prd-to-prototype-pipeline
plan: "01"
subsystem: commands
tags: [prototype, prd, acceptance-criteria, arc-tags, gsd-prototyper, command-orchestration]

# Dependency graph
requires:
  - phase: 05-arc-defaults
    provides: ARC-enabled defaults and iterate.md flag patterns used as template
provides:
  - PRD-driven prototype command with 3-way PRD resolution, AC extraction, confirmation gate, and AC-enriched gsd-prototyper spawn
affects: [06-02, gsd-prototyper, prototype-users]

# Tech tracking
tech-stack:
  added: [AskUserQuestion tool added to prototype.md allowed-tools]
  patterns:
    - "PRD priority chain: --prd flag > auto-detect .planning/PRD.md > AskUserQuestion paste"
    - "Semantic AC extraction via inline prompt (not structural regex) — Pitfall 16 prevention"
    - "Mandatory confirmation gate with --non-interactive as only bypass (D-03 pattern)"
    - "AC-to-tag traceability: @gsd-todo(ref:AC-N) links prototype code to PRD requirements"

key-files:
  created: []
  modified:
    - commands/gsd/prototype.md

key-decisions:
  - "PRD ingestion stays in command orchestrator (prototype.md), not in gsd-prototyper agent — keeps agent reusable and format-agnostic (D-02)"
  - "Semantic AC extraction handles all PRD formats (prose, bullets, tables, user stories) — avoids structural regex brittleness (D-08, Pitfall 16)"
  - "Confirmation gate is mandatory; only --non-interactive bypasses it — user must verify AC list before code generation (D-03)"
  - "--non-interactive bypasses AC confirmation gate only; --interactive enables per-iteration loop pauses (two separate behavior axes, Q3 from research)"

patterns-established:
  - "Command orchestrator pattern: all PRD ingestion, AC extraction, and confirmation logic lives in the command file; agent receives clean enriched Task() prompt"
  - "Three-way PRD resolution: --prd flag > auto-detect > paste prompt — standardizes how all future PRD-aware commands should resolve input"
  - "ref:AC-N metadata key: @gsd-todo(ref:AC-1) format links prototype todos back to PRD ACs for completeness tracking"

requirements-completed: [PRD-01, PRD-02, PRD-03, PRD-04, PRD-07]

# Metrics
duration: 2min
completed: 2026-03-29
---

# Phase 6 Plan 01: PRD-to-Prototype Pipeline Entry Point Summary

**Rewrote prototype.md into a PRD-driven orchestrator with 3-way PRD resolution, semantic AC extraction, mandatory confirmation gate, and @gsd-todo(ref:AC-N)-enriched gsd-prototyper spawn**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-29T11:40:00Z
- **Completed:** 2026-03-29T11:41:27Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Rewrote `commands/gsd/prototype.md` from a 4-step single-agent-spawn into a full PRD pipeline orchestrator
- Implemented three-way PRD resolution: `--prd <path>` flag, auto-detect `.planning/PRD.md`, paste via AskUserQuestion
- Added semantic AC extraction step with prompt structure that handles all PRD formats (prose, bullets, tables, user stories)
- Implemented mandatory confirmation gate (D-03): user reviews extracted AC list before code generation; only `--non-interactive` bypasses it
- Enriched gsd-prototyper Task() spawn with AC list and explicit `ref:AC-N` tag instruction to ensure traceability
- Added Step 5 AC completeness check: `grep -c "ref:AC-"` on CODE-INVENTORY.md with warning if zero tags found
- Added placeholder comment for Steps 6-7 (iteration loop — Plan 02)

## Task Commits

1. **Task 1: Rewrite prototype.md with PRD pipeline Steps 0-5** - `2345dfb` (feat)

**Plan metadata:** (see below)

## Files Created/Modified

- `commands/gsd/prototype.md` — Rewritten from 56 lines to 203 lines with Steps 0-5, new flags, and AskUserQuestion in allowed-tools

## Decisions Made

- PRD ingestion stays in the command orchestrator, not in gsd-prototyper agent (D-02 locked decision — confirmed during implementation as the right architectural boundary)
- `--non-interactive` bypasses only the AC confirmation gate; `--interactive` enables per-iteration loop pauses — these are two separate axes, not opposites (clarified from research Q3)
- Semantic extraction handles malformed/minimal PRDs gracefully via inference rule: "if no explicit ACs exist, infer them from goals and scope sections"
- AC count warning added to Step 5 (not in plan) to surface Pitfall 5 immediately if gsd-prototyper omits `ref:AC-N` metadata

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added AC count warning in Step 5**
- **Found during:** Task 1 (writing Step 5)
- **Issue:** Plan said "log AC todos remaining: N" but didn't specify what to do if N=0 when ac_count>0 (Pitfall 5 in research — would silently indicate completion when ACs were never implemented)
- **Fix:** Added explicit warning message when `AC_REMAINING = 0` but `ac_count > 0`: warns user that gsd-prototyper may not have used `ref:AC-N` metadata
- **Files modified:** commands/gsd/prototype.md (Step 5 section)
- **Verification:** Warning text present in file
- **Committed in:** 2345dfb (task commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** The warning is essential for detecting Pitfall 5 (missing ref:AC-N tags causing false "complete" signal). No scope creep.

## Issues Encountered

None — plan executed cleanly. All patterns from iterate.md translated directly.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `commands/gsd/prototype.md` Steps 0-5 are complete and ready for Plan 02 to add Steps 6-7 (autonomous iteration loop)
- The placeholder comment `<!-- Steps 6-7 ... will be added by Plan 02 -->` marks the exact insertion point
- gsd-prototyper agent is unchanged — receives enriched Task() prompt from the command
- All 5 requirements addressed: PRD-01 (auto-detect), PRD-02 (--prd flag), PRD-03 (paste prompt), PRD-04 (ref:AC-N tags), PRD-07 (confirmation gate)

---
*Phase: 06-prd-to-prototype-pipeline*
*Completed: 2026-03-29*
