# Phase 7: Test Agent - Research

**Researched:** 2026-03-29
**Domain:** Claude Code agent authoring, CJS module design, RED-GREEN test discipline, test framework detection
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** gsd-tester is a NEW agent file (`agents/gsd-tester.md`), not a wrapper around existing agents. It does NOT subclass gsd-verifier or the add-tests workflow. Different purpose: gsd-tester targets prototype/annotated code using ARC tags as specifications.
- **D-02:** Agent frontmatter follows exact format of existing agents: `name`, `description`, `tools`, `permissionMode`, `color`. Tools: `Read, Write, Edit, Bash, Grep, Glob`.
- **D-03:** gsd-tester reads @gsd-api tags as test specifications and writes tests against the API contract, not against stub behavior. Tests should fail on stubs (RED) and pass only when real implementation satisfies the contract.
- **D-04:** Tests are written into the project's existing test directory structure (e.g., `tests/`, `__tests__/`, `src/**/*.test.*`). Follows whatever convention the project already uses. If no test directory exists, create `tests/` at project root.
- **D-05:** A new CJS module `get-shit-done/bin/lib/test-detector.cjs` auto-detects the project's test framework by reading package.json `scripts.test`, `devDependencies`, and `dependencies`. Returns: framework name, test command, file pattern. Supports: jest, vitest, mocha, ava, node:test.
- **D-06:** test-detector.cjs is a pure utility module with no external dependencies. Uses Node.js built-ins only (fs, path). Exports a single function: `detectTestFramework(projectRoot)`.
- **D-07:** The agent writes tests first, then runs them. For RED phase: tests must fail against stubs/unimplemented code. For GREEN phase: tests must pass against the real implementation. The agent confirms both phases before marking complete.
- **D-08:** If RED phase fails (tests pass against stubs when they shouldn't), the agent rewrites tests with stricter assertions before proceeding.
- **D-09:** After test generation, the agent scans for code paths it could NOT test (complex async, external dependencies, UI interactions) and annotates them with `@gsd-risk` tags. These automatically appear in CODE-INVENTORY.md via extract-tags.
- **D-10:** @gsd-risk annotations include metadata: `reason:` explaining why the path is untested, `severity:` (high/medium/low).
- **D-11:** The gsd-tester agent itself runs tests via Bash tool (correction from earlier research). The agent needs immediate feedback to iterate on failing tests.
- **D-12:** The agent uses test-detector.cjs to determine the correct test command, then runs it and parses output for pass/fail.
- **D-13:** No new slash command is created for this phase. The existing `/gsd:add-tests` command will be updated to optionally use gsd-tester as its agent when ARC mode is enabled. When ARC is off, it falls back to the existing add-tests workflow.

### Claude's Discretion

- Exact prompt structure for gsd-tester agent
- How many test files to generate per source file
- Test naming conventions (follow project's existing patterns)
- Whether to generate test fixtures/mocks as separate files

### Deferred Ideas (OUT OF SCOPE)

- @gsd-coverage tag type for test coverage in CODE-INVENTORY.md — deferred to v1.2+
- Multi-language test runner detection beyond Node.js — deferred to v1.2+
- Parallel test generation across files — out of scope (coordination complexity)

</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TEST-01 | gsd-tester agent writes runnable unit/integration tests for annotated code | Agent authoring patterns verified; @gsd-api contract-driven test writing approach documented |
| TEST-02 | gsd-tester executes tests and confirms green before completing | Bash tool test execution inside agent confirmed; output parsing approach documented |
| TEST-03 | gsd-tester auto-detects the project's test framework (jest, vitest, node:test, etc.) | test-detector.cjs detection algorithm designed; 5-framework coverage verified; gsd-tools.cjs integration pattern documented |
| TEST-04 | gsd-tester annotates untested/hard-to-test code paths with @gsd-risk tags | @gsd-risk tag syntax and metadata keys verified from arc-standard.md; reason: and severity: keys documented |
| TEST-05 | Tests must fail against stubs before passing against implementation (RED-GREEN) | RED-GREEN discipline defined; stub detection heuristics documented; agent prompt design patterns described |

</phase_requirements>

---

## Summary

Phase 7 creates two deliverables: a new Claude Code agent file (`agents/gsd-tester.md`) and a new CJS utility module (`get-shit-done/bin/lib/test-detector.cjs`). It also updates the existing `commands/gsd/add-tests.md` to route to gsd-tester when ARC mode is active.

The agent pattern is well-understood from 20 existing agents in the codebase. The gsd-tester agent mirrors the structure of `gsd-prototyper.md` (5-step execution flow, constraints section, YAML frontmatter) but with a fundamentally different job: reading @gsd-api annotations as test specifications and driving a RED-GREEN discipline loop. The critical design challenge is ensuring tests are written against the API contract rather than against stub return values — this distinction must be explicit in the agent prompt.

The test-detector module follows the zero-dependency pattern used by all 17 existing lib modules. Its detection algorithm reads the target project's `package.json` (not this project's) and fingerprints against the 5 major Node.js test frameworks. Detection is injected into the agent via gsd-tools.cjs `detect-test-framework` subcommand, keeping the agent stateless about environment probing.

**Primary recommendation:** Build test-detector.cjs first (pure function, easily testable), add the `detect-test-framework` subcommand to gsd-tools.cjs, then author gsd-tester.md using gsd-prototyper.md as structural template. Update add-tests.md last since it depends on both prior deliverables.

---

## Project Constraints (from CLAUDE.md)

The following directives are mandatory and override any research recommendations that contradict them:

| Directive | Constraint |
|-----------|-----------|
| Zero runtime dependencies | No new npm packages in the CJS layer — Node.js built-ins only |
| node:test for CJS tests | test-detector.cjs tests MUST use `require('node:test')` and `require('node:assert')` |
| Agent frontmatter format | YAML with `name`, `description`, `tools`, `permissionMode`, `color` — exact format from existing agents |
| Write tool for file creation | Agent must use Write tool, never `Bash(cat << 'EOF')` |
| Additive changes only | No modification to upstream GSD files; no modification to existing agent behavior |
| All original GSD commands must continue working | The add-tests.md update must be backward-compatible; non-ARC behavior unchanged |
| Install pattern: auto-discovery | install.js auto-discovers `agents/gsd-*.md` — no explicit registration needed |

---

## Standard Stack

### Core

| Component | Version | Purpose | Why Standard |
|-----------|---------|---------|--------------|
| Claude Code agent YAML frontmatter | Current Claude Code format | Agent identity, tools, permissions | All 20 existing agents use this exact format — non-negotiable |
| Node.js `fs`, `path` built-ins | Node.js >=20 | test-detector.cjs I/O | Zero-dep constraint; all 17 existing lib modules use this pattern |
| `node:test` + `node:assert` | Node.js >=20 built-in | Test files for test-detector.cjs | All 47 existing test files use this — project enforces consistency |

### Supporting

| Component | Version | Purpose | When to Use |
|-----------|---------|---------|-------------|
| `gsd-tools.cjs` `detect-test-framework` subcommand | New in Phase 7 | Let agent call test detection via bash | Agent uses Bash tool to call `gsd-tools.cjs detect-test-framework` rather than reading package.json directly |
| `tests/helpers.cjs` | Existing | `createTempProject()`, `cleanup()`, `runGsdTools()` helpers | Reuse in test-detector test file; pattern established |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| node:test | jest, vitest | Project constraint prohibits — CJS tests use node:test only |
| Pure regex framework detection | `which jest`, `npx jest --version` | Registry-based detection is fragile and requires spawning processes; package.json inspection is deterministic and faster |
| Direct package.json read in agent | test-detector.cjs via gsd-tools | Agent reading package.json directly works but bypasses the standard state gateway pattern; gsd-tools subcommand is more testable and consistent |

**Installation:** No new packages — zero-dependency constraint applies.

**Version verification:** N/A — no new npm packages added.

---

## Architecture Patterns

### Recommended Project Structure for Phase 7

```
agents/
└── gsd-tester.md                           # NEW: test-writing agent

get-shit-done/bin/lib/
└── test-detector.cjs                       # NEW: framework detection module

get-shit-done/bin/gsd-tools.cjs
  case 'detect-test-framework': ...         # NEW: subcommand (add to switch block)

commands/gsd/
└── add-tests.md                            # MODIFIED: ARC routing when arc.enabled

tests/
└── test-detector.test.cjs                  # NEW: tests for test-detector.cjs
```

### Pattern 1: Agent File Structure (gsd-tester.md)

**What:** YAML frontmatter + Markdown prose organized into `<role>`, `<project_context>`, `<execution_flow>` (steps), `<constraints>` sections.

**When to use:** Every agent in the codebase. Non-negotiable format.

**Example:**
```markdown
---
name: gsd-tester
description: Writes runnable tests for annotated prototype code following RED-GREEN discipline. Spawned by /gsd:add-tests when ARC mode is enabled.
tools: Read, Write, Edit, Bash, Grep, Glob
permissionMode: acceptEdits
color: green
---

<role>
You are the GSD tester...
</role>

<execution_flow>
<step name="load_context" number="1">...</step>
<step name="detect_framework" number="2">...</step>
<step name="write_tests" number="3">...</step>
<step name="red_phase" number="4">...</step>
<step name="annotate_risks" number="5">...</step>
</execution_flow>

<constraints>
...
</constraints>
```

Source: `agents/gsd-prototyper.md` (verified)

### Pattern 2: CJS Lib Module (test-detector.cjs)

**What:** Single-responsibility module with `module.exports` of named functions. Uses only `fs` and `path`. Matches the structure of `config.cjs`, `arc-scanner.cjs`.

**When to use:** All new CJS utility modules.

**Example:**
```javascript
// Source: get-shit-done/bin/lib/config.cjs pattern

'use strict';
const fs = require('fs');
const path = require('path');

/**
 * Detect the test framework used by the project at projectRoot.
 * Returns: { framework, testCommand, filePattern }
 */
function detectTestFramework(projectRoot) {
  const pkgPath = path.join(projectRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return { framework: 'node:test', testCommand: 'node --test', filePattern: '**/*.test.cjs' };
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const testScript = (pkg.scripts && pkg.scripts.test) || '';

  if (deps.vitest || testScript.includes('vitest')) {
    return { framework: 'vitest', testCommand: 'npx vitest run', filePattern: '**/*.test.{ts,js}' };
  }
  if (deps.jest || testScript.includes('jest')) {
    return { framework: 'jest', testCommand: 'npx jest', filePattern: '**/*.test.{ts,js}' };
  }
  if (deps.mocha || testScript.includes('mocha')) {
    return { framework: 'mocha', testCommand: 'npx mocha', filePattern: '**/*.test.{mjs,cjs,js}' };
  }
  if (deps.ava || testScript.includes('ava')) {
    return { framework: 'ava', testCommand: 'npx ava', filePattern: '**/*.test.{mjs,js}' };
  }
  if (testScript.includes('--test')) {
    return { framework: 'node:test', testCommand: 'node --test', filePattern: '**/*.test.cjs' };
  }
  return { framework: 'node:test', testCommand: 'node --test', filePattern: '**/*.test.cjs' };
}

module.exports = { detectTestFramework };
```

Source: `get-shit-done/bin/lib/config.cjs` + `.planning/research/STACK.md` (verified)

### Pattern 3: gsd-tools.cjs Subcommand Registration

**What:** Add a `case 'detect-test-framework':` block to the main switch statement in gsd-tools.cjs (line ~944, just before the `default:` case).

**When to use:** Every new CJS capability exposed to agents/commands.

**Example:**
```javascript
// Source: gsd-tools.cjs switch block pattern (lines 914-928 for extract-tags reference)
case 'detect-test-framework': {
  const targetDir = args[1] || cwd;
  const testDetector = require('./lib/test-detector.cjs');
  const result = testDetector.detectTestFramework(targetDir);
  core.output(result, raw, `${result.framework}: ${result.testCommand}`);
  break;
}
```

### Pattern 4: add-tests.md ARC Routing

**What:** Check `arc.enabled` at the start of add-tests.md. If true and CODE-INVENTORY.md exists, spawn gsd-tester instead of the default workflow.

**When to use:** Any command that has ARC-aware vs. standard code paths.

**Example (from iterate.md routing pattern):**
```markdown
## ARC Mode Check

```bash
ARC_ENABLED=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" config-get arc.enabled 2>/dev/null || echo "true")
```

If ARC_ENABLED is "true" and CODE-INVENTORY.md exists at `.planning/prototype/CODE-INVENTORY.md`:
- Spawn gsd-tester with the prototype source files as context
- Skip the standard add-tests workflow

If ARC_ENABLED is "false" or CODE-INVENTORY.md does not exist:
- Continue with existing add-tests workflow (unchanged)
```

Source: `agents/gsd-arc-executor.md` (lines 47-57), `commands/gsd/iterate.md` (routing pattern, verified)

### Pattern 5: Agent Bash Tool Test Execution

**What:** Agent runs tests using the Bash tool, reads stdout/stderr, parses pass/fail signals, and iterates if needed.

**When to use:** Any agent that needs feedback from a test run.

**RED detection patterns by framework:**

| Framework | Failure Signal | Pass Signal |
|-----------|---------------|-------------|
| node:test | `not ok`, `# tests failed` | `# tests passed`, `✓` |
| vitest | `FAIL`, `✗` | `PASS`, `✓` |
| jest | `FAIL`, `✕` | `PASS`, `✓` |
| mocha | `failing`, `AssertionError` | `passing` |
| ava | `✘`, `not ok` | `✔`, `passed` |

Source: `get-shit-done/workflows/add-tests.md` + `.planning/research/STACK.md` (verified)

### Recommended Agent Execution Flow (5 Steps)

Mirrors gsd-prototyper's 5-step structure for consistency:

```
Step 1: load_context
  - Read CLAUDE.md (if exists)
  - Read .planning/prototype/CODE-INVENTORY.md for @gsd-api contracts
  - Read .planning/prototype/PROTOTYPE-LOG.md for file list
  - Detect test framework via gsd-tools detect-test-framework
  - Discover existing test directory structure

Step 2: plan_tests
  - For each @gsd-api tag: map to one test case (happy path + at least one edge case)
  - Identify @gsd-constraint tags (test boundary conditions)
  - List planned test files with paths and test count

Step 3: write_tests
  - Write test files using the Write tool (never Bash heredoc)
  - Use framework-appropriate syntax detected in Step 1
  - Each test asserts the API contract, NOT stub return values
  - Test naming follows project convention from existing test files

Step 4: red_green
  - RED: Run tests, confirm they FAIL against current code
    - If tests PASS on RED: rewrite with stricter assertions (D-08)
  - GREEN: Verify tests pass against real implementation
    - If tests FAIL on GREEN: debug and fix test logic (not implementation)

Step 5: annotate_risks
  - Scan source files for code paths NOT covered by generated tests
  - Add @gsd-risk tags with reason: and severity: metadata
  - Report: test file paths, test counts, risk annotations added
```

### Anti-Patterns to Avoid

- **Writing tests against stub return values:** Prototype code returns hardcoded values. `assert.strictEqual(result, undefined)` always passes and is meaningless. Tests must assert the _contract_ as described in @gsd-api tags.
- **Skipping RED phase verification:** RED must be confirmed with actual output, not assumed. If agent skips running tests before GREEN, RED-GREEN discipline is broken.
- **Inventing a test framework when none is detected:** Fall back to `node:test` — it is available on all supported Node.js versions and requires no installation.
- **Writing test-detector.cjs tests with vitest:** The project enforces node:test for all CJS layer tests. test-detector.cjs is CJS — its test file must use node:test.
- **Modifying gsd-executor.md or other upstream files:** The additive constraint is absolute. All changes to `commands/gsd/add-tests.md` must be backward compatible (non-ARC path unchanged).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Test framework detection parsing | Custom regexp against npm registry or CLI output | `package.json` deps + scripts inspection | Registry queries are slow/fragile; package.json is always local and definitive |
| Agent context injection | Custom file-passing protocol | Standard Task() prompt with @-reference context | All agents receive context via prompt — established pattern throughout the codebase |
| Test output parsing | Custom TAP/XML parser | Agent reads stdout with LLM reasoning, signals by pattern | gsd-verifier already does this — proven to work at this complexity level |
| Stub detection | AST parser | Pattern matching on common stub forms (hardcoded primitives, throw NotImplementedError, return undefined) | AST parsers add dependencies; common stubs are structurally obvious |
| @gsd-risk tag writing | Custom annotation system | arc-standard.md syntax exactly | Tag scanner only recognizes the ARC format — deviations break CODE-INVENTORY.md |

**Key insight:** The agent layer handles the hard reasoning (test design, contract interpretation, output analysis). The CJS layer handles only deterministic utility work (framework detection, file path resolution). Never blur these boundaries.

---

## Common Pitfalls

### Pitfall 1: Tests Pass Against Stubs (False RED)

**What goes wrong:** Agent writes a test like `assert.ok(result !== undefined)` or `assert.strictEqual(typeof result, 'function')`. The stub satisfies this and the test passes immediately — no RED phase.

**Why it happens:** The agent infers what the function _does_ from the stub body rather than what it _should_ do per the @gsd-api contract.

**How to avoid:** Agent prompt must explicitly state: "Read the @gsd-api description to understand the expected behavior. Write assertions against the contract's stated return shape and side effects. Do NOT inspect stub return values to write assertions."

**Warning signs:** All tests pass on first run without any GREEN-phase implementation work.

### Pitfall 2: Wrong Test Directory

**What goes wrong:** Agent creates `tests/foo.test.cjs` but the project uses `src/__tests__/foo.test.ts`. Tests are never found by the test runner.

**Why it happens:** Agent guesses directory without inspecting existing structure.

**How to avoid:** Step 1 of agent execution must discover the existing test directory by globbing for `**/*.test.*` and `**/*.spec.*` before writing any test files (this is in the Step 1 design above).

**Warning signs:** `npm test` exits 0 with "no tests found" after agent claims success.

### Pitfall 3: test-detector.cjs Reads Wrong package.json

**What goes wrong:** `detectTestFramework(cwd)` reads this project's package.json (vitest + node:test) instead of the target project's package.json, and returns the wrong framework.

**Why it happens:** `cwd` is resolved relative to where gsd-tools.cjs is running, not the target project.

**How to avoid:** The `detect-test-framework` subcommand must accept a `<projectRoot>` argument. The agent passes the project root, not the default cwd. Document this in the subcommand signature: `gsd-tools detect-test-framework <projectRoot>`.

**Warning signs:** Agent generates `vitest` test syntax for a project that uses `jest`.

### Pitfall 4: @gsd-risk Annotations Break the Comment Anchor Rule

**What goes wrong:** Agent adds `@gsd-risk` inline after code: `const x = foo(); // @gsd-risk(reason:...) untested path`. The scanner skips this because the comment is not the first non-whitespace content on the line.

**Why it happens:** Agent places annotation on same line as code for convenience.

**How to avoid:** Agent constraints section must reiterate the comment anchor rule from arc-standard.md. A @gsd-risk tag must occupy its own line with the comment token as the first non-whitespace content.

**Warning signs:** CODE-INVENTORY.md shows zero @gsd-risk tags after agent claims to have added them.

### Pitfall 5: Installer Registration Required for New CJS Module

**What goes wrong:** `test-detector.cjs` is created but install.js doesn't copy it to `~/.claude/`. Existing installations don't have the file, and `require('./lib/test-detector.cjs')` fails at runtime.

**Why it happens:** Unlike agent .md files (which are auto-discovered by glob), CJS lib files are NOT auto-discovered. They are either referenced via `require()` in gsd-tools.cjs (which is bundled) or must be explicitly included.

**How to avoid:** `test-detector.cjs` lives in `get-shit-done/bin/lib/` — this directory is inside `get-shit-done/` which is listed in the `files` array of `package.json`. The module is accessed via `require('./lib/test-detector.cjs')` from gsd-tools.cjs at runtime, so it ships with the distribution automatically. No explicit installer change needed — but this must be verified.

**Warning signs:** `Error: Cannot find module './lib/test-detector.cjs'` in production after install.

### Pitfall 6: Node:test Output Buffering Causes RED Misread

**What goes wrong:** Agent runs `node --test` and interprets a buffering artifact as a pass signal before all test results are flushed.

**Why it happens:** node:test writes TAP output progressively; the agent reads the first few lines and sees `✓` before later `✗` lines appear.

**How to avoid:** In the agent prompt, instruct the agent to read the FULL Bash output, specifically looking for the summary line (e.g., `# tests 5 pass 3 fail 2`) rather than individual test lines.

---

## Code Examples

### test-detector.cjs — Full Module

```javascript
// Source: .planning/research/STACK.md design + config.cjs pattern

'use strict';
const fs = require('fs');
const path = require('path');

/**
 * @gsd-api detectTestFramework(projectRoot: string)
 *   Returns: { framework: string, testCommand: string, filePattern: string }
 *   Reads target project's package.json to detect test framework.
 *   Falls back to node:test when package.json is absent or unrecognized.
 */
function detectTestFramework(projectRoot) {
  const pkgPath = path.join(projectRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return { framework: 'node:test', testCommand: 'node --test', filePattern: '**/*.test.cjs' };
  }

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  } catch {
    return { framework: 'node:test', testCommand: 'node --test', filePattern: '**/*.test.cjs' };
  }

  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const testScript = (pkg.scripts && pkg.scripts.test) || '';

  if (deps.vitest || testScript.includes('vitest')) {
    return { framework: 'vitest', testCommand: 'npx vitest run', filePattern: '**/*.test.{ts,js}' };
  }
  if (deps.jest || testScript.includes('jest')) {
    return { framework: 'jest', testCommand: 'npx jest', filePattern: '**/*.test.{ts,js}' };
  }
  if (deps.mocha || testScript.includes('mocha')) {
    return { framework: 'mocha', testCommand: 'npx mocha', filePattern: '**/*.test.{mjs,cjs,js}' };
  }
  if (deps.ava || testScript.includes('ava')) {
    return { framework: 'ava', testCommand: 'npx ava', filePattern: '**/*.test.{mjs,js}' };
  }
  if (testScript.includes('--test')) {
    return { framework: 'node:test', testCommand: 'node --test', filePattern: '**/*.test.cjs' };
  }
  return { framework: 'node:test', testCommand: 'node --test', filePattern: '**/*.test.cjs' };
}

module.exports = { detectTestFramework };
```

### test-detector.test.cjs — Test File Pattern

```javascript
// Source: tests/arc-scanner.test.cjs pattern + tests/config.test.cjs pattern

'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createTempProject, cleanup } = require('./helpers.cjs');
const { detectTestFramework } = require('../get-shit-done/bin/lib/test-detector.cjs');

describe('detectTestFramework', () => {
  let tmpDir;

  // beforeEach / afterEach follow helpers.cjs createTempProject() / cleanup() pattern

  test('returns node:test when package.json does not exist', () => {
    const result = detectTestFramework('/nonexistent/path');
    assert.strictEqual(result.framework, 'node:test');
    assert.strictEqual(result.testCommand, 'node --test');
  });

  test('detects vitest from devDependencies', () => {
    // Write a package.json with vitest in devDependencies to tmpDir
    // assert result.framework === 'vitest'
  });

  test('detects jest from scripts.test', () => {
    // Write a package.json with "test": "jest" in scripts
    // assert result.framework === 'jest'
  });

  test('falls back to node:test when no framework recognized', () => {
    // Write a minimal package.json with no test framework
    // assert result.framework === 'node:test'
  });
});
```

### @gsd-risk Annotation — Correct Syntax

```javascript
// Source: get-shit-done/references/arc-standard.md

// Valid placement (comment token is first non-whitespace):
// @gsd-risk(reason:external-http-call, severity:high) sendEmail() calls SMTP — cannot be unit tested without mocking
async function sendEmail(to, subject, body) { ... }

// Invalid placement (inline after code — scanner will skip this):
async function sendEmail(to, subject, body) { ... } // @gsd-risk(reason:...) WRONG
```

### add-tests.md ARC Routing Block

```markdown
<!-- Source: agents/gsd-arc-executor.md ARC check pattern -->

## ARC Mode Check

Check if ARC mode is enabled and CODE-INVENTORY.md exists:

```bash
ARC_ENABLED=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" config-get arc.enabled 2>/dev/null || echo "true")
CODE_INVENTORY="$PWD/.planning/prototype/CODE-INVENTORY.md"
```

If ARC_ENABLED is "true" AND CODE-INVENTORY.md exists at $CODE_INVENTORY:
  Spawn gsd-tester with:
  - Prototype source file list from PROTOTYPE-LOG.md
  - CODE-INVENTORY.md path for @gsd-api contracts
  - Phase context from $ARGUMENTS

Otherwise:
  Continue with existing add-tests workflow (all steps unchanged).
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Test generation after phase execution (add-tests workflow) | Test generation against API contracts during prototype iteration (gsd-tester) | Phase 7 | Tests are now written before full implementation exists, using @gsd-api as specification |
| Manual test framework detection via ask | Auto-detection from package.json | Phase 7 | Eliminates user friction; deterministic for Node.js projects |
| Coverage gaps documented in SUMMARY.md | Coverage gaps annotated with @gsd-risk in source code | Phase 7 | Risk annotations appear in CODE-INVENTORY.md and feed gsd-reviewer in Phase 8 |

**Deprecated/outdated in this phase context:**
- Using `add-tests.md` workflow directly for ARC-mode projects: gsd-tester replaces this path when CODE-INVENTORY.md exists. The old path remains valid for non-ARC projects.

---

## Open Questions

1. **Stub detection definition**
   - What we know: D-07/D-08 require tests to fail on stubs before passing on real implementation
   - What's unclear: The agent must recognize "stub implementation" in prototype code. What patterns qualify? The STATE.md blocker (Phase 7 concern) explicitly flags this as unresolved.
   - Recommendation: Include explicit stub patterns in the agent prompt. Common stub patterns in this project: functions that `throw new Error('not implemented')`, return `undefined`/`null`/`{}` unconditionally, or return a hardcoded primitive. The agent should write assertions that assert the _contract_ return shape (e.g., `assert.ok(result.id)` for a createUser function returning `{id, email, createdAt}`) — which will fail against `return undefined`.

2. **Test file naming when no existing convention**
   - What we know: D-04 says to use existing convention or create `tests/` if none exists
   - What's unclear: When `tests/` is created fresh, should files be `.test.cjs` (this project's convention) or `.test.js` (framework's default)?
   - Recommendation: Agent should use the detected framework's default extension. For node:test, `.test.cjs`; for jest/vitest, `.test.js`. Document this decision in the agent's constraints section.

3. **gsd-tools.cjs subcommand vs. direct require in agent**
   - What we know: D-12 says agent uses test-detector.cjs to determine test command. D-11 says agent runs tests via Bash.
   - What's unclear: Should the agent call `gsd-tools detect-test-framework` via Bash, or read package.json directly?
   - Recommendation: Use `gsd-tools detect-test-framework <projectRoot>` via Bash. This is consistent with the state-gateway pattern and makes the detection testable independently.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js >=20 | test-detector.cjs, gsd-tester Bash execution | Yes | v24.14.0 | — |
| `node:test` | test-detector.test.cjs | Yes | Built-in | — |
| `node:assert` | test-detector.test.cjs | Yes | Built-in | — |
| `node:fs`, `node:path` | test-detector.cjs | Yes | Built-in | — |
| `tests/helpers.cjs` | test-detector.test.cjs | Yes | Existing | — |
| Target project's test framework | gsd-tester agent Bash execution | Varies by target | Detected at runtime | Fall back to node:test if not detected |

**Missing dependencies with no fallback:** None — all dependencies are Node.js built-ins or pre-existing project files.

**Missing dependencies with fallback:** Target project's test runner — if not detected, node:test is used as the safe default.

---

## Validation Architecture

> Skipped — `workflow.nyquist_validation` is explicitly `false` in `.planning/config.json`.

---

## Sources

### Primary (HIGH confidence)

- `agents/gsd-prototyper.md` — Complete agent file format, 5-step execution flow, constraints section, YAML frontmatter
- `agents/gsd-arc-executor.md` — ARC mode check pattern, TDD execution flow (lines 363-375), Bash tool test execution
- `get-shit-done/references/arc-standard.md` — @gsd-risk tag definition, `reason:` and `severity:` metadata keys, comment anchor rule
- `get-shit-done/bin/lib/config.cjs` — CJS module structure, `module.exports` pattern, error handling
- `tests/arc-scanner.test.cjs` + `tests/config.test.cjs` — node:test + node:assert test patterns, helpers.cjs usage
- `tests/helpers.cjs` — `createTempProject()`, `cleanup()`, `runGsdTools()` helper functions
- `get-shit-done/bin/gsd-tools.cjs` (lines 140-155, 914-928) — lib module import pattern, subcommand switch block
- `commands/gsd/add-tests.md` — Current state: no ARC routing; must be added
- `get-shit-done/workflows/add-tests.md` — Existing test classification and RED-GREEN patterns to preserve
- `.planning/research/ARCHITECTURE.md` — Layer 3 gsd-tester architecture, anti-patterns, component boundaries
- `.planning/research/STACK.md` — test-detector.cjs detection algorithm design, zero-dep constraint, framework coverage
- `bin/install.js` (lines 3955-3961) — Auto-discovery of `agents/gsd-*.md`; no explicit registration needed
- `.planning/config.json` — `workflow.nyquist_validation: false` confirmed

### Secondary (MEDIUM confidence)

- `.planning/STATE.md` — Phase 7 blocker: "stub implementation" definition must be in agent prompt (confirmed as open question)
- `.planning/REQUIREMENTS.md` — TEST-01 through TEST-05 requirements scope

### Tertiary (LOW confidence)

- None — all claims supported by direct codebase inspection.

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — all components are existing project patterns, verified by direct file reads
- Architecture patterns: HIGH — agent file format, CJS module structure, gsd-tools.cjs subcommand pattern all verified from codebase
- Pitfalls: HIGH — derived from arc-standard.md syntax rules, existing agent patterns, and explicitly documented anti-patterns in ARCHITECTURE.md
- Detection algorithm: HIGH — design confirmed in STACK.md, logic verified against this project's own package.json (vitest + node:test both detected correctly)

**Research date:** 2026-03-29
**Valid until:** 2026-04-28 (stable domain — agent format and CJS patterns change rarely)
