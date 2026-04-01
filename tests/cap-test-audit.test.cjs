'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  analyzeAssertions,
  detectAntiPatterns,
  generateSpotChecks,
  computeTrustScore,
  findTestFiles,
  applyMutation,
  ASSERTION_PATTERNS,
  WEAK_ASSERTION_PATTERNS,
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
    const testContent = `
'use strict';
const { it } = require('node:test');
const assert = require('node:assert');

it('test one', () => {
  assert.strictEqual(1, 1);
  assert.ok(true);
});

it('test two', () => {
  assert.deepStrictEqual({a: 1}, {a: 1});
});
`;
    fs.writeFileSync(path.join(tmpDir, 'sample.test.cjs'), testContent);
    const result = analyzeAssertions(tmpDir);
    assert.strictEqual(result.totalTests, 2);
    assert.strictEqual(result.totalAssertions, 3);
    assert.strictEqual(result.emptyTests.length, 0);
    assert.ok(result.assertionDensity > 0);
  });

  it('flags tests with zero assertions', () => {
    const testContent = `
const { it } = require('node:test');
it('empty test', () => {
  const x = 1 + 1;
});
`;
    fs.writeFileSync(path.join(tmpDir, 'empty.test.cjs'), testContent);
    const result = analyzeAssertions(tmpDir);
    assert.strictEqual(result.totalTests, 1);
    assert.strictEqual(result.totalAssertions, 0);
    assert.strictEqual(result.emptyTests.length, 1);
    assert.strictEqual(result.emptyTests[0].name, 'empty test');
  });

  it('handles files with many assertions per test', () => {
    const testContent = `
const { it } = require('node:test');
const assert = require('node:assert');
it('thorough test', () => {
  assert.strictEqual(1, 1);
  assert.ok(true);
  assert.deepStrictEqual([], []);
  assert.notStrictEqual(1, 2);
  assert.match('hello', /hello/);
});
`;
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
    const testContent = `
import { it, expect } from 'vitest';
it('vitest test', () => {
  expect(1).toBe(1);
  expect([1,2]).toHaveLength(2);
  expect(() => { throw new Error() }).toThrow();
});
`;
    fs.writeFileSync(path.join(tmpDir, 'vitest.test.ts'), testContent);
    const result = analyzeAssertions(tmpDir);
    assert.strictEqual(result.totalTests, 1);
    assert.strictEqual(result.totalAssertions, 3);
  });
});

// --- detectAntiPatterns ---

describe('detectAntiPatterns', () => {
  it('flags toBeDefined-only assertions', () => {
    const testContent = `
const { it } = require('node:test');
it('weak test', () => {
  expect(result).toBeDefined();
});
`;
    fs.writeFileSync(path.join(tmpDir, 'weak.test.cjs'), testContent);
    const result = detectAntiPatterns(tmpDir);
    assert.ok(result.flags.length > 0);
    const toBeDefined = result.flags.find(f => f.pattern === 'toBeDefined-only');
    assert.ok(toBeDefined);
    assert.strictEqual(toBeDefined.severity, 'warning');
  });

  it('flags toBeTruthy-only assertions', () => {
    const testContent = `
const { it } = require('node:test');
it('truthy test', () => {
  expect(result).toBeTruthy();
});
`;
    fs.writeFileSync(path.join(tmpDir, 'truthy.test.cjs'), testContent);
    const result = detectAntiPatterns(tmpDir);
    const flag = result.flags.find(f => f.pattern === 'toBeTruthy-only');
    assert.ok(flag);
    assert.strictEqual(flag.severity, 'warning');
  });

  it('flags snapshot tests on logic', () => {
    const testContent = `
const { it } = require('node:test');
it('snapshot test', () => {
  expect(calculateTotal(items)).toMatchSnapshot();
});
`;
    fs.writeFileSync(path.join(tmpDir, 'snap.test.cjs'), testContent);
    const result = detectAntiPatterns(tmpDir);
    const flag = result.flags.find(f => f.pattern === 'snapshot-logic');
    assert.ok(flag);
  });

  it('returns no flags for strong assertions', () => {
    const testContent = `
const { it } = require('node:test');
const assert = require('node:assert');
it('strong test', () => {
  assert.strictEqual(add(1, 2), 3);
  assert.deepStrictEqual(getItems(), ['a', 'b']);
});
`;
    fs.writeFileSync(path.join(tmpDir, 'strong.test.cjs'), testContent);
    const result = detectAntiPatterns(tmpDir);
    // Should not have weak-assertion-only or empty-test flags
    const weak = result.flags.filter(f => f.pattern === 'weak-assertions-only' || f.pattern === 'empty-test-body');
    assert.strictEqual(weak.length, 0);
  });

  it('flags empty test bodies', () => {
    const testContent = `
const { it } = require('node:test');
it('noop test', () => {});
`;
    fs.writeFileSync(path.join(tmpDir, 'noop.test.cjs'), testContent);
    const result = detectAntiPatterns(tmpDir);
    const flag = result.flags.find(f => f.pattern === 'empty-test-body');
    assert.ok(flag);
    assert.strictEqual(flag.severity, 'error');
  });

  it('flags typeof-only checks', () => {
    const testContent = `
const { it } = require('node:test');
it('type check', () => {
  if (typeof result === 'string') {}
});
`;
    fs.writeFileSync(path.join(tmpDir, 'typeof.test.cjs'), testContent);
    const result = detectAntiPatterns(tmpDir);
    const flag = result.flags.find(f => f.pattern === 'typeof-only');
    assert.ok(flag);
  });
});

// --- generateSpotChecks ---

describe('generateSpotChecks', () => {
  it('returns spot checks for test files', () => {
    const testContent = `
const { it } = require('node:test');
const assert = require('node:assert');
const auth = require('../lib/auth.cjs');
it('auth login test', () => {
  assert.ok(true);
});
it('another test', () => {
  assert.strictEqual(1, 1);
});
`;
    const testsDir = path.join(tmpDir, 'tests');
    fs.mkdirSync(testsDir);
    fs.writeFileSync(path.join(testsDir, 'auth.test.cjs'), testContent);
    const result = generateSpotChecks(tmpDir, { count: 3, criticalPaths: ['auth'] });
    assert.ok(result.length > 0);
    assert.ok(result.length <= 3);
    assert.ok(result[0].file);
    assert.ok(result[0].testName);
    assert.ok(result[0].line > 0);
    assert.ok(result[0].suggestion);
  });

  it('prioritizes critical path tests', () => {
    const testsDir = path.join(tmpDir, 'tests');
    fs.mkdirSync(testsDir);

    // Auth test (critical)
    fs.writeFileSync(path.join(testsDir, 'auth-login.test.cjs'), `
const { it } = require('node:test');
it('login check', () => {});
`);

    // Utility test (not critical)
    fs.writeFileSync(path.join(testsDir, 'utils-format.test.cjs'), `
const { it } = require('node:test');
const assert = require('node:assert');
it('format date', () => { assert.strictEqual(1,1); assert.ok(true); assert.ok(true); });
`);

    const result = generateSpotChecks(tmpDir, { count: 1, criticalPaths: ['auth'] });
    assert.strictEqual(result.length, 1);
    assert.ok(result[0].file.includes('auth'));
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
