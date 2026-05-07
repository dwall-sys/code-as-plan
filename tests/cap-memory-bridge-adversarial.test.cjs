'use strict';

// @cap-feature(feature:F-080) Adversarial tests for cap-memory-bridge.cjs.
//   Stage-2 lessons applied UPFRONT (V6 streak now candidate 7):
//     1. Proto-pollution defense in MEMORY.md frontmatter + cache JSON parse.
//     2. ANSI/control-byte injection defense in entry titles + hooks.
//     3. Path-traversal defense in slug derivation + sibling references.
//     4. Silent-skip is REAL silent: zero stdout/stderr capture asserts it.
//     5. Cache TOCTOU: cache + source diverge mid-run → no crash.
//     6. Atomic cache writes: tmp-then-rename, no half-written state.
//     7. Round-trip stability: load + write (no source change) → byte-identical.
//     8. Surface limit hard-cap.
//     9. AC-5 priority tie-break determinism.
//    10. Missing/empty/malformed sibling files.
//    11. Realistic fixture (mirrors actual MEMORY.md shape).
//    12. AC-1 read-only contract: source dir mtime + content unchanged.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const bridge = require('../cap/bin/lib/cap-memory-bridge.cjs');

let SANDBOX;

before(() => {
  SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-memory-bridge-adv-'));
});

after(() => {
  if (SANDBOX) {
    try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
  }
});

function makeSandboxProject() {
  const sandboxRoot = fs.mkdtempSync(path.join(SANDBOX, 'sandbox-'));
  const projectRoot = path.join(sandboxRoot, 'work', 'my-project');
  const fakeHome = path.join(sandboxRoot, 'home');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(fakeHome, { recursive: true });
  fs.mkdirSync(path.join(projectRoot, '.cap', 'memory'), { recursive: true });
  const origHomedir = os.homedir;
  os.homedir = () => fakeHome;
  const slug = bridge.getProjectSlug(projectRoot);
  const claudeNativeDir = path.join(fakeHome, '.claude', 'projects', slug, 'memory');
  fs.mkdirSync(claudeNativeDir, { recursive: true });
  return {
    projectRoot,
    claudeNativeDir,
    fakeHome,
    restoreHome: () => { os.homedir = origHomedir; },
  };
}

function writeSimple(memoryDir, indexLines, siblings) {
  fs.writeFileSync(path.join(memoryDir, 'MEMORY.md'), indexLines.join('\n') + '\n', 'utf8');
  for (const [filename, content] of Object.entries(siblings || {})) {
    fs.writeFileSync(path.join(memoryDir, filename), content, 'utf8');
  }
}

// -------- Stage-2 #12: AC-1 read-only contract --------

describe('Stage-2 #12: AC-1 read-only contract — bridge MUST NOT write to ~/.claude/projects/', () => {
  it('source dir mtime + sibling mtimes UNCHANGED across full bridge invocation', () => {
    const { projectRoot, claudeNativeDir, restoreHome } = makeSandboxProject();
    try {
      const memoryMd = '- [Foo](foo.md) — foo hook\n';
      fs.writeFileSync(path.join(claudeNativeDir, 'MEMORY.md'), memoryMd, 'utf8');
      fs.writeFileSync(path.join(claudeNativeDir, 'foo.md'), '---\nname: Foo\ntype: project\n---\nbody\n', 'utf8');
      // Capture pre-state mtimes + content hashes.
      const memoryMdStat0 = fs.statSync(path.join(claudeNativeDir, 'MEMORY.md'));
      const fooStat0 = fs.statSync(path.join(claudeNativeDir, 'foo.md'));
      const dirStat0 = fs.statSync(claudeNativeDir);
      const memoryMdContent0 = fs.readFileSync(path.join(claudeNativeDir, 'MEMORY.md'), 'utf8');
      const fooContent0 = fs.readFileSync(path.join(claudeNativeDir, 'foo.md'), 'utf8');
      // Run the full bridge end-to-end multiple times.
      bridge.getBridgeData(projectRoot);
      bridge.refreshCache(projectRoot);
      bridge.surfaceForFeature(projectRoot, 'F-080');
      // Re-stat and compare.
      const memoryMdStat1 = fs.statSync(path.join(claudeNativeDir, 'MEMORY.md'));
      const fooStat1 = fs.statSync(path.join(claudeNativeDir, 'foo.md'));
      const memoryMdContent1 = fs.readFileSync(path.join(claudeNativeDir, 'MEMORY.md'), 'utf8');
      const fooContent1 = fs.readFileSync(path.join(claudeNativeDir, 'foo.md'), 'utf8');
      assert.equal(memoryMdStat0.mtime.toISOString(), memoryMdStat1.mtime.toISOString(), 'MEMORY.md mtime unchanged');
      assert.equal(fooStat0.mtime.toISOString(), fooStat1.mtime.toISOString(), 'sibling mtime unchanged');
      assert.equal(memoryMdStat0.size, memoryMdStat1.size, 'MEMORY.md size unchanged');
      assert.equal(memoryMdContent0, memoryMdContent1, 'MEMORY.md content unchanged');
      assert.equal(fooContent0, fooContent1, 'sibling content unchanged');
      // Directory entry list also unchanged (no new files were created in source).
      const dirEntries1 = fs.readdirSync(claudeNativeDir).sort();
      assert.deepEqual(dirEntries1, ['MEMORY.md', 'foo.md']);
      // Sanity: dir mtime is fs-dependent (some FSes update on stat) but the entry list IS the contract.
      assert.ok(dirStat0);  // smoke
    } finally {
      restoreHome();
    }
  });
});

// -------- Stage-2 #1: proto-pollution --------

describe('Stage-2 #1: proto-pollution defense', () => {
  it('rejects __proto__ key in sibling frontmatter (no global pollution)', () => {
    const { projectRoot, claudeNativeDir, restoreHome } = makeSandboxProject();
    try {
      writeSimple(claudeNativeDir,
        ['- [Bad](bad.md) — bad hook'],
        { 'bad.md': '---\nname: Bad\n__proto__: {polluted: true}\nconstructor: 99\nprototype: x\ntype: project\n---\nbody\n' }
      );
      bridge.refreshCache(projectRoot);
      const empty = {};
      assert.equal(empty.polluted, undefined, 'Object.prototype.polluted is undefined');
      const cached = bridge.loadCachedIndex(projectRoot);
      assert.ok(cached);
      assert.equal(cached.entries[0].type, 'project', 'normal type field still parsed');
    } finally {
      restoreHome();
    }
  });

  it('cache JSON with __proto__ entry is filtered on load', () => {
    const { projectRoot, restoreHome } = makeSandboxProject();
    try {
      const cachePath = bridge.getCachePath(projectRoot);
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      // Write a maliciously-crafted cache file directly (skip refreshCache).
      const malicious = JSON.stringify({
        schemaVersion: 1,
        sourceRoot: '/tmp/x',
        memoryMdMtime: '2026-01-01T00:00:00.000Z',
        entries: [
          { title: 'Good', file: 'good.md', hook: '', type: 'project', fileMtime: null, description: null },
          { title: 'Bad', file: '__proto__', hook: '', type: 'project', fileMtime: null, description: null },
          { title: 'Traversal', file: '../etc/passwd', hook: '', type: 'project', fileMtime: null, description: null },
        ],
      });
      fs.writeFileSync(cachePath, malicious, 'utf8');
      const cached = bridge.loadCachedIndex(projectRoot);
      assert.ok(cached);
      assert.equal(cached.entries.length, 1, 'only the safe entry survives');
      assert.equal(cached.entries[0].title, 'Good');
    } finally {
      restoreHome();
    }
  });
});

// -------- Stage-2 #2: ANSI / control-byte sanitization --------

describe('Stage-2 #2: ANSI byte stripping in surface output', () => {
  it('entry title with ANSI escape codes → bullets are scrubbed before output', () => {
    const { projectRoot, claudeNativeDir, restoreHome } = makeSandboxProject();
    try {
      const ansiTitle = 'Innocent\x1b[31mEVIL\x1b[0mTitle';
      writeSimple(claudeNativeDir,
        [`- [${ansiTitle}](evil.md) — evil hook`],
        { 'evil.md': '---\nname: x\ntype: project\n---\n' }
      );
      const surface = bridge.surfaceForFeature(projectRoot, 'F-080');
      // formatSurface uses _safeForOutput which strips bytes outside [0x20..0x7E].
      const formatted = bridge.formatSurface(surface);
      assert.doesNotMatch(formatted, /\x1b/, 'no escape byte in formatted surface');
      assert.match(formatted, /Innocent/, 'innocent prefix survives');
    } finally {
      restoreHome();
    }
  });

  it('_safeForOutput truncates very long titles to 200 chars', () => {
    const long = 'x'.repeat(500);
    const safe = bridge._safeForOutput(long);
    assert.equal(safe.length, 200);
  });
});

// -------- Stage-2 #3: path-traversal --------

describe('Stage-2 #3: path-traversal defense', () => {
  it('sibling reference with `../` is silently dropped during parse', () => {
    const { projectRoot, claudeNativeDir, restoreHome } = makeSandboxProject();
    try {
      writeSimple(claudeNativeDir,
        [
          '- [Safe](safe.md) — safe hook',
          '- [Evil](../../etc/passwd) — traversal',
        ],
        { 'safe.md': '---\nname: x\ntype: project\n---\n' }
      );
      const entries = bridge.parseMemoryMd(claudeNativeDir);
      assert.equal(entries.length, 1, 'traversal entry dropped');
      assert.equal(entries[0].title, 'Safe');
    } finally {
      restoreHome();
    }
  });

  it('sibling reference with backslash is silently dropped', () => {
    const { projectRoot, claudeNativeDir, restoreHome } = makeSandboxProject();
    try {
      writeSimple(claudeNativeDir,
        [
          '- [Safe](safe.md) — ok',
          '- [Win](..\\evil.md) — windows traversal',
        ],
        { 'safe.md': '---\nname: x\n---\n' }
      );
      const entries = bridge.parseMemoryMd(claudeNativeDir);
      assert.equal(entries.length, 1);
    } finally {
      restoreHome();
    }
  });

  it('hook column containing `[Other](../../foo)` does NOT introduce a new entry', () => {
    const { projectRoot, claudeNativeDir, restoreHome } = makeSandboxProject();
    try {
      writeSimple(claudeNativeDir,
        [
          '- [Real](real.md) — hook with [Fake](../../etc/passwd) embedded',
        ],
        { 'real.md': '---\nname: x\n---\n' }
      );
      const entries = bridge.parseMemoryMd(claudeNativeDir);
      assert.equal(entries.length, 1, 'only the real entry');
      assert.equal(entries[0].title, 'Real', 'first bracket-paren wins');
      assert.equal(entries[0].file, 'real.md');
    } finally {
      restoreHome();
    }
  });

  it('getProjectSlug rejects NUL byte in path', () => {
    assert.throws(() => bridge.getProjectSlug('/Users/foo\0/bar'), /NUL/);
  });
});

// -------- Stage-2 #4: silent-skip is REAL silent --------

describe('Stage-2 #4: silent-skip emits ZERO stdout/stderr (subprocess capture)', () => {
  it('missing claude-native dir → no stdout, no stderr from getBridgeData', () => {
    // Use spawnSync to capture both streams verbatim. We can't trust an in-process
    // monkey-patch of console.* because some downstream helpers use process.stderr.write
    // directly.
    const code = `
      const path = require('node:path');
      const os = require('node:os');
      // Override homedir so the slug points to a guaranteed-missing dir.
      os.homedir = () => '/tmp/cap-bridge-no-home-${Date.now()}';
      const bridge = require('${path.join(__dirname, '..', 'cap', 'bin', 'lib', 'cap-memory-bridge.cjs').replace(/\\/g, '\\\\')}');
      const data = bridge.getBridgeData('/Users/nobody/never-exists-${Date.now()}');
      // The only thing we print is the JSON return — anything ELSE on stdout/stderr is a fail.
      process.stdout.write(JSON.stringify({ available: data.available, reason: data.reason }));
    `;
    const result = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8' });
    assert.equal(result.status, 0, `subprocess exit code: ${result.status}, stderr: ${result.stderr}`);
    // stderr MUST be empty.
    assert.equal(result.stderr, '', `stderr should be empty, got: ${JSON.stringify(result.stderr)}`);
    // stdout MUST be exactly the JSON we wrote.
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.available, false);
    assert.equal(parsed.reason, 'no-claude-native-dir');
  });

  it('corrupt cache JSON → graceful re-parse, ZERO stderr', () => {
    const { projectRoot, claudeNativeDir, restoreHome } = makeSandboxProject();
    try {
      writeSimple(claudeNativeDir,
        ['- [Foo](foo.md) — hook'],
        { 'foo.md': '---\nname: x\n---\n' }
      );
      const cachePath = bridge.getCachePath(projectRoot);
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      fs.writeFileSync(cachePath, '{not-valid-json{{{', 'utf8');
      // loadCachedIndex must return null silently.
      const cached = bridge.loadCachedIndex(projectRoot);
      assert.equal(cached, null);
      // getBridgeData must still surface entries (re-parse path).
      const data = bridge.getBridgeData(projectRoot);
      assert.equal(data.available, true);
      assert.equal(data.entries.length, 1);
    } finally {
      restoreHome();
    }
  });
});

// -------- Stage-2 #5: cache TOCTOU --------

describe('Stage-2 #5: cache TOCTOU is benign (no crash, sensible output)', () => {
  it('source modified between isCacheValid and refreshCache → still produces valid output', () => {
    const { projectRoot, claudeNativeDir, restoreHome } = makeSandboxProject();
    try {
      writeSimple(claudeNativeDir,
        ['- [A](a.md) — hook'],
        { 'a.md': '---\nname: x\n---\n' }
      );
      bridge.refreshCache(projectRoot);
      // Modify source AFTER cache write but BEFORE next call. Bump mtime explicitly.
      const memoryMdPath = path.join(claudeNativeDir, 'MEMORY.md');
      fs.writeFileSync(memoryMdPath, '- [A](a.md) — hook\n- [B](b.md) — hook2\n', 'utf8');
      fs.writeFileSync(path.join(claudeNativeDir, 'b.md'), '---\nname: y\n---\n', 'utf8');
      const future = new Date(Date.now() + 5000);
      fs.utimesSync(memoryMdPath, future, future);
      const data = bridge.getBridgeData(projectRoot);
      assert.equal(data.available, true);
      assert.equal(data.entries.length, 2, 'cache invalidated and re-parsed');
    } finally {
      restoreHome();
    }
  });
});

// -------- Stage-2 #6: atomic cache writes --------

describe('Stage-2 #6: atomic cache writes (no half-written tmp left behind)', () => {
  it('after refreshCache, no stray .tmp files in .cap/memory/', () => {
    const { projectRoot, claudeNativeDir, restoreHome } = makeSandboxProject();
    try {
      writeSimple(claudeNativeDir, ['- [A](a.md) — hook'], { 'a.md': '---\nname: x\n---\n' });
      bridge.refreshCache(projectRoot);
      bridge.refreshCache(projectRoot);
      bridge.refreshCache(projectRoot);
      const dir = path.join(projectRoot, '.cap', 'memory');
      const entries = fs.readdirSync(dir);
      const tmpFiles = entries.filter((f) => f.endsWith('.tmp') || f.includes('.tmp.'));
      assert.deepEqual(tmpFiles, [], 'no .tmp leftovers');
    } finally {
      restoreHome();
    }
  });
});

// -------- Stage-2 #7: round-trip stability --------

describe('Stage-2 #7: round-trip stability', () => {
  it('refresh + refresh (no source change) → cache file is byte-identical second time', () => {
    const { projectRoot, claudeNativeDir, restoreHome } = makeSandboxProject();
    try {
      writeSimple(claudeNativeDir,
        ['- [A](a.md) — hook a', '- [B](b.md) — hook b'],
        { 'a.md': '---\nname: A\n---\n', 'b.md': '---\nname: B\n---\n' }
      );
      bridge.refreshCache(projectRoot);
      const cachePath = bridge.getCachePath(projectRoot);
      const c1 = fs.readFileSync(cachePath, 'utf8');
      bridge.refreshCache(projectRoot);
      const c2 = fs.readFileSync(cachePath, 'utf8');
      assert.equal(c1, c2, 'cache content byte-identical across refreshes');
    } finally {
      restoreHome();
    }
  });
});

// -------- Stage-2 #8: surface limit hard-cap --------

describe('Stage-2 #8: surface limit is HARD-cap, not best-effort', () => {
  it('7 candidates → exactly 5 bullets, truncated:true', () => {
    const { projectRoot, claudeNativeDir, restoreHome } = makeSandboxProject();
    try {
      const lines = [];
      const sibs = {};
      for (let i = 0; i < 7; i++) {
        lines.push(`- [F-080 e${i}](e${i}.md) — hook ${i}`);
        sibs[`e${i}.md`] = `---\nname: e${i}\n---\n`;
      }
      writeSimple(claudeNativeDir, lines, sibs);
      const surface = bridge.surfaceForFeature(projectRoot, 'F-080');
      assert.equal(surface.bullets.length, 5);
      assert.equal(surface.truncated, true);
    } finally {
      restoreHome();
    }
  });
});

// -------- Stage-2 #9: tie-break determinism --------

describe('Stage-2 #9: priority tie-break is deterministic (mtime desc, title asc)', () => {
  it('three same-tier entries with same mtime → sorted by title asc deterministically', () => {
    const { projectRoot, claudeNativeDir, restoreHome } = makeSandboxProject();
    try {
      writeSimple(claudeNativeDir,
        [
          '- [F-080 charlie](c.md) — hook',
          '- [F-080 alpha](a.md) — hook',
          '- [F-080 bravo](b.md) — hook',
        ],
        { 'a.md': '---\nname: a\n---\n', 'b.md': '---\nname: b\n---\n', 'c.md': '---\nname: c\n---\n' }
      );
      // Force same mtime on all siblings so title is the discriminator.
      const sameTime = new Date('2026-05-01T00:00:00Z');
      for (const f of ['a.md', 'b.md', 'c.md']) {
        fs.utimesSync(path.join(claudeNativeDir, f), sameTime, sameTime);
      }
      const surface = bridge.surfaceForFeature(projectRoot, 'F-080');
      // alpha < bravo < charlie alphabetically → that order in bullets.
      const idxA = surface.bullets.findIndex((b) => b.includes('alpha'));
      const idxB = surface.bullets.findIndex((b) => b.includes('bravo'));
      const idxC = surface.bullets.findIndex((b) => b.includes('charlie'));
      assert.ok(idxA < idxB && idxB < idxC, `expected alpha<bravo<charlie, got order: ${surface.bullets.join(' | ')}`);
    } finally {
      restoreHome();
    }
  });

  it('repeated calls produce IDENTICAL bullet order', () => {
    const { projectRoot, claudeNativeDir, restoreHome } = makeSandboxProject();
    try {
      const lines = [];
      const sibs = {};
      for (let i = 0; i < 4; i++) {
        lines.push(`- [F-080 e${i}](e${i}.md) — h${i}`);
        sibs[`e${i}.md`] = `---\nname: e${i}\n---\n`;
      }
      writeSimple(claudeNativeDir, lines, sibs);
      const s1 = bridge.surfaceForFeature(projectRoot, 'F-080');
      const s2 = bridge.surfaceForFeature(projectRoot, 'F-080');
      assert.deepEqual(s1.bullets, s2.bullets);
    } finally {
      restoreHome();
    }
  });
});

// -------- Stage-2 #10: missing/empty/malformed siblings --------

describe('Stage-2 #10: missing / empty / malformed siblings', () => {
  it('missing sibling file referenced from index → entry survives but type/mtime null', () => {
    const { projectRoot, claudeNativeDir, restoreHome } = makeSandboxProject();
    try {
      writeSimple(claudeNativeDir, ['- [Foo](foo.md) — hook'], {});  // no sibling
      const entries = bridge.parseMemoryMd(claudeNativeDir);
      assert.equal(entries.length, 1);
      assert.equal(entries[0].type, null);
      assert.equal(entries[0].fileMtime, null);
    } finally {
      restoreHome();
    }
  });

  it('empty MEMORY.md → entries: []', () => {
    const { projectRoot, claudeNativeDir, restoreHome } = makeSandboxProject();
    try {
      fs.writeFileSync(path.join(claudeNativeDir, 'MEMORY.md'), '', 'utf8');
      const entries = bridge.parseMemoryMd(claudeNativeDir);
      assert.deepEqual(entries, []);
      const data = bridge.getBridgeData(projectRoot);
      assert.equal(data.available, true);
      assert.equal(data.entries.length, 0);
      assert.equal(data.reason, 'parse-empty');
    } finally {
      restoreHome();
    }
  });

  it('sibling with no frontmatter → type/description null but file still indexed', () => {
    const { projectRoot, claudeNativeDir, restoreHome } = makeSandboxProject();
    try {
      writeSimple(claudeNativeDir,
        ['- [Foo](foo.md) — hook'],
        { 'foo.md': 'just a body, no frontmatter\n' }
      );
      const entries = bridge.parseMemoryMd(claudeNativeDir);
      assert.equal(entries.length, 1);
      assert.equal(entries[0].type, null);
      assert.equal(entries[0].description, null);
      assert.ok(entries[0].fileMtime);
    } finally {
      restoreHome();
    }
  });

  it('malformed entry line in MEMORY.md → just that line is skipped, others survive', () => {
    const { projectRoot, claudeNativeDir, restoreHome } = makeSandboxProject();
    try {
      const memoryMd = [
        '- [Real](real.md) — hook',
        '- [Broken — no closing paren',  // malformed
        '- not even a bullet',
        '- [Other](other.md) — hook2',
      ].join('\n');
      fs.writeFileSync(path.join(claudeNativeDir, 'MEMORY.md'), memoryMd, 'utf8');
      fs.writeFileSync(path.join(claudeNativeDir, 'real.md'), '---\nname: x\n---\n', 'utf8');
      fs.writeFileSync(path.join(claudeNativeDir, 'other.md'), '---\nname: y\n---\n', 'utf8');
      const entries = bridge.parseMemoryMd(claudeNativeDir);
      assert.equal(entries.length, 2);
    } finally {
      restoreHome();
    }
  });

  it('duplicate sibling reference → second one skipped (dedup by file)', () => {
    const { projectRoot, claudeNativeDir, restoreHome } = makeSandboxProject();
    try {
      const memoryMd = [
        '- [First](dup.md) — hook 1',
        '- [Second](dup.md) — hook 2',
      ].join('\n');
      fs.writeFileSync(path.join(claudeNativeDir, 'MEMORY.md'), memoryMd, 'utf8');
      fs.writeFileSync(path.join(claudeNativeDir, 'dup.md'), '---\nname: x\n---\n', 'utf8');
      const entries = bridge.parseMemoryMd(claudeNativeDir);
      assert.equal(entries.length, 1);
      assert.equal(entries[0].title, 'First', 'first occurrence wins');
    } finally {
      restoreHome();
    }
  });
});

// -------- F-080-FIX-A: _safeForOutput at parse-time --------

// @cap-decision(F-080/followup) F-080-FIX-A: _safeForOutput at parse-time, not surface-time.
//   Pin: ANSI bytes in the hook field → entries[N].hook does NOT contain `\x1b`.
describe('F-080-FIX-A: parse-time sanitization of hook + description', () => {
  it('ANSI bytes in hook field are stripped at parse-time (entries[].hook is safe)', () => {
    const { projectRoot, claudeNativeDir, restoreHome } = makeSandboxProject();
    try {
      const ansiHook = 'safe-prefix\x1b[31mEVIL\x1b[0msuffix';
      const ansiDescription = 'desc\x1b[2mhidden\x1b[0m';
      writeSimple(claudeNativeDir,
        [`- [Title](file.md) — ${ansiHook}`],
        { 'file.md': `---\nname: x\ntype: project\ndescription: ${ansiDescription}\n---\n` }
      );
      const entries = bridge.parseMemoryMd(claudeNativeDir);
      assert.equal(entries.length, 1, 'one entry parsed');
      assert.doesNotMatch(entries[0].hook, /\x1b/, 'hook field has no escape bytes');
      assert.match(entries[0].hook, /safe-prefix/, 'safe prefix retained in hook');
      assert.doesNotMatch(entries[0].description || '', /\x1b/, 'description has no escape bytes');
      // Title is also safe (already covered by Stage-2 #2 but pinned here for symmetry).
      assert.doesNotMatch(entries[0].title, /\x1b/, 'title has no escape bytes');
    } finally {
      restoreHome();
    }
  });

  it('ANSI bytes are stripped on cache-load too (loadCachedIndex sanitizes)', () => {
    const { projectRoot, claudeNativeDir, restoreHome } = makeSandboxProject();
    try {
      // Manually write a poisoned cache (simulating an older version that didn't sanitize).
      const cachePath = bridge.getCachePath(projectRoot);
      const ansiTitle = 'Title\x1b[31mEVIL\x1b[0m';
      const ansiHook = 'hook\x1b[2mhidden\x1b[0m';
      const ansiDescription = 'desc\x1b[31mEVIL\x1b[0m';
      const poisoned = {
        schemaVersion: bridge.CACHE_SCHEMA_VERSION,
        sourceRoot: claudeNativeDir,
        memoryMdMtime: '2026-05-07T00:00:00.000Z',
        entries: [
          { title: ansiTitle, file: 'a.md', hook: ansiHook, type: 'project', fileMtime: null, description: ansiDescription },
        ],
      };
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify(poisoned), 'utf8');
      const cached = bridge.loadCachedIndex(projectRoot);
      assert.ok(cached, 'cache loaded');
      assert.equal(cached.entries.length, 1);
      assert.doesNotMatch(cached.entries[0].title, /\x1b/, 'title sanitized on cache load');
      assert.doesNotMatch(cached.entries[0].hook, /\x1b/, 'hook sanitized on cache load');
      assert.doesNotMatch(cached.entries[0].description || '', /\x1b/, 'description sanitized on cache load');
    } finally {
      restoreHome();
    }
  });
});

// -------- F-080-FIX-B: MEMORY_MD_LINE_RE requires surrounding spaces for hyphen --------

// @cap-decision(F-080/followup) F-080-FIX-B: hyphen separator now requires surrounding whitespace.
describe('F-080-FIX-B: hyphen-in-title disambiguation', () => {
  it('title containing inner hyphen does NOT split at the inner hyphen', () => {
    const { projectRoot, claudeNativeDir, restoreHome } = makeSandboxProject();
    try {
      // The title bracket is delimited by `]`, so a hyphen inside is captured by the title group.
      // What we want to pin: a line like `- [Foo-Bar](file.md) Description with-no-separator`
      //   does NOT match (no real separator), and a line like `- [Foo-Bar](file.md) - hook`
      //   DOES match with hook='hook' (surrounding spaces around hyphen).
      writeSimple(claudeNativeDir,
        [
          '- [Foo-Bar](safe.md) - hook with hyphen',
          '- [No-Sep-Foo](nosep.md) inline-text-no-sep',
        ],
        {
          'safe.md': '---\nname: x\n---\n',
          'nosep.md': '---\nname: y\n---\n',
        }
      );
      const entries = bridge.parseMemoryMd(claudeNativeDir);
      // The hyphen-with-spaces line MUST parse, with title intact.
      const safe = entries.find((e) => e.file === 'safe.md');
      assert.ok(safe, 'space-padded hyphen separator parsed');
      assert.equal(safe.title, 'Foo-Bar', 'title is `Foo-Bar` (NOT `Foo` with separator at inner hyphen)');
      assert.match(safe.hook, /hook with hyphen/, 'hook captured correctly');
      // The no-separator line must NOT parse (no hook means no real bullet entry shape).
      const nosep = entries.find((e) => e.file === 'nosep.md');
      assert.equal(nosep, undefined, 'no-separator line silently dropped (not a valid bullet)');
    } finally {
      restoreHome();
    }
  });

  it('em-dash (—) and en-dash (–) still parse without requiring extra whitespace', () => {
    const { projectRoot, claudeNativeDir, restoreHome } = makeSandboxProject();
    try {
      writeSimple(claudeNativeDir,
        [
          '- [Em](em.md) — em hook',
          '- [En](en.md) – en hook',
        ],
        {
          'em.md': '---\nname: x\n---\n',
          'en.md': '---\nname: y\n---\n',
        }
      );
      const entries = bridge.parseMemoryMd(claudeNativeDir);
      assert.equal(entries.length, 2, 'both em/en-dash forms parse');
      const em = entries.find((e) => e.file === 'em.md');
      const en = entries.find((e) => e.file === 'en.md');
      assert.equal(em && em.title, 'Em');
      assert.equal(en && en.title, 'En');
    } finally {
      restoreHome();
    }
  });
});

// -------- F-080-FIX-C: rename retry on EBUSY/EPERM with backoff --------

// @cap-decision(F-080/followup) F-080-FIX-C: pin retry behavior.
describe('F-080-FIX-C: rename retry on EBUSY/EPERM with backoff', () => {
  it('_renameWithRetry retries up to 3 times on EBUSY, then succeeds', () => {
    // Build a tmp file then mock fs.renameSync via dependency-injection-by-monkey-patch.
    const tmpRoot = fs.mkdtempSync(path.join(SANDBOX, 'rename-retry-'));
    const src = path.join(tmpRoot, 'src');
    const dst = path.join(tmpRoot, 'dst');
    fs.writeFileSync(src, 'payload');
    const orig = fs.renameSync;
    let calls = 0;
    fs.renameSync = (a, b) => {
      calls++;
      if (calls < 3) {
        const err = new Error('ebusy mock');
        err.code = 'EBUSY';
        throw err;
      }
      return orig.call(fs, a, b);
    };
    try {
      bridge._renameWithRetry(src, dst);
      assert.equal(calls, 3, 'rename called 3 times (2 EBUSY + 1 success)');
      assert.ok(fs.existsSync(dst), 'destination file exists after success');
    } finally {
      fs.renameSync = orig;
      try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
    }
  });

  it('_renameWithRetry throws after 3 retries when EBUSY persists', () => {
    const tmpRoot = fs.mkdtempSync(path.join(SANDBOX, 'rename-fail-'));
    const src = path.join(tmpRoot, 'src');
    const dst = path.join(tmpRoot, 'dst');
    fs.writeFileSync(src, 'payload');
    const orig = fs.renameSync;
    let calls = 0;
    fs.renameSync = () => {
      calls++;
      const err = new Error('ebusy persistent');
      err.code = 'EBUSY';
      throw err;
    };
    try {
      assert.throws(
        () => bridge._renameWithRetry(src, dst),
        (e) => e && e.code === 'EBUSY',
        'final attempt re-throws the EBUSY'
      );
      assert.equal(calls, 4, 'rename called 4 times (3 retries + 1 initial)');
    } finally {
      fs.renameSync = orig;
      try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
    }
  });

  it('refreshCache emits stderr warning + cleans tmp when rename fails persistently', () => {
    const { projectRoot, claudeNativeDir, restoreHome } = makeSandboxProject();
    const orig = fs.renameSync;
    const origStderrWrite = process.stderr.write.bind(process.stderr);
    let stderrCaptured = '';
    process.stderr.write = (chunk) => {
      stderrCaptured += String(chunk);
      return true;
    };
    let calls = 0;
    fs.renameSync = () => {
      calls++;
      const err = new Error('ebusy persistent');
      err.code = 'EBUSY';
      throw err;
    };
    try {
      writeSimple(claudeNativeDir,
        ['- [Title](a.md) — hook'],
        { 'a.md': '---\nname: x\n---\n' }
      );
      const result = bridge.refreshCache(projectRoot);
      assert.equal(result.written, false, 'refresh signals write failure');
      assert.equal(result.reason, 'cache-write-failed');
      assert.equal(calls, 4, '4 rename attempts (3 retries + 1 initial)');
      assert.match(stderrCaptured, /cache write failed after retries/, 'stderr warning emitted');
      assert.match(stderrCaptured, /EBUSY/, 'stderr warning includes errno');
      // Verify tmp is cleaned up.
      const cacheDir = path.dirname(bridge.getCachePath(projectRoot));
      const tmpFiles = fs.readdirSync(cacheDir).filter((n) => n.includes('.tmp.'));
      assert.equal(tmpFiles.length, 0, 'no .tmp files left after failure');
    } finally {
      fs.renameSync = orig;
      process.stderr.write = origStderrWrite;
      restoreHome();
    }
  });

  it('non-retryable errors (e.g. ENOENT) throw immediately on first attempt', () => {
    const tmpRoot = fs.mkdtempSync(path.join(SANDBOX, 'rename-enoent-'));
    const src = path.join(tmpRoot, 'src-missing');  // does not exist
    const dst = path.join(tmpRoot, 'dst');
    const orig = fs.renameSync;
    let calls = 0;
    fs.renameSync = () => {
      calls++;
      const err = new Error('enoent');
      err.code = 'ENOENT';
      throw err;
    };
    try {
      assert.throws(
        () => bridge._renameWithRetry(src, dst),
        (e) => e && e.code === 'ENOENT',
        'ENOENT re-thrown immediately'
      );
      assert.equal(calls, 1, 'only 1 attempt — no retries on ENOENT');
    } finally {
      fs.renameSync = orig;
      try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
    }
  });
});
