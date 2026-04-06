'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const HOOK_PATH = path.join(__dirname, '..', 'hooks', 'cap-statusline.js');

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

describe('cap-statusline hook', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-statusline-test-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should exit silently on empty input', () => {
    const output = runHook('');
    assert.strictEqual(output, '', 'Should produce no output on empty input');
    assert.strictEqual(typeof output, 'string', 'Output should be a string');
  });

  it('should exit silently on malformed JSON', () => {
    const output = runHook('{not valid json!!!');
    assert.strictEqual(output, '', 'Should produce no output on malformed JSON');
    assert.strictEqual(output.includes('Error'), false, 'Should not print error messages');
  });

  it('should display model name and directory in output', { skip: process.platform === 'win32' }, () => {
    const output = runHook({
      model: { display_name: 'Claude Opus' },
      workspace: { current_dir: '/home/user/myproject' },
    });
    assert.ok(output.includes('Claude Opus'), 'Should include model display name');
    assert.ok(output.includes('myproject'), 'Should include directory basename');
  });

  it('should default model name to Claude when not provided', { skip: process.platform === 'win32' }, () => {
    const output = runHook({
      workspace: { current_dir: '/tmp/test' },
    });
    assert.ok(output.includes('Claude'), 'Should default to Claude');
    assert.ok(output.includes('test'), 'Should show directory name');
  });

  it('should display context window usage with progress bar when data is provided', { skip: process.platform === 'win32' }, () => {
    const output = runHook({
      model: { display_name: 'Claude' },
      workspace: { current_dir: '/tmp/proj' },
      context_window: {
        remaining_percentage: 60,
        total_input_tokens: 50000,
        total_output_tokens: 10000,
        context_window_size: 200000,
      },
    });
    // Should contain progress bar characters
    assert.ok(output.includes('█') || output.includes('░'), 'Should display progress bar');
    assert.ok(output.includes('%'), 'Should display percentage');
  });

  it('should write context metrics bridge file when session_id is present', { skip: process.platform === 'win32' }, () => {
    const sessionId = 'statusline-test-' + Date.now();
    const bridgePath = path.join(os.tmpdir(), `claude-ctx-${sessionId}.json`);

    runHook({
      model: { display_name: 'Claude' },
      workspace: { current_dir: '/tmp/proj' },
      session_id: sessionId,
      context_window: {
        remaining_percentage: 70,
        total_input_tokens: 30000,
        total_output_tokens: 5000,
        context_window_size: 200000,
      },
    });

    assert.ok(fs.existsSync(bridgePath), 'Should write bridge file to tmpdir');
    const bridge = JSON.parse(fs.readFileSync(bridgePath, 'utf8'));
    assert.strictEqual(bridge.session_id, sessionId, 'Bridge should contain session_id');

    // Cleanup
    try { fs.unlinkSync(bridgePath); } catch (_e) { /* ignore */ }
  });

  it('should show CAP update notification when cache file indicates update available', { skip: process.platform === 'win32' }, () => {
    const cacheDir = path.join(tmpDir, '.claude-test', 'cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
      path.join(cacheDir, 'cap-update-check.json'),
      JSON.stringify({ update_available: true, installed: '1.0.0', latest: '2.0.0' })
    );

    const output = runHook(
      {
        model: { display_name: 'Claude' },
        workspace: { current_dir: '/tmp/proj' },
      },
      { CLAUDE_CONFIG_DIR: path.join(tmpDir, '.claude-test') }
    );

    assert.ok(output.includes('cap:update') || output.includes('update'), 'Should show update notification');
    assert.ok(output.length > 0, 'Should produce output');
  });

  it('should format token counts with k and M suffixes', { skip: process.platform === 'win32' }, () => {
    // Test with large token counts that should display as 'k'
    const output = runHook({
      model: { display_name: 'Claude' },
      workspace: { current_dir: '/tmp/proj' },
      context_window: {
        remaining_percentage: 50,
        total_input_tokens: 150000,
        total_output_tokens: 25000,
        context_window_size: 200000,
      },
    });
    assert.ok(output.includes('k') || output.includes('M'), 'Should format large numbers with suffixes');
    assert.ok(output.includes('In:'), 'Should show input token label');
  });
});
