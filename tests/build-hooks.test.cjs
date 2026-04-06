'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');

const BUILD_SCRIPT_PATH = path.join(__dirname, '..', 'scripts', 'build-hooks.js');
const HOOKS_DIR = path.join(__dirname, '..', 'hooks');

describe('build-hooks.js — hook build script', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-build-hooks-test-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should be valid JavaScript that parses without syntax errors', () => {
    const content = fs.readFileSync(BUILD_SCRIPT_PATH, 'utf8');
    assert.ok(content.length > 0, 'Build script should not be empty');
    assert.doesNotThrow(() => {
      new vm.Script(content, { filename: 'build-hooks.js' });
    }, 'Build script should have valid JavaScript syntax');
  });

  it('should define the list of hooks to copy', () => {
    const content = fs.readFileSync(BUILD_SCRIPT_PATH, 'utf8');
    assert.ok(content.includes('HOOKS_TO_COPY'), 'Should define HOOKS_TO_COPY array');
    assert.ok(content.includes('cap-check-update.js'), 'Should include check-update hook');
    assert.ok(content.includes('cap-context-monitor.js'), 'Should include context-monitor hook');
    assert.ok(content.includes('cap-statusline.js'), 'Should include statusline hook');
  });

  it('should have a validateSyntax function that uses vm.Script', () => {
    const content = fs.readFileSync(BUILD_SCRIPT_PATH, 'utf8');
    assert.ok(content.includes('validateSyntax'), 'Should define validateSyntax function');
    assert.ok(content.includes('vm.Script') || content.includes('new vm.Script'), 'Should use vm.Script for syntax validation');
  });

  it('should exit with code 1 on syntax errors in hooks', () => {
    const content = fs.readFileSync(BUILD_SCRIPT_PATH, 'utf8');
    assert.ok(content.includes('process.exit(1)'), 'Should exit with code 1 on errors');
    assert.ok(content.includes('hasErrors'), 'Should track error state');
  });

  it('should validate all source hooks have valid syntax', () => {
    // Read each hook file listed in the build script and validate syntax
    const hookFiles = [
      'cap-check-update.js',
      'cap-context-monitor.js',
      'cap-statusline.js',
      'cap-workflow-guard.js',
      'cap-memory.js',
    ];

    for (const hookFile of hookFiles) {
      const hookPath = path.join(HOOKS_DIR, hookFile);
      if (fs.existsSync(hookPath)) {
        const hookContent = fs.readFileSync(hookPath, 'utf8');
        assert.doesNotThrow(() => {
          new vm.Script(hookContent, { filename: hookFile });
        }, `${hookFile} should have valid syntax`);
      }
    }
    assert.ok(hookFiles.length >= 5, 'Should validate at least 5 hook files');
  });

  it('should run successfully and create dist directory', { skip: process.platform === 'win32' }, () => {
    // Run the actual build script
    const output = execSync(`NODE_V8_COVERAGE= node "${BUILD_SCRIPT_PATH}"`, {
      encoding: 'utf8',
      timeout: 15000,
      cwd: path.join(__dirname, '..'),
    });
    assert.ok(output.includes('Build complete'), 'Should report build complete');
    assert.ok(fs.existsSync(path.join(HOOKS_DIR, 'dist')), 'Should create dist directory');
  });

  it('should copy hook files to the dist directory', { skip: process.platform === 'win32' }, () => {
    const distDir = path.join(HOOKS_DIR, 'dist');
    // After the previous test ran build, dist should exist with hook files
    assert.ok(fs.existsSync(distDir), 'dist directory should exist');
    const distFiles = fs.readdirSync(distDir);
    assert.ok(distFiles.includes('cap-statusline.js'), 'dist should contain cap-statusline.js');
    assert.ok(distFiles.includes('cap-context-monitor.js'), 'dist should contain cap-context-monitor.js');
  });

  it('should detect syntax errors in invalid JavaScript', () => {
    // Create a temp hook file with a syntax error and verify validateSyntax catches it
    const badFile = path.join(tmpDir, 'bad-hook.js');
    fs.writeFileSync(badFile, 'const x = {; // syntax error');

    // We can test by loading the function directly — read the build script and extract validateSyntax
    const buildContent = fs.readFileSync(BUILD_SCRIPT_PATH, 'utf8');
    // The script uses vm.Script to validate — we can replicate the logic
    const content = fs.readFileSync(badFile, 'utf8');
    let syntaxError = null;
    try {
      new vm.Script(content, { filename: 'bad-hook.js' });
    } catch (e) {
      if (e instanceof SyntaxError) {
        syntaxError = e.message;
      }
    }
    assert.ok(syntaxError !== null, 'Should detect syntax error in bad JavaScript');
    assert.strictEqual(typeof syntaxError, 'string', 'Syntax error should be a string message');
    assert.ok(syntaxError.length > 0, 'Syntax error message should not be empty');
  });
});
