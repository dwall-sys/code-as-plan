---
phase: "07"
plan: "02"
subsystem: test-agent
tags: [gsd-tester, agent, add-tests, arc-routing, red-green, gsd-risk]
dependency_graph:
  requires:
    - get-shit-done/bin/lib/test-detector.cjs (from 07-01)
    - gsd-tools detect-test-framework subcommand (from 07-01)
  provides:
    - agents/gsd-tester.md (test-writing agent with RED-GREEN discipline)
    - commands/gsd/add-tests.md (ARC-aware routing to gsd-tester or existing workflow)
  affects:
    - /gsd:add-tests command (now ARC-aware)
tech_stack:
  added:
    - agents/gsd-tester.md (new Claude Code agent, Markdown)
  patterns:
    - Agent YAML frontmatter (name, description, tools, permissionMode, color)
    - 5-step execution flow matching gsd-prototyper.md structure
    - ARC routing pattern (config-get arc.enabled check) from iterate.md
key_files:
  created:
    - agents/gsd-tester.md
  modified:
    - commands/gsd/add-tests.md
decisions:
  - "gsd-tester reads @gsd-api tags as contract specs, not stub behavior -- tests must FAIL against stubs on RED"
  - "add-tests.md uses additive ARC routing: Route A (gsd-tester) when arc.enabled=true AND CODE-INVENTORY.md exists, Route B (existing workflow) otherwise"
  - "GREEN phase deferred (not skipped) for stub-state code -- agent documents deferral explicitly rather than faking GREEN"
metrics:
  duration: "3 minutes"
  completed_date: "2026-03-29"
  tasks_completed: 2
  files_created: 1
  files_modified: 1
requirements_satisfied:
  - TEST-01
  - TEST-02
  - TEST-04
  - TEST-05
---

# Phase 07 Plan 02: gsd-tester Agent and add-tests ARC Routing Summary

**One-liner:** gsd-tester agent using @gsd-api contracts as test specs with 5-step RED-GREEN discipline and @gsd-risk annotation, plus ARC-aware routing added to /gsd:add-tests.

## What Was Built

Created `agents/gsd-tester.md`, a new Claude Code agent that writes runnable tests for annotated prototype code. The agent reads `@gsd-api` tags from CODE-INVENTORY.md as test specifications, writes tests that assert the API contract (not stub return values), confirms RED phase (tests fail against stubs), verifies GREEN phase (tests pass against real implementation), and annotates untested code paths with `@gsd-risk` tags.

Updated `commands/gsd/add-tests.md` to be ARC-aware. When `arc.enabled=true` AND `CODE-INVENTORY.md` exists, the command routes to gsd-tester. When ARC is off or the inventory is absent, the command falls back to the existing add-tests workflow unchanged.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create gsd-tester agent file | 0074939 | agents/gsd-tester.md (261 lines) |
| 2 | Update add-tests.md with ARC routing | 2663d30 | commands/gsd/add-tests.md |

## Verification Results

- `head -10 agents/gsd-tester.md` -- confirms YAML frontmatter with `name: gsd-tester`
- `grep -c '<step' agents/gsd-tester.md` -- returns 5 (5 execution steps confirmed)
- `grep 'detect-test-framework' agents/gsd-tester.md` -- confirms agent uses the subcommand
- `grep '@gsd-risk' agents/gsd-tester.md` -- 14 occurrences (instructions + examples)
- `grep 'config-get arc.enabled' commands/gsd/add-tests.md` -- confirms ARC routing
- `grep 'gsd-tester' commands/gsd/add-tests.md` -- confirms agent spawn reference in Route A
- `grep 'workflows/add-tests.md' commands/gsd/add-tests.md` -- confirms Route B preserved

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None -- agents/gsd-tester.md is a complete agent prompt with no placeholder sections. commands/gsd/add-tests.md has all routes fully specified.

## Self-Check: PASSED
