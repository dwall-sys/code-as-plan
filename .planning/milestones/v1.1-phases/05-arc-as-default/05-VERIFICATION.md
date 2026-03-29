---
phase: 05-arc-as-default
verified: 2026-03-29T00:00:00Z
status: passed
score: 4/4 must-haves verified
re_verification: false
---

# Phase 5: ARC as Default Verification Report

**Phase Goal:** New installations have ARC annotations enabled by default and existing configs with explicit false are preserved
**Verified:** 2026-03-29
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Fresh install with no config.json routes to gsd-arc-executor (ARC on by default) | VERIFIED | `agents/gsd-arc-executor.md:53` has `\|\| echo "true"`. `agents/gsd-arc-planner.md:62` has `\|\| echo "true"`. `commands/gsd/iterate.md:88` has `\|\| echo "true"`. All three fallback sites default to ARC enabled when config-get fails. |
| 2 | Existing project with arc.enabled: false routes to gsd-executor (opt-out preserved) | VERIFIED | `config.cjs:174-176` merges `choices.arc` over `hardcoded.arc`. Test `'explicit arc.enabled false is preserved (ARC-02)'` at `tests/config.test.cjs:421` asserts `config.arc.enabled === false` when `choices.arc.enabled = false` is passed. Test passes. |
| 3 | iterate.md logs which executor was selected and why at step 4 | VERIFIED | `commands/gsd/iterate.md:92-93` contains "ARC mode: enabled -- using gsd-arc-executor" and "ARC mode: disabled (config) -- using gsd-executor". Phrase "or not set" confirmed absent. |
| 4 | buildNewProjectConfig({}) returns arc.enabled === true (test proves it) | VERIFIED | `tests/config.test.cjs:390` — `assert.strictEqual(config.arc.enabled, true, 'arc.enabled should default to true')`. `node --test tests/config.test.cjs` exits 0, 51 tests pass, 0 failures. |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `agents/gsd-arc-executor.md` | ARC enabled fallback for fresh installs | VERIFIED | Line 53: `\|\| echo "true"` confirmed. Other `echo "false"` lines on 283-284 are for unrelated workflow flags — not ARC_ENABLED. |
| `agents/gsd-arc-planner.md` | ARC enabled fallback for fresh installs | VERIFIED | Line 62: `\|\| echo "true"` confirmed. Line 63 PHASE_MODE fallback correctly preserved as `\|\| echo "plan-first"`. |
| `commands/gsd/iterate.md` | ARC routing with default-true fallback and log line | VERIFIED | Line 88: `\|\| echo "true"`. Lines 92-93: both routing log strings present. |
| `tests/config.test.cjs` | Test assertion for arc.enabled default | VERIFIED | Lines 388-391: arc section assertions. Lines 421-432: ARC-02 test. All pass. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `commands/gsd/iterate.md` | `agents/gsd-arc-executor.md` | Step 4 routing spawns arc-executor when ARC_ENABLED is true | WIRED | Line 92: "spawn `gsd-arc-executor` via the Task tool" when ARC_ENABLED is `true`. Pattern `echo "true"` confirmed at line 88. |
| `tests/config.test.cjs` | `get-shit-done/bin/lib/config.cjs` | Test asserts buildNewProjectConfig returns arc.enabled: true | WIRED | Pattern `config\.arc\.enabled.*true` confirmed at line 390. Test runs against actual `config-new-project` command which calls `buildNewProjectConfig`. All 51 tests pass. |

### Data-Flow Trace (Level 4)

Not applicable — this phase modifies Markdown agent files and test assertions, not React components or dynamic data pipelines. The config.cjs function `buildNewProjectConfig` is the data source and is verified directly by the test suite.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All config tests pass including new arc.enabled assertions | `node --test tests/config.test.cjs` | 51 pass, 0 fail | PASS |
| No ARC_ENABLED lines still use `echo "false"` | `grep 'echo "false"' ... \| grep ARC_ENABLED` | No output (exit 1) | PASS |
| "or not set" phrase absent from iterate.md | `grep "or not set" commands/gsd/iterate.md` | NOT_FOUND | PASS |
| config.cjs arc.enabled hardcoded default is true | `grep -A3 "arc:" config.cjs` | `enabled: true` at line 141 | PASS |
| config.cjs unchanged from HEAD | `git diff HEAD get-shit-done/bin/lib/config.cjs` | No diff output | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| ARC-01 | 05-01-PLAN.md | arc.enabled defaults to true for all new gsd-code-first installations | SATISFIED | Three fallback strings changed to `"true"`. `config.cjs:141` hardcoded default `enabled: true`. Test at line 390 asserts `config.arc.enabled === true`. |
| ARC-02 | 05-01-PLAN.md | Existing projects with explicit arc.enabled: false preserve their setting | SATISFIED | `config.cjs:174-176` merge preserves user choices. Dedicated test `'explicit arc.enabled false is preserved (ARC-02)'` at line 421 passes. |

No orphaned requirements found. Both ARC-01 and ARC-02 are marked `[x]` in REQUIREMENTS.md and both map to Phase 5.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `agents/gsd-arc-executor.md` | 283-284 | `\|\| echo "false"` for workflow flags | Info | These are for `_auto_chain_active` and `auto_advance` — unrelated to ARC_ENABLED. Not a stub; correct default for those flags. |

No blockers or warnings. The `echo "false"` occurrences on lines 283-284 of gsd-arc-executor.md are for different config keys (`workflow._auto_chain_active`, `workflow.auto_advance`) where `false` is the correct default. They were correctly left unchanged by the plan.

### Human Verification Required

None. All verification objectives are programmatically testable and confirmed.

## Gaps Summary

No gaps. All four observable truths are verified, all artifacts pass all applicable levels (exists, substantive, wired), both requirements are satisfied, and the test suite passes with 0 failures across 51 tests.

---

_Verified: 2026-03-29_
_Verifier: Claude (gsd-verifier)_
