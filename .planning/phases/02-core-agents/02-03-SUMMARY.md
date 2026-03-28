---
phase: 02-core-agents
plan: "03"
subsystem: agents
tags: [arc, agents, wrappers, config-gating, annotations]
dependency_graph:
  requires:
    - 01-annotation-foundation (arc-standard.md, config.cjs with arc.enabled key)
    - agents/gsd-executor.md (upstream behavior the executor wrapper replicates)
    - agents/gsd-planner.md (upstream behavior the planner wrapper replicates)
  provides:
    - agents/gsd-arc-executor.md (ARC-aware executor wrapper)
    - agents/gsd-arc-planner.md (ARC-aware planner wrapper)
  affects:
    - 02-04 and later plans that wire these agents into workflow commands
tech_stack:
  added: []
  patterns:
    - Config-gated ARC behavior via gsd-tools.cjs config-get arc.enabled
    - Option A wrapper delegation (self-contained prose, no runtime reads of upstream agent files)
    - Three-mode planning input (code-first / hybrid / plan-first) controlled by default_phase_mode
key_files:
  created:
    - agents/gsd-arc-executor.md
    - agents/gsd-arc-planner.md
  modified: []
decisions:
  - "Wrapper agents use Option A (self-contained prose) delegation -- no runtime reads of upstream agent files, avoiding installation-path fragility"
  - "gsd-arc-executor ARC obligations are applied after task work but before commit -- task completion is primary, tag maintenance is secondary"
  - "gsd-arc-planner output format is always standard PLAN.md -- only the INPUT changes in code-first mode, not the output structure"
metrics:
  duration: "5m 10s"
  completed: "2026-03-28"
  tasks_completed: 2
  files_created: 2
  files_modified: 0
---

# Phase 02 Plan 03: ARC Wrapper Agents Summary

**One-liner:** Config-gated ARC executor and planner wrappers that add @gsd-decision tagging, @gsd-todo removal, and code-first planning input via CODE-INVENTORY.md -- all falling back to standard behavior when arc.enabled is false.

## What Was Built

Two new agent files that wrap the upstream GSD executor and planner with ARC annotation capabilities:

**`agents/gsd-arc-executor.md`** -- an ARC-aware executor that:
- Checks `arc.enabled` at startup; falls back to standard gsd-executor behavior when false
- When ARC is enabled: removes completed `@gsd-todo` tags from files it touches after each task
- When ARC is enabled: adds `@gsd-decision` tags for significant design choices made during execution
- Follows ARC comment anchor rule from arc-standard.md (comment token must be first non-whitespace on the line)
- Carries full executor behavior in self-contained prose (Option A delegation)

**`agents/gsd-arc-planner.md`** -- an ARC-aware planner that:
- Checks both `arc.enabled` and `default_phase_mode` at startup
- **code-first mode:** Uses CODE-INVENTORY.md as primary requirements input; @gsd-todo tags are the authoritative task backlog; @gsd-context/decision/constraint tags map to plan elements
- **hybrid mode:** Uses both REQUIREMENTS.md and CODE-INVENTORY.md; cross-references @gsd-ref tags
- **plan-first mode:** Uses REQUIREMENTS.md as primary, CODE-INVENTORY.md as supplementary context
- Falls back to standard gsd-planner behavior when arc.enabled is false
- Output is always standard PLAN.md format -- only the input source changes
- Runs `extract-tags --format json` for fresh supplementary tag data in code-first mode

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create gsd-arc-executor wrapper agent | bdf23fd | agents/gsd-arc-executor.md |
| 2 | Create gsd-arc-planner wrapper agent | ba24d32 | agents/gsd-arc-planner.md |

## Verification Results

Final test run: `node --test tests/agent-frontmatter.test.cjs`
- **104 pass, 2 fail** (2 failures are pre-existing gsd-annotator defects, unchanged from baseline)
- gsd-arc-executor: 4/4 tests pass (anti-heredoc, no skills:, commented hooks, name/description/tools/color)
- gsd-arc-planner: 4/4 tests pass (anti-heredoc, no skills:, commented hooks, name/description/tools/color)
- `git diff agents/gsd-executor.md` → 0 lines (unmodified)
- `git diff agents/gsd-planner.md` → 0 lines (unmodified)

## Decisions Made

1. **Option A delegation chosen for both wrappers:** Self-contained prose files that carry all executor/planner behavior inline, without reading upstream agent files at runtime. This avoids installation-path fragility where `agents/gsd-executor.md` resolves differently in installed vs local contexts.

2. **ARC obligations are secondary to task execution:** The executor completes task work first, then handles tag maintenance before committing. This ensures plan execution is never blocked by annotation housekeeping.

3. **Output format invariance in code-first mode:** The planner always produces standard PLAN.md with frontmatter regardless of mode. Code-first mode changes the INPUT (reading CODE-INVENTORY.md instead of REQUIREMENTS.md), not the OUTPUT structure. This preserves compatibility with the execute-phase orchestrator.

## Deviations from Plan

None -- plan executed exactly as written.

## Known Stubs

None -- both agents are complete and self-contained. No data sources or behavioral components are left unconnected.

## Self-Check: PASSED

- [x] agents/gsd-arc-executor.md exists
- [x] agents/gsd-arc-planner.md exists
- [x] Commit bdf23fd exists (feat(02-03): create gsd-arc-executor wrapper agent)
- [x] Commit ba24d32 exists (feat(02-03): create gsd-arc-planner wrapper agent)
- [x] 104 tests pass, no new failures introduced
- [x] Upstream agent files unmodified
