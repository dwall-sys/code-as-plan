# Retrospective

## Milestone: v1.0 -- GSD Code-First Fork

**Shipped:** 2026-03-28
**Phases:** 4 | **Plans:** 13 | **Tasks:** 18

### What Was Built
- ARC annotation standard v1.0 with 8 @gsd-tag types and frozen spec
- Regex-based tag scanner with comment-anchor false-positive prevention (21 tests)
- gsd-prototyper agent building annotated scaffolds with auto-chain to extract-plan
- gsd-code-planner agent producing compact plans from CODE-INVENTORY.md
- gsd-arc-executor and gsd-arc-planner wrapper agents with config gating
- /gsd:iterate flagship command orchestrating the full code-first loop
- set-mode and deep-plan workflow commands
- Full documentation (README, help, arc-standard reference)

### What Worked
- Auto-advance pipeline (discuss -> plan -> execute) ran all 4 phases with minimal intervention
- Parallel execution within waves -- agents completed independently without conflicts
- Wrapper agent strategy preserved upstream files completely (zero git diff)
- Phase 1's thorough research prevented rework in Phases 2-3
- Gap closure phase (Phase 4) was quick and focused

### What Was Inefficient
- Some SUMMARY.md files lacked one-liner fields, requiring manual extraction
- ARC wrapper routing gap (execute-phase/plan-phase not wired) was only caught at milestone audit -- could have been identified during Phase 2 planning
- Missing workflow file references (annotate.md, prototype.md, extract-plan.md) were vestigial from template copying -- a linting step could catch these

### Patterns Established
- Agent files: YAML frontmatter + commented hooks block + anti-heredoc instruction for all Write-capable agents
- Command files: YAML frontmatter + objective + process (self-contained, no external workflow dependency)
- Auto-chain pattern: agent completes -> extract-tags runs -> CODE-INVENTORY.md updated
- Config gating: arc.enabled checked at agent startup with `|| echo "false"` fallback
- Wrapper agents: self-contained prose delegation (no runtime reads of upstream agent files)

### Key Lessons
- Upstream mergeability constraint drove all architecture decisions -- wrapper agents, additive config, separate files
- The code-first value proposition is real: prototype -> annotate -> iterate is faster than discuss -> plan -> execute for well-understood work
- Gap closure phases are cheap and worth doing before milestone completion

## Milestone: v1.1 -- Autonomous Prototype & Review Loop

**Shipped:** 2026-03-29
**Phases:** 4 | **Plans:** 6

### What Was Built
- ARC enabled by default for new installations; existing opt-out configs preserved
- PRD-to-prototype pipeline with 3-way PRD resolution, semantic AC extraction, confirmation gate
- Autonomous iteration loop (max 5 iterations) with AC_REMAINING exit condition and --interactive mode
- gsd-tester agent with auto-detection of 5 test frameworks and RED-GREEN discipline
- test-detector.cjs utility module with 11 TDD tests
- gsd-reviewer agent with two-stage evaluation (spec compliance gate -> code quality)
- /gsd:review-code command with test execution and structured REVIEW-CODE.md output

### What Worked
- Research-first approach for each phase prevented rework -- Phase 6/7/8 all had research before planning
- Lean plan count (6 plans vs 13 in v1.0) -- tighter scoping led to faster execution
- Decision logging in STATE.md accumulated context captured pitfalls early (e.g., command name collision)
- Wrapper/routing pattern from v1.0 (add-tests.md ARC routing) scaled cleanly to new commands
- Phase verification caught all requirements at artifact level -- 21/21 satisfied

### What Was Inefficient
- SUMMARY.md `requirements_completed` frontmatter was sparse (only 2/21 requirements listed) -- should be populated by executor
- Integration checker found 2 defects (stale command name, non-portable grep) that could have been caught during phase execution
- `grep -oP` portability issue suggests a need for a linting step on bash commands in agent/command files
- Human verification items accumulated (8 total) with no mechanism to track their completion

### Patterns Established
- PRD ingestion in command layer, not agent layer -- keeps agents reusable across input formats
- Two-stage gate pattern: evaluation only proceeds if prerequisite stage passes
- Test execution in command layer, results passed to agent -- prevents context window blockage
- ARC routing pattern: `config-get arc.enabled` with fallback, then branch on result

### Key Lessons
- Lean phases with focused research produce better outcomes than large phases with broad scope
- Integration defects hide at phase boundaries -- cross-phase integration checking should happen during execution, not just at audit
- Agent prompt files are hard to test statically -- behavioral verification requires live runs

## Cross-Milestone Trends

| Metric | v1.0 | v1.1 |
|--------|------|------|
| Phases | 4 | 4 |
| Plans | 13 | 6 |
| Tasks | 18 | 11 |
| Requirements | 31/31 | 21/21 |
| Verification pass rate | 100% | 100% |
| Integration defects | 0 | 2 (tech debt) |
| Gap closure phases | 1 | 0 |
