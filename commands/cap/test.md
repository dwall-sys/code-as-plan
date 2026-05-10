---
name: cap:test
description: Write or extend RED-GREEN tests for a Feature Map entry's acceptance criteria. TRIGGER when a feature is in state `prototyped` and the user wants to verify it works, says "test this / write tests for F-XXX / add coverage / cover this with tests", or after `/cap:prototype` or `/cap:iterate` when code is in place but the feature isn't in state `tested` yet. Auto-detects framework (vitest, jest, node:test). --red-only stops after RED phase (TDD); --deep also runs test-audit (mutation, assertion-density, anti-patterns). DO NOT trigger for one-off test fixes — just edit the test file. Spawns cap-validator MODE: TEST.
argument-hint: "[--features NAME] [--red-only] [--deep]"
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

<!-- @cap-context CAP v2.0 test command -- orchestrates test generation against Feature Map ACs. Spawns cap-validator agent, collects test results, updates Feature Map test status. -->
<!-- @cap-decision Tests derive from Feature Map ACs, not from code inspection. This ensures tests verify the specification, not the implementation. -->
<!-- @cap-pattern --red-only flag stops after RED phase -- useful for TDD workflows where developer writes GREEN implementation manually. -->

<objective>
<!-- @cap-todo(ref:AC-52) /cap:test shall invoke the cap-validator agent with a RED-GREEN discipline mindset. -->

Spawns cap-validator to write tests against Feature Map acceptance criteria. Tests must demonstrate RED (fail against stubs) before GREEN (pass against implementation).

**Arguments:**
- `--features NAME` -- scope to specific Feature Map entries
- `--red-only` -- stop after RED phase (tests written, confirmed failing)
- `--deep` -- run test audit after tests pass (assertion density, coverage, mutations, anti-patterns, trust score). If trust score < 70%, shows prioritized improvement suggestions.
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
- `--deep` -- if present, set `deep_mode = true`

## Step 1: Read Feature Map and extract ACs for test generation

<!-- @cap-todo(ref:AC-54) cap-validator shall write tests that verify the acceptance criteria from the Feature Map entry for the active feature. -->

```bash
node -e "
const fm = require('./cap/bin/lib/cap-feature-map.cjs');
const session = require('./cap/bin/lib/cap-session.cjs');
// @cap-todo(ac:F-081/AC-4 iter:2) Migrated to {safe: true} opt-in to preserve CLI on duplicate-ID FEATURE-MAP.
// @cap-decision(F-081/iter2) Warn on parseError; continue with partial map for read-only display.
const featureMap = fm.readFeatureMap(process.cwd(), undefined, { safe: true });
if (featureMap && featureMap.parseError) {
  console.warn('cap: test load — duplicate feature ID detected, target list uses partial map: ' + String(featureMap.parseError.message).trim());
}
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

<!-- @cap-todo(ref:AC-56) cap-validator shall use node:test for CJS code and vitest for SDK TypeScript code. -->

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

## Step 3: Spawn cap-validator agent

<!-- @cap-todo(ref:AC-53) cap-validator shall approach testing with a "how do I break this?" adversarial mindset. -->
<!-- @cap-todo(ref:AC-57) Green tests shall replace the need for a separate VERIFICATION.md artifact. -->

Spawn `cap-validator` via Task tool:

```
**MODE: TEST**

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

Wait for cap-validator to complete. Parse results.

## Step 4: Run tests and capture results

```bash
node --test {test_config.testDir}/*.test.cjs 2>&1 | tail -20
```

Store exit code and output.

## Step 5: Update Feature Map status

<!-- @cap-todo(ref:AC-55) cap-validator shall update the feature state in FEATURE-MAP.md from prototyped to tested when all tests pass. -->

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

<!-- @cap-feature(feature:F-023) Emoji-Enhanced AC Status and Human Verification Checklist -->

```
cap:test complete.

Phase: {RED or GREEN}
Tests written: {tests_written}
Tests passing: {tests_passing}
Tests failing: {tests_failing}
```

<!-- @cap-todo(ac:F-023/AC-2) Display AC table with emoji status after test -->
<!-- @cap-todo(ac:F-023/AC-6) Emojis in terminal output only -->

**Display the AC status table with emojis (terminal output only):**

```bash
node -e "
const fm = require('./cap/bin/lib/cap-feature-map.cjs');
// @cap-todo(ac:F-081/AC-4 iter:2) Migrated to {safe: true} opt-in to preserve CLI on duplicate-ID FEATURE-MAP.
// @cap-decision(F-081/iter2) Warn on parseError; continue with partial map for read-only display.
const featureMap = fm.readFeatureMap(process.cwd(), undefined, { safe: true });
if (featureMap && featureMap.parseError) {
  console.warn('cap: test AC-table — duplicate feature ID detected, table uses partial map: ' + String(featureMap.parseError.message).trim());
}
const targetIds = {JSON.stringify(target_feature_ids)};
for (const id of targetIds) {
  const f = featureMap.features.find(feat => feat.id === id);
  if (!f) continue;
  console.log('\n  ' + f.id + ': ' + f.title + ' [' + f.state + ']');
  for (const ac of f.acs) {
    const emoji = ac.status === 'tested' ? '✅' : ac.status === 'prototyped' ? '🔨' : ac.status === 'partial' ? '⚠️' : '📋';
    console.log('    ' + emoji + ' ' + ac.id + ': ' + ac.description);
  }
}
"
```

```
{If red_only:}
RED phase complete. Tests are written and confirmed failing.
Run /cap:iterate to implement, then re-run /cap:test without --red-only.
{Else if all_pass:}
GREEN phase complete. All tests pass.
Feature state updated: {feature_ids} -> tested
{Else:}
Some tests failing. Fix implementation and re-run /cap:test.
{End if}
```

{If untested_paths:}
```
Untested code paths flagged with @cap-risk:
{For each path: - path}
```
{End if}

<!-- @cap-todo(ac:F-023/AC-3) Auto-generate Human Verification Checklist after test -->
<!-- @cap-todo(ac:F-023/AC-4) Derive checklist items from ACs that aren't fully automatable -->
<!-- @cap-todo(ac:F-023/AC-5) Format as markdown checkboxes -->

## Step 7: Human Verification Checklist

**If all tests pass and NOT `red_only`:**

Generate a verification checklist from the feature's ACs. For each AC, determine if it requires human verification (anything involving visual output, user flow, permissions, external services, or cross-device behavior).

**Display to user (terminal output with emojis):**

```
🔍 Human Verification Checklist — {feature.id}: {feature.title}

{For each target_feature:}
  {For each AC — categorize and generate checklist items:}

  {If AC involves visual/UI behavior:}
  🌐 Browser / Visual
  - [ ] {Derived check from AC, e.g., "Verify error message displays correctly when module is missing"}
  {End if}

  {If AC involves user interaction/flow:}
  🔍 Manual Verification
  - [ ] {Derived check, e.g., "Run npx code-as-plan@latest --force and verify clean install completes"}
  {End if}

  {If AC involves permissions/security:}
  🔐 Security / Permissions
  - [ ] {Derived check, e.g., "Verify non-root user can install without sudo"}
  {End if}

  {If AC involves performance/timing:}
  ⚡ Performance
  - [ ] {Derived check, e.g., "Verify install completes in under 30 seconds on cold cache"}
  {End if}

  {If AC involves cross-platform/environment:}
  💻 Cross-Platform
  - [ ] {Derived check, e.g., "Test on Linux with symlinked $HOME"}
  {End if}

  {If AC is purely automatable (covered by unit tests):}
  ✅ {ac.id}: Covered by automated tests
  {End if}

{End for}
{End for}

Status: [ ] All checks passed  [ ] Issues found
Verified by: ________________  Date: ________________
```

**Note:** The checklist is displayed in the terminal only. If the user wants to save it, they can run `/cap:review` which writes it to `.cap/MANUAL-TESTS.md`.

## Step 8: Deep audit (if --deep)

If `deep_mode` is true and tests passed (not `red_only`):

```bash
node -e "const a = require('./cap/bin/lib/cap-test-audit.cjs'); const r = a.generateAuditReport(process.cwd()); const fs = require('fs'); fs.writeFileSync('.cap/TEST-AUDIT.md', a.formatAuditReport(r), 'utf8'); console.log(JSON.stringify({ trustScore: r.trustScore, assertions: r.assertions.totalAssertions, density: r.assertions.assertionDensity, emptyTests: r.assertions.emptyTests.length, antiPatterns: r.antiPatterns.flags.length, coverageLines: r.coverage ? r.coverage.lines : null }));"
```

Store as `audit`.

Display the audit summary:

```
Test Audit (--deep)
  Trust score: {audit.trustScore}/100
  Assertions: {audit.assertions} total ({audit.density} per test)
  Empty tests: {audit.emptyTests}
  Anti-patterns: {audit.antiPatterns}
  Coverage: {audit.coverageLines ?? 'not available'}%
  Report: .cap/TEST-AUDIT.md
```

**If `audit.trustScore < 70`:**

Read and display the IMPROVEMENT SUGGESTIONS section from `.cap/TEST-AUDIT.md`:

```bash
node -e "const fs = require('fs'); const c = fs.readFileSync('.cap/TEST-AUDIT.md', 'utf8'); const idx = c.indexOf('IMPROVEMENT SUGGESTIONS'); if (idx >= 0) console.log(c.substring(idx, c.indexOf('Generated:', idx))); else console.log('No suggestions — score is adequate.');"
```

Display suggestions and ask the user:
> "Trust score is {audit.trustScore}/100 (target: 70+). Want me to address the top suggestion now?"

If user agrees, implement the top suggestion (add assertions, fix empty tests, or address anti-patterns) and re-run the audit.

**If `audit.trustScore >= 70`:**

```
Trust score {audit.trustScore}/100 — tests are reliable.
```

```
Next steps:
  - Work through the verification checklist above
  - Run /cap:review to verify code quality and save checklist
```

</process>
