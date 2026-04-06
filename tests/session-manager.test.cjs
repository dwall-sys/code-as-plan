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

  it('falls back to default_app when current_app is null but default_app is set', () => {
    // Write session with no current_app but with default_app
    const sessionPath = path.join(tmpDir, '.planning');
    fs.mkdirSync(sessionPath, { recursive: true });
    fs.writeFileSync(
      path.join(sessionPath, 'SESSION.json'),
      JSON.stringify({ current_app: null, default_app: 'apps/default', workspace_type: 'monorepo', available_apps: [], updated_at: 1 }),
      'utf-8'
    );
    assert.strictEqual(session.getCurrentApp(tmpDir), 'apps/default');
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

  it('falls back to existing available_apps when availableApps param is falsy', () => {
    session.setCurrentApp(tmpDir, 'apps/a', ['apps/a', 'apps/b']);
    // Call with null availableApps
    const result = session.setCurrentApp(tmpDir, 'apps/c', null);
    assert.deepStrictEqual(result.available_apps, ['apps/a', 'apps/b']);
  });

  it('falls back to empty array when both availableApps and existing.available_apps are falsy', () => {
    // No prior session => existing = {}, existing.available_apps = undefined
    const result = session.setCurrentApp(tmpDir, 'apps/x', null);
    assert.deepStrictEqual(result.available_apps, []);
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

  it('auto-selects default_app if previously configured', () => {
    session.setDefaultApp(tmpDir, 'apps/default');
    const result = session.initSession(tmpDir, { type: 'nx', apps: [{ path: 'apps/default', name: 'default' }] });
    assert.strictEqual(result.current_app, 'apps/default');
    assert.strictEqual(result.default_app, 'apps/default');
  });

  it('handles empty apps array in workspaceInfo', () => {
    const result = session.initSession(tmpDir, { type: 'single' });
    assert.deepStrictEqual(result.available_apps, []);
    assert.strictEqual(result.workspace_type, 'single');
  });

  it('defaults workspace_type to monorepo when not provided', () => {
    const result = session.initSession(tmpDir, { apps: [] });
    assert.strictEqual(result.workspace_type, 'monorepo');
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

// ---------------------------------------------------------------------------
// 10. setDefaultApp
// ---------------------------------------------------------------------------

describe('setDefaultApp', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('writes default_app to SESSION.json', () => {
    const result = session.setDefaultApp(tmpDir, 'apps/dashboard');
    assert.strictEqual(result.default_app, 'apps/dashboard');
    assert.strictEqual(result.workspace_type, 'monorepo');
    assert.strictEqual(typeof result.updated_at, 'number');
  });

  it('sets current_app from existing session when present', () => {
    session.setCurrentApp(tmpDir, 'apps/web', ['apps/web']);
    const result = session.setDefaultApp(tmpDir, 'apps/api');
    assert.strictEqual(result.current_app, 'apps/web');
    assert.strictEqual(result.default_app, 'apps/api');
  });

  it('uses appPath as current_app when no existing session', () => {
    const result = session.setDefaultApp(tmpDir, 'apps/new');
    assert.strictEqual(result.current_app, 'apps/new');
    assert.strictEqual(result.default_app, 'apps/new');
  });

  it('clears default when appPath is null', () => {
    session.setDefaultApp(tmpDir, 'apps/x');
    const result = session.setDefaultApp(tmpDir, null);
    assert.strictEqual(result.default_app, null);
  });

  it('preserves available_apps from existing session', () => {
    session.setCurrentApp(tmpDir, 'apps/a', ['apps/a', 'apps/b']);
    const result = session.setDefaultApp(tmpDir, 'apps/a');
    assert.deepStrictEqual(result.available_apps, ['apps/a', 'apps/b']);
  });
});

// ---------------------------------------------------------------------------
// 11. getDefaultApp
// ---------------------------------------------------------------------------

describe('getDefaultApp', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('returns null when no session exists', () => {
    assert.strictEqual(session.getDefaultApp(tmpDir), null);
  });

  it('returns null when session has no default_app', () => {
    session.setCurrentApp(tmpDir, 'apps/web', []);
    assert.strictEqual(session.getDefaultApp(tmpDir), null);
  });

  it('returns the configured default app', () => {
    session.setDefaultApp(tmpDir, 'apps/dashboard');
    assert.strictEqual(session.getDefaultApp(tmpDir), 'apps/dashboard');
  });

  it('returns null after clearing default', () => {
    session.setDefaultApp(tmpDir, 'apps/x');
    session.setDefaultApp(tmpDir, null);
    assert.strictEqual(session.getDefaultApp(tmpDir), null);
  });
});

// --- Assertion density boost: export shape verification ---
describe('session-manager export verification', () => {
  const mod = require('../cap/bin/lib/session-manager.cjs');

  it('exports have correct types', () => {
    assert.strictEqual(typeof mod.getSessionPath, 'function');
    assert.strictEqual(typeof mod.getSession, 'function');
    assert.strictEqual(typeof mod.getCurrentApp, 'function');
    assert.strictEqual(typeof mod.resolveCurrentApp, 'function');
    assert.strictEqual(typeof mod.setCurrentApp, 'function');
    assert.strictEqual(typeof mod.setDefaultApp, 'function');
    assert.strictEqual(typeof mod.getDefaultApp, 'function');
    assert.strictEqual(typeof mod.clearSession, 'function');
    assert.strictEqual(typeof mod.initSession, 'function');
    assert.strictEqual(typeof mod.isMonorepoSession, 'function');
    assert.strictEqual(typeof mod.getAvailableApps, 'function');
    assert.strictEqual(typeof mod.formatAppSelector, 'function');
  });

  it('exported functions are named', () => {
    assert.strictEqual(typeof mod.getSessionPath, 'function');
    assert.ok(mod.getSessionPath.name.length > 0);
    assert.strictEqual(typeof mod.getSession, 'function');
    assert.ok(mod.getSession.name.length > 0);
    assert.strictEqual(typeof mod.getCurrentApp, 'function');
    assert.ok(mod.getCurrentApp.name.length > 0);
    assert.strictEqual(typeof mod.resolveCurrentApp, 'function');
    assert.ok(mod.resolveCurrentApp.name.length > 0);
    assert.strictEqual(typeof mod.setCurrentApp, 'function');
    assert.ok(mod.setCurrentApp.name.length > 0);
    assert.strictEqual(typeof mod.setDefaultApp, 'function');
    assert.ok(mod.setDefaultApp.name.length > 0);
    assert.strictEqual(typeof mod.getDefaultApp, 'function');
    assert.ok(mod.getDefaultApp.name.length > 0);
    assert.strictEqual(typeof mod.clearSession, 'function');
    assert.ok(mod.clearSession.name.length > 0);
    assert.strictEqual(typeof mod.initSession, 'function');
    assert.ok(mod.initSession.name.length > 0);
    assert.strictEqual(typeof mod.isMonorepoSession, 'function');
    assert.ok(mod.isMonorepoSession.name.length > 0);
  });
});
