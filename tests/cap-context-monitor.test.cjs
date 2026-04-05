'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const HOOK_PATH = path.join(__dirname, '..', 'hooks', 'cap-context-monitor.js');

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
    // exit code != 0
    return e.stdout || '';
  }
}

describe('cap-context-monitor hook', () => {
  let tmpDir;
  const SESSION_ID = 'test-session-ctx-monitor-' + Date.now();

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-ctx-monitor-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    // Clean up bridge and warn files
    const bridgePath = path.join(os.tmpdir(), `claude-ctx-${SESSION_ID}.json`);
    const warnPath = path.join(os.tmpdir(), `claude-ctx-${SESSION_ID}-warned.json`);
    try { fs.unlinkSync(bridgePath); } catch (_e) { /* ignore */ }
    try { fs.unlinkSync(warnPath); } catch (_e) { /* ignore */ }
  });

  it('should exit silently on empty input', () => {
    const output = runHook('');
    assert.strictEqual(output, '', 'Should produce no output on empty input');
    assert.strictEqual(typeof output, 'string', 'Output should be a string');
  });

  it('should exit silently on malformed JSON input', () => {
    const output = runHook('not-json{{{');
    assert.strictEqual(output, '', 'Should produce no output on malformed JSON');
    assert.ok(!output.includes('Error'), 'Should not print error messages');
  });

  it('should exit silently when session_id is missing', () => {
    const output = runHook({ tool_name: 'Read' });
    assert.strictEqual(output, '', 'Should produce no output without session_id');
    assert.ok(!output.includes('hookSpecificOutput'), 'Should not produce hook output');
  });

  it('should exit silently when no metrics bridge file exists', () => {
    const output = runHook({
      session_id: 'nonexistent-session-' + Date.now(),
      tool_name: 'Read',
    });
    assert.strictEqual(output, '', 'Should produce no output without metrics file');
    assert.strictEqual(typeof output, 'string', 'Output type should be string');
  });

  it('should emit WARNING when remaining context is at warning threshold', () => {
    // Write a bridge file with remaining at 30% (below WARNING_THRESHOLD of 35%)
    const bridgePath = path.join(os.tmpdir(), `claude-ctx-${SESSION_ID}.json`);
    const metricsData = {
      session_id: SESSION_ID,
      remaining_percentage: 30,
      used_pct: 70,
      timestamp: Math.floor(Date.now() / 1000),
    };
    fs.writeFileSync(bridgePath, JSON.stringify(metricsData));

    const output = runHook({
      session_id: SESSION_ID,
      tool_name: 'Read',
    });

    assert.ok(output.length > 0, 'Should produce output at warning threshold');
    const parsed = JSON.parse(output);
    assert.ok(parsed.hookSpecificOutput, 'Should have hookSpecificOutput');
    assert.ok(
      parsed.hookSpecificOutput.additionalContext.includes('CONTEXT WARNING'),
      'Should contain CONTEXT WARNING message'
    );
  });

  it('should emit CRITICAL when remaining context is at critical threshold', () => {
    // Clean up any previous warn file to avoid debounce
    const warnPath = path.join(os.tmpdir(), `claude-ctx-${SESSION_ID}-warned.json`);
    try { fs.unlinkSync(warnPath); } catch (_e) { /* ignore */ }

    const bridgePath = path.join(os.tmpdir(), `claude-ctx-${SESSION_ID}.json`);
    const metricsData = {
      session_id: SESSION_ID,
      remaining_percentage: 20,
      used_pct: 80,
      timestamp: Math.floor(Date.now() / 1000),
    };
    fs.writeFileSync(bridgePath, JSON.stringify(metricsData));

    const output = runHook({
      session_id: SESSION_ID,
      tool_name: 'Read',
    });

    assert.ok(output.length > 0, 'Should produce output at critical threshold');
    const parsed = JSON.parse(output);
    assert.ok(
      parsed.hookSpecificOutput.additionalContext.includes('CONTEXT CRITICAL'),
      'Should contain CONTEXT CRITICAL message'
    );
  });

  it('should exit silently when remaining context is above warning threshold', () => {
    const safeSessionId = 'safe-session-' + Date.now();
    const bridgePath = path.join(os.tmpdir(), `claude-ctx-${safeSessionId}.json`);
    const metricsData = {
      session_id: safeSessionId,
      remaining_percentage: 60,
      used_pct: 40,
      timestamp: Math.floor(Date.now() / 1000),
    };
    fs.writeFileSync(bridgePath, JSON.stringify(metricsData));

    const output = runHook({
      session_id: safeSessionId,
      tool_name: 'Read',
    });

    assert.strictEqual(output, '', 'Should produce no output when context is healthy');
    assert.ok(!output.includes('WARNING'), 'Should not warn when above threshold');

    // Cleanup
    try { fs.unlinkSync(bridgePath); } catch (_e) { /* ignore */ }
  });

  it('should ignore stale metrics older than 60 seconds', () => {
    const staleSessionId = 'stale-session-' + Date.now();
    const bridgePath = path.join(os.tmpdir(), `claude-ctx-${staleSessionId}.json`);
    const metricsData = {
      session_id: staleSessionId,
      remaining_percentage: 10,
      used_pct: 90,
      timestamp: Math.floor(Date.now() / 1000) - 120, // 2 minutes ago
    };
    fs.writeFileSync(bridgePath, JSON.stringify(metricsData));

    const output = runHook({
      session_id: staleSessionId,
      tool_name: 'Read',
    });

    assert.strictEqual(output, '', 'Should produce no output for stale metrics');
    assert.ok(!output.includes('CRITICAL'), 'Should not warn on stale data');

    // Cleanup
    try { fs.unlinkSync(bridgePath); } catch (_e) { /* ignore */ }
  });
});
