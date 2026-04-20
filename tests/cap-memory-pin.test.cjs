'use strict';

// @cap-feature(feature:F-030) Tests for cap-memory-pin.cjs — pin/unpin @cap-pitfall annotations.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const pinModule = require('../cap/bin/lib/cap-memory-pin.cjs');

let tmp;
let targetFile;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-memory-pin-'));
  targetFile = path.join(tmp, 'src.cjs');
});

afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('pin/unpin happy path', () => {
  it('adds pinned:true to a @cap-pitfall without metadata', () => {
    fs.writeFileSync(targetFile, [
      "'use strict';",
      '// @cap-pitfall Watch out for regex escaping',
      'function foo() {}',
    ].join('\n'));

    const r = pinModule.pin(targetFile, 'Watch out');
    assert.strictEqual(r.changed, true);
    assert.strictEqual(r.status, 'pinned');
    assert.strictEqual(r.line, 2);
    const written = fs.readFileSync(targetFile, 'utf8');
    assert.ok(written.includes('@cap-pitfall(pinned:true)'));
  });

  it('adds pinned:true to an existing metadata block', () => {
    fs.writeFileSync(targetFile, [
      '// @cap-pitfall(sessions:3) Retry loop gotcha',
      'const x = 1;',
    ].join('\n'));
    const r = pinModule.pin(targetFile, 'Retry');
    assert.strictEqual(r.changed, true);
    const written = fs.readFileSync(targetFile, 'utf8');
    assert.ok(written.includes('@cap-pitfall(sessions:3, pinned:true)'));
  });

  it('unpin removes pinned:true token from metadata', () => {
    fs.writeFileSync(targetFile, [
      '// @cap-pitfall(sessions:3, pinned:true) Retry loop gotcha',
    ].join('\n'));
    const r = pinModule.unpin(targetFile, 'Retry');
    assert.strictEqual(r.changed, true);
    assert.strictEqual(r.status, 'unpinned');
    const written = fs.readFileSync(targetFile, 'utf8');
    assert.ok(!written.includes('pinned:true'));
    assert.ok(written.includes('@cap-pitfall(sessions:3)'));
  });

  it('unpin with only pinned token collapses to empty metadata', () => {
    fs.writeFileSync(targetFile, [
      '// @cap-pitfall(pinned:true) Single token gotcha',
    ].join('\n'));
    const r = pinModule.unpin(targetFile, 'Single');
    assert.strictEqual(r.changed, true);
    const written = fs.readFileSync(targetFile, 'utf8');
    assert.ok(written.startsWith('// @cap-pitfall Single token gotcha'));
  });
});

describe('pin/unpin idempotency + no-ops', () => {
  it('already-pinned returns status=already-pinned and does not rewrite', () => {
    fs.writeFileSync(targetFile, [
      '// @cap-pitfall(pinned:true) Deadlock window',
    ].join('\n'));
    const before = fs.readFileSync(targetFile, 'utf8');
    const r = pinModule.pin(targetFile, 'Deadlock');
    assert.strictEqual(r.status, 'already-pinned');
    assert.strictEqual(r.changed, false);
    assert.strictEqual(fs.readFileSync(targetFile, 'utf8'), before);
  });

  it('unpin on a non-pinned annotation returns status=not-pinned', () => {
    fs.writeFileSync(targetFile, [
      '// @cap-pitfall Nothing pinned here',
    ].join('\n'));
    const r = pinModule.unpin(targetFile, 'Nothing');
    assert.strictEqual(r.status, 'not-pinned');
    assert.strictEqual(r.changed, false);
  });
});

describe('error / edge cases', () => {
  it('returns not-found when prefix does not match any pitfall', () => {
    fs.writeFileSync(targetFile, [
      '// @cap-pitfall Other pitfall',
      'const x = 1;',
    ].join('\n'));
    const r = pinModule.pin(targetFile, 'Doesnotexist');
    assert.strictEqual(r.status, 'not-found');
    assert.strictEqual(r.changed, false);
  });

  it('returns ambiguous when multiple pitfalls match the prefix', () => {
    fs.writeFileSync(targetFile, [
      '// @cap-pitfall Common issue with foo',
      '// @cap-pitfall Common issue with bar',
    ].join('\n'));
    const r = pinModule.pin(targetFile, 'Common');
    assert.strictEqual(r.status, 'ambiguous');
    assert.strictEqual(r.candidates.length, 2);
    assert.strictEqual(r.changed, false);
  });

  it('returns read-error on a missing file', () => {
    const r = pinModule.pin(path.join(tmp, 'does-not-exist.cjs'), 'anything');
    assert.strictEqual(r.status, 'read-error');
    assert.strictEqual(r.file, null);
  });

  it('ignores non-pitfall annotations (@cap-history, @cap-pattern)', () => {
    fs.writeFileSync(targetFile, [
      '// @cap-history(sessions:5) Hot module',
      '// @cap-pattern(key:value) Approach',
    ].join('\n'));
    const r = pinModule.pin(targetFile, 'Hot');
    assert.strictEqual(r.status, 'not-found');
  });

  it('handles Python-style # comments', () => {
    const py = path.join(tmp, 'x.py');
    fs.writeFileSync(py, [
      '# @cap-pitfall Indentation bug',
      'def foo(): pass',
    ].join('\n'));
    const r = pinModule.pin(py, 'Indentation');
    assert.strictEqual(r.changed, true);
    const written = fs.readFileSync(py, 'utf8');
    assert.ok(written.includes('# @cap-pitfall(pinned:true)'));
  });

  it('dryRun does not write to disk but still returns changed=true', () => {
    fs.writeFileSync(targetFile, '// @cap-pitfall Preview me\n');
    const before = fs.readFileSync(targetFile, 'utf8');
    const r = pinModule.pin(targetFile, 'Preview', { dryRun: true });
    assert.strictEqual(r.changed, true);
    assert.strictEqual(fs.readFileSync(targetFile, 'utf8'), before, 'file must not be written in dry-run');
  });
});

describe('formatResult', () => {
  it('renders each status variant as a human-readable string', () => {
    assert.ok(pinModule.formatResult({ status: 'pinned', file: 'x', line: 2, description: 'Foo' }).includes('pinned x:2'));
    assert.ok(pinModule.formatResult({ status: 'unpinned', file: 'x', line: 2, description: 'Foo' }).includes('unpinned'));
    assert.ok(pinModule.formatResult({ status: 'already-pinned', file: 'x', line: 2 }).includes('already pinned'));
    assert.ok(pinModule.formatResult({ status: 'not-pinned', file: 'x', line: 2 }).includes('was not pinned'));
    assert.ok(pinModule.formatResult({ status: 'not-found', file: 'x' }).includes('no @cap-pitfall'));
    assert.ok(pinModule.formatResult({ status: 'ambiguous', candidates: ['a', 'b'] }).includes('ambiguous'));
    assert.ok(pinModule.formatResult({ status: 'read-error' }).includes('could not read'));
  });
});
