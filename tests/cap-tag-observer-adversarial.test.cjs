'use strict';

// @cap-feature(feature:F-054) Hook-Based Tag Event Observation — adversarial test suite.
// Sibling of tests/cap-tag-observer.test.cjs (happy-path). These tests probe the
// gaps a feature author naturally overlooks: parser edge-cases, JSONL contract
// under rapid/concurrent calls, snapshot corruption, UTC rotation boundaries,
// non-blocking error modes, and the hook entry-point's hardening.

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const observer = require('../cap/bin/lib/cap-tag-observer.cjs');
const HOOK_PATH = path.join(__dirname, '..', 'hooks', 'cap-tag-observer.js');

function makeWorkspace(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `cap-obs-adv-${label}-`));
  const rawDir = path.join(root, '.cap', 'memory', 'raw');
  return { root, rawDir };
}

function cleanup(ws) {
  try { fs.rmSync(ws.root, { recursive: true, force: true }); } catch { /* noop */ }
}

// ───────────────────────────────────────────────────────────────────────────────
// extractTags — parser edge cases (AC-2)
// ───────────────────────────────────────────────────────────────────────────────

describe('adversarial :: extractTags parser edge-cases (AC-2)', () => {
  it('does NOT count a @cap-feature token embedded in a string literal (no leading comment token)', () => {
    // This is already covered implicitly by the happy-path suite, but we also
    // assert it in an adversarial context with JS/Python/shell syntax variants.
    const src = [
      'const s = "// @cap-feature(feature:F-999) inside JS string";',
      "s2 = '# @cap-todo(ac:F-999/AC-1) inside python string'",
      'echo "@cap-feature(feature:F-999) inside bash string"',
    ].join('\n');
    assert.deepEqual(observer.extractTags(src), []);
  });

  it('does NOT count a @cap-feature mention in plain markdown prose (no leading comment prefix)', () => {
    const src = [
      'This paragraph mentions @cap-feature(feature:F-777) without a comment prefix.',
      '   @cap-todo(ac:F-777/AC-1) indented prose, still no comment token',
      '',
      '> @cap-feature(feature:F-777) blockquote',
    ].join('\n');
    assert.deepEqual(observer.extractTags(src), []);
  });

  it('captures all tags when multiple @cap-feature/@cap-todo occur on the same comment line', () => {
    // Adversarial: the implementation uses String.prototype.match (not matchAll)
    // against TAG_TOKEN_RE — does it capture BOTH tokens on a line like:
    //   "// @cap-feature(feature:F-001) and @cap-todo(ac:F-001/AC-1)" ?
    // The AC says the *diff* needs to reflect added tags. If the second token is
    // silently dropped, a real-world line "@cap-feature + @cap-todo on one line"
    // would lose one of them. Expected correct behaviour: both tags emitted.
    const src = '// @cap-feature(feature:F-001) and @cap-todo(ac:F-001/AC-1)\n';
    const tags = observer.extractTags(src);
    assert.ok(
      tags.includes('@cap-feature(feature:F-001)'),
      `expected @cap-feature on same line as @cap-todo to be captured, got ${JSON.stringify(tags)}`,
    );
    assert.ok(
      tags.includes('@cap-todo(ac:F-001/AC-1)'),
      `expected @cap-todo on same line as @cap-feature to be captured, got ${JSON.stringify(tags)}`,
    );
    assert.equal(tags.length, 2, `expected exactly 2 tags on that line, got ${JSON.stringify(tags)}`);
  });

  it('handles an unclosed paren gracefully (no throw, tag still emitted as bare token)', () => {
    // Adversarial: a developer typo leaves the paren unclosed. The regex
    //   (?:\([^)]*\))?  is optional — so the line still matches. The token
    // captured is the bare "@cap-todo" without the broken parenthetical.
    // Requirement: never throw; either skip or capture the bare token.
    const src = '// @cap-todo(ac:F-054/AC-1 oops no close paren\n// @cap-feature(feature:F-054)\n';
    let tags;
    assert.doesNotThrow(() => { tags = observer.extractTags(src); });
    assert.ok(Array.isArray(tags));
    // The valid tag on line 2 must still be captured:
    assert.ok(
      tags.includes('@cap-feature(feature:F-054)'),
      `valid tag on subsequent line must still be captured, got ${JSON.stringify(tags)}`,
    );
  });

  it('accepts Unicode in tag metadata without throwing or mangling the identity', () => {
    const src = '// @cap-feature(feature:F-001:Ümlaut-日本語) unicode meta\n';
    const tags = observer.extractTags(src);
    assert.equal(tags.length, 1, `expected 1 tag for unicode metadata, got ${JSON.stringify(tags)}`);
    assert.ok(tags[0].includes('Ümlaut'));
    assert.ok(tags[0].includes('日本語'));
  });

  it('normalises internal whitespace so `@cap-todo ( ac:F-1/AC-1 )` == `@cap-todo(ac:F-1/AC-1)`', () => {
    // The module docstring claims internal-whitespace normalisation. Verify.
    // NOTE: TAG_TOKEN_RE has no \s between `@cap-todo` and `(`, so the "extra
    // whitespace" form may not be captured at all. If so, this surfaces the gap.
    const src1 = '// @cap-todo(ac:F-1/AC-1) a\n';
    const src2 = '// @cap-todo ( ac:F-1/AC-1 ) b\n';
    const t1 = observer.extractTags(src1);
    const t2 = observer.extractTags(src2);
    // Regardless of whether src2 is captured at all, it must NOT throw:
    assert.doesNotThrow(() => observer.extractTags(src2));
    // If the regex *does* capture src2, the normalised identity must match src1.
    // If not, that's a known limitation — we assert the stronger promise the
    // docstring makes (normalisation) and let RED surface the gap.
    if (t2.length > 0) {
      assert.deepEqual(t2, t1, 'normalised tags with inner whitespace must equal canonical form');
    } else {
      assert.fail(
        'docstring promises whitespace normalisation inside parens, but the regex does not capture `@cap-todo ( ... )` at all',
      );
    }
  });

  it('deduplicates identical tag identities even when they appear N times across N lines', () => {
    const src = [
      '// @cap-feature(feature:F-1)',
      '// @cap-feature(feature:F-1)',
      '// @cap-feature(feature:F-1)',
      '// @cap-feature(feature:F-1)',
      '// @cap-feature(feature:F-1)',
    ].join('\n');
    const tags = observer.extractTags(src);
    assert.equal(tags.length, 1, 'set-semantics: 5 copies of the same tag collapse to 1');
    assert.equal(tags[0], '@cap-feature(feature:F-1)');
  });

  it('returns stable, sorted output (order-independent tag identity)', () => {
    const src1 = '// @cap-todo(ac:F-1/AC-2)\n// @cap-feature(feature:F-1)\n';
    const src2 = '// @cap-feature(feature:F-1)\n// @cap-todo(ac:F-1/AC-2)\n';
    assert.deepEqual(observer.extractTags(src1), observer.extractTags(src2));
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// diffTags — boundary conditions (AC-2)
// ───────────────────────────────────────────────────────────────────────────────

describe('adversarial :: diffTags boundary conditions (AC-2)', () => {
  it('returns empty added/removed when both inputs are empty arrays', () => {
    const diff = observer.diffTags([], []);
    assert.deepEqual(diff.added, []);
    assert.deepEqual(diff.removed, []);
  });

  it('handles duplicate inputs without double-counting', () => {
    const diff = observer.diffTags(['@cap-feature(F-1)', '@cap-feature(F-1)'], ['@cap-feature(F-1)']);
    assert.deepEqual(diff.added, []);
    assert.deepEqual(diff.removed, []);
  });

  it('returns null-safe results when both sides are null/undefined', () => {
    const diff = observer.diffTags(null, undefined);
    assert.deepEqual(diff.added, []);
    assert.deepEqual(diff.removed, []);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// JSONL contract under stress (AC-3, AC-4)
// ───────────────────────────────────────────────────────────────────────────────

describe('adversarial :: JSONL event correctness (AC-3, AC-4)', () => {
  let ws;
  beforeEach(() => { ws = makeWorkspace('jsonl'); });
  after(() => { if (ws) cleanup(ws); });

  it('rapid-succession of 50 alternating observe() calls yields 50 parseable JSONL lines (no interleaving corruption)', () => {
    const file = path.join(ws.root, 'rapid.js');
    fs.writeFileSync(file, '');

    for (let i = 0; i < 50; i++) {
      // Alternate tag contents every iteration so each call produces a non-empty diff.
      const tag = (i % 2 === 0)
        ? '// @cap-feature(feature:F-EVEN)\n'
        : '// @cap-feature(feature:F-ODD)\n';
      fs.writeFileSync(file, tag);
      observer.observe({ filePath: file, tool: 'Edit', rawDir: ws.rawDir });
    }

    const day = observer._dayStamp(new Date());
    const logFile = path.join(ws.rawDir, `tag-events-${day}.jsonl`);
    const content = fs.readFileSync(logFile, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    assert.equal(lines.length, 50, `expected 50 JSONL lines, got ${lines.length}`);

    // Every line must parse cleanly and have the documented shape.
    let added = 0; let removed = 0;
    for (const line of lines) {
      const ev = JSON.parse(line); // throws if corrupted
      assert.equal(typeof ev.timestamp, 'string');
      assert.equal(ev.tool, 'Edit');
      assert.ok(Array.isArray(ev.added));
      assert.ok(Array.isArray(ev.removed));
      added += ev.added.length;
      removed += ev.removed.length;
    }
    // Sanity: each call adds exactly one tag and removes at most one.
    assert.ok(added >= 50, 'each call should have contributed at least one added tag');
    assert.ok(removed >= 49, 'all calls after the first should have removed the prior tag');
  });

  it('first observation of a file that contains ZERO @cap tags produces NO event (AC-4)', () => {
    const file = path.join(ws.root, 'tagless.js');
    fs.writeFileSync(file, 'const x = 1;\n// ordinary comment with no @cap tags\n');
    const res = observer.observe({ filePath: file, tool: 'Write', rawDir: ws.rawDir });
    assert.equal(res.eventWritten, false);
    assert.deepEqual(res.added, []);
    assert.deepEqual(res.removed, []);

    const day = observer._dayStamp(new Date());
    const logFile = path.join(ws.rawDir, `tag-events-${day}.jsonl`);
    assert.equal(fs.existsSync(logFile), false, 'no JSONL must exist for a tagless first observation');
  });

  it('snapshot is primed even on tagless first-observe so subsequent tagless calls stay silent', () => {
    const file = path.join(ws.root, 'tagless2.js');
    fs.writeFileSync(file, '// plain comment\n');
    observer.observe({ filePath: file, tool: 'Write', rawDir: ws.rawDir });
    const res = observer.observe({ filePath: file, tool: 'Edit', rawDir: ws.rawDir });
    assert.equal(res.eventWritten, false);
    assert.deepEqual(res.added, []);
    assert.deepEqual(res.removed, []);
  });

  it('file paths with spaces and special characters are serialised safely in JSONL', () => {
    const dirWithSpace = path.join(ws.root, 'weird dir with spaces & symbols');
    fs.mkdirSync(dirWithSpace, { recursive: true });
    const file = path.join(dirWithSpace, 'name with "quotes" and \\backslash.js');
    fs.writeFileSync(file, '// @cap-feature(feature:F-054)\n');
    const res = observer.observe({ filePath: file, tool: 'Write', rawDir: ws.rawDir });
    assert.equal(res.eventWritten, true);

    const day = observer._dayStamp(new Date());
    const logFile = path.join(ws.rawDir, `tag-events-${day}.jsonl`);
    const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);
    // JSON.parse must succeed and the file field must round-trip.
    const ev = JSON.parse(lines[0]);
    assert.equal(ev.file, path.resolve(file));
  });

  it('rotates correctly across a UTC day boundary even though events arrive out of order', () => {
    // Adversarial vs the happy-path test: two events on the same file that cross
    // a UTC day boundary. The LATER-timestamped event could arrive to a log file
    // that already exists for day 1; day 2's event must land in a new file.
    const file = path.join(ws.root, 'rotate.js');

    // T-minus-1 second before UTC midnight.
    const lateDay1 = new Date('2026-03-14T23:59:59Z');
    fs.writeFileSync(file, '// @cap-feature(feature:F-054)\n');
    observer.observe({ filePath: file, tool: 'Write', rawDir: ws.rawDir, now: lateDay1 });

    // T-plus-1 second after UTC midnight — different day, different file.
    const earlyDay2 = new Date('2026-03-15T00:00:01Z');
    fs.writeFileSync(file, '// @cap-feature(feature:F-054)\n// @cap-todo(ac:F-054/AC-7)\n');
    observer.observe({ filePath: file, tool: 'Edit', rawDir: ws.rawDir, now: earlyDay2 });

    const f1 = path.join(ws.rawDir, 'tag-events-2026-03-14.jsonl');
    const f2 = path.join(ws.rawDir, 'tag-events-2026-03-15.jsonl');
    assert.ok(fs.existsSync(f1), 'day-1 log must exist');
    assert.ok(fs.existsSync(f2), 'day-2 log must exist');
    assert.equal(fs.readFileSync(f1, 'utf8').trim().split('\n').length, 1);
    assert.equal(fs.readFileSync(f2, 'utf8').trim().split('\n').length, 1);
    // And the day-1 file must NOT have been rotated INTO (no smearing).
    assert.equal(fs.readFileSync(f1, 'utf8').includes('2026-03-15'), false);
  });

  it('UTC rotation is independent of the host locale/TZ offset (simulated via `now` injection)', () => {
    // A developer in Europe/Berlin (+01:00) edits at 00:30 local time on March 15.
    // UTC-wise that's March 14 23:30 — the log must carry 2026-03-14, NOT 03-15.
    const file = path.join(ws.root, 'tz.js');
    fs.writeFileSync(file, '// @cap-feature(feature:F-054)\n');
    const localMidnightIsh = new Date('2026-03-14T23:30:00Z');
    observer.observe({ filePath: file, tool: 'Write', rawDir: ws.rawDir, now: localMidnightIsh });

    const f = path.join(ws.rawDir, 'tag-events-2026-03-14.jsonl');
    assert.ok(fs.existsSync(f), 'UTC stamp must be 2026-03-14 regardless of host TZ');
    assert.equal(
      fs.existsSync(path.join(ws.rawDir, 'tag-events-2026-03-15.jsonl')),
      false,
      'no premature rotation into the next UTC day',
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// Snapshot roundtrip + corruption (AC-2)
// ───────────────────────────────────────────────────────────────────────────────

describe('adversarial :: snapshot roundtrip + corruption (AC-2)', () => {
  let ws;
  beforeEach(() => { ws = makeWorkspace('snap'); });
  after(() => { if (ws) cleanup(ws); });

  it('writeSnapshot → loadSnapshot roundtrip preserves tags, file, and sort order', () => {
    const file = path.join(ws.root, 'roundtrip.js');
    fs.writeFileSync(file, '');
    const data = {
      file: path.resolve(file),
      tags: ['@cap-feature(feature:F-001)', '@cap-todo(ac:F-001/AC-1)', '@cap-todo(ac:F-001/AC-2)'],
      mtime: 12345,
      updatedAt: '2026-04-20T12:00:00.000Z',
    };
    observer.writeSnapshot(ws.rawDir, file, data);
    const loaded = observer.loadSnapshot(ws.rawDir, file);
    assert.ok(loaded, 'snapshot must load back');
    assert.deepEqual(loaded.tags, data.tags);
    assert.equal(loaded.file, data.file);
    assert.equal(loaded.updatedAt, data.updatedAt);
  });

  it('loadSnapshot returns null (not throw) for a corrupted/malformed snapshot file on disk', () => {
    const file = path.join(ws.root, 'corrupt.js');
    // Pre-create a bad snapshot by writing invalid JSON at the expected path.
    const snapPath = observer.snapshotPath(ws.rawDir, file);
    fs.mkdirSync(path.dirname(snapPath), { recursive: true });
    fs.writeFileSync(snapPath, '{ not valid json ::: ');

    let loaded;
    assert.doesNotThrow(() => { loaded = observer.loadSnapshot(ws.rawDir, file); });
    assert.equal(loaded, null, 'corrupted snapshot must be treated as missing, not thrown');
  });

  it('observe() recovers from a corrupted snapshot by treating it as "no prior state" and emitting a full-added event', () => {
    const file = path.join(ws.root, 'recover.js');
    fs.writeFileSync(file, '// @cap-feature(feature:F-054)\n// @cap-todo(ac:F-054/AC-2)\n');

    // Plant a corrupted snapshot on disk.
    const snapPath = observer.snapshotPath(ws.rawDir, file);
    fs.mkdirSync(path.dirname(snapPath), { recursive: true });
    fs.writeFileSync(snapPath, 'not-json');

    const res = observer.observe({ filePath: file, tool: 'Write', rawDir: ws.rawDir });
    assert.equal(res.eventWritten, true, 'corrupted snapshot must not block observation');
    assert.equal(res.added.length, 2, 'all current tags should be reported as added after recovery');
    assert.deepEqual(res.removed, []);

    // And a fresh, valid snapshot must have replaced the corrupted one.
    const healed = observer.loadSnapshot(ws.rawDir, file);
    assert.ok(healed, 'snapshot must be healed after successful observation');
    assert.equal(healed.tags.length, 2);
  });

  it('writeSnapshot creates the .snapshots/ directory on first write (directory auto-provisioning)', () => {
    const file = path.join(ws.root, 'fresh.js');
    fs.writeFileSync(file, '');
    // The .snapshots/ dir does not exist yet.
    const snapDir = path.join(ws.rawDir, '.snapshots');
    assert.equal(fs.existsSync(snapDir), false, 'precondition: .snapshots/ must not pre-exist');

    observer.writeSnapshot(ws.rawDir, file, {
      file: path.resolve(file), tags: [], mtime: null, updatedAt: new Date().toISOString(),
    });
    assert.equal(fs.existsSync(snapDir), true, '.snapshots/ must be auto-provisioned');
  });

  it('snapshotPath is deterministic — same file path yields the same hash-based path', () => {
    const file = path.join(ws.root, 'stable.js');
    const p1 = observer.snapshotPath(ws.rawDir, file);
    const p2 = observer.snapshotPath(ws.rawDir, file);
    assert.equal(p1, p2, 'snapshotPath must be deterministic for identical inputs');
  });

  it('snapshotPath distinguishes distinct files (no collision on trivial cases)', () => {
    const a = observer.snapshotPath(ws.rawDir, path.join(ws.root, 'a.js'));
    const b = observer.snapshotPath(ws.rawDir, path.join(ws.root, 'b.js'));
    assert.notEqual(a, b, 'different file paths must hash to different snapshot paths');
  });

  it('leaves NO orphaned `.tmp` files in .snapshots/ after a successful observe()', () => {
    const file = path.join(ws.root, 'clean.js');
    fs.writeFileSync(file, '// @cap-feature(feature:F-054)\n');
    observer.observe({ filePath: file, tool: 'Write', rawDir: ws.rawDir });
    const snapDir = path.join(ws.rawDir, '.snapshots');
    const entries = fs.readdirSync(snapDir);
    const tmps = entries.filter((e) => e.endsWith('.tmp'));
    assert.equal(tmps.length, 0, `no .tmp files should remain, found: ${JSON.stringify(tmps)}`);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// Non-blocking error paths (AC-6)
// ───────────────────────────────────────────────────────────────────────────────

describe('adversarial :: non-blocking error paths (AC-6)', () => {
  let ws;
  beforeEach(() => { ws = makeWorkspace('err'); });
  after(() => { if (ws) cleanup(ws); });

  it('does not throw when readFile injector throws (file system error simulation)', () => {
    const file = path.join(ws.root, 'simulated-fs-error.js');
    const readFile = () => { throw new Error('EIO: simulated disk failure'); };
    let res;
    assert.doesNotThrow(() => {
      res = observer.observe({ filePath: file, tool: 'Edit', rawDir: ws.rawDir, readFile });
    });
    assert.equal(res.eventWritten, false);
    // errors.log must have been appended.
    const errorLog = path.join(ws.rawDir, 'errors.log');
    assert.ok(fs.existsSync(errorLog));
    const entry = JSON.parse(fs.readFileSync(errorLog, 'utf8').trim().split('\n')[0]);
    assert.ok(entry.message.includes('EIO'));
  });

  it('binary file content produces no tags and no event (extractTags is safe on non-text bytes)', () => {
    const file = path.join(ws.root, 'binary.bin');
    // JPG-ish magic + random bytes. utf8-decode will produce replacement chars
    // but must not throw; extractTags must return [].
    const bin = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0xff]);
    fs.writeFileSync(file, bin);
    let res;
    assert.doesNotThrow(() => {
      res = observer.observe({ filePath: file, tool: 'Write', rawDir: ws.rawDir });
    });
    assert.equal(res.eventWritten, false, 'binary file must not emit a spurious event');
    assert.deepEqual(res.added, []);
  });

  it('logError is idempotent and swallows its own failures when errors.log is unwritable', { skip: process.platform === 'win32' }, () => {
    // Make rawDir exist but make errors.log itself un-writable.
    fs.mkdirSync(ws.rawDir, { recursive: true });
    const errorLog = path.join(ws.rawDir, 'errors.log');
    fs.writeFileSync(errorLog, '');
    fs.chmodSync(errorLog, 0o000);
    try {
      assert.doesNotThrow(() => {
        observer.logError(ws.rawDir, new Error('outer'));
      }, 'logError must never throw even when its own target is unwritable');
    } finally {
      // Restore mode so cleanup can remove the file.
      try { fs.chmodSync(errorLog, 0o600); } catch { /* noop */ }
    }
  });

  it('observe() does not crash when rawDir is inside a read-only parent directory', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => {
    // Create parent, lock it, point rawDir at a non-existent child.
    const locked = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-obs-locked-'));
    fs.chmodSync(locked, 0o500); // read+execute only, no write.
    try {
      const rawDir = path.join(locked, 'raw');
      const file = path.join(ws.root, 'will-fail.js');
      fs.writeFileSync(file, '// @cap-feature(feature:F-054)\n');
      let res;
      assert.doesNotThrow(() => {
        res = observer.observe({ filePath: file, tool: 'Write', rawDir });
      }, 'observe must swallow mkdir EACCES');
      // The event should NOT be marked as written since the append failed.
      assert.equal(res.eventWritten, false, 'no successful event when rawDir is un-creatable');
    } finally {
      try { fs.chmodSync(locked, 0o700); fs.rmSync(locked, { recursive: true, force: true }); } catch { /* noop */ }
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// Hook entry-point integration — spawned child processes (AC-1, AC-6)
// ───────────────────────────────────────────────────────────────────────────────

describe('adversarial :: hook entry-point integration (AC-1, AC-6)', { skip: process.platform === 'win32' }, () => {
  let ws;
  beforeEach(() => { ws = makeWorkspace('hook'); });
  after(() => { if (ws) cleanup(ws); });

  function runHook({ stdin, env = {}, cwd }) {
    return spawnSync('node', [HOOK_PATH], {
      input: stdin ?? '',
      encoding: 'utf8',
      timeout: 8000,
      env: { ...process.env, NODE_V8_COVERAGE: '', ...env },
      cwd: cwd || ws.root,
    });
  }

  it('exits 0 immediately with empty stdin (no-op path)', () => {
    const result = runHook({ stdin: '' });
    assert.equal(result.status, 0, `hook must exit 0 on empty stdin; stderr=${result.stderr}`);
    assert.equal(result.signal, null);
  });

  it('exits 0 silently on malformed JSON stdin (no traceback leak to stdout/stderr)', () => {
    const result = runHook({ stdin: '{not-valid-json,' });
    assert.equal(result.status, 0, `malformed JSON must still exit 0; stderr=${result.stderr}`);
    // stdout must be empty — the hook is a PostToolUse side-effect, not a writer.
    assert.equal(result.stdout, '', 'hook must not print to stdout on bad input');
    // stderr may be empty (preferred) — MUST NOT contain an uncaught exception trace.
    assert.equal(
      result.stderr.includes('Uncaught'),
      false,
      `stderr must not contain "Uncaught": ${result.stderr}`,
    );
    assert.equal(
      /at\s+\S+\s+\(.*\.js:\d+/.test(result.stderr),
      false,
      `stderr must not contain a stacktrace: ${result.stderr}`,
    );
  });

  it('exits 0 without any side-effects when tool_name is outside Edit/Write/MultiEdit/NotebookEdit', () => {
    const payload = JSON.stringify({
      tool_name: 'Read',
      tool_input: { file_path: path.join(ws.root, 'whatever.js') },
      cwd: ws.root,
    });
    const result = runHook({ stdin: payload });
    assert.equal(result.status, 0);
    // No JSONL log, no errors.log, no snapshot dir should exist.
    assert.equal(fs.existsSync(ws.rawDir), false, 'rawDir must not be created for non-observed tools');
  });

  it('exits 0 when tool_input is missing file_path AND notebook_path', () => {
    const payload = JSON.stringify({
      tool_name: 'Edit',
      tool_input: {},
      cwd: ws.root,
    });
    const result = runHook({ stdin: payload });
    assert.equal(result.status, 0);
    assert.equal(fs.existsSync(ws.rawDir), false, 'no side-effects for missing file_path');
  });

  it('honours CAP_SKIP_TAG_OBSERVER=1 and exits 0 with zero side-effects', () => {
    const payload = JSON.stringify({
      tool_name: 'Edit',
      tool_input: { file_path: path.join(ws.root, 'skipped.js') },
      cwd: ws.root,
    });
    fs.writeFileSync(path.join(ws.root, 'skipped.js'), '// @cap-feature(feature:F-999)\n');
    const result = runHook({ stdin: payload, env: { CAP_SKIP_TAG_OBSERVER: '1' } });
    assert.equal(result.status, 0);
    assert.equal(fs.existsSync(ws.rawDir), false, 'skip flag must short-circuit before any observe() call');
  });

  it('produces a JSONL event end-to-end when given a valid Edit payload', () => {
    const target = path.join(ws.root, 'valid.js');
    fs.writeFileSync(target, '// @cap-feature(feature:F-054)\n// @cap-todo(ac:F-054/AC-1) first\n');
    const payload = JSON.stringify({
      tool_name: 'Edit',
      tool_input: { file_path: target },
      cwd: ws.root,
    });
    const result = runHook({ stdin: payload });
    assert.equal(result.status, 0, `hook must exit 0; stderr=${result.stderr}`);

    const day = observer._dayStamp(new Date());
    const logFile = path.join(ws.rawDir, `tag-events-${day}.jsonl`);
    assert.ok(fs.existsSync(logFile), `JSONL log must be written to ${logFile}`);
    const ev = JSON.parse(fs.readFileSync(logFile, 'utf8').trim().split('\n')[0]);
    assert.equal(ev.tool, 'Edit');
    assert.equal(ev.file, path.resolve(target));
    assert.ok(ev.added.length >= 2);
  });

  it('observes each of the four supported tools (Edit/Write/MultiEdit/NotebookEdit) end-to-end', () => {
    // Each tool triggers an independent observe() that writes one event against a fresh file.
    const tools = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
    for (const tool of tools) {
      const target = path.join(ws.root, `${tool}.js`);
      fs.writeFileSync(target, `// @cap-feature(feature:F-${tool})\n`);
      const payload = JSON.stringify({
        tool_name: tool,
        tool_input: tool === 'NotebookEdit' ? { notebook_path: target } : { file_path: target },
        cwd: ws.root,
      });
      const result = runHook({ stdin: payload });
      assert.equal(result.status, 0, `${tool} must produce exit 0; stderr=${result.stderr}`);
    }

    const day = observer._dayStamp(new Date());
    const logFile = path.join(ws.rawDir, `tag-events-${day}.jsonl`);
    assert.ok(fs.existsSync(logFile), 'JSONL log must exist after all four tools');
    const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean);
    const observedTools = new Set(lines.map((l) => JSON.parse(l).tool));
    for (const tool of tools) {
      assert.ok(observedTools.has(tool), `tool ${tool} missing from JSONL; observed=${[...observedTools].join(',')}`);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// Performance scaling beyond the AC-5 threshold
// ───────────────────────────────────────────────────────────────────────────────

describe('adversarial :: performance scaling beyond AC-5', () => {
  let ws;
  beforeEach(() => { ws = makeWorkspace('perf'); });
  after(() => { if (ws) cleanup(ws); });

  it('processes a 100k-line file in under 1 second (soft ceiling — flags @cap-risk otherwise)', () => {
    const file = path.join(ws.root, 'huge.js');
    const lines = new Array(100000);
    for (let i = 0; i < 100000; i++) {
      lines[i] = (i % 1000 === 0)
        ? `// @cap-todo(ac:F-054/AC-${i}) scaling marker`
        : `const x${i} = ${i};`;
    }
    fs.writeFileSync(file, lines.join('\n'));

    const t0 = process.hrtime.bigint();
    observer.observe({ filePath: file, tool: 'Write', rawDir: ws.rawDir });
    const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;

    // AC-5 only mandates <100 ms for 10k lines. For 100k we accept <1000 ms as a
    // soft ceiling; exceeding it should surface as @cap-risk, not a hard fail.
    assert.ok(
      elapsedMs < 1000,
      `100k-line file took ${elapsedMs.toFixed(2)} ms — @cap-risk: tag observer does not scale linearly`,
    );
  });
});
