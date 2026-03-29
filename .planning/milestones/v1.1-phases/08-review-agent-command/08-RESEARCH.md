# Phase 8: Review Agent + Command - Research

**Researched:** 2026-03-29
**Domain:** Claude Code agent authoring, command orchestration, two-stage code review pipeline
**Confidence:** HIGH — all findings drawn from direct codebase inspection of existing agents, commands, and project research documents

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** New command is `/gsd:review-code` (file: `commands/gsd/review-code.md`). Does NOT modify existing `/gsd:review`. Two distinct commands, two distinct purposes.
- **D-02:** Output file is `REVIEW-CODE.md` (not REVIEW.md, not REVIEWS.md). Hard naming constraint to avoid collision with existing plan review artifacts.
- **D-03:** gsd-reviewer is a NEW standalone agent (`agents/gsd-reviewer.md`), NOT a wrapper around gsd-verifier. Different lifecycle position.
- **D-04:** Agent frontmatter: `name: gsd-reviewer`, tools: `Read, Write, Bash, Grep, Glob` (no Edit — reviewer reads and writes reports, doesn't modify code).
- **D-05:** Agent receives test results as context in its Task() prompt, NOT by running tests itself. Test execution happens in the command orchestrator via Bash.
- **D-06:** Stage 1 (spec compliance): Check each PRD acceptance criterion against code/tests. Reports pass/fail per AC.
- **D-07:** Stage 2 (code quality): Security, maintainability, error handling, edge cases. Only runs if Stage 1 passes.
- **D-08:** If Stage 1 fails, review stops and presents which ACs are not met. Stage 2 is not executed.
- **D-09:** Review includes concrete manual verification steps for UI/navigation/UX. Format: numbered checklist "Open X, click Y, expect Z."
- **D-10:** Manual steps cover what automated tests cannot: visual appearance, navigation flow, UX, responsiveness.
- **D-11:** REVIEW-CODE.md includes at most 5 prioritized next steps. Each has: file path, severity (critical/high/medium/low), and a concrete action description.
- **D-12:** Output schema designed for future `--fix` chaining (pipe into /gsd:iterate as @gsd-todo tags). Design now even though --fix is deferred to v1.2+.
- **D-13:** `/gsd:review-code` runs test suite via Bash using test-detector.cjs from Phase 7. Test output captured and passed to gsd-reviewer.
- **D-14:** If no test runner detected, reviewer proceeds with Stage 1 only and notes absence as a @gsd-risk in REVIEW-CODE.md.

### Claude's Discretion

- Exact REVIEW-CODE.md section structure beyond the required fields
- How to handle projects with no PRD (review against REQUIREMENTS.md instead)
- Verbosity level of Stage 2 findings
- Whether to include code snippets in review output

### Deferred Ideas (OUT OF SCOPE)

- `--fix` flag to pipe review findings into /gsd:iterate as @gsd-todo tags — deferred to v1.2+
- Judge/filter pattern for review verbosity control — design now, implement if needed
- Review-to-iterate automated chain — deferred to v1.2+
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REV-01 | /gsd:review-code performs Stage 1 review: spec compliance (PRD ACs met?) | Two-stage architecture documented in FEATURES.md and CONTEXT.md D-06/D-07/D-08 |
| REV-02 | /gsd:review-code performs Stage 2 review: code quality (security, maintainability) | Stage 2 agent prompt design in Architecture Patterns section |
| REV-03 | Stage 2 only runs if Stage 1 passes | Command orchestrator gate in review-code.md step flow |
| REV-04 | Review includes manual verification steps (UI, navigation, UX checklist) | D-09 constraint; format pattern from gsd-verifier human verification section |
| REV-05 | Review includes actionable next steps for user and agent | D-11 constraint; 5-item max, severity-ranked |
| REV-06 | Review output written to REVIEW-CODE.md with structured schema for future --fix chaining | D-12 constraint; REVIEW-CODE.md schema section below |
| REV-07 | gsd-reviewer executes test suite and includes results in review | D-13 constraint; test execution in command layer, results passed to agent |
</phase_requirements>

---

## Summary

Phase 8 creates two new files — `commands/gsd/review-code.md` and `agents/gsd-reviewer.md` — and registers the agent in `bin/install.js`. No existing files are modified. The command orchestrates test detection, test execution, and two-stage agent evaluation; the agent receives all context in its Task() prompt and writes REVIEW-CODE.md directly.

The key design constraint is the hard separation between command layer (test execution, Stage 1 gate, context assembly) and agent layer (evaluation, judgment, structured output). This separation is already established in Phase 7 with gsd-tester: the agent writes tests, the command runs them. Phase 8 extends the same pattern.

The two-stage gate (Stage 1 passes before Stage 2 runs) is the architectural differentiator. It prevents wasting review cycles on code quality when spec compliance is not yet met. The command orchestrator enforces this gate — it is NOT delegated to the agent to decide whether to run Stage 2.

**Primary recommendation:** Build the command orchestrator first (steps, flags, test execution, result formatting, gate logic), then write the agent prompt around the context the command will provide. Do not write the agent in isolation.

---

## Standard Stack

### Core (all pre-existing — zero new dependencies)

| Component | Version | Purpose | Source |
|-----------|---------|---------|--------|
| `agents/gsd-reviewer.md` | NEW | Review evaluation agent | New file following existing agent format |
| `commands/gsd/review-code.md` | NEW | Command orchestrator | New file following existing command format |
| `get-shit-done/bin/lib/test-detector.cjs` | Phase 7 | Test framework detection | Already exists, exposed via `detect-test-framework` subcommand |
| `get-shit-done/bin/gsd-tools.cjs` | Existing | CLI state gateway | `detect-test-framework [dir]` returns `{ framework, testCommand, filePattern }` |
| `bin/install.js` | MODIFIED | Register new agent for copy | Add `agents/gsd-reviewer.md` to the copy list |

### No New Runtime Dependencies

This project has zero external runtime dependencies. Phase 8 must maintain this. All functionality uses:
- Node.js built-ins for Bash execution
- The existing `test-detector.cjs` module
- Claude Code's native Task() and AskUserQuestion tools

### Agent Frontmatter Template (verified against all 23 existing agents)

```yaml
---
name: gsd-reviewer
description: Evaluates prototype code quality via two-stage review (spec compliance then code quality). Reads test results from Task() context. Writes REVIEW-CODE.md with structured findings and actionable next steps.
tools: Read, Write, Bash, Grep, Glob
permissionMode: acceptEdits
color: green
---
```

Note: no `Edit` tool — reviewer reads and writes reports, never modifies source code (D-04).

### Command Frontmatter Template (verified against prototype.md, iterate.md)

```yaml
---
name: gsd:review-code
description: Two-stage prototype code review — spec compliance check (Stage 1) then code quality evaluation (Stage 2). Runs test suite, spawns gsd-reviewer, writes REVIEW-CODE.md with actionable next steps.
argument-hint: "[path] [--non-interactive]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Task
  - Glob
  - Grep
  - AskUserQuestion
---
```

---

## Architecture Patterns

### How Phase 8 Fits the Existing Layer Map

```
/gsd:review-code (commands/gsd/review-code.md)
        |
        | Step 1: detect-test-framework via Bash
        | Step 2: run test suite via Bash (capture stdout/exit code)
        | Step 3: assemble Task() context (test results + paths)
        | Step 4: spawn gsd-reviewer via Task()
        |         — pass Stage 1 gate result from command
        | Step 5: read REVIEW-CODE.md summary
        | Step 6: present to user via AskUserQuestion
        v
agents/gsd-reviewer.md
        |
        | Step 1: read project context (CLAUDE.md, PROJECT.md)
        | Step 2: read prototype artifacts (CODE-INVENTORY.md, PROTOTYPE-LOG.md)
        | Step 3: Stage 1 — check each PRD AC against code + test evidence
        | Step 4: if Stage 1 PASS → Stage 2 (code quality)
        |         if Stage 1 FAIL → stop, write failures only
        | Step 5: write REVIEW-CODE.md
        v
.planning/prototype/REVIEW-CODE.md
```

The command layer enforces the Stage 1/Stage 2 gate. The agent does not decide whether to run Stage 2 — the command passes `stage1_passed: true/false` in the Task() prompt, and the agent branches on that value.

### Pattern 1: Command as Thin Orchestrator (inline steps, no separate workflow file)

`/gsd:prototype` and `/gsd:iterate` both embed orchestration logic directly in the command `.md` file without delegating to a workflow file. Phase 8 follows the same pattern — no `get-shit-done/workflows/review-code.md` file is needed.

```markdown
<!-- commands/gsd/review-code.md structure -->
---
[frontmatter]
---
<objective>...</objective>
<context>
$ARGUMENTS
@.planning/PROJECT.md
@.planning/REQUIREMENTS.md
</context>
<process>
## Step 0: Parse flags
## Step 1: Detect test framework
## Step 2: Run test suite
## Step 3: Load PRD / AC list
## Step 4: Spawn gsd-reviewer
## Step 5: Present results
</process>
```

Source: `commands/gsd/prototype.md` (verified by direct read — 7-step inline process, no workflow file reference)

### Pattern 2: Test Execution in Command Layer, Results Passed to Agent

Established in Phase 7 architecture research (ARCHITECTURE.md Layer 4 anti-patterns). Test execution belongs in the command orchestrator:

```bash
# In review-code.md Step 1: Detect test framework
TEST_INFO=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" detect-test-framework "$PWD")
# Returns JSON: { "framework": "vitest", "testCommand": "npx vitest run", "filePattern": "**/*.test.{ts,js}" }

# In review-code.md Step 2: Run tests and capture output
TEST_OUTPUT=$(eval "$TEST_COMMAND" 2>&1)
TEST_EXIT=$?
```

The agent receives `test_output`, `test_exit_code`, `framework` as context — NOT the command to run them again.

Source: ARCHITECTURE.md "Anti-Pattern: Test execution inside gsd-tester" section (HIGH confidence)

### Pattern 3: PRD / AC Resolution for Stage 1

Stage 1 requires a list of acceptance criteria to check against. The command must resolve where to get them:

**Priority chain (parallels the PRD resolution in prototype.md):**
1. `.planning/prototype/CODE-INVENTORY.md` — contains `@gsd-todo(ref:AC-N)` tags linked to the PRD ACs from prototype phase
2. `.planning/PRD.md` — if present, re-extract ACs for direct comparison
3. REQUIREMENTS.md — fallback if no PRD; review against listed requirements
4. No structured spec — proceed with Stage 2 only, note in REVIEW-CODE.md that spec compliance was not checked

This resolution is done in the command layer, not the agent. The agent receives the AC list in its Task() prompt.

### Pattern 4: Two-Stage Gate Enforcement

The command enforces the Stage 1/2 gate, not the agent:

```markdown
## Step 4: Spawn gsd-reviewer

Build the Task() prompt:
- Include: test output, test exit code, AC list (from Step 3)
- Include: **stage1_instruction** — "Perform Stage 1 spec compliance. For each AC, check whether
  the code/tests satisfy it. If ALL ACs pass, set stage1_result=PASS and proceed to Stage 2.
  If ANY AC fails, set stage1_result=FAIL, list failing ACs, and DO NOT perform Stage 2."
- This ensures the agent receives the gate logic as explicit instruction, not implicit expectation.
```

The agent's Step 3 in its execution flow reads: "If stage1_result = FAIL, write REVIEW-CODE.md with Stage 1 failures only and stop. Do NOT evaluate code quality."

Source: CONTEXT.md D-07/D-08 (HIGH confidence, locked decision)

### Pattern 5: REVIEW-CODE.md Schema (structured for future --fix chaining)

Designed per D-12: the schema is machine-parseable now even though `--fix` is deferred.

```markdown
---
review_date: YYYY-MM-DDTHH:MM:SSZ
stage1_result: PASS | FAIL
stage2_result: PASS | FAIL | SKIPPED
test_framework: vitest | jest | node:test | none
tests_run: N
tests_passed: N
tests_failed: N
ac_total: N
ac_passed: N
ac_failed: N
next_steps:
  - id: NS-1
    file: src/foo.js
    severity: critical | high | medium | low
    action: "Concrete imperative action description"
  - id: NS-2
    ...
---

# Code Review: [Project Name]

**Review date:** {date}
**Stage 1 (Spec Compliance):** PASS | FAIL
**Stage 2 (Code Quality):** PASS | FAIL | SKIPPED (Stage 1 failed)

## Test Results

| Framework | Tests Run | Passed | Failed |
|-----------|-----------|--------|--------|
| {framework} | N | N | N |

## Stage 1: Spec Compliance

| AC | Description | Status | Evidence |
|----|-------------|--------|----------|
| AC-1 | {description} | PASS / FAIL | {file:line or "no evidence found"} |

## Stage 2: Code Quality

> Skipped — Stage 1 failures must be resolved first.

OR (if Stage 1 passed):

### Security
### Maintainability
### Error Handling
### Edge Cases

## Manual Verification Steps

1. Open [file/URL], do [action], expect [result]
2. ...

## Next Steps (top 5, prioritized by severity)

| # | File | Severity | Action |
|---|------|----------|--------|
| 1 | src/foo.js | critical | {concrete action} |
...
```

The YAML frontmatter `next_steps` array is the machine-readable surface for future `--fix` chaining.

### Pattern 6: Agent Step Structure (5-step pattern from gsd-tester)

gsd-tester uses a clear 5-step flow with named steps. gsd-reviewer should follow the same pattern:

```markdown
<step name="load_context" number="1">
Read CLAUDE.md, PROJECT.md, CODE-INVENTORY.md, PROTOTYPE-LOG.md, PRD.md (if exists)
</step>

<step name="stage1_spec_compliance" number="2">
For each AC from Task() prompt context:
  - Search code/tests for evidence of implementation
  - Mark PASS (evidence found) or FAIL (no evidence)
  - If ANY fail: skip to step 4 with stage1_result=FAIL
</step>

<step name="stage2_code_quality" number="3">
ONLY if stage1_result = PASS:
  - Security: secrets, input validation, injection risks
  - Maintainability: complexity, duplication, naming
  - Error handling: unhandled exceptions, missing guard clauses
  - Edge cases: boundary conditions not covered by tests
</step>

<step name="write_review_code_md" number="4">
Write .planning/prototype/REVIEW-CODE.md using Write tool (never Bash heredoc)
</step>

<step name="manual_verification" number="5">
For any UI-bearing code: generate numbered checklist of manual verification steps
Append to REVIEW-CODE.md
</step>
```

### Recommended Project Structure (new files only)

```
agents/
└── gsd-reviewer.md         # NEW — review evaluation agent

commands/gsd/
└── review-code.md          # NEW — command orchestrator

bin/
└── install.js              # MODIFIED — register gsd-reviewer.md for copy
```

Output location:
```
.planning/prototype/
└── REVIEW-CODE.md          # Written by gsd-reviewer agent
```

### Anti-Patterns to Avoid

- **Running tests inside the agent:** The agent context window stays open during test execution, blocking output and risking timeout. Tests are run in the command layer via Bash, results passed to agent. (Source: ARCHITECTURE.md anti-pattern section)
- **Modifying existing `/gsd:review`:** The existing `commands/gsd/review.md` performs cross-AI plan review and writes REVIEWS.md. Phase 8 creates a new file `commands/gsd/review-code.md` that writes REVIEW-CODE.md. Never edit the existing file. (Source: CONTEXT.md D-01, Pitfall 15)
- **gsd-reviewer extending gsd-verifier:** Different lifecycle position. gsd-verifier checks phase goal achievement after execution. gsd-reviewer evaluates prototype quality before iteration. Do not extend or wrap gsd-verifier. Copy evaluation patterns if needed. (Source: CONTEXT.md D-03)
- **Stage 2 running regardless of Stage 1:** If Stage 1 fails, Stage 2 produces misleading quality signals about code that doesn't meet the spec. The gate must be hard — no configuration, no flags to bypass. (Source: CONTEXT.md D-08, FEATURES.md two-stage review differentiator)
- **Verbose, unfocused review output:** Per Pitfall 14, reviews with more than 5 actionable items are routinely skipped by developers. Hard cap at 5 next steps. Each must have file path, severity, and a concrete imperative action. Generic advice ("consider adding error handling") is not acceptable. (Source: PITFALLS.md Pitfall 14)
- **Placing the next_steps schema in agent discretion:** The schema must be defined in the agent prompt explicitly. If left to agent discretion, the format varies across runs, making future --fix chaining impossible. (Source: CONTEXT.md D-12)

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Test framework detection | Custom package.json scanner | `node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" detect-test-framework "$PWD"` | Phase 7 already built and tested this; returns `{ framework, testCommand, filePattern }` JSON |
| AC list for Stage 1 | Re-parsing PRD inline | Read from CODE-INVENTORY.md `@gsd-todo(ref:AC-N)` tags — these are already the normalized ACs from the prototype phase | The prototype pipeline guarantees one tag per AC; don't re-derive from prose |
| REVIEW-CODE.md file write | Bash heredoc | Write tool | Project-wide rule: always Write tool for file creation, never heredoc |
| Stage 1 gate logic | Complex agent reasoning | Command orchestrator passes `stage1_result` explicitly in Task() prompt | Gate logic in the command layer, not delegated to agent judgment |

**Key insight:** Phase 7 infrastructure (test-detector.cjs, detect-test-framework subcommand) and Phase 6 infrastructure (@gsd-todo tags in CODE-INVENTORY.md) already provide the two main data inputs for the review pipeline. Phase 8 consumes them, it does not rebuild them.

---

## Common Pitfalls

### Pitfall 1: Verbose Review Output That Gets Skipped (Pitfall 14)
**What goes wrong:** Review agent produces 10-20 generic findings, developer skims or ignores it, review step is abandoned within a week.
**Why it happens:** Without explicit output constraints, LLMs default to comprehensive coverage. "Comprehensive" = low signal density.
**How to avoid:** Hard cap of 5 next steps in the agent prompt. Each must have file path + severity + concrete action. The agent prompt must state: "If you identify more than 5 issues, rank by severity and report only the top 5. Generic advice without a specific file path is forbidden."
**Warning signs:** Stage 2 output exceeds one page; findings contain no file paths; multiple findings say "consider..."

### Pitfall 2: Stage 2 Running Despite Stage 1 Failures
**What goes wrong:** Review evaluates code quality for code that doesn't meet spec, giving the user misleading green signals.
**How to avoid:** The command layer detects the Stage 1 result (either from a structured output field or from parsing REVIEW-CODE.md after the agent writes it). If `stage1_result: FAIL` is present, the command presents only Stage 1 findings to the user and suppresses Stage 2 output from the display (even if the agent wrote it). Belt-and-suspenders: the command enforces the gate independently of the agent.
**Warning signs:** REVIEW-CODE.md contains both `stage1_result: FAIL` and a populated Stage 2 section.

### Pitfall 3: No PRD/AC List Available for Stage 1
**What goes wrong:** User runs `/gsd:review-code` on a codebase that was not built via `/gsd:prototype`, so there are no `@gsd-todo(ref:AC-N)` tags in CODE-INVENTORY.md and no `.planning/PRD.md`. Stage 1 has nothing to check.
**How to avoid:** The command must handle this case explicitly. Resolution priority:
  1. CODE-INVENTORY.md has `ref:AC-N` tags → use them
  2. `.planning/PRD.md` exists → re-extract ACs for Stage 1
  3. `.planning/REQUIREMENTS.md` exists → use requirement list as AC substitute
  4. None of the above → skip Stage 1, run Stage 2 only, note "No spec file found — spec compliance check skipped" in REVIEW-CODE.md
**Warning signs:** Command fails with no error message; REVIEW-CODE.md is empty or missing Stage 1 section entirely.

### Pitfall 4: Test Detection Returns "node:test" Fallback When No Tests Exist
**What goes wrong:** `detect-test-framework` always returns a result (falls back to `node:test`), so the command cannot distinguish "project uses node:test" from "no test files exist at all." The command runs `node --test` on a project with no test files, gets output like "no tests found," and passes this as context to the agent, which misinterprets it as a test failure rather than an absence.
**How to avoid:** After running the test command, check the output for "no test files" / "no tests found" patterns. If detected, treat as D-14 case: proceed with Stage 1 only, annotate absence as `@gsd-risk(reason:no-tests, severity:high)` in REVIEW-CODE.md. Do NOT report "0 tests passed" as a test failure.
**Warning signs:** Test output contains "no test files found" but REVIEW-CODE.md shows `tests_failed: N`.

### Pitfall 5: /gsd:review Command Collision
**What goes wrong:** Developer accidentally edits `commands/gsd/review.md` instead of creating `commands/gsd/review-code.md`. The existing cross-AI plan review is silently broken.
**How to avoid:** Treat `commands/gsd/review.md` as read-only. Phase 8 only creates `commands/gsd/review-code.md`. The plan in PLAN.md should list the file paths explicitly to prevent ambiguity.
**Warning signs:** Git diff shows modifications to `commands/gsd/review.md`.

### Pitfall 6: Agent Writes REVIEW-CODE.md Before Stage 1 Gate Decision
**What goes wrong:** Agent writes a partial REVIEW-CODE.md during Stage 1, then the command reads an incomplete file and incorrectly determines the stage1_result.
**How to avoid:** Agent must write REVIEW-CODE.md as a single atomic Write tool call at the end of its execution, not incrementally. The YAML frontmatter with `stage1_result` must be present in that final write. The command reads REVIEW-CODE.md only after gsd-reviewer completes (i.e., after the Task() call returns).

---

## Code Examples

### Detect Test Framework in Command Layer
```bash
# Source: gsd-tools.cjs detect-test-framework subcommand (line 950-956)
TEST_INFO=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" detect-test-framework "$PWD")
# Output: {"framework":"vitest","testCommand":"npx vitest run","filePattern":"**/*.test.{ts,js}"}
TEST_COMMAND=$(echo "$TEST_INFO" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');console.log(JSON.parse(d).testCommand)")
```

### Run Tests and Capture Results
```bash
# Run test command, capture both stdout+stderr and exit code
TEST_OUTPUT=$(eval "$TEST_COMMAND" 2>&1) || true
TEST_EXIT=$?
# TEST_EXIT=0 means all tests passed, non-zero means failures or no tests found
```

### Task() Prompt Assembly Pattern (from prototype.md Step 4)
```markdown
# Pattern verified from commands/gsd/prototype.md Step 4

Spawn gsd-reviewer via Task tool with prompt:

"""
**Test execution results:**
Framework: {framework}
Command run: {testCommand}
Exit code: {TEST_EXIT}
Output:
```
{TEST_OUTPUT}
```

**Acceptance criteria for Stage 1 check:**
{AC_LIST — one per line, format: AC-N: description}

**Stage 1 instruction:** If ALL ACs above are satisfied by evidence in the code or tests,
set stage1_result=PASS and proceed to Stage 2 code quality evaluation.
If ANY AC is not satisfied, set stage1_result=FAIL, list failing ACs, and do NOT perform Stage 2.

**Prototype artifacts:**
- CODE-INVENTORY.md: .planning/prototype/CODE-INVENTORY.md
- PROTOTYPE-LOG.md: .planning/prototype/PROTOTYPE-LOG.md
"""
```

### Agent Frontmatter (verified pattern from gsd-tester.md)
```yaml
---
name: gsd-reviewer
description: Evaluates prototype code quality via two-stage review. Receives test results and AC list in Task() context. Writes REVIEW-CODE.md with structured findings and top-5 actionable next steps.
tools: Read, Write, Bash, Grep, Glob
permissionMode: acceptEdits
color: green
---
```

### @gsd-risk Annotation Format (for "no tests found" case)
```javascript
// Source: arc-standard.md + gsd-tester.md Step 5 (verified pattern)
// @gsd-risk(reason:no-tests, severity:high) No test suite detected — automated test coverage unavailable
```
REVIEW-CODE.md should include this annotation in the next_steps YAML when D-14 applies.

### install.js Registration (verified pattern from existing agent registration)
```javascript
// In bin/install.js — add to the agent copy list alongside existing agents
// Pattern: same as how gsd-tester.md was registered in Phase 7
{ src: 'agents/gsd-reviewer.md', dest: 'agents/gsd-reviewer.md' }
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `/gsd:review` = cross-AI plan review | Two separate commands: `/gsd:review` (plan review) + `/gsd:review-code` (code review) | Phase 8 (v1.1) | Eliminates name collision; both commands are preserved |
| Single-stage code review | Two-stage: spec compliance before code quality | Phase 8 (v1.1) | Prevents reviewing quality of spec-non-compliant code |
| Test execution inside review agent | Test execution in command layer, results passed as context | Phase 7 architecture decision | Prevents context window blocking during long test suites |

**Deprecated/outdated:**
- ARCHITECTURE.md "Layer 5: Modified /gsd:review" — this was an early design option (Option A: context-aware `/gsd:review`). Superseded by CONTEXT.md D-01 which chose a new command `/gsd:review-code` instead.

---

## Environment Availability

Step 2.6: SKIPPED — Phase 8 is a pure command/agent authoring phase. All execution dependencies (Node.js, gsd-tools.cjs, test-detector.cjs) are verified to exist as part of the project's own toolchain. The test runner detection handles its own availability check at runtime.

---

## Validation Architecture

Validation section: SKIPPED — `workflow.nyquist_validation` is explicitly set to `false` in `.planning/config.json`.

---

## Open Questions

1. **How does the command handle the AC list when CODE-INVENTORY.md has NO `ref:AC-N` tags?**
   - What we know: The fallback chain is CODE-INVENTORY.md → PRD.md → REQUIREMENTS.md → skip Stage 1
   - What's unclear: The exact grep pattern to detect `ref:AC-` tags in CODE-INVENTORY.md needs to be specified in the command step, not left to the agent
   - Recommendation: Add an explicit Bash step in the command: `AC_COUNT=$(grep -c "ref:AC-" .planning/prototype/CODE-INVENTORY.md 2>/dev/null || echo "0")` and branch from there

2. **What severity thresholds trigger a Stage 1 FAIL vs. a warning?**
   - What we know: D-08 says "if Stage 1 fails, review stops." But partial AC coverage (e.g., 8 of 10 ACs met) isn't explicitly defined
   - What's unclear: Does 1 failing AC halt Stage 2, or is there a threshold?
   - Recommendation: D-08 says "if ANY AC is not met" → hard fail. One missing AC = Stage 1 FAIL. The planner should encode this as an explicit agent rule, not leave it to judgment.

3. **Does gsd-reviewer read source files directly or rely entirely on CODE-INVENTORY.md?**
   - What we know: D-05 says agent receives test results in context; agent tools include Read and Grep
   - What's unclear: The agent prompt should specify whether it reads prototype source files directly (for Stage 2 quality review) or only consults CODE-INVENTORY.md
   - Recommendation: For Stage 1, use CODE-INVENTORY.md (structured AC tags). For Stage 2, read source files directly via Read/Grep — CODE-INVENTORY.md doesn't capture security or maintainability signals.

---

## Sources

### Primary (HIGH confidence)
- `agents/gsd-tester.md` — verified agent format, 5-step flow structure, constraint section pattern
- `commands/gsd/prototype.md` — verified command orchestrator pattern, inline steps, Task() prompt assembly
- `commands/gsd/review.md` — verified: existing cross-AI plan review, writes REVIEWS.md, must not be modified
- `agents/gsd-verifier.md` — verified: different lifecycle position from gsd-reviewer, evaluation patterns borrowable
- `get-shit-done/bin/lib/test-detector.cjs` — verified detect-test-framework API: returns `{ framework, testCommand, filePattern }`
- `get-shit-done/bin/gsd-tools.cjs` lines 950-956 — verified `detect-test-framework` subcommand routing
- `.planning/phases/08-review-agent-command/08-CONTEXT.md` — all locked decisions (D-01 through D-14)
- `.planning/research/ARCHITECTURE.md` — Layer 4 design, anti-patterns, integration boundaries
- `.planning/research/FEATURES.md` — two-stage review pattern, structured output schema, feature dependencies
- `.planning/research/PITFALLS.md` lines 294-346 — Pitfall 14 (verbose output), Pitfall 15 (command name collision)
- `.planning/config.json` — `workflow.nyquist_validation: false` confirmed

### Secondary (MEDIUM confidence)
- `.planning/REQUIREMENTS.md` — REV-01 through REV-07 requirement descriptions
- `.planning/STATE.md` — accumulated decisions including REVIEW-CODE.md naming constraint and test-execution-in-command-layer decision

---

## Metadata

**Confidence breakdown:**
- Agent file format: HIGH — verified against 23 existing agents; gsd-tester.md is the direct template
- Command file format: HIGH — verified against prototype.md (closest parallel: multi-step orchestrator with PRD/context assembly)
- Two-stage gate pattern: HIGH — locked by D-06/D-07/D-08 in CONTEXT.md, supported by FEATURES.md research
- REVIEW-CODE.md schema: HIGH — D-11/D-12 define the constraints; specific section names are Claude's discretion
- Test execution flow: HIGH — established in Phase 7 architecture; test-detector.cjs verified
- Stage 1 AC resolution: MEDIUM — fallback chain is clear but exact grep commands and edge case handling need to be specified in PLAN

**Research date:** 2026-03-29
**Valid until:** 2026-04-28 (stable architecture domain — 30-day validity)
