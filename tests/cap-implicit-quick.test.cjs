'use strict';

// @cap-feature(feature:F-098) Implicit Quick-Mode tests cover all 7 ACs.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  detectQuickSession,
  classifyFiles,
  annotateFile,
  formatNotice,
  processSession,
  isDisabled,
  readWrittenFilesForSession,
  FORMAL_COMMANDS,
  MIN_EDITS_FOR_QUICK,
} = require('../cap/bin/lib/cap-implicit-quick.cjs');

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-f098-'));
  fs.mkdirSync(path.join(root, '.cap', 'learning', 'state'), { recursive: true });
  return root;
}

function rmrf(dir) { if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true }); }

function writeSession(projectRoot, payload) {
  fs.writeFileSync(path.join(projectRoot, '.cap', 'SESSION.json'), JSON.stringify(payload, null, 2));
}

function appendLedger(projectRoot, sessionId, files) {
  const fp = path.join(projectRoot, '.cap', 'learning', 'state', 'written-files.jsonl');
  const lines = files.map(f => JSON.stringify({ sessionId, targetFile: f, ts: new Date().toISOString() }));
  fs.appendFileSync(fp, lines.join('\n') + '\n');
}

function writeSrc(projectRoot, relPath, content) {
  const abs = path.join(projectRoot, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

// ─── detectQuickSession ───

describe('detectQuickSession — AC-1 heuristic gates', () => {
  it('returns isQuick=true when all gates pass: no formal cmd, ≥5 edits, activeFeature set', () => {
    const root = makeProject();
    try {
      writeSession(root, { sessionId: 'sess-A', activeFeature: 'F-098', lastCommand: '/cap:save' });
      const files = ['/tmp/a.js', '/tmp/b.js', '/tmp/c.js', '/tmp/d.js', '/tmp/e.js'];
      appendLedger(root, 'sess-A', files);
      const det = detectQuickSession({ projectRoot: root });
      assert.strictEqual(det.isQuick, true);
      assert.strictEqual(det.activeFeature, 'F-098');
      assert.strictEqual(det.editCount, 5);
    } finally { rmrf(root); }
  });

  it('skips when last command was formal (/cap:prototype etc.)', () => {
    const root = makeProject();
    try {
      writeSession(root, { sessionId: 's', activeFeature: 'F-098', lastCommand: '/cap:prototype' });
      const files = Array.from({ length: 10 }, (_, i) => `/tmp/f${i}.js`);
      appendLedger(root, 's', files);
      const det = detectQuickSession({ projectRoot: root });
      assert.strictEqual(det.isQuick, false);
      assert.strictEqual(det.reason, 'formal-command');
    } finally { rmrf(root); }
  });

  it('skips when fewer than threshold edits', () => {
    const root = makeProject();
    try {
      writeSession(root, { sessionId: 's', activeFeature: 'F-098', lastCommand: '/cap:save' });
      appendLedger(root, 's', ['/tmp/a.js', '/tmp/b.js']); // 2 < 5
      const det = detectQuickSession({ projectRoot: root });
      assert.strictEqual(det.isQuick, false);
      assert.strictEqual(det.reason, 'too-few-edits');
      assert.strictEqual(det.threshold, MIN_EDITS_FOR_QUICK);
    } finally { rmrf(root); }
  });

  it('skips when activeFeature is missing', () => {
    const root = makeProject();
    try {
      writeSession(root, { sessionId: 's', activeFeature: null, lastCommand: '/cap:save' });
      const det = detectQuickSession({ projectRoot: root });
      assert.strictEqual(det.isQuick, false);
      assert.strictEqual(det.reason, 'no-active-feature');
    } finally { rmrf(root); }
  });

  it('skips when activeFeature has invalid shape', () => {
    const root = makeProject();
    try {
      writeSession(root, { sessionId: 's', activeFeature: 'not-a-feature-id', lastCommand: '/cap:save' });
      const files = Array.from({ length: 6 }, (_, i) => `/tmp/f${i}.js`);
      appendLedger(root, 's', files);
      const det = detectQuickSession({ projectRoot: root });
      assert.strictEqual(det.isQuick, false);
      assert.strictEqual(det.reason, 'invalid-active-feature');
    } finally { rmrf(root); }
  });

  it('accepts long-form monorepo IDs (F-Hub-Slug)', () => {
    const root = makeProject();
    try {
      writeSession(root, { sessionId: 's', activeFeature: 'F-Hub-Spotlight-Carousel', lastCommand: null });
      const files = Array.from({ length: 6 }, (_, i) => `/tmp/f${i}.js`);
      appendLedger(root, 's', files);
      const det = detectQuickSession({ projectRoot: root });
      assert.strictEqual(det.isQuick, true);
      assert.strictEqual(det.activeFeature, 'F-Hub-Spotlight-Carousel');
    } finally { rmrf(root); }
  });

  it('handles missing SESSION.json without throwing', () => {
    const root = makeProject();
    try {
      const det = detectQuickSession({ projectRoot: root });
      assert.strictEqual(det.isQuick, false);
      assert.strictEqual(det.reason, 'no-session-json');
    } finally { rmrf(root); }
  });

  it('handles missing ledger file (fresh project, no edits yet)', () => {
    const root = makeProject();
    try {
      writeSession(root, { sessionId: 's', activeFeature: 'F-098', lastCommand: '/cap:save' });
      const det = detectQuickSession({ projectRoot: root });
      assert.strictEqual(det.isQuick, false);
      assert.strictEqual(det.reason, 'too-few-edits');
      assert.strictEqual(det.editCount, 0);
    } finally { rmrf(root); }
  });
});

// ─── readWrittenFilesForSession dedup ───

describe('readWrittenFilesForSession', () => {
  it('deduplicates ledger entries and filters by sessionId', () => {
    const root = makeProject();
    try {
      appendLedger(root, 'A', ['/tmp/a.js', '/tmp/b.js', '/tmp/a.js']);
      appendLedger(root, 'B', ['/tmp/c.js']);
      const filesA = readWrittenFilesForSession(root, 'A');
      const filesB = readWrittenFilesForSession(root, 'B');
      assert.deepStrictEqual(filesA.sort(), ['/tmp/a.js', '/tmp/b.js']);
      assert.deepStrictEqual(filesB, ['/tmp/c.js']);
    } finally { rmrf(root); }
  });

  it('survives malformed JSONL lines', () => {
    const root = makeProject();
    try {
      const fp = path.join(root, '.cap', 'learning', 'state', 'written-files.jsonl');
      fs.writeFileSync(fp, [
        JSON.stringify({ sessionId: 'A', targetFile: '/tmp/a.js' }),
        '{ broken json',
        JSON.stringify({ sessionId: 'A', targetFile: '/tmp/b.js' }),
      ].join('\n') + '\n');
      const files = readWrittenFilesForSession(root, 'A');
      assert.deepStrictEqual(files.sort(), ['/tmp/a.js', '/tmp/b.js']);
    } finally { rmrf(root); }
  });
});

// ─── annotateFile ───

describe('annotateFile — AC-2 atomic write & comment-style', () => {
  it('inserts // @cap-feature on a JS file as the first non-shebang line', () => {
    const root = makeProject();
    try {
      const f = writeSrc(root, 'src/foo.js', 'function hello() { return 42; }\n');
      const r = annotateFile(f, 'F-098');
      assert.strictEqual(r.changed, true);
      const content = fs.readFileSync(f, 'utf8');
      assert.match(content, /^\/\/ @cap-feature\(feature:F-098\)/);
      assert.match(content, /function hello\(\)/);
    } finally { rmrf(root); }
  });

  it('preserves shebang as line 1 when present', () => {
    const root = makeProject();
    try {
      const f = writeSrc(root, 'cli.js', '#!/usr/bin/env node\nconsole.log("hi");\n');
      annotateFile(f, 'F-098');
      const lines = fs.readFileSync(f, 'utf8').split('\n');
      assert.strictEqual(lines[0], '#!/usr/bin/env node');
      assert.match(lines[1], /^\/\/ @cap-feature/);
    } finally { rmrf(root); }
  });

  it('preserves leading "use strict" before inserting the tag', () => {
    const root = makeProject();
    try {
      const f = writeSrc(root, 'mod.cjs', "'use strict';\nconst x = 1;\n");
      annotateFile(f, 'F-098');
      const lines = fs.readFileSync(f, 'utf8').split('\n');
      assert.match(lines[0], /'use strict'/);
      assert.match(lines[1], /^\/\/ @cap-feature/);
    } finally { rmrf(root); }
  });

  it('uses # comment style for python files', () => {
    const root = makeProject();
    try {
      const f = writeSrc(root, 'script.py', 'def foo(): return 42\n');
      annotateFile(f, 'F-098');
      const content = fs.readFileSync(f, 'utf8');
      assert.match(content, /^# @cap-feature\(feature:F-098\)/);
    } finally { rmrf(root); }
  });

  it('refuses to overwrite an existing @cap-feature tag', () => {
    const root = makeProject();
    try {
      const f = writeSrc(root, 'a.js', '// @cap-feature(feature:F-001)\nconst x = 1;\n');
      const r = annotateFile(f, 'F-098');
      assert.strictEqual(r.changed, false);
      assert.strictEqual(r.reason, 'already-tagged');
      // file content untouched
      assert.match(fs.readFileSync(f, 'utf8'), /F-001/);
    } finally { rmrf(root); }
  });

  it('throws on invalid feature id (no silent fallback)', () => {
    const root = makeProject();
    try {
      const f = writeSrc(root, 'a.js', 'const x = 1;\n');
      assert.throws(() => annotateFile(f, 'not-an-id'), /Invalid feature id/);
    } finally { rmrf(root); }
  });
});

// ─── isDisabled — AC-5 ───

describe('isDisabled — AC-5 disable channels', () => {
  it('honors CAP_SKIP_IMPLICIT_QUICK=1 env var', () => {
    const prev = process.env.CAP_SKIP_IMPLICIT_QUICK;
    process.env.CAP_SKIP_IMPLICIT_QUICK = '1';
    try {
      assert.deepStrictEqual(isDisabled('/nonexistent'), { disabled: true, reason: 'env-var' });
    } finally {
      if (prev === undefined) delete process.env.CAP_SKIP_IMPLICIT_QUICK;
      else process.env.CAP_SKIP_IMPLICIT_QUICK = prev;
    }
  });

  it('honors .cap/config.json: { implicitQuick: { enabled: false } }', () => {
    const root = makeProject();
    try {
      fs.writeFileSync(path.join(root, '.cap', 'config.json'), JSON.stringify({ implicitQuick: { enabled: false } }));
      assert.deepStrictEqual(isDisabled(root), { disabled: true, reason: 'config' });
    } finally { rmrf(root); }
  });

  it('default-enabled when neither flag is set', () => {
    const root = makeProject();
    try {
      assert.deepStrictEqual(isDisabled(root), { disabled: false });
    } finally { rmrf(root); }
  });
});

// ─── processSession — orchestrator integration (AC-1+2+3+5+6) ───

describe('processSession — orchestrator end-to-end', () => {
  it('AC-2 happy path: 5 raw-chat edits → 5 files annotated, notice issued', () => {
    const root = makeProject();
    try {
      writeSession(root, { sessionId: 'S', activeFeature: 'F-098', lastCommand: '/cap:save' });
      const files = [];
      for (let i = 0; i < 5; i++) {
        files.push(writeSrc(root, `src/m${i}.js`, `// untagged source ${i}\nfunction x() {}\n`));
      }
      appendLedger(root, 'S', files);
      const r = processSession({ projectRoot: root });
      assert.strictEqual(r.skipped, false);
      assert.strictEqual(r.annotated.length, 5);
      assert.match(r.notice, /F-098: 5 files annotated, 5 edits captured/);
      // verify each file actually got the tag on disk
      for (const f of files) {
        assert.match(fs.readFileSync(f, 'utf8'), /@cap-feature\(feature:F-098\)/);
      }
    } finally { rmrf(root); }
  });

  it('AC-1 explicit /cap:prototype session: catch-up is skipped entirely', () => {
    const root = makeProject();
    try {
      writeSession(root, { sessionId: 'S', activeFeature: 'F-098', lastCommand: '/cap:prototype' });
      const files = [];
      for (let i = 0; i < 8; i++) files.push(writeSrc(root, `src/m${i}.js`, 'untagged\n'));
      appendLedger(root, 'S', files);
      const r = processSession({ projectRoot: root });
      assert.strictEqual(r.skipped, true);
      assert.strictEqual(r.reason, 'formal-command');
      // verify no tag was written
      for (const f of files) {
        assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /@cap-feature/);
      }
    } finally { rmrf(root); }
  });

  it('AC-6 ambiguous: a touched file pinned to a different feature → no annotation, ambiguous notice', () => {
    const root = makeProject();
    try {
      writeSession(root, { sessionId: 'S', activeFeature: 'F-098', lastCommand: null });
      const files = [];
      // four untagged files
      for (let i = 0; i < 4; i++) files.push(writeSrc(root, `src/m${i}.js`, 'untagged\n'));
      // one file already tagged for F-001 — that's ambiguity
      files.push(writeSrc(root, 'src/legacy.js', '// @cap-feature(feature:F-001)\nold code\n'));
      appendLedger(root, 'S', files);
      const r = processSession({ projectRoot: root });
      assert.strictEqual(r.skipped, false);
      assert.strictEqual(r.ambiguous, true);
      assert.strictEqual(r.annotated.length, 0);
      assert.match(r.notice, /ambiguous files touched/);
      // none of the untagged files were annotated (conservative: zero on ambiguity)
      for (const f of files.slice(0, 4)) {
        assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /@cap-feature/);
      }
    } finally { rmrf(root); }
  });

  it('AC-5 CAP_SKIP_IMPLICIT_QUICK=1: catch-up is skipped without inspecting the session', () => {
    const root = makeProject();
    const prev = process.env.CAP_SKIP_IMPLICIT_QUICK;
    process.env.CAP_SKIP_IMPLICIT_QUICK = '1';
    try {
      writeSession(root, { sessionId: 'S', activeFeature: 'F-098', lastCommand: null });
      const files = [];
      for (let i = 0; i < 6; i++) files.push(writeSrc(root, `src/m${i}.js`, 'untagged\n'));
      appendLedger(root, 'S', files);
      const r = processSession({ projectRoot: root });
      assert.strictEqual(r.skipped, true);
      assert.strictEqual(r.reason, 'disabled-env-var');
      for (const f of files) {
        assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /@cap-feature/);
      }
    } finally {
      if (prev === undefined) delete process.env.CAP_SKIP_IMPLICIT_QUICK;
      else process.env.CAP_SKIP_IMPLICIT_QUICK = prev;
      rmrf(root);
    }
  });

  it('AC-2 preserves existing @cap-feature tags on already-annotated files', () => {
    const root = makeProject();
    try {
      writeSession(root, { sessionId: 'S', activeFeature: 'F-098', lastCommand: null });
      const files = [];
      for (let i = 0; i < 4; i++) files.push(writeSrc(root, `src/m${i}.js`, 'untagged\n'));
      // one file with the SAME activeFeature already tagged — must be preserved (not double-tagged)
      const sameFeatTag = writeSrc(root, 'src/already.js', '// @cap-feature(feature:F-098)\nbody\n');
      files.push(sameFeatTag);
      appendLedger(root, 'S', files);
      const r = processSession({ projectRoot: root });
      assert.strictEqual(r.ambiguous, false, 'same-feature pre-tag should NOT trigger ambiguity');
      assert.strictEqual(r.annotated.length, 4);
      assert.deepStrictEqual(r.preserved, [sameFeatTag]);
      const content = fs.readFileSync(sameFeatTag, 'utf8');
      const tagCount = (content.match(/@cap-feature/g) || []).length;
      assert.strictEqual(tagCount, 1, 'must not double-annotate a file with matching tag');
    } finally { rmrf(root); }
  });

  it('AC-3 notice format mentions feature id, file count, edit count, and /cap:test hint', () => {
    const root = makeProject();
    try {
      writeSession(root, { sessionId: 'S', activeFeature: 'F-098', lastCommand: null });
      const files = [];
      for (let i = 0; i < 7; i++) files.push(writeSrc(root, `src/m${i}.js`, 'untagged\n'));
      appendLedger(root, 'S', files);
      const r = processSession({ projectRoot: root });
      assert.match(r.notice, /F-098/);
      assert.match(r.notice, /7 files annotated/);
      assert.match(r.notice, /7 edits captured/);
      assert.match(r.notice, /\/cap:test/);
    } finally { rmrf(root); }
  });

  it('handles per-file annotation errors without aborting the batch', () => {
    const root = makeProject();
    try {
      writeSession(root, { sessionId: 'S', activeFeature: 'F-098', lastCommand: null });
      const good = [];
      for (let i = 0; i < 4; i++) good.push(writeSrc(root, `src/m${i}.js`, 'untagged\n'));
      // ledger references a missing file → classifyFiles routes it to skipped, not annotate
      const ghost = '/tmp/cap-f098-nonexistent-' + process.hrtime.bigint() + '.js';
      const files = [...good, ghost];
      appendLedger(root, 'S', files);
      const r = processSession({ projectRoot: root });
      assert.strictEqual(r.skipped, false);
      assert.strictEqual(r.annotated.length, 4);
      assert.strictEqual(r.errors.length, 0); // missing file is skipped, not errored
    } finally { rmrf(root); }
  });
});

// ─── formatNotice ───

describe('formatNotice', () => {
  it('emits happy-path text', () => {
    const out = formatNotice({ featureId: 'F-098', fileCount: 3, editCount: 7 });
    assert.match(out, /F-098: 3 files annotated, 7 edits captured/);
  });

  it('emits ambiguous-path text', () => {
    const out = formatNotice({ fileCount: 5, editCount: 12, ambiguous: true });
    assert.match(out, /5 ambiguous files touched/);
  });
});

// ─── classifyFiles ───

describe('classifyFiles', () => {
  it('routes by extension and existing @cap-feature tag', () => {
    const root = makeProject();
    try {
      const tagged = writeSrc(root, 'a.js', '// @cap-feature(feature:F-098)\nx\n');
      const untagged = writeSrc(root, 'b.js', 'no tag here\n');
      const md = writeSrc(root, 'README.md', 'docs\n');
      const ghost = path.join(root, 'gone.js');
      const r = classifyFiles([tagged, untagged, md, ghost], 'F-098');
      assert.deepStrictEqual(r.hasTag, [tagged]);
      assert.deepStrictEqual(r.needsAnnotate, [untagged]);
      assert.strictEqual(r.skipped.length, 2);
    } finally { rmrf(root); }
  });
});

// ─── FORMAL_COMMANDS surface ───

describe('FORMAL_COMMANDS', () => {
  it('contains the canonical formal slash commands', () => {
    for (const cmd of ['/cap:prototype', '/cap:iterate', '/cap:test', '/cap:review']) {
      assert.ok(FORMAL_COMMANDS.has(cmd), `should include ${cmd}`);
    }
  });
});
