# Milestones

## v1.2 Brainstorm & Feature Map (Shipped: 2026-03-30)

**Phases completed:** 4 phases (Code-First workflow: PRD → prototype → iterate), 15 commits, 18 requirements

**Key accomplishments:**

- /gsd:brainstorm command with conversational PRD generation, feature grouping, dependency analysis, approval gate, and cross-session BRAINSTORM-LEDGER.md
- /gsd:prototype --architecture mode with convention reading, project skeleton generation, and @gsd-decision annotations at every module boundary
- Feature Map auto-aggregation (FEATURES.md) from PRD ACs + @gsd-tags, coupled to extract-tags for always-current status
- v1.1 tech debt resolved (stale extract-plan ref, non-portable grep -oP) + JSONC tsconfig support
- 57 new tests (convention-reader, skeleton-generator, feature-aggregator) all green

---

## v1.1 Autonomous Prototype & Review Loop (Shipped: 2026-03-29)

**Phases completed:** 4 phases, 6 plans, 3 tasks

**Key accomplishments:**

- ARC annotations enabled by default for new installations; existing opt-out configs preserved
- PRD-to-Prototype pipeline with 3-way PRD resolution, semantic AC extraction, confirmation gate, and @gsd-todo(ref:AC-N) traceability
- Autonomous iteration loop (max 5) with AC_REMAINING exit condition, --interactive pause points, and final report
- Test agent (gsd-tester) with auto-detection of 5 test frameworks, RED-GREEN discipline, and @gsd-risk annotations
- Two-stage review agent (gsd-reviewer) with spec compliance gate, code quality evaluation, test results, and structured REVIEW-CODE.md output

---

## v1.0 GSD Code-First Fork (Shipped: 2026-03-28)

**Phases completed:** 4 phases, 13 plans, 18 tasks

**Key accomplishments:**

- ARC annotation standard v1.0 — versioned spec defining 8 @gsd-tag types, comment-anchor rule, metadata syntax, and per-language examples for the scanner and annotator to implement
- Regex-based @gsd-tag scanner with comment-anchor false-positive prevention, phase/type filtering, and JSON/Markdown output — 21 TDD tests all green
- extract-tags subcommand added to gsd-tools.cjs dispatch and gsd:extract-plan slash command created to produce CODE-INVENTORY.md from @gsd-tag scans
- arc and phase_modes config namespaces added to config.cjs with three-level deep-merge, enabling MODE-02 config validation for Phase 2 agents
- gsd-annotator agent and /gsd:annotate command for retroactive ARC annotation with auto-chain to extract-plan
- gsd-prototyper agent with 5-step ARC-annotated prototype workflow and /gsd:prototype slash command with --phases scoping and auto-chain to extract-plan
- One-liner:
- One-liner:
- set-mode gsd-tools.cjs subcommand + phase_modes.N config validation + two slash command .md files for per-phase mode configuration and chained discuss+plan workflow
- `/gsd:iterate` command that orchestrates the full code-first loop: extract-tags -> gsd-code-planner -> mandatory approval gate -> gsd-arc-executor/gsd-executor, with --non-interactive CI bypass and optional --verify/--annotate post-execution flags
- Help workflow updated with all 6 code-first commands; README.md created as user entry point for gsd-code-first with installation, workflow, ARC tags, and mode switching documentation
- Removed stale execution_context workflow refs from 3 command files and fixed gsd-annotator to pass all 106 agent-frontmatter tests
- README.md Known Limitations section added: ARC wrapper agents are only reachable via /gsd:iterate, not /gsd:execute-phase or /gsd:plan-phase

---
