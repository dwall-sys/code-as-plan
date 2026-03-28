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

## Cross-Milestone Trends

| Metric | v1.0 |
|--------|------|
| Phases | 4 |
| Plans | 13 |
| Tasks | 18 |
| Requirements | 31/31 |
| Verification pass rate | 100% |
| Gap closure phases | 1 |
