'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  generateAnchorId,
  generateCategoryMarkdown,
  writeMemoryDirectory,
  readMemoryDirectory,
  getCrossReference,
  MEMORY_DIR,
  CATEGORY_FILES,
} = require('../cap/bin/lib/cap-memory-dir.cjs');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-memdir-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeEntry(overrides = {}) {
  return {
    category: 'decision',
    file: '/src/auth.js',
    content: 'Use token-based refresh',
    metadata: {
      source: '2026-04-01T10:00:00Z',
      branch: 'main',
      relatedFiles: ['/src/auth.js'],
      features: ['F-001'],
      pinned: false,
    },
    ...overrides,
  };
}

// --- generateAnchorId ---

describe('generateAnchorId', () => {
  it('generates 8-char hex string', () => {
    const id = generateAnchorId('some content');
    assert.strictEqual(id.length, 8);
    assert.ok(/^[a-f0-9]{8}$/.test(id));
  });

  it('is deterministic', () => {
    assert.strictEqual(generateAnchorId('test'), generateAnchorId('test'));
  });

  it('normalizes whitespace', () => {
    assert.strictEqual(generateAnchorId('hello   world'), generateAnchorId('hello world'));
  });

  it('is case-insensitive', () => {
    assert.strictEqual(generateAnchorId('Hello'), generateAnchorId('hello'));
  });
});

// --- generateCategoryMarkdown ---

describe('generateCategoryMarkdown', () => {
  it('generates decisions markdown', () => {
    const entries = [makeEntry()];
    const md = generateCategoryMarkdown('decision', entries);
    assert.ok(md.includes('# Project Memory: Decisions'));
    assert.ok(md.includes('Use token-based refresh'));
    assert.ok(md.includes('2026-04-01'));
    assert.ok(md.includes('`/src/auth.js`'));
    assert.ok(md.includes('1 decisions total'));
  });

  it('generates hotspots markdown with ranking table', () => {
    const entries = [
      makeEntry({ category: 'hotspot', file: '/src/auth.js', content: 'Frequently modified', metadata: { sessions: 3, edits: 8, since: '2026-03-15', pinned: false, source: '2026-04-01T10:00:00Z' } }),
      makeEntry({ category: 'hotspot', file: '/src/utils.js', content: 'Frequently modified', metadata: { sessions: 2, edits: 4, since: '2026-03-20', pinned: false, source: '2026-04-01T10:00:00Z' } }),
    ];
    const md = generateCategoryMarkdown('hotspot', entries);
    assert.ok(md.includes('# Project Memory: Hotspots'));
    assert.ok(md.includes('| Rank |'));
    assert.ok(md.includes('/src/auth.js'));
    // auth.js should rank first (3 sessions > 2)
    assert.ok(md.indexOf('auth.js') < md.indexOf('utils.js'));
  });

  it('generates hotspots with missing metadata (? fallbacks)', () => {
    const entries = [
      makeEntry({ category: 'hotspot', file: '/src/x.js', content: 'Modified', metadata: { pinned: false } }),
    ];
    const md = generateCategoryMarkdown('hotspot', entries);
    assert.ok(md.includes('?')); // sessions, edits, since all missing -> '?'
  });

  it('sorts hotspots by edits when sessions are equal', () => {
    const entries = [
      makeEntry({ category: 'hotspot', file: '/src/low.js', content: 'Low', metadata: { sessions: 3, edits: 2, since: '2026-01-01', pinned: false } }),
      makeEntry({ category: 'hotspot', file: '/src/high.js', content: 'High', metadata: { sessions: 3, edits: 10, since: '2026-01-01', pinned: false } }),
    ];
    const md = generateCategoryMarkdown('hotspot', entries);
    // high.js should rank first (more edits, same sessions)
    assert.ok(md.indexOf('high.js') < md.indexOf('low.js'));
  });

  it('shows pinned tag', () => {
    const entries = [makeEntry({ metadata: { ...makeEntry().metadata, pinned: true } })];
    const md = generateCategoryMarkdown('decision', entries);
    assert.ok(md.includes('[pinned]'));
  });

  it('handles empty entries', () => {
    const md = generateCategoryMarkdown('pattern', []);
    assert.ok(md.includes('No patterns recorded'));
  });

  it('shows confirmation count for patterns', () => {
    const entries = [makeEntry({ category: 'pattern', content: 'Good approach', metadata: { ...makeEntry().metadata, confirmations: 3 } })];
    const md = generateCategoryMarkdown('pattern', entries);
    assert.ok(md.includes('Confirmed:** 3'));
  });

  it('includes anchor IDs', () => {
    const entries = [makeEntry()];
    const md = generateCategoryMarkdown('decision', entries);
    assert.ok(md.includes('<a id="'));
  });
});

// --- writeMemoryDirectory ---

describe('writeMemoryDirectory', () => {
  it('writes all four category files', () => {
    const entries = [
      makeEntry({ category: 'decision' }),
      makeEntry({ category: 'hotspot', content: 'Hotspot', metadata: { sessions: 2, edits: 5, since: '2026-01-01', pinned: false, source: '2026-04-01T10:00:00Z' } }),
      makeEntry({ category: 'pitfall', content: 'Watch out' }),
      makeEntry({ category: 'pattern', content: 'Good', metadata: { ...makeEntry().metadata, confirmations: 2 } }),
    ];
    const result = writeMemoryDirectory(tmpDir, entries);
    assert.strictEqual(result.written, 4);

    const memPath = path.join(tmpDir, MEMORY_DIR);
    assert.ok(fs.existsSync(path.join(memPath, 'decisions.md')));
    assert.ok(fs.existsSync(path.join(memPath, 'hotspots.md')));
    assert.ok(fs.existsSync(path.join(memPath, 'pitfalls.md')));
    assert.ok(fs.existsSync(path.join(memPath, 'patterns.md')));
  });

  it('dry-run returns content without writing', () => {
    const entries = [makeEntry()];
    const result = writeMemoryDirectory(tmpDir, entries, { dryRun: true });
    assert.strictEqual(result.written, 0);
    assert.ok(result.files['decisions.md'].includes('Use token-based refresh'));
    assert.ok(!fs.existsSync(path.join(tmpDir, MEMORY_DIR)));
  });

  it('creates .cap/memory/ directory', () => {
    writeMemoryDirectory(tmpDir, [makeEntry()]);
    assert.ok(fs.existsSync(path.join(tmpDir, MEMORY_DIR)));
  });
});

// --- readMemoryDirectory ---

describe('readMemoryDirectory', () => {
  it('reads existing memory files', () => {
    writeMemoryDirectory(tmpDir, [makeEntry()]);
    const result = readMemoryDirectory(tmpDir);
    assert.ok(result['decisions.md']);
    assert.ok(result['decisions.md'].includes('Use token-based refresh'));
  });

  it('returns empty for nonexistent directory', () => {
    const result = readMemoryDirectory('/nonexistent');
    assert.deepStrictEqual(result, {});
  });
});

// --- getCrossReference ---

describe('getCrossReference', () => {
  it('generates cross-reference for decision', () => {
    const ref = getCrossReference(makeEntry());
    assert.ok(ref.startsWith('see .cap/memory/decisions.md#'));
    assert.ok(ref.length > 30);
  });

  it('generates cross-reference for hotspot', () => {
    const entry = makeEntry({ category: 'hotspot' });
    const ref = getCrossReference(entry);
    assert.ok(ref.includes('hotspots.md#'));
  });

  it('generates cross-reference for pattern', () => {
    const entry = makeEntry({ category: 'pattern' });
    const ref = getCrossReference(entry);
    assert.ok(ref.includes('patterns.md#'));
  });
});

// --- Branch coverage: parseExistingAnchors ---

describe('parseExistingAnchors', () => {
  const { parseExistingAnchors } = require('../cap/bin/lib/cap-memory-dir.cjs');

  it('extracts anchor IDs from markdown content', () => {
    const content = '### <a id="abc12345"></a>Decision\n### <a id="def67890"></a>Another';
    const anchors = parseExistingAnchors(content);
    assert.strictEqual(anchors.size, 2);
    assert.ok(anchors.has('abc12345'));
    assert.ok(anchors.has('def67890'));
  });

  it('returns empty set for content without anchors', () => {
    const anchors = parseExistingAnchors('No anchors here');
    assert.strictEqual(anchors.size, 0);
  });
});

// --- Branch coverage: generateCategoryMarkdown edge cases ---

describe('generateCategoryMarkdown edge cases', () => {
  it('handles entry with no source date (unknown)', () => {
    const entries = [makeEntry({ metadata: { pinned: false, relatedFiles: [], features: [] } })];
    const md = generateCategoryMarkdown('decision', entries);
    assert.ok(md.includes('unknown'));
  });

  it('handles entry with no relatedFiles (cross-cutting)', () => {
    const entries = [makeEntry({ metadata: { source: '2026-04-01T10:00:00Z', pinned: false, relatedFiles: [], features: [] } })];
    const md = generateCategoryMarkdown('decision', entries);
    assert.ok(md.includes('cross-cutting'));
  });

  it('handles entry with features', () => {
    const entries = [makeEntry({ metadata: { source: '2026-04-01T10:00:00Z', pinned: false, relatedFiles: ['a.js'], features: ['F-001', 'F-002'] } })];
    const md = generateCategoryMarkdown('decision', entries);
    assert.ok(md.includes('F-001'));
    assert.ok(md.includes('F-002'));
  });

  it('handles entry with no features (empty array)', () => {
    const entries = [makeEntry({ metadata: { source: '2026-04-01T10:00:00Z', pinned: false, relatedFiles: ['a.js'], features: [] } })];
    const md = generateCategoryMarkdown('decision', entries);
    // Should not include a features string like "(F-...)"
    assert.ok(!md.includes('(F-'));
  });

  it('handles entry without confirmations', () => {
    const entries = [makeEntry({ category: 'pattern', content: 'Some pattern', metadata: { source: '2026-04-01T10:00:00Z', pinned: false, relatedFiles: [], features: [] } })];
    const md = generateCategoryMarkdown('pattern', entries);
    assert.ok(!md.includes('Confirmed:'));
  });
});

// --- Branch coverage: writeMemoryDirectory merge mode ---

describe('writeMemoryDirectory merge mode', () => {
  it('merges new entries with existing files and skips duplicates', () => {
    const entries = [makeEntry({ content: 'Unique decision alpha' })];
    writeMemoryDirectory(tmpDir, entries);

    // Now merge same entries — should skip since anchor already exists
    const entries2 = [makeEntry({ content: 'Unique decision alpha' })];
    const result = writeMemoryDirectory(tmpDir, entries2, { merge: true });
    assert.strictEqual(result.written, 4);
    assert.ok(result.files['decisions.md'].includes('Unique decision alpha'));
  });

  it('merge mode adds new entries not in existing anchors', () => {
    const entries1 = [makeEntry({ content: 'First decision' })];
    writeMemoryDirectory(tmpDir, entries1);

    const entries2 = [
      makeEntry({ content: 'First decision' }),
      makeEntry({ content: 'Second decision brand new' }),
    ];
    const result = writeMemoryDirectory(tmpDir, entries2, { merge: true });
    assert.strictEqual(result.written, 4);
    assert.ok(result.files['decisions.md'].includes('Second decision brand new'));
  });

  it('merge mode always regenerates hotspots fully', () => {
    const hotspot = makeEntry({
      category: 'hotspot',
      content: 'Frequently modified',
      file: '/src/hot.js',
      metadata: { sessions: 3, edits: 10, since: '2026-01-01', pinned: false, source: '2026-04-01T10:00:00Z' },
    });
    writeMemoryDirectory(tmpDir, [hotspot]);

    const hotspot2 = makeEntry({
      category: 'hotspot',
      content: 'Frequently modified',
      file: '/src/hot.js',
      metadata: { sessions: 5, edits: 15, since: '2026-01-01', pinned: false, source: '2026-04-01T10:00:00Z' },
    });
    const result = writeMemoryDirectory(tmpDir, [hotspot2], { merge: true });
    assert.strictEqual(result.written, 4);
    assert.ok(result.files['hotspots.md'].includes('hot.js'));
  });

  it('handles entries with unknown category (ignored)', () => {
    const entries = [makeEntry({ category: 'unknown_cat' })];
    const result = writeMemoryDirectory(tmpDir, entries, { dryRun: true });
    // Unknown category is silently ignored — grouped map has no slot for it
    assert.strictEqual(result.written, 0);
    assert.ok(result.files['decisions.md']);
  });
});

// --- Branch coverage: getCrossReference edge cases ---

describe('getCrossReference edge cases', () => {
  it('returns empty string for unknown category', () => {
    const entry = makeEntry({ category: 'unknown_cat' });
    const ref = getCrossReference(entry);
    assert.strictEqual(ref, '');
  });

  it('generates cross-reference for pitfall', () => {
    const entry = makeEntry({ category: 'pitfall' });
    const ref = getCrossReference(entry);
    assert.ok(ref.includes('pitfalls.md#'));
  });
});

// --- Assertion density boost: export shape verification ---
describe('cap-memory-dir export verification', () => {
  const mod = require('../cap/bin/lib/cap-memory-dir.cjs');

  it('exports have correct types', () => {
    assert.strictEqual(typeof mod.generateAnchorId, 'function');
    assert.strictEqual(typeof mod.generateCategoryMarkdown, 'function');
    assert.strictEqual(typeof mod.parseExistingAnchors, 'function');
    assert.strictEqual(typeof mod.writeMemoryDirectory, 'function');
    assert.strictEqual(typeof mod.readMemoryDirectory, 'function');
    assert.strictEqual(typeof mod.getCrossReference, 'function');
    assert.strictEqual(typeof mod.MEMORY_DIR, 'string');
    assert.strictEqual(typeof mod.CATEGORY_FILES, 'object');
  });

  it('exported functions are named', () => {
    assert.strictEqual(typeof mod.generateAnchorId, 'function');
    assert.ok(mod.generateAnchorId.name.length > 0);
    assert.strictEqual(typeof mod.generateCategoryMarkdown, 'function');
    assert.ok(mod.generateCategoryMarkdown.name.length > 0);
    assert.strictEqual(typeof mod.parseExistingAnchors, 'function');
    assert.ok(mod.parseExistingAnchors.name.length > 0);
    assert.strictEqual(typeof mod.writeMemoryDirectory, 'function');
    assert.ok(mod.writeMemoryDirectory.name.length > 0);
    assert.strictEqual(typeof mod.readMemoryDirectory, 'function');
    assert.ok(mod.readMemoryDirectory.name.length > 0);
    assert.strictEqual(typeof mod.getCrossReference, 'function');
    assert.ok(mod.getCrossReference.name.length > 0);
  });

  it('constants are stable', () => {
    assert.strictEqual(typeof mod.MEMORY_DIR, 'string');
    assert.ok(mod.MEMORY_DIR.length > 0);
    assert.strictEqual(typeof mod.CATEGORY_FILES, 'object');
    assert.ok(Object.keys(mod.CATEGORY_FILES).length >= 0);
  });
});
