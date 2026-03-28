# Requirements: GSD Code-First Fork

**Defined:** 2026-03-28
**Core Value:** Code is the plan — developers build first and extract structured planning from annotated code

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### ARC Standard

- [x] **ARC-01**: Developer can annotate code with structured @gsd-tags (context, decision, todo, constraint, pattern, ref, risk, api) following a documented standard
- [x] **ARC-02**: ARC standard reference document exists at get-shit-done/references/arc-standard.md with syntax rules, tag definitions, and per-language examples

### Tag Scanner

- [x] **SCAN-01**: Tag scanner in gsd-tools.cjs extracts all @gsd-tags from source files via regex, anchored to comment tokens to avoid false positives in strings/URLs
- [x] **SCAN-02**: Tag scanner outputs structured JSON (for agents) and Markdown (for CODE-INVENTORY.md)
- [x] **SCAN-03**: Tag scanner supports filtering by phase reference and tag type
- [x] **SCAN-04**: Tag scanner is language-agnostic (works on any text file with comments)

### Extract Plan

- [x] **EXTR-01**: extract-plan command invokes tag scanner and writes .planning/prototype/CODE-INVENTORY.md
- [x] **EXTR-02**: CODE-INVENTORY.md groups tags by type, file, and phase reference with summary statistics

### Prototyper

- [ ] **PROT-01**: gsd-prototyper agent builds working prototypes with ARC annotations embedded in code
- [ ] **PROT-02**: prototype command spawns prototyper with PROJECT.md, REQUIREMENTS.md, ROADMAP.md context
- [ ] **PROT-03**: prototype command supports --phases flag for scoping and auto-runs extract-plan on completion
- [ ] **PROT-04**: PROTOTYPE-LOG.md template captures what was built, decisions made, and open @gsd-todos

### Code Planner

- [x] **PLAN-01**: gsd-code-planner agent reads CODE-INVENTORY.md and source code @gsd-tags as primary input
- [x] **PLAN-02**: gsd-code-planner generates compact Markdown plans (no XML, no research, no plan-check)

### Iterate

- [ ] **ITER-01**: iterate command runs the full loop: extract-tags → code-planner → user approval gate → executor
- [ ] **ITER-02**: iterate command supports --verify and --annotate flags
- [ ] **ITER-03**: Approval gate pauses for human review before execution (headless-capable for CI)

### Annotator

- [x] **ANNOT-01**: gsd-annotator agent retroactively annotates existing code with @gsd-tags
- [x] **ANNOT-02**: annotate command spawns annotator and auto-runs extract-plan on completion

### Agent Modifications

- [ ] **AMOD-01**: gsd-executor extended with ARC comment obligation (adds @gsd-decision tags, removes completed @gsd-todo tags)
- [ ] **AMOD-02**: gsd-planner extended with code-based planning mode (reads @gsd-tags as input alongside or instead of requirements docs)
- [ ] **AMOD-03**: Agent modifications are config-gated to preserve upstream compatibility

### Mode Configuration

- [ ] **MODE-01**: set-mode command configures per-phase workflow mode (code-first, plan-first, hybrid)
- [x] **MODE-02**: Config schema extended with phase_modes, arc settings, and default_phase_mode
- [ ] **MODE-03**: deep-plan command wraps discuss-phase + plan-phase for phases needing upfront reasoning

### Distribution

- [ ] **DIST-01**: bin/install.js copies all new agent files and command files during installation
- [ ] **DIST-02**: package.json updated with name "gsd-code-first" and correct bin entry
- [ ] **DIST-03**: Installer markers use GSD_CF_ namespace prefix to avoid conflicts with upstream

### Documentation

- [ ] **DOCS-01**: help command updated to list all new commands with descriptions
- [ ] **DOCS-02**: README.md documents the code-first workflow and installation
- [ ] **DOCS-03**: User guide explains ARC tags, prototype → iterate workflow, and mode switching

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Advanced Extraction

- **ADVX-01**: AST-based tag parsing for higher precision in complex code
- **ADVX-02**: Watch mode for continuous annotation extraction
- **ADVX-03**: CODE-INVENTORY.md pagination for large codebases

### Collaboration

- **COLLAB-01**: Team annotation conventions and shared tag vocabulary
- **COLLAB-02**: Multi-repo / monorepo orchestration support

### Integration

- **INTG-01**: IDE extension for inline ARC tag suggestions
- **INTG-02**: CI/CD integration for automated annotation coverage checks

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| IDE plugin / editor integration | Scope creep; requires per-editor maintenance; CLI-first tool |
| AST-based tag parsing | High complexity, language-specific; regex sufficient for v1 |
| Visual diff viewer / web UI | Mismatches CLI-first nature of the tool |
| Automatic commit/push on iteration | Destroys developer trust; approval gate is table stakes |
| Spec-first enforcement | Opposite of code-first value proposition |
| Custom tag namespace versioning | Operational overhead with no v1 value |
| Multi-repo orchestration | Separate domain problem; single-repo scope |
| Real-time watch mode | Infrastructure complexity not expected by CLI users |
| Breaking changes to original GSD commands | Strands existing users, causes upstream merge conflicts |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| ARC-01 | Phase 1 | Complete |
| ARC-02 | Phase 1 | Complete |
| SCAN-01 | Phase 1 | Complete |
| SCAN-02 | Phase 1 | Complete |
| SCAN-03 | Phase 1 | Complete |
| SCAN-04 | Phase 1 | Complete |
| EXTR-01 | Phase 1 | Complete |
| EXTR-02 | Phase 1 | Complete |
| ANNOT-01 | Phase 1 | Complete |
| ANNOT-02 | Phase 1 | Complete |
| MODE-02 | Phase 1 | Complete |
| PROT-01 | Phase 2 | Pending |
| PROT-02 | Phase 2 | Pending |
| PROT-03 | Phase 2 | Pending |
| PROT-04 | Phase 2 | Pending |
| PLAN-01 | Phase 2 | Complete |
| PLAN-02 | Phase 2 | Complete |
| AMOD-01 | Phase 2 | Pending |
| AMOD-02 | Phase 2 | Pending |
| AMOD-03 | Phase 2 | Pending |
| ITER-01 | Phase 3 | Pending |
| ITER-02 | Phase 3 | Pending |
| ITER-03 | Phase 3 | Pending |
| MODE-01 | Phase 3 | Pending |
| MODE-03 | Phase 3 | Pending |
| DIST-01 | Phase 3 | Pending |
| DIST-02 | Phase 3 | Pending |
| DIST-03 | Phase 3 | Pending |
| DOCS-01 | Phase 3 | Pending |
| DOCS-02 | Phase 3 | Pending |
| DOCS-03 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 31 total
- Mapped to phases: 31
- Unmapped: 0

---
*Requirements defined: 2026-03-28*
*Last updated: 2026-03-28 after roadmap creation*
