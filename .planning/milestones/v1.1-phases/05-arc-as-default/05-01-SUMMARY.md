---
phase: 05-arc-as-default
plan: "01"
subsystem: arc-default-config
tags: [arc, config, agent, iterate, tdd]
dependency_graph:
  requires: []
  provides: [arc.enabled-default-true, arc-opt-out-preserved]
  affects: [agents/gsd-arc-executor.md, agents/gsd-arc-planner.md, commands/gsd/iterate.md, tests/config.test.cjs]
tech_stack:
  added: []
  patterns: [node:test TDD, bash fallback strings in agent markdown]
key_files:
  created: []
  modified:
    - agents/gsd-arc-executor.md
    - agents/gsd-arc-planner.md
    - commands/gsd/iterate.md
    - tests/config.test.cjs
decisions:
  - "ARC_ENABLED fallback changed from false to true in all three agent/command files — fresh installs without config.json default to ARC on"
  - "iterate.md step 4 now uses a bash variable with fallback (not bare config-get) and logs which executor was selected and why"
  - "config.cjs left untouched — its hardcoded default was already correct (arc.enabled: true)"
metrics:
  duration: "<5 minutes"
  completed: "2026-03-29"
  tasks_completed: 2
  files_modified: 4
---

# Phase 5 Plan 1: ARC as Default Summary

**One-liner:** Fixed three `|| echo "false"` fallbacks to `|| echo "true"` in agent/command Markdown files so fresh installs default to ARC enabled, added executor selection logging to iterate.md step 4, and added two test assertions proving arc.enabled defaults to true (ARC-01) and explicit false is preserved (ARC-02).

## What Was Built

ARC mode was already `enabled: true` in `config.cjs` for new projects — but the bash fallback strings in agent/command files contradicted this. If `config-get arc.enabled` failed (no config.json yet), agents would default to `"false"` instead of `"true"`. This plan corrected all three fallback sites and added test coverage.

### Changes Made

**agents/gsd-arc-executor.md** (line 53)
- Before: `|| echo "false"`
- After: `|| echo "true"`

**agents/gsd-arc-planner.md** (line 62)
- Before: `|| echo "false"`
- After: `|| echo "true"`
- Line 63 (`PHASE_MODE` fallback to `"plan-first"`) left unchanged

**commands/gsd/iterate.md** (step 4)
- Before: bare `config-get arc.enabled` with prose routing, included "or not set" fallback
- After: bash variable with `|| echo "true"` fallback, logs "ARC mode: enabled -- using gsd-arc-executor" or "ARC mode: disabled (config) -- using gsd-executor" before spawning

**tests/config.test.cjs**
- Added 3 assertions to existing `'creates full config with all expected keys'` test:
  - `config.arc` section exists and is an object
  - `config.arc.enabled === true` (ARC-01)
  - `config.arc.tag_prefix === '@gsd-'`
- Added new test `'explicit arc.enabled false is preserved (ARC-02)'`
- Test count: 48 → 51, all passing

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED
