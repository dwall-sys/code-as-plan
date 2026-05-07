/**
 * GSD Agent Installation Validation Tests (#1371)
 *
 * Validates that GSD detects missing or incomplete agent installations and
 * surfaces warnings through init commands and health checks. When agents are
 * not installed, Task(subagent_type="gsd-*") silently falls back to
 * general-purpose, losing specialized instructions.
 */

// @cap-decision(CI/issue-42 Path-2 PR-2.8+2.9) Migrated runGsdTools spawn
// callsites to direct in-process calls. Pattern follows tests/commands.test.cjs
// runCmd helper (PR #55).

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createTempProject, cleanup } = require('./helpers.cjs');
const {
  cmdInitExecutePhase,
  cmdInitPlanPhase,
  cmdInitQuick,
} = require('../cap/bin/lib/init.cjs');
const {
  cmdValidateHealth,
  cmdValidateAgents,
} = require('../cap/bin/lib/verify.cjs');

const AGENTS_DIR_NAME = 'agents';
const MODEL_PROFILES = require('../cap/bin/lib/model-profiles.cjs').MODEL_PROFILES;
const EXPECTED_AGENTS = Object.keys(MODEL_PROFILES);

/**
 * In-process equivalent of runGsdTools that captures stdout, stderr, and
 * process.exit(). Returns the same {success, output, error} shape.
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

/**
 * Create a fake GSD install directory structure that mirrors what the installer
 * produces. cap-tools.cjs lives at <configDir>/cap/bin/cap-tools.cjs,
 * so the agents dir is at <configDir>/agents/.
 *
 * We use --cwd to point at the project, and GSD_INSTALL_DIR env to override
 * the agents directory location for testing.
 */
function createAgentsDir(configDir, agentNames = []) {
  const agentsDir = path.join(configDir, AGENTS_DIR_NAME);
  fs.mkdirSync(agentsDir, { recursive: true });
  for (const name of agentNames) {
    fs.writeFileSync(
      path.join(agentsDir, `${name}.md`),
      `---\nname: ${name}\ndescription: Test agent\ntools: Read, Bash\ncolor: cyan\n---\nAgent content.\n`
    );
  }
  return agentsDir;
}

// ─── Init command agent validation ──────────────────────────────────────────

describe('init commands: agents_installed field (#1371)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('init execute-phase includes agents_installed=true when agents exist', () => {
    // Create phase dir for init
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });

    // Create agents dir as sibling of cap/ (the installed layout)
    // cap-tools.cjs resolves agents from GSD_INSTALL_DIR or __dirname/../../agents
    const gsdInstallDir = path.resolve(__dirname, '..', 'cap', 'bin');
    const configDir = path.resolve(gsdInstallDir, '..', '..');
    const agentsDir = path.join(configDir, 'agents');

    // Agents already exist in the repo root /agents/ dir which is sibling to cap/
    const result = runCmd(() => cmdInitExecutePhase(tmpDir, '1', true));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(typeof output.agents_installed, 'boolean',
      'init execute-phase must include agents_installed field');
    // The repo has agents/ dir with all gsd-*.md files, so this should be true
    assert.strictEqual(output.agents_installed, true,
      'agents_installed should be true when agents directory has gsd-*.md files');
  });

  test('init plan-phase includes agents_installed=true when agents exist', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });

    const result = runCmd(() => cmdInitPlanPhase(tmpDir, '1', true));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(typeof output.agents_installed, 'boolean',
      'init plan-phase must include agents_installed field');
    assert.strictEqual(output.agents_installed, true);
  });

  test('init execute-phase includes missing_agents list when agents are missing', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });

    const result = runCmd(() => cmdInitExecutePhase(tmpDir, '1', true));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(Array.isArray(output.missing_agents),
      'init execute-phase must include missing_agents array');
  });

  test('init quick includes agents_installed field', () => {
    const result = runCmd(() => cmdInitQuick(tmpDir, 'test description', true));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(typeof output.agents_installed, 'boolean',
      'init quick must include agents_installed field');
  });
});

// ─── Health check: agent installation ───────────────────────────────────────

describe('validate health: agent installation check W010 (#1371)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    // Write minimal project files so health check doesn't fail on E001-E005
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'PROJECT.md'),
      '# Project\n\n## What This Is\nTest\n\n## Core Value\nTest\n\n## Requirements\nTest\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n\n### Phase 1: Setup\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      '# Session State\n\n## Current Position\n\nPhase: 1\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({
        model_profile: 'balanced',
        commit_docs: true,
        workflow: { nyquist_validation: true },
      }, null, 2)
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-setup'), { recursive: true });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('health check reports healthy when agents are installed (repo layout)', () => {
    // In the repo, agents/ exists as a sibling of cap/, so the
    // health check should find them via the cap-tools.cjs path resolution
    const result = runCmd(() => cmdValidateHealth(tmpDir, { repair: false }, true));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    // Should not have W010 warning about missing agents
    const w010 = (output.warnings || []).find(w => w.code === 'W010');
    assert.ok(!w010, 'Should not warn about missing agents when agents/ dir exists with files');
  });
});

// ─── validate agents subcommand ─────────────────────────────────────────────

describe('validate agents subcommand (#1371)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('validate agents returns status with agent list', () => {
    const result = runCmd(() => cmdValidateAgents(tmpDir, true));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok('agents_dir' in output, 'Must include agents_dir path');
    assert.ok('installed' in output, 'Must include installed array');
    assert.ok('missing' in output, 'Must include missing array');
    assert.ok('agents_found' in output, 'Must include agents_found boolean');
  });

  test('validate agents lists all expected agent types', () => {
    const result = runCmd(() => cmdValidateAgents(tmpDir, true));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    // The expected agents come from MODEL_PROFILES keys
    assert.ok(output.expected.length > 0, 'Must have expected agents');
  });
});
