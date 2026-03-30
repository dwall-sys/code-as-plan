---
name: gsd:review-code
description: Two-stage prototype code review -- spec compliance check (Stage 1) then code quality evaluation (Stage 2). Runs test suite, spawns gsd-reviewer, writes REVIEW-CODE.md with actionable next steps.
argument-hint: "[--non-interactive]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Task
  - Glob
  - Grep
  - AskUserQuestion
---

<objective>
Orchestrates a two-stage code review of the current prototype: Stage 1 checks spec compliance (do the PRD acceptance criteria pass?), Stage 2 checks code quality (security, maintainability, error handling, edge cases). Stage 2 only runs if Stage 1 passes.

This command:
1. Detects the test framework and runs the test suite, capturing results
2. Resolves the acceptance criteria list from CODE-INVENTORY.md, PRD.md, or REQUIREMENTS.md
3. Spawns the gsd-reviewer agent with all context it needs (test results + AC list + gate instructions)
4. Reads the resulting REVIEW-CODE.md and presents a formatted summary to the user
5. Suggests the next action based on Stage 1 result

The agent (gsd-reviewer) writes `.planning/prototype/REVIEW-CODE.md`. This command orchestrates and presents results.

**Arguments:**
- `--non-interactive` — skip the final AskUserQuestion prompt (for CI/headless pipelines); still runs full review and writes REVIEW-CODE.md
</objective>

<context>
$ARGUMENTS

@.planning/PROJECT.md
@.planning/REQUIREMENTS.md
</context>

<process>

## Step 0: Parse flags

Check `$ARGUMENTS` for the following flags:

- **`--non-interactive`** -- if present, set `non_interactive_mode = true`

Log the parsed flags so the user can confirm the invocation was understood.

## Step 1: Detect test framework and run tests

Detect the test framework using Phase 7 infrastructure:

```bash
TEST_INFO=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" detect-test-framework "$PWD")
```

This returns JSON: `{ "framework": "vitest", "testCommand": "npx vitest run", "filePattern": "**/*.test.{ts,js}" }`.

Extract `framework` and `testCommand` from the JSON output:

```bash
FRAMEWORK=$(echo "$TEST_INFO" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');console.log(JSON.parse(d).framework)")
TEST_COMMAND=$(echo "$TEST_INFO" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');console.log(JSON.parse(d).testCommand)")
```

Run the test suite and capture the full output including exit code:

```bash
TEST_OUTPUT=$(eval "$TEST_COMMAND" 2>&1) || true
TEST_EXIT=$?
```

Log: "Test framework: {FRAMEWORK} | Command: {TEST_COMMAND} | Exit code: {TEST_EXIT}"

**Handle the no-tests-found case (Pitfall 4):**

After running, check the output for "no test files" / "no tests found" / "found 0 test files" / "no tests matching" patterns:

```bash
echo "$TEST_OUTPUT" | grep -qi "no test\|no tests\|0 test files\|no spec files\|nothing to run" && TESTS_FOUND=false || TESTS_FOUND=true
```

If `TESTS_FOUND=false`:
- Log: "No test files found. Review will proceed without test results. Absence will be noted in REVIEW-CODE.md."
- Set `tests_run=0`, `tests_passed=0`, `tests_failed=0`
- Do NOT report "0 tests passed" as a test failure -- absence of tests is distinct from failing tests.

If `TESTS_FOUND=true`:
- Log full test output summary (first 50 lines + last 20 lines if output is long)

## Step 2: Resolve AC list for Stage 1

Determine the acceptance criteria for Stage 1 spec compliance. Use this resolution priority chain:

**Priority 1 -- CODE-INVENTORY.md has AC-linked tags:**

```bash
AC_COUNT=$(grep -c "ref:AC-" .planning/prototype/CODE-INVENTORY.md 2>/dev/null || echo "0")
```

If `AC_COUNT > 0`:
- Extract AC list from CODE-INVENTORY.md:
  ```bash
  grep "ref:AC-" .planning/prototype/CODE-INVENTORY.md | grep -oE "ref:AC-[0-9]+" | sort -u
  ```
- Read `.planning/prototype/CODE-INVENTORY.md` using the Read tool to get full AC descriptions from the @gsd-todo tags
- Log: "AC source: CODE-INVENTORY.md ({AC_COUNT} AC-linked tags found)"
- Set `SPEC_AVAILABLE=true`, `AC_SOURCE=code-inventory`

**Priority 2 -- PRD.md exists:**

If `AC_COUNT` is 0, check for PRD:
```bash
test -f .planning/PRD.md && echo "exists" || echo "missing"
```

If exists:
- Read `.planning/PRD.md` using the Read tool
- Extract ACs using the same semantic extraction as prototype.md Step 2:

  Extract all acceptance criteria, requirements, and success conditions from the PRD.
  Output format -- one per line:
  AC-1: [description in imperative form]
  AC-2: [description in imperative form]

  Rules:
  - Include ACs from prose paragraphs, bullet lists, tables, and user stories
  - Normalize user stories to acceptance criteria form
  - If no explicit ACs, infer from goals and scope sections
  - Output ONLY the numbered list -- no headers, no commentary

- Log: "AC source: .planning/PRD.md (re-extracted {N} ACs)"
- Set `SPEC_AVAILABLE=true`, `AC_SOURCE=prd`

**Priority 3 -- REQUIREMENTS.md exists:**

If no PRD, check REQUIREMENTS.md:
- Read `.planning/REQUIREMENTS.md` using the Read tool
- Extract requirements as AC substitutes -- use requirement IDs and descriptions as the AC list
- Log: "AC source: .planning/REQUIREMENTS.md (using requirements as AC substitutes)"
- Set `SPEC_AVAILABLE=true`, `AC_SOURCE=requirements`

**Priority 4 -- No spec available:**

If none of the above:
- Log: "No spec file found -- spec compliance check (Stage 1) will be skipped. Review will run Stage 2 only."
- Set `SPEC_AVAILABLE=false`

## Step 3: Spawn gsd-reviewer

Build the Task() prompt with ALL context gsd-reviewer needs. The prompt must include:

```
**Test execution results:**
Framework: {FRAMEWORK}
Command run: {TEST_COMMAND}
Exit code: {TEST_EXIT}
Tests found: {TESTS_FOUND}
Output:
{TEST_OUTPUT}

**Acceptance criteria for Stage 1 check ({AC_COUNT} total):**
{AC_LIST -- one per line, format: AC-N: description}

**Stage 1 instruction:**
For each AC listed above, check whether the code and/or tests satisfy it. Find concrete evidence (file path, line number, or code snippet). If ALL ACs are satisfied, set stage1_result=PASS and proceed to Stage 2 code quality evaluation. If ANY AC is not satisfied, set stage1_result=FAIL, list the failing ACs with reason, and do NOT perform Stage 2.

Note: One failing AC is enough to fail Stage 1. There is no threshold -- ALL ACs must pass.

**If SPEC_AVAILABLE=false:**
No spec file (PRD or REQUIREMENTS.md) was found. Skip Stage 1 entirely. Run Stage 2 code quality evaluation only. Note in REVIEW-CODE.md: "Spec compliance check skipped -- no PRD or requirements file found."

**Prototype artifact paths:**
- Code inventory: .planning/prototype/CODE-INVENTORY.md
- Prototype log: .planning/prototype/PROTOTYPE-LOG.md
```

Spawn gsd-reviewer via the Task tool with the prompt above. Wait for the agent to complete -- it will write `.planning/prototype/REVIEW-CODE.md` before returning.

## Step 4: Read review results

After the Task() call returns, read the review output:

Read `.planning/prototype/REVIEW-CODE.md` using the Read tool.

Parse the YAML frontmatter to extract:
- `stage1_result` (PASS / FAIL)
- `stage2_result` (PASS / FAIL / SKIPPED)
- `test_framework`, `tests_run`, `tests_passed`, `tests_failed`
- `ac_total`, `ac_passed`, `ac_failed`
- `next_steps` array (id, file, severity, action)

If REVIEW-CODE.md does not exist after the Task() call, log: "Warning: gsd-reviewer did not produce REVIEW-CODE.md. Check agent output above for errors."

## Step 5: Present results to user

**If `non_interactive_mode = true`:** Log the summary below and exit without AskUserQuestion.

**Otherwise:** Use AskUserQuestion to present a formatted summary and ask the user what to do next.

Format the summary as:

```
Review complete.

--- Stage 1: Spec Compliance ---
Result: {PASS / FAIL}
ACs checked: {ac_total} | Passed: {ac_passed} | Failed: {ac_failed}
{If FAIL: list failing ACs by ID}

--- Stage 2: Code Quality ---
Result: {PASS / FAIL / SKIPPED}
{If SKIPPED: "Skipped -- Stage 1 failures must be resolved first"}

--- Test Results ---
Framework: {test_framework}
Tests run: {tests_run} | Passed: {tests_passed} | Failed: {tests_failed}
{If no tests found: "No test files detected -- test coverage is absent (@gsd-risk noted in REVIEW-CODE.md)"}

--- Top Next Steps ---
{List up to 5 next steps from REVIEW-CODE.md: # | File | Severity | Action}

Full review: .planning/prototype/REVIEW-CODE.md
```

Then ask:

```
How would you like to proceed?

Options:
- "fix" or "iterate" -- run /gsd:iterate to address the next steps
- "details" -- I'll show you the full REVIEW-CODE.md content
- "done" -- accept results and continue
- "rerun" -- re-run the review after you've made manual changes

What's your next step?
```

**If Stage 1 passed:** suggest `/gsd:iterate` for improvements or proceed to manual verification steps from REVIEW-CODE.md.

**If Stage 1 failed:** recommend fixing the failing ACs first ("Resolve failing ACs before addressing code quality issues") before re-running `/gsd:review-code`.

Handle the user's response:
- "fix", "iterate", or similar: remind user to run `/gsd:iterate` with the REVIEW-CODE.md path for context
- "details": Read and display the full REVIEW-CODE.md content
- "done" or any other response: confirm review is complete and exit
- "rerun": remind user to make their changes first, then re-run `/gsd:review-code`

</process>
