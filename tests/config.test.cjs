/**
 * GSD Tools Tests - config.cjs
 *
 * Direct in-process tests for config-ensure-section, config-set, and config-get
 * commands by calling the cmdConfig* functions in cap/bin/lib/config.cjs.
 *
 * Requirements: TEST-13
 */

// @cap-decision(CI/issue-42 Path-2 PR-2.3) Migrated 77 runGsdTools spawn
// callsites to direct cmdConfig* in-process calls. Removes ~2.3s of spawn
// overhead. Tracks issue #42 Path 2 plan in scripts/run-tests.cjs:39-53.

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createTempProject, cleanup } = require('./helpers.cjs');
const configMod = require('../cap/bin/lib/config.cjs');

/**
 * In-process equivalent of runGsdTools that captures stdout, stderr, and
 * process.exit(). Returns the same {success, output, error} shape so the
 * existing test bodies need no further changes beyond swapping the call.
 *
 * Pattern follows tests/commands.test.cjs runCmd helper (PR #55).
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
 * Like runCmd, but also temporarily overrides process.env for the call.
 * Used to replace runGsdTools(args, cwd, { HOME: tmpDir, USERPROFILE: tmpDir })
 * which sandboxed env in the spawned child. In-process, we mutate and restore.
 */
function runCmdWithEnv(envOverrides, fn) {
  const orig = {};
  for (const k of Object.keys(envOverrides)) {
    orig[k] = process.env[k];
    process.env[k] = envOverrides[k];
  }
  try {
    return runCmd(fn);
  } finally {
    for (const k of Object.keys(envOverrides)) {
      if (orig[k] === undefined) delete process.env[k];
      else process.env[k] = orig[k];
    }
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function readConfig(tmpDir) {
  const configPath = path.join(tmpDir, '.planning', 'config.json');
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

function writeConfig(tmpDir, obj) {
  const configPath = path.join(tmpDir, '.planning', 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(obj, null, 2), 'utf-8');
}

/**
 * Helper: capture output from config functions that call core.output().
 * core.output() calls fs.writeSync(1, data) — we intercept fd 1 writes.
 * Used by the legacy "direct unit tests" suite at the bottom of this file.
 */
function captureOutput(fn) {
  const origWriteSync = fs.writeSync;
  let captured = '';
  fs.writeSync = (fd, data) => {
    if (fd === 1) { captured += data; return data.length; }
    return origWriteSync(fd, data);
  };
  try {
    fn();
  } finally {
    fs.writeSync = origWriteSync;
  }
  return captured ? JSON.parse(captured) : null;
}

// ─── config-ensure-section ───────────────────────────────────────────────────

describe('config-ensure-section command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('creates config.json with expected structure and types', () => {
    const result = runCmd(() => configMod.cmdConfigEnsureSection(tmpDir, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.created, true);

    const config = readConfig(tmpDir);
    // Verify structure and types — exact values may vary if ~/.gsd/defaults.json exists
    assert.strictEqual(typeof config.model_profile, 'string');
    assert.strictEqual(typeof config.commit_docs, 'boolean');
    assert.strictEqual(typeof config.parallelization, 'boolean');
    assert.ok(config.git && typeof config.git === 'object', 'git should be an object');
    assert.strictEqual(typeof config.git.branching_strategy, 'string');
    assert.ok(config.workflow && typeof config.workflow === 'object', 'workflow should be an object');
    assert.strictEqual(typeof config.workflow.research, 'boolean');
    assert.strictEqual(typeof config.workflow.plan_check, 'boolean');
    assert.strictEqual(typeof config.workflow.verifier, 'boolean');
    assert.strictEqual(typeof config.workflow.nyquist_validation, 'boolean');
    // These hardcoded defaults are always present (may be overridden by user defaults)
    assert.ok('model_profile' in config, 'model_profile should exist');
    assert.ok('brave_search' in config, 'brave_search should exist');
    assert.ok('search_gitignored' in config, 'search_gitignored should exist');
  });

  test('is idempotent — returns already_exists on second call', () => {
    const first = runCmd(() => configMod.cmdConfigEnsureSection(tmpDir, false));
    assert.ok(first.success, `First call failed: ${first.error}`);
    const firstOutput = JSON.parse(first.output);
    assert.strictEqual(firstOutput.created, true);

    const second = runCmd(() => configMod.cmdConfigEnsureSection(tmpDir, false));
    assert.ok(second.success, `Second call failed: ${second.error}`);
    const secondOutput = JSON.parse(second.output);
    assert.strictEqual(secondOutput.created, false);
    assert.strictEqual(secondOutput.reason, 'already_exists');
  });

  test('detects Brave Search from file-based key', () => {
    // Sandbox HOME=tmpDir for the in-process call so brave_api_key lookup hits
    // the temp dir, not the developer's real ~/.gsd/.
    const gsdDir = path.join(tmpDir, '.gsd');
    fs.mkdirSync(gsdDir, { recursive: true });
    fs.writeFileSync(path.join(gsdDir, 'brave_api_key'), 'test-key', 'utf-8');

    const result = runCmdWithEnv({ HOME: tmpDir, USERPROFILE: tmpDir }, () =>
      configMod.cmdConfigEnsureSection(tmpDir, false)
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.strictEqual(config.brave_search, true);
  });

  test('merges user defaults from defaults.json', () => {
    // Sandbox HOME=tmpDir for the in-process call so defaults.json lookup hits
    // the temp dir, not the developer's real ~/.gsd/.
    const gsdDir = path.join(tmpDir, '.gsd');
    fs.mkdirSync(gsdDir, { recursive: true });
    fs.writeFileSync(path.join(gsdDir, 'defaults.json'), JSON.stringify({
      model_profile: 'quality',
      commit_docs: false,
    }), 'utf-8');

    const result = runCmdWithEnv({ HOME: tmpDir, USERPROFILE: tmpDir }, () =>
      configMod.cmdConfigEnsureSection(tmpDir, false)
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.strictEqual(config.model_profile, 'quality', 'model_profile should be overridden');
    assert.strictEqual(config.commit_docs, false, 'commit_docs should be overridden');
    assert.ok(config.git && typeof config.git === 'object', 'git should be an object');
    assert.strictEqual(typeof config.git.branching_strategy, 'string', 'git.branching_strategy should be a string');
  });

  test('merges nested workflow keys from defaults.json preserving unset keys', () => {
    // Sandbox HOME=tmpDir for the in-process call so defaults.json lookup hits
    // the temp dir, not the developer's real ~/.gsd/.
    const gsdDir = path.join(tmpDir, '.gsd');
    fs.mkdirSync(gsdDir, { recursive: true });
    fs.writeFileSync(path.join(gsdDir, 'defaults.json'), JSON.stringify({
      workflow: { research: false },
    }), 'utf-8');

    const result = runCmdWithEnv({ HOME: tmpDir, USERPROFILE: tmpDir }, () =>
      configMod.cmdConfigEnsureSection(tmpDir, false)
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.strictEqual(config.workflow.research, false, 'research should be overridden');
    assert.strictEqual(typeof config.workflow.plan_check, 'boolean', 'plan_check should be a boolean');
    assert.strictEqual(typeof config.workflow.verifier, 'boolean', 'verifier should be a boolean');
  });
});

// ─── config-set ──────────────────────────────────────────────────────────────

describe('config-set command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    // Create initial config
    runCmd(() => configMod.cmdConfigEnsureSection(tmpDir, false));
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('sets a top-level string value', () => {
    const result = runCmd(() => configMod.cmdConfigSet(tmpDir, 'model_profile', 'quality', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.updated, true);
    assert.strictEqual(output.key, 'model_profile');
    assert.strictEqual(output.value, 'quality');

    const config = readConfig(tmpDir);
    assert.strictEqual(config.model_profile, 'quality');
  });

  test('coerces true to boolean', () => {
    const result = runCmd(() => configMod.cmdConfigSet(tmpDir, 'commit_docs', 'true', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.strictEqual(config.commit_docs, true);
    assert.strictEqual(typeof config.commit_docs, 'boolean');
  });

  test('coerces false to boolean', () => {
    const result = runCmd(() => configMod.cmdConfigSet(tmpDir, 'commit_docs', 'false', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.strictEqual(config.commit_docs, false);
    assert.strictEqual(typeof config.commit_docs, 'boolean');
  });

  test('coerces numeric strings to numbers', () => {
    const result = runCmd(() => configMod.cmdConfigSet(tmpDir, 'granularity', '42', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.strictEqual(config.granularity, 42);
    assert.strictEqual(typeof config.granularity, 'number');
  });

  test('preserves plain strings', () => {
    const result = runCmd(() => configMod.cmdConfigSet(tmpDir, 'model_profile', 'hello', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.strictEqual(config.model_profile, 'hello');
    assert.strictEqual(typeof config.model_profile, 'string');
  });

  test('sets nested values via dot-notation', () => {
    const result = runCmd(() => configMod.cmdConfigSet(tmpDir, 'workflow.research', 'false', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.strictEqual(config.workflow.research, false);
  });

  test('auto-creates nested objects for dot-notation', () => {
    // Start with empty config
    writeConfig(tmpDir, {});

    const result = runCmd(() => configMod.cmdConfigSet(tmpDir, 'workflow.research', 'false', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.strictEqual(config.workflow.research, false);
    assert.strictEqual(typeof config.workflow, 'object');
  });

  test('rejects unknown config keys', () => {
    const result = runCmd(() => configMod.cmdConfigSet(tmpDir, 'workflow.nyquist_validation_enabled', 'false', false));
    assert.strictEqual(result.success, false);
    assert.ok(
      result.error.includes('Unknown config key'),
      `Expected "Unknown config key" in error: ${result.error}`
    );
  });

  test('sets workflow.text_mode for remote session support', () => {
    writeConfig(tmpDir, {});

    const result = runCmd(() => configMod.cmdConfigSet(tmpDir, 'workflow.text_mode', 'true', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.strictEqual(config.workflow.text_mode, true);
  });

  test('errors when no key path provided', () => {
    const result = runCmd(() => configMod.cmdConfigSet(tmpDir, undefined, undefined, false));
    assert.strictEqual(result.success, false);
  });

  test('rejects known invalid nyquist alias keys with a suggestion', () => {
    const result = runCmd(() => configMod.cmdConfigSet(tmpDir, 'workflow.nyquist_validation_enabled', 'false', false));
    assert.strictEqual(result.success, false);
    assert.match(result.error, /Unknown config key: workflow\.nyquist_validation_enabled/);
    assert.match(result.error, /workflow\.nyquist_validation/);

    const config = readConfig(tmpDir);
    assert.strictEqual(config.workflow.nyquist_validation_enabled, undefined);
    assert.strictEqual(config.workflow.nyquist_validation, true);
  });
});

// ─── config-get ──────────────────────────────────────────────────────────────

describe('config-get command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    // Create config with known values — sandbox HOME to avoid global defaults
    runCmdWithEnv({ HOME: tmpDir, USERPROFILE: tmpDir }, () =>
      configMod.cmdConfigEnsureSection(tmpDir, false)
    );
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('gets a top-level value', () => {
    const result = runCmdWithEnv({ HOME: tmpDir, USERPROFILE: tmpDir }, () =>
      configMod.cmdConfigGet(tmpDir, 'model_profile', false)
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output, 'balanced');
  });

  test('gets a nested value via dot-notation', () => {
    const result = runCmd(() => configMod.cmdConfigGet(tmpDir, 'workflow.research', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output, true);
  });

  test('errors for nonexistent key', () => {
    const result = runCmd(() => configMod.cmdConfigGet(tmpDir, 'nonexistent_key', false));
    assert.strictEqual(result.success, false);
    assert.ok(
      result.error.includes('Key not found'),
      `Expected "Key not found" in error: ${result.error}`
    );
  });

  test('errors for deeply nested nonexistent key', () => {
    const result = runCmd(() => configMod.cmdConfigGet(tmpDir, 'workflow.nonexistent', false));
    assert.strictEqual(result.success, false);
    assert.ok(
      result.error.includes('Key not found'),
      `Expected "Key not found" in error: ${result.error}`
    );
  });

  describe('when config.json does not exist', () => {
    let emptyTmpDir;

    beforeEach(() => {
      emptyTmpDir = createTempProject();
    });

    afterEach(() => {
      cleanup(emptyTmpDir);
    });

    test('errors when config.json does not exist', () => {
      const result = runCmd(() => configMod.cmdConfigGet(emptyTmpDir, 'model_profile', false));
      assert.strictEqual(result.success, false);
      assert.ok(
        result.error.includes('No config.json'),
        `Expected "No config.json" in error: ${result.error}`
      );
    });
  });

  test('errors when no key path provided', () => {
    const result = runCmd(() => configMod.cmdConfigGet(tmpDir, undefined, false));
    assert.strictEqual(result.success, false);
  });
});

// ─── config-new-project ───────────────────────────────────────────────────────

describe('config-new-project command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('creates full config with all expected keys', () => {
    const choices = JSON.stringify({
      mode: 'interactive',
      granularity: 'standard',
      parallelization: true,
      commit_docs: true,
      model_profile: 'balanced',
      workflow: { research: true, plan_check: true, verifier: true, nyquist_validation: true },
    });
    const result = runCmdWithEnv({ HOME: tmpDir, USERPROFILE: tmpDir }, () =>
      configMod.cmdConfigNewProject(tmpDir, choices, false)
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);

    // User choices present
    assert.strictEqual(config.mode, 'interactive');
    assert.strictEqual(config.granularity, 'standard');
    assert.strictEqual(config.parallelization, true);
    assert.strictEqual(config.commit_docs, true);
    assert.strictEqual(config.model_profile, 'balanced');

    // Defaults materialized — these were silently missing before
    assert.strictEqual(typeof config.search_gitignored, 'boolean');
    assert.strictEqual(typeof config.brave_search, 'boolean');

    // git section present with all three keys
    assert.ok(config.git && typeof config.git === 'object', 'git section should exist');
    assert.strictEqual(config.git.branching_strategy, 'none');
    assert.strictEqual(config.git.phase_branch_template, 'gsd/phase-{phase}-{slug}');
    assert.strictEqual(config.git.milestone_branch_template, 'gsd/{milestone}-{slug}');

    // workflow section present with all keys
    assert.ok(config.workflow && typeof config.workflow === 'object', 'workflow section should exist');
    assert.strictEqual(config.workflow.research, true);
    assert.strictEqual(config.workflow.plan_check, true);
    assert.strictEqual(config.workflow.verifier, true);
    assert.strictEqual(config.workflow.nyquist_validation, true);
    assert.strictEqual(config.workflow.auto_advance, false);
    assert.strictEqual(config.workflow.node_repair, true);
    assert.strictEqual(config.workflow.node_repair_budget, 2);
    assert.strictEqual(config.workflow.ui_phase, true);
    assert.strictEqual(config.workflow.ui_safety_gate, true);

    // hooks section present
    assert.ok(config.hooks && typeof config.hooks === 'object', 'hooks section should exist');
    assert.strictEqual(config.hooks.context_warnings, true);

    // arc section present with correct defaults (ARC-01)
    assert.ok(config.arc && typeof config.arc === 'object', 'arc section should exist');
    assert.strictEqual(config.arc.enabled, true, 'arc.enabled should default to true');
    assert.strictEqual(config.arc.tag_prefix, '@cap-', 'arc.tag_prefix should default to @cap-');
  });

  test('user choices override defaults', () => {
    const choices = JSON.stringify({
      mode: 'yolo',
      granularity: 'coarse',
      parallelization: false,
      commit_docs: false,
      model_profile: 'quality',
      workflow: { research: false, plan_check: false, verifier: true, nyquist_validation: false },
    });
    const result = runCmdWithEnv({ HOME: tmpDir, USERPROFILE: tmpDir }, () =>
      configMod.cmdConfigNewProject(tmpDir, choices, false)
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.strictEqual(config.mode, 'yolo');
    assert.strictEqual(config.granularity, 'coarse');
    assert.strictEqual(config.parallelization, false);
    assert.strictEqual(config.commit_docs, false);
    assert.strictEqual(config.model_profile, 'quality');
    assert.strictEqual(config.workflow.research, false);
    assert.strictEqual(config.workflow.plan_check, false);
    assert.strictEqual(config.workflow.verifier, true);
    assert.strictEqual(config.workflow.nyquist_validation, false);
    // Defaults still present for non-chosen keys
    assert.strictEqual(config.git.branching_strategy, 'none');
    assert.strictEqual(typeof config.search_gitignored, 'boolean');
  });

  test('explicit arc.enabled false is preserved (ARC-02)', () => {
    const choices = JSON.stringify({
      mode: 'interactive',
      granularity: 'standard',
      arc: { enabled: false },
    });
    const result = runCmdWithEnv({ HOME: tmpDir, USERPROFILE: tmpDir }, () =>
      configMod.cmdConfigNewProject(tmpDir, choices, false)
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.strictEqual(config.arc.enabled, false, 'explicit arc.enabled: false must be preserved');
  });

  test('works with empty choices — all defaults materialized', () => {
    const result = runCmdWithEnv({ HOME: tmpDir, USERPROFILE: tmpDir }, () =>
      configMod.cmdConfigNewProject(tmpDir, '{}', false)
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.strictEqual(config.model_profile, 'balanced');
    assert.strictEqual(config.commit_docs, true);
    assert.strictEqual(config.parallelization, true);
    assert.strictEqual(config.search_gitignored, false);
    assert.ok(config.git && typeof config.git === 'object');
    assert.strictEqual(config.git.branching_strategy, 'none');
    assert.ok(config.workflow && typeof config.workflow === 'object');
    assert.strictEqual(config.workflow.nyquist_validation, true);
    assert.strictEqual(config.workflow.auto_advance, false);
    assert.strictEqual(config.workflow.node_repair, true);
    assert.strictEqual(config.workflow.node_repair_budget, 2);
    assert.strictEqual(config.workflow.ui_phase, true);
    assert.strictEqual(config.workflow.ui_safety_gate, true);
    assert.ok(config.hooks && typeof config.hooks === 'object');
    assert.strictEqual(config.hooks.context_warnings, true);
  });

  test('is idempotent — returns already_exists if config exists', () => {
    const choices = JSON.stringify({ mode: 'yolo', granularity: 'fine' });

    const first = runCmd(() => configMod.cmdConfigNewProject(tmpDir, choices, false));
    assert.ok(first.success, `First call failed: ${first.error}`);
    const firstOut = JSON.parse(first.output);
    assert.strictEqual(firstOut.created, true);

    const second = runCmd(() => configMod.cmdConfigNewProject(tmpDir, choices, false));
    assert.ok(second.success, `Second call failed: ${second.error}`);
    const secondOut = JSON.parse(second.output);
    assert.strictEqual(secondOut.created, false);
    assert.strictEqual(secondOut.reason, 'already_exists');

    // Config unchanged
    const config = readConfig(tmpDir);
    assert.strictEqual(config.mode, 'yolo');
    assert.strictEqual(config.granularity, 'fine');
  });

  test('auto_advance in workflow choices is preserved', () => {
    const choices = JSON.stringify({
      mode: 'yolo',
      granularity: 'standard',
      workflow: { research: true, plan_check: true, verifier: true, nyquist_validation: true, auto_advance: true },
    });
    const result = runCmd(() => configMod.cmdConfigNewProject(tmpDir, choices, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.strictEqual(config.workflow.auto_advance, true);
  });

  test('rejects invalid JSON choices', () => {
    const result = runCmd(() => configMod.cmdConfigNewProject(tmpDir, '{not-json}', false));
    assert.strictEqual(result.success, false);
    assert.ok(result.error.includes('Invalid JSON'), `Expected "Invalid JSON" in: ${result.error}`);
  });

  test('output has created:true and path on success', () => {
    const choices = JSON.stringify({ mode: 'interactive', granularity: 'standard' });
    const result = runCmd(() => configMod.cmdConfigNewProject(tmpDir, choices, false));
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.strictEqual(out.created, true);
    assert.strictEqual(out.path, '.planning/config.json');
  });
});

// ─── config-set (research_before_questions and discuss_mode) ──────────────────

describe('config-set research_before_questions and discuss_mode', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    runCmdWithEnv({ HOME: tmpDir, USERPROFILE: tmpDir }, () =>
      configMod.cmdConfigEnsureSection(tmpDir, false)
    );
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('workflow.research_before_questions is a valid config key', () => {
    const result = runCmd(() => configMod.cmdConfigSet(tmpDir, 'workflow.research_before_questions', 'true', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.strictEqual(config.workflow.research_before_questions, true);
  });

  test('workflow.discuss_mode is a valid config key', () => {
    const result = runCmd(() => configMod.cmdConfigSet(tmpDir, 'workflow.discuss_mode', 'assumptions', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.strictEqual(config.workflow.discuss_mode, 'assumptions');
  });

  test('research_before_questions defaults to false in new configs', () => {
    const config = readConfig(tmpDir);
    assert.strictEqual(config.workflow.research_before_questions, false);
  });

  test('discuss_mode defaults to discuss in new configs', () => {
    const config = readConfig(tmpDir);
    assert.strictEqual(config.workflow.discuss_mode, 'discuss');
  });

  test('hooks.research_questions is rejected with suggestion', () => {
    const result = runCmd(() => configMod.cmdConfigSet(tmpDir, 'hooks.research_questions', 'true', false));
    assert.strictEqual(result.success, false);
    assert.ok(
      result.error.includes('Unknown config key'),
      `Expected "Unknown config key" in error: ${result.error}`
    );
    assert.ok(
      result.error.includes('workflow.research_before_questions'),
      `Expected suggestion for workflow.research_before_questions in error: ${result.error}`
    );
  });
});

// ─── config-set (additional coverage) ────────────────────────────────────────

describe('config-set unknown key (no suggestion)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    runCmd(() => configMod.cmdConfigEnsureSection(tmpDir, false));
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('rejects a key that has no suggestion', () => {
    const result = runCmd(() => configMod.cmdConfigSet(tmpDir, 'totally.unknown.key', 'value', false));
    assert.strictEqual(result.success, false);
    assert.ok(
      result.error.includes('Unknown config key'),
      `Expected "Unknown config key" in error: ${result.error}`
    );
  });
});

// ─── config-get (additional coverage) ────────────────────────────────────────

describe('config-get edge cases', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('errors when traversing a dot-path through a non-object value', () => {
    // model_profile is a string — requesting model_profile.something traverses into a non-object
    writeConfig(tmpDir, { model_profile: 'balanced' });
    const result = runCmd(() => configMod.cmdConfigGet(tmpDir, 'model_profile.something', false));
    assert.strictEqual(result.success, false);
    assert.ok(
      result.error.includes('Key not found'),
      `Expected "Key not found" in error: ${result.error}`
    );
  });

  test('errors when config.json contains malformed JSON', () => {
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
    fs.writeFileSync(configPath, '{not valid json', 'utf-8');
    const result = runCmd(() => configMod.cmdConfigGet(tmpDir, 'model_profile', false));
    assert.strictEqual(result.success, false);
    assert.ok(
      result.error.includes('Failed to read config.json'),
      `Expected "Failed to read config.json" in error: ${result.error}`
    );
  });
});

// ─── config-set-model-profile ─────────────────────────────────────────────────

describe('config-set-model-profile command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    runCmdWithEnv({ HOME: tmpDir, USERPROFILE: tmpDir }, () =>
      configMod.cmdConfigEnsureSection(tmpDir, false)
    );
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('sets a valid profile and updates config', () => {
    const result = runCmd(() => configMod.cmdConfigSetModelProfile(tmpDir, 'quality', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const out = JSON.parse(result.output);
    assert.strictEqual(out.updated, true);
    assert.strictEqual(out.profile, 'quality');
    assert.ok(out.agentToModelMap && typeof out.agentToModelMap === 'object');

    const config = readConfig(tmpDir);
    assert.strictEqual(config.model_profile, 'quality');
  });

  test('reports previous profile in output', () => {
    const result = runCmdWithEnv({ HOME: tmpDir, USERPROFILE: tmpDir }, () =>
      configMod.cmdConfigSetModelProfile(tmpDir, 'budget', false)
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const out = JSON.parse(result.output);
    assert.strictEqual(out.previousProfile, 'balanced'); // default was balanced
    assert.strictEqual(out.profile, 'budget');
  });

  test('setting the same profile is a no-op on config but still succeeds', () => {
    // Set to quality first, then set to quality again
    runCmd(() => configMod.cmdConfigSetModelProfile(tmpDir, 'quality', false));
    const result = runCmd(() => configMod.cmdConfigSetModelProfile(tmpDir, 'quality', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const out = JSON.parse(result.output);
    assert.strictEqual(out.profile, 'quality');
    assert.strictEqual(out.previousProfile, 'quality');
  });

  test('is case-insensitive', () => {
    const result = runCmd(() => configMod.cmdConfigSetModelProfile(tmpDir, 'BALANCED', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.strictEqual(config.model_profile, 'balanced');
  });

  test('rejects invalid profile', () => {
    const result = runCmd(() => configMod.cmdConfigSetModelProfile(tmpDir, 'turbo', false));
    assert.strictEqual(result.success, false);
    assert.ok(
      result.error.includes('Invalid profile'),
      `Expected "Invalid profile" in error: ${result.error}`
    );
  });

  test('errors when no profile provided', () => {
    const result = runCmd(() => configMod.cmdConfigSetModelProfile(tmpDir, undefined, false));
    assert.strictEqual(result.success, false);
  });

  describe('when config is missing', () => {
    let emptyDir;

    beforeEach(() => {
      emptyDir = createTempProject();
    });

    afterEach(() => {
      cleanup(emptyDir);
    });

    test('creates config if missing before setting profile', () => {
      const result = runCmd(() => configMod.cmdConfigSetModelProfile(emptyDir, 'budget', false));
      assert.ok(result.success, `Command failed: ${result.error}`);

      const config = readConfig(emptyDir);
      assert.strictEqual(config.model_profile, 'budget');
    });
  });
});

// ─── config-set (workflow.skip_discuss) ───────────────────────────────────────

describe('config-set workflow.skip_discuss', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    runCmd(() => configMod.cmdConfigEnsureSection(tmpDir, false));
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('workflow.skip_discuss is a valid config key', () => {
    const result = runCmd(() => configMod.cmdConfigSet(tmpDir, 'workflow.skip_discuss', 'true', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.strictEqual(config.workflow.skip_discuss, true);
  });

  test('skip_discuss defaults to false in new configs', () => {
    const config = readConfig(tmpDir);
    assert.strictEqual(config.workflow.skip_discuss, false);
  });

  test('skip_discuss can be toggled back to false', () => {
    runCmd(() => configMod.cmdConfigSet(tmpDir, 'workflow.skip_discuss', 'true', false));
    const result = runCmd(() => configMod.cmdConfigSet(tmpDir, 'workflow.skip_discuss', 'false', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.strictEqual(config.workflow.skip_discuss, false);
  });

  describe('skip_discuss in config-new-project', () => {
    let emptyDir;

    beforeEach(() => {
      emptyDir = createTempProject();
    });

    afterEach(() => {
      cleanup(emptyDir);
    });

    test('skip_discuss is present in config-new-project output', () => {
      const result = runCmdWithEnv({ HOME: emptyDir, USERPROFILE: emptyDir }, () =>
        configMod.cmdConfigNewProject(emptyDir, '{}', false)
      );
      assert.ok(result.success, `Command failed: ${result.error}`);

      const config = readConfig(emptyDir);
      assert.strictEqual(config.workflow.skip_discuss, false, 'skip_discuss should default to false');
    });

    test('skip_discuss can be set via config-new-project choices', () => {
      const choices = JSON.stringify({
        workflow: { skip_discuss: true },
      });
      const result = runCmdWithEnv({ HOME: emptyDir, USERPROFILE: emptyDir }, () =>
        configMod.cmdConfigNewProject(emptyDir, choices, false)
      );
      assert.ok(result.success, `Command failed: ${result.error}`);

      const config = readConfig(emptyDir);
      assert.strictEqual(config.workflow.skip_discuss, true);
    });
  });

  test('config-get workflow.skip_discuss returns the set value', () => {
    runCmd(() => configMod.cmdConfigSet(tmpDir, 'workflow.skip_discuss', 'true', false));
    const result = runCmd(() => configMod.cmdConfigGet(tmpDir, 'workflow.skip_discuss', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output, true);
  });
});

// ─── config-set JSON array/object values ────────────────────────────────────

describe('config-set JSON value parsing', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    runCmd(() => configMod.cmdConfigEnsureSection(tmpDir, false));
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('parses JSON array value', () => {
    const result = runCmd(() => configMod.cmdConfigSet(tmpDir, 'arc.comment_anchors', '["//","#"]', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.deepStrictEqual(config.arc.comment_anchors, ['//', '#']);
  });

  test('parses JSON object value', () => {
    const result = runCmd(() => configMod.cmdConfigSet(tmpDir, 'arc.comment_anchors', '{"a":1}', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.deepStrictEqual(config.arc.comment_anchors, { a: 1 });
  });

  test('keeps invalid JSON as string', () => {
    const result = runCmd(() => configMod.cmdConfigSet(tmpDir, 'arc.tag_prefix', '{broken', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.strictEqual(config.arc.tag_prefix, '{broken');
  });

  test('empty string value is kept as empty string (not coerced to number)', () => {
    // Empty value "" is not NaN and not '', so it stays as string
    const result = runCmd(() => configMod.cmdConfigSet(tmpDir, 'arc.tag_prefix', '', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.strictEqual(config.arc.tag_prefix, '');
  });
});

// ─── config-set dynamic keys (agent_skills, phase_modes) ────────────────────

describe('config-set dynamic keys', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    runCmd(() => configMod.cmdConfigEnsureSection(tmpDir, false));
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('accepts agent_skills.<agent-type> as valid key', () => {
    const result = runCmd(() => configMod.cmdConfigSet(tmpDir, 'agent_skills.researcher', 'true', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.strictEqual(config.agent_skills.researcher, true);
  });

  test('accepts phase_modes.<number> as valid key', () => {
    const result = runCmd(() => configMod.cmdConfigSet(tmpDir, 'phase_modes.3', 'code-first', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.strictEqual(config.phase_modes['3'], 'code-first');
  });
});

// ─── config-set-model-profile raw output message ────────────────────────────

describe('config-set-model-profile raw output', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    runCmdWithEnv({ HOME: tmpDir, USERPROFILE: tmpDir }, () =>
      configMod.cmdConfigEnsureSection(tmpDir, false)
    );
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('raw output shows "was:" when profile changes', () => {
    // First set to quality with raw=true; assertion only checks success.
    const result = runCmd(() => configMod.cmdConfigSetModelProfile(tmpDir, 'quality', true));
    assert.ok(result.success, `Command failed: ${result.error}`);
  });

  test('setting same profile shows "already set"', () => {
    // Set to balanced (which is the default), then set again
    const result = runCmdWithEnv({ HOME: tmpDir, USERPROFILE: tmpDir }, () =>
      configMod.cmdConfigSetModelProfile(tmpDir, 'balanced', false)
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const out = JSON.parse(result.output);
    assert.strictEqual(out.profile, 'balanced');
    assert.strictEqual(out.previousProfile, 'balanced');
  });
});

// ─── buildNewProjectConfig depth migration ──────────────────────────────────

describe('buildNewProjectConfig depth migration', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('migrates deprecated depth key to granularity in defaults.json', () => {
    const gsdDir = path.join(tmpDir, '.gsd');
    fs.mkdirSync(gsdDir, { recursive: true });
    fs.writeFileSync(path.join(gsdDir, 'defaults.json'), JSON.stringify({
      depth: 'comprehensive',
    }), 'utf-8');

    const result = runCmdWithEnv({ HOME: tmpDir, USERPROFILE: tmpDir }, () =>
      configMod.cmdConfigNewProject(tmpDir, '{}', false)
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.strictEqual(config.granularity, 'fine', 'comprehensive should map to fine');

    // Verify the defaults.json was also updated
    const updatedDefaults = JSON.parse(fs.readFileSync(path.join(gsdDir, 'defaults.json'), 'utf-8'));
    assert.strictEqual(updatedDefaults.granularity, 'fine');
    assert.strictEqual(updatedDefaults.depth, undefined, 'depth key should be removed');
  });

  test('detects firecrawl key from file', () => {
    const gsdDir = path.join(tmpDir, '.gsd');
    fs.mkdirSync(gsdDir, { recursive: true });
    fs.writeFileSync(path.join(gsdDir, 'firecrawl_api_key'), 'test-key', 'utf-8');

    const result = runCmdWithEnv({ HOME: tmpDir, USERPROFILE: tmpDir }, () =>
      configMod.cmdConfigNewProject(tmpDir, '{}', false)
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.strictEqual(config.firecrawl, true);
  });

  test('detects exa_search key from file', () => {
    const gsdDir = path.join(tmpDir, '.gsd');
    fs.mkdirSync(gsdDir, { recursive: true });
    fs.writeFileSync(path.join(gsdDir, 'exa_api_key'), 'test-key', 'utf-8');

    const result = runCmdWithEnv({ HOME: tmpDir, USERPROFILE: tmpDir }, () =>
      configMod.cmdConfigNewProject(tmpDir, '{}', false)
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const cfg = readConfig(tmpDir);
    assert.strictEqual(cfg.exa_search, true);
  });
});

// ─── Direct unit tests (for c8 branch coverage) ────────────────────────────

describe('config direct unit tests — buildNewProjectConfig', () => {
  let origHome;

  beforeEach(() => {
    origHome = process.env.HOME;
    // Sandbox HOME to prevent user defaults from interfering
    const tmpHome = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cfg-home-'));
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    process.env.HOME = origHome;
  });

  test('returns full config with all sections', () => {
    const cfg = configMod.buildNewProjectConfig({});
    assert.strictEqual(cfg.model_profile, 'balanced');
    assert.strictEqual(cfg.commit_docs, true);
    assert.ok(cfg.git && typeof cfg.git === 'object');
    assert.ok(cfg.workflow && typeof cfg.workflow === 'object');
    assert.ok(cfg.hooks && typeof cfg.hooks === 'object');
    assert.ok(cfg.arc && typeof cfg.arc === 'object');
    assert.strictEqual(cfg.default_phase_mode, 'plan-first');
  });

  test('user choices override hardcoded defaults', () => {
    const cfg = configMod.buildNewProjectConfig({
      mode: 'yolo',
      model_profile: 'quality',
      workflow: { research: false },
      git: { branching_strategy: 'phase' },
    });
    assert.strictEqual(cfg.mode, 'yolo');
    assert.strictEqual(cfg.model_profile, 'quality');
    assert.strictEqual(cfg.workflow.research, false);
    assert.strictEqual(cfg.workflow.plan_check, true); // preserved default
    assert.strictEqual(cfg.git.branching_strategy, 'phase');
    assert.strictEqual(cfg.git.phase_branch_template, 'gsd/phase-{phase}-{slug}'); // preserved default
  });

  test('handles null/undefined choices', () => {
    const cfg = configMod.buildNewProjectConfig(null);
    assert.strictEqual(cfg.model_profile, 'balanced');
  });
});

describe('config direct unit tests — setConfigValue', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    // Create a minimal config
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'balanced', workflow: { research: true } }, null, 2)
    );
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('sets a top-level value', () => {
    const result = configMod.setConfigValue(tmpDir, 'model_profile', 'quality');
    assert.strictEqual(result.updated, true);
    assert.strictEqual(result.key, 'model_profile');
    assert.strictEqual(result.value, 'quality');
    assert.strictEqual(result.previousValue, 'balanced');
  });

  test('sets a nested value', () => {
    const result = configMod.setConfigValue(tmpDir, 'workflow.research', false);
    assert.strictEqual(result.updated, true);
    assert.strictEqual(result.value, false);
    assert.strictEqual(result.previousValue, true);
  });

  test('auto-creates intermediate objects for deep paths', () => {
    const result = configMod.setConfigValue(tmpDir, 'deep.nested.key', 'value');
    assert.strictEqual(result.updated, true);

    const cfg = readConfig(tmpDir);
    assert.strictEqual(cfg.deep.nested.key, 'value');
  });

  test('creates config from scratch when file does not exist', () => {
    // Remove config
    fs.unlinkSync(path.join(tmpDir, '.planning', 'config.json'));

    const result = configMod.setConfigValue(tmpDir, 'model_profile', 'budget');
    assert.strictEqual(result.updated, true);

    const cfg = readConfig(tmpDir);
    assert.strictEqual(cfg.model_profile, 'budget');
  });

  test('overwrites non-object intermediate value with object', () => {
    // Set model_profile to a string, then try to use it as parent for nested key
    configMod.setConfigValue(tmpDir, 'model_profile', 'balanced');
    const result = configMod.setConfigValue(tmpDir, 'model_profile.sub', 'value');
    assert.strictEqual(result.updated, true);

    const cfg = readConfig(tmpDir);
    assert.strictEqual(cfg.model_profile.sub, 'value');
  });
});

describe('config direct unit tests — cmdConfigEnsureSection', () => {
  let tmpDir;
  let origHome;

  beforeEach(() => {
    tmpDir = createTempProject();
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    cleanup(tmpDir);
  });

  test('creates config file when it does not exist', () => {
    const result = captureOutput(() => {
      configMod.cmdConfigEnsureSection(tmpDir, false);
    });
    assert.strictEqual(result.created, true);
  });

  test('returns already_exists when config exists', () => {
    // Create config first
    captureOutput(() => configMod.cmdConfigEnsureSection(tmpDir, false));

    const result = captureOutput(() => {
      configMod.cmdConfigEnsureSection(tmpDir, false);
    });
    assert.strictEqual(result.created, false);
    assert.strictEqual(result.reason, 'already_exists');
  });
});

describe('config direct unit tests — cmdConfigSet', () => {
  let tmpDir;
  let origHome;

  beforeEach(() => {
    tmpDir = createTempProject();
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
    captureOutput(() => configMod.cmdConfigEnsureSection(tmpDir, false));
  });

  afterEach(() => {
    process.env.HOME = origHome;
    cleanup(tmpDir);
  });

  test('sets a string value', () => {
    const result = captureOutput(() => {
      configMod.cmdConfigSet(tmpDir, 'model_profile', 'quality', false);
    });
    assert.strictEqual(result.updated, true);
    assert.strictEqual(result.value, 'quality');
  });

  test('coerces true to boolean', () => {
    const result = captureOutput(() => {
      configMod.cmdConfigSet(tmpDir, 'commit_docs', 'true', false);
    });
    assert.strictEqual(result.value, true);
  });

  test('coerces false to boolean', () => {
    const result = captureOutput(() => {
      configMod.cmdConfigSet(tmpDir, 'commit_docs', 'false', false);
    });
    assert.strictEqual(result.value, false);
  });

  test('coerces numeric string to number', () => {
    const result = captureOutput(() => {
      configMod.cmdConfigSet(tmpDir, 'granularity', '42', false);
    });
    assert.strictEqual(result.value, 42);
  });

  test('parses JSON array value', () => {
    const result = captureOutput(() => {
      configMod.cmdConfigSet(tmpDir, 'arc.comment_anchors', '["//","#"]', false);
    });
    assert.deepStrictEqual(result.value, ['//', '#']);
  });

  test('parses JSON object value', () => {
    const result = captureOutput(() => {
      configMod.cmdConfigSet(tmpDir, 'arc.comment_anchors', '{"a":1}', false);
    });
    assert.deepStrictEqual(result.value, { a: 1 });
  });

  test('keeps malformed JSON as string', () => {
    const result = captureOutput(() => {
      configMod.cmdConfigSet(tmpDir, 'arc.tag_prefix', '{broken', false);
    });
    assert.strictEqual(result.value, '{broken');
  });

  test('sets nested value via dot notation', () => {
    const result = captureOutput(() => {
      configMod.cmdConfigSet(tmpDir, 'workflow.research', 'false', false);
    });
    assert.strictEqual(result.value, false);
  });
});

describe('config direct unit tests — cmdConfigGet', () => {
  let tmpDir;
  let origHome;

  beforeEach(() => {
    tmpDir = createTempProject();
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
    captureOutput(() => configMod.cmdConfigEnsureSection(tmpDir, false));
  });

  afterEach(() => {
    process.env.HOME = origHome;
    cleanup(tmpDir);
  });

  test('gets a top-level value', () => {
    const result = captureOutput(() => {
      configMod.cmdConfigGet(tmpDir, 'model_profile', false);
    });
    assert.strictEqual(result, 'balanced');
  });

  test('gets a nested value', () => {
    const result = captureOutput(() => {
      configMod.cmdConfigGet(tmpDir, 'workflow.research', false);
    });
    assert.strictEqual(result, true);
  });
});

describe('config direct unit tests — cmdConfigNewProject', () => {
  let tmpDir;
  let origHome;

  beforeEach(() => {
    tmpDir = createTempProject();
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    cleanup(tmpDir);
  });

  test('creates config with choices', () => {
    const choices = JSON.stringify({ mode: 'yolo', granularity: 'fine' });
    const result = captureOutput(() => {
      configMod.cmdConfigNewProject(tmpDir, choices, false);
    });
    assert.strictEqual(result.created, true);

    const cfg = readConfig(tmpDir);
    assert.strictEqual(cfg.mode, 'yolo');
    assert.strictEqual(cfg.granularity, 'fine');
  });

  test('is idempotent', () => {
    captureOutput(() => configMod.cmdConfigNewProject(tmpDir, '{}', false));

    const result = captureOutput(() => {
      configMod.cmdConfigNewProject(tmpDir, '{}', false);
    });
    assert.strictEqual(result.created, false);
    assert.strictEqual(result.reason, 'already_exists');
  });

  test('handles empty/null choices', () => {
    const result = captureOutput(() => {
      configMod.cmdConfigNewProject(tmpDir, '', false);
    });
    assert.strictEqual(result.created, true);
  });
});

describe('config direct unit tests — cmdConfigSetModelProfile', () => {
  let tmpDir;
  let origHome;

  beforeEach(() => {
    tmpDir = createTempProject();
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
    captureOutput(() => configMod.cmdConfigEnsureSection(tmpDir, false));
  });

  afterEach(() => {
    process.env.HOME = origHome;
    cleanup(tmpDir);
  });

  test('sets valid profile and returns agent map', () => {
    const result = captureOutput(() => {
      configMod.cmdConfigSetModelProfile(tmpDir, 'quality', false);
    });
    assert.strictEqual(result.updated, true);
    assert.strictEqual(result.profile, 'quality');
    assert.ok(result.agentToModelMap);
  });

  test('returns previous profile', () => {
    const result = captureOutput(() => {
      configMod.cmdConfigSetModelProfile(tmpDir, 'budget', false);
    });
    assert.strictEqual(result.previousProfile, 'balanced');
    assert.strictEqual(result.profile, 'budget');
  });

  test('is case-insensitive', () => {
    const result = captureOutput(() => {
      configMod.cmdConfigSetModelProfile(tmpDir, 'BALANCED', false);
    });
    assert.strictEqual(result.profile, 'balanced');
  });
});
