---
phase: 01-annotation-foundation
plan: 01
subsystem: documentation
tags: [arc, annotations, gsd-tags, reference, specification]

# Dependency graph
requires: []
provides:
  - ARC annotation standard v1.0 at get-shit-done/references/arc-standard.md
  - Frozen tag syntax (8 tag types, comment-anchor rule, metadata format)
  - Per-language examples for JavaScript, Python, Go, Rust, SQL, Shell
  - Scanner JSON object shape specification
affects: [arc-scanner, gsd-annotator, extract-plan, code-inventory, plan-02, plan-03, plan-04, plan-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Reference document pattern: versioned Markdown spec with header block, sections, code examples"

key-files:
  created:
    - get-shit-done/references/arc-standard.md
  modified: []

key-decisions:
  - "Tag names are frozen as of v1.0 — @gsd-context, @gsd-decision, @gsd-todo, @gsd-constraint, @gsd-pattern, @gsd-ref, @gsd-risk, @gsd-api will not be renamed"
  - "Comment anchor rule documented: tags only valid when comment token is first non-whitespace content on the line"
  - "Metadata is always a flat key-value object (no nesting, all values strings)"

patterns-established:
  - "ARC standard v1.0 is the ground truth — all scanner code and agent prompts implement what this document defines"

requirements-completed: [ARC-01, ARC-02]

# Metrics
duration: 2min
completed: 2026-03-28
---

# Phase 1 Plan 01: Write ARC Annotation Standard Summary

**ARC annotation standard v1.0 — versioned spec defining 8 @gsd-tag types, comment-anchor rule, metadata syntax, and per-language examples for the scanner and annotator to implement**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-28T19:24:42Z
- **Completed:** 2026-03-28T19:26:33Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Created `get-shit-done/references/arc-standard.md` with version 1.0 and stability guarantee
- Defined all 8 tag types (@gsd-context, @gsd-decision, @gsd-todo, @gsd-constraint, @gsd-pattern, @gsd-ref, @gsd-risk, @gsd-api) with purpose, usage guidance, and realistic code examples
- Documented the comment-anchor rule with VALID/INVALID side-by-side examples
- Documented the scanner JSON object shape (type, file, line, metadata, description, raw fields)
- Provided per-language examples for JavaScript/TypeScript, Python, Go, Rust, SQL, and Shell

## Task Commits

Each task was committed atomically:

1. **Task 1: Write arc-standard.md** - `340b35a` (feat)

**Plan metadata:** (to be committed with SUMMARY.md)

## Files Created/Modified
- `get-shit-done/references/arc-standard.md` - Complete ARC annotation standard v1.0 spec

## Decisions Made
- Followed all locked decisions D-01 through D-04 from CONTEXT.md exactly as specified
- Used exact stability guarantee text from the plan: "Tag names and parenthesized keys will not change in v1.x. New optional metadata keys may be added in future versions. Tag types will not be renamed."
- Included `//+` and `*` (block comment continuation) as valid comment tokens per the plan's Comment Anchor Rule section

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- arc-standard.md is the frozen spec that Plan 02 (arc-scanner.cjs) and Plan 03 (extract-tags command) implement
- The comment-anchor regex in RESEARCH.md Pitfall 1 implements the rule documented in this spec
- Scanner JSON object shape is documented here and must match what arc-scanner.cjs produces

---
*Phase: 01-annotation-foundation*
*Completed: 2026-03-28*
