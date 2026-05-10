'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');

const HOOK_PATH = path.join(__dirname, '..', 'hooks', 'cap-memory.js');

describe('cap-memory hook', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-memory-hook-test-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should be valid JavaScript that parses without syntax errors', () => {
    const content = fs.readFileSync(HOOK_PATH, 'utf8');
    assert.ok(content.length > 0, 'Hook file should not be empty');
    assert.doesNotThrow(() => {
      new vm.Script(content, { filename: 'cap-memory.js' });
    }, 'Hook should have valid JavaScript syntax');
  });

  it('should exit immediately when CAP_SKIP_MEMORY=1 is set', { skip: process.platform === 'win32' }, () => {
    const result = execSync(`NODE_V8_COVERAGE= node "${HOOK_PATH}"`, {
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, NODE_V8_COVERAGE: '', CAP_SKIP_MEMORY: '1' },
      cwd: tmpDir,
    });
    assert.strictEqual(result, '', 'Should produce no output when skipped');
    assert.strictEqual(typeof result, 'string', 'Output type should be string');
  });

  it('should exit silently when required modules are not found', { skip: process.platform === 'win32' }, () => {
    // Running in tmpDir where no cap modules exist — should fail silently
    const result = execSync(`NODE_V8_COVERAGE= node "${HOOK_PATH}"`, {
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, NODE_V8_COVERAGE: '', HOME: tmpDir, CAP_SKIP_MEMORY: undefined },
      cwd: tmpDir,
    });
    assert.strictEqual(result, '', 'Should produce no output when modules missing');
    assert.ok(!result.includes('Error'), 'Should not show errors');
  });

  it('should support --init flag for bootstrap mode', () => {
    const content = fs.readFileSync(HOOK_PATH, 'utf8');
    assert.ok(content.includes("'init'") || content.includes('"init"'), 'Should support init argument');
    assert.ok(content.includes('--init'), 'Should support --init flag');
    assert.ok(content.includes('isInit'), 'Should parse isInit from args');
  });

  it('should implement the filterNewSessions function for incremental processing', () => {
    const content = fs.readFileSync(HOOK_PATH, 'utf8');
    assert.ok(content.includes('filterNewSessions'), 'Should have filterNewSessions function');
    assert.ok(content.includes('readLastRun'), 'Should have readLastRun function');
    assert.ok(content.includes('writeLastRun'), 'Should have writeLastRun function');
  });

  it('hotspot computation uses ALL sessions, not just the new-since-last-run slice', () => {
    // V6 regression: the incremental run was filtering sessions to the new slice for ALL purposes,
    // including hotspot computation. Hotspots are inherently cumulative (>= 2 sessions of edits to a
    // single file), so a 1-2-session window almost never produces them, and writeMemoryDirectory then
    // overwrote hotspots.md with an empty stub. Real-world evidence: GoetzeInvest had 61 hotspot
    // nodes in graph.json from a prior init, but every incremental run zeroed hotspots.md.
    // Pin this fix at the source-shape level so a future refactor doesn't silently regress.
    const content = fs.readFileSync(HOOK_PATH, 'utf8');
    // The full-history pass must be wired through allSessionFiles, not sessionFiles.
    const filesToProcessAssign = content.match(/const filesToProcess = (\w+)\.map/);
    assert.ok(filesToProcessAssign, 'Hook must declare filesToProcess from one of the session lists');
    assert.strictEqual(
      filesToProcessAssign[1],
      'allSessionFiles',
      'filesToProcess must derive from allSessionFiles so hotspot aggregation sees full history',
    );
  });

  it('should run the F-027 to F-029 pipeline (engine -> writer -> directory)', () => {
    const content = fs.readFileSync(HOOK_PATH, 'utf8');
    assert.ok(content.includes('cap-memory-engine'), 'Should load memory engine (F-027)');
    assert.ok(content.includes('cap-annotation-writer'), 'Should load annotation writer (F-028)');
    assert.ok(content.includes('cap-memory-dir'), 'Should load memory directory (F-029)');
  });

  it('should emit performance warnings when hook exceeds 5 second target', () => {
    const content = fs.readFileSync(HOOK_PATH, 'utf8');
    assert.ok(content.includes('5000'), 'Should have 5000ms threshold');
    assert.ok(content.includes('cap-memory: warning'), 'Should emit timing warning via stderr');
  });

  it('should never block session end — errors are caught silently', () => {
    const content = fs.readFileSync(HOOK_PATH, 'utf8');
    // The outer try/catch ensures errors don't crash the hook
    const tryCatchCount = (content.match(/try\s*\{/g) || []).length;
    assert.ok(tryCatchCount >= 2, 'Should have multiple try-catch blocks for error handling');
    assert.ok(content.includes('process.stderr.write'), 'Should write errors to stderr not stdout');
  });

  it('F-098/AC-3: wires implicit-quick processSession after the memory pipeline', () => {
    const content = fs.readFileSync(HOOK_PATH, 'utf8');
    assert.ok(content.includes('cap-implicit-quick.cjs'), 'Stop hook must load cap-implicit-quick.cjs');
    assert.ok(content.includes('processSession'), 'Stop hook must invoke processSession');
    // notice goes to stderr per AC-3
    assert.ok(/result\.notice[\s\S]{0,200}process\.stderr/.test(content),
      'notice must be written to stderr (AC-3)');
    // skip when init mode (avoid double-running on bootstrap)
    assert.ok(/!options\.init[\s\S]{0,200}cap-implicit-quick/.test(content)
      || /options\.init[\s\S]{0,400}cap-implicit-quick/.test(content),
      'implicit-quick must be gated on !options.init');
  });

  it('should handle the init mode with monorepo support', { skip: process.platform === 'win32' }, () => {
    // Running with init flag in a dir with no sessions should exit cleanly
    const result = execSync(`NODE_V8_COVERAGE= node "${HOOK_PATH}" init`, {
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, NODE_V8_COVERAGE: '', HOME: tmpDir },
      cwd: tmpDir,
    });
    // With no modules found, it exits silently
    assert.strictEqual(typeof result, 'string', 'Should return string output');
    assert.ok(!result.includes('uncaught'), 'Should not have uncaught exceptions');
  });
});
