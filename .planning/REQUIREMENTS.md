# Requirements: GSD Code-First Fork

**Defined:** 2026-03-29
**Core Value:** Code is the plan -- developers build first and extract structured planning from annotated code

## v1.1 Requirements

Requirements for v1.1 Autonomous Prototype & Review Loop. Each maps to roadmap phases.

### ARC Default

- [x] **ARC-01**: arc.enabled defaults to true for all new gsd-code-first installations
- [x] **ARC-02**: Existing projects with explicit arc.enabled: false preserve their setting

### PRD Pipeline

- [x] **PRD-01**: User can run /gsd:prototype with a PRD file auto-detected at .planning/PRD.md
- [x] **PRD-02**: User can specify a PRD path via --prd flag
- [x] **PRD-03**: User is prompted to paste PRD content if no file is found
- [x] **PRD-04**: Each acceptance criterion from the PRD becomes a @gsd-todo tag in prototype code
- [x] **PRD-05**: Prototype iterates autonomously until functional, with a hard iteration cap
- [x] **PRD-06**: User can enable step-by-step mode with --interactive flag
- [x] **PRD-07**: User sees a requirements-found confirmation before scaffold generation begins

### Test Agent

- [x] **TEST-01**: gsd-tester agent writes runnable unit/integration tests for annotated code
- [x] **TEST-02**: gsd-tester executes tests and confirms green before completing
- [x] **TEST-03**: gsd-tester auto-detects the project's test framework (jest, vitest, node:test, etc.)
- [x] **TEST-04**: gsd-tester annotates untested/hard-to-test code paths with @gsd-risk tags
- [x] **TEST-05**: Tests must fail against stubs before passing against implementation (RED-GREEN)

### Review Agent

- [ ] **REV-01**: /gsd:review-code performs Stage 1 review: spec compliance (PRD ACs met?)
- [ ] **REV-02**: /gsd:review-code performs Stage 2 review: code quality (security, maintainability)
- [ ] **REV-03**: Stage 2 only runs if Stage 1 passes
- [ ] **REV-04**: Review includes manual verification steps (UI, navigation, UX checklist)
- [ ] **REV-05**: Review includes actionable next steps for user and agent
- [ ] **REV-06**: Review output written to REVIEW-CODE.md with structured schema for future --fix chaining
- [ ] **REV-07**: gsd-reviewer executes test suite and includes results in review

## v1.2+ Requirements

Deferred to future release. Tracked but not in current roadmap.

### Review Automation

- **REVA-01**: /gsd:review-code --fix pipes structured findings into /gsd:iterate as @gsd-todo tags
- **REVA-02**: PRD template scaffolding via /gsd:prototype --init-prd

### Extended Coverage

- **EXTC-01**: @gsd-coverage tag type for surfacing test coverage gaps in CODE-INVENTORY.md
- **EXTC-02**: Multi-language test runner detection beyond Node.js (Python, Go, Rust)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Parallel test generation across files | Coordination complexity exceeds benefit for single-developer workflow |
| Auto-commit after prototype/test generation | Erodes developer trust; human approval gates are non-negotiable |
| 100% test coverage targeting | Produces coverage theater -- brittle tests, false confidence |
| Remote PRD URLs (Notion, Confluence) | Local file/paste is sufficient for v1.1; remote access adds complexity |
| Single mega-agent for entire pipeline | Context window exhaustion, role confusion, can't restart at failed step |
| Fully autonomous with zero human checkpoints | Agents hallucinate; approval gates are required |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| ARC-01 | Phase 5 | Complete |
| ARC-02 | Phase 5 | Complete |
| PRD-01 | Phase 6 | Complete |
| PRD-02 | Phase 6 | Complete |
| PRD-03 | Phase 6 | Complete |
| PRD-04 | Phase 6 | Complete |
| PRD-05 | Phase 6 | Complete |
| PRD-06 | Phase 6 | Complete |
| PRD-07 | Phase 6 | Complete |
| TEST-01 | Phase 7 | Complete |
| TEST-02 | Phase 7 | Complete |
| TEST-03 | Phase 7 | Complete |
| TEST-04 | Phase 7 | Complete |
| TEST-05 | Phase 7 | Complete |
| REV-01 | Phase 8 | Pending |
| REV-02 | Phase 8 | Pending |
| REV-03 | Phase 8 | Pending |
| REV-04 | Phase 8 | Pending |
| REV-05 | Phase 8 | Pending |
| REV-06 | Phase 8 | Pending |
| REV-07 | Phase 8 | Pending |

**Coverage:**
- v1.1 requirements: 21 total
- Mapped to phases: 21
- Unmapped: 0

---
*Requirements defined: 2026-03-29*
*Last updated: 2026-03-29 after roadmap creation*
