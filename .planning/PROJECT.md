# GSD Code-First Fork

## What This Is

A fork of the GSD (Get Shit Done) framework that implements the "Code-First" principle. Developers brainstorm ideas in conversation, build prototypes from PRDs, annotate code with @gsd-tags, iterate with AI planning, run tests, and get two-stage reviews -- all from the CLI. Installable as `npx gsd-code-first@latest`.

Shipped v1.2 with brainstorm command, feature map, and architecture mode.

## Core Value

Code is the plan -- developers build first and extract structured planning from annotated code, eliminating the overhead of upfront document-heavy planning while maintaining traceability.

## Requirements

### Validated

- ✓ ARC annotation standard with 8 @gsd-tag types -- v1.0
- ✓ Tag scanner with regex extraction, false-positive prevention, phase/type filtering -- v1.0
- ✓ extract-plan command producing CODE-INVENTORY.md -- v1.0
- ✓ gsd-annotator agent for retroactive code annotation -- v1.0
- ✓ annotate command with auto-chain to extract-plan -- v1.0
- ✓ Config schema extended (phase_modes, arc settings, default_phase_mode) -- v1.0
- ✓ gsd-prototyper agent building annotated scaffolds -- v1.0
- ✓ prototype command with --phases scoping and auto-chain -- v1.0
- ✓ gsd-code-planner reading CODE-INVENTORY.md to produce compact plans -- v1.0
- ✓ gsd-arc-executor wrapper with ARC comment obligations -- v1.0
- ✓ gsd-arc-planner wrapper with code-based planning mode -- v1.0
- ✓ iterate command (flagship code-first loop with approval gate) -- v1.0
- ✓ deep-plan command chaining discuss-phase + plan-phase -- v1.0
- ✓ set-mode command for per-phase mode configuration -- v1.0
- ✓ Installer verified (wholesale copy of agents/ and commands/) -- v1.0
- ✓ package.json with name gsd-code-first -- v1.0
- ✓ Help command with all Code-First commands -- v1.0
- ✓ README.md with installation, workflow, and user guide -- v1.0
- ✓ ARC annotations enabled by default for new installations -- v1.1
- ✓ PRD-to-Prototype pipeline with AC extraction, confirmation gate, autonomous iteration loop -- v1.1
- ✓ gsd-tester agent with RED-GREEN discipline, test-detector.cjs, @gsd-risk annotation -- v1.1
- ✓ gsd-reviewer agent and /gsd:review-code command with two-stage evaluation -- v1.1
- ✓ /gsd:brainstorm conversational PRD generation with feature grouping and ledger -- v1.2
- ✓ /gsd:prototype --architecture skeleton-first mode with convention reading -- v1.2
- ✓ Feature Map (FEATURES.md) auto-aggregated from PRDs + @gsd-tags, coupled to extract-tags -- v1.2
- ✓ v1.1 tech debt resolved (extract-plan ref, grep portability, JSONC support) -- v1.2

### Active

(None -- next milestone not yet defined)

### Out of Scope

- UI/Frontend -- this is a CLI tool, no visual interface
- Breaking changes to original GSD commands -- existing workflows must still function
- Custom editor integrations -- IDE plugins are out of scope
- Multi-language AST parsing for tags -- regex-based extraction is sufficient
- Parallel test generation across files -- coordination complexity exceeds benefit
- Auto-commit after prototype/test generation -- human approval gates are non-negotiable
- Remote PRD URLs (Notion, Confluence) -- local file/paste is sufficient
- Fully autonomous with zero human checkpoints -- agents hallucinate; approval gates required
- Brainstorm auto-chains to prototype without stop -- PRD is the error-correction surface
- FEATURES.md manually editable -- derived artifact, overwritten on regeneration
- Architecture mode replaces dedicated scaffolding tools -- annotates decisions, delegates boilerplate
- Line-level code coverage per feature in Feature Map -- false signals erode trust

## Context

- Shipped v1.0 on 2026-03-28 with 4 phases, 13 plans
- Shipped v1.1 on 2026-03-29 with 4 phases, 6 plans
- Shipped v1.2 on 2026-03-30 with 4 phases (Code-First workflow), 15 commits
- Tech stack: JavaScript/Node.js (CJS), Markdown agents/commands, JSON config
- Zero runtime dependencies -- all tooling uses Node.js built-ins
- 7 agents: gsd-prototyper, gsd-code-planner, gsd-arc-executor, gsd-arc-planner, gsd-tester, gsd-reviewer, gsd-brainstormer
- 10 commands: brainstorm, prototype (with --architecture), iterate, annotate, extract-plan, set-mode, deep-plan, add-tests, review-code
- 3 CJS utilities: test-detector.cjs, feature-aggregator.cjs, convention-reader.cjs, skeleton-generator.cjs
- 57 new tests in v1.2 (convention-reader: 22, skeleton-generator: 16, feature-aggregator: 19)

## Constraints

- **Tech stack**: JavaScript/Node.js, Markdown, JSON -- must match original GSD stack
- **Compatibility**: All original GSD commands must continue working unchanged
- **Distribution**: Must be installable via `npx gsd-code-first@latest`
- **Upstream mergeability**: Primarily additive changes to minimize merge conflicts with upstream
- **Zero runtime deps**: No external npm packages at runtime

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Fork rather than PR upstream | Fundamentally different workflow philosophy (code-first vs plan-first) | ✓ Good -- clean separation, no upstream conflicts |
| Regex-based tag extraction | Simpler than AST parsing, language-agnostic, sufficient for structured comments | ✓ Good -- handles all test cases, zero false positives |
| ARC annotation standard | Structured @gsd-tags provide machine-readable planning data embedded in code | ✓ Good -- 8 tag types frozen at v1.0, stable spec |
| Preserve all original commands | Users can mix code-first and plan-first workflows per phase | ✓ Good -- zero regressions in original functionality |
| Wrapper agents over patches | New gsd-arc-executor/planner files instead of modifying upstream agents | ✓ Good -- upstream files untouched, merge-safe |
| PRD ingestion in command layer | prototype.md orchestrator handles PRD, not agent | ✓ Good -- agent stays reusable across PRD formats |
| Two-stage review gate | Stage 2 only runs if Stage 1 passes | ✓ Good -- prevents wasted review cycles |
| RED-GREEN discipline | Tests must fail against stubs before passing against implementation | ✓ Good -- ensures meaningful tests |
| Brainstorm → PRD → Prototype pipeline | Conversation produces PRD, PRD feeds prototype, no auto-chain | ✓ Good -- human reviews PRD before code generation |
| Feature Map derived from code | FEATURES.md aggregated from PRD ACs + @gsd-tags, never manually edited | ✓ Good -- always in sync with actual code |
| Architecture mode as flag | --architecture on existing /gsd:prototype, not a separate command | ✓ Good -- one command, two modes, no surface area bloat |
| Code-First workflow for v1.2 | PRD → prototype → iterate instead of discuss → plan → execute | ✓ Good -- faster, fewer tokens, less overhead |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? -> Move to Out of Scope with reason
2. Requirements validated? -> Move to Validated with phase reference
3. New requirements emerged? -> Add to Active
4. Decisions to log? -> Add to Key Decisions
5. "What This Is" still accurate? -> Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check -- still the right priority?
3. Audit Out of Scope -- reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-30 after v1.2 milestone completion*
