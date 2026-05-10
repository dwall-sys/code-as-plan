'use strict';

// @cap-feature(feature:F-097) Hook Registration Verification — tests cover all 4 ACs.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  verifyHookRegistration,
  expectedHookLifecycle,
  computeRegistrationPatch,
  applyRegistrationFix,
  formatHookSection,
} = require('../cap/bin/lib/cap-doctor.cjs');

function makeFixtureHome() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-f097-'));
  const hooksDir = path.join(root, '.claude', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  return { root, hooksDir, settingsPath: path.join(root, '.claude', 'settings.json') };
}

function writeHook(hooksDir, name, header) {
  const content = `#!/usr/bin/env node\n${header}\nprocess.exit(0);\n`;
  fs.writeFileSync(path.join(hooksDir, name), content, 'utf8');
}

function writeSettings(settingsPath, settings) {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
}

function rmrf(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

// --- expectedHookLifecycle ---

describe('expectedHookLifecycle', () => {
  let fx;
  before(() => { fx = makeFixtureHome(); });
  after(() => rmrf(fx.root));

  it('reads the explicit cap-hook-lifecycle marker first', () => {
    writeHook(fx.hooksDir, 'cap-explicit.js', '// cap-hook-lifecycle: PostToolUse\n// (Stop hook somewhere else in comments — must be ignored)');
    const lc = expectedHookLifecycle(path.join(fx.hooksDir, 'cap-explicit.js'));
    assert.strictEqual(lc, 'PostToolUse');
  });

  it('falls back to header heuristic when explicit marker is absent', () => {
    writeHook(fx.hooksDir, 'cap-implicit.js', '// some text — Stop hook for session end');
    const lc = expectedHookLifecycle(path.join(fx.hooksDir, 'cap-implicit.js'));
    assert.strictEqual(lc, 'Stop');
  });

  it('returns null when neither marker nor heuristic matches', () => {
    writeHook(fx.hooksDir, 'cap-mystery.js', '// just some non-lifecycle comment\n// nothing useful');
    const lc = expectedHookLifecycle(path.join(fx.hooksDir, 'cap-mystery.js'));
    assert.strictEqual(lc, null);
  });

  it('rejects unknown lifecycle values from explicit marker', () => {
    writeHook(fx.hooksDir, 'cap-bogus.js', '// cap-hook-lifecycle: NotAThing');
    const lc = expectedHookLifecycle(path.join(fx.hooksDir, 'cap-bogus.js'));
    assert.strictEqual(lc, null);
  });
});

// --- verifyHookRegistration: 3-bucket output (AC-1, AC-2) ---

describe('verifyHookRegistration — buckets', () => {
  it('reports ok=true when every installed hook is registered to the expected lifecycle', () => {
    const fx = makeFixtureHome();
    try {
      const stopHook = path.join(fx.hooksDir, 'cap-stop.js');
      const postHook = path.join(fx.hooksDir, 'cap-post.js');
      writeHook(fx.hooksDir, 'cap-stop.js', '// cap-hook-lifecycle: Stop');
      writeHook(fx.hooksDir, 'cap-post.js', '// cap-hook-lifecycle: PostToolUse');
      writeSettings(fx.settingsPath, {
        hooks: {
          Stop: [{ hooks: [{ type: 'command', command: `node "${stopHook}"` }] }],
          PostToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: `node "${postHook}"` }] }],
        },
      });
      const r = verifyHookRegistration({ homeDir: fx.root });
      assert.strictEqual(r.ok, true, JSON.stringify(r, null, 2));
      assert.strictEqual(r.registered.length, 2);
      assert.strictEqual(r.unregistered.length, 0);
      assert.strictEqual(r.brokenPointers.length, 0);
    } finally { rmrf(fx.root); }
  });

  it('detects installed-not-registered hooks (the F-097 motivating case)', () => {
    const fx = makeFixtureHome();
    try {
      writeHook(fx.hooksDir, 'cap-learning-hook.js', '// cap-hook-lifecycle: PostToolUse\n// PostToolUse hook for editAfterWrite signals');
      writeHook(fx.hooksDir, 'cap-tag-observer.js', '// cap-hook-lifecycle: PostToolUse');
      writeHook(fx.hooksDir, 'cap-learn-review-hook.js', '// cap-hook-lifecycle: Stop');
      // settings.json registers ZERO of them — the exact pre-F-097 state on Dennis's laptop.
      writeSettings(fx.settingsPath, { hooks: {} });
      const r = verifyHookRegistration({ homeDir: fx.root });
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.unregistered.length, 3);
      assert.strictEqual(r.brokenPointers.length, 0);
      const names = r.unregistered.map(h => h.name).sort();
      assert.deepStrictEqual(names, ['cap-learn-review-hook.js', 'cap-learning-hook.js', 'cap-tag-observer.js']);
      // each unregistered hook gets a recommendation pointing at the expected lifecycle
      for (const h of r.unregistered) {
        assert.match(h.recommendation, /Add to settings.json/);
        assert.ok(h.recommendation.includes(h.expectedLifecycle));
      }
    } finally { rmrf(fx.root); }
  });

  it('detects broken pointers (settings references a missing file)', () => {
    const fx = makeFixtureHome();
    try {
      // Note: NO file written to hooksDir. Settings still references it.
      const ghostPath = path.join(fx.hooksDir, 'cap-removed-by-mistake.js');
      writeSettings(fx.settingsPath, {
        hooks: {
          Stop: [{ hooks: [{ type: 'command', command: `node "${ghostPath}"` }] }],
        },
      });
      const r = verifyHookRegistration({ homeDir: fx.root });
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.brokenPointers.length, 1);
      assert.strictEqual(r.brokenPointers[0].name, 'cap-removed-by-mistake.js');
      assert.match(r.brokenPointers[0].recommendation, /references missing file/);
    } finally { rmrf(fx.root); }
  });

  it('detects lifecycle mismatch (registered to a different lifecycle than expected)', () => {
    const fx = makeFixtureHome();
    try {
      const hookPath = path.join(fx.hooksDir, 'cap-misplaced.js');
      writeHook(fx.hooksDir, 'cap-misplaced.js', '// cap-hook-lifecycle: PostToolUse');
      writeSettings(fx.settingsPath, {
        hooks: {
          Stop: [{ hooks: [{ type: 'command', command: `node "${hookPath}"` }] }],
        },
      });
      const r = verifyHookRegistration({ homeDir: fx.root });
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.mismatched.length, 1);
      assert.strictEqual(r.mismatched[0].registeredLifecycle, 'Stop');
      assert.strictEqual(r.mismatched[0].expectedLifecycle, 'PostToolUse');
      assert.match(r.mismatched[0].recommendation, /Move from .*Stop.* to .*PostToolUse/);
    } finally { rmrf(fx.root); }
  });

  it('handles statusLine as a separate registration surface (not under hooks.*)', () => {
    const fx = makeFixtureHome();
    try {
      const slPath = path.join(fx.hooksDir, 'cap-statusline.js');
      writeHook(fx.hooksDir, 'cap-statusline.js', '// cap-hook-lifecycle: statusLine');
      writeSettings(fx.settingsPath, {
        statusLine: { type: 'command', command: `node "${slPath}"` },
      });
      const r = verifyHookRegistration({ homeDir: fx.root });
      assert.strictEqual(r.ok, true, 'statusLine hook should count as registered');
      assert.strictEqual(r.registered.length, 1);
      assert.strictEqual(r.registered[0].registeredLifecycle, 'statusLine');
    } finally { rmrf(fx.root); }
  });

  it('does not crash on malformed settings.json', () => {
    const fx = makeFixtureHome();
    try {
      writeHook(fx.hooksDir, 'cap-x.js', '// cap-hook-lifecycle: Stop');
      fs.writeFileSync(fx.settingsPath, '{ "hooks": broken json', 'utf8');
      const r = verifyHookRegistration({ homeDir: fx.root });
      // hook is installed but settings unparseable → must surface as unregistered, not throw
      assert.strictEqual(r.unregistered.length, 1);
    } finally { rmrf(fx.root); }
  });

  it('handles missing settings.json (fresh install, nothing registered yet)', () => {
    const fx = makeFixtureHome();
    try {
      writeHook(fx.hooksDir, 'cap-x.js', '// cap-hook-lifecycle: Stop');
      // no settings.json on disk
      const r = verifyHookRegistration({ homeDir: fx.root });
      assert.strictEqual(r.unregistered.length, 1);
      assert.strictEqual(r.ok, false);
    } finally { rmrf(fx.root); }
  });

  it('non-cap *.js files in the hooks dir are ignored', () => {
    const fx = makeFixtureHome();
    try {
      writeHook(fx.hooksDir, 'cap-mine.js', '// cap-hook-lifecycle: Stop');
      writeHook(fx.hooksDir, 'someone-elses-hook.js', '// not a CAP hook');
      writeSettings(fx.settingsPath, {
        hooks: { Stop: [{ hooks: [{ type: 'command', command: `node "${path.join(fx.hooksDir, 'cap-mine.js')}"` }] }] },
      });
      const r = verifyHookRegistration({ homeDir: fx.root });
      assert.strictEqual(r.hooks.length, 1, 'only cap-*.js files should be tracked');
      assert.strictEqual(r.hooks[0].name, 'cap-mine.js');
      assert.strictEqual(r.ok, true);
    } finally { rmrf(fx.root); }
  });
});

// --- computeRegistrationPatch + applyRegistrationFix (AC-3) ---

describe('applyRegistrationFix — --fix flag', () => {
  it('proposes patches without writing when apply=false (default)', () => {
    const fx = makeFixtureHome();
    try {
      writeHook(fx.hooksDir, 'cap-x.js', '// cap-hook-lifecycle: Stop');
      writeSettings(fx.settingsPath, { hooks: {} });
      const before = fs.readFileSync(fx.settingsPath, 'utf8');
      const result = applyRegistrationFix({ homeDir: fx.root, settingsPath: fx.settingsPath });
      assert.strictEqual(result.applied, false);
      assert.strictEqual(result.backupPath, null);
      assert.strictEqual(result.patches.length, 1);
      assert.strictEqual(result.patches[0].op, 'add');
      assert.strictEqual(result.patches[0].path, '/hooks/Stop/-');
      const after = fs.readFileSync(fx.settingsPath, 'utf8');
      assert.strictEqual(before, after, 'settings.json must be untouched without apply:true');
    } finally { rmrf(fx.root); }
  });

  it('writes a timestamped backup and applies the patches when apply=true', () => {
    const fx = makeFixtureHome();
    try {
      writeHook(fx.hooksDir, 'cap-x.js', '// cap-hook-lifecycle: Stop');
      writeSettings(fx.settingsPath, { hooks: {}, otherKey: 'preserved' });
      const result = applyRegistrationFix({ homeDir: fx.root, settingsPath: fx.settingsPath, apply: true });
      assert.strictEqual(result.applied, true);
      assert.ok(result.backupPath, 'backup path must be set');
      assert.match(result.backupPath, /\.bak-pre-fix-/);
      assert.ok(fs.existsSync(result.backupPath), 'backup file must exist on disk');
      const next = JSON.parse(fs.readFileSync(fx.settingsPath, 'utf8'));
      assert.ok(Array.isArray(next.hooks.Stop), 'Stop block must be created');
      assert.strictEqual(next.hooks.Stop.length, 1);
      assert.match(next.hooks.Stop[0].hooks[0].command, /cap-x\.js/);
      assert.strictEqual(next.otherKey, 'preserved', 'unrelated keys must survive');
    } finally { rmrf(fx.root); }
  });

  it('is idempotent — running --fix twice does not double-register', () => {
    const fx = makeFixtureHome();
    try {
      writeHook(fx.hooksDir, 'cap-x.js', '// cap-hook-lifecycle: Stop');
      writeSettings(fx.settingsPath, { hooks: {} });
      applyRegistrationFix({ homeDir: fx.root, settingsPath: fx.settingsPath, apply: true });
      const second = applyRegistrationFix({ homeDir: fx.root, settingsPath: fx.settingsPath, apply: true });
      assert.strictEqual(second.patches.length, 0, 'second run should have nothing to do');
      const settings = JSON.parse(fs.readFileSync(fx.settingsPath, 'utf8'));
      assert.strictEqual(settings.hooks.Stop.length, 1, 'Stop block must contain exactly one entry');
    } finally { rmrf(fx.root); }
  });

  it('skips hooks with unknown lifecycle (no expected lifecycle → no patch)', () => {
    const fx = makeFixtureHome();
    try {
      writeHook(fx.hooksDir, 'cap-mystery.js', '// nothing useful here\n// totally bare');
      writeSettings(fx.settingsPath, { hooks: {} });
      const result = applyRegistrationFix({ homeDir: fx.root, settingsPath: fx.settingsPath, apply: true });
      assert.strictEqual(result.patches.length, 0, 'unknown-lifecycle hook gets no patch — caller must declare it first');
      assert.strictEqual(result.applied, false, 'no backup or write when zero patches');
    } finally { rmrf(fx.root); }
  });
});

// --- formatHookSection (presentation contract) ---

describe('formatHookSection', () => {
  it('returns a single OK line when ok=true', () => {
    const fx = makeFixtureHome();
    try {
      const hookPath = path.join(fx.hooksDir, 'cap-x.js');
      writeHook(fx.hooksDir, 'cap-x.js', '// cap-hook-lifecycle: Stop');
      writeSettings(fx.settingsPath, {
        hooks: { Stop: [{ hooks: [{ type: 'command', command: `node "${hookPath}"` }] }] },
      });
      const r = verifyHookRegistration({ homeDir: fx.root });
      const lines = formatHookSection(r);
      assert.ok(lines.some(l => /All 1 CAP hooks registered/.test(l)));
    } finally { rmrf(fx.root); }
  });

  it('lists each unregistered hook with its expected lifecycle', () => {
    const fx = makeFixtureHome();
    try {
      writeHook(fx.hooksDir, 'cap-a.js', '// cap-hook-lifecycle: Stop');
      writeHook(fx.hooksDir, 'cap-b.js', '// cap-hook-lifecycle: PostToolUse');
      writeSettings(fx.settingsPath, { hooks: {} });
      const r = verifyHookRegistration({ homeDir: fx.root });
      const out = formatHookSection(r).join('\n');
      assert.match(out, /cap-a\.js.*Stop/);
      assert.match(out, /cap-b\.js.*PostToolUse/);
      assert.match(out, /cap doctor --fix/);
    } finally { rmrf(fx.root); }
  });
});
