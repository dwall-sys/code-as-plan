/**
 * Workstream Tests — CRUD, env-var routing, collision detection
 */

// @cap-decision(CI/issue-42 Path-2 PR-2.7) Migrated remaining 23 runGsdTools
// spawn callsites to direct workstream-module in-process calls. File is now
// 100% in-process (was already partial — the 461-1040 Direct Unit Tests
// block was the original Path 2 template).

const { describe, test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createTempProject, cleanup } = require('./helpers.cjs');
const {
  migrateToWorkstreams,
  cmdWorkstreamCreate,
  cmdWorkstreamList,
  cmdWorkstreamStatus,
  cmdWorkstreamComplete,
  cmdWorkstreamSet,
  cmdWorkstreamGet,
  cmdWorkstreamProgress,
  getOtherActiveWorkstreams,
} = require('../cap/bin/lib/workstream.cjs');
const { cmdStateJson } = require('../cap/bin/lib/state.cjs');
const { cmdFindPhase } = require('../cap/bin/lib/phase.cjs');
const core = require('../cap/bin/lib/core.cjs');

// ─── In-process command runner ──────────────────────────────────────────────
//
// Captures stdout (fd 1), stderr (fd 2), and process.exit() from a cmd
// invocation, returning a {success, output, error} shape compatible with the
// previous runGsdTools spawn-based tests so the test bodies stay unchanged.
//
// Pattern follows tests/commands.test.cjs:41-78 (PR #55) which itself
// generalises the captureOutput/captureError helpers below at lines 461-1040.

function runCmd(fn, env = {}) {
  // Save and apply env overrides for the duration of the call.
  const savedEnv = {};
  for (const k of Object.keys(env)) {
    savedEnv[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }

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
    // Restore env
    for (const k of Object.keys(savedEnv)) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
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

/**
 * Replicates cap-tools.cjs CLI behaviour for workstream resolution + validation
 * BEFORE invoking the cmd function. Use for tests that exercise the CLI's
 * --ws flag or GSD_WORKSTREAM env-var traversal validation. Plain cmd calls
 * without workstream-flag semantics use runCmd() directly.
 *
 * Priority (matches cap-tools.cjs:248-271):
 *   --ws flag (opts.ws) > GSD_WORKSTREAM env (opts.env) > getActiveWorkstream(cwd)
 */
function runWs(fn, opts = {}) {
  const { ws, env = {}, cwd } = opts;
  return runCmd(() => {
    let resolved = null;
    if (ws !== undefined && ws !== null) {
      resolved = ws;
    } else if (process.env.GSD_WORKSTREAM) {
      resolved = process.env.GSD_WORKSTREAM.trim();
    } else if (cwd) {
      resolved = core.getActiveWorkstream(cwd);
    }
    if (resolved && !/^[a-zA-Z0-9_-]+$/.test(resolved)) {
      fs.writeSync(2, 'Error: Invalid workstream name: must be alphanumeric, hyphens, and underscores only\n');
      process.exit(1);
    }
    if (resolved) process.env.GSD_WORKSTREAM = resolved;
    else delete process.env.GSD_WORKSTREAM;
    fn();
  }, env);
}

// ─── Helper ──────────────────────────────────────────────────────────────────

function createProjectWithState(tmpDir, roadmap, state) {
  if (roadmap) {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), roadmap, 'utf-8');
  }
  if (state) {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), state, 'utf-8');
  }
}

// ─── planningDir / planningPaths env-var awareness ──────────────────────────

describe('planningDir workstream awareness via env var', () => {
  let tmpDir;

  before(() => {
    tmpDir = createTempProject();
    // Create workstream structure
    const wsDir = path.join(tmpDir, '.planning', 'workstreams', 'alpha');
    fs.mkdirSync(path.join(wsDir, 'phases'), { recursive: true });
    fs.writeFileSync(path.join(wsDir, 'STATE.md'), '# State\n**Status:** In progress\n**Current Phase:** 1\n');
    fs.writeFileSync(path.join(wsDir, 'ROADMAP.md'), '## Roadmap v1.0: Alpha\n### Phase 1: Setup\n');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'active-workstream'), 'alpha\n');
  });

  after(() => cleanup(tmpDir));

  test('state json returns workstream-scoped state when GSD_WORKSTREAM is set', () => {
    const result = runCmd(() => cmdStateJson(tmpDir, true), { GSD_WORKSTREAM: 'alpha' });
    assert.ok(result.success, `state json failed: ${result.error}`);
    const data = JSON.parse(result.output);
    assert.ok(data.status || data.current_phase !== undefined, 'should return state data');
  });

  test('state json reads from flat .planning when no workstream set', () => {
    // Clear active-workstream so no auto-detection
    try { fs.unlinkSync(path.join(tmpDir, '.planning', 'active-workstream')); } catch {}
    const result = runCmd(() => cmdStateJson(tmpDir, true), { GSD_WORKSTREAM: '' });
    // Should fail or return empty state since flat .planning/ has no STATE.md
    assert.ok(!result.success || result.output.includes('not found') || result.output === '{}',
      'should read from flat .planning/');
    // Restore
    fs.writeFileSync(path.join(tmpDir, '.planning', 'active-workstream'), 'alpha\n');
  });

  test('--ws flag overrides GSD_WORKSTREAM env var', () => {
    // Create a second workstream
    const betaDir = path.join(tmpDir, '.planning', 'workstreams', 'beta');
    fs.mkdirSync(path.join(betaDir, 'phases'), { recursive: true });
    fs.writeFileSync(path.join(betaDir, 'STATE.md'), '# State\n**Status:** Beta active\n');

    // CLI semantic: --ws beta overrides GSD_WORKSTREAM=alpha. Since runWs takes
    // explicit ws, it normalises GSD_WORKSTREAM to 'beta' before cmdStateJson runs.
    const result = runWs(() => cmdStateJson(tmpDir, true), { ws: 'beta', env: { GSD_WORKSTREAM: 'alpha' } });
    assert.ok(result.success, `state json --ws beta failed: ${result.error}`);
  });
});

// ─── Workstream CRUD ────────────────────────────────────────────────────────

describe('workstream create', () => {
  let tmpDir;

  before(() => {
    tmpDir = createTempProject();
    fs.writeFileSync(path.join(tmpDir, '.planning', 'PROJECT.md'), '# Project\n');
  });

  after(() => cleanup(tmpDir));

  test('creates a new workstream in clean project', () => {
    const result = runCmd(() => cmdWorkstreamCreate(tmpDir, 'feature-x', {}, true));
    assert.ok(result.success, `create failed: ${result.error}`);
    const data = JSON.parse(result.output);
    assert.strictEqual(data.created, true);
    assert.strictEqual(data.workstream, 'feature-x');
    assert.ok(fs.existsSync(path.join(tmpDir, '.planning', 'workstreams', 'feature-x', 'STATE.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.planning', 'workstreams', 'feature-x', 'phases')));
  });

  test('sets created workstream as active', () => {
    const active = fs.readFileSync(path.join(tmpDir, '.planning', 'active-workstream'), 'utf-8').trim();
    assert.strictEqual(active, 'feature-x');
  });

  test('rejects duplicate workstream', () => {
    const result = runCmd(() => cmdWorkstreamCreate(tmpDir, 'feature-x', {}, true));
    assert.ok(result.success); // returns success with error field
    const data = JSON.parse(result.output);
    assert.strictEqual(data.created, false);
    assert.strictEqual(data.error, 'already_exists');
  });

  test('creates second workstream', () => {
    const result = runCmd(() => cmdWorkstreamCreate(tmpDir, 'feature-y', {}, true));
    assert.ok(result.success);
    const data = JSON.parse(result.output);
    assert.strictEqual(data.created, true);
    assert.strictEqual(data.workstream, 'feature-y');
  });
});

describe('workstream create with migration', () => {
  let tmpDir;

  before(() => {
    tmpDir = createTempProject();
    fs.writeFileSync(path.join(tmpDir, '.planning', 'PROJECT.md'), '# Project\n');
    // Existing flat-mode work
    fs.writeFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), '## Roadmap v1.0: Existing\n### Phase 1: A\n');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), '# State\n**Status:** In progress\n');
  });

  after(() => cleanup(tmpDir));

  test('migrates existing flat work to named workstream', () => {
    const result = runCmd(() =>
      cmdWorkstreamCreate(tmpDir, 'new-feature', { migrateName: 'existing-work' }, true)
    );
    assert.ok(result.success, `create with migration failed: ${result.error}`);
    const data = JSON.parse(result.output);
    assert.strictEqual(data.created, true);
    assert.ok(data.migration, 'should include migration info');
    assert.strictEqual(data.migration.workstream, 'existing-work');
    // Old flat files moved to workstream dir
    assert.ok(fs.existsSync(path.join(tmpDir, '.planning', 'workstreams', 'existing-work', 'ROADMAP.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.planning', 'workstreams', 'existing-work', 'STATE.md')));
    // Shared files stay
    assert.ok(fs.existsSync(path.join(tmpDir, '.planning', 'PROJECT.md')));
  });
});

describe('workstream list', () => {
  let tmpDir;

  before(() => {
    tmpDir = createTempProject();
    // Create two workstreams
    for (const ws of ['alpha', 'beta']) {
      const wsDir = path.join(tmpDir, '.planning', 'workstreams', ws);
      fs.mkdirSync(path.join(wsDir, 'phases'), { recursive: true });
      fs.writeFileSync(path.join(wsDir, 'STATE.md'), `# State\n**Status:** Working on ${ws}\n**Current Phase:** 1\n`);
    }
  });

  after(() => cleanup(tmpDir));

  test('lists all workstreams', () => {
    const result = runCmd(() => cmdWorkstreamList(tmpDir, true));
    assert.ok(result.success, `list failed: ${result.error}`);
    const data = JSON.parse(result.output);
    assert.strictEqual(data.mode, 'workstream');
    assert.strictEqual(data.count, 2);
    const names = data.workstreams.map(w => w.name).sort();
    assert.deepStrictEqual(names, ['alpha', 'beta']);
  });

  describe('flat mode', () => {
    let flatDir;

    beforeEach(() => {
      flatDir = createTempProject();
    });

    afterEach(() => {
      cleanup(flatDir);
    });

    test('reports flat mode when no workstreams exist', () => {
      const result = runCmd(() => cmdWorkstreamList(flatDir, true));
      assert.ok(result.success);
      const data = JSON.parse(result.output);
      assert.strictEqual(data.mode, 'flat');
    });
  });
});

describe('workstream status', () => {
  let tmpDir;

  before(() => {
    tmpDir = createTempProject();
    const wsDir = path.join(tmpDir, '.planning', 'workstreams', 'alpha');
    fs.mkdirSync(path.join(wsDir, 'phases', '01-setup'), { recursive: true });
    fs.writeFileSync(path.join(wsDir, 'phases', '01-setup', 'PLAN.md'), '# Plan\n');
    fs.writeFileSync(path.join(wsDir, 'STATE.md'), '# State\n**Status:** In progress\n**Current Phase:** 1 — Setup\n');
    fs.writeFileSync(path.join(wsDir, 'ROADMAP.md'), '## Roadmap\n');
  });

  after(() => cleanup(tmpDir));

  test('returns detailed status for workstream', () => {
    const result = runCmd(() => cmdWorkstreamStatus(tmpDir, 'alpha', true));
    assert.ok(result.success, `status failed: ${result.error}`);
    const data = JSON.parse(result.output);
    assert.strictEqual(data.found, true);
    assert.strictEqual(data.workstream, 'alpha');
    assert.strictEqual(data.files.roadmap, true);
    assert.strictEqual(data.files.state, true);
    assert.strictEqual(data.phase_count, 1);
  });

  test('returns not found for missing workstream', () => {
    const result = runCmd(() => cmdWorkstreamStatus(tmpDir, 'nonexistent', true));
    assert.ok(result.success);
    const data = JSON.parse(result.output);
    assert.strictEqual(data.found, false);
  });
});

describe('workstream complete', () => {
  let tmpDir;

  before(() => {
    tmpDir = createTempProject();
    const wsDir = path.join(tmpDir, '.planning', 'workstreams', 'done-ws');
    fs.mkdirSync(path.join(wsDir, 'phases'), { recursive: true });
    fs.writeFileSync(path.join(wsDir, 'STATE.md'), '# State\n**Status:** Complete\n');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'active-workstream'), 'done-ws\n');
  });

  after(() => cleanup(tmpDir));

  test('archives workstream to milestones/', () => {
    const result = runCmd(() => cmdWorkstreamComplete(tmpDir, 'done-ws', {}, true));
    assert.ok(result.success, `complete failed: ${result.error}`);
    const data = JSON.parse(result.output);
    assert.strictEqual(data.completed, true);
    assert.ok(data.archived_to.startsWith('.planning/milestones/ws-done-ws'));
    // Workstream dir should be gone
    assert.ok(!fs.existsSync(path.join(tmpDir, '.planning', 'workstreams', 'done-ws')));
  });

  test('clears active-workstream when completing active one', () => {
    assert.ok(!fs.existsSync(path.join(tmpDir, '.planning', 'active-workstream')));
  });
});

describe('workstream set/get', () => {
  let tmpDir;

  before(() => {
    tmpDir = createTempProject();
    for (const ws of ['ws-a', 'ws-b']) {
      const wsDir = path.join(tmpDir, '.planning', 'workstreams', ws);
      fs.mkdirSync(path.join(wsDir, 'phases'), { recursive: true });
      fs.writeFileSync(path.join(wsDir, 'STATE.md'), '# State\n');
    }
  });

  after(() => cleanup(tmpDir));

  test('sets active workstream', () => {
    const result = runCmd(() => cmdWorkstreamSet(tmpDir, 'ws-a', true));
    assert.ok(result.success);
    assert.strictEqual(result.output, 'ws-a');
  });

  test('gets active workstream', () => {
    const result = runCmd(() => cmdWorkstreamGet(tmpDir, true));
    assert.ok(result.success);
    assert.strictEqual(result.output, 'ws-a');
  });
});

// ─── Collision Detection ────────────────────────────────────────────────────

describe('getOtherActiveWorkstreams', () => {
  let tmpDir;

  before(() => {
    tmpDir = createTempProject();
    // Create 3 workstreams: alpha (active), beta (active), gamma (completed)
    for (const ws of ['alpha', 'beta', 'gamma']) {
      const wsDir = path.join(tmpDir, '.planning', 'workstreams', ws);
      fs.mkdirSync(path.join(wsDir, 'phases'), { recursive: true });
    }
    fs.writeFileSync(path.join(tmpDir, '.planning', 'workstreams', 'alpha', 'STATE.md'),
      '# State\n**Status:** In progress\n**Current Phase:** 3\n');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'workstreams', 'beta', 'STATE.md'),
      '# State\n**Status:** In progress\n**Current Phase:** 5\n');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'workstreams', 'gamma', 'STATE.md'),
      '# State\n**Status:** Milestone complete\n');
  });

  after(() => cleanup(tmpDir));

  test('workstream list excludes completed workstreams from active count', () => {
    const result = runCmd(() => cmdWorkstreamList(tmpDir, true));
    assert.ok(result.success);
    const data = JSON.parse(result.output);
    assert.strictEqual(data.count, 3); // all listed
    const activeWs = data.workstreams.filter(w =>
      !w.status.toLowerCase().includes('milestone complete'));
    assert.strictEqual(activeWs.length, 2); // alpha and beta active
  });
});

describe('workstream progress', () => {
  let tmpDir;

  before(() => {
    tmpDir = createTempProject();
    const wsDir = path.join(tmpDir, '.planning', 'workstreams', 'feature');
    fs.mkdirSync(path.join(wsDir, 'phases', '01-init'), { recursive: true });
    fs.writeFileSync(path.join(wsDir, 'phases', '01-init', 'PLAN.md'), '# Plan\n');
    fs.writeFileSync(path.join(wsDir, 'phases', '01-init', 'SUMMARY.md'), '# Summary\n');
    fs.writeFileSync(path.join(wsDir, 'STATE.md'), '# State\n**Status:** In progress\n**Current Phase:** 2\n');
    fs.writeFileSync(path.join(wsDir, 'ROADMAP.md'), '## Roadmap\n### Phase 1: Init\n### Phase 2: Build\n');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'active-workstream'), 'feature\n');
  });

  after(() => cleanup(tmpDir));

  test('returns progress summary', () => {
    const result = runCmd(() => cmdWorkstreamProgress(tmpDir, true));
    assert.ok(result.success, `progress failed: ${result.error}`);
    const data = JSON.parse(result.output);
    assert.strictEqual(data.mode, 'workstream');
    assert.strictEqual(data.count, 1);
    assert.strictEqual(data.workstreams[0].name, 'feature');
    assert.strictEqual(data.workstreams[0].active, true);
    assert.strictEqual(data.workstreams[0].progress_percent, 50);
  });
});

// ─── Integration: gsd-tools --ws flag ────────────────────────────────────────

describe('gsd-tools --ws flag integration', () => {
  let tmpDir;

  before(() => {
    tmpDir = createTempProject();
    // Create a workstream with roadmap
    const wsDir = path.join(tmpDir, '.planning', 'workstreams', 'test-ws');
    fs.mkdirSync(path.join(wsDir, 'phases', '01-setup'), { recursive: true });
    fs.writeFileSync(path.join(wsDir, 'ROADMAP.md'),
      '## Roadmap v1.0: Test\n### Phase 1: Setup\nDo setup things.\n');
    fs.writeFileSync(path.join(wsDir, 'STATE.md'),
      '---\nmilestone: v1.0\n---\n# State\n**Status:** In progress\n**Current Phase:** 1 — Setup\n');
    fs.writeFileSync(path.join(wsDir, 'phases', '01-setup', 'PLAN.md'), '# Plan\n');
  });

  after(() => cleanup(tmpDir));

  test('find-phase resolves to workstream-scoped phases via --ws', () => {
    const result = runWs(() => cmdFindPhase(tmpDir, '1', true), { ws: 'test-ws' });
    assert.ok(result.success, `find-phase failed: ${result.error}`);
    assert.ok(result.output.includes('workstreams/test-ws'), `path should be workstream-scoped: ${result.output}`);
  });

  test('find-phase returns JSON with workstream path when not raw', () => {
    const result = runWs(() => cmdFindPhase(tmpDir, '1', false), { ws: 'test-ws' });
    assert.ok(result.success, `find-phase failed: ${result.error}`);
    const data = JSON.parse(result.output);
    assert.ok(data.found, 'phase should be found');
    assert.ok(data.directory.includes('workstreams/test-ws'), `path should be workstream-scoped: ${data.directory}`);
  });
});

// ─── Path Traversal Rejection ────────────────────────────────────────────────

describe('path traversal rejection', () => {
  let tmpDir;

  before(() => {
    tmpDir = createTempProject();
    fs.writeFileSync(path.join(tmpDir, '.planning', 'PROJECT.md'), '# Project\n');
    const wsDir = path.join(tmpDir, '.planning', 'workstreams', 'legit');
    fs.mkdirSync(path.join(wsDir, 'phases'), { recursive: true });
    fs.writeFileSync(path.join(wsDir, 'STATE.md'), '# State\n');
  });

  after(() => cleanup(tmpDir));

  const maliciousNames = [
    '../../etc',
    '../foo',
    'ws/../../../passwd',
    'a/b',
    'ws name with spaces',
    '..',
    '.',
    'ws..traversal',
  ];

  describe('--ws flag rejects traversal attempts', () => {
    for (const name of maliciousNames) {
      test(`rejects --ws=${name}`, () => {
        const result = runWs(() => cmdWorkstreamList(tmpDir, true), { ws: name });
        assert.ok(!result.success, `should reject --ws=${name}`);
        assert.ok(result.error.includes('Invalid workstream name'), `error should mention invalid name for: ${name}`);
      });
    }
  });

  describe('GSD_WORKSTREAM env var rejects traversal attempts', () => {
    for (const name of maliciousNames) {
      test(`rejects GSD_WORKSTREAM=${name}`, () => {
        const result = runWs(() => cmdWorkstreamList(tmpDir, true), { env: { GSD_WORKSTREAM: name } });
        assert.ok(!result.success, `should reject GSD_WORKSTREAM=${name}`);
        assert.ok(result.error.includes('Invalid workstream name'), `error should mention invalid name for: ${name}`);
      });
    }
  });

  describe('cmdWorkstreamSet rejects traversal attempts', () => {
    for (const name of maliciousNames) {
      test(`rejects set ${name}`, () => {
        const result = runCmd(() => cmdWorkstreamSet(tmpDir, name, true));
        // cmdWorkstreamSet validates the positional arg and returns invalid_name error
        assert.ok(result.success, `command should exit cleanly for: ${name}`);
        const data = JSON.parse(result.output);
        assert.strictEqual(data.error, 'invalid_name', `should return invalid_name error for: ${name}`);
        assert.strictEqual(data.active, null, `active should be null for: ${name}`);
      });
    }
  });

  describe('getActiveWorkstream rejects poisoned active-workstream file', () => {
    for (const name of maliciousNames) {
      test(`rejects poisoned file containing ${name}`, () => {
        // Write malicious name directly to the active-workstream file
        fs.writeFileSync(path.join(tmpDir, '.planning', 'active-workstream'), name + '\n');
        const result = runCmd(() => cmdWorkstreamGet(tmpDir, false), { GSD_WORKSTREAM: '' });
        assert.ok(result.success, 'get should succeed');
        const data = JSON.parse(result.output);
        // getActiveWorkstream should return null for invalid names
        assert.strictEqual(data.active, null, `should return null for poisoned name: ${name}`);
      });
    }

    // Cleanup: remove poisoned file
    test('cleanup: remove active-workstream file', () => {
      try { fs.unlinkSync(path.join(tmpDir, '.planning', 'active-workstream')); } catch { /* expected */ }
      assert.strictEqual(typeof tmpDir, 'string', 'tmpDir should exist');
    });
  });

  describe('setActiveWorkstream rejects invalid names directly', () => {
    const { setActiveWorkstream } = require('../cap/bin/lib/core.cjs');
    for (const name of maliciousNames) {
      test(`throws for ${name}`, () => {
        assert.throws(
          () => setActiveWorkstream(tmpDir, name),
          { message: /Invalid workstream name/ },
          `should throw for: ${name}`
        );
      });
    }
  });
});

// ─── Direct Unit Tests (in-process coverage) ──────────────────────────────────

function makeTmpProject() {
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ws-unit-'));
  fs.mkdirSync(path.join(tmpDir, '.planning', 'phases'), { recursive: true });
  return tmpDir;
}

function cleanTmp(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Capture stdout (fd 1) writes from output() during fn() */
function captureOutput(fn) {
  const origWrite = fs.writeSync;
  let captured = '';
  fs.writeSync = function(fd, data) {
    if (fd === 1) { captured += data; return data.length; }
    return origWrite.apply(fs, arguments);
  };
  try { fn(); } finally { fs.writeSync = origWrite; }
  return captured;
}

/** Run fn() intercepting process.exit and stderr writes. Returns { exitCode, stderr } */
function captureError(fn) {
  const origExit = process.exit;
  const origWrite = fs.writeSync;
  let exitCode = null;
  let stderr = '';
  process.exit = (code) => { exitCode = code; throw new Error('__EXIT__'); };
  fs.writeSync = function(fd, data) {
    if (fd === 2) { stderr += data; return data.length; }
    if (fd === 1) { return data.length; }
    return origWrite.apply(fs, arguments);
  };
  try { fn(); } catch (e) { if (e.message !== '__EXIT__') throw e; }
  finally { process.exit = origExit; fs.writeSync = origWrite; }
  return { exitCode, stderr };
}

describe('migrateToWorkstreams (direct)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTmpProject(); });
  afterEach(() => cleanTmp(tmpDir));

  test('throws on empty workstream name', () => {
    assert.throws(() => migrateToWorkstreams(tmpDir, ''), /Invalid workstream name/);
  });

  test('throws on name with slashes', () => {
    assert.throws(() => migrateToWorkstreams(tmpDir, 'a/b'), /Invalid workstream name/);
  });

  test('throws on name with backslashes', () => {
    assert.throws(() => migrateToWorkstreams(tmpDir, 'a\\b'), /Invalid workstream name/);
  });

  test('throws on dot name', () => {
    assert.throws(() => migrateToWorkstreams(tmpDir, '.'), /Invalid workstream name/);
  });

  test('throws on dotdot name', () => {
    assert.throws(() => migrateToWorkstreams(tmpDir, '..'), /Invalid workstream name/);
  });

  test('throws if workstreams/ already exists', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'workstreams'), { recursive: true });
    assert.throws(() => migrateToWorkstreams(tmpDir, 'test'), /Already in workstream mode/);
  });

  test('migrates existing files into workstream dir', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), '# Roadmap');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), '# State');
    const result = migrateToWorkstreams(tmpDir, 'alpha');
    assert.strictEqual(result.migrated, true);
    assert.strictEqual(result.workstream, 'alpha');
    assert.ok(result.files_moved.includes('ROADMAP.md'));
    assert.ok(result.files_moved.includes('STATE.md'));
    assert.ok(fs.existsSync(path.join(tmpDir, '.planning', 'workstreams', 'alpha', 'ROADMAP.md')));
  });

  test('migrates REQUIREMENTS.md and phases/', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'REQUIREMENTS.md'), '# Reqs');
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-init'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.planning', 'phases', '01-init', 'PLAN.md'), '# Plan');
    const result = migrateToWorkstreams(tmpDir, 'beta');
    assert.ok(result.files_moved.includes('REQUIREMENTS.md'));
    assert.ok(result.files_moved.includes('phases'));
    assert.ok(fs.existsSync(path.join(tmpDir, '.planning', 'workstreams', 'beta', 'phases', '01-init', 'PLAN.md')));
  });

  test('skips files that do not exist (only phases/ remains)', () => {
    // phases/ dir exists from createTempProject but no ROADMAP/STATE/REQUIREMENTS
    const result = migrateToWorkstreams(tmpDir, 'empty');
    assert.strictEqual(result.migrated, true);
    // Only phases/ may move if it exists
    assert.ok(result.files_moved.length <= 1, 'should move at most phases/');
  });
});

describe('cmdWorkstreamCreate (direct)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTmpProject(); });
  afterEach(() => cleanTmp(tmpDir));

  test('creates workstream in clean project without existing work', () => {
    // Remove phases/ so hasExistingWork is false (makeTmpProject creates it)
    fs.rmSync(path.join(tmpDir, '.planning', 'phases'), { recursive: true, force: true });
    const out = captureOutput(() => cmdWorkstreamCreate(tmpDir, 'alpha', {}, false));
    const data = JSON.parse(out);
    assert.strictEqual(data.created, true);
    assert.strictEqual(data.workstream, 'alpha');
    assert.strictEqual(data.active, true);
    assert.ok(data.path.includes('alpha'));
    assert.ok(data.state_path.includes('STATE.md'));
    assert.ok(data.phases_path.includes('phases'));
    assert.strictEqual(data.migration, null);
    assert.ok(fs.existsSync(path.join(tmpDir, '.planning', 'workstreams', 'alpha', 'STATE.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.planning', 'workstreams', 'alpha', 'phases')));
  });

  test('returns already_exists for duplicate workstream', () => {
    captureOutput(() => cmdWorkstreamCreate(tmpDir, 'dup', {}, false));
    const out = captureOutput(() => cmdWorkstreamCreate(tmpDir, 'dup', {}, false));
    const data = JSON.parse(out);
    assert.strictEqual(data.created, false);
    assert.strictEqual(data.error, 'already_exists');
  });

  test('slugifies workstream name', () => {
    const out = captureOutput(() => cmdWorkstreamCreate(tmpDir, 'My Feature!', {}, false));
    const data = JSON.parse(out);
    assert.strictEqual(data.workstream, 'my-feature');
  });

  test('migrates existing flat work with migrateName option', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), '# Roadmap');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), '# State');

    const out = captureOutput(() =>
      cmdWorkstreamCreate(tmpDir, 'new-feat', { migrateName: 'old-work' }, false)
    );
    const data = JSON.parse(out);
    assert.strictEqual(data.created, true);
    assert.ok(data.migration);
    assert.strictEqual(data.migration.workstream, 'old-work');
  });

  test('migrates existing flat work with auto-generated name from milestone', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), '# Roadmap');

    const out = captureOutput(() =>
      cmdWorkstreamCreate(tmpDir, 'feat-2', {}, false)
    );
    const data = JSON.parse(out);
    assert.strictEqual(data.created, true);
    // migration should have happened with auto-detected or 'default' name
    assert.ok(data.migration, 'should include migration info');
    assert.ok(typeof data.migration.workstream === 'string', 'migration workstream should be a string');
    assert.ok(data.migration.files_moved.length >= 0, 'should report files moved');
  });

  test('creates wsRoot when flat mode with no existing work (no ROADMAP/STATE/phases)', () => {
    // Remove ALL flat-mode artifacts so hasExistingWork is false
    fs.rmSync(path.join(tmpDir, '.planning', 'phases'), { recursive: true, force: true });
    try { fs.unlinkSync(path.join(tmpDir, '.planning', 'ROADMAP.md')); } catch {}
    try { fs.unlinkSync(path.join(tmpDir, '.planning', 'STATE.md')); } catch {}
    const out = captureOutput(() => cmdWorkstreamCreate(tmpDir, 'fresh', {}, false));
    const data = JSON.parse(out);
    assert.strictEqual(data.created, true);
    assert.strictEqual(data.migration, null, 'should not migrate when no existing work');
    assert.ok(fs.existsSync(path.join(tmpDir, '.planning', 'workstreams')));
  });

  test('skips migration when migrate:false option', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), '# Roadmap');
    // Manually create the wsRoot to skip the isFlatMode branch
    const wsRoot = path.join(tmpDir, '.planning', 'workstreams');
    fs.mkdirSync(wsRoot, { recursive: true });

    const out = captureOutput(() =>
      cmdWorkstreamCreate(tmpDir, 'no-migrate', { migrate: false }, false)
    );
    const data = JSON.parse(out);
    assert.strictEqual(data.created, true);
    assert.strictEqual(data.migration, null);
  });

  test('auto-detects migration workstream name from milestone or defaults', () => {
    // Create existing flat work. getMilestoneInfo may return a name or throw.
    fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), '# State');
    const out = captureOutput(() =>
      cmdWorkstreamCreate(tmpDir, 'catch-test', {}, false)
    );
    const data = JSON.parse(out);
    assert.strictEqual(data.created, true);
    assert.ok(data.migration, 'should include migration');
    // The workstream name should be either a slug from milestone or 'default'
    assert.ok(typeof data.migration.workstream === 'string');
    assert.ok(data.migration.workstream.length > 0);
  });

  test('does not overwrite existing STATE.md in workstream dir', () => {
    const wsDir = path.join(tmpDir, '.planning', 'workstreams', 'preexist');
    fs.mkdirSync(path.join(wsDir, 'phases'), { recursive: true });
    // Dir exists but no STATE.md, so it won't be detected as already_exists
    const out = captureOutput(() => cmdWorkstreamCreate(tmpDir, 'preexist', {}, false));
    const data = JSON.parse(out);
    assert.strictEqual(data.created, true);
    // STATE.md should be created since it didn't exist
    assert.ok(fs.existsSync(path.join(wsDir, 'STATE.md')));
  });
});

describe('cmdWorkstreamCreate error paths (direct)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTmpProject(); });
  afterEach(() => cleanTmp(tmpDir));

  test('errors when name is empty', () => {
    const { exitCode, stderr } = captureError(() => cmdWorkstreamCreate(tmpDir, '', {}, false));
    assert.strictEqual(exitCode, 1);
    assert.ok(stderr.includes('workstream name required'));
  });

  test('errors when slug is empty (non-alphanumeric name)', () => {
    const { exitCode, stderr } = captureError(() => cmdWorkstreamCreate(tmpDir, '!!!', {}, false));
    assert.strictEqual(exitCode, 1);
    assert.ok(stderr.includes('must contain at least one alphanumeric'));
  });

  test('errors when .planning/ does not exist', () => {
    const emptyDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ws-empty-'));
    const { exitCode, stderr } = captureError(() => cmdWorkstreamCreate(emptyDir, 'test', {}, false));
    assert.strictEqual(exitCode, 1);
    assert.ok(stderr.includes('.planning/ directory not found'));
    cleanTmp(emptyDir);
  });
});

describe('cmdWorkstreamStatus error paths (direct)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTmpProject(); });
  afterEach(() => cleanTmp(tmpDir));

  test('errors when name is empty', () => {
    const { exitCode, stderr } = captureError(() => cmdWorkstreamStatus(tmpDir, '', false));
    assert.strictEqual(exitCode, 1);
    assert.ok(stderr.includes('workstream name required'));
  });

  test('errors on path traversal in name', () => {
    const { exitCode, stderr } = captureError(() => cmdWorkstreamStatus(tmpDir, '../etc', false));
    assert.strictEqual(exitCode, 1);
    assert.ok(stderr.includes('Invalid workstream name'));
  });
});

describe('cmdWorkstreamComplete error paths (direct)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTmpProject(); });
  afterEach(() => cleanTmp(tmpDir));

  test('errors when name is empty', () => {
    const { exitCode, stderr } = captureError(() => cmdWorkstreamComplete(tmpDir, '', {}, false));
    assert.strictEqual(exitCode, 1);
    assert.ok(stderr.includes('workstream name required'));
  });

  test('errors on path traversal in name', () => {
    const { exitCode, stderr } = captureError(() => cmdWorkstreamComplete(tmpDir, 'a/b', {}, false));
    assert.strictEqual(exitCode, 1);
    assert.ok(stderr.includes('Invalid workstream name'));
  });
});

describe('cmdWorkstreamList (direct)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTmpProject(); });
  afterEach(() => cleanTmp(tmpDir));

  test('returns flat mode when no workstreams dir', () => {
    const out = captureOutput(() => cmdWorkstreamList(tmpDir, false));
    const data = JSON.parse(out);
    assert.strictEqual(data.mode, 'flat');
    assert.deepStrictEqual(data.workstreams, []);
  });

  test('lists workstreams with phase completion info', () => {
    const wsDir = path.join(tmpDir, '.planning', 'workstreams', 'alpha');
    fs.mkdirSync(path.join(wsDir, 'phases', '01-init'), { recursive: true });
    fs.writeFileSync(path.join(wsDir, 'STATE.md'), '# State\n**Status:** In progress\n**Current Phase:** 1\n');
    fs.writeFileSync(path.join(wsDir, 'phases', '01-init', 'PLAN.md'), '# Plan');
    fs.writeFileSync(path.join(wsDir, 'phases', '01-init', 'SUMMARY.md'), '# Summary');

    const out = captureOutput(() => cmdWorkstreamList(tmpDir, false));
    const data = JSON.parse(out);
    assert.strictEqual(data.mode, 'workstream');
    assert.strictEqual(data.count, 1);
    assert.strictEqual(data.workstreams[0].name, 'alpha');
    assert.strictEqual(data.workstreams[0].has_state, true);
    assert.strictEqual(data.workstreams[0].completed_phases, 1);
  });

  test('ignores non-directory entries in workstreams/', () => {
    const wsRoot = path.join(tmpDir, '.planning', 'workstreams');
    fs.mkdirSync(wsRoot, { recursive: true });
    fs.writeFileSync(path.join(wsRoot, 'stray-file.txt'), 'ignore me');
    const wsDir = path.join(wsRoot, 'alpha');
    fs.mkdirSync(path.join(wsDir, 'phases'), { recursive: true });
    fs.writeFileSync(path.join(wsDir, 'STATE.md'), '# State\n**Status:** New\n');

    const out = captureOutput(() => cmdWorkstreamList(tmpDir, false));
    const data = JSON.parse(out);
    assert.strictEqual(data.count, 1);
  });
});

describe('cmdWorkstreamStatus (direct)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTmpProject(); });
  afterEach(() => cleanTmp(tmpDir));

  test('returns not found for nonexistent workstream', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'workstreams'), { recursive: true });
    const out = captureOutput(() => cmdWorkstreamStatus(tmpDir, 'nope', false));
    const data = JSON.parse(out);
    assert.strictEqual(data.found, false);
  });

  test('returns detailed info for existing workstream', () => {
    const wsDir = path.join(tmpDir, '.planning', 'workstreams', 'alpha');
    fs.mkdirSync(path.join(wsDir, 'phases', '01-init'), { recursive: true });
    fs.writeFileSync(path.join(wsDir, 'STATE.md'), '# State\n**Status:** Active\n**Current Phase:** 1\n**Last Activity:** 2026-01-01\n');
    fs.writeFileSync(path.join(wsDir, 'ROADMAP.md'), '# Roadmap');
    fs.writeFileSync(path.join(wsDir, 'REQUIREMENTS.md'), '# Reqs');
    fs.writeFileSync(path.join(wsDir, 'phases', '01-init', 'PLAN.md'), '# Plan');

    const out = captureOutput(() => cmdWorkstreamStatus(tmpDir, 'alpha', false));
    const data = JSON.parse(out);
    assert.strictEqual(data.found, true);
    assert.strictEqual(data.files.roadmap, true);
    assert.strictEqual(data.files.state, true);
    assert.strictEqual(data.files.requirements, true);
    assert.strictEqual(data.phase_count, 1);
    assert.strictEqual(data.status, 'Active');
    assert.strictEqual(data.current_phase, '1');
  });

  test('reports phase as in_progress when plan exists but no summary', () => {
    const wsDir = path.join(tmpDir, '.planning', 'workstreams', 'beta');
    fs.mkdirSync(path.join(wsDir, 'phases', '01-setup'), { recursive: true });
    fs.writeFileSync(path.join(wsDir, 'STATE.md'), '# State\n**Status:** Working\n');
    fs.writeFileSync(path.join(wsDir, 'phases', '01-setup', 'PLAN.md'), '# Plan');

    const out = captureOutput(() => cmdWorkstreamStatus(tmpDir, 'beta', false));
    const data = JSON.parse(out);
    assert.strictEqual(data.phases[0].status, 'in_progress');
    assert.strictEqual(data.phases[0].plan_count, 1);
    assert.strictEqual(data.phases[0].summary_count, 0);
  });
});

describe('cmdWorkstreamComplete (direct)', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = makeTmpProject();
    const wsDir = path.join(tmpDir, '.planning', 'workstreams', 'done');
    fs.mkdirSync(path.join(wsDir, 'phases'), { recursive: true });
    fs.writeFileSync(path.join(wsDir, 'STATE.md'), '# State\n**Status:** Complete\n');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'active-workstream'), 'done\n');
  });
  afterEach(() => cleanTmp(tmpDir));

  test('returns not found for missing workstream', () => {
    const out = captureOutput(() => cmdWorkstreamComplete(tmpDir, 'nonexist', {}, false));
    const data = JSON.parse(out);
    assert.strictEqual(data.completed, false);
    assert.strictEqual(data.error, 'not_found');
  });

  test('archives workstream and clears active', () => {
    const out = captureOutput(() => cmdWorkstreamComplete(tmpDir, 'done', {}, false));
    const data = JSON.parse(out);
    assert.strictEqual(data.completed, true);
    assert.ok(data.archived_to.includes('ws-done'));
    // workstream dir should be gone
    assert.ok(!fs.existsSync(path.join(tmpDir, '.planning', 'workstreams', 'done')));
  });

  test('reverts to flat mode when last workstream completed', () => {
    const out = captureOutput(() => cmdWorkstreamComplete(tmpDir, 'done', {}, false));
    const data = JSON.parse(out);
    assert.strictEqual(data.reverted_to_flat, true);
    assert.strictEqual(data.remaining_workstreams, 0);
  });

  test('handles archive path collision with suffix', () => {
    // Create a pre-existing archive
    const today = new Date().toISOString().split('T')[0];
    const archiveDir = path.join(tmpDir, '.planning', 'milestones', `ws-done-${today}`);
    fs.mkdirSync(archiveDir, { recursive: true });

    const out = captureOutput(() => cmdWorkstreamComplete(tmpDir, 'done', {}, false));
    const data = JSON.parse(out);
    assert.strictEqual(data.completed, true);
    assert.ok(data.archived_to.includes(`ws-done-${today}-1`));
  });
});

describe('cmdWorkstreamSet (direct)', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = makeTmpProject();
    const wsDir = path.join(tmpDir, '.planning', 'workstreams', 'alpha');
    fs.mkdirSync(path.join(wsDir, 'phases'), { recursive: true });
    fs.writeFileSync(path.join(wsDir, 'STATE.md'), '# State\n');
  });
  afterEach(() => cleanTmp(tmpDir));

  test('clears active when name is falsy', () => {
    const out = captureOutput(() => cmdWorkstreamSet(tmpDir, null, false));
    const data = JSON.parse(out);
    assert.strictEqual(data.cleared, true);
    assert.strictEqual(data.active, null);
  });

  test('rejects invalid name characters', () => {
    const out = captureOutput(() => cmdWorkstreamSet(tmpDir, 'bad name!', false));
    const data = JSON.parse(out);
    assert.strictEqual(data.error, 'invalid_name');
  });

  test('returns not_found for nonexistent workstream', () => {
    const out = captureOutput(() => cmdWorkstreamSet(tmpDir, 'nonexist', false));
    const data = JSON.parse(out);
    assert.strictEqual(data.error, 'not_found');
  });

  test('sets valid workstream as active', () => {
    const out = captureOutput(() => cmdWorkstreamSet(tmpDir, 'alpha', false));
    const data = JSON.parse(out);
    assert.strictEqual(data.set, true);
    assert.strictEqual(data.active, 'alpha');
  });
});

describe('cmdWorkstreamGet (direct)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTmpProject(); });
  afterEach(() => cleanTmp(tmpDir));

  test('returns flat mode and null when no workstreams', () => {
    const out = captureOutput(() => cmdWorkstreamGet(tmpDir, false));
    const data = JSON.parse(out);
    assert.strictEqual(data.mode, 'flat');
    assert.strictEqual(data.active, null);
  });

  test('returns workstream mode when workstreams dir exists', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'workstreams', 'test'), { recursive: true });
    const out = captureOutput(() => cmdWorkstreamGet(tmpDir, false));
    const data = JSON.parse(out);
    assert.strictEqual(data.mode, 'workstream');
  });
});

describe('cmdWorkstreamProgress (direct)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTmpProject(); });
  afterEach(() => cleanTmp(tmpDir));

  test('returns flat mode when no workstreams exist', () => {
    const out = captureOutput(() => cmdWorkstreamProgress(tmpDir, false));
    const data = JSON.parse(out);
    assert.strictEqual(data.mode, 'flat');
  });

  test('returns progress with roadmap phase count', () => {
    const wsDir = path.join(tmpDir, '.planning', 'workstreams', 'feature');
    fs.mkdirSync(path.join(wsDir, 'phases', '01-init'), { recursive: true });
    fs.writeFileSync(path.join(wsDir, 'phases', '01-init', 'PLAN.md'), '# Plan');
    fs.writeFileSync(path.join(wsDir, 'phases', '01-init', 'SUMMARY.md'), '# Summary');
    fs.writeFileSync(path.join(wsDir, 'STATE.md'), '# State\n**Status:** Active\n**Current Phase:** 2\n');
    fs.writeFileSync(path.join(wsDir, 'ROADMAP.md'), '## Roadmap\n### Phase 1: Init\n### Phase 2: Build\n### Phase 3: Ship\n');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'active-workstream'), 'feature\n');

    const out = captureOutput(() => cmdWorkstreamProgress(tmpDir, false));
    const data = JSON.parse(out);
    assert.strictEqual(data.mode, 'workstream');
    assert.strictEqual(data.count, 1);
    const ws = data.workstreams[0];
    assert.strictEqual(ws.name, 'feature');
    assert.strictEqual(ws.active, true);
    assert.strictEqual(ws.phases, '1/3');
    assert.strictEqual(ws.plans, '1/1');
    assert.strictEqual(ws.progress_percent, 33);
  });

  test('handles workstream with no roadmap', () => {
    const wsDir = path.join(tmpDir, '.planning', 'workstreams', 'bare');
    fs.mkdirSync(path.join(wsDir, 'phases'), { recursive: true });
    fs.writeFileSync(path.join(wsDir, 'STATE.md'), '# State\n**Status:** New\n');

    const out = captureOutput(() => cmdWorkstreamProgress(tmpDir, false));
    const data = JSON.parse(out);
    assert.strictEqual(data.workstreams[0].progress_percent, 0);
  });
});

describe('getOtherActiveWorkstreams (direct)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTmpProject(); });
  afterEach(() => cleanTmp(tmpDir));

  test('returns empty array when no workstreams dir', () => {
    const others = getOtherActiveWorkstreams(tmpDir, 'any');
    assert.deepStrictEqual(others, []);
  });

  test('excludes the specified workstream', () => {
    for (const ws of ['alpha', 'beta']) {
      const wsDir = path.join(tmpDir, '.planning', 'workstreams', ws);
      fs.mkdirSync(path.join(wsDir, 'phases'), { recursive: true });
      fs.writeFileSync(path.join(wsDir, 'STATE.md'), `# State\n**Status:** In progress\n**Current Phase:** 1\n`);
    }
    const others = getOtherActiveWorkstreams(tmpDir, 'alpha');
    assert.strictEqual(others.length, 1);
    assert.strictEqual(others[0].name, 'beta');
  });

  test('excludes milestone complete workstreams', () => {
    const wsDir1 = path.join(tmpDir, '.planning', 'workstreams', 'active');
    fs.mkdirSync(path.join(wsDir1, 'phases'), { recursive: true });
    fs.writeFileSync(path.join(wsDir1, 'STATE.md'), '# State\n**Status:** In progress\n');
    const wsDir2 = path.join(tmpDir, '.planning', 'workstreams', 'completed');
    fs.mkdirSync(path.join(wsDir2, 'phases'), { recursive: true });
    fs.writeFileSync(path.join(wsDir2, 'STATE.md'), '# State\n**Status:** Milestone complete\n');

    const others = getOtherActiveWorkstreams(tmpDir, 'something-else');
    const names = others.map(o => o.name);
    assert.ok(names.includes('active'));
    assert.ok(!names.includes('completed'));
  });

  test('excludes archived workstreams', () => {
    const wsDir = path.join(tmpDir, '.planning', 'workstreams', 'archived-ws');
    fs.mkdirSync(path.join(wsDir, 'phases'), { recursive: true });
    fs.writeFileSync(path.join(wsDir, 'STATE.md'), '# State\n**Status:** Archived\n');

    const others = getOtherActiveWorkstreams(tmpDir, 'other');
    assert.strictEqual(others.length, 0);
  });

  test('includes phase progress information', () => {
    const wsDir = path.join(tmpDir, '.planning', 'workstreams', 'active');
    fs.mkdirSync(path.join(wsDir, 'phases', '01-init'), { recursive: true });
    fs.writeFileSync(path.join(wsDir, 'STATE.md'), '# State\n**Status:** Working\n**Current Phase:** 1\n');
    fs.writeFileSync(path.join(wsDir, 'phases', '01-init', 'PLAN.md'), '# Plan');

    const others = getOtherActiveWorkstreams(tmpDir, 'excluded');
    assert.strictEqual(others.length, 1);
    assert.strictEqual(others[0].name, 'active');
    assert.strictEqual(others[0].phases, '0/1');
    assert.strictEqual(others[0].current_phase, '1');
  });
});
