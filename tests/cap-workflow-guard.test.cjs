'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const HOOK_PATH = path.join(__dirname, '..', 'hooks', 'cap-workflow-guard.js');

function runHook(inputObj, env = {}) {
  const input = (inputObj != null && inputObj.constructor === String) ? inputObj : JSON.stringify(inputObj);
  try {
    const result = execSync(
      `echo '${input.replace(/'/g, "'\\''")}' | NODE_V8_COVERAGE= node "${HOOK_PATH}"`,
      {
        encoding: 'utf8',
        timeout: 10000,
        env: { ...process.env, NODE_V8_COVERAGE: '', ...env },
        shell: true,
      }
    );
    return result;
  } catch (e) {
    return e.stdout || '';
  }
}

describe('cap-workflow-guard hook', () => {
  let tmpDir;
  let configDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-wf-guard-test-'));
    // Create a .planning/config.json with workflow_guard enabled
    configDir = path.join(tmpDir, '.planning');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, 'config.json'),
      JSON.stringify({ hooks: { workflow_guard: true } })
    );
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should exit silently on empty input', () => {
    const output = runHook('');
    assert.strictEqual(output, '', 'Should produce no output on empty input');
    assert.strictEqual(typeof output, 'string', 'Output should be a string');
  });

  it('should exit silently on malformed JSON input', () => {
    const output = runHook('{{broken json');
    assert.strictEqual(output, '', 'Should produce no output on malformed JSON');
    assert.strictEqual(output.includes('Error'), false, 'Should not print error messages');
  });

  it('should exit silently for non-Write/Edit tool calls (e.g., Read, Bash)', () => {
    const output = runHook({
      tool_name: 'Read',
      cwd: tmpDir,
    });
    assert.strictEqual(output, '', 'Should not warn on Read tool');
    const output2 = runHook({
      tool_name: 'Bash',
      cwd: tmpDir,
    });
    assert.strictEqual(output2, '', 'Should not warn on Bash tool');
  });

  it('should exit silently when editing .cap/ files', () => {
    const output = runHook({
      tool_name: 'Write',
      tool_input: { file_path: '/project/.cap/SESSION.json' },
      cwd: tmpDir,
    });
    assert.strictEqual(output, '', 'Should not warn on .cap/ file edits');
    assert.ok(!output.includes('WORKFLOW'), 'Should not include workflow advisory');
  });

  it('should exit silently when editing allowed config files', () => {
    const output = runHook({
      tool_name: 'Write',
      tool_input: { file_path: '/project/.gitignore' },
      cwd: tmpDir,
    });
    assert.strictEqual(output, '', 'Should not warn on .gitignore edits');

    const output2 = runHook({
      tool_name: 'Edit',
      tool_input: { file_path: '/project/CLAUDE.md' },
      cwd: tmpDir,
    });
    assert.strictEqual(output2, '', 'Should not warn on CLAUDE.md edits');
  });

  it('should emit advisory warning when guard is enabled and editing source files', { skip: process.platform === 'win32' }, () => {
    const output = runHook({
      tool_name: 'Write',
      tool_input: { file_path: '/project/src/app.js' },
      cwd: tmpDir,
    });
    assert.ok(output.length > 0, 'Should produce output when guard triggers');
    const parsed = JSON.parse(output);
    assert.ok(parsed.hookSpecificOutput, 'Should have hookSpecificOutput');
    assert.ok(
      parsed.hookSpecificOutput.additionalContext.includes('WORKFLOW ADVISORY'),
      'Should contain WORKFLOW ADVISORY message'
    );
  });

  it('should exit silently when no config file exists (guard disabled by default)', () => {
    const noConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-wf-noconfig-'));
    const output = runHook({
      tool_name: 'Write',
      tool_input: { file_path: '/project/src/app.js' },
      cwd: noConfigDir,
    });
    assert.strictEqual(output, '', 'Should not warn when no config exists');
    assert.ok(!output.includes('WORKFLOW'), 'Should not contain workflow warning');
    fs.rmSync(noConfigDir, { recursive: true, force: true });
  });

  it('should exit silently for subagent/task contexts', () => {
    const output = runHook({
      tool_name: 'Write',
      tool_input: { file_path: '/project/src/app.js', is_subagent: true },
      cwd: tmpDir,
    });
    assert.strictEqual(output, '', 'Should not warn for subagent edits');

    const output2 = runHook({
      tool_name: 'Write',
      tool_input: { file_path: '/project/src/app.js' },
      session_type: 'task',
      cwd: tmpDir,
    });
    assert.strictEqual(output2, '', 'Should not warn for task session edits');
  });

  it('should include the filename in the advisory message', { skip: process.platform === 'win32' }, () => {
    const output = runHook({
      tool_name: 'Edit',
      tool_input: { file_path: '/project/src/handler.ts' },
      cwd: tmpDir,
    });
    assert.ok(output.length > 0, 'Should produce output');
    const parsed = JSON.parse(output);
    assert.ok(
      parsed.hookSpecificOutput.additionalContext.includes('handler.ts'),
      'Advisory should mention the file being edited'
    );
  });
});
