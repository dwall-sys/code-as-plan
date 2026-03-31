'use strict';

/**
 * Tests for test-detector.cjs
 *
 * Tests detectTestFramework() for all 5 supported frameworks plus fallback cases.
 *
 * Requirements: TEST-03
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { detectTestFramework } = require('../cap/bin/lib/test-detector.cjs');

// ─── helpers ──────────────────────────────────────────────────────────────────

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'test-detector-'));
}

function writePkg(tmpDir, pkg) {
  fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg, null, 2), 'utf-8');
}

function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// ─── detectTestFramework ─────────────────────────────────────────────────────

describe('detectTestFramework', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  // Test 1: No package.json → fallback
  test('returns node:test when package.json does not exist', () => {
    const result = detectTestFramework('/nonexistent/path/__test_sentinel__');
    assert.strictEqual(result.framework, 'node:test');
    assert.strictEqual(result.testCommand, 'node --test');
    assert.strictEqual(result.filePattern, '**/*.test.cjs');
  });

  // Test 2: Invalid JSON → fallback
  test('returns node:test when package.json has invalid JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{ invalid json }', 'utf-8');
    const result = detectTestFramework(tmpDir);
    assert.strictEqual(result.framework, 'node:test');
    assert.strictEqual(result.testCommand, 'node --test');
    assert.strictEqual(result.filePattern, '**/*.test.cjs');
  });

  // Test 3: vitest in devDependencies
  test('detects vitest from devDependencies', () => {
    writePkg(tmpDir, { devDependencies: { vitest: '^1.0.0' } });
    const result = detectTestFramework(tmpDir);
    assert.strictEqual(result.framework, 'vitest');
    assert.strictEqual(result.testCommand, 'npx vitest run');
    assert.strictEqual(result.filePattern, '**/*.test.{ts,js}');
  });

  // Test 4: vitest in scripts.test
  test('detects vitest from scripts.test', () => {
    writePkg(tmpDir, { scripts: { test: 'vitest run' } });
    const result = detectTestFramework(tmpDir);
    assert.strictEqual(result.framework, 'vitest');
    assert.strictEqual(result.testCommand, 'npx vitest run');
    assert.strictEqual(result.filePattern, '**/*.test.{ts,js}');
  });

  // Test 5: jest in devDependencies
  test('detects jest from devDependencies', () => {
    writePkg(tmpDir, { devDependencies: { jest: '^29.0.0' } });
    const result = detectTestFramework(tmpDir);
    assert.strictEqual(result.framework, 'jest');
    assert.strictEqual(result.testCommand, 'npx jest');
    assert.strictEqual(result.filePattern, '**/*.test.{ts,js}');
  });

  // Test 6: jest in scripts.test
  test('detects jest from scripts.test', () => {
    writePkg(tmpDir, { scripts: { test: 'jest --coverage' } });
    const result = detectTestFramework(tmpDir);
    assert.strictEqual(result.framework, 'jest');
    assert.strictEqual(result.testCommand, 'npx jest');
    assert.strictEqual(result.filePattern, '**/*.test.{ts,js}');
  });

  // Test 7: mocha in devDependencies
  test('detects mocha from devDependencies', () => {
    writePkg(tmpDir, { devDependencies: { mocha: '^10.0.0' } });
    const result = detectTestFramework(tmpDir);
    assert.strictEqual(result.framework, 'mocha');
    assert.strictEqual(result.testCommand, 'npx mocha');
    assert.strictEqual(result.filePattern, '**/*.test.{mjs,cjs,js}');
  });

  // Test 8: ava in devDependencies
  test('detects ava from devDependencies', () => {
    writePkg(tmpDir, { devDependencies: { ava: '^6.0.0' } });
    const result = detectTestFramework(tmpDir);
    assert.strictEqual(result.framework, 'ava');
    assert.strictEqual(result.testCommand, 'npx ava');
    assert.strictEqual(result.filePattern, '**/*.test.{mjs,js}');
  });

  // Test 9: node --test in scripts.test
  test('detects node:test from scripts.test containing --test flag', () => {
    writePkg(tmpDir, { scripts: { test: 'node --test tests/*.test.cjs' } });
    const result = detectTestFramework(tmpDir);
    assert.strictEqual(result.framework, 'node:test');
    assert.strictEqual(result.testCommand, 'node --test');
    assert.strictEqual(result.filePattern, '**/*.test.cjs');
  });

  // Test 10: package.json exists but no recognized framework
  test('falls back to node:test when package.json has no recognized test framework', () => {
    writePkg(tmpDir, { name: 'my-package', version: '1.0.0', dependencies: { express: '^4.0.0' } });
    const result = detectTestFramework(tmpDir);
    assert.strictEqual(result.framework, 'node:test');
    assert.strictEqual(result.testCommand, 'node --test');
    assert.strictEqual(result.filePattern, '**/*.test.cjs');
  });

  // Test 11: Priority — vitest wins over jest when both present
  test('vitest takes priority over jest when both are in devDependencies', () => {
    writePkg(tmpDir, { devDependencies: { vitest: '^1.0.0', jest: '^29.0.0' } });
    const result = detectTestFramework(tmpDir);
    assert.strictEqual(result.framework, 'vitest');
  });
});
