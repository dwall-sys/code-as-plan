---
phase: prototype
plan: feature-map
subsystem: feature-aggregator
tags: [feature-map, arc, code-inventory, features-md]
dependency-graph:
  requires: [arc-scanner, extract-tags]
  provides: [aggregate-features, FEATURES.md]
  affects: [gsd-tools.cjs, extract-tags]
tech-stack:
  added: []
  patterns: [auto-chain, derived-artifact]
key-files:
  created:
    - get-shit-done/bin/lib/feature-aggregator.cjs
    - tests/feature-aggregator.test.cjs
    - .planning/FEATURES.md
    - .planning/prototype/CODE-INVENTORY.md
  modified:
    - get-shit-done/bin/gsd-tools.cjs
decisions:
  - AC completion derived from tag presence (absence of @gsd-todo = done)
  - Auto-chain is non-fatal to preserve extract-tags reliability
  - Auto-chain only triggers in file-output mode (not JSON stdout)
metrics:
  duration: 2min
  completed: 2026-03-30T11:31:00Z
  tasks: 4
  files-created: 4
  files-modified: 1
---

# Feature Map: Auto-Aggregated FEATURES.md Summary

Feature aggregator reads PRDs and CODE-INVENTORY.md to produce a derived FEATURES.md showing AC completion status and cross-feature dependencies, auto-chained from extract-tags.

## Tasks Completed

| Task | Description | Commit | Key Files |
|------|-------------|--------|-----------|
| 1 | Verify feature-aggregator.cjs implementations | 2bda43c | feature-aggregator.cjs, feature-aggregator.test.cjs |
| 2 | Wire aggregate-features subcommand into gsd-tools.cjs | f8dbe09 | gsd-tools.cjs |
| 3 | Wire auto-chain from extract-tags into aggregate-features | 2a3c669 | gsd-tools.cjs |
| 4 | End-to-end validation against project artifacts | 3cc1756 | FEATURES.md, CODE-INVENTORY.md |

## Acceptance Criteria Status

| AC | Description | Status |
|----|-------------|--------|
| FMAP-01 | FEATURES.md auto-generated from PRD ACs and code tags | SATISFIED |
| FMAP-02 | Per-AC completion status (done vs. open) | SATISFIED |
| FMAP-03 | Dependencies visualized in FEATURES.md | SATISFIED |
| FMAP-04 | Auto-regeneration on extract-tags run | SATISFIED |
| FMAP-05 | Read-only artifact with timestamp and source-hash header | SATISFIED |

## Deviations from Plan

None -- plan executed exactly as written.

## Known Stubs

None -- all functions are fully implemented with no placeholder logic.

## Self-Check: PASSED

All 4 files verified on disk. All 4 commit hashes confirmed in git log.
