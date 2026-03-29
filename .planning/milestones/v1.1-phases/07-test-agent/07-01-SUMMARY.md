---
phase: "07"
plan: "01"
subsystem: test-detector
tags: [test-framework-detection, cjs-module, gsd-tools, tdd, node-test]
dependency_graph:
  requires: []
  provides:
    - get-shit-done/bin/lib/test-detector.cjs (detectTestFramework function)
    - gsd-tools detect-test-framework subcommand
  affects:
    - get-shit-done/bin/gsd-tools.cjs (new subcommand added)
tech_stack:
  added:
    - get-shit-done/bin/lib/test-detector.cjs (Node.js built-ins only: fs, path)
  patterns:
    - Zero-dependency CJS module (fs + path only)
    - node:test + node:assert for tests
    - gsd-tools.cjs inline require() for lib modules
key_files:
  created:
    - get-shit-done/bin/lib/test-detector.cjs
    - tests/test-detector.test.cjs
  modified:
    - get-shit-done/bin/gsd-tools.cjs
decisions:
  - "detectTestFramework returns node:test fallback for missing/invalid package.json — safe default on all Node.js >=20"
  - "Priority order: vitest > jest > mocha > ava > node:test script > fallback — matches ecosystem adoption order"
  - "gsd-tools subcommand accepts optional <dir> arg, defaults to cwd — matches existing subcommand pattern"
metrics:
  duration: "2 minutes"
  completed_date: "2026-03-29"
  tasks_completed: 2
  files_created: 2
  files_modified: 1
requirements_satisfied:
  - TEST-03
---

# Phase 07 Plan 01: test-detector.cjs Summary

**One-liner:** Zero-dependency CJS module detecting vitest, jest, mocha, ava, and node:test from package.json with gsd-tools subcommand for agent access.

## What Was Built

Created `test-detector.cjs`, a pure utility module that reads a target project's `package.json` and returns the test framework in use. Integrated it as the `detect-test-framework` subcommand in `gsd-tools.cjs` so the gsd-tester agent (Plan 02) can invoke detection via a standard Bash call.

The module follows the zero-dependency constraint: only `fs` and `path` built-ins. Detection priority is deterministic: vitest > jest > mocha > ava > node:test (via `--test` script flag) > node:test (fallback).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Add failing tests for detectTestFramework | 76ec2b1 | tests/test-detector.test.cjs |
| 1 (GREEN) | Implement detectTestFramework | e8a4991 | get-shit-done/bin/lib/test-detector.cjs |
| 2 | Add detect-test-framework subcommand | 4a6fa62 | get-shit-done/bin/gsd-tools.cjs |

## Verification Results

- `node --test tests/test-detector.test.cjs` — 11/11 tests pass
- `node gsd-tools.cjs detect-test-framework` — returns JSON with framework, testCommand, filePattern
- `node gsd-tools.cjs detect-test-framework /tmp` — returns node:test fallback
- `node --test tests/config.test.cjs` — 51/51 existing tests pass (no regressions)

## Deviations from Plan

None - plan executed exactly as written.

Note: The plan's verify command used `--raw` expecting JSON, but in gsd-tools.cjs `--raw=true` outputs human-readable strings and no `--raw` outputs JSON. This is the established convention throughout gsd-tools. The subcommand was implemented correctly per this convention; the verify command in the plan had a minor documentation inaccuracy in the flag direction, not affecting implementation correctness.

## Known Stubs

None — all functionality fully implemented and wired.

## Self-Check: PASSED
