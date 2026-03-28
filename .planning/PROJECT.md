# GSD Code-First Fork

## What This Is

A fork of the GSD (Get Shit Done) framework that implements the "Code-First" principle. Instead of running discuss → plan → execute for every phase, developers build a prototype directly, annotate the code with structured @gsd-tags (the "ARC" system), and use those annotations as planning input for further iterations. Installable as `npx gsd-code-first@latest`.

## Core Value

Code is the plan — developers build first and extract structured planning from annotated code, eliminating the overhead of upfront document-heavy planning while maintaining traceability.

## Requirements

### Validated

- ✓ ARC annotation standard with @gsd-tags (context, decision, todo, constraint, pattern, ref, risk, api) — Phase 1
- ✓ Tag scanner in gsd-tools.cjs that extracts @gsd-tags from code — Phase 1
- ✓ extract-plan command that generates CODE-INVENTORY.md from tags — Phase 1
- ✓ gsd-annotator agent for retroactive code annotation — Phase 1
- ✓ annotate command that spawns annotator + runs extract-plan — Phase 1
- ✓ Extended config schema (phase_modes, arc settings, default_phase_mode) — Phase 1

### Active

- [ ] gsd-prototyper agent that builds prototypes with ARC annotations
- [ ] prototype command that spawns prototyper with project context
- [ ] gsd-code-planner agent that reads code + tags to generate plans
- [ ] iterate command (extract-tags → code-planner → approval → executor)
- [ ] deep-plan command wrapping discuss-phase + plan-phase
- [ ] set-mode command for per-phase mode configuration
- [ ] Modified gsd-executor with ARC comment obligation
- [ ] Modified gsd-planner with code-based planning mode
- [ ] Updated installer (bin/install.js) with new agents + commands
- [ ] Updated package.json (name: gsd-code-first)
- [ ] Updated help command with new commands
- [ ] User documentation and README for the fork

### Out of Scope

- UI/Frontend — this is a CLI tool, no visual interface
- Breaking changes to original GSD commands — existing workflows must still function
- Custom editor integrations — IDE plugins are out of scope for v1
- Multi-language AST parsing for tags — regex-based extraction is sufficient for v1

## Context

- This is a fork of `get-shit-done-cc` (the original GSD npm package)
- The codebase is JavaScript/Node.js with Markdown for agent prompts and commands, JSON for config
- The ARC (Annotated Reasoning in Code) system is the core innovation — structured comments that serve as both documentation and planning input
- The fork adds new agents, commands, and tooling while preserving all original GSD functionality
- Target audience: developers and teams already using GSD who want a faster, code-centric workflow
- The fork should remain mergeable with upstream GSD updates (primarily additive changes)

## Constraints

- **Tech stack**: JavaScript/Node.js, Markdown, JSON — must match original GSD stack
- **Compatibility**: All original GSD commands must continue working unchanged
- **Distribution**: Must be installable via `npx gsd-code-first@latest`
- **Upstream mergeability**: Primarily additive changes to minimize merge conflicts with upstream

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Fork rather than PR upstream | Fundamentally different workflow philosophy (code-first vs plan-first) | — Pending |
| Regex-based tag extraction | Simpler than AST parsing, language-agnostic, sufficient for structured comments | — Pending |
| ARC annotation standard | Structured @gsd-tags provide machine-readable planning data embedded in code | — Pending |
| Preserve all original commands | Users can mix code-first and plan-first workflows per phase | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-28 after Phase 1 completion*
