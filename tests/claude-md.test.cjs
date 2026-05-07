/**
 * CLAUDE.md generation and new-project workflow tests
 */

// @cap-decision(CI/issue-42 Path-2 PR-2.8+2.9) Migrated runGsdTools spawn
// callsites to direct in-process calls. Pattern follows tests/commands.test.cjs
// runCmd helper (PR #55).

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createTempProject, cleanup } = require('./helpers.cjs');
const { cmdGenerateClaudeMd } = require('../cap/bin/lib/profile-output.cjs');

/**
 * In-process equivalent of runGsdTools that captures stdout, stderr, and
 * process.exit(). Returns the same {success, output, error} shape so the
 * existing test bodies need no further changes beyond swapping the call.
 */
function runCmd(fn) {
  const origWriteSync = fs.writeSync;
  const origExit = process.exit;
  let stdout = '';
  let stderr = '';
  let exited = false;
  let exitCode = 0;

  fs.writeSync = (fd, data, ...rest) => {
    const str = String(data);
    if (fd === 1) { stdout += str; return Buffer.byteLength(str); }
    if (fd === 2) { stderr += str; return Buffer.byteLength(str); }
    return origWriteSync.call(fs, fd, data, ...rest);
  };
  process.exit = (code) => {
    exited = true;
    exitCode = code || 0;
    throw new Error('__CMD_EXIT__');
  };

  let thrown = null;
  try {
    fn();
  } catch (e) {
    if (e && e.message !== '__CMD_EXIT__') thrown = e;
  } finally {
    fs.writeSync = origWriteSync;
    process.exit = origExit;
  }

  if (thrown) {
    return { success: false, output: stdout.trim(), error: (stderr.trim() || thrown.message) };
  }
  if (exited && exitCode !== 0) {
    return { success: false, output: stdout.trim(), error: stderr.trim() };
  }
  return { success: true, output: stdout.trim(), error: null };
}

describe('generate-claude-md', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('creates CLAUDE.md with workflow enforcement section', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'PROJECT.md'),
      '# Test Project\n\n## What This Is\n\nA small test project.\n'
    );

    const result = runCmd(() => cmdGenerateClaudeMd(tmpDir, { output: null, auto: false, force: false }, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.action, 'created');
    assert.strictEqual(output.sections_total, 5);
    assert.ok(output.sections_generated.includes('workflow'));

    const claudePath = path.join(tmpDir, 'CLAUDE.md');
    const content = fs.readFileSync(claudePath, 'utf-8');
    assert.ok(content.includes('## GSD Workflow Enforcement'));
    assert.ok(content.includes('/gsd:quick'));
    assert.ok(content.includes('/gsd:debug'));
    assert.ok(content.includes('/gsd:execute-phase'));
    assert.ok(content.includes('Do not make direct repo edits outside a GSD workflow'));
  });

  test('adds workflow enforcement section when updating an existing CLAUDE.md', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'PROJECT.md'),
      '# Test Project\n\n## What This Is\n\nA small test project.\n'
    );
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '## Local Notes\n\nKeep this intro.\n');

    const result = runCmd(() => cmdGenerateClaudeMd(tmpDir, { output: null, auto: false, force: false }, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.action, 'updated');

    const content = fs.readFileSync(path.join(tmpDir, 'CLAUDE.md'), 'utf-8');
    assert.ok(content.includes('## Local Notes'));
    assert.ok(content.includes('## GSD Workflow Enforcement'));
  });
});

describe('new-project workflow includes CLAUDE.md generation', () => {
  const workflowPath = path.join(__dirname, '..', 'cap', 'workflows', 'new-project.md');
  const commandsPath = path.join(__dirname, '..', 'docs', 'COMMANDS.md');

  test('new-project workflow generates CLAUDE.md before final commit', () => {
    const content = fs.readFileSync(workflowPath, 'utf-8');
    assert.ok(content.includes('generate-claude-md'));
    assert.ok(content.includes('--files .planning/ROADMAP.md .planning/STATE.md .planning/REQUIREMENTS.md CLAUDE.md'));
  });

  test('new-project artifacts mention CLAUDE.md', () => {
    const workflowContent = fs.readFileSync(workflowPath, 'utf-8');
    const commandsContent = fs.readFileSync(commandsPath, 'utf-8');

    assert.ok(workflowContent.includes('| Project guide  | `CLAUDE.md`'));
    assert.ok(workflowContent.includes('- `CLAUDE.md`'));
    assert.ok(commandsContent.includes('`CLAUDE.md`'));
  });
});
