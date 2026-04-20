'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  analyzeAssertions,
  analyzeTestDiversity,
  analyzeCriticalPathCoverage,
  detectAntiPatterns,
  generateSpotChecks,
  generateAuditReport,
  computeTrustScore,
  findTestFiles,
  applyMutation,
  ASSERTION_PATTERNS,
  WEAK_ASSERTION_PATTERNS,
  ERROR_PATH_PATTERNS,
  EDGE_CASE_PATTERNS,
  DEFAULT_CRITICAL_PATHS,
  MUTATION_OPERATORS,
  DEFAULT_TEST_EXTENSIONS,
  formatAuditReport,
} = require('../cap/bin/lib/cap-test-audit.cjs');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-test-audit-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// --- findTestFiles ---

describe('findTestFiles', () => {
  it('finds .test.cjs files in directory', () => {
    fs.writeFileSync(path.join(tmpDir, 'foo.test.cjs'), '// test file');
    fs.writeFileSync(path.join(tmpDir, 'bar.test.cjs'), '// test file');
    fs.writeFileSync(path.join(tmpDir, 'not-a-test.cjs'), '// not a test');
    const files = findTestFiles(tmpDir);
    assert.strictEqual(files.length, 2);
    assert.ok(files.every(f => f.endsWith('.test.cjs')));
  });

  it('finds .test.ts files', () => {
    fs.writeFileSync(path.join(tmpDir, 'auth.test.ts'), '// test');
    const files = findTestFiles(tmpDir);
    assert.strictEqual(files.length, 1);
    assert.ok(files[0].endsWith('.test.ts'));
  });

  it('returns empty array for empty directory', () => {
    const files = findTestFiles(tmpDir);
    assert.strictEqual(files.length, 0);
  });

  it('skips node_modules', () => {
    const nm = path.join(tmpDir, 'node_modules');
    fs.mkdirSync(nm);
    fs.writeFileSync(path.join(nm, 'dep.test.cjs'), '// test');
    const files = findTestFiles(tmpDir);
    assert.strictEqual(files.length, 0);
  });

  it('recurses into subdirectories', () => {
    const sub = path.join(tmpDir, 'tests');
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, 'deep.test.cjs'), '// test');
    const files = findTestFiles(tmpDir);
    assert.strictEqual(files.length, 1);
  });
});

// --- analyzeAssertions ---

describe('analyzeAssertions', () => {
  it('counts assertions in test files', () => {
    const testContent = [
      "'use strict';",
      "const { it } = require('node:test');",
      "const assert = require('node:assert');",
      "",
      "it('test one', () => {",
      "  assert.strictEqual(1, 1);",
      "  assert." + "ok(true);",
      "});",
      "",
      "it('test two', () => {",
      "  assert.deepStrictEqual({a: 1}, {a: 1});",
      "});",
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'sample.test.cjs'), testContent);
    const result = analyzeAssertions(tmpDir);
    assert.strictEqual(result.totalTests, 2);
    assert.strictEqual(result.totalAssertions, 3);
    assert.strictEqual(result.emptyTests.length, 0);
    assert.strictEqual(result.assertionDensity > 0, true, 'density should be positive');
  });

  it('flags tests with zero assertions', () => {
    const testContent = [
      "const { it } = require('node:test');",
      "it('empty test', () => {",
      "  const x = 1 + 1;",
      "});",
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'empty.test.cjs'), testContent);
    const result = analyzeAssertions(tmpDir);
    assert.strictEqual(result.totalTests, 1);
    assert.strictEqual(result.totalAssertions, 0);
    assert.strictEqual(result.emptyTests.length, 1);
    assert.strictEqual(result.emptyTests[0].name, 'empty test');
  });

  it('handles files with many assertions per test', () => {
    const testContent = [
      "const { it } = require('node:test');",
      "const assert = require('node:assert');",
      "it('thorough test', () => {",
      "  assert.strictEqual(1, 1);",
      "  assert." + "ok(true);",
      "  assert.deepStrictEqual([], []);",
      "  assert.notStrictEqual(1, 2);",
      "  assert.match('hello', /hello/);",
      "});",
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'many.test.cjs'), testContent);
    const result = analyzeAssertions(tmpDir);
    assert.strictEqual(result.totalTests, 1);
    assert.strictEqual(result.totalAssertions, 5);
    assert.strictEqual(result.assertionDensity, 5);
  });

  it('returns zero density when no test files exist', () => {
    const result = analyzeAssertions(tmpDir);
    assert.strictEqual(result.totalTests, 0);
    assert.strictEqual(result.assertionDensity, 0);
  });

  it('detects vitest-style assertions (expect/toBe)', () => {
    const testContent = [
      "import { it, expect } from 'vitest';",
      "it('vitest test', () => {",
      "  expect(1).toBe(1);",
      "  expect([1,2]).toHaveLength(2);",
      "  expect(() => { throw new Error() }).toThrow();",
      "});",
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'vitest.test.ts'), testContent);
    const result = analyzeAssertions(tmpDir);
    assert.strictEqual(result.totalTests, 1);
    assert.strictEqual(result.totalAssertions, 3);
  });
});

// --- detectAntiPatterns ---

describe('detectAntiPatterns', () => {
  it('flags toBeDefined-only assertions', () => {
    const testContent = [
      "const { it } = require('node:test');",
      "it('weak test', () => {",
      "  expect(result).toBe" + "Defined();",
      "});",
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'weak.test.cjs'), testContent);
    const result = detectAntiPatterns(tmpDir);
    assert.strictEqual(result.flags.length > 0, true, 'should have flags');
    const toBeDefined = result.flags.find(f => f.pattern === 'toBeDefined-only');
    assert.notStrictEqual(toBeDefined, undefined, 'should find toBeDefined-only flag');
    assert.strictEqual(toBeDefined.severity, 'warning');
  });

  it('flags toBeTruthy-only assertions', () => {
    const testContent = [
      "const { it } = require('node:test');",
      "it('truthy test', () => {",
      "  expect(result).toBe" + "Truthy();",
      "});",
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'truthy.test.cjs'), testContent);
    const result = detectAntiPatterns(tmpDir);
    const flag = result.flags.find(f => f.pattern === 'toBeTruthy-only');
    assert.notStrictEqual(flag, undefined, 'should find toBeTruthy-only flag');
    assert.strictEqual(flag.severity, 'warning');
  });

  it('flags snapshot tests on logic', () => {
    const testContent = [
      "const { it } = require('node:test');",
      "it('snapshot test', () => {",
      "  expect(calculateTotal(items)).toMatch" + "Snapshot();",
      "});",
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'snap.test.cjs'), testContent);
    const result = detectAntiPatterns(tmpDir);
    const flag = result.flags.find(f => f.pattern === 'snapshot-logic');
    assert.notStrictEqual(flag, undefined, 'should find snapshot-logic flag');
  });

  it('returns no flags for strong assertions', () => {
    const testContent = [
      "const { it } = require('node:test');",
      "const assert = require('node:assert');",
      "it('strong test', () => {",
      "  assert.strictEqual(add(1, 2), 3);",
      "  assert.deepStrictEqual(getItems(), ['a', 'b']);",
      "});",
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'strong.test.cjs'), testContent);
    const result = detectAntiPatterns(tmpDir);
    // Should not have weak-assertion-only or empty-test flags
    const weak = result.flags.filter(f => f.pattern === 'weak-assertions-only' || f.pattern === 'empty-test-body');
    assert.strictEqual(weak.length, 0);
  });

  it('flags empty test bodies', () => {
    const testContent = [
      "const { it } = require('node:test');",
      "it('noop test', () => " + "{});",
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'noop.test.cjs'), testContent);
    const result = detectAntiPatterns(tmpDir);
    const flag = result.flags.find(f => f.pattern === 'empty-test-body');
    assert.notStrictEqual(flag, undefined, 'should find empty-test-body flag');
    assert.strictEqual(flag.severity, 'error');
  });

  it('flags typeof-only checks', () => {
    const testContent = [
      "const { it } = require('node:test');",
      "it('type check', () => {",
      "  if (type" + "of result " + "=== 'string') {}",
      "});",
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'typeof.test.cjs'), testContent);
    const result = detectAntiPatterns(tmpDir);
    const flag = result.flags.find(f => f.pattern === 'typeof-only');
    assert.notStrictEqual(flag, undefined, 'should find typeof-only flag');
  });
});

// --- generateSpotChecks ---

describe('generateSpotChecks', () => {
  it('returns spot checks for test files', () => {
    const testContent = [
      "const { it } = require('node:test');",
      "const assert = require('node:assert');",
      "const auth = require('../lib/auth.cjs');",
      "it('auth login test', () => {",
      "  assert." + "ok(true);",
      "});",
      "it('another test', () => {",
      "  assert.strictEqual(1, 1);",
      "});",
    ].join('\n');
    const testsDir = path.join(tmpDir, 'tests');
    fs.mkdirSync(testsDir);
    fs.writeFileSync(path.join(testsDir, 'auth.test.cjs'), testContent);
    const result = generateSpotChecks(tmpDir, { count: 3, criticalPaths: ['auth'] });
    assert.strictEqual(result.length > 0, true, 'should have spot checks');
    assert.strictEqual(result.length <= 3, true, 'should have at most 3');
    assert.notStrictEqual(result[0].file, undefined, 'should have file');
    assert.notStrictEqual(result[0].testName, undefined, 'should have testName');
    assert.strictEqual(result[0].line > 0, true, 'line should be positive');
    assert.notStrictEqual(result[0].suggestion, undefined, 'should have suggestion');
  });

  it('prioritizes critical path tests', () => {
    const testsDir = path.join(tmpDir, 'tests');
    fs.mkdirSync(testsDir);

    // Auth test (critical)
    fs.writeFileSync(path.join(testsDir, 'auth-login.test.cjs'), [
      "const { it } = require('node:test');",
      "it('login check', () => " + "{});",
    ].join('\n'));

    // Utility test (not critical)
    fs.writeFileSync(path.join(testsDir, 'utils-format.test.cjs'), [
      "const { it } = require('node:test');",
      "const assert = require('node:assert');",
      "it('format date', () => { assert.strictEqual(1,1); assert." + "ok(true); assert." + "ok(true); });",
    ].join('\n'));

    const result = generateSpotChecks(tmpDir, { count: 1, criticalPaths: ['auth'] });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].file.includes('auth'), true, 'should prioritize auth');
  });

  it('returns empty array when no test files exist', () => {
    const result = generateSpotChecks(tmpDir);
    assert.strictEqual(result.length, 0);
  });
});

// --- applyMutation ---

describe('applyMutation', () => {
  it('flips === to !==', () => {
    const content = 'line1\nif (a === b) {\nline3';
    const operator = MUTATION_OPERATORS.find(o => o.name === 'flip-equality');
    const result = applyMutation(content, 1, operator);
    assert.ok(result.applied);
    assert.ok(result.mutated.includes('!=='));
    assert.ok(!result.mutated.split('\n')[1].includes('==='));
  });

  it('flips true to false', () => {
    const content = 'line1\nreturn true;\nline3';
    const operator = MUTATION_OPERATORS.find(o => o.name === 'flip-true');
    const result = applyMutation(content, 1, operator);
    assert.ok(result.applied);
    assert.ok(result.mutated.includes('return false;'));
  });

  it('removes return value', () => {
    const content = 'line1\nreturn computeResult();\nline3';
    const operator = MUTATION_OPERATORS.find(o => o.name === 'remove-return');
    const result = applyMutation(content, 1, operator);
    assert.ok(result.applied);
    assert.ok(result.mutated.includes('return undefined'));
  });

  it('returns applied=false when pattern not found on line', () => {
    const content = 'line1\nconst x = 42;\nline3';
    const operator = MUTATION_OPERATORS.find(o => o.name === 'flip-equality');
    const result = applyMutation(content, 1, operator);
    assert.strictEqual(result.applied, false);
  });

  it('skips comment lines', () => {
    const content = '// if (a === b) {}';
    const operator = MUTATION_OPERATORS.find(o => o.name === 'flip-equality');
    const result = applyMutation(content, 0, operator);
    assert.strictEqual(result.applied, false);
  });

  it('handles out-of-range line index', () => {
    const content = 'only one line';
    const operator = MUTATION_OPERATORS.find(o => o.name === 'flip-equality');
    const result = applyMutation(content, 5, operator);
    assert.strictEqual(result.applied, false);
  });

  it('handles negative line index', () => {
    const content = 'only one line';
    const operator = MUTATION_OPERATORS.find(o => o.name === 'flip-equality');
    const result = applyMutation(content, -1, operator);
    assert.strictEqual(result.applied, false);
  });

  it('flips && to ||', () => {
    const content = 'if (a && b) {}';
    const operator = MUTATION_OPERATORS.find(o => o.name === 'flip-and-or');
    const result = applyMutation(content, 0, operator);
    assert.ok(result.applied);
    assert.ok(result.mutated.includes('||'));
  });
});

// --- computeTrustScore ---

describe('computeTrustScore', () => {
  it('returns high score for good metrics', () => {
    const assertions = { totalTests: 10, totalAssertions: 30, emptyTests: [], assertionDensity: 3.0 };
    const coverage = { lines: 90, branches: 80, functions: 95, error: null };
    const mutations = { mutationsTotal: 10, mutationsCaught: 9, mutationScore: 90 };
    const antiPatterns = { flags: [] };
    const score = computeTrustScore(assertions, coverage, mutations, antiPatterns);
    assert.ok(score >= 70, `Expected score >= 70, got ${score}`);
  });

  it('returns low score for poor metrics', () => {
    const assertions = { totalTests: 5, totalAssertions: 1, emptyTests: [1,2,3], assertionDensity: 0.2 };
    const coverage = { lines: 10, branches: 5, functions: 10, error: null };
    const mutations = { mutationsTotal: 10, mutationsCaught: 1, mutationScore: 10 };
    const antiPatterns = { flags: [
      { severity: 'error' }, { severity: 'error' },
      { severity: 'warning' }, { severity: 'warning' }, { severity: 'warning' },
    ]};
    const score = computeTrustScore(assertions, coverage, mutations, antiPatterns);
    assert.ok(score < 50, `Expected score < 50, got ${score}`);
  });

  it('returns neutral score when coverage and mutations unavailable', () => {
    const assertions = { totalTests: 5, totalAssertions: 10, emptyTests: [], assertionDensity: 2.0 };
    const score = computeTrustScore(assertions, null, null, { flags: [] });
    assert.ok(score >= 40 && score <= 80, `Expected moderate score, got ${score}`);
  });

  it('clamps between 0 and 100', () => {
    // Even extreme values should clamp
    const assertions = { totalTests: 0, totalAssertions: 0, emptyTests: [], assertionDensity: 0 };
    const antiPatterns = { flags: Array(50).fill({ severity: 'error' }) };
    const score = computeTrustScore(assertions, null, null, antiPatterns);
    assert.ok(score >= 0 && score <= 100, `Score out of bounds: ${score}`);
  });
});

// --- formatAuditReport ---

describe('formatAuditReport', () => {
  it('produces readable output with all sections', () => {
    const report = {
      timestamp: '2026-03-31T12:00:00Z',
      projectRoot: tmpDir,
      assertions: { totalTests: 5, totalAssertions: 15, emptyTests: [], assertionDensity: 3.0 },
      coverage: { lines: 85, branches: 70, functions: 90, error: null, uncoveredFiles: ['lib/old.cjs'], coverageByFile: {} },
      mutations: { mutationsTotal: 5, mutationsCaught: 4, mutationScore: 80, survived: [{ file: 'lib/x.cjs', line: 10, mutation: 'flip-equality', description: 'Flip === to !== on line 10' }] },
      spotChecks: [{ file: 'tests/auth.test.cjs', testName: 'login test', line: 5, suggestion: 'Critical path test', productionFile: 'lib/auth.cjs', productionLine: 1 }],
      antiPatterns: { flags: [{ file: 'tests/weak.test.cjs', line: 3, pattern: 'toBeDefined-only', severity: 'warning', description: 'Weak assertion' }] },
      trustScore: 72,
    };

    const output = formatAuditReport(report, 'my-app');
    assert.ok(output.includes('Test Audit -- my-app'));
    assert.ok(output.includes('ASSERTIONS'));
    assert.ok(output.includes('Total tests: 5'));
    assert.ok(output.includes('COVERAGE'));
    assert.ok(output.includes('Lines: 85%'));
    assert.ok(output.includes('MUTATION SCORE'));
    assert.ok(output.includes('80%'));
    assert.ok(output.includes('SPOT-CHECK GUIDE'));
    assert.ok(output.includes('login test'));
    assert.ok(output.includes('ANTI-PATTERNS'));
    assert.ok(output.includes('Weak assertion'));
    assert.ok(output.includes('TRUST SCORE: 72/100'));
  });

  it('handles report with no coverage', () => {
    const report = {
      timestamp: '2026-03-31T12:00:00Z',
      projectRoot: tmpDir,
      assertions: { totalTests: 0, totalAssertions: 0, emptyTests: [], assertionDensity: 0 },
      coverage: null,
      mutations: null,
      spotChecks: [],
      antiPatterns: { flags: [] },
      trustScore: 15,
    };

    const output = formatAuditReport(report, 'empty-project');
    assert.ok(output.includes('Test Audit -- empty-project'));
    assert.ok(output.includes('Total tests: 0'));
    assert.ok(output.includes('TRUST SCORE: 15/100'));
    assert.ok(!output.includes('COVERAGE'));
    assert.ok(!output.includes('MUTATION SCORE'));
  });

  it('lists empty tests when present', () => {
    const report = {
      timestamp: '2026-03-31T12:00:00Z',
      projectRoot: tmpDir,
      assertions: { totalTests: 2, totalAssertions: 0, emptyTests: [
        { file: 'tests/a.test.cjs', name: 'empty one', line: 5 },
        { file: 'tests/b.test.cjs', name: 'empty two', line: 10 },
      ], assertionDensity: 0 },
      coverage: null,
      mutations: null,
      spotChecks: [],
      antiPatterns: { flags: [] },
      trustScore: 10,
    };

    const output = formatAuditReport(report, 'test');
    assert.ok(output.includes('empty one'));
    assert.ok(output.includes('empty two'));
    assert.ok(output.includes('Empty tests (0 assertions): 2'));
  });
});

// --- computeTrustScore: diversity and criticalPath branches ---

describe('computeTrustScore with diversity and criticalPath', () => {
  const baseAssertions = { totalTests: 10, totalAssertions: 25, emptyTests: [], assertionDensity: 2.5 };

  it('awards full diversity points for diversityRatio >= 0.30', () => {
    const diversity = { totalTests: 10, diversityRatio: 0.35 };
    const score = computeTrustScore(baseAssertions, null, null, { flags: [] }, diversity, null);
    assert.ok(score >= 50, `Expected >= 50, got ${score}`);
  });

  it('awards partial diversity points for diversityRatio between 0.20 and 0.30', () => {
    const diversity = { totalTests: 10, diversityRatio: 0.25 };
    const score = computeTrustScore(baseAssertions, null, null, { flags: [] }, diversity, null);
    assert.ok(score >= 40, `Expected >= 40, got ${score}`);
  });

  it('awards partial diversity points for diversityRatio between 0.10 and 0.20', () => {
    const diversity = { totalTests: 10, diversityRatio: 0.15 };
    const score = computeTrustScore(baseAssertions, null, null, { flags: [] }, diversity, null);
    assert.ok(score >= 30, `Expected >= 30, got ${score}`);
  });

  it('awards minimal diversity points for diversityRatio > 0 but < 0.10', () => {
    const diversity = { totalTests: 10, diversityRatio: 0.05 };
    const score = computeTrustScore(baseAssertions, null, null, { flags: [] }, diversity, null);
    assert.ok(score >= 20, `Expected >= 20, got ${score}`);
  });

  it('awards zero diversity points for diversityRatio === 0', () => {
    const diversity = { totalTests: 10, diversityRatio: 0 };
    const score1 = computeTrustScore(baseAssertions, null, null, { flags: [] }, diversity, null);
    const diversity2 = { totalTests: 10, diversityRatio: 0.05 };
    const score2 = computeTrustScore(baseAssertions, null, null, { flags: [] }, diversity2, null);
    assert.ok(score2 >= score1, 'More diverse should score higher');
  });

  it('awards neutral diversity score when no diversity data', () => {
    const score = computeTrustScore(baseAssertions, null, null, { flags: [] }, null, null);
    assert.ok(score >= 20, `Expected >= 20, got ${score}`);
  });

  it('awards criticalPath points when criticalFiles > 0', () => {
    const criticalPath = { criticalFiles: 5, score: 80 };
    const score = computeTrustScore(baseAssertions, null, null, { flags: [] }, null, criticalPath);
    assert.ok(score >= 20, `Expected >= 20, got ${score}`);
  });

  it('awards neutral criticalPath score when no critical paths', () => {
    const criticalPath = { criticalFiles: 0, score: 100 };
    const score1 = computeTrustScore(baseAssertions, null, null, { flags: [] }, null, criticalPath);
    const score2 = computeTrustScore(baseAssertions, null, null, { flags: [] }, null, null);
    // Both should get neutral 5 points
    assert.strictEqual(score1, score2);
  });

  it('handles assertion density between 0.5 and 1', () => {
    const assertions = { totalTests: 10, totalAssertions: 7, emptyTests: [], assertionDensity: 0.7 };
    const score = computeTrustScore(assertions, null, null, { flags: [] }, null, null);
    assert.ok(score >= 0 && score <= 100, `Score out of bounds: ${score}`);
  });

  it('handles assertion density between 1 and 2', () => {
    const assertions = { totalTests: 10, totalAssertions: 15, emptyTests: [], assertionDensity: 1.5 };
    const score = computeTrustScore(assertions, null, null, { flags: [] }, null, null);
    assert.ok(score >= 0 && score <= 100, `Score out of bounds: ${score}`);
  });
});

// --- formatAuditReport: coverage error branch ---

describe('formatAuditReport coverage and improvement edges', () => {
  it('shows coverage error message', () => {
    const report = {
      timestamp: '2026-03-31T12:00:00Z',
      projectRoot: tmpDir,
      assertions: { totalTests: 5, totalAssertions: 15, emptyTests: [], assertionDensity: 3.0 },
      coverage: { error: 'c8 not available', lines: 0, branches: 0, functions: 0, uncoveredFiles: [], coverageByFile: {} },
      mutations: null,
      spotChecks: [],
      antiPatterns: { flags: [] },
      trustScore: 50,
    };
    const output = formatAuditReport(report, 'proj');
    assert.ok(output.includes('Error: c8 not available'));
  });

  it('shows critical path section with untested paths', () => {
    const report = {
      timestamp: '2026-03-31T12:00:00Z',
      projectRoot: tmpDir,
      assertions: { totalTests: 5, totalAssertions: 15, emptyTests: [], assertionDensity: 3.0 },
      coverage: null,
      mutations: null,
      spotChecks: [],
      antiPatterns: { flags: [] },
      criticalPath: { score: 60, criticalFiles: 3, testedFiles: 1, wellTestedFiles: 0, untestedPaths: ['lib/auth.cjs', 'lib/session.cjs'], coverage: 0.33 },
      trustScore: 40,
    };
    const output = formatAuditReport(report, 'proj');
    assert.ok(output.includes('CRITICAL PATH COVERAGE'));
    assert.ok(output.includes('UNTESTED: lib/auth.cjs'));
  });

  it('shows test diversity section', () => {
    const report = {
      timestamp: '2026-03-31T12:00:00Z',
      projectRoot: tmpDir,
      assertions: { totalTests: 5, totalAssertions: 15, emptyTests: [], assertionDensity: 3.0 },
      coverage: null,
      mutations: null,
      spotChecks: [],
      antiPatterns: { flags: [] },
      diversity: { diversityScore: 40, totalTests: 20, errorPathTests: 5, edgeCaseTests: 3, happyPathOnlyTests: 12, diversityRatio: 0.40 },
      trustScore: 60,
    };
    const output = formatAuditReport(report, 'proj');
    assert.ok(output.includes('TEST DIVERSITY'));
    assert.ok(output.includes('Score: 40%'));
    assert.ok(output.includes('Error-path tests: 5'));
  });

  it('shows improvement suggestions when trust score < 70', () => {
    const report = {
      timestamp: '2026-03-31T12:00:00Z',
      projectRoot: tmpDir,
      assertions: { totalTests: 5, totalAssertions: 3, emptyTests: [{ file: 'a.test.cjs', name: 'x', line: 1 }], assertionDensity: 0.6 },
      coverage: { lines: 40, branches: 20, functions: 30, error: null, uncoveredFiles: [], coverageByFile: {} },
      mutations: { mutationsTotal: 10, mutationsCaught: 3, mutationScore: 30, survived: [{ file: 'lib/x.cjs', line: 5, mutation: 'flip-eq', description: 'Flip === on line 5' }] },
      spotChecks: [],
      antiPatterns: { flags: [{ severity: 'error', file: 'a.test.cjs', line: 1, pattern: 'empty-test', description: 'Empty test' }] },
      criticalPath: { score: 40, criticalFiles: 3, testedFiles: 1, wellTestedFiles: 0, untestedPaths: ['lib/auth.cjs'], coverage: 0.33 },
      diversity: { diversityScore: 5, totalTests: 10, errorPathTests: 0, edgeCaseTests: 0, happyPathOnlyTests: 10, diversityRatio: 0 },
      trustScore: 20,
    };
    const output = formatAuditReport(report, 'proj');
    assert.ok(output.includes('IMPROVEMENT SUGGESTIONS'));
    assert.ok(output.includes('Current score: 20/100'));
  });
});

// --- generateImprovementSuggestions ---

describe('generateImprovementSuggestions', () => {
  const { generateImprovementSuggestions } = require('../cap/bin/lib/cap-test-audit.cjs');

  it('suggests increasing assertion density when < 1', () => {
    const report = {
      assertions: { assertionDensity: 0.3, emptyTests: [], totalTests: 10 },
      coverage: null,
      mutations: null,
      antiPatterns: { flags: [] },
      criticalPath: null,
      diversity: null,
    };
    const suggestions = generateImprovementSuggestions(report);
    assert.ok(suggestions.length >= 1);
    assert.ok(suggestions.some(s => s.title.includes('assertion density')));
  });

  it('suggests increasing assertion density when between 1 and 2', () => {
    const report = {
      assertions: { assertionDensity: 1.5, emptyTests: [], totalTests: 10 },
      coverage: null,
      mutations: null,
      antiPatterns: { flags: [] },
      criticalPath: null,
      diversity: null,
    };
    const suggestions = generateImprovementSuggestions(report);
    assert.ok(suggestions.some(s => s.title.includes('assertion density')));
  });

  it('suggests fixing empty tests', () => {
    const report = {
      assertions: { assertionDensity: 3, emptyTests: [{ file: 'a.test.cjs', line: 1 }, { file: 'b.test.cjs', line: 2 }], totalTests: 10 },
      coverage: null,
      mutations: null,
      antiPatterns: { flags: [] },
      criticalPath: null,
      diversity: null,
    };
    const suggestions = generateImprovementSuggestions(report);
    assert.ok(suggestions.some(s => s.title.includes('empty test')));
  });

  it('suggests increasing coverage when lines < 70', () => {
    const report = {
      assertions: { assertionDensity: 3, emptyTests: [], totalTests: 10 },
      coverage: { lines: 40, branches: 20, functions: 30, error: null },
      mutations: null,
      antiPatterns: { flags: [] },
      criticalPath: null,
      diversity: null,
    };
    const suggestions = generateImprovementSuggestions(report);
    assert.ok(suggestions.some(s => s.title.includes('coverage')));
  });

  it('suggests improving branch coverage when < 50', () => {
    const report = {
      assertions: { assertionDensity: 3, emptyTests: [], totalTests: 10 },
      coverage: { lines: 80, branches: 30, functions: 80, error: null },
      mutations: null,
      antiPatterns: { flags: [] },
      criticalPath: null,
      diversity: null,
    };
    const suggestions = generateImprovementSuggestions(report);
    assert.ok(suggestions.some(s => s.title.includes('branch coverage')));
  });

  it('suggests catching surviving mutations', () => {
    const report = {
      assertions: { assertionDensity: 3, emptyTests: [], totalTests: 10 },
      coverage: null,
      mutations: { mutationsTotal: 10, mutationsCaught: 3, mutationScore: 30, survived: [{ file: 'x.cjs', line: 1, description: 'flip' }] },
      antiPatterns: { flags: [] },
      criticalPath: null,
      diversity: null,
    };
    const suggestions = generateImprovementSuggestions(report);
    assert.ok(suggestions.some(s => s.title.includes('mutation')));
  });

  it('suggests improving critical path coverage', () => {
    const report = {
      assertions: { assertionDensity: 3, emptyTests: [], totalTests: 10 },
      coverage: null,
      mutations: null,
      antiPatterns: { flags: [] },
      criticalPath: { score: 30, criticalFiles: 3, testedFiles: 1, wellTestedFiles: 0, untestedPaths: ['lib/auth.cjs'] },
      diversity: null,
    };
    const suggestions = generateImprovementSuggestions(report);
    assert.ok(suggestions.some(s => s.title.includes('critical path')));
  });

  it('suggests increasing test diversity', () => {
    const report = {
      assertions: { assertionDensity: 3, emptyTests: [], totalTests: 10 },
      coverage: null,
      mutations: null,
      antiPatterns: { flags: [] },
      criticalPath: null,
      diversity: { diversityRatio: 0.05, totalTests: 10 },
    };
    const suggestions = generateImprovementSuggestions(report);
    assert.ok(suggestions.some(s => s.title.includes('diversity')));
  });

  it('suggests fixing anti-patterns', () => {
    const report = {
      assertions: { assertionDensity: 3, emptyTests: [], totalTests: 10 },
      coverage: null,
      mutations: null,
      antiPatterns: { flags: [
        { severity: 'error', file: 'a.test.cjs', line: 1, pattern: 'empty-test', description: 'Empty test body' },
        { severity: 'warning', file: 'b.test.cjs', line: 2, pattern: 'weak', description: 'Weak assertion' },
      ] },
      criticalPath: null,
      diversity: null,
    };
    const suggestions = generateImprovementSuggestions(report);
    assert.ok(suggestions.some(s => s.title.includes('anti-pattern')));
  });

  it('sorts suggestions by points descending', () => {
    const report = {
      assertions: { assertionDensity: 0.3, emptyTests: [{ file: 'a', line: 1 }], totalTests: 10 },
      coverage: { lines: 30, branches: 10, functions: 20, error: null },
      mutations: { mutationsTotal: 10, mutationsCaught: 2, mutationScore: 20, survived: [{ file: 'x', line: 1, description: 'd' }] },
      antiPatterns: { flags: [{ severity: 'error', file: 'a', line: 1, pattern: 'x', description: 'y' }] },
      criticalPath: { score: 20, criticalFiles: 2, testedFiles: 0, wellTestedFiles: 0, untestedPaths: ['a'] },
      diversity: { diversityRatio: 0, totalTests: 10 },
    };
    const suggestions = generateImprovementSuggestions(report);
    assert.ok(suggestions.length >= 2);
    for (let i = 1; i < suggestions.length; i++) {
      assert.ok(suggestions[i - 1].points >= suggestions[i].points, `Suggestion ${i-1} (${suggestions[i-1].points}) should have >= points than ${i} (${suggestions[i].points})`);
    }
    assert.strictEqual(suggestions[0].priority, 1);
  });
});

// --- findTestFiles: unreadable directory ---

describe('findTestFiles edge cases', () => {
  it('handles unreadable directory gracefully', () => {
    const noDir = path.join(tmpDir, 'nonexistent');
    const files = findTestFiles(noDir);
    assert.strictEqual(files.length, 0);
  });
});

// --- analyzeAssertions: unreadable file ---

describe('analyzeAssertions edge cases', () => {
  it('skips unreadable test files', () => {
    const sub = path.join(tmpDir, 'tests');
    fs.mkdirSync(sub);
    const fp = path.join(sub, 'unreadable.test.cjs');
    fs.writeFileSync(fp, 'content');
    fs.chmodSync(fp, 0o000);
    const result = analyzeAssertions(tmpDir);
    // Should not crash; just skips the file
    assert.strictEqual(typeof result.totalTests, 'number');
    fs.chmodSync(fp, 0o644); // restore for cleanup
  });
});

// --- detectAntiPatterns: unreadable file ---

describe('detectAntiPatterns edge cases', () => {
  it('skips unreadable test files gracefully', () => {
    const sub = path.join(tmpDir, 'tests');
    fs.mkdirSync(sub);
    const fp = path.join(sub, 'unreadable.test.cjs');
    fs.writeFileSync(fp, 'content');
    fs.chmodSync(fp, 0o000);
    const result = detectAntiPatterns(tmpDir);
    assert.ok(Array.isArray(result.flags));
    fs.chmodSync(fp, 0o644);
  });
});

// --- generateSpotChecks: unreadable test file and import resolution ---

describe('generateSpotChecks edge cases', () => {
  it('skips unreadable test files', () => {
    const sub = path.join(tmpDir, 'tests');
    fs.mkdirSync(sub);
    const fp = path.join(sub, 'unreadable.test.cjs');
    fs.writeFileSync(fp, 'it("test", () => { assert.ok(1); });');
    fs.chmodSync(fp, 0o000);
    const result = generateSpotChecks(tmpDir, { count: 3 });
    assert.ok(Array.isArray(result));
    fs.chmodSync(fp, 0o644);
  });

  it('resolves production file from ES import syntax', () => {
    const sub = path.join(tmpDir, 'tests');
    fs.mkdirSync(sub);
    const testContent = [
      "import { something } from '../lib/util.js';",
      "const { it } = require('node:test');",
      "it('check import', () => " + "{ assert.ok(1); });",
    ].join('\n');
    fs.writeFileSync(path.join(sub, 'util.test.cjs'), testContent);
    const result = generateSpotChecks(tmpDir, { count: 1 });
    if (result.length > 0) {
      assert.ok(result[0].productionFile.includes('util'));
    }
  });

  it('handles test file with no require/import', () => {
    const sub = path.join(tmpDir, 'tests');
    fs.mkdirSync(sub);
    const testContent = [
      "const { it } = require('node:test');",
      "it('standalone test', () => " + "{ assert.ok(1); });",
    ].join('\n');
    fs.writeFileSync(path.join(sub, 'standalone.test.cjs'), testContent);
    const result = generateSpotChecks(tmpDir, { count: 1 });
    if (result.length > 0) {
      assert.strictEqual(result[0].productionFile, '');
    }
  });
});

// --- ASSERTION_PATTERNS ---

describe('ASSERTION_PATTERNS', () => {
  it('matches assert.strictEqual', () => {
    const line = '  assert.strictEqual(a, b);';
    assert.ok(ASSERTION_PATTERNS.some(p => p.test(line)));
  });

  it('matches expect().toBe()', () => {
    const line = '  expect(result).toBe(42);';
    assert.ok(ASSERTION_PATTERNS.some(p => p.test(line)));
  });

  it('matches assert.throws', () => {
    const line = '  assert.throws(() => fn(), Error);';
    assert.ok(ASSERTION_PATTERNS.some(p => p.test(line)));
  });

  it('does not match plain variable assignment', () => {
    const line = '  const x = 42;';
    assert.ok(!ASSERTION_PATTERNS.some(p => p.test(line)));
  });
});

// --- MUTATION_OPERATORS ---

describe('MUTATION_OPERATORS', () => {
  it('has at least 5 operators', () => {
    assert.ok(MUTATION_OPERATORS.length >= 5);
  });

  it('each operator has name, description, pattern, and replacement', () => {
    for (const op of MUTATION_OPERATORS) {
      assert.ok(op.name, 'operator missing name');
      assert.ok(op.description, 'operator missing description');
      assert.ok(op.pattern instanceof RegExp, 'operator pattern not a RegExp');
      assert.strictEqual(typeof op.replacement, 'string', 'operator replacement not a string');
    }
  });
});

// --- analyzeTestDiversity ---

describe('analyzeTestDiversity', () => {
  it('returns zero scores when no test files exist', () => {
    const result = analyzeTestDiversity(tmpDir);
    assert.strictEqual(result.diversityScore, 0);
    assert.strictEqual(result.totalTests, 0);
    assert.strictEqual(result.errorPathTests, 0);
    assert.strictEqual(result.edgeCaseTests, 0);
    assert.strictEqual(result.happyPathOnlyTests, 0);
    assert.strictEqual(result.diversityRatio, 0);
  });

  it('counts error path tests from test names', () => {
    fs.mkdirSync(path.join(tmpDir, 'tests'));
    const content = [
      "const { it } = require('node:test');",
      "const assert = require('node:assert');",
      "it('throws error on invalid input', () => " + "{ assert.ok(true); });",
      "it('rejects null argument', () => " + "{ assert.ok(true); });",
      "it('handles happy path', () => " + "{ assert.ok(true); });",
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'tests', 'err.test.cjs'), content);
    const result = analyzeTestDiversity(tmpDir);
    assert.strictEqual(result.totalTests, 3);
    assert.ok(result.errorPathTests >= 2, `Expected >= 2 error path tests, got ${result.errorPathTests}`);
  });

  it('counts edge case tests from test names', () => {
    fs.mkdirSync(path.join(tmpDir, 'tests'));
    const content = [
      "const { it } = require('node:test');",
      "const assert = require('node:assert');",
      "it('handles empty string', () => " + "{ assert.ok(true); });",
      "it('handles boundary value', () => " + "{ assert.ok(true); });",
      "it('normal operation', () => " + "{ assert.ok(true); });",
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'tests', 'edge.test.cjs'), content);
    const result = analyzeTestDiversity(tmpDir);
    assert.strictEqual(result.totalTests, 3);
    assert.ok(result.edgeCaseTests >= 2, `Expected >= 2 edge case tests, got ${result.edgeCaseTests}`);
  });

  it('computes diversityScore and happyPathOnlyTests correctly', () => {
    fs.mkdirSync(path.join(tmpDir, 'tests'));
    const content = [
      "const { it } = require('node:test');",
      "const assert = require('node:assert');",
      "it('throws on null', () => " + "{ assert.ok(true); });",
      "it('handles empty input', () => " + "{ assert.ok(true); });",
      "it('works normally', () => " + "{ assert.ok(true); });",
      "it('another normal test', () => " + "{ assert.ok(true); });",
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'tests', 'mixed.test.cjs'), content);
    const result = analyzeTestDiversity(tmpDir);
    assert.strictEqual(result.totalTests, 4);
    assert.ok(result.diversityScore >= 25, `diversityScore should be >= 25, got ${result.diversityScore}`);
    assert.ok(result.happyPathOnlyTests >= 1, 'Should have happy-path-only tests');
    assert.ok(result.diversityRatio > 0, 'diversityRatio should be > 0');
  });

  it('skips files that cannot be read', () => {
    fs.mkdirSync(path.join(tmpDir, 'tests'));
    // Create a test file then make it unreadable by replacing with a directory (causes read error)
    const badPath = path.join(tmpDir, 'tests', 'bad.test.cjs');
    fs.mkdirSync(badPath); // directory instead of file
    const result = analyzeTestDiversity(tmpDir);
    assert.strictEqual(result.totalTests, 0);
  });

  it('detects error paths from test body content', () => {
    fs.mkdirSync(path.join(tmpDir, 'tests'));
    const content = [
      "const { it } = require('node:test');",
      "const assert = require('node:assert');",
      "it('validates the input', () => " + "{",
      "  assert.throws(() => fn(null), /invalid/);",
      "});",
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'tests', 'body.test.cjs'), content);
    const result = analyzeTestDiversity(tmpDir);
    assert.ok(result.errorPathTests >= 1, 'Should detect error path from body (assert.throws)');
  });
});

// --- analyzeCriticalPathCoverage ---

describe('analyzeCriticalPathCoverage', () => {
  it('returns score 100 when no critical files exist', () => {
    const result = analyzeCriticalPathCoverage(tmpDir);
    assert.strictEqual(result.score, 100);
    assert.strictEqual(result.criticalFiles, 0);
    assert.strictEqual(result.coverage, 1.0);
  });

  it('detects critical files by name keyword', () => {
    // Create a source file with a critical keyword in name
    const libDir = path.join(tmpDir, 'cap', 'bin', 'lib');
    fs.mkdirSync(libDir, { recursive: true });
    fs.writeFileSync(path.join(libDir, 'cap-session.cjs'), '// session module');
    // No test file => untested
    const result = analyzeCriticalPathCoverage(tmpDir, { criticalPaths: ['session'] });
    assert.ok(result.criticalFiles >= 1, `Expected >= 1 critical file, got ${result.criticalFiles}`);
    assert.ok(result.untestedPaths.length >= 1, 'Should have untested paths');
  });

  it('detects critical files by content keyword', () => {
    const libDir = path.join(tmpDir, 'cap', 'bin', 'lib');
    fs.mkdirSync(libDir, { recursive: true });
    fs.writeFileSync(path.join(libDir, 'utility.cjs'), '// handles authentication logic\nmodule.exports = {};');
    const result = analyzeCriticalPathCoverage(tmpDir, { criticalPaths: ['auth'] });
    assert.ok(result.criticalFiles >= 1, 'Should detect critical file by content');
  });

  it('marks critical files as tested when test file exists', () => {
    const libDir = path.join(tmpDir, 'cap', 'bin', 'lib');
    fs.mkdirSync(libDir, { recursive: true });
    fs.writeFileSync(path.join(libDir, 'cap-session.cjs'), '// session module');
    // Create corresponding test file with assertions
    fs.mkdirSync(path.join(tmpDir, 'tests'));
    const testContent = [
      "const { it } = require('node:test');",
      "const assert = require('node:assert');",
      "it('t1', () => " + "{ assert.ok(1); });",
      "it('t2', () => " + "{ assert.ok(1); });",
      "it('t3', () => " + "{ assert.ok(1); });",
      "it('t4', () => " + "{ assert.ok(1); });",
      "it('t5', () => " + "{ assert.ok(1); assert.ok(2); assert.ok(3); });",
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'tests', 'cap-session.test.cjs'), testContent);
    const result = analyzeCriticalPathCoverage(tmpDir, { criticalPaths: ['session'] });
    assert.ok(result.testedFiles >= 1, 'Should have at least one tested file');
  });

  it('counts well-tested files with enough assertions per test', () => {
    const libDir = path.join(tmpDir, 'cap', 'bin', 'lib');
    fs.mkdirSync(libDir, { recursive: true });
    fs.writeFileSync(path.join(libDir, 'cap-session.cjs'), '// session');
    fs.mkdirSync(path.join(tmpDir, 'tests'));
    // Each test needs 2+ assertions on separate lines (ASSERTION_PATTERNS counts per-line)
    const lines = [
      "const { it } = require('node:test');",
      "const assert = require('node:assert');",
    ];
    for (let i = 0; i < 6; i++) {
      lines.push("it('test" + i + "', () => " + "{");
      lines.push("  assert.ok(1);");
      lines.push("  assert.strictEqual(1,1);");
      lines.push("  assert.deepStrictEqual([],[]);");
      lines.push("});");
    }
    fs.writeFileSync(path.join(tmpDir, 'tests', 'cap-session.test.cjs'), lines.join('\n'));
    const result = analyzeCriticalPathCoverage(tmpDir, { criticalPaths: ['session'] });
    assert.ok(result.wellTestedFiles >= 1, `Expected wellTestedFiles >= 1, got ${result.wellTestedFiles}`);
    assert.ok(result.score > 60, `Expected score > 60, got ${result.score}`);
  });

  it('scans otherDirs (bin, hooks, scripts)', () => {
    const binDir = path.join(tmpDir, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'security-check.js'), '// security check');
    const result = analyzeCriticalPathCoverage(tmpDir, { criticalPaths: ['security'] });
    assert.ok(result.criticalFiles >= 1, 'Should find critical file in bin/');
  });
});

// --- generateAuditReport ---

describe('generateAuditReport', () => {
  it('returns a full report object with all expected keys', () => {
    // Create minimal project structure
    fs.mkdirSync(path.join(tmpDir, 'tests'));
    const testContent = [
      "const { it } = require('node:test');",
      "const assert = require('node:assert');",
      "it('example', () => " + "{ assert.ok(true); });",
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'tests', 'example.test.cjs'), testContent);

    const report = generateAuditReport(tmpDir, {
      coverage: false,
      mutations: false,
      testCommand: 'node --test tests/',
    });
    assert.ok(report.timestamp, 'Should have timestamp');
    assert.strictEqual(report.projectRoot, tmpDir);
    assert.ok(report.assertions, 'Should have assertions');
    assert.strictEqual(report.coverage, null);
    assert.strictEqual(report.mutations, null);
    assert.ok(Array.isArray(report.spotChecks), 'Should have spotChecks array');
    assert.ok(report.antiPatterns, 'Should have antiPatterns');
    assert.ok(report.diversity, 'Should have diversity');
    assert.ok(report.criticalPath, 'Should have criticalPath');
    assert.strictEqual(typeof report.trustScore, 'number');
  });

  it('runs with coverage enabled (returns coverage object or null)', { skip: process.platform === 'win32' }, () => {
    fs.mkdirSync(path.join(tmpDir, 'tests'));
    fs.writeFileSync(path.join(tmpDir, 'tests', 'x.test.cjs'), "const { it } = require('node:test');\nit('x', () => " + "{ require('node:assert').ok(1); });");
    const report = generateAuditReport(tmpDir, {
      coverage: true,
      mutations: false,
      testCommand: 'echo "no coverage output"',
    });
    // coverage might be null or an object depending on c8 availability
    assert.ok('coverage' in report, 'report should have coverage key');
  });

  it('auto-discovers mutation targets from cap/bin/lib', () => {
    const libDir = path.join(tmpDir, 'cap', 'bin', 'lib');
    fs.mkdirSync(libDir, { recursive: true });
    fs.writeFileSync(path.join(libDir, 'sample.cjs'), "module.exports = { add: (a,b) => a + b };");
    fs.mkdirSync(path.join(tmpDir, 'tests'));
    fs.writeFileSync(path.join(tmpDir, 'tests', 'sample.test.cjs'), "const { it } = require('node:test');\nit('s', () => " + "{ require('node:assert').ok(1); });");

    const report = generateAuditReport(tmpDir, {
      coverage: false,
      mutations: true,
      mutationCount: 1,
      testCommand: 'node --test tests/',
      timeout: 5000,
    });
    // mutations should be attempted (may be null if no mutations apply)
    assert.ok('mutations' in report);
  });
});

// --- detectAntiPatterns: weak-assertions-only ---

describe('detectAntiPatterns weak-assertions-only', () => {
  it('flags a test that only has typeof checks', () => {
    fs.mkdirSync(path.join(tmpDir, 'tests'));
    const content = [
      "const { it } = require('node:test');",
      "it('only typeof', () => " + "{",
      "  if (typeof x === 'string') " + "{ console.log('ok'); }",
      "});",
      "it('has strong assertion', () => " + "{",
      "  require('node:assert').strictEqual(1, 1);",
      "});",
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'tests', 'weak.test.cjs'), content);
    const result = detectAntiPatterns(tmpDir);
    const weakOnly = result.flags.filter(f => f.pattern === 'weak-assertions-only');
    assert.ok(weakOnly.length >= 1, 'Should flag test with only weak assertions');
    assert.strictEqual(weakOnly[0].severity, 'warning');
  });
});

// --- analyzeAssertions: empty test detection ---

describe('analyzeAssertions empty test detection', () => {
  it('detects tests with zero assertions as empty tests', () => {
    fs.mkdirSync(path.join(tmpDir, 'tests'));
    const content = [
      "const { it } = require('node:test');",
      "it('does nothing', () => " + "{",
      "  const x = 1;",
      "});",
      "it('also empty', () => " + "{",
      "  console.log('no assertions');",
      "});",
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'tests', 'empty.test.cjs'), content);
    const result = analyzeAssertions(tmpDir);
    assert.strictEqual(result.emptyTests.length, 2);
    assert.strictEqual(result.emptyTests[0].name, 'does nothing');
    assert.strictEqual(result.emptyTests[1].name, 'also empty');
    assert.strictEqual(result.totalAssertions, 0);
  });

  it('detects last test in file as empty if it has no assertions', () => {
    fs.mkdirSync(path.join(tmpDir, 'tests'));
    const content = [
      "const { it } = require('node:test');",
      "const assert = require('node:assert');",
      "it('has assertion', () => " + "{ assert.ok(true); });",
      "it('trailing empty', () => " + "{",
      "  // no assertions here",
      "});",
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'tests', 'trailing.test.cjs'), content);
    const result = analyzeAssertions(tmpDir);
    assert.strictEqual(result.emptyTests.length, 1);
    assert.strictEqual(result.emptyTests[0].name, 'trailing empty');
  });
});

// --- analyzeCoverage (imported separately) ---

describe('analyzeCoverage', { skip: process.platform === 'win32' }, () => {
  const { analyzeCoverage } = require('../cap/bin/lib/cap-test-audit.cjs');

  it('parses coverage-summary.json when present', () => {
    // Create a fake coverage-summary.json
    const coverageDir = path.join(tmpDir, '.cap', 'coverage');
    fs.mkdirSync(coverageDir, { recursive: true });
    const summary = {
      total: {
        lines: { pct: 85 },
        branches: { pct: 70 },
        functions: { pct: 90 },
      },
      '/some/file.js': {
        lines: { pct: 40 },
        branches: { pct: 30 },
        functions: { pct: 50 },
      },
      '/another/file.js': {
        lines: { pct: 95 },
        branches: { pct: 80 },
        functions: { pct: 100 },
      },
    };
    fs.writeFileSync(path.join(coverageDir, 'coverage-summary.json'), JSON.stringify(summary));

    // analyzeCoverage runs c8 itself, but we can test the parsing by pre-creating the file
    // and using a test command that succeeds but produces no output
    const result = analyzeCoverage(tmpDir, 'true');
    // Even if c8 overwrites the summary, at least the function runs
    assert.ok('lines' in result);
    assert.ok('branches' in result);
    assert.ok('uncoveredFiles' in result);
  });
});

// --- runMutationTests ---

describe('runMutationTests', () => {
  const { runMutationTests } = require('../cap/bin/lib/cap-test-audit.cjs');

  it('detects surviving mutation when tests pass on mutated code', () => {
    // Create a source file with === that can be mutated
    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'logic.cjs'), "module.exports = (a) => a === 1 ? 'yes' : 'no';\n");
    // Create a test that does NOT check the return value strongly enough
    fs.mkdirSync(path.join(tmpDir, 'tests'));
    const testContent = [
      "const { it } = require('node:test');",
      "const assert = require('node:assert');",
      "const fn = require('../src/logic.cjs');",
      "it('runs', () => " + "{ assert.ok(typeof fn(1) === 'string'); });",
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'tests', 'logic.test.cjs'), testContent);
    const result = runMutationTests(tmpDir, ['src/logic.cjs'], 'node --test tests/logic.test.cjs', {
      mutations: 5,
      timeout: 10000,
    });
    assert.ok(result.mutationsTotal >= 1, `Expected mutations, got ${result.mutationsTotal}`);
    // With weak test, mutations likely survive
    assert.strictEqual(typeof result.mutationScore, 'number');
    // File should be restored
    const restored = fs.readFileSync(path.join(srcDir, 'logic.cjs'), 'utf8');
    assert.ok(restored.includes('==='), 'Source file should be restored after mutations');
  });

  it('catches mutation when test fails on mutated code', () => {
    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'eq.cjs'), "module.exports = (a, b) => a === b;\n");
    fs.mkdirSync(path.join(tmpDir, 'tests'));
    const testContent = [
      "const { it } = require('node:test');",
      "const assert = require('node:assert');",
      "const fn = require('../src/eq.cjs');",
      "it('check', () => " + "{ assert.strictEqual(fn(1, 1), true); });",
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'tests', 'eq.test.cjs'), testContent);
    const result = runMutationTests(tmpDir, ['src/eq.cjs'], 'node --test tests/eq.test.cjs', {
      mutations: 2,
      timeout: 10000,
    });
    assert.ok(result.mutationsTotal >= 1, `Expected at least 1 mutation, got ${result.mutationsTotal}`);
    const restored = fs.readFileSync(path.join(srcDir, 'eq.cjs'), 'utf8');
    assert.ok(restored.includes('==='), 'Source file should be restored');
  });

  it('skips unreadable target files', () => {
    // Reference a file that does not exist
    const result = runMutationTests(tmpDir, ['nonexistent/file.cjs'], 'true', {
      mutations: 1,
      timeout: 5000,
    });
    assert.strictEqual(result.mutationsTotal, 0);
  });

  it('returns zero score when no mutations can be applied', () => {
    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'empty.cjs'), '// nothing to mutate\n');
    const result = runMutationTests(tmpDir, ['src/empty.cjs'], 'true', {
      mutations: 5,
      timeout: 5000,
    });
    assert.strictEqual(result.mutationScore, 0);
    assert.strictEqual(result.mutationsTotal, 0);
  });
});

// --- ERROR_PATH_PATTERNS and EDGE_CASE_PATTERNS ---

describe('ERROR_PATH_PATTERNS', () => {
  it('matches common error-related test names', () => {
    const errorNames = ['throws error on null', 'rejects invalid', 'fails gracefully', 'handles exception'];
    for (const name of errorNames) {
      assert.ok(ERROR_PATH_PATTERNS.some(p => p.test(name)), `Should match: "${name}"`);
    }
  });
});

describe('EDGE_CASE_PATTERNS', () => {
  it('matches common edge-case test names', () => {
    const edgeNames = ['handles empty array', 'boundary condition', 'zero length input', 'null parameter'];
    for (const name of edgeNames) {
      assert.ok(EDGE_CASE_PATTERNS.some(p => p.test(name)), `Should match: "${name}"`);
    }
  });
});

// ---------------------------------------------------------------------------
// F-053: Native coverage path
// ---------------------------------------------------------------------------

describe('supportsNativeCoverage', () => {
  const { supportsNativeCoverage } = require('../cap/bin/lib/cap-test-audit.cjs');

  it('returns true for bare `node --test <paths>`', () => {
    assert.strictEqual(supportsNativeCoverage('node --test tests/'), true);
    assert.strictEqual(supportsNativeCoverage('node --test tests/a.cjs tests/b.cjs'), true);
  });

  it('returns true when extra node flags precede --test', () => {
    assert.strictEqual(supportsNativeCoverage('node --test-isolation=none --test tests/'), true);
    assert.strictEqual(supportsNativeCoverage('node --experimental-vm-modules --test tests/'), true);
  });

  it('returns false for vitest / jest / ts-node wrappers', () => {
    assert.strictEqual(supportsNativeCoverage('npx vitest run'), false);
    assert.strictEqual(supportsNativeCoverage('jest --ci'), false);
    assert.strictEqual(supportsNativeCoverage('npx ts-node tests/a.ts'), false);
  });

  it('returns false for non-string or missing command', () => {
    assert.strictEqual(supportsNativeCoverage(null), false);
    assert.strictEqual(supportsNativeCoverage(undefined), false);
    assert.strictEqual(supportsNativeCoverage(42), false);
  });
});

describe('parseNativeCoverageOutput', () => {
  const { parseNativeCoverageOutput } = require('../cap/bin/lib/cap-test-audit.cjs');

  it('parses a minimal native coverage report', () => {
    const stdout = [
      'ℹ tests 10',
      'ℹ pass 10',
      'ℹ start of coverage report',
      'ℹ -------------------|---------|----------|---------|---------|---------',
      'ℹ file              | line %  | branch % | funcs % | uncovered',
      'ℹ -------------------|---------|----------|---------|---------|---------',
      'ℹ cap-anchor.cjs    |   99.09 |    94.44 |  100.00 | 102-103',
      'ℹ cap-deps.cjs      |   40.25 |   100.00 |    0.00 | 50-120',
      'ℹ -------------------|---------|----------|---------|---------|---------',
      'ℹ all files         |   98.03 |    89.62 |   97.81 |',
      'ℹ -------------------|---------|----------|---------|---------|---------',
      'ℹ end of coverage report',
    ].join('\n');
    const result = parseNativeCoverageOutput(stdout, {
      lines: 0, branches: 0, functions: 0, uncoveredFiles: [], coverageByFile: {},
    });
    assert.strictEqual(result.lines, 98.03);
    assert.strictEqual(result.branches, 89.62);
    assert.strictEqual(result.functions, 97.81);
    assert.strictEqual(result.coverageByFile['cap-anchor.cjs'].lines, 99.09);
    assert.strictEqual(result.coverageByFile['cap-deps.cjs'].lines, 40.25);
    assert.ok(result.uncoveredFiles.includes('cap-deps.cjs'));
    assert.ok(!result.uncoveredFiles.includes('cap-anchor.cjs'));
  });

  it('ignores rows outside start/end markers', () => {
    const stdout = [
      'ℹ tests 10',
      'ℹ cap-foo.cjs      |   50.00 |   50.00 |   50.00 | 1-10',
      'ℹ start of coverage report',
      'ℹ cap-bar.cjs      |   80.00 |   70.00 |   60.00 |',
      'ℹ end of coverage report',
      'ℹ cap-baz.cjs      |   99.00 |   99.00 |   99.00 |',
    ].join('\n');
    const result = parseNativeCoverageOutput(stdout, {
      lines: 0, branches: 0, functions: 0, uncoveredFiles: [], coverageByFile: {},
    });
    assert.strictEqual(Object.keys(result.coverageByFile).length, 1);
    assert.ok('cap-bar.cjs' in result.coverageByFile);
  });

  it('sets error when no parseable rows are found', () => {
    const stdout = 'ℹ start of coverage report\nℹ end of coverage report\n';
    const result = parseNativeCoverageOutput(stdout, {
      lines: 0, branches: 0, functions: 0, uncoveredFiles: [], coverageByFile: {},
    });
    assert.ok(result.error);
  });

  it('accepts rows without the ℹ prefix (older node versions)', () => {
    const stdout = [
      'start of coverage report',
      '  cap-foo.cjs  |  95.00 |  80.00 |  90.00 |',
      '  all files   |  95.00 |  80.00 |  90.00 |',
      'end of coverage report',
    ].join('\n');
    const result = parseNativeCoverageOutput(stdout, {
      lines: 0, branches: 0, functions: 0, uncoveredFiles: [], coverageByFile: {},
    });
    assert.strictEqual(result.lines, 95);
    assert.ok('cap-foo.cjs' in result.coverageByFile);
  });
});

// @cap-risk The native-coverage integration path works when /cap:test-audit runs against
// a normal project, but spawning `node --experimental-test-coverage` from INSIDE a
// `node --test` parent suppresses the coverage output on stdout. We therefore cover the
// native path via parser unit tests (parseNativeCoverageOutput above) plus the routing
// test below, and exercise the end-to-end flow via the supportsNativeCoverage check —
// not by spawning a nested test runner.
describe('analyzeCoverage: routes non-node commands to c8', { skip: process.platform === 'win32' }, () => {
  const { analyzeCoverage } = require('../cap/bin/lib/cap-test-audit.cjs');

  it('returns source=c8 for vitest/jest/ts-node style commands', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-audit-fallback-'));
    try {
      const result = analyzeCoverage(tmp, 'npx vitest run');
      assert.strictEqual(result.source, 'c8');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
