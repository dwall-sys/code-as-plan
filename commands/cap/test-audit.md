---
name: cap:test-audit
description: Analyze test quality -- assertion density, coverage, mutation testing, anti-patterns, and trust score.
argument-hint: "[--coverage] [--mutations N] [--critical auth,payment] [--no-mutations]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---

<!-- @cap-feature(feature:F-TEST-AUDIT) Test audit command -- orchestrates test quality analysis and generates trust score report. -->
<!-- @cap-decision Test audit combines assertion analysis, coverage, mutation testing, spot-checks, and anti-pattern detection into a single trust score. -->

<objective>
Analyze test quality across the project. Produces a trust score from 0-100 based on assertion density, code coverage, mutation testing results, and anti-pattern detection.

**Arguments:**
- `--coverage` -- force coverage analysis (default: auto-detect c8)
- `--no-coverage` -- skip coverage analysis
- `--mutations N` -- number of random mutations to apply (default: 10)
- `--no-mutations` -- skip mutation testing
- `--critical NAME,NAME` -- comma-separated critical path keywords (default: auth,payment,booking,rls,security)
- `--target FILE,FILE` -- comma-separated files for mutation testing (default: auto-detect from critical paths)
</objective>

<context>
$ARGUMENTS

@FEATURE-MAP.md
@.cap/SESSION.json
</context>

<process>

## Step 0: Parse flags

Check `$ARGUMENTS` for:
- `--coverage` / `--no-coverage`
- `--mutations N` / `--no-mutations`
- `--critical NAME,NAME`
- `--target FILE,FILE`

Set defaults:
- `runCoverage = true` (unless --no-coverage)
- `mutationCount = 10` (unless --no-mutations sets it to 0)
- `criticalPaths = ['auth', 'payment', 'booking', 'rls', 'security']`
- `targetFiles = []` (auto-detect below)

## Step 1: Detect test framework

```bash
node -e "
const fs = require('node:fs');
const path = require('node:path');
const cwd = process.cwd();
const result = { framework: 'node:test', testDir: 'tests', extension: '.test.cjs', testCommand: 'node --test tests/' };

if (fs.existsSync(path.join(cwd, 'package.json'))) {
  const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (allDeps.vitest) { result.framework = 'vitest'; result.testCommand = 'npx vitest run'; }
  else if (allDeps.jest) { result.framework = 'jest'; result.testCommand = 'npx jest'; }
  if (allDeps.c8) result.hasC8 = true;
}

const testDirs = ['tests', 'test', '__tests__', 'spec'];
for (const d of testDirs) {
  if (fs.existsSync(path.join(cwd, d))) { result.testDir = d; break; }
}

console.log(JSON.stringify(result));
"
```

Store as `test_config`.

## Step 2: Auto-detect mutation target files

If `--target` not specified, find files matching critical path keywords:

```bash
node -e "
const fs = require('node:fs');
const path = require('node:path');
const criticalPaths = $CRITICAL_PATHS_JSON;
const cwd = process.cwd();
const targets = [];

function walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch(_) { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && !['node_modules','.git','dist','build','coverage','.cap'].includes(e.name)) {
      walk(full);
    } else if (e.isFile() && ['.js','.cjs','.ts'].some(ext => e.name.endsWith(ext)) && !e.name.includes('.test.')) {
      const lower = e.name.toLowerCase();
      if (criticalPaths.some(cp => lower.includes(cp))) {
        targets.push(path.relative(cwd, full));
      }
    }
  }
}
walk(cwd);
console.log(JSON.stringify(targets));
"
```

Store as `targetFiles`.

## Step 3: Run assertion analysis

```bash
node -e "
const audit = require('./cap/bin/lib/cap-test-audit.cjs');
const result = audit.analyzeAssertions(process.cwd());
console.log(JSON.stringify(result, null, 2));
"
```

Display:
```
ASSERTIONS
  Total tests: {totalTests}
  Total assertions: {totalAssertions}
  Assertion density: {assertionDensity} per test
  Empty tests: {emptyTests.length}
```

## Step 4: Run coverage analysis (if enabled)

If `runCoverage` and `test_config.hasC8`:

```bash
node -e "
const audit = require('./cap/bin/lib/cap-test-audit.cjs');
const result = audit.analyzeCoverage(process.cwd(), '$TEST_COMMAND');
console.log(JSON.stringify(result, null, 2));
"
```

Display:
```
COVERAGE
  Lines: {lines}%  Branches: {branches}%  Functions: {functions}%
```

## Step 5: Run mutation testing (if enabled)

If `mutationCount > 0` and `targetFiles.length > 0`:

```bash
node -e "
const audit = require('./cap/bin/lib/cap-test-audit.cjs');
const result = audit.runMutationTests(
  process.cwd(),
  $TARGET_FILES_JSON,
  '$TEST_COMMAND',
  { mutations: $MUTATION_COUNT, timeout: 30000 }
);
console.log(JSON.stringify(result, null, 2));
"
```

Display:
```
MUTATION SCORE
  Mutations: {mutationsTotal} applied, {mutationsCaught} caught ({mutationScore}%)
```

## Step 6: Run spot-check generation

```bash
node -e "
const audit = require('./cap/bin/lib/cap-test-audit.cjs');
const result = audit.generateSpotChecks(process.cwd(), {
  count: 3,
  criticalPaths: $CRITICAL_PATHS_JSON
});
console.log(JSON.stringify(result, null, 2));
"
```

## Step 7: Run anti-pattern detection

```bash
node -e "
const audit = require('./cap/bin/lib/cap-test-audit.cjs');
const result = audit.detectAntiPatterns(process.cwd());
console.log(JSON.stringify(result, null, 2));
"
```

## Step 8: Generate trust score and write report

```bash
node -e "
const audit = require('./cap/bin/lib/cap-test-audit.cjs');
const fs = require('node:fs');
const path = require('node:path');

const report = audit.generateAuditReport(process.cwd(), {
  testCommand: '$TEST_COMMAND',
  criticalPaths: $CRITICAL_PATHS_JSON,
  targetFiles: $TARGET_FILES_JSON,
  coverage: $RUN_COVERAGE,
  mutations: $RUN_MUTATIONS,
  mutationCount: $MUTATION_COUNT,
});

// Write markdown report
const capDir = path.join(process.cwd(), '.cap');
if (!fs.existsSync(capDir)) fs.mkdirSync(capDir, { recursive: true });

const markdown = audit.formatAuditReport(report, '$PROJECT_NAME');
fs.writeFileSync(path.join(capDir, 'TEST-AUDIT.md'), markdown, 'utf8');
console.log(markdown);
"
```

## Step 9: Update session

```bash
node -e "
const session = require('./cap/bin/lib/cap-session.cjs');
session.updateSession(process.cwd(), {
  lastCommand: '/cap:test-audit',
  lastCommandTimestamp: new Date().toISOString(),
  step: 'test-audit-complete'
});
"
```

## Step 10: Final report

Display the full formatted audit report to the user.

```
cap:test-audit complete.

Report written to: .cap/TEST-AUDIT.md
Trust score: {trustScore}/100

{If trustScore >= 80:}
High confidence -- tests are thorough and catch mutations.
{Else if trustScore >= 50:}
Moderate confidence -- review the spot-check guide and address anti-patterns.
{Else:}
Low confidence -- significant testing gaps detected. Address empty tests, weak assertions, and coverage gaps.
{End if}

Next steps:
- Review spot-check suggestions manually
- Address anti-patterns flagged above
- Run /cap:test to generate more tests for uncovered features
```

</process>
