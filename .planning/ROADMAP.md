# Roadmap: GSD Code-First Fork

## Milestones

- v1.0 GSD Code-First Fork -- Phases 1-4 (shipped 2026-03-28)
- v1.1 Autonomous Prototype & Review Loop -- Phases 5-8 (in progress)

## Phases

<details>
<summary>v1.0 GSD Code-First Fork (Phases 1-4) -- SHIPPED 2026-03-28</summary>

- [x] Phase 1: Annotation Foundation (5/5 plans) -- completed 2026-03-28
- [x] Phase 2: Core Agents (3/3 plans) -- completed 2026-03-28
- [x] Phase 3: Workflow, Distribution, and Docs (3/3 plans) -- completed 2026-03-28
- [x] Phase 4: Tech Debt Cleanup (2/2 plans) -- completed 2026-03-28

</details>

### v1.1 Autonomous Prototype & Review Loop (In Progress)

**Milestone Goal:** Make the code-first workflow the standard routine -- PRD in, functional prototype out, with tests written and review produced.

- [x] **Phase 5: ARC as Default** - Make ARC annotations always-on for new installs while preserving existing configs (completed 2026-03-29)
- [x] **Phase 6: PRD-to-Prototype Pipeline** - Overhaul /gsd:prototype to ingest a PRD and drive scaffold generation from acceptance criteria (completed 2026-03-29)
- [x] **Phase 7: Test Agent** - New gsd-tester agent that writes and runs tests against annotated code with RED-GREEN discipline (completed 2026-03-29)
- [ ] **Phase 8: Review Agent + Command** - New gsd-reviewer agent and /gsd:review-code command that evaluates spec compliance, code quality, and test results

## Phase Details

### Phase 5: ARC as Default
**Goal**: New installations have ARC annotations enabled by default and existing configs with explicit false are preserved
**Depends on**: Phase 4 (v1.0 complete)
**Requirements**: ARC-01, ARC-02
**Success Criteria** (what must be TRUE):
  1. Running /gsd:prototype or /gsd:iterate on a fresh install produces @gsd-tag annotations without any config change
  2. An existing project with arc.enabled: false in config.json continues to function without ARC annotations after upgrading
  3. The /gsd:iterate command logs which executor (gsd-arc-executor vs gsd-executor) was selected at runtime, making the ARC/non-ARC routing visible
**Plans:** 1/1 plans complete
Plans:
- [x] 05-01-PLAN.md -- Fix ARC fallback defaults to true, add routing log line, add config test

### Phase 6: PRD-to-Prototype Pipeline
**Goal**: Users can run /gsd:prototype with a PRD file and receive a scaffolded prototype where each acceptance criterion from the PRD becomes a @gsd-todo tag in the code
**Depends on**: Phase 5
**Requirements**: PRD-01, PRD-02, PRD-03, PRD-04, PRD-05, PRD-06, PRD-07
**Success Criteria** (what must be TRUE):
  1. User can run /gsd:prototype and have .planning/PRD.md auto-detected and used as the PRD source without any flags
  2. User can run /gsd:prototype --prd path/to/custom.md and have that file used as the PRD source
  3. When no PRD file exists, user is prompted to paste PRD content directly into the terminal before scaffold generation begins
  4. User sees a confirmation listing the parsed acceptance criteria before any code is generated, and can abort if the list is wrong
  5. Each acceptance criterion extracted from the PRD appears as a @gsd-todo tag in the generated prototype code, creating a direct traceability link
  6. User can run /gsd:prototype --interactive to step through prototype generation decision-by-decision rather than autonomously
**Plans:** 2/2 plans complete
Plans:
- [x] 06-01-PLAN.md -- Rewrite prototype.md with PRD pipeline Steps 0-5 (PRD ingestion, AC extraction, confirmation gate, first pass)
- [x] 06-02-PLAN.md -- Add autonomous iteration loop (Step 6) and final report (Step 7) with --interactive support
**UI hint**: no

### Phase 7: Test Agent
**Goal**: Users can invoke a test agent that writes runnable tests for annotated code, executes them to confirm green, and marks untested paths with @gsd-risk tags
**Depends on**: Phase 6
**Requirements**: TEST-01, TEST-02, TEST-03, TEST-04, TEST-05
**Success Criteria** (what must be TRUE):
  1. The gsd-tester agent produces test files that actually run against the project's test framework without manual setup
  2. Tests written by gsd-tester fail against scaffold stubs before the real implementation exists, confirming RED-GREEN discipline
  3. gsd-tester detects the project's test framework (vitest, jest, mocha, ava, or node:test) automatically from package.json without user input
  4. Code paths that gsd-tester cannot test or deems high-risk receive @gsd-risk annotations, making coverage gaps visible in CODE-INVENTORY.md
  5. The agent confirms all tests pass (green) before marking its work complete
**Plans:** 2/2 plans complete
Plans:
- [x] 07-01-PLAN.md -- Create test-detector.cjs module with TDD tests and gsd-tools.cjs subcommand
- [x] 07-02-PLAN.md -- Create gsd-tester agent and update add-tests.md with ARC routing

### Phase 8: Review Agent + Command
**Goal**: Users can run /gsd:review-code to get a two-stage evaluation of their prototype -- spec compliance first, then code quality -- with test results included and actionable next steps written to REVIEW-CODE.md
**Depends on**: Phase 7
**Requirements**: REV-01, REV-02, REV-03, REV-04, REV-05, REV-06, REV-07
**Success Criteria** (what must be TRUE):
  1. Running /gsd:review-code performs Stage 1 (spec compliance: does the code satisfy the PRD acceptance criteria?) and reports pass/fail before proceeding
  2. Stage 2 (code quality: security, maintainability) only runs and is reported if Stage 1 passes, preventing wasted review cycles on non-compliant code
  3. The review output includes manual verification steps that the user can follow to check UI, navigation, and UX behavior
  4. REVIEW-CODE.md is written with a structured schema containing at most 5 prioritized next steps, each with file path, severity level, and a concrete action
  5. Test suite results are executed and included in the review output, giving the reviewer full pass/fail context alongside the evaluation
**Plans**: TBD

## Progress

**Execution Order:** 5 -> 6 -> 7 -> 8

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Annotation Foundation | v1.0 | 5/5 | Complete | 2026-03-28 |
| 2. Core Agents | v1.0 | 3/3 | Complete | 2026-03-28 |
| 3. Workflow, Distribution, and Docs | v1.0 | 3/3 | Complete | 2026-03-28 |
| 4. Tech Debt Cleanup | v1.0 | 2/2 | Complete | 2026-03-28 |
| 5. ARC as Default | v1.1 | 1/1 | Complete   | 2026-03-29 |
| 6. PRD-to-Prototype Pipeline | v1.1 | 2/2 | Complete   | 2026-03-29 |
| 7. Test Agent | v1.1 | 2/2 | Complete   | 2026-03-29 |
| 8. Review Agent + Command | v1.1 | 0/TBD | Not started | - |
