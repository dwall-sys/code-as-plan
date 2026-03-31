/**
 * GSD Tools Tests - session-manager.cjs
 *
 * Unit tests for the session management module.
 * Covers read/write operations, resolution logic, init, query helpers, and formatting.
 */

'use strict';
const { describe, it, afterEach, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const session = require('../cap/bin/lib/session-manager.cjs');

function createTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-session-test-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// 1. getSession
// ---------------------------------------------------------------------------

describe('getSession', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('returns null when no SESSION.json exists', () => {
    assert.strictEqual(session.getSession(tmpDir), null);
  });

  it('returns parsed object when SESSION.json exists', () => {
    const sessionPath = path.join(tmpDir, '.planning');
    fs.mkdirSync(sessionPath, { recursive: true });
    const data = { current_app: 'apps/foo', workspace_type: 'nx', available_apps: ['apps/foo'], updated_at: 1000 };
    fs.writeFileSync(path.join(sessionPath, 'SESSION.json'), JSON.stringify(data, null, 2), 'utf-8');

    const result = session.getSession(tmpDir);
    assert.deepStrictEqual(result, data);
  });
});

// ---------------------------------------------------------------------------
// 2. getCurrentApp
// ---------------------------------------------------------------------------

describe('getCurrentApp', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('returns null with no session', () => {
    assert.strictEqual(session.getCurrentApp(tmpDir), null);
  });

  it('returns current_app value when session present', () => {
    session.setCurrentApp(tmpDir, 'apps/dashboard', []);
    assert.strictEqual(session.getCurrentApp(tmpDir), 'apps/dashboard');
  });

  it('returns null when current_app is null in session', () => {
    session.setCurrentApp(tmpDir, null, []);
    assert.strictEqual(session.getCurrentApp(tmpDir), null);
  });
});

// ---------------------------------------------------------------------------
// 3. resolveCurrentApp
// ---------------------------------------------------------------------------

describe('resolveCurrentApp', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('explicit arg wins over session', () => {
    session.setCurrentApp(tmpDir, 'apps/foo', []);
    assert.strictEqual(session.resolveCurrentApp(tmpDir, 'apps/bar'), 'apps/bar');
  });

  it('session used when explicit arg is null', () => {
    session.setCurrentApp(tmpDir, 'apps/foo', []);
    assert.strictEqual(session.resolveCurrentApp(tmpDir, null), 'apps/foo');
  });

  it('session used when explicit arg is undefined', () => {
    session.setCurrentApp(tmpDir, 'apps/foo', []);
    assert.strictEqual(session.resolveCurrentApp(tmpDir, undefined), 'apps/foo');
  });

  it('returns null when neither present', () => {
    assert.strictEqual(session.resolveCurrentApp(tmpDir, null), null);
  });
});

// ---------------------------------------------------------------------------
// 4. setCurrentApp
// ---------------------------------------------------------------------------

describe('setCurrentApp', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('writes SESSION.json with correct shape', () => {
    const result = session.setCurrentApp(tmpDir, 'apps/dashboard', ['apps/dashboard', 'apps/api']);
    assert.strictEqual(result.current_app, 'apps/dashboard');
    assert.deepStrictEqual(result.available_apps, ['apps/dashboard', 'apps/api']);
    assert.strictEqual(result.workspace_type, 'monorepo');
    assert.strictEqual(typeof result.updated_at, 'number');
  });

  it('subsequent getSession returns written data', () => {
    session.setCurrentApp(tmpDir, 'apps/web', ['apps/web']);
    const read = session.getSession(tmpDir);
    assert.strictEqual(read.current_app, 'apps/web');
  });

  it('updated_at is a number (epoch ms)', () => {
    const result = session.setCurrentApp(tmpDir, null, []);
    assert.strictEqual(typeof result.updated_at, 'number');
    assert.ok(result.updated_at > 0);
  });
});

// ---------------------------------------------------------------------------
// 5. clearSession
// ---------------------------------------------------------------------------

describe('clearSession', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('removes SESSION.json', () => {
    session.setCurrentApp(tmpDir, 'apps/foo', []);
    session.clearSession(tmpDir);
    assert.strictEqual(session.getSession(tmpDir), null);
  });

  it('calling again does not throw', () => {
    session.clearSession(tmpDir);
    assert.doesNotThrow(() => session.clearSession(tmpDir));
  });
});

// ---------------------------------------------------------------------------
// 6. initSession
// ---------------------------------------------------------------------------

describe('initSession', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('creates SESSION.json with current_app: null', () => {
    const workspaceInfo = {
      type: 'turbo',
      apps: [{ path: 'apps/web', name: 'web' }, { path: 'apps/api', name: 'api' }],
    };

    const result = session.initSession(tmpDir, workspaceInfo);
    assert.strictEqual(result.current_app, null);
  });

  it('sets correct workspace_type from workspaceInfo', () => {
    const workspaceInfo = { type: 'pnpm', apps: [] };
    const result = session.initSession(tmpDir, workspaceInfo);
    assert.strictEqual(result.workspace_type, 'pnpm');
  });

  it('sets correct available_apps from workspaceInfo.apps', () => {
    const workspaceInfo = {
      type: 'nx',
      apps: [{ path: 'apps/a', name: 'a' }, { path: 'apps/b', name: 'b' }],
    };
    const result = session.initSession(tmpDir, workspaceInfo);
    assert.deepStrictEqual(result.available_apps, ['apps/a', 'apps/b']);
  });
});

// ---------------------------------------------------------------------------
// 7. isMonorepoSession
// ---------------------------------------------------------------------------

describe('isMonorepoSession', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('returns true for workspace_type nx', () => {
    session.initSession(tmpDir, { type: 'nx', apps: [] });
    assert.strictEqual(session.isMonorepoSession(tmpDir), true);
  });

  it('returns false for workspace_type single', () => {
    const sessionPath = path.join(tmpDir, '.planning');
    fs.mkdirSync(sessionPath, { recursive: true });
    fs.writeFileSync(
      path.join(sessionPath, 'SESSION.json'),
      JSON.stringify({ current_app: null, workspace_type: 'single', available_apps: [], updated_at: 1 }),
      'utf-8'
    );
    assert.strictEqual(session.isMonorepoSession(tmpDir), false);
  });

  it('returns false for no session', () => {
    assert.strictEqual(session.isMonorepoSession(tmpDir), false);
  });
});

// ---------------------------------------------------------------------------
// 8. getAvailableApps
// ---------------------------------------------------------------------------

describe('getAvailableApps', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('returns array from session', () => {
    session.initSession(tmpDir, { type: 'nx', apps: [{ path: 'apps/x', name: 'x' }] });
    const apps = session.getAvailableApps(tmpDir);
    assert.deepStrictEqual(apps, ['apps/x']);
  });

  it('returns empty array when no session', () => {
    assert.deepStrictEqual(session.getAvailableApps(tmpDir), []);
  });
});

// ---------------------------------------------------------------------------
// 9. formatAppSelector
// ---------------------------------------------------------------------------

describe('formatAppSelector', () => {
  it('output contains all app names', () => {
    const output = session.formatAppSelector(['apps/web', 'apps/api'], 'apps/web');
    assert.ok(output.includes('apps/web'));
    assert.ok(output.includes('apps/api'));
  });

  it('marks current app with (current)', () => {
    const output = session.formatAppSelector(['apps/web', 'apps/api'], 'apps/web');
    assert.ok(output.includes('apps/web (current)'));
    assert.ok(!output.includes('apps/api (current)'));
  });

  it('includes Global option as last entry', () => {
    const output = session.formatAppSelector(['apps/web'], 'apps/web');
    assert.ok(output.includes('[Global]'));
    // Global should be after apps/web
    const globalIdx = output.indexOf('[Global]');
    const webIdx = output.indexOf('apps/web');
    assert.ok(globalIdx > webIdx);
  });

  it('marks Global as current when currentApp is null', () => {
    const output = session.formatAppSelector(['apps/web'], null);
    assert.ok(output.includes('[Global]'));
    assert.ok(output.includes('cross-app work (current)'));
  });
});
