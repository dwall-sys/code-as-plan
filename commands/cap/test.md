---
name: cap:test
description: Spawn cap-tester agent to write runnable tests against Feature Map acceptance criteria using RED-GREEN discipline.
argument-hint: "[--features NAME] [--red-only]"
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

<!-- @gsd-context CAP v2.0 test command -- orchestrates test generation against Feature Map ACs. Spawns cap-tester agent, collects test results, updates Feature Map test status. -->
<!-- @gsd-decision Tests derive from Feature Map ACs, not from code inspection. This ensures tests verify the specification, not the implementation. -->
<!-- @gsd-pattern --red-only flag stops after RED phase -- useful for TDD workflows where developer writes GREEN implementation manually. -->

<objective>
<!-- @gsd-todo(ref:AC-52) /cap:test shall invoke the cap-tester agent with a RED-GREEN discipline mindset. -->

Spawns cap-tester to write tests against Feature Map acceptance criteria. Tests must demonstrate RED (fail against stubs) before GREEN (pass against implementation).

**Arguments:**
- `--features NAME` -- scope to specific Feature Map entries
- `--red-only` -- stop after RED phase (tests written, confirmed failing)
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
- `--red-only` -- if present, set `red_only = true`

## Step 1: Read Feature Map and extract ACs for test generation

<!-- @gsd-todo(ref:AC-54) cap-tester shall write tests that verify the acceptance criteria from the Feature Map entry for the active feature. -->

```bash
node -e "
const fm = require('./cap/bin/lib/cap-feature-map.cjs');
const session = require('./cap/bin/lib/cap-session.cjs');
const featureMap = fm.readFeatureMap(process.cwd());
const s = session.loadSession(process.cwd());
console.log(JSON.stringify({
  activeFeature: s.activeFeature,
  features: featureMap.features.map(f => ({
    id: f.id, title: f.title, state: f.state,
    acs: f.acs, files: f.files
  }))
}));
"
```

**Scope features:**
- If `feature_filter`: filter to matching IDs
- Else if active feature: use only that feature
- Else: use all features with state `prototyped`

Store as `test_features`. Collect all ACs as `test_specs`.

If `test_features` is empty: STOP and report:
> "No prototyped features found. Run /cap:prototype first, or specify --features."

## Step 2: Detect test framework

<!-- @gsd-todo(ref:AC-56) cap-tester shall use node:test for CJS code and vitest for SDK TypeScript code. -->

```bash
node -e "
const fs = require('node:fs');
const path = require('node:path');
const cwd = process.cwd();
const result = { framework: 'node:test', testDir: 'tests', extension: '.test.cjs' };

// Check package.json
if (fs.existsSync(path.join(cwd, 'package.json'))) {
  const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (allDeps.vitest) result.framework = 'vitest';
  else if (allDeps.jest) result.framework = 'jest';
}

// Check for existing test patterns
const testDirs = ['tests', 'test', '__tests__', 'spec'];
for (const d of testDirs) {
  if (fs.existsSync(path.join(cwd, d))) { result.testDir = d; break; }
}

// Check for SDK directory (vitest scope)
if (fs.existsSync(path.join(cwd, 'sdk'))) {
  result.sdkTestFramework = 'vitest';
  result.sdkTestDir = 'sdk/src';
  result.sdkExtension = '.test.ts';
}

// Detect extension from existing tests
try {
  const existing = fs.readdirSync(path.join(cwd, result.testDir));
  const testFile = existing.find(f => f.includes('.test.'));
  if (testFile) result.extension = path.extname(testFile).replace('.', '.test.');
} catch (_) {}

console.log(JSON.stringify(result));
"
```

Store as `test_config`.

## Step 3: Spawn cap-tester agent

<!-- @gsd-todo(ref:AC-53) cap-tester shall approach testing with a "how do I break this?" adversarial mindset. -->
<!-- @gsd-todo(ref:AC-57) Green tests shall replace the need for a separate VERIFICATION.md artifact. -->

Spawn `cap-tester` via Task tool:

```
$ARGUMENTS

**RED-GREEN DISCIPLINE**
{If red_only:} Stop after RED phase -- write tests that FAIL. Do not implement GREEN.
{Else:} Full RED-GREEN cycle -- write failing tests, then make them pass.

**Test framework:** {test_config.framework}
**Test directory:** {test_config.testDir}
**Test extension:** {test_config.extension}
{If test_config.sdkTestFramework:}
**SDK tests:** {test_config.sdkTestFramework} in {test_config.sdkTestDir} ({test_config.sdkExtension})
{End if}

**Features under test:**
{For each test_feature:}
Feature: {feature.id} - {feature.title} [{feature.state}]
Implementation files: {feature.files.join(', ')}
Acceptance criteria:
{For each AC:}
  {ac.id}: {ac.description} [{ac.status}]
{End for}
{End for}

**Testing obligations:**
1. Each AC produces AT LEAST one test case
2. Adversarial mindset: "how do I break this?"
3. Test edge cases, error paths, and boundary conditions
4. For CJS code: use node:test (require('node:test'), require('node:assert'))
5. For SDK TypeScript: use vitest
6. Name test files: {feature.id.toLowerCase()}-{slug}.test.{ext}
7. Annotate untested code paths with @cap-risk tags

**RED phase (mandatory):**
- Write all tests
- Run them to confirm they FAIL against stubs or missing implementation
- Report RED results

{If NOT red_only:}
**GREEN phase:**
- Implement minimum code to make tests pass
- Run tests to confirm GREEN
- Report GREEN results
{End if}

**Return format:**
=== TEST RESULTS ===
PHASE: {RED or GREEN}
TESTS_WRITTEN: N
TESTS_PASSING: N
TESTS_FAILING: N
FILES_CREATED: [list]
UNTESTED_PATHS: [list of code paths without test coverage]
=== END TEST RESULTS ===
```

Wait for cap-tester to complete. Parse results.

## Step 4: Run tests and capture results

```bash
node --test {test_config.testDir}/*.test.cjs 2>&1 | tail -20
```

Store exit code and output.

## Step 5: Update Feature Map status

<!-- @gsd-todo(ref:AC-55) cap-tester shall update the feature state in FEATURE-MAP.md from prototyped to tested when all tests pass. -->

If all tests pass and `red_only` is false:

```bash
node -e "
const fm = require('./cap/bin/lib/cap-feature-map.cjs');
const targetIds = {JSON.stringify(target_feature_ids)};
for (const id of targetIds) {
  const result = fm.updateFeatureState(process.cwd(), id, 'tested');
  console.log(id + ': ' + (result ? 'updated to tested' : 'state unchanged'));
}
"
```

Update session:

```bash
node -e "
const session = require('./cap/bin/lib/cap-session.cjs');
session.updateSession(process.cwd(), {
  lastCommand: '/cap:test',
  lastCommandTimestamp: new Date().toISOString(),
  step: 'test-complete'
});
"
```

## Step 6: Final report

```
cap:test complete.

Phase: {RED or GREEN}
Tests written: {tests_written}
Tests passing: {tests_passing}
Tests failing: {tests_failing}

{If red_only:}
RED phase complete. Tests are written and confirmed failing.
Run /cap:iterate to implement, then re-run /cap:test without --red-only.
{Else if all_pass:}
GREEN phase complete. All tests pass.
Feature state updated: {feature_ids} -> tested
Run /cap:review to verify code quality.
{Else:}
Some tests failing. Fix implementation and re-run /cap:test.
{End if}

{If untested_paths:}
Untested code paths flagged with @cap-risk:
{For each path: - path}
{End if}
```

</process>
