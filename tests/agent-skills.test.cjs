/**
 * GSD Tools Tests - Agent Skills Injection
 *
 * CLI integration tests for the `agent-skills` command that reads
 * `agent_skills` from .planning/config.json and returns a formatted
 * skills block for injection into Task() prompts.
 */

// @cap-decision(CI/issue-42 Path-2 PR-2.8+2.9) Migrated runGsdTools spawn
// callsites to direct in-process calls. Pattern follows tests/commands.test.cjs
// runCmd helper (PR #55). The HOME/USERPROFILE env overrides used by these
// tests to sandbox ~/.gsd/ lookups are now done by mutating process.env in the
// runCmd wrapper and restoring on completion.

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createTempProject, cleanup } = require('./helpers.cjs');
const { cmdAgentSkills } = require('../cap/bin/lib/init.cjs');
const {
  cmdConfigEnsureSection,
  cmdConfigSet,
} = require('../cap/bin/lib/config.cjs');

/**
 * In-process equivalent of runGsdTools that captures stdout, stderr, and
 * process.exit(). Optionally overrides process.env entries (e.g. HOME) for
 * the duration of the call. Returns the same {success, output, error} shape.
 */
function runCmd(fn, envOverride = null) {
  const origWriteSync = fs.writeSync;
  const origExit = process.exit;
  const origStdoutWrite = process.stdout.write;
  let stdout = '';
  let stderr = '';
  let exited = false;
  let exitCode = 0;

  const savedEnv = {};
  if (envOverride) {
    for (const k of Object.keys(envOverride)) {
      savedEnv[k] = process.env[k];
      process.env[k] = envOverride[k];
    }
  }

  fs.writeSync = (fd, data, ...rest) => {
    const str = String(data);
    if (fd === 1) { stdout += str; return Buffer.byteLength(str); }
    if (fd === 2) { stderr += str; return Buffer.byteLength(str); }
    return origWriteSync.call(fs, fd, data, ...rest);
  };
  // cmdAgentSkills calls process.stdout.write() directly; capture that too.
  process.stdout.write = function (chunk) {
    stdout += String(chunk);
    return true;
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
    process.stdout.write = origStdoutWrite;
    if (envOverride) {
      for (const k of Object.keys(savedEnv)) {
        if (savedEnv[k] === undefined) delete process.env[k];
        else process.env[k] = savedEnv[k];
      }
    }
  }

  if (thrown) {
    return { success: false, output: stdout.trim(), error: (stderr.trim() || thrown.message) };
  }
  if (exited && exitCode !== 0) {
    return { success: false, output: stdout.trim(), error: stderr.trim() };
  }
  return { success: true, output: stdout.trim(), error: null };
}

const HOME_ENV = (tmpDir) => ({ HOME: tmpDir, USERPROFILE: tmpDir });

// ─── helpers ──────────────────────────────────────────────────────────────────

function writeConfig(tmpDir, obj) {
  const configPath = path.join(tmpDir, '.planning', 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(obj, null, 2), 'utf-8');
}

function readConfig(tmpDir) {
  const configPath = path.join(tmpDir, '.planning', 'config.json');
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

// ─── agent-skills command ────────────────────────────────────────────────────

describe('agent-skills command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns empty when no config exists', () => {
    // No config.json at all
    const result = runCmd(() => cmdAgentSkills(tmpDir, 'gsd-executor', false), HOME_ENV(tmpDir));
    // Should succeed with empty output (no skills configured)
    assert.strictEqual(result.output, '');
  });

  test('returns empty when config has no agent_skills section', () => {
    writeConfig(tmpDir, { model_profile: 'balanced' });
    const result = runCmd(() => cmdAgentSkills(tmpDir, 'gsd-executor', false), HOME_ENV(tmpDir));
    assert.strictEqual(result.output, '');
  });

  test('returns empty for unconfigured agent type', () => {
    writeConfig(tmpDir, {
      agent_skills: {
        'gsd-executor': ['skills/test-skill'],
      },
    });
    const result = runCmd(() => cmdAgentSkills(tmpDir, 'gsd-planner', false), HOME_ENV(tmpDir));
    assert.strictEqual(result.output, '');
  });

  test('returns formatted block for configured agent with array of paths', () => {
    // Create the skill directories with SKILL.md files
    const skillDir = path.join(tmpDir, 'skills', 'test-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Test Skill\n');

    writeConfig(tmpDir, {
      agent_skills: {
        'gsd-executor': ['skills/test-skill'],
      },
    });

    const result = runCmd(() => cmdAgentSkills(tmpDir, 'gsd-executor', false), HOME_ENV(tmpDir));
    assert.ok(result.success, `Command failed: ${result.error}`);
    assert.ok(result.output.includes('<agent_skills>'), 'Should contain <agent_skills> tag');
    assert.ok(result.output.includes('</agent_skills>'), 'Should contain closing tag');
    assert.ok(result.output.includes('skills/test-skill/SKILL.md'), 'Should contain skill path');
  });

  test('returns formatted block for configured agent with single string path', () => {
    const skillDir = path.join(tmpDir, 'skills', 'my-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# My Skill\n');

    writeConfig(tmpDir, {
      agent_skills: {
        'gsd-executor': 'skills/my-skill',
      },
    });

    const result = runCmd(() => cmdAgentSkills(tmpDir, 'gsd-executor', false), HOME_ENV(tmpDir));
    assert.ok(result.success, `Command failed: ${result.error}`);
    assert.ok(result.output.includes('skills/my-skill/SKILL.md'), 'Should contain skill path');
  });

  test('handles multiple skill paths', () => {
    const skill1 = path.join(tmpDir, 'skills', 'skill-a');
    const skill2 = path.join(tmpDir, 'skills', 'skill-b');
    fs.mkdirSync(skill1, { recursive: true });
    fs.mkdirSync(skill2, { recursive: true });
    fs.writeFileSync(path.join(skill1, 'SKILL.md'), '# Skill A\n');
    fs.writeFileSync(path.join(skill2, 'SKILL.md'), '# Skill B\n');

    writeConfig(tmpDir, {
      agent_skills: {
        'gsd-executor': ['skills/skill-a', 'skills/skill-b'],
      },
    });

    const result = runCmd(() => cmdAgentSkills(tmpDir, 'gsd-executor', false), HOME_ENV(tmpDir));
    assert.ok(result.success, `Command failed: ${result.error}`);
    assert.ok(result.output.includes('skills/skill-a/SKILL.md'), 'Should contain first skill');
    assert.ok(result.output.includes('skills/skill-b/SKILL.md'), 'Should contain second skill');
  });

  test('warns for nonexistent skill path but does not error', () => {
    writeConfig(tmpDir, {
      agent_skills: {
        'gsd-executor': ['skills/nonexistent'],
      },
    });

    const result = runCmd(() => cmdAgentSkills(tmpDir, 'gsd-executor', false), HOME_ENV(tmpDir));
    // Should not crash — returns empty output (the missing skill is skipped)
    assert.ok(result.success, 'Command should succeed even with missing skill paths');
    // Should not include the missing skill in the output
    assert.ok(!result.output.includes('skills/nonexistent/SKILL.md'),
      'Should not include nonexistent skill in output');
  });

  test('validates path safety — rejects traversal attempts', () => {
    writeConfig(tmpDir, {
      agent_skills: {
        'gsd-executor': ['../../../etc/passwd'],
      },
    });

    const result = runCmd(() => cmdAgentSkills(tmpDir, 'gsd-executor', false), HOME_ENV(tmpDir));
    // Should not include traversal path in output
    assert.ok(!result.output.includes('/etc/passwd'), 'Should not include traversal path');
  });

  test('returns empty when no agent type argument provided', () => {
    const result = runCmd(() => cmdAgentSkills(tmpDir, undefined, false), HOME_ENV(tmpDir));
    // Should succeed with empty output — no agent type means no skills to return
    assert.ok(result.success, 'Command should succeed');
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed, '', 'Should return empty string');
  });
});

// ─── config-ensure-section includes agent_skills ────────────────────────────

describe('config-ensure-section with agent_skills', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('new configs include agent_skills key', () => {
    const result = runCmd(() => cmdConfigEnsureSection(tmpDir, false), HOME_ENV(tmpDir));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.ok('agent_skills' in config, 'config should have agent_skills key');
    assert.deepStrictEqual(config.agent_skills, {}, 'agent_skills should default to empty object');
  });
});

// ─── config-set agent_skills ─────────────────────────────────────────────────

describe('config-set agent_skills', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    // Ensure config exists first
    runCmd(() => cmdConfigEnsureSection(tmpDir, false), HOME_ENV(tmpDir));
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('can set agent_skills via dot notation', () => {
    const result = runCmd(
      () => cmdConfigSet(tmpDir, 'agent_skills.gsd-executor', '["skills/my-skill"]', false),
      HOME_ENV(tmpDir)
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.deepStrictEqual(
      config.agent_skills['gsd-executor'],
      ['skills/my-skill'],
      'Should store array of skill paths'
    );
  });
});
