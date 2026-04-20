// @cap-feature(feature:F-007) Test Audit — assertion analysis, coverage parsing, mutation testing, anti-pattern detection
// @cap-decision Regex-based assertion counting -- no AST parsing needed for counting assert/expect patterns.
// @cap-decision Simple mutation engine -- flip operators, negate conditions, remove returns. No external mutation framework.
// @cap-constraint Zero external dependencies -- uses only Node.js built-ins (fs, path, child_process).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

// Patterns that count as assertions
const ASSERTION_PATTERNS = [
  /assert\.\w+/,
  /expect\(/,
  /\.toBe\(/,
  /\.toEqual\(/,
  /\.toThrow\(/,
  /\.toHaveLength\(/,
  /\.toContain\(/,
  /\.toMatch\(/,
  /\.toBeTruthy\(/,
  /\.toBeFalsy\(/,
  /\.toBeNull\(/,
  /\.toBeUndefined\(/,
  /\.toBeDefined\(/,
  /\.toBeGreaterThan\(/,
  /\.toBeLessThan\(/,
  /\.toHaveBeenCalled/,
  /\.toHaveProperty\(/,
  /\.toStrictEqual\(/,
  /\.rejects\./,
  /\.resolves\./,
  /assert\.strictEqual/,
  /assert\.deepStrictEqual/,
  /assert\.ok/,
  /assert\.throws/,
  /assert\.rejects/,
  /assert\.doesNotThrow/,
  /assert\.match/,
  /assert\.notStrictEqual/,
];

// Weak assertion patterns (anti-patterns)
const WEAK_ASSERTION_PATTERNS = [
  { pattern: /\.toBeDefined\(\)/, name: 'toBeDefined-only', severity: 'warning', description: 'Weak assertion: only checks value is defined, not correctness' },
  { pattern: /\.toBeTruthy\(\)/, name: 'toBeTruthy-only', severity: 'warning', description: 'Weak assertion: only checks truthiness, not specific value' },
  { pattern: /\.toBeFalsy\(\)/, name: 'toBeFalsy-only', severity: 'info', description: 'Potentially weak assertion: only checks falsiness' },
  { pattern: /typeof\s+\w+\s*===?\s*['"]/, name: 'typeof-only', severity: 'warning', description: 'Weak assertion: only checks type, not value' },
  { pattern: /\.toMatchSnapshot\(\)/, name: 'snapshot-logic', severity: 'warning', description: 'Snapshot test on logic code -- prefer explicit assertions' },
  { pattern: /expect\([^)]+\)\s*$/, name: 'expect-no-matcher', severity: 'error', description: 'expect() without matcher -- test always passes' },
];

// Test block patterns for detecting individual tests
const TEST_BLOCK_RE = /^\s*(?:it|test)\s*\(\s*['"`]([^'"`]+)['"`]/;
const DESCRIBE_BLOCK_RE = /^\s*describe\s*\(\s*['"`]([^'"`]+)['"`]/;

// Default test file extensions
const DEFAULT_TEST_EXTENSIONS = ['.test.cjs', '.test.js', '.test.mjs', '.test.ts', '.test.tsx', '.spec.cjs', '.spec.js', '.spec.ts'];

/**
 * Find test files in a directory recursively.
 * @param {string} dir - Directory to search
 * @param {string[]} extensions - Test file extensions to match
 * @returns {string[]} - Array of absolute file paths
 */
function findTestFiles(dir, extensions = DEFAULT_TEST_EXTENSIONS) {
  const files = [];
  const EXCLUDE = ['node_modules', '.git', 'dist', 'build', 'coverage', '.cap'];

  function walk(d) {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (_e) {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (EXCLUDE.includes(entry.name)) continue;
        walk(fullPath);
      } else if (entry.isFile()) {
        const hasTestExt = extensions.some(ext => entry.name.endsWith(ext));
        if (hasTestExt) files.push(fullPath);
      }
    }
  }

  walk(dir);
  return files;
}

/**
 * Count assertions in test files. Flags tests with zero assertions.
 *
 * @param {string} projectRoot
 * @param {Object} options - { testPattern: glob, extensions: ['.test.ts', '.test.cjs'] }
 * @returns {{ totalTests: number, totalAssertions: number, emptyTests: Array<{file, name, line}>, assertionDensity: number }}
 */
function analyzeAssertions(projectRoot, options = {}) {
  const extensions = options.extensions || DEFAULT_TEST_EXTENSIONS;
  const testFiles = findTestFiles(projectRoot, extensions);

  let totalTests = 0;
  let totalAssertions = 0;
  const emptyTests = [];

  for (const filePath of testFiles) {
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (_e) {
      continue;
    }

    const relativePath = path.relative(projectRoot, filePath);
    const lines = content.split('\n');

    // Track test blocks and their assertion counts
    let currentTest = null;
    let braceDepth = 0;
    let testAssertionCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check for test block start
      const testMatch = line.match(TEST_BLOCK_RE);
      if (testMatch) {
        // Save previous test if it had no assertions
        if (currentTest && testAssertionCount === 0) {
          emptyTests.push({
            file: relativePath,
            name: currentTest.name,
            line: currentTest.line,
          });
        }
        totalTests++;
        currentTest = { name: testMatch[1], line: i + 1 };
        testAssertionCount = 0;
        braceDepth = 0;
      }

      // Count assertions on this line
      if (currentTest) {
        for (const pattern of ASSERTION_PATTERNS) {
          if (pattern.test(line)) {
            testAssertionCount++;
            totalAssertions++;
            break; // Count one assertion per line max
          }
        }
      }
    }

    // Check last test in file
    if (currentTest && testAssertionCount === 0) {
      emptyTests.push({
        file: relativePath,
        name: currentTest.name,
        line: currentTest.line,
      });
    }
  }

  return {
    totalTests,
    totalAssertions,
    emptyTests,
    assertionDensity: totalTests > 0 ? Math.round((totalAssertions / totalTests) * 100) / 100 : 0,
  };
}

/**
 * Run coverage analysis. Prefers Node's native `--experimental-test-coverage`
 * (offline, zero-dep, available on Node >= 20). Falls back to `npx c8` when
 * the test command isn't a `node --test` invocation or native coverage fails.
 *
 * @param {string} projectRoot
 * @param {string} testCommand - e.g., 'node --test tests/' or 'npx vitest run'
 * @param {{ preferC8?: boolean }} [options] - preferC8 forces the legacy path (tests only)
 * @returns {{ lines: number, branches: number, functions: number, uncoveredFiles: string[], coverageByFile: Object, source?: ('native'|'c8') }}
 */
// @cap-todo(ac:F-053/AC-1) Prefer Node native --experimental-test-coverage when the test command is `node --test`.
// @cap-todo(ac:F-053/AC-2) Fall back to `npx c8` when native is unavailable or the test command uses vitest/etc.
function analyzeCoverage(projectRoot, testCommand, options) {
  const opts = options || {};
  const useC8 = opts.preferC8 === true || !supportsNativeCoverage(testCommand);
  if (!useC8) {
    const native = analyzeCoverageNative(projectRoot, testCommand);
    if (!native.error) {
      native.source = 'native';
      return native;
    }
    // Native failed — fall through to c8 with a deprecation-safe error note preserved
  }
  const legacy = analyzeCoverageC8(projectRoot, testCommand);
  legacy.source = 'c8';
  return legacy;
}

// @cap-decision A test command qualifies for native coverage when it starts with
// `node --test` or `node --test-only …` and references files/paths directly. Commands
// that wrap tests in another runner (vitest, jest, ts-node) cannot be injected with
// `--experimental-test-coverage` — c8 remains the right tool for those.
function supportsNativeCoverage(testCommand) {
  if (typeof testCommand !== 'string') return false;
  const trimmed = testCommand.trim();
  return /^node\s+(?:--[\w-]+(?:=\S+)?\s+)*--test(\s|$)/.test(trimmed);
}

/**
 * Coverage via Node's built-in `--experimental-test-coverage`. Parses the
 * text-format report emitted to stdout. Runs offline, no external deps.
 *
 * @param {string} projectRoot
 * @param {string} testCommand - must start with `node --test …`
 * @returns {{ lines:number, branches:number, functions:number, uncoveredFiles:string[], coverageByFile:Object, error?:string }}
 */
// @cap-todo(ac:F-053/AC-3) Parse Node's native coverage text into the same shape parseCoverage() returns.
// @cap-todo(ac:F-053/AC-4) Native path must work offline — no npx, no network.
function analyzeCoverageNative(projectRoot, testCommand) {
  const result = {
    lines: 0,
    branches: 0,
    functions: 0,
    uncoveredFiles: [],
    coverageByFile: {},
  };

  // Inject native coverage flags into the `node --test` invocation. Keep whatever
  // flags the caller already passed (e.g. --test-isolation=none from run-tests.cjs).
  const injected = testCommand.replace(
    /^node(\s+)/,
    `node$1--experimental-test-coverage --test-reporter=spec `
  );

  // Scrub env vars that would hijack the child's coverage channel — when /cap:test-audit
  // is itself invoked under c8 or `node --experimental-test-coverage`, NODE_V8_COVERAGE
  // and friends leak in and route the child's raw v8 profile into the parent's dir,
  // leaving stdout without the expected text report.
  const env = { ...process.env };
  delete env.NODE_V8_COVERAGE;
  delete env.NODE_OPTIONS;

  let stdout;
  try {
    stdout = execSync(injected, {
      cwd: projectRoot,
      env,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 180000,
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (e) {
    // Tests may fail but still produce coverage output on stdout
    stdout = (e.stdout && e.stdout.toString()) || '';
    if (!stdout.includes('start of coverage report')) {
      result.error = 'Native coverage run failed: ' + (e.message || 'unknown error');
      return result;
    }
  }

  return parseNativeCoverageOutput(stdout, result);
}

/**
 * Parse the text-format coverage report Node emits between
 * `ℹ start of coverage report` and `ℹ end of coverage report`. Extracts per-file
 * percentages and the "all files" summary row. Accepts buffers without the ℹ prefix
 * (the node --test reporter emits it but older versions may omit it).
 *
 * @param {string} stdout
 * @param {Object} result - Result object to mutate in place
 * @returns {Object}
 */
function parseNativeCoverageOutput(stdout, result) {
  const lines = stdout.split('\n');
  let inReport = false;
  const FILE_ROW_RE = /^(?:ℹ\s*)?\s*([A-Za-z0-9._\-/]+\.(?:cjs|js|mjs|tsx?|jsx?))\s*\|\s*([0-9.]+)\s*\|\s*([0-9.]+)\s*\|\s*([0-9.]+)\s*\|\s*(.*)$/;
  const ALL_FILES_RE = /^(?:ℹ\s*)?\s*all files\s*\|\s*([0-9.]+)\s*\|\s*([0-9.]+)\s*\|\s*([0-9.]+)\s*\|/i;

  for (const raw of lines) {
    if (raw.includes('start of coverage report')) { inReport = true; continue; }
    if (raw.includes('end of coverage report')) { inReport = false; continue; }
    if (!inReport) continue;

    const all = raw.match(ALL_FILES_RE);
    if (all) {
      result.lines = Number(all[1]);
      result.branches = Number(all[2]);
      result.functions = Number(all[3]);
      continue;
    }
    const m = raw.match(FILE_ROW_RE);
    if (!m) continue;
    const file = m[1];
    const linePct = Number(m[2]);
    const branchPct = Number(m[3]);
    const funcPct = Number(m[4]);
    result.coverageByFile[file] = { lines: linePct, branches: branchPct, functions: funcPct };
    if (linePct < 50) result.uncoveredFiles.push(file);
  }

  if (Object.keys(result.coverageByFile).length === 0 && result.lines === 0) {
    result.error = 'Native coverage produced no parseable rows';
  }
  return result;
}

/**
 * Legacy c8 path. Kept as fallback for projects that use vitest/jest/etc.
 * @param {string} projectRoot
 * @param {string} testCommand
 * @returns {{ lines:number, branches:number, functions:number, uncoveredFiles:string[], coverageByFile:Object, error?:string }}
 */
function analyzeCoverageC8(projectRoot, testCommand) {
  const result = {
    lines: 0,
    branches: 0,
    functions: 0,
    uncoveredFiles: [],
    coverageByFile: {},
  };

  // Check if c8 is available
  try {
    execSync('npx c8 --version', { cwd: projectRoot, stdio: 'pipe', timeout: 10000 });
  } catch (_e) {
    result.error = 'c8 not available. For node --test projects use native coverage (Node >= 20); otherwise install c8 via `npm install -D c8`.';
    return result;
  }

  // Run tests with c8 JSON reporter
  const coverageDir = path.join(projectRoot, '.cap', 'coverage');
  try {
    execSync(
      `npx c8 --reporter json --report-dir "${coverageDir}" ${testCommand}`,
      { cwd: projectRoot, stdio: 'pipe', timeout: 120000 }
    );
  } catch (e) {
    // Tests might fail but still produce coverage
    if (!fs.existsSync(path.join(coverageDir, 'coverage-summary.json'))) {
      result.error = 'Coverage run failed: ' + (e.message || 'unknown error');
      return result;
    }
  }

  // Parse coverage JSON
  const summaryPath = path.join(coverageDir, 'coverage-summary.json');
  if (!fs.existsSync(summaryPath)) {
    result.error = 'Coverage summary not found at ' + summaryPath;
    return result;
  }

  try {
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    const total = summary.total || {};
    result.lines = (total.lines && total.lines.pct) || 0;
    result.branches = (total.branches && total.branches.pct) || 0;
    result.functions = (total.functions && total.functions.pct) || 0;

    // Per-file coverage
    for (const [filePath, data] of Object.entries(summary)) {
      if (filePath === 'total') continue;
      const relPath = path.relative(projectRoot, filePath);
      const linePct = (data.lines && data.lines.pct) || 0;
      result.coverageByFile[relPath] = {
        lines: linePct,
        branches: (data.branches && data.branches.pct) || 0,
        functions: (data.functions && data.functions.pct) || 0,
      };
      if (linePct < 50) {
        result.uncoveredFiles.push(relPath);
      }
    }
  } catch (e) {
    result.error = 'Failed to parse coverage JSON: ' + e.message;
  }

  return result;
}

// Mutation operators for simple mutation testing
const MUTATION_OPERATORS = [
  {
    name: 'flip-equality',
    description: 'Flip === to !==',
    pattern: /===/g,
    replacement: '!==',
  },
  {
    name: 'flip-inequality',
    description: 'Flip !== to ===',
    pattern: /!==/g,
    replacement: '===',
  },
  {
    name: 'flip-gt',
    description: 'Flip > to <',
    pattern: /(?<!=)>(?!=)/g,
    replacement: '<',
  },
  {
    name: 'flip-lt',
    description: 'Flip < to >',
    pattern: /(?<!=)<(?!=)/g,
    replacement: '>',
  },
  {
    name: 'flip-true',
    description: 'Flip true to false',
    pattern: /\btrue\b/g,
    replacement: 'false',
  },
  {
    name: 'flip-false',
    description: 'Flip false to true',
    pattern: /\bfalse\b/g,
    replacement: 'true',
  },
  {
    name: 'remove-return',
    description: 'Remove return value (return undefined)',
    pattern: /return\s+[^;}\n]+/g,
    replacement: 'return undefined',
  },
  {
    name: 'flip-plus-minus',
    description: 'Flip + to -',
    pattern: /(?<=[a-zA-Z0-9_)\]]) \+ (?=[a-zA-Z0-9_(])/g,
    replacement: ' - ',
  },
  {
    name: 'flip-and-or',
    description: 'Flip && to ||',
    pattern: /&&/g,
    replacement: '||',
  },
  {
    name: 'flip-or-and',
    description: 'Flip || to &&',
    pattern: /\|\|/g,
    replacement: '&&',
  },
];

/**
 * Apply a single mutation to a specific line in file content.
 *
 * @param {string} content - File content
 * @param {number} lineIndex - 0-based line index to mutate
 * @param {Object} operator - Mutation operator with pattern and replacement
 * @returns {{ mutated: string, applied: boolean, description: string }}
 */
function applyMutation(content, lineIndex, operator) {
  const lines = content.split('\n');
  if (lineIndex < 0 || lineIndex >= lines.length) {
    return { mutated: content, applied: false, description: '' };
  }

  const originalLine = lines[lineIndex];
  // Skip comment lines
  if (/^\s*(?:\/\/|\/\*|\*|#|--)/.test(originalLine)) {
    return { mutated: content, applied: false, description: '' };
  }

  const mutatedLine = originalLine.replace(operator.pattern, operator.replacement);
  if (mutatedLine === originalLine) {
    return { mutated: content, applied: false, description: '' };
  }

  lines[lineIndex] = mutatedLine;
  return {
    mutated: lines.join('\n'),
    applied: true,
    description: `${operator.description} on line ${lineIndex + 1}`,
  };
}

/**
 * Run mutation testing on specified files.
 *
 * @param {string} projectRoot
 * @param {string[]} targetFiles - files to mutate (relative paths)
 * @param {string} testCommand
 * @param {Object} options - { mutations: 10, timeout: 30000 }
 * @returns {{ mutationsTotal: number, mutationsCaught: number, mutationScore: number, survived: Array<{file, line, mutation, description}> }}
 */
function runMutationTests(projectRoot, targetFiles, testCommand, options = {}) {
  const maxMutations = options.mutations || 10;
  const timeout = options.timeout || 30000;
  const result = {
    mutationsTotal: 0,
    mutationsCaught: 0,
    mutationScore: 0,
    survived: [],
  };

  // Collect candidate mutations from target files
  const candidates = [];
  for (const relFile of targetFiles) {
    const absPath = path.join(projectRoot, relFile);
    let content;
    try {
      content = fs.readFileSync(absPath, 'utf8');
    } catch (_e) {
      continue;
    }

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const op of MUTATION_OPERATORS) {
        if (op.pattern.test(lines[i]) && !/^\s*(?:\/\/|\/\*|\*|#|--)/.test(lines[i])) {
          candidates.push({ file: relFile, absPath, lineIndex: i, operator: op });
          // Reset regex lastIndex since they are global
          op.pattern.lastIndex = 0;
        }
        op.pattern.lastIndex = 0;
      }
    }
  }

  // Randomly select mutations up to maxMutations
  const selected = [];
  const shuffled = candidates.sort(() => Math.random() - 0.5);
  for (let i = 0; i < Math.min(maxMutations, shuffled.length); i++) {
    selected.push(shuffled[i]);
  }

  // Apply each mutation, run tests, check if caught
  for (const candidate of selected) {
    const originalContent = fs.readFileSync(candidate.absPath, 'utf8');

    const { mutated, applied, description } = applyMutation(
      originalContent,
      candidate.lineIndex,
      candidate.operator
    );

    if (!applied) continue;

    result.mutationsTotal++;

    // Write mutated file
    try {
      fs.writeFileSync(candidate.absPath, mutated, 'utf8');
    } catch (_e) {
      // Cannot write -- skip
      continue;
    }

    // Run tests
    let testsPassed = false;
    try {
      execSync(testCommand, {
        cwd: projectRoot,
        stdio: 'pipe',
        timeout,
      });
      testsPassed = true;
    } catch (_e) {
      // Tests failed -- mutation was caught
      testsPassed = false;
    }

    // Restore original
    fs.writeFileSync(candidate.absPath, originalContent, 'utf8');

    if (testsPassed) {
      // Mutation survived -- tests didn't catch it
      result.survived.push({
        file: candidate.file,
        line: candidate.lineIndex + 1,
        mutation: candidate.operator.name,
        description,
      });
    } else {
      result.mutationsCaught++;
    }
  }

  result.mutationScore = result.mutationsTotal > 0
    ? Math.round((result.mutationsCaught / result.mutationsTotal) * 100)
    : 0;

  return result;
}

// @cap-decision Test Diversity measures the breadth of test types — error paths, edge cases, boundary conditions.
// Projects that only test happy paths score low; adversarial testing is rewarded.

/** Patterns that indicate error-path testing. */
const ERROR_PATH_PATTERNS = [
  /\bthrow[s]?\b/i,
  /\breject[s]?\b/i,
  /\berror\b/i,
  /\bfail[s]?\b/i,
  /\binvalid\b/i,
  /\bmalformed\b/i,
  /\bcorrupt/i,
  /\btimeout\b/i,
  /\bexception\b/i,
  /\.toThrow\(/,
  /assert\.throws\(/,
  /assert\.rejects\(/,
];

/** Patterns that indicate edge-case / boundary testing. */
const EDGE_CASE_PATTERNS = [
  /\bnull\b/,
  /\bundefined\b/,
  /\bempty\b/i,
  /\bboundary\b/i,
  /\bedge[- ]?case/i,
  /\bzero\b/i,
  /\bnegative\b/i,
  /\boverflow\b/i,
  /\bmax\b/i,
  /\bmin\b/i,
  /\bhuge\b/i,
  /\blarge\b/i,
  /\bspecial char/i,
  /\bunicode\b/i,
  /\badversarial\b/i,
];

/**
 * Analyze test diversity — measures how well tests cover error paths and edge cases.
 * Returns a diversity score (0-100) based on the proportion of tests that exercise
 * non-happy-path scenarios.
 *
 * @param {string} projectRoot
 * @param {Object} [options]
 * @param {string[]} [options.extensions] - File extensions to scan
 * @returns {{ diversityScore: number, totalTests: number, errorPathTests: number, edgeCaseTests: number, happyPathOnlyTests: number, diversityRatio: number }}
 */
function analyzeTestDiversity(projectRoot, options = {}) {
  const testFiles = findTestFiles(projectRoot, options.extensions);
  let totalTests = 0;
  let errorPathTests = 0;
  let edgeCaseTests = 0;

  for (const filePath of testFiles) {
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (_e) {
      continue;
    }

    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const testMatch = lines[i].match(TEST_BLOCK_RE);
      if (!testMatch) continue;

      totalTests++;
      const testName = testMatch[1] || '';

      // Collect test body (until next test or describe block)
      let testBody = testName;
      for (let j = i + 1; j < lines.length; j++) {
        if (TEST_BLOCK_RE.test(lines[j]) || DESCRIBE_BLOCK_RE.test(lines[j])) break;
        testBody += ' ' + lines[j];
      }

      // Check if test exercises error paths
      const isErrorPath = ERROR_PATH_PATTERNS.some(p => p.test(testName)) ||
        ERROR_PATH_PATTERNS.some(p => p.test(testBody));

      // Check if test exercises edge cases
      const isEdgeCase = EDGE_CASE_PATTERNS.some(p => p.test(testName)) ||
        EDGE_CASE_PATTERNS.some(p => p.test(testBody));

      if (isErrorPath) errorPathTests++;
      if (isEdgeCase) edgeCaseTests++;
    }
  }

  const diverseTests = new Set(); // count unique diverse tests (a test can be both error + edge)
  // We approximate: diverse = max(errorPathTests, edgeCaseTests) + min(errorPathTests, edgeCaseTests) * 0.5
  // This avoids double-counting while rewarding tests that cover both
  const diverseCount = Math.min(totalTests, errorPathTests + edgeCaseTests);
  const diversityRatio = totalTests > 0 ? diverseCount / totalTests : 0;
  const diversityScore = Math.round(diversityRatio * 100);

  return {
    diversityScore,
    totalTests,
    errorPathTests,
    edgeCaseTests,
    happyPathOnlyTests: Math.max(0, totalTests - diverseCount),
    diversityRatio: Math.round(diversityRatio * 100) / 100,
  };
}

/**
 * Generate spot-check suggestions for human review.
 *
 * @param {string} projectRoot
 * @param {Object} options - { count: 3, criticalPaths: ['auth', 'payment', 'booking'] }
 * @returns {Array<{ file: string, testName: string, line: number, suggestion: string, productionFile: string, productionLine: number }>}
 */
// @cap-decision Critical Path Coverage measures whether the most important code paths have dedicated tests.
// Uses configurable path keywords to identify critical areas and checks for test file presence + assertion density.

/** Default critical path keywords — areas where bugs are most costly. */
const DEFAULT_CRITICAL_PATHS = ['auth', 'security', 'payment', 'session', 'migration', 'rls', 'permission', 'encrypt', 'token', 'credential'];

/**
 * Analyze critical path test coverage.
 * Scans source files for critical path keywords, then checks if corresponding test files exist
 * and have sufficient assertions.
 *
 * @param {string} projectRoot
 * @param {Object} [options]
 * @param {string[]} [options.criticalPaths] - Keywords identifying critical paths
 * @param {string[]} [options.extensions] - Test file extensions
 * @returns {{ score: number, criticalFiles: number, testedFiles: number, wellTestedFiles: number, untestedPaths: string[], coverage: number }}
 */
function analyzeCriticalPathCoverage(projectRoot, options = {}) {
  const criticalKeywords = options.criticalPaths || DEFAULT_CRITICAL_PATHS;

  // Step 1: Find source files matching critical path keywords
  const libDir = path.join(projectRoot, 'cap', 'bin', 'lib');
  let sourceFiles = [];
  try {
    if (fs.existsSync(libDir)) {
      sourceFiles = fs.readdirSync(libDir)
        .filter(f => f.endsWith('.cjs') && !f.includes('.test.'))
        .map(f => ({ name: f, path: path.join('cap', 'bin', 'lib', f) }));
    }
  } catch (_e) { /* ignore */ }

  // Also scan other common source directories
  const otherDirs = ['bin', 'hooks', 'scripts'];
  for (const dir of otherDirs) {
    const dirPath = path.join(projectRoot, dir);
    try {
      if (fs.existsSync(dirPath)) {
        const files = fs.readdirSync(dirPath)
          .filter(f => f.endsWith('.js') || f.endsWith('.cjs') || f.endsWith('.mjs'))
          .map(f => ({ name: f, path: path.join(dir, f) }));
        sourceFiles.push(...files);
      }
    } catch (_e) { /* ignore */ }
  }

  // Identify critical source files — files whose name or content contains critical keywords
  const criticalFiles = [];
  for (const sf of sourceFiles) {
    const lowerName = sf.name.toLowerCase();
    const isCriticalByName = criticalKeywords.some(kw => lowerName.includes(kw));

    if (isCriticalByName) {
      criticalFiles.push(sf);
      continue;
    }

    // Check file content for critical keywords (first 50 lines)
    try {
      const content = fs.readFileSync(path.join(projectRoot, sf.path), 'utf8');
      const head = content.split('\n').slice(0, 50).join(' ').toLowerCase();
      const isCriticalByContent = criticalKeywords.some(kw => head.includes(kw));
      if (isCriticalByContent) {
        criticalFiles.push(sf);
      }
    } catch (_e) { /* ignore */ }
  }

  if (criticalFiles.length === 0) {
    return { score: 100, criticalFiles: 0, testedFiles: 0, wellTestedFiles: 0, untestedPaths: [], coverage: 1.0 };
  }

  // Step 2: Check which critical files have corresponding test files with assertions
  const testFiles = findTestFiles(projectRoot, options.extensions);
  const testFileNames = testFiles.map(f => path.basename(f).toLowerCase());
  const testFileContents = {};
  for (const tf of testFiles) {
    try {
      testFileContents[path.basename(tf).toLowerCase()] = fs.readFileSync(tf, 'utf8');
    } catch (_e) { /* ignore */ }
  }

  let testedFiles = 0;
  let wellTestedFiles = 0;
  const untestedPaths = [];

  for (const cf of criticalFiles) {
    // Derive expected test file name: cap-session.cjs → cap-session.test.cjs
    const baseName = cf.name.replace(/\.(cjs|js|mjs)$/, '');
    const possibleTestNames = [
      `${baseName}.test.cjs`,
      `${baseName}.test.js`,
      `${baseName}.test.ts`,
      `${baseName}.test.mjs`,
    ];

    const matchedTest = possibleTestNames.find(tn => testFileNames.includes(tn));
    if (!matchedTest) {
      untestedPaths.push(cf.path);
      continue;
    }

    testedFiles++;

    // Check assertion density in the test file
    const content = testFileContents[matchedTest] || '';
    let assertionCount = 0;
    let testCount = 0;
    for (const line of content.split('\n')) {
      if (TEST_BLOCK_RE.test(line)) testCount++;
      for (const p of ASSERTION_PATTERNS) {
        if (p.test(line)) { assertionCount++; break; }
      }
    }

    // "Well tested" = at least 5 tests and 2+ assertions per test
    if (testCount >= 5 && (testCount > 0 ? assertionCount / testCount : 0) >= 2) {
      wellTestedFiles++;
    }
  }

  const coverage = criticalFiles.length > 0 ? testedFiles / criticalFiles.length : 0;
  const wellTestedRatio = criticalFiles.length > 0 ? wellTestedFiles / criticalFiles.length : 0;
  // Score: 60% from having tests, 40% from having GOOD tests
  const score = Math.round((coverage * 0.6 + wellTestedRatio * 0.4) * 100);

  return {
    score,
    criticalFiles: criticalFiles.length,
    testedFiles,
    wellTestedFiles,
    untestedPaths,
    coverage: Math.round(coverage * 100) / 100,
  };
}

function generateSpotChecks(projectRoot, options = {}) {
  const count = options.count || 3;
  const criticalPaths = options.criticalPaths || ['auth', 'payment', 'booking', 'rls', 'security'];
  const testFiles = findTestFiles(projectRoot);
  const checks = [];

  for (const filePath of testFiles) {
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (_e) {
      continue;
    }

    const relativePath = path.relative(projectRoot, filePath);
    const lines = content.split('\n');
    const lowerPath = relativePath.toLowerCase();

    // Score based on critical path presence
    const isCritical = criticalPaths.some(cp => lowerPath.includes(cp));

    for (let i = 0; i < lines.length; i++) {
      const testMatch = lines[i].match(TEST_BLOCK_RE);
      if (!testMatch) continue;

      // Count assertions in this test (rough: until next test or describe)
      let assertCount = 0;
      for (let j = i + 1; j < lines.length; j++) {
        if (TEST_BLOCK_RE.test(lines[j]) || DESCRIBE_BLOCK_RE.test(lines[j])) break;
        for (const p of ASSERTION_PATTERNS) {
          if (p.test(lines[j])) { assertCount++; break; }
        }
      }

      // Try to find associated production file
      let productionFile = '';
      let productionLine = 0;
      // Look for require/import statements to find the production module
      for (let j = 0; j < Math.min(20, lines.length); j++) {
        const reqMatch = lines[j].match(/require\(['"]([^'"]+)['"]\)/);
        const impMatch = lines[j].match(/from\s+['"]([^'"]+)['"]/);
        const mod = reqMatch ? reqMatch[1] : (impMatch ? impMatch[1] : null);
        if (mod && !mod.includes('node:') && !mod.includes('vitest') && !mod.includes('assert')) {
          productionFile = mod;
          productionLine = 1;
          break;
        }
      }

      const score = (isCritical ? 10 : 0) + Math.max(0, 5 - assertCount);
      checks.push({
        file: relativePath,
        testName: testMatch[1],
        line: i + 1,
        suggestion: isCritical
          ? `Critical path test -- verify this catches real failures`
          : `Low assertion count (${assertCount}) -- verify test is meaningful`,
        productionFile,
        productionLine,
        _score: score,
      });
    }
  }

  // Sort by score descending and take top N
  checks.sort((a, b) => b._score - a._score);
  return checks.slice(0, count).map(({ _score, ...rest }) => rest);
}

/**
 * Detect test quality anti-patterns.
 *
 * @param {string} projectRoot
 * @param {Object} options
 * @returns {{ flags: Array<{file, line, pattern, severity, description}> }}
 */
function detectAntiPatterns(projectRoot, options = {}) {
  const extensions = options.extensions || DEFAULT_TEST_EXTENSIONS;
  const testFiles = findTestFiles(projectRoot, extensions);
  const flags = [];

  for (const filePath of testFiles) {
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (_e) {
      continue;
    }

    const relativePath = path.relative(projectRoot, filePath);
    const lines = content.split('\n');
    let insideTest = false;
    let testHasStrongAssertion = false;
    let testStartLine = 0;
    let testName = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Track test block boundaries
      const testMatch = line.match(TEST_BLOCK_RE);
      if (testMatch) {
        // Check previous test for weak-only assertions
        if (insideTest && !testHasStrongAssertion && testName) {
          flags.push({
            file: relativePath,
            line: testStartLine,
            pattern: 'weak-assertions-only',
            severity: 'warning',
            description: `Test "${testName}" may only have weak assertions`,
          });
        }
        insideTest = true;
        testHasStrongAssertion = false;
        testStartLine = i + 1;
        testName = testMatch[1];
      }

      // Check for weak assertion patterns
      for (const weak of WEAK_ASSERTION_PATTERNS) {
        if (weak.pattern.test(line)) {
          flags.push({
            file: relativePath,
            line: i + 1,
            pattern: weak.name,
            severity: weak.severity,
            description: weak.description,
          });
        }
      }

      // Check for strong assertion (anything in ASSERTION_PATTERNS that is not in weak list)
      if (insideTest) {
        const isAssertion = ASSERTION_PATTERNS.some(p => p.test(line));
        const isWeak = WEAK_ASSERTION_PATTERNS.some(w => w.pattern.test(line));
        if (isAssertion && !isWeak) {
          testHasStrongAssertion = true;
        }
      }

      // Check for empty test body: it('name', () => {})
      if (/(?:it|test)\s*\([^)]+,\s*(?:\(\)\s*=>|function\s*\(\))\s*\{\s*\}\s*\)/.test(line)) {
        flags.push({
          file: relativePath,
          line: i + 1,
          pattern: 'empty-test-body',
          severity: 'error',
          description: 'Empty test body -- test will always pass',
        });
      }
    }

    // Check final test in file
    if (insideTest && !testHasStrongAssertion && testName) {
      flags.push({
        file: relativePath,
        line: testStartLine,
        pattern: 'weak-assertions-only',
        severity: 'warning',
        description: `Test "${testName}" may only have weak assertions`,
      });
    }
  }

  return { flags };
}

/**
 * Compute trust score from audit components.
 *
 * @param {Object} assertions - from analyzeAssertions
 * @param {Object} coverage - from analyzeCoverage (may be null)
 * @param {Object} mutations - from runMutationTests (may be null)
 * @param {Object} antiPatterns - from detectAntiPatterns
 * @returns {number} - 0 to 100
 */
function computeTrustScore(assertions, coverage, mutations, antiPatterns, diversity, criticalPath) {
  let score = 0;

  // Assertion density (max 25 points)
  // 2+ assertions per test = full marks
  if (assertions.assertionDensity >= 2) score += 25;
  else if (assertions.assertionDensity >= 1) score += 15;
  else if (assertions.assertionDensity >= 0.5) score += 8;

  // Empty tests penalty (max -10)
  if (assertions.totalTests > 0) {
    const emptyRatio = assertions.emptyTests.length / assertions.totalTests;
    score -= Math.round(emptyRatio * 10);
  }

  // Coverage (max 25 points)
  if (coverage && !coverage.error) {
    score += Math.round(coverage.lines * 0.13); // Up to 13 points
    score += Math.round(coverage.branches * 0.08); // Up to 8 points
    score += Math.round(coverage.functions * 0.04); // Up to 4 points
  } else {
    score += 13; // Neutral if no coverage data
  }

  // Mutation score (max 25 points)
  if (mutations && mutations.mutationsTotal > 0) {
    score += Math.round(mutations.mutationScore * 0.25);
  } else {
    score += 13; // Neutral if no mutation data
  }

  // Test diversity (max 15 points)
  // @cap-decision Diversity rewards error-path and edge-case testing — adversarial mindset is scored.
  if (diversity && diversity.totalTests > 0) {
    // 30%+ diverse tests = full marks, linear scale below that
    const ratio = diversity.diversityRatio;
    if (ratio >= 0.30) score += 15;
    else if (ratio >= 0.20) score += 12;
    else if (ratio >= 0.10) score += 8;
    else if (ratio > 0) score += 4;
  } else {
    score += 8; // Neutral if no diversity data
  }

  // Critical path coverage (max 10 points)
  // @cap-decision Critical path coverage rewards testing the most important code paths (auth, security, payment).
  if (criticalPath && criticalPath.criticalFiles > 0) {
    score += Math.round(criticalPath.score * 0.10);
  } else {
    score += 5; // Neutral if no critical paths detected
  }

  // Anti-pattern penalty (max -15)
  if (antiPatterns && antiPatterns.flags) {
    const errorCount = antiPatterns.flags.filter(f => f.severity === 'error').length;
    const warningCount = antiPatterns.flags.filter(f => f.severity === 'warning').length;
    score -= Math.min(15, errorCount * 5 + warningCount * 2);
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Generate the full test audit report as structured data.
 *
 * @param {string} projectRoot
 * @param {Object} options
 * @returns {Object} TestAuditReport
 */
function generateAuditReport(projectRoot, options = {}) {
  const testCommand = options.testCommand || 'node --test tests/';
  const criticalPaths = options.criticalPaths || ['auth', 'payment', 'booking', 'rls', 'security'];
  const runCoverage = options.coverage !== false;
  const runMutations = options.mutations !== false;
  const mutationCount = options.mutationCount || 10;
  let targetFiles = options.targetFiles || [];

  // @cap-decision Auto-discover mutation target files when none explicitly provided.
  // Scans cap/bin/lib/*.cjs as default targets for mutation testing.
  if (targetFiles.length === 0 && runMutations) {
    const libDir = path.join(projectRoot, 'cap', 'bin', 'lib');
    if (fs.existsSync(libDir)) {
      try {
        targetFiles = fs.readdirSync(libDir)
          .filter(f => f.endsWith('.cjs') && !f.includes('.test.'))
          .map(f => path.join('cap', 'bin', 'lib', f));
      } catch (_e) { /* ignore */ }
    }
  }

  // Step 1: Assertion analysis (always runs)
  const assertions = analyzeAssertions(projectRoot, {
    extensions: options.extensions,
  });

  // Step 2: Coverage (optional)
  let coverage = null;
  if (runCoverage) {
    coverage = analyzeCoverage(projectRoot, testCommand);
  }

  // Step 3: Mutation testing (optional, on target files)
  let mutations = null;
  if (runMutations && targetFiles.length > 0) {
    mutations = runMutationTests(projectRoot, targetFiles, testCommand, {
      mutations: mutationCount,
      timeout: options.timeout || 30000,
    });
  }

  // Step 4: Spot checks
  const spotChecks = generateSpotChecks(projectRoot, {
    count: options.spotCheckCount || 3,
    criticalPaths,
  });

  // Step 5: Anti-patterns
  const antiPatterns = detectAntiPatterns(projectRoot, {
    extensions: options.extensions,
  });

  // Step 6: Test diversity
  const diversity = analyzeTestDiversity(projectRoot, {
    extensions: options.extensions,
  });

  // Step 7: Critical path coverage
  const criticalPath = analyzeCriticalPathCoverage(projectRoot, {
    criticalPaths,
    extensions: options.extensions,
  });

  // Step 8: Trust score
  const trustScore = computeTrustScore(assertions, coverage, mutations, antiPatterns, diversity, criticalPath);

  return {
    timestamp: new Date().toISOString(),
    projectRoot,
    assertions,
    coverage,
    mutations,
    spotChecks,
    antiPatterns,
    diversity,
    criticalPath,
    trustScore,
  };
}

/**
 * Format an audit report as a readable Markdown string.
 *
 * @param {Object} report - from generateAuditReport
 * @param {string} projectName - display name for the project
 * @returns {string}
 */
function formatAuditReport(report, projectName = 'project') {
  const lines = [];
  lines.push(`Test Audit -- ${projectName}`);
  lines.push('='.repeat(lines[0].length));
  lines.push('');

  // Assertions
  lines.push('ASSERTIONS');
  lines.push(`  Total tests: ${report.assertions.totalTests}`);
  lines.push(`  Total assertions: ${report.assertions.totalAssertions}`);
  lines.push(`  Assertion density: ${report.assertions.assertionDensity} per test`);
  lines.push(`  Empty tests (0 assertions): ${report.assertions.emptyTests.length}`);
  if (report.assertions.emptyTests.length > 0) {
    for (const et of report.assertions.emptyTests) {
      lines.push(`    ${et.file}:${et.line} -- "${et.name}"`);
    }
  }
  lines.push('');

  // Coverage
  if (report.coverage) {
    lines.push('COVERAGE');
    if (report.coverage.error) {
      lines.push(`  Error: ${report.coverage.error}`);
    } else {
      lines.push(`  Lines: ${report.coverage.lines}%  Branches: ${report.coverage.branches}%  Functions: ${report.coverage.functions}%`);
      if (report.coverage.uncoveredFiles.length > 0) {
        lines.push('  Uncovered critical files:');
        for (const f of report.coverage.uncoveredFiles) {
          lines.push(`    ${f}`);
        }
      }
    }
    lines.push('');
  }

  // Mutations
  if (report.mutations) {
    lines.push('MUTATION SCORE');
    lines.push(`  Mutations: ${report.mutations.mutationsTotal} applied, ${report.mutations.mutationsCaught} caught (${report.mutations.mutationScore}%)`);
    if (report.mutations.survived.length > 0) {
      lines.push('  Survived mutations (tests didn\'t catch):');
      for (const s of report.mutations.survived) {
        lines.push(`    ${s.file}:${s.line} -- ${s.description}`);
      }
    }
    lines.push('');
  }

  // Spot checks
  if (report.spotChecks.length > 0) {
    lines.push('SPOT-CHECK GUIDE (for human review)');
    report.spotChecks.forEach((sc, idx) => {
      lines.push(`  ${idx + 1}. ${sc.file}:${sc.line} -- "${sc.testName}"`);
      if (sc.productionFile) {
        lines.push(`     Break: Delete a line in ${sc.productionFile}`);
        lines.push(`     Expected: This test should turn RED`);
      }
      lines.push(`     ${sc.suggestion}`);
      lines.push(`     [ ] Verified  [ ] Suspect`);
      lines.push('');
    });
  }

  // Anti-patterns
  if (report.antiPatterns.flags.length > 0) {
    lines.push('ANTI-PATTERNS');
    for (const flag of report.antiPatterns.flags) {
      lines.push(`  ${flag.severity.toUpperCase()} ${flag.file}:${flag.line} -- ${flag.description}`);
    }
    lines.push('');
  }

  // Critical path coverage
  if (report.criticalPath) {
    lines.push('CRITICAL PATH COVERAGE');
    lines.push(`  Score: ${report.criticalPath.score}%`);
    lines.push(`  Critical files: ${report.criticalPath.criticalFiles}`);
    lines.push(`  With tests: ${report.criticalPath.testedFiles} (${report.criticalPath.wellTestedFiles} well-tested)`);
    if (report.criticalPath.untestedPaths.length > 0) {
      lines.push(`  UNTESTED: ${report.criticalPath.untestedPaths.join(', ')}`);
    }
    lines.push('');
  }

  // Test diversity
  if (report.diversity) {
    lines.push('TEST DIVERSITY');
    lines.push(`  Score: ${report.diversity.diversityScore}%`);
    lines.push(`  Error-path tests: ${report.diversity.errorPathTests} / ${report.diversity.totalTests}`);
    lines.push(`  Edge-case tests: ${report.diversity.edgeCaseTests} / ${report.diversity.totalTests}`);
    lines.push(`  Happy-path only: ${report.diversity.happyPathOnlyTests} / ${report.diversity.totalTests}`);
    lines.push('');
  }

  lines.push(`TRUST SCORE: ${report.trustScore}/100`);

  // Improvement suggestions for low trust scores
  if (report.trustScore < 70) {
    lines.push('');
    const suggestions = generateImprovementSuggestions(report);
    lines.push('IMPROVEMENT SUGGESTIONS');
    lines.push(`  Current score: ${report.trustScore}/100 (target: 70+)`);
    lines.push('');
    for (const s of suggestions) {
      lines.push(`  ${s.priority}. ${s.title} (+${s.points} pts)`);
      lines.push(`     ${s.action}`);
      if (s.command) lines.push(`     Run: ${s.command}`);
      lines.push('');
    }
  }

  lines.push('');
  lines.push(`Generated: ${report.timestamp}`);

  return lines.join('\n');
}

/**
 * Generate prioritized improvement suggestions based on audit report.
 * Returns suggestions sorted by potential point gain (highest first).
 *
 * @param {Object} report - from generateAuditReport
 * @returns {Array<{priority: number, title: string, points: number, action: string, command?: string}>}
 */
function generateImprovementSuggestions(report) {
  const suggestions = [];

  // Assertion density
  if (report.assertions.assertionDensity < 2) {
    const currentPts = report.assertions.assertionDensity >= 1 ? 20 : report.assertions.assertionDensity >= 0.5 ? 10 : 0;
    const gain = 30 - currentPts;
    if (gain > 0) {
      suggestions.push({
        title: 'Increase assertion density',
        points: gain,
        action: report.assertions.assertionDensity < 1
          ? `Tests average ${report.assertions.assertionDensity.toFixed(1)} assertions each. Add specific value checks (assert.strictEqual, assert.deepStrictEqual) — aim for 2+ assertions per test.`
          : `Tests average ${report.assertions.assertionDensity.toFixed(1)} assertions each. Add edge case checks and boundary assertions to reach 2+ per test.`,
      });
    }
  }

  // Empty tests
  if (report.assertions.emptyTests.length > 0) {
    const emptyRatio = report.assertions.emptyTests.length / Math.max(1, report.assertions.totalTests);
    const penalty = Math.round(emptyRatio * 10);
    suggestions.push({
      title: `Fix ${report.assertions.emptyTests.length} empty test(s)`,
      points: penalty,
      action: `These tests have 0 assertions: ${report.assertions.emptyTests.slice(0, 3).map(t => t.file + ':' + t.line).join(', ')}${report.assertions.emptyTests.length > 3 ? '...' : ''}. Add at least one assert per test.`,
    });
  }

  // Coverage
  if (report.coverage && !report.coverage.error) {
    if (report.coverage.lines < 70) {
      const currentPts = Math.round(report.coverage.lines * 0.15) + Math.round(report.coverage.branches * 0.10) + Math.round(report.coverage.functions * 0.05);
      const targetPts = Math.round(70 * 0.15) + Math.round(50 * 0.10) + Math.round(60 * 0.05);
      const gain = Math.max(0, targetPts - currentPts);
      suggestions.push({
        title: 'Increase code coverage',
        points: gain,
        action: `Lines: ${report.coverage.lines}% (target: 70%+). Focus on uncovered critical files first.`,
        command: 'npm run test:coverage',
      });
    }
    if (report.coverage.branches < 50) {
      suggestions.push({
        title: 'Improve branch coverage',
        points: 5,
        action: `Branch coverage is ${report.coverage.branches}%. Add tests for if/else, switch, and ternary branches — especially error paths.`,
      });
    }
  }

  // Mutations
  if (report.mutations && report.mutations.mutationsTotal > 0 && report.mutations.mutationScore < 60) {
    const currentPts = Math.round(report.mutations.mutationScore * 0.25);
    const targetPts = Math.round(80 * 0.25);
    const gain = Math.max(0, targetPts - currentPts);
    if (report.mutations.survived.length > 0) {
      suggestions.push({
        title: 'Catch surviving mutations',
        points: gain,
        action: `${report.mutations.survived.length} mutation(s) survived — tests didn't detect code changes. Add assertions for: ${report.mutations.survived.slice(0, 2).map(s => s.file + ':' + s.line + ' (' + s.description + ')').join('; ')}.`,
        command: '/cap:test-audit --mutations 20',
      });
    }
  }

  // Critical path coverage
  if (report.criticalPath && report.criticalPath.score < 80) {
    const currentPts = Math.round(report.criticalPath.score * 0.10);
    const gain = Math.max(0, 10 - currentPts);
    if (gain > 0) {
      suggestions.push({
        title: 'Improve critical path test coverage',
        points: gain,
        action: `${report.criticalPath.untestedPaths.length} critical file(s) have no tests: ${report.criticalPath.untestedPaths.slice(0, 3).join(', ')}. Add dedicated test files for these security/auth/payment paths.`,
      });
    }
  }

  // Test diversity
  if (report.diversity && report.diversity.diversityRatio < 0.30) {
    const currentPts = report.diversity.diversityRatio >= 0.20 ? 12 : report.diversity.diversityRatio >= 0.10 ? 8 : report.diversity.diversityRatio > 0 ? 4 : 0;
    const gain = 15 - currentPts;
    if (gain > 0) {
      suggestions.push({
        title: 'Increase test diversity',
        points: gain,
        action: `Only ${report.diversity.diversityRatio * 100}% of tests cover error paths or edge cases (target: 30%+). Add tests for: null/undefined inputs, invalid data, timeouts, boundary values, error throwing.`,
      });
    }
  }

  // Anti-patterns
  if (report.antiPatterns && report.antiPatterns.flags.length > 0) {
    const errors = report.antiPatterns.flags.filter(f => f.severity === 'error');
    const warnings = report.antiPatterns.flags.filter(f => f.severity === 'warning');
    const penalty = Math.min(15, errors.length * 5 + warnings.length * 2);
    if (penalty > 0) {
      const topIssue = errors[0] || warnings[0];
      suggestions.push({
        title: `Fix ${errors.length + warnings.length} anti-pattern(s)`,
        points: penalty,
        action: `Top issue: ${topIssue.description} (${topIssue.file}:${topIssue.line}). Replace weak assertions with specific value checks.`,
      });
    }
  }

  // Sort by potential points gained (highest first)
  suggestions.sort((a, b) => b.points - a.points);

  // Add priority numbers
  return suggestions.map((s, i) => ({ ...s, priority: i + 1 }));
}

module.exports = {
  analyzeAssertions,
  analyzeCoverage,
  analyzeCoverageNative,
  analyzeCoverageC8,
  parseNativeCoverageOutput,
  supportsNativeCoverage,
  analyzeTestDiversity,
  analyzeCriticalPathCoverage,
  runMutationTests,
  generateSpotChecks,
  detectAntiPatterns,
  generateAuditReport,
  formatAuditReport,
  computeTrustScore,
  generateImprovementSuggestions,
  findTestFiles,
  applyMutation,
  ASSERTION_PATTERNS,
  WEAK_ASSERTION_PATTERNS,
  ERROR_PATH_PATTERNS,
  EDGE_CASE_PATTERNS,
  DEFAULT_CRITICAL_PATHS,
  MUTATION_OPERATORS,
  DEFAULT_TEST_EXTENSIONS,
};
