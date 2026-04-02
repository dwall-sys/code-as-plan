'use strict';

// @cap-feature(feature:F-013) Convention & Skeleton Generation — test framework auto-detection
/**
 * test-detector.cjs — Test framework auto-detection
 *
 * Reads a project's package.json to determine which test framework is in use.
 * Returns deterministic results with zero external dependencies.
 *
 * @cap-api detectTestFramework(projectRoot: string)
 *   Returns: { framework: string, testCommand: string, filePattern: string }
 *   Reads target project's package.json to detect test framework.
 *   Falls back to node:test when package.json is absent, invalid, or unrecognized.
 *   Detection priority: vitest > jest > mocha > ava > node:test (--test flag) > node:test (fallback)
 */

const fs = require('fs');
const path = require('path');

/**
 * Detect the test framework used by the project at projectRoot.
 *
 * @param {string} projectRoot - Absolute path to the target project root
 * @returns {{ framework: string, testCommand: string, filePattern: string }}
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
