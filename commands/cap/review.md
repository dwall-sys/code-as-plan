---
name: cap:review
description: Two-stage code review -- Stage 1 checks Feature Map AC compliance, Stage 2 checks code quality. Stage 2 only runs if Stage 1 passes.
argument-hint: "[--features NAME] [--stage2-only]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Task
  - Glob
  - Grep
  - AskUserQuestion
---

<!-- @gsd-context CAP v2.0 review command -- orchestrates two-stage code review. Collects test results, reads Feature Map ACs, spawns cap-reviewer agent. -->
<!-- @gsd-decision Stage 2 only runs if Stage 1 passes -- prevents wasted review cycles on code that does not meet spec. -->
<!-- @gsd-decision Review output goes to .cap/REVIEW.md -- centralized under .cap/ runtime directory. -->

<objective>
<!-- @gsd-todo(ref:AC-58) /cap:review shall invoke the cap-reviewer agent for two-stage review. -->

Runs two-stage code review:
1. Stage 1: Check Feature Map AC compliance (does the code implement what was promised?)
2. Stage 2: Check code quality (security, maintainability, error handling)

Stage 2 only runs if Stage 1 passes.

**Arguments:**
- `--features NAME` -- scope review to specific Feature Map entries
- `--stage2-only` -- skip Stage 1, run only code quality review
</objective>

<context>
$ARGUMENTS

@FEATURE-MAP.md
@.cap/SESSION.json
</context>

<process>

## Step 0: Parse flags

Check `$ARGUMENTS` for:
- `--features NAME` -- if present, store as `feature_filter`
- `--stage2-only` -- if present, set `stage2_only = true`

## Step 1: Collect test results

Run existing tests to get current pass/fail state:

```bash
node --test tests/*.test.cjs 2>&1 | tail -30
```

Store output as `test_output` and exit code as `test_exit_code`.

## Step 2: Read Feature Map ACs for review scope

<!-- @gsd-todo(ref:AC-59) Stage 1: cap-reviewer shall verify that the implementation satisfies all acceptance criteria listed in the Feature Map entry. -->

```bash
node -e "
const fm = require('./get-shit-done/bin/lib/cap-feature-map.cjs');
const session = require('./get-shit-done/bin/lib/cap-session.cjs');
const scanner = require('./get-shit-done/bin/lib/cap-tag-scanner.cjs');
const featureMap = fm.readFeatureMap(process.cwd());
const s = session.loadSession(process.cwd());
const tags = scanner.scanDirectory(process.cwd());
const groups = scanner.groupByFeature(tags);

console.log(JSON.stringify({
  activeFeature: s.activeFeature,
  features: featureMap.features.map(f => ({
    id: f.id, title: f.title, state: f.state,
    acs: f.acs, files: f.files
  })),
  tagGroups: Object.fromEntries(
    Object.entries(groups).map(([k, v]) => [k, v.map(t => ({ type: t.type, file: t.file, line: t.line, description: t.description }))])
  )
}));
"
```

**Scope features:**
- If `feature_filter`: filter to matching IDs
- Else if active feature: use only that feature
- Else: use all features with state `tested`

Store as `review_features`.

## Step 3: Spawn cap-reviewer for Stage 1 (AC compliance)

<!-- @gsd-todo(ref:AC-61) cap-reviewer shall check that all code implementing the feature has appropriate @cap-feature annotations. -->

**Skip Stage 1 if `stage2_only`.**

Spawn `cap-reviewer` via Task tool:

```
**STAGE 1: ACCEPTANCE CRITERIA COMPLIANCE**

**Features under review:**
{For each review_feature:}
Feature: {feature.id} - {feature.title} [{feature.state}]
Implementation files: {feature.files.join(', ')}
Acceptance criteria:
{For each AC:}
  {ac.id}: {ac.description} [{ac.status}]
{End for}
{End for}

**Tag evidence:**
{For each feature in tagGroups:}
  {feature_id}: {tags.length} tags across {unique files}
{End for}

**Test results:**
{test_output}
Test exit code: {test_exit_code}

**Stage 1 checklist:**
For each AC in each feature under review:
1. Is there code that implements this AC?
2. Is the implementing code annotated with @cap-feature(feature:{ID})?
3. Is there a test that verifies this AC?
4. Does the test pass?

**Return format:**
=== STAGE 1 RESULTS ===
VERDICT: PASS | FAIL
{For each feature:}
FEATURE: {id}
{For each AC:}
  {ac.id}: PASS | FAIL | PARTIAL -- {evidence or reason}
{End for}
{End for}
MISSING_ANNOTATIONS: [list of files implementing features without @cap-feature tags]
=== END STAGE 1 RESULTS ===
```

Parse the Stage 1 results.

**If Stage 1 VERDICT is FAIL and NOT `stage2_only`:**

Display Stage 1 failures and STOP:

```
cap:review Stage 1 FAILED.

{For each failing AC:}
  {feature.id}/{ac.id}: FAIL -- {reason}
{End for}

{If missing annotations:}
Missing @cap-feature annotations:
  {For each file: - file}
{End if}

Stage 2 (code quality) skipped -- fix Stage 1 issues first.
Run /cap:iterate to address gaps, then re-run /cap:review.
```

## Step 4: Spawn cap-reviewer for Stage 2 (code quality)

<!-- @gsd-todo(ref:AC-60) Stage 2: cap-reviewer shall perform code quality review (naming, structure, complexity, test coverage, tag completeness). -->

Spawn `cap-reviewer` via Task tool:

```
**STAGE 2: CODE QUALITY REVIEW**

{If not stage2_only:}
Stage 1 passed. All ACs verified.
{End if}

**Features under review:**
{For each review_feature:}
Feature: {feature.id} - {feature.title}
Implementation files: {feature.files.join(', ')}
{End for}

**Review checklist:**
1. **Naming:** Are function/variable/file names clear and consistent with project conventions?
2. **Structure:** Is the code organized logically? Are modules appropriately sized?
3. **Complexity:** Are there functions > 50 lines? Deep nesting > 3 levels? Cyclomatic complexity concerns?
4. **Error handling:** Are errors handled gracefully? Are edge cases covered?
5. **Security:** Any hardcoded credentials, SQL injection vectors, XSS risks, path traversal?
6. **Test coverage:** Are critical paths tested? Are error paths tested?
7. **Tag completeness:** Does every significant function have @cap-feature annotation?
8. **Dependencies:** Are there unnecessary imports or tight coupling between modules?

**Return format:**
=== STAGE 2 RESULTS ===
VERDICT: PASS | PASS_WITH_NOTES | FAIL
FINDINGS:
{numbered list of findings with severity: critical/warning/note}
TOP_5_ACTIONS:
1. {actionable improvement}
2. ...
=== END STAGE 2 RESULTS ===
```

Parse Stage 2 results.

## Step 5: Update Feature Map status

<!-- @gsd-todo(ref:AC-62) cap-reviewer shall update the feature state in FEATURE-MAP.md from tested to shipped upon passing both review stages. -->

If both stages pass (or Stage 1 skipped with `stage2_only` and Stage 2 passes):

```bash
node -e "
const fm = require('./get-shit-done/bin/lib/cap-feature-map.cjs');
const targetIds = {JSON.stringify(target_feature_ids)};
for (const id of targetIds) {
  const result = fm.updateFeatureState(process.cwd(), id, 'shipped');
  console.log(id + ': ' + (result ? 'updated to shipped' : 'state unchanged'));
}
"
```

Write review report:

```bash
node -e "
const fs = require('node:fs');
const path = require('node:path');
const capDir = path.join(process.cwd(), '.cap');
if (!fs.existsSync(capDir)) fs.mkdirSync(capDir, { recursive: true });
// Write review file (content constructed by command layer from parsed results)
"
```

Write `.cap/REVIEW.md` using the Write tool with the combined Stage 1 + Stage 2 findings.

Update session:

```bash
node -e "
const session = require('./get-shit-done/bin/lib/cap-session.cjs');
session.updateSession(process.cwd(), {
  lastCommand: '/cap:review',
  lastCommandTimestamp: new Date().toISOString(),
  step: 'review-complete'
});
"
```

## Step 6: Final report

```
cap:review complete.

Stage 1 (AC compliance): {PASS or FAIL or SKIPPED}
Stage 2 (Code quality):  {PASS or PASS_WITH_NOTES or FAIL}

{If both pass:}
Feature state updated: {feature_ids} -> shipped
Review report: .cap/REVIEW.md

Top 5 actions:
{top_5_actions}
{End if}

{If stage 2 has notes:}
Review passed with notes. See .cap/REVIEW.md for details.
{End if}
```

</process>
