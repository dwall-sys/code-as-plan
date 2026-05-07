'use strict';

// @cap-feature(feature:F-080) Tests for cap-memory-bridge.cjs — happy-path coverage for
//   AC-1 (read-only consumer), AC-2 (mtime cache), AC-3 (silent skip), AC-4 (surface format),
//   AC-5 (priority + max-5), AC-6 (fixture-based parse).

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const bridge = require('../cap/bin/lib/cap-memory-bridge.cjs');
const schema = require('../cap/bin/lib/cap-memory-schema.cjs');

// -------- Sandbox --------

let SANDBOX;

before(() => {
  SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-memory-bridge-'));
});

after(() => {
  if (SANDBOX) {
    try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
  }
});

/**
 * Build a fake "project root" with a fake home dir under SANDBOX so we don't touch the
 * real ~/.claude/projects/. The bridge derives the slug from `projectRoot` — by setting
 * HOME to a sandbox dir and creating ~/.claude/projects/<slug>/memory/ inside it, we
 * exercise the full path resolution.
 *
 * @returns {{projectRoot:string, claudeNativeDir:string, restoreHome:Function}}
 */
function makeSandboxProject() {
  const sandboxRoot = fs.mkdtempSync(path.join(SANDBOX, 'sandbox-'));
  const projectRoot = path.join(sandboxRoot, 'work', 'my-project');
  const fakeHome = path.join(sandboxRoot, 'home');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(fakeHome, { recursive: true });
  fs.mkdirSync(path.join(projectRoot, '.cap', 'memory'), { recursive: true });
  // Override HOMEDIR for this test by monkey-patching os.homedir() — the bridge uses
  // os.homedir() so the override flows through getClaudeNativeDir().
  const origHomedir = os.homedir;
  os.homedir = () => fakeHome;
  // Compute the slug the bridge will derive AFTER os.homedir is patched (slug derivation
  // does NOT use homedir; it uses projectRoot directly). The result is deterministic.
  const slug = bridge.getProjectSlug(projectRoot);
  const claudeNativeDir = path.join(fakeHome, '.claude', 'projects', slug, 'memory');
  fs.mkdirSync(claudeNativeDir, { recursive: true });
  return {
    projectRoot,
    claudeNativeDir,
    restoreHome: () => { os.homedir = origHomedir; },
  };
}

/**
 * Write a realistic MEMORY.md fixture mirroring the real project's index format.
 * @param {string} memoryDir
 * @param {Array<{title:string, file:string, hook:string, type?:string, description?:string}>} entries
 */
function writeFixture(memoryDir, entries) {
  const lines = [];
  for (const e of entries) {
    lines.push(`- [${e.title}](${e.file}) — ${e.hook}`);
    const fmLines = ['---', `name: ${e.title}`];
    if (e.description) fmLines.push(`description: ${e.description}`);
    if (e.type) fmLines.push(`type: ${e.type}`);
    fmLines.push('---');
    fmLines.push(`Body for ${e.title}.`);
    fs.writeFileSync(path.join(memoryDir, e.file), fmLines.join('\n') + '\n', 'utf8');
  }
  fs.writeFileSync(path.join(memoryDir, 'MEMORY.md'), lines.join('\n') + '\n', 'utf8');
}

// -------- AC-1: getProjectSlug --------

describe('AC-1: getProjectSlug derives slug from absolute project path', () => {
  it('replaces `/` with `-` and prefixes a leading `-` for absolute POSIX paths', () => {
    const slug = bridge.getProjectSlug('/Users/foo/bar');
    assert.equal(slug, '-Users-foo-bar');
  });

  it('normalizes trailing slashes (idempotent)', () => {
    const a = bridge.getProjectSlug('/Users/foo/bar');
    const b = bridge.getProjectSlug('/Users/foo/bar/');
    assert.equal(a, b);
  });

  it('throws on empty input', () => {
    assert.throws(() => bridge.getProjectSlug(''), /non-empty/);
  });

  it('throws on non-string input', () => {
    assert.throws(() => bridge.getProjectSlug(null), /non-empty/);
  });
});

// -------- AC-1: parseMemoryMd --------

describe('AC-1: parseMemoryMd reads index + sibling frontmatter', () => {
  it('parses 5+ entries from a realistic fixture', () => {
    const { projectRoot, claudeNativeDir, restoreHome } = makeSandboxProject();
    try {
      writeFixture(claudeNativeDir, [
        { title: 'User profile', file: 'user_profile.md', hook: 'Dennis, German-speaking developer', type: 'user', description: 'profile desc' },
        { title: 'Git workflow', file: 'feedback_git_workflow.md', hook: 'Feature branches', type: 'feedback' },
        { title: 'F-080 Bridge', file: 'project_f080_bridge.md', hook: 'Bridge to Claude-native', type: 'project' },
        { title: 'F-079 Snapshots', file: 'project_f079_snapshots.md', hook: 'Snapshot linkage shipped', type: 'project' },
        { title: 'V6 Foundation', file: 'project_v6_foundation.md', hook: 'F-076+F-077+F-078', type: 'project' },
      ]);
      const entries = bridge.parseMemoryMd(claudeNativeDir);
      assert.equal(entries.length, 5);
      assert.equal(entries[0].title, 'User profile');
      assert.equal(entries[0].type, 'user');
      assert.equal(entries[0].description, 'profile desc');
      assert.ok(entries[0].fileMtime, 'fileMtime populated from sibling stat');
    } finally {
      restoreHome();
    }
  });

  it('skips lines that do not match the bullet shape', () => {
    const { claudeNativeDir, restoreHome } = makeSandboxProject();
    try {
      const memoryMd = [
        '# This is a header line, not a bullet',
        '',
        '- [Real Entry](real.md) — real hook',
        'plain prose with no bullet',
        '- [Another](other.md) — other hook',
      ].join('\n');
      fs.writeFileSync(path.join(claudeNativeDir, 'MEMORY.md'), memoryMd, 'utf8');
      fs.writeFileSync(path.join(claudeNativeDir, 'real.md'), '---\nname: Real\n---\nbody.\n', 'utf8');
      fs.writeFileSync(path.join(claudeNativeDir, 'other.md'), '---\nname: Other\n---\nbody.\n', 'utf8');
      const entries = bridge.parseMemoryMd(claudeNativeDir);
      assert.equal(entries.length, 2);
      assert.equal(entries[0].title, 'Real Entry');
      assert.equal(entries[1].title, 'Another');
    } finally {
      restoreHome();
    }
  });

  it('returns empty array when MEMORY.md is missing', () => {
    const { claudeNativeDir, restoreHome } = makeSandboxProject();
    try {
      const entries = bridge.parseMemoryMd(claudeNativeDir);
      assert.deepEqual(entries, []);
    } finally {
      restoreHome();
    }
  });

  it('tolerates en-dash and hyphen separators (mirrors F-082 em-dash lesson)', () => {
    const { claudeNativeDir, restoreHome } = makeSandboxProject();
    try {
      const memoryMd = [
        '- [Em-dash](a.md) — em-dash hook',
        '- [En-dash](b.md) – en-dash hook',
        '- [Hyphen](c.md) - hyphen hook',
      ].join('\n');
      fs.writeFileSync(path.join(claudeNativeDir, 'MEMORY.md'), memoryMd, 'utf8');
      for (const f of ['a.md', 'b.md', 'c.md']) {
        fs.writeFileSync(path.join(claudeNativeDir, f), '---\nname: x\n---\n', 'utf8');
      }
      const entries = bridge.parseMemoryMd(claudeNativeDir);
      assert.equal(entries.length, 3);
    } finally {
      restoreHome();
    }
  });
});

// -------- AC-2: cache I/O --------

describe('AC-2: mtime-based cache invalidation', () => {
  it('loadCachedIndex returns null when cache file missing', () => {
    const { projectRoot, restoreHome } = makeSandboxProject();
    try {
      const cached = bridge.loadCachedIndex(projectRoot);
      assert.equal(cached, null);
    } finally {
      restoreHome();
    }
  });

  it('refreshCache writes JSON cache with all expected fields', () => {
    const { projectRoot, claudeNativeDir, restoreHome } = makeSandboxProject();
    try {
      writeFixture(claudeNativeDir, [
        { title: 'Foo', file: 'foo.md', hook: 'foo hook', type: 'project' },
      ]);
      const result = bridge.refreshCache(projectRoot);
      assert.equal(result.written, true);
      assert.equal(result.reason, 'wrote');
      assert.equal(result.entries.length, 1);
      const cached = bridge.loadCachedIndex(projectRoot);
      assert.ok(cached);
      assert.equal(cached.schemaVersion, bridge.CACHE_SCHEMA_VERSION);
      assert.ok(cached.memoryMdMtime);
      assert.equal(cached.entries[0].title, 'Foo');
      assert.equal(cached.entries[0].type, 'project');
    } finally {
      restoreHome();
    }
  });

  it('isCacheValid returns true immediately after refreshCache', () => {
    const { projectRoot, claudeNativeDir, restoreHome } = makeSandboxProject();
    try {
      writeFixture(claudeNativeDir, [
        { title: 'Foo', file: 'foo.md', hook: 'foo hook' },
      ]);
      bridge.refreshCache(projectRoot);
      assert.equal(bridge.isCacheValid(projectRoot), true);
    } finally {
      restoreHome();
    }
  });

  it('isCacheValid returns false after MEMORY.md mtime advances', () => {
    const { projectRoot, claudeNativeDir, restoreHome } = makeSandboxProject();
    try {
      writeFixture(claudeNativeDir, [
        { title: 'Foo', file: 'foo.md', hook: 'foo hook' },
      ]);
      bridge.refreshCache(projectRoot);
      // Bump MEMORY.md mtime by a full second to defeat fs-resolution.
      const memoryMdPath = path.join(claudeNativeDir, 'MEMORY.md');
      const future = new Date(Date.now() + 5000);
      fs.utimesSync(memoryMdPath, future, future);
      assert.equal(bridge.isCacheValid(projectRoot), false);
    } finally {
      restoreHome();
    }
  });

  it('isCacheValid returns false after a sibling file mtime advances', () => {
    const { projectRoot, claudeNativeDir, restoreHome } = makeSandboxProject();
    try {
      writeFixture(claudeNativeDir, [
        { title: 'Foo', file: 'foo.md', hook: 'foo hook' },
      ]);
      bridge.refreshCache(projectRoot);
      const siblingPath = path.join(claudeNativeDir, 'foo.md');
      const future = new Date(Date.now() + 5000);
      fs.utimesSync(siblingPath, future, future);
      assert.equal(bridge.isCacheValid(projectRoot), false);
    } finally {
      restoreHome();
    }
  });
});

// -------- AC-3: graceful skip --------

describe('AC-3: silent skip on missing/inaccessible Claude-native dir', () => {
  it('getBridgeData returns {available:false} when dir does not exist', () => {
    const { projectRoot, claudeNativeDir, restoreHome } = makeSandboxProject();
    try {
      // Remove the claude-native dir we just created.
      fs.rmSync(claudeNativeDir, { recursive: true, force: true });
      const data = bridge.getBridgeData(projectRoot);
      assert.equal(data.available, false);
      assert.equal(data.reason, 'no-claude-native-dir');
      assert.deepEqual(data.entries, []);
    } finally {
      restoreHome();
    }
  });

  it('getBridgeData returns {available:false} when MEMORY.md missing', () => {
    const { projectRoot, restoreHome } = makeSandboxProject();
    try {
      // Dir exists but no MEMORY.md.
      const data = bridge.getBridgeData(projectRoot);
      assert.equal(data.available, false);
      assert.equal(data.reason, 'no-memory-md');
    } finally {
      restoreHome();
    }
  });

  it('getBridgeData NEVER throws on any input shape', () => {
    // Use a totally different fake home so the slug points to a guaranteed-missing dir.
    const origHomedir = os.homedir;
    os.homedir = () => path.join(SANDBOX, 'nonexistent-home');
    try {
      assert.doesNotThrow(() => bridge.getBridgeData('/Users/nobody/never-exists'));
      const data = bridge.getBridgeData('/Users/nobody/never-exists');
      assert.equal(data.available, false);
    } finally {
      os.homedir = origHomedir;
    }
  });
});

// -------- AC-4 + AC-5: surface --------

describe('AC-4+AC-5: surfaceForFeature priority + max-5 truncation', () => {
  it('returns up to 5 bullets for an active feature with many matches', () => {
    const { projectRoot, claudeNativeDir, restoreHome } = makeSandboxProject();
    try {
      // 7 entries — all match F-080 in title or hook
      const items = [];
      for (let i = 0; i < 7; i++) {
        items.push({ title: `F-080 entry ${i}`, file: `f080_${i}.md`, hook: 'bridge hook', type: 'project' });
      }
      writeFixture(claudeNativeDir, items);
      const surface = bridge.surfaceForFeature(projectRoot, 'F-080');
      assert.equal(surface.bullets.length, 5);
      assert.equal(surface.truncated, true);
    } finally {
      restoreHome();
    }
  });

  it('formatSurface emits "Claude-native erinnert:" header + indented bullets', () => {
    const result = bridge.formatSurface({
      bullets: ['- foo', '- bar'],
      truncated: false,
      chosen: [],
    });
    const lines = result.split('\n');
    assert.equal(lines[0], 'Claude-native erinnert:');
    assert.equal(lines[1], '  - foo');
    assert.equal(lines[2], '  - bar');
  });

  it('formatSurface returns empty string for zero bullets', () => {
    const result = bridge.formatSurface({ bullets: [], truncated: false, chosen: [] });
    assert.equal(result, '');
  });

  it('priority order: activeFeature → related_features → globals', () => {
    const { projectRoot, claudeNativeDir, restoreHome } = makeSandboxProject();
    try {
      writeFixture(claudeNativeDir, [
        { title: 'About F-080', file: 'a.md', hook: 'F-080 stuff', type: 'project' },
        { title: 'About F-079', file: 'b.md', hook: 'F-079 stuff', type: 'project' },
        { title: 'Global Recent', file: 'c.md', hook: 'unrelated recent', type: 'project' },
      ]);
      // Inject related_features = ['F-079'] via test seam.
      const surface = bridge.surfaceForFeature(projectRoot, 'F-080', { relatedFeatures: ['F-079'] });
      // Should be: tier1 (F-080) first, then tier2 (F-079), then tier3 (global).
      assert.ok(surface.bullets[0].includes('F-080'), 'F-080 entry comes first');
      assert.ok(surface.bullets[1].includes('F-079'), 'F-079 (related) comes second');
      assert.ok(surface.bullets[2].includes('Global'), 'global recent comes third');
    } finally {
      restoreHome();
    }
  });

  it('returns no bullets when bridge data is unavailable', () => {
    const { projectRoot, claudeNativeDir, restoreHome } = makeSandboxProject();
    try {
      fs.rmSync(claudeNativeDir, { recursive: true, force: true });
      const surface = bridge.surfaceForFeature(projectRoot, 'F-080');
      assert.deepEqual(surface.bullets, []);
    } finally {
      restoreHome();
    }
  });

  it('reads related_features from per-feature memory file', () => {
    const { projectRoot, claudeNativeDir, restoreHome } = makeSandboxProject();
    try {
      // Write a per-feature memory file with related_features: [F-079].
      const featureFile = schema.getFeaturePath(projectRoot, 'F-080', 'bridge');
      fs.mkdirSync(path.dirname(featureFile), { recursive: true });
      fs.writeFileSync(featureFile, [
        '---',
        'feature: F-080',
        'topic: bridge',
        'updated: 2026-05-07T00:00:00Z',
        'related_features: [F-079]',
        '---',
        '',
        '# F-080: Bridge',
        '',
        schema.AUTO_BLOCK_START_MARKER,
        schema.AUTO_BLOCK_END_MARKER,
        '',
        '## Lessons',
        '',
        'manual lessons',
        '',
      ].join('\n'), 'utf8');
      writeFixture(claudeNativeDir, [
        { title: 'About F-079', file: 'related.md', hook: 'F-079 lesson', type: 'project' },
      ]);
      // No relatedFeatures override → bridge reads from per-feature file.
      const related = bridge._readRelatedFeatures(projectRoot, 'F-080');
      assert.deepEqual(related, ['F-079']);
      const surface = bridge.surfaceForFeature(projectRoot, 'F-080');
      assert.equal(surface.bullets.length, 1);
      assert.ok(surface.bullets[0].includes('F-079'));
    } finally {
      restoreHome();
    }
  });
});

// -------- AC-6: fixture-based parse + cache invalidation + skip + limit --------

describe('AC-6: fixture-based round-trip', () => {
  it('full pipeline: parse + cache + invalidate + re-parse', () => {
    const { projectRoot, claudeNativeDir, restoreHome } = makeSandboxProject();
    try {
      writeFixture(claudeNativeDir, [
        { title: 'Entry A', file: 'a.md', hook: 'hook a', type: 'project' },
      ]);
      // First call → fresh parse + cache write.
      const data1 = bridge.getBridgeData(projectRoot);
      assert.equal(data1.available, true);
      assert.equal(data1.entries.length, 1);
      assert.equal(bridge.isCacheValid(projectRoot), true);
      // Second call → cache hit (no source change between → entries identical).
      const data2 = bridge.getBridgeData(projectRoot);
      assert.deepEqual(data2.entries.map((e) => e.file), data1.entries.map((e) => e.file));
      // Modify source → cache invalidates → re-parse picks up new entry.
      const memoryMdPath = path.join(claudeNativeDir, 'MEMORY.md');
      const newContent = fs.readFileSync(memoryMdPath, 'utf8') +
        '- [Entry B](b.md) — hook b\n';
      fs.writeFileSync(path.join(claudeNativeDir, 'b.md'), '---\nname: B\ntype: project\n---\n', 'utf8');
      // Bump mtime explicitly to defeat fs-resolution (some FSes have 1s mtime granularity).
      const future = new Date(Date.now() + 5000);
      fs.writeFileSync(memoryMdPath, newContent, 'utf8');
      fs.utimesSync(memoryMdPath, future, future);
      assert.equal(bridge.isCacheValid(projectRoot), false);
      const data3 = bridge.getBridgeData(projectRoot);
      assert.equal(data3.entries.length, 2);
    } finally {
      restoreHome();
    }
  });
});
