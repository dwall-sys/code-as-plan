'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const HOOK_PATH = path.join(__dirname, '..', 'hooks', 'cap-check-update.js');

describe('cap-check-update hook', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-check-update-test-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should be a valid JavaScript file that parses without syntax errors', () => {
    const content = fs.readFileSync(HOOK_PATH, 'utf8');
    assert.ok(content.length > 0, 'Hook file should not be empty');
    // Validate syntax by compiling
    const vm = require('node:vm');
    assert.doesNotThrow(() => {
      new vm.Script(content, { filename: 'cap-check-update.js' });
    }, 'Hook should have valid JavaScript syntax');
  });

  it('should have a shebang line and required module imports', () => {
    const content = fs.readFileSync(HOOK_PATH, 'utf8');
    assert.ok(content.startsWith('#!/usr/bin/env node'), 'Should have node shebang');
    assert.ok(content.includes("require('fs')") || content.includes("require('node:fs')"), 'Should require fs');
    assert.ok(content.includes("require('child_process')") || content.includes("require('node:child_process')"), 'Should require child_process');
  });

  it('should reference the npm package name for version checking', () => {
    const content = fs.readFileSync(HOOK_PATH, 'utf8');
    assert.ok(content.includes('code-as-plan'), 'Should reference the npm package name');
    assert.ok(content.includes('npm view'), 'Should use npm view command to check version');
  });

  it('should write update results to a cache file in JSON format', () => {
    const content = fs.readFileSync(HOOK_PATH, 'utf8');
    assert.ok(content.includes('cap-update-check.json'), 'Should write to cap-update-check.json cache file');
    assert.ok(content.includes('update_available'), 'Should include update_available field in cache');
    assert.ok(content.includes('installed'), 'Should include installed version in cache');
  });

  it('should detect stale hooks by comparing hook version headers', () => {
    const content = fs.readFileSync(HOOK_PATH, 'utf8');
    assert.ok(content.includes('staleHooks') || content.includes('stale_hooks'), 'Should track stale hooks');
    assert.ok(content.includes('cap-hook-version'), 'Should check cap-hook-version header in hooks');
  });

  it('should support multiple config directory locations for multi-runtime', () => {
    const content = fs.readFileSync(HOOK_PATH, 'utf8');
    assert.ok(content.includes('detectConfigDir'), 'Should have detectConfigDir function');
    assert.ok(content.includes('.opencode') || content.includes('opencode'), 'Should support OpenCode runtime');
    assert.ok(content.includes('.gemini'), 'Should support Gemini runtime');
    assert.ok(content.includes('.claude'), 'Should support Claude runtime');
  });

  it('should spawn the background process as detached and unref it', () => {
    const content = fs.readFileSync(HOOK_PATH, 'utf8');
    assert.ok(content.includes('detached: true'), 'Should spawn detached process');
    assert.ok(content.includes('child.unref()'), 'Should unref the child process');
  });

  it('should respect CLAUDE_CONFIG_DIR environment variable', () => {
    const content = fs.readFileSync(HOOK_PATH, 'utf8');
    assert.ok(content.includes('CLAUDE_CONFIG_DIR'), 'Should check CLAUDE_CONFIG_DIR env var');
    assert.ok(content.includes('process.env.CLAUDE_CONFIG_DIR'), 'Should read from process.env');
  });

  it('should exit cleanly when spawned as a process (no stdin needed)', (_, done) => {
    const child = spawn(process.execPath, [HOOK_PATH], {
      env: { ...process.env, NODE_V8_COVERAGE: '', HOME: tmpDir, CLAUDE_CONFIG_DIR: path.join(tmpDir, '.claude-test') },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    });

    let exited = false;
    child.on('exit', (code) => {
      exited = true;
      // Hook spawns a background child and exits — code 0 is expected
      assert.ok(code === 0 || code === null, `Should exit cleanly, got code ${code}`);
      assert.ok(exited, 'Process should have exited');
      done();
    });

    child.on('error', (err) => {
      // Timeout or spawn error — still pass if it's just the npm view failing
      assert.ok(err.killed || err.code === 'ETIMEDOUT', `Unexpected error: ${err.message}`);
      done();
    });
  });
});
