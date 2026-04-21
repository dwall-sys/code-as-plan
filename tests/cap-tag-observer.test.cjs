'use strict';

// @cap-feature(feature:F-054) Hook-Based Tag Event Observation — unit tests for the
// pure-logic observer module and the PostToolUse JSONL contract.

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const observer = require('../cap/bin/lib/cap-tag-observer.cjs');

/**
 * Make a fresh tmp workspace per test so snapshots / event logs never bleed
 * across it-blocks (this matters for the "no-diff → no write" assertions).
 */
function makeWorkspace(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `cap-tag-observer-${label}-`));
  const rawDir = path.join(root, '.cap', 'memory', 'raw');
  return { root, rawDir };
}

describe('cap-tag-observer :: extractTags', () => {
  // @cap-todo(ac:F-054/AC-2) extractTags findet nur @cap-feature und @cap-todo.
  it('finds @cap-feature and @cap-todo tags only — ignores risk/decision', () => {
    const src = [
      '// @cap-feature(feature:F-054) entry',
      '// @cap-todo(ac:F-054/AC-1) fire on Edit/Write/MultiEdit/NotebookEdit',
      '// @cap-risk something spooky',
      '// @cap-decision intentional design',
      'const x = "@cap-feature(feature:F-999)"; // tag inside a string literal — no leading comment token',
    ].join('\n');

    const tags = observer.extractTags(src);
    assert.deepEqual(
      tags,
      [
        '@cap-feature(feature:F-054)',
        '@cap-todo(ac:F-054/AC-1)',
      ].sort(),
    );
  });

  it('distinguishes different ACs as distinct tag identities', () => {
    const src = [
      '# @cap-todo(ac:F-054/AC-1) first',
      '# @cap-todo(ac:F-054/AC-2) second',
      '# @cap-todo(ac:F-054/AC-1) duplicate of first',
    ].join('\n');
    const tags = observer.extractTags(src);
    assert.deepEqual(tags, ['@cap-todo(ac:F-054/AC-1)', '@cap-todo(ac:F-054/AC-2)']);
  });

  it('deduplicates identical tags within a single file', () => {
    const src = '// @cap-feature(feature:F-1)\n// @cap-feature(feature:F-1)\n';
    assert.deepEqual(observer.extractTags(src), ['@cap-feature(feature:F-1)']);
  });

  it('returns empty array for empty / non-string input', () => {
    assert.deepEqual(observer.extractTags(''), []);
    assert.deepEqual(observer.extractTags(null), []);
    assert.deepEqual(observer.extractTags(undefined), []);
  });
});

describe('cap-tag-observer :: diffTags', () => {
  it('computes added/removed sets with deduplication', () => {
    const before = ['@cap-feature(feature:F-1)', '@cap-todo(ac:F-1/AC-1)'];
    const after = ['@cap-feature(feature:F-1)', '@cap-todo(ac:F-1/AC-2)'];
    const diff = observer.diffTags(before, after);
    assert.deepEqual(diff.added, ['@cap-todo(ac:F-1/AC-2)']);
    assert.deepEqual(diff.removed, ['@cap-todo(ac:F-1/AC-1)']);
  });

  it('treats undefined / non-array inputs as empty sets', () => {
    const diff = observer.diffTags(undefined, ['@cap-feature(feature:F-2)']);
    assert.deepEqual(diff.added, ['@cap-feature(feature:F-2)']);
    assert.deepEqual(diff.removed, []);
  });
});

describe('cap-tag-observer :: observe', () => {
  let ws;

  beforeEach(() => {
    ws = makeWorkspace('obs');
  });

  after(() => {
    // best-effort global cleanup — individual workspaces live under os.tmpdir()
  });

  // @cap-todo(ac:F-054/AC-2) Erster Observe-Call einer annotated Datei emittet
  //   ein Event mit allen @cap-Tags als `added`.
  it('emits a full-added event on first observation', () => {
    const file = path.join(ws.root, 'a.js');
    fs.writeFileSync(file, '// @cap-feature(feature:F-054)\n// @cap-todo(ac:F-054/AC-1) first\n');
    const res = observer.observe({ filePath: file, tool: 'Write', rawDir: ws.rawDir });
    assert.equal(res.eventWritten, true);
    assert.deepEqual(res.added.sort(), ['@cap-feature(feature:F-054)', '@cap-todo(ac:F-054/AC-1)'].sort());
    assert.deepEqual(res.removed, []);

    const day = observer._dayStamp(new Date());
    const logFile = path.join(ws.rawDir, `tag-events-${day}.jsonl`);
    assert.ok(fs.existsSync(logFile), 'daily JSONL log must exist');
    const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);
    const event = JSON.parse(lines[0]);
    assert.equal(event.tool, 'Write');
    assert.equal(event.file, path.resolve(file));
    assert.ok(Array.isArray(event.added) && event.added.length === 2);
    assert.deepEqual(event.removed, []);
    assert.match(event.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  // @cap-todo(ac:F-054/AC-4) Kein Diff → kein Write (keine Leerzeilen, kein Noise).
  it('produces NO event when tags are unchanged between observations', () => {
    const file = path.join(ws.root, 'b.js');
    fs.writeFileSync(file, '// @cap-feature(feature:F-054)\n');
    observer.observe({ filePath: file, tool: 'Write', rawDir: ws.rawDir });

    // Mutate file but leave tags unchanged (add a comment, keep the same tag line)
    fs.writeFileSync(file, '// @cap-feature(feature:F-054)\n// unrelated comment\n');
    const res = observer.observe({ filePath: file, tool: 'Edit', rawDir: ws.rawDir });
    assert.equal(res.eventWritten, false);
    assert.deepEqual(res.added, []);
    assert.deepEqual(res.removed, []);

    // Exactly ONE JSONL line (from the first call), no trailing blanks.
    const day = observer._dayStamp(new Date());
    const logFile = path.join(ws.rawDir, `tag-events-${day}.jsonl`);
    const content = fs.readFileSync(logFile, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    assert.equal(lines.length, 1, 'no-diff call must not append a second line');
    // And crucially, no empty trailing line either beyond the single trailing \n.
    assert.equal(content.endsWith('\n\n'), false, 'no empty-line noise');
  });

  it('emits a removed-event when a tag disappears', () => {
    const file = path.join(ws.root, 'c.js');
    fs.writeFileSync(file, '// @cap-feature(feature:F-054)\n// @cap-todo(ac:F-054/AC-1)\n');
    observer.observe({ filePath: file, tool: 'Write', rawDir: ws.rawDir });

    // Drop the todo tag.
    fs.writeFileSync(file, '// @cap-feature(feature:F-054)\n');
    const res = observer.observe({ filePath: file, tool: 'Edit', rawDir: ws.rawDir });
    assert.equal(res.eventWritten, true);
    assert.deepEqual(res.added, []);
    assert.deepEqual(res.removed, ['@cap-todo(ac:F-054/AC-1)']);
  });

  // @cap-todo(ac:F-054/AC-7) Tages-Rotation: zwei Events an zwei Tagen landen in
  //   zwei unterschiedlichen Dateien.
  it('rotates the log file per calendar day (UTC)', () => {
    const file = path.join(ws.root, 'd.js');
    fs.writeFileSync(file, '// @cap-feature(feature:F-054)\n');
    const day1 = new Date('2026-01-15T10:00:00Z');
    observer.observe({ filePath: file, tool: 'Write', rawDir: ws.rawDir, now: day1 });

    // Change tags + advance clock by one calendar day.
    fs.writeFileSync(file, '// @cap-feature(feature:F-054)\n// @cap-todo(ac:F-054/AC-1)\n');
    const day2 = new Date('2026-01-16T10:00:00Z');
    observer.observe({ filePath: file, tool: 'Edit', rawDir: ws.rawDir, now: day2 });

    const f1 = path.join(ws.rawDir, 'tag-events-2026-01-15.jsonl');
    const f2 = path.join(ws.rawDir, 'tag-events-2026-01-16.jsonl');
    assert.ok(fs.existsSync(f1), 'day-1 log file must exist');
    assert.ok(fs.existsSync(f2), 'day-2 log file must exist');
    assert.equal(fs.readFileSync(f1, 'utf8').trim().split('\n').length, 1);
    assert.equal(fs.readFileSync(f2, 'utf8').trim().split('\n').length, 1);
  });

  // @cap-todo(ac:F-054/AC-3) Jede JSONL-Zeile parst als Objekt mit
  //   {timestamp, tool, file, added, removed}.
  it('every JSONL line parses into the documented event shape', () => {
    const file = path.join(ws.root, 'e.js');
    fs.writeFileSync(file, '// @cap-feature(feature:F-054)\n');
    observer.observe({ filePath: file, tool: 'Write', rawDir: ws.rawDir });
    fs.writeFileSync(file, '// @cap-todo(ac:F-054/AC-1) now\n');
    observer.observe({ filePath: file, tool: 'MultiEdit', rawDir: ws.rawDir });

    const day = observer._dayStamp(new Date());
    const logFile = path.join(ws.rawDir, `tag-events-${day}.jsonl`);
    const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n');
    assert.equal(lines.length, 2);
    for (const line of lines) {
      const ev = JSON.parse(line);
      assert.equal(typeof ev.timestamp, 'string');
      assert.ok(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(ev.tool));
      assert.equal(typeof ev.file, 'string');
      assert.ok(Array.isArray(ev.added));
      assert.ok(Array.isArray(ev.removed));
    }
  });

  // @cap-todo(ac:F-054/AC-5) <100 ms für 10 000-Zeilen-Files (2 Calls summiert).
  it('processes a 10k-line file in <100 ms across two observe() calls', () => {
    const file = path.join(ws.root, 'big.js');
    const lines = new Array(10000);
    for (let i = 0; i < 10000; i++) {
      if (i % 200 === 0 && i < 10000) {
        // 50 scattered @cap tags (i=0, 200, 400, ..., 9800).
        lines[i] = `// @cap-todo(ac:F-054/AC-${i}) bulk`;
      } else {
        lines[i] = `const v${i} = ${i};`;
      }
    }
    fs.writeFileSync(file, lines.join('\n'));

    const t0 = process.hrtime.bigint();
    observer.observe({ filePath: file, tool: 'Write', rawDir: ws.rawDir });
    observer.observe({ filePath: file, tool: 'Edit', rawDir: ws.rawDir }); // no-diff branch
    const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;

    assert.ok(
      elapsedMs < 100,
      `expected <100 ms for 10k-line file, got ${elapsedMs.toFixed(2)} ms`,
    );
  });

  // @cap-todo(ac:F-054/AC-6) Fehler werden geloggt, Crash wird geschluckt.
  it('logs errors and returns a noop result when the file is unreadable', () => {
    const file = path.join(ws.root, 'does-not-exist.js');
    const res = observer.observe({ filePath: file, tool: 'Edit', rawDir: ws.rawDir });
    assert.equal(res.eventWritten, false);
    assert.deepEqual(res.added, []);
    assert.deepEqual(res.removed, []);

    const errorLog = path.join(ws.rawDir, 'errors.log');
    assert.ok(fs.existsSync(errorLog), 'errors.log must be created on failure');
    const lines = fs.readFileSync(errorLog, 'utf8').trim().split('\n').filter(Boolean);
    assert.ok(lines.length >= 1);
    const record = JSON.parse(lines[0]);
    assert.equal(typeof record.timestamp, 'string');
    assert.ok(typeof record.message === 'string' && record.message.length > 0);

    // And no JSONL event was written.
    const day = observer._dayStamp(new Date());
    const logFile = path.join(ws.rawDir, `tag-events-${day}.jsonl`);
    assert.equal(fs.existsSync(logFile), false, 'no event log must be produced on read-error');
  });
});

describe('cap-tag-observer :: hook entry-point sanity', () => {
  // We do not invoke the hook as a child process here (the integration surface
  // is covered by hook-validation.test.cjs patterns) but we do verify the file
  // is parseable and wires up the documented guards.
  const HOOK_PATH = path.join(__dirname, '..', 'hooks', 'cap-tag-observer.js');

  it('exists and is syntactically valid JS', () => {
    const vm = require('node:vm');
    const content = fs.readFileSync(HOOK_PATH, 'utf8');
    assert.doesNotThrow(() => new vm.Script(content, { filename: 'cap-tag-observer.js' }));
  });

  it('declares the observed tool filter and skip envvar', () => {
    const content = fs.readFileSync(HOOK_PATH, 'utf8');
    assert.ok(content.includes('CAP_SKIP_TAG_OBSERVER'), 'must honour CAP_SKIP_TAG_OBSERVER');
    assert.ok(content.includes("'Edit'") && content.includes("'Write'"), 'must filter Edit/Write');
    assert.ok(content.includes("'MultiEdit'"), 'must filter MultiEdit');
    assert.ok(content.includes("'NotebookEdit'"), 'must filter NotebookEdit');
    assert.ok(content.includes('cap-hook-version:'), 'must carry cap-hook-version marker');
  });
});
