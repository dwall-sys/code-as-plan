# Requirements: GSD Code-First Fork

**Defined:** 2026-03-30
**Core Value:** Code is the plan -- developers build first and extract structured planning from annotated code

## v1.2 Requirements

Requirements for v1.2 Brainstorm & Feature Map. Each maps to roadmap phases.

### Tech Debt

- [ ] **DEBT-01**: Fix `extract-plan` stale ref in gsd-tester.md:221 (should be `extract-tags`)
- [ ] **DEBT-02**: Fix `grep -oP` non-portable in review-code.md:103 (replace with `grep -oE "ref:AC-[0-9]+"`)

### Brainstorm

- [ ] **BRAIN-01**: User can run `/gsd:brainstorm` and have a conversational exchange that produces a structured PRD with acceptance criteria
- [ ] **BRAIN-02**: gsd-brainstormer agent asks targeted questions one at a time, building understanding before drafting the PRD
- [ ] **BRAIN-03**: Brainstorm output is a valid `.planning/PRD.md` (or `PRD-[slug].md`) that `/gsd:prototype` can consume without modification
- [ ] **BRAIN-04**: Agent clusters features into groups and surfaces cross-feature dependencies before writing PRDs
- [ ] **BRAIN-05**: Agent can output multiple scoped PRD files when features are independent (e.g., `PRD-auth.md`, `PRD-dashboard.md`)
- [ ] **BRAIN-06**: User sees a PRD summary and confirms before the file is written (approval gate)
- [ ] **BRAIN-07**: Brainstorm decisions are persisted to `.planning/BRAINSTORM-LEDGER.md` for cross-session continuity

### Feature Map

- [ ] **FMAP-01**: `FEATURES.md` is auto-generated from PRD acceptance criteria and `@gsd-tags` in code
- [ ] **FMAP-02**: Each feature shows AC completion status (done vs. open `@gsd-todo` tags remaining)
- [ ] **FMAP-03**: Feature dependencies are visualized in FEATURES.md
- [ ] **FMAP-04**: `FEATURES.md` is regenerated automatically when `extract-tags` runs (coupled, not on-demand)
- [ ] **FMAP-05**: `FEATURES.md` is a derived read-only artifact -- never manually edited

### Architecture Mode

- [ ] **ARCH-01**: User can run `/gsd:prototype --architecture` to generate a project skeleton with folder structure, config, and typed interfaces
- [ ] **ARCH-02**: Architecture mode produces `@gsd-decision` and `@gsd-context` tags explaining structural choices
- [ ] **ARCH-03**: gsd-prototyper reads existing project conventions (package.json, tsconfig, etc.) before generating skeleton
- [ ] **ARCH-04**: Architecture skeleton contains zero feature implementation -- only structure, interfaces, and stubs

## v1.3+ Requirements

Deferred to future release. Tracked but not in current roadmap.

### Review Automation

- **REVA-01**: `/gsd:review-code --fix` pipes structured findings into `/gsd:iterate` as `@gsd-todo` tags
- **REVA-02**: PRD template scaffolding via `/gsd:prototype --init-prd`

### Extended Coverage

- **EXTC-01**: `@gsd-coverage` tag type for surfacing test coverage gaps in CODE-INVENTORY.md
- **EXTC-02**: Multi-language test runner detection beyond Node.js (Python, Go, Rust)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Brainstorm auto-chains to prototype without stop | PRD is the error-correction surface; skipping it amplifies hallucinations |
| FEATURES.md is manually editable | Derived artifact -- manual edits overwritten on regeneration |
| Architecture mode replaces dedicated scaffolding tools | GSD annotates decisions, delegates boilerplate to create-next-app etc. |
| Line-level code coverage per feature in Feature Map | Requires 100% tag discipline; false 0% signals erode trust |
| Remote PRD URLs (Notion, Confluence) | Local file/paste is sufficient; remote access adds complexity |
| Brainstorm generates code directly (skip PRD) | Spec is the checkpoint; removing it removes error correction |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DEBT-01 | Phase 9 | Pending |
| DEBT-02 | Phase 9 | Pending |
| BRAIN-01 | Phase 10 | Pending |
| BRAIN-02 | Phase 10 | Pending |
| BRAIN-03 | Phase 10 | Pending |
| BRAIN-04 | Phase 10 | Pending |
| BRAIN-05 | Phase 10 | Pending |
| BRAIN-06 | Phase 10 | Pending |
| BRAIN-07 | Phase 10 | Pending |
| FMAP-01 | Phase 12 | Pending |
| FMAP-02 | Phase 12 | Pending |
| FMAP-03 | Phase 12 | Pending |
| FMAP-04 | Phase 12 | Pending |
| FMAP-05 | Phase 12 | Pending |
| ARCH-01 | Phase 11 | Pending |
| ARCH-02 | Phase 11 | Pending |
| ARCH-03 | Phase 11 | Pending |
| ARCH-04 | Phase 11 | Pending |

**Coverage:**
- v1.2 requirements: 18 total
- Mapped to phases: 18
- Unmapped: 0

---
*Requirements defined: 2026-03-30*
*Last updated: 2026-03-30 after roadmap creation*
