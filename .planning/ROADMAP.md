# Roadmap: GSD Code-First Fork

## Overview

Three phases take GSD Code-First from zero to a shippable npm package. Phase 1 locks down the ARC annotation standard and builds the tag scanner — the foundation everything else depends on. Phase 2 delivers the three new agents that power code-first development: the prototyper that generates annotated code, the annotator that retrofits existing code, and the code-planner that reads annotations to produce plans. Phase 3 wires the full iterate loop, adds workflow commands, updates the installer, and ships documentation — producing a distributable `npx gsd-code-first@latest` package.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Annotation Foundation** - ARC standard, tag scanner, config schema, and extract-plan command (completed 2026-03-28)
- [ ] **Phase 2: Core Agents** - gsd-prototyper, gsd-annotator, gsd-code-planner, and modified agent behavior
- [ ] **Phase 3: Workflow, Distribution, and Docs** - iterate loop, mode commands, installer, and documentation

## Phase Details

### Phase 1: Annotation Foundation
**Goal**: Developers can annotate code with @gsd-tags following a stable standard and extract those annotations into a structured CODE-INVENTORY.md artifact
**Depends on**: Nothing (first phase)
**Requirements**: ARC-01, ARC-02, SCAN-01, SCAN-02, SCAN-03, SCAN-04, EXTR-01, EXTR-02, MODE-02, ANNOT-01, ANNOT-02
**Success Criteria** (what must be TRUE):
  1. Developer can write @gsd-tags in any language's comment format and find them documented in arc-standard.md with syntax rules and examples
  2. Running `extract-plan` on an annotated codebase produces a .planning/prototype/CODE-INVENTORY.md grouped by tag type, file, and phase reference
  3. Tag scanner correctly extracts tags anchored to comment tokens and does not produce false positives from strings, URLs, or template literals
  4. Tag scanner supports filtering by phase reference and tag type, and works on any text file without language-specific configuration
  5. Running `annotate` on an existing unannotated codebase produces annotated code files and auto-generates CODE-INVENTORY.md on completion
**Plans**: 5 plans

Plans:
- [x] 01-01-PLAN.md — Write arc-standard.md (ARC annotation standard v1.0)
- [x] 01-02-PLAN.md — Build arc-scanner.cjs with TDD (regex scanner + test suite)
- [x] 01-03-PLAN.md — Wire extract-tags subcommand in gsd-tools.cjs + create extract-plan command
- [x] 01-04-PLAN.md — Extend config.cjs with arc and phase_modes schema
- [x] 01-05-PLAN.md — Create gsd-annotator agent + annotate slash command

### Phase 2: Core Agents
**Goal**: Developers can build annotated prototypes from scratch or have existing code annotated, and a code-planner agent reads those annotations to produce execution plans
**Depends on**: Phase 1
**Requirements**: PROT-01, PROT-02, PROT-03, PROT-04, PLAN-01, PLAN-02, AMOD-01, AMOD-02, AMOD-03
**Success Criteria** (what must be TRUE):
  1. Running `prototype` spawns gsd-prototyper with PROJECT.md, REQUIREMENTS.md, and ROADMAP.md context and produces working code with @gsd-tags already embedded
  2. Running `prototype --phases 2` scopes the prototype to a specific phase and auto-runs extract-plan on completion
  3. gsd-code-planner reads CODE-INVENTORY.md and source @gsd-tags as primary input and generates a compact Markdown plan without XML or research sections
  4. gsd-executor adds @gsd-decision tags and removes completed @gsd-todo tags during execution, and this behavior is gated by config so it does not affect users who have not opted in
  5. gsd-planner can read @gsd-tags as planning input when code-based planning mode is enabled in config
**Plans**: TBD

### Phase 3: Workflow, Distribution, and Docs
**Goal**: The complete code-first workflow is available as an installable npm package with full documentation
**Depends on**: Phase 2
**Requirements**: ITER-01, ITER-02, ITER-03, MODE-01, MODE-03, DIST-01, DIST-02, DIST-03, DOCS-01, DOCS-02, DOCS-03
**Success Criteria** (what must be TRUE):
  1. Running `iterate` executes the full extract-tags → code-planner → user approval gate → executor loop, pausing for human review before execution and supporting --non-interactive for CI
  2. Running `set-mode code-first` configures the per-phase workflow mode and the active mode is visible at command startup
  3. Running `deep-plan` invokes discuss-phase followed by plan-phase for phases requiring upfront reasoning
  4. Running `npx gsd-code-first@latest` installs all new agents and commands with GSD_CF_ namespaced markers that do not conflict with upstream GSD installations
  5. Developer new to the tool can find the ARC annotation workflow, prototype → iterate pattern, and mode switching explained in the README and user guide
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Annotation Foundation | 5/5 | Complete   | 2026-03-28 |
| 2. Core Agents | 0/TBD | Not started | - |
| 3. Workflow, Distribution, and Docs | 0/TBD | Not started | - |
