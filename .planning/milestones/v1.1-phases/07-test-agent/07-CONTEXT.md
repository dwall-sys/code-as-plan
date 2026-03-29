# Phase 7: Test Agent - Context

**Gathered:** 2026-03-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Create a new gsd-tester agent that writes runnable unit/integration tests for annotated code, executes them, and annotates untested paths with @gsd-risk tags. The agent uses @gsd-api tags as test specifications and follows RED-GREEN discipline. Also includes test framework auto-detection.

</domain>

<decisions>
## Implementation Decisions

### Agent Design
- **D-01:** gsd-tester is a NEW agent file (`agents/gsd-tester.md`), not a wrapper around existing agents. It does NOT subclass gsd-verifier or the add-tests workflow. Different purpose: gsd-tester targets prototype/annotated code using ARC tags as specifications.
- **D-02:** Agent frontmatter follows exact format of existing agents: `name`, `description`, `tools`, `permissionMode`, `color`. Tools: `Read, Write, Edit, Bash, Grep, Glob`.
- **D-03:** gsd-tester reads @gsd-api tags as test specifications and writes tests against the API contract, not against stub behavior. Tests should fail on stubs (RED) and pass only when real implementation satisfies the contract.

### Test Output Location
- **D-04:** Tests are written into the project's existing test directory structure (e.g., `tests/`, `__tests__/`, `src/**/*.test.*`). Follows whatever convention the project already uses. If no test directory exists, create `tests/` at project root.

### Test Framework Detection
- **D-05:** A new CJS module `get-shit-done/bin/lib/test-detector.cjs` auto-detects the project's test framework by reading package.json `scripts.test`, `devDependencies`, and `dependencies`. Returns: framework name, test command, file pattern. Supports: jest, vitest, mocha, ava, node:test.
- **D-06:** test-detector.cjs is a pure utility module with no external dependencies. Uses Node.js built-ins only (fs, path). Exports a single function: `detectTestFramework(projectRoot)`.

### RED-GREEN Discipline
- **D-07:** The agent writes tests first, then runs them. For RED phase: tests must fail against stubs/unimplemented code. For GREEN phase: tests must pass against the real implementation. The agent confirms both phases before marking complete.
- **D-08:** If RED phase fails (tests pass against stubs when they shouldn't), the agent rewrites tests with stricter assertions before proceeding.

### @gsd-risk Annotation
- **D-09:** After test generation, the agent scans for code paths it could NOT test (complex async, external dependencies, UI interactions) and annotates them with `@gsd-risk` tags. These automatically appear in CODE-INVENTORY.md via extract-tags.
- **D-10:** @gsd-risk annotations include metadata: `reason:` explaining why the path is untested, `severity:` (high/medium/low).

### Test Execution
- **D-11:** The gsd-tester agent itself runs tests via Bash tool (it has Bash in its tools list). This is a correction from earlier research that suggested test execution should be in the command layer -- the agent needs immediate feedback to iterate on failing tests.
- **D-12:** The agent uses test-detector.cjs to determine the correct test command, then runs it and parses output for pass/fail.

### Command Integration
- **D-13:** No new slash command is created for this phase. The existing `/gsd:add-tests` command will be updated to optionally use gsd-tester as its agent when ARC mode is enabled. When ARC is off, it falls back to the existing add-tests workflow.

### Claude's Discretion
- Exact prompt structure for gsd-tester agent
- How many test files to generate per source file
- Test naming conventions (follow project's existing patterns)
- Whether to generate test fixtures/mocks as separate files

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Test Infrastructure
- `commands/gsd/add-tests.md` -- Existing add-tests command (will be updated to use gsd-tester)
- `get-shit-done/workflows/add-tests.md` -- Existing add-tests workflow (reference for test classification patterns)
- `tests/*.test.cjs` -- Project's own test files (pattern reference for node:test usage)

### Agent Templates
- `agents/gsd-prototyper.md` -- Reference agent for frontmatter format, step structure, constraints section
- `agents/gsd-arc-executor.md` -- Reference for ARC-aware agent pattern

### ARC Standard
- `get-shit-done/references/arc-standard.md` -- @gsd-risk and @gsd-api tag definitions

### Research
- `.planning/research/ARCHITECTURE.md` -- Layer 3: gsd-tester architecture, anti-patterns
- `.planning/research/STACK.md` -- test-detector.cjs design, zero-dep constraint
- `.planning/research/FEATURES.md` -- RED-GREEN discipline, @gsd-risk differentiator
- `.planning/research/PITFALLS.md` -- Test false confidence prevention

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `get-shit-done/workflows/add-tests.md` -- TDD/E2E/Skip classification logic can inform gsd-tester's approach
- `agents/gsd-prototyper.md` -- Agent structure template (5-step execution flow, constraints section)
- `get-shit-done/bin/lib/config.cjs` -- Pattern for new CJS modules (exports, error handling)
- `tests/config.test.cjs` -- Pattern for node:test test files

### Established Patterns
- Agent YAML frontmatter: name, description, tools, permissionMode, color
- CJS modules in `get-shit-done/bin/lib/` with module.exports
- parseNamedArgs() for flag parsing in gsd-tools.cjs
- `node:test` with `node:assert` for all CJS test files

### Integration Points
- `agents/gsd-tester.md` -- new file, registered in installer
- `get-shit-done/bin/lib/test-detector.cjs` -- new CJS module
- `commands/gsd/add-tests.md` -- updated to route to gsd-tester when ARC enabled
- `get-shit-done/bin/gsd-tools.cjs` -- may need new subcommand for test-detector (or agent calls it directly)

</code_context>

<specifics>
## Specific Ideas

- User emphasized: "Der Agent schreibt die Tests und führt sie aus" -- the agent writes AND runs tests
- Tests must be "runnable" -- not stubs, not placeholders, actual executable tests
- @gsd-risk annotation feeds into the review agent (Phase 8) for coverage gap awareness
- RED-GREEN is mandatory, not optional -- tests must prove they can fail before they pass

</specifics>

<deferred>
## Deferred Ideas

- @gsd-coverage tag type for test coverage in CODE-INVENTORY.md -- deferred to v1.2+
- Multi-language test runner detection beyond Node.js -- deferred to v1.2+
- Parallel test generation across files -- out of scope (coordination complexity)

</deferred>

---

*Phase: 07-test-agent*
*Context gathered: 2026-03-29*
