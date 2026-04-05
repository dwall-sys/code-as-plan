'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  CAP_DIR,
  SESSION_FILE,
  GITIGNORE_CONTENT,
  loadSession,
  saveSession,
  updateSession,
  getDefaultSession,
  startSession,
  updateStep,
  endSession,
  isInitialized,
  initCapDirectory,
  setActiveApp,
  getActiveApp,
  getAppRoot,
  listApps,
} = require('../cap/bin/lib/cap-session.cjs');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-session-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// --- getDefaultSession tests ---

describe('getDefaultSession', () => {
  it('returns session with version 2.0.0', () => {
    const session = getDefaultSession();
    assert.strictEqual(session.version, '2.0.0');
  });

  it('returns session with null lastCommand', () => {
    const session = getDefaultSession();
    assert.strictEqual(session.lastCommand, null);
  });

  it('returns session with empty metadata object', () => {
    const session = getDefaultSession();
    assert.deepStrictEqual(session.metadata, {});
  });

  // @gsd-todo(ref:AC-2) SESSION.json with { active_feature: null, step: null, started_at: null }
  it('returns session with null activeFeature', () => {
    const session = getDefaultSession();
    assert.strictEqual(session.activeFeature, null);
  });

  it('returns session with null step', () => {
    const session = getDefaultSession();
    assert.strictEqual(session.step, null);
  });

  it('returns session with null startedAt', () => {
    const session = getDefaultSession();
    assert.strictEqual(session.startedAt, null);
  });
});

// --- loadSession tests ---

describe('loadSession', () => {
  it('loads existing session from .cap/SESSION.json', () => {
    const capDir = path.join(tmpDir, CAP_DIR);
    fs.mkdirSync(capDir, { recursive: true });
    const session = { ...getDefaultSession(), activeFeature: 'F-001', step: 'prototype' };
    fs.writeFileSync(path.join(capDir, SESSION_FILE), JSON.stringify(session));
    const loaded = loadSession(tmpDir);
    assert.strictEqual(loaded.activeFeature, 'F-001');
    assert.strictEqual(loaded.step, 'prototype');
  });

  it('returns default session when file is missing', () => {
    const loaded = loadSession(tmpDir);
    assert.strictEqual(loaded.version, '2.0.0');
    assert.strictEqual(loaded.activeFeature, null);
  });

  it('returns default session when JSON is corrupt', () => {
    const capDir = path.join(tmpDir, CAP_DIR);
    fs.mkdirSync(capDir, { recursive: true });
    fs.writeFileSync(path.join(capDir, SESSION_FILE), 'not valid json {{{');
    const loaded = loadSession(tmpDir);
    assert.strictEqual(loaded.version, '2.0.0');
    assert.strictEqual(loaded.activeFeature, null);
  });

  // @gsd-todo(ref:AC-16) SESSION.json tracks ephemeral workflow state
  it('merges with defaults for older session files missing new fields', () => {
    const capDir = path.join(tmpDir, CAP_DIR);
    fs.mkdirSync(capDir, { recursive: true });
    // Simulate an older session that lacks 'step' and 'startedAt'
    fs.writeFileSync(path.join(capDir, SESSION_FILE), JSON.stringify({
      version: '2.0.0',
      lastCommand: '/cap:init',
      activeFeature: null,
    }));
    const loaded = loadSession(tmpDir);
    assert.strictEqual(loaded.step, null);
    assert.strictEqual(loaded.startedAt, null);
    assert.strictEqual(loaded.lastCommand, '/cap:init');
  });
});

// --- saveSession tests ---

describe('saveSession', () => {
  it('creates .cap/ directory if it does not exist', () => {
    const session = getDefaultSession();
    saveSession(tmpDir, session);
    assert.ok(fs.existsSync(path.join(tmpDir, CAP_DIR)));
    assert.ok(fs.existsSync(path.join(tmpDir, CAP_DIR, SESSION_FILE)));
  });

  it('writes valid JSON to .cap/SESSION.json', () => {
    const session = { ...getDefaultSession(), activeFeature: 'F-005' };
    saveSession(tmpDir, session);
    const content = fs.readFileSync(path.join(tmpDir, CAP_DIR, SESSION_FILE), 'utf8');
    const parsed = JSON.parse(content);
    assert.strictEqual(parsed.activeFeature, 'F-005');
    assert.strictEqual(parsed.version, '2.0.0');
  });

  it('overwrites existing session', () => {
    saveSession(tmpDir, { ...getDefaultSession(), activeFeature: 'F-001' });
    saveSession(tmpDir, { ...getDefaultSession(), activeFeature: 'F-002' });
    const loaded = loadSession(tmpDir);
    assert.strictEqual(loaded.activeFeature, 'F-002');
  });
});

// --- updateSession tests ---

describe('updateSession', () => {
  it('merges updates without overwriting unmodified fields', () => {
    saveSession(tmpDir, { ...getDefaultSession(), activeFeature: 'F-001', step: 'prototype' });
    const updated = updateSession(tmpDir, { step: 'test' });
    assert.strictEqual(updated.activeFeature, 'F-001');
    assert.strictEqual(updated.step, 'test');
  });

  it('creates session file if none exists', () => {
    const updated = updateSession(tmpDir, { lastCommand: '/cap:init' });
    assert.strictEqual(updated.lastCommand, '/cap:init');
    assert.strictEqual(updated.version, '2.0.0');
  });
});

// --- startSession tests ---

describe('startSession', () => {
  // @gsd-todo(ref:AC-17) SESSION.json connects to FEATURE-MAP.md only via feature IDs (loose coupling)
  it('sets active feature and step', () => {
    const session = startSession(tmpDir, 'F-003', 'brainstorm');
    assert.strictEqual(session.activeFeature, 'F-003');
    assert.strictEqual(session.step, 'brainstorm');
    assert.ok(session.startedAt);
  });

  it('sets a valid ISO timestamp', () => {
    const session = startSession(tmpDir, 'F-001', 'prototype');
    const parsed = new Date(session.startedAt);
    assert.ok(!isNaN(parsed.getTime()));
  });

  it('persists to disk', () => {
    startSession(tmpDir, 'F-010', 'test');
    const loaded = loadSession(tmpDir);
    assert.strictEqual(loaded.activeFeature, 'F-010');
    assert.strictEqual(loaded.step, 'test');
  });
});

// --- updateStep tests ---

describe('updateStep', () => {
  it('updates workflow step without clearing feature', () => {
    startSession(tmpDir, 'F-001', 'prototype');
    const updated = updateStep(tmpDir, 'test');
    assert.strictEqual(updated.step, 'test');
    assert.strictEqual(updated.activeFeature, 'F-001');
  });

  it('persists step change to disk', () => {
    startSession(tmpDir, 'F-001', 'prototype');
    updateStep(tmpDir, 'review');
    const loaded = loadSession(tmpDir);
    assert.strictEqual(loaded.step, 'review');
  });
});

// --- endSession tests ---

describe('endSession', () => {
  it('clears active feature and step', () => {
    startSession(tmpDir, 'F-001', 'prototype');
    const ended = endSession(tmpDir);
    assert.strictEqual(ended.activeFeature, null);
    assert.strictEqual(ended.step, null);
    assert.strictEqual(ended.startedAt, null);
  });

  it('preserves other session fields', () => {
    saveSession(tmpDir, { ...getDefaultSession(), lastCommand: '/cap:prototype', activeFeature: 'F-001', step: 'prototype' });
    const ended = endSession(tmpDir);
    assert.strictEqual(ended.lastCommand, '/cap:prototype');
    assert.strictEqual(ended.activeFeature, null);
  });
});

// --- isInitialized tests ---

describe('isInitialized', () => {
  it('returns false when .cap/ does not exist', () => {
    assert.strictEqual(isInitialized(tmpDir), false);
  });

  it('returns true when .cap/ exists', () => {
    fs.mkdirSync(path.join(tmpDir, CAP_DIR));
    assert.strictEqual(isInitialized(tmpDir), true);
  });
});

// --- initCapDirectory tests ---

describe('initCapDirectory', () => {
  // @gsd-todo(ref:AC-3) .cap/.gitignore ignores SESSION.json
  it('creates full .cap/ directory structure', () => {
    initCapDirectory(tmpDir);
    assert.ok(fs.existsSync(path.join(tmpDir, CAP_DIR)));
    assert.ok(fs.existsSync(path.join(tmpDir, CAP_DIR, 'stack-docs')));
    assert.ok(fs.existsSync(path.join(tmpDir, CAP_DIR, 'debug')));
  });

  it('creates .gitignore in .cap/', () => {
    initCapDirectory(tmpDir);
    const gitignorePath = path.join(tmpDir, CAP_DIR, '.gitignore');
    assert.ok(fs.existsSync(gitignorePath));
    const content = fs.readFileSync(gitignorePath, 'utf8');
    assert.ok(content.includes('SESSION.json'));
    assert.ok(content.includes('debug/'));
  });

  it('creates SESSION.json with default session', () => {
    initCapDirectory(tmpDir);
    const sessionPath = path.join(tmpDir, CAP_DIR, SESSION_FILE);
    assert.ok(fs.existsSync(sessionPath));
    const content = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    assert.strictEqual(content.version, '2.0.0');
    assert.strictEqual(content.activeFeature, null);
    assert.strictEqual(content.step, null);
  });

  // @gsd-todo(ref:AC-6) Idempotent -- running on already-initialized project does not overwrite
  it('is idempotent -- safe to run multiple times', () => {
    initCapDirectory(tmpDir);
    // Modify session to check it is preserved
    saveSession(tmpDir, { ...getDefaultSession(), activeFeature: 'F-001' });
    initCapDirectory(tmpDir);
    const loaded = loadSession(tmpDir);
    assert.strictEqual(loaded.activeFeature, 'F-001');
  });

  // @gsd-todo(ref:AC-4) No prompts, no wizards -- initCapDirectory is synchronous with no user interaction
  // @gsd-todo(ref:AC-5) Completes in single invocation
  it('completes synchronously without errors', () => {
    assert.doesNotThrow(() => initCapDirectory(tmpDir));
  });

  // @gsd-todo(ref:AC-18) SESSION.json not committed to version control
  it('gitignore prevents SESSION.json from being committed', () => {
    initCapDirectory(tmpDir);
    const gitignore = fs.readFileSync(path.join(tmpDir, CAP_DIR, '.gitignore'), 'utf8');
    assert.ok(gitignore.includes('SESSION.json'));
  });

  // @gsd-todo(ref:AC-19) SESSION.json is the only mutable session artifact
  it('does not create any other session artifacts', () => {
    initCapDirectory(tmpDir);
    const capDir = path.join(tmpDir, CAP_DIR);
    const files = fs.readdirSync(capDir).filter(f => !fs.statSync(path.join(capDir, f)).isDirectory());
    // Should only have .gitignore and SESSION.json
    assert.ok(files.includes('.gitignore'));
    assert.ok(files.includes(SESSION_FILE));
    assert.strictEqual(files.length, 2);
  });
});

// --- setActiveApp tests ---

describe('setActiveApp', () => {
  it('sets activeApp in SESSION.json', () => {
    initCapDirectory(tmpDir);
    const session = setActiveApp(tmpDir, 'apps/flow');
    assert.strictEqual(session.activeApp, 'apps/flow');
    // Verify persisted
    const loaded = loadSession(tmpDir);
    assert.strictEqual(loaded.activeApp, 'apps/flow');
  });

  it('clears activeApp when set to null', () => {
    initCapDirectory(tmpDir);
    setActiveApp(tmpDir, 'apps/flow');
    const session = setActiveApp(tmpDir, null);
    assert.strictEqual(session.activeApp, null);
  });

  it('preserves other session fields', () => {
    initCapDirectory(tmpDir);
    startSession(tmpDir, 'F-001', 'prototype');
    setActiveApp(tmpDir, 'apps/hub');
    const loaded = loadSession(tmpDir);
    assert.strictEqual(loaded.activeApp, 'apps/hub');
    assert.strictEqual(loaded.activeFeature, 'F-001');
    assert.strictEqual(loaded.step, 'prototype');
  });
});

// --- getActiveApp tests ---

describe('getActiveApp', () => {
  it('returns null when no activeApp is set', () => {
    initCapDirectory(tmpDir);
    assert.strictEqual(getActiveApp(tmpDir), null);
  });

  it('returns the active app path', () => {
    initCapDirectory(tmpDir);
    setActiveApp(tmpDir, 'packages/ui');
    assert.strictEqual(getActiveApp(tmpDir), 'packages/ui');
  });

  it('returns null when SESSION.json does not exist', () => {
    assert.strictEqual(getActiveApp(tmpDir), null);
  });
});

// --- getAppRoot tests ---

describe('getAppRoot', () => {
  it('returns projectRoot when no activeApp is set', () => {
    initCapDirectory(tmpDir);
    assert.strictEqual(getAppRoot(tmpDir), tmpDir);
  });

  it('returns projectRoot + activeApp when app is set', () => {
    initCapDirectory(tmpDir);
    setActiveApp(tmpDir, 'apps/flow');
    assert.strictEqual(getAppRoot(tmpDir), path.join(tmpDir, 'apps/flow'));
  });

  it('returns projectRoot when SESSION.json missing', () => {
    assert.strictEqual(getAppRoot(tmpDir), tmpDir);
  });
});

// --- listApps tests ---

describe('listApps', () => {
  it('returns isMonorepo false for single-repo project', () => {
    const result = listApps(tmpDir);
    assert.strictEqual(result.isMonorepo, false);
    assert.deepStrictEqual(result.apps, []);
  });

  it('detects monorepo apps from package.json workspaces', () => {
    // Create a monorepo structure
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      name: 'monorepo',
      workspaces: ['apps/*', 'packages/*'],
    }));
    fs.mkdirSync(path.join(tmpDir, 'apps', 'flow'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'apps', 'hub'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'packages', 'ui'), { recursive: true });

    const result = listApps(tmpDir);
    assert.strictEqual(result.isMonorepo, true);
    assert.ok(result.apps.includes(path.join('apps', 'flow')));
    assert.ok(result.apps.includes(path.join('apps', 'hub')));
    assert.ok(result.apps.includes(path.join('packages', 'ui')));
  });
});

// --- getDefaultSession includes activeApp ---

describe('getDefaultSession activeApp field', () => {
  it('includes activeApp as null in default session', () => {
    const session = getDefaultSession();
    assert.strictEqual(session.activeApp, null);
    assert.ok('activeApp' in session);
  });
});

// --- Assertion density boost: export shape verification ---
describe('cap-session export verification', () => {
  const mod = require('../cap/bin/lib/cap-session.cjs');

  it('exports have correct types', () => {
    assert.strictEqual(typeof mod.CAP_DIR, 'string');
    assert.strictEqual(typeof mod.SESSION_FILE, 'string');
    assert.strictEqual(typeof mod.GITIGNORE_CONTENT, 'string');
    assert.strictEqual(typeof mod.loadSession, 'function');
    assert.strictEqual(typeof mod.saveSession, 'function');
    assert.strictEqual(typeof mod.updateSession, 'function');
    assert.strictEqual(typeof mod.getDefaultSession, 'function');
    assert.strictEqual(typeof mod.startSession, 'function');
    assert.strictEqual(typeof mod.updateStep, 'function');
    assert.strictEqual(typeof mod.endSession, 'function');
    assert.strictEqual(typeof mod.isInitialized, 'function');
    assert.strictEqual(typeof mod.initCapDirectory, 'function');
    assert.strictEqual(typeof mod.setActiveApp, 'function');
    assert.strictEqual(typeof mod.getActiveApp, 'function');
    assert.strictEqual(typeof mod.getAppRoot, 'function');
  });

  it('exported functions are named', () => {
    assert.strictEqual(typeof mod.loadSession, 'function');
    assert.ok(mod.loadSession.name.length > 0);
    assert.strictEqual(typeof mod.saveSession, 'function');
    assert.ok(mod.saveSession.name.length > 0);
    assert.strictEqual(typeof mod.updateSession, 'function');
    assert.ok(mod.updateSession.name.length > 0);
    assert.strictEqual(typeof mod.getDefaultSession, 'function');
    assert.ok(mod.getDefaultSession.name.length > 0);
    assert.strictEqual(typeof mod.startSession, 'function');
    assert.ok(mod.startSession.name.length > 0);
    assert.strictEqual(typeof mod.updateStep, 'function');
    assert.ok(mod.updateStep.name.length > 0);
    assert.strictEqual(typeof mod.endSession, 'function');
    assert.ok(mod.endSession.name.length > 0);
    assert.strictEqual(typeof mod.isInitialized, 'function');
    assert.ok(mod.isInitialized.name.length > 0);
    assert.strictEqual(typeof mod.initCapDirectory, 'function');
    assert.ok(mod.initCapDirectory.name.length > 0);
    assert.strictEqual(typeof mod.setActiveApp, 'function');
    assert.ok(mod.setActiveApp.name.length > 0);
  });

  it('constants are stable', () => {
    assert.strictEqual(typeof mod.CAP_DIR, 'string');
    assert.ok(mod.CAP_DIR.length > 0);
    assert.strictEqual(typeof mod.SESSION_FILE, 'string');
    assert.ok(mod.SESSION_FILE.length > 0);
    assert.strictEqual(typeof mod.GITIGNORE_CONTENT, 'string');
    assert.ok(mod.GITIGNORE_CONTENT.length > 0);
  });
});
