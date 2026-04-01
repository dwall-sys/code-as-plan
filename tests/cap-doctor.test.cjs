'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  checkTool,
  runDoctor,
  formatReport,
} = require('../cap/bin/lib/cap-doctor.cjs');

// --- checkTool tests ---

describe('checkTool', () => {
  it('returns ok:true for an existing command (node --version)', () => {
    const result = checkTool('node --version');
    assert.strictEqual(result.ok, true);
    assert.notStrictEqual(result.version, 'not found');
    // Version should be a semver-like string (digits and dots)
    assert.match(result.version, /^\d+\.\d+/);
  });

  it('returns ok:false for a nonexistent command', () => {
    const result = checkTool('definitely-not-a-real-tool-xyz --version');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.version, 'not found');
  });

  it('strips leading v from version output', () => {
    // node --version returns "v20.x.x" -- checkTool should strip the v
    const result = checkTool('node --version');
    assert.ok(result.ok);
    assert.ok(!result.version.startsWith('v'), 'version should not start with v');
  });

  it('respects timeout parameter', () => {
    // A command that would take too long with a very short timeout
    const result = checkTool('sleep 10', 100);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.version, 'not found');
  });
});

// --- runDoctor tests ---

describe('runDoctor', () => {
  it('returns a valid DoctorReport structure', () => {
    const report = runDoctor();
    assert.ok(Array.isArray(report.tools), 'tools should be an array');
    assert.strictEqual(typeof report.requiredOk, 'number');
    assert.strictEqual(typeof report.requiredTotal, 'number');
    assert.strictEqual(typeof report.optionalOk, 'number');
    assert.strictEqual(typeof report.optionalTotal, 'number');
    assert.strictEqual(typeof report.healthy, 'boolean');
    assert.ok(Array.isArray(report.installCommands), 'installCommands should be an array');
  });

  it('includes required tools (Node.js, npm, git)', () => {
    const report = runDoctor();
    const requiredNames = report.tools.filter(t => t.required).map(t => t.name);
    assert.ok(requiredNames.includes('Node.js'), 'should check Node.js');
    assert.ok(requiredNames.includes('npm'), 'should check npm');
    assert.ok(requiredNames.includes('git'), 'should check git');
  });

  it('has correct requiredOk/requiredTotal counts', () => {
    const report = runDoctor();
    const requiredTools = report.tools.filter(t => t.required);
    const requiredOkCount = requiredTools.filter(t => t.ok).length;
    assert.strictEqual(report.requiredOk, requiredOkCount);
    assert.strictEqual(report.requiredTotal, requiredTools.length);
  });

  it('has correct optionalOk/optionalTotal counts', () => {
    const report = runDoctor();
    const optionalTools = report.tools.filter(t => !t.required);
    const optionalOkCount = optionalTools.filter(t => t.ok).length;
    assert.strictEqual(report.optionalOk, optionalOkCount);
    assert.strictEqual(report.optionalTotal, optionalTools.length);
  });

  it('marks healthy:true when all required tools are available', () => {
    const report = runDoctor();
    const allRequiredOk = report.tools.filter(t => t.required).every(t => t.ok);
    assert.strictEqual(report.healthy, allRequiredOk);
  });

  it('each tool has expected properties', () => {
    const report = runDoctor();
    for (const tool of report.tools) {
      assert.strictEqual(typeof tool.name, 'string', `tool should have name`);
      assert.strictEqual(typeof tool.version, 'string', `${tool.name} should have version`);
      assert.strictEqual(typeof tool.ok, 'boolean', `${tool.name} should have ok`);
      assert.strictEqual(typeof tool.required, 'boolean', `${tool.name} should have required`);
      assert.strictEqual(typeof tool.purpose, 'string', `${tool.name} should have purpose`);
      assert.strictEqual(typeof tool.installHint, 'string', `${tool.name} should have installHint`);
    }
  });

  it('includes project-specific checks when projectRoot is provided', () => {
    // Use the actual project root which has package.json
    const projectRoot = require('node:path').resolve(__dirname, '..');
    const report = runDoctor(projectRoot);
    const toolNames = report.tools.map(t => t.name);
    // Should include fast-check (project-specific check)
    assert.ok(toolNames.includes('fast-check'), 'should check fast-check when package.json exists');
  });
});

// --- formatReport tests ---

describe('formatReport', () => {
  it('produces readable string output', () => {
    const report = runDoctor();
    const output = formatReport(report);
    assert.strictEqual(typeof output, 'string');
    assert.ok(output.length > 0, 'output should not be empty');
  });

  it('contains cap:doctor header', () => {
    const report = runDoctor();
    const output = formatReport(report);
    assert.ok(output.includes('cap:doctor'), 'should contain cap:doctor header');
  });

  it('contains Required and Optional sections', () => {
    const report = runDoctor();
    const output = formatReport(report);
    assert.ok(output.includes('Required:'), 'should have Required section');
    assert.ok(output.includes('Optional:'), 'should have Optional section');
  });

  it('contains OK summary counts', () => {
    const report = runDoctor();
    const output = formatReport(report);
    assert.ok(output.includes(`${report.requiredOk}/${report.requiredTotal} OK`), 'should show required OK count');
    assert.ok(output.includes(`${report.optionalOk}/${report.optionalTotal} OK`), 'should show optional OK count');
  });

  it('shows UNHEALTHY when required tools are missing', () => {
    // Create a fake unhealthy report
    const fakeReport = {
      tools: [
        { name: 'Node.js', ok: false, version: 'not found', required: true, purpose: 'runtime', installHint: 'install node' },
      ],
      requiredOk: 0,
      requiredTotal: 1,
      optionalOk: 0,
      optionalTotal: 0,
      healthy: false,
      installCommands: [],
    };
    const output = formatReport(fakeReport);
    assert.ok(output.includes('UNHEALTHY'), 'should show UNHEALTHY for missing required tools');
  });

  it('shows install commands when tools are missing', () => {
    const fakeReport = {
      tools: [
        { name: 'c8', ok: false, version: 'not found', required: false, purpose: 'coverage', installHint: 'npm install -D c8' },
      ],
      requiredOk: 0,
      requiredTotal: 0,
      optionalOk: 0,
      optionalTotal: 1,
      healthy: true,
      installCommands: ['npm install -D c8'],
    };
    const output = formatReport(fakeReport);
    assert.ok(output.includes('npm install -D c8'), 'should show install command');
    assert.ok(output.includes('To install missing tools'), 'should have install section header');
  });

  it('shows fully operational when all tools available', () => {
    const fakeReport = {
      tools: [
        { name: 'Node.js', ok: true, version: '20.0.0', required: true, purpose: 'runtime', installHint: '' },
      ],
      requiredOk: 1,
      requiredTotal: 1,
      optionalOk: 0,
      optionalTotal: 0,
      healthy: true,
      installCommands: [],
    };
    const output = formatReport(fakeReport);
    assert.ok(output.includes('fully operational'), 'should show fully operational');
  });
});
