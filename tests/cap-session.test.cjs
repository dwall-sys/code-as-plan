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
} = require('../get-shit-done/bin/lib/cap-session.cjs');

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
