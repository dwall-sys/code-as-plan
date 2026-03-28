---
phase: 02-core-agents
plan: "02"
subsystem: agents
tags: [agent, code-planner, arc, planning]
dependency_graph:
  requires:
    - 01-04 (extract-tags command and CODE-INVENTORY.md output)
    - 01-05 (gsd-annotator as structural template)
  provides:
    - agents/gsd-code-planner.md
  affects:
    - iterate command (future, uses this agent)
    - CODE-PLAN.md output format
tech_stack:
  added: []
  patterns:
    - "Agent frontmatter with commented hooks block"
    - "Anti-heredoc instruction in file-writing agents"
    - "extract-tags --format json for supplementary tag scan"
key_files:
  created:
    - agents/gsd-code-planner.md
  modified: []
decisions:
  - "Code-planner reads CODE-INVENTORY.md as primary input (D-08)"
  - "Code-planner bans XML output, research sections, plan-check blocks (D-09)"
  - "Plans are compact enough for single executor pass (D-10)"
  - "@gsd-todo tags become tasks; @gsd-context/@gsd-decision become context; @gsd-constraint become hard limits"
metrics:
  duration: "2min"
  completed_date: "2026-03-28"
  tasks_completed: 1
  files_changed: 1
---

# Phase 02 Plan 02: gsd-code-planner Agent Summary

**One-liner:** Code-planner agent that reads CODE-INVENTORY.md and extract-tags JSON to produce compact Markdown plans from @gsd-todo annotations -- no XML, no research sections.

## What Was Built

Created `agents/gsd-code-planner.md` -- the bridge between annotated code and execution. The agent:

1. Reads `.planning/prototype/CODE-INVENTORY.md` as primary planning input
2. Runs `extract-tags --format json` for supplementary file/line context
3. Maps each @gsd-todo to a task with Files, Action, and Done-when fields
4. Writes a compact Markdown plan to `.planning/prototype/CODE-PLAN.md`
5. Explicitly bans XML output, research sections, and plan-check blocks per D-09

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Create gsd-code-planner agent | 9826e41 | agents/gsd-code-planner.md |

## Verification

- `node --test tests/agent-frontmatter.test.cjs` -- 96 pass, 2 fail (same 2 pre-existing gsd-annotator failures; no new failures introduced)
- gsd-code-planner passes all 4 frontmatter subtests: anti-heredoc, no skills:, commented hooks, valid name/description/tools/color

## Decisions Made

1. **Tag-to-section mapping:** @gsd-todo -> tasks, @gsd-context/@gsd-decision -> Context section, @gsd-constraint -> Constraints subsection, @gsd-risk -> Risks subsection, @gsd-api -> Done-when criteria, @gsd-pattern -> Action instructions, @gsd-ref -> requirement traceability in Success Criteria
2. **Output path locked:** Plans always write to `.planning/prototype/CODE-PLAN.md` (consistent with CODE-INVENTORY.md colocation)
3. **Task grouping threshold:** 10+ @gsd-todo tags triggers grouping into combined tasks; target 2-8 total tasks per plan

## Deviations from Plan

None -- plan executed exactly as written.

## Known Stubs

None -- agent is complete and functional as a prompt file.

## Self-Check: PASSED

- `agents/gsd-code-planner.md` exists: FOUND
- Commit 9826e41 exists: FOUND
- agent-frontmatter tests: 96 pass, 2 fail (no regression)
