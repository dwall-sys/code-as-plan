'use strict';

// @cap-feature(feature:F-059) Research-First Gate Before Prototype — adversarial test suite.
// Probes: regex edge cases (scoped names, substrings), malformed package.json,
// timezone-drifted mtimes, symlinked docs, logging failure modes.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const gate = require('../cap/bin/lib/cap-research-gate.cjs');

function makeWorkspace(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `cap-research-gate-adv-${label}-`));
  fs.mkdirSync(path.join(root, '.cap', 'stack-docs'), { recursive: true });
  return { root, docsDir: path.join(root, '.cap', 'stack-docs') };
}

function writeDocAtAge(docsDir, libName, ageHours) {
  const p = path.join(docsDir, `${libName}.md`);
  fs.writeFileSync(p, `# ${libName}\n`, 'utf8');
  const mtime = new Date(Date.now() - ageHours * 60 * 60 * 1000);
  fs.utimesSync(p, mtime, mtime);
  return p;
}

describe('[adversarial] parseLibraryMentions — regex edge cases', () => {
  it('does not confuse "react" with "react-dom" when only one is in deps', () => {
    const descs = ['We use react-dom render to mount the tree'];
    const deps = ['react'];
    // "react" substring appears inside "react-dom" but boundary rule should reject it
    assert.deepEqual(gate.parseLibraryMentions(descs, deps), []);
  });

  it('matches react AND react-dom when both are in deps and both are mentioned', () => {
    const descs = ['Use react hooks and react-dom.render to mount'];
    const deps = ['react', 'react-dom'];
    assert.deepEqual(gate.parseLibraryMentions(descs, deps), ['react', 'react-dom']);
  });

  it('matches a dep that appears only at the very start of a description', () => {
    const descs = ['react is required here'];
    const deps = ['react'];
    assert.deepEqual(gate.parseLibraryMentions(descs, deps), ['react']);
  });

  it('matches a dep that appears only at the very end of a description', () => {
    const descs = ['configure the test runner with vitest'];
    const deps = ['vitest'];
    assert.deepEqual(gate.parseLibraryMentions(descs, deps), ['vitest']);
  });

  it('rejects a dep mentioned only inside a URL-like identifier', () => {
    const descs = ['see /api/prismaclient/v2 for migration notes'];
    const deps = ['prismaclient'];
    // Word boundary allows / but char class explicitly lists "/" so prismaclient inside a path is rejected
    assert.deepEqual(gate.parseLibraryMentions(descs, deps), []);
  });

  it('handles a dep name containing dots ("@types/node" / "lodash.merge")', () => {
    const descs = ['Use lodash.merge for deep object merge'];
    const deps = ['lodash.merge', 'lodash'];
    // Both match: lodash.merge via literal, lodash because the boundary after lodash is "."
    // The spec says a dep must match; both are in deps and both appear.
    const out = gate.parseLibraryMentions(descs, deps);
    assert.ok(out.includes('lodash.merge'));
  });

  it('accepts a dep mentioned with a trailing punctuation (e.g. "react.")', () => {
    const descs = ['We chose react.'];
    const deps = ['react'];
    assert.deepEqual(gate.parseLibraryMentions(descs, deps), ['react']);
  });

  it('accepts a scoped dep at end of line', () => {
    const descs = ['integrate @anthropic-ai/sdk'];
    const deps = ['@anthropic-ai/sdk'];
    assert.deepEqual(gate.parseLibraryMentions(descs, deps), ['@anthropic-ai/sdk']);
  });

  it('handles AC descriptions with non-ASCII characters (umlaut / emoji)', () => {
    const descs = ['Ähm, react für das Frontend — 🚀 rocket-emoji'];
    const deps = ['react'];
    assert.deepEqual(gate.parseLibraryMentions(descs, deps), ['react']);
  });

  it('scales to a large dep list + large description without exploding regex', () => {
    const deps = Array.from({ length: 500 }, (_, i) => `pkg-${i}`);
    const descs = [Array.from({ length: 2000 }, () => 'filler words here').join(' ') + ' pkg-42 match'];
    const started = Date.now();
    const out = gate.parseLibraryMentions(descs, deps);
    const elapsed = Date.now() - started;
    assert.deepEqual(out, ['pkg-42']);
    assert.ok(elapsed < 250, `parseLibraryMentions took ${elapsed}ms, expected <250ms`);
  });
});

describe('[adversarial] readPackageDependencies — malformed package.json', () => {
  it('tolerates package.json with non-object dependencies', () => {
    const ws = makeWorkspace('non-object-deps');
    fs.writeFileSync(
      path.join(ws.root, 'package.json'),
      JSON.stringify({ name: 'x', dependencies: 'not-an-object' }),
      'utf8',
    );
    assert.deepEqual(gate.readPackageDependencies(ws.root), []);
    fs.rmSync(ws.root, { recursive: true, force: true });
  });

  it('tolerates package.json with null dependencies', () => {
    const ws = makeWorkspace('null-deps');
    fs.writeFileSync(
      path.join(ws.root, 'package.json'),
      JSON.stringify({ name: 'x', dependencies: null, devDependencies: null }),
      'utf8',
    );
    assert.deepEqual(gate.readPackageDependencies(ws.root), []);
    fs.rmSync(ws.root, { recursive: true, force: true });
  });

  it('ignores non-string dep keys (normalised by JSON so not a real risk, but pin behaviour)', () => {
    const ws = makeWorkspace('string-deps');
    fs.writeFileSync(
      path.join(ws.root, 'package.json'),
      JSON.stringify({ name: 'x', dependencies: { '': '1.0', valid: '^2' } }),
      'utf8',
    );
    const out = gate.readPackageDependencies(ws.root);
    // Empty string is filtered out by length > 0 check
    assert.deepEqual(out, ['valid']);
    fs.rmSync(ws.root, { recursive: true, force: true });
  });

  it('returns [] for an empty file', () => {
    const ws = makeWorkspace('empty-pkg');
    fs.writeFileSync(path.join(ws.root, 'package.json'), '', 'utf8');
    assert.deepEqual(gate.readPackageDependencies(ws.root), []);
    fs.rmSync(ws.root, { recursive: true, force: true });
  });
});

describe('[adversarial] checkStackDocs — filesystem edge cases', () => {
  it('future-dated mtime counts as fresh (age clamped to 0)', () => {
    const ws = makeWorkspace('future-mtime');
    const p = path.join(ws.docsDir, 'future-lib.md');
    fs.writeFileSync(p, '# future', 'utf8');
    // Set mtime 10 days in the future — cap-stack-docs clamps Math.max(0, ...).
    const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    fs.utimesSync(p, future, future);
    const r = gate.checkStackDocs(ws.root, ['future-lib'], 30);
    assert.deepEqual(r.fresh, ['future-lib']);
    assert.deepEqual(r.missing, []);
    assert.deepEqual(r.stale, []);
    fs.rmSync(ws.root, { recursive: true, force: true });
  });

  it('exactly-at-threshold counts as fresh (≤ comparison)', () => {
    const ws = makeWorkspace('boundary');
    // 30 days - 1 hour safety margin to avoid flakiness around mtime rounding
    writeDocAtAge(ws.docsDir, 'boundary', 30 * 24 - 1);
    const r = gate.checkStackDocs(ws.root, ['boundary'], 30);
    assert.deepEqual(r.fresh, ['boundary']);
    fs.rmSync(ws.root, { recursive: true, force: true });
  });

  it('treats a symlinked doc path as the file it points to', () => {
    const ws = makeWorkspace('symlink');
    const realPath = path.join(ws.root, 'real.md');
    fs.writeFileSync(realPath, '# real', 'utf8');
    // Make it old so we see the symlink resolution actually tracks mtime of target.
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    fs.utimesSync(realPath, old, old);
    fs.symlinkSync(realPath, path.join(ws.docsDir, 'sym-lib.md'));
    const r = gate.checkStackDocs(ws.root, ['sym-lib'], 30);
    // Node's statSync follows symlinks by default → mtime of target → stale
    assert.deepEqual(r.stale, ['sym-lib']);
    fs.rmSync(ws.root, { recursive: true, force: true });
  });

  it('silently skips non-string / empty library names', () => {
    const ws = makeWorkspace('bad-names');
    writeDocAtAge(ws.docsDir, 'real-lib', 24);
    const r = gate.checkStackDocs(ws.root, ['real-lib', '', null, undefined, 0], 30);
    assert.deepEqual(r.fresh, ['real-lib']);
    fs.rmSync(ws.root, { recursive: true, force: true });
  });
});

describe('[adversarial] runGate — robustness', () => {
  it('uses default maxAgeDays when opts.maxAgeDays is 0 or negative', () => {
    const ws = makeWorkspace('nonpositive');
    fs.writeFileSync(
      path.join(ws.root, 'package.json'),
      JSON.stringify({ dependencies: { react: '^18' } }),
      'utf8',
    );
    writeDocAtAge(ws.docsDir, 'react', 24 * 29); // 29 days
    const r = gate.runGate({
      projectRoot: ws.root,
      acDescriptions: ['use react here'],
      maxAgeDays: 0, // should be ignored in favour of DEFAULT_MAX_AGE_DAYS (30)
    });
    assert.equal(r.maxAgeDays, gate.DEFAULT_MAX_AGE_DAYS);
    assert.deepEqual(r.fresh, ['react']);
    fs.rmSync(ws.root, { recursive: true, force: true });
  });

  it('dependencies override bypasses package.json read entirely', () => {
    const ws = makeWorkspace('deps-override');
    // No package.json on disk
    const r = gate.runGate({
      projectRoot: ws.root,
      acDescriptions: ['react and prisma'],
      dependencies: ['react', 'prisma'],
    });
    assert.deepEqual(r.libraries.sort(), ['prisma', 'react']);
    fs.rmSync(ws.root, { recursive: true, force: true });
  });

  it('empty AC descriptions yield empty libraries + empty buckets (no-op result, not an error)', () => {
    const ws = makeWorkspace('empty-acs');
    fs.writeFileSync(
      path.join(ws.root, 'package.json'),
      JSON.stringify({ dependencies: { react: '^18' } }),
      'utf8',
    );
    const r = gate.runGate({ projectRoot: ws.root, acDescriptions: [] });
    assert.deepEqual(r.libraries, []);
    assert.deepEqual(r.missing, []);
    assert.deepEqual(r.stale, []);
    assert.deepEqual(r.fresh, []);
    fs.rmSync(ws.root, { recursive: true, force: true });
  });
});

describe('[adversarial] formatWarning — output invariants (AC-3/AC-5)', () => {
  it('never renders "[y/N]" when both missing and stale are empty — no user prompt without reason', () => {
    const out = gate.formatWarning({ missing: [], stale: [], maxAgeDays: 30 });
    assert.equal(out, '');
    assert.ok(!out.includes('[y/N]'));
  });

  it('always renders the /cap:refresh-docs recommendation when there is something to refresh', () => {
    const out = gate.formatWarning({ missing: ['a'], stale: ['b'], maxAgeDays: 30 });
    assert.match(out, /\/cap:refresh-docs a b/);
  });

  it('tolerates unusual but valid lib names in the rendered command', () => {
    const out = gate.formatWarning({ missing: ['@anthropic-ai/sdk', 'lodash.merge'], stale: [], maxAgeDays: 30 });
    assert.match(out, /@anthropic-ai\/sdk/);
    assert.match(out, /lodash\.merge/);
  });

  it('omits the stale section when stale is empty', () => {
    const out = gate.formatWarning({ missing: ['a'], stale: [], maxAgeDays: 30 });
    assert.ok(!out.includes('Stale'));
    assert.match(out, /Missing: a/);
  });

  it('omits the missing section when missing is empty', () => {
    const out = gate.formatWarning({ missing: [], stale: ['a'], maxAgeDays: 30 });
    assert.ok(!out.includes('Missing:'));
    assert.match(out, /Stale \(> 30 days\): a/);
  });
});

describe('[adversarial] logGateCheck — failure modes (AC-6)', () => {
  it('creates the .cap directory if missing', () => {
    const ws = makeWorkspace('log-creates-dir');
    fs.rmSync(path.join(ws.root, '.cap'), { recursive: true, force: true });
    gate.logGateCheck(ws.root, { libsChecked: 1, missing: 0, stale: 0 });
    const logPath = path.join(ws.root, '.cap', 'session-log.jsonl');
    assert.ok(fs.existsSync(logPath));
    fs.rmSync(ws.root, { recursive: true, force: true });
  });

  it('coerces missing counts to 0 when the record passes non-numeric values', () => {
    const ws = makeWorkspace('log-coerce');
    gate.logGateCheck(ws.root, { libsChecked: 'bogus', missing: null, stale: undefined });
    const lines = fs.readFileSync(path.join(ws.root, '.cap', 'session-log.jsonl'), 'utf8').trim().split('\n');
    const rec = JSON.parse(lines[0]);
    assert.equal(rec.libsChecked, 0);
    assert.equal(rec.missing, 0);
    assert.equal(rec.stale, 0);
    fs.rmSync(ws.root, { recursive: true, force: true });
  });

  it('ignores an empty projectRoot without throwing', () => {
    assert.doesNotThrow(() => gate.logGateCheck('', { libsChecked: 1 }));
  });
});
