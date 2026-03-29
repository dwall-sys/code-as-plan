# Phase 8: Review Agent + Command - Context

**Gathered:** 2026-03-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Create a new gsd-reviewer agent and `/gsd:review-code` command that performs two-stage code evaluation (spec compliance → code quality), executes the test suite, presents manual verification steps, and writes structured output to REVIEW-CODE.md with actionable next steps.

</domain>

<decisions>
## Implementation Decisions

### Command Name and Routing
- **D-01:** New command is `/gsd:review-code` (file: `commands/gsd/review-code.md`). Does NOT modify existing `/gsd:review` which does cross-AI plan review. Two distinct commands, two distinct purposes.
- **D-02:** Output file is `REVIEW-CODE.md` (not REVIEW.md, not REVIEWS.md). Hard naming constraint to avoid collision with existing plan review artifacts.

### Agent Design
- **D-03:** gsd-reviewer is a NEW standalone agent (`agents/gsd-reviewer.md`), NOT a wrapper around gsd-verifier. Different lifecycle position: reviewer evaluates prototype quality before iteration, verifier checks phase goals after execution.
- **D-04:** Agent frontmatter: `name: gsd-reviewer`, tools: `Read, Write, Bash, Grep, Glob` (no Edit -- reviewer reads and writes reports, doesn't modify code).
- **D-05:** Agent receives test results as context in its Task() prompt, NOT by running tests itself. Test execution happens in the command orchestrator via Bash.

### Two-Stage Review
- **D-06:** Stage 1 (spec compliance): Check each PRD acceptance criterion against code/tests. Does the implementation satisfy what was specified? Reports pass/fail per AC.
- **D-07:** Stage 2 (code quality): Security, maintainability, error handling, edge cases. Only runs if Stage 1 passes. Prevents wasting review cycles on code that doesn't meet the spec.
- **D-08:** If Stage 1 fails, the review stops and presents which ACs are not met. Stage 2 is not executed.

### Manual Verification Steps
- **D-09:** Review includes concrete manual verification steps for UI/navigation/UX. Format: numbered checklist with "Open X, click Y, expect Z" -- not abstract descriptions.
- **D-10:** Manual steps cover what automated tests cannot: visual appearance, navigation flow, user experience, responsiveness.

### Actionable Next Steps
- **D-11:** REVIEW-CODE.md includes at most 5 prioritized next steps. Each has: file path, severity (critical/high/medium/low), and a concrete action description.
- **D-12:** The output schema is designed for future `--fix` chaining (pipe findings into /gsd:iterate as @gsd-todo tags). Design the schema now even though --fix is deferred to v1.2+.

### Test Execution in Command Layer
- **D-13:** The `/gsd:review-code` command runs the test suite via Bash using test-detector.cjs (from Phase 7) to determine the test command. Test output is captured and passed to gsd-reviewer as context.
- **D-14:** If no test runner is detected, the reviewer proceeds with Stage 1 only (spec compliance) and notes the absence of tests as a @gsd-risk in REVIEW-CODE.md.

### Claude's Discretion
- Exact REVIEW-CODE.md section structure beyond the required fields
- How to handle projects with no PRD (review against REQUIREMENTS.md instead)
- Verbosity level of Stage 2 findings
- Whether to include code snippets in review output

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Review Command (DO NOT modify)
- `commands/gsd/review.md` -- Existing cross-AI plan review command (stays untouched)

### Agent Templates
- `agents/gsd-tester.md` -- Phase 7 agent (reference for format, 5-step flow structure)
- `agents/gsd-prototyper.md` -- Reference for report-writing agent pattern

### Test Infrastructure (Phase 7)
- `get-shit-done/bin/lib/test-detector.cjs` -- Test framework detection module
- `get-shit-done/bin/gsd-tools.cjs` -- detect-test-framework subcommand

### ARC Standard
- `get-shit-done/references/arc-standard.md` -- @gsd-risk tag definitions

### Research
- `.planning/research/ARCHITECTURE.md` -- Layer 4: gsd-reviewer architecture, anti-patterns
- `.planning/research/FEATURES.md` -- Two-stage review pattern, structured output schema
- `.planning/research/PITFALLS.md` -- Review verbosity prevention, Judge/filter pattern

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `agents/gsd-tester.md` -- Agent structure template from Phase 7 (5-step flow, constraints)
- `commands/gsd/prototype.md` -- Command orchestrator pattern with agent spawning and result handling
- `get-shit-done/bin/lib/test-detector.cjs` -- detectTestFramework() for test command resolution
- `agents/gsd-verifier.md` -- Evaluation patterns (goal-backward analysis) -- can borrow approach but NOT extend

### Established Patterns
- Agent YAML frontmatter: name, description, tools, permissionMode, color
- Command orchestrators pass context to agents via Task() prompt
- Report-writing agents use Write tool to create .md artifacts
- AskUserQuestion for presenting results and next steps

### Integration Points
- `commands/gsd/review-code.md` -- new command file
- `agents/gsd-reviewer.md` -- new agent file
- Test execution via `detect-test-framework` subcommand from Phase 7

</code_context>

<specifics>
## Specific Ideas

- User emphasized: "ausführlich dem User präsentiert, was er reviewt hat, was gut ist, was nicht so gut ist"
- User wants: "Verifikationsschritte und einen Unit-Test vorstellt, den der User ausführen muss"
- After review: "wird dem User vorgeschlagen, was am besten das Nächste zu machen ist"
- Review should help the user understand what the agent needs to plan better with ARC annotations

</specifics>

<deferred>
## Deferred Ideas

- `--fix` flag to pipe review findings into /gsd:iterate as @gsd-todo tags -- deferred to v1.2+
- Judge/filter pattern for review verbosity control -- design now, implement if needed
- Review-to-iterate automated chain -- deferred to v1.2+

</deferred>

---

*Phase: 08-review-agent-command*
*Context gathered: 2026-03-29*
