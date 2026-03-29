---
phase: 08-review-agent-command
plan: "01"
subsystem: review-pipeline
tags:
  - review
  - two-stage
  - spec-compliance
  - code-quality
  - agent

dependency_graph:
  requires:
    - "07-01: gsd-tester agent (detect-test-framework subcommand)"
    - "06-01: prototype pipeline (@gsd-todo ref:AC-N tags in CODE-INVENTORY.md)"
  provides:
    - "commands/gsd/review-code.md: /gsd:review-code command orchestrator"
    - "agents/gsd-reviewer.md: two-stage review evaluation agent"
  affects:
    - ".planning/prototype/REVIEW-CODE.md: output artifact (written by gsd-reviewer)"

tech_stack:
  added: []
  patterns:
    - "Command orchestrator with test execution and agent spawning (prototype.md pattern)"
    - "Five-step agent execution flow (gsd-tester.md pattern)"
    - "YAML frontmatter schema designed for future --fix chaining"
    - "Stage gate: Stage 2 only runs if Stage 1 passes (hard rule, no threshold)"
    - "AC resolution priority chain: CODE-INVENTORY.md -> PRD.md -> REQUIREMENTS.md -> skip"

key_files:
  created:
    - commands/gsd/review-code.md
    - agents/gsd-reviewer.md
  modified: []

decisions:
  - "Two-stage gate enforced in command layer (not delegated to agent judgment) -- gate logic passed via Task() prompt"
  - "Test execution stays in command layer (detect-test-framework + Bash) -- agent receives results as context"
  - "Stage 2 gated: any Stage 1 AC failure sets stage2_result=SKIPPED, agent skips step 3"
  - "next_steps array capped at 5 with file/severity/action for future --fix chaining"
  - "No Edit tool in gsd-reviewer -- reviewer never modifies source code"
  - "REVIEW-CODE.md written atomically (single Write call) per Pitfall 6"
  - "No tests found = absence case, not failure -- TESTS_FOUND=false handled separately"

metrics:
  duration: "3 minutes"
  completed_date: "2026-03-29T12:38:51Z"
  tasks_completed: 2
  files_created: 2
  files_modified: 0
---

# Phase 8 Plan 1: Review Agent + Command Summary

**One-liner:** Two-stage /gsd:review-code command with gsd-reviewer agent -- runs tests, checks spec compliance per AC, evaluates code quality (gated), writes structured REVIEW-CODE.md with YAML next_steps array and max-5 severity-ranked actionable items.

## What Was Built

Two new files completing the v1.1 Autonomous Prototype & Review Loop:

1. **`commands/gsd/review-code.md`** -- Command orchestrator that:
   - Detects test framework via `detect-test-framework` and runs test suite in command layer
   - Resolves AC list via priority chain: CODE-INVENTORY.md `ref:AC-N` tags → PRD.md re-extraction → REQUIREMENTS.md fallback → skip Stage 1
   - Spawns gsd-reviewer via Task() with all context (test results, AC list, gate instructions)
   - Reads completed REVIEW-CODE.md and presents formatted summary via AskUserQuestion
   - Handles no-tests-found case: absence ≠ failure (Pitfall 4)

2. **`agents/gsd-reviewer.md`** -- Five-step review evaluation agent that:
   - Step 1: Loads CLAUDE.md, CODE-INVENTORY.md, PROTOTYPE-LOG.md, PRD.md
   - Step 2 (Stage 1): Checks each AC against code evidence -- PASS (cite file:line) or FAIL (no evidence)
   - Step 3 (Stage 2): Security, maintainability, error handling, edge cases -- ONLY if Stage 1 passed
   - Step 4: Writes REVIEW-CODE.md atomically with YAML frontmatter + all sections
   - Step 5: Reports summary to /gsd:review-code command

## Deviations from Plan

None -- plan executed exactly as written.

## Known Stubs

None -- both files are complete orchestration/agent prompt files with no stub data.

## Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create /gsd:review-code command | a94f849 | commands/gsd/review-code.md |
| 2 | Create gsd-reviewer agent | f95c33e | agents/gsd-reviewer.md |

## Self-Check: PASSED

- commands/gsd/review-code.md: FOUND
- agents/gsd-reviewer.md: FOUND
- Commit a94f849: FOUND
- Commit f95c33e: FOUND
