# Roadmap: GSD Code-First Fork

## Milestones

- v1.0 GSD Code-First Fork -- Phases 1-4 (shipped 2026-03-28)
- v1.1 Autonomous Prototype & Review Loop -- Phases 5-8 (shipped 2026-03-29)
- v1.2 Brainstorm & Feature Map -- Phases 9-12 (in progress)

## Phases

<details>
<summary>v1.0 GSD Code-First Fork (Phases 1-4) -- SHIPPED 2026-03-28</summary>

- [x] Phase 1: Annotation Foundation (5/5 plans) -- completed 2026-03-28
- [x] Phase 2: Core Agents (3/3 plans) -- completed 2026-03-28
- [x] Phase 3: Workflow, Distribution, and Docs (3/3 plans) -- completed 2026-03-28
- [x] Phase 4: Tech Debt Cleanup (2/2 plans) -- completed 2026-03-28

</details>

<details>
<summary>v1.1 Autonomous Prototype & Review Loop (Phases 5-8) -- SHIPPED 2026-03-29</summary>

- [x] Phase 5: ARC as Default (1/1 plans) -- completed 2026-03-29
- [x] Phase 6: PRD-to-Prototype Pipeline (2/2 plans) -- completed 2026-03-29
- [x] Phase 7: Test Agent (2/2 plans) -- completed 2026-03-29
- [x] Phase 8: Review Agent + Command (1/1 plans) -- completed 2026-03-29

</details>

**v1.2 Brainstorm & Feature Map (Phases 9-12)**

- [ ] **Phase 9: Tech Debt** - Fix two known defects before building new features
- [ ] **Phase 10: Brainstorm Command** - Conversational PRD generation with approval gate and ledger
- [ ] **Phase 11: Architecture Mode** - Skeleton-first prototyping via --architecture flag
- [ ] **Phase 12: Feature Map** - Auto-aggregated FEATURES.md from PRDs and @gsd-tags, with pipeline integration

## Phase Details

### Phase 9: Tech Debt
**Goal**: Known defects are resolved before new features are built on top of them
**Depends on**: Phase 8
**Requirements**: DEBT-01, DEBT-02
**Success Criteria** (what must be TRUE):
  1. Running `/gsd:extract-tags` on a project produces no "extract-plan" references in gsd-tester output -- the correct `extract-tags` command name is used throughout
  2. Running `/gsd:review-code` on a macOS or BSD system produces valid grep output -- no `grep: invalid option -- P` errors appear
  3. Both fixes are verified against the specific file and line numbers documented in PROJECT.md (gsd-tester.md:221, review-code.md:103)
**Plans**: TBD

### Phase 10: Brainstorm Command
**Goal**: Users can have a structured conversation with Claude that produces a PRD ready for `/gsd:prototype` without manual editing
**Depends on**: Phase 9
**Requirements**: BRAIN-01, BRAIN-02, BRAIN-03, BRAIN-04, BRAIN-05, BRAIN-06, BRAIN-07
**Success Criteria** (what must be TRUE):
  1. User runs `/gsd:brainstorm` and receives targeted clarifying questions one at a time -- not a single-prompt PRD dump
  2. At the end of the conversation, user sees a PRD summary and AC count before being asked to confirm -- files are not written without explicit approval
  3. After confirmation, `.planning/PRD.md` (or `PRD-[slug].md`) is written and `/gsd:prototype` can consume it without modification or reformatting
  4. When a project has multiple independent feature areas, the agent surfaces cross-feature dependencies and can output separate scoped PRD files
  5. Conversation decisions (including scope exclusions and deferred features) are persisted to `.planning/BRAINSTORM-LEDGER.md` and survive session restarts
**Plans**: TBD

### Phase 11: Architecture Mode
**Goal**: Users can generate a project skeleton with structural decisions annotated before any feature implementation begins
**Depends on**: Phase 9
**Requirements**: ARCH-01, ARCH-02, ARCH-03, ARCH-04
**Success Criteria** (what must be TRUE):
  1. User runs `/gsd:prototype --architecture` and receives a skeleton with folder structure, config files, and typed interfaces -- zero feature implementation code is present
  2. Every module boundary in the skeleton has `@gsd-decision` and `@gsd-context` tags explaining the structural choice
  3. On a project with existing conventions (package.json, tsconfig, etc.), the generated skeleton matches those naming and module patterns rather than agent defaults
  4. User sees the proposed skeleton and must confirm before any files are written
**Plans**: TBD

### Phase 12: Feature Map
**Goal**: FEATURES.md is auto-generated from PRD acceptance criteria and live code tags, and stays current automatically on every extract-tags run
**Depends on**: Phase 10, Phase 11
**Requirements**: FMAP-01, FMAP-02, FMAP-03, FMAP-04, FMAP-05
**Success Criteria** (what must be TRUE):
  1. After running `/gsd:prototype` or `/gsd:brainstorm` on a project with a PRD, `.planning/FEATURES.md` is generated automatically -- no separate command needed
  2. Each feature in FEATURES.md shows whether its ACs are complete (no open `@gsd-todo` tags remaining) or in-progress
  3. Cross-feature dependencies documented in the PRD are visible in FEATURES.md
  4. Running `/gsd:extract-tags` on a project regenerates FEATURES.md automatically -- the file always reflects the current code state without manual intervention
  5. FEATURES.md includes a `last-updated` and `source-hash` header so readers can confirm it is current; the file contains no instructions for manual editing
**Plans**: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Annotation Foundation | v1.0 | 5/5 | Complete | 2026-03-28 |
| 2. Core Agents | v1.0 | 3/3 | Complete | 2026-03-28 |
| 3. Workflow, Distribution, and Docs | v1.0 | 3/3 | Complete | 2026-03-28 |
| 4. Tech Debt Cleanup | v1.0 | 2/2 | Complete | 2026-03-28 |
| 5. ARC as Default | v1.1 | 1/1 | Complete | 2026-03-29 |
| 6. PRD-to-Prototype Pipeline | v1.1 | 2/2 | Complete | 2026-03-29 |
| 7. Test Agent | v1.1 | 2/2 | Complete | 2026-03-29 |
| 8. Review Agent + Command | v1.1 | 1/1 | Complete | 2026-03-29 |
| 9. Tech Debt | v1.2 | 0/TBD | Not started | - |
| 10. Brainstorm Command | v1.2 | 0/TBD | Not started | - |
| 11. Architecture Mode | v1.2 | 0/TBD | Not started | - |
| 12. Feature Map | v1.2 | 0/TBD | Not started | - |
