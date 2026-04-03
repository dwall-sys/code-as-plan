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
